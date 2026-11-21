// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  cuerpoCotizacion,
  cuerpoInscripcion,
  crearEscenarioInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  type RespuestaApi,
  rutaPublica,
} from '../../utilidades/inscripciones';
import { crearAppConIpPorCabecera, desde, pedir } from '../../utilidades/inscripciones-ronda1';

// Criterio 49 (crítico, criterio 33, nota O2 de 001; ataque ronda 1, F1): `HEAD` cuenta como `GET` en los límites por IP. Toda ruta pública
// de `/api/a` que tiene límite para `GET` lo tiene también para `HEAD`, con el MISMO contador: `GET` y `HEAD` de `/api/a/{nombreCorto}` y de
// `/api/a/{nombreCorto}/inscripcion` suman en el contador "lectura" de 60 por minuto por IP (también con mayúsculas distintas o barra final).
//   a) 60 HEAD desde una IP y después un GET (de cualquiera de las dos rutas): el GET responde 429 DEMASIADAS_SOLICITUDES;
//   b) 60 GET y después un HEAD (de cualquiera de las dos rutas): 429 con Cache-Control: no-store, sin buscar la academia;
//   c) pasado el límite, un HEAD con un nombre corto que existe y uno con un nombre corto que no existe responden el mismo 429 (el HEAD ya no
//      distingue una academia existente de una inexistente);
//   d) mezclando GET y HEAD sobre las dos rutas, la petición número 61 del minuto es la primera en responder 429.
// Los demás contadores (cotización, envío, consulta, ingreso) no cambian: un HEAD nunca cuenta en ellos ni agota el de lectura de otra IP.
// Cada prueba crea su aplicación y arranca con los contadores en cero. La IP de cada petición se fija con X-Forwarded-For (plan, sección 15).

describe('HEAD cuenta como GET en los límites por IP (criterio 49)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  const IP = '203.0.113.10';

  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    e = await crearEscenarioInscripcion();
    ctx = await crearAppConIpPorCabecera({ conLimites: true, ahora: AHORA_005 });
  });
  afterEach(async () => {
    await ctx?.http.cerrar();
  });

  const RUTAS = ['', '/inscripcion'] as const;
  const head = (nombreCorto = 'academia-a', sufijo = '', ip = IP) =>
    pedir(ctx, 'HEAD', rutaPublica(nombreCorto, sufijo), { headers: desde(ip) });
  const get = (nombreCorto = 'academia-a', sufijo = '', ip = IP) =>
    pedir(ctx, 'GET', rutaPublica(nombreCorto, sufijo), { headers: desde(ip) });
  const metodo = (nombre: 'GET' | 'HEAD', nombreCorto = 'academia-a', sufijo = '', ip = IP) =>
    nombre === 'GET' ? get(nombreCorto, sufijo, ip) : head(nombreCorto, sufijo, ip);

  async function repetir(n: number, pedirUna: (i: number) => Promise<RespuestaApi>): Promise<number[]> {
    const estados: number[] = [];
    for (let i = 0; i < n; i++) estados.push((await pedirUna(i)).status);
    return estados;
  }

  function esLimite(respuesta: RespuestaApi, descripcion = ''): void {
    expect(respuesta.status, `${descripcion} ${respuesta.texto}`).toBe(429);
    expect(respuesta.cacheControl, descripcion).toBe('no-store');
  }

  it('control: un HEAD de una academia que existe responde 200 y uno de una que no existe, 404 (antes del límite)', async () => {
    expect((await head('academia-a')).status).toBe(200);
    expect((await head('no-existe')).status).toBe(404);
    expect((await head('academia-a', '/inscripcion')).status).toBe(200);
  });

  it.each(RUTAS)(
    'criterio 49 a: 60 HEAD de /api/a/{nombreCorto}%s desde una IP y después un GET de cualquiera de las dos rutas responde 429 DEMASIADAS_SOLICITUDES',
    async (sufijo) => {
      const estados = await repetir(60, () => head('academia-a', sufijo));
      expect(
        estados.filter((estado) => estado === 429),
        'los 60 primeros HEAD no reciben 429',
      ).toEqual([]);

      for (const ruta of RUTAS) {
        const respuesta = await get('academia-a', ruta);
        esLimite(respuesta, `GET ${ruta || '/'}`);
        expect(codigoDe(respuesta)).toBe('DEMASIADAS_SOLICITUDES');
      }
    },
  );

  it.each(RUTAS)(
    'criterio 49 b: 60 GET de /api/a/{nombreCorto}%s y después un HEAD de cualquiera de las dos rutas responde 429 con Cache-Control: no-store',
    async (sufijo) => {
      const estados = await repetir(60, () => get('academia-a', sufijo));
      expect(
        estados.filter((estado) => estado === 429),
        'los 60 primeros GET no reciben 429',
      ).toEqual([]);

      for (const ruta of RUTAS) esLimite(await head('academia-a', ruta), `HEAD ${ruta || '/'}`);
    },
  );

  it('criterio 49 b: pasado el límite el HEAD responde 429 antes de buscar la academia: una suspendida o inexistente también da 429, no 403 ni 404', async () => {
    await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');
    await repetir(60, () => get('academia-a'));

    esLimite(await head('academia-b'), 'HEAD de una academia suspendida');
    esLimite(await head('no-existe', '/inscripcion'), 'HEAD de una academia inexistente');
  });

  it('criterio 49 c: pasado el límite, un HEAD con un nombre corto que existe y uno con un nombre corto que no existe responden el mismo 429 (ya no se distingue una academia existente)', async () => {
    await repetir(60, () => head('academia-a'));

    const existe = await head('academia-a');
    const noExiste = await head('no-existe');
    const existeFormulario = await head('academia-a', '/inscripcion');
    const noExisteFormulario = await head('no-existe', '/inscripcion');

    for (const respuesta of [existe, noExiste, existeFormulario, noExisteFormulario]) esLimite(respuesta);
    expect([noExiste.status, existeFormulario.status, noExisteFormulario.status]).toEqual([existe.status, 429, 429]);
    const cabeceras = (respuesta: RespuestaApi) =>
      [...respuesta.headers.entries()].filter(([nombre]) => !['date', 'etag', 'x-request-id'].includes(nombre)).sort();
    expect(cabeceras(noExiste)).toEqual(cabeceras(existe));
  });

  it('criterio 49 d: mezclando GET y HEAD sobre las dos rutas, la petición número 61 del minuto es la primera en responder 429', async () => {
    const combinaciones: ['GET' | 'HEAD', (typeof RUTAS)[number]][] = [
      ['GET', ''],
      ['HEAD', ''],
      ['HEAD', '/inscripcion'],
      ['GET', '/inscripcion'],
      ['HEAD', '/inscripcion'],
      ['GET', ''],
      ['HEAD', ''],
    ];

    const estados = await repetir(61, (i) => {
      const [nombre, ruta] = combinaciones[i % combinaciones.length] as (typeof combinaciones)[number];
      return metodo(nombre, 'academia-a', ruta);
    });

    expect(
      estados.slice(0, 60).filter((estado) => estado === 429),
      'ninguna de las 60 primeras es 429',
    ).toEqual([]);
    expect(estados[60]).toBe(429);
  });

  it('criterio 49: el límite de HEAD no se salta con mayúsculas distintas ni con la barra final (el mismo contador que el GET)', async () => {
    const variantes = [
      '/api/a/ACADEMIA-A',
      '/api/a/academia-a/',
      '/api/a/ACADEMIA-A/INSCRIPCION',
      '/api/a/academia-a/Inscripcion/',
    ];
    const estados = [
      ...(await repetir(56, () => head())),
      ...(await repetir(4, (i) =>
        pedir(ctx, 'HEAD', variantes[i % variantes.length] as string, { headers: desde(IP) }),
      )),
    ];
    expect(estados.filter((estado) => estado === 429)).toEqual([]);

    esLimite(await get());
    esLimite(await head('academia-a', '/inscripcion'));
  });

  it('criterio 49: los HEAD de una IP no agotan el contador de lectura de otra IP', async () => {
    await repetir(60, () => head('academia-a', '', '203.0.113.10'));
    esLimite(await head('academia-a', '', '203.0.113.10'));

    expect((await head('academia-a', '', '203.0.113.11')).status).toBe(200);
    expect((await get('academia-a', '/inscripcion', '203.0.113.11')).status).toBe(200);
  });

  it('criterio 49: los HEAD nunca cuentan en los demás contadores: 30 HEAD de la cotización, 10 de la consulta y 10 del envío no agotan los de los POST', async () => {
    const rutaCotizacion = rutaPublica('academia-a', '/inscripcion/cotizacion');
    const rutaConsulta = rutaPublica('academia-a', '/solicitudes/consulta');
    const rutaEnvio = rutaPublica('academia-a', '/inscripcion');
    const cabeceras = desde(IP);
    // Un HEAD de una ruta que solo existe como POST no cuenta en el contador del POST.
    for (let i = 0; i < 30; i++) await pedir(ctx, 'HEAD', rutaCotizacion, { headers: cabeceras });
    for (let i = 0; i < 10; i++) await pedir(ctx, 'HEAD', rutaConsulta, { headers: cabeceras });
    // El HEAD de la ruta del formulario cuenta en la lectura, no en el envío (que es un POST).
    for (let i = 0; i < 10; i++) await pedir(ctx, 'HEAD', rutaEnvio, { headers: cabeceras });

    const cotizaciones = await repetir(30, () =>
      pedir(ctx, 'POST', rutaCotizacion, { headers: cabeceras, cuerpo: cuerpoCotizacion(e) }),
    );
    const consultas = await repetir(10, () =>
      pedir(ctx, 'POST', rutaConsulta, { headers: cabeceras, cuerpo: { basura: 1 } }),
    );
    const envios = await repetir(10, () =>
      pedir(ctx, 'POST', rutaEnvio, { headers: cabeceras, cuerpo: { basura: true } }),
    );

    expect(
      cotizaciones.every((estado) => estado === 200),
      `cotizaciones: ${cotizaciones.join(',')}`,
    ).toBe(true);
    expect(
      consultas.every((estado) => estado === 400),
      `consultas: ${consultas.join(',')}`,
    ).toBe(true);
    expect(
      envios.every((estado) => estado === 400),
      `envíos: ${envios.join(',')}`,
    ).toBe(true);
    // Y los contadores de los POST siguen siendo los suyos: el 31.º, el 11.º y el 11.º responden 429.
    esLimite(
      await pedir(ctx, 'POST', rutaCotizacion, { headers: cabeceras, cuerpo: cuerpoCotizacion(e) }),
      'cotización 31',
    );
    esLimite(await pedir(ctx, 'POST', rutaConsulta, { headers: cabeceras, cuerpo: { basura: 1 } }), 'consulta 11');
    esLimite(
      await pedir(ctx, 'POST', rutaEnvio, { headers: cabeceras, cuerpo: await cuerpoInscripcion(e) }),
      'envío 11',
    );
  });

  it('criterio 49: los POST no cuentan en la lectura: agotar la cotización no impide un GET ni un HEAD', async () => {
    const ruta = rutaPublica('academia-a', '/inscripcion/cotizacion');
    await repetir(31, () => pedir(ctx, 'POST', ruta, { headers: desde(IP), cuerpo: cuerpoCotizacion(e) }));

    expect((await get()).status).toBe(200);
    expect((await head()).status).toBe(200);
  });
});
