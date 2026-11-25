// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  instantaneaDeLaAcademia,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import { cerrarCajaDePrueba, retenerUsuarios } from '../../utilidades/caja';
import {
  type AppInscripciones,
  conRetencion,
  crearAppInscripciones,
  cuerpoInscripcion,
  leerAlumnos,
  leerSolicitudes,
  rutaPublica,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';
import type { Retenedor } from '../../utilidades/planes-clases';
import {
  crearUsuarioDePrueba,
  instantaneaDeUsuarios,
  leerUsuarioPorDni,
  leerUsuarios,
} from '../../utilidades/usuarios';

// Criterio 22 (crítico, D-28, RN-03; DR-16 de 005; DR-1 y DT-16 de 007): el personal y los alumnos de una academia no comparten DNI:
//   a) si al confirmar ya hay un usuario de la academia con el DNI del cliente (datos anteriores a esta historia o escritos por otra vía), responde 409 `DNI_DEL_PERSONAL` sin escribir
//      nada (criterio 21), y el administrador decide con el cliente;
//   b) `POST /api/usuarios` (002) con el DNI de un alumno de la academia que no está en `CLIENTE`, o de un cliente con una solicitud activa, responde 409 `DNI_EN_USO` (el mismo cuerpo
//      de 002), sin crear ni auditar. Con el DNI de un cliente sin solicitud activa, crea la cuenta como hoy, y ese cliente ya no puede volver a inscribirse (criterio 21 a de 005);
//   c) la creación de personal y la confirmación con el mismo DNI, a la vez, terminan con exactamente una de las dos y la otra responde su 409; nunca 500 ni `40P01`.

describe('el DNI del personal y de los alumnos (criterio 22)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const cobrar = (c: SolicitudSembrada, cookie = cookies.secretaria) =>
    ctx.http.post(rutaCobro(c.solicitudId), cuerpoCobro('42.00'), { cookie });
  const crearPersonal = (dni: string, rol = 'ENTRENADOR') =>
    ctx.http.post('/api/usuarios', { dni, nombres: 'Persona', apellidos: 'De Prueba', rol }, { cookie: cookies.admin });

  describe('criterio 22 a: al confirmar, un usuario de la academia ya tiene el DNI del cliente', () => {
    it.each([['ENTRENADOR'], ['SECRETARIA'], ['ADMIN'], ['ALUMNO']] as const)(
      'criterio 22 a: con un %s de la academia con ese DNI, el cobro responde 409 DNI_DEL_PERSONAL y no escribe nada',
      async (rol) => {
        await abrirCajaDeHoy(e);
        const cliente = await sembrarCobrable(e);
        await crearUsuarioDePrueba({ academiaId: e.A.id, rol, dni: cliente.dni });
        const antes = await instantaneaDeLaAcademia(e.A.id);

        const respuesta = await cobrar(cliente);

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'DNI_DEL_PERSONAL']);
        expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
        expect(await leerPagos(e.A.id)).toEqual([]);
        expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)).toMatchObject({
          estado: 'CLIENTE',
          usuario_id: null,
        });
      },
    );

    it('criterio 22 a: también con el usuario INACTIVO (su DNI sigue en uso)', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', dni: cliente.dni, estado: 'INACTIVO' });

      const respuesta = await cobrar(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([409, 'DNI_DEL_PERSONAL']);
    });

    it('criterio 22 a: se decide antes que la caja (con la caja cerrada responde DNI_DEL_PERSONAL) y después del monto', async () => {
      const caja = await abrirCajaDeHoy(e);
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
      const cliente = await sembrarCobrable(e);
      await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', dni: cliente.dni });

      const alCobrar = await cobrar(cliente);
      const conMontoViejo = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('41.00'), {
        cookie: cookies.secretaria,
      });

      expect([alCobrar.status, codigoDeRespuesta(alCobrar)]).toEqual([409, 'DNI_DEL_PERSONAL']);
      expect([conMontoViejo.status, codigoDeRespuesta(conMontoViejo)]).toEqual([409, 'MONTO_CAMBIO']);
    });

    it('criterio 22 a: el mismo DNI en un usuario de B no impide el cobro en A (D-28)', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      await crearUsuarioDePrueba({ academiaId: e.B.id, rol: 'ENTRENADOR', dni: cliente.dni });

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
    });
  });

  describe('criterio 22 b: crear personal con el DNI de un alumno o de un cliente con solicitud', () => {
    it.each([
      ['un alumno activo', { estadoAlumno: 'ALUMNO_ACTIVO' }],
      ['un alumno vencido', { estadoAlumno: 'ALUMNO_VENCIDO' }],
      ['un alumno inactivo', { estadoAlumno: 'INACTIVO' }],
      ['un cliente con una solicitud activa (PENDIENTE_PAGO)', {}],
      ['un cliente con una solicitud sin vencimiento', { reservaVenceEn: null }],
    ])(
      'criterio 22 b: el DNI de %s responde 409 DNI_EN_USO (el mismo cuerpo de 002) sin crear ni auditar',
      async (_nombre, opciones) => {
        const alumno = await sembrarCobrable(e, opciones);
        const conocido = await crearPersonal(e.secretariaA.dni, 'SECRETARIA');
        const antes = await instantaneaDeUsuarios(e.A.id);
        const auditoria = (await leerAuditoriaDeAcademia(e.A.id)).length;

        const respuesta = await crearPersonal(alumno.dni);

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'DNI_EN_USO']);
        expect(respuesta.texto, 'el mismo cuerpo que el DNI de un usuario existente (002)').toBe(conocido.texto);
        expect(await instantaneaDeUsuarios(e.A.id)).toBe(antes);
        expect((await leerAuditoriaDeAcademia(e.A.id)).length).toBe(auditoria);
      },
    );

    it.each([
      ['con la reserva vencida (la fila aún dice PENDIENTE_PAGO)', { estado: 'PENDIENTE_PAGO_VENCIDA' as const }],
      ['con la solicitud VENCIDA', { estado: 'VENCIDA' as const }],
      ['con la solicitud CANCELADA', { estado: 'CANCELADA' as const }],
    ])(
      'criterio 22 b: el DNI de un cliente %s (sin solicitud activa) crea la cuenta como hoy (201), y ese cliente ya no puede volver a inscribirse',
      async (_nombre, opciones) => {
        const cliente = await sembrarCobrable(e, opciones);

        const respuesta = await crearPersonal(cliente.dni);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(await leerUsuarioPorDni(e.A.id, cliente.dni)).toMatchObject({ rol: 'ENTRENADOR', dni: cliente.dni });
        const reinscripcion = await ctx.http.post(
          rutaPublica('academia-a', '/inscripcion'),
          await cuerpoInscripcion(e, { sobre: { alumno: { dni: cliente.dni } } }),
        );
        expect([reinscripcion.status, codigoDeRespuesta(reinscripcion)], reinscripcion.texto).toEqual([
          409,
          'DNI_YA_REGISTRADO',
        ]);
      },
    );

    it('criterio 22 b: el DNI de un cliente de B no impide crear personal en A', async () => {
      const deB = await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });

      const respuesta = await crearPersonal(deB.dni);

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 22 b: un DNI sin ninguna relación con alumnos ni clientes se sigue creando como siempre (control)', async () => {
      const respuesta = await crearPersonal('20202020', 'SECRETARIA');

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect((await leerUsuarios(e.A.id)).some((u) => u.dni === '20202020')).toBe(true);
    });
  });

  describe('criterio 22 c: la creación de personal y la confirmación con el mismo DNI, a la vez', () => {
    const consultivoDelDni = (cliente: SolicitudSembrada) => async (retenedor: Retenedor) => {
      await retenedor.consultar(
        "SELECT pg_advisory_xact_lock(hashtextextended('inscripcion-dni:' || $1::text || ':' || $2::text, 0))",
        [e.A.id, cliente.dni],
      );
    };

    it('criterio 22 c: con el bloqueo consultivo del DNI retenido por la prueba, el cobro y la creación de personal esperan los dos (los dos toman el mismo bloqueo, DT-16)', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: consultivoDelDni(cliente),
        enviar: [() => cobrar(cliente), () => crearPersonal(cliente.dni)],
        enOrden: true,
        liberar: 'ROLLBACK',
      });

      expect(
        todasEsperaron,
        'el cobro y la creación de personal debían quedar esperando el bloqueo consultivo del DNI',
      ).toBe(true);
      const [cobro, creacion] = resultados;
      expect(cobro?.status, cobro?.texto).toBeLessThan(500);
      expect(creacion?.status, creacion?.texto).toBeLessThan(500);
    });

    it('criterio 22 c: terminan con exactamente una de las dos y la otra responde su 409; nunca 500 ni 40P01; la base queda coherente', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerUsuarios(e.A.id, [e.secretariaA.id, e.adminA.id]),
        enviar: [() => cobrar(cliente), () => crearPersonal(cliente.dni)],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      const [cobro, creacion] = resultados;
      for (const r of resultados) {
        expect(r.status, r.texto).toBeLessThan(500);
        expect(r.texto).not.toMatch(/40P01|deadlock/i);
      }
      const gano = [cobro, creacion].filter((r) => r && r.status >= 200 && r.status < 300);
      expect(gano, `cobro ${cobro?.texto} creación ${creacion?.texto}`).toHaveLength(1);
      const cuentas = (await leerUsuarios(e.A.id)).filter((u) => u.dni === cliente.dni);
      expect(cuentas, 'nunca dos cuentas con el mismo DNI').toHaveLength(1);
      if (cobro?.status === 201) {
        expect(codigoDeRespuesta(creacion!)).toBe('DNI_EN_USO');
        expect(cuentas[0]?.rol).toBe('ALUMNO');
        expect(await leerPagos(e.A.id)).toHaveLength(1);
      } else {
        expect(codigoDeRespuesta(cobro!)).toBe('DNI_DEL_PERSONAL');
        expect(cuentas[0]?.rol).toBe('ENTRENADOR');
        expect(await leerPagos(e.A.id)).toHaveLength(0);
        expect((await leerSolicitudes(e.A.id))[0]?.estado).toBe('PENDIENTE_PAGO');
      }
    });
  });
});
