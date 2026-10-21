import * as Crypto from 'expo-crypto';
import {ed25519} from '@noble/curves/ed25519.js';import {bytesToHex} from '@noble/curves/utils.js';
import {canonical} from '../../api/src/academy/rules';
import {localApply} from '../../../contracts/offline-engine';import {businessQuery} from '../../../contracts/business-query';import type {BusinessState,RecordRow as Row,SyncReceipt} from '../../../contracts/offline-protocol';
import {businessStore} from './business-db';import {accessApi,deviceKeys,readGrant,saveGrant,savedDevice,signedChallenge,type Session,type StoredGrant} from './access-client';import {deviceClock} from './device-clock';import {evaluateOffline} from './offline-policy';
let tail:Promise<unknown>=Promise.resolve();
function exclusive<T>(fn:()=>Promise<T>):Promise<T>{const result=tail.then(fn);tail=result.catch(()=>{});return result;}
async function authorized(session:Session,stored:StoredGrant|null,readOnly=false){if(!stored)throw new Error('Sincroniza datos para habilitar el celular offline.');const key=await deviceKeys(),clock=await deviceClock();const result=evaluateOffline(stored.grant,{serverPublicKey:process.env.EXPO_PUBLIC_OFFLINE_PUBLIC_KEY??'',tenantId:session.user.tenant_id,userId:session.user.id,deviceId:stored.deviceId,publicKey:key.publicKey,securityVersion:session.user.version},stored.anchor,clock);if(!result.authorized&&!(readOnly&&result.readable))throw new Error(result.reason);const claims=JSON.parse(stored.grant.payload) as Row;if(claims.business!==true)throw new Error('Sincroniza la copia completa y los pendientes.');return {key,clock,claims,stored};}
async function upload(session:Session){
 const store=await businessStore(session.user.tenant_id),copy=await store.read(),pending=await store.pending();if(copy&&copy.state.userId!==session.user.id&&pending.length)throw new Error('Hay pendientes de otro operador. Debe iniciar sesión esa persona para sincronizarlos.');
 let rejected=0;for(const op of pending){const receipt=await accessApi<SyncReceipt>('sync/push',session.token,op);await store.acknowledge(receipt);if(receipt.status==='REJECTED')rejected++;}
 return {store,copy,rejected};
}
export async function uploadPending(session:Session){return exclusive(async()=>{const {rejected}=await upload(session);return `Pendientes enviados. ${rejected} incidencias para administración. Sincroniza una copia completa antes de continuar.`;});}
export async function syncBusiness(session:Session,deviceId:string){return exclusive(async()=>{
 const {store,copy,rejected}=await upload(session);
 const head=copy?.head??(await accessApi<{lastSequence:number}>('sync/head/'+deviceId,session.token)).lastSequence;
 const anchor=await deviceClock(),proof=await signedChallenge(session,'lease');const response=await accessApi<{state:BusinessState;grant:StoredGrant['grant'];lastSequence:number}>('sync/pull',session.token,{deviceId,queueHead:head,...proof});
 const claims=JSON.parse(response.grant.payload) as Row,stored={grant:response.grant,anchor:{...anchor,grantId:String(claims.grantId)},deviceId};await authorized(session,stored);
 if(response.state.tenantId!==session.user.tenant_id||response.state.userId!==session.user.id||response.state.deviceId!==deviceId||response.lastSequence!==head||claims.lastSequence!==head)throw new Error('Copia de otro operador o secuencia.');
 await store.replace(response.state,head);await saveGrant(stored);return {reason:`Datos sincronizados. ${rejected} operaciones enviadas a auditoría. Autorización por hasta 24 horas.`,rejected};
 });}
const actions:Record<string,string>={'academy/students':'student.save','academy/enrollments':'enrollment.create','academy/enrollments/decision':'enrollment.decision','academy/enrollments/schedule':'enrollment.schedule','operations/cash/open':'cash.open','operations/cash/movement':'cash.movement','operations/cash/close':'cash.close','operations/payments':'payment.create','operations/payments/verify':'payment.verify','operations/attendance':'attendance.create','operations/files':'file.upload'};
export async function businessApi<T>(session:Session,path:string,body?:object):Promise<T>{return exclusive(async()=>{
 const deviceId=await savedDevice(session);if(!deviceId)return accessApi<T>(path,session.token,body);
 const stored=await readGrant();
 // A registered, undesignated phone can continue to work online without opening a native database.
 if(!stored){const devices=await accessApi<{id:string;designated:boolean}[]>('devices',session.token);if(!devices.some(d=>d.id===deviceId&&d.designated))return accessApi<T>(path,session.token,body);throw new Error('Sincroniza datos antes de operar con el celular designado.');}
 const context=await authorized(session,stored,!body),store=await businessStore(session.user.tenant_id);const copy=await store.read();if(!copy||copy.state.userId!==session.user.id||copy.state.deviceId!==deviceId)throw new Error('Primero sincroniza la copia de este operador.');if(copy.needsPull)throw new Error('Completa la sincronización para actualizar la copia.');
 if(!body)return businessQuery(copy.state,path) as T;
 const action=actions[path];if(!action)throw new Error('Esta configuración se modifica online desde la web; sincroniza después el celular.');
 const input=action==='file.upload'?{operationId:Crypto.randomUUID(),data:body}:body as Row;let result:Row={};
 await store.enqueue(async(state,sequence)=>{if(sequence>2147483647)throw new Error('Secuencia agotada; contacta administración.');const fresh=await authorized(session,stored),capturedAt=Number(fresh.claims.issuedAt)+Math.floor(fresh.clock.elapsedMs-stored.anchor.elapsedMs),projection=localApply(state,action,input,capturedAt,'PISCINA:'+bytesToHex(await Crypto.getRandomBytesAsync(32)));result=projection.result;
  const unsigned={sequence,action,input,capturedAt,grant:stored.grant,basis:projection.basis};return {state:projection.state,operation:{...unsigned,signature:bytesToHex(ed25519.sign(new TextEncoder().encode(canonical(unsigned)),context.key.secret))}};});return result as T;
 });}
export async function businessHistory(session:Session){const store=await businessStore(session.user.tenant_id),copy=await store.read();if(copy&&copy.state.userId!==session.user.id)throw new Error('Pendientes de otro operador.');return {pending:(await store.pending()).length,rows:await store.history()};}
export async function localImage(session:Session,fileId:string){const raw=await readGrant();if(!raw)return null;await authorized(session,raw,true);const copy=await (await businessStore(session.user.tenant_id)).read();if(!copy||copy.state.userId!==session.user.id)return null;const file=copy.state.tables.files?.find(f=>f.id===fileId);return file?'data:'+String(file.mime)+';base64,'+String(file.base64):null;}
export async function businessCopy(session:Session){const raw=await readGrant();if(!raw||!session.user.permissions.includes('cash.write'))return null;await authorized(session,raw,true);const copy=await (await businessStore(session.user.tenant_id)).read();if(!copy||copy.state.userId!==session.user.id||copy.needsPull)throw new Error('Completa la sincronización de esta copia.');return copy.state;}
