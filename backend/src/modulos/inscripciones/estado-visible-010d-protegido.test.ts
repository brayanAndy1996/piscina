// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Criterio 10 (crítico, D-05, DT-9 del plan): el estado visible de una solicitud con la matrícula `CANCELADA` y su último pago `RECHAZADO` es `PAGO_RECHAZADO` mientras el mes de hoy (Lima) no es posterior al de la matrícula, y `VENCIDA` después (amplía `estadoVisible`; con una matrícula de M el resultado no cambia). Pruebas unitarias de
// `estadoVisible(datos, ahora)` con hoy en M, en M+1 y en M+2, con el cambio de año y con el proceso en `TZ=UTC` y en `TZ=Asia/Tokyo`. El resto de las ramas del estado visible no cambia. (La lista del panel, que usa `estadoVisibleSql`, se prueba con la base real en `backend/test/integracion/inscripciones/mes-siguiente-rechazo.test.ts`.)
// Lectura estricta elegida: «el mes de hoy no es posterior al de la matrícula» compara año y mes juntos (`anio × 12 + mes`): diciembre de 2026 todavía es PAGO_RECHAZADO el 31/12/2026 a las 23:59:59.999 de Lima y VENCIDA el 1/1/2027 a las 00:00:00.000, aunque 1 < 12.

interface DatosDelEstado {
  estado_solicitud: string;
  estado_matricula: string;
  reserva_vence_en: Date | null;
  estado_ultimo_pago?: string | null;
  hay_pago_pendiente?: boolean | null;
  anio?: number;
  mes?: number;
}
type EstadoVisible = (datos: DatosDelEstado, ahora: Date) => string;

async function cargar(): Promise<EstadoVisible> {
  const ruta = path.join(__dirname, 'estado-visible.ts');
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 010d: no se pudo cargar "backend/src/modulos/inscripciones/estado-visible.ts" (${motivo}).`,
      { cause: error },
    );
  }
  if (typeof modulo['estadoVisible'] !== 'function' || typeof modulo['estadoVisibleSql'] !== 'function') {
    throw new Error(
      'Falta la funcionalidad de la 010d: "estado-visible.ts" debe exportar estadoVisible y estadoVisibleSql.',
    );
  }
  return modulo['estadoVisible'] as EstadoVisible;
}

const ZONA_ORIGINAL = process.env['TZ'];
afterEach(() => {
  if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ZONA_ORIGINAL;
});

const rechazada = (anio: number, mes: number): DatosDelEstado => ({
  estado_solicitud: 'PENDIENTE_PAGO',
  estado_matricula: 'CANCELADA',
  reserva_vence_en: null,
  estado_ultimo_pago: 'RECHAZADO',
  hay_pago_pendiente: false,
  anio,
  mes,
});

describe.each(['UTC', 'Asia/Tokyo'])('criterio 10: estadoVisible tras un rechazo, con el proceso en TZ=%s', (zona) => {
  const estado = async (datos: DatosDelEstado, ahora: string): Promise<string> => {
    process.env['TZ'] = zona;
    const estadoVisible = await cargar();
    return estadoVisible(datos, new Date(ahora));
  };

  it.each([
    [
      'hoy en M (27/11/2026) y matrícula de M+1 (diciembre): PAGO_RECHAZADO',
      2026,
      12,
      '2026-11-27T15:00:00.000Z',
      'PAGO_RECHAZADO',
    ],
    [
      'hoy en M (27/11/2026) y matrícula de M (noviembre): PAGO_RECHAZADO (sin cambios)',
      2026,
      11,
      '2026-11-27T15:00:00.000Z',
      'PAGO_RECHAZADO',
    ],
    [
      'hoy en M (27/11/2026) y matrícula de octubre (anterior): VENCIDA (sin cambios)',
      2026,
      10,
      '2026-11-27T15:00:00.000Z',
      'VENCIDA',
    ],
    [
      'hoy en M+1 (2/12/2026) y matrícula de diciembre: PAGO_RECHAZADO (ahora es M)',
      2026,
      12,
      '2026-12-02T15:00:00.000Z',
      'PAGO_RECHAZADO',
    ],
    [
      'hoy en M+1 (2/12/2026) y matrícula de noviembre (ya pasó): VENCIDA',
      2026,
      11,
      '2026-12-02T15:00:00.000Z',
      'VENCIDA',
    ],
    [
      'hoy el 1/1/2027 (M+2 de diciembre) y matrícula de diciembre: VENCIDA',
      2026,
      12,
      '2027-01-15T15:00:00.000Z',
      'VENCIDA',
    ],
    [
      'hoy en M (31/12/2026) y matrícula de enero de 2027 (cambio de año): PAGO_RECHAZADO',
      2027,
      1,
      '2026-12-31T15:00:00.000Z',
      'PAGO_RECHAZADO',
    ],
    [
      'hoy en enero de 2027 y matrícula de diciembre de 2026 (año anterior, mes mayor): VENCIDA',
      2026,
      12,
      '2027-01-10T15:00:00.000Z',
      'VENCIDA',
    ],
    [
      'hoy en noviembre de 2026 y matrícula de enero de 2027 (M+2, aún sin empezar): PAGO_RECHAZADO',
      2027,
      1,
      '2026-11-27T15:00:00.000Z',
      'PAGO_RECHAZADO',
    ],
    [
      'hoy en noviembre de 2027 y matrícula de noviembre de 2026 (mismo mes, otro año): VENCIDA',
      2026,
      11,
      '2027-11-10T15:00:00.000Z',
      'VENCIDA',
    ],
  ])('criterio 10: %s', async (_nombre, anio, mes, ahora, esperado) => {
    expect(await estado(rechazada(anio, mes), ahora)).toBe(esperado);
  });

  it('criterio 10 (bordes de Lima): una matrícula de diciembre rechazada es PAGO_RECHAZADO a las 23:59:59.999 del 31/12/2026 (2027-01-01T04:59:59.999Z) y VENCIDA a las 00:00:00.000 del 1/1/2027 (2027-01-01T05:00:00.000Z)', async () => {
    expect(await estado(rechazada(2026, 12), '2027-01-01T04:59:59.999Z')).toBe('PAGO_RECHAZADO');
    expect(await estado(rechazada(2026, 12), '2027-01-01T05:00:00.000Z')).toBe('VENCIDA');
  });

  it('criterio 10 (bordes de Lima, sin cambios para M): una matrícula de noviembre rechazada es PAGO_RECHAZADO a las 23:59:59.999 del 30/11 y VENCIDA a las 00:00:00.000 del 1/12', async () => {
    expect(await estado(rechazada(2026, 11), '2026-12-01T04:59:59.999Z')).toBe('PAGO_RECHAZADO');
    expect(await estado(rechazada(2026, 11), '2026-12-01T05:00:00.000Z')).toBe('VENCIDA');
  });

  it('criterio 10: la matrícula de M+1 en verificación, cancelada sin pago rechazado, reservada o con la fila de la solicitud cerrada conservan su estado de siempre', async () => {
    const hoy = '2026-11-27T15:00:00.000Z';
    expect(
      await estado({ ...rechazada(2026, 12), hay_pago_pendiente: true }, hoy),
      'con un pago pendiente, EN_VERIFICACION',
    ).toBe('EN_VERIFICACION');
    expect(
      await estado({ ...rechazada(2026, 12), estado_ultimo_pago: null }, hoy),
      'cancelada sin pago rechazado',
    ).toBe('CANCELADA');
    expect(await estado({ ...rechazada(2026, 12), estado_ultimo_pago: 'CONFIRMADO' }, hoy)).toBe('CANCELADA');
    expect(
      await estado({ ...rechazada(2026, 12), estado_solicitud: 'CANCELADA' }, hoy),
      'la fila de la solicitud manda',
    ).toBe('CANCELADA');
    expect(await estado({ ...rechazada(2026, 12), estado_solicitud: 'VENCIDA' }, hoy)).toBe('VENCIDA');
    expect(await estado({ ...rechazada(2026, 12), estado_solicitud: 'CONFIRMADA' }, hoy)).toBe('CONFIRMADA');
    const reservada: DatosDelEstado = {
      estado_solicitud: 'PENDIENTE_PAGO',
      estado_matricula: 'RESERVADA',
      reserva_vence_en: new Date('2026-11-28T15:00:00.000Z'),
      anio: 2026,
      mes: 12,
    };
    expect(await estado(reservada, '2026-11-28T14:59:59.999Z'), 'reserva de 24 horas de diciembre vigente').toBe(
      'PENDIENTE_PAGO',
    );
    expect(await estado(reservada, '2026-11-28T15:00:00.000Z'), 'vence en este mismo instante').toBe('VENCIDA');
  });
});
