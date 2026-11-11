// spec: 001-academias-aislamiento (pruebas protegidas)
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerAcademias, leerAuditoriaPlataforma, leerSuperadmin } from '../../utilidades/datos';
import {
  cookieDePlataforma,
  cookieDeSesion,
  crearSuperadminDePrueba,
  type SuperadminDePrueba,
} from '../../utilidades/superadmins';

// Criterio 105 (ataque ronda 3, O5; complementa los criterios 42, 74 y 76): dada cualquier ruta de `/api` con cuerpo JSON
// (criterio 74), cuando el cuerpo, ya descomprimido (criterio 89), no es UTF-8 valido (por ejemplo, contiene `0xFF`, `0xC3 0x28`,
// una secuencia demasiado larga como `0xC0 0xAF`, un sustituto codificado como `0xED 0xA0 0x80` o una secuencia cortada al final
// como `0xE2 0x82`, dentro o fuera de una cadena JSON), entonces responde 400 `SOLICITUD_INVALIDA` con
// `detalles: { errores: [{ campo: "", mensaje }] }` y `Cache-Control: no-store`, sin interpretar el cuerpo ni escribir nada:
// nunca guarda U+FFFD en su lugar. En `POST /api/plataforma/sesion` cuenta para el limite por IP (criterio 75) y no calcula ningun
// hash ni cuenta un intento; en `POST /api/plataforma/academias`, `.../suspender` y `.../reactivar` no crea, no cambia ni audita
// nada. Un cuerpo UTF-8 valido que trae U+FFFD escrito por el cliente sigue las reglas de texto de siempre.

const AHORA = new Date('2026-11-11T15:00:00.000Z');
const CORREO = 'dueno@aquagestion.test';
const CLAVE = 'ClaveSegura-2026!';
const RUTA_SESION = '/api/plataforma/sesion';

interface RespuestaCruda {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface ErrorCuerpo {
  codigo?: string;
  detalles?: { errores?: { campo: string; mensaje: string }[] };
}

async function enviar(
  app: NestExpressApplication,
  ruta: string,
  cuerpo: Buffer,
  cabeceras: Record<string, string> = {},
  metodo = 'POST',
): Promise<RespuestaCruda> {
  const servidor = app.getHttpServer();
  if (!servidor.listening) await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const port = (servidor.address() as AddressInfo).port;
  return new Promise((resolver, rechazar) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: metodo,
        path: ruta,
        headers: { 'Content-Type': 'application/json', 'Content-Length': cuerpo.length, ...cabeceras },
      },
      (res) => {
        const trozos: Buffer[] = [];
        res.on('data', (trozo: Buffer) => trozos.push(trozo));
        res.on('end', () => {
          const texto = Buffer.concat(trozos).toString('utf8');
          let body: Record<string, unknown>;
          try {
            body = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
          } catch {
            body = {};
          }
          resolver({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on('error', rechazar);
    req.write(cuerpo);
    req.end();
  });
}

const bytes = (...valores: number[]): Buffer => Buffer.from(valores);
const texto = (valor: string): Buffer => Buffer.from(valor, 'utf8');

/** Una secuencia de bytes que no es UTF-8 valido, con el nombre que se muestra en la prueba. */
const SECUENCIAS_INVALIDAS: [string, Buffer][] = [
  ['0xFF', bytes(0xff)],
  ['0xC3 0x28 (continuacion que no lo es)', bytes(0xc3, 0x28)],
  ['0xC0 0xAF (secuencia demasiado larga)', bytes(0xc0, 0xaf)],
  ['0xED 0xA0 0x80 (sustituto codificado)', bytes(0xed, 0xa0, 0x80)],
  ['0xE2 0x82 (secuencia cortada)', bytes(0xe2, 0x82)],
  ['0xF8 0x88 0x80 0x80 0x80 (cinco bytes)', bytes(0xf8, 0x88, 0x80, 0x80, 0x80)],
  ['0x80 (continuacion sin inicio)', bytes(0x80)],
];

/** Cuerpo JSON de inicio de sesion con los bytes invalidos dentro de la cadena `clave`. */
function sesionConBytesEnLaClave(invalidos: Buffer): Buffer {
  return Buffer.concat([texto(`{"correo":"${CORREO}","clave":"clave-`), invalidos, texto('-fin"}')]);
}

/** Cuerpos con los bytes invalidos FUERA de una cadena JSON. */
function sesionConBytesFuera(invalidos: Buffer): [string, Buffer][] {
  const valido = `{"correo":"${CORREO}","clave":"${CLAVE}"}`;
  return [
    ['al final del cuerpo', Buffer.concat([texto(valido), invalidos])],
    ['al inicio del cuerpo', Buffer.concat([invalidos, texto(valido)])],
    [
      'entre dos propiedades',
      Buffer.concat([texto(`{"correo":"${CORREO}",`), invalidos, texto(`"clave":"${CLAVE}"}`)]),
    ],
  ];
}

function cabeceraNoStore(respuesta: RespuestaCruda): string {
  const valor = respuesta.headers['cache-control'];
  return Array.isArray(valor) ? valor.join(',') : (valor ?? '');
}

/**
 * 400 SOLICITUD_INVALIDA con `detalles.errores = [{ campo: '', mensaje }]`, `no-store` y sin cookie. En las rutas fuera de
 * `/api/plataforma` y `/api/a` (que la precision P-8 no cubre) no se exige la cabecera, como en la prueba del criterio 89.
 */
function esperarRechazoPorUtf8(respuesta: RespuestaCruda, { noStore = true }: { noStore?: boolean } = {}): void {
  expect(respuesta.status).toBe(400);
  const cuerpo = respuesta.body as ErrorCuerpo;
  expect(cuerpo.codigo).toBe('SOLICITUD_INVALIDA');
  expect(cuerpo.detalles?.errores).toEqual([{ campo: '', mensaje: expect.any(String) as string }]);
  expect(cuerpo.detalles?.errores?.[0]?.mensaje.length).toBeGreaterThan(0);
  if (noStore) expect(cabeceraNoStore(respuesta)).toContain('no-store');
  expect(respuesta.headers['set-cookie']).toBeUndefined();
}

describe('criterio 105: POST /api/plataforma/sesion con un cuerpo que no es UTF-8 valido', () => {
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

  it.each(SECUENCIAS_INVALIDAS)(
    'criterio 105: %s dentro de la cadena clave responde 400 SOLICITUD_INVALIDA, sin cookie y sin contar un intento',
    async (_nombre, invalidos) => {
      const respuesta = await enviar(app, RUTA_SESION, sesionConBytesEnLaClave(invalidos));

      esperarRechazoPorUtf8(respuesta);
      await esperarSuperadminIntacto();
    },
  );

  it.each(
    SECUENCIAS_INVALIDAS.flatMap(([nombre, invalidos]) =>
      sesionConBytesFuera(invalidos).map(([donde, cuerpo]) => [`${nombre} ${donde}`, cuerpo] as const),
    ),
  )(
    'criterio 105: %s (fuera de una cadena JSON) responde 400 SOLICITUD_INVALIDA aunque las credenciales sean correctas',
    async (_nombre, cuerpo) => {
      const respuesta = await enviar(app, RUTA_SESION, cuerpo);

      esperarRechazoPorUtf8(respuesta);
      await esperarSuperadminIntacto();
    },
  );

  it('criterio 105: cinco cuerpos invalidos con el correo correcto no cuentan intentos ni bloquean la cuenta', async () => {
    for (let i = 0; i < 5; i++) {
      const respuesta = await enviar(app, RUTA_SESION, sesionConBytesEnLaClave(bytes(0xff, 0xfe)));
      esperarRechazoPorUtf8(respuesta);
    }

    await esperarSuperadminIntacto();
    const valida = await enviar(app, RUTA_SESION, texto(JSON.stringify({ correo: CORREO, clave: CLAVE })));
    expect(valida.status).toBe(200);
    expect(cookieDePlataforma(valida.headers)).toBeDefined();
  });

  it('criterio 105: 10 cuerpos invalidos agotan el limite por IP y la peticion valida recibe 429 DEMASIADAS_SOLICITUDES', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 10; i++) {
      estados.push((await enviar(app, RUTA_SESION, sesionConBytesEnLaClave(bytes(0xc3, 0x28)))).status);
    }

    const valida = await enviar(app, RUTA_SESION, texto(JSON.stringify({ correo: CORREO, clave: CLAVE })));

    expect(estados).toEqual(Array(10).fill(400));
    expect(valida.status).toBe(429);
    expect((valida.body as ErrorCuerpo).codigo).toBe('DEMASIADAS_SOLICITUDES');
    expect(cookieDePlataforma(valida.headers)).toBeUndefined();
    await esperarSuperadminIntacto();
  });

  it('criterio 105: pasado el limite, un cuerpo invalido responde 429 y no 400', async () => {
    for (let i = 0; i < 10; i++) await enviar(app, RUTA_SESION, texto('{"correo": '));

    const respuesta = await enviar(app, RUTA_SESION, sesionConBytesEnLaClave(bytes(0xff)));

    expect(respuesta.status).toBe(429);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('DEMASIADAS_SOLICITUDES');
  });

  it('criterio 105: un cuerpo UTF-8 valido con acentos y emojis sigue funcionando (control)', async () => {
    const respuesta = await enviar(app, RUTA_SESION, texto(JSON.stringify({ correo: CORREO, clave: CLAVE })));
    const conAcentos = await enviar(
      app,
      RUTA_SESION,
      texto(JSON.stringify({ correo: CORREO, clave: 'Contraseña-😀-ñandú' })),
    );

    expect(respuesta.status).toBe(200);
    expect(conAcentos.status).toBe(401);
  });

  it('criterio 105: un cuerpo UTF-8 valido que trae U+FFFD escrito por el cliente se trata como texto (no como bytes invalidos)', async () => {
    const respuesta = await enviar(
      app,
      RUTA_SESION,
      texto(JSON.stringify({ correo: CORREO, clave: 'clave-�-escrita' })),
    );

    // U+FFFD valido en UTF-8 (EF BF BD): llega como una clave equivocada (401), no como un cuerpo ilegible (400).
    expect(respuesta.status).toBe(401);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('CREDENCIALES_INVALIDAS');
  });
});

describe('criterio 105: rutas de la plataforma con sesion y cuerpos que no son UTF-8 valido', () => {
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

  const academiaConBytes = (invalidos: Buffer): Buffer =>
    Buffer.concat([texto('{"nombre":"Academia '), invalidos, texto(' Delfines","nombreCorto":"delfines"}')]);
  const motivoConBytes = (invalidos: Buffer): Buffer =>
    Buffer.concat([texto('{"motivo":"Falta de pago '), invalidos, texto(' de la mensualidad"}')]);

  describe('POST /api/plataforma/academias', () => {
    it.each(SECUENCIAS_INVALIDAS)(
      'criterio 105: %s en nombre responde 400, no crea la academia y no audita',
      async (_nombre, invalidos) => {
        const respuesta = await enviar(app, '/api/plataforma/academias', academiaConBytes(invalidos), {
          Cookie: cookie,
        });

        esperarRechazoPorUtf8(respuesta);
        expect(await leerAcademias()).toEqual([]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
    );

    it('criterio 105: bytes invalidos fuera de una cadena responden 400 y no crean nada', async () => {
      const valido = '{"nombre":"Academia Delfines","nombreCorto":"delfines"}';

      const respuesta = await enviar(app, '/api/plataforma/academias', Buffer.concat([texto(valido), bytes(0xff)]), {
        Cookie: cookie,
      });

      esperarRechazoPorUtf8(respuesta);
      expect(await leerAcademias()).toEqual([]);
    });

    it('criterio 105: nunca guarda U+FFFD en lugar de los bytes invalidos', async () => {
      await enviar(app, '/api/plataforma/academias', academiaConBytes(bytes(0xff)), { Cookie: cookie });

      const guardadas = (await leerAcademias()).filter((academia) => academia.nombre.includes('�'));
      expect(guardadas).toEqual([]);
    });

    it('criterio 105: sin sesion, un cuerpo invalido responde 401 NO_AUTENTICADO antes de mirar el cuerpo', async () => {
      const respuesta = await enviar(app, '/api/plataforma/academias', academiaConBytes(bytes(0xff)));

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
      expect(await leerAcademias()).toEqual([]);
    });

    it('criterio 105: un nombre UTF-8 valido con U+FFFD escrito por el cliente sigue las reglas de texto y se guarda tal cual', async () => {
      const nombre = 'Delfines ��';

      const respuesta = await enviar(
        app,
        '/api/plataforma/academias',
        texto(JSON.stringify({ nombre, nombreCorto: 'delfines' })),
        {
          Cookie: cookie,
        },
      );

      expect(respuesta.status).toBe(201);
      const filas = await leerAcademias();
      expect(filas).toHaveLength(1);
      expect(filas[0]?.nombre).toBe(nombre);
    });
  });

  describe('POST /api/plataforma/academias/{id}/suspender', () => {
    it.each(SECUENCIAS_INVALIDAS)(
      'criterio 105: %s en motivo responde 400 y no suspende la academia ni audita',
      async (_nombre, invalidos) => {
        const academia = await crearAcademiaDePrueba({ nombreCorto: 'activa-utf8' });

        const respuesta = await enviar(
          app,
          `/api/plataforma/academias/${academia.id}/suspender`,
          motivoConBytes(invalidos),
          {
            Cookie: cookie,
          },
        );

        esperarRechazoPorUtf8(respuesta);
        const fila = (await leerAcademias()).find((candidata) => candidata.id === academia.id);
        expect(fila?.estado).toBe('ACTIVA');
        expect(fila?.motivo_suspension).toBeNull();
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
    );
  });

  describe('POST /api/plataforma/academias/{id}/reactivar', () => {
    it.each(SECUENCIAS_INVALIDAS)(
      'criterio 105: %s en motivo responde 400 y no reactiva la academia ni audita',
      async (_nombre, invalidos) => {
        const academia = await crearAcademiaDePrueba({ nombreCorto: 'suspendida-utf8', estado: 'SUSPENDIDA' });

        const respuesta = await enviar(
          app,
          `/api/plataforma/academias/${academia.id}/reactivar`,
          motivoConBytes(invalidos),
          {
            Cookie: cookie,
          },
        );

        esperarRechazoPorUtf8(respuesta);
        const fila = (await leerAcademias()).find((candidata) => candidata.id === academia.id);
        expect(fila?.estado).toBe('SUSPENDIDA');
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
    );
  });

  describe('otras rutas de /api con cuerpo JSON (criterio 74)', () => {
    it.each([
      ['POST /api/salud', 'POST', '/api/salud'],
      ['POST /api/a/delfines', 'POST', '/api/a/delfines'],
      ['PUT /api/salud', 'PUT', '/api/salud'],
      ['POST /api/no-existe', 'POST', '/api/no-existe'],
    ])(
      'criterio 105: %s con un cuerpo que no es UTF-8 valido responde 400 SOLICITUD_INVALIDA',
      async (_nombre, metodo, ruta) => {
        const cuerpo = Buffer.concat([texto('{"a":"'), bytes(0xff), texto('"}')]);
        const respuesta = await enviar(app, ruta, cuerpo, {}, metodo);

        esperarRechazoPorUtf8(respuesta, { noStore: ruta.startsWith('/api/a/') });
      },
    );

    it.each(['PUT', 'PATCH', 'DELETE'])(
      'criterio 105: %s con sesion en una ruta de la plataforma con bytes invalidos responde 400',
      async (metodo) => {
        const respuesta = await enviar(
          app,
          '/api/plataforma/academias/algo',
          Buffer.concat([texto('{"a":"'), bytes(0xc3, 0x28), texto('"}')]),
          { Cookie: cookie },
          metodo,
        );

        esperarRechazoPorUtf8(respuesta);
      },
    );
  });
});
