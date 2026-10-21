import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync,sign } from 'node:crypto';
import { evaluateOffline } from '../src/offline-policy.ts';
const pair=generateKeyPairSync('ed25519');
const serverPublicKey=pair.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
const claims={v:1,tenantId:'tenant-a',userId:'user-a',deviceId:'device-a',publicKey:'ab'.repeat(32),permissions:['offline.use'],securityVersion:1,issuedAt:1000,expiresAt:1000+86400000,grantId:'grant-a'};
const expected={serverPublicKey,tenantId:'tenant-a',userId:'user-a',deviceId:'device-a',publicKey:'ab'.repeat(32),securityVersion:1};
const anchor={bootId:'boot-a',elapsedMs:10000,wallMs:20000,grantId:'grant-a'};
function grant(value=claims){const payload=JSON.stringify(value);return {payload,signature:sign(null,Buffer.from(payload),pair.privateKey).toString('hex')};}

test('firma, ámbito y clave del dispositivo son obligatorios para acceso offline',()=>{
 const valid=grant();
 assert.equal(evaluateOffline(valid,expected,anchor,{bootId:'boot-a',elapsedMs:11000,wallMs:21000}).authorized,true);
 assert.equal(evaluateOffline({...valid,signature:'00'.repeat(64)},expected,anchor,{bootId:'boot-a',elapsedMs:11000,wallMs:21000}).authorized,false);
 assert.equal(evaluateOffline(valid,{...expected,deviceId:'otro'},anchor,{bootId:'boot-a',elapsedMs:11000,wallMs:21000}).authorized,false);
 assert.equal(evaluateOffline(valid,{...expected,userId:'otro'},anchor,{bootId:'boot-a',elapsedMs:11000,wallMs:21000}).authorized,false);
 assert.equal(evaluateOffline(grant({...claims,permissions:[]}),expected,anchor,{bootId:'boot-a',elapsedMs:11000,wallMs:21000}).authorized,false);
});
test('24h exactas, reinicio, retroceso de reloj y ancla ajena bloquean',()=>{
 const valid=grant();
 assert.equal(evaluateOffline(valid,expected,anchor,{bootId:'boot-a',elapsedMs:10000+86400000,wallMs:20000+86400000}).authorized,false);
 assert.equal(evaluateOffline(valid,expected,anchor,{bootId:'boot-b',elapsedMs:11000,wallMs:21000}).authorized,false);
 assert.equal(evaluateOffline(valid,expected,anchor,{bootId:'boot-a',elapsedMs:11000,wallMs:0}).authorized,false);
 assert.equal(evaluateOffline(valid,expected,{...anchor,grantId:'otro'},{bootId:'boot-a',elapsedMs:11000,wallMs:21000}).authorized,false);
 assert.equal(evaluateOffline(grant({...claims,expiresAt:claims.expiresAt+1}),expected,anchor,{bootId:'boot-a',elapsedMs:11000,wallMs:21000}).authorized,false);
});
