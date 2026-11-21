// spec: 005-inscripcion-publica (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Criterio 54 (crítico, RN-28, DR-1, DR-12, RNF-12; respuesta R1, ronda 1): la función pura `vencimientoDeReserva(ahora)` devuelve el menor
// entre `ahora + 24 h` y el fin del mes en Lima del mes de "ahora" (las 23:59:59.999 del último día del mes en America/Lima). Se prueba con
// el proceso en `TZ=UTC` y en `TZ=Asia/Tokyo`. `finDelMesEnLima(ahora)` (contrato de `dominio/reserva.ts`) da ese fin de mes.
// Los casos están escritos a mano y la propiedad se compara con un cálculo independiente (Lima es UTC-5 todo el año).

interface Reserva {
  vencimientoDeReserva: (ahora: Date) => Date;
  finDelMesEnLima: (ahora: Date) => Date;
}

async function cargar(): Promise<Reserva> {
  const ruta = path.join(__dirname, 'reserva.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 005a: no se pudo cargar "backend/src/modulos/matriculas/dominio/reserva.ts" (${motivo}).`,
      { cause: error },
    );
  }
  for (const nombre of ['vencimientoDeReserva', 'finDelMesEnLima']) {
    if (typeof modulo[nombre] !== 'function') {
      throw new Error(`Falta la funcionalidad de la 005a: "dominio/reserva.ts" no exporta ${nombre}.`);
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

/** Independiente de la implementación: el fin del mes de Lima de un instante, con enteros y el desfase fijo de Lima. */
function finDelMesDeReferencia(ahora: Date): number {
  const lima = new Date(ahora.getTime() - OFFSET_LIMA_MS);
  const primerInstanteDelMesSiguiente = Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth() + 1, 1, 5, 0, 0, 0);
  return primerInstanteDelMesSiguiente - 1;
}

const mesDeLima = (instante: number): string => {
  const lima = new Date(instante - OFFSET_LIMA_MS);
  return `${lima.getUTCFullYear()}-${lima.getUTCMonth() + 1}`;
};

describe.each(['UTC', 'Asia/Tokyo'])('criterio 54: vencimientoDeReserva con el proceso en TZ=%s', (zona) => {
  const vence = async (ahora: string): Promise<string> => {
    process.env['TZ'] = zona;
    const { vencimientoDeReserva } = await cargar();
    const resultado = vencimientoDeReserva(new Date(ahora));
    expect(resultado, 'devuelve un Date').toBeInstanceOf(Date);
    return resultado.toISOString();
  };

  it.each([
    ['a) miércoles 11, 10:00 en Lima: alcanzan las 24 horas', '2026-11-11T15:00:00.000Z', '2026-11-12T15:00:00.000Z'],
    [
      'b) lunes 30, 10:00 en Lima: el fin de mes (no el 1 de diciembre a las 10:00)',
      '2026-11-30T15:00:00.000Z',
      '2026-12-01T04:59:59.999Z',
    ],
    [
      'c) 23:59:59.999 del domingo 29 en Lima: las dos coinciden',
      '2026-11-30T04:59:59.999Z',
      '2026-12-01T04:59:59.999Z',
    ],
    [
      'd) 00:00 del lunes 30 en Lima: fin de mes (las 24 horas darían el 1 de diciembre a las 00:00)',
      '2026-11-30T05:00:00.000Z',
      '2026-12-01T04:59:59.999Z',
    ],
    ['e) cambio de año: 31 de diciembre, 10:00 en Lima', '2026-12-31T15:00:00.000Z', '2027-01-01T04:59:59.999Z'],
    ['f) febrero de 28 días (2027)', '2027-02-28T15:00:00.000Z', '2027-03-01T04:59:59.999Z'],
    ['f) año bisiesto (2028): alcanzan las 24 horas', '2028-02-28T15:00:00.000Z', '2028-02-29T15:00:00.000Z'],
    [
      'g) el último milisegundo de noviembre en Lima da ese mismo instante',
      '2026-12-01T04:59:59.999Z',
      '2026-12-01T04:59:59.999Z',
    ],
  ])('criterio 54 %s', async (_nombre, ahora, esperado) => {
    expect(await vence(ahora)).toBe(esperado);
  });

  it('criterio 54: el primer milisegundo del mes siguiente en Lima ya es otro mes: vence 24 horas después (diciembre)', async () => {
    expect(await vence('2026-12-01T05:00:00.000Z')).toBe('2026-12-02T05:00:00.000Z');
  });

  it('criterio 54: un milisegundo antes del fin de mes da el fin de mes (no antes de "ahora")', async () => {
    expect(await vence('2026-12-01T04:59:59.998Z')).toBe('2026-12-01T04:59:59.999Z');
  });

  it('criterio 54 h (propiedad): con instantes de todo 2026 y 2027, el resultado nunca es anterior a "ahora", nunca pasa de ahora + 24 h, cae en el mismo mes de Lima que "ahora" y es el menor entre ahora + 24 h y el fin del mes', async () => {
    process.env['TZ'] = zona;
    const { vencimientoDeReserva } = await cargar();
    const inicio = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
    const fin = Date.UTC(2028, 0, 1, 0, 0, 0, 0);
    const instantes = new Set<number>();
    // Cada 37 minutos (no divide a 24 horas: recorre minutos distintos de cada hora).
    for (let t = inicio; t < fin; t += 37 * 60 * 1000 + 13_017) instantes.add(t);
    // Todos los minutos en las seis horas antes y la hora después de cada cambio de mes en Lima.
    for (let anio = 2026; anio <= 2027; anio++) {
      for (let mes = 0; mes < 12; mes++) {
        const cambio = Date.UTC(anio, mes + 1, 1, 5, 0, 0, 0);
        for (let t = cambio - 6 * 60 * 60 * 1000; t <= cambio + 60 * 60 * 1000; t += 60 * 1000) instantes.add(t);
        instantes.add(cambio - 2);
        instantes.add(cambio - 1);
        instantes.add(cambio);
        instantes.add(cambio + 1);
      }
    }

    let revisados = 0;
    for (const t of instantes) {
      const resultado = vencimientoDeReserva(new Date(t)).getTime();
      const mensaje = `ahora ${new Date(t).toISOString()} → ${new Date(resultado).toISOString()}`;
      if (resultado < t || resultado > t + VEINTICUATRO_HORAS || mesDeLima(resultado) !== mesDeLima(t)) {
        expect.fail(`fuera de rango: ${mensaje}`);
      }
      if (resultado !== Math.min(t + VEINTICUATRO_HORAS, finDelMesDeReferencia(new Date(t)))) {
        expect.fail(`no es el menor entre ahora + 24 h y el fin del mes: ${mensaje}`);
      }
      revisados += 1;
    }
    expect(revisados).toBeGreaterThan(30_000);
  });
});

describe.each(['UTC', 'Asia/Tokyo'])('criterio 54: finDelMesEnLima con el proceso en TZ=%s', (zona) => {
  it.each([
    ['noviembre de 2026', '2026-11-11T15:00:00.000Z', '2026-12-01T04:59:59.999Z'],
    ['el primer instante de noviembre en Lima', '2026-11-01T05:00:00.000Z', '2026-12-01T04:59:59.999Z'],
    ['el último milisegundo de noviembre en Lima', '2026-12-01T04:59:59.999Z', '2026-12-01T04:59:59.999Z'],
    ['el primer instante de diciembre en Lima', '2026-12-01T05:00:00.000Z', '2027-01-01T04:59:59.999Z'],
    ['diciembre (cambio de año)', '2026-12-31T15:00:00.000Z', '2027-01-01T04:59:59.999Z'],
    ['febrero de 2027 (28 días)', '2027-02-10T15:00:00.000Z', '2027-03-01T04:59:59.999Z'],
    ['febrero de 2028 (bisiesto)', '2028-02-10T15:00:00.000Z', '2028-03-01T04:59:59.999Z'],
  ])('criterio 54: %s', async (_nombre, ahora, esperado) => {
    process.env['TZ'] = zona;
    const { finDelMesEnLima } = await cargar();

    expect(finDelMesEnLima(new Date(ahora)).toISOString()).toBe(esperado);
  });
});
