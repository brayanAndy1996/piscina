// spec: 001-academias-aislamiento (pruebas protegidas)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAcademias, leerAuditoriaPlataforma } from '../../utilidades/datos';

// Criterio 78 (ataque ronda 1, O4) en la semilla: NODE_ENV, si esta definida (aunque sea vacia), debe ser exactamente
// development, test o production. Con cualquier otro valor, `npm run db:semilla` termina con codigo 1 sin escribir nada
// y con un mensaje que nombra NODE_ENV y los valores permitidos, sin mostrar el valor recibido. Si no esta definida, la
// semilla se comporta fuera de produccion.

const TIMEOUT = 120_000;
const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');
const CLAVE = 'clave-de-desarrollo-123';
const SUPERADMIN = {
  SUPERADMIN_CORREO: 'superadmin@aquagestion.test',
  SUPERADMIN_NOMBRE: 'Superadmin de desarrollo',
  SUPERADMIN_CLAVE: CLAVE,
};

async function superadmins(): Promise<{ id: string }[]> {
  const { rows } = await ejecutarComo('propietario', 'SELECT id FROM superadmins', [], { plataforma: true });
  return rows as { id: string }[];
}

/** La semilla con NODE_ENV ausente (no vacia): se quita de las variables del proceso hijo. */
function semillaSinNodeEnv(): { estado: number | null; salida: string } {
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL: urlPropietarioPruebas(),
    ...SUPERADMIN,
  };
  delete env['NODE_ENV'];
  const resultado = spawnSync('npm', ['run', '--silent', 'db:semilla'], {
    cwd: RAIZ,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 120_000,
  });
  return {
    estado: resultado.status,
    salida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}${resultado.error ? String(resultado.error) : ''}`,
  };
}

describe('criterio 78: la semilla y NODE_ENV', () => {
  beforeEach(limpiarBase);

  it.each([
    ['Production', 'Production'],
    ['PRODUCTION', 'PRODUCTION'],
    ['con un espacio al comienzo', ' production'],
    ['con un espacio al final', 'production '],
    ['prod', 'prod'],
    ['vacia', ''],
    ['un valor cualquiera', 'valor-raro-xyz'],
  ])(
    'criterio 78: con NODE_ENV %s termina con codigo 1, nombra NODE_ENV y los valores permitidos, y no escribe nada',
    async (_caso, valor) => {
      const resultado = ejecutarComando('db:semilla', { ...SUPERADMIN, NODE_ENV: valor });

      expect(resultado.estado, resultado.salida).toBe(1);
      expect(resultado.salida).toContain('NODE_ENV');
      expect(resultado.salida).toContain('development');
      expect(resultado.salida).toContain('test');
      expect(resultado.salida).toContain('production');
      expect(resultado.salida).not.toContain(CLAVE);
      if (valor === 'valor-raro-xyz') expect(resultado.salida).not.toContain(valor);
      expect(await leerAcademias()).toEqual([]);
      expect(await superadmins()).toEqual([]);
      expect(await leerAuditoriaPlataforma()).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'criterio 78: con NODE_ENV=development la semilla funciona',
    async () => {
      const resultado = ejecutarComando('db:semilla', { ...SUPERADMIN, NODE_ENV: 'development' });

      expect(resultado.estado, resultado.salida).toBe(0);
      expect(await leerAcademias()).toHaveLength(2);
      expect(await superadmins()).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'criterio 78: sin NODE_ENV (ausente) la semilla se comporta fuera de produccion y funciona',
    async () => {
      const resultado = semillaSinNodeEnv();

      expect(resultado.estado, resultado.salida).toBe(0);
      expect(await leerAcademias()).toHaveLength(2);
      expect(await superadmins()).toHaveLength(1);
    },
    TIMEOUT,
  );
});
