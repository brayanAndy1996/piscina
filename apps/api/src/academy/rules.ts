export type Level='BASICO'|'INTERMEDIO'|'AVANZADO';
export const levels:Level[]=['BASICO','INTERMEDIO','AVANZADO'];
export function integer(value:unknown,min:number,max:number):number {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new Error('Número fuera del rango permitido.');return value;
}
export function dateOnly(value:unknown):string {
 if(typeof value!=='string'||!/^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(value))throw new Error('Fecha inválida (AAAA-MM-DD).');
 const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw new Error('Fecha inexistente.');return value;
}
export function weekdays(value:unknown):number[]{
 if(!Array.isArray(value)||!value.length||value.length>7)throw new Error('Días inválidos.');
 const days=value.map(v=>integer(v,1,7));if(new Set(days).size!==days.length)throw new Error('Días repetidos.');return days.sort((a,b)=>a-b);
}
export function remainingDates(start:string,days:number[],limit:number):string[]{
 dateOnly(start);const allowed=weekdays(days);integer(limit,1,31);
 const current=new Date(start+'T00:00:00Z'),month=current.getUTCMonth(),result:string[]=[];
 while(current.getUTCMonth()===month&&result.length<limit){if(allowed.includes(current.getUTCDay()||7))result.push(current.toISOString().slice(0,10));current.setUTCDate(current.getUTCDate()+1);}return result;
}
export function quote(priceCents:number,planClasses:number,classes:number){
 integer(priceCents,1,100000000);integer(planClasses,1,31);integer(classes,1,planClasses);
 const numerator=BigInt(priceCents)*BigInt(classes),denominator=BigInt(planClasses)*100n;
 const totalCents=Number((numerator+denominator-1n)/denominator*100n);
 const valueCents=Number((BigInt(totalCents)*100n+59n)/118n);
 return {totalCents,valueCents,igvCents:totalCents-valueCents};
}
export function limaDate(now:number=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
export function ageAt(birth:string,today:string){dateOnly(birth);dateOnly(today);if(birth>today)throw new Error('Nacimiento futuro.');return Number(today.slice(0,4))-Number(birth.slice(0,4))-(today.slice(5)<birth.slice(5)?1:0);}

export function cashExpected(opening:number,cash:number,income:number,expense:number){for(const v of [opening,cash,income,expense])integer(v,0,1000000000);const expected=opening+cash+income-expense;if(expected<0||!Number.isSafeInteger(expected))throw new Error('Efectivo insuficiente.');return expected;}

export function canonical(value:unknown):string {const clean:unknown=JSON.parse(JSON.stringify(value));const encode=(v:unknown):string=>Array.isArray(v)?'['+v.map(encode).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+encode((v as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(v);return encode(clean);}
