// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  conRetencion,
  contarFilasDeInscripciones,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoCotizacion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  type RespuestaApi,
  retenerClases,
  rutaPublica,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';

// Criterio 33 (crítico, nota O2 de 001, DT-1 de 002): las rutas públicas de `/api/a` cuentan las peticiones por IP con el almacén de
// `@nestjs/throttler`, antes de leer el cuerpo y antes de buscar la academia (como el ingreso de 002), sumando todas las academias, con
// estos límites: `GET /api/a/{nombreCorto}` y `GET /api/a/{nombreCorto}/inscripcion`, 60 por minuto en total; la cotización, 30 por minuto;
// el envío, 10 por hora; la consulta de seguimiento, 10 por minuto. El límite de 10 por minuto del ingreso (002) no cambia. Pasado el
// límite responde 429 DEMASIADAS_SOLICITUDES con `Cache-Control: no-store`, sin leer el cuerpo, sin abrir transacción y sin escribir. Cada
// límite tiene su contador: agotar uno no afecta a los otros. (El límite de la foto, 10 por hora, es de la 005b.) Cada prueba crea su
// aplicación y arranca con los contadores en cero.

describe('límites por IP de las rutas públicas (criterio 33)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    e = await crearEscenarioInscripcion();
    ctx = await crearAppInscripciones({ conLimites: true, ahora: AHORA_005 });
  });
  afterEach(async () => {
    await ctx?.http.cerrar();
  });

  const lectura = (nombreCorto = 'academia-a') => ctx.http.get(rutaPublica(nombreCorto));
  const formulario = (nombreCorto = 'academia-a') => ctx.http.get(rutaPublica(nombreCorto, '/inscripcion'));
  const cotizar = (cuerpo: unknown = cuerpoCotizacion(e), nombreCorto = 'academia-a') =>
    ctx.http.post(rutaPublica(nombreCorto, '/inscripcion/cotizacion'), cuerpo);
  const enviar = (cuerpo: unknown, nombreCorto = 'academia-a') =>
    ctx.http.post(rutaPublica(nombreCorto, '/inscripcion'), cuerpo);
  const consultar = (cuerpo: unknown = { token: 'A'.repeat(43) }, nombreCorto = 'academia-a') =>
    ctx.http.post(rutaPublica(nombreCorto, '/solicitudes/consulta'), cuerpo);

  /** Hace `n` peticiones seguidas y devuelve los estados. */
  async function repetir(n: number, pedir: (i: number) => Promise<RespuestaApi>): Promise<number[]> {
    const estados: number[] = [];
    for (let i = 0; i < n; i++) estados.push((await pedir(i)).status);
    return estados;
  }

  function esLimite(respuesta: RespuestaApi): void {
    expect(respuesta.status, respuesta.texto).toBe(429);
    expect(codigoDe(respuesta)).toBe('DEMASIADAS_SOLICITUDES');
    expect(respuesta.cacheControl).toBe('no-store');
  }

  it('criterio 33: las lecturas (GET de la academia y GET del formulario) comparten 60 por minuto, sumando todas las academias, existan o no: la 61.ª responde 429', async () => {
    const nombres = ['academia-a', 'academia-b', 'no-existe'];
    const estados = await repetir(60, (i) => (i % 2 === 0 ? lectura(nombres[i % 3]) : formulario(nombres[i % 3])));

    expect(
      estados.filter((estado) => estado === 429),
      'las primeras 60 no reciben 429',
    ).toEqual([]);
    esLimite(await lectura());
    esLimite(await formulario());
    esLimite(await lectura('no-existe'));
  });

  it('criterio 33: pasado el límite de lecturas, el 429 llega antes de buscar la academia: una academia suspendida o inexistente también da 429, no 403 ni 404', async () => {
    await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');
    await repetir(60, () => lectura());

    esLimite(await lectura('academia-b'));
    esLimite(await formulario('no-existe'));
  });

  it('criterio 33: cada petición cuenta, también las que fallan: 60 lecturas de academias inexistentes agotan el límite de las academias que sí existen', async () => {
    await repetir(60, () => lectura('no-existe'));

    esLimite(await lectura('academia-a'));
  });

  it('criterio 33: la cotización tiene su contador de 30 por minuto: la 31.ª responde 429 aunque el cuerpo esté roto o la academia no exista', async () => {
    const estados = await repetir(30, () => cotizar());
    expect(estados.filter((estado) => estado === 429)).toEqual([]);

    esLimite(await cotizar());
    esLimite(
      await ctx.http.post(rutaPublica('academia-a', '/inscripcion/cotizacion'), undefined, { crudo: '{"planId":' }),
    );
    esLimite(await cotizar(cuerpoCotizacion(e), 'no-existe'));
  });

  it('criterio 33: el envío tiene su contador de 10 por hora: el 11.º responde 429 aunque el cuerpo sea válido, y no escribe nada', async () => {
    const estados = await repetir(10, () => enviar({ basura: true }));
    expect(
      estados.filter((estado) => estado === 429),
      'los 10 primeros (inválidos) no reciben 429',
    ).toEqual([]);

    const valido = await enviar(await cuerpoInscripcion(e));

    esLimite(valido);
    expect(await contarFilasDeInscripciones(e.A.id)).toEqual({
      alumnos: 0,
      apoderados: 0,
      fichas_medicas: 0,
      consentimientos: 0,
      solicitudes_inscripcion: 0,
      matriculas: 0,
      matricula_clases: 0,
    });
  });

  it('criterio 33: el 429 del envío llega antes de leer el cuerpo y antes de buscar la academia (JSON roto, academia inexistente o suspendida)', async () => {
    await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');
    await repetir(10, () => enviar({ basura: true }));

    esLimite(await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), undefined, { crudo: '{"alumno": ' }));
    esLimite(await enviar({ basura: true }, 'no-existe'));
    esLimite(await enviar({ basura: true }, 'academia-b'));
  });

  it('criterio 33: pasado el límite del envío, la petición no abre ninguna transacción: no espera el bloqueo de la clase que retiene la prueba', async () => {
    await repetir(10, () => enviar({ basura: true }));
    const valido = await cuerpoInscripcion(e);

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerClases([e.lunes.id], e.A.id),
      enviar: [() => enviar(valido)],
      liberar: 'ROLLBACK',
    });

    expect(todasEsperaron, 'el envío rechazado por el límite no debía quedar esperando nada').toBe(false);
    esLimite(resultados[0] as RespuestaApi);
  });

  it('criterio 33: la consulta de seguimiento tiene su contador de 10 por minuto: la 11.ª responde 429, también con cuerpo roto o academia inexistente', async () => {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    const estados = await repetir(10, (i) =>
      i % 2 === 0 ? consultar({ token: cliente.token }) : consultar({ basura: 1 }),
    );
    expect(estados.filter((estado) => estado === 429)).toEqual([]);

    esLimite(await consultar({ token: cliente.token }));
    esLimite(
      await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), undefined, { crudo: '{"token":' }),
    );
    esLimite(await consultar({ token: cliente.token }, 'no-existe'));
  });

  it('criterio 33: cada límite tiene su contador: agotar uno no afecta a los otros', async () => {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    await repetir(10, () => consultar({ token: cliente.token }));
    esLimite(await consultar({ token: cliente.token }));

    expect((await lectura()).status).toBe(200);
    expect((await formulario()).status).toBe(200);
    expect((await cotizar()).status).toBe(200);
    expect((await enviar({ basura: true })).status).toBe(400);

    expect(await repetir(29, () => cotizar()), 'con la primera, son 30').not.toContain(429);
    esLimite(await cotizar());
    expect((await lectura()).status, 'las lecturas siguen').toBe(200);
    expect((await enviar({ basura: true })).status, 'el envío sigue').toBe(400);
  });

  it('criterio 33: el límite de 10 por minuto del ingreso (002) no cambia ni se mezcla: agotar la consulta no bloquea el ingreso y agotar el ingreso no bloquea la consulta', async () => {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    await repetir(10, () => consultar({ token: cliente.token }));
    esLimite(await consultar({ token: cliente.token }));

    const ingreso = await ctx.http.post(rutaPublica('academia-a', '/sesion'), {
      usuario: '12345678',
      clave: 'una-clave-cualquiera',
    });

    expect(ingreso.status, 'el ingreso responde lo suyo (credenciales inválidas), no 429').toBe(401);
  });

  it('criterio 33: el ingreso agotado (10 por minuto) no bloquea la lectura ni la consulta', async () => {
    for (let i = 0; i < 10; i++) {
      await ctx.http.post(rutaPublica('academia-a', '/sesion'), { usuario: '12345678', clave: 'una-clave-cualquiera' });
    }
    esLimite(
      await ctx.http.post(rutaPublica('academia-a', '/sesion'), { usuario: '12345678', clave: 'una-clave-cualquiera' }),
    );

    expect((await lectura()).status).toBe(200);
    expect((await consultar({ basura: 1 })).status).toBe(400);
  });

  it('criterio 33: el límite no se salta cambiando mayúsculas ni agregando una barra final a la dirección (Express enruta igual)', async () => {
    const variantes = ['/api/a/ACADEMIA-A/INSCRIPCION', '/api/a/academia-a/Inscripcion/', '/api/a/academia-a/'];
    const estados = [
      ...(await repetir(56, () => formulario())),
      ...(await repetir(4, (i) => ctx.http.get(variantes[i % variantes.length] as string))),
    ];
    expect(estados.slice(0, 56)).not.toContain(429);

    esLimite(await formulario());
  });

  it('criterio 33: el límite de la cotización tampoco se salta con mayúsculas ni con la barra final', async () => {
    const variantes = [
      '/api/a/academia-a/inscripcion/cotizacion/',
      '/api/a/ACADEMIA-A/INSCRIPCION/COTIZACION',
      '/api/a/academia-a/Inscripcion/Cotizacion',
    ];
    await repetir(27, () => cotizar());
    await repetir(3, (i) => ctx.http.post(variantes[i % variantes.length] as string, cuerpoCotizacion(e)));

    esLimite(await cotizar());
  });

  it('criterio 33: el límite de la consulta tampoco se salta con mayúsculas ni con la barra final', async () => {
    const variantes: string[] = ['/api/a/academia-a/solicitudes/consulta/', '/api/a/ACADEMIA-A/SOLICITUDES/CONSULTA'];
    await repetir(8, () => consultar({ basura: 1 }));
    await repetir(2, (i) => ctx.http.post(variantes[i] as string, { basura: 1 }));

    esLimite(await consultar({ basura: 1 }));
  });

  it('criterio 33: dentro del límite, las rutas responden con normalidad (control: la cotización 30.ª y el envío 10.º no reciben 429)', async () => {
    const cotizaciones = await repetir(30, () => cotizar());
    const envios = await repetir(10, () => enviar({ basura: true }));

    expect(cotizaciones.every((estado) => estado === 200)).toBe(true);
    expect(envios.every((estado) => estado === 400)).toBe(true);
  });
});
