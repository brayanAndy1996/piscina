// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerMovimientos } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import { comprobanteDe, exigirRutasDe007b, sembrarRechazada } from '../../utilidades/escenario-pagos-007b';
import {
  crearPlanYClaseSabado,
  cuerpoInscripcion,
  leerAlumnos,
  leerMatriculas,
  llenarClase,
  ocupacionDeClase,
  rutaPublica,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  archivosBajo,
  crearAppConAlmacen,
  exigirAlmacen,
} from '../../utilidades/inscripciones-005b';
import { filaPagoValida, leerPagos, sqlInsertarPago } from '../../utilidades/pagos';
import { abrirRetenedor, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';
import { cookieDeUsuario } from '../../utilidades/usuarios';

// Criterio 60 (crítico, ronda adversarial 1 de la 007b, falla R1-1; RN-11, RN-28, D-05; criterios 18 b, 37, 41 y 44; «Aforo» de `CLAUDE.md`): la subida del comprobante
// (`PUT /api/a/{nombreCorto}/solicitudes/comprobante`) bloquea siempre las clases antes de decidir, también con la reserva vigente, y nunca deja una clase con más matrículas que
// ocupan cupo que su aforo por su culpa.
// Reproducción determinista: aforo 20 con 19 matrículas que ocupan cupo más la solicitud S, cuya reserva vence en T. La subida de S empieza con el reloj en T0 (antes de T) y su
// `INSERT` del pago queda retenido en el índice `pagos_numero_operacion_abierto_key` por otra transacción sin confirmar (de la misma academia, el mismo método y el mismo número
// normalizado, que no bloquea clases). Con la subida retenida y el reloj en T, llega otra operación por el último cupo (un envío de la 005 o el cobro en efectivo de una solicitud
// `PAGO_RECHAZADO`). La transacción que retiene se revierte. Resultado: exactamente un 201, la ocupación final de la clase como mucho 20 (nunca 21) y la operación que pierde no deja nada.
// Control: si la subida hace su lectura corta con el reloj en T0 y entra a su transacción con el reloj ya en T, después de que el envío tomó el cupo y confirmó, responde 409
// `SOLICITUD_NO_EDITABLE`, sin pago, archivo ni auditoría, y la ocupación queda en 20.

describe('la subida del comprobante bloquea las clases antes de decidir (criterio 60)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  const mes = { anio: 2026, mes: 11 };
  const T0 = AHORA_007;
  const T = new Date(T0.getTime() + 60 * 60 * 1000);

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ ahora: AHORA_007 });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(T0);
    ctx.vaciarAlmacen();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const ocupacion = (claseId: string, ahora: Date) => ocupacionDeClase(e.A.id, claseId, mes, ahora);
  const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
  const numeroNuevo = () => `77700${Math.floor(Math.random() * 100000)}`;

  /** Aforo 20 con 19 matrículas que ocupan cupo más la solicitud S, cuya reserva vence en T (a las 10:30, hora de Lima). */
  const sembrarClaseConLaReservaQueVence = async () => {
    const { plan, clase } = await crearPlanYClaseSabado(e);
    await llenarClase(e.A.id, clase.id, plan.id, 19, { ahora: T0 });
    const s = await sembrarSolicitud(e.A.id, {
      planId: plan.id,
      claseIds: [clase.id],
      clasesTotales: 3,
      clasesPorMesPlan: 4,
      precioPlan: '40.00',
      monto: '30.00',
      reservaVenceEn: T,
      ahora: T0,
    });
    expect(await ocupacion(clase.id, T0), 'antes de T, S ocupa el cupo número 20').toBe(20);
    expect(await ocupacion(clase.id, T), 'en T la reserva de S ya no cuenta').toBe(19);
    return { plan, clase, s };
  };

  /** Un pago abierto de otra solicitud, sin confirmar, con el número que usará la subida: su `INSERT` espera el índice del número de operación. */
  const retenerElIndiceDelNumero = async (numero: string) => {
    const otra = await sembrarCobrable(e);
    const retenedor = await abrirRetenedor(e.A.id);
    try {
      const fila = filaPagoValida(
        e.A.id,
        { alumnoId: otra.alumnoId, matriculaId: otra.matriculaId },
        {},
        { numero_operacion: numero, numero_operacion_normalizado: numero },
      );
      const { sql, valores } = sqlInsertarPago(e.A.id, fila);
      await retenedor.consultar(sql, valores);
    } catch (error) {
      await retenedor.liberar('ROLLBACK');
      throw error;
    }
    return retenedor;
  };

  /** Lo que la subida de S deja: el pago de su matrícula, los archivos del almacén y la auditoría `PAGO_COMPROBANTE_REGISTRADO`. */
  const loQueDejaLaSubida = async (s: SolicitudSembrada) => ({
    pagos: (await leerPagos(e.A.id)).filter((p) => p.matricula_id === s.matriculaId).length,
    archivos: archivosBajo(ctx.raiz).length,
    auditoria: (await leerAuditoriaDeAcademia(e.A.id, 'PAGO_COMPROBANTE_REGISTRADO')).length,
  });

  describe('criterio 60 (determinista): la subida retenida y otra operación por el último cupo', () => {
    it('criterio 60 a y c: la subida de S, retenida en el índice del número, y un envío de la 005 en T por la misma clase: un solo 201, la ocupación como mucho 20 y quien pierde no deja nada', async () => {
      const { plan, clase, s } = await sembrarClaseConLaReservaQueVence();
      const cuerpoDelEnvio = await cuerpoInscripcion(e, { plan, clases: [clase], ahora: T });
      const numero = numeroNuevo();
      const retenedor = await retenerElIndiceDelNumero(numero);
      // Después del retenedor: `retenerElIndiceDelNumero` siembra otra solicitud con su alumno y su matrícula.
      const alumnosAntes = (await leerAlumnos(e.A.id)).length;
      const matriculasAntes = (await leerMatriculas(e.A.id)).length;
      let comprobante: Awaited<ReturnType<typeof comprobanteDe>>;
      let envio: Awaited<ReturnType<typeof enviar>>;
      try {
        ctx.reloj.fijar(T0);
        const subida = observar(
          comprobanteDe(ctx, s, {
            monto: '30.00',
            numeroOperacion: numero,
            fechaOperacion: '2026-11-11',
            claveIdempotencia: randomUUID(),
          }),
        );
        const subidaEsperando = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [subida],
          'la subida del comprobante ni respondió ni quedó esperando el índice del número de operación.',
        );
        expect(subidaEsperando, 'la subida debía quedar esperando el índice del número de operación').toBe(true);

        // En T, otra persona se inscribe en la misma clase: para ella, la reserva de S ya venció. Si la subida ya tiene las clases, el envío espera; si no, termina enseguida.
        ctx.reloj.fijar(T);
        const envioObservado = observar(enviar(cuerpoDelEnvio));
        await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 2,
          [envioObservado],
          'el envío ni respondió ni quedó esperando.',
        );
        await retenedor.liberar('ROLLBACK');
        [comprobante, envio] = await conLimite(
          Promise.all([subida.resultado, envioObservado.resultado]),
          'Límite de seguridad: la subida y el envío no respondieron tras revertir la retención.',
        );
      } finally {
        await retenedor.liberar('ROLLBACK');
      }

      const resumen = `subida: ${comprobante.status} ${comprobante.texto} | envío: ${envio.status} ${envio.texto}`;
      expect(await ocupacion(clase.id, T), `nunca más inscritos que el aforo; ${resumen}`).toBeLessThanOrEqual(20);
      expect(
        [comprobante.status, envio.status].filter((estado) => estado === 201),
        `exactamente una de las dos operaciones responde 201; ${resumen}`,
      ).toHaveLength(1);
      expect(
        [comprobante.status, envio.status].filter((estado) => estado === 409),
        `la otra responde 409; ${resumen}`,
      ).toHaveLength(1);

      if (comprobante.status === 409) {
        // Perdió la subida: no deja pago, archivo ni auditoría, y S sigue como estaba.
        expect(await loQueDejaLaSubida(s)).toEqual({ pagos: 0, archivos: 0, auditoria: 0 });
      } else {
        // Perdió el envío (el resultado esperado): `SIN_CUPO`, sin solicitud, matrícula ni persona nuevas.
        expect([envio.status, codigoDeRespuesta(envio)]).toEqual([409, 'SIN_CUPO']);
        expect((await leerAlumnos(e.A.id)).length, 'el envío que pierde no deja la persona').toBe(alumnosAntes);
        expect((await leerMatriculas(e.A.id)).length, 'el envío que pierde no deja la matrícula').toBe(matriculasAntes);
        expect((await loQueDejaLaSubida(s)).pagos, 'la subida que gana deja su pago').toBe(1);
      }
    });

    it('criterio 60 a y c: la subida de S, retenida en el índice del número, y el cobro en efectivo de una solicitud PAGO_RECHAZADO en T por la misma clase: un solo 201, la ocupación como mucho 20 y quien pierde no deja nada', async () => {
      const { plan, clase, s } = await sembrarClaseConLaReservaQueVence();
      const rechazada = await sembrarRechazada(e, {
        planId: plan.id,
        claseIds: [clase.id],
        clasesTotales: 3,
        clasesPorMesPlan: 4,
        precioPlan: '40.00',
        monto: '30.00',
        ahora: T0,
      });
      await abrirCajaDeHoy(e);
      expect(await ocupacion(clase.id, T0), 'la rechazada no ocupa cupo').toBe(20);
      const numero = numeroNuevo();
      const retenedor = await retenerElIndiceDelNumero(numero);
      let comprobante: Awaited<ReturnType<typeof comprobanteDe>>;
      let cobro: Awaited<ReturnType<typeof comprobanteDe>>;
      try {
        ctx.reloj.fijar(T0);
        const subida = observar(
          comprobanteDe(ctx, s, {
            monto: '30.00',
            numeroOperacion: numero,
            fechaOperacion: '2026-11-11',
            claveIdempotencia: randomUUID(),
          }),
        );
        const subidaEsperando = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [subida],
          'la subida del comprobante ni respondió ni quedó esperando el índice del número de operación.',
        );
        expect(subidaEsperando, 'la subida debía quedar esperando el índice del número de operación').toBe(true);

        ctx.reloj.fijar(T);
        const cobroObservado = observar(
          ctx.http.post(rutaCobro(rechazada.solicitudId), cuerpoCobro('30.00'), {
            cookie: cookieDeUsuario(e.secretariaA, T),
          }),
        );
        await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 2,
          [cobroObservado],
          'el cobro ni respondió ni quedó esperando.',
        );
        await retenedor.liberar('ROLLBACK');
        [comprobante, cobro] = await conLimite(
          Promise.all([subida.resultado, cobroObservado.resultado]),
          'Límite de seguridad: la subida y el cobro no respondieron tras revertir la retención.',
        );
      } finally {
        await retenedor.liberar('ROLLBACK');
      }

      const resumen = `subida: ${comprobante.status} ${comprobante.texto} | cobro: ${cobro.status} ${cobro.texto}`;
      expect(await ocupacion(clase.id, T), `nunca más inscritos que el aforo; ${resumen}`).toBeLessThanOrEqual(20);
      expect(
        [comprobante.status, cobro.status].filter((estado) => estado === 201),
        `exactamente una de las dos operaciones responde 201; ${resumen}`,
      ).toHaveLength(1);
      expect(
        [comprobante.status, cobro.status].filter((estado) => estado === 409),
        `la otra responde 409; ${resumen}`,
      ).toHaveLength(1);

      const matriculaDeLaRechazada = async () =>
        (await leerMatriculas(e.A.id)).find((m) => m.id === rechazada.matriculaId)?.estado;
      if (comprobante.status === 409) {
        expect(await loQueDejaLaSubida(s)).toEqual({ pagos: 0, archivos: 0, auditoria: 0 });
      } else {
        // Perdió el cobro (el resultado esperado): `SIN_CUPO`, sin pago en efectivo ni movimiento, y la matrícula sigue `CANCELADA`.
        expect([cobro.status, codigoDeRespuesta(cobro)]).toEqual([409, 'SIN_CUPO']);
        expect(await matriculaDeLaRechazada()).toBe('CANCELADA');
        expect((await leerPagos(e.A.id)).filter((p) => p.metodo === 'EFECTIVO')).toEqual([]);
        expect(await leerMovimientos(e.A.id)).toEqual([]);
        expect((await loQueDejaLaSubida(s)).pagos, 'la subida que gana deja su pago').toBe(1);
      }
    });
  });

  describe('criterio 60 (control): la subida que entra a su transacción cuando su reserva ya venció', () => {
    it('criterio 60 b (control): la lectura corta con el reloj en T0 y la transacción con el reloj en T, después de que el envío tomó el cupo, responde 409 SOLICITUD_NO_EDITABLE sin dejar nada y la ocupación queda en 20', async () => {
      const { plan, clase, s } = await sembrarClaseConLaReservaQueVence();
      const cuerpoDelEnvio = await cuerpoInscripcion(e, { plan, clases: [clase], ahora: T });
      const retenedor = await abrirRetenedor(e.A.id);
      let comprobante: Awaited<ReturnType<typeof comprobanteDe>>;
      let envio: Awaited<ReturnType<typeof enviar>>;
      try {
        // La fila de la solicitud retenida: la lectura corta (sin bloqueos) pasa con el reloj en T0 y la transacción espera.
        await retenedor.consultar(
          'SELECT id FROM solicitudes_inscripcion WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
          [e.A.id, s.solicitudId],
        );
        ctx.reloj.fijar(T0);
        const subida = observar(
          comprobanteDe(ctx, s, { monto: '30.00', fechaOperacion: '2026-11-11', claveIdempotencia: randomUUID() }),
        );
        const subidaEsperando = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [subida],
          'la subida del comprobante ni respondió ni quedó esperando la fila de la solicitud.',
        );
        expect(subidaEsperando, 'la subida debía quedar esperando la fila de la solicitud').toBe(true);

        ctx.reloj.fijar(T);
        envio = await conLimite(enviar(cuerpoDelEnvio), 'el envío no respondió con la subida esperando');
        expect(envio.status, envio.texto).toBe(201);

        await retenedor.liberar('ROLLBACK');
        comprobante = await conLimite(subida.resultado, 'la subida no respondió tras soltar la fila de la solicitud');
      } finally {
        await retenedor.liberar('ROLLBACK');
      }

      expect([comprobante.status, codigoDeRespuesta(comprobante)], comprobante.texto).toEqual([
        409,
        'SOLICITUD_NO_EDITABLE',
      ]);
      expect(await loQueDejaLaSubida(s)).toEqual({ pagos: 0, archivos: 0, auditoria: 0 });
      expect(await ocupacion(clase.id, T)).toBe(20);
    });
  });
});
