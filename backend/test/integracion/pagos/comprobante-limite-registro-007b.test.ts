// spec: 007-pagos (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEXTO_REDACTADO } from '../../../src/infraestructura/registro/opciones-registro';
import {
  AHORA_007,
  codigoDeRespuesta,
  crearEscenarioDePagos,
  type EscenarioPagos,
  exigirRutasDePagos,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  datosDeComprobante,
  exigirRutasDe007b,
  instantaneaConArchivos,
  sembrarEnVerificacion,
  subirComprobante,
} from '../../utilidades/escenario-pagos-007b';
import { desde, pedir } from '../../utilidades/inscripciones-ronda1';
import {
  conRetencion,
  cuerpoCotizacion,
  type RespuestaApi,
  rutaPublica,
  tokenAleatorio,
} from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  jpeg,
  png,
  subirFoto,
  TEXTO_MARCADO,
} from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { leerPagos } from '../../utilidades/pagos';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 43 (crítico, criterios 28, 33, 53 y 59 de 005): la regla `comprobante` cuenta `PUT /api/a/{nombreCorto}/solicitudes/comprobante` (con mayúsculas distintas o barra final) por clave de conexión, sumando todas las
// academias, con su propio contador (agotarla no afecta a las demás ni al revés), 10 por hora como la foto; la 11.ª responde 429 `DEMASIADAS_SOLICITUDES` con `Cache-Control: no-store`, sin leer el cuerpo. Las cabeceras
// `X-Token-Solicitud` y `X-Pago-Datos` se redactan en todo el registro técnico; ninguna línea lleva el token, el DNI, el número de operación, el monto declarado ni el contenido de la imagen.

describe('límite por conexión del comprobante (criterio 43)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;

  beforeEach(async () => {
    e = await crearEscenarioDePagos();
    ctx = await crearAppConAlmacen({ conLimites: true, ipPorCabecera: true, ahora: AHORA_007 });
    exigirAlmacen(ctx);
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
  });
  afterEach(async () => {
    await ctx?.cerrarTodo();
  });

  /** Una subida cualquiera desde `ip`: con un token inexistente, así que sin límite responde 404. */
  const subir = (ip?: string, extra: Parameters<typeof subirComprobante>[2] = {}, nombreCorto = 'academia-a') =>
    subirComprobante(ctx, nombreCorto, {
      token: tokenAleatorio(),
      datos: datosDeComprobante(),
      headers: ip ? desde(ip) : {},
      ...extra,
    });

  async function repetir(n: number, hacer: (i: number) => Promise<RespuestaApi>): Promise<number[]> {
    const estados: number[] = [];
    for (let i = 0; i < n; i++) estados.push((await hacer(i)).status);
    return estados;
  }

  function esLimite(respuesta: RespuestaApi, descripcion = ''): void {
    expect(respuesta.status, `${descripcion} ${respuesta.texto}`).toBe(429);
    expect(codigoDeRespuesta(respuesta)).toBe('DEMASIADAS_SOLICITUDES');
    expect(respuesta.cacheControl).toBe('no-store');
  }

  it('criterio 43: 10 subidas desde una conexión, buenas o rechazadas con 400, 404, 409 o 413, no reciben 429 y la 11.ª responde 429 DEMASIADAS_SOLICITUDES con no-store, sin escribir', async () => {
    const buena = await sembrarCobrable(e);
    const otra = await sembrarCobrable(e);
    const vencida = await sembrarCobrable(e, { estado: 'CANCELADA' });
    const libre = await sembrarCobrable(e);
    const intentos: (() => Promise<RespuestaApi>)[] = [
      () => subir(undefined, { token: buena.token }), // 201
      () => subir(undefined, { token: otra.token, cuerpo: Buffer.from('basura') }), // 400 imagen
      () => subir(undefined, { tipo: 'image/gif' }), // 400 tipo
      () => subir(), // 404 token
      () => subir(undefined, { token: null }), // 404 sin token
      () => subir(undefined, { token: vencida.token }), // 409
      () => subir(undefined, { cuerpo: Buffer.alloc(8), largoDeclarado: 6 * 1024 * 1024, plazoMs: 8000 }), // 413
      () => subir(undefined, {}, 'no-existe'), // 404 academia
      () => subir(undefined, { token: otra.token, datos: datosDeComprobante({ monto: 'x' }) }), // 400 datos
      () => subir(), // 404
    ];

    const estados = await repetir(10, (i) => (intentos[i] as () => Promise<RespuestaApi>)());

    expect(estados.filter((estado) => estado === 429)).toEqual([]);
    expect(estados).toEqual([201, 400, 400, 404, 404, 409, 413, 404, 400, 404]);
    const antes = await instantaneaConArchivos(ctx, e);
    esLimite(await subir(undefined, { token: libre.token }), 'la 11.ª, con un token y una imagen válidos');
    expect(await instantaneaConArchivos(ctx, e)).toBe(antes);
    expect(await leerPagos(e.A.id)).toHaveLength(1);
  });

  it('criterio 43: el 429 llega antes de leer el cuerpo, de los datos y de buscar la academia: un Content-Length de 6 MB, un tipo malo, sin datos, una academia que no existe o suspendida también dan 429', async () => {
    await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');
    await repetir(10, () => subir());

    esLimite(
      await subir(undefined, { cuerpo: Buffer.alloc(8), largoDeclarado: 6 * 1024 * 1024, plazoMs: 8000 }),
      '6 MB',
    );
    esLimite(await subir(undefined, { tipo: 'image/gif' }), 'tipo malo');
    esLimite(await subir(undefined, { codificacion: 'gzip' }), 'Content-Encoding');
    esLimite(await subir(undefined, { datos: null }), 'sin X-Pago-Datos');
    esLimite(await subir(undefined, {}, 'no-existe'), 'academia inexistente');
    esLimite(await subir(undefined, {}, 'academia-b'), 'academia suspendida');
  });

  it('criterio 43: pasado el límite, la subida no abre ninguna transacción: no espera el bloqueo del alumno que retiene la prueba', async () => {
    const cliente = await sembrarCobrable(e);
    await repetir(10, () => subir());

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: async (retenedor) => {
        await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
          e.A.id,
          cliente.alumnoId,
        ]);
      },
      enviar: [() => subir(undefined, { token: cliente.token })],
      liberar: 'ROLLBACK',
    });

    expect(todasEsperaron, 'la petición esperó un bloqueo: abrió una transacción').toBe(false);
    esLimite(resultados[0] as RespuestaApi);
  });

  it('criterio 43: el contador suma todas las academias: 5 subidas a A y 5 a B agotan el límite, y la 11.ª a cualquiera responde 429', async () => {
    await repetir(5, () => subir(undefined, {}, 'academia-a'));
    await repetir(5, () => subir(undefined, {}, 'academia-b'));

    esLimite(await subir(undefined, {}, 'academia-a'));
    esLimite(await subir(undefined, {}, 'academia-b'));
    esLimite(await subir(undefined, {}, 'no-existe'));
  });

  it('criterio 43: la dirección con otras mayúsculas o con barra final cuenta en el mismo contador', async () => {
    await repetir(4, () => subir());
    await repetir(3, () => subir(undefined, { ruta: '/api/a/academia-a/Solicitudes/COMPROBANTE' }));
    await repetir(3, () => subir(undefined, { ruta: '/api/a/academia-a/solicitudes/comprobante/' }));

    esLimite(await subir(), 'la 11.ª');
  });

  it('criterio 43: otros métodos sobre la dirección del comprobante no cuentan en su contador', async () => {
    const cliente = await sembrarCobrable(e);
    await repetir(10, () => subirComprobante(ctx, 'academia-a', { metodo: 'GET', tipo: null, datos: null }));
    await repetir(5, () => subirComprobante(ctx, 'academia-a', { metodo: 'POST', token: tokenAleatorio() }));

    expect((await subir(undefined, { token: cliente.token })).status, 'la subida real sigue siendo posible').toBe(201);
  });

  it('criterio 43: las IP distintas tienen contadores separados: 10 subidas desde 203.0.113.1 agotan solo el suyo', async () => {
    await repetir(10, () => subir('203.0.113.1'));

    esLimite(await subir('203.0.113.1'));
    expect((await subir('203.0.113.2')).status).toBe(404);
  });

  describe('su propio contador', () => {
    const consultar = () =>
      ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { token: tokenAleatorio() });
    const subirLaFoto = () => subirFoto(ctx, 'academia-a', { token: tokenAleatorio(), cuerpo: png(100, 100) });
    const cotizar = () => ctx.http.post(rutaPublica('academia-a', '/inscripcion/cotizacion'), cuerpoCotizacion(e));
    const leer = () => ctx.http.get(rutaPublica('academia-a'));

    it('criterio 43: agotar el comprobante no afecta a la foto, a la consulta, a la cotización ni a las lecturas', async () => {
      await repetir(10, () => subir());
      esLimite(await subir());

      expect((await subirLaFoto()).status, 'foto').toBe(404);
      expect((await consultar()).status, 'consulta').toBe(404);
      expect((await cotizar()).status, 'cotización').toBe(200);
      expect((await leer()).status, 'lectura').toBe(200);
    });

    it('criterio 43: agotar la foto (10 subidas) no afecta al comprobante, ni agotar la consulta', async () => {
      await repetir(10, () => subirLaFoto());
      esLimite(await subirLaFoto());
      expect((await subir()).status, 'comprobante con la foto agotada').toBe(404);

      await repetir(10, () => consultar());
      esLimite(await consultar());
      expect((await subir()).status, 'comprobante con la consulta agotada').toBe(404);
    });

    it('criterio 43: 10 subidas de comprobante no restan nada a las 60 lecturas: las 60 dan 200 y la 61.ª (un HEAD) da 429', async () => {
      await repetir(10, () => subir());

      const estados = await repetir(60, () => leer());

      expect(estados.filter((estado) => estado !== 200)).toEqual([]);
      expect((await pedir(ctx, 'HEAD', rutaPublica('academia-a'))).status).toBe(429);
    });
  });
});

describe('el registro técnico del comprobante no lleva datos sensibles (criterio 43)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({
      nivelRegistro: 'trace',
      destinoRegistro: destino,
      conLimites: true,
      // La IP sale de `X-Forwarded-For`: la prueba agota las 10 subidas por hora desde su propia IP y las demás no se ven afectadas.
      ipPorCabecera: true,
      ahora: AHORA_007,
    });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  /** Cada valor de `x-pago-datos` y de `x-token-solicitud` que aparece en una línea está redactado; devuelve cuántos hay de cada uno. */
  function cabecerasRedactadas(todas: readonly string[]): { datos: number; token: number } {
    const cuenta = { datos: 0, token: 0 };
    for (const linea of todas) {
      for (const [cabecera, clave] of [
        ['x-pago-datos', 'datos'],
        ['x-token-solicitud', 'token'],
      ] as const) {
        for (const coincidencia of linea.matchAll(new RegExp(`"${cabecera}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g'))) {
          expect(coincidencia[1], `${cabecera} sin redactar en: ${linea.slice(0, 300)}`).toBe(TEXTO_REDACTADO);
          cuenta[clave] += 1;
        }
      }
    }
    return cuenta;
  }

  it('criterio 43: una subida correcta y una rechazada de cada tipo (400 datos, 400 imagen, 404, 409, 413 y 429) no dejan token, DNI, número de operación, monto, clave, texto marcado ni contenido de la imagen en el registro', async () => {
    const dni = '47811902';
    const cliente = await sembrarCobrable(e, {
      dni,
      nombres: 'Zenobia',
      apellidos: 'Quillahuaman Torrico',
      monto: '77.00',
    });
    const otro = await sembrarCobrable(e, { monto: '77.00' });
    const cancelada = await sembrarCobrable(e, { estado: 'CANCELADA' });
    const enRevision = await sembrarEnVerificacion(e, { monto: '77.00', numeroOperacion: '5550001' });
    const numero = '9087654321';
    const datos = datosDeComprobante({ numeroOperacion: numero, monto: '77.00' });
    const foto = await jpeg(600, 400, { gps: true, comentario: TEXTO_MARCADO, orientacion: 1 });
    const referer = (token: string) => `https://academia.test/a/academia-a/solicitud/${token}`;
    const subir = (token: string, extra: Parameters<typeof subirComprobante>[2] = {}) =>
      subirComprobante(ctx, 'academia-a', {
        token,
        datos,
        cuerpo: foto,
        tipo: 'image/jpeg',
        headers: { referer: referer(token), ...desde('203.0.113.43') },
        ...extra,
      });

    const correcta = await subir(cliente.token);
    const datosMalos = await subir(otro.token, {
      datos: datosDeComprobante({ numeroOperacion: numero, monto: 'abc' }),
    });
    const imagenMala = await subir(otro.token, { cuerpo: png(99, 99), tipo: 'image/png' });
    const montoDistinto = await subir(otro.token, {
      datos: datosDeComprobante({ numeroOperacion: '9087654322', monto: '70.00' }),
    });
    const noEncontrada = await subir(tokenAleatorio());
    const noEditable = await subir(cancelada.token);
    const yaEnRevision = await subir(enRevision.token);
    const grande = await subir(cliente.token, {
      cuerpo: Buffer.alloc(8),
      largoDeclarado: 6 * 1024 * 1024,
      plazoMs: 8000,
    });
    expect([
      correcta.status,
      datosMalos.status,
      imagenMala.status,
      montoDistinto.status,
      noEncontrada.status,
      noEditable.status,
      yaEnRevision.status,
      grande.status,
    ]).toEqual([201, 400, 400, 409, 404, 409, 409, 413]);
    // Con 8 subidas hechas, dos más agotan las 10 por hora y la siguiente responde 429.
    for (let i = 0; i < 2; i++) await subir(tokenAleatorio());
    const limite = await subir(cliente.token);
    expect(limite.status, limite.texto).toBe(429);
    await esperarHasta(() => lineas.some((linea) => linea.includes('"statusCode":429')));

    expect(lineas.length, 'la aplicación escribió registros').toBeGreaterThan(0);
    const todo = lineas.join('\n');
    const sensibles: Record<string, string> = {
      token: cliente.token,
      tokenDeLaCancelada: cancelada.token,
      dni,
      nombres: 'Zenobia',
      apellidos: 'Quillahuaman',
      numeroDeOperacion: numero,
      numeroDeOperacionDelOtroPago: '5550001',
      montoDeclarado: '77.00',
      clave: String(datos['claveIdempotencia']),
      enlaceDeSeguimiento: referer(cliente.token),
      textoMarcado: TEXTO_MARCADO,
      coordenadas: 'GPS',
      exif: 'Exif',
    };
    for (const [nombre, valor] of Object.entries(sensibles)) {
      expect(todo, `el registro lleva ${nombre}`).not.toContain(valor);
    }
    for (const trozo of [foto.subarray(0, 48), foto.subarray(200, 248), foto.subarray(foto.length - 48)]) {
      expect(todo, 'el registro lleva el contenido de la imagen en base64').not.toContain(trozo.toString('base64'));
      expect(todo, 'el registro lleva el contenido de la imagen en hexadecimal').not.toContain(trozo.toString('hex'));
      expect(todo, 'el registro lleva el contenido de la imagen en base64url').not.toContain(
        trozo.toString('base64url'),
      );
    }
    expect(todo, 'el registro lleva el encabezado JPEG en base64').not.toContain('/9j/4');
    const redactadas = cabecerasRedactadas(lineas);
    expect(redactadas.datos, 'ninguna línea de petición lleva req.headers["x-pago-datos"] redactado').toBeGreaterThan(
      0,
    );
    expect(
      redactadas.token,
      'ninguna línea de petición lleva req.headers["x-token-solicitud"] redactado',
    ).toBeGreaterThan(0);
    expect(todo).toContain(TEXTO_REDACTADO);
    expect(todo, 'la petición se anota con su dirección sin datos').toContain('/solicitudes/comprobante');
  });

  it('criterio 43: un X-Pago-Datos enviado a otra ruta (GET /api/a/{nombreCorto}, la consulta, una ruta que no existe y una del panel) también se redacta', async () => {
    const secreto = datosDeComprobante({ numeroOperacion: '6670001', monto: '88.00' });
    const cabecera = JSON.stringify(secreto);
    const conDatos = { 'x-pago-datos': cabecera };
    const peticiones = [
      pedir(ctx, 'GET', rutaPublica('academia-a'), { headers: conDatos }),
      pedir(ctx, 'POST', rutaPublica('academia-a', '/solicitudes/consulta'), {
        headers: conDatos,
        cuerpo: { token: tokenAleatorio() },
      }),
      pedir(ctx, 'GET', rutaPublica('no-existe'), { headers: conDatos }),
      pedir(ctx, 'GET', '/api/clases', { headers: conDatos }),
    ];
    const estados = (await Promise.all(peticiones)).map((r) => r.status);
    expect(estados.slice(0, 3)).toEqual([200, 404, 404]);
    await esperarHasta(() => lineas.some((linea) => linea.includes('/solicitudes/consulta')));
    await new Promise((resolver) => setTimeout(resolver, 150));

    const todo = lineas.join('\n');
    expect(todo, 'el registro lleva los datos del pago').not.toContain('6670001');
    expect(todo).not.toContain(String(secreto['claveIdempotencia']));
    expect(cabecerasRedactadas(lineas).datos).toBeGreaterThanOrEqual(3);
  });
});
