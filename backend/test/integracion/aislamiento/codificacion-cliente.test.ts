// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { conClienteComo, ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import {
  crearDatosDeAislamiento,
  leerAcademias,
  leerAuditoriaPlataforma,
  type DatosDeAislamiento,
} from '../../utilidades/datos';
import { obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';
import { cookieDeSesion } from '../../utilidades/superadmins';

// Criterio 146 (ataque ronda 9, F2; AMPLIA los criterios 107 y 122 y la excepcion de cli/ de los criterios 107 y 121; decision del orquestador):
// `@prisma/adapter-pg` y `pg` envian y leen el texto siempre en UTF-8; con otra `client_encoding` en la sesion, PostgreSQL convierte lo que recibe
// como si viniera en esa codificacion (en la ronda 9, tras un `set_config('client_encoding', 'LATIN1', false)` dejado en la conexion, `Ñandú` se
// guardo como `ÃandÃº`, y la misma conexion lo leia bien porque la conversion de vuelta lo deshacia). Por eso toda transaccion de `BaseDatos`
// (`conAcademia`, `comoPlataforma`, `resolverAcademia` y la de la comprobacion del rol) y de `enPlataforma` fija `client_encoding` en `UTF8`, local a
// la transaccion (`pg_catalog.set_config('client_encoding', 'UTF8', true)`), en la misma primera sentencia, antes de `trabajo`; dentro de `trabajo`,
// `current_setting('client_encoding')` es `UTF8`. La primera sentencia y sus parametros tienen solo caracteres ASCII.
//
// Prueba de integracion con la via (a) del criterio 107, con la API de pruebas en `DATABASE_POOL_MAX=1`: un `conAcademia(A, ...)` cuyo `trabajo`
// ejecuta `set_config('client_encoding', 'LATIN1', false)` y confirma; despues, en la misma conexion:
//   - un `conAcademia(B, ...)` inserta en `configuraciones` una fila con `valor` `{"nombre": "Ñandú"}`; dentro de ese `trabajo`,
//     `current_setting('client_encoding')` es `UTF8`; leida como duenio con una conexion nueva de `pg`, `valor->>'nombre'` es exactamente `Ñandú` y su
//     `octet_length` es 7;
//   - `POST /api/plataforma/academias` con el nombre `Academia Ñandú` responde 201 y, leido como duenio con una conexion nueva, el nombre guardado en
//     `academias` es exactamente `Academia Ñandú`, y tambien donde lo guarde su fila de `auditoria_plataforma` (por ejemplo,
//     `datos_despues->>'nombre'`), si lo guarda.
// La parte de los comandos (`enPlataforma`) esta en `backend/test/integracion/cli/contexto-comandos-ronda9.test.ts`. La via (b) (`options`) no
// aplica a este parametro: `pg` envia `client_encoding=UTF8` al abrir la conexion y eso manda sobre `options` (se comprueba abajo como premisa).

const AHORA = new Date('2026-11-12T15:00:00.000Z');
const NOMBRE = 'Ñandú';
const NOMBRE_ACADEMIA = 'Academia Ñandú';
const NOMBRE_CORTO = 'academia-nandu-r9';

describe('criterio 146: premisas de la contaminacion (solo PostgreSQL)', () => {
  it('criterio 146 (premisa): tras set_config(client_encoding, LATIN1, false) en la sesion, Ñandú llega como 7 caracteres y no como 5', async () => {
    const visto = await conClienteComo('app', async (cliente) => {
      await cliente.query("SELECT set_config('client_encoding', 'LATIN1', false)");
      const { rows } = await cliente.query(
        'SELECT char_length($1::text) AS caracteres, octet_length($1::text) AS bytes',
        [NOMBRE],
      );
      return rows[0] as { caracteres: number; bytes: number };
    });

    expect(visto.caracteres).toBe(7);
    expect(visto.bytes).toBe(11);
  });

  it('criterio 146 (premisa): con set_config(client_encoding, UTF8, true) en la transaccion, Ñandú llega como 5 caracteres y al terminar vuelve LATIN1', async () => {
    const visto = await conClienteComo('app', async (cliente) => {
      await cliente.query("SELECT set_config('client_encoding', 'LATIN1', false)");
      await cliente.query('BEGIN');
      await cliente.query("SELECT set_config('client_encoding', 'UTF8', true)");
      const { rows } = await cliente.query(
        "SELECT char_length($1::text) AS caracteres, current_setting('client_encoding') AS dentro",
        [NOMBRE],
      );
      await cliente.query('COMMIT');
      const despues = await cliente.query("SELECT current_setting('client_encoding') AS despues");
      return {
        ...(rows[0] as { caracteres: number; dentro: string }),
        despues: (despues.rows[0] as { despues: string }).despues,
      };
    });

    expect(visto).toEqual({ caracteres: 5, dentro: 'UTF8', despues: 'LATIN1' });
  });
});

describe('criterio 146: client_encoding en UTF8 en cada transaccion de BaseDatos, aunque un trabajo anterior lo dejo en LATIN1 en la misma conexion', () => {
  let datos: DatosDeAislamiento;
  let app: NestExpressApplication | undefined;
  let base: BaseDatosRonda3;

  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
    // Via (a): una sola conexion, contaminada por un `trabajo` anterior que confirma.
    app = await crearAppDePruebas({
      nivelRegistro: 'silent',
      variables: { DATABASE_POOL_MAX: '1' },
      ajustar: (constructor) => constructor.overrideProvider(RELOJ).useValue(new RelojFijo(AHORA)),
    });
    base = await obtenerBaseDatosRonda3(app);
    await base.conAcademia(datos.A.id, async (tx) => {
      await tx.cliente.$queryRaw`SELECT set_config('client_encoding', 'LATIN1', false)`;
    });
  });
  afterEach(async () => {
    await app?.close().catch(() => undefined);
    app = undefined;
  });

  it('criterio 146: dentro de conAcademia y de comoPlataforma, current_setting(client_encoding) es UTF8', async () => {
    const enAcademia = await base.conAcademia(datos.B.id, async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ valor: string }[]>`SELECT current_setting('client_encoding') AS valor`;
      return filas[0]?.valor;
    });
    const enPlataforma = await base.comoPlataforma(async (tx) => {
      const filas = await tx.cliente.$queryRaw<{ valor: string }[]>`SELECT current_setting('client_encoding') AS valor`;
      return filas[0]?.valor;
    });

    expect(enAcademia).toBe('UTF8');
    expect(enPlataforma).toBe('UTF8');
  });

  it('criterio 146: un conAcademia(B) guarda {"nombre": "Ñandú"} en configuraciones sin alterarlo (valor->>nombre es exactamente Ñandú y mide 7 bytes, leido con otra conexion)', async () => {
    const texto = JSON.stringify({ nombre: NOMBRE });

    const codificacionDentro = await base.conAcademia(datos.B.id, async (tx) => {
      await tx.cliente.$queryRaw`
        INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
        VALUES (${datos.B.id}::uuid, 'nombre_r9', ${texto}::jsonb, now())`;
      const filas = await tx.cliente.$queryRaw<{ valor: string }[]>`SELECT current_setting('client_encoding') AS valor`;
      return filas[0]?.valor;
    });

    expect(codificacionDentro, 'current_setting(client_encoding) dentro de trabajo').toBe('UTF8');
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT valor->>'nombre' AS nombre, octet_length(valor->>'nombre') AS bytes
         FROM configuraciones WHERE academia_id = $1::uuid AND clave = 'nombre_r9'`,
      [datos.B.id],
      { academiaId: datos.B.id },
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { nombre: string }).nombre).toBe(NOMBRE);
    expect(Number((rows[0] as { bytes: number }).bytes)).toBe(7);
  });

  it('criterio 146: POST /api/plataforma/academias con el nombre "Academia Ñandú" responde 201 y guarda el nombre exacto en academias y en su fila de auditoria_plataforma', async () => {
    const respuesta = await request((app as NestExpressApplication).getHttpServer())
      .post('/api/plataforma/academias')
      .set('Cookie', cookieDeSesion(datos.superadmin, AHORA))
      .send({ nombre: NOMBRE_ACADEMIA, nombreCorto: NOMBRE_CORTO });

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
    const academia = (await leerAcademias()).find((fila) => fila.nombre_corto === NOMBRE_CORTO);
    expect(academia?.nombre).toBe(NOMBRE_ACADEMIA);
    // Donde guarde el nombre su fila de auditoria_plataforma (por ejemplo, `datos_despues.nombre`), si lo guarda.
    const auditoria = (await leerAuditoriaPlataforma('ACADEMIA_CREADA')).filter(
      (fila) => fila.entidad_id === academia?.id,
    );
    expect(auditoria, 'ACADEMIA_CREADA queda en auditoria_plataforma (criterio 32)').toHaveLength(1);
    for (const fila of auditoria) {
      const despues = fila.datos_despues as { nombre?: unknown } | null;
      if (despues && typeof despues === 'object' && 'nombre' in despues) expect(despues.nombre).toBe(NOMBRE_ACADEMIA);
      expect(JSON.stringify(fila.datos_despues ?? null), 'texto alterado en la auditoria').not.toMatch(/Ã|�/);
    }
  });
});
