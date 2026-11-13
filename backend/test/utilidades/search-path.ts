// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type TestContext } from 'vitest';
import request from 'supertest';
import { crearAppDePruebas } from './aplicacion';
import { cargarPrisma, crearDestinoDeRegistro, esperarHasta } from './modulos';
import { ejecutarComo, limpiarBase } from './base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from './datos';
import { intentar } from './ronda3';
import {
  APP,
  RUTA_FIJA,
  SEARCH_PATH_1,
  SEARCH_PATH_2,
  borrarTrampa,
  crearApiContaminada,
  crearTrampa,
  detectarCapacidades,
  hashDeLaClaveDelAtacante,
  limpiarRestos,
  motivoParaOmitir,
  sinEspacios,
  type ApiContaminada,
  type Capacidades,
  type Contaminado,
  type Via,
} from './ronda5';

// Criterio 121 (ataque ronda 5, F2 (a) y (c); complementa los criterios 72, 98 y 107): toda transaccion de `BaseDatos`
// (`conAcademia`, `comoPlataforma` y `resolverAcademia`) y de `enPlataforma` fija `search_path` en `pg_catalog, public, pg_temp`,
// local a la transaccion, en la misma primera sentencia que fija el contexto, y llama a cada funcion con `pg_catalog.` porque
// PostgreSQL interpreta esa sentencia con el `search_path` que trae la conexion. Las consultas de la comprobacion del rol
// tambien corren en una transaccion que empieza con esa primera sentencia y califican con `pg_catalog.`.
//
// Prueba de integracion (como la del criterio 107), con la API en DATABASE_POOL_MAX=1 y una API nueva por via. El dueno crea un
// esquema `trampa` (si no puede crear esquemas, se omite con aviso), del que la app no es duena ni tiene CREATE, con USAGE para la
// app; dentro, tablas `trampa.academias` y `trampa.superadmins` con las mismas columnas y filas falsas (la academia A, suspendida
// en `public`, como ACTIVA; el correo del superadmin con el hash de una clave del atacante), con SELECT concedido a la app; y
// funciones `trampa.set_config(text, text, boolean)` (devuelve su segundo argumento sin fijar nada) y
// `trampa.has_table_privilege(name, oid, text)` (devuelve false). Vias de contaminacion de `search_path` a
// `trampa, pg_catalog, public` y a `"$user", trampa, pg_catalog, public`: (a) un `trabajo` anterior en la misma conexion con
// `set_config('search_path', ..., false)`; (b) `options` en DATABASE_URL_APP; (c) `ALTER DATABASE <base de pruebas> SET search_path`
// (si el dueno puede; si no, se omite con aviso); (d) `ALTER ROLE ALL [IN DATABASE ...] SET search_path` (solo superusuario: se
// omite con aviso en la nube). Todo se restaura al final, tambien si la prueba falla. Entonces:
//   - dentro de `trabajo`, current_setting('search_path') es el fijo y, en conAcademia(B, ...), current_setting('app.academia_id',
//     true) es el id de B (no se uso la `set_config` falsa);
//   - conAcademia(A, ...) rechaza con ErrorAcademiaSuspendida y GET /api/a/{nombre corto de A} responde 403;
//   - POST /api/plataforma/sesion con la clave del atacante responde 401 y con la real, 200;
//   - con las vias (b) y (c) y ademas GRANT TRUNCATE ON auditoria TO aquagestion_app, una API nueva rechaza con
//     ErrorRolBaseDatosInseguro (no se uso la has_table_privilege falsa).
// Las vias (a) y (b) estan en backend/test/integracion/aislamiento/search-path.test.ts; las vias (c) y (d), que cambian valores
// compartidos con otras conexiones, en backend/test/integracion-aislada/search-path-servidor.test.ts (proyecto `backend-aislado`).
//
// ADAPTADO POR EL CRITERIO 130 (ataque ronda 6; ver "Impacto en especificaciones anteriores", ronda 6): con la comprobacion del rol en
// todos los esquemas, una API que se crea con `trampa` ya presente (con `USAGE` y `SELECT` para la app y objetos propios) rechazaria
// todo con `ErrorRolBaseDatosInseguro`, y los casos funcionales fallarian por una razon ajena a lo que comprueban. Sin quitar casos ni
// cambiar lo que comprueban:
//   - en los casos funcionales, la API se crea y pasa su primera comprobacion del rol (un `comoPlataforma` vacio; en la via (a), el
//     `trabajo` que contamina) ANTES de crear `trampa`. Asi el criterio 121 se prueba como segunda capa, en el escenario del riesgo
//     aceptado "comprobacion del rol una vez por proceso" (un esquema creado con la API ya en marcha);
//   - en el caso con `GRANT TRUNCATE ON auditoria`, que sigue creando la API con `trampa` presente, se exige ademas que el log del
//     rechazo nombre `auditoria` y `TRUNCATE` (con la `has_table_privilege` falsa de `trampa` no aparecerian), porque `trampa` sola ya
//     causa el rechazo. El registro de la primera aplicacion del proceso recibe el de todas las demas (nestjs-pino crea un unico
//     registrador por proceso), asi que una aplicacion inicial, creada y cerrada en `beforeAll`, fija el destino en memoria.

const CLAVE_DEL_ATACANTE = 'Clave-Del-Atacante-2026';
const NOMBRES = ['search_path'];

export interface ViaDeSearchPath {
  readonly titulo: string;
  readonly via: Via;
  readonly parametro: Contaminado;
  /** La via (b) y (c) tambien comprueban el rechazo por un privilegio de mas (el catalogo calificado). */
  readonly conPrivilegio: boolean;
}

export const VIAS_LOCALES: readonly ViaDeSearchPath[] = [
  {
    titulo: "(a) un trabajo anterior ejecuta set_config('search_path', 'trampa, pg_catalog, public', false)",
    via: 'sesion',
    parametro: SEARCH_PATH_1,
    conPrivilegio: false,
  },
  {
    titulo: `(a) un trabajo anterior ejecuta set_config('search_path', '"$user", trampa, pg_catalog, public', false)`,
    via: 'sesion',
    parametro: SEARCH_PATH_2,
    conPrivilegio: false,
  },
  {
    titulo: '(b) DATABASE_URL_APP lleva ?options=-c search_path=trampa,pg_catalog,public',
    via: 'url',
    parametro: SEARCH_PATH_1,
    conPrivilegio: true,
  },
  {
    titulo: '(b) DATABASE_URL_APP lleva ?options=-c search_path="$user",trampa,pg_catalog,public',
    via: 'url',
    parametro: SEARCH_PATH_2,
    conPrivilegio: true,
  },
];

export const VIAS_DEL_SERVIDOR: readonly ViaDeSearchPath[] = [
  {
    titulo: '(c) ALTER DATABASE <base> SET search_path TO trampa, pg_catalog, public',
    via: 'base',
    parametro: SEARCH_PATH_1,
    conPrivilegio: true,
  },
  {
    titulo: '(c) ALTER DATABASE <base> SET search_path TO "$user", trampa, pg_catalog, public',
    via: 'base',
    parametro: SEARCH_PATH_2,
    conPrivilegio: true,
  },
  {
    titulo: '(d) ALTER ROLE ALL SET search_path TO trampa, pg_catalog, public',
    via: 'roles',
    parametro: SEARCH_PATH_1,
    conPrivilegio: false,
  },
  {
    titulo: '(d) ALTER ROLE ALL IN DATABASE <base> SET search_path TO trampa, pg_catalog, public',
    via: 'roles-base',
    parametro: SEARCH_PATH_1,
    conPrivilegio: false,
  },
];

/** Registra los hooks y las pruebas del criterio 121 para las vias indicadas. */
export function registrarPruebasDeSearchPath(vias: readonly ViaDeSearchPath[]): void {
  let capacidades: Capacidades = { superusuario: false, alteraLaBase: false, creaEsquemas: false };
  let hashDelAtacante = '';
  const { destino, lineas } = crearDestinoDeRegistro();

  beforeAll(async () => {
    // La primera aplicacion del proceso fija el destino del registro para todas las demas (criterio 130, caso del TRUNCATE).
    const inicial = await crearAppDePruebas({ nivelRegistro: 'info', destinoRegistro: destino });
    await inicial.close();
    capacidades = await detectarCapacidades();
    if (vias.some((via) => via.via !== 'sesion' && via.via !== 'url')) {
      // Restos de una ejecucion anterior que murio a medias: se quitan antes de crear nada.
      await limpiarRestos(NOMBRES, capacidades).catch(() => undefined);
    }
    if (!capacidades.creaEsquemas) {
      console.warn(
        '[criterio 121] AVISO: el dueno de la base de pruebas no puede crear esquemas (CREATE sobre la base); estas pruebas se omiten. Corren en Docker y en la CI.',
      );
    }
    if (vias.some((via) => via.via === 'base') && !capacidades.alteraLaBase) {
      console.warn(
        '[criterio 121] AVISO: el dueno de la base de pruebas no puede ejecutar ALTER DATABASE ... SET; la via (c) se omite.',
      );
    }
    if (vias.some((via) => via.via === 'roles' || via.via === 'roles-base') && !capacidades.superusuario) {
      console.warn(
        '[criterio 121] AVISO: el dueno de la base de pruebas no es superusuario (nube); la via (d) ALTER ROLE ALL se omite. Corre en Docker y en la CI.',
      );
    }
  });
  afterAll(async () => {
    await borrarTrampa().catch(() => undefined);
    if (vias.some((via) => via.via !== 'sesion' && via.via !== 'url')) {
      await limpiarRestos(NOMBRES, capacidades).catch(() => undefined);
    }
  });

  describe.each(vias)('criterio 121: search_path contaminado $titulo', (variante) => {
    let datos: DatosDeAislamiento;
    let api: ApiContaminada | undefined;
    let omitida: string | undefined;

    beforeEach(async () => {
      omitida = motivoParaOmitir(variante.via, capacidades);
      if (omitida) return;
      await limpiarBase();
      datos = await crearDatosDeAislamiento();
      // La academia A esta suspendida en `public`; la fila falsa de `trampa.academias` dice ACTIVA.
      await ejecutarComo(
        'propietario',
        `UPDATE academias SET estado = 'SUSPENDIDA', motivo_suspension = 'Suspendida para la prueba', suspendida_en = now()
          WHERE id = $1::uuid`,
        [datos.A.id],
        { plataforma: true },
      );
      // (criterio 130) `trampa` ya no se crea aqui: se crea despues de la primera comprobacion del rol de la API (ver `iniciar`).
      hashDelAtacante ||= await hashDeLaClaveDelAtacante(CLAVE_DEL_ATACANTE);
    });
    afterEach(async () => {
      try {
        await api?.cerrar();
      } finally {
        api = undefined;
        if (!omitida) await borrarTrampa();
      }
    });

    async function iniciar(contexto: TestContext): Promise<ApiContaminada> {
      if (omitida) contexto.skip(omitida);
      api = await crearApiContaminada(variante.via, [variante.parametro]);
      // (criterio 130) Primera comprobacion del rol, todavia sin `trampa`; despues se crea la trampa con la API ya en marcha.
      await api.baseDatos.comoPlataforma(() => Promise.resolve('rol comprobado'));
      await crearTrampa(hashDelAtacante);
      return api;
    }

    it('criterio 121: dentro de conAcademia(B) y de comoPlataforma, current_setting(search_path) es pg_catalog, public, pg_temp y el contexto es el real', async (ctx) => {
      const { baseDatos } = await iniciar(ctx);

      const enAcademia = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ ruta: string; academia: string | null }[]>`
          SELECT current_setting('search_path') AS ruta, current_setting('app.academia_id', true) AS academia`;
        return filas[0];
      });
      const enPlataforma = await baseDatos.comoPlataforma(async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ ruta: string; plataforma: string | null }[]>`
          SELECT current_setting('search_path') AS ruta, current_setting('app.plataforma', true) AS plataforma`;
        return filas[0];
      });

      expect(sinEspacios(enAcademia?.ruta ?? '')).toBe(RUTA_FIJA);
      expect(enAcademia?.academia, 'se uso la set_config falsa en vez de pg_catalog.set_config').toBe(datos.B.id);
      expect(sinEspacios(enPlataforma?.ruta ?? '')).toBe(RUTA_FIJA);
      expect(enPlataforma?.plataforma, 'se uso la set_config falsa en vez de pg_catalog.set_config').toBe('si');
    });

    it('criterio 121: conAcademia(A) rechaza con ErrorAcademiaSuspendida y GET /api/a/{nombre corto de A} responde 403 (no se leyo trampa.academias)', async (ctx) => {
      const { ErrorAcademiaSuspendida } = await cargarPrisma();
      const { app, baseDatos } = await iniciar(ctx);

      const error = await intentar(() => baseDatos.conAcademia(datos.A.id, () => Promise.resolve('no')));
      const A = await request(app.getHttpServer()).get(`/api/a/${datos.A.nombreCorto}`);
      const B = await request(app.getHttpServer()).get(`/api/a/${datos.B.nombreCorto}`);

      expect(error, 'conAcademia(A) debia rechazar').toBeInstanceOf(ErrorAcademiaSuspendida);
      expect(A.status).toBe(403);
      expect(B.status).toBe(200);
    });

    it('criterio 121: POST /api/plataforma/sesion con la clave del atacante responde 401 y con la real, 200 (no se leyo trampa.superadmins)', async (ctx) => {
      const { app } = await iniciar(ctx);
      const entrar = (clave: string) =>
        request(app.getHttpServer()).post('/api/plataforma/sesion').send({ correo: datos.superadmin.correo, clave });

      const atacante = await entrar(CLAVE_DEL_ATACANTE);
      expect(atacante.status, 'la clave del atacante no debe entrar').toBe(401);
      expect(atacante.headers['set-cookie']).toBeUndefined();
      const real = await entrar(datos.superadmin.clave);
      expect(real.status).toBe(200);
    });

    if (variante.conPrivilegio) {
      it('criterio 121: con GRANT TRUNCATE ON auditoria TO aquagestion_app, una API nueva rechaza con ErrorRolBaseDatosInseguro (no se uso la has_table_privilege falsa) y el log nombra auditoria y TRUNCATE', async (ctx) => {
        if (omitida) ctx.skip(omitida);
        const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
        // Este caso crea la API con `trampa` presente (criterio 130: `trampa` sola ya causa el rechazo; por eso se exige el log).
        await crearTrampa(hashDelAtacante);
        await ejecutarComo('propietario', `GRANT TRUNCATE ON public.auditoria TO ${APP}`);
        const desde = lineas.length;
        try {
          api = await crearApiContaminada(variante.via, [variante.parametro]);
          const { baseDatos } = api;

          const errorPlataforma = await intentar(() => baseDatos.comoPlataforma(() => Promise.resolve('no')));
          const errorAcademia = await intentar(() => baseDatos.conAcademia(datos.B.id, () => Promise.resolve('no')));

          expect(errorPlataforma, 'comoPlataforma debia rechazar').toBeInstanceOf(ErrorRolBaseDatosInseguro);
          expect(errorAcademia, 'conAcademia debia rechazar').toBeInstanceOf(ErrorRolBaseDatosInseguro);

          await esperarHasta(() => lineas.slice(desde).some((linea) => linea.includes('DATABASE_URL_APP')));
          const errores = lineas
            .slice(desde)
            .map((linea) => JSON.parse(linea) as { level: number; msg?: string })
            .filter((registro) => registro.level >= 50 && registro.msg?.includes('DATABASE_URL_APP'));
          expect(errores.length, 'falta un registro de nivel error que nombre DATABASE_URL_APP').toBeGreaterThan(0);
          const texto = errores.map((registro) => registro.msg).join('\n');
          expect(texto, 'el registro no nombra auditoria (se uso la has_table_privilege falsa)').toContain('auditoria');
          expect(texto, 'el registro no nombra TRUNCATE (se uso la has_table_privilege falsa)').toContain('TRUNCATE');
        } finally {
          await api?.cerrar();
          api = undefined;
          await ejecutarComo('propietario', `REVOKE TRUNCATE ON public.auditoria FROM ${APP}`);
        }
      });
    }
  });
}
