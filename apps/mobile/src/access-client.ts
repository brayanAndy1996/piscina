import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex,hexToBytes } from '@noble/curves/utils.js';
import { deviceClock } from './device-clock';
import { evaluateOffline,type SignedGrant,type AccessAnchor } from './offline-policy';

export interface SessionUser {id:string;tenant_id:string;tenant_slug:string;username:string;display_name:string;role:string;permissions:string[];must_change:boolean;version:number;}
export interface Session {token:string;user:SessionUser;}
export interface Device {id:string;name:string;public_key:string;designated:boolean;offline_expires_at:string|null;}
interface StoredGrant {grant:SignedGrant;anchor:AccessAnchor;deviceId:string;}
export class ClientError extends Error {constructor(message:string,readonly status=0){super(message);}}
const options={keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY};
export async function accessApi<T>(path:string,token?:string,body?:object,method=body?'POST':'GET'):Promise<T> {
 const configured=process.env.EXPO_PUBLIC_API_URL;
 if(!configured)throw new ClientError('Configura la URL de API.');
 const url=new URL(path,configured.endsWith('/')?configured:configured+'/');
 if(url.username||url.password||!['http:','https:'].includes(url.protocol)||(!__DEV__&&url.protocol!=='https:'))throw new ClientError('La API distribuida requiere HTTPS sin credenciales en la URL.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try {
  const response=await fetch(url.toString(),{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal});
  const data=await response.json();if(!response.ok)throw new ClientError(data.error??'No se completó la acción.',response.status);return data;
 }catch(error){if(error instanceof ClientError)throw error;throw new ClientError('No se pudo conectar con la nube.');}finally{clearTimeout(timer);}
}
export async function readSession():Promise<Session|null>{const text=await SecureStore.getItemAsync('piscina.session',options);return text?JSON.parse(text):null;}
export async function saveSession(session:Session){await SecureStore.setItemAsync('piscina.session',JSON.stringify(session),options);}
export async function clearAccess(){await SecureStore.deleteItemAsync('piscina.offline',options);await SecureStore.deleteItemAsync('piscina.session',options);}
async function deviceKeys(){
 let secret=await SecureStore.getItemAsync('piscina.device.seed',options);
 if(!secret){secret=bytesToHex(await Crypto.getRandomBytesAsync(32));await SecureStore.setItemAsync('piscina.device.seed',secret,options);}
 return {secret:hexToBytes(secret),publicKey:bytesToHex(ed25519.getPublicKey(hexToBytes(secret)))};
}
export async function savedDevice(session:Session){return SecureStore.getItemAsync('piscina.device.'+session.user.tenant_id,options);}
async function signedChallenge(session:Session,purpose:string){
 const key=await deviceKeys();
 const challenge=await accessApi<{id:string;message:string}>('devices/challenge',session.token,{publicKey:key.publicKey,purpose});
 return {challengeId:challenge.id,signature:bytesToHex(ed25519.sign(new TextEncoder().encode(challenge.message),key.secret))};
}
export async function registerDevice(session:Session,name:string){
 const proof=await signedChallenge(session,'register');
 const device=await accessApi<{id:string}>('devices/register',session.token,{...proof,name});
 await SecureStore.setItemAsync('piscina.device.'+session.user.tenant_id,device.id,options);return device.id;
}
export async function syncAccess(session:Session,id:string){
 const anchor=await deviceClock(); // Antes de la solicitud: la latencia nunca extiende la vigencia local.
 const proof=await signedChallenge(session,'lease');
 const grant=await accessApi<SignedGrant>('devices/'+id+'/access-sync',session.token,proof);
 const claims=JSON.parse(grant.payload) as {grantId:string};
 const stored={grant,anchor:{...anchor,grantId:claims.grantId},deviceId:id};
 const key=await deviceKeys();
 const result=evaluateOffline(grant,{serverPublicKey:process.env.EXPO_PUBLIC_OFFLINE_PUBLIC_KEY??'',tenantId:session.user.tenant_id,userId:session.user.id,deviceId:id,publicKey:key.publicKey,securityVersion:session.user.version},stored.anchor,await deviceClock());
 if(!result.authorized)throw new ClientError(result.reason);
 await SecureStore.setItemAsync('piscina.offline',JSON.stringify(stored),options);return result;
}
export async function offlineStatus(session:Session){
 const raw=await SecureStore.getItemAsync('piscina.offline',options);
 if(!raw)return {authorized:false,reason:'Sin autorización offline sincronizada.'};
 const stored=JSON.parse(raw) as StoredGrant;
 const key=await deviceKeys();
 return evaluateOffline(stored.grant,{serverPublicKey:process.env.EXPO_PUBLIC_OFFLINE_PUBLIC_KEY??'',tenantId:session.user.tenant_id,userId:session.user.id,deviceId:stored.deviceId,publicKey:key.publicKey,securityVersion:session.user.version},stored.anchor,await deviceClock());
}
