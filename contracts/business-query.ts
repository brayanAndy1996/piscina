import type {BusinessState,RecordRow as Row} from './offline-protocol.js';
import {cashExpected,limaDate} from '../apps/api/src/academy/rules.js';
export function businessQuery(state:BusinessState,path:string):unknown{
 const url=new URL(path,'https://local.invalid/'),parts=url.pathname.split('/').filter(Boolean),month=url.searchParams.get('month')??'',rows=(t:string)=>state.tables[t]??[],student=(sid:unknown)=>rows('students').find(s=>s.id===sid),enrollment=(eid:unknown)=>rows('enrollments').find(e=>e.id===eid),named=(e:Row)=>({...e,student_name:student(e.student_id)?.name,dni:student(e.student_id)?.dni,class_ids:rows('enrollment_classes').filter(c=>c.enrollment_id===e.id).map(c=>c.class_id)});
 if(parts[0]==='academy'){
  if(parts[1]==='settings')return rows('settings')[0]??{data:{},version:0};if(parts[1]==='students'&&parts[2])return student(parts[2])??null;
  let result=rows(parts[1]??'').slice();if(parts[1]==='students'){const search=(url.searchParams.get('search')??'').toLowerCase();result=result.filter(s=>(String(s.name)+' '+String(s.dni)).toLowerCase().includes(search));}
  if(parts[1]==='enrollments')result=result.filter(e=>e.month===month).map(named);
  if(parts[1]==='classes')result=result.map(c=>({...c,trainer_name:rows('trainers').find(t=>t.id===c.trainer_id)?.name,reserved:rows('enrollment_classes').filter(l=>l.class_id===c.id&&enrollment(l.enrollment_id)?.month===month&&enrollment(l.enrollment_id)?.status==='APPROVED').length}));
  const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??50);return result.slice(offset,offset+limit);
 }
 if(parts[0]==='sync'&&parts[1]==='incidents')return rows('incidents');
 if(parts[0]==='operations'){
  if(parts[1]==='cash'&&parts[2]){const c=rows('cashboxes').find(c=>c.id===parts[2]);if(!c)throw new Error('Caja no encontrada.');const ms=rows('movements').filter(m=>m.cashbox_id===c.id),sum=(k:string,m:string)=>ms.filter(r=>r.kind===k&&r.method===m).reduce((n,r)=>n+Number(r.amount_cents),0);return {...c,movements:ms,totals:{expectedCents:cashExpected(Number(c.opening_cents),sum('PAYMENT','CASH'),sum('INCOME','CASH'),sum('EXPENSE','CASH')),cashCents:sum('PAYMENT','CASH'),yapeCents:sum('PAYMENT','YAPE'),transferCents:sum('PAYMENT','TRANSFER'),incomeCents:sum('INCOME','CASH'),expenseCents:sum('EXPENSE','CASH')}};}
  if(parts[1]==='cashboxes')return rows('cashboxes').filter(c=>String(c.business_date).startsWith(month));
  if(parts[1]==='payments')return rows('payments').filter(p=>enrollment(p.enrollment_id)?.month===month).map(p=>({...p,student_name:student(enrollment(p.enrollment_id)?.student_id)?.name,receipt_id:rows('receipts').find(r=>r.payment_id===p.id)?.id}));
  if(parts[1]==='attendance')return rows('attendance').filter(a=>String(a.business_date).startsWith(month)).map(a=>({...a,student_name:student(a.student_id)?.name}));
  if(parts[1]==='files'&&parts[2])return rows('files').find(f=>f.id===parts[2])??null;
  if(parts[1]==='report'){const report=new Map<string,Row>();for(const p of rows('payments').filter(p=>p.status==='CONFIRMED'&&limaDate(new Date(String(p.confirmed_at)).getTime()).slice(0,7)===month)){const method=String(p.method),r=report.get(method)??{method,payments:0,total_cents:0};r.payments=Number(r.payments)+1;r.total_cents=Number(r.total_cents)+Number(p.amount_cents);report.set(method,r);}return [...report.values()];}
 }
 throw new Error('Esta consulta requiere conexión con la nube.');
}
