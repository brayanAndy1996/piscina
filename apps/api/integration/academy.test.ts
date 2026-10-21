import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {Sequelize} from 'sequelize';
import {readTestConfig} from '../test-support/config.js';
import {createDatabase} from '../src/database.js';
import {migrateAccess} from '../src/access/migrations.js';
import {migrateAcademy} from '../src/academy/migrations.js';
import {AccessService} from '../src/access/service.js';
import {AcademyService} from '../src/academy/service.js';
import {buildApp} from '../src/app.js';
const config=readTestConfig(),root=createDatabase(config),schema='academy_test_'+randomUUID().replaceAll('-','');
let db:Sequelize,access:AccessService,academy:AcademyService,token:string,other:string,tenant:string;
const password='PruebaAcademia2026!';
const cmd=(data:object,extra:object={})=>({operationId:randomUUID(),data,...extra});
const student=(dni='70000001')=>({dni,name:'Alumno ficticio',birth:'2012-01-01',level:'BASICO',contact:{phone:'000000000',email:'alumno@example.invalid',address:'Dirección ficticia',schoolGrade:'Segundo'},health:{bloodType:'',conditions:'Dato médico confidencial ficticio',allergies:'',medications:'',insurance:'',emergencyName:'Contacto ficticio',emergencyPhone:'000000000'},guardian:{name:'Apoderado ficticio',dni:'80000001',phone:'000000000',relationship:'Madre'},consents:{data:true,liability:true}});
let planId:string,classId:string,trainerId:string;
before(async()=>{
 await root.query(`CREATE SCHEMA "${schema}"`);db=new Sequelize(config.databaseUrl,{dialect:'postgres',logging:false,dialectOptions:{options:`-c search_path=${schema}`}});await migrateAccess(db);
 access=new AccessService(db,generateKeyPairSync('ed25519').privateKey,()=>Date.parse('2026-10-01T12:00:00Z'));
 const owner=await access.bootstrap({slug:'academy-test',name:'Academia prueba',username:'admin',displayName:'Administrador',password});tenant=owner.tenantId;
 await migrateAcademy(db);await migrateAcademy(db);academy=new AcademyService(access);token=(await access.login({academy:'academy-test',username:'admin',password})).token;
 await access.bootstrap({slug:'other-test',name:'Otra academia',username:'admin',displayName:'Administrador',password});other=(await access.login({academy:'other-test',username:'admin',password})).token;
 planId=(await academy.savePlan(token,cmd({name:'Plan demo',priceCents:10000,daysPerWeek:1,monthlyClasses:4,durationMinutes:60,allowedWeekdays:[1,3],allowedHours:[8,9],levels:['BASICO'],validFrom:'2026-01-01',validTo:'2027-12-31',active:true}))).id;
 trainerId=(await academy.saveTrainer(token,cmd({name:'Entrenador ficticio',phone:'000000000',userId:null,active:true}))).id;
 classId=(await academy.saveClass(token,cmd({trainerId,weekday:1,hour:8,level:'BASICO',capacity:20,active:true}))).id;
});
after(async()=>{if(db)await db.close();await root.query(`DROP SCHEMA "${schema}" CASCADE`);await root.close();});
test('catálogos, replay, versiones y separación tenant/roles',async()=>{
 const request=cmd({name:'Plan replay',priceCents:10000,daysPerWeek:1,monthlyClasses:4,durationMinutes:60,allowedWeekdays:[1],allowedHours:[8],levels:['BASICO'],validFrom:'2026-01-01',validTo:'2027-12-31',active:true});
 const created=await academy.savePlan(token,request);assert.deepEqual(await academy.savePlan(token,request),created);assert.deepEqual(await academy.savePlan(token,{data:request.data,operationId:request.operationId}),created);
 await assert.rejects(academy.savePlan(token,{...request,data:{...request.data,name:'Manipulado'}}),{code:'OPERATION_REUSED'});
 await assert.rejects(academy.savePlan(other,cmd(request.data,{id:created.id,version:1})),{code:'NOT_FOUND'});
 await academy.savePlan(token,cmd(request.data,{id:created.id,version:1}));await assert.rejects(academy.savePlan(token,cmd(request.data,{id:created.id,version:1})),{code:'VERSION_CONFLICT'});
 await access.createUser(token,{username:'secretaria',displayName:'Recepción',role:'SECRETARIA',password});const temp=await access.login({academy:'academy-test',username:'secretaria',password});await access.changePassword(temp.token,password,password+'nueva');const staff=await access.login({academy:'academy-test',username:'secretaria',password:password+'nueva'});
 await assert.rejects(academy.savePlan(staff.token,cmd(request.data)),{code:'FORBIDDEN'});assert.ok((await academy.list(staff.token,'plans')).length>0);
 const app=buildApp({database:{authenticate:async()=>{},close:async()=>{}},corsOrigins:[],access});try{assert.equal((await app.inject({url:'/academy/plans?limit=10',headers:{authorization:'Bearer '+token}})).statusCode,200);}finally{await app.close();}
});
test('alumnos: menor exige apoderado, DNI único y salud fuera de auditoría',async()=>{
 await assert.rejects(academy.saveStudent(token,cmd({...student(),guardian:null})),{code:'INVALID_INPUT'});
 await assert.rejects(academy.saveStudent(token,cmd({...student(),consents:{data:false,liability:true}})),{code:'INVALID_INPUT'});
 const s=await academy.saveStudent(token,cmd(student()));await assert.rejects(academy.saveStudent(token,cmd(student())),{code:'DNI_EXISTS'});
 await assert.rejects(academy.studentDetail(other,s.id),{code:'NOT_FOUND'});
 await assert.rejects(academy.saveStudent(token,cmd({...student(),dni:'70000002'},{id:s.id,version:1,reason:'Corrección'})),{code:'DNI_IMMUTABLE'});
 const audit=JSON.stringify(await access.auditList(token));assert.doesNotMatch(audit,/Dato médico|70000001|80000001/);
});
test('entrenador no se duplica por bloque y clase usada conserva horario',async()=>{
 await assert.rejects(academy.saveClass(token,cmd({trainerId,weekday:1,hour:8,level:'AVANZADO',capacity:20,active:true})),{code:'TRAINER_OVERLAP'});
 const sid=(await academy.saveStudent(token,cmd(student('70000100')))).id;await academy.enroll(token,cmd({studentId:sid,planId,classIds:[classId],startDate:'2026-10-01'}));
 await assert.rejects(academy.saveClass(token,cmd({trainerId,weekday:1,hour:9,level:'BASICO',capacity:20,active:true},{id:classId,version:1})),{code:'CLASS_IN_USE'});
});
test('último cupo concurrente: primera aprobación válida gana; rechazo libera',async()=>{
 const ids:string[]=[];for(let i=0;i<21;i++){const sid=(await academy.saveStudent(token,cmd(student(String(71000000+i))))).id;const e=await academy.enroll(token,cmd({studentId:sid,planId,classIds:[classId],startDate:'2026-10-01'}));ids.push(e.id);if(i<19)await academy.decision(token,cmd({decision:'APPROVED'},{id:e.id,version:1,reason:'Verificación presencial'}));}
 const results=await Promise.allSettled(ids.slice(19).map(rid=>academy.decision(token,cmd({decision:'APPROVED'},{id:rid,version:1,reason:'Aprobar'}))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const rejected=results.findIndex(r=>r.status==='rejected'),winner=ids[19+(rejected===0?1:0)]!,loser=ids[19+rejected]!;
 await academy.decision(token,cmd({decision:'REJECTED'},{id:winner,version:2,reason:'Cliente desiste'}));await academy.decision(token,cmd({decision:'APPROVED'},{id:loser,version:1,reason:'Vacante liberada'}));
 assert.match(JSON.stringify(await access.auditList(token)),/CLASS_FULL/);
});
test('solicitud pública no reserva ni activa cuenta y rechaza tenant inyectado',async()=>{
 const request={student:student('72000001'),planId,classIds:[classId],startDate:'2026-10-01'};
 const result=await academy.publicApply('academy-test',request);assert.equal(result.status,'REQUESTED');
 const count=await access.rows<{count:string}>("SELECT count(*) AS count FROM academy_enrollments WHERE tenant_id=:tenant AND status='APPROVED'",{tenant});assert.equal(Number(count[0]?.count),20);
 await assert.rejects(academy.publicApply('academy-test',{...request,tenantId:'otro'}),{code:'INVALID_INPUT'});
 const pub=JSON.stringify(await academy.publicCatalog('academy-test'));assert.doesNotMatch(pub,/70000001|password|emergency|Dato médico|trainer_name/);
});

test('entrenador ve solo alumnos asignados y no lista fichas de recepción',async()=>{
 const account=await access.createUser(token,{username:'profesor',displayName:'Profesor',role:'ENTRENADOR',password});const temporary=await access.login({academy:'academy-test',username:'profesor',password});await access.changePassword(temporary.token,password,password+'nueva');const current=await access.login({academy:'academy-test',username:'profesor',password:password+'nueva'});
 await academy.saveTrainer(token,cmd({name:'Profesor vinculado',phone:'000000000',userId:account.id,active:true},{id:trainerId,version:1}));
 const assigned=await academy.assigned(current.token);assert.equal(assigned.length,20);await academy.studentDetail(current.token,String((assigned[0] as {id:string}).id));
 const unassigned=(await access.rows<{id:string}>('SELECT id FROM academy_students WHERE tenant_id=:tenant AND dni=:dni',{tenant,dni:'70000001'}))[0]!;await assert.rejects(academy.studentDetail(current.token,unassigned.id),{code:'FORBIDDEN'});await assert.rejects(academy.list(current.token,'students'),{code:'FORBIDDEN'});
});
