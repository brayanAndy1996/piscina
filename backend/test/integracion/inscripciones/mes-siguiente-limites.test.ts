// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cookiesDePagos, crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import {
  cuerpoDeCotizacion,
  cuerpoParaMes,
  enviarPublico,
  INSTANTE,
  MES_DIC,
  rutaFormulario,
  rutaMeses,
} from '../../utilidades/escenario-mes-siguiente';
import {
  type AppInscripciones,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  leerSolicitudes,
  type RespuestaApi,
  rutaPublica,
  VEINTICUATRO_HORAS,
} from '../../utilidades/inscripciones';
import { crearAppConIpPorCabecera, desde, pedir } from '../../utilidades/inscripciones-ronda1';
import { contarAuditoria, fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 14 (crítico, criterios 25, 28, 33 y 49 de 005, criterio 33 de 007): `GET /api/a/{nombreCorto}/inscripcion/meses` cuenta en la regla `lectura` de `LIMITES_PUBLICOS` (60 por minuto por clave de conexión, también con `HEAD`, mayúsculas distintas o barra final), y `?mes=` no saca al `GET` del formulario de su regla. Las solicitudes de M+1 cuentan en el límite de 5 reservas
// sin pagar por conexión (criterio 25 de 005). Las peticiones de recepción no cuentan (criterio 33 de 007). El registro técnico de estas rutas no lleva DNI, nombres, datos médicos, token ni cuerpo (criterio 28 de 005).
// Lecturas estrictas elegidas: (1) la IP de cada petición se fija con `X-Forwarded-For` (como en las pruebas de la 005); (2) «60 por minuto» se prueba con 60 peticiones que no reciben 429 y la 61.ª, que sí; (3) los demás contadores (cotización, envío) no cambian.

const IP = '203.0.113.10';
const OTRA_IP = '203.0.113.77';

describe('el límite de lectura de /inscripcion/meses y del formulario con ?mes= (criterio 14)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    e = await crearEscenarioInscripcion();
    ctx = await crearAppConIpPorCabecera({ conLimites: true, ahora: INSTANTE.viernes27 });
  });
  afterEach(async () => {
    await ctx?.http.cerrar();
  });

  const get = (ruta: string, ip = IP) => pedir(ctx, 'GET', ruta, { headers: desde(ip) });
  const head = (ruta: string, ip = IP) => pedir(ctx, 'HEAD', ruta, { headers: desde(ip) });
  const raiz = (nombreCorto = 'academia-a') => rutaPublica(nombreCorto);

  async function repetir(n: number, pedirUna: (i: number) => Promise<RespuestaApi>): Promise<number[]> {
    const estados: number[] = [];
    for (let i = 0; i < n; i++) estados.push((await pedirUna(i)).status);
    return estados;
  }
  /** 429 con `Cache-Control: no-store`; un `HEAD` no lleva cuerpo, así que su código no se mira. */
  function esLimite(respuesta: RespuestaApi, descripcion = ''): void {
    expect(respuesta.status, `${descripcion} ${respuesta.texto}`).toBe(429);
    if (!descripcion.toUpperCase().includes('HEAD'))
      expect(codigoDe(respuesta), descripcion).toBe('DEMASIADAS_SOLICITUDES');
    expect(respuesta.cacheControl, descripcion).toBe('no-store');
  }

  it('criterio 14: 60 GET de /inscripcion/meses no reciben 429 y el 61.º sí (DEMASIADAS_SOLICITUDES con Cache-Control: no-store)', async () => {
    const estados = await repetir(60, () => get(rutaMeses()));

    expect(
      estados.filter((estado) => estado !== 200),
      'las 60 primeras responden 200',
    ).toEqual([]);
    esLimite(await get(rutaMeses()), 'GET /inscripcion/meses');
  });

  it('criterio 14: /inscripcion/meses comparte el contador `lectura` con GET de la academia y GET del formulario (con y sin `?mes=`): 20 de cada una suman 60 y la siguiente de cualquiera responde 429', async () => {
    const formas = [() => get(raiz()), () => get(rutaFormulario('academia-a', '?mes=2026-12')), () => get(rutaMeses())];
    const estados = await repetir(60, (i) => (formas[i % 3] as () => Promise<RespuestaApi>)());

    expect(
      estados.filter((estado) => estado === 429),
      'las 60 primeras no reciben 429',
    ).toEqual([]);
    esLimite(await get(rutaMeses()), 'meses');
    esLimite(await get(raiz()), 'academia');
    esLimite(await get(rutaFormulario('academia-a')), 'formulario');
  });

  it('criterio 14: también cuentan HEAD, otras mayúsculas y la barra final: 15 GET, 15 HEAD, 15 con otras mayúsculas y 15 con barra final suman 60, y la siguiente (GET o HEAD) responde 429', async () => {
    const formas = [
      () => get(rutaMeses()),
      () => head(rutaMeses()),
      () => get('/api/a/academia-a/Inscripcion/MESES'),
      () => get(`${rutaMeses()}/`),
    ];
    const estados = await repetir(60, (i) => (formas[i % 4] as () => Promise<RespuestaApi>)());

    expect(
      estados.filter((estado) => estado === 429),
      'las 60 primeras no reciben 429',
    ).toEqual([]);
    esLimite(await head(rutaMeses()), 'HEAD');
    esLimite(await get(rutaMeses()), 'GET');
    esLimite(await get('/api/a/ACADEMIA-A/inscripcion/meses/'), 'mayúsculas y barra');
  });

  it('criterio 14: pasado el límite, el 429 llega antes de buscar la academia: una suspendida o inexistente también da 429 (no 403 ni 404)', async () => {
    await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');
    await repetir(60, () => get(rutaMeses()));

    esLimite(await get(rutaMeses('academia-b')), 'suspendida');
    esLimite(await get(rutaMeses('no-existe')), 'inexistente');
    esLimite(await head(rutaMeses('no-existe')), 'HEAD inexistente');
  });

  it('criterio 14: el contador es por conexión: agotado el de una IP, otra IP sigue leyendo (200), y el de la cotización no se gasta con las lecturas', async () => {
    await repetir(60, () => get(rutaMeses()));

    const otraIp = await get(rutaMeses(), OTRA_IP);
    const cotizacion = await ctx.http.post(
      rutaPublica('academia-a', '/inscripcion/cotizacion'),
      cuerpoDeCotizacion({ planId: e.plan.id, claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id], mes: MES_DIC }),
      { headers: desde(IP) },
    );

    expect(otraIp.status, otraIp.texto).toBe(200);
    expect(cotizacion.status, cotizacion.texto).not.toBe(429);
  });

  describe('`?mes=` no saca al GET del formulario de su regla', () => {
    it.each([
      ['un mes de inscripción', '?mes=2026-12'],
      ['el mes en curso', '?mes=2026-11'],
      ['un mes mal escrito (400)', '?mes=diciembre'],
      ['un mes repetido (400)', '?mes=2026-11&mes=2026-12'],
    ])(
      'criterio 14: 60 GET del formulario con %s y el siguiente, con o sin `mes`, responde 429',
      async (_nombre, consulta) => {
        const estados = await repetir(60, () => get(rutaFormulario('academia-a', consulta)));

        expect(
          estados.filter((estado) => estado === 429),
          'las 60 primeras no reciben 429',
        ).toEqual([]);
        esLimite(await get(rutaFormulario('academia-a', consulta)), `con ${consulta}`);
        esLimite(await get(rutaFormulario('academia-a')), 'sin mes');
        esLimite(await head(rutaFormulario('academia-a', '?mes=2026-12')), 'HEAD con mes');
        esLimite(await get(rutaMeses()), 'meses');
      },
    );

    it('criterio 14: 60 lecturas sin `mes` y después una con `?mes=` (válido, repetido o mal escrito) responden 429: el parámetro no abre otro contador', async () => {
      await repetir(60, () => get(rutaFormulario('academia-a')));

      for (const consulta of [
        '?mes=2026-12',
        '?mes=2026-11',
        '?mes=nada',
        '?mes=2026-12&mes=2026-12',
        '?mes=2026-12&academiaId=x',
      ]) {
        esLimite(await get(rutaFormulario('academia-a', consulta)), consulta);
      }
    });
  });
});

describe('las solicitudes de M+1 y el límite de 5 reservas sin pagar por conexión (criterio 14)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ ahora: INSTANTE.viernes27 });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(INSTANTE.viernes27);
    e = await crearEscenarioDePagos();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const deDiciembre = async () => enviarPublico(ctx, await cuerpoParaMes(e, MES_DIC));
  const deNoviembre = async () => enviarPublico(ctx, await cuerpoInscripcion(e, { ahora: INSTANTE.viernes27 }));

  it('criterio 14: con 5 solicitudes de diciembre activas desde la misma conexión, la sexta responde 409 LIMITE_DE_RESERVAS_PENDIENTES y no escribe ni audita', async () => {
    for (let i = 0; i < 5; i++) {
      const respuesta = await deDiciembre();
      expect(respuesta.status, `reserva ${i + 1}: ${respuesta.texto}`).toBe(201);
    }
    const antes = { solicitudes: (await leerSolicitudes(e.A.id)).length, auditoria: await contarAuditoria(e.A.id) };

    const sexta = await deDiciembre();

    expect([sexta.status, codigoDe(sexta)], sexta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
    expect({ solicitudes: (await leerSolicitudes(e.A.id)).length, auditoria: await contarAuditoria(e.A.id) }).toEqual(
      antes,
    );
  });

  it('criterio 14: las solicitudes de noviembre y de diciembre suman en el mismo límite: 2 de noviembre y 3 de diciembre dejan sin lugar a la sexta, sea del mes que sea', async () => {
    for (const enviar of [deNoviembre, deNoviembre, deDiciembre, deDiciembre, deDiciembre]) {
      const respuesta = await enviar();
      expect(respuesta.status, respuesta.texto).toBe(201);
    }

    const deDic = await deDiciembre();
    const deNov = await deNoviembre();

    expect([deDic.status, codigoDe(deDic)]).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
    expect([deNov.status, codigoDe(deNov)]).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
  });

  it('criterio 14: las reservas de diciembre vencidas (pasadas las 24 horas) ya no cuentan: la sexta entra', async () => {
    for (let i = 0; i < 5; i++) expect((await deDiciembre()).status).toBe(201);
    expect(codigoDe(await deDiciembre())).toBe('LIMITE_DE_RESERVAS_PENDIENTES');

    ctx.reloj.avanzar(VEINTICUATRO_HORAS);
    const despues = await deDiciembre();

    expect(despues.status, despues.texto).toBe(201);
  });

  it('criterio 14: las peticiones de recepción no cuentan: la secretaria envía 7 solicitudes de diciembre desde la misma conexión (201) y un anónimo todavía envía 5, y recién la sexta responde 409 LIMITE_DE_RESERVAS_PENDIENTES', async () => {
    const cookie = cookiesDePagos(e, INSTANTE.viernes27).secretaria;
    for (let i = 0; i < 7; i++) {
      const respuesta = await enviarPublico(ctx, await cuerpoParaMes(e, MES_DIC), { cookie });
      expect(respuesta.status, `recepción ${i + 1}: ${respuesta.texto}`).toBe(201);
    }

    for (let i = 0; i < 5; i++) expect((await deDiciembre()).status, `anónimo ${i + 1}`).toBe(201);
    const sexta = await deDiciembre();

    expect([sexta.status, codigoDe(sexta)], sexta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
  });
});
