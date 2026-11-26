// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  asistenciasDe,
  clasesUsadasDe,
  codigoDeRespuesta,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  instantaneaDeAsistencia,
  LUNES,
  marcar,
  resultadoDe,
  type Via,
} from '../../utilidades/escenario-asistencia';
import {
  ejecutarFaltas,
  inasistenciasDe,
  instantaneaDeFaltas,
  prepararEscenarioDe009b,
  registrarPosterior,
} from '../../utilidades/escenario-faltas';
import type { RespuestaApi } from '../../utilidades/inscripciones';
import { abrirRetenedor, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';

// Criterio 36 (crítico: idempotencia de una escritura de asistencia; un 200 con la asistencia de otro registro hace creer a recepción que el alumno se marcó hoy; R1-1 de la ronda 1 de la 009a): las asistencias del marcado (QR o manual,
// `registro_posterior` `false`) y las del registro posterior (`true`) comparten el único `asistencias_academia_id_clave_idempotencia_key`. El 200 con `repetida: true` del criterio 13 exige que la clave sea del mismo alumno y del mismo tipo de registro: un marcado
// (QR o manual) cuya clave ya usó un registro posterior del mismo alumno responde 409 `CLAVE_YA_USADA`, con el mismo cuerpo que cuando la clave es de otro alumno (sin `detalles`), y un registro posterior cuya clave ya usó un marcado del mismo alumno responde el mismo
// 409. Ninguno de los dos escribe, descuenta, cubre una falta ni audita. Entre QR y manual del mismo alumno sigue el 200 del criterio 13 (los dos son marcado). Prueba en serie, en los dos sentidos, con QR y con manual; y prueba determinista: un retenedor toma la
// matrícula del alumno con `FOR UPDATE`; un marcado de la clase en curso y un registro posterior de una clase ya terminada del mismo mes, con la misma clave, esperan los dos (comprobado en la cadena de bloqueos de PostgreSQL); al soltar el retenedor, uno responde 201 y el otro
// 409 `CLAVE_YA_USADA`, en cualquier orden, con una sola fila en `asistencias`, `clases_usadas` sube 1 y hay una auditoría `ASISTENCIA_POSTERIOR_REGISTRADA` solo si el 201 fue el del posterior.
// Cómo se arma: el alumno tiene la clase de los lunes de 18:00 a 19:00 y la de los martes de 08:00 a 09:00; el martes 17/11 a las 08:30 el marcado vale para la clase de los martes (en curso) y el registro posterior, para la del lunes 16/11 (ya terminada).
// Lecturas estrictas elegidas: «el mismo cuerpo» del 409 es el mismo texto de respuesta que el de la clave de otro alumno; el rechazo por la clave no escribe ni siquiera la falta del lunes que la tarea ya había registrado (queda sin cubrir); en la prueba determinista no se fija qué
// operación gana (el orden de llegada lo decide PostgreSQL), solo que una es 201, la otra 409 `CLAVE_YA_USADA` y todo cuadra.

describe('la clave de un marcado no repite un registro posterior, ni al revés (criterio 36)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDe009b(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  /** El martes 17/11 a las 08:30: la clase de los martes (08:00 a 09:00) está en curso y la de los lunes (16/11, 18:00 a 19:00) ya terminó. */
  const AHORA = enLima('2026-11-17', '08:30:00.000');
  const ACCION = 'ASISTENCIA_POSTERIOR_REGISTRADA';
  const nuevo = () => crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.e.lunes.id, esc.martes08.id] });
  const cookie = () => en(ctx, esc, AHORA).secretaria;
  const posterior = (alumno: AlumnoDeAsistencia, clave: string, galleta = cookie()) =>
    registrarPosterior(ctx, galleta, alumno.alumnoId, LUNES, '18:05', { claveIdempotencia: clave });

  const conflicto = (respuesta: RespuestaApi): [number, string | undefined] => [
    respuesta.status,
    codigoDeRespuesta(respuesta),
  ];

  describe.each<Via>(['QR', 'MANUAL'])('en serie, por la vía %s', (via) => {
    it('criterio 36: el marcado con la clave que ya usó un registro posterior del mismo alumno responde 409 CLAVE_YA_USADA, con el mismo cuerpo que con la clave de otro alumno, sin escribir, descontar ni auditar', async () => {
      const alumno = await nuevo();
      const otro = await nuevo();
      const clave = randomUUID();
      const galleta = cookie();
      resultadoDe(await posterior(alumno, clave, galleta), 201);
      const conOtroAlumno = await marcar(ctx, via, galleta, otro, { claveIdempotencia: clave });
      expect(conflicto(conOtroAlumno), 'control: la clave de otro alumno').toEqual([409, 'CLAVE_YA_USADA']);
      const antes = await instantaneaDeFaltas(esc.e);

      const respuesta = await marcar(ctx, via, galleta, alumno, { claveIdempotencia: clave });

      expect(conflicto(respuesta), respuesta.texto.slice(0, 300)).toEqual([409, 'CLAVE_YA_USADA']);
      expect(respuesta.body?.['detalles'], 'sin detalles').toBeUndefined();
      expect(respuesta.texto, 'el mismo cuerpo que con la clave de otro alumno').toBe(conOtroAlumno.texto);
      expect(await instantaneaDeFaltas(esc.e), 'ni escribe, ni descuenta, ni cubre una falta, ni audita').toBe(antes);
      expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
      expect(await leerAuditoriaDeAcademia(A(), ACCION)).toHaveLength(1);
    });

    it('criterio 36: el registro posterior con la clave que ya usó un marcado del mismo alumno responde 409 CLAVE_YA_USADA, con el mismo cuerpo que con la clave de otro alumno, sin escribir, descontar, cubrir la falta ni auditar', async () => {
      const alumno = await nuevo();
      const otro = await nuevo();
      const clave = randomUUID();
      const galleta = cookie();
      await ejecutarFaltas(ctx, AHORA); // la falta del lunes 16/11 queda registrada y sin cubrir
      expect(await inasistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      resultadoDe(await marcar(ctx, via, galleta, alumno, { claveIdempotencia: clave }), 201);
      const conOtroAlumno = await posterior(otro, clave, galleta);
      expect(conflicto(conOtroAlumno), 'control: la clave de otro alumno').toEqual([409, 'CLAVE_YA_USADA']);
      const antes = await instantaneaDeFaltas(esc.e);

      const respuesta = await posterior(alumno, clave, galleta);

      expect(conflicto(respuesta), respuesta.texto.slice(0, 300)).toEqual([409, 'CLAVE_YA_USADA']);
      expect(respuesta.body?.['detalles'], 'sin detalles').toBeUndefined();
      expect(respuesta.texto, 'el mismo cuerpo que con la clave de otro alumno').toBe(conOtroAlumno.texto);
      expect(await instantaneaDeFaltas(esc.e), 'ni escribe, ni descuenta, ni cubre una falta, ni audita').toBe(antes);
      expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      expect((await inasistenciasDe(A(), alumno.alumnoId)).map((falta) => falta.asistencia_id)).toEqual([null]);
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
      expect(await leerAuditoriaDeAcademia(A(), ACCION)).toEqual([]);
    });

    it('criterio 36 (control): el mismo marcado repetido con su clave sigue respondiendo 200 repetida, y el mismo registro posterior repetido con su clave también', async () => {
      const alumno = await nuevo();
      const otro = await nuevo();
      const claveDelMarcado = randomUUID();
      const claveDelPosterior = randomUUID();
      const galleta = cookie();
      resultadoDe(await marcar(ctx, via, galleta, alumno, { claveIdempotencia: claveDelMarcado }), 201);
      resultadoDe(await posterior(otro, claveDelPosterior, galleta), 201);

      const marcadoRepetido = await marcar(ctx, via, galleta, alumno, { claveIdempotencia: claveDelMarcado });
      const posteriorRepetido = await posterior(otro, claveDelPosterior, galleta);

      expect(resultadoDe(marcadoRepetido, 200)).toMatchObject({
        repetida: true,
        asistencia: { registroPosterior: false },
      });
      expect(resultadoDe(posteriorRepetido, 200)).toMatchObject({
        repetida: true,
        asistencia: { registroPosterior: true },
      });
    });
  });

  describe('entre QR y manual del mismo alumno sigue el 200 del criterio 13 (los dos son marcado)', () => {
    it.each([
      ['QR', 'MANUAL'],
      ['MANUAL', 'QR'],
    ] as const)(
      'criterio 36: el marcado por %s y después por %s con la misma clave responde 200 con repetida: true, sin otra fila ni otro descuento',
      async (primera, segunda) => {
        const alumno = await nuevo();
        const clave = randomUUID();
        const galleta = cookie();
        const resultado = resultadoDe(await marcar(ctx, primera, galleta, alumno, { claveIdempotencia: clave }), 201);

        const reintento = await marcar(ctx, segunda, galleta, alumno, { claveIdempotencia: clave });

        const repetido = resultadoDe(reintento, 200);
        expect(repetido.repetida).toBe(true);
        expect(repetido.asistencia.id).toBe(resultado.asistencia.id);
        expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
        expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
      },
    );
  });

  describe('la espera de la matrícula, con la misma clave a la vez (determinista)', () => {
    const COMBINACIONES = (['QR', 'MANUAL'] as const).flatMap((via) =>
      (['marcado-primero', 'posterior-primero'] as const).map((orden) => ({ via, orden })),
    );

    it.each(COMBINACIONES)(
      'criterio 36: un marcado por $via de la clase en curso y un registro posterior de la clase ya terminada, con la misma clave y con la matrícula retenida ($orden): uno responde 201 y el otro 409 CLAVE_YA_USADA, una sola fila, un solo descuento',
      async ({ via, orden }) => {
        const alumno = await nuevo();
        const galleta = cookie();
        const clave = randomUUID();
        const lanzar = {
          marcado: () => marcar(ctx, via, galleta, alumno, { claveIdempotencia: clave }),
          posterior: () => posterior(alumno, clave, galleta),
        };
        const [primera, segunda] =
          orden === 'marcado-primero' ? (['marcado', 'posterior'] as const) : (['posterior', 'marcado'] as const);
        const retenedor = await abrirRetenedor(A());
        let respuestas: Record<'marcado' | 'posterior', RespuestaApi>;
        try {
          await retenedor.consultar(
            'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [A(), alumno.matriculaId],
          );
          const p1 = observar(lanzar[primera]());
          expect(
            await esperarEspera(
              async () => (await retenedor.sesionesEsperando()) >= 1,
              [p1],
              `${primera} ni respondió ni quedó esperando la matrícula.`,
            ),
            `${primera} debía quedar esperando la matrícula del alumno`,
          ).toBe(true);
          const p2 = observar(lanzar[segunda]());
          expect(
            await esperarEspera(
              async () => (await retenedor.sesionesEsperando()) >= 2,
              [p1, p2],
              `${segunda} ni respondió ni quedó esperando la matrícula.`,
            ),
            `${segunda} debía quedar esperando la matrícula del alumno`,
          ).toBe(true);
          await retenedor.liberar('ROLLBACK');
          const [r1, r2] = await conLimite(
            Promise.all([p1.resultado, p2.resultado]),
            'Límite de seguridad: las peticiones no respondieron tras soltar la matrícula.',
          );
          respuestas = { [primera]: r1, [segunda]: r2 } as Record<'marcado' | 'posterior', RespuestaApi>;
        } finally {
          await retenedor.liberar('ROLLBACK');
        }

        const estados = [respuestas.marcado.status, respuestas.posterior.status].sort();
        expect(
          estados,
          `${respuestas.marcado.texto.slice(0, 160)} | ${respuestas.posterior.texto.slice(0, 160)}`,
        ).toEqual([201, 409]);
        const rechazada = respuestas.marcado.status === 409 ? respuestas.marcado : respuestas.posterior;
        expect(codigoDeRespuesta(rechazada)).toBe('CLAVE_YA_USADA');
        expect(rechazada.body?.['detalles'], 'sin detalles').toBeUndefined();
        expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
        expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
        expect(
          await leerAuditoriaDeAcademia(A(), ACCION),
          'una auditoría solo si el 201 fue el del registro posterior',
        ).toHaveLength(respuestas.posterior.status === 201 ? 1 : 0);
      },
    );
  });

  it('criterio 36: el resto de la academia no cambia: la instantánea de la otra academia sigue igual tras un 409 por la clave', async () => {
    const alumno = await nuevo();
    const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' });
    const clave = randomUUID();
    const galleta = cookie();
    resultadoDe(await posterior(alumno, clave, galleta), 201);
    const antes = await instantaneaDeAsistencia(esc.e);

    const respuesta = await marcar(ctx, 'MANUAL', galleta, alumno, { claveIdempotencia: clave });

    expect(respuesta.status).toBe(409);
    expect(await instantaneaDeAsistencia(esc.e)).toBe(antes);
    expect(await asistenciasDe(esc.e.B.id, deB.alumnoId)).toEqual([]);
  });
});
