// spec: 001-academias-aislamiento (pruebas protegidas)
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerAcademias, leerAuditoriaPlataforma, leerSuperadmin } from '../../utilidades/datos';
import { cookieDeSesion, crearSuperadminDePrueba, type SuperadminDePrueba } from '../../utilidades/superadmins';

// Criterio 74 (ataque ronda 1, F2): en las rutas de /api con POST, PUT, PATCH o DELETE y cuerpo (Content-Length > 0 o
// Transfer-Encoding), solo se acepta Content-Type application/json (sin distinguir mayusculas, con charset=utf-8
// opcional). Cualquier otro tipo, o ninguno: 400 SOLICITUD_INVALIDA con detalles.errores = [{ campo: '', mensaje }] y
// Cache-Control: no-store, sin interpretar el cuerpo. Sin sesion, las rutas protegidas siguen respondiendo 401 antes
// de mirar el cuerpo. Cada peticion a POST /api/plataforma/sesion cuenta para el limite de 10 por IP (criterio 75):
// las pruebas de inicio de sesion crean una aplicacion nueva para cada caso.

const AHORA = new Date('2026-11-11T15:00:00.000Z');
const CORREO = 'dueno@aquagestion.test';

interface RespuestaCruda {
  status: number;
  headers: http.IncomingHttpHeaders;
  texto: string;
  body: Record<string, unknown>;
}

interface PeticionCruda {
  metodo: string;
  ruta: string;
  cabeceras?: Record<string, string>;
  /** Trozos del cuerpo. Si `troceado`, se envian con Transfer-Encoding: chunked y sin Content-Length. */
  cuerpo?: string;
  troceado?: boolean;
}

function analizarJson(texto: string): Record<string, unknown> {
  try {
    return texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function escuchar(app: NestExpressApplication): Promise<number> {
  const servidor = app.getHttpServer();
  if (!servidor.listening) await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  return (servidor.address() as AddressInfo).port;
}

/** Peticion HTTP con control total de las cabeceras (sin Content-Type, Content-Type vacio, chunked). */
async function enviarCrudo(app: NestExpressApplication, peticion: PeticionCruda): Promise<RespuestaCruda> {
  const port = await escuchar(app);
  const cabeceras: Record<string, string | number> = { ...peticion.cabeceras };
  if (peticion.cuerpo !== undefined && !peticion.troceado) {
    cabeceras['Content-Length'] = Buffer.byteLength(peticion.cuerpo);
  }
  if (peticion.troceado) cabeceras['Transfer-Encoding'] = 'chunked';
  return new Promise((resolver, rechazar) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: peticion.metodo, path: peticion.ruta, headers: cabeceras },
      (res) => {
        const trozos: Buffer[] = [];
        res.on('data', (trozo: Buffer) => trozos.push(trozo));
        res.on('end', () => {
          const texto = Buffer.concat(trozos).toString('utf8');
          resolver({ status: res.statusCode ?? 0, headers: res.headers, texto, body: analizarJson(texto) });
        });
      },
    );
    req.on('error', rechazar);
    if (peticion.cuerpo !== undefined) req.write(peticion.cuerpo);
    req.end();
  });
}

interface ErrorCuerpo {
  codigo?: string;
  mensaje?: string;
  detalles?: { errores?: { campo: string; mensaje: string }[] };
}

/** 400 SOLICITUD_INVALIDA con el formato del criterio 74. */
function esperarRechazoPorTipo(respuesta: { status: number; body: unknown; headers: Record<string, unknown> }): void {
  expect(respuesta.status).toBe(400);
  const cuerpo = respuesta.body as ErrorCuerpo;
  expect(cuerpo.codigo).toBe('SOLICITUD_INVALIDA');
  expect(cuerpo.detalles?.errores).toEqual([{ campo: '', mensaje: expect.any(String) as string }]);
  const cacheControl = respuesta.headers['cache-control'];
  expect(Array.isArray(cacheControl) ? cacheControl.join(',') : (cacheControl as string | undefined)).toContain(
    'no-store',
  );
  expect(respuesta.headers['set-cookie']).toBeUndefined();
}

// Cuerpos con credenciales correctas: si la API los interpretara, el inicio de sesion o la creacion tendrian exito.
const CLAVE = 'ClaveSegura-2026!';
const JSON_VALIDO = JSON.stringify({ correo: CORREO, clave: CLAVE });
const FORMULARIO = `correo=${encodeURIComponent(CORREO)}&clave=${encodeURIComponent(CLAVE)}`;
const MULTIPART = [
  '--XYZ',
  'Content-Disposition: form-data; name="correo"',
  '',
  CORREO,
  '--XYZ',
  'Content-Disposition: form-data; name="clave"',
  '',
  CLAVE,
  '--XYZ--',
  '',
].join('\r\n');

/** [tipo, cuerpo con las credenciales correctas]. */
const TIPOS_RECHAZADOS: [string, string][] = [
  ['application/x-www-form-urlencoded', FORMULARIO],
  ['text/plain', JSON_VALIDO],
  ['text/plain; charset=utf-8', JSON_VALIDO],
  ['text/json', JSON_VALIDO],
  ['multipart/form-data; boundary=XYZ', MULTIPART],
  ['application/json; charset=latin1', JSON_VALIDO],
  ['application/json; charset=utf-16', JSON_VALIDO],
  ['application/vnd.api+json', JSON_VALIDO],
  ['application/json-patch+json', JSON_VALIDO],
  ['application/octet-stream', JSON_VALIDO],
];

const TIPOS_ACEPTADOS = [
  'application/json',
  'APPLICATION/JSON',
  'Application/Json',
  'application/json; charset=utf-8',
  'application/json;charset=UTF-8',
  'application/json; CHARSET=utf-8',
];

describe('criterio 74: POST /api/plataforma/sesion con cuerpos que no son JSON', () => {
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
    const fila = await leerSuperadmin(superadmin.id);
    expect(fila).toMatchObject({
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_acceso: null,
      version_token: 0,
    });
  }

  it.each(TIPOS_RECHAZADOS)(
    'criterio 74: Content-Type %s con la clave correcta responde 400, no emite cookie y no cambia la cuenta',
    async (tipo, cuerpo) => {
      const respuesta = await request(app.getHttpServer())
        .post('/api/plataforma/sesion')
        .set('Content-Type', tipo)
        .send(cuerpo);

      esperarRechazoPorTipo(respuesta);
      await esperarSuperadminIntacto();
    },
  );

  it('criterio 74: un cuerpo sin Content-Type responde 400 y no inicia sesion', async () => {
    const respuesta = await enviarCrudo(app, { metodo: 'POST', ruta: '/api/plataforma/sesion', cuerpo: JSON_VALIDO });

    esperarRechazoPorTipo(respuesta);
    await esperarSuperadminIntacto();
  });

  it('criterio 74: un cuerpo con Content-Type vacio responde 400 y no inicia sesion', async () => {
    const respuesta = await enviarCrudo(app, {
      metodo: 'POST',
      ruta: '/api/plataforma/sesion',
      cabeceras: { 'Content-Type': '' },
      cuerpo: JSON_VALIDO,
    });

    esperarRechazoPorTipo(respuesta);
    await esperarSuperadminIntacto();
  });

  it.each([
    ['sin Content-Type', undefined],
    ['con text/plain', 'text/plain'],
    ['con application/x-www-form-urlencoded', 'application/x-www-form-urlencoded'],
  ])('criterio 74: un cuerpo con Transfer-Encoding: chunked %s responde 400', async (_caso, tipo) => {
    const respuesta = await enviarCrudo(app, {
      metodo: 'POST',
      ruta: '/api/plataforma/sesion',
      cabeceras: tipo ? { 'Content-Type': tipo } : {},
      cuerpo: tipo === 'application/x-www-form-urlencoded' ? FORMULARIO : JSON_VALIDO,
      troceado: true,
    });

    esperarRechazoPorTipo(respuesta);
    await esperarSuperadminIntacto();
  });

  it('criterio 74: un cuerpo grande de un tipo que no es JSON responde 400 y no 413 (no se interpreta)', async () => {
    const respuesta = await request(app.getHttpServer())
      .post('/api/plataforma/sesion')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`correo=${encodeURIComponent(CORREO)}&clave=${'x'.repeat(150_000)}`);

    esperarRechazoPorTipo(respuesta);
    await esperarSuperadminIntacto();
  });

  it.each(TIPOS_ACEPTADOS)(
    'criterio 74: Content-Type %s sigue siendo JSON y el inicio de sesion funciona',
    async (tipo) => {
      const respuesta = await request(app.getHttpServer())
        .post('/api/plataforma/sesion')
        .set('Content-Type', tipo)
        .send(JSON_VALIDO);

      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['set-cookie']).toBeDefined();
    },
  );

  it('criterio 74: un cuerpo JSON troceado (Transfer-Encoding: chunked) con application/json funciona', async () => {
    const respuesta = await enviarCrudo(app, {
      metodo: 'POST',
      ruta: '/api/plataforma/sesion',
      cabeceras: { 'Content-Type': 'application/json' },
      cuerpo: JSON_VALIDO,
      troceado: true,
    });

    expect(respuesta.status).toBe(200);
  });
});

describe('criterio 74: rutas protegidas de /api/plataforma y otras rutas de /api', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let superadmin: SuperadminDePrueba;
  let cookie: string;

  const servidor = () => app.getHttpServer();

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

  const NUEVA_ACADEMIA = { nombre: 'Academia de Natacion Los Delfines', nombreCorto: 'delfines' };
  const JSON_ACADEMIA = JSON.stringify(NUEVA_ACADEMIA);
  const FORM_ACADEMIA = 'nombre=Academia+de+Natacion+Los+Delfines&nombreCorto=delfines';

  const TIPOS_PARA_ACADEMIAS: [string, string][] = [
    ['application/x-www-form-urlencoded', FORM_ACADEMIA],
    ['text/plain', JSON_ACADEMIA],
    [
      'multipart/form-data; boundary=XYZ',
      '--XYZ\r\nContent-Disposition: form-data; name="nombre"\r\n\r\nX\r\n--XYZ--\r\n',
    ],
    ['application/json; charset=latin1', JSON_ACADEMIA],
    ['application/vnd.api+json', JSON_ACADEMIA],
  ];

  describe('POST /api/plataforma/academias', () => {
    it.each(TIPOS_PARA_ACADEMIAS)(
      'criterio 74: con sesion y Content-Type %s responde 400 y no crea ni audita nada',
      async (tipo, cuerpo) => {
        const respuesta = await request(servidor())
          .post('/api/plataforma/academias')
          .set('Cookie', cookie)
          .set('Content-Type', tipo)
          .send(cuerpo);

        esperarRechazoPorTipo(respuesta);
        expect(await leerAcademias()).toEqual([]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
    );

    it('criterio 74: con sesion y sin Content-Type responde 400 y no crea ni audita nada', async () => {
      const respuesta = await enviarCrudo(app, {
        metodo: 'POST',
        ruta: '/api/plataforma/academias',
        cabeceras: { Cookie: cookie },
        cuerpo: JSON_ACADEMIA,
      });

      esperarRechazoPorTipo(respuesta);
      expect(await leerAcademias()).toEqual([]);
      expect(await leerAuditoriaPlataforma()).toEqual([]);
    });

    it('criterio 74: con sesion y un cuerpo grande de formulario responde 400 y no 413', async () => {
      const respuesta = await request(servidor())
        .post('/api/plataforma/academias')
        .set('Cookie', cookie)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`${FORM_ACADEMIA}&relleno=${'x'.repeat(150_000)}`);

      esperarRechazoPorTipo(respuesta);
      expect(await leerAcademias()).toEqual([]);
    });

    it('criterio 74: con sesion y application/json la creacion funciona (201)', async () => {
      const respuesta = await request(servidor())
        .post('/api/plataforma/academias')
        .set('Cookie', cookie)
        .set('Content-Type', 'application/json; charset=utf-8')
        .send(JSON_ACADEMIA);

      expect(respuesta.status).toBe(201);
      expect(await leerAcademias()).toHaveLength(1);
    });

    it.each(TIPOS_PARA_ACADEMIAS)(
      'criterio 74: sin sesion y Content-Type %s responde 401 NO_AUTENTICADO antes de mirar el cuerpo',
      async (tipo, cuerpo) => {
        const respuesta = await request(servidor())
          .post('/api/plataforma/academias')
          .set('Content-Type', tipo)
          .send(cuerpo);

        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
        expect(await leerAcademias()).toEqual([]);
      },
    );
  });

  describe('POST /api/plataforma/academias/{id}/suspender y /reactivar', () => {
    it.each(TIPOS_PARA_ACADEMIAS)(
      'criterio 74: suspender con Content-Type %s responde 400 y la academia sigue ACTIVA, sin auditoria',
      async (tipo) => {
        const academia = await crearAcademiaDePrueba();
        const respuesta = await request(servidor())
          .post(`/api/plataforma/academias/${academia.id}/suspender`)
          .set('Cookie', cookie)
          .set('Content-Type', tipo)
          .send('motivo=Falta+de+pago');

        esperarRechazoPorTipo(respuesta);
        const filas = await leerAcademias();
        expect(filas.map((fila) => [fila.id, fila.estado, fila.motivo_suspension])).toEqual([
          [academia.id, 'ACTIVA', null],
        ]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
    );

    it.each(TIPOS_PARA_ACADEMIAS)(
      'criterio 74: reactivar con Content-Type %s responde 400 y la academia sigue SUSPENDIDA, sin auditoria',
      async (tipo) => {
        const academia = await crearAcademiaDePrueba({ estado: 'SUSPENDIDA' });
        const respuesta = await request(servidor())
          .post(`/api/plataforma/academias/${academia.id}/reactivar`)
          .set('Cookie', cookie)
          .set('Content-Type', tipo)
          .send('motivo=Pago+recibido');

        esperarRechazoPorTipo(respuesta);
        const filas = await leerAcademias();
        expect(filas.map((fila) => [fila.id, fila.estado])).toEqual([[academia.id, 'SUSPENDIDA']]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
    );

    it('criterio 74: sin sesion, suspender con un formulario responde 401 y no cambia nada', async () => {
      const academia = await crearAcademiaDePrueba();
      const respuesta = await request(servidor())
        .post(`/api/plataforma/academias/${academia.id}/suspender`)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('motivo=Falta+de+pago');

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      expect((await leerAcademias())[0]?.estado).toBe('ACTIVA');
    });
  });

  describe('DELETE /api/plataforma/sesion', () => {
    it('criterio 74: con sesion y un cuerpo que no es JSON responde 400 y no cambia version_token', async () => {
      const respuesta = await request(servidor())
        .delete('/api/plataforma/sesion')
        .set('Cookie', cookie)
        .set('Content-Type', 'text/plain')
        .send('cerrar');

      esperarRechazoPorTipo(respuesta);
      expect((await leerSuperadmin(superadmin.id))?.version_token).toBe(0);
      const vigente = await request(servidor()).get('/api/plataforma/sesion').set('Cookie', cookie);
      expect(vigente.status).toBe(200);
    });

    it('criterio 74: sin sesion y con un cuerpo que no es JSON tambien responde 400', async () => {
      const respuesta = await request(servidor())
        .delete('/api/plataforma/sesion')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('a=1');

      esperarRechazoPorTipo(respuesta);
    });

    it('criterio 74: sin cuerpo sigue el criterio 44: 204 aunque lleve un Content-Type que no es JSON', async () => {
      const respuesta = await request(servidor())
        .delete('/api/plataforma/sesion')
        .set('Cookie', cookie)
        .set('Content-Type', 'text/plain');

      expect(respuesta.status).toBe(204);
      expect((await leerSuperadmin(superadmin.id))?.version_token).toBe(1);
    });
  });

  describe('PUT, PATCH, DELETE y rutas que no existen', () => {
    it.each(['PUT', 'PATCH', 'DELETE'])(
      'criterio 74: %s con sesion y un cuerpo text/plain responde 400',
      async (metodo) => {
        const academia = await crearAcademiaDePrueba();
        const respuesta = await enviarCrudo(app, {
          metodo,
          ruta: `/api/plataforma/academias/${academia.id}`,
          cabeceras: { Cookie: cookie, 'Content-Type': 'text/plain' },
          cuerpo: 'hola',
        });

        esperarRechazoPorTipo(respuesta);
      },
    );

    it.each(['PUT', 'PATCH', 'DELETE'])(
      'criterio 74: %s sin sesion y un cuerpo text/plain responde 401',
      async (metodo) => {
        const respuesta = await enviarCrudo(app, {
          metodo,
          ruta: '/api/plataforma/academias/algo',
          cabeceras: { 'Content-Type': 'text/plain' },
          cuerpo: 'hola',
        });

        expect(respuesta.status).toBe(401);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      },
    );

    it.each([
      ['POST /api/salud', 'POST', '/api/salud'],
      ['POST /api/a/delfines', 'POST', '/api/a/delfines'],
      ['PUT /api/salud', 'PUT', '/api/salud'],
      ['POST /api/no-existe', 'POST', '/api/no-existe'],
    ])('criterio 74: %s con un cuerpo text/plain responde 400 SOLICITUD_INVALIDA', async (_nombre, metodo, ruta) => {
      const respuesta = await enviarCrudo(app, {
        metodo,
        ruta,
        cabeceras: { 'Content-Type': 'text/plain' },
        cuerpo: 'hola',
      });

      expect(respuesta.status).toBe(400);
      const cuerpo = respuesta.body as ErrorCuerpo;
      expect(cuerpo.codigo).toBe('SOLICITUD_INVALIDA');
      expect(cuerpo.detalles?.errores).toEqual([{ campo: '', mensaje: expect.any(String) as string }]);
    });

    it('criterio 74: un GET con Content-Type text/plain y sin cuerpo no se ve afectado', async () => {
      const respuesta = await request(servidor()).get('/api/salud').set('Content-Type', 'text/plain');

      expect(respuesta.status).toBe(200);
    });
  });
});
