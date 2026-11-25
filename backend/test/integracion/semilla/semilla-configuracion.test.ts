import { telefonoAcademiaSchema } from '@aquagestion/contratos';
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerFilasConfiguracion } from '../../utilidades/configuracion';
import { leerAcademias } from '../../utilidades/datos';

// Spec 003, criterio 25: la semilla deja a `delfines` con un teléfono de ejemplo inventado y a `tiburones` sin configuración (valores por
// defecto), y se puede ejecutar dos veces sin duplicar ni fallar. Prueba no protegida. Desde la 007b (criterio 57) `delfines` también trae los
// datos de pago de ejemplo; su prueba propia está en `semilla-pago-007b.test.ts`.

const TIMEOUT = 120_000;
const CLAVES_DE_DATOS_DE_PAGO = [
  'transferencia_banco',
  'transferencia_cci',
  'transferencia_cuenta',
  'transferencia_titular',
  'yape_numero',
  'yape_titular',
];
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

describe('semilla: configuración de ejemplo (criterio 25)', () => {
  beforeEach(limpiarBase);

  it(
    'delfines queda con un teléfono válido (y los datos de pago de la 007b) y tiburones sin filas',
    async () => {
      const resultado = ejecutarComando('db:semilla', VARIABLES);

      expect(resultado.estado, resultado.salida).toBe(0);
      const filasDelfines = await leerFilasConfiguracion(await idDe('delfines'));
      expect(filasDelfines.map((fila) => fila.clave)).toEqual(['telefono', ...CLAVES_DE_DATOS_DE_PAGO]);
      const telefono = filasDelfines.find((fila) => fila.clave === 'telefono');
      expect(telefonoAcademiaSchema.parse(telefono?.valor)).toBe(telefono?.valor);
      expect(await leerFilasConfiguracion(await idDe('tiburones'))).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'repetirla no falla, no duplica y no pisa un teléfono que el administrador ya cambió',
    async () => {
      expect(ejecutarComando('db:semilla', VARIABLES).estado).toBe(0);
      const delfinesId = await idDe('delfines');
      await ejecutarComo(
        'propietario',
        `UPDATE configuraciones SET valor = '"(01) 555-0199"'::jsonb WHERE academia_id = $1::uuid AND clave = 'telefono'`,
        [delfinesId],
        { academiaId: delfinesId },
      );

      const segunda = ejecutarComando('db:semilla', VARIABLES);

      expect(segunda.estado, segunda.salida).toBe(0);
      const filas = await leerFilasConfiguracion(delfinesId);
      expect(filas).toHaveLength(1 + CLAVES_DE_DATOS_DE_PAGO.length);
      expect(filas.find((fila) => fila.clave === 'telefono')?.valor).toBe('(01) 555-0199');
      expect(await leerFilasConfiguracion(await idDe('tiburones'))).toEqual([]);
    },
    TIMEOUT,
  );
});
