import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAcademias, leerAuditoriaPlataforma } from '../../utilidades/datos';

const TIMEOUT = 120_000;
const CLAVE = 'clave-de-desarrollo-123';
const SUPERADMIN = {
  SUPERADMIN_CORREO: 'Superadmin@AquaGestion.test',
  SUPERADMIN_NOMBRE: 'Superadmin de desarrollo',
  SUPERADMIN_CLAVE: CLAVE,
};

function semilla(variables: Record<string, string | undefined> = SUPERADMIN) {
  return ejecutarComando('db:semilla', variables);
}

async function superadmins(): Promise<{ id: string; correo: string; nombre: string; clave_hash: string }[]> {
  const { rows } = await ejecutarComo('propietario', 'SELECT id, correo, nombre, clave_hash FROM superadmins', [], {
    plataforma: true,
  });
  return rows as { id: string; correo: string; nombre: string; clave_hash: string }[];
}

// Criterio 61: la semilla de desarrollo.
describe('npm run db:semilla', () => {
  beforeEach(limpiarBase);

  it(
    'criterio 61: crea las academias delfines y tiburones activas y el superadmin, y resume sin la clave',
    async () => {
      const resultado = semilla();

      expect(resultado.estado, resultado.salida).toBe(0);
      expect(resultado.salida).toContain('Academia de ejemplo creada: delfines');
      expect(resultado.salida).toContain('Academia de ejemplo creada: tiburones');
      expect(resultado.salida).toContain('Superadmin de desarrollo creado: superadmin@aquagestion.test');
      expect(resultado.salida).not.toContain(CLAVE);
      const academias = await leerAcademias();
      expect(academias.map((academia) => [academia.nombre_corto, academia.nombre, academia.estado])).toEqual([
        ['delfines', 'Academia de Natación Los Delfines', 'ACTIVA'],
        ['tiburones', 'Club de Natación Tiburones', 'ACTIVA'],
      ]);
      const filas = await superadmins();
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ correo: 'superadmin@aquagestion.test', nombre: 'Superadmin de desarrollo' });
      expect(filas[0]?.clave_hash.startsWith('$argon2id$')).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'criterio 61: repetirla no falla, no duplica y no modifica lo que ya existe (ni restablece la clave)',
    async () => {
      expect(semilla().estado).toBe(0);
      await ejecutarComo(
        'propietario',
        `UPDATE academias SET nombre = 'Nombre cambiado' WHERE nombre_corto = 'delfines'`,
        [],
        {
          plataforma: true,
        },
      );
      const antes = await superadmins();

      const repetida = semilla({ ...SUPERADMIN, SUPERADMIN_CLAVE: 'otra-clave-distinta-456' });

      expect(repetida.estado, repetida.salida).toBe(0);
      expect(repetida.salida).toContain('La academia de ejemplo ya existía: delfines');
      expect(repetida.salida).toContain('La academia de ejemplo ya existía: tiburones');
      expect(repetida.salida).toContain('El superadmin de desarrollo ya existía: superadmin@aquagestion.test');
      expect(repetida.salida).not.toContain('otra-clave-distinta-456');
      const academias = await leerAcademias();
      expect(academias).toHaveLength(2);
      expect(academias.find((academia) => academia.nombre_corto === 'delfines')?.nombre).toBe('Nombre cambiado');
      expect(await superadmins()).toEqual(antes);
    },
    TIMEOUT,
  );

  it(
    'criterio 61: sin las variables SUPERADMIN_* crea las academias y avisa que no creó el superadmin',
    async () => {
      const resultado = semilla({});

      expect(resultado.estado, resultado.salida).toBe(0);
      expect(resultado.salida).toContain('Academia de ejemplo creada: delfines');
      expect(resultado.salida).toContain('No se creó el superadmin de desarrollo');
      expect(await leerAcademias()).toHaveLength(2);
      expect(await superadmins()).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'criterio 61: con NODE_ENV=production termina con código 1 sin escribir nada',
    async () => {
      const resultado = semilla({ ...SUPERADMIN, NODE_ENV: 'production' });

      expect(resultado.estado, resultado.salida).toBe(1);
      expect(resultado.salida).not.toContain(CLAVE);
      expect(await leerAcademias()).toEqual([]);
      expect(await superadmins()).toEqual([]);
      expect(await leerAuditoriaPlataforma()).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'criterio 61: con SUPERADMIN_* inválidas termina con código 1, nombra la variable y no escribe nada',
    async () => {
      const resultado = semilla({ ...SUPERADMIN, SUPERADMIN_CLAVE: 'corta' });

      expect(resultado.estado, resultado.salida).toBe(1);
      expect(resultado.salida).toContain('SUPERADMIN_CLAVE');
      expect(await leerAcademias()).toEqual([]);
      expect(await superadmins()).toEqual([]);
    },
    TIMEOUT,
  );
});
