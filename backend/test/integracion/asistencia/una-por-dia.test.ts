// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AppCarnet, conAlumnoRetenido, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  asistenciasDe,
  clasesUsadasDe,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  instantaneaDeAsistencia,
  LUNES,
  MARTES,
  marcar,
  prepararEscenarioDeAsistencia,
  rechazoDe,
  resultadoDe,
  type Via,
} from '../../utilidades/escenario-asistencia';

// Criterio 12 (crítico, RN-16): una segunda asistencia del mismo alumno con la misma fecha de Lima, por QR o manual, responde 409 `ASISTENCIA_YA_REGISTRADA` con `detalles.asistenciaDeHoy` (`horaLlegada`, `estadoLlegada` y `metodo` de la primera). Dos lecturas a la vez del mismo
// alumno con claves distintas (prueba determinista, espera comprobada en `pg_locks`): una 201, la otra 409 `ASISTENCIA_YA_REGISTRADA`, una sola fila y `clases_usadas` sube 1. (Si el choque llega por el índice `asistencias_un_dia_key`, el 409 sale del nombre de la restricción
// después del `ROLLBACK`: con el orden de bloqueos del criterio 14, la matrícula con `FOR UPDATE` lo ordena antes, y el resultado visible es el mismo.)
// Lecturas estrictas elegidas: «el día» es el de Lima, no el de UTC: un lunes a las 19:30 de Lima y el martes a las 08:30 de Lima son dos días distintos aunque en UTC sean el mismo; la segunda lectura no cambia `asistenciaDeHoy` (sigue siendo la primera); el rechazo no descuenta ni audita.

describe('una asistencia por alumno y por día (criterio 12)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  describe('la segunda lectura del mismo día', () => {
    const COMBINACIONES: [Via, Via][] = [
      ['QR', 'QR'],
      ['QR', 'MANUAL'],
      ['MANUAL', 'QR'],
      ['MANUAL', 'MANUAL'],
    ];

    it.each(COMBINACIONES)(
      'criterio 12: la primera por %s y la segunda por %s: 409 ASISTENCIA_YA_REGISTRADA (AMARILLA) con la hora, el estado y el método de la primera, sin segunda fila ni segundo descuento',
      async (primera, segunda) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        const registrada = resultadoDe(
          await marcar(ctx, primera, en(ctx, esc, enLima(LUNES, '18:05')).secretaria, alumno),
          201,
        );
        const antes = await instantaneaDeAsistencia(esc.e);

        const repetida = await marcar(ctx, segunda, en(ctx, esc, enLima(LUNES, '18:40')).admin, alumno);

        const detalles = rechazoDe(repetida, 'ASISTENCIA_YA_REGISTRADA', 'AMARILLA');
        expect(detalles.asistenciaDeHoy).toEqual({ horaLlegada: '18:05', estadoLlegada: 'PUNTUAL', metodo: primera });
        expect(registrada.asistencia.metodo).toBe(primera);
        expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
        expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
        expect(await instantaneaDeAsistencia(esc.e), 'el rechazo no escribe, no descuenta ni audita').toBe(antes);
      },
    );

    it('criterio 12: una tercera y una cuarta lectura dan el mismo 409, y la primera sigue siendo la del 18:05 (TARDE no la reemplaza)', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '18:05')).secretaria, alumno);

      for (const hora of ['18:30', '18:59:59.999']) {
        const respuesta = await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, hora)).secretaria, alumno);
        expect(rechazoDe(respuesta, 'ASISTENCIA_YA_REGISTRADA', 'AMARILLA').asistenciaDeHoy?.horaLlegada).toBe('18:05');
      }
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
    });

    it('criterio 12: la asistencia de un alumno no cuenta para otro: otro alumno de la misma clase marca el mismo día', async () => {
      const uno = await crearAlumnoDeAsistencia(ctx, esc);
      const otro = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;

      await marcar(ctx, 'QR', cookie, uno);
      const respuesta = await marcar(ctx, 'QR', cookie, otro);

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
    });
  });

  describe('el día es el de Lima (no el de UTC)', () => {
    it('criterio 12: el lunes 19:30 de Lima (00:30 UTC del martes) y el martes 08:30 de Lima (13:30 UTC) son dos días distintos: las dos marcan', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id, esc.martes08.id] });

      const lunes = await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '19:30')).secretaria, alumno);
      const martes = await marcar(ctx, 'QR', en(ctx, esc, enLima(MARTES, '08:30')).secretaria, alumno);

      expect(resultadoDe(lunes, 201).asistencia).toMatchObject({ fecha: LUNES, llegadaEn: '2026-11-17T00:30:00.000Z' });
      expect(resultadoDe(martes, 201).asistencia).toMatchObject({
        fecha: MARTES,
        llegadaEn: '2026-11-17T13:30:00.000Z',
      });
      expect((await asistenciasDe(esc.e.A.id, alumno.alumnoId)).map((fila) => fila.fecha)).toEqual([LUNES, MARTES]);
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(2);
    });

    it('criterio 12: dos lecturas el mismo lunes a las 19:10 y a las 19:50 de Lima (las dos el martes en UTC) son el mismo día: la segunda es ASISTENCIA_YA_REGISTRADA', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id] });
      await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '19:10')).secretaria, alumno);

      const segunda = await marcar(ctx, 'MANUAL', en(ctx, esc, enLima(LUNES, '19:50')).secretaria, alumno);

      expect(rechazoDe(segunda, 'ASISTENCIA_YA_REGISTRADA', 'AMARILLA').asistenciaDeHoy).toEqual({
        horaLlegada: '19:10',
        estadoLlegada: 'PUNTUAL',
        metodo: 'QR',
      });
    });
  });

  describe('dos lecturas a la vez (carrera determinista)', () => {
    const PARES: [Via, Via][] = [
      ['QR', 'QR'],
      ['QR', 'MANUAL'],
      ['MANUAL', 'MANUAL'],
    ];

    it.each(PARES)(
      'criterio 12: dos lecturas del mismo alumno con claves distintas (%s y %s) que esperan la misma fila: una 201, la otra 409 ASISTENCIA_YA_REGISTRADA, una sola fila y clases_usadas sube 1',
      async (via1, via2) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;
        const auditoriaAntes = await leerAuditoriaDeAcademia(esc.e.A.id);

        const { resultados, esperaron } = await conAlumnoRetenido({
          academiaId: esc.e.A.id,
          alumnoId: alumno.alumnoId,
          esperando: 2,
          enviar: [() => marcar(ctx, via1, cookie, alumno), () => marcar(ctx, via2, cookie, alumno)],
        });

        expect(esperaron, 'las dos lecturas debían quedar esperando la fila del alumno').toBe(true);
        const estados = resultados.map((respuesta) => respuesta.status).sort();
        expect(estados, resultados.map((r) => r.texto.slice(0, 200)).join(' | ')).toEqual([201, 409]);
        const perdedora = resultados.find((respuesta) => respuesta.status === 409);
        const ganadora = resultados.find((respuesta) => respuesta.status === 201);
        const detalles = rechazoDe(perdedora as NonNullable<typeof perdedora>, 'ASISTENCIA_YA_REGISTRADA', 'AMARILLA');
        expect(detalles.asistenciaDeHoy).toMatchObject({
          horaLlegada: '18:05',
          metodo: resultadoDe(ganadora as NonNullable<typeof ganadora>, 201).asistencia.metodo,
        });
        expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
        expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
        expect(await leerAuditoriaDeAcademia(esc.e.A.id)).toEqual(auditoriaAntes);
      },
    );

    it('criterio 12: diez lecturas a la vez del mismo alumno con claves distintas: una sola 201, nueve 409 ASISTENCIA_YA_REGISTRADA, una sola fila y un solo descuento', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;

      const respuestas = await Promise.all(
        Array.from({ length: 10 }, (_, i) => marcar(ctx, i % 2 === 0 ? 'QR' : 'MANUAL', cookie, alumno)),
      );

      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        respuestas.filter((r) => r.status === 409 && r.body?.['codigo'] === 'ASISTENCIA_YA_REGISTRADA'),
      ).toHaveLength(9);
      expect(respuestas.filter((r) => r.status >= 500)).toEqual([]);
      expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
    });

    it('criterio 12 (control): lecturas a la vez de alumnos distintos de la misma clase marcan todos (201) y cada matrícula sube 1', async () => {
      const alumnos = [];
      for (let i = 0; i < 5; i++) alumnos.push(await crearAlumnoDeAsistencia(ctx, esc));
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;

      const respuestas = await Promise.all(
        alumnos.map((alumno, i) => marcar(ctx, i % 2 === 0 ? 'QR' : 'MANUAL', cookie, alumno)),
      );

      expect(respuestas.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      for (const alumno of alumnos) expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
    });
  });
});
