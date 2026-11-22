// spec: 006-caja (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, type RolPruebas } from '../../utilidades/base-datos';
import {
  AYER,
  type CajaDePrueba,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  type EscenarioCaja,
  filaEgresoValida,
  filaIngresoValida,
  insertarFilaCaja,
  insertarFilaCajaSinEsperar,
  leerMovimientos,
} from '../../utilidades/caja';
import { abrirRetenedor, conLimite, esperarEspera } from '../../utilidades/planes-clases';

// Criterio 6 (crítico, RN-17): un trigger BEFORE INSERT en `movimientos_caja` toma la fila de su caja con FOR SHARE y rechaza el movimiento
// con 23514 y la restricción `movimientos_caja_solo_caja_abierta` si la caja no está ABIERTA. Pruebas, como app y como dueño:
//   a) un INSERT directo en una caja CERRADA falla;
//   b) una transacción de la prueba cierra la caja (UPDATE ... SET estado = 'CERRADA') sin confirmar; otra inserta un movimiento directo, que
//      queda esperando (se comprueba con pg_blocking_pids, que sale de pg_locks); la prueba confirma; entonces el INSERT falla con 23514.
// La función del trigger es SECURITY INVOKER, sin valores propios distintos de `search_path` (criterio 124 de la 001). No comprueba el día:
// eso lo decide la API con `RELOJ` (criterio 20). Sin esperas fijas: el límite de seguridad solo evita que una prueba se cuelgue.

const ROLES: readonly RolPruebas[] = ['app', 'propietario'];
const RESTRICCION = 'movimientos_caja_solo_caja_abierta';

describe('criterio 6: el trigger de la caja cerrada', () => {
  let e: EscenarioCaja;
  let caja: CajaDePrueba;
  let alumnoId: string;

  beforeEach(async () => {
    e = await crearEscenarioDeCaja();
    alumnoId = (await crearAlumnoDeCaja(e.A.id)).id;
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
  });

  const ingreso = (numero = 1) => filaIngresoValida(caja.id, e.secretariaA.id, alumnoId, numero);
  const egreso = (numero = 1) => filaEgresoValida(caja.id, e.secretariaA.id, numero);
  const cerrarComoDueno = () =>
    ejecutarComo(
      'propietario',
      "UPDATE cajas SET estado = 'CERRADA' WHERE academia_id = $1::uuid AND id = $2::uuid",
      [e.A.id, caja.id],
      { academiaId: e.A.id },
    );

  describe('en el catálogo', () => {
    it('criterio 6: movimientos_caja tiene el trigger movimientos_caja_solo_caja_abierta, BEFORE INSERT por fila', async () => {
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT pg_catalog.pg_get_triggerdef(t.oid) AS definicion
           FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = 'public.movimientos_caja'::regclass AND NOT t.tgisinternal AND t.tgname = $1`,
        [RESTRICCION],
      );

      expect(rows).toHaveLength(1);
      const definicion = (rows[0] as { definicion: string }).definicion;
      expect(definicion).toMatch(/BEFORE INSERT ON (public\.)?movimientos_caja/);
      expect(definicion).toMatch(/FOR EACH ROW/);
      expect(definicion, 'solo INSERT: no es de UPDATE ni de DELETE').not.toMatch(/UPDATE|DELETE/);
    });

    it('criterio 6: la función del trigger es SECURITY INVOKER y no fija más valor propio que search_path (criterio 124 de la 001)', async () => {
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT p.prosecdef AS definer, p.proconfig AS config, n.nspname AS esquema
           FROM pg_catalog.pg_trigger t
           JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE t.tgrelid = 'public.movimientos_caja'::regclass AND NOT t.tgisinternal AND t.tgname = $1`,
        [RESTRICCION],
      );

      expect(rows).toHaveLength(1);
      const fila = rows[0] as { definer: boolean; config: string[] | null; esquema: string };
      expect(fila.definer, 'SECURITY INVOKER').toBe(false);
      expect(fila.esquema).toBe('public');
      for (const valor of fila.config ?? []) expect(valor).toMatch(/^search_path=/);
    });
  });

  describe.each(ROLES)('a) un INSERT directo en una caja CERRADA, como %s', (rol) => {
    it('criterio 6 a: un ingreso falla con 23514 y la restricción movimientos_caja_solo_caja_abierta', async () => {
      await cerrarComoDueno();

      await expect(insertarFilaCaja(rol, 'movimientos_caja', e.A.id, ingreso())).rejects.toMatchObject({
        code: '23514',
        constraint: RESTRICCION,
      });
      expect(await leerMovimientos(e.A.id)).toHaveLength(0);
    });

    it('criterio 6 a: un egreso falla con 23514 y la restricción movimientos_caja_solo_caja_abierta', async () => {
      await cerrarComoDueno();

      await expect(insertarFilaCaja(rol, 'movimientos_caja', e.A.id, egreso())).rejects.toMatchObject({
        code: '23514',
        constraint: RESTRICCION,
      });
      expect(await leerMovimientos(e.A.id)).toHaveLength(0);
    });

    it('criterio 6 a: con la caja ABIERTA el mismo INSERT se acepta (control)', async () => {
      await expect(insertarFilaCaja(rol, 'movimientos_caja', e.A.id, ingreso())).resolves.toBeDefined();
      await expect(insertarFilaCaja(rol, 'movimientos_caja', e.A.id, egreso(2))).resolves.toBeDefined();
    });

    it('criterio 6: el trigger no comprueba el día: en una caja ABIERTA de un día anterior el INSERT directo se acepta (lo decide la API)', async () => {
      await ejecutarComo(
        'propietario',
        "UPDATE cajas SET estado = 'CERRADA' WHERE academia_id = $1::uuid AND id = $2::uuid",
        [e.A.id, caja.id],
        { academiaId: e.A.id },
      );
      const deAyer = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });

      await expect(
        insertarFilaCaja(rol, 'movimientos_caja', e.A.id, filaEgresoValida(deAyer.id, e.secretariaA.id, 1)),
      ).resolves.toBeDefined();
    });
  });

  describe.each(ROLES)('b) la caja se cierra mientras el INSERT espera, como %s', (rol) => {
    it('criterio 6 b: el INSERT queda esperando la fila de la caja y, al confirmarse el cierre, falla con 23514', async () => {
      const retenedor = await abrirRetenedor(e.A.id);
      try {
        await retenedor.consultar(
          "UPDATE cajas SET estado = 'CERRADA' WHERE academia_id = $1::uuid AND id = $2::uuid",
          [e.A.id, caja.id],
        );
        const insercion = insertarFilaCajaSinEsperar(rol, 'movimientos_caja', e.A.id, ingreso());

        const espero = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [insercion],
          'el INSERT ni respondió ni quedó esperando la fila de la caja.',
        );
        expect(espero, 'el INSERT no esperó la fila de la caja: el trigger no la toma con FOR SHARE').toBe(true);
        await retenedor.liberar('COMMIT');

        await expect(
          conLimite(insercion.resultado, 'el INSERT no respondió tras confirmar el cierre'),
        ).rejects.toMatchObject({ code: '23514', constraint: RESTRICCION });
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
      expect(await leerMovimientos(e.A.id)).toHaveLength(0);
    });

    it('criterio 6 b: si la transacción de la prueba revierte el cierre, el INSERT que esperaba se acepta (control)', async () => {
      const retenedor = await abrirRetenedor(e.A.id);
      try {
        await retenedor.consultar(
          "UPDATE cajas SET estado = 'CERRADA' WHERE academia_id = $1::uuid AND id = $2::uuid",
          [e.A.id, caja.id],
        );
        const insercion = insertarFilaCajaSinEsperar(rol, 'movimientos_caja', e.A.id, egreso());

        const espero = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [insercion],
          'el INSERT ni respondió ni quedó esperando la fila de la caja.',
        );
        expect(espero).toBe(true);
        await retenedor.liberar('ROLLBACK');

        await expect(
          conLimite(insercion.resultado, 'el INSERT no respondió tras revertir el cierre'),
        ).resolves.toBeUndefined();
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });
  });
});
