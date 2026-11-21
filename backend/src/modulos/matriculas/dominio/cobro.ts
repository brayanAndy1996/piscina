import { TZDate } from '@date-fns/tz';
import { type Bloque, type DiaSemana, esBisiesto } from '@aquagestion/contratos';
import { ZONA_LIMA, fechaEnLima } from '../../../comun/fechas';
import { Decimal } from '../../../infraestructura/prisma';

/**
 * Cálculo del cobro (spec 005, criterios 8 a 10; RN-25, HU-34, D-03): funciones puras, sin base de datos ni Nest, exactas y en
 * America/Lima. Nunca `number` con coma flotante: los montos son `Decimal` y las cuentas intermedias, fracciones de `bigint`. Los precios
 * ya incluyen IGV (D-03): ningún cálculo les suma ni les resta nada. El total se redondea hacia arriba al sol entero UNA sola vez, al
 * final (redondear antes daría S/ 201 donde corresponde S/ 200).
 */

/** Una fracción exacta de soles: `numerador ÷ denominador`, con el denominador mayor que 0. */
export interface Racional {
  readonly numerador: bigint;
  readonly denominador: bigint;
}

/** Un descuento de D-03: un porcentaje de 0 a 100, o un monto fijo en soles. */
export interface Descuento {
  readonly tipo: 'PORCENTAJE' | 'MONTO_FIJO';
  readonly valor: Decimal;
}

/** La clase elegida por la persona, como la necesita el conteo: su día de la semana ISO (1 lunes … 7 domingo) y su hora de inicio. */
export interface ClaseElegida {
  readonly diaSemana: DiaSemana;
  readonly horaInicio: Bloque;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Clases restantes del mes (criterio 8)
// ---------------------------------------------------------------------------------------------------------------------------------

export function diasDelMes(anio: number, mes: number): number {
  if (mes === 2) return esBisiesto(anio) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

/** Día de la semana ISO (1 lunes … 7 domingo) de una fecha de calendario de Lima. */
function diaIsoEnLima(anio: number, mes: number, dia: number): number {
  const dow = new TZDate(anio, mes - 1, dia, 12, 0, 0, ZONA_LIMA).getDay();
  return dow === 0 ? 7 : dow;
}

/**
 * Cuántas clases quedan en el mes en curso de America/Lima (HU-34): para cada fecha desde hoy hasta el último día del mes, las clases
 * elegidas cuyo día de la semana coincide. Las de hoy cuentan solo si su hora de inicio en Lima es posterior a "ahora" (provisional,
 * pregunta N2 de 005: la que empieza en este instante ya no cuenta). No descuenta días de cierre (RN-33, historia 017).
 */
export function clasesRestantes(clases: readonly ClaseElegida[], ahora: Date): number {
  const { anio, mes, dia: hoy } = fechaEnLima(ahora);
  const ultimo = diasDelMes(anio, mes);
  const diaDeHoy = diaIsoEnLima(anio, mes, hoy);
  let cuenta = 0;
  for (let dia = hoy; dia <= ultimo; dia++) {
    // El día de la semana de cada fecha sale del de hoy: no se vuelve a consultar la zona.
    const iso = ((diaDeHoy - 1 + (dia - hoy)) % 7) + 1;
    for (const clase of clases) {
      if (clase.diaSemana !== iso) continue;
      if (dia === hoy) {
        const [hora = '0', minuto = '0'] = clase.horaInicio.split(':');
        const inicio = new TZDate(anio, mes - 1, hoy, Number(hora), Number(minuto), 0, ZONA_LIMA);
        if (inicio.getTime() <= ahora.getTime()) continue;
      }
      cuenta += 1;
    }
  }
  return cuenta;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Aritmética racional con `bigint`
// ---------------------------------------------------------------------------------------------------------------------------------

/** Un `Decimal` finito como fracción exacta (`"120.50"` → `12050 / 100`), sin pasar por `number`. */
function aRacional(valor: Decimal): Racional {
  if (!valor.isFinite()) throw new RangeError('El monto debe ser un número finito.');
  const texto = valor.toFixed();
  const negativo = texto.startsWith('-');
  const [enteros = '0', decimales = ''] = (negativo ? texto.slice(1) : texto).split('.');
  const numerador = BigInt(`${enteros}${decimales}`);
  return { numerador: negativo ? -numerador : numerador, denominador: 10n ** BigInt(decimales.length) };
}

function comprobar(racional: Racional): Racional {
  if (racional.denominador <= 0n) throw new RangeError('El denominador debe ser mayor que 0.');
  return racional;
}

/** El menor entero (en soles) que no es menor que la fracción; 0 si la fracción es 0 o negativa. */
function techoDeSoles({ numerador, denominador }: Racional): Decimal {
  if (numerador <= 0n) return new Decimal(0);
  return new Decimal(((numerador + denominador - 1n) / denominador).toString());
}

/**
 * El valor exacto de `precio × clasesTotales ÷ clasesPorMes`, en soles y sin redondear (la base de `calcularTotal`). El precio llega de
 * `numeric(10,2)`: con más de dos decimales se rechaza (no se redondea en silencio).
 */
export function baseProporcional(precio: Decimal, clasesPorMes: number, clasesTotales: number): Racional {
  if (!Number.isInteger(clasesPorMes) || clasesPorMes < 1)
    throw new RangeError('Las clases por mes deben ser 1 o más.');
  if (!Number.isInteger(clasesTotales) || clasesTotales < 0)
    throw new RangeError('Las clases totales no pueden ser negativas.');
  const centimos = aRacional(precio.toDecimalPlaces(2));
  if (!precio.toDecimalPlaces(2).equals(precio)) throw new RangeError('El precio debe tener como mucho dos decimales.');
  return comprobar({
    numerador: centimos.numerador * BigInt(clasesTotales),
    denominador: centimos.denominador * BigInt(clasesPorMes),
  });
}

/**
 * `precio × clasesTotales ÷ clasesPorMes`, exacto y redondeado hacia arriba al sol entero una sola vez, al final (RN-25, criterio 9).
 * S/ 100 de 12 clases con 5 → S/ 42; S/ 200 de 3 clases con 3 → S/ 200 (no 201); S/ 120.50 de 12 con 12 → S/ 121 (D-03).
 */
export function montoProporcional(precio: Decimal, clasesPorMes: number, clasesTotales: number): Decimal {
  return techoDeSoles(baseProporcional(precio, clasesPorMes, clasesTotales));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Orden completo de D-03 (criterio 10)
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * El total de D-03: el monto ajustado reemplaza al calculado; el descuento (porcentaje de 0 a 100, o monto fijo) se aplica sobre ese
 * monto sin redondear; el monto nunca queda por debajo de 0; y el total se redondea hacia arriba al sol entero una sola vez. En la 005
 * nadie la llama con ajuste ni descuento: la usan la 007 (ajuste, HU-34) y la 015 (descuento, HU-10).
 */
export function calcularTotal(entrada: { base: Racional; montoAjustado?: Decimal; descuento?: Descuento }): Decimal {
  let monto = comprobar(entrada.base);
  if (entrada.montoAjustado !== undefined) {
    const ajustado = aRacional(entrada.montoAjustado);
    if (ajustado.numerador < 0n) throw new RangeError('El monto ajustado no puede ser negativo.');
    monto = ajustado;
  }
  const descuento = entrada.descuento;
  if (descuento !== undefined) {
    const valor = aRacional(descuento.valor);
    if (valor.numerador < 0n) throw new RangeError('El descuento no puede ser negativo.');
    if (descuento.tipo === 'PORCENTAJE') {
      // monto × (100 − p) ÷ 100, con p = pn / pd.
      if (valor.numerador > 100n * valor.denominador) throw new RangeError('El porcentaje de descuento va de 0 a 100.');
      monto = {
        numerador: monto.numerador * (100n * valor.denominador - valor.numerador),
        denominador: monto.denominador * 100n * valor.denominador,
      };
    } else {
      // monto − f, con f = fn / fd.
      monto = {
        numerador: monto.numerador * valor.denominador - valor.numerador * monto.denominador,
        denominador: monto.denominador * valor.denominador,
      };
    }
  }
  return techoDeSoles(monto);
}
