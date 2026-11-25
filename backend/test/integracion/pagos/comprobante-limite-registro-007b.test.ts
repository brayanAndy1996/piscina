// spec: 007-pagos (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  png,
  subirFoto,
} from '../../utilidades/inscripciones-005b';
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
