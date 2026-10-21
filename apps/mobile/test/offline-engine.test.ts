import assert from 'node:assert/strict';import {test} from 'node:test';import {randomUUID} from 'node:crypto';import {localApply} from '../../../contracts/offline-engine.ts';import type {BusinessState} from '../../../contracts/offline-protocol.ts';
import {businessQuery} from '../../../contracts/business-query.ts';
const at=Date.parse('2026-10-05T13:15:00Z'),tenantId=randomUUID(),userId=randomUUID(),deviceId=randomUUID(),plan=randomUUID(),trainer=randomUUID(),lesson=randomUUID();
export const initial:BusinessState={tenantId,userId,deviceId,tables:{plans:[{id:plan,version:1,active:true,data:{name:'Plan',priceCents:10000,daysPerWeek:1,monthlyClasses:4,durationMinutes:60,allowedWeekdays:[1],allowedHours:[8],levels:['BASICO'],validFrom:'2026-01-01',validTo:'2027-12-31',active:true}}],trainers:[{id:trainer}],classes:[{id:lesson,trainer_id:trainer,weekday:1,hour:8,level:'BASICO',capacity:20,active:true,version:1}]}};
const pupil={dni:'76000001',name:'Alumno offline',birth:'1990-01-01',level:'BASICO',contact:{phone:'000000000',email:'',address:'Ficticia',schoolGrade:''},health:{emergencyName:'Contacto',emergencyPhone:'000000000'},guardian:null,consents:{data:true,liability:true}};
test('recorrido local alumno→aprobación→pago completo→asistencia es inmediato y atómico',()=>{
 let state=initial;const run=(action:string,data:object,extra:object={})=>{const input={operationId:randomUUID(),data,...extra};const result=localApply(state,action,input,at,'PISCINA:'+'ab'.repeat(32));state=result.state;return result;};
 const sid=String(run('student.save',pupil).result.id);assert.equal(initial.tables.students,undefined);
 const eid=String(run('enrollment.create',{studentId:sid,planId:plan,classIds:[lesson],startDate:'2026-10-01'}).result.id);
 run('enrollment.decision',{decision:'APPROVED'},{id:eid,version:1,reason:'Datos verificados'});run('cash.open',{openingCents:5000});
 assert.throws(()=>run('payment.create',{enrollmentId:eid,method:'CASH',amountCents:5000}));
 run('payment.create',{enrollmentId:eid,method:'CASH',amountCents:10000});const attendance=run('attendance.create',{studentId:sid,classId:lesson,method:'MANUAL'});assert.equal(attendance.result.remaining,3);assert.throws(()=>run('attendance.create',{studentId:sid,classId:lesson,method:'MANUAL'}));assert.equal(state.tables.attendance?.length,1);assert.equal(state.tables.receipts?.length,1);
});

test('reporte local agrupa el cobro por mes Lima aunque UTC ya cambió de mes',()=>{const state:BusinessState={...initial,tables:{payments:[{status:'CONFIRMED',method:'CASH',amount_cents:10000,confirmed_at:'2026-11-01T02:00:00Z'}]}};assert.deepEqual(businessQuery(state,'operations/report?month=2026-10'),[{method:'CASH',payments:1,total_cents:10000}]);assert.deepEqual(businessQuery(state,'operations/report?month=2026-11'),[]);});
