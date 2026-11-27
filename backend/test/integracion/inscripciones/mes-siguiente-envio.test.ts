// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerMovimientos } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { en, enLima } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet, leerQr } from '../../utilidades/escenario-carnet';
import {
  cambiarConfiguracion,
  consultarSolicitud,
  cotizacionDelMes,
  cotizarPublico,
  cuerpoDeCotizacion,
  cuerpoParaMes,
  enviarPublico,
  type EscenarioMesSiguiente,
  INSTANTE,
  MES_DIC,
  MES_ENE_2027,
  MES_NOV,
  prepararEscenarioDeMesSiguiente,
} from '../../utilidades/escenario-mes-siguiente';
import { instantaneaDeLaAcademia } from '../../utilidades/escenario-pagos';
import { vistaDeRespuesta } from '../../utilidades/escenario-pagos-007b';
import {
  ACCION_SOLICITUD_CREADA,
  cuerpoInscripcion,
  codigoDe,
  detallesDe,
  leerAlumnos,
  leerMatriculaClases,
  leerMatriculas,
  leerSolicitudes,
  type Objeto,
  solicitudDe,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';
import { crearPlanDePrueba } from '../../utilidades/planes-clases';
import { contarAuditoria, leerUsuarios } from '../../utilidades/usuarios';

// Criterio 4 (crítico, HU-01, HU-02, RN-28, D-05, DR-10, DR-12 de 005): `POST /api/a/{nombreCorto}/inscripcion` con `inscripcion.mes` igual a M+1 y la ventana abierta hace lo del criterio 16 de 005 con la matrícula de M+1: `anio` y `mes` de M+1, `fecha_inicio`
// el día 1, `fecha_fin` el último día, `clases_totales`, `es_proporcional`, `precio_plan`, `clases_por_mes_plan` y `monto_calculado` de la cotización del mes siguiente, y `reserva_vence_en` igual a la reserva sin pago de M+1 (el menor entre «ahora» más 24 horas
// y el fin del mes de la matrícula: para M+1 son siempre las 24 horas, también cuando cruzan el día 1). 201 con la `cotizacion` de M+1 y ese `reservaVenceEn`; la auditoría `SOLICITUD_INSCRIPCION_CREADA` lleva `mes` M+1 y el mismo vencimiento; el correo de
// seguimiento sale igual. Con `inscripcion.mes` igual a M, nada cambia; con cualquier otro mes, 409 `MES_CAMBIO` con `detalles.mes` igual a M, en el mismo lugar del orden de la 005 (después de `TEXTOS_ACTUALIZADOS` y antes de `PLAN_NO_DISPONIBLE`). Si
// `montoMostrado` no es el total, 409 `MONTO_CAMBIO` con la cotización de M+1. No crea usuario, carnet ni pago.
// Criterio 5 (crítico, DR-10, D-06, RNF-12): los bordes de la ventana en el envío (25/11 23:59:59.999 → MES_CAMBIO; 26/11 00:00:00.000 y 30/11 23:59:59.999 → 201); un envío para 2026-12 cotizado el 30/11 y procesado el 1/12 a las 00:00:00.000 se trata como M;
// `2027-01` el 30/11, MES_CAMBIO; si el administrador baja `diasPrioridadRenovacion` y la ventana deja de estar abierta, el envío siguiente para M+1 responde MES_CAMBIO y las solicitudes de M+1 ya creadas siguen valiendo. Ningún rechazo escribe, audita ni envía correo.

const ZONA_ORIGINAL = process.env['TZ'];

describe.each(['UTC', 'Asia/Tokyo'])(
  'el envío para el mes siguiente (criterios 4 y 5) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppCarnet;
    let esc: EscenarioMesSiguiente;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppCarnet();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      esc = await prepararEscenarioDeMesSiguiente(ctx);
      ctx.correo.mensajes.length = 0;
      en(ctx, esc, INSTANTE.viernes27);
    });
    afterAll(async () => {
      await ctx?.cerrarTodo();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    const A = () => esc.e.A.id;
    const clasesDeLaSemana = () => [esc.e.lunes, esc.e.miercoles, esc.e.viernes];
    const dniDe = (cuerpo: Objeto): string => (cuerpo['alumno'] as Objeto)['dni'] as string;
    /** Todo lo que un rechazo no puede cambiar. */
    const estado = async () => ({
      filas: await instantaneaDeLaAcademia(A()),
      auditoria: await contarAuditoria(A()),
      correos: ctx.correo.mensajes.length,
    });

    describe('criterio 4: el caso correcto', () => {
      it('criterio 4: el viernes 27/11 a las 10:00 de Lima, el envío para diciembre responde 201 con la cotización de diciembre y la reserva de 24 horas (2026-11-28T15:00:00.000Z)', async () => {
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC);

        const respuesta = await enviarPublico(ctx, cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(respuesta.cacheControl).toBe('no-store');
        const solicitud = solicitudDe(respuesta);
        expect(solicitud.estado).toBe('PENDIENTE_PAGO');
        expect(solicitud.cotizacion).toEqual({
          mes: '2026-12',
          fechaInicio: '2026-12-01',
          fechaFin: '2026-12-31',
          clasesRestantes: 13,
          clasesTotales: 12,
          clasesPorMes: 12,
          precioPlan: '120.00',
          monto: '120.00',
          esProporcional: false,
        });
        expect(solicitud.cotizacion).toEqual(cotizacionDelMes(esc.e.plan, clasesDeLaSemana(), MES_DIC));
        expect(new Date(solicitud.reservaVenceEn).toISOString()).toBe('2026-11-28T15:00:00.000Z');
      });

      it('criterio 4: la matrícula es de diciembre: anio y mes, fechas del mes, clases, monto y reserva de la cotización de diciembre; RESERVADA con sus tres clases', async () => {
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC);

        const respuesta = await enviarPublico(ctx, cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(201);
        const matriculas = await leerMatriculas(A());
        expect(matriculas).toHaveLength(1);
        expect(matriculas[0]).toMatchObject({
          plan_id: esc.e.plan.id,
          anio: 2026,
          mes: 12,
          fecha_inicio: '2026-12-01',
          fecha_fin: '2026-12-31',
          clases_totales: 12,
          clases_usadas: 0,
          es_proporcional: false,
          precio_plan: '120.00',
          clases_por_mes_plan: 12,
          monto_calculado: '120.00',
          monto_ajustado: null,
          estado: 'RESERVADA',
        });
        expect(matriculas[0]?.reserva_vence_en?.toISOString()).toBe('2026-11-28T15:00:00.000Z');
        const clases = (await leerMatriculaClases(A())).filter((fila) => fila.matricula_id === matriculas[0]?.id);
        expect(clases.map((fila) => fila.clase_id).sort()).toEqual(
          clasesDeLaSemana()
            .map((c) => c.id)
            .sort(),
        );
      });

      it('criterio 4: la persona sigue como CLIENTE y no se crea usuario, carnet (QR) ni pago: solo el alumno, su solicitud y su matrícula de diciembre', async () => {
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC);
        const usuariosAntes = (await leerUsuarios(A())).length;

        const respuesta = await enviarPublico(ctx, cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(201);
        const alumno = (await leerAlumnos(A())).find((fila) => fila.dni === dniDe(cuerpo));
        expect(alumno).toMatchObject({ estado: 'CLIENTE', usuario_id: null });
        expect(
          (await leerQr(A(), alumno?.id as string)).qr_token,
          'sin carnet hasta que se confirme el pago',
        ).toBeNull();
        expect((await leerUsuarios(A())).length).toBe(usuariosAntes);
        expect(await leerPagos(A())).toEqual([]);
        expect(await leerMovimientos(A())).toEqual([]);
        expect(await leerSolicitudes(A())).toHaveLength(1);
      });

      it('criterio 4: la auditoría SOLICITUD_INSCRIPCION_CREADA lleva el mes de diciembre y el mismo vencimiento, con actor PUBLICO y sin datos personales', async () => {
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC);

        const respuesta = await enviarPublico(ctx, cuerpo);

        const [fila] = await leerAuditoriaDeAcademia(A(), ACCION_SOLICITUD_CREADA);
        expect(fila).toMatchObject({ actor_tipo: 'PUBLICO', actor_id: null, entidad: 'solicitud_inscripcion' });
        const datos = fila?.datos_despues as Objeto;
        expect(datos).toMatchObject({
          mes: '2026-12',
          clasesTotales: 12,
          montoCalculado: '120.00',
          esProporcional: false,
        });
        expect(new Date(datos['reservaVenceEn'] as string).toISOString()).toBe(
          new Date(solicitudDe(respuesta).reservaVenceEn).toISOString(),
        );
        const texto = JSON.stringify(fila);
        expect(texto).not.toContain(dniDe(cuerpo));
        expect(texto).not.toContain(solicitudDe(respuesta).token);
      });

      it('criterio 4: con correo del alumno, el aviso de seguimiento sale una vez, después de confirmar, con el código y el enlace de la solicitud', async () => {
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC, { sobre: { alumno: { correo: 'camila@ejemplo.test' } } });

        const respuesta = await enviarPublico(ctx, cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(201);
        const solicitud = solicitudDe(respuesta);
        expect(ctx.correo.mensajes).toHaveLength(1);
        expect(ctx.correo.mensajes[0]).toMatchObject({
          academiaId: A(),
          para: 'camila@ejemplo.test',
          plantilla: 'SEGUIMIENTO_SOLICITUD',
        });
        expect(JSON.stringify(ctx.correo.mensajes[0]?.datos)).toContain(solicitud.codigo);
      });

      it('criterio 4: el mismo cuerpo con la misma clave de idempotencia no duplica: responde 409 SOLICITUD_YA_REGISTRADA con el código y deja una sola solicitud', async () => {
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC);

        const primera = await enviarPublico(ctx, cuerpo);
        const segunda = await enviarPublico(ctx, cuerpo);

        expect(primera.status, primera.texto).toBe(201);
        expect([segunda.status, codigoDe(segunda)], segunda.texto).toEqual([409, 'SOLICITUD_YA_REGISTRADA']);
        expect(detallesDe(segunda)).toEqual({ codigo: solicitudDe(primera).codigo });
        expect(await leerSolicitudes(A())).toHaveLength(1);
        expect(await leerMatriculas(A())).toHaveLength(1);
      });

      it('criterio 4: el plan de una clase por semana con el sábado de las 10:00 para diciembre (4 sábados, 4 clases): S/ 40.00 no proporcional, y la ocupación de c en diciembre pasa a 1', async () => {
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDia, clases: [esc.c] });

        const respuesta = await enviarPublico(ctx, cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(solicitudDe(respuesta).cotizacion).toMatchObject({
          clasesRestantes: 4,
          clasesTotales: 4,
          monto: '40.00',
          esProporcional: false,
        });
      });

      it('criterio 4: el 28/01/2027 con un plan de S/ 100.00 y 13 clases, la matrícula de febrero guarda 12 clases, proporcional y S/ 93.00', async () => {
        const plan = await crearPlanDePrueba(A(), {
          nombre: 'Plan de 13 clases',
          veces_por_semana: 3,
          clases_por_mes: 13,
          precio: '100.00',
          dias_permitidos: [1, 3, 5],
          franjas_permitidas: ['18:00'],
          niveles_aplicables: ['BASICO'],
        });
        const el28 = enLima('2027-01-28', '10:00');
        en(ctx, esc, el28);
        const cuerpo = await cuerpoParaMes(esc.e, '2027-02', { plan });

        const respuesta = await enviarPublico(ctx, cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect((await leerMatriculas(A()))[0]).toMatchObject({
          anio: 2027,
          mes: 2,
          fecha_inicio: '2027-02-01',
          fecha_fin: '2027-02-28',
          clases_totales: 12,
          es_proporcional: true,
          precio_plan: '100.00',
          clases_por_mes_plan: 13,
          monto_calculado: '93.00',
        });
        expect(new Date(solicitudDe(respuesta).reservaVenceEn).toISOString()).toBe('2027-01-29T15:00:00.000Z');
      });
    });

    describe('criterio 4: el vencimiento de la reserva del mes siguiente (24 horas, sin recortar al fin del mes en curso)', () => {
      it.each([
        [
          'el 26/11 a las 00:00:00.000 (primer instante de la ventana)',
          enLima('2026-11-26', '00:00:00.000'),
          MES_DIC,
          '2026-11-27T05:00:00.000Z',
        ],
        ['el viernes 27/11 a las 10:00', INSTANTE.viernes27, MES_DIC, '2026-11-28T15:00:00.000Z'],
        [
          'el lunes 30/11 a las 22:00 (2026-12-01T03:00:00.000Z): cruza el día 1 y no se recorta al fin de noviembre',
          INSTANTE.lunes30a22,
          MES_DIC,
          '2026-12-02T03:00:00.000Z',
        ],
        [
          'el 30/11 a las 23:59:59.999 (último instante de la ventana)',
          INSTANTE.ultimoDeLaVentana,
          MES_DIC,
          '2026-12-02T04:59:59.999Z',
        ],
        [
          'el 31/12/2026 a las 10:00 con enero de 2027 (cambio de año)',
          INSTANTE.jueves31dic,
          MES_ENE_2027,
          '2027-01-01T15:00:00.000Z',
        ],
      ])('criterio 4: %s vence a %s', async (_nombre, instante, mes, vence) => {
        en(ctx, esc, instante);
        const cuerpo = await cuerpoParaMes(esc.e, mes);

        const respuesta = await enviarPublico(ctx, cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(new Date(solicitudDe(respuesta).reservaVenceEn).toISOString()).toBe(vence);
        expect((await leerMatriculas(A()))[0]?.reserva_vence_en?.toISOString()).toBe(vence);
        const [auditoria] = await leerAuditoriaDeAcademia(A(), ACCION_SOLICITUD_CREADA);
        expect(new Date((auditoria?.datos_despues as Objeto)['reservaVenceEn'] as string).toISOString()).toBe(vence);
      });

      it('criterio 4: con `mes` igual a M nada cambia: el 30/11 a las 10:00 la reserva de noviembre vence al fin del mes (2026-12-01T04:59:59.999Z) y la de diciembre, a las 24 horas (2026-12-01T15:00:00.000Z)', async () => {
        const diezDelTreinta = enLima('2026-11-30', '10:00');
        en(ctx, esc, diezDelTreinta);
        const deNoviembre = await enviarPublico(ctx, await cuerpoInscripcion(esc.e, { ahora: diezDelTreinta }));
        const deDiciembre = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC));

        expect(deNoviembre.status, deNoviembre.texto).toBe(201);
        expect(deDiciembre.status, deDiciembre.texto).toBe(201);
        expect(new Date(solicitudDe(deNoviembre).reservaVenceEn).toISOString()).toBe('2026-12-01T04:59:59.999Z');
        expect(solicitudDe(deNoviembre).cotizacion['mes']).toBe('2026-11');
        expect(new Date(solicitudDe(deDiciembre).reservaVenceEn).toISOString()).toBe('2026-12-01T15:00:00.000Z');
        const meses = (await leerMatriculas(A())).map((m) => [m.anio, m.mes]).sort();
        expect(meses).toEqual([
          [2026, 11],
          [2026, 12],
        ]);
      });
    });

    describe('criterio 4: MES_CAMBIO, MONTO_CAMBIO y el orden de los 409', () => {
      it.each([
        ['M+2 (enero de 2027) con la ventana abierta', MES_ENE_2027],
        ['un mes pasado (octubre)', '2026-10'],
        ['el mismo mes de otro año', '2027-11'],
        ['un mes anterior de otro año', '2025-12'],
      ])(
        'criterio 4: %s responde 409 MES_CAMBIO con `detalles.mes` igual a M y no escribe, no audita ni envía correo',
        async (_nombre, mes) => {
          const cuerpo = await cuerpoParaMes(esc.e, mes, {
            montoMostrado: '120.00',
            sobre: { alumno: { correo: 'camila@ejemplo.test' } },
          });
          const antes = await estado();

          const respuesta = await enviarPublico(ctx, cuerpo);

          expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MES_CAMBIO']);
          expect(detallesDe(respuesta)['mes']).toBe(MES_NOV);
          expect(await estado()).toEqual(antes);
        },
      );

      it('criterio 4: el orden de la 005 se conserva: TEXTOS_ACTUALIZADOS gana a MES_CAMBIO, MES_CAMBIO a PLAN_NO_DISPONIBLE, y con un mes de inscripción un plan inexistente da PLAN_NO_DISPONIBLE', async () => {
        const inexistente = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';
        const textos = await enviarPublico(
          ctx,
          await cuerpoParaMes(esc.e, MES_ENE_2027, {
            sobre: { consentimientos: { version: 'vieja' }, inscripcion: { planId: inexistente } },
          }),
        );
        const mes = await enviarPublico(
          ctx,
          await cuerpoParaMes(esc.e, MES_ENE_2027, { sobre: { inscripcion: { planId: inexistente } } }),
        );
        const plan = await enviarPublico(
          ctx,
          await cuerpoParaMes(esc.e, MES_DIC, { sobre: { inscripcion: { planId: inexistente } } }),
        );

        expect(codigoDe(textos)).toBe('TEXTOS_ACTUALIZADOS');
        expect(codigoDe(mes)).toBe('MES_CAMBIO');
        expect(codigoDe(plan)).toBe('PLAN_NO_DISPONIBLE');
      });

      it('criterio 4: un `montoMostrado` que no es el total responde 409 MONTO_CAMBIO con la cotización de diciembre en `detalles.cotizacion`, y no escribe', async () => {
        const antes = await estado();

        const respuesta = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC, { montoMostrado: '1.00' }));

        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MONTO_CAMBIO']);
        expect(detallesDe(respuesta)['cotizacion']).toEqual(cotizacionDelMes(esc.e.plan, clasesDeLaSemana(), MES_DIC));
        expect(await estado()).toEqual(antes);
      });

      it('criterio 4: lo que se ve es lo que se guarda: el monto de noviembre (S/ 20.00, dos clases restantes) enviado con `mes` de diciembre responde 409 MONTO_CAMBIO', async () => {
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC, { montoMostrado: '20.00' });

        const respuesta = await enviarPublico(ctx, cuerpo);

        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MONTO_CAMBIO']);
        expect((detallesDe(respuesta)['cotizacion'] as Objeto)['monto']).toBe('120.00');
        expect(await leerMatriculas(A())).toEqual([]);
      });

      it('criterio 4: el plan se evalúa el día 1 del mes: uno que vence el 30/11 sirve para noviembre y no para diciembre (PLAN_NO_DISPONIBLE); uno que empieza el 1/12 al revés', async () => {
        const comunes = {
          veces_por_semana: 3,
          clases_por_mes: 12,
          dias_permitidos: [1, 3, 5],
          franjas_permitidas: ['18:00'],
          niveles_aplicables: ['BASICO'],
        };
        const venceElTreinta = await crearPlanDePrueba(A(), {
          ...comunes,
          nombre: 'Vence el 30/11',
          precio: '120.00',
          vigencia_fin: '2026-11-30',
        });
        const empiezaElPrimero = await crearPlanDePrueba(A(), {
          ...comunes,
          nombre: 'Empieza el 1/12',
          precio: '130.00',
          vigencia_inicio: '2026-12-01',
        });

        const venceEnDic = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC, { plan: venceElTreinta }));
        const empiezaEnNov = await enviarPublico(
          ctx,
          await cuerpoInscripcion(esc.e, { plan: empiezaElPrimero, ahora: INSTANTE.viernes27 }),
        );
        const empiezaEnDic = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC, { plan: empiezaElPrimero }));
        const venceEnNov = await enviarPublico(
          ctx,
          await cuerpoInscripcion(esc.e, { plan: venceElTreinta, ahora: INSTANTE.viernes27 }),
        );

        expect([venceEnDic.status, codigoDe(venceEnDic)], venceEnDic.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
        expect([empiezaEnNov.status, codigoDe(empiezaEnNov)], empiezaEnNov.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
        expect(empiezaEnDic.status, empiezaEnDic.texto).toBe(201);
        expect(solicitudDe(empiezaEnDic).cotizacion).toMatchObject({ precioPlan: '130.00', monto: '130.00' });
        expect(venceEnNov.status, venceEnNov.texto).toBe(201);
      });

      it('criterio 4: las reglas de selección son las de la 005: una clase de un día que el plan no permite responde 409 SELECCION_NO_VALIDA para diciembre', async () => {
        const respuesta = await enviarPublico(
          ctx,
          await cuerpoParaMes(esc.e, MES_DIC, { clases: [esc.e.martes], montoMostrado: '120.00' }),
        );

        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
      });
    });

    describe('criterio 4: el cliente que vuelve (casos límite)', () => {
      it('criterio 4: una persona con una solicitud activa de noviembre que quiere diciembre recibe 409 DNI_YA_REGISTRADO (una sola solicitud activa por persona)', async () => {
        const dni = '45612378';
        await enviarPublico(
          ctx,
          await cuerpoInscripcion(esc.e, { ahora: INSTANTE.viernes27, sobre: { alumno: { dni } } }),
        );

        const respuesta = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC, { sobre: { alumno: { dni } } }));

        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'DNI_YA_REGISTRADO']);
      });

      it('criterio 4: un exalumno (ALUMNO_VENCIDO) que usa el formulario para diciembre recibe 409 DNI_YA_REGISTRADO: renueva en recepción', async () => {
        const dni = '45612399';
        const previa = await sembrarSolicitud(A(), {
          planId: esc.e.plan.id,
          claseIds: [esc.e.lunes.id],
          dni,
          estadoAlumno: 'ALUMNO_VENCIDO',
          estado: 'VENCIDA',
          mes: { anio: 2026, mes: 10 },
        });
        expect(previa.dni).toBe(dni);

        const respuesta = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC, { sobre: { alumno: { dni } } }));

        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'DNI_YA_REGISTRADO']);
      });

      it('criterio 4: cuando vence la reserva de 24 horas de diciembre, la solicitud se ve VENCIDA y la persona puede volver a inscribirse para diciembre', async () => {
        const dni = '45612355';
        const primera = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC, { sobre: { alumno: { dni } } }));
        expect(primera.status, primera.texto).toBe(201);
        en(ctx, esc, INSTANTE.sabado28a10); // 28/11 a las 10:00: la reserva hecha el 27/11 a las 10:00 vence en este instante

        const vista = await consultarSolicitud(ctx, solicitudDe(primera).token);
        const otra = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC, { sobre: { alumno: { dni } } }));

        expect(vistaDeRespuesta(vista)['estado']).toBe('VENCIDA');
        expect(otra.status, otra.texto).toBe(201);
        expect((await leerSolicitudes(A())).map((s) => s.estado).sort()).toEqual(['PENDIENTE_PAGO', 'VENCIDA']);
      });
    });

    describe('criterio 5: los bordes de la ventana en el envío', () => {
      it('criterio 5: el 25/11 a las 23:59:59.999 de Lima, la cotización y el envío para diciembre responden 409 MES_CAMBIO y no escriben, auditan ni envían correo', async () => {
        en(ctx, esc, INSTANTE.antesDeLaVentana);
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC, { sobre: { alumno: { correo: 'camila@ejemplo.test' } } });
        const antes = await estado();

        const cotizacion = await cotizarPublico(
          ctx,
          cuerpoDeCotizacion({ planId: esc.e.plan.id, claseIds: clasesDeLaSemana().map((c) => c.id), mes: MES_DIC }),
        );
        const envio = await enviarPublico(ctx, cuerpo);

        expect([cotizacion.status, codigoDe(cotizacion)], cotizacion.texto).toEqual([409, 'MES_CAMBIO']);
        expect([envio.status, codigoDe(envio)], envio.texto).toEqual([409, 'MES_CAMBIO']);
        expect(detallesDe(envio)['mes']).toBe(MES_NOV);
        expect(await estado()).toEqual(antes);
      });

      it.each([
        ['el 26/11 a las 00:00:00.000 de Lima (2026-11-26T05:00:00.000Z)', INSTANTE.primeroDeLaVentana],
        ['el 30/11 a las 23:59:59.999 de Lima (ya es 1/12 en UTC)', INSTANTE.ultimoDeLaVentana],
      ])('criterio 5: %s la cotización responde 200 y el envío para diciembre, 201', async (_nombre, instante) => {
        en(ctx, esc, instante);

        const cotizacion = await cotizarPublico(
          ctx,
          cuerpoDeCotizacion({ planId: esc.e.plan.id, claseIds: clasesDeLaSemana().map((c) => c.id), mes: MES_DIC }),
        );
        const envio = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC));

        expect(cotizacion.status, cotizacion.texto).toBe(200);
        expect(envio.status, envio.texto).toBe(201);
        expect((await leerMatriculas(A()))[0]).toMatchObject({ anio: 2026, mes: 12, fecha_inicio: '2026-12-01' });
      });

      it('criterio 5: un envío para 2026-12 cotizado el 30/11 a las 23:59:59.999 y procesado el 1/12 a las 00:00:00.000 se trata como M: 201 con la reserva de `vencimientoDeReserva(ahora)` (2026-12-02T05:00:00.000Z)', async () => {
        en(ctx, esc, INSTANTE.ultimoDeLaVentana);
        const cuerpo = await cuerpoParaMes(esc.e, MES_DIC);
        en(ctx, esc, INSTANTE.martes1);

        const respuesta = await enviarPublico(ctx, cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(new Date(solicitudDe(respuesta).reservaVenceEn).toISOString()).toBe('2026-12-02T05:00:00.000Z');
        expect(solicitudDe(respuesta).cotizacion).toMatchObject({ mes: '2026-12', monto: '120.00' });
      });

      it('criterio 5: `2027-01` el 30/11 responde 409 MES_CAMBIO (aunque la ventana esté abierta, solo se ofrece el mes siguiente)', async () => {
        en(ctx, esc, INSTANTE.ultimoDeLaVentana);
        const antes = await estado();

        const respuesta = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_ENE_2027));

        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MES_CAMBIO']);
        expect(await estado()).toEqual(antes);
      });

      it('criterio 5: noviembre el 1/12 a las 00:00:00.000 ya no es de inscripción: 409 MES_CAMBIO con `detalles.mes` igual a 2026-12', async () => {
        en(ctx, esc, INSTANTE.martes1);

        const respuesta = await enviarPublico(
          ctx,
          await cuerpoInscripcion(esc.e, {
            ahora: INSTANTE.ultimoDeLaVentana,
            sobre: { inscripcion: { montoMostrado: '20.00' } },
          }),
        );

        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'MES_CAMBIO']);
        expect(detallesDe(respuesta)['mes']).toBe(MES_DIC);
      });

      it('criterio 5: si el administrador baja `diasPrioridadRenovacion` y la ventana deja de estar abierta, el envío siguiente para diciembre responde 409 MES_CAMBIO y la solicitud de diciembre ya creada sigue valiendo', async () => {
        const cookies = en(ctx, esc, INSTANTE.viernes27);
        const primera = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC));
        expect(primera.status, primera.texto).toBe(201);

        const patch = await cambiarConfiguracion(ctx, cookies.admin, { diasPrioridadRenovacion: 3 }); // la ventana de diciembre empieza el 28/11
        const antes = await estado();
        const segunda = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC));
        const vista = await consultarSolicitud(ctx, solicitudDe(primera).token);

        expect(patch.status, patch.texto).toBe(200);
        expect([segunda.status, codigoDe(segunda)], segunda.texto).toEqual([409, 'MES_CAMBIO']);
        expect(await estado()).toEqual(antes);
        expect(vista.status, vista.texto).toBe(200);
        expect(vistaDeRespuesta(vista)).toMatchObject({ estado: 'PENDIENTE_PAGO', mes: '2026-12' });
      });

      it('criterio 5: al subir `diasPrioridadRenovacion` a 10 el 21/11 el envío para diciembre pasa de 409 MES_CAMBIO a 201 en la petición siguiente, sin reiniciar', async () => {
        const cookies = en(ctx, esc, enLima('2026-11-21', '10:00'));

        const antes = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC));
        const patch = await cambiarConfiguracion(ctx, cookies.admin, { diasPrioridadRenovacion: 10 });
        const despues = await enviarPublico(ctx, await cuerpoParaMes(esc.e, MES_DIC));

        expect([antes.status, codigoDe(antes)], antes.texto).toEqual([409, 'MES_CAMBIO']);
        expect(patch.status, patch.texto).toBe(200);
        expect(despues.status, despues.texto).toBe(201);
      });
    });
  },
);
