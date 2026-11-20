// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLAVE_EN_BASE, fijarConfiguracion, fijarFilaConfiguracion } from '../../utilidades/configuracion';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  type AppInscripciones,
  cargarContratos,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoCotizacion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  llenarClase,
  type Objeto,
  rutaPublica,
  sembrarSolicitud,
  tokenAleatorio,
  VEINTICUATRO_HORAS,
  AHORA_005,
} from '../../utilidades/inscripciones';
import { actualizarFila, crearPlanDePrueba } from '../../utilidades/planes-clases';
import { actualizarUsuario, fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterios 5, 6 y 7 (críticos, D-22, D-23, D-27, HU-02, RN-11):
//   5. GET /api/a/{nombreCorto} responde 200 con { nombreCorto, nombre, telefono } (el valor efectivo de la configuración o null, sin
//      caché), sin id, estado ni motivo, con Cache-Control: no-store y los mismos 404 y 403 de los criterios 58 a 60 de 001.
//   6. GET /api/a/{nombreCorto}/inscripcion responde RespuestaFormularioInscripcion: academia { nombre, telefono }, mes (AAAA-MM), hoy
//      (AAAA-MM-DD), planes activos y VIGENTES hoy, clases activas con cupos restantes mayores que 0 (sin entrenador, aforo ni
//      ocupación) y los consentimientos con su versión vigente.
//   7. Un planId, claseId o token de B en las rutas públicas de A se comporta como uno que no existe (el mismo cuerpo), sin leer ni
//      escribir nada de B; un academiaId en el cuerpo es 400 y en la consulta o una cabecera no cambia de academia.

const ES_ISO = /^\d{4}-\d{2}-\d{2}$/;

describe('GET /api/a/{nombreCorto}: el teléfono público (criterio 5)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const leer = (nombreCorto = 'academia-a') => ctx.http.get(rutaPublica(nombreCorto));

  it('criterio 5: sin teléfono configurado responde 200 con { nombreCorto, nombre, telefono: null } y Cache-Control: no-store', async () => {
    const respuesta = await leer();

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(respuesta.body).toEqual({ nombreCorto: 'academia-a', nombre: 'Academia A', telefono: null });
    expect(respuesta.cacheControl).toBe('no-store');
  });

  it('criterio 5: con teléfono, responde el valor efectivo de la configuración y nada más (sin id, estado ni motivo)', async () => {
    await fijarConfiguracion(e.A.id, { telefono: '+51 987 654 321' });

    const respuesta = await leer();

    expect(respuesta.body).toEqual({ nombreCorto: 'academia-a', nombre: 'Academia A', telefono: '+51 987 654 321' });
    expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['nombre', 'nombreCorto', 'telefono']);
    expect(respuesta.texto).not.toMatch(/estado|motivo|"id"|ACTIVA|SUSPENDIDA/i);
  });

  it('criterio 5: un cambio de teléfono confirmado se ve en la petición siguiente (sin caché), y quitarlo da null', async () => {
    await fijarConfiguracion(e.A.id, { telefono: '(01) 555-0199' });
    expect((await leer()).body?.['telefono']).toBe('(01) 555-0199');

    await fijarConfiguracion(e.A.id, { telefono: '+51 912 345 678' });
    expect((await leer()).body?.['telefono']).toBe('+51 912 345 678');

    await fijarConfiguracion(e.A.id, { telefono: null });
    expect((await leer()).body?.['telefono']).toBeNull();
  });

  it('criterio 5: un valor guardado que no cumple el formato se lee como "sin teléfono" (null), como en la configuración', async () => {
    await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.telefono, 'no es un teléfono');

    expect((await leer()).body?.['telefono']).toBeNull();
  });

  it('criterio 5: el teléfono de otra academia no se filtra', async () => {
    await fijarConfiguracion(e.B.id, { telefono: '+51 900 111 222' });

    const respuesta = await leer();

    expect(respuesta.body?.['telefono']).toBeNull();
    expect(respuesta.texto).not.toContain('900 111 222');
    expect((await leer('academia-b')).body?.['telefono']).toBe('+51 900 111 222');
  });

  it.each([
    ['un nombre que no existe', 'noexiste'],
    ['una palabra reservada', 'admin'],
    ['dos puntos', '..'],
    ['con un porcentaje mal formado', '%25'],
  ])('criterio 5 (58 a 60 de 001): %s responde 404 ACADEMIA_NO_ENCONTRADA con no-store', async (_caso, nombreCorto) => {
    const respuesta = await leer(nombreCorto);

    expect(respuesta.status).toBe(404);
    expect(codigoDe(respuesta)).toBe('ACADEMIA_NO_ENCONTRADA');
    expect(respuesta.cacheControl).toBe('no-store');
  });

  it('criterio 5 (58 a 60 de 001): una academia suspendida responde 403 ACADEMIA_SUSPENDIDA y no dice su teléfono', async () => {
    await fijarConfiguracion(e.B.id, { telefono: '+51 900 111 222' });
    await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');

    const respuesta = await leer('academia-b');

    expect(respuesta.status).toBe(403);
    expect(codigoDe(respuesta)).toBe('ACADEMIA_SUSPENDIDA');
    expect(respuesta.texto).not.toContain('900 111 222');
  });

  it('criterio 5 (58 a 60 de 001): el nombre corto se recorta y se pasa a minúsculas; no pide sesión aunque la cookie sea inválida', async () => {
    const respuesta = await ctx.http.get(rutaPublica('%20ACADEMIA-A'), { cookie: 'aq_sesion=invalida' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body?.['nombreCorto']).toBe('academia-a');
  });
});

describe('GET /api/a/{nombreCorto}/inscripcion: los datos del formulario (criterio 6)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const leer = (nombreCorto = 'academia-a') => ctx.http.get(rutaPublica(nombreCorto, '/inscripcion'));
  const listaDe = (respuesta: { body: Objeto | null }, clave: 'planes' | 'clases'): Objeto[] =>
    (respuesta.body?.[clave] ?? []) as Objeto[];

  it('criterio 6: responde 200 con academia, mes, hoy, planes, clases y consentimientos, y Cache-Control: no-store', async () => {
    await fijarConfiguracion(e.A.id, { telefono: '+51 987 654 321' });

    const respuesta = await leer();

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(respuesta.cacheControl).toBe('no-store');
    expect(Object.keys(respuesta.body ?? {}).sort()).toEqual([
      'academia',
      'clases',
      'consentimientos',
      'hoy',
      'mes',
      'planes',
    ]);
    expect(respuesta.body?.['academia']).toEqual({ nombre: 'Academia A', telefono: '+51 987 654 321' });
    expect(respuesta.body?.['mes']).toBe('2026-11');
    expect(respuesta.body?.['hoy']).toBe('2026-11-11');
  });

  it('criterio 6: academia.telefono es null si la academia no lo configuró', async () => {
    expect((await leer()).body?.['academia']).toEqual({ nombre: 'Academia A', telefono: null });
  });

  it('criterio 6: "hoy" y "mes" son los de America/Lima, no los de UTC ni los del servidor (22:00 y 23:59:59 de Lima, y el cambio de mes)', async () => {
    ctx.reloj.fijar(new Date('2026-11-12T03:00:00.000Z')); // 22:00 del 11 en Lima; en UTC ya es 12
    let respuesta = await leer();
    expect([respuesta.body?.['hoy'], respuesta.body?.['mes']]).toEqual(['2026-11-11', '2026-11']);

    ctx.reloj.fijar(new Date('2026-12-01T04:59:59.000Z')); // 23:59:59 del 30 de noviembre en Lima
    respuesta = await leer();
    expect([respuesta.body?.['hoy'], respuesta.body?.['mes']]).toEqual(['2026-11-30', '2026-11']);

    ctx.reloj.fijar(new Date('2026-12-01T05:00:00.000Z')); // 00:00:00 del 1 de diciembre en Lima
    respuesta = await leer();
    expect([respuesta.body?.['hoy'], respuesta.body?.['mes']]).toEqual(['2026-12-01', '2026-12']);
  });

  it('criterio 6: cada plan trae solo id, nombre, vecesPorSemana, clasesPorMes, duracionMinutos, precio (dos decimales), diasPermitidos, franjasPermitidas y nivelesAplicables', async () => {
    const respuesta = await leer();

    const planes = listaDe(respuesta, 'planes');
    expect(planes).toHaveLength(1);
    expect(planes[0]).toEqual({
      id: e.plan.id,
      nombre: 'Plan 3 por semana',
      vecesPorSemana: 3,
      clasesPorMes: 12,
      duracionMinutos: 60,
      precio: '120.00',
      diasPermitidos: [1, 3, 5],
      franjasPermitidas: ['17:00', '18:00', '19:00'],
      nivelesAplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
    });
  });

  it('criterio 6: nunca ofrece planes inactivos, programados ni vencidos; sí el que vence hoy o empieza hoy (la fecha es la de Lima)', async () => {
    ctx.reloj.fijar(new Date('2026-11-12T03:00:00.000Z')); // 22:00 del 11 de noviembre en Lima
    const base = {
      veces_por_semana: 1,
      clases_por_mes: 4,
      precio: '40.00',
      dias_permitidos: [1],
      franjas_permitidas: ['18:00'],
    };
    const inactivo = await crearPlanDePrueba(e.A.id, { ...base, nombre: 'Inactivo', activo: false });
    const programado = await crearPlanDePrueba(e.A.id, {
      ...base,
      nombre: 'Programado',
      vigencia_inicio: '2026-11-12',
    });
    const vencido = await crearPlanDePrueba(e.A.id, { ...base, nombre: 'Vencido', vigencia_fin: '2026-11-10' });
    const venceHoy = await crearPlanDePrueba(e.A.id, { ...base, nombre: 'Vence hoy', vigencia_fin: '2026-11-11' });
    const empiezaHoy = await crearPlanDePrueba(e.A.id, {
      ...base,
      nombre: 'Empieza hoy',
      vigencia_inicio: '2026-11-11',
    });

    const ids = listaDe(await leer(), 'planes').map((plan) => plan['id']);

    expect(ids).toEqual(expect.arrayContaining([e.plan.id, venceHoy.id, empiezaHoy.id]));
    for (const excluido of [inactivo, programado, vencido, e.planB]) expect(ids).not.toContain(excluido.id);
    expect(ids).toHaveLength(3);
  });

  it('criterio 6: cada clase trae solo id, nivel, diaSemana, horaInicio, horaFin y cuposRestantes; sin entrenador, aforo ni ocupación', async () => {
    const respuesta = await leer();

    const clase = listaDe(respuesta, 'clases').find((c) => c['id'] === e.lunes.id);
    expect(clase).toEqual({
      id: e.lunes.id,
      nivel: 'BASICO',
      diaSemana: 1,
      horaInicio: '18:00',
      horaFin: '19:00',
      cuposRestantes: 20,
    });
    for (const fila of listaDe(respuesta, 'clases')) {
      expect(Object.keys(fila).sort()).toEqual(['cuposRestantes', 'diaSemana', 'horaFin', 'horaInicio', 'id', 'nivel']);
    }
    expect(respuesta.texto).not.toContain(e.entrenadorA.id);
    expect(respuesta.texto).not.toContain(e.entrenadorA.dni);
    expect(JSON.stringify(respuesta.body?.['clases'])).not.toMatch(/aforo|ocupacion|entrenador/i);
  });

  it('criterio 6: ofrece todas las clases activas de A (también la de un entrenador desactivado, DR-6 de 004) y ninguna de B', async () => {
    await actualizarUsuario(e.A.id, e.entrenadorA.id, { estado: 'INACTIVO' });

    const respuesta = await leer();

    const ids = listaDe(respuesta, 'clases').map((c) => c['id']);
    for (const clase of [e.lunes, e.miercoles, e.viernes, e.lunes17, e.martes, e.lunes08, e.intermedioLunes]) {
      expect(ids, `${clase.dia_semana} ${clase.hora_inicio}`).toContain(clase.id);
    }
    for (const deB of [e.lunesB, e.miercolesB, e.viernesB]) expect(ids).not.toContain(deB.id);
    expect(respuesta.texto).not.toContain(e.B.id);
  });

  it('criterio 6: una clase inactiva no aparece', async () => {
    await actualizarFila('propietario', 'clases', e.A.id, e.martes.id, { activo: false });

    expect(listaDe(await leer(), 'clases').map((c) => c['id'])).not.toContain(e.martes.id);
  });

  it('criterio 6: los cupos restantes son el aforo menos la ocupación del mes en curso; una clase llena no aparece', async () => {
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 5);
    await llenarClase(e.A.id, e.miercoles.id, e.plan.id, 19);
    await llenarClase(e.A.id, e.viernes.id, e.plan.id, 20);

    const clases = listaDe(await leer(), 'clases');

    const cupos = (id: string) => clases.find((c) => c['id'] === id)?.['cuposRestantes'];
    expect(cupos(e.lunes.id)).toBe(15);
    expect(cupos(e.miercoles.id)).toBe(1);
    expect(
      clases.map((c) => c['id']),
      'la clase llena no se ofrece',
    ).not.toContain(e.viernes.id);
    expect(cupos(e.lunes17.id), 'una clase sin inscritos tiene todos sus cupos').toBe(20);
  });

  it('criterio 6: ocupan cupo las matrículas VIGENTES, las RESERVADAS sin vencimiento y las RESERVADAS con vencimiento futuro; las vencidas, canceladas y de otro mes no', async () => {
    const futuro = new Date(AHORA_005.getTime() + VEINTICUATRO_HORAS);
    const pasado = new Date(AHORA_005.getTime() - 1000);
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 2, { estado: 'VIGENTE' });
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 3, { estado: 'RESERVADA', reservaVenceEn: null });
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 4, { estado: 'RESERVADA', reservaVenceEn: futuro });
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 6, { estado: 'RESERVADA', reservaVenceEn: pasado });
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 5, { mes: { anio: 2026, mes: 10 } });
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 1, { mes: { anio: 2026, mes: 12 } });
    await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'CANCELADA' });
    await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'VENCIDA' });

    const clase = listaDe(await leer(), 'clases').find((c) => c['id'] === e.lunes.id);

    expect(clase?.['cuposRestantes']).toBe(20 - (2 + 3 + 4));
  });

  it('criterio 6: con el aforo por debajo de la ocupación (DR-5 de 004: aforo bajado con confirmación), la clase tiene 0 cupos y no aparece', async () => {
    await llenarClase(e.A.id, e.lunes.id, e.plan.id, 21);

    expect(listaDe(await leer(), 'clases').map((c) => c['id'])).not.toContain(e.lunes.id);
  });

  it('criterio 6: un cliente con solicitud sembrada ocupa cupo mientras la reserva vive y lo libera al vencer, sin ninguna tarea programada', async () => {
    await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'PENDIENTE_PAGO' });
    const cupos = async () =>
      listaDe(await leer(), 'clases').find((c) => c['id'] === e.lunes.id)?.['cuposRestantes'] as number | undefined;

    expect(await cupos()).toBe(19);

    ctx.reloj.avanzar(VEINTICUATRO_HORAS - 1000);
    expect(await cupos(), 'un segundo antes del vencimiento sigue reservado').toBe(19);

    ctx.reloj.avanzar(1000);
    expect(await cupos(), 'en el instante del vencimiento ya no ocupa').toBe(20);
  });

  it('criterio 6: los consentimientos traen la versión vigente y el texto, con el nombre de la academia y los datos de salud', async () => {
    const contratos = await cargarContratos();

    const respuesta = await leer();

    const consentimientos = respuesta.body?.['consentimientos'] as Objeto;
    expect(consentimientos['version']).toBe(contratos.VERSION_CONSENTIMIENTOS);
    const texto = JSON.stringify(consentimientos);
    expect(texto).toContain('Academia A');
    expect(texto).toMatch(/salud/i);
  });

  it('criterio 6: no escribe nada (ni filas ni auditoría) y no deja datos de B', async () => {
    await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });
    const antes = await instantaneaDeInscripciones(e.A.id);
    const auditoriaAntes = (await leerAuditoriaDeAcademia(e.A.id)).length;

    const respuesta = await leer();

    expect(respuesta.status).toBe(200);
    expect(await instantaneaDeInscripciones(e.A.id)).toBe(antes);
    expect((await leerAuditoriaDeAcademia(e.A.id)).length).toBe(auditoriaAntes);
    expect(respuesta.texto).not.toContain(e.B.id);
    expect(respuesta.texto).not.toContain(e.planB.id);
  });

  it('criterio 6: academia inexistente 404, suspendida 403, con el mismo orden y cuerpos que la ruta de la academia', async () => {
    await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');

    const inexistente = await leer('noexiste');
    const suspendida = await leer('academia-b');

    expect([inexistente.status, codigoDe(inexistente)]).toEqual([404, 'ACADEMIA_NO_ENCONTRADA']);
    expect([suspendida.status, codigoDe(suspendida)]).toEqual([403, 'ACADEMIA_SUSPENDIDA']);
    expect(inexistente.cacheControl).toBe('no-store');
  });

  it('criterio 6: la fecha de hoy tiene el formato AAAA-MM-DD', async () => {
    expect(String((await leer()).body?.['hoy'])).toMatch(ES_ISO);
  });
});

describe('ids, tokens y academiaId de otra academia en las rutas públicas (criterio 7)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const cotizar = (cuerpo: unknown, sufijo = '') =>
    ctx.http.post(rutaPublica('academia-a', `/inscripcion/cotizacion${sufijo}`), cuerpo);
  const enviar = (cuerpo: unknown, sufijo = '') =>
    ctx.http.post(rutaPublica('academia-a', `/inscripcion${sufijo}`), cuerpo);
  const consultar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), cuerpo);
  const INEXISTENTE = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';

  async function estado() {
    return {
      a: await instantaneaDeInscripciones(e.A.id),
      b: await instantaneaDeInscripciones(e.B.id),
      auditoriaA: (await leerAuditoriaDeAcademia(e.A.id)).length,
      auditoriaB: (await leerAuditoriaDeAcademia(e.B.id)).length,
    };
  }

  it('criterio 7: la cotización con el planId de B responde exactamente lo mismo que con un planId que no existe (409 PLAN_NO_DISPONIBLE)', async () => {
    const deB = await cotizar(cuerpoCotizacion(e, { planId: e.planB.id }));
    const inexistente = await cotizar(cuerpoCotizacion(e, { planId: INEXISTENTE }));

    expect(deB.status).toBe(409);
    expect(codigoDe(deB)).toBe('PLAN_NO_DISPONIBLE');
    expect(deB.texto).toBe(inexistente.texto);
  });

  it('criterio 7: la cotización con claseIds de B (o mezcladas con las de A) responde lo mismo que con claseIds que no existen (409 SELECCION_NO_VALIDA)', async () => {
    const inexistentes = await cotizar(cuerpoCotizacion(e, { claseIds: [e.lunes.id, e.miercoles.id, INEXISTENTE] }));
    const mezcladas = await cotizar(cuerpoCotizacion(e, { claseIds: [e.lunes.id, e.miercoles.id, e.viernesB.id] }));
    const todasDeB = await cotizar(cuerpoCotizacion(e, { claseIds: [e.lunesB.id, e.miercolesB.id, e.viernesB.id] }));

    expect(inexistentes.status).toBe(409);
    expect(codigoDe(inexistentes)).toBe('SELECCION_NO_VALIDA');
    expect(mezcladas.texto, 'una clase de B se ve como una que no existe').toBe(inexistentes.texto);
    expect(codigoDe(todasDeB)).toBe('SELECCION_NO_VALIDA');
    for (const respuesta of [inexistentes, mezcladas, todasDeB]) {
      expect(respuesta.texto).not.toContain(e.lunesB.id);
      expect(respuesta.texto).not.toContain(e.B.id);
    }
  });

  it('criterio 7: el envío con el planId o los claseIds de B responde lo mismo que con ids que no existen, y no escribe nada en A ni en B', async () => {
    const antes = await estado();
    const conPlanDeB = await enviar(await cuerpoInscripcion(e, { sobre: { inscripcion: { planId: e.planB.id } } }));
    const conPlanInexistente = await enviar(
      await cuerpoInscripcion(e, { sobre: { inscripcion: { planId: INEXISTENTE } } }),
    );
    const conClasesDeB = await enviar(
      await cuerpoInscripcion(e, {
        sobre: { inscripcion: { claseIds: [e.lunesB.id, e.miercolesB.id, e.viernesB.id] } },
      }),
    );
    const conClasesInexistentes = await enviar(
      await cuerpoInscripcion(e, { sobre: { inscripcion: { claseIds: [INEXISTENTE, e.miercoles.id, e.viernes.id] } } }),
    );

    expect([conPlanDeB.status, codigoDe(conPlanDeB)]).toEqual([409, 'PLAN_NO_DISPONIBLE']);
    expect(conPlanDeB.texto).toBe(conPlanInexistente.texto);
    expect([conClasesDeB.status, codigoDe(conClasesDeB)]).toEqual([409, 'SELECCION_NO_VALIDA']);
    expect([conClasesInexistentes.status, codigoDe(conClasesInexistentes)]).toEqual([409, 'SELECCION_NO_VALIDA']);
    expect(await estado(), 'nada se escribió, ni se auditó').toEqual(antes);
  });

  it('criterio 7: la consulta con el token de una solicitud de B responde exactamente lo mismo que con un token que no existe (404 SOLICITUD_NO_ENCONTRADA)', async () => {
    const deB = await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });
    const deA = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });

    const conTokenDeB = await consultar({ token: deB.token });
    const inexistente = await consultar({ token: tokenAleatorio() });
    const propio = await consultar({ token: deA.token });

    expect(conTokenDeB.status).toBe(404);
    expect(codigoDe(conTokenDeB)).toBe('SOLICITUD_NO_ENCONTRADA');
    expect(conTokenDeB.texto).toBe(inexistente.texto);
    expect(propio.status, 'control: el token de A sí sirve en A').toBe(200);
    expect(conTokenDeB.texto).not.toContain(deB.codigo);
  });

  it('criterio 7: la consulta con el código y el DNI de una solicitud de B responde el mismo 404 que uno inexistente', async () => {
    const deB = await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });

    const conDatosDeB = await consultar({ codigo: deB.codigo, dni: deB.dni });
    const inexistente = await consultar({ codigo: 'AQ-ZZZZZZ', dni: '12345678' });

    expect(conDatosDeB.status).toBe(404);
    expect(conDatosDeB.texto).toBe(inexistente.texto);
  });

  it('criterio 7: un academiaId en el cuerpo responde 400 SOLICITUD_INVALIDA en la cotización, el envío y la consulta, sin escribir nada', async () => {
    const deA = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    const despuesDeSembrar = await estado();

    const cotizacion = await cotizar({ ...cuerpoCotizacion(e), academiaId: e.B.id });
    const envio = await enviar({ ...(await cuerpoInscripcion(e)), academiaId: e.B.id });
    const consulta = await consultar({ token: deA.token, academiaId: e.B.id });

    for (const respuesta of [cotizacion, envio, consulta]) {
      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
    }
    expect(await estado()).toEqual(despuesDeSembrar);
  });

  it('criterio 7: un academiaId en la consulta o en una cabecera no cambia de academia (los parámetros de consulta se ignoran)', async () => {
    const aURL = rutaPublica('academia-a', '/inscripcion');

    const conParametro = await ctx.http.get(`${aURL}?academiaId=${e.B.id}&nombreCorto=academia-b`);
    const conCabeceras = await ctx.http.get(aURL, {
      headers: { 'x-academia-id': e.B.id, 'x-academia': 'academia-b', 'x-forwarded-host': 'academia-b' },
    });

    for (const respuesta of [conParametro, conCabeceras]) {
      expect(respuesta.status).toBe(200);
      expect((respuesta.body?.['academia'] as Objeto).nombre).toBe('Academia A');
      expect(respuesta.texto).not.toContain(e.lunesB.id);
      expect(respuesta.texto).not.toContain(e.planB.id);
    }
  });

  it('criterio 7: un academiaId en la consulta (query) de la cotización o del envío se ignora: se usa la academia de la dirección', async () => {
    const cotizacion = await cotizar(cuerpoCotizacion(e), `?academiaId=${e.B.id}`);
    const conPlanDeB = await cotizar(cuerpoCotizacion(e, { planId: e.planB.id }), `?academiaId=${e.B.id}`);

    expect(cotizacion.status, cotizacion.texto).toBe(200);
    expect([conPlanDeB.status, codigoDe(conPlanDeB)]).toEqual([409, 'PLAN_NO_DISPONIBLE']);
  });
});
