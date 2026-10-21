import {createPublicKey,verify,type KeyObject} from 'node:crypto';
import {AccessError} from '../access/policy.js';
import {verifyDevice} from '../access/crypto.js';
import {canonical} from '../academy/rules.js';
export interface OfflineOperation {sequence:number;action:string;input:Record<string,unknown>;capturedAt:number;grant:{payload:string;signature:string};basis:Record<string,unknown>;signature:string;}
export interface BusinessClaims {v:number;business:boolean;tenantId:string;userId:string;deviceId:string;publicKey:string;securityVersion:number;issuedAt:number;expiresAt:number;grantId:string;}
export const offlineActions=['student.save','enrollment.create','enrollment.decision','enrollment.schedule','cash.open','cash.movement','cash.close','payment.create','payment.verify','attendance.create','file.upload'];
export function verifyOperation(op:OfflineOperation,tenant:string,user:string,serverKey:KeyObject,now:number):BusinessClaims{
 const bad=()=>new AccessError(403,'INVALID_OFFLINE_PROOF','Firma, ámbito o vigencia de operación offline inválidos.');
 try{if(!op||typeof op!=='object'||Object.keys(op).some(k=>!['sequence','action','input','capturedAt','grant','basis','signature'].includes(k))||!Number.isSafeInteger(op.sequence)||op.sequence<1||op.sequence>2147483647||!offlineActions.includes(op.action)||!op.input||typeof op.input!=='object'||Array.isArray(op.input)||!op.basis||typeof op.basis!=='object'||Array.isArray(op.basis)||!Number.isSafeInteger(op.capturedAt)||!op.grant||typeof op.grant.payload!=='string'||op.grant.payload.length>5000||! /^[a-f0-9]{128}$/.test(op.grant.signature))throw bad();
 if(!verify(null,Buffer.from(op.grant.payload),createPublicKey(serverKey),Buffer.from(op.grant.signature,'hex')))throw bad();const claims=JSON.parse(op.grant.payload) as BusinessClaims;
 if(claims.v!==1||claims.business!==true||claims.tenantId!==tenant||claims.userId!==user||!Number.isSafeInteger(claims.issuedAt)||!Number.isSafeInteger(claims.expiresAt)||claims.expiresAt-claims.issuedAt!==86400000||op.capturedAt<claims.issuedAt||op.capturedAt>=claims.expiresAt||op.capturedAt>now+300000)throw bad();
 const unsigned={sequence:op.sequence,action:op.action,input:op.input,capturedAt:op.capturedAt,grant:op.grant,basis:op.basis};if(!verifyDevice(claims.publicKey,canonical(unsigned),op.signature))throw bad();return claims;
 }catch{throw bad();}
}
