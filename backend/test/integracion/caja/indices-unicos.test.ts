// spec: 006-caja (pruebas protegidas)
// Actualizada por la 007 (spec 007-pagos, criterios 1, 3 y 5 y «Pruebas protegidas anteriores que amplía la 007a»): las utilidades de la 006 crean ahora el pago
// `CONFIRMADO` de todo ingreso con `pago_id` en la misma transacción. CAMBIO APROBADO POR EL ORQUESTADOR (no solo suma, DT-19): la prueba «en B se aceptan la
// misma clave, el mismo numero y el mismo pago_id que en A» quita la parte del `pago_id` (con la llave compuesta hacia `pagos` y `pagos.id` como llave primaria,
// el mismo pago no puede existir en las dos academias, criterio 3 de la 007) y quedan la de la clave y la del numero.
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RolPruebas } from '../../utilidades/base-datos';
import {
  actualizarFilasCaja,
  AYER,
  type CajaDePrueba,
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
  HOY,
  insertarFilaCaja,
  leerCajas,
  leerCierres,
  leerMovimientos,
} from '../../utilidades/caja';

// Criterio 5 (crítico, RN-17, D-04): dado un INSERT o UPDATE directo, falla con 23505: una segunda caja ABIERTA en la misma academia
// (`cajas_una_abierta_por_academia`, índice único parcial); una segunda caja con la misma `fecha` en la misma academia
// (`cajas_academia_id_fecha_key`, una caja por día, DR-1); la misma `clave_idempotencia` en dos cajas, dos egresos o dos cierres de la
// academia; dos movimientos con el mismo `numero` en una caja; dos movimientos con el mismo `pago_id` en la academia (un pago entra una sola
// vez a la caja); dos cierres con el mismo `numero` en una caja; y dos cierres vigentes (sin `reabierto_en`) en una caja. En B, los mismos
// valores se aceptan.

const ROLES: readonly RolPruebas[] = ['app', 'propietario'];

describe('criterio 5: índices únicos', () => {
  let e: EscenarioCaja;
  let A: { caja: CajaDePrueba; alumnoId: string };
  let B: { caja: CajaDePrueba; alumnoId: string };

  beforeEach(async () => {
    e = await crearEscenarioDeCaja();
    A = {
      caja: await crearCajaDePrueba(e.A.id, e.secretariaA.id),
      alumnoId: (await crearAlumnoDeCaja(e.A.id)).id,
    };
    B = {
      caja: await crearCajaDePrueba(e.B.id, e.secretariaB.id),
      alumnoId: (await crearAlumnoDeCaja(e.B.id)).id,
    };
  });

  const motivo = {
    reabierto_por: '',
    reabierto_en: enLima(HOY, '19:00'),
    motivo_reapertura: 'Reapertura de la prueba',
  };
  /** Las columnas de un cierre que ya se reabrió (no es el vigente). */
  const reabierto = (): Columnas => ({ ...motivo, reabierto_por: e.adminA.id });

  describe.each(ROLES)('cajas, como %s', (rol) => {
    it('criterio 5: una segunda caja ABIERTA en la misma academia falla con 23505 (cajas_una_abierta_por_academia)', async () => {
      const otra = filaCajaValida(e.secretariaA.id, { fecha: AYER, estado: 'ABIERTA' });

      await expect(insertarFilaCaja(rol, 'cajas', e.A.id, otra)).rejects.toMatchObject({
        code: '23505',
        constraint: 'cajas_una_abierta_por_academia',
      });
      expect(await leerCajas(e.A.id)).toHaveLength(1);
    });

    it('criterio 5: una segunda caja con la misma fecha en la misma academia falla con 23505 (cajas_academia_id_fecha_key)', async () => {
      const otra = filaCajaValida(e.secretariaA.id, { fecha: HOY, estado: 'CERRADA' });

      await expect(insertarFilaCaja(rol, 'cajas', e.A.id, otra)).rejects.toMatchObject({
        code: '23505',
        constraint: 'cajas_academia_id_fecha_key',
      });
    });

    it('criterio 5: la misma clave_idempotencia en dos cajas de la academia falla con 23505', async () => {
      const otra = filaCajaValida(e.secretariaA.id, {
        fecha: AYER,
        estado: 'CERRADA',
        clave_idempotencia: A.caja.claveIdempotencia,
      });

      await expect(insertarFilaCaja(rol, 'cajas', e.A.id, otra)).rejects.toMatchObject({ code: '23505' });
    });

    it('criterio 5: en B se aceptan la misma fecha y la misma clave de A, y B tiene su propia caja abierta aunque A tenga la suya', async () => {
      // La caja de B ya existe con la misma fecha; otra academia puede repetir la clave de A en una fecha distinta.
      const deB = filaCajaValida(e.secretariaB.id, {
        fecha: AYER,
        estado: 'CERRADA',
        clave_idempotencia: A.caja.claveIdempotencia,
      });

      await expect(insertarFilaCaja(rol, 'cajas', e.B.id, deB)).resolves.toBeDefined();
      expect((await leerCajas(e.B.id)).map((c) => c.fecha)).toEqual([AYER, HOY]);
      expect(B.caja.fecha, 'la caja de B es de la misma fecha que la de A').toBe(A.caja.fecha);
    });
  });

  describe('cajas: UPDATE', () => {
    it('criterio 5: pasar a ABIERTA una caja cerrada cuando otra está abierta falla con 23505 (cajas_una_abierta_por_academia)', async () => {
      const cerrada = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER, estado: 'CERRADA' });

      await expect(
        actualizarFilasCaja('app', 'cajas', e.A.id, { id: cerrada.id }, { estado: 'ABIERTA' }),
      ).rejects.toMatchObject({ code: '23505', constraint: 'cajas_una_abierta_por_academia' });
      expect((await leerCajas(e.A.id)).filter((caja) => caja.estado === 'ABIERTA')).toHaveLength(1);
    });

    it('criterio 5: cambiar la fecha o la clave de una caja a las de otra de la academia falla con 23505 (como dueño)', async () => {
      const otra = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER, estado: 'CERRADA' });

      await expect(
        actualizarFilasCaja(
          'propietario',
          'cajas',
          e.A.id,
          { id: otra.id },
          { clave_idempotencia: A.caja.claveIdempotencia },
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe.each(ROLES)('movimientos_caja, como %s', (rol) => {
    const ingreso = (numero: number, sobre: Columnas = {}) =>
      filaIngresoValida(A.caja.id, e.secretariaA.id, A.alumnoId, numero, sobre);
    const egreso = (numero: number, sobre: Columnas = {}) =>
      filaEgresoValida(A.caja.id, e.secretariaA.id, numero, sobre);
    const insertar = (fila: Columnas) => insertarFilaCaja(rol, 'movimientos_caja', e.A.id, fila);

    it('criterio 5: la misma clave_idempotencia en dos egresos de la academia falla con 23505', async () => {
      const clave = randomUUID();
      await insertar(egreso(1, { clave_idempotencia: clave }));

      await expect(insertar(egreso(2, { clave_idempotencia: clave }))).rejects.toMatchObject({ code: '23505' });
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });

    it('criterio 5: dos movimientos con el mismo numero en una caja fallan con 23505', async () => {
      await insertar(ingreso(1));

      await expect(insertar(ingreso(1))).rejects.toMatchObject({ code: '23505' });
      await expect(insertar(egreso(1))).rejects.toMatchObject({ code: '23505' });
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });

    it('criterio 5: dos movimientos con el mismo pago_id en la academia fallan con 23505 (un pago entra una sola vez)', async () => {
      const pago = randomUUID();
      await insertar(ingreso(1, { pago_id: pago }));

      await expect(insertar(ingreso(2, { pago_id: pago, metodo: 'YAPE' }))).rejects.toMatchObject({ code: '23505' });
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });

    it('criterio 5: en B se aceptan la misma clave y el mismo numero que en A', async () => {
      const clave = randomUUID();
      await insertar(egreso(1, { clave_idempotencia: clave }));
      await insertar(ingreso(2));

      await expect(
        insertarFilaCaja(
          rol,
          'movimientos_caja',
          e.B.id,
          filaEgresoValida(B.caja.id, e.secretariaB.id, 1, { clave_idempotencia: clave }),
        ),
      ).resolves.toBeDefined();
      await expect(
        insertarFilaCaja(
          rol,
          'movimientos_caja',
          e.B.id,
          filaIngresoValida(B.caja.id, e.secretariaB.id, B.alumnoId, 2),
        ),
      ).resolves.toBeDefined();
    });

    it('criterio 5: movimientos distintos (otro número, otra clave, otro pago) se aceptan (control)', async () => {
      await insertar(ingreso(1));
      await insertar(egreso(2));

      await expect(insertar(ingreso(3))).resolves.toBeDefined();
      await expect(insertar(egreso(4))).resolves.toBeDefined();
    });
  });

  describe.each(ROLES)('cierres_caja, como %s', (rol) => {
    const cierre = (numero: number, sobre: Columnas = {}) =>
      filaCierreValida(A.caja.id, e.secretariaA.id, {}, { numero, ...sobre });
    const insertar = (fila: Columnas) => insertarFilaCaja(rol, 'cierres_caja', e.A.id, fila);

    it('criterio 5: dos cierres con el mismo numero en una caja fallan con 23505', async () => {
      await insertar(cierre(1, reabierto()));

      await expect(insertar(cierre(1))).rejects.toMatchObject({ code: '23505' });
      expect(await leerCierres(e.A.id)).toHaveLength(1);
    });

    it('criterio 5: la misma clave_idempotencia en dos cierres de la academia falla con 23505', async () => {
      const clave = randomUUID();
      await insertar(cierre(1, { ...reabierto(), clave_idempotencia: clave }));

      await expect(insertar(cierre(2, { clave_idempotencia: clave }))).rejects.toMatchObject({ code: '23505' });
    });

    it('criterio 5: dos cierres vigentes (sin reabierto_en) en una caja fallan con 23505 (cierres_caja_un_vigente_por_caja)', async () => {
      await insertar(cierre(1));

      await expect(insertar(cierre(2))).rejects.toMatchObject({
        code: '23505',
        constraint: 'cierres_caja_un_vigente_por_caja',
      });
      expect(await leerCierres(e.A.id)).toHaveLength(1);
    });

    it('criterio 5: un cierre reabierto y uno vigente en la misma caja se aceptan (control: la caja que se reabre y se cierra de nuevo)', async () => {
      await insertar(cierre(1, reabierto()));

      await expect(insertar(cierre(2))).resolves.toBeDefined();
      expect((await leerCierres(e.A.id)).map((c) => c.numero)).toEqual([1, 2]);
    });

    it('criterio 5: en B se aceptan el mismo numero y la misma clave que en A', async () => {
      const clave = randomUUID();
      await insertar(cierre(1, { clave_idempotencia: clave }));

      await expect(
        insertarFilaCaja(
          rol,
          'cierres_caja',
          e.B.id,
          filaCierreValida(B.caja.id, e.secretariaB.id, {}, { numero: 1, clave_idempotencia: clave }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('cierres_caja: UPDATE', () => {
    it('criterio 5: quitar la reapertura de un cierre cuando hay otro vigente en la caja falla con 23505', async () => {
      const primero = cierre1();
      await insertarFilaCaja('propietario', 'cierres_caja', e.A.id, primero);
      await insertarFilaCaja(
        'propietario',
        'cierres_caja',
        e.A.id,
        filaCierreValida(A.caja.id, e.secretariaA.id, {}, { numero: 2 }),
      );

      await expect(
        actualizarFilasCaja(
          'propietario',
          'cierres_caja',
          e.A.id,
          { id: primero['id'] },
          { reabierto_por: null, reabierto_en: null, motivo_reapertura: null },
        ),
      ).rejects.toMatchObject({ code: '23505', constraint: 'cierres_caja_un_vigente_por_caja' });
    });

    function cierre1(): Columnas {
      return filaCierreValida(A.caja.id, e.secretariaA.id, {}, { numero: 1, ...reabierto() });
    }
  });
});
