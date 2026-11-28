// spec: 010-mensualidades (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Criterio 4 (crítico, RN-28, DR-1 y DR-12 de 005, DR-10 de 010; DT-7 del plan): `vencimientoDeReservaDelMes(ahora, mes)` es una función pura (sin base de datos ni zona del proceso) que devuelve el menor entre `ahora` más 24 horas y las 23:59:59.999 de Lima del último día del mes de la matrícula
// (`mes`: `{ anio, mes }`, como `MesDeCalendario` de `mensualidades/dominio/ventana.ts`). Para el mes en curso de `ahora` (M) coincide con `vencimientoDeReserva(ahora)` de la 005; para el mes siguiente (M+1) son siempre las 24 horas, aunque crucen el día 1. `vencimientoDeReserva` y `finDelMesEnLima` no cambian.
// Lectura estricta elegida: el segundo argumento es `{ anio, mes }` (el mismo tipo que usan `cuposParaInscripcionNueva` y `exigirCupoDeLaMatricula` según el plan). Se prueba con el proceso en `TZ=UTC` y en `TZ=Asia/Tokyo`; los casos están escritos a mano y la propiedad se compara con un cálculo independiente (Lima es UTC-5 todo el año).

interface Reserva {
  vencimientoDeReservaDelMes: (ahora: Date, mes: { anio: number; mes: number }) => Date;
  vencimientoDeReserva: (ahora: Date) => Date;
}

async function cargar(): Promise<Reserva> {
  const ruta = path.join(__dirname, 'reserva.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 010d: no se pudo cargar "backend/src/modulos/matriculas/dominio/reserva.ts" (${motivo}).`,
      { cause: error },
    );
  }
  for (const nombre of ['vencimientoDeReservaDelMes', 'vencimientoDeReserva']) {
    if (typeof modulo[nombre] !== 'function') {
      throw new Error(`Falta la funcionalidad de la 010d: "dominio/reserva.ts" no exporta ${nombre}.`);
    }
  }
  return modulo as unknown as Reserva;
}

const ZONA_ORIGINAL = process.env['TZ'];
afterEach(() => {
  if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ZONA_ORIGINAL;
});

const VEINTICUATRO_HORAS = 24 * 60 * 60 * 1000;
const OFFSET_LIMA_MS = 5 * 60 * 60 * 1000;

/** Independiente de la implementación: el fin de un mes de Lima (`mes` de 1 a 12), con enteros y el desfase fijo de Lima. */
const finDelMesDeReferencia = (anio: number, mes: number): number => Date.UTC(anio, mes, 1, 5, 0, 0, 0) - 1;
/** El mes de Lima de un instante. */
function mesDeLima(instante: number): { anio: number; mes: number } {
  const lima = new Date(instante - OFFSET_LIMA_MS);
  return { anio: lima.getUTCFullYear(), mes: lima.getUTCMonth() + 1 };
}
const siguiente = ({ anio, mes }: { anio: number; mes: number }) =>
  mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };

describe.each(['UTC', 'Asia/Tokyo'])('criterio 4: vencimientoDeReservaDelMes con el proceso en TZ=%s', (zona) => {
  const vence = async (ahora: string, mes: { anio: number; mes: number }): Promise<string> => {
    process.env['TZ'] = zona;
    const { vencimientoDeReservaDelMes } = await cargar();
    const resultado = vencimientoDeReservaDelMes(new Date(ahora), mes);
    expect(resultado, 'devuelve un Date').toBeInstanceOf(Date);
    return resultado.toISOString();
  };

  it.each([
    [
      'a) viernes 27/11 a las 10:00 de Lima con diciembre (M+1): las 24 horas',
      '2026-11-27T15:00:00.000Z',
      { anio: 2026, mes: 12 },
      '2026-11-28T15:00:00.000Z',
    ],
    [
      'b) lunes 30/11 a las 22:00 de Lima (ya es 1/12 a las 03:00 UTC) con diciembre: cruza el día 1, no se recorta al fin de noviembre',
      '2026-12-01T03:00:00.000Z',
      { anio: 2026, mes: 12 },
      '2026-12-02T03:00:00.000Z',
    ],
    [
      'c) 30/11 a las 23:59:59.999 de Lima con diciembre: las 24 horas exactas',
      '2026-12-01T04:59:59.999Z',
      { anio: 2026, mes: 12 },
      '2026-12-02T04:59:59.999Z',
    ],
    [
      'd) 26/11 a las 00:00:00.000 de Lima (primer instante de la ventana) con diciembre',
      '2026-11-26T05:00:00.000Z',
      { anio: 2026, mes: 12 },
      '2026-11-27T05:00:00.000Z',
    ],
    [
      'e) jueves 31/12/2026 a las 10:00 de Lima con enero de 2027 (cambio de año)',
      '2026-12-31T15:00:00.000Z',
      { anio: 2027, mes: 1 },
      '2027-01-01T15:00:00.000Z',
    ],
    [
      'f) 28/01/2027 a las 10:00 de Lima con febrero de 2027 (febrero de 28 días)',
      '2027-01-28T15:00:00.000Z',
      { anio: 2027, mes: 2 },
      '2027-01-29T15:00:00.000Z',
    ],
    [
      'g) 31/01/2027 a las 23:59:59.999 de Lima con febrero de 2027: las 24 horas caen el 1/2 a las 23:59:59.999, dentro de febrero',
      '2027-02-01T04:59:59.999Z',
      { anio: 2027, mes: 2 },
      '2027-02-02T04:59:59.999Z',
    ],
  ])('criterio 4: %s', async (_nombre, ahora, mes, esperado) => {
    expect(await vence(ahora, mes)).toBe(esperado);
  });

  it.each([
    [
      'a) miércoles 11/11 a las 10:00 con noviembre (M): alcanzan las 24 horas',
      '2026-11-11T15:00:00.000Z',
      { anio: 2026, mes: 11 },
      '2026-11-12T15:00:00.000Z',
    ],
    [
      'b) lunes 30/11 a las 10:00 con noviembre (M): el fin de mes y no el 1/12 a las 10:00',
      '2026-11-30T15:00:00.000Z',
      { anio: 2026, mes: 11 },
      '2026-12-01T04:59:59.999Z',
    ],
    [
      'c) 30/11 a las 00:00:00.000 con noviembre (M): el fin de mes (las 24 horas darían el 1/12 a las 00:00)',
      '2026-11-30T05:00:00.000Z',
      { anio: 2026, mes: 11 },
      '2026-12-01T04:59:59.999Z',
    ],
    [
      'd) 1/12 a las 00:00:00.000 con diciembre (ya es M): las 24 horas',
      '2026-12-01T05:00:00.000Z',
      { anio: 2026, mes: 12 },
      '2026-12-02T05:00:00.000Z',
    ],
    [
      'e) 31/12 a las 10:00 con diciembre (M): el fin de diciembre',
      '2026-12-31T15:00:00.000Z',
      { anio: 2026, mes: 12 },
      '2027-01-01T04:59:59.999Z',
    ],
  ])(
    'criterio 4: para el mes en curso coincide con `vencimientoDeReserva(ahora)`: %s',
    async (_nombre, ahora, mes, esperado) => {
      expect(await vence(ahora, mes)).toBe(esperado);
      process.env['TZ'] = zona;
      const { vencimientoDeReserva } = await cargar();
      expect(vencimientoDeReserva(new Date(ahora)).toISOString(), 'la función de la 005 no cambia').toBe(esperado);
    },
  );

  it('criterio 4 (propiedad): para 3 000 instantes de 2026 y 2027, con el mes en curso es el menor entre ahora + 24 h y el fin de su mes, y con el mes siguiente siempre ahora + 24 h; nunca antes de ahora', async () => {
    process.env['TZ'] = zona;
    const { vencimientoDeReservaDelMes } = await cargar();
    let semilla = 20261127;
    const azar = (): number => {
      semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0;
      return semilla / 2 ** 32;
    };
    const inicio = Date.UTC(2026, 0, 1);
    const fin = Date.UTC(2027, 11, 31);
    for (let i = 0; i < 3000; i++) {
      const ahora = Math.floor(inicio + azar() * (fin - inicio));
      const m = mesDeLima(ahora);
      const delMes = vencimientoDeReservaDelMes(new Date(ahora), m).getTime();
      const delSiguiente = vencimientoDeReservaDelMes(new Date(ahora), siguiente(m)).getTime();
      const esperadoM = Math.min(ahora + VEINTICUATRO_HORAS, finDelMesDeReferencia(m.anio, m.mes));
      expect(delMes, `M, ahora=${new Date(ahora).toISOString()}`).toBe(esperadoM);
      expect(delSiguiente, `M+1, ahora=${new Date(ahora).toISOString()}`).toBe(ahora + VEINTICUATRO_HORAS);
      expect(delMes).toBeGreaterThanOrEqual(ahora);
      expect(delSiguiente).toBeGreaterThan(ahora);
    }
  });

  it('criterio 4: el vencimiento de M+1 siempre cae dentro del mes de la matrícula (lo que exige el CHECK `matriculas_reserva_dentro_del_mes`), también cuando las 24 horas cruzan el día 1', async () => {
    process.env['TZ'] = zona;
    const { vencimientoDeReservaDelMes } = await cargar();
    for (const ahora of [
      '2026-11-26T05:00:00.000Z',
      '2026-12-01T03:00:00.000Z',
      '2026-12-01T04:59:59.999Z',
      '2026-12-31T15:00:00.000Z',
    ]) {
      const instante = new Date(ahora);
      const mes = siguiente(mesDeLima(instante.getTime()));
      const resultado = vencimientoDeReservaDelMes(instante, mes).getTime();
      expect(resultado, ahora).toBeLessThanOrEqual(finDelMesDeReferencia(mes.anio, mes.mes));
    }
  });
});
