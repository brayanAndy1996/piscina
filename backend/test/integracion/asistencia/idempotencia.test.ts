// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AppCarnet, cambiarAlumno, conAlumnoRetenido, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  asistenciasDe,
  cambiarMatricula,
  CLAVES_DE_LA_ASISTENCIA,
  CLAVES_DEL_RESULTADO,
  clasesUsadasDe,
  codigoDeRespuesta,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  instantaneaDeAsistencia,
  leerAsistencias,
  LUNES,
  LUNES_SIGUIENTE,
  marcar,
  marcarManual,
  marcarPorQr,
  prepararEscenarioDeAsistencia,
  rechazoDe,
  resultadoDe,
  type Via,
} from '../../utilidades/escenario-asistencia';

// Criterio 13 (crítico, `CLAUDE.md`: escrituras idempotentes): si la `claveIdempotencia` ya registró una asistencia de ese mismo alumno en la academia, responde 200 con el mismo cuerpo del 201 y `repetida: true`, aunque la clase ya haya terminado, sin otra fila, otro descuento ni
// otra auditoría. Dos peticiones a la vez con la misma clave dejan una fila (una 201 y una 200). La misma clave usada con otro alumno responde 409 `CLAVE_YA_USADA` (también con el registro posterior de la 009b); la misma clave en otra academia no choca. La clave de un intento rechazado no
// queda guardada y se puede volver a usar.
// Orden de las validaciones (criterio 7, filas b y c): el 404 gana a la clave; la clave ya usada gana a todas las que siguen (alumno inactivo, ya marcó hoy, mensualidad, clases, horario).
// Lecturas estrictas elegidas: la repetición devuelve el mismo cuerpo que el 201 (la misma asistencia, hora y estado, con `repetida: true`) por cualquiera de las dos vías: lo que cuenta es el alumno y la clave, no cómo se leyó; el 200 repetido sigue valiendo si después el alumno pasa a `INACTIVO`,
// termina su mensualidad o cambia la tolerancia; el `CLAVE_YA_USADA` de otro alumno no lleva el cuerpo de la asistencia ajena (ni su DNI, ni su token).

describe('idempotencia con la clave (criterio 13)', () => {
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

  const HORA = enLima(LUNES, '18:05:00.000');

  describe.each<Via>(['QR', 'MANUAL'])('el reintento por la vía %s', (via) => {
    it('criterio 13: la misma clave otra vez responde 200 con el mismo cuerpo del 201 y repetida: true, sin otra fila, otro descuento ni otra auditoría', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, HORA).secretaria;
      const clave = randomUUID();
      const primera = await marcar(ctx, via, cookie, alumno, { claveIdempotencia: clave });
      const resultado = resultadoDe(primera, 201);
      const antes = await instantaneaDeAsistencia(esc.e);

      const reintento = await marcar(ctx, via, cookie, alumno, { claveIdempotencia: clave });

      const repetido = resultadoDe(reintento, 200);
      expect(repetido.repetida).toBe(true);
      expect({ ...repetido, repetida: false }, 'el mismo cuerpo del 201').toEqual(resultado);
      expect(Object.keys(repetido).sort()).toEqual(CLAVES_DEL_RESULTADO);
      expect(Object.keys(repetido.asistencia).sort()).toEqual(CLAVES_DE_LA_ASISTENCIA);
      expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
      expect(await instantaneaDeAsistencia(esc.e), 'ni otra fila, ni otro descuento, ni otra auditoría').toBe(antes);
    });

    it('criterio 13: el reintento después de que terminó la clase (20:30), y al día siguiente, sigue siendo 200 repetida con la misma asistencia', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const clave = randomUUID();
      const resultado = resultadoDe(
        await marcar(ctx, via, en(ctx, esc, HORA).secretaria, alumno, { claveIdempotencia: clave }),
        201,
      );

      for (const cuando of [enLima(LUNES, '20:30'), enLima('2026-11-17', '09:00'), enLima(LUNES_SIGUIENTE, '19:30')]) {
        const reintento = await marcar(ctx, via, en(ctx, esc, cuando).secretaria, alumno, { claveIdempotencia: clave });

        const repetido = resultadoDe(reintento, 200);
        expect(repetido.repetida).toBe(true);
        expect(repetido.asistencia).toEqual(resultado.asistencia);
      }
      expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
    });

    it('criterio 13: la clave ya usada gana al alumno inactivo, a la mensualidad vencida y al horario (fila c antes que d a j): sigue siendo 200', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const clave = randomUUID();
      await marcar(ctx, via, en(ctx, esc, HORA).secretaria, alumno, { claveIdempotencia: clave });
      await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { estado: 'INACTIVO' });
      await cambiarMatricula(esc.e.A.id, alumno.matriculaId, { estado: 'FINALIZADA' });

      const reintento = await marcar(ctx, via, en(ctx, esc, enLima('2026-12-02', '10:00')).secretaria, alumno, {
        claveIdempotencia: clave,
      });

      expect(resultadoDe(reintento, 200).repetida).toBe(true);
      expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
    });

    it('criterio 13: la misma clave con otro alumno responde 409 CLAVE_YA_USADA, sin escribir, descontar ni auditar, y sin los datos de la asistencia ajena', async () => {
      const dueño = await crearAlumnoDeAsistencia(ctx, esc);
      const otro = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, HORA).secretaria;
      const clave = randomUUID();
      await marcar(ctx, via, cookie, dueño, { claveIdempotencia: clave });
      const antes = await instantaneaDeAsistencia(esc.e);

      const respuesta = await marcar(ctx, via, cookie, otro, { claveIdempotencia: clave });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
        409,
        'CLAVE_YA_USADA',
      ]);
      expect(respuesta.texto).not.toContain(dueño.alumnoId);
      expect(respuesta.texto).not.toContain(dueño.dni);
      expect(respuesta.texto).not.toContain(dueño.token);
      expect(await instantaneaDeAsistencia(esc.e)).toBe(antes);
      expect(await clasesUsadasDe(esc.e.A.id, otro.matriculaId)).toBe(0);
    });

    it('criterio 13: la clave usada por otro alumno gana a ALUMNO_INACTIVO y al resto (fila c antes que d), y el 404 gana a la clave (fila b antes que c)', async () => {
      const dueño = await crearAlumnoDeAsistencia(ctx, esc);
      const inactivo = await crearAlumnoDeAsistencia(ctx, esc);
      await cambiarAlumno(esc.e.A.id, inactivo.alumnoId, { estado: 'INACTIVO' });
      const cookie = en(ctx, esc, HORA).secretaria;
      const clave = randomUUID();
      await marcar(ctx, via, cookie, dueño, { claveIdempotencia: clave });

      const conInactivo = await marcar(ctx, via, cookie, inactivo, { claveIdempotencia: clave });
      const conDesconocido =
        via === 'QR'
          ? await marcarPorQr(ctx, cookie, `AQ1:${'E'.repeat(43)}`, { claveIdempotencia: clave })
          : await marcarManual(ctx, cookie, randomUUID(), { claveIdempotencia: clave });

      expect([conInactivo.status, codigoDeRespuesta(conInactivo)]).toEqual([409, 'CLAVE_YA_USADA']);
      expect(conDesconocido.status).toBe(404);
    });

    it('criterio 13: la clave de un intento rechazado no queda guardada: se rechaza fuera de horario (409) y la misma clave sirve después, dentro de la clase (201)', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const clave = randomUUID();
      const fuera = await marcar(ctx, via, en(ctx, esc, enLima(LUNES, '17:00')).secretaria, alumno, {
        claveIdempotencia: clave,
      });
      rechazoDe(fuera, 'FUERA_DE_HORARIO', 'AMARILLA');
      expect(await leerAsistencias(esc.e.A.id)).toEqual([]);

      const dentro = await marcar(ctx, via, en(ctx, esc, HORA).secretaria, alumno, { claveIdempotencia: clave });

      const resultado = resultadoDe(dentro, 201);
      expect(resultado.repetida).toBe(false);
      expect((await asistenciasDe(esc.e.A.id, alumno.alumnoId))[0]?.clave_idempotencia).toBe(clave);
    });
  });

  it('criterio 13: la misma clave con el mismo alumno por la otra vía (QR y después manual) es el mismo reintento: 200 repetida con la asistencia original', async () => {
    const alumno = await crearAlumnoDeAsistencia(ctx, esc);
    const cookie = en(ctx, esc, HORA).secretaria;
    const clave = randomUUID();
    const original = resultadoDe(await marcar(ctx, 'QR', cookie, alumno, { claveIdempotencia: clave }), 201);

    const porOtraVia = await marcar(ctx, 'MANUAL', cookie, alumno, { claveIdempotencia: clave });

    const repetido = resultadoDe(porOtraVia, 200);
    expect(repetido.repetida).toBe(true);
    expect(repetido.asistencia).toEqual(original.asistencia);
    expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
  });

  it('criterio 13: la misma clave en otra academia no choca: cada academia registra la suya (201 y 201)', async () => {
    const deA = await crearAlumnoDeAsistencia(ctx, esc);
    const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' });
    const cookies = en(ctx, esc, HORA);
    const clave = randomUUID();

    const respuestaA = await marcar(ctx, 'QR', cookies.secretaria, deA, { claveIdempotencia: clave });
    const respuestaB = await marcar(ctx, 'QR', cookies.secretariaB, deB, { claveIdempotencia: clave });

    expect(resultadoDe(respuestaA, 201).repetida).toBe(false);
    expect(resultadoDe(respuestaB, 201).repetida).toBe(false);
    expect((await leerAsistencias(esc.e.A.id))[0]?.clave_idempotencia).toBe(clave);
    expect((await leerAsistencias(esc.e.B.id))[0]?.clave_idempotencia).toBe(clave);
  });

  it('criterio 13: la clave de A usada con un alumno de B desde la sesión de B tampoco la bloquea ni la toma (el alumno de A no es de la academia de B: 404)', async () => {
    const deA = await crearAlumnoDeAsistencia(ctx, esc);
    const cookies = en(ctx, esc, HORA);
    const clave = randomUUID();
    await marcar(ctx, 'QR', cookies.secretaria, deA, { claveIdempotencia: clave });

    const desdeB = await marcar(ctx, 'QR', cookies.secretariaB, deA, { claveIdempotencia: clave });

    expect([desdeB.status, codigoDeRespuesta(desdeB)]).toEqual([404, 'QR_NO_RECONOCIDO']);
    expect(await leerAsistencias(esc.e.B.id)).toEqual([]);
  });

  describe('dos peticiones a la vez con la misma clave (carrera determinista)', () => {
    const PARES: [Via, Via][] = [
      ['QR', 'QR'],
      ['MANUAL', 'MANUAL'],
      ['QR', 'MANUAL'],
    ];

    it.each(PARES)(
      'criterio 13: dos peticiones (%s y %s) con la misma clave que esperan la fila del alumno dejan una fila: una 201 y una 200 repetida, un solo descuento y una sola auditoría vacía',
      async (via1, via2) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        const cookie = en(ctx, esc, HORA).secretaria;
        const clave = randomUUID();
        const auditoriaAntes = await leerAuditoriaDeAcademia(esc.e.A.id);

        const { resultados, esperaron } = await conAlumnoRetenido({
          academiaId: esc.e.A.id,
          alumnoId: alumno.alumnoId,
          esperando: 2,
          enviar: [
            () => marcar(ctx, via1, cookie, alumno, { claveIdempotencia: clave }),
            () => marcar(ctx, via2, cookie, alumno, { claveIdempotencia: clave }),
          ],
        });

        expect(esperaron, 'las dos peticiones debían quedar esperando la fila del alumno').toBe(true);
        expect(
          resultados.map((r) => r.status).sort(),
          resultados.map((r) => r.texto.slice(0, 200)).join(' | '),
        ).toEqual([200, 201]);
        const nueva = resultadoDe(
          resultados.find((r) => r.status === 201) as NonNullable<(typeof resultados)[number]>,
          201,
        );
        const repetida = resultadoDe(
          resultados.find((r) => r.status === 200) as NonNullable<(typeof resultados)[number]>,
          200,
        );
        expect(repetida.repetida).toBe(true);
        expect(nueva.repetida).toBe(false);
        expect(repetida.asistencia.id).toBe(nueva.asistencia.id);
        expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
        expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
        expect(await leerAuditoriaDeAcademia(esc.e.A.id)).toEqual(auditoriaAntes);
      },
    );

    it('criterio 13: seis peticiones a la vez con la misma clave: una sola 201, cinco 200 repetidas, una fila y un descuento', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, HORA).secretaria;
      const clave = randomUUID();

      const respuestas = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          marcar(ctx, i % 2 === 0 ? 'QR' : 'MANUAL', cookie, alumno, { claveIdempotencia: clave }),
        ),
      );

      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
      expect(respuestas.filter((r) => r.status === 200)).toHaveLength(5);
      expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
    });
  });
});
