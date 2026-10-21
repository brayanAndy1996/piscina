import {randomUUID} from 'node:crypto';
import {AccessService} from '../access/service.js';
import {AccessError} from '../access/policy.js';
import {dateOnly,remainingDates,quote} from './rules.js';
export async function seedAcademyDemo(access:AccessService,enabled:boolean,baseDate='2026-10-01'){
 const target=(await access.rows<{name:string}>('SELECT current_database() AS name'))[0];if(!enabled||!target?.name.endsWith('_demo'))throw new AccessError(400,'DEMO_TARGET','Solo BD demo explícita.');dateOnly(baseDate);
 await access.db.transaction(async tx=>{
  await access.db.query('SELECT pg_advisory_xact_lock(77821502)',{transaction:tx});if((await access.rows("SELECT id FROM access_tenants WHERE mode<>'demo'",{},tx)).length)throw new AccessError(409,'REAL_DATA','No cargar sobre datos reales.');
  for(const tenant of await access.rows<{id:string}>("SELECT id FROM access_tenants WHERE slug IN ('demo-azul','demo-verde') AND mode='demo'",{},tx)){
   if((await access.rows('SELECT tenant_id FROM academy_demo_seed WHERE tenant_id=:tenant',{tenant:tenant.id},tx)).length)continue;
   const plan=randomUUID(),trainer=randomUUID(),classes=[randomUUID(),randomUUID()];
   const data={name:'Plan grupal demo',priceCents:10000,daysPerWeek:2,monthlyClasses:8,durationMinutes:60,allowedWeekdays:[1,3],allowedHours:[8],levels:['BASICO'],validFrom:'2026-01-01',validTo:'2099-12-31',active:true};
   await access.run('INSERT INTO academy_plans(id,tenant_id,name,data) VALUES (:id,:tenant,:name,CAST(:data AS jsonb))',{id:plan,tenant:tenant.id,name:data.name,data:JSON.stringify(data)},tx);
   const user=(await access.rows<{id:string}>("SELECT id FROM access_users WHERE tenant_id=:tenant AND username='entrenador' AND role='ENTRENADOR'",{tenant:tenant.id},tx))[0];
   await access.run('INSERT INTO academy_trainers(id,tenant_id,name,phone,user_id) VALUES (:id,:tenant,:name,:phone,:user)',{id:trainer,tenant:tenant.id,name:'Entrenador ficticio',phone:'000000000',user:user?.id??null},tx);
   for(let i=0;i<2;i++)await access.run("INSERT INTO academy_classes(id,tenant_id,trainer_id,weekday,hour,level,capacity) VALUES (:id,:tenant,:trainer,:day,8,'BASICO',20)",{id:classes[i]!,tenant:tenant.id,trainer,day:i===0?1:3},tx);
   for(let i=0;i<2;i++){
    const id=randomUUID(),enrollment=randomUUID(),dni=String(90000001+i),name=i===0?'Alumno demo aprobado':'Alumno demo solicitado';
    const student={dni,name,birth:'2010-01-15',level:'BASICO',contact:{phone:'000000000',email:'demo@example.invalid',address:'Dirección ficticia',schoolGrade:'Secundaria'},health:{bloodType:'O+',conditions:'Ejemplo ficticio: requiere supervisión',allergies:'Ejemplo ficticio',medications:'',insurance:'',emergencyName:'Apoderado ficticio',emergencyPhone:'000000000'},guardian:{name:'Apoderado ficticio',dni:'90000009',phone:'000000000',relationship:'Madre'},consents:{data:true,liability:true}};
    await access.run("INSERT INTO academy_students(id,tenant_id,dni,name,birth,level,data) VALUES (:id,:tenant,:dni,:name,'2010-01-15','BASICO',CAST(:data AS jsonb))",{id,tenant:tenant.id,dni,name,data:JSON.stringify(student)},tx);
    const dates=remainingDates(baseDate,[1,3],8);if(!dates.length)throw new AccessError(400,'DEMO_DATE','Fecha base sin clases demo restantes.');const terms={plan:data,dates,classes:dates.length,...quote(10000,8,dates.length),renewalPriority:false};
    await access.run("INSERT INTO academy_enrollments(id,tenant_id,student_id,plan_id,month,start_date,status,source,terms,created_at) VALUES (:id,:tenant,:student,:plan,:month,:date,:status,'STAFF',CAST(:terms AS jsonb),now())",{id:enrollment,tenant:tenant.id,student:id,plan,month:baseDate.slice(0,7),date:baseDate,status:i===0?'APPROVED':'REQUESTED',terms:JSON.stringify(terms)},tx);
    for(const cid of classes)await access.run('INSERT INTO academy_enrollment_classes(tenant_id,enrollment_id,class_id) VALUES (:tenant,:enrollment,:class)',{tenant:tenant.id,enrollment,class:cid},tx);
   }
   await access.run('INSERT INTO academy_demo_seed(tenant_id,base_date) VALUES (:tenant,:date)',{tenant:tenant.id,date:baseDate},tx);await access.audit(tenant.id,null,'demo.academy.seeded',{baseDate},tx);
  }
 });
}
