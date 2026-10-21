import { readConfig } from '../config.js';
import { createDatabase } from '../database.js';
import {migrateSync} from '../sync/migrations.js';
import {migrateOperations} from '../operations/migrations.js';
import { migrateAcademy } from '../academy/migrations.js';
import { migrateAccess } from './migrations.js';
import { AccessService } from './service.js';
import { signingKey, hashPassword } from './crypto.js';
import { AccessError, loginName, passwordPolicy } from './policy.js';

async function main() {
 const db=createDatabase(readConfig());
 try {
  const command=process.argv[2];
  if(command==='migrate') { await migrateAccess(db); await migrateAcademy(db);await migrateOperations(db);await migrateSync(db); console.log('Migraciones de acceso aplicadas; no se crearon usuarios ni demo.'); return; }
  const service=new AccessService(db,signingKey(process.env.API_OFFLINE_PRIVATE_KEY??''));
  if(command==='bootstrap') {
   const result=await service.bootstrap({slug:process.env.BOOTSTRAP_ACADEMY??'',name:process.env.BOOTSTRAP_ACADEMY_NAME??'',username:process.env.BOOTSTRAP_USERNAME??'',displayName:process.env.BOOTSTRAP_NAME??'',password:process.env.BOOTSTRAP_PASSWORD??''});
   console.log(`Administrador creado de forma explícita. Academia: ${result.tenantId}. No se imprime contraseña.`); return;
  }
  if(command==='recover') {
   const slug=loginName(process.env.BOOTSTRAP_ACADEMY),username=loginName(process.env.BOOTSTRAP_USERNAME),password=process.env.BOOTSTRAP_PASSWORD;
   passwordPolicy(password); const hash=await hashPassword(password);
   await db.transaction(async(tx)=>{
    const tenant=(await service.rows<{id:string}>('SELECT id FROM access_tenants WHERE slug=:slug FOR UPDATE',{slug},tx))[0];
    if(!tenant) throw new AccessError(404,'NOT_FOUND','Academia no encontrada.');
    const user=(await service.rows<{id:string}>("SELECT id FROM access_users WHERE tenant_id=:tenant AND username=:username AND role='ADMIN'",{tenant:tenant.id,username},tx))[0];
    if(!user) throw new AccessError(404,'NOT_FOUND','Administrador no encontrado.');
    await service.run('UPDATE access_users SET password_hash=:hash,active=true,must_change=false,version=version+1,failed_attempts=0,locked_until=NULL WHERE tenant_id=:tenant AND id=:id',{tenant:tenant.id,id:user.id,hash},tx);
    await service.run('DELETE FROM access_sessions WHERE tenant_id=:tenant AND user_id=:id',{tenant:tenant.id,id:user.id},tx);
    await service.audit(tenant.id,null,'owner.recovered',{id:user.id,channel:'maintenance-cli'},tx);
   }); console.log('Acceso del administrador recuperado y auditado; sesiones anteriores revocadas.'); return;
  }
  throw new Error('Comando de acceso desconocido.');
 } finally { await db.close(); }
}
main().catch((error:unknown)=>{console.error(error instanceof AccessError?error.message:'No se completó el comando; revise configuración, claves y migraciones.');process.exitCode=1;});
