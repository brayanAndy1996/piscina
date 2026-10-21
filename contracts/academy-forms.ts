export interface Field {key:string;label:string;kind?:'number'|'date'|'check'|'multi'|'select'|'money';options?:{value:string;label:string}[];source?:string;optional?:boolean;initial?:string|boolean;}
const choices=(values:(string|number)[])=>values.map(value=>({value:String(value),label:String(value)}));
const levelOptions=choices(['BASICO','INTERMEDIO','AVANZADO']);
export const studentFields:Field[]=[
 {key:'dni',label:'DNI (8 dígitos)'},{key:'name',label:'Nombre completo'},{key:'birth',label:'Nacimiento',kind:'date'},{key:'level',label:'Nivel',kind:'select',options:levelOptions},
 {key:'contact.phone',label:'Teléfono'},{key:'contact.email',label:'Correo',optional:true},{key:'contact.address',label:'Dirección'},{key:'contact.schoolGrade',label:'Grado de colegio',optional:true},
 {key:'health.bloodType',label:'Grupo sanguíneo',optional:true},{key:'health.conditions',label:'Condiciones médicas',optional:true},{key:'health.allergies',label:'Alergias',optional:true},{key:'health.medications',label:'Medicamentos',optional:true},{key:'health.insurance',label:'Seguro',optional:true},{key:'health.emergencyName',label:'Contacto de emergencia'},{key:'health.emergencyPhone',label:'Teléfono de emergencia'},
 {key:'guardian.name',label:'Nombre del apoderado (obligatorio para menor)',optional:true},{key:'guardian.dni',label:'DNI del apoderado',optional:true},{key:'guardian.phone',label:'Teléfono del apoderado',optional:true},{key:'guardian.relationship',label:'Parentesco',optional:true},
 {key:'consents.data',label:'Acepta tratamiento de datos personales',kind:'check'},{key:'consents.liability',label:'Acepta deslinde de responsabilidad',kind:'check'},
];
export const forms:Record<string,{title:string;fields:Field[]}>= {
 settings:{title:'Configuración',fields:[{key:'name',label:'Nombre de academia'},{key:'address',label:'Dirección'},{key:'phone',label:'Teléfono'},{key:'ruc',label:'RUC',optional:true},{key:'expiringDays',label:'Avisar vencimiento con días de anticipación',kind:'number',initial:'5'}]},
 plans:{title:'Planes',fields:[{key:'name',label:'Nombre del plan'},{key:'priceCents',label:'Precio mensual S/',kind:'money'},{key:'daysPerWeek',label:'Días por semana',kind:'number',initial:'3'},{key:'monthlyClasses',label:'Clases mensuales',kind:'number',initial:'12'},{key:'durationMinutes',label:'Duración (minutos)',kind:'number',initial:'60'},{key:'allowedWeekdays',label:'Días permitidos (1 lunes, 7 domingo)',kind:'multi',options:choices([1,2,3,4,5,6,7])},{key:'allowedHours',label:'Horas permitidas',kind:'multi',options:choices([8,9,10,11,12,13,14,15,16,17,18,19])},{key:'levels',label:'Niveles',kind:'multi',options:levelOptions},{key:'validFrom',label:'Vigente desde',kind:'date'},{key:'validTo',label:'Vigente hasta',kind:'date'},{key:'active',label:'Activo',kind:'check',initial:true}]},
 trainers:{title:'Entrenadores',fields:[{key:'name',label:'Nombre del entrenador'},{key:'phone',label:'Teléfono'},{key:'userId',label:'Cuenta de entrenador (opcional)',kind:'select',source:'trainerUsers',optional:true},{key:'active',label:'Activo',kind:'check',initial:true}]},
 classes:{title:'Clases',fields:[{key:'trainerId',label:'Entrenador',kind:'select',source:'trainers'},{key:'weekday',label:'Día (1 lunes, 7 domingo)',kind:'select',options:choices([1,2,3,4,5,6,7])},{key:'hour',label:'Hora de inicio',kind:'select',options:choices([8,9,10,11,12,13,14,15,16,17,18,19])},{key:'level',label:'Nivel',kind:'select',options:levelOptions},{key:'capacity',label:'Aforo (20 a 50)',kind:'number',initial:'20'},{key:'active',label:'Activa',kind:'check',initial:true}]},
 students:{title:'Alumnos',fields:studentFields},
 enrollments:{title:'Inscripciones',fields:[{key:'studentId',label:'Alumno',kind:'select',source:'students'},{key:'planId',label:'Plan',kind:'select',source:'plans'},{key:'classIds',label:'Clases (un bloque por día elegido)',kind:'multi',source:'classes'},{key:'startDate',label:'Fecha de inicio',kind:'date'}]},
};
export type Row=Record<string,unknown>;
export function fieldValue(data:Row,key:string):unknown {let value:unknown=data;for(const part of key.split('.'))value=value&&typeof value==='object'?(value as Row)[part]:undefined;return value;}
export function defaults(fields:Field[],data:Row={}):Record<string,string|boolean|string[]>{const result:Record<string,string|boolean|string[]>={};for(const f of fields){const v=fieldValue(data,f.key);result[f.key]=f.kind==='money'?(typeof v==='number'?(v/100).toFixed(2):''):f.kind==='multi'?(Array.isArray(v)?v.map(String):[]):f.kind==='check'?(typeof v==='boolean'?v:Boolean(f.initial)):String(v??f.initial??'');}return result;}
export function formData(fields:Field[],values:Record<string,string|boolean|string[]>):Row {
 const result:Row={};for(const f of fields){let value:unknown=values[f.key];if(f.kind==='money'){if(!/^[0-9]+(\.[0-9]{1,2})?$/.test(String(value)))throw new Error('Importe inválido.');const [whole,fraction='']=String(value).split('.');value=Number(whole)*100+Number(fraction.padEnd(2,'0'));}else if(f.kind==='number'||['weekday','hour'].includes(f.key))value=Number(value);else if(f.kind==='multi'&&['allowedWeekdays','allowedHours'].includes(f.key))value=(value as string[]).map(Number);else if(f.key==='userId'&&value==='')value=null;
 const parts=f.key.split('.');let target=result;for(const part of parts.slice(0,-1)){target[part]??={};target=target[part] as Row;}target[parts.at(-1)!]=value;}
 if(result.guardian&&!(result.guardian as Row).name)result.guardian=null;return result;
}
export function optionLabel(kind:string,row:Row){if(kind==='enrollments')return `${row.student_name} · ${row.month} · ${row.status} · S/ ${(Number((row.terms as Row)?.totalCents)/100).toFixed(2)}`;if(kind==='cashboxes')return `${row.business_date} · ${row.status} · ${row.owner_id}`;if(kind==='classes')return `${row.level} · día ${row.weekday} · ${row.hour}:00 · ${row.trainer_name??''} · ${row.reserved??0}/${row.capacity??''}`;return String(row.name??row.display_name??row.username??row.id);}

export const operationForms:Record<string,{title:string;path:string;fields:Field[]}>={
 open:{title:'Abrir mi caja',path:'cash/open',fields:[{key:'openingCents',label:'Fondo inicial S/',kind:'money'}]},
 movement:{title:'Ingreso/egreso de efectivo',path:'cash/movement',fields:[{key:'kind',label:'Tipo',kind:'select',options:[{value:'INCOME',label:'Ingreso de efectivo'},{value:'EXPENSE',label:'Egreso de efectivo'}]},{key:'amountCents',label:'Monto S/',kind:'money'},{key:'concept',label:'Concepto'}]},
 close:{title:'Cerrar mi caja',path:'cash/close',fields:[{key:'cashboxId',label:'Caja',kind:'select',source:'cashboxes'},{key:'countedCents',label:'Efectivo contado S/',kind:'money'},{key:'observation',label:'Observación de diferencia',optional:true}]},
 reopen:{title:'Reabrir caja (administrador)',path:'cash/reopen',fields:[{key:'cashboxId',label:'Caja cerrada',kind:'select',source:'cashboxes'},{key:'reason',label:'Motivo'}]},
 payment:{title:'Registrar cobro completo',path:'payments',fields:[{key:'enrollmentId',label:'Inscripción',kind:'select',source:'enrollments'},{key:'method',label:'Método',kind:'select',options:[{value:'CASH',label:'Efectivo'},{value:'YAPE',label:'Yape'},{value:'TRANSFER',label:'Transferencia'}]},{key:'amountCents',label:'Importe completo S/',kind:'money'},{key:'reference',label:'Número de operación (Yape/transferencia)',optional:true}]},
 attendance:{title:'Asistencia manual',path:'attendance',fields:[{key:'studentId',label:'Alumno',kind:'select',source:'students'},{key:'classId',label:'Clase de hoy',kind:'select',source:'classes'}]},
 adjust:{title:'Ajustar mensualidad (administrador)',path:'enrollments/adjust',fields:[{key:'enrollmentId',label:'Inscripción',kind:'select',source:'enrollments'},{key:'totalCents',label:'Total S/',kind:'money'},{key:'classes',label:'Clases asignadas',kind:'number'},{key:'reason',label:'Motivo de ajuste'}]},
 reset:{title:'Restablecer acceso de alumno',path:'students/reset',fields:[{key:'studentId',label:'Alumno',kind:'select',source:'students'},{key:'reason',label:'Motivo de restablecimiento'}]},
 rotate:{title:'Reemplazar QR',path:'cards/rotate',fields:[{key:'studentId',label:'Alumno',kind:'select',source:'students'},{key:'reason',label:'Motivo de reemplazo'}]},
 notice:{title:'Publicar aviso en portal',path:'notices',fields:[{key:'studentId',label:'Alumno (vacío para toda la academia)',kind:'select',source:'students',optional:true},{key:'title',label:'Título'},{key:'body',label:'Mensaje'}]},
};
export function operationBody(kind:string,data:Row,lists:Record<string,Row[]>,proofId:string|null){
 let row:Row|undefined;const input:Row={data};if(kind==='close'||kind==='reopen'){row=lists.cashboxes?.find(r=>r.id===data.cashboxId);delete data.cashboxId;input.id=row?.id;input.version=row?.version;}
 if(kind==='adjust'){row=lists.enrollments?.find(r=>r.id===data.enrollmentId);delete data.enrollmentId;input.id=row?.id;input.version=row?.version;}
 if(kind==='reset'||kind==='rotate'){input.id=data.studentId;delete data.studentId;}
 if(data.reason){input.reason=data.reason;delete data.reason;}if(kind==='payment')data.proofId=proofId;
 if(kind==='attendance')data.method='MANUAL';if(kind==='notice'&&!data.studentId)data.studentId=null;return input;
}

export async function collectRows(read:(offset:number)=>Promise<Row[]>){const result:Row[]=[];for(let offset=0;offset<=100000;offset+=100){const rows=await read(offset);result.push(...rows);if(rows.length<100)return result;}throw new Error('Usa filtros para reducir el catálogo.');}
