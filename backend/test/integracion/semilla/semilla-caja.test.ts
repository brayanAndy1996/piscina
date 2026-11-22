import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerCajas, leerCierres, leerMovimientos } from '../../utilidades/caja';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAcademias } from '../../utilidades/datos';
import { leerUsuarios } from '../../utilidades/usuarios';

// Spec 006, criterio 45 (verificación del revisor, prueba no protegida): la semilla deja a `delfines` con una caja de ejemplo cerrada en una
// fecha fija pasada (2026-11-02), abierta y cerrada por la secretaria de ejemplo, con un egreso y un cierre con un sobrante pequeño y su
// observación; ninguna caja abierta; `tiburones` sin cajas; y se puede ejecutar dos veces sin duplicar ni fallar.

const TIMEOUT = 120_000;
const VARIABLES = {
  SUPERADMIN_CORREO: 'superadmin@aquagestion.test',
  SUPERADMIN_NOMBRE: 'Superadmin de desarrollo',
  SUPERADMIN_CLAVE: 'clave-de-desarrollo-123',
};

async function idDe(nombreCorto: string): Promise<string> {
  const academia = (await leerAcademias()).find((fila) => fila.nombre_corto === nombreCorto);
  if (!academia) throw new Error(`Falta la academia ${nombreCorto}.`);
  return academia.id;
}

describe('semilla: caja de ejemplo (criterio 45)', () => {
  beforeEach(limpiarBase);

  it(
    'delfines queda con una caja cerrada del 2 de noviembre, con un egreso y un cierre con sobrante y observación; tiburones sin cajas',
    async () => {
      const resultado = ejecutarComando('db:semilla', VARIABLES);

      expect(resultado.estado, resultado.salida).toBe(0);
      const delfinesId = await idDe('delfines');
      const secretaria = (await leerUsuarios(delfinesId)).find((usuario) => usuario.rol === 'SECRETARIA');
      const cajas = await leerCajas(delfinesId);
      expect(cajas).toHaveLength(1);
      expect(cajas[0]).toMatchObject({ fecha: '2026-11-02', estado: 'CERRADA', monto_inicial: '100.00' });
      expect(cajas[0]?.abierta_por).toBe(secretaria?.id);
      expect(
        cajas.filter((caja) => caja.estado === 'ABIERTA'),
        'ninguna caja abierta',
      ).toHaveLength(0);
      const movimientos = await leerMovimientos(delfinesId);
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]).toMatchObject({ tipo: 'EGRESO', metodo: 'EFECTIVO', numero: 1, monto: '15.50' });
      const cierres = await leerCierres(delfinesId);
      expect(cierres).toHaveLength(1);
      expect(cierres[0]).toMatchObject({
        numero: 1,
        esperado_efectivo: '84.50',
        monto_declarado: '85.00',
        diferencia: '0.50',
        tardio: false,
        reabierto_en: null,
        cerrado_por: secretaria?.id,
      });
      expect(cierres[0]?.observacion).toBeTruthy();
      expect(await leerCajas(await idDe('tiburones')), 'tiburones queda sin cajas').toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'se puede ejecutar dos veces sin duplicar ni fallar',
    async () => {
      expect(ejecutarComando('db:semilla', VARIABLES).estado).toBe(0);
      const segunda = ejecutarComando('db:semilla', VARIABLES);

      expect(segunda.estado, segunda.salida).toBe(0);
      const delfinesId = await idDe('delfines');
      expect(await leerCajas(delfinesId)).toHaveLength(1);
      expect(await leerMovimientos(delfinesId)).toHaveLength(1);
      expect(await leerCierres(delfinesId)).toHaveLength(1);
    },
    TIMEOUT,
  );
});
