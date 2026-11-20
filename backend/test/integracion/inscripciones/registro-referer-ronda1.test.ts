// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEXTO_REDACTADO } from '../../../src/infraestructura/registro/opciones-registro';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import {
  type AppInscripciones,
  AHORA_005,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoCotizacion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  rutaPublica,
  sembrarSolicitud,
  tokenAleatorio,
} from '../../utilidades/inscripciones';
import { pedir } from '../../utilidades/inscripciones-ronda1';

// Criterio 53 (crítico, D-05, D-27, Ley 29733; criterio 43 de 002 y criterio 28; ataque ronda 1, F5): la página de seguimiento tiene el token
// en su dirección (`/a/{nombreCorto}/solicitud/{token}`) y un navegador puede mandar esa dirección en `Referer` a la API. En toda ruta de la
// API (públicas, del panel y de la plataforma, también en las respuestas de error y en las rechazadas por el límite), la línea de `pino-http`
// y cualquier otro registro técnico llevan `req.headers.referer` redactado con `TEXTO_REDACTADO`, en todos los niveles. Prueba con un registro
// en memoria en el nivel más detallado (`trace`) que manda `Referer: https://academia.test/a/{nombreCorto}/solicitud/{token}` en
// `GET /api/a/{nombreCorto}`, `GET …/inscripcion`, la cotización, un envío correcto, un envío rechazado (400 y 409), una consulta con 200 y con
// 404, una petición rechazada con 429 y una ruta que no existe: el token no aparece en ninguna línea, y el valor redactado sí.

const TOKEN_EN_EL_REFERER = tokenAleatorio();
const REFERER = `https://academia.test/a/academia-a/solicitud/${TOKEN_EN_EL_REFERER}`;
const CON_REFERER = { referer: REFERER };

function sinFiltrar(lineas: readonly string[]): void {
  const texto = lineas.join('\n');
  expect(texto, 'el registro lleva el token del Referer').not.toContain(TOKEN_EN_EL_REFERER);
  expect(texto, 'el registro lleva la dirección del Referer').not.toContain('academia.test/a/');
}

/** Cada línea que lleva la clave `referer` la lleva redactada. */
function todasRedactadas(lineas: readonly string[]): number {
  let conReferer = 0;
  for (const linea of lineas) {
    const valores = [...linea.matchAll(/"referer":\s*"((?:[^"\\]|\\.)*)"/g)].map((coincidencia) => coincidencia[1]);
    for (const valor of valores) {
      expect(valor, `Referer sin redactar en: ${linea.slice(0, 300)}`).toBe(TEXTO_REDACTADO);
      conReferer += 1;
    }
  }
  return conReferer;
}

describe('el registro técnico no lleva la cabecera Referer (criterio 53)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  /**
   * Hace la petición con `Referer`, espera la línea de la petición ya completada y comprueba el registro de esa petición. Algunas rutas
   * rechazan la petición sin dejar la línea de `pino-http` (sin sesión): ahí solo se exige que el token no esté en ninguna línea.
   */
  async function comprobar(
    nombre: string,
    hacer: () => Promise<{ status: number }>,
    estadoEsperado: number | readonly number[],
    exigirLinea = true,
  ): Promise<void> {
    const antes = lineas.length;
    const respuesta = await hacer();
    expect([estadoEsperado].flat(), `${nombre}: estado ${respuesta.status}`).toContain(respuesta.status);
    if (exigirLinea) await esperarHasta(() => lineas.slice(antes).some((linea) => linea.includes(TEXTO_REDACTADO)));
    else await new Promise((resolver) => setTimeout(resolver, 150));
    const nuevas = lineas.slice(antes);
    sinFiltrar(nuevas);
    const redactadas = todasRedactadas(nuevas);
    if (exigirLinea) {
      expect(redactadas, `${nombre}: la línea de la petición lleva el Referer redactado`).toBeGreaterThan(0);
    }
  }

  it('criterio 53: GET /api/a/{nombreCorto}', async () => {
    await comprobar('lectura', () => pedir(ctx, 'GET', rutaPublica('academia-a'), { headers: CON_REFERER }), 200);
  });

  it('criterio 53: GET /api/a/{nombreCorto}/inscripcion', async () => {
    await comprobar(
      'formulario',
      () => pedir(ctx, 'GET', rutaPublica('academia-a', '/inscripcion'), { headers: CON_REFERER }),
      200,
    );
  });

  it('criterio 53: la cotización', async () => {
    await comprobar(
      'cotización',
      () =>
        pedir(ctx, 'POST', rutaPublica('academia-a', '/inscripcion/cotizacion'), {
          headers: CON_REFERER,
          cuerpo: cuerpoCotizacion(e),
        }),
      200,
    );
  });

  it('criterio 53: un envío correcto (201)', async () => {
    await comprobar(
      'envío correcto',
      async () =>
        pedir(ctx, 'POST', rutaPublica('academia-a', '/inscripcion'), {
          headers: CON_REFERER,
          cuerpo: await cuerpoInscripcion(e),
        }),
      201,
    );
  });

  it('criterio 53: un envío rechazado con 400', async () => {
    await comprobar(
      'envío 400',
      () =>
        pedir(ctx, 'POST', rutaPublica('academia-a', '/inscripcion'), {
          headers: CON_REFERER,
          cuerpo: { basura: true },
        }),
      400,
    );
  });

  it('criterio 53: un envío rechazado con 409', async () => {
    await comprobar(
      'envío 409',
      async () =>
        pedir(ctx, 'POST', rutaPublica('academia-a', '/inscripcion'), {
          headers: CON_REFERER,
          cuerpo: await cuerpoInscripcion(e, { sobre: { consentimientos: { version: 'vieja' } } }),
        }),
      409,
    );
  });

  it('criterio 53: una consulta con 200', async () => {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    await comprobar(
      'consulta 200',
      () =>
        pedir(ctx, 'POST', rutaPublica('academia-a', '/solicitudes/consulta'), {
          headers: CON_REFERER,
          cuerpo: { token: cliente.token },
        }),
      200,
    );
  });

  it('criterio 53: una consulta con 404', async () => {
    await comprobar(
      'consulta 404',
      () =>
        pedir(ctx, 'POST', rutaPublica('academia-a', '/solicitudes/consulta'), {
          headers: CON_REFERER,
          cuerpo: { token: tokenAleatorio() },
        }),
      404,
    );
  });

  it('criterio 53: una academia que no existe (404) y una ruta de la API que no existe', async () => {
    await comprobar(
      'academia inexistente',
      () => pedir(ctx, 'GET', rutaPublica('no-existe'), { headers: CON_REFERER }),
      404,
    );
    await comprobar(
      'ruta inexistente',
      () => pedir(ctx, 'GET', '/api/esta-ruta-no-existe', { headers: CON_REFERER }),
      [401, 404],
      false,
    );
  });

  it('criterio 53: rutas del panel y de la plataforma sin sesión (401): el Referer tampoco llega al registro', async () => {
    await comprobar('panel', () => pedir(ctx, 'GET', '/api/clases', { headers: CON_REFERER }), 401, false);
    await comprobar(
      'plataforma',
      () => pedir(ctx, 'GET', '/api/plataforma/academias', { headers: CON_REFERER }),
      401,
      false,
    );
  });

  it('criterio 53: el valor redactado es TEXTO_REDACTADO, como el de la cookie y authorization', async () => {
    const antes = lineas.length;

    await pedir(ctx, 'GET', rutaPublica('academia-a'), {
      headers: {
        ...CON_REFERER,
        cookie: 'aq_sesion=valor-secreto-de-prueba',
        authorization: 'Bearer secreto-de-prueba',
      },
    });
    await esperarHasta(() => lineas.slice(antes).some((linea) => linea.includes(TEXTO_REDACTADO)));

    const nuevas = lineas.slice(antes).join('\n');
    expect(nuevas).toContain(`"referer":"${TEXTO_REDACTADO}"`);
    expect(nuevas).not.toContain('valor-secreto-de-prueba');
    expect(nuevas).not.toContain('secreto-de-prueba');
  });
});

describe('criterio 53: una petición rechazada por el límite (429) tampoco lleva el Referer al registro', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppInscripciones;

  beforeAll(async () => {
    await exigirTablasDeInscripcion();
    await crearEscenarioInscripcion();
    ctx = await crearAppInscripciones({ conLimites: true, nivelRegistro: 'trace', destinoRegistro: destino });
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it('criterio 53: la consulta número 11 del minuto responde 429 y ninguna línea lleva el token del Referer', async () => {
    const antes = lineas.length;
    const consultar = () =>
      pedir(ctx, 'POST', rutaPublica('academia-a', '/solicitudes/consulta'), {
        headers: CON_REFERER,
        cuerpo: { token: tokenAleatorio() },
      });
    for (let i = 0; i < 10; i++) expect((await consultar()).status).toBe(404);

    const limitada = await consultar();

    expect(limitada.status).toBe(429);
    await esperarHasta(() => lineas.slice(antes).filter((linea) => linea.includes(TEXTO_REDACTADO)).length >= 10);
    const nuevas = lineas.slice(antes);
    sinFiltrar(nuevas);
    // La petición rechazada por el límite puede no dejar su línea de `pino-http`: si la deja, también va redactada (`sinFiltrar`).
    expect(
      todasRedactadas(nuevas),
      'las líneas de las 10 peticiones anteriores llevan el Referer redactado',
    ).toBeGreaterThanOrEqual(10);
  });
});
