import { telefonoAcademiaSchema } from '@aquagestion/contratos';
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerFilasConfiguracion } from '../../utilidades/configuracion';
import { leerAcademias } from '../../utilidades/datos';

// Spec 003, criterio 25: la semilla deja a `delfines` con un teléfono de ejemplo inventado y a `tiburones` sin configuración (valores por
// defecto), y se puede ejecutar dos veces sin duplicar ni fallar. Prueba no protegida.

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

describe('semilla: configuración de ejemplo (criterio 25)', () => {
  beforeEach(limpiarBase);

  it(
    'delfines queda con un teléfono válido y tiburones sin filas',
    async () => {
      const resultado = ejecutarComando('db:semilla', VARIABLES);

      expect(resultado.estado, resultado.salida).toBe(0);
      const filasDelfines = await leerFilasConfiguracion(await idDe('delfines'));
      expect(filasDelfines.map((fila) => fila.clave)).toEqual(['telefono']);
      expect(telefonoAcademiaSchema.parse(filasDelfines[0]?.valor)).toBe(filasDelfines[0]?.valor);
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
      expect(filas).toHaveLength(1);
      expect(filas[0]?.valor).toBe('(01) 555-0199');
      expect(await leerFilasConfiguracion(await idDe('tiburones'))).toEqual([]);
    },
    TIMEOUT,
  );
});
