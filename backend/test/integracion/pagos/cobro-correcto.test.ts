// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearCajaDePrueba, leerMovimientos } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  pagoDe,
  rutaCobro,
  sembrarCobrable,
  solicitudPanelDe,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  crearAppInscripciones,
  leerAlumnos,
  type SolicitudSembrada,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 13 (crítico, HU-07, RN-04, RN-01, D-03; HU-26): dada una solicitud con estado visible `PENDIENTE_PAGO` y la caja de hoy abierta, cuando una `SECRETARIA` o un
// `ADMIN` envía `POST /api/solicitudes/{id}/pago-efectivo` con `{ claveIdempotencia, montoMostrado }` (`cobrarEnEfectivoSchema`, estricto), responde 201 con `{ pago,
// solicitud }` (`pagoSchema` y el elemento del panel). En una sola transacción: se crea el pago `CONFIRMADO`, `EFECTIVO`, concepto `INSCRIPCION`, con el total a cobrar,
// `registrado_por` y `verificado_por` iguales al actor, `registrado_en` y `verificado_en` iguales a «ahora» y el siguiente `numero_ticket` de la academia; su ingreso entra a
// la caja de hoy con `registrarIngresoEnCaja` (método `EFECTIVO`, el mismo monto, el alumno y el pago), que suma al efectivo esperado del cierre; se confirma el pago
// (criterio 20, ver `confirmacion-alumno.test.ts`); se audita `PAGO_REGISTRADO` (entidad `pago`, actor el usuario, `datosDespues: { matriculaId, metodo, monto, concepto,
// numeroTicket }`, sin DNI), además de `CAJA_INGRESO_REGISTRADO` y `USUARIO_CREADO`.
// Criterio 25 (prueba obligatoria; HU-07, D-09, DR-4): cada pago `CONFIRMADO` recibe al confirmarse el siguiente `numero_ticket` de su academia (1, 2, 3…), sin saltos ni
// repetidos aunque se confirmen pagos a la vez; cada academia tiene su propia numeración.

const CLAVES_DEL_PAGO = [
  'concepto',
  'estado',
  'fechaOperacion',
  'id',
  'metodo',
  'monto',
  'motivoRechazo',
  'numeroOperacion',
  'numeroTicket',
  'registradoEn',
  'verificadoEn',
];

describe('cobro en efectivo en recepción (criterios 13 y 25)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;
  let cajaId: string;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
    cajaId = (await abrirCajaDeHoy(e)).id;
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const cobrar = (c: SolicitudSembrada, cuerpo: Record<string, unknown>, cookie = cookies.secretaria) =>
    ctx.http.post(rutaCobro(c.solicitudId), cuerpo, { cookie });

  describe('criterio 13: el cobro correcto', () => {
    it.each([
      ['la secretaria', 'secretaria', 'secretariaA'],
      ['el administrador', 'admin', 'adminA'],
      ['la otra secretaria', 'secretaria2', 'secretariaA2'],
      ['el otro administrador', 'admin2', 'adminA2'],
    ] as const)(
      'criterio 13: %s cobra: 201 con { pago, solicitud } y Cache-Control: no-store',
      async (_nombre, cookie, usuario) => {
        const cliente = await sembrarCobrable(e);

        const respuesta = await cobrar(cliente, cuerpoCobro('42.00'), cookies[cookie]);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(respuesta.cacheControl).toBe('no-store');
        expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['pago', 'solicitud']);
        const pago = pagoDe(respuesta);
        expect(Object.keys(pago).sort()).toEqual(CLAVES_DEL_PAGO);
        expect(pago).toMatchObject({
          estado: 'CONFIRMADO',
          metodo: 'EFECTIVO',
          concepto: 'INSCRIPCION',
          monto: '42.00',
          numeroOperacion: null,
          fechaOperacion: null,
          motivoRechazo: null,
          numeroTicket: 1,
        });
        expect(pago.registradoEn).toBe(AHORA_007.toISOString());
        expect(pago.verificadoEn).toBe(AHORA_007.toISOString());
        const filas = await leerPagos(e.A.id);
        expect(filas).toHaveLength(1);
        expect(filas[0]).toMatchObject({
          id: pago.id,
          alumno_id: cliente.alumnoId,
          matricula_id: cliente.matriculaId,
          estado: 'CONFIRMADO',
          metodo: 'EFECTIVO',
          concepto: 'INSCRIPCION',
          monto: '42.00',
          registrado_por: e[usuario].id,
          verificado_por: e[usuario].id,
          numero_ticket: 1,
          numero_operacion: null,
          comprobante_clave: null,
          fecha_operacion: null,
        });
        expect(filas[0]?.registrado_en.getTime()).toBe(AHORA_007.getTime());
        expect(filas[0]?.verificado_en?.getTime()).toBe(AHORA_007.getTime());
      },
    );

    it('criterio 13: la respuesta trae el elemento del panel de la solicitud: CONFIRMADA, con el total y el pago, y es el mismo que muestra la lista de confirmadas', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await cobrar(cliente, cuerpoCobro('42'));

      expect(respuesta.status, respuesta.texto).toBe(201);
      const solicitud = solicitudPanelDe(respuesta);
      const pago = pagoDe(respuesta);
      expect(solicitud).toMatchObject({
        id: cliente.solicitudId,
        codigo: cliente.codigo,
        estado: 'CONFIRMADA',
        reservaVenceEn: null,
        monto: '42.00',
        ajuste: null,
        pago: {
          id: pago.id,
          metodo: 'EFECTIVO',
          estado: 'CONFIRMADO',
          monto: '42.00',
          registradoEn: AHORA_007.toISOString(),
          verificadoEn: AHORA_007.toISOString(),
          numeroOperacion: null,
          fechaOperacion: null,
          motivoRechazo: null,
          numeroTicket: 1,
        },
      });
      const lista = await ctx.http.get('/api/solicitudes?estado=CONFIRMADAS', { cookie: cookies.admin });
      expect(lista.status, lista.texto).toBe(200);
      expect(
        (lista.body?.['solicitudes'] as unknown[]).find((s) => (s as { id: string }).id === cliente.solicitudId),
      ).toEqual(solicitud);
    });

    it('criterio 13: el ingreso entra a la caja de hoy como efectivo (el mismo monto, el alumno y el pago) y suma al efectivo esperado del cierre', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await cobrar(cliente, cuerpoCobro('42.00'));

      const pago = pagoDe(respuesta);
      const movimientos = await leerMovimientos(e.A.id);
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]).toMatchObject({
        caja_id: cajaId,
        numero: 1,
        tipo: 'INGRESO',
        concepto: 'INSCRIPCION',
        metodo: 'EFECTIVO',
        monto: '42.00',
        alumno_id: cliente.alumnoId,
        pago_id: pago.id,
        registrado_por: e.secretariaA.id,
      });
      const delDia = await ctx.http.get('/api/cajas/actual', { cookie: cookies.secretaria });
      expect(delDia.status, delDia.texto).toBe(200);
      const caja = delDia.body?.['caja'] as {
        resumen: { ingresos: { efectivo: string }; esperado: { efectivo: string } };
      };
      expect(caja.resumen.ingresos.efectivo).toBe('42.00');
      expect(caja.resumen.esperado.efectivo).toBe('142.00');
    });

    it('criterio 13: audita PAGO_REGISTRADO (entidad pago, el actor, con la matrícula, el método, el monto, el concepto y el ticket, sin DNI), CAJA_INGRESO_REGISTRADO y USUARIO_CREADO', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await cobrar(cliente, cuerpoCobro('42.00'));

      const pago = pagoDe(respuesta);
      const registrados = await leerAuditoriaDeAcademia(e.A.id, 'PAGO_REGISTRADO');
      expect(registrados).toHaveLength(1);
      expect(registrados[0]).toMatchObject({
        entidad: 'pago',
        entidad_id: pago.id,
        actor_tipo: 'USUARIO',
        actor_id: e.secretariaA.id,
      });
      expect(registrados[0]?.datos_despues).toEqual({
        matriculaId: cliente.matriculaId,
        metodo: 'EFECTIVO',
        monto: '42.00',
        concepto: 'INSCRIPCION',
        numeroTicket: 1,
      });
      expect(JSON.stringify(registrados[0]), 'sin el DNI').not.toContain(cliente.dni);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'CAJA_INGRESO_REGISTRADO')).toHaveLength(1);
      const cuenta = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CREADO');
      expect(cuenta).toHaveLength(1);
      expect(cuenta[0]).toMatchObject({ actor_tipo: 'USUARIO', actor_id: e.secretariaA.id });
    });

    it('criterio 13: sin cuerpo extra: un campo de más (la academia, el monto del pago, el método) responde 400 sin cobrar', async () => {
      const cliente = await sembrarCobrable(e);

      for (const extra of [{ academiaId: e.B.id }, { monto: '1.00' }, { metodo: 'YAPE' }, { numeroOperacion: '123' }]) {
        const respuesta = await cobrar(cliente, cuerpoCobro('42.00', extra));
        expect(respuesta.status, JSON.stringify(extra)).toBe(400);
      }
      expect(await leerPagos(e.A.id)).toEqual([]);
    });

    it('criterio 13: el alumno que cobra una solicitud de recepción pasa a ALUMNO_ACTIVO y la solicitud se ve CONFIRMADA en la lista de confirmadas y no en la de activas', async () => {
      const cliente = await sembrarCobrable(e);

      await cobrar(cliente, cuerpoCobro('42.00'));

      expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)?.estado).toBe('ALUMNO_ACTIVO');
      const activas = await ctx.http.get('/api/solicitudes?estado=ACTIVAS', { cookie: cookies.admin });
      const confirmadas = await ctx.http.get('/api/solicitudes?estado=CONFIRMADAS', { cookie: cookies.admin });
      const idsDe = (r: { body: Record<string, unknown> | null }) =>
        (r.body?.['solicitudes'] as { id: string }[]).map((s) => s.id);
      expect(idsDe(activas)).not.toContain(cliente.solicitudId);
      expect(idsDe(confirmadas)).toEqual([cliente.solicitudId]);
    });
  });

  describe('criterio 25: el número del ticket', () => {
    it('criterio 25: los cobros de la academia reciben 1, 2, 3… sin saltos ni repetidos', async () => {
      const numeros: number[] = [];
      for (let i = 0; i < 3; i++) {
        const cliente = await sembrarCobrable(e);
        const respuesta = await cobrar(cliente, cuerpoCobro('42.00'), i % 2 === 0 ? cookies.secretaria : cookies.admin);
        expect(respuesta.status, respuesta.texto).toBe(201);
        numeros.push(pagoDe(respuesta).numeroTicket ?? 0);
      }

      expect(numeros).toEqual([1, 2, 3]);
    });

    it('criterio 25: tres cobros simultáneos de la misma academia reciben 1, 2 y 3 (la caja abierta, bloqueada al final, ordena las confirmaciones)', async () => {
      const clientes = [await sembrarCobrable(e), await sembrarCobrable(e), await sembrarCobrable(e)];

      const respuestas = await Promise.all(clientes.map((c) => cobrar(c, cuerpoCobro('42.00'))));

      for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto).toBe(201);
      expect(respuestas.map((r) => pagoDe(r).numeroTicket).sort()).toEqual([1, 2, 3]);
      expect((await leerPagos(e.A.id)).map((p) => p.numero_ticket).sort()).toEqual([1, 2, 3]);
    });

    it('criterio 25: cada academia tiene su propia numeración: el primer cobro de B también es el ticket 1', async () => {
      const deA = await sembrarCobrable(e);
      await cobrar(deA, cuerpoCobro('42.00'));
      await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      const deB = await sembrarSolicitud(e.B.id, {
        planId: e.planB.id,
        claseIds: [e.lunesB.id],
        clasesTotales: 5,
        clasesPorMesPlan: 12,
        precioPlan: '100.00',
        monto: '42.00',
      });

      const respuesta = await ctx.http.post(rutaCobro(deB.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookies.secretariaB,
      });

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(pagoDe(respuesta).numeroTicket).toBe(1);
      expect((await leerPagos(e.B.id))[0]?.numero_ticket).toBe(1);
      expect((await leerPagos(e.A.id))[0]?.numero_ticket).toBe(1);
    });

    it('criterio 25: un cobro rechazado no consume número: después de un 409, el siguiente cobro recibe el 1', async () => {
      const cliente = await sembrarCobrable(e);
      const mal = await cobrar(cliente, cuerpoCobro('41.00'));
      expect(mal.status).toBe(409);

      const bien = await cobrar(cliente, cuerpoCobro('42.00'));

      expect(pagoDe(bien).numeroTicket).toBe(1);
    });
  });
});
