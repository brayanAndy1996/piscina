// spec: 001-academias-aislamiento (pruebas protegidas)
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { deflateSync, gzipSync } from 'node:zlib';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerAcademias, leerAuditoriaPlataforma, leerSuperadmin } from '../../utilidades/datos';
import { sesionDeAcademia } from '../../utilidades/sesion-academia';
import {
  cookieDePlataforma,
  cookieDeSesion,
  crearSuperadminDePrueba,
  type SuperadminDePrueba,
} from '../../utilidades/superadmins';

// Criterio 89 (ataque ronda 2, O2): en cualquier ruta de /api con POST, PUT, PATCH o DELETE y cuerpo se admiten sin
// Content-Encoding o con un unico valor `identity`, `gzip` o `deflate` (sin distinguir mayusculas, con espacios en los
// extremos). Cualquier otro valor (`br`, `zstd`, `compress`, `x-gzip`, una lista como `gzip, identity`, o vacio) responde
// 400 SOLICITUD_INVALIDA con detalles.errores = [{ campo: '', mensaje }] y Cache-Control: no-store, sin interpretar el
// cuerpo; ninguna respuesta de /api es 415. Un cuerpo gzip o deflate corrupto responde 400 SOLICITUD_INVALIDA; el limite de
// 100 KB (102 400 bytes) se aplica al cuerpo DESCOMPRIMIDO: uno que, descomprimido, pasa de 102 400 bytes responde 413
// CARGA_EXCESIVA aunque comprimido sea pequeno. En POST /api/plataforma/sesion, todas estas respuestas cuentan para el limite
// por IP (criterio 75) y no calculan ningun hash ni cuentan un intento; un JSON valido comprimido con gzip se atiende como sin
// comprimir. En las rutas que exigen sesion, sin sesion valida sigue respondiendo 401 antes de mirar el cuerpo (P-7).

const AHORA = new Date('2026-11-11T15:00:00.000Z');
const CORREO = 'dueno@aquagestion.test';
const CLAVE = 'ClaveSegura-2026!';
const LIMITE_BYTES = 102_400;
const RUTA_SESION = '/api/plataforma/sesion';

interface RespuestaCruda {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface PeticionCruda {
  metodo?: string;
  ruta: string;
  cabeceras?: Record<string, string>;
  cuerpo?: Buffer | string;
}

interface ErrorCuerpo {
  codigo?: string;
  detalles?: { errores?: { campo: string; mensaje: string }[] };
}

async function escuchar(app: NestExpressApplication): Promise<number> {
  const servidor = app.getHttpServer();
  if (!servidor.listening) await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  return (servidor.address() as AddressInfo).port;
}

function analizarJson(texto: string): Record<string, unknown> {
  try {
    return texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Peticion HTTP con control total de las cabeceras y del cuerpo en bytes. Por defecto: POST con Content-Type JSON. */
async function enviar(app: NestExpressApplication, peticion: PeticionCruda): Promise<RespuestaCruda> {
  const port = await escuchar(app);
  const cabeceras: Record<string, string | number> = { 'Content-Type': 'application/json', ...peticion.cabeceras };
  if (peticion.cuerpo !== undefined) cabeceras['Content-Length'] = Buffer.byteLength(peticion.cuerpo);
  return new Promise((resolver, rechazar) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: peticion.metodo ?? 'POST', path: peticion.ruta, headers: cabeceras },
      (res) => {
        const trozos: Buffer[] = [];
        res.on('data', (trozo: Buffer) => trozos.push(trozo));
        res.on('end', () => {
          resolver({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: analizarJson(Buffer.concat(trozos).toString('utf8')),
          });
        });
      },
    );
    req.on('error', rechazar);
    if (peticion.cuerpo !== undefined) req.write(peticion.cuerpo);
    req.end();
  });
}

const JSON_SESION = JSON.stringify({ correo: CORREO, clave: CLAVE });
const JSON_SESION_CLAVE_EQUIVOCADA = JSON.stringify({ correo: CORREO, clave: 'clave-equivocada-123' });

/** JSON valido de inicio de sesion rellenado con espacios finales hasta ocupar exactamente `bytes` bytes. */
function jsonDeSesionDe(bytes: number, clave = CLAVE): Buffer {
  const base = JSON.stringify({ correo: CORREO, clave });
  return Buffer.from(base + ' '.repeat(bytes - Buffer.byteLength(base)));
}

function cabeceraNoStore(respuesta: RespuestaCruda): string {
  const valor = respuesta.headers['cache-control'];
  return Array.isArray(valor) ? valor.join(',') : (valor ?? '');
}

/** 400 SOLICITUD_INVALIDA con el formato del criterio 89 (sin cookie, sin 415). */
function esperarRechazoPorCodificacion(respuesta: RespuestaCruda): void {
  expect(respuesta.status).not.toBe(415);
  expect(respuesta.status).toBe(400);
  const cuerpo = respuesta.body as ErrorCuerpo;
  expect(cuerpo.codigo).toBe('SOLICITUD_INVALIDA');
  expect(cuerpo.detalles?.errores).toEqual([{ campo: '', mensaje: expect.any(String) as string }]);
  expect(cabeceraNoStore(respuesta)).toContain('no-store');
  expect(respuesta.headers['set-cookie']).toBeUndefined();
}

/** Codificaciones que NO se admiten: [valor de la cabecera]. */
const NO_ADMITIDAS = [
  'br',
  'BR',
  'zstd',
  'compress',
  'x-gzip',
  'gzip, identity',
  'identity, gzip',
  'deflate, gzip',
  '',
];

/** Codificaciones admitidas: [valor de la cabecera, funcion que codifica el cuerpo]. */
const ADMITIDAS: [string | undefined, (cuerpo: Buffer) => Buffer][] = [
  [undefined, (cuerpo) => cuerpo],
  ['identity', (cuerpo) => cuerpo],
  ['IDENTITY', (cuerpo) => cuerpo],
  ['gzip', (cuerpo) => gzipSync(cuerpo)],
  ['GZIP', (cuerpo) => gzipSync(cuerpo)],
  [' gzip ', (cuerpo) => gzipSync(cuerpo)],
  ['deflate', (cuerpo) => deflateSync(cuerpo)],
  ['Deflate', (cuerpo) => deflateSync(cuerpo)],
];

function cabecerasCon(codificacion: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  return codificacion === undefined ? { ...extra } : { 'Content-Encoding': codificacion, ...extra };
}

describe('criterio 89: POST /api/plataforma/sesion y Content-Encoding', () => {
  let app: NestExpressApplication;
  let superadmin: SuperadminDePrueba;

  // Una aplicacion nueva por caso: cada peticion a este endpoint cuenta para el limite de 10 por IP (criterio 75).
  beforeEach(async () => {
    await limpiarBase();
    superadmin = await crearSuperadminDePrueba({ correo: CORREO, clave: CLAVE });
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
  });
  afterEach(async () => {
    await app?.close();
  });

  async function esperarSuperadminIntacto(): Promise<void> {
    expect(await leerSuperadmin(superadmin.id)).toMatchObject({
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_acceso: null,
      version_token: 0,
    });
  }

  it.each(ADMITIDAS)(
    'criterio 89: Content-Encoding %j con un JSON valido inicia sesion como sin comprimir (200 con cookie)',
    async (codificacion, codificar) => {
      const respuesta = await enviar(app, {
        ruta: RUTA_SESION,
        cabeceras: cabecerasCon(codificacion),
        cuerpo: codificar(Buffer.from(JSON_SESION)),
      });

      expect(respuesta.status).toBe(200);
      expect(cookieDePlataforma(respuesta.headers)).toBeDefined();
    },
  );

  it.each(NO_ADMITIDAS)(
    'criterio 89: Content-Encoding %j con la clave correcta responde 400, no emite cookie y no cambia la cuenta',
    async (codificacion) => {
      const respuesta = await enviar(app, {
        ruta: RUTA_SESION,
        cabeceras: { 'Content-Encoding': codificacion },
        cuerpo: JSON_SESION,
      });

      esperarRechazoPorCodificacion(respuesta);
      await esperarSuperadminIntacto();
    },
  );

  it('criterio 89: cinco peticiones con una codificacion no admitida y la clave equivocada no cuentan intentos ni bloquean la cuenta', async () => {
    for (let i = 0; i < 5; i++) {
      const respuesta = await enviar(app, {
        ruta: RUTA_SESION,
        cabeceras: { 'Content-Encoding': 'br' },
        cuerpo: JSON_SESION_CLAVE_EQUIVOCADA,
      });
      esperarRechazoPorCodificacion(respuesta);
    }

    await esperarSuperadminIntacto();
    const valida = await enviar(app, { ruta: RUTA_SESION, cuerpo: JSON_SESION });
    expect(valida.status).toBe(200);
  });

  describe('cuerpos gzip o deflate corruptos', () => {
    it.each([
      ['gzip con bytes que no son gzip', 'gzip', Buffer.from('esto no es un cuerpo gzip')],
      ['deflate con bytes que no son deflate', 'deflate', Buffer.from('esto no es un cuerpo deflate')],
      ['gzip truncado a la mitad', 'gzip', gzipSync(Buffer.from(JSON_SESION)).subarray(0, 12)],
      ['deflate truncado', 'deflate', deflateSync(Buffer.from(JSON_SESION)).subarray(0, 6)],
      ['gzip con un cuerpo deflate', 'gzip', deflateSync(Buffer.from(JSON_SESION))],
      ['deflate con un cuerpo gzip', 'deflate', gzipSync(Buffer.from(JSON_SESION))],
      ['gzip con el JSON sin comprimir', 'gzip', Buffer.from(JSON_SESION)],
    ])(
      'criterio 89: %s responde 400 SOLICITUD_INVALIDA y no cuenta un intento',
      async (_caso, codificacion, cuerpo) => {
        const respuesta = await enviar(app, {
          ruta: RUTA_SESION,
          cabeceras: { 'Content-Encoding': codificacion },
          cuerpo,
        });

        esperarRechazoPorCodificacion(respuesta);
        await esperarSuperadminIntacto();
      },
    );
  });

  describe('el limite de 100 KB se aplica al cuerpo descomprimido', () => {
    it('criterio 89: un JSON valido de exactamente 102 400 bytes descomprimidos (gzip) se atiende (200)', async () => {
      const respuesta = await enviar(app, {
        ruta: RUTA_SESION,
        cabeceras: { 'Content-Encoding': 'gzip' },
        cuerpo: gzipSync(jsonDeSesionDe(LIMITE_BYTES)),
      });

      expect(respuesta.status).toBe(200);
    });

    it('criterio 89: un cuerpo gzip que descomprimido pasa de 102 400 bytes (102 401) responde 413 CARGA_EXCESIVA', async () => {
      const comprimido = gzipSync(jsonDeSesionDe(LIMITE_BYTES + 1));
      expect(comprimido.length).toBeLessThan(2000);

      const respuesta = await enviar(app, {
        ruta: RUTA_SESION,
        cabeceras: { 'Content-Encoding': 'gzip' },
        cuerpo: comprimido,
      });

      expect(respuesta.status).toBe(413);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CARGA_EXCESIVA');
      expect(cabeceraNoStore(respuesta)).toContain('no-store');
      expect(respuesta.headers['set-cookie']).toBeUndefined();
      await esperarSuperadminIntacto();
    });

    it('criterio 89: lo mismo con deflate', async () => {
      const respuesta = await enviar(app, {
        ruta: RUTA_SESION,
        cabeceras: { 'Content-Encoding': 'deflate' },
        cuerpo: deflateSync(jsonDeSesionDe(LIMITE_BYTES + 1)),
      });

      expect(respuesta.status).toBe(413);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CARGA_EXCESIVA');
    });

    it('criterio 89: una "bomba" de 5 MB descomprimidos en pocos bytes comprimidos responde 413 y no 400', async () => {
      const bomba = gzipSync(Buffer.from(JSON_SESION + ' '.repeat(5_000_000)));
      expect(bomba.length).toBeLessThan(20_000);

      const respuesta = await enviar(app, {
        ruta: RUTA_SESION,
        cabeceras: { 'Content-Encoding': 'gzip' },
        cuerpo: bomba,
      });

      expect(respuesta.status).toBe(413);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CARGA_EXCESIVA');
      await esperarSuperadminIntacto();
    });
  });

  describe('cuentan para el limite de 10 peticiones por IP (criterio 75)', () => {
    it('criterio 89: 10 peticiones con codificacion no admitida, gzip corrupto o demasiado grande agotan el limite y la valida recibe 429', async () => {
      const intentos: Array<() => Promise<RespuestaCruda>> = [
        ...['br', 'zstd', 'compress', 'x-gzip'].map(
          (codificacion) => () =>
            enviar(app, { ruta: RUTA_SESION, cabeceras: { 'Content-Encoding': codificacion }, cuerpo: JSON_SESION }),
        ),
        ...[1, 2, 3].map(
          () => () =>
            enviar(app, {
              ruta: RUTA_SESION,
              cabeceras: { 'Content-Encoding': 'gzip' },
              cuerpo: Buffer.from('esto no es gzip'),
            }),
        ),
        ...[1, 2, 3].map(
          () => () =>
            enviar(app, {
              ruta: RUTA_SESION,
              cabeceras: { 'Content-Encoding': 'gzip' },
              cuerpo: gzipSync(jsonDeSesionDe(LIMITE_BYTES + 1)),
            }),
        ),
      ];

      const estados: number[] = [];
      for (const intento of intentos) estados.push((await intento()).status);
      const valida = await enviar(app, { ruta: RUTA_SESION, cuerpo: JSON_SESION });

      expect(estados).toEqual([400, 400, 400, 400, 400, 400, 400, 413, 413, 413]);
      expect(valida.status).toBe(429);
      expect((valida.body as ErrorCuerpo).codigo).toBe('DEMASIADAS_SOLICITUDES');
      expect(cookieDePlataforma(valida.headers)).toBeUndefined();
      await esperarSuperadminIntacto();
    });

    it('criterio 89: pasado el limite, una codificacion no admitida responde 429 y no 400 (no se lee el cuerpo)', async () => {
      for (let i = 0; i < 10; i++) await enviar(app, { ruta: RUTA_SESION, cuerpo: '{"correo": ' });

      const respuesta = await enviar(app, {
        ruta: RUTA_SESION,
        cabeceras: { 'Content-Encoding': 'br' },
        cuerpo: JSON_SESION,
      });

      expect(respuesta.status).toBe(429);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('DEMASIADAS_SOLICITUDES');
    });
  });
});

describe('criterio 89: rutas protegidas y otras rutas de /api', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let superadmin: SuperadminDePrueba;
  let cookie: string;

  beforeAll(async () => {
    reloj = new RelojFijo(AHORA);
    app = await crearAppDePruebas({
      nivelRegistro: 'silent',
      ajustar: (constructor) => constructor.overrideProvider(RELOJ).useValue(reloj),
    });
  });
  beforeEach(async () => {
    await limpiarBase();
    reloj.fijar(AHORA);
    superadmin = await crearSuperadminDePrueba({ correo: CORREO });
    cookie = cookieDeSesion(superadmin, AHORA);
  });
  afterAll(async () => {
    await app?.close();
  });

  const CUERPO_ACADEMIA = JSON.stringify({ nombre: 'Academia de Natacion Los Delfines', nombreCorto: 'delfines' });

  describe('POST /api/plataforma/academias', () => {
    it.each(ADMITIDAS)(
      'criterio 89: con sesion y Content-Encoding %j la creacion funciona (201)',
      async (codificacion, codificar) => {
        const respuesta = await enviar(app, {
          ruta: '/api/plataforma/academias',
          cabeceras: cabecerasCon(codificacion, { Cookie: cookie }),
          cuerpo: codificar(Buffer.from(CUERPO_ACADEMIA)),
        });

        expect(respuesta.status).toBe(201);
        expect(await leerAcademias()).toHaveLength(1);
      },
    );

    it.each(NO_ADMITIDAS)(
      'criterio 89: con sesion y Content-Encoding %j responde 400 y no crea ni audita nada',
      async (codificacion) => {
        const respuesta = await enviar(app, {
          ruta: '/api/plataforma/academias',
          cabeceras: { 'Content-Encoding': codificacion, Cookie: cookie },
          cuerpo: CUERPO_ACADEMIA,
        });

        esperarRechazoPorCodificacion(respuesta);
        expect(await leerAcademias()).toEqual([]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
    );

    it('criterio 89: con sesion y un cuerpo gzip corrupto responde 400 y no crea nada', async () => {
      const respuesta = await enviar(app, {
        ruta: '/api/plataforma/academias',
        cabeceras: { 'Content-Encoding': 'gzip', Cookie: cookie },
        cuerpo: Buffer.from('esto no es gzip'),
      });

      esperarRechazoPorCodificacion(respuesta);
      expect(await leerAcademias()).toEqual([]);
    });

    it('criterio 89: con sesion y un cuerpo deflate que descomprimido pasa de 102 400 bytes responde 413 CARGA_EXCESIVA', async () => {
      const respuesta = await enviar(app, {
        ruta: '/api/plataforma/academias',
        cabeceras: { 'Content-Encoding': 'deflate', Cookie: cookie },
        cuerpo: deflateSync(Buffer.from(CUERPO_ACADEMIA + ' '.repeat(LIMITE_BYTES))),
      });

      expect(respuesta.status).toBe(413);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CARGA_EXCESIVA');
      expect(await leerAcademias()).toEqual([]);
    });

    it.each([
      ['br con el cuerpo sin comprimir', 'br', Buffer.from(CUERPO_ACADEMIA)],
      ['gzip corrupto', 'gzip', Buffer.from('esto no es gzip')],
      ['una lista de codificaciones', 'gzip, identity', gzipSync(Buffer.from(CUERPO_ACADEMIA))],
    ])(
      'criterio 89: sin sesion y %s responde 401 NO_AUTENTICADO antes de mirar el cuerpo',
      async (_caso, codificacion, cuerpo) => {
        const respuesta = await enviar(app, {
          ruta: '/api/plataforma/academias',
          cabeceras: { 'Content-Encoding': codificacion },
          cuerpo,
        });

        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
        expect(await leerAcademias()).toEqual([]);
      },
    );
  });

  describe('otros metodos y rutas', () => {
    it.each(['PUT', 'PATCH', 'DELETE'])(
      'criterio 89: %s con sesion, un cuerpo y Content-Encoding br responde 400',
      async (metodo) => {
        const respuesta = await enviar(app, {
          metodo,
          ruta: '/api/plataforma/academias/algo',
          cabeceras: { 'Content-Encoding': 'br', Cookie: cookie },
          cuerpo: '{}',
        });

        esperarRechazoPorCodificacion(respuesta);
      },
    );

    it.each([
      ['POST /api/salud', 'POST', '/api/salud'],
      ['POST /api/a/delfines', 'POST', '/api/a/delfines'],
      ['PUT /api/salud', 'PUT', '/api/salud'],
    ])(
      'criterio 89: %s con un cuerpo y Content-Encoding zstd responde 400 SOLICITUD_INVALIDA, no 415',
      async (_nombre, metodo, ruta) => {
        const respuesta = await enviar(app, {
          metodo,
          ruta,
          cabeceras: { 'Content-Encoding': 'zstd' },
          cuerpo: '{}',
        });

        expect(respuesta.status).not.toBe(415);
        expect(respuesta.status).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        expect((respuesta.body as ErrorCuerpo).detalles?.errores).toEqual([
          { campo: '', mensaje: expect.any(String) as string },
        ]);
      },
    );

    // Spec 002, criterio 18: `/api/no-existe` no es una ruta publica. Sin sesion responde 401 antes de leer el cuerpo; con una sesion de
    // academia valida el error del cuerpo se difiere hasta el permiso y, como la ruta no existe, responde 404 (nunca 415).
    it('criterio 89: POST /api/no-existe con un cuerpo y Content-Encoding zstd responde 401 sin sesion y 404 con sesion de academia, no 415', async () => {
      const sinSesion = await enviar(app, {
        metodo: 'POST',
        ruta: '/api/no-existe',
        cabeceras: { 'Content-Encoding': 'zstd' },
        cuerpo: '{}',
      });
      const { cookie: cookieAcademia } = await sesionDeAcademia(undefined, { ahora: AHORA });
      const conSesion = await enviar(app, {
        metodo: 'POST',
        ruta: '/api/no-existe',
        cabeceras: { 'Content-Encoding': 'zstd', Cookie: cookieAcademia },
        cuerpo: '{}',
      });

      expect(sinSesion.status).toBe(401);
      expect((sinSesion.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      expect(conSesion.status).toBe(404);
      expect((conSesion.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
    });

    it('criterio 89: DELETE /api/plataforma/sesion sin cuerpo con Content-Encoding br no se ve afectado (204)', async () => {
      const respuesta = await enviar(app, {
        metodo: 'DELETE',
        ruta: RUTA_SESION,
        cabeceras: { 'Content-Encoding': 'br', Cookie: cookie },
      });

      expect(respuesta.status).toBe(204);
    });

    it('criterio 89: un GET sin cuerpo con Content-Encoding br no se ve afectado', async () => {
      const respuesta = await enviar(app, {
        metodo: 'GET',
        ruta: '/api/salud',
        cabeceras: { 'Content-Encoding': 'br' },
      });

      expect(respuesta.status).toBe(200);
    });
  });
});
