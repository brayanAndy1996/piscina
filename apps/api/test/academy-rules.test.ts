import assert from 'node:assert/strict';
import {test} from 'node:test';
import {remainingDates,quote,cashExpected} from '../src/academy/rules.js';
test('calendario mensual inclusivo, bisiesto y tope del plan',()=>{
 assert.deepEqual(remainingDates('1996-02-29',[4],1),['1996-02-29']);
 assert.deepEqual(remainingDates('2028-02-28',[1,2],12),['2028-02-28','2028-02-29']);
 assert.deepEqual(remainingDates('2026-10-30',[5,6],1),['2026-10-30']);
 assert.equal(remainingDates('2026-10-01',[1,3,5],12).length,12);
 assert.throws(()=>remainingDates('2026-02-30',[1],12));
 assert.throws(()=>remainingDates('2026-10-01',[1,1],12));
});
test('proporcional exacto, IGV incluido y redondeo hacia arriba al sol',()=>{
 assert.deepEqual(quote(10000,12,5),{totalCents:4200,valueCents:3559,igvCents:641});
 assert.deepEqual(quote(10000,12,12),{totalCents:10000,valueCents:8475,igvCents:1525});
 assert.equal(quote(10001,12,12).totalCents,10100);
 assert.throws(()=>quote(10000,12,0));assert.throws(()=>quote(10000,12,13));
});

test('caja suma solo efectivo y detecta egresos imposibles',()=>{assert.equal(cashExpected(10000,4200,500,1200),13500);assert.throws(()=>cashExpected(0,0,0,100));assert.throws(()=>cashExpected(-1,0,0,0));});
