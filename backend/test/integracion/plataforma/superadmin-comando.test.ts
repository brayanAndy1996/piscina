// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { JWT_SECRETO_PRUEBAS, crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando, existeElScript } from '../../utilidades/comandos';
import { leerAuditoriaPlataforma, leerSuperadmin } from '../../utilidades/datos';
import {
  CLAVE_SUPERADMIN_PRUEBAS,
  OTRA_CLAVE_SUPERADMIN_PRUEBAS,
  cookieDeSesion,
  crearSuperadminDePrueba,
} from '../../utilidades/superadmins';

const TIMEOUT = 90_000;
const CLAVE_NUEVA = 'Nueva-Clave-Segura-2026';

function comando(variables: Record<string, string | undefined>) {
  return ejecutarComando('plataforma:superadmin', variables);
}

async function filasDeSuperadmins(): Promise<{ id: string; correo: string; nombre: string; clave_hash: string }[]> {
  const { rows } = await ejecutarComo('propietario', 'SELECT id, correo, nombre, clave_hash FROM superadmins', [], {
    plataforma: true,
  });
  return rows as { id: string; correo: string; nombre: string; clave_hash: string }[];
}

describe('npm run plataforma:superadmin', () => {
  beforeEach(limpiarBase);

  describe('criterio 33: crear un superadmin', () => {
    it(
      'criterio 33: crea el superadmin con argon2id, version_token 0 e intentos_fallidos 0 y lo informa',
      async () => {
        const resultado = comando({
          SUPERADMIN_CORREO: '  Dueno@AquaGestion.TEST ',
          SUPERADMIN_NOMBRE: 'Dueño de la plataforma',
          SUPERADMIN_CLAVE: CLAVE_NUEVA,
        });

        expect(resultado.estado, resultado.salida).toBe(0);
        expect(resultado.salida).toContain('Superadmin creado: dueno@aquagestion.test');
        expect(resultado.salida).not.toContain(CLAVE_NUEVA);
        const filas = await filasDeSuperadmins();
        expect(filas).toHaveLength(1);
        expect(filas[0]).toMatchObject({ correo: 'dueno@aquagestion.test', nombre: 'Dueño de la plataforma' });
        expect(filas[0]?.clave_hash.startsWith('$argon2id$')).toBe(true);
        expect(filas[0]?.clave_hash).not.toContain(CLAVE_NUEVA);
        const fila = await leerSuperadmin(filas[0]?.id ?? '');
        expect(fila).toMatchObject({
          version_token: 0,
          intentos_fallidos: 0,
          bloqueado_hasta: null,
          ultimo_acceso: null,
        });
      },
      TIMEOUT,
    );

    it(
      'criterio 33: registra SUPERADMIN_CREADO con actor SISTEMA, sin ip y sin la clave ni su hash (criterio 32)',
      async () => {
        const resultado = comando({
          SUPERADMIN_CORREO: 'dueno@aquagestion.test',
          SUPERADMIN_NOMBRE: 'Dueño de la plataforma',
          SUPERADMIN_CLAVE: CLAVE_NUEVA,
        });
        expect(resultado.estado, resultado.salida).toBe(0);

        const [superadmin] = await filasDeSuperadmins();
        const auditoria = await leerAuditoriaPlataforma('SUPERADMIN_CREADO');
        expect(auditoria).toHaveLength(1);
        expect(auditoria[0]).toMatchObject({
          actor_tipo: 'SISTEMA',
          ip: null,
          entidad_id: superadmin?.id,
          datos_despues: { id: superadmin?.id, correo: 'dueno@aquagestion.test', nombre: 'Dueño de la plataforma' },
        });
        expect(auditoria[0]?.entidad).toMatch(/^superadmins?$/i);
        const todo = JSON.stringify(await leerAuditoriaPlataforma());
        expect(todo).not.toContain(CLAVE_NUEVA);
        expect(todo).not.toContain('argon2');
        expect(todo).not.toContain(superadmin?.clave_hash ?? 'sin-hash');
      },
      TIMEOUT,
    );

    it(
      'criterio 33: el hash creado sirve para iniciar sesión con esa clave',
      async () => {
        const resultado = comando({
          SUPERADMIN_CORREO: 'dueno@aquagestion.test',
          SUPERADMIN_NOMBRE: 'Dueño de la plataforma',
          SUPERADMIN_CLAVE: CLAVE_NUEVA,
        });
        expect(resultado.estado, resultado.salida).toBe(0);

        const app = await crearAppDePruebas();
        try {
          const respuesta = await request(app.getHttpServer())
            .post('/api/plataforma/sesion')
            .send({ correo: 'dueno@aquagestion.test', clave: CLAVE_NUEVA });
          expect(respuesta.status).toBe(200);
        } finally {
          await app.close();
        }
      },
      TIMEOUT,
    );
  });

  describe('criterio 34: restablecer la contraseña de un superadmin existente', () => {
    it(
      'criterio 34: reemplaza hash y nombre, limpia el bloqueo, incrementa version_token y lo informa',
      async () => {
        const existente = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test', nombre: 'Nombre viejo' });
        await ejecutarComo(
          'propietario',
          `UPDATE superadmins SET intentos_fallidos = 3, bloqueado_hasta = now() + interval '1 hour', version_token = 4
            WHERE id = $1::uuid`,
          [existente.id],
          { plataforma: true },
        );
        const antes = await leerSuperadmin(existente.id);

        const resultado = comando({
          SUPERADMIN_CORREO: ' DUENO@aquagestion.test ',
          SUPERADMIN_NOMBRE: 'Nombre nuevo',
          SUPERADMIN_CLAVE: CLAVE_NUEVA,
        });

        expect(resultado.estado, resultado.salida).toBe(0);
        expect(resultado.salida).toContain('Contraseña del superadmin restablecida: dueno@aquagestion.test');
        expect(resultado.salida).not.toContain(CLAVE_NUEVA);
        expect(await filasDeSuperadmins()).toHaveLength(1);
        const despues = await leerSuperadmin(existente.id);
        expect(despues).toMatchObject({ nombre: 'Nombre nuevo', intentos_fallidos: 0, bloqueado_hasta: null });
        expect(despues?.version_token).toBe((antes?.version_token ?? 0) + 1);
        expect(despues?.clave_hash).not.toBe(antes?.clave_hash);
        expect(despues?.clave_hash.startsWith('$argon2id$')).toBe(true);
      },
      TIMEOUT,
    );

    it(
      'criterio 34: registra SUPERADMIN_CLAVE_RESTABLECIDA con actor SISTEMA y sin ip',
      async () => {
        const existente = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });

        const resultado = comando({
          SUPERADMIN_CORREO: 'dueno@aquagestion.test',
          SUPERADMIN_NOMBRE: 'Nombre nuevo',
          SUPERADMIN_CLAVE: CLAVE_NUEVA,
        });
        expect(resultado.estado, resultado.salida).toBe(0);

        const auditoria = await leerAuditoriaPlataforma('SUPERADMIN_CLAVE_RESTABLECIDA');
        expect(auditoria).toHaveLength(1);
        expect(auditoria[0]).toMatchObject({
          actor_tipo: 'SISTEMA',
          ip: null,
          entidad_id: existente.id,
          datos_despues: { id: existente.id, correo: 'dueno@aquagestion.test', nombre: 'Nombre nuevo' },
        });
        expect(await leerAuditoriaPlataforma('SUPERADMIN_CREADO')).toHaveLength(0);
        expect(JSON.stringify(await leerAuditoriaPlataforma())).not.toContain(CLAVE_NUEVA);
      },
      TIMEOUT,
    );

    it(
      'criterio 34: las sesiones abiertas dejan de valer y la clave nueva entra',
      async () => {
        const existente = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });
        const app: NestExpressApplication = await crearAppDePruebas();
        try {
          const servidor = app.getHttpServer();
          const cookieVieja = cookieDeSesion(existente, new Date());
          const antes = await request(servidor).get('/api/plataforma/sesion').set('Cookie', cookieVieja);
          expect(antes.status).toBe(200);

          const resultado = comando({
            SUPERADMIN_CORREO: 'dueno@aquagestion.test',
            SUPERADMIN_NOMBRE: 'Nombre nuevo',
            SUPERADMIN_CLAVE: CLAVE_NUEVA,
          });
          expect(resultado.estado, resultado.salida).toBe(0);

          const despues = await request(servidor).get('/api/plataforma/sesion').set('Cookie', cookieVieja);
          expect(despues.status).toBe(401);
          const ingreso = await request(servidor)
            .post('/api/plataforma/sesion')
            .send({ correo: 'dueno@aquagestion.test', clave: CLAVE_NUEVA });
          expect(ingreso.status).toBe(200);
        } finally {
          await app.close();
        }
      },
      TIMEOUT,
    );
  });

  describe('criterio 35: entradas inválidas', () => {
    // Sin el script, `npm` también termina con código 1: sin esta comprobación las pruebas de abajo podrían pasar
    // por casualidad. La salida debe además nombrar la variable inválida, que `npm` por sí solo nunca imprime.
    it('criterio 35: el script plataforma:superadmin existe en package.json', () => {
      expect(
        existeElScript('plataforma:superadmin'),
        'Falta la funcionalidad de la 001: no existe el script plataforma:superadmin',
      ).toBe(true);
    });

    const VALIDAS = {
      SUPERADMIN_CORREO: 'dueno@aquagestion.test',
      SUPERADMIN_NOMBRE: 'Dueño de la plataforma',
      SUPERADMIN_CLAVE: CLAVE_NUEVA,
    };

    it.each([
      ['correo sin arroba', { SUPERADMIN_CORREO: 'no-es-un-correo' }, 'SUPERADMIN_CORREO'],
      [
        'correo de más de 254 caracteres',
        { SUPERADMIN_CORREO: `${'a'.repeat(60)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.test` },
        'SUPERADMIN_CORREO',
      ],
      ['correo faltante', { SUPERADMIN_CORREO: undefined }, 'SUPERADMIN_CORREO'],
      ['nombre de 2 caracteres', { SUPERADMIN_NOMBRE: 'Ab' }, 'SUPERADMIN_NOMBRE'],
      ['nombre de 101 caracteres', { SUPERADMIN_NOMBRE: 'n'.repeat(101) }, 'SUPERADMIN_NOMBRE'],
      ['nombre faltante', { SUPERADMIN_NOMBRE: undefined }, 'SUPERADMIN_NOMBRE'],
      ['clave de 11 caracteres', { SUPERADMIN_CLAVE: 'Clave-corta' }, 'SUPERADMIN_CLAVE'],
      ['clave de 129 caracteres', { SUPERADMIN_CLAVE: `Aa1-${'x'.repeat(125)}` }, 'SUPERADMIN_CLAVE'],
      ['clave faltante', { SUPERADMIN_CLAVE: undefined }, 'SUPERADMIN_CLAVE'],
    ])(
      'criterio 35: %s: termina con código 1, nombra la variable y no crea nada',
      async (_caso, cambio, variable) => {
        const variables = { ...VALIDAS, ...cambio };

        const resultado = comando(variables);

        expect(resultado.estado, resultado.salida).toBe(1);
        expect(resultado.salida).toContain(variable);
        expect(await filasDeSuperadmins()).toEqual([]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
        const clave = variables.SUPERADMIN_CLAVE;
        if (clave) expect(resultado.salida).not.toContain(clave);
      },
      TIMEOUT,
    );

    it(
      'criterio 35: con una entrada inválida no modifica un superadmin existente',
      async () => {
        const existente = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });
        const antes = await leerSuperadmin(existente.id);

        const resultado = comando({ ...VALIDAS, SUPERADMIN_CLAVE: 'Corta-1234' });

        expect(resultado.estado, resultado.salida).toBe(1);
        expect(resultado.salida).toContain('SUPERADMIN_CLAVE');
        expect(await leerSuperadmin(existente.id)).toEqual(antes);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
      TIMEOUT,
    );

    it(
      'criterio 35: un error de conexión no imprime la clave ni crea nada',
      async () => {
        const resultado = comando({
          ...VALIDAS,
          DATABASE_URL: 'postgresql://dueno:otra-clave-secreta@127.0.0.1:1/base_sin_uso',
        });

        expect(resultado.estado).not.toBe(0);
        expect(resultado.salida).not.toContain(CLAVE_NUEVA);
        expect(resultado.salida).not.toContain('otra-clave-secreta');
        expect(await filasDeSuperadmins()).toEqual([]);
      },
      TIMEOUT,
    );
  });

  describe('criterio 46: la clave no aparece en la salida del comando', () => {
    it(
      'criterio 46: ni al crear ni al restablecer, en la salida estándar ni en la de errores',
      () => {
        const primera = comando({
          SUPERADMIN_CORREO: 'dueno@aquagestion.test',
          SUPERADMIN_NOMBRE: 'Dueño de la plataforma',
          SUPERADMIN_CLAVE: CLAVE_NUEVA,
        });
        const segunda = comando({
          SUPERADMIN_CORREO: 'dueno@aquagestion.test',
          SUPERADMIN_NOMBRE: 'Dueño de la plataforma',
          SUPERADMIN_CLAVE: OTRA_CLAVE_SUPERADMIN_PRUEBAS,
        });

        expect(primera.estado, primera.salida).toBe(0);
        expect(segunda.estado, segunda.salida).toBe(0);
        for (const salida of [primera.salida, segunda.salida]) {
          for (const clave of [
            CLAVE_NUEVA,
            OTRA_CLAVE_SUPERADMIN_PRUEBAS,
            CLAVE_SUPERADMIN_PRUEBAS,
            JWT_SECRETO_PRUEBAS,
          ]) {
            expect(salida).not.toContain(clave);
          }
          expect(salida).not.toContain('$argon2');
        }
      },
      TIMEOUT,
    );
  });
});
