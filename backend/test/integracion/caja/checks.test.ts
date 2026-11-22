// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RolPruebas } from '../../utilidades/base-datos';
import {
  actualizarFilasCaja,
  type BaseDeCierre,
  type Columnas,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  enLima,
  type EscenarioCaja,
  filaCajaValida,
  filaCierreValida,
  filaEgresoValida,
  filaIngresoValida,
  insertarFilaCaja,
  leerCajas,
  leerCierres,
  leerMovimientos,
} from '../../utilidades/caja';

// Criterio 4 (crítico, RN-17, HU-27, sección 4.3, RNF-12): invariantes con CHECK. Dado un INSERT o UPDATE directo, como app y como dueño,
// falla con 23514:
//   a) cajas: `monto_inicial` negativo o NaN; `fecha` distinta de la fecha de America/Lima de `abierta_en`.
//   b) movimientos_caja: `monto` <= 0 o NaN; `numero` < 1; un INGRESO con concepto EGRESO_MENOR, sin `alumno_id` o sin `pago_id`, o con
//      `descripcion`, `comprobante` o `clave_idempotencia`; un EGRESO con un concepto distinto de EGRESO_MENOR, con un método distinto de
//      EFECTIVO, sin `descripcion` o sin `clave_idempotencia`, o con `alumno_id` o `pago_id`.
//   c) cierres_caja: cualquier monto NaN; `monto_inicial`, los ingresos, los egresos o `monto_declarado` negativos; `esperado_efectivo`
//      distinto de inicial + ingresos en efectivo - egresos; `diferencia` distinta de declarado - esperado; `diferencia` distinta de 0 sin
//      `observacion`; `numero` < 1; `movimientos_hasta` negativo; `reabierto_por`, `reabierto_en` y `motivo_reapertura` no todos nulos o
//      todos llenos; `reabierto_en` anterior a `cerrado_en`.
// Como app no hay UPDATE de la mayoría de las columnas (criterio 2): los UPDATE se prueban como dueño, en `cajas` y `cierres_caja`. En
// `movimientos_caja` no hay política de UPDATE (los movimientos no cambian): un UPDATE no alcanza ninguna fila, con ningún rol.
// En los movimientos, el error no puede venir del trigger de la caja cerrada: la caja está ABIERTA y la restricción que falla es otra.

const ROLES: readonly RolPruebas[] = ['app', 'propietario'];
const TRIGGER = 'movimientos_caja_solo_caja_abierta';

describe('criterio 4: CHECK de las tres tablas', () => {
  let e: EscenarioCaja;
  let cajaId: string;
  let alumnoId: string;

  beforeEach(async () => {
    e = await crearEscenarioDeCaja();
    alumnoId = (await crearAlumnoDeCaja(e.A.id)).id;
    cajaId = (await crearCajaDePrueba(e.A.id, e.secretariaA.id)).id;
  });

  const insertar = (rol: RolPruebas, tabla: 'cajas' | 'movimientos_caja' | 'cierres_caja', fila: Columnas) =>
    insertarFilaCaja(rol, tabla, e.A.id, fila);

  // -------------------------------------------------------------------------------------------------------------------
  // a) cajas
  // -------------------------------------------------------------------------------------------------------------------

  describe.each(ROLES)('a) cajas, como %s', (rol) => {
    const caja = (sobre: Columnas) =>
      filaCajaValida(e.secretariaA.id, { estado: 'CERRADA', fecha: '2026-10-01', ...sobre });

    it.each(['-0.01', '-1', '-99999.99', 'NaN'])('criterio 4 a: monto_inicial %s falla con 23514', async (monto) => {
      await expect(insertar(rol, 'cajas', caja({ monto_inicial: monto }))).rejects.toMatchObject({ code: '23514' });
      expect(await leerCajas(e.A.id)).toHaveLength(1);
    });

    it.each(['0', '0.00', '0.01', '99999.99'])('criterio 4 a: monto_inicial %s se acepta (control)', async (monto) => {
      await expect(insertar(rol, 'cajas', caja({ monto_inicial: monto }))).resolves.toBeDefined();
    });

    // [fecha, abierta_en, ¿cumple?]: la fecha de Lima de cada instante, con los bordes de las 19:00, de la medianoche, del fin de mes y del
    // fin de año. En UTC ya sería el día siguiente desde las 19:00 de Lima.
    it.each([
      ['2026-12-01', '2026-11-30T23:59:00.000Z', false],
      ['2026-11-30', '2026-11-30T23:59:00.000Z', true],
      ['2026-12-01', '2026-12-01T00:30:00.000Z', false],
      ['2026-11-30', '2026-12-01T00:30:00.000Z', true],
      ['2026-12-01', '2026-12-01T04:59:59.999Z', false],
      ['2026-11-30', '2026-12-01T04:59:59.999Z', true],
      ['2026-11-30', '2026-12-01T05:00:00.000Z', false],
      ['2026-12-01', '2026-12-01T05:00:00.000Z', true],
      ['2027-01-01', '2027-01-01T04:59:59.999Z', false],
      ['2026-12-31', '2027-01-01T04:59:59.999Z', true],
      ['2026-12-31', '2027-01-01T05:00:00.000Z', false],
      ['2027-01-01', '2027-01-01T05:00:00.000Z', true],
    ] as const)(
      'criterio 4 a: fecha %s con abierta_en %s (fecha de Lima del instante): cumple = %s',
      async (fecha, abiertaEn, cumple) => {
        const insercion = insertar(rol, 'cajas', caja({ fecha, abierta_en: new Date(abiertaEn) }));

        if (cumple) await expect(insercion).resolves.toBeDefined();
        else await expect(insercion).rejects.toMatchObject({ code: '23514' });
      },
    );
  });

  describe('a) cajas: UPDATE como dueño', () => {
    it('criterio 4 a: cambiar la fecha a una que no es la de Lima de abierta_en falla con 23514', async () => {
      await expect(
        actualizarFilasCaja('propietario', 'cajas', e.A.id, { id: cajaId }, { fecha: '2026-11-12' }),
      ).rejects.toMatchObject({ code: '23514' });
      expect((await leerCajas(e.A.id))[0]?.fecha).toBe('2026-11-11');
    });

    it.each(['-1', 'NaN'])('criterio 4 a: cambiar monto_inicial a %s falla con 23514', async (monto) => {
      await expect(
        actualizarFilasCaja('propietario', 'cajas', e.A.id, { id: cajaId }, { monto_inicial: monto }),
      ).rejects.toMatchObject({ code: '23514' });
      expect((await leerCajas(e.A.id))[0]?.monto_inicial).toBe('100.00');
    });

    it('criterio 4 a: cambiar abierta_en al día siguiente de Lima sin cambiar la fecha falla con 23514', async () => {
      await expect(
        actualizarFilasCaja(
          'propietario',
          'cajas',
          e.A.id,
          { id: cajaId },
          { abierta_en: enLima('2026-11-12', '00:00') },
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // b) movimientos_caja
  // -------------------------------------------------------------------------------------------------------------------

  describe.each(ROLES)('b) movimientos_caja, como %s', (rol) => {
    const ingreso = (sobre: Columnas = {}) => filaIngresoValida(cajaId, e.secretariaA.id, alumnoId, 1, sobre);
    const egreso = (sobre: Columnas = {}) => filaEgresoValida(cajaId, e.secretariaA.id, 1, sobre);

    async function rechazaPorCheck(fila: Columnas): Promise<void> {
      const error = await insertar(rol, 'movimientos_caja', fila).then(
        () => undefined,
        (falla: unknown) => falla as { code?: string; constraint?: string },
      );
      expect(error, 'la fila inválida se aceptó').toBeDefined();
      expect(error?.code).toBe('23514');
      expect(error?.constraint, 'debe fallar un CHECK de coherencia, no el trigger de la caja cerrada').not.toBe(
        TRIGGER,
      );
      expect(await leerMovimientos(e.A.id)).toHaveLength(0);
    }

    it.each([
      ['monto 0', { monto: '0' }],
      ['monto 0.00', { monto: '0.00' }],
      ['monto negativo', { monto: '-1.00' }],
      ['monto NaN', { monto: 'NaN' }],
      ['número 0', { numero: 0 }],
      ['número negativo', { numero: -1 }],
    ])('criterio 4 b: un ingreso con %s falla con 23514', async (_nombre, sobre) => {
      await rechazaPorCheck(ingreso(sobre));
    });

    it.each([
      ['monto 0', { monto: '0.00' }],
      ['monto negativo', { monto: '-0.01' }],
      ['monto NaN', { monto: 'NaN' }],
      ['número 0', { numero: 0 }],
    ])('criterio 4 b: un egreso con %s falla con 23514', async (_nombre, sobre) => {
      await rechazaPorCheck(egreso(sobre));
    });

    it.each([
      ['concepto EGRESO_MENOR', { concepto: 'EGRESO_MENOR' }],
      ['sin alumno_id', { alumno_id: null }],
      ['sin pago_id', { pago_id: null }],
      ['con descripcion', { descripcion: 'Una descripción' }],
      ['con comprobante', { comprobante: 'B001-123' }],
      ['con clave_idempotencia', { clave_idempotencia: randomUUID() }],
    ])('criterio 4 b: un INGRESO %s falla con 23514', async (_nombre, sobre) => {
      await rechazaPorCheck(ingreso(sobre));
    });

    it.each([
      ['concepto INSCRIPCION', { concepto: 'INSCRIPCION' }],
      ['concepto MENSUALIDAD', { concepto: 'MENSUALIDAD' }],
      ['concepto CLASE_PARTICULAR', { concepto: 'CLASE_PARTICULAR' }],
      ['método YAPE', { metodo: 'YAPE' }],
      ['método TRANSFERENCIA', { metodo: 'TRANSFERENCIA' }],
      ['sin descripcion', { descripcion: null }],
      ['sin clave_idempotencia', { clave_idempotencia: null }],
      ['con alumno_id', { alumno_id: randomUUID() }],
      ['con pago_id', { pago_id: randomUUID() }],
    ])('criterio 4 b: un EGRESO %s falla con 23514', async (_nombre, sobre) => {
      await rechazaPorCheck(egreso(sobre));
    });

    it('criterio 4 b: un EGRESO con alumno_id de un alumno real también falla con 23514 (no por la llave foránea)', async () => {
      await rechazaPorCheck(egreso({ alumno_id: alumnoId }));
    });

    it.each([
      ['INSCRIPCION', 'EFECTIVO'],
      ['MENSUALIDAD', 'YAPE'],
      ['CLASE_PARTICULAR', 'TRANSFERENCIA'],
    ])('criterio 4 b: un ingreso de %s por %s se acepta (control)', async (concepto, metodo) => {
      await expect(insertar(rol, 'movimientos_caja', ingreso({ concepto, metodo }))).resolves.toBeDefined();
    });

    it('criterio 4 b: un egreso en efectivo con descripción y clave, con o sin comprobante, se acepta (control)', async () => {
      await expect(
        insertar(rol, 'movimientos_caja', egreso({ comprobante: 'Boleta B001-123' })),
      ).resolves.toBeDefined();
      await expect(insertar(rol, 'movimientos_caja', egreso({ numero: 2 }))).resolves.toBeDefined();
    });

    it('criterio 4 b: el monto máximo de la columna (99999999.99) y el mínimo (0.01) se aceptan (control)', async () => {
      await expect(insertar(rol, 'movimientos_caja', ingreso({ monto: '0.01' }))).resolves.toBeDefined();
      await expect(
        insertar(rol, 'movimientos_caja', egreso({ numero: 2, monto: '99999999.99' })),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // c) cierres_caja
  // -------------------------------------------------------------------------------------------------------------------

  describe.each(ROLES)('c) cierres_caja, como %s', (rol) => {
    const cierre = (base: Partial<BaseDeCierre> = {}, sobre: Columnas = {}) =>
      filaCierreValida(cajaId, e.secretariaA.id, base, sobre);

    async function rechazaPorCheck(fila: Columnas): Promise<void> {
      await expect(insertar(rol, 'cierres_caja', fila)).rejects.toMatchObject({ code: '23514' });
      expect(await leerCierres(e.A.id)).toHaveLength(0);
    }

    // Con NaN en una de las columnas que entran en las cuentas, esperado y diferencia son NaN: así las cuentas "cuadran" y solo el CHECK
    // de NaN puede rechazar la fila.
    it.each(['monto_inicial', 'ingresos_efectivo', 'egresos_efectivo', 'monto_declarado'])(
      'criterio 4 c: %s NaN (con las cuentas coherentes) falla con 23514',
      async (columna) => {
        await rechazaPorCheck(
          cierre(
            {},
            { [columna]: 'NaN', esperado_efectivo: 'NaN', diferencia: 'NaN', observacion: 'NaN de la prueba' },
          ),
        );
      },
    );

    it.each(['ingresos_yape', 'ingresos_transferencia', 'esperado_efectivo', 'diferencia'])(
      'criterio 4 c: %s NaN falla con 23514',
      async (columna) => {
        await rechazaPorCheck(cierre({}, { [columna]: 'NaN', observacion: 'NaN de la prueba' }));
      },
    );

    it.each([
      ['monto_inicial', { montoInicial: '-1.00' }],
      ['ingresos_efectivo', { ingresosEfectivo: '-1.00' }],
      ['ingresos_yape', { ingresosYape: '-1.00' }],
      ['ingresos_transferencia', { ingresosTransferencia: '-1.00' }],
      ['egresos_efectivo', { egresosEfectivo: '-1.00' }],
      ['monto_declarado', { montoDeclarado: '-1.00' }],
    ] as const)('criterio 4 c: %s negativo (con las cuentas coherentes) falla con 23514', async (_columna, base) => {
      await rechazaPorCheck(cierre(base));
    });

    it('criterio 4 c: la diferencia sí puede ser negativa (faltante) y el esperado también si los egresos superan lo disponible en una cuenta coherente', async () => {
      await expect(insertar(rol, 'cierres_caja', cierre({ montoDeclarado: '120.00' }))).resolves.toBeDefined();
    });

    it('criterio 4 c: esperado_efectivo distinto de inicial + ingresos en efectivo - egresos falla con 23514 (con la diferencia coherente con ese esperado)', async () => {
      await rechazaPorCheck(
        cierre({}, { esperado_efectivo: '126.49', diferencia: '0.01', observacion: 'Esperado mal calculado' }),
      );
      await rechazaPorCheck(cierre({}, { esperado_efectivo: '226.50', diferencia: '-100.00', observacion: 'Otro' }));
    });

    it('criterio 4 c: el esperado no cuenta los ingresos de Yape ni de transferencia (sección 4.3, D-04): sumarlos falla con 23514', async () => {
      await rechazaPorCheck(
        cierre(
          {},
          {
            esperado_efectivo: '334.50',
            monto_declarado: '334.50',
            diferencia: '0.00',
          },
        ),
      );
    });

    it('criterio 4 c: diferencia distinta de monto_declarado - esperado_efectivo falla con 23514', async () => {
      await rechazaPorCheck(cierre({}, { diferencia: '0.01', observacion: 'Diferencia mal calculada' }));
      await rechazaPorCheck(
        cierre({ montoDeclarado: '120.00' }, { diferencia: '6.50', observacion: 'Signo cambiado' }),
      );
    });

    it.each(['126.49', '126.51', '0', '99999.99'])(
      'criterio 4 c: con monto_declarado %s la diferencia es distinta de 0 y sin observación falla con 23514',
      async (declarado) => {
        await rechazaPorCheck(cierre({ montoDeclarado: declarado }, { observacion: null }));
      },
    );

    it('criterio 4 c: con diferencia distinta de 0 y con observación, o con diferencia 0 sin ella, se acepta (control)', async () => {
      await expect(
        insertar(rol, 'cierres_caja', cierre({ montoDeclarado: '126.49' }, { observacion: 'Faltó un céntimo' })),
      ).resolves.toBeDefined();
      await expect(
        insertar(
          rol,
          'cierres_caja',
          cierre(
            {},
            {
              numero: 2,
              observacion: null,
              reabierto_por: e.adminA.id,
              reabierto_en: enLima('2026-11-11', '19:00'),
              motivo_reapertura: 'Primera reapertura',
            },
          ),
        ),
      ).resolves.toBeDefined();
    });

    it.each([
      ['número 0', { numero: 0 }],
      ['número negativo', { numero: -1 }],
      ['movimientos_hasta negativo', { movimientos_hasta: -1 }],
    ])('criterio 4 c: un cierre con %s falla con 23514', async (_nombre, sobre) => {
      await rechazaPorCheck(cierre({}, sobre));
    });

    const COMPLETA = {
      reabierto_por: '', // se completa con el id del administrador de A en cada caso
      reabierto_en: enLima('2026-11-11', '19:00'),
      motivo_reapertura: 'Se cerró por error',
    };

    it.each([
      ['solo reabierto_por', ['reabierto_por']],
      ['solo reabierto_en', ['reabierto_en']],
      ['solo motivo_reapertura', ['motivo_reapertura']],
      ['reabierto_por y reabierto_en sin motivo', ['reabierto_por', 'reabierto_en']],
      ['reabierto_por y motivo sin reabierto_en', ['reabierto_por', 'motivo_reapertura']],
      ['reabierto_en y motivo sin reabierto_por', ['reabierto_en', 'motivo_reapertura']],
    ] as const)('criterio 4 c: %s llenos a medias falla con 23514', async (_nombre, columnas) => {
      const parcial: Columnas = {};
      for (const columna of columnas) {
        parcial[columna] = columna === 'reabierto_por' ? e.adminA.id : COMPLETA[columna];
      }

      await rechazaPorCheck(cierre({}, parcial));
    });

    it('criterio 4 c: reabierto_en anterior a cerrado_en falla con 23514, y a igual instante se acepta', async () => {
      const completa = { reabierto_por: e.adminA.id, motivo_reapertura: 'Se cerró por error' };

      await rechazaPorCheck(cierre({}, { ...completa, reabierto_en: enLima('2026-11-11', '17:59:59.999') }));
      await expect(
        insertar(rol, 'cierres_caja', cierre({}, { ...completa, reabierto_en: enLima('2026-11-11', '18:00') })),
      ).resolves.toBeDefined();
    });
  });

  describe('c) cierres_caja: UPDATE como dueño', () => {
    it.each([
      ['monto_declarado negativo', { monto_declarado: '-1' }],
      ['diferencia que no cuadra', { diferencia: '5.00' }],
      ['esperado_efectivo que no cuadra', { esperado_efectivo: '1.00' }],
      ['monto_declarado NaN', { monto_declarado: 'NaN' }],
      ['número 0', { numero: 0 }],
      ['solo reabierto_por', { reabierto_por: 'ADMIN' }],
      ['solo motivo_reapertura', { motivo_reapertura: 'Sin quien reabre' }],
    ])('criterio 4 c: cambiar un cierre a %s falla con 23514', async (_nombre, cambio) => {
      const cierre = filaCierreValida(cajaId, e.secretariaA.id);
      await insertar('propietario', 'cierres_caja', cierre);
      const cambios = Object.fromEntries(
        Object.entries(cambio).map(([columna, valor]) => [columna, valor === 'ADMIN' ? e.adminA.id : valor]),
      );

      await expect(
        actualizarFilasCaja('propietario', 'cierres_caja', e.A.id, { id: cierre['id'] }, cambios),
      ).rejects.toMatchObject({ code: '23514' });

      expect((await leerCierres(e.A.id))[0]?.monto_declarado).toBe('126.50');
    });

    it('criterio 4 c: la reapertura completa (reabierto_por, reabierto_en y motivo) sí se acepta en un UPDATE (control)', async () => {
      const cierre = filaCierreValida(cajaId, e.secretariaA.id);
      await insertar('propietario', 'cierres_caja', cierre);

      const filas = await actualizarFilasCaja(
        'app',
        'cierres_caja',
        e.A.id,
        { id: cierre['id'] },
        {
          reabierto_por: e.adminA.id,
          reabierto_en: enLima('2026-11-11', '19:00'),
          motivo_reapertura: 'Se cerró por error',
        },
      );

      expect(filas).toBe(1);
    });
  });
});
