// spec: 001-academias-aislamiento (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAcademias, leerAuditoriaPlataforma } from '../../utilidades/datos';
import { EN_BLANCO_DE_LA_SPEC, emojis } from '../../utilidades/textos-ronda2';

// Criterios 87 y 88 (ataque ronda 2, F5 y F6) en la semilla: `npm run db:semilla` valida SUPERADMIN_CORREO,
// SUPERADMIN_NOMBRE y SUPERADMIN_CLAVE con las mismas reglas que el comando `plataforma:superadmin` antes de escribir
// (textos visibles sin ignorables ni U+2800, longitudes por puntos de codigo); si no cumplen, termina con codigo 1, nombra la
// variable y no escribe nada (ni siquiera las academias de ejemplo).

const TIMEOUT = 120_000;
const VALIDAS = {
  SUPERADMIN_CORREO: 'superadmin@aquagestion.test',
  SUPERADMIN_NOMBRE: 'Superadmin de desarrollo',
  SUPERADMIN_CLAVE: 'clave-de-desarrollo-123',
};

async function superadmins(): Promise<{ id: string; nombre: string; clave_hash: string }[]> {
  const { rows } = await ejecutarComo('propietario', 'SELECT id, nombre, clave_hash FROM superadmins', [], {
    plataforma: true,
  });
  return rows as { id: string; nombre: string; clave_hash: string }[];
}

describe('criterios 87 y 88: la semilla valida los datos del superadmin como el comando', () => {
  beforeEach(limpiarBase);

  async function esperarRechazoSinEscribir(
    cambio: Record<string, string>,
    variable: 'SUPERADMIN_CORREO' | 'SUPERADMIN_NOMBRE' | 'SUPERADMIN_CLAVE',
  ): Promise<void> {
    const resultado = ejecutarComando('db:semilla', { ...VALIDAS, ...cambio });

    expect(resultado.estado, resultado.salida).toBe(1);
    expect(resultado.salida).toContain(variable);
    expect(resultado.salida).not.toContain(VALIDAS.SUPERADMIN_CLAVE);
    expect(await leerAcademias()).toEqual([]);
    expect(await superadmins()).toEqual([]);
    expect(await leerAuditoriaPlataforma()).toEqual([]);
  }

  it.each(EN_BLANCO_DE_LA_SPEC.slice(0, 3))(
    'criterio 87: SUPERADMIN_NOMBRE de %s termina con codigo 1, nombra la variable y no escribe nada',
    async (_caso, nombre) => {
      await esperarRechazoSinEscribir({ SUPERADMIN_NOMBRE: nombre }, 'SUPERADMIN_NOMBRE');
    },
    TIMEOUT,
  );

  it(
    'criterio 88: SUPERADMIN_CLAVE de 6 emojis (12 unidades UTF-16) termina con codigo 1, nombra la variable y no escribe nada',
    async () => {
      await esperarRechazoSinEscribir({ SUPERADMIN_CLAVE: emojis(6) }, 'SUPERADMIN_CLAVE');
    },
    TIMEOUT,
  );

  it(
    'criterio 88: SUPERADMIN_CLAVE de 129 emojis termina con codigo 1, nombra la variable y no escribe nada',
    async () => {
      await esperarRechazoSinEscribir({ SUPERADMIN_CLAVE: emojis(129) }, 'SUPERADMIN_CLAVE');
    },
    TIMEOUT,
  );

  it(
    'criterio 88: SUPERADMIN_NOMBRE de 101 emojis termina con codigo 1, nombra la variable y no escribe nada',
    async () => {
      await esperarRechazoSinEscribir({ SUPERADMIN_NOMBRE: emojis(101) }, 'SUPERADMIN_NOMBRE');
    },
    TIMEOUT,
  );

  it(
    'criterio 88: SUPERADMIN_CORREO de 255 caracteres termina con codigo 1, nombra la variable y no escribe nada',
    async () => {
      const dominio = '@aquagestion.test';
      await esperarRechazoSinEscribir(
        { SUPERADMIN_CORREO: `${'a'.repeat(255 - dominio.length)}${dominio}` },
        'SUPERADMIN_CORREO',
      );
    },
    TIMEOUT,
  );

  it(
    'criterio 88: SUPERADMIN_NOMBRE de 51 emojis y SUPERADMIN_CLAVE de 128 emojis son validos: la semilla crea el superadmin',
    async () => {
      const resultado = ejecutarComando('db:semilla', {
        ...VALIDAS,
        SUPERADMIN_NOMBRE: emojis(51),
        SUPERADMIN_CLAVE: emojis(128),
      });

      expect(resultado.estado, resultado.salida).toBe(0);
      expect(resultado.salida).not.toContain(emojis(128));
      const filas = await superadmins();
      expect(filas).toHaveLength(1);
      expect(filas[0]?.nombre).toBe(emojis(51));
      expect(filas[0]?.clave_hash.startsWith('$argon2id$')).toBe(true);
      expect(await leerAcademias()).toHaveLength(2);
    },
    TIMEOUT,
  );
});
