import { randomUUID, randomBytes, type KeyObject } from 'node:crypto';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { AccessError, ROLE_PERMISSIONS, validRole, passwordPolicy, text, loginName, uuid, type Role } from './policy.js';
import { hashPassword, verifyPassword, tokenHash, canReplaceDevice, signPayload, verifyDevice, publicKeyHex } from './crypto.js';

type Values = Record<string, string | number | boolean | null>;
export interface Actor {
 id: string; tenant_id: string; tenant_slug: string; username: string; display_name: string;
 role: Role; permissions: string[]; version: number; must_change: boolean;
}
interface UserRow extends Actor { password_hash: string; active: boolean; failed_attempts: number; locked_until: Date | null; }
interface Tenant { id: string; offline_device_id: string | null; offline_expires_at: Date | null; }
export class AccessService {
 constructor(readonly db: Sequelize, readonly key: KeyObject, readonly now: () => number = Date.now) {}
 async rows<T extends object>(sql: string, values: Values = {}, transaction?: Transaction): Promise<T[]> {
  return this.db.query<T>(sql, { replacements: values, type: QueryTypes.SELECT, transaction });
 }
 async run(sql: string, values: Values = {}, transaction?: Transaction) {
  await this.db.query(sql, { replacements: values, transaction });
 }
 async audit(tenant: string, actor: string | null, event: string, details: object, transaction?: Transaction) {
  await this.run('INSERT INTO access_audit(id,tenant_id,actor_id,event,details,created_at) VALUES (:id,:tenant,:actor,:event,CAST(:details AS jsonb),:at)',
   { id: randomUUID(), tenant, actor, event, details: JSON.stringify(details), at: new Date(this.now()).toISOString() }, transaction);
 }
 async bootstrap(input: { slug: string; name: string; username: string; displayName: string; password: string; mode?: 'normal' | 'demo' }) {
  const slug = loginName(input.slug), username = loginName(input.username);
  const name = text(input.name, 'academia'), displayName = text(input.displayName, 'nombre');
  passwordPolicy(input.password);
  const hash = await hashPassword(input.password);
  return this.db.transaction(async (tx) => {
   await this.db.query('SELECT pg_advisory_xact_lock(77821502)', { transaction: tx });
   if ((await this.rows('SELECT id FROM access_tenants WHERE mode<>:mode LIMIT 1', { mode: input.mode ?? 'normal' }, tx)).length) throw new AccessError(409,'DATABASE_MODE','No mezclar instalaciones normales con datos demo.');
   if ((await this.rows('SELECT id FROM access_tenants WHERE slug=:slug', { slug }, tx)).length) throw new AccessError(409,'TENANT_EXISTS','La academia ya existe; no se modificó su administrador.');
   const tenant = randomUUID(), user = randomUUID();
   await this.run('INSERT INTO access_tenants(id,slug,name,mode) VALUES (:id,:slug,:name,:mode)', { id: tenant, slug, name, mode: input.mode ?? 'normal' }, tx);
   for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    await this.run('INSERT INTO access_roles(tenant_id,name,permissions) VALUES (:tenant,:role,CAST(:permissions AS jsonb))', { tenant, role, permissions: JSON.stringify(permissions) }, tx);
   }
   await this.run("INSERT INTO access_users(id,tenant_id,username,display_name,password_hash,role,must_change) VALUES (:id,:tenant,:username,:name,:hash,'ADMIN',false)", { id: user, tenant, username, name: displayName, hash }, tx);
   await this.audit(tenant, user, 'owner.bootstrapped', { channel: 'maintenance-cli' }, tx);
   return { tenantId: tenant, userId: user };
  });
 }
 async login(input: { academy: string; username: string; password: string }) {
  const academy = loginName(input.academy), username = loginName(input.username);
  const bad = () => new AccessError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas o acceso temporalmente bloqueado.');
  if (typeof input.password !== 'string' || input.password.length > 128) throw bad();
  const initial = (await this.rows<{id:string}>('SELECT id FROM access_tenants WHERE slug=:academy', { academy }))[0];
  if (!initial) { await hashPassword(input.password); throw bad(); }
  const result = await this.db.transaction(async (tx) => {
   await this.rows('SELECT id FROM access_tenants WHERE id=:tenant FOR UPDATE', { tenant: initial.id }, tx);
   const user = (await this.rows<UserRow>('SELECT * FROM access_users WHERE tenant_id=:tenant AND username=:username FOR UPDATE', { tenant: initial.id, username }, tx))[0];
   if (!user) { await hashPassword(input.password); return null; }
   const valid = await verifyPassword(input.password, user.password_hash);
   if (!user.active || (user.locked_until && user.locked_until.getTime() > this.now()) || !valid) {
    if (user.active && (!user.locked_until || user.locked_until.getTime() <= this.now())) {
     const count = user.locked_until ? 1 : user.failed_attempts + 1;
     await this.run('UPDATE access_users SET failed_attempts=:count,locked_until=:until WHERE id=:id', { id: user.id, count, until: count >= 5 ? new Date(this.now()+15*60_000).toISOString() : null }, tx);
    }
    await this.audit(initial.id, user.id, 'login.rejected', {}, tx);
    return null;
   }
   await this.run('UPDATE access_users SET failed_attempts=0,locked_until=NULL WHERE id=:id', { id: user.id }, tx);
   const token = randomBytes(32).toString('base64url');
   await this.run('INSERT INTO access_sessions(token_hash,tenant_id,user_id,user_version,expires_at) VALUES (:hash,:tenant,:user,:version,:expires)',
    { hash: tokenHash(token), tenant: initial.id, user: user.id, version: user.version, expires: new Date(this.now()+12*3600_000).toISOString() }, tx);
   await this.audit(initial.id, user.id, 'login.accepted', {}, tx);
   return token;
  });
  if (!result) throw bad();
  return { token: result, user: await this.actor(result, undefined, true) };
 }
 async actor(token: string, permission?: string, allowTemporary = false, tx?: Transaction): Promise<Actor> {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new AccessError(401,'UNAUTHENTICATED','Inicia sesión.');
  const actor = (await this.rows<Actor>(`SELECT u.id,u.tenant_id,t.slug AS tenant_slug,u.username,u.display_name,u.role,r.permissions,u.version,u.must_change
   FROM access_sessions s JOIN access_users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id
   JOIN access_tenants t ON t.id=u.tenant_id JOIN access_roles r ON r.tenant_id=u.tenant_id AND r.name=u.role
   WHERE s.token_hash=:hash AND s.expires_at>:now AND s.user_version=u.version AND u.active=true`,
   { hash: tokenHash(token), now: new Date(this.now()).toISOString() }, tx))[0];
  if (!actor) throw new AccessError(401,'UNAUTHENTICATED','Sesión vencida o revocada.');
  if (actor.must_change && !allowTemporary) throw new AccessError(403,'PASSWORD_CHANGE_REQUIRED','Cambia tu contraseña temporal.');
  if (permission && !actor.permissions.includes(permission)) { await this.audit(actor.tenant_id,actor.id,'permission.denied',{permission},tx); throw new AccessError(403,'FORBIDDEN','No tienes permiso para esta acción.'); }
  return actor;
 }
 async mutate<T>(token: string, permission: string | undefined, action: string, details: object, fn: (actor: Actor, tx: Transaction) => Promise<T>, allowTemporary=false): Promise<T> {
  const first = await this.actor(token, permission, allowTemporary);
  try {
   return await this.db.transaction(async (tx) => {
    await this.rows('SELECT id FROM access_tenants WHERE id=:tenant FOR UPDATE', { tenant: first.tenant_id }, tx);
    const current = await this.actor(token, permission, allowTemporary, tx);
    return fn(current, tx);
   });
  } catch (error) {
   if (error instanceof AccessError) await this.audit(first.tenant_id,first.id,'access.rejected',{ action, code:error.code, ...details });
   throw error;
  }
 }
 async logout(token: string) {
  const actor = await this.actor(token,undefined,true);
  await this.db.transaction(async (tx) => {
   await this.run('DELETE FROM access_sessions WHERE token_hash=:hash', { hash: tokenHash(token) }, tx);
   await this.audit(actor.tenant_id, actor.id, 'session.closed', {}, tx);
  });
 }
 async users(token: string) {
  const actor=await this.actor(token,'users.read');
  return this.rows('SELECT id,username,display_name,role,active,must_change,version FROM access_users WHERE tenant_id=:tenant ORDER BY username', {tenant:actor.tenant_id});
 }
 async roles(token: string) { const a=await this.actor(token,'roles.read'); return this.rows('SELECT name,permissions FROM access_roles WHERE tenant_id=:tenant ORDER BY name',{tenant:a.tenant_id}); }
 async createUser(token: string,input: {username:string;displayName:string;role:Role;password:string}) {
  validRole(input.role); passwordPolicy(input.password);
  const username=loginName(input.username), name=text(input.displayName,'nombre');
  // Autorizar antes del hash costoso; volver a validar dentro de la transacción.
  await this.actor(token,'users.manage');
  const hash=await hashPassword(input.password);
  return this.mutate(token,'users.manage','user.create',{},async(a,tx)=>{
   if ((await this.rows('SELECT id FROM access_users WHERE tenant_id=:tenant AND username=:username',{tenant:a.tenant_id,username},tx)).length) throw new AccessError(409,'USER_EXISTS','El usuario ya existe.');
   const id=randomUUID();
   await this.run('INSERT INTO access_users(id,tenant_id,username,display_name,password_hash,role) VALUES (:id,:tenant,:username,:name,:hash,:role)',{id,tenant:a.tenant_id,username,name,hash,role:input.role},tx);
   await this.audit(a.tenant_id,a.id,'user.created',{id,username,role:input.role},tx);
   return {id};
  });
 }
 async changeUser(token:string,id:string,input:{displayName:string;role:Role;active:boolean;version:number}) {
  uuid(id); validRole(input.role); const name=text(input.displayName,'nombre');
  if(typeof input.active!=='boolean'||!Number.isInteger(input.version)||input.version<1) throw new AccessError(400,'INVALID_INPUT','Estado o versión inválidos.');
  return this.mutate(token,'users.manage','user.update',{id,requested:{name,role:input.role,active:input.active,version:input.version}},async(a,tx)=>{
   const user=(await this.rows<UserRow>('SELECT * FROM access_users WHERE tenant_id=:tenant AND id=:id',{tenant:a.tenant_id,id},tx))[0];
   if(!user) throw new AccessError(404,'NOT_FOUND','Usuario no encontrado.');
   if(user.version!==input.version) throw new AccessError(409,'VERSION_CONFLICT','Otro cambio ya fue aceptado; actualiza la lista.');
   if(user.active&&user.role==='ADMIN'&&(!input.active||input.role!=='ADMIN')) {
    const admins=await this.rows("SELECT id FROM access_users WHERE tenant_id=:tenant AND active=true AND role='ADMIN'",{tenant:a.tenant_id},tx);
    if(admins.length<=1) throw new AccessError(409,'LAST_ADMIN','Debe permanecer un administrador activo.');
   }
   await this.run('UPDATE access_users SET display_name=:name,role=:role,active=:active,version=version+1 WHERE tenant_id=:tenant AND id=:id',{tenant:a.tenant_id,id,name,role:input.role,active:input.active},tx);
   await this.run('DELETE FROM access_sessions WHERE tenant_id=:tenant AND user_id=:id',{tenant:a.tenant_id,id},tx);
   await this.audit(a.tenant_id,a.id,'user.updated',{id,before:{name:user.display_name,role:user.role,active:user.active},after:{name,role:input.role,active:input.active}},tx);
   return {updated:true};
  });
 }
 async resetPassword(token:string,id:string,password:string) {
  uuid(id); passwordPolicy(password); await this.actor(token,'users.manage'); const hash=await hashPassword(password);
  return this.mutate(token,'users.manage','password.reset',{id},async(a,tx)=>{
   if(!(await this.rows('SELECT id FROM access_users WHERE tenant_id=:tenant AND id=:id',{tenant:a.tenant_id,id},tx)).length) throw new AccessError(404,'NOT_FOUND','Usuario no encontrado.');
   if(a.id===id) throw new AccessError(400,'USE_PASSWORD_CHANGE','Usa cambio de contraseña para tu cuenta.');
   await this.run('UPDATE access_users SET password_hash=:hash,must_change=true,version=version+1,failed_attempts=0,locked_until=NULL WHERE tenant_id=:tenant AND id=:id',{tenant:a.tenant_id,id,hash},tx);
   await this.run('DELETE FROM access_sessions WHERE tenant_id=:tenant AND user_id=:id',{tenant:a.tenant_id,id},tx);
   await this.audit(a.tenant_id,a.id,'password.reset',{id},tx); return {updated:true};
  });
 }
 async changePassword(token:string,currentPassword:string,newPassword:string) {
  passwordPolicy(newPassword); if(typeof currentPassword!=='string'||currentPassword.length>128) throw new AccessError(400,'INVALID_INPUT','Contraseña actual inválida.');
  return this.mutate(token,undefined,'password.change',{},async(a,tx)=>{
   const user=(await this.rows<UserRow>('SELECT * FROM access_users WHERE tenant_id=:tenant AND id=:id',{tenant:a.tenant_id,id:a.id},tx))[0]!;
   if(!(await verifyPassword(currentPassword,user.password_hash))) throw new AccessError(400,'INVALID_PASSWORD','Contraseña actual incorrecta.');
   if(currentPassword===newPassword) throw new AccessError(400,'SAME_PASSWORD','Elige una contraseña diferente.');
   const hash=await hashPassword(newPassword);
   await this.run('UPDATE access_users SET password_hash=:hash,must_change=false,version=version+1 WHERE id=:id',{id:a.id,hash},tx);
   await this.run('DELETE FROM access_sessions WHERE tenant_id=:tenant AND user_id=:id',{tenant:a.tenant_id,id:a.id},tx);
   await this.audit(a.tenant_id,a.id,'password.changed',{},tx); return {loginRequired:true};
  },true);
 }
 async challenge(token:string,publicKey:string,purpose:string) {
  if(!/^[a-f0-9]{64}$/.test(publicKey)||!['register','lease'].includes(purpose)) throw new AccessError(400,'INVALID_INPUT','Clave o propósito inválidos.');
  return this.mutate(token,'offline.use','device.challenge',{},async(a,tx)=>{
   await this.run('DELETE FROM access_challenges WHERE tenant_id=:tenant AND user_id=:user AND (expires_at < :now OR consumed=true)',{tenant:a.tenant_id,user:a.id,now:new Date(this.now()).toISOString()},tx);
   const count=await this.rows('SELECT id FROM access_challenges WHERE tenant_id=:tenant AND user_id=:user AND consumed=false',{tenant:a.tenant_id,user:a.id},tx);
   if(count.length>=5) throw new AccessError(429,'TOO_MANY_CHALLENGES','Completa o espera a que venzan los desafíos anteriores.');
   const id=randomUUID(),message=`piscina:device:v1:${a.tenant_id}:${a.id}:${publicKey}:${purpose}:${id}:${randomBytes(32).toString('hex')}`;
   await this.run('INSERT INTO access_challenges(id,tenant_id,user_id,public_key,purpose,message,expires_at) VALUES (:id,:tenant,:user,:key,:purpose,:message,:expires)',{id,tenant:a.tenant_id,user:a.id,key:publicKey,purpose,message,expires:new Date(this.now()+120_000).toISOString()},tx);
   return {id,message};
  });
 }
 async consume(a:Actor,id:string,signature:string,purpose:string,tx:Transaction) {
  uuid(id);
  const challenge=(await this.rows<{public_key:string;message:string;expires_at:Date;consumed:boolean;purpose:string}>('SELECT * FROM access_challenges WHERE tenant_id=:tenant AND user_id=:user AND id=:id FOR UPDATE',{tenant:a.tenant_id,user:a.id,id},tx))[0];
  if(!challenge||challenge.consumed||challenge.purpose!==purpose||challenge.expires_at.getTime()<=this.now()||!verifyDevice(challenge.public_key,challenge.message,signature)) throw new AccessError(403,'INVALID_CHALLENGE','Desafío vencido, utilizado o firma inválida.');
  await this.run('UPDATE access_challenges SET consumed=true WHERE id=:id',{id},tx); return challenge.public_key;
 }
 async registerDevice(token:string,input:{challengeId:string;signature:string;name:string}) {
  const name=text(input.name,'nombre del dispositivo');
  return this.mutate(token,'offline.use','device.register',{},async(a,tx)=>{
   const key=await this.consume(a,input.challengeId,input.signature,'register',tx);
   const existing=(await this.rows<{id:string}>('SELECT id FROM access_devices WHERE tenant_id=:tenant AND public_key=:key',{tenant:a.tenant_id,key},tx))[0];
   if(existing) return existing;
   const id=randomUUID(); await this.run('INSERT INTO access_devices(id,tenant_id,name,public_key,created_at) VALUES (:id,:tenant,:name,:key,:at)',{id,tenant:a.tenant_id,name,key,at:new Date(this.now()).toISOString()},tx);
   await this.audit(a.tenant_id,a.id,'device.registered',{id,name},tx); return {id};
  });
 }
 async devices(token:string) {
  const a=await this.actor(token,'devices.read');
  return this.rows(`SELECT d.id,d.name,d.public_key,d.created_at,(t.offline_device_id=d.id) AS designated,t.offline_expires_at
   FROM access_devices d JOIN access_tenants t ON t.id=d.tenant_id WHERE d.tenant_id=:tenant ORDER BY d.created_at`,{tenant:a.tenant_id});
 }
 async designate(token:string,id:string,expectedDeviceId:string|null) {
  if(expectedDeviceId!==null)uuid(expectedDeviceId);
  uuid(id);
  return this.mutate(token,'devices.manage','device.designate',{id},async(a,tx)=>{
   if(!(await this.rows('SELECT id FROM access_devices WHERE tenant_id=:tenant AND id=:id',{tenant:a.tenant_id,id},tx)).length) throw new AccessError(404,'NOT_FOUND','Dispositivo no encontrado.');
   const tenant=(await this.rows<Tenant>('SELECT * FROM access_tenants WHERE id=:tenant',{tenant:a.tenant_id},tx))[0]!;
   if(tenant.offline_device_id!==expectedDeviceId)throw new AccessError(409,'VERSION_CONFLICT','La designación cambió; actualiza la lista.');
   if(tenant.offline_device_id!==id&&!canReplaceDevice(tenant.offline_expires_at?.getTime()??null,this.now())) throw new AccessError(409,'OFFLINE_LEASE_ACTIVE','Espera al vencimiento del permiso del celular anterior antes de reemplazarlo.');
   if(tenant.offline_device_id!==id) {
    await this.run('UPDATE access_tenants SET offline_device_id=:id,offline_expires_at=NULL WHERE id=:tenant',{tenant:a.tenant_id,id},tx);
    await this.audit(a.tenant_id,a.id,'device.designated',{id,previous:tenant.offline_device_id},tx);
   }
   return {id};
  });
 }
 async offlineAccess(token:string,id:string,input:{challengeId:string;signature:string}) {
  uuid(id);
  return this.mutate(token,'offline.use','access.offline_sync',{id},async(a,tx)=>{
   const publicKey=await this.consume(a,input.challengeId,input.signature,'lease',tx);
   const device=(await this.rows<{id:string}>('SELECT id FROM access_devices WHERE tenant_id=:tenant AND id=:id AND public_key=:key',{tenant:a.tenant_id,id,key:publicKey},tx))[0];
   const tenant=(await this.rows<Tenant>('SELECT * FROM access_tenants WHERE id=:tenant',{tenant:a.tenant_id},tx))[0]!;
   if(!device||tenant.offline_device_id!==id) throw new AccessError(403,'DEVICE_NOT_DESIGNATED','Este celular no está autorizado para acceso offline.');
   const issuedAt=this.now(),expiresAt=issuedAt+24*3600_000,grantId=randomUUID();
   const claims={v:1,tenantId:a.tenant_id,userId:a.id,deviceId:id,publicKey,permissions:a.permissions,securityVersion:a.version,issuedAt,expiresAt,grantId};
   const payload=JSON.stringify(claims),signature=signPayload(this.key,payload);
   await this.run('UPDATE access_tenants SET offline_expires_at=:expires WHERE id=:tenant',{tenant:a.tenant_id,expires:new Date(expiresAt).toISOString()},tx);
   await this.audit(a.tenant_id,a.id,'access.offline_synced',{deviceId:id,grantId,expiresAt},tx);
   return {payload,signature,serverPublicKey:publicKeyHex(this.key)};
  });
 }
 async auditList(token:string) {
  const a=await this.actor(token,'audit.read');
  return this.rows('SELECT id,actor_id,event,details,created_at FROM access_audit WHERE tenant_id=:tenant ORDER BY created_at DESC,id DESC LIMIT 100',{tenant:a.tenant_id});
 }
}
