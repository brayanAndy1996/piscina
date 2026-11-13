import { verify } from '@node-rs/argon2';
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAcademias } from '../../utilidades/datos';

// Historia 002, criterio 45: la semilla crea un usuario por rol en `delfines` y un administrador en `tiburones` con el mismo DNI que
// el de `delfines` (D-28), con DNIs inventados, clave igual al DNI y cambio obligatorio; repetirla no duplica ni restablece claves, y
// la salida no muestra claves (la clave inicial es el DNI).

const TIMEOUT = 120_000;

interface UsuarioSembrado {
  id: string;
  dni: string;
  rol: string;
  clave_hash: string;
  debe_cambiar_clave: boolean;
  estado: string;
  version_token: number;
}

async function usuariosDe(nombreCorto: string): Promise<UsuarioSembrado[]> {
  const academia = (await leerAcademias()).find((fila) => fila.nombre_corto === nombreCorto);
  if (!academia) return [];
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT id, dni, rol::text AS rol, clave_hash, debe_cambiar_clave, estado::text AS estado, version_token
       FROM usuarios WHERE academia_id = $1::uuid ORDER BY rol::text, dni`,
    [academia.id],
    { academiaId: academia.id },
  );
  return rows as UsuarioSembrado[];
}

describe('npm run db:semilla: usuarios de ejemplo (criterio 45)', () => {
  beforeEach(limpiarBase);

  it(
    'crea un usuario por rol en delfines y un administrador en tiburones con el mismo DNI que el de delfines',
    async () => {
      const resultado = ejecutarComando('db:semilla', {});

      expect(resultado.estado, resultado.salida).toBe(0);
      const delfines = await usuariosDe('delfines');
      const tiburones = await usuariosDe('tiburones');
      expect(delfines.map((u) => u.rol).sort()).toEqual(['ADMIN', 'ALUMNO', 'ENTRENADOR', 'SECRETARIA']);
      expect(tiburones.map((u) => u.rol)).toEqual(['ADMIN']);
      for (const usuario of [...delfines, ...tiburones]) {
        expect(usuario.dni).toMatch(/^[0-9]{8}$/);
        expect(usuario.estado).toBe('ACTIVO');
        expect(usuario.debe_cambiar_clave).toBe(true);
        expect(usuario.version_token).toBe(0);
      }
      const adminDelfines = delfines.find((u) => u.rol === 'ADMIN');
      expect(tiburones[0]?.dni, 'la misma persona en dos academias es dos cuentas (D-28)').toBe(adminDelfines?.dni);
      expect(tiburones[0]?.id).not.toBe(adminDelfines?.id);
      expect(new Set(delfines.map((u) => u.dni)).size).toBe(4);
    },
    TIMEOUT,
  );

  it(
    'la clave de cada usuario es su DNI (hash argon2id) y la salida no muestra ni DNIs ni hashes',
    async () => {
      const resultado = ejecutarComando('db:semilla', {});

      expect(resultado.estado, resultado.salida).toBe(0);
      const usuarios = [...(await usuariosDe('delfines')), ...(await usuariosDe('tiburones'))];
      expect(usuarios).toHaveLength(5);
      for (const usuario of usuarios) {
        expect(usuario.clave_hash.startsWith('$argon2id$')).toBe(true);
        expect(await verify(usuario.clave_hash, usuario.dni)).toBe(true);
        expect(resultado.salida).not.toContain(usuario.dni);
        expect(resultado.salida).not.toContain(usuario.clave_hash);
      }
      expect(resultado.salida).toContain('Usuario de ejemplo creado: delfines, ADMIN');
      expect(resultado.salida).toContain('Usuario de ejemplo creado: tiburones, ADMIN');
    },
    TIMEOUT,
  );

  it(
    'repetirla no duplica usuarios ni restablece las claves ya cambiadas',
    async () => {
      expect(ejecutarComando('db:semilla', {}).estado).toBe(0);
      const antes = await usuariosDe('delfines');
      const admin = antes.find((u) => u.rol === 'ADMIN');
      const academia = (await leerAcademias()).find((fila) => fila.nombre_corto === 'delfines');
      await ejecutarComo(
        'propietario',
        `UPDATE usuarios SET clave_hash = 'hash-cambiado-por-el-usuario', debe_cambiar_clave = false WHERE id = $1::uuid`,
        [admin?.id],
        { academiaId: academia?.id },
      );

      const repetida = ejecutarComando('db:semilla', {});

      expect(repetida.estado, repetida.salida).toBe(0);
      expect(repetida.salida).toContain('El usuario de ejemplo ya existía: delfines, ADMIN');
      expect(repetida.salida).not.toContain('Usuario de ejemplo creado');
      const despues = await usuariosDe('delfines');
      expect(despues).toHaveLength(4);
      expect(despues.find((u) => u.rol === 'ADMIN')).toMatchObject({
        id: admin?.id,
        clave_hash: 'hash-cambiado-por-el-usuario',
        debe_cambiar_clave: false,
      });
      expect(await usuariosDe('tiburones')).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'con NODE_ENV=production no crea nada (ni usuarios)',
    async () => {
      const resultado = ejecutarComando('db:semilla', { NODE_ENV: 'production' });

      expect(resultado.estado, resultado.salida).toBe(1);
      expect(await usuariosDe('delfines')).toEqual([]);
      expect(await leerAcademias()).toEqual([]);
    },
    TIMEOUT,
  );
});
