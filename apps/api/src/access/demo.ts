import { randomUUID } from 'node:crypto';
import { QueryTypes, type Sequelize } from 'sequelize';
import { AccessService } from './service.js';
import { AccessError, ROLE_PERMISSIONS } from './policy.js';
import { hashPassword } from './crypto.js';

export async function seedAccessDemo(service:AccessService,enabled:boolean) {
 const db:Sequelize=service.db;
 const [name]=await db.query<{name:string}>('SELECT current_database() AS name',{type:QueryTypes.SELECT});
 if(!enabled||!name?.name.endsWith('_demo')) throw new AccessError(400,'DEMO_TARGET','Demo requiere opción explícita y BD dedicada con sufijo _demo.');
 const tables=await db.query<{name:string}>('SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema()',{type:QueryTypes.SELECT});
 if(tables.some(t=>!t.name.startsWith('access_')&&!['academy_demo_seed','academy_settings','academy_plans','academy_trainers','academy_classes','academy_students','academy_enrollments','academy_enrollment_classes','academy_operations','academy_cashboxes','academy_files','academy_payments','academy_movements','academy_receipts','academy_cards','academy_attendance','academy_notices'].includes(t.name)&&t.name!=='piscina_migrations')) throw new AccessError(409,'UNKNOWN_DATA','Demo rechazada: existen tablas ajenas al escenario de acceso.');
 const fixtures=[
  {username:'admin',display:'Administrador demo',role:'ADMIN',password:'DemoLocal2026!',active:true,temporary:false},
  {username:'secretaria',display:'Recepción demo',role:'SECRETARIA',password:'RecepcionDemo2026!',active:true,temporary:true},
  {username:'entrenador',display:'Entrenador demo',role:'ENTRENADOR',password:'EntrenadorDemo2026!',active:true,temporary:true},
  {username:'inactivo',display:'Usuario inactivo demo',role:'SECRETARIA',password:'InactivoDemo2026!',active:false,temporary:true},
 ];
 const prepared=await Promise.all(fixtures.map(async(f)=>({...f,hash:await hashPassword(f.password)})));
 await db.transaction(async(tx)=>{
  await db.query('SELECT pg_advisory_xact_lock(77821502)',{transaction:tx});
  if((await service.rows("SELECT id FROM access_tenants WHERE mode<>'demo'",{},tx)).length)throw new AccessError(409,'REAL_DATA','Demo rechazada: la base contiene una academia normal.');
  for(const slug of ['demo-azul','demo-verde']) {
   if((await service.rows('SELECT id FROM access_tenants WHERE slug=:slug',{slug},tx)).length)continue;
   const tenant=randomUUID();
   await service.run("INSERT INTO access_tenants(id,slug,name,mode) VALUES (:id,:slug,:name,'demo')",{id:tenant,slug,name:`Academia ficticia ${slug}`},tx);
   for(const [role,permissions] of Object.entries(ROLE_PERMISSIONS))await service.run('INSERT INTO access_roles(tenant_id,name,permissions) VALUES (:tenant,:role,CAST(:permissions AS jsonb))',{tenant,role,permissions:JSON.stringify(permissions)},tx);
   let owner:string|null=null;
   for(const f of prepared){const id=randomUUID();if(f.role==='ADMIN')owner=id;await service.run('INSERT INTO access_users(id,tenant_id,username,display_name,password_hash,role,active,must_change) VALUES (:id,:tenant,:username,:name,:hash,:role,:active,:temporary)',{id,tenant,username:f.username,name:f.display,hash:f.hash,role:f.role,active:f.active,temporary:f.temporary},tx);}
   await service.audit(tenant,owner,'demo.seeded',{scenario:'access-v1'},tx);
  }
 });
}
