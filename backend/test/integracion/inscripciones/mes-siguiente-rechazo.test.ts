// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, enLima } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  consultarSolicitud,
  cuerpoParaMes,
  enviarPublico,
  type EscenarioMesSiguiente,
  INSTANTE,
  MES_DIC,
  prepararEscenarioDeMesSiguiente,
} from '../../utilidades/escenario-mes-siguiente';
import {
  codigoDeRespuesta,
  cuerpoCobro,
  instantaneaDeLaAcademia,
  pagoDe,
  rutaCobro,
} from '../../utilidades/escenario-pagos';
import {
  datosDeComprobante,
  rutaRechazo,
  sembrarRechazada,
  subirComprobante,
  vistaDeRespuesta,
} from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  DICIEMBRE,
  NOVIEMBRE,
  registrarRenovacion,
  renovacionDe,
  sembrarTitulares,
} from '../../utilidades/escenario-renovacion';
import {
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  llenarClase,
  ocupacionDeClase,
  solicitudDe,
} from '../../utilidades/inscripciones';
import { archivosBajo } from '../../utilidades/inscripciones-005b';
import { leerPagos } from '../../utilidades/pagos';
import { contarAuditoria } from '../../utilidades/usuarios';

// Criterio 10 (crítico, D-05, RN-11, RN-28, D-06): el estado visible de una solicitud con la matrícula `CANCELADA` y su último pago `RECHAZADO` es `PAGO_RECHAZADO` mientras el mes de hoy (Lima) no es posterior al de la matrícula, y `VENCIDA` después (amplía `estadoVisible` y `estadoVisibleSql`; con una matrícula de M el resultado no
// cambia). Al subir un nuevo comprobante o cobrar en efectivo después de un rechazo, el cupo se vuelve a pedir con el cupo libre para una inscripción nueva en el mes de la matrícula: con las reservas de prioridad si la matrícula es de M+1 respecto de «ahora». Con `RELOJ` fijo el 27/11/2026 y c de aforo 20 con 19 titulares: K1 toma el lugar
// libre de diciembre (201), sube su Yape y se lo rechazan; la consulta de seguimiento muestra `PAGO_RECHAZADO`; K2 toma el lugar (201); K1 sube otro comprobante: 409 `SIN_CUPO`, sin pago, sin archivo y sin auditoría; el 28/11 vence la reserva de K2 y K1 sube otro: 201; los 19 titulares renuevan c con 201. Rechazado el 29/11, un nuevo comprobante
// el 2/12 pide `aforo − ocupación(c, dic)`. Una solicitud de diciembre rechazada se muestra `VENCIDA` el 1/1/2027 a las 00:00:00.000 de Lima, y no antes. Las pruebas unitarias de `estadoVisible` están en `estado-visible-010d-protegido.test.ts`; aquí, la lista del panel de solicitudes con una solicitud de M+1.

const ZONA_ORIGINAL = process.env['TZ'];

describe.each(['UTC', 'Asia/Tokyo'])(
  'el rechazo y el nuevo comprobante de una solicitud del mes siguiente (criterio 10) con el proceso en TZ=%s',
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
      await abrirCajaPara(esc, INSTANTE.viernes27);
    });
    afterAll(async () => {
      await ctx?.cerrarTodo();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    const A = () => esc.e.A.id;

    /** Un cliente nuevo que pide c (plan de una clase por semana, S/ 40.00) para diciembre en `instante`. */
    async function pedirC(instante: Date) {
      en(ctx, esc, instante);
      const cuerpo = await cuerpoParaMes(esc.e, MES_DIC, { plan: esc.planUnDia, clases: [esc.c] });
      const respuesta = await enviarPublico(ctx, cuerpo);
      return { respuesta, cuerpo };
    }
    const subir = (token: string, fechaOperacion = '2026-11-27') =>
      subirComprobante(ctx, 'academia-a', { token, datos: datosDeComprobante({ monto: '40.00', fechaOperacion }) });
    const rechazar = (pagoId: string, cookie: string) =>
      ctx.http.post(rutaRechazo(pagoId), { motivo: 'La imagen no se lee, sube otra foto más nítida' }, { cookie });
    const estadoVisible = async (token: string): Promise<string> =>
      String(vistaDeRespuesta(await consultarSolicitud(ctx, token))['estado']);
    const ocupacion = (mes: { anio: number; mes: number }, ahora: Date) => ocupacionDeClase(A(), esc.c.id, mes, ahora);
    const fotografia = async () =>
      JSON.stringify({
        academia: await instantaneaDeLaAcademia(A()),
        archivos: archivosBajo(ctx.raiz),
        auditoria: await contarAuditoria(A()),
      });
    /** El pago más reciente de una solicitud, para rechazarlo. */
    const ultimoPago = async () => {
      const pagos = await leerPagos(A());
      return pagos[pagos.length - 1];
    };

    /** K1 toma el lugar libre de diciembre en c, sube su Yape y se lo rechazan el 27/11 a las 11:00. */
    async function k1RechazadoEl27() {
      const { respuesta } = await pedirC(INSTANTE.viernes27);
      expect(respuesta.status, respuesta.texto).toBe(201);
      const token = solicitudDe(respuesta).token;
      en(ctx, esc, enLima('2026-11-27', '10:30'));
      const subida = await subir(token);
      expect(subida.status, subida.texto).toBe(201);
      const pago = await ultimoPago();
      const rechazo = await rechazar(pago?.id as string, en(ctx, esc, INSTANTE.viernes27a11).secretaria);
      expect(rechazo.status, rechazo.texto).toBe(200);
      expect(pagoDe(rechazo)).toMatchObject({ estado: 'RECHAZADO' });
      return { token };
    }

    describe('el ejemplo de la spec: c con 19 titulares', () => {
      it('criterio 10: K1 toma el lugar libre de diciembre, sube su Yape y se lo rechazan: el seguimiento muestra PAGO_RECHAZADO (aunque su matrícula es del mes siguiente y hoy es noviembre); K2 toma el lugar (201); K1 sube otro comprobante: 409 SIN_CUPO sin pago, sin archivo y sin auditoría', async () => {
        await sembrarTitulares(A(), esc.planUnDia.id, 19, { claseIds: [esc.c.id] });

        const { token: k1 } = await k1RechazadoEl27();
        expect(await estadoVisible(k1), 'una solicitud de M+1 rechazada durante M no está vencida').toBe(
          'PAGO_RECHAZADO',
        );
        const k2 = await pedirC(enLima('2026-11-27', '11:15'));
        expect(k2.respuesta.status, k2.respuesta.texto).toBe(201);
        en(ctx, esc, enLima('2026-11-27', '11:30'));
        const antes = await fotografia();

        const otro = await subir(k1);

        expect([otro.status, codigoDeRespuesta(otro)], otro.texto).toEqual([409, 'SIN_CUPO']);
        expect(await fotografia()).toBe(antes);
        expect(await estadoVisible(k1)).toBe('PAGO_RECHAZADO');
        expect((await leerPagos(A())).map((p) => p.estado)).toEqual(['RECHAZADO']);
        await laOcupacionDeDiciembreNoPasaDelAforo(enLima('2026-11-27', '11:30'));
      });

      it('criterio 10: el 28/11 vence la reserva de K2 y K1 sube otro comprobante: 201 (EN_VERIFICACION, matrícula RESERVADA sin vencimiento); después los 19 titulares renuevan c con 201 y diciembre queda en 20 de 20', async () => {
        const titulares = await sembrarTitulares(A(), esc.planUnDia.id, 19, { claseIds: [esc.c.id] });
        const { token: k1 } = await k1RechazadoEl27();
        const k2 = await pedirC(enLima('2026-11-27', '11:15'));
        expect(k2.respuesta.status, k2.respuesta.texto).toBe(201);
        const el28 = en(ctx, esc, enLima('2026-11-28', '12:00')); // la reserva de K2 venció a las 11:15

        const reintento = await subir(k1, '2026-11-28');

        expect(reintento.status, reintento.texto).toBe(201);
        expect(vistaDeRespuesta(reintento)['estado']).toBe('EN_VERIFICACION');
        const matriculaDeK1 = (await leerMatriculas(A())).find(
          (m) => m.estado === 'RESERVADA' && m.reserva_vence_en === null,
        );
        expect(matriculaDeK1, 'la matrícula vuelve de CANCELADA a RESERVADA sin vencimiento').toMatchObject({
          anio: 2026,
          mes: 12,
        });
        await abrirCajaPara(esc, enLima('2026-11-28', '12:00'));
        for (const titular of titulares) {
          const renovacion = (
            await registrarRenovacion(ctx, esc, 'EFECTIVO', el28.secretaria, titular, {
              total: '40.00',
              seleccion: { planId: esc.planUnDia.id, claseIds: [esc.c.id] },
            })
          ).respuesta;
          expect(renovacionDe(renovacion, 201).renovacion.mes).toBe(MES_DIC);
        }
        expect(await ocupacion(DICIEMBRE, enLima('2026-11-28', '12:00'))).toBe(20);
        await laOcupacionDeDiciembreNoPasaDelAforo(enLima('2026-11-28', '12:00'));
      });
    });

    describe('el cupo se vuelve a pedir con el cupo libre para una inscripción nueva en el mes de la matrícula', () => {
      it('criterio 10: rechazado el 29/11 con 20 titulares apartados (SIN_CUPO por las reservas de prioridad), un nuevo comprobante el 2/12 (diciembre ya es M, sin reservas) pide `aforo − ocupación(c, dic)` = 20: 201', async () => {
        await sembrarTitulares(A(), esc.planUnDia.id, 19, { claseIds: [esc.c.id] });
        const { token } = await k1RechazadoEl27();
        await sembrarTitulares(A(), esc.planUnDia.id, 1, { claseIds: [esc.c.id] }); // ahora los 20 lugares de diciembre están apartados
        en(ctx, esc, enLima('2026-11-29', '10:00'));
        const el29 = await subir(token, '2026-11-29');
        en(ctx, esc, INSTANTE.miercoles2);

        const el2 = await subir(token, '2026-12-02');

        expect([el29.status, codigoDeRespuesta(el29)], el29.texto).toEqual([409, 'SIN_CUPO']);
        expect(el2.status, el2.texto).toBe(201);
        expect(vistaDeRespuesta(el2)).toMatchObject({ estado: 'EN_VERIFICACION', mes: '2026-12' });
      });

      it('criterio 10: el 2/12, con diciembre llena (20 de 20 ocupados), el nuevo comprobante responde 409 SIN_CUPO', async () => {
        const { token } = await k1RechazadoEl27();
        en(ctx, esc, INSTANTE.miercoles2);
        await llenarClase(A(), esc.c.id, esc.planUnDia.id, 20, { mes: DICIEMBRE });
        const antes = await fotografia();

        const respuesta = await subir(token, '2026-12-02');

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SIN_CUPO']);
        expect(await fotografia()).toBe(antes);
      });

      it('criterio 10: lo mismo con el cobro en efectivo después del rechazo: con los 20 lugares apartados el efectivo responde 409 SIN_CUPO y el 2/12 (con la caja de ese día) 201', async () => {
        await sembrarTitulares(A(), esc.planUnDia.id, 19, { claseIds: [esc.c.id] });
        await k1RechazadoEl27();
        await sembrarTitulares(A(), esc.planUnDia.id, 1, { claseIds: [esc.c.id] });
        const solicitud = (await leerSolicitudes(A())).find((s) => s.estado === 'PENDIENTE_PAGO');
        const el29 = en(ctx, esc, enLima('2026-11-29', '10:00'));
        await abrirCajaPara(esc, enLima('2026-11-29', '10:00'));

        const apartados = await ctx.http.post(rutaCobro(solicitud?.id as string), cuerpoCobro('40.00'), {
          cookie: el29.secretaria,
        });
        const el2 = en(ctx, esc, INSTANTE.miercoles2);
        await abrirCajaPara(esc, INSTANTE.miercoles2);
        const liberado = await ctx.http.post(rutaCobro(solicitud?.id as string), cuerpoCobro('40.00'), {
          cookie: el2.secretaria,
        });

        expect([apartados.status, codigoDeRespuesta(apartados)], apartados.texto).toEqual([409, 'SIN_CUPO']);
        expect(liberado.status, liberado.texto).toBe(201);
      });
    });

    describe('PAGO_RECHAZADO y VENCIDA según el mes de hoy', () => {
      it('criterio 10: una solicitud de diciembre rechazada se muestra PAGO_RECHAZADO hasta el 31/12 a las 23:59:59.999 de Lima y VENCIDA el 1/1/2027 a las 00:00:00.000, y no antes', async () => {
        const { token } = await k1RechazadoEl27();
        const hasta = (instante: Date) => {
          en(ctx, esc, instante);
          return estadoVisible(token);
        };

        expect(await hasta(INSTANTE.viernes27a11)).toBe('PAGO_RECHAZADO');
        expect(await hasta(INSTANTE.martes1), 'el 1/12 diciembre es M: sigue rechazada').toBe('PAGO_RECHAZADO');
        expect(await hasta(enLima('2026-12-31', '23:59:59.999'))).toBe('PAGO_RECHAZADO');
        expect(await hasta(enLima('2027-01-01', '00:00:00.000'))).toBe('VENCIDA');
        expect(await hasta(enLima('2027-01-15', '10:00'))).toBe('VENCIDA');
      });

      it('criterio 10: pasado el mes de la matrícula, el nuevo comprobante responde 409 SOLICITUD_NO_EDITABLE (VENCIDA) y no escribe', async () => {
        const { token } = await k1RechazadoEl27();
        en(ctx, esc, enLima('2027-01-01', '00:00:00.000'));
        const antes = await fotografia();

        const respuesta = await subir(token, '2027-01-01');

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
          409,
          'SOLICITUD_NO_EDITABLE',
        ]);
        expect(await fotografia()).toBe(antes);
      });

      it('criterio 10: la lista del panel de solicitudes: una solicitud de diciembre rechazada el 27/11 está en ACTIVAS con estado PAGO_RECHAZADO y no en VENCIDAS; el 1/1/2027 pasa a VENCIDAS con estado VENCIDA', async () => {
        await k1RechazadoEl27();
        const lista = async (estado: string, instante: Date) => {
          const cookie = en(ctx, esc, instante).admin;
          const respuesta = await ctx.http.get(`/api/solicitudes?estado=${estado}`, { cookie });
          expect(respuesta.status, respuesta.texto).toBe(200);
          return (respuesta.body?.['solicitudes'] as { estado: string; mes: string }[]).map((s) => [s.estado, s.mes]);
        };

        expect(await lista('ACTIVAS', INSTANTE.viernes27a11)).toEqual([['PAGO_RECHAZADO', '2026-12']]);
        expect(await lista('VENCIDAS', INSTANTE.viernes27a11)).toEqual([]);
        expect(await lista('ACTIVAS', enLima('2027-01-01', '00:00:00.000'))).toEqual([]);
        expect(await lista('VENCIDAS', enLima('2027-01-01', '00:00:00.000'))).toEqual([['VENCIDA', '2026-12']]);
      });

      it('criterio 10: con una matrícula de M el resultado no cambia: una solicitud de noviembre rechazada se ve PAGO_RECHAZADO hasta el 30/11 a las 23:59:59.999 y VENCIDA el 1/12 a las 00:00:00.000', async () => {
        const cliente = await sembrarRechazada(esc.e, { ahora: INSTANTE.viernes27 });
        const hasta = (instante: Date) => {
          en(ctx, esc, instante);
          return estadoVisible(cliente.token);
        };

        expect(await hasta(INSTANTE.viernes27)).toBe('PAGO_RECHAZADO');
        expect(await hasta(INSTANTE.ultimoDeLaVentana)).toBe('PAGO_RECHAZADO');
        expect(await hasta(INSTANTE.martes1)).toBe('VENCIDA');
        expect((await leerAlumnos(A())).find((a) => a.id === cliente.alumnoId)?.estado).toBe('CLIENTE');
      });
    });

    /** La ocupación de diciembre de c no pasa del aforo (20). */
    async function laOcupacionDeDiciembreNoPasaDelAforo(ahora: Date): Promise<void> {
      expect(await ocupacion(DICIEMBRE, ahora)).toBeLessThanOrEqual(20);
      expect(await ocupacion(NOVIEMBRE, ahora)).toBeLessThanOrEqual(20);
    }
  },
);
