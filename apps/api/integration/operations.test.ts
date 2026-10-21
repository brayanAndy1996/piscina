import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {Sequelize} from 'sequelize';
import sharp from 'sharp';
import {readTestConfig} from '../test-support/config.js';
import {createDatabase} from '../src/database.js';
import {migrateAccess} from '../src/access/migrations.js';
import {migrateAcademy} from '../src/academy/migrations.js';
import {migrateOperations} from '../src/operations/migrations.js';
import {AccessService} from '../src/access/service.js';
import {AcademyService} from '../src/academy/service.js';
import {OperationsService} from '../src/operations/service.js';
import {PrivateFiles} from '../src/operations/files.js';
const cfg=readTestConfig(),root=createDatabase(cfg),schema='operations_test_'+randomUUID().replaceAll('-','');let db:Sequelize,access:AccessService,academy:AcademyService,ops:OperationsService,files:PrivateFiles,token:string,other:string,tenant:string,planId:string,classId:string,studentId:string,enrollmentId:string,cashId:string;let clock=Date.parse('2026-10-05T13:15:00Z');const password='PruebaOperaciones2026!';
const cmd=(data:object,extra:object={})=>({operationId:randomUUID(),data,...extra});
async function pupil(dni:string){const s=await academy.saveStudent(token,cmd({dni,name:'Alumno ficticio '+dni,birth:'2000-01-01',level:'BASICO',contact:{phone:'000000000',email:'',address:'Ficticia',schoolGrade:''},health:{emergencyName:'Contacto',emergencyPhone:'000000000'},guardian:null,consents:{data:true,liability:true}}));const e=await academy.enroll(token,cmd({studentId:s.id,planId,classIds:[classId],startDate:'2026-10-01'}));return {student:s.id,enrollment:e.id};}
before(async()=>{await root.query(`CREATE SCHEMA "${schema}"`);db=new Sequelize(cfg.databaseUrl,{dialect:'postgres',logging:false,dialectOptions:{options:`-c search_path=${schema}`}});await migrateAccess(db);await migrateAcademy(db);await migrateOperations(db);await migrateOperations(db);access=new AccessService(db,generateKeyPairSync('ed25519').privateKey,()=>clock);academy=new AcademyService(access);ops=new OperationsService(academy);files=new PrivateFiles(academy);
 const o=await access.bootstrap({slug:'ops-test',name:'Academia prueba',username:'admin',displayName:'Propietario',password});tenant=o.tenantId;token=(await access.login({academy:'ops-test',username:'admin',password})).token;await access.bootstrap({slug:'other-test',name:'Otra academia',username:'admin',displayName:'Otro',password});other=(await access.login({academy:'other-test',username:'admin',password})).token;
 planId=(await academy.savePlan(token,cmd({name:'Plan',priceCents:10000,daysPerWeek:1,monthlyClasses:4,durationMinutes:60,allowedWeekdays:[1,3],allowedHours:[8,9],levels:['BASICO'],validFrom:'2026-01-01',validTo:'2027-12-31',active:true}))).id;const trainer=(await academy.saveTrainer(token,cmd({name:'Entrenador',phone:'000000000',userId:null,active:true}))).id;classId=(await academy.saveClass(token,cmd({trainerId:trainer,weekday:1,hour:8,level:'BASICO',capacity:20,active:true}))).id;const p=await pupil('74000001');studentId=p.student;enrollmentId=p.enrollment;
});
after(async()=>{if(db)await db.close();await root.query(`DROP SCHEMA "${schema}" CASCADE`);await root.close();});
test('pago exige aprobación, monto completo y caja propia; replay no duplica',async()=>{
 await assert.rejects(ops.createPayment(token,cmd({enrollmentId,method:'CASH',amountCents:10000})),{code:'APPROVAL_REQUIRED'});
 await academy.decision(token,cmd({decision:'APPROVED'},{id:enrollmentId,version:1,reason:'Aprobación'}));
 await assert.rejects(ops.createPayment(token,cmd({enrollmentId,method:'CASH',amountCents:5000})),{code:'FULL_PAYMENT_REQUIRED'});
 await assert.rejects(ops.createPayment(token,cmd({enrollmentId,method:'CASH',amountCents:10000})),{code:'CASH_REQUIRED'});
 cashId=(await ops.openCash(token,cmd({openingCents:5000}))).id;await assert.rejects(ops.openCash(token,cmd({openingCents:0})),{code:'CASH_ALREADY_OPEN'});
 const request=cmd({enrollmentId,method:'CASH',amountCents:10000});const payment=await ops.createPayment(token,request);assert.deepEqual(await ops.createPayment(token,request),payment);
 for(const table of ['payments','receipts','movements'])assert.equal((await access.rows(`SELECT id FROM academy_${table} WHERE tenant_id=:tenant`,{tenant})).length,1);
 for(const kind of ['cashboxes','payments','attendance'])await ops.list(token,kind,'2026-10');
 const cash=await ops.cashDetail(token,cashId);assert.equal(cash.totals.expectedCents,15000);assert.equal(cash.totals.yapeCents,0);await assert.rejects(ops.cashDetail(other,cashId),{code:'NOT_FOUND'});
 await assert.rejects(academy.decision(token,cmd({decision:'REJECTED'},{id:enrollmentId,version:3,reason:'Intento'})),{code:'ALREADY_PAID'});
});
test('DNI temporal solo alumno, portal aislado, carnet y PDF auténtico',async()=>{
 const login=await access.login({academy:'ops-test',username:'74000001',password:'74000001'});assert.equal(login.user.must_change,true);await assert.rejects(ops.portal(login.token),{code:'PASSWORD_CHANGE_REQUIRED'});await access.changePassword(login.token,'74000001','ClaveAlumno2026!');const current=await access.login({academy:'ops-test',username:'74000001',password:'ClaveAlumno2026!'});const portal=await ops.portal(current.token);assert.equal(portal.student.id,studentId);assert.equal(portal.receipts.length,1);assert.match(portal.card!.image,/^data:image\/png;base64,/);
 await assert.rejects(ops.portal(token),{code:'FORBIDDEN'});const receipt=(portal.receipts[0] as {id:string}).id;assert.equal((await ops.receiptPdf(current.token,receipt)).subarray(0,5).toString(),'%PDF-');await assert.rejects(ops.receipt(other,receipt),{code:'NOT_FOUND'});
 await assert.rejects(access.createUser(token,{username:'badpassword',displayName:'Usuario',role:'SECRETARIA',password:'12345678'}),{code:'INVALID_PASSWORD'});
 const previous=portal.card!.code;await ops.rotateCard(token,cmd({},{id:studentId,reason:'Reemplazo'}));assert.notEqual((await ops.portal(current.token)).card!.code,previous);
});
test('asistencia manual y QR comparten control diario y descuento único',async()=>{
 const request=cmd({studentId,classId,method:'MANUAL'}),result=await ops.attendance(token,request);assert.equal(result.remaining,3);assert.deepEqual(await ops.attendance(token,request),result);await assert.rejects(ops.attendance(token,cmd({studentId,classId,method:'MANUAL'})),{code:'ATTENDANCE_EXISTS'});assert.equal((await access.rows('SELECT id FROM academy_attendance WHERE tenant_id=:tenant',{tenant})).length,1);
 clock+=86400000;const login=await access.login({academy:'ops-test',username:'admin',password});token=login.token;await assert.rejects(ops.attendance(token,cmd({studentId,classId,method:'MANUAL'})),{code:'OUTSIDE_SCHEDULE'});clock-=86400000;
});
test('archivos privados saneados, pago digital manual único y no suma efectivo',async()=>{
 const p=await pupil('74000002');const bytes=await sharp({create:{width:20,height:20,channels:3,background:'#00aacc'}}).png().toBuffer();
 const file=await files.upload(token,{studentId:p.student,purpose:'PROOF',base64:bytes.toString('base64')});assert.equal((await files.read(token,file.id)).mime,'image/jpeg');await assert.rejects(files.read(other,file.id),{code:'NOT_FOUND'});await assert.rejects(files.upload(token,{studentId:p.student,purpose:'PROOF',base64:Buffer.from('<svg>xx</svg>').toString('base64')}),{code:'INVALID_IMAGE'});
 const request=cmd({enrollmentId:p.enrollment,method:'YAPE',amountCents:10000,reference:'YAPE-TEST-1',proofId:file.id});const payment=await ops.createPayment(token,request);
 await assert.rejects(ops.verifyPayment(token,cmd({decision:'CONFIRMED'},{id:payment.id,version:1,reason:'Verificado en aplicación bancaria'})),{code:'APPROVAL_REQUIRED'});
 await academy.decision(token,cmd({decision:'APPROVED'},{id:p.enrollment,version:1,reason:'Aprobar'}));const results=await Promise.allSettled([1,2].map(()=>ops.verifyPayment(token,cmd({decision:'CONFIRMED'},{id:payment.id,version:1,reason:'Verificado manualmente'}))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const cash=await ops.cashDetail(token,cashId);assert.equal(cash.totals.expectedCents,15000);assert.equal(cash.totals.yapeCents,10000);
});
test('cierre cuadra efectivo, diferencia exige motivo y no permite cobrar cerrado',async()=>{
 await ops.movement(token,cmd({kind:'EXPENSE',amountCents:1000,concept:'Limpieza'}));await assert.rejects(ops.closeCash(token,cmd({countedCents:13000,observation:''},{id:cashId,version:1})),{code:'REASON_REQUIRED'});await ops.closeCash(token,cmd({countedCents:14000,observation:''},{id:cashId,version:1}));assert.equal((await ops.cashPdf(token,cashId)).subarray(0,5).toString(),'%PDF-');await assert.rejects(ops.movement(token,cmd({kind:'INCOME',amountCents:100,concept:'Intento'})),{code:'CASH_REQUIRED'});await ops.reopenCash(token,cmd({},{id:cashId,version:2,reason:'Revisión administrativa'}));assert.equal((await ops.cashDetail(token,cashId)).status,'OPEN');const audit=JSON.stringify(await access.auditList(token));assert.doesNotMatch(audit,/password_hash|ClaveAlumno|PISCINA:/);
});

test('reset de alumno no puede restablecer una cuenta promovida a administrador',async()=>{
 const s=(await access.rows<{user_id:string}>('SELECT user_id FROM academy_students WHERE tenant_id=:tenant AND id=:id',{tenant,id:studentId}))[0]!;const user=(await access.rows<{version:number}>('SELECT version FROM access_users WHERE tenant_id=:tenant AND id=:id',{tenant,id:s.user_id}))[0]!;
 await access.changeUser(token,s.user_id,{displayName:'Alumno promovido',role:'ADMIN',active:true,version:user.version});await assert.rejects(ops.resetStudent(token,cmd({},{id:studentId,reason:'Intento de reset indirecto'})),{code:'NOT_FOUND'});
});
