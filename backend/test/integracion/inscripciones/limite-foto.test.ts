// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';
import {
  AHORA_005,
  codigoDe,
  conRetencion,
  contarFilasDeInscripciones,
  crearEscenarioInscripcion,
  cuerpoCotizacion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  type RespuestaApi,
  rutaPublica,
  sembrarSolicitud,
  tokenAleatorio,
} from '../../utilidades/inscripciones';
import { desde, pedir } from '../../utilidades/inscripciones-ronda1';
import {
  type AppConAlmacen,
  archivosBajo,
  crearAppConAlmacen,
  exigirAlmacen,
  fotoClaveDe,
  png,
  subirFoto,
} from '../../utilidades/inscripciones-005b';

// Criterio 33, parte de la 005b (crítico, nota O2 de 001, DT-1 de 002, DT-7, respuesta R4; PB10): la regla `foto` cuenta `PUT /api/a/{nombreCorto}/solicitudes/foto`
// (también con mayúsculas distintas o barra final) por clave de conexión (`claveDeConexion(req.ip)`, criterio 59), 10 por hora, sumando todas las
// academias y con su propio contador. Pruebas, cada una con un almacén limpio: 10 subidas desde una conexión (válidas o rechazadas con 400, 404, 409 o
// 413) y la 11 responde 429 DEMASIADAS_SOLICITUDES con `Cache-Control: no-store`, sin leer el cuerpo (también con un `Content-Length` de 6 MB), sin buscar la
// academia ni abrir transacción; diez subidas desde direcciones distintas del mismo /64 agotan el contador, y 203.0.113.1 y ::ffff:203.0.113.1 lo
// comparten; agotar el de la foto no afecta a la consulta, al envío ni a las lecturas, ni al revés.

describe('límite por conexión de la foto (criterio 33, parte de la 005b)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioInscripcion;

  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    e = await crearEscenarioInscripcion();
    ctx = await crearAppConAlmacen({ conLimites: true, ipPorCabecera: true, ahora: AHORA_005 });
    exigirAlmacen(ctx);
  });
  afterEach(async () => {
    await ctx?.cerrarTodo();
  });

  /** Una subida cualquiera desde `ip` (por defecto, la de la prueba): con un token inexistente, así que sin límite responde 404. */
  const subir = (ip?: string, extra: Parameters<typeof subirFoto>[2] = {}, nombreCorto = 'academia-a') =>
    subirFoto(ctx, nombreCorto, {
      token: tokenAleatorio(),
      cuerpo: png(100, 100),
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
    expect(codigoDe(respuesta)).toBe('DEMASIADAS_SOLICITUDES');
    expect(respuesta.cacheControl).toBe('no-store');
  }

  const bloque = (n: number, bloqueDeLaRed = '1:2') => `2001:db8:${bloqueDeLaRed}::${n.toString(16)}`;

  it('criterio 33: 10 subidas desde una conexión, válidas o rechazadas con 400, 404, 409 o 413, no reciben 429 y la 11.ª responde 429 DEMASIADAS_SOLICITUDES con no-store, sin escribir', async () => {
    const buena = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    const otra = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    const vencida = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'CANCELADA' });
    const intentos: (() => Promise<RespuestaApi>)[] = [
      () => subir(undefined, { token: buena.token }), // 204
      () =>
        subir(undefined, { token: otra.token, tipo: 'image/jpeg', cuerpo: Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0]) }), // 400
      () => subir(undefined, { tipo: 'image/gif' }), // 400
      () => subir(), // 404
      () => subir(undefined, { token: null }), // 404
      () => subir(undefined, { token: vencida.token }), // 409
      () => subir(undefined, { cuerpo: Buffer.alloc(8), largoDeclarado: 6 * 1024 * 1024 }), // 413
      () => subir(undefined, {}, 'no-existe'), // 404 de la academia
      () => subir(undefined, { token: buena.token }), // 204 otra vez
      () => subir(), // 404
    ];

    const estados = await repetir(10, (i) => (intentos[i] as () => Promise<RespuestaApi>)());

    expect(
      estados.filter((estado) => estado === 429),
      'una de las 10 primeras recibió 429',
    ).toEqual([]);
    expect(estados).toEqual([204, 400, 400, 404, 404, 409, 413, 404, 204, 404]);
    const antes = await instantaneaDeInscripciones(e.A.id);
    const archivosAntes = archivosBajo(ctx.raiz);
    esLimite(await subir(undefined, { token: otra.token }), 'la 11.ª, con un token y una imagen válidos');
    expect(await instantaneaDeInscripciones(e.A.id)).toBe(antes);
    expect(archivosBajo(ctx.raiz)).toEqual(archivosAntes);
    expect(await fotoClaveDe(e.A.id, otra.alumnoId)).toBeNull();
  });

  it('criterio 33: el 429 llega antes de leer el cuerpo y antes de buscar la academia: un Content-Length de 6 MB, un tipo malo, una academia que no existe o suspendida también dan 429', async () => {
    await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');
    await repetir(10, () => subir());

    esLimite(
      await subir(undefined, { cuerpo: Buffer.alloc(8), largoDeclarado: 6 * 1024 * 1024, plazoMs: 8000 }),
      'Content-Length de 6 MB',
    );
    esLimite(await subir(undefined, { tipo: 'image/gif' }), 'tipo malo');
    esLimite(await subir(undefined, { codificacion: 'gzip' }), 'Content-Encoding');
    esLimite(await subir(undefined, {}, 'no-existe'), 'academia inexistente');
    esLimite(await subir(undefined, {}, 'academia-b'), 'academia suspendida');
  });

  it('criterio 33: pasado el límite, la subida no abre ninguna transacción: no espera el bloqueo del alumno que retiene la prueba', async () => {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
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

  it('criterio 33: el contador suma todas las academias: 5 subidas a A y 5 a B agotan el límite, y la 11.ª a cualquiera responde 429', async () => {
    await repetir(5, () => subir(undefined, {}, 'academia-a'));
    await repetir(5, () => subir(undefined, {}, 'academia-b'));

    esLimite(await subir(undefined, {}, 'academia-a'));
    esLimite(await subir(undefined, {}, 'academia-b'));
    esLimite(await subir(undefined, {}, 'no-existe'));
  });

  it('criterio 33: la dirección con otras mayúsculas o con barra final cuenta en el mismo contador', async () => {
    await repetir(4, () => subir());
    await repetir(3, () => subir(undefined, { ruta: '/api/a/academia-a/Solicitudes/FOTO' }));
    await repetir(3, () => subir(undefined, { ruta: '/api/a/academia-a/solicitudes/foto/' }));

    esLimite(await subir(), 'la 11.ª');
  });

  it('criterio 33: otros métodos sobre la dirección de la foto no cuentan en el contador de la foto', async () => {
    await repetir(10, () => subirFoto(ctx, 'academia-a', { metodo: 'GET', tipo: null }));
    await repetir(5, () =>
      subirFoto(ctx, 'academia-a', { metodo: 'POST', token: tokenAleatorio(), cuerpo: png(100, 100) }),
    );

    expect((await subir()).status).toBe(404);
  });

  it('criterio 33: las IP distintas tienen contadores separados: 10 subidas desde 203.0.113.1 agotan solo el suyo', async () => {
    await repetir(10, () => subir('203.0.113.1'));

    esLimite(await subir('203.0.113.1'));
    expect((await subir('203.0.113.2')).status).toBe(404);
  });

  describe('clave de conexión (criterio 59)', () => {
    it('criterio 33: 10 subidas desde 10 direcciones distintas de 2001:db8:1:2::/64 agotan el contador: la 11.ª, desde otra dirección del mismo bloque, responde 429; desde 2001:db8:1:3::1 no', async () => {
      const estados = await repetir(10, (i) => subir(bloque(i + 1)));
      expect(estados.filter((estado) => estado === 429)).toEqual([]);

      esLimite(await subir(bloque(500)), 'otra dirección del mismo bloque');
      expect((await subir('2001:db8:1:3::1')).status, 'otro bloque').toBe(404);
    });

    it('criterio 33: las formas escritas distinto de la misma dirección cuentan en el mismo bloque', async () => {
      const formas = [
        '2001:db8:1:2::1',
        '2001:DB8:1:2::1',
        '2001:0db8:0001:0002:ffff:ffff:ffff:ffff',
        '2001:db8:1:2:0:0:0:abc',
      ];
      await repetir(10, (i) => subir(formas[i % formas.length]));

      esLimite(await subir('2001:db8:1:2::77'));
    });

    it('criterio 33: 203.0.113.1 y ::ffff:203.0.113.1 comparten el contador (5 subidas desde cada forma y la 11.ª responde 429); 203.0.113.2 tiene el suyo', async () => {
      await repetir(5, () => subir('203.0.113.1'));
      await repetir(5, () => subir('::ffff:203.0.113.1'));

      esLimite(await subir('203.0.113.1'));
      esLimite(await subir('::ffff:203.0.113.1'));
      expect((await subir('203.0.113.2')).status).toBe(404);
    });
  });

  describe('contadores separados', () => {
    const consultar = () =>
      ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { token: tokenAleatorio() });
    const cotizar = () => ctx.http.post(rutaPublica('academia-a', '/inscripcion/cotizacion'), cuerpoCotizacion(e));
    const enviarInvalido = () => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), { basura: true });
    const leer = () => ctx.http.get(rutaPublica('academia-a'));

    it('criterio 33: agotar el límite de la foto no afecta a la consulta, a la cotización, al envío ni a las lecturas', async () => {
      await repetir(10, () => subir());
      esLimite(await subir());

      expect((await consultar()).status, 'consulta').toBe(404);
      expect((await cotizar()).status, 'cotización').toBe(200);
      expect((await enviarInvalido()).status, 'envío').toBe(400);
      expect((await leer()).status, 'lectura').toBe(200);
      expect((await ctx.http.get(rutaPublica('academia-a', '/inscripcion'))).status, 'formulario').toBe(200);
    });

    it('criterio 33: agotar la consulta (10 por minuto) no afecta a la foto', async () => {
      await repetir(10, consultar);
      esLimite(await consultar());

      expect((await subir()).status).toBe(404);
    });

    it('criterio 33: agotar el envío (10 por hora) no afecta a la foto', async () => {
      await repetir(10, enviarInvalido);
      esLimite(await enviarInvalido());

      expect((await subir()).status).toBe(404);
    });

    it('criterio 33: agotar la cotización (30 por minuto) y las lecturas (60 por minuto) no afecta a la foto', async () => {
      await repetir(30, cotizar);
      esLimite(await cotizar());
      await repetir(60, leer);
      esLimite(await leer());

      expect((await subir()).status).toBe(404);
    });

    it('criterio 33: 10 subidas no restan nada a las 60 lecturas: las 60 dan 200 y la 61.ª (un HEAD) da 429', async () => {
      await repetir(10, () => subir());

      const estados = await repetir(60, () => leer());

      expect(estados.filter((estado) => estado !== 200)).toEqual([]);
      const cabeza = await pedir(ctx, 'HEAD', rutaPublica('academia-a'));
      expect(cabeza.status).toBe(429);
    });
  });

  it('criterio 33: las subidas rechazadas por el límite no se cuentan como filas: B y A no cambian', async () => {
    await repetir(10, () => subir());
    const antes = await contarFilasDeInscripciones(e.A.id);

    esLimite(await subir());

    expect(await contarFilasDeInscripciones(e.A.id)).toEqual(antes);
  });
});
