// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, enLima } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  cuerpoParaMes,
  cuposDe,
  enviarPublico,
  type EscenarioMesSiguiente,
  INSTANTE,
  MES_DIC,
  pedirFormulario,
  prepararEscenarioDeMesSiguiente,
} from '../../utilidades/escenario-mes-siguiente';
import { instantaneaDeLaAcademia } from '../../utilidades/escenario-pagos';
import {
  abrirCajaPara,
  DICIEMBRE,
  fijarAforo,
  NOVIEMBRE,
  registrarRenovacion,
  renovacionDe,
  resumen,
  sembrarMatriculaDelMes,
  sembrarTitulares,
} from '../../utilidades/escenario-renovacion';
import {
  cuerpoInscripcion,
  codigoDe,
  detallesDe,
  leerSolicitudes,
  ocupacionDeClase,
  sembrarSolicitud,
  solicitudDe,
} from '../../utilidades/inscripciones';
import { contarAuditoria } from '../../utilidades/usuarios';

// Criterio 6 (crítico, D-06, RN-11, RN-28, DR-10): una inscripción nueva para M+1 necesita, en cada clase elegida, cupo libre para una inscripción nueva en M+1 (`aforo − ocupación − reservas de prioridad`; quien se inscribe por el formulario es un CLIENTE y nunca es titular); si no, 409
// `SIN_CUPO` con `detalles.clasesSinCupo` (todas las que no tienen lugar, en el orden pedido), sin escribir, auditar ni enviar correo. Con `RELOJ` fijo el 27/11/2026 (N = 5), la caja abierta de hoy y la clase c (sábado 10:00, aforo 20) con 18 titulares y nada de diciembre: K1 se inscribe a c para diciembre
// a las 10:00 y K2 a las 11:00 (201 y 201); K3 recibe `SIN_CUPO`; noviembre de c sigue mostrando 2 cupos (`20 − 18`) en el formulario sin `mes`; el 28/11 a las 10:00, sin pagar, vence la reserva de K1 (no la de K2): K3 se inscribe a c para diciembre (201); los 18 titulares renuevan c para diciembre en
// efectivo (010a), cada uno con 201, también el último; diciembre queda en 20 de 20; el 1/12 a las 00:00:00.000 de Lima ya no hay reservas de prioridad: con otra clase d de aforo 20, 15 titulares de noviembre y ninguno renovado, un cliente se inscribe a d para diciembre (ya es M) con `aforo − ocupación(d, dic)`.
// Si el administrador bajó el aforo de c por debajo de los inscritos (DR-5 de 004), el cliente recibe `SIN_CUPO`. La ocupación de cada mes nunca pasa del aforo.

describe('solo los cupos libres para el mes siguiente (criterio 6)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioMesSiguiente;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeMesSiguiente(ctx);
    ctx.correo.mensajes.length = 0;
    en(ctx, esc, INSTANTE.viernes27);
    await abrirCajaPara(esc, INSTANTE.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  /** El cuerpo de un cliente nuevo que pide c (plan de una clase por semana de S/ 40.00) para `mes`. */
  const paraC = (mes: string, sobre: Record<string, unknown> = {}) =>
    cuerpoParaMes(esc.e, mes, { plan: esc.planUnDia, clases: [esc.c], sobre });
  const inscribirAC = async (mes = MES_DIC) => enviarPublico(ctx, await paraC(mes));
  const estado = async () => ({
    filas: await instantaneaDeLaAcademia(A()),
    auditoria: await contarAuditoria(A()),
    correos: ctx.correo.mensajes.length,
  });
  const ocupacion = (claseId: string, mes: { anio: number; mes: number }, ahora: Date) =>
    ocupacionDeClase(A(), claseId, mes, ahora);
  /** La ocupación de cada mes nunca pasa del aforo (20) en ninguna clase del escenario. */
  async function laOcupacionNoPasaDelAforo(ahora: Date): Promise<void> {
    for (const clase of [esc.c, esc.sabado17, esc.e.lunes, esc.e.miercoles, esc.e.viernes]) {
      for (const mes of [NOVIEMBRE, DICIEMBRE]) {
        expect(await ocupacion(clase.id, mes, ahora), `${clase.id} en ${mes.mes}`).toBeLessThanOrEqual(20);
      }
    }
  }
  const renovarC = async (alumnoId: string, cookie: string) =>
    (
      await registrarRenovacion(ctx, esc, 'EFECTIVO', cookie, alumnoId, {
        total: '40.00',
        seleccion: { planId: esc.planUnDia.id, claseIds: [esc.c.id] },
      })
    ).respuesta;

  describe('el ejemplo de la spec: c con 18 titulares y nada de diciembre', () => {
    it('criterio 6: K1 (10:00) y K2 (11:00) se inscriben a c para diciembre (201 y 201); K3 recibe 409 SIN_CUPO con `detalles.clasesSinCupo` [c] sin escribir, auditar ni enviar correo; noviembre de c sigue con 2 cupos', async () => {
      await sembrarTitulares(A(), esc.planUnDia.id, 18, { claseIds: [esc.c.id] });

      const k1 = await inscribirAC();
      en(ctx, esc, INSTANTE.viernes27a11);
      const k2 = await inscribirAC();
      const antes = await estado();
      const k3 = await enviarPublico(ctx, await paraC(MES_DIC, { alumno: { correo: 'k3@ejemplo.test' } }));

      expect(k1.status, k1.texto).toBe(201);
      expect(k2.status, k2.texto).toBe(201);
      expect([k3.status, codigoDe(k3)], k3.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDe(k3)['clasesSinCupo']).toEqual([esc.c.id]);
      expect(await estado()).toEqual(antes);
      expect(cuposDe(await pedirFormulario(ctx), esc.c.id), 'noviembre: 20 − 18').toBe(2);
      expect(
        cuposDe(await pedirFormulario(ctx, `?mes=${MES_DIC}`), esc.c.id),
        'diciembre: 20 − 2 − 18',
      ).toBeUndefined();
      expect(await ocupacion(esc.c.id, DICIEMBRE, INSTANTE.viernes27a11)).toBe(2);
      await laOcupacionNoPasaDelAforo(INSTANTE.viernes27a11);
    });

    it('criterio 6: el 28/11 a las 10:00, sin pagar, vence la reserva de K1 y no la de K2: K3 se inscribe a c para diciembre (201)', async () => {
      await sembrarTitulares(A(), esc.planUnDia.id, 18, { claseIds: [esc.c.id] });
      const k1 = await inscribirAC();
      en(ctx, esc, INSTANTE.viernes27a11);
      const k2 = await inscribirAC();
      const k3Antes = await inscribirAC();
      en(ctx, esc, INSTANTE.sabado28a10);

      const k3 = await inscribirAC();

      expect([k1.status, k2.status, k3Antes.status]).toEqual([201, 201, 409]);
      expect(k3.status, k3.texto).toBe(201);
      expect((await leerSolicitudes(A())).length, 'K1, K2 y K3 (la rechazada no dejó nada)').toBe(3);
      expect(await ocupacion(esc.c.id, DICIEMBRE, INSTANTE.sabado28a10), 'K1 venció; quedan K2 y K3').toBe(2);
      await laOcupacionNoPasaDelAforo(INSTANTE.sabado28a10);
    });

    it('criterio 6: después, los 18 titulares renuevan c para diciembre en efectivo, cada uno con 201 (también el último): diciembre queda en 20 de 20 y un cliente nuevo recibe SIN_CUPO', async () => {
      const titulares = await sembrarTitulares(A(), esc.planUnDia.id, 18, { claseIds: [esc.c.id] });
      await inscribirAC();
      en(ctx, esc, INSTANTE.viernes27a11);
      await inscribirAC();
      const el28 = en(ctx, esc, INSTANTE.sabado28a10);
      expect((await inscribirAC()).status).toBe(201);
      await abrirCajaPara(esc, INSTANTE.sabado28a10);

      const respuestas = [];
      for (const titular of titulares) respuestas.push(await renovarC(titular, el28.secretaria));

      respuestas.forEach((respuesta, indice) => {
        expect(renovacionDe(respuesta, 201).renovacion.mes, `titular ${indice + 1}`).toBe(MES_DIC);
      });
      expect(await ocupacion(esc.c.id, DICIEMBRE, INSTANTE.sabado28a10)).toBe(20);
      const otro = await inscribirAC();
      expect([otro.status, codigoDe(otro)], otro.texto).toEqual([409, 'SIN_CUPO']);
      await laOcupacionNoPasaDelAforo(INSTANTE.sabado28a10);
    });
  });

  describe('el día 1 se liberan los lugares apartados', () => {
    it('criterio 6: otra clase d de aforo 20 con 15 titulares sin renovar y 2 personas con diciembre: el 30/11 a las 23:59:59.999 diciembre muestra 3 cupos y el 1/12 a las 00:00:00.000 un cliente se inscribe a d para diciembre (ya es M) con `aforo − ocupación`, sin restar reservas', async () => {
      await sembrarTitulares(A(), esc.planUnDia.id, 15, { claseIds: [esc.sabado17.id] });
      // Dos personas ya con diciembre en d (para que el cupo de diciembre y el de noviembre no coincidan).
      await sembrarTitulares(A(), esc.planUnDia.id, 2, { claseIds: [esc.sabado17.id], mes: DICIEMBRE });
      en(ctx, esc, INSTANTE.ultimoDeLaVentana);
      const antesDelDia1 = await pedirFormulario(ctx, `?mes=${MES_DIC}`);
      en(ctx, esc, INSTANTE.martes1);
      const despues = await pedirFormulario(ctx);

      const envio = await enviarPublico(
        ctx,
        await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDia, clases: [esc.sabado17] }),
      );

      expect(cuposDe(antesDelDia1, esc.sabado17.id), '20 − 2 de diciembre − 15 titulares apartados').toBe(3);
      expect(cuposDe(despues, esc.sabado17.id), 'ya es diciembre: 20 − 2, sin reservas de prioridad').toBe(18);
      expect(envio.status, envio.texto).toBe(201);
      expect(solicitudDe(envio).cotizacion).toMatchObject({ mes: '2026-12', fechaInicio: '2026-12-01' });
      expect(await ocupacion(esc.sabado17.id, DICIEMBRE, INSTANTE.martes1)).toBe(3);
    });

    it('criterio 6: justo antes del día 1 un cliente no toma un lugar apartado (SIN_CUPO) y a las 00:00:00.000 del día 1 sí', async () => {
      await sembrarTitulares(A(), esc.planUnDia.id, 20, { claseIds: [esc.sabado17.id] });
      const cuerpoAntes = async () => cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDia, clases: [esc.sabado17] });
      en(ctx, esc, INSTANTE.ultimoDeLaVentana);
      const antes = await enviarPublico(ctx, await cuerpoAntes());
      en(ctx, esc, INSTANTE.martes1);
      const despues = await enviarPublico(ctx, await cuerpoAntes());

      expect([antes.status, codigoDe(antes)], antes.texto).toEqual([409, 'SIN_CUPO']);
      expect(despues.status, despues.texto).toBe(201);
    });
  });

  describe('otros casos de cupo', () => {
    it('criterio 6: aforo bajado (DR-5 de 004): c de aforo 30 con 30 titulares, que el administrador baja a 20, responde SIN_CUPO para diciembre y no escribe', async () => {
      await fijarAforo(A(), esc.c.id, 30);
      await sembrarTitulares(A(), esc.planUnDia.id, 30, { claseIds: [esc.c.id] });
      await fijarAforo(A(), esc.c.id, 20);
      const antes = await estado();

      const respuesta = await inscribirAC();

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDe(respuesta)['clasesSinCupo']).toEqual([esc.c.id]);
      expect(await estado()).toEqual(antes);
      expect(
        cuposDe(await pedirFormulario(ctx, `?mes=${MES_DIC}`), esc.c.id),
        'los cupos mostrados se recortan a 0',
      ).toBeUndefined();
    });

    it('criterio 6: los titulares que ya renovaron diciembre no restan dos veces: con 18 titulares y 10 renovados en c, quedan 20 − 10 − 8 = 2 lugares: dos clientes entran y el tercero recibe SIN_CUPO', async () => {
      const titulares = await sembrarTitulares(A(), esc.planUnDia.id, 18, { claseIds: [esc.c.id] });
      await sembrarMatriculaDelMes(A(), esc.planUnDia.id, titulares.slice(0, 10), [esc.c.id], DICIEMBRE);

      const primero = await inscribirAC();
      const segundo = await inscribirAC();
      const tercero = await inscribirAC();

      expect([primero.status, segundo.status]).toEqual([201, 201]);
      expect([tercero.status, codigoDe(tercero)], tercero.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(esc.c.id, DICIEMBRE, INSTANTE.viernes27)).toBe(12);
    });

    it('criterio 6: un titular que renueva diciembre en otras clases deja libre su lugar en c: con 20 titulares y uno renovado en otra clase, un cliente toma el lugar y el siguiente recibe SIN_CUPO', async () => {
      const titulares = await sembrarTitulares(A(), esc.planUnDia.id, 20, { claseIds: [esc.c.id] });
      await sembrarMatriculaDelMes(A(), esc.planUnDia.id, [titulares[0] as string], [esc.martes10.id], DICIEMBRE);

      const primero = await inscribirAC();
      const segundo = await inscribirAC();

      expect(primero.status, primero.texto).toBe(201);
      expect([segundo.status, codigoDe(segundo)], segundo.texto).toEqual([409, 'SIN_CUPO']);
    });

    it('criterio 6: una reserva de 24 horas sin pagar de un cliente de noviembre no da prioridad: con 19 titulares y esa reserva (20 de 20 en noviembre) quedan 20 − 0 − 19 = 1 lugar en diciembre para un cliente nuevo', async () => {
      await sembrarTitulares(A(), esc.planUnDia.id, 19, { claseIds: [esc.c.id] });
      await sembrarSolicitud(A(), {
        planId: esc.planUnDia.id,
        claseIds: [esc.c.id],
        ahora: INSTANTE.viernes27,
        clasesTotales: 1,
        clasesPorMesPlan: 4,
        precioPlan: '40.00',
        monto: '10.00',
      });

      const noviembre = await pedirFormulario(ctx);
      const diciembre = await inscribirAC();

      expect(cuposDe(noviembre, esc.c.id), 'noviembre: 19 titulares y una reserva: llena').toBeUndefined();
      expect(diciembre.status, diciembre.texto).toBe(201);
    });

    it('criterio 6: `clasesSinCupo` lista todas las clases sin lugar, en el orden pedido, y con una sola llena no se reserva ninguna', async () => {
      // El viernes y el miércoles tienen todos sus lugares apartados para los titulares; el lunes tiene lugar.
      await sembrarTitulares(A(), esc.e.plan.id, 20, { claseIds: [esc.e.viernes.id, esc.e.miercoles.id] });
      const antes = await estado();

      const respuesta = await enviarPublico(
        ctx,
        await cuerpoParaMes(esc.e, MES_DIC, { clases: [esc.e.viernes, esc.e.lunes, esc.e.miercoles] }),
      );

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDe(respuesta)['clasesSinCupo']).toEqual([esc.e.viernes.id, esc.e.miercoles.id]);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 6: con `mes` igual a M el cupo sigue siendo `aforo − ocupación` (las reservas de prioridad no restan al mes en curso): con 18 titulares dos clientes entran a noviembre y el tercero recibe SIN_CUPO', async () => {
      await sembrarTitulares(A(), esc.planUnDia.id, 18, { claseIds: [esc.c.id] });
      const deNoviembre = () =>
        cuerpoInscripcion(esc.e, { plan: esc.planUnDia, clases: [esc.c], ahora: INSTANTE.viernes27 });

      const primero = await enviarPublico(ctx, await deNoviembre());
      const segundo = await enviarPublico(ctx, await deNoviembre());
      const tercero = await enviarPublico(ctx, await deNoviembre());

      expect([primero.status, segundo.status]).toEqual([201, 201]);
      expect([tercero.status, codigoDe(tercero)], tercero.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(esc.c.id, NOVIEMBRE, INSTANTE.viernes27)).toBe(20);
      expect(await ocupacion(esc.c.id, DICIEMBRE, INSTANTE.viernes27)).toBe(0);
    });
  });

  it('criterio 6: tres clientes piden el mismo lugar libre de diciembre uno tras otro: uno 201 y los demás 409 SIN_CUPO con el mismo cuerpo de error', async () => {
    await sembrarTitulares(A(), esc.planUnDia.id, 19, { claseIds: [esc.c.id] });
    const k1 = await inscribirAC();
    const k2 = await inscribirAC();
    const k3 = await inscribirAC();

    expect(k1.status, k1.texto).toBe(201);
    expect([k2.status, codigoDe(k2)]).toEqual([409, 'SIN_CUPO']);
    expect(resumen(k3)).toEqual([409, 'SIN_CUPO']);
    expect(detallesDe(k3)).toEqual(detallesDe(k2));
  });

  it('criterio 6: el 30/11 a las 19:30 cuentan todas las clases de diciembre desde el día 1, también la de 19:00 de ese lunes: la inscripción para diciembre es de 12 clases (13 con tope) y 201', async () => {
    // La clase de los lunes de 19:00 a 20:00: para M la de hoy ya no cuenta; para M+1 cuentan todas las de diciembre desde el día 1.
    const el30 = enLima('2026-11-30', '19:30');
    en(ctx, esc, el30);

    const respuesta = await enviarPublico(
      ctx,
      await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.e.plan, clases: [esc.lunes19, esc.e.miercoles, esc.e.viernes] }),
    );

    expect(respuesta.status, respuesta.texto).toBe(201);
    expect(solicitudDe(respuesta).cotizacion).toMatchObject({
      mes: '2026-12',
      clasesRestantes: 13,
      clasesTotales: 12,
      monto: '120.00',
    });
  });
});
