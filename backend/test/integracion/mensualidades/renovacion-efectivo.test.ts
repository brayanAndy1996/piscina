// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cerrarCajaDePrueba, leerCajas, leerMovimientos } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet, leerQr } from '../../utilidades/escenario-carnet';
import { rutaTicket } from '../../utilidades/escenario-pagos';
import {
  abrirCajaPara,
  cargarContratosDe010a,
  CLAVES_DE_LA_RENOVACION,
  CLAVES_DE_LA_RESPUESTA,
  cotizarRenovacion,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  cuerpoCotizacionRenovacion,
  DICIEMBRE,
  detallesDe,
  estadoDelAlumno,
  INSTANTES,
  instantaneaDeRenovacion,
  MES_DICIEMBRE,
  MES_NOVIEMBRE,
  matriculaDelMes,
  NOVIEMBRE,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
  resumen,
  seleccionDeDiciembre,
} from '../../utilidades/escenario-renovacion';
import { leerPagos } from '../../utilidades/pagos';
import { crearPlanDePrueba } from '../../utilidades/planes-clases';
import { leerUsuarios } from '../../utilidades/usuarios';

// Criterio 6 (crítico, HU-07, HU-12, RN-17, D-03): `POST /api/alumnos/{id}/renovacion/efectivo` con `renovarEnEfectivoSchema` hace, en una transacción: la matrícula (`solicitud_id` nula), sus `matricula_clases` y la confirmación con
// `confirmarPagoEnTransaccion` (concepto `MENSUALIDAD`, método `EFECTIVO`): el ingreso en la caja abierta de hoy, el ticket, la matrícula `VIGENTE` y la auditoría `PAGO_REGISTRADO`. No crea cuenta ni cambia el QR. Si la matrícula es de M y el alumno está
// `ALUMNO_VENCIDO`, pasa a `ALUMNO_ACTIVO` en la misma transacción (8.8). Responde 201 con `respuestaRenovacionSchema`. Si `montoMostrado` no es el total, 409 `MONTO_CAMBIO` con `detalles.total`. Sin caja abierta, 409 `SIN_CAJA_ABIERTA`; con la caja
// abierta de otro día, 409 `CAJA_DE_OTRO_DIA`; en los dos casos no queda nada escrito.
// Criterio 5 (parte del guardado): la matrícula guarda `precio_plan`, `clases_por_mes_plan`, `clases_totales`, `monto_calculado` y `es_proporcional`, y el pago y la caja usan el total de lo guardado (HU-19).
// Lecturas estrictas elegidas: (1) «No crea cuenta ni cambia el QR»: ningún usuario nuevo, `alumnos.usuario_id`, `qr_token` y `qr_generado_en` quedan como estaban; (2) el paso a `ALUMNO_ACTIVO` es solo para la matrícula de M: un `ALUMNO_VENCIDO` que renueva M+1 en la
// ventana sigue `ALUMNO_VENCIDO` hasta que el cierre de mes (010b) lo decida el 1/12; (3) el ticket de la 007a (`GET /api/pagos/{id}/ticket`) sirve para la renovación: concepto `MENSUALIDAD` y mes `2026-12`; (4) el cobro de efectivo registra el ingreso por el
// total y con el alumno; (5) `conPrioridad` de la respuesta lista, ordenados, los ids de las clases en las que el alumno era titular (aquí, las tres de noviembre).

describe('la renovación en efectivo (criterios 5 y 6)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const clasesDeNoviembre = () => [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id].sort();

  describe('el cobro de diciembre dentro de la ventana', () => {
    it('criterio 6: 201 con la respuesta del contrato, la matrícula VIGENTE sin solicitud ni vencimiento, el pago confirmado, el ingreso en la caja de hoy, el ticket y la auditoría PAGO_REGISTRADO', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await abrirCajaPara(esc, INSTANTES.viernes27);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const cajaDeHoy = (await leerCajas(esc.e.A.id)).find((c) => c.estado === 'ABIERTA');
      const auditoriasAntes = (await leerAuditoriaDeAcademia(esc.e.A.id, 'PAGO_REGISTRADO')).length;
      const movimientosAntes = (await leerMovimientos(esc.e.A.id)).length;
      const pagosAntes = (await leerPagos(esc.e.A.id)).length;
      const usuariosAntes = (await leerUsuarios(esc.e.A.id)).length;
      const qrAntes = await leerQr(esc.e.A.id, alumno.alumnoId);

      const { cuerpo, respuesta } = await registrarRenovacion(
        ctx,
        esc,
        'EFECTIVO',
        cookies.secretaria,
        alumno.alumnoId,
      );

      const resultado = renovacionDe(respuesta, 201);
      expect(Object.keys(resultado).sort()).toEqual(CLAVES_DE_LA_RESPUESTA);
      expect(respuesta.texto, 'la respuesta no lleva el DNI ni el token del QR del alumno').not.toContain(alumno.dni);
      expect(respuesta.texto).not.toContain(alumno.token);
      expect(Object.keys(resultado.renovacion).sort()).toEqual(CLAVES_DE_LA_RENOVACION);
      expect(resultado.repetida).toBe(false);
      expect(resultado.renovacion).toMatchObject({
        mes: MES_DICIEMBRE,
        estado: 'VIGENTE',
        plan: { id: esc.e.plan.id, nombre: esc.e.plan.nombre },
        fechaInicio: '2026-12-01',
        fechaFin: '2026-12-31',
        clasesTotales: 12,
        total: '120.00',
      });
      expect(resultado.renovacion.clases.map((c) => c.id).sort()).toEqual(clasesDeNoviembre());
      expect(resultado.renovacion.clases.find((c) => c.id === esc.e.lunes.id)).toEqual({
        id: esc.e.lunes.id,
        diaSemana: 1,
        horaInicio: '18:00',
        horaFin: '19:00',
      });
      expect(resultado.renovacion.conPrioridad.slice().sort()).toEqual(clasesDeNoviembre());
      const contratos = await cargarContratosDe010a();
      expect(contratos.respuestaRenovacionSchema.safeParse(respuesta.body).success, respuesta.texto).toBe(true);
      expect(resultado.pago).toMatchObject({
        estado: 'CONFIRMADO',
        metodo: 'EFECTIVO',
        concepto: 'MENSUALIDAD',
        monto: '120.00',
        numeroOperacion: null,
        fechaOperacion: null,
      });
      expect(typeof resultado.pago.numeroTicket).toBe('number');

      const matricula = await matriculaDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE);
      expect(matricula).toMatchObject({
        id: resultado.renovacion.matriculaId,
        solicitud_id: null,
        estado: 'VIGENTE',
        reserva_vence_en: null,
        plan_id: esc.e.plan.id,
        fecha_inicio: '2026-12-01',
        fecha_fin: '2026-12-31',
        clases_totales: 12,
        clases_usadas: 0,
        precio_plan: '120.00',
        clases_por_mes_plan: 12,
        monto_calculado: '120.00',
        monto_ajustado: null,
        es_proporcional: false,
      });
      expect(matricula.clases).toEqual(clasesDeNoviembre());

      const pagos = (await leerPagos(esc.e.A.id)).filter((p) => p.matricula_id === matricula.id);
      expect(pagos).toHaveLength(1);
      expect(pagos[0]).toMatchObject({
        id: resultado.pago.id,
        alumno_id: alumno.alumnoId,
        concepto: 'MENSUALIDAD',
        metodo: 'EFECTIVO',
        estado: 'CONFIRMADO',
        monto: '120.00',
        registrado_por: esc.e.secretariaA.id,
        clave_idempotencia: cuerpo['claveIdempotencia'],
        numero_operacion: null,
        comprobante_clave: null,
      });
      expect(pagos[0]?.numero_ticket).toBe(resultado.pago.numeroTicket);

      const movimientos = await leerMovimientos(esc.e.A.id);
      expect(movimientos).toHaveLength(movimientosAntes + 1);
      expect(movimientos.find((m) => m.pago_id === resultado.pago.id)).toMatchObject({
        caja_id: cajaDeHoy?.id,
        tipo: 'INGRESO',
        concepto: 'MENSUALIDAD',
        metodo: 'EFECTIVO',
        monto: '120.00',
        alumno_id: alumno.alumnoId,
        registrado_por: esc.e.secretariaA.id,
      });
      expect((await leerPagos(esc.e.A.id)).length).toBe(pagosAntes + 1);

      expect(await estadoDelAlumno(esc.e.A.id, alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
      expect((await leerUsuarios(esc.e.A.id)).length, 'no crea cuenta').toBe(usuariosAntes);
      expect(await leerQr(esc.e.A.id, alumno.alumnoId), 'no cambia el QR ni la cuenta del alumno').toEqual(qrAntes);
      expect(await leerAuditoriaDeAcademia(esc.e.A.id, 'PAGO_REGISTRADO')).toHaveLength(auditoriasAntes + 1);
      expect((await leerAuditoriaDeAcademia(esc.e.A.id, 'PAGO_REGISTRADO')).at(-1)).toMatchObject({
        entidad: 'pago',
        entidad_id: resultado.pago.id,
        actor_tipo: 'USUARIO',
        actor_id: esc.e.secretariaA.id,
      });
    });

    it('criterio 6: el ticket de la 007a sirve para la renovación: concepto MENSUALIDAD, mes 2026-12, por S/ 120.00 en efectivo', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await abrirCajaPara(esc, INSTANTES.viernes27);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId);
      const pagoId = renovacionDe(respuesta, 201).pago.id;

      const ticket = await ctx.http.get(rutaTicket(pagoId), { cookie: cookies.secretaria });

      expect(ticket.status, ticket.texto).toBe(200);
      expect(ticket.body?.['ticket']).toMatchObject({
        concepto: 'MENSUALIDAD',
        mes: MES_DICIEMBRE,
        metodo: 'EFECTIVO',
        monto: '120.00',
        plan: { nombre: esc.e.plan.nombre },
      });
    });

    it('criterio 5 y 6: con otro plan que el del mes en curso (S/ 100.00) la matrícula guarda los valores de ese plan y el pago y la caja usan ese total', async () => {
      const plan100 = await crearPlanDePrueba(esc.e.A.id, {
        nombre: 'Plan de S/ 100',
        veces_por_semana: 3,
        clases_por_mes: 12,
        precio: '100.00',
        dias_permitidos: [1, 3, 5],
        franjas_permitidas: ['17:00', '18:00', '19:00'],
        niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
      });
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await abrirCajaPara(esc, INSTANTES.viernes27);
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId, {
        seleccion: { planId: plan100.id },
        total: '100.00',
      });

      const resultado = renovacionDe(respuesta, 201);
      expect(resultado.renovacion).toMatchObject({ plan: { id: plan100.id }, total: '100.00' });
      expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toMatchObject({
        plan_id: plan100.id,
        precio_plan: '100.00',
        clases_por_mes_plan: 12,
        clases_totales: 12,
        monto_calculado: '100.00',
        es_proporcional: false,
      });
      expect((await leerMovimientos(esc.e.A.id)).find((m) => m.pago_id === resultado.pago.id)?.monto).toBe('100.00');
    });

    it('criterio 6: el total que se cobra es el de la cotización del mismo instante (la web cotiza y cobra lo mismo)', async () => {
      const alumno = await crearAlumnoVencido(ctx, esc);
      await abrirCajaPara(esc, INSTANTES.jueves26);
      const cookies = en(ctx, esc, INSTANTES.jueves26);
      const sel = seleccionDeDiciembre(esc, { mes: MES_NOVIEMBRE });
      const cotizacion = await cotizarRenovacion(
        ctx,
        cookies.secretaria,
        alumno.alumnoId,
        cuerpoCotizacionRenovacion(sel),
      );
      const total = (cotizacion.body?.['cotizacion'] as { monto: string }).monto;

      const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId, {
        seleccion: { mes: MES_NOVIEMBRE },
        total,
      });

      expect(total).toBe('20.00');
      expect(renovacionDe(respuesta, 201).pago.monto).toBe(total);
    });
  });

  describe('el estado del alumno (8.8)', () => {
    it('criterio 6: la renovación de M de un ALUMNO_VENCIDO (renovación tardía, S/ 20.00 proporcional) lo pasa a ALUMNO_ACTIVO en la misma transacción; la matrícula empieza hoy', async () => {
      const alumno = await crearAlumnoVencido(ctx, esc);
      await abrirCajaPara(esc, INSTANTES.jueves26);
      const cookies = en(ctx, esc, INSTANTES.jueves26);
      expect(await estadoDelAlumno(esc.e.A.id, alumno.alumnoId)).toBe('ALUMNO_VENCIDO');

      const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId, {
        seleccion: { mes: MES_NOVIEMBRE },
        total: '20.00',
      });

      const resultado = renovacionDe(respuesta, 201);
      expect(resultado.renovacion).toMatchObject({
        mes: MES_NOVIEMBRE,
        estado: 'VIGENTE',
        fechaInicio: '2026-11-26',
        fechaFin: '2026-11-30',
        clasesTotales: 2,
        total: '20.00',
        conPrioridad: [],
      });
      expect(await estadoDelAlumno(esc.e.A.id, alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
      expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, NOVIEMBRE)).toMatchObject({
        estado: 'VIGENTE',
        fecha_inicio: '2026-11-26',
        fecha_fin: '2026-11-30',
        clases_totales: 2,
        clases_por_mes_plan: 12,
        precio_plan: '120.00',
        monto_calculado: '20.00',
        es_proporcional: true,
      });
    });

    it('criterio 6: la renovación de M+1 de un ALUMNO_VENCIDO no cambia su estado (solo la de M lo cambia)', async () => {
      const alumno = await crearAlumnoVencido(ctx, esc);
      await abrirCajaPara(esc, INSTANTES.viernes27);
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId);

      expect(renovacionDe(respuesta, 201).renovacion.mes).toBe(MES_DICIEMBRE);
      expect(await estadoDelAlumno(esc.e.A.id, alumno.alumnoId)).toBe('ALUMNO_VENCIDO');
    });

    it('criterio 6: un alumno que ya estaba ALUMNO_ACTIVO sigue siéndolo', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await abrirCajaPara(esc, INSTANTES.viernes27);
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId);

      expect(await estadoDelAlumno(esc.e.A.id, alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
    });
  });

  describe('el monto mostrado', () => {
    it.each(['119.99', '120.01', '100.00', '20.00'])(
      'criterio 6: montoMostrado %s no es el total (S/ 120.00): 409 MONTO_CAMBIO con detalles.total y no queda nada escrito',
      async (mostrado) => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        await abrirCajaPara(esc, INSTANTES.viernes27);
        const cookies = en(ctx, esc, INSTANTES.viernes27);
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId, {
          total: mostrado,
        });

        expect(resumen(respuesta), respuesta.texto).toEqual([409, 'MONTO_CAMBIO']);
        expect(detallesDe(respuesta)['total']).toBe('120.00');
        expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      },
    );
  });

  describe('la caja', () => {
    it('criterio 6: con la caja cerrada (no hay ninguna abierta), 409 SIN_CAJA_ABIERTA y no queda nada escrito: ni matrícula, ni pago, ni movimiento, ni ticket, ni auditoría', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await cerrarCajaDePrueba(esc.e.A.id, esc.cajaA, esc.e.secretariaA.id);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId);

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SIN_CAJA_ABIERTA']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      expect(await leerAuditoriaDeAcademia(esc.e.A.id, 'RENOVACION_REGISTRADA')).toEqual([]);
    });

    it('criterio 6: con la caja abierta de otro día (la del 11/11 y hoy es el 27/11), 409 CAJA_DE_OTRO_DIA y no queda nada escrito', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId);

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'CAJA_DE_OTRO_DIA']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    it('criterio 6: con la caja de hoy abierta el mismo cobro se acepta (control de los dos rechazos anteriores)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await abrirCajaPara(esc, INSTANTES.viernes27);
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId);

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 6 y casos límite: la caja del 30/11 sirve hasta las 23:59:59.999 de Lima (ya es 1/12 en UTC) y a las 00:00:00.000 del 1/12 es una caja de otro día', async () => {
      const [antes, despues] = [await crearAlumnoDeNoviembre(ctx, esc), await crearAlumnoDeNoviembre(ctx, esc)];
      await abrirCajaPara(esc, INSTANTES.ultimoDeLaVentana);

      const alFinal = en(ctx, esc, INSTANTES.ultimoDeLaVentana);
      const aTiempo = await registrarRenovacion(ctx, esc, 'EFECTIVO', alFinal.secretaria, antes.alumnoId);
      const alDiaSiguiente = en(ctx, esc, INSTANTES.primeroDeDiciembre);
      const tarde = await registrarRenovacion(ctx, esc, 'EFECTIVO', alDiaSiguiente.secretaria, despues.alumnoId, {
        seleccion: { mes: MES_DICIEMBRE },
      });

      expect(aTiempo.respuesta.status, aTiempo.respuesta.texto).toBe(201);
      expect(resumen(tarde.respuesta), tarde.respuesta.texto).toEqual([409, 'CAJA_DE_OTRO_DIA']);
    });
  });
});
