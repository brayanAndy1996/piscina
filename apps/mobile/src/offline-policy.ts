import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/curves/utils.js';
export interface SignedGrant { payload:string; signature:string; }
export interface ExpectedAccess { serverPublicKey:string; tenantId:string; userId:string; deviceId:string; publicKey:string; securityVersion:number; }
export interface ClockSnapshot { bootId:string; elapsedMs:number; wallMs:number; }
export interface AccessAnchor extends ClockSnapshot { grantId:string; }
export function evaluateOffline(grant:SignedGrant,expected:ExpectedAccess,anchor:AccessAnchor,clock:ClockSnapshot):{authorized:boolean;reason:string;expiresAt?:number;readable?:boolean} {
 const deny=(reason:string)=>({authorized:false,reason});
 try {
  if(grant.payload.length>5000||! /^[a-f0-9]{128}$/.test(grant.signature)||! /^[a-f0-9]{64}$/.test(expected.serverPublicKey)) return deny('Firma no válida.');
  if(!ed25519.verify(hexToBytes(grant.signature),new TextEncoder().encode(grant.payload),hexToBytes(expected.serverPublicKey),{zip215:false})) return deny('Firma no válida.');
  const claims:unknown=JSON.parse(grant.payload);
  if(!claims||typeof claims!=='object') return deny('Permiso inválido.');
  const c=claims as Record<string,unknown>;
  if(c.v!==1||c.securityVersion!==expected.securityVersion||c.tenantId!==expected.tenantId||c.userId!==expected.userId||c.deviceId!==expected.deviceId||c.publicKey!==expected.publicKey||c.grantId!==anchor.grantId||!Array.isArray(c.permissions)||!c.permissions.includes('offline.use')) return deny('Permiso de otro usuario o dispositivo.');
  if(typeof c.issuedAt!=='number'||typeof c.expiresAt!=='number'||!Number.isSafeInteger(c.issuedAt)||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=c.issuedAt||c.expiresAt-c.issuedAt>86400000) return deny('Vigencia inválida.');
  if(!clock.bootId||clock.bootId!==anchor.bootId||![clock.elapsedMs,clock.wallMs,anchor.elapsedMs,anchor.wallMs].every(Number.isFinite)) return deny('Vuelve a conectar después del reinicio.');
  const elapsed=clock.elapsedMs-anchor.elapsedMs;
  if(elapsed<0||Math.abs((clock.wallMs-anchor.wallMs)-elapsed)>5000) return deny('El reloj cambió; sincroniza acceso.');
  if(elapsed>=c.expiresAt-c.issuedAt) return {...deny('Vencieron las 24 horas; sincroniza acceso. Solo consulta local.'),readable:true};
  return {authorized:true,reason:'Acceso offline autorizado',expiresAt:c.expiresAt};
 }catch{return deny('No se pudo verificar el permiso.');}
}
