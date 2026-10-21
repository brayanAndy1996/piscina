import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID, generateKeyPairSync, sign, verify, createPublicKey } from 'node:crypto';
import { Sequelize } from 'sequelize';
import { readTestConfig } from '../test-support/config.js';
import { createDatabase } from '../src/database.js';
import { migrateAccess } from '../src/access/migrations.js';
import { AccessService } from '../src/access/service.js';
import { publicKeyHex, tokenHash } from '../src/access/crypto.js';
import { buildApp } from '../src/app.js';
import type { Role } from '../src/access/policy.js';

const schema='access_test_'+randomUUID().replaceAll('-','');
const config=readTestConfig();
const admin=createDatabase(config);
let db:Sequelize;
let clock=Date.now();
const key=generateKeyPairSync('ed25519').privateKey;
let access:AccessService;
const password='PersonalPrueba2026!';
before(async()=>{
 await admin.query(`CREATE SCHEMA "${schema}"`);
 db=new Sequelize(config.databaseUrl,{dialect:'postgres',logging:false,pool:{max:6,min:0},dialectOptions:{options:`-c search_path=${schema}`,...(config.databaseSsl?{ssl:{require:true,rejectUnauthorized:true}}:{})}});
 await migrateAccess(db);
 access=new AccessService(db,key,()=>clock);
});
after(async()=>{if(db)await db.close();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();});
async function owner(){
 const slug='test-'+randomUUID().slice(0,8);
 const ids=await access.bootstrap({slug,name:'Academia ficticia',username:'admin',displayName:'Propietario prueba',password});
 const {token,user}=await access.login({academy:slug,username:'admin',password});
 return {slug,token,user,...ids};
}
async function employee(ownerToken:string,academy:string,username:string,role:Role='SECRETARIA'){
 const {id}=await access.createUser(ownerToken,{username,displayName:username,role,password});
 const first=await access.login({academy,username,password});
 await access.changePassword(first.token,password,password+'nuevo');
 const current=await access.login({academy,username,password:password+'nuevo'});
 return {id,...current};
}
function deviceKey(){const pair=generateKeyPairSync('ed25519');return {secret:pair.privateKey,publicKey:publicKeyHex(pair.privateKey)};}
async function register(token:string,name='Android prueba'){
 const keys=deviceKey();
 const challenge=await access.challenge(token,keys.publicKey,'register');
 const signature=sign(null,Buffer.from(challenge.message),keys.secret).toString('hex');
 const device=await access.registerDevice(token,{challengeId:challenge.id,signature,name});
 return {...keys,...device,challenge,signature};
}

test('migración repetible, bootstrap explícito y hash/token no guardados en claro',async()=>{
 const o=await owner();await migrateAccess(db);
 await assert.rejects(access.bootstrap({slug:o.slug,name:'Otra',username:'otro',displayName:'Otro',password}),{code:'TENANT_EXISTS'});
 const rows=await access.rows<{password_hash:string}>('SELECT password_hash FROM access_users WHERE id=:id',{id:o.userId});
 assert.notEqual(rows[0]?.password_hash,password);
 const sessions=await access.rows<{token_hash:string}>('SELECT token_hash FROM access_sessions WHERE user_id=:id',{id:o.userId});
 assert.ok(sessions.some(s=>s.token_hash===tokenHash(o.token)));assert.ok(sessions.every(s=>s.token_hash!==o.token));
});

test('API niega sin sesión, temporal, rol sin permisos y datos de otro tenant',async()=>{
 const o=await owner(),other=await owner();
 const created=await access.createUser(o.token,{username:'secretaria',displayName:'Recepción',role:'SECRETARIA',password});
 const temporary=await access.login({academy:o.slug,username:'secretaria',password});
 const app=buildApp({database:{authenticate:async()=>{},close:async()=>{}},corsOrigins:[],access});
 const auth=(token:string)=>({authorization:`Bearer ${token}`});
 try{
  assert.equal((await app.inject('/users')).statusCode,401);
  const blocked=await app.inject({url:'/devices',headers:auth(temporary.token)});assert.equal(blocked.statusCode,403);assert.equal(blocked.json().code,'PASSWORD_CHANGE_REQUIRED');
  await access.changePassword(temporary.token,password,password+'nuevo');
  await assert.rejects(access.actor(temporary.token),{code:'UNAUTHENTICATED'});
  const staff=await access.login({academy:o.slug,username:'secretaria',password:password+'nuevo'});
  assert.equal((await app.inject({url:'/users',headers:auth(staff.token)})).statusCode,403);
  assert.equal((await app.inject({url:'/roles',headers:auth(staff.token)})).statusCode,403);
  const cross=await app.inject({method:'PATCH',url:`/users/${created.id}`,headers:auth(other.token),payload:{displayName:'Manipulado',role:'ADMIN',active:true,version:2}});assert.equal(cross.statusCode,404);
  const forged=await app.inject({method:'POST',url:'/users',headers:auth(o.token),payload:{username:'otro',displayName:'Otro',role:'ADMIN',password,tenantId:other.tenantId}});assert.equal(forged.statusCode,400);
  const users=await app.inject({url:'/users',headers:auth(other.token)});assert.equal(users.json().length,1);
 }finally{await app.close();}
});

test('fallos de login bloquean, sesión expira y logout revoca',async()=>{
 const o=await owner();
 for(let i=0;i<5;i++)await assert.rejects(access.login({academy:o.slug,username:'admin',password:'incorrecta'}),{code:'INVALID_CREDENTIALS'});
 await assert.rejects(access.login({academy:o.slug,username:'admin',password}),{code:'INVALID_CREDENTIALS'});
 clock+=15*60_000;
 const valid=await access.login({academy:o.slug,username:'admin',password});
 await access.logout(valid.token);await assert.rejects(access.actor(valid.token),{code:'UNAUTHENTICATED'});
 clock+=12*3600_000;await assert.rejects(access.actor(o.token),{code:'UNAUTHENTICATED'});
});

test('último administrador protegido también con dos demociones concurrentes',async()=>{
 const o=await owner();
 await assert.rejects(access.changeUser(o.token,o.userId,{displayName:'Propietario',role:'SECRETARIA',active:true,version:1}),{code:'LAST_ADMIN'});
 const second=await employee(o.token,o.slug,'admin-dos','ADMIN');
 const results=await Promise.allSettled([
  access.changeUser(o.token,o.userId,{displayName:'Uno',role:'SECRETARIA',active:true,version:1}),
  access.changeUser(second.token,second.id,{displayName:'Dos',role:'SECRETARIA',active:true,version:second.user.version}),
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const admins=await access.rows("SELECT id FROM access_users WHERE tenant_id=:tenant AND active=true AND role='ADMIN'",{tenant:o.tenantId});assert.equal(admins.length,1);
});

test('cambio de usuario revoca sesiones, stale version va a auditoría y reset exige cambio',async()=>{
 const o=await owner(),staff=await employee(o.token,o.slug,'secretaria');
 await access.changeUser(o.token,staff.id,{displayName:'Recepción nueva',role:'SECRETARIA',active:true,version:staff.user.version});
 await assert.rejects(access.actor(staff.token),{code:'UNAUTHENTICATED'});
 await assert.rejects(access.changeUser(o.token,staff.id,{displayName:'Cambio perdido',role:'SECRETARIA',active:true,version:staff.user.version}),{code:'VERSION_CONFLICT'});
 await access.resetPassword(o.token,staff.id,'TemporalReset2026!');
 const temp=await access.login({academy:o.slug,username:'secretaria',password:'TemporalReset2026!'});assert.equal(temp.user.must_change,true);
 await access.changeUser(o.token,staff.id,{displayName:'Recepción',role:'SECRETARIA',active:false,version:temp.user.version});
 await assert.rejects(access.login({academy:o.slug,username:'secretaria',password:'TemporalReset2026!'}),{code:'INVALID_CREDENTIALS'});
 const audit=JSON.stringify(await access.auditList(o.token));assert.match(audit,/VERSION_CONFLICT/);assert.match(audit,/user.updated/);assert.doesNotMatch(audit,/TemporalReset2026|password_hash|PersonalPrueba/);
});

test('desafío requiere posesión, rechaza replay y expira a dos minutos',async()=>{
 const o=await owner(),keys=deviceKey();
 const challenge=await access.challenge(o.token,keys.publicKey,'register');
 await assert.rejects(access.registerDevice(o.token,{challengeId:challenge.id,signature:'00'.repeat(64),name:'Android'}),{code:'INVALID_CHALLENGE'});
 const signature=sign(null,Buffer.from(challenge.message),keys.secret).toString('hex');
 await access.registerDevice(o.token,{challengeId:challenge.id,signature,name:'Android'});
 await assert.rejects(access.registerDevice(o.token,{challengeId:challenge.id,signature,name:'Android'}),{code:'INVALID_CHALLENGE'});
 const late=await access.challenge(o.token,keys.publicKey,'register');clock+=120_000;
 await assert.rejects(access.registerDevice(o.token,{challengeId:late.id,signature:sign(null,Buffer.from(late.message),keys.secret).toString('hex'),name:'Android'}),{code:'INVALID_CHALLENGE'});
});

test('permiso firmado para un único Android, reemplazo espera 24h y aislamiento',async()=>{
 const o=await owner(),first=await register(o.token),second=await register(o.token),other=await owner();
 await access.designate(o.token,first.id,null);
 const challenge=await access.challenge(o.token,first.publicKey,'lease');
 const grant=await access.offlineAccess(o.token,first.id,{challengeId:challenge.id,signature:sign(null,Buffer.from(challenge.message),first.secret).toString('hex')});
 const claims=JSON.parse(grant.payload);assert.equal(claims.expiresAt-claims.issuedAt,24*3600_000);assert.equal(claims.deviceId,first.id);
 assert.equal(verify(null,Buffer.from(grant.payload),createPublicKey(key),Buffer.from(grant.signature,'hex')),true);
 assert.equal(verify(null,Buffer.from(grant.payload+' '),createPublicKey(key),Buffer.from(grant.signature,'hex')),false);
 await assert.rejects(access.designate(o.token,second.id,first.id),{code:'OFFLINE_LEASE_ACTIVE'});
 await assert.rejects(access.designate(other.token,first.id,null),{code:'NOT_FOUND'});
 const wrong=await access.challenge(o.token,second.publicKey,'lease');
 await assert.rejects(access.offlineAccess(o.token,first.id,{challengeId:wrong.id,signature:sign(null,Buffer.from(wrong.message),second.secret).toString('hex')}),{code:'DEVICE_NOT_DESIGNATED'});
 clock=claims.expiresAt;
 const renewed=await access.login({academy:o.slug,username:'admin',password});
 await access.designate(renewed.token,second.id,first.id);
 const devices=await access.devices(renewed.token);assert.equal(devices.filter(d=>(d as {designated:boolean}).designated).length,1);
});

test('designación concurrente e intento de permiso en otro equipo no habilitan dos',async()=>{
 const o=await owner(),first=await register(o.token),second=await register(o.token);
 await access.designate(o.token,first.id,null);
 const c=await access.challenge(o.token,first.publicKey,'lease');
 await Promise.allSettled([
  access.offlineAccess(o.token,first.id,{challengeId:c.id,signature:sign(null,Buffer.from(c.message),first.secret).toString('hex')}),
  access.designate(o.token,second.id,first.id),
 ]);
 const devices=await access.devices(o.token);assert.equal(devices.filter(d=>(d as {designated:boolean}).designated).length,1);
});
