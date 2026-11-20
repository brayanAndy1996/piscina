// spec: 005-inscripcion-publica (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { actualizarFila, leerClase } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS, cookieDeUsuario, dniInventado } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  cancelarTodasLasReservas,
  codigoDe,
  conRetencion,
  contarFilasDeInscripciones,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  crearPlanDeDosVeces,
  cuerpoInscripcion,
  detallesDe,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  llenarClase,
  type Objeto,
  ocupacionDeClase,
  type RespuestaApi,
  retenerClases,
  rutaPublica,
  sembrarSolicitud,
  sqlLlenarClase,
} from '../../utilidades/inscripciones';

// Criterio 18 (crítico, RN-11, RN-28; criterio 23 de 004): el último cupo, a la vez. Pruebas deterministas, sin depender de tiempos: la
// prueba retiene la fila de la clase con su propia transacción, envía las peticiones sin esperarlas, comprueba con `pg_blocking_pids` que
// quedaron esperando y solo entonces libera.
//   a) aforo 20 con 19 ocupados; dos envíos simultáneos de personas distintas: exactamente uno 201 y el otro 409 SIN_CUPO; ocupación 20;
//   b) aforo 20 con 18 ocupados y diez envíos simultáneos: exactamente dos 201 y ocho 409; ocupación 20;
//   c) una transacción de la prueba bloquea la clase y confirma una matrícula que llena el aforo; el envío, que quedó esperando, responde
//      409 después de la confirmación;
//   d) dos envíos con las clases [c1, c2] y [c2, c1] a la vez terminan los dos, sin 40P01 ni 500;
//   e) un envío por el último cupo y un PATCH que baja el aforo con confirmación, a la vez: nunca queda una ocupación mayor que el aforo
//      resultante por una inscripción nueva (criterio 41: los inscritos se cuentan después del bloqueo de la clase).
// Criterio 22 (crítico, RN-03, D-28): el mismo DNI, a la vez: exactamente uno 201 y el otro 409 DNI_YA_REGISTRADO; un alumno, una
// solicitud y una matrícula; lo mismo con un DNI de un cliente sin solicitud activa. Nunca 500 ni 40P01.
// Criterio 42 (crítico, DR-5 de 004): un envío y la desactivación de la clase se ordenan por el bloqueo de la clase: o el envío entra
// primero y la desactivación da 409 CLASE_CON_INSCRITOS, o la desactivación entra primero y el envío da SELECCION_NO_VALIDA.

describe('envío: concurrencia sobre el cupo y el DNI (criterios 18, 22 y 42)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  let cookieAdmin: string;
  const mes = { anio: 2026, mes: 11 };

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
    cookieAdmin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
  const personas = async (
    cantidad: number,
    opciones: Parameters<typeof cuerpoInscripcion>[1] = {},
  ): Promise<Objeto[]> => {
    const cuerpos: Objeto[] = [];
    for (let i = 0; i < cantidad; i++) cuerpos.push(await cuerpoInscripcion(e, opciones));
    return cuerpos;
  };
  const estados = (respuestas: RespuestaApi[]) => respuestas.map((r) => r.status).sort();
  const ocupacion = (claseId: string) => ocupacionDeClase(e.A.id, claseId, mes, AHORA_005);

  describe('criterio 18 a, b y c: el último cupo', () => {
    it('criterio 18 a: con 19 de 20 ocupados, dos envíos simultáneos de personas distintas: uno 201 y otro 409 SIN_CUPO; la ocupación queda en 20', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const [uno, dos] = await personas(2);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => enviar(uno), () => enviar(dos)],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron, 'los dos envíos debían quedar esperando el bloqueo de la clase').toBe(true);
      expect(estados(resultados), JSON.stringify(resultados.map((r) => r.body))).toEqual([201, 409]);
      const rechazado = resultados.find((r) => r.status === 409);
      expect(rechazado && codigoDe(rechazado)).toBe('SIN_CUPO');
      expect(rechazado && detallesDe(rechazado)['clasesSinCupo']).toEqual([e.lunes.id]);
      expect(await ocupacion(e.lunes.id)).toBe(20);
      expect(await leerSolicitudes(e.A.id)).toHaveLength(1);
    });

    it('criterio 18 b: con 18 de 20 ocupados y diez envíos simultáneos: exactamente dos 201 y ocho 409 SIN_CUPO; la ocupación queda en 20', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 18);
      const cuerpos = await personas(10);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: cuerpos.map((cuerpo) => () => enviar(cuerpo)),
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'los diez envíos debían quedar esperando').toBe(true);
      expect(resultados.filter((r) => r.status === 201)).toHaveLength(2);
      const rechazados = resultados.filter((r) => r.status === 409);
      expect(rechazados).toHaveLength(8);
      expect(rechazados.every((r) => codigoDe(r) === 'SIN_CUPO')).toBe(true);
      expect(await ocupacion(e.lunes.id)).toBe(20);
      expect((await contarFilasDeInscripciones(e.A.id)).solicitudes_inscripcion).toBe(2);
    });

    it('criterio 18 b: lo mismo sin retención (peticiones simultáneas a secas): nunca más de dos entran y la ocupación no pasa de 20', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 18);
      const cuerpos = await personas(10);

      const respuestas = await Promise.all(cuerpos.map((cuerpo) => enviar(cuerpo)));

      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(2);
      expect(
        respuestas.every((r) => r.status === 201 || r.status === 409),
        JSON.stringify(estados(respuestas)),
      ).toBe(true);
      expect(await ocupacion(e.lunes.id)).toBe(20);
    });

    it('criterio 18 c: una transacción de la prueba bloquea la clase y confirma la matrícula que la llena; el envío, que esperaba, responde 409 SIN_CUPO después de la confirmación', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const [cuerpo] = await personas(1);
      const llenar = sqlLlenarClase(e.A.id, e.lunes.id, e.plan.id, [dniInventado()], { mes });

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: async (retenedor) => {
          await retenerClases([e.lunes.id], e.A.id)(retenedor);
          await retenedor.consultar(llenar.sql, llenar.parametros);
        },
        enviar: [() => enviar(cuerpo as Objeto)],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron, 'el envío debía quedar esperando el bloqueo de la clase').toBe(true);
      expect([resultados[0]?.status, resultados[0] && codigoDe(resultados[0])]).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(e.lunes.id)).toBe(20);
      expect(await leerSolicitudes(e.A.id)).toEqual([]);
    });

    it('criterio 18 c (control): si la transacción de la prueba se revierte, el envío que esperaba entra y la ocupación llega a 20', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);
      const [cuerpo] = await personas(1);
      const llenar = sqlLlenarClase(e.A.id, e.lunes.id, e.plan.id, [dniInventado()], { mes });

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: async (retenedor) => {
          await retenerClases([e.lunes.id], e.A.id)(retenedor);
          await retenedor.consultar(llenar.sql, llenar.parametros);
        },
        enviar: [() => enviar(cuerpo as Objeto)],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron).toBe(true);
      expect(resultados[0]?.status, resultados[0]?.texto).toBe(201);
      expect(await ocupacion(e.lunes.id)).toBe(20);
    });
  });

  describe('criterio 18 d: clases cruzadas', () => {
    it('criterio 18 d: dos envíos con [lunes, miércoles] y [miércoles, lunes] a la vez, con las dos clases retenidas, terminan los dos (201) sin 40P01 ni 500', async () => {
      const plan = await crearPlanDeDosVeces(e);
      const uno = await cuerpoInscripcion(e, { plan, clases: [e.lunes, e.miercoles] });
      const dos = await cuerpoInscripcion(e, { plan, clases: [e.miercoles, e.lunes] });

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id, e.miercoles.id], e.A.id),
        enviar: [() => enviar(uno), () => enviar(dos)],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron).toBe(true);
      expect(estados(resultados), JSON.stringify(resultados.map((r) => r.body))).toEqual([201, 201]);
      expect(await ocupacion(e.lunes.id)).toBe(2);
      expect(await ocupacion(e.miercoles.id)).toBe(2);
    });

    it('criterio 18 d: varias rondas de [c1, c2] y [c2, c1] simultáneos sin retención nunca dan 500 ni 40P01', async () => {
      const plan = await crearPlanDeDosVeces(e);
      for (let ronda = 0; ronda < 6; ronda++) {
        const uno = await cuerpoInscripcion(e, { plan, clases: [e.lunes, e.viernes] });
        const dos = await cuerpoInscripcion(e, { plan, clases: [e.viernes, e.lunes] });

        const respuestas = await Promise.all([enviar(uno), enviar(dos)]);

        expect(estados(respuestas), `ronda ${ronda}: ${JSON.stringify(respuestas.map((r) => r.body))}`).toEqual([
          201, 201,
        ]);
        await cancelarTodasLasReservas(e.A.id);
      }
    });
  });

  describe('criterio 18 e: el último cupo frente a un cambio de aforo con confirmación (criterio 41)', () => {
    async function prepararUltimoCupo() {
      await actualizarFila('propietario', 'clases', e.A.id, e.lunes.id, { aforo: 25 });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 24);
      const [cuerpo] = await personas(1);
      return cuerpo as Objeto;
    }
    const bajarAforo = () =>
      ctx.http.patch(`/api/clases/${e.lunes.id}`, cookieAdmin, { aforo: 20, confirmarAforoMenor: true });
    const auditoriaDelCambio = async () =>
      (await leerAuditoriaDeAcademia(e.A.id, 'CLASE_ACTUALIZADA')).filter((fila) => fila.entidad_id === e.lunes.id);

    it('criterio 18 e: el cambio de aforo entra primero: el envío ya no tiene cupo (409 SIN_CUPO) y la ocupación se queda en 24, no pasa del aforo por una inscripción nueva', async () => {
      const cuerpo = await prepararUltimoCupo();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => bajarAforo(), () => enviar(cuerpo)],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      const [patch, envio] = resultados as [RespuestaApi, RespuestaApi];
      expect(patch.status, patch.texto).toBe(200);
      expect([envio.status, codigoDe(envio)], envio.texto).toEqual([409, 'SIN_CUPO']);
      expect(await ocupacion(e.lunes.id)).toBe(24);
      expect((await leerClase(e.A.id, e.lunes.id))?.aforo).toBe(20);
      const [auditoria] = await auditoriaDelCambio();
      expect(auditoria?.datos_despues).toMatchObject({
        aforo: 20,
        inscritos: 24,
        confirmacion: 'AFORO_MENOR_QUE_INSCRITOS',
      });
    });

    it('criterio 18 e: el envío entra primero: toma el último cupo (201) y el cambio de aforo cuenta 25 inscritos (los cuenta después del bloqueo)', async () => {
      const cuerpo = await prepararUltimoCupo();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => enviar(cuerpo), () => bajarAforo()],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      const [envio, patch] = resultados as [RespuestaApi, RespuestaApi];
      expect(envio.status, envio.texto).toBe(201);
      expect(patch.status, patch.texto).toBe(200);
      expect(await ocupacion(e.lunes.id)).toBe(25);
      const [auditoria] = await auditoriaDelCambio();
      expect(auditoria?.datos_despues).toMatchObject({
        aforo: 20,
        inscritos: 25,
        confirmacion: 'AFORO_MENOR_QUE_INSCRITOS',
      });
    });
  });

  describe('criterio 22: el mismo DNI, a la vez', () => {
    it('criterio 22: dos envíos con el mismo DNI nuevo (distinta clave): uno 201 y otro 409 DNI_YA_REGISTRADO; un alumno, una solicitud y una matrícula', async () => {
      const uno = await cuerpoInscripcion(e);
      const dos = { ...uno, claveIdempotencia: randomUUID() };

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => enviar(uno), () => enviar(dos)],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron).toBe(true);
      expect(estados(resultados), JSON.stringify(resultados.map((r) => r.body))).toEqual([201, 409]);
      const rechazado = resultados.find((r) => r.status === 409);
      expect(rechazado && codigoDe(rechazado)).toBe('DNI_YA_REGISTRADO');
      expect(await contarFilasDeInscripciones(e.A.id)).toMatchObject({
        alumnos: 1,
        solicitudes_inscripcion: 1,
        matriculas: 1,
      });
    });

    it('criterio 22: lo mismo con un DNI de un cliente sin solicitud activa (criterio 21 b): uno 201 y otro 409; un alumno y una sola solicitud activa nueva', async () => {
      const previo = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'VENCIDA' });
      const uno = await cuerpoInscripcion(e, { sobre: { alumno: { dni: previo.dni } } });
      const dos = { ...uno, claveIdempotencia: randomUUID() };

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND dni = $2 FOR UPDATE', [
            e.A.id,
            previo.dni,
          ]);
        },
        enviar: [() => enviar(uno), () => enviar(dos)],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron).toBe(true);
      expect(estados(resultados), JSON.stringify(resultados.map((r) => r.body))).toEqual([201, 409]);
      expect((await leerAlumnos(e.A.id)).filter((a) => a.dni === previo.dni)).toHaveLength(1);
      const activas = (await leerSolicitudes(e.A.id)).filter((s) => s.estado === 'PENDIENTE_PAGO');
      expect(activas).toHaveLength(1);
      expect((await leerMatriculas(e.A.id)).filter((m) => m.estado === 'RESERVADA')).toHaveLength(1);
    });

    it('criterio 22: varias rondas de dos envíos simultáneos con el mismo DNI nuevo, sin retención: siempre [201, 409], nunca 500 ni 40P01', async () => {
      for (let ronda = 0; ronda < 6; ronda++) {
        const uno = await cuerpoInscripcion(e);
        const dos = { ...uno, claveIdempotencia: randomUUID() };

        const respuestas = await Promise.all([enviar(uno), enviar(dos)]);

        expect(estados(respuestas), `ronda ${ronda}: ${JSON.stringify(respuestas.map((r) => r.body))}`).toEqual([
          201, 409,
        ]);
        expect(
          respuestas.find((r) => r.status === 409) &&
            codigoDe(respuestas.find((r) => r.status === 409) as RespuestaApi),
        ).toBe('DNI_YA_REGISTRADO');
        await cancelarTodasLasReservas(e.A.id);
      }
      expect((await contarFilasDeInscripciones(e.A.id)).alumnos).toBe(6);
    });

    it('criterio 22: el mismo DNI en dos academias a la vez no choca: los dos envíos entran', async () => {
      const dni = dniInventado();
      const deA = await cuerpoInscripcion(e, { sobre: { alumno: { dni } } });
      const deB = await cuerpoInscripcion(e, {
        plan: e.planB,
        clases: [e.lunesB, e.miercolesB, e.viernesB],
        sobre: { alumno: { dni } },
      });

      const respuestas = await Promise.all([
        enviar(deA),
        ctx.http.post(rutaPublica('academia-b', '/inscripcion'), deB),
      ]);

      expect(estados(respuestas)).toEqual([201, 201]);
    });
  });

  describe('criterio 42: el envío y la desactivación de la clase se ordenan por el bloqueo de la clase', () => {
    const desactivar = () => ctx.http.patch(`/api/clases/${e.lunes.id}`, cookieAdmin, { activo: false });

    it('criterio 42: el envío entra primero: toma la clase (201) y la desactivación responde 409 CLASE_CON_INSCRITOS con los inscritos', async () => {
      const [cuerpo] = await personas(1);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => enviar(cuerpo as Objeto), () => desactivar()],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      const [envio, patch] = resultados as [RespuestaApi, RespuestaApi];
      expect(envio.status, envio.texto).toBe(201);
      expect([patch.status, codigoDe(patch)], patch.texto).toEqual([409, 'CLASE_CON_INSCRITOS']);
      expect(detallesDe(patch)['inscritos']).toBe(1);
      expect((await leerClase(e.A.id, e.lunes.id))?.activo).toBe(true);
    });

    it('criterio 42: la desactivación entra primero: la clase queda inactiva (200) y el envío responde 409 SELECCION_NO_VALIDA, sin escribir', async () => {
      const [cuerpo] = await personas(1);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => desactivar(), () => enviar(cuerpo as Objeto)],
        enOrden: true,
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      const [patch, envio] = resultados as [RespuestaApi, RespuestaApi];
      expect(patch.status, patch.texto).toBe(200);
      expect([envio.status, codigoDe(envio)], envio.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
      expect((await leerClase(e.A.id, e.lunes.id))?.activo).toBe(false);
      expect(await leerSolicitudes(e.A.id)).toEqual([]);
    });
  });
});
