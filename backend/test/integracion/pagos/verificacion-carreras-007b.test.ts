// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerMovimientos, retenerCaja } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  type EscenarioPagos,
  exigirRutasDePagos,
  pagoDe,
} from '../../utilidades/escenario-pagos';
import {
  exigirRutasDe007b,
  rutaAprobacion,
  rutaRechazo,
  sembrarEnVerificacion,
} from '../../utilidades/escenario-pagos-007b';
import {
  conRetencion,
  cuerpoInscripcion,
  leerAlumnos,
  leerMatriculas,
  llenarClase,
  ocupacionDeClase,
  type RespuestaApi,
  retenerClases,
  rutaPublica,
} from '../../utilidades/inscripciones';
import { type AppConAlmacen, crearAppConAlmacen, exigirAlmacen } from '../../utilidades/inscripciones-005b';
import { leerPagos } from '../../utilidades/pagos';
import type { Retenedor } from '../../utilidades/planes-clases';
import { leerUsuarios } from '../../utilidades/usuarios';

// Criterio 48 (crítico, «aprobar dos veces» y «aprobar un pago rechazado» de `CLAUDE.md`): dos aprobaciones simultáneas dejan un movimiento, una cuenta y una auditoría (las dos 200); una aprobación y un rechazo
// simultáneos dejan exactamente uno de los dos (200 y 409 `PAGO_YA_CONFIRMADO` o `PAGO_YA_RECHAZADO`). Sin `40P01` ni 500.
// Criterio 50 (crítico, RN-28, RN-11): un rechazo y un envío simultáneos por la clase llena terminan sin superar el aforo.
// Orden de bloqueos (arquitectura): `usuarios` (actor) → bloqueo consultivo del DNI → `alumnos` → `solicitudes_inscripcion` → `matriculas` → `pagos` → `clases` → la caja, al final (regla de la 006): una aprobación a la vez que
// un egreso o un cierre de la caja termina sin `40P01` ni 500. Pruebas deterministas: la prueba retiene una fila que las operaciones necesitan, las envía (en los dos órdenes), comprueba que esperan y recién entonces libera.

describe('aprobar y rechazar a la vez: sin interbloqueos y con un solo ganador (criterios 48 y 50)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;
  let cajaId: string;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ ahora: AHORA_007 });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
    cookies = cookiesDePagos(e);
    cajaId = (await abrirCajaDeHoy(e)).id;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const MOTIVO = 'La imagen no se lee';
  const aprobar = (pagoId: string, cookie = cookies.secretaria) =>
    ctx.http.post(rutaAprobacion(pagoId), {}, { cookie });
  const rechazar = (pagoId: string, cookie = cookies.secretaria) =>
    ctx.http.post(rutaRechazo(pagoId), { motivo: MOTIVO }, { cookie });
  const sinError500 = (r: RespuestaApi) => {
    expect(r.status, r.texto).toBeLessThan(500);
    expect(r.texto).not.toMatch(/40P01|deadlock|interbloqueo/i);
  };
  const resumen = (r: RespuestaApi) => [r.status, codigoDeRespuesta(r)];

  /** Retiene la fila del pago (el último bloqueo antes de las clases) para que las operaciones se crucen siempre. */
  const retenerPago = (pagoId: string) => async (retenedor: Retenedor) => {
    await retenedor.consultar('SELECT id FROM pagos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
      e.A.id,
      pagoId,
    ]);
  };

  describe('criterio 48: dos aprobaciones del mismo pago', () => {
    it('criterio 48: dos aprobaciones simultáneas (la secretaria y el administrador) responden 200 las dos con el mismo pago y dejan un movimiento, una cuenta, un ticket y una auditoría', async () => {
      const cliente = await sembrarEnVerificacion(e);

      const [uno, otro] = await Promise.all([aprobar(cliente.pagoId), aprobar(cliente.pagoId, cookies.admin)]);

      expect([uno.status, otro.status], `${uno.texto} | ${otro.texto}`).toEqual([200, 200]);
      expect(pagoDe(uno)).toEqual(pagoDe(otro));
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect((await leerUsuarios(e.A.id)).filter((u) => u.dni === cliente.dni)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_APROBADO')).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CREADO')).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'CAJA_INGRESO_REGISTRADO')).toHaveLength(1);
      expect((await leerPagos(e.A.id)).map((p) => [p.estado, p.numero_ticket])).toEqual([['CONFIRMADO', 1]]);
    });

    it('criterio 48 (determinista): con las filas del pago retenidas, las dos aprobaciones esperan; al soltarlas responden 200 las dos y dejan un movimiento, una cuenta y una auditoría', async () => {
      const cliente = await sembrarEnVerificacion(e);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerPago(cliente.pagoId),
        enviar: [() => aprobar(cliente.pagoId), () => aprobar(cliente.pagoId, cookies.admin)],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron, 'las dos aprobaciones debían quedar esperando el pago retenido').toBe(true);
      expect(resultados.map((r) => r.status)).toEqual([200, 200]);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect((await leerUsuarios(e.A.id)).filter((u) => u.dni === cliente.dni)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_APROBADO')).toHaveLength(1);
    });

    it('criterio 48 y 25: tres aprobaciones simultáneas de tres pagos distintos responden 200 con los tickets 1, 2 y 3 (la caja, bloqueada al final, ordena las confirmaciones) y dejan tres movimientos', async () => {
      const pagos = [await sembrarEnVerificacion(e), await sembrarEnVerificacion(e), await sembrarEnVerificacion(e)];

      const respuestas = await Promise.all(pagos.map((p) => aprobar(p.pagoId)));

      for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuestas.map((r) => pagoDe(r).numeroTicket).sort()).toEqual([1, 2, 3]);
      expect(await leerMovimientos(e.A.id)).toHaveLength(3);
      expect((await leerPagos(e.A.id)).map((p) => p.numero_ticket).sort()).toEqual([1, 2, 3]);
    });
  });

  describe('criterio 48: una aprobación y un rechazo del mismo pago', () => {
    it('criterio 48 (determinista): si la aprobación llega primero, gana: 200 y el rechazo responde 409 PAGO_YA_CONFIRMADO; queda el movimiento, la cuenta y el ticket', async () => {
      const cliente = await sembrarEnVerificacion(e);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerPago(cliente.pagoId),
        enviar: [() => aprobar(cliente.pagoId), () => rechazar(cliente.pagoId)],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      const [aprobacion, rechazo] = resultados as [RespuestaApi, RespuestaApi];
      expect(aprobacion.status, aprobacion.texto).toBe(200);
      expect(resumen(rechazo), rechazo.texto).toEqual([409, 'PAGO_YA_CONFIRMADO']);
      expect((await leerPagos(e.A.id)).map((p) => [p.estado, p.numero_ticket])).toEqual([['CONFIRMADO', 1]]);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect((await leerMatriculas(e.A.id))[0]?.estado).toBe('VIGENTE');
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_RECHAZADO')).toEqual([]);
    });

    it('criterio 48 (determinista): si el rechazo llega primero, gana: 200 y la aprobación responde 409 PAGO_YA_RECHAZADO; no queda movimiento, cuenta ni ticket', async () => {
      const cliente = await sembrarEnVerificacion(e);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerPago(cliente.pagoId),
        enviar: [() => rechazar(cliente.pagoId), () => aprobar(cliente.pagoId)],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      const [rechazo, aprobacion] = resultados as [RespuestaApi, RespuestaApi];
      expect(rechazo.status, rechazo.texto).toBe(200);
      expect(resumen(aprobacion), aprobacion.texto).toEqual([409, 'PAGO_YA_RECHAZADO']);
      expect((await leerPagos(e.A.id)).map((p) => [p.estado, p.numero_ticket])).toEqual([['RECHAZADO', null]]);
      expect(await leerMovimientos(e.A.id)).toEqual([]);
      expect((await leerUsuarios(e.A.id)).filter((u) => u.dni === cliente.dni)).toEqual([]);
      expect((await leerAlumnos(e.A.id))[0]?.estado).toBe('CLIENTE');
      expect((await leerMatriculas(e.A.id))[0]?.estado).toBe('CANCELADA');
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_APROBADO')).toEqual([]);
    });

    it('criterio 48: cinco parejas de aprobación y rechazo simultáneos sobre cinco pagos dejan siempre exactamente un ganador por pago, coherente en el pago, la matrícula, la caja y la auditoría, sin 40P01 ni 500', async () => {
      const clientes = [];
      for (let i = 0; i < 5; i++) clientes.push(await sembrarEnVerificacion(e));

      const respuestas = await Promise.all(
        clientes.flatMap((c) => [aprobar(c.pagoId), rechazar(c.pagoId, cookies.admin)]),
      );

      for (const respuesta of respuestas) sinError500(respuesta);
      const pagos = await leerPagos(e.A.id);
      const matriculas = await leerMatriculas(e.A.id);
      for (const [i, cliente] of clientes.entries()) {
        const aprobacion = respuestas[2 * i] as RespuestaApi;
        const rechazo = respuestas[2 * i + 1] as RespuestaApi;
        const pago = pagos.find((p) => p.id === cliente.pagoId);
        const ganaLaAprobacion = aprobacion.status === 200 && resumen(rechazo).join() === '409,PAGO_YA_CONFIRMADO';
        const ganaElRechazo = rechazo.status === 200 && resumen(aprobacion).join() === '409,PAGO_YA_RECHAZADO';
        expect(ganaLaAprobacion || ganaElRechazo, `pareja ${i}: ${aprobacion.texto} | ${rechazo.texto}`).toBe(true);
        expect(pago?.estado).toBe(ganaLaAprobacion ? 'CONFIRMADO' : 'RECHAZADO');
        expect(matriculas.find((m) => m.id === cliente.matriculaId)?.estado).toBe(
          ganaLaAprobacion ? 'VIGENTE' : 'CANCELADA',
        );
      }
      const confirmados = pagos.filter((p) => p.estado === 'CONFIRMADO');
      expect(await leerMovimientos(e.A.id), 'un movimiento por cada pago confirmado').toHaveLength(confirmados.length);
      expect(confirmados.map((p) => p.numero_ticket).sort()).toEqual(confirmados.map((_p, i) => i + 1));
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_APROBADO')).toHaveLength(confirmados.length);
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_RECHAZADO')).toHaveLength(5 - confirmados.length);
    });

    it('criterio 49: dos rechazos simultáneos del mismo pago responden 200 los dos con el mismo pago y dejan una sola auditoría', async () => {
      const cliente = await sembrarEnVerificacion(e);

      const [uno, otro] = await Promise.all([rechazar(cliente.pagoId), rechazar(cliente.pagoId, cookies.admin)]);

      expect([uno.status, otro.status], `${uno.texto} | ${otro.texto}`).toEqual([200, 200]);
      expect(pagoDe(uno).motivoRechazo).toBe(MOTIVO);
      expect(pagoDe(otro)).toEqual(pagoDe(uno));
      expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_RECHAZADO')).toHaveLength(1);
    });
  });

  describe('criterio 50: un rechazo y un envío simultáneos por el último cupo', () => {
    const mes = { anio: 2026, mes: 11 };
    const enviar = async () => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));

    it('criterio 50 (determinista): si el rechazo llega primero a la clase, el envío toma el cupo liberado (201) y la clase queda en 20, no más', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const cliente = await sembrarEnVerificacion(e);
      const cuerpoDelEnvio = await cuerpoInscripcion(e);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [
          () => rechazar(cliente.pagoId),
          () => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpoDelEnvio),
        ],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron, 'el rechazo y el envío debían quedar esperando el bloqueo de la clase').toBe(true);
      const [rechazo, envio] = resultados as [RespuestaApi, RespuestaApi];
      expect(rechazo.status, rechazo.texto).toBe(200);
      expect(envio.status, envio.texto).toBe(201);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBe(20);
    });

    it('criterio 50 (determinista): si el envío llega primero a la clase, todavía está llena (SIN_CUPO) y el rechazo igual se acepta; la clase queda en 19', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const cliente = await sembrarEnVerificacion(e);
      const cuerpoDelEnvio = await cuerpoInscripcion(e);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [
          () => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpoDelEnvio),
          () => rechazar(cliente.pagoId),
        ],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      const [envio, rechazo] = resultados as [RespuestaApi, RespuestaApi];
      expect(resumen(envio), envio.texto).toEqual([409, 'SIN_CUPO']);
      expect(rechazo.status, rechazo.texto).toBe(200);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBe(19);
    });

    it('criterio 50: un rechazo y varios envíos simultáneos por la clase llena terminan sin superar el aforo (como mucho uno toma el cupo liberado) y sin 500', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const cliente = await sembrarEnVerificacion(e);

      const [rechazo, ...envios] = await Promise.all([rechazar(cliente.pagoId), enviar(), enviar(), enviar()]);

      expect(rechazo?.status, rechazo?.texto).toBe(200);
      for (const envio of envios) sinError500(envio);
      expect(envios.filter((r) => r.status === 201).length).toBeLessThanOrEqual(1);
      expect(
        envios.filter((r) => r.status !== 201).map((r) => resumen(r).join()),
        'los envíos que no entran responden SIN_CUPO',
      ).toEqual(envios.filter((r) => r.status !== 201).map(() => '409,SIN_CUPO'));
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBeLessThanOrEqual(20);
    });
  });

  describe('la aprobación contra la caja: sin interbloqueos', () => {
    const PARES: {
      nombre: string;
      otra: () => Promise<RespuestaApi>;
      validar: (aprobacion: RespuestaApi, otra: RespuestaApi) => void;
    }[] = [
      {
        nombre: 'un egreso de la misma caja',
        otra: () =>
          ctx.http.post(
            `/api/cajas/${cajaId}/egresos`,
            { claveIdempotencia: randomUUID(), descripcion: 'Compra de útiles de limpieza', monto: '10.00' },
            { cookie: cookies.admin },
          ),
        validar: (aprobacion, egreso) => {
          expect(aprobacion.status, aprobacion.texto).toBe(200);
          expect(egreso.status, egreso.texto).toBe(201);
        },
      },
      {
        nombre: 'el cierre de la misma caja',
        otra: () =>
          ctx.http.post(
            `/api/cajas/${cajaId}/cierre`,
            {
              claveIdempotencia: randomUUID(),
              montoDeclarado: '100.00',
              ultimoMovimientoVisto: 0,
              observacion: 'Conteo de la prueba',
            },
            { cookie: cookies.admin },
          ),
        validar: (aprobacion, cierre) => {
          const aprobacionPrimero = aprobacion.status === 200 && cierre.status === 409;
          const cierrePrimero = cierre.status === 200 && resumen(aprobacion).join() === '409,SIN_CAJA_ABIERTA';
          expect(aprobacionPrimero || cierrePrimero, `aprobación ${aprobacion.texto} cierre ${cierre.texto}`).toBe(
            true,
          );
        },
      },
    ];

    it.each(PARES)(
      'criterio 48: la aprobación a la vez que $nombre termina sin 40P01 ni 500, en los dos órdenes, y cada operación responde su éxito o su 409',
      async (par) => {
        for (const aprobacionPrimero of [true, false]) {
          const cliente = await sembrarEnVerificacion(e);
          const hacerAprobacion = () => aprobar(cliente.pagoId);
          const { resultados, todasEsperaron } = await conRetencion({
            academiaId: e.A.id,
            retener: retenerCaja(e.A.id, cajaId),
            enviar: aprobacionPrimero ? [hacerAprobacion, par.otra] : [par.otra, hacerAprobacion],
            enOrden: true,
            liberar: 'COMMIT',
          });

          expect(todasEsperaron, 'las dos operaciones debían quedar esperando la caja retenida').toBe(true);
          const [primera, segunda] = resultados as [RespuestaApi, RespuestaApi];
          sinError500(primera);
          sinError500(segunda);
          par.validar(aprobacionPrimero ? primera : segunda, aprobacionPrimero ? segunda : primera);
          if (par.nombre.startsWith('el cierre')) break; // el cierre deja la caja cerrada: solo se prueba con la aprobación primero
        }
      },
    );
  });
});
