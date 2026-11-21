// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conFilaRetenida } from '../../utilidades/carreras';
import { ejecutarComo } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  conRetencion,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerMatriculas,
  leerSolicitudes,
  llenarClase,
  ocupacionDeClase,
  type RespuestaApi,
  retenerClases,
  rutaPublica,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import type { Retenedor } from '../../utilidades/planes-clases';
import {
  CLAVE_COMUN,
  cookieDeUsuario,
  crearUsuarioDePrueba,
  leerUsuario,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 39, pruebas c a f (crítico, RN-22, RN-28, DT-5 de 002; PB12), deterministas, con la espera comprobada en `pg_locks` y sin tiempos:
//   c) dos cancelaciones simultáneas de la misma solicitud: las dos responden 200 y queda una sola auditoría;
//   d) carrera del actor como el criterio 7 de 004: el actor se desactiva (o cambia su versión de token) mientras la petición espera: 401 y nada escrito;
//   e) una cancelación y un envío por el último cupo de la misma clase a la vez, y una cancelación y un `PATCH` del aforo de esa clase a la vez: ninguno
//      responde 500 ni falla con 40P01, y nunca hay más ocupación que aforo por una inscripción nueva;
//   f) una cancelación y un envío con el mismo DNI (criterio 21 b) a la vez: el envío responde 201 o 409 DNI_YA_REGISTRADO, según quién entre primero,
//      nunca 500.
// Orden de bloqueos del criterio 39: `bloquearActorVigente` → la solicitud `FOR UPDATE` → su matrícula `FOR UPDATE` → `bloquearClasesParaCupo`.

const ACCION = 'SOLICITUD_INSCRIPCION_CANCELADA';
const MOTIVO = 'Cancelada por la secretaría';
const MES = { anio: 2026, mes: 11 };

describe('cancelar una solicitud: carreras (criterio 39 c a f)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  let cookieAdmin: string;
  let cookieSecretaria: string;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ ahora: AHORA_005 });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
    cookieAdmin = cookieDeUsuario(e.adminA, AHORA_005);
    cookieSecretaria = cookieDeUsuario(e.secretariaA, AHORA_005);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const sembrar = (opciones: Partial<Parameters<typeof sembrarSolicitud>[1]> = {}): Promise<SolicitudSembrada> =>
    sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], ...opciones });
  const cancelar = (id: string, cookie = cookieAdmin): Promise<RespuestaApi> =>
    ctx.http.post(`/api/solicitudes/${id}/cancelar`, { motivo: MOTIVO }, { cookie });
  const enviar = async (sobre: Record<string, unknown> = {}): Promise<RespuestaApi> =>
    ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e, { sobre }));
  const bloquearSolicitud = (id: string) => async (retenedor: Retenedor) => {
    await retenedor.consultar(
      'SELECT id FROM solicitudes_inscripcion WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
      [e.A.id, id],
    );
  };
  const auditorias = async () => (await leerAuditoriaDeAcademia(e.A.id, ACCION)).length;

  describe('c) dos cancelaciones simultáneas', () => {
    it('criterio 39 c: la prueba retiene la fila de la solicitud; las dos cancelaciones quedan esperando y, al soltar, las dos responden 200 y queda una sola auditoría', async () => {
      const activa = await sembrar();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: bloquearSolicitud(activa.solicitudId),
        enviar: [() => cancelar(activa.solicitudId, cookieAdmin), () => cancelar(activa.solicitudId, cookieSecretaria)],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'las dos cancelaciones no quedaron esperando la fila de la solicitud').toBe(true);
      expect(
        resultados.map((r) => r.status),
        resultados.map((r) => r.texto).join(' | '),
      ).toEqual([200, 200]);
      expect(await auditorias(), 'dos cancelaciones dejaron más de una auditoría').toBe(1);
      expect((await leerSolicitudes(e.A.id))[0]?.estado).toBe('CANCELADA');
      expect((await leerMatriculas(e.A.id))[0]?.estado).toBe('CANCELADA');
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, MES, AHORA_005)).toBe(0);
    });

    it('criterio 39 c: lo mismo con seis cancelaciones simultáneas: todas 200, una sola auditoría y la ocupación en 0', async () => {
      const activa = await sembrar();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: bloquearSolicitud(activa.solicitudId),
        enviar: Array.from(
          { length: 6 },
          (_, i) => () => cancelar(activa.solicitudId, i % 2 === 0 ? cookieAdmin : cookieSecretaria),
        ),
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron).toBe(true);
      expect(resultados.map((r) => r.status)).toEqual(Array(6).fill(200));
      expect(await auditorias()).toBe(1);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, MES, AHORA_005)).toBe(0);
    });
  });

  describe('d) el actor deja de estar vigente mientras la cancelación espera', () => {
    let x: UsuarioDePrueba;
    let cookieX: string;
    beforeEach(async () => {
      x = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_COMUN });
      cookieX = cookieDeUsuario(x, AHORA_005);
    });

    it.each(['desactivar', 'solo-version'] as const)(
      'criterio 39 d (X con el cambio %s): X deja de estar vigente (se desactiva o sube su versión de token) mientras su petición espera el bloqueo: 401 NO_AUTENTICADO y no se escribe nada',
      async (cambio) => {
        const activa = await sembrar();
        const antes = {
          filas: await instantaneaDeInscripciones(e.A.id),
          filasB: await instantaneaDeInscripciones(e.B.id),
          auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
          version: (await leerUsuario(e.A.id, x.id))?.version_token ?? 0,
        };

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: x.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => cancelar(activa.solicitudId, cookieX),
        });

        expect(esperoElBloqueo, 'la petición no quedó esperando la fila del actor').toBe(true);
        expect(resultado.status, resultado.texto).toBe(401);
        expect(codigoDe(resultado)).toBe('NO_AUTENTICADO');
        expect(await instantaneaDeInscripciones(e.A.id)).toBe(antes.filas);
        expect(await instantaneaDeInscripciones(e.B.id)).toBe(antes.filasB);
        expect(JSON.stringify(await leerAuditoriaDeAcademia(e.A.id))).toBe(antes.auditoria);
        expect((await leerUsuario(e.A.id, x.id))?.version_token).toBeGreaterThan(antes.version);
        expect(await ocupacionDeClase(e.A.id, e.lunes.id, MES, AHORA_005), 'la solicitud sigue ocupando el cupo').toBe(
          1,
        );
      },
    );

    it('criterio 39 d (control): si la transacción de la prueba solo bloquea la fila del actor y no cambia nada, la cancelación espera y después responde 200', async () => {
      const activa = await sembrar();

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: e.A.id,
        actorId: x.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'COMMIT',
        enviar: () => cancelar(activa.solicitudId, cookieX),
      });

      expect(esperoElBloqueo, 'la cancelación no bloquea la fila del actor (bloquearActorVigente)').toBe(true);
      expect(resultado.status, resultado.texto).toBe(200);
      expect(await auditorias()).toBe(1);
    });
  });

  describe('e) cancelación y envío por el último cupo', () => {
    /** La clase del lunes llena: 19 matrículas de relleno y una solicitud activa (aforo 20). */
    async function claseLlena(): Promise<SolicitudSembrada> {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const activa = await sembrar();
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, MES, AHORA_005)).toBe(20);
      return activa;
    }

    it('criterio 39 e: la cancelación llega primero a la clase retenida y el envío después: cancelación 200 y envío 201; la ocupación queda en 20, nunca más que el aforo', async () => {
      const activa = await claseLlena();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => cancelar(activa.solicitudId), () => enviar()],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron, 'la cancelación y el envío no quedaron esperando la clase').toBe(true);
      expect(
        resultados.map((r) => r.status),
        resultados.map((r) => r.texto).join(' | '),
      ).toEqual([200, 201]);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, MES, AHORA_005)).toBe(20);
    });

    it('criterio 39 e: el envío llega primero: responde 409 SIN_CUPO (la clase está llena) y la cancelación 200; la ocupación queda en 19', async () => {
      const activa = await claseLlena();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => enviar(), () => cancelar(activa.solicitudId)],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron).toBe(true);
      expect(
        resultados.map((r) => r.status),
        resultados.map((r) => r.texto).join(' | '),
      ).toEqual([409, 200]);
      expect(codigoDe(resultados[0] as RespuestaApi)).toBe('SIN_CUPO');
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, MES, AHORA_005)).toBe(19);
    });

    it('criterio 39 e: una cancelación y ocho envíos a la vez por el último cupo: ninguno responde 500; hay a lo sumo un 201 y la ocupación nunca pasa de 20', async () => {
      const activa = await claseLlena();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => cancelar(activa.solicitudId), ...Array.from({ length: 8 }, () => () => enviar())],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron).toBe(true);
      const estados = resultados.map((r) => r.status);
      expect(
        estados.filter((estado) => estado >= 500),
        resultados.map((r) => r.texto).join(' | '),
      ).toEqual([]);
      expect(estados[0]).toBe(200);
      const creados = estados.slice(1).filter((estado) => estado === 201).length;
      expect(creados).toBeLessThanOrEqual(1);
      expect(estados.slice(1).filter((estado) => estado !== 201 && estado !== 409)).toEqual([]);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, MES, AHORA_005)).toBe(20 - 1 + creados);
    });

    /** Una clase del lunes con aforo 30 y 21 inscritos (20 de relleno y una solicitud activa). */
    async function claseConAforoAlto(): Promise<SolicitudSembrada> {
      await ejecutarComo(
        'propietario',
        'UPDATE clases SET aforo = 30 WHERE academia_id = $1::uuid AND id = $2::uuid',
        [e.A.id, e.lunes.id],
        {
          academiaId: e.A.id,
        },
      );
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);
      const activa = await sembrar();
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, MES, AHORA_005)).toBe(21);
      return activa;
    }
    const bajarAforo = () => ctx.http.patch(`/api/clases/${e.lunes.id}`, cookieAdmin, { aforo: 20 });

    it('criterio 39 e: la cancelación llega primero y el PATCH que baja el aforo a 20 después: cancelación 200 y PATCH 200 (ya hay 20 inscritos); aforo 20 y ocupación 20', async () => {
      const activa = await claseConAforoAlto();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => cancelar(activa.solicitudId), () => bajarAforo()],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron, 'la cancelación y el PATCH no quedaron esperando la clase').toBe(true);
      expect(
        resultados.map((r) => r.status),
        resultados.map((r) => r.texto).join(' | '),
      ).toEqual([200, 200]);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, MES, AHORA_005)).toBe(20);
    });

    it('criterio 39 e: el PATCH llega primero: 409 AFORO_MENOR_QUE_INSCRITOS (hay 21 inscritos) y la cancelación 200; el aforo sigue en 30 y nadie pierde su lugar por el PATCH', async () => {
      const activa = await claseConAforoAlto();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => bajarAforo(), () => cancelar(activa.solicitudId)],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron).toBe(true);
      expect(
        resultados.map((r) => r.status),
        resultados.map((r) => r.texto).join(' | '),
      ).toEqual([409, 200]);
      expect(codigoDe(resultados[0] as RespuestaApi)).toBe('AFORO_MENOR_QUE_INSCRITOS');
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, MES, AHORA_005)).toBe(20);
    });
  });

  describe('f) cancelación y envío con el mismo DNI', () => {
    it('criterio 39 f: la cancelación llega primero a la fila retenida y el envío con el mismo DNI después: el envío responde 201 o 409 DNI_YA_REGISTRADO, nunca 500, y el resultado es coherente', async () => {
      const activa = await sembrar();

      const { resultados } = await conRetencion({
        academiaId: e.A.id,
        retener: bloquearSolicitud(activa.solicitudId),
        enviar: [() => cancelar(activa.solicitudId), () => enviar({ alumno: { dni: activa.dni } })],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      const [cancelacion, envio] = resultados as [RespuestaApi, RespuestaApi];
      expect(cancelacion.status, cancelacion.texto).toBe(200);
      expect([201, 409], `el envío respondió ${envio.status}: ${envio.texto}`).toContain(envio.status);
      if (envio.status === 409) expect(codigoDe(envio)).toBe('DNI_YA_REGISTRADO');
      const delAlumno = (await leerSolicitudes(e.A.id)).filter((s) => s.alumno_id === activa.alumnoId);
      expect(delAlumno).toHaveLength(envio.status === 201 ? 2 : 1);
      expect(delAlumno.filter((s) => s.estado === 'PENDIENTE_PAGO')).toHaveLength(envio.status === 201 ? 1 : 0);
      expect(await auditorias()).toBe(1);
    });

    it('criterio 39 f: el envío con el mismo DNI llega primero: responde 409 DNI_YA_REGISTRADO (la solicitud sigue activa) y la cancelación 200', async () => {
      const activa = await sembrar();

      const { resultados } = await conRetencion({
        academiaId: e.A.id,
        retener: bloquearSolicitud(activa.solicitudId),
        enviar: [() => enviar({ alumno: { dni: activa.dni } }), () => cancelar(activa.solicitudId)],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(
        resultados.map((r) => r.status),
        resultados.map((r) => r.texto).join(' | '),
      ).toEqual([409, 200]);
      expect(codigoDe(resultados[0] as RespuestaApi)).toBe('DNI_YA_REGISTRADO');
      expect((await leerSolicitudes(e.A.id)).filter((s) => s.alumno_id === activa.alumnoId)).toHaveLength(1);
    });

    it('criterio 39 f: después de cancelar, el mismo DNI puede volver a inscribirse (201) y la solicitud cancelada no cambia', async () => {
      const activa = await sembrar();
      expect((await cancelar(activa.solicitudId)).status).toBe(200);

      const envio = await enviar({ alumno: { dni: activa.dni } });

      expect(envio.status, envio.texto).toBe(201);
      const anterior = (await leerSolicitudes(e.A.id)).find((s) => s.id === activa.solicitudId);
      expect(anterior?.estado).toBe('CANCELADA');
    });
  });
});
