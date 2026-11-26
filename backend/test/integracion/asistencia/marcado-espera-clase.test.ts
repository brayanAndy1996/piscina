// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { cuerpoCobro, rutaCobro, sembrarCobrable } from '../../utilidades/escenario-pagos';
import {
  asistenciasDe,
  cambiarMatricula,
  clasesUsadasDe,
  comprobarSinErrores,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  leerAsistencias,
  LUNES,
  marcar,
  rechazoDe,
  resultadoDe,
  type Via,
} from '../../utilidades/escenario-asistencia';
import { asegurarCajaDelDia, prepararEscenarioDe009b, registrarPosterior } from '../../utilidades/escenario-faltas';
import { leerMatriculas, type RespuestaApi } from '../../utilidades/inscripciones';
import { abrirRetenedor, conClaseRetenida, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';

// Criterio 37 (crítico: asistencia solo mientras dura la clase, D-16, y descuento de una clase, RN-14; R1-2 de la ronda 1 de la 009a; criterio 14, DT-16, DT-22): el `INSERT` en `asistencias` toma un `FOR KEY SHARE` implícito sobre la fila de la clase por la llave foránea. Si lo
// espera después de leer «ahora» (por ejemplo, detrás de `bloquearClasesParaCupo` de un cobro, una cancelación o una inscripción), la asistencia se registraría con la hora de antes aunque la clase ya haya terminado. Por eso el marcado por QR y manual toma, en este orden:
// actor → alumno (`FOR SHARE`) → matrícula del día (`FOR UPDATE`) → las clases de esa matrícula con `FOR KEY SHARE` (todas y no solo las del día) y recién después lee «ahora». Sin matrícula del día no bloquea ninguna clase. Nunca toma `clases` con `FOR UPDATE` ni `FOR SHARE`.
// El registro posterior (criterio 28) toma sus clases del mismo modo, entre la matrícula y la falta. Así, una espera que cruza el fin de la clase responde 409 `FUERA_DE_HORARIO`, sin escribir.
// Prueba determinista, por QR y por manual: el alumno tiene matrícula `VIGENTE` y la clase del lunes de 18:00 a 19:00; con `RELOJ` fijo en el lunes a las 18:59:59 de Lima, un retenedor, en una transacción de la misma academia, toma esa clase con `SELECT … FROM clases … FOR UPDATE`
// (la misma sentencia de `bloquearClasesParaCupo`). Se lanza el marcado y se comprueba con la cadena de bloqueos de PostgreSQL que su conexión espera. Se mueve `RELOJ` a las 19:00:05 y se suelta el retenedor. La respuesta es 409 `FUERA_DE_HORARIO` con `detalles.alerta` `AMARILLA`
// y `detalles.claseDeHoy` `{ horaInicio: '18:00', horaFin: '19:00' }`; no hay fila en `asistencias`, `clases_usadas` no cambia y no hay auditoría. Además, la prueba de bloqueos sin `40P01` suma un cobro de otro alumno de la misma clase (`bloquearClasesParaCupo`) a la vez que el marcado.
// Lecturas estrictas elegidas: la espera se comprueba en los dos sentidos (el marcado espera la clase retenida; la que no es de su matrícula no la espera); el control con el reloj que se mueve dentro de la clase (18:59:59.500) registra con la hora de después de la espera; la clase
// retenida de otro día de la misma matrícula (el miércoles) también se espera, porque el marcado toma todas las clases de la matrícula y no solo la de hoy; el alumno sin matrícula del día no espera ninguna clase y responde su rechazo; el registro posterior se lanza a las 18:59:58
// (la clase todavía no terminó), espera la clase retenida, y al soltarla a las 19:00:05 ya terminó: se registra con la hora de después de la espera. Con el cobro de otro alumno de la misma clase (la clase retenida con `FOR UPDATE`), el cobro responde 201, el marcado o el registro posterior
// responden su 201, ninguno termina en `40P01` ni en 5xx, y las dos operaciones esperan a la vez.

describe('el marcado toma su clase antes de leer «ahora» (criterio 37)', () => {
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
  const SELECT_CLASE =
    'SELECT id FROM clases WHERE academia_id = $1::uuid AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE';
  const INTERBLOQUEO = /40P01|deadlock|interbloqueo/i;

  /**
   * Retiene la clase con `FOR UPDATE`, lanza `peticion`, espera (con la cadena de bloqueos) a que quede esperando, mueve el reloj a `t1`, suelta y devuelve la
   * respuesta. Si `debeEsperar` es falso, comprueba en cambio que la respuesta llega con la clase retenida (sin esperarla) y la suelta después.
   */
  async function conClaseRetenidaYRelojQueAvanza(opciones: {
    claseIds: readonly string[];
    peticion: () => Promise<RespuestaApi>;
    t1?: Date;
    debeEsperar?: boolean;
  }): Promise<{ respuesta: RespuestaApi; esperando: boolean }> {
    const { claseIds, peticion, t1, debeEsperar = true } = opciones;
    const retenedor = await abrirRetenedor(A());
    try {
      await retenedor.consultar(SELECT_CLASE, [A(), claseIds]);
      const lanzada = observar(peticion());
      if (!debeEsperar) {
        const respuesta = await conLimite(
          lanzada.resultado,
          'La petición esperó una clase retenida que no es de su matrícula.',
        );
        return { respuesta, esperando: false };
      }
      const esperando = await esperarEspera(
        async () => (await retenedor.sesionesEsperando()) >= 1,
        [lanzada],
        'la petición ni respondió ni quedó esperando la clase retenida.',
      );
      if (t1) ctx.reloj.fijar(t1);
      await retenedor.liberar('ROLLBACK');
      const respuesta = await conLimite(
        lanzada.resultado,
        'Límite de seguridad: la petición no respondió tras soltar la clase.',
      );
      return { respuesta, esperando };
    } finally {
      await retenedor.liberar('ROLLBACK');
    }
  }

  describe.each<Via>(['QR', 'MANUAL'])('el marcado por %s', (via) => {
    it('criterio 37: lanzado a las 18:59:59 con la clase retenida y soltada a las 19:00:05: la conexión espera y la respuesta es 409 FUERA_DE_HORARIO (AMARILLA, con la clase de hoy 18:00 a 19:00), sin fila, sin descuento y sin auditoría', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, enLima(LUNES, '18:59:59.000')).secretaria;
      const auditoriaAntes = await leerAuditoriaDeAcademia(A());

      const { respuesta, esperando } = await conClaseRetenidaYRelojQueAvanza({
        claseIds: [esc.e.lunes.id],
        peticion: () => marcar(ctx, via, cookie, alumno),
        t1: enLima(LUNES, '19:00:05.000'),
      });

      expect(
        esperando,
        'el marcado debía quedar esperando la clase (FOR KEY SHARE explícito antes de leer «ahora»)',
      ).toBe(true);
      const detalles = rechazoDe(respuesta, 'FUERA_DE_HORARIO', 'AMARILLA');
      expect(detalles.claseDeHoy).toEqual({ horaInicio: '18:00', horaFin: '19:00' });
      expect(await asistenciasDe(A(), alumno.alumnoId)).toEqual([]);
      expect(await leerAsistencias(A())).toEqual([]);
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(0);
      expect(await leerAuditoriaDeAcademia(A())).toEqual(auditoriaAntes);
    });

    it('criterio 37: soltada a las 19:00:00.000 exactas (el fin de la clase) también es FUERA_DE_HORARIO; a las 18:59:59.500 todavía registra, con la hora de después de la espera', async () => {
      const tarde = await crearAlumnoDeAsistencia(ctx, esc);
      const aTiempo = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, enLima(LUNES, '18:59:59.000')).secretaria;

      const alFin = await conClaseRetenidaYRelojQueAvanza({
        claseIds: [esc.e.lunes.id],
        peticion: () => marcar(ctx, via, cookie, tarde),
        t1: enLima(LUNES, '19:00:00.000'),
      });
      ctx.reloj.fijar(enLima(LUNES, '18:59:59.000'));
      const dentro = await conClaseRetenidaYRelojQueAvanza({
        claseIds: [esc.e.lunes.id],
        peticion: () => marcar(ctx, via, cookie, aTiempo),
        t1: enLima(LUNES, '18:59:59.500'),
      });

      expect(alFin.esperando).toBe(true);
      rechazoDe(alFin.respuesta, 'FUERA_DE_HORARIO', 'AMARILLA');
      expect(dentro.esperando).toBe(true);
      const resultado = resultadoDe(dentro.respuesta, 201);
      expect(resultado.asistencia.llegadaEn).toBe(enLima(LUNES, '18:59:59.500').toISOString());
      expect(await asistenciasDe(A(), tarde.alumnoId)).toEqual([]);
      expect((await asistenciasDe(A(), aTiempo.alumnoId))[0]?.registrado_en.toISOString()).toBe(
        enLima(LUNES, '18:59:59.500').toISOString(),
      );
      expect(await clasesUsadasDe(A(), aTiempo.matriculaId)).toBe(1);
    });

    it('criterio 37: toma todas las clases de la matrícula y no solo la de hoy: con la clase del miércoles retenida, el marcado del lunes también espera, y al soltar registra', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.e.lunes.id, esc.e.miercoles.id] });
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;

      const { respuesta, esperando } = await conClaseRetenidaYRelojQueAvanza({
        claseIds: [esc.e.miercoles.id],
        peticion: () => marcar(ctx, via, cookie, alumno),
      });

      expect(esperando, 'el marcado debía esperar la clase del miércoles (todas las de la matrícula)').toBe(true);
      expect(resultadoDe(respuesta, 201).clase.id).toBe(esc.e.lunes.id);
    });

    it('criterio 37: no espera una clase que no es de su matrícula: con otra clase de la academia retenida con FOR UPDATE, responde 201 sin esperar', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;

      const { respuesta, esperando } = await conClaseRetenidaYRelojQueAvanza({
        claseIds: [esc.lunes19.id, esc.e.intermedioLunes.id],
        peticion: () => marcar(ctx, via, cookie, alumno),
        debeEsperar: false,
      });

      expect(esperando).toBe(false);
      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
    });

    it('criterio 37: sin matrícula del día no bloquea ninguna clase: el alumno con la matrícula FINALIZADA responde MENSUALIDAD_NO_VIGENTE sin esperar la clase retenida', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await cambiarMatricula(A(), alumno.matriculaId, { estado: 'FINALIZADA' });
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;

      const { respuesta } = await conClaseRetenidaYRelojQueAvanza({
        claseIds: [esc.e.lunes.id],
        peticion: () => marcar(ctx, via, cookie, alumno),
        debeEsperar: false,
      });

      rechazoDe(respuesta, 'MENSUALIDAD_NO_VIGENTE', 'ROJA');
    });
  });

  describe('el registro posterior toma sus clases del mismo modo', () => {
    it('criterio 37: lanzado a las 18:59:58 (la clase no terminó) con la clase retenida y soltada a las 19:00:05: espera y se registra con la hora de después de la espera', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, enLima(LUNES, '18:59:58.000')).secretaria;
      const t1 = enLima(LUNES, '19:00:05.000');

      const { respuesta, esperando } = await conClaseRetenidaYRelojQueAvanza({
        claseIds: [esc.e.lunes.id],
        peticion: () => registrarPosterior(ctx, cookie, alumno.alumnoId, LUNES, '18:05'),
        t1,
      });

      expect(esperando, 'el registro posterior debía quedar esperando la clase').toBe(true);
      expect(resultadoDe(respuesta, 201).asistencia.registroPosterior).toBe(true);
      const [fila] = await asistenciasDe(A(), alumno.alumnoId);
      expect(fila?.registrado_en.toISOString()).toBe(t1.toISOString());
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
    });
  });

  describe('sin 40P01 con el cobro de otro alumno de la misma clase (bloquearClasesParaCupo)', () => {
    it.each([
      ['QR', 'marcado-primero'],
      ['QR', 'cobro-primero'],
      ['MANUAL', 'marcado-primero'],
      ['MANUAL', 'cobro-primero'],
    ] as const)(
      'criterio 37: el marcado por %s y el cobro de otro alumno de la misma clase a la vez, con la clase retenida (%s): los dos esperan, el cobro responde 201, el marcado registra y ninguno termina en 40P01',
      async (via, orden) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;
        await asegurarCajaDelDia(esc, LUNES);
        const cliente = await sembrarCobrable(esc.e, { reservaVenceEn: enLima('2026-11-20', '10:00') });
        const marcado = () => marcar(ctx, via, cookie, alumno);
        const cobro = () => ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie });

        const { resultados, todasEsperaron } = await conClaseRetenida({
          academiaId: A(),
          claseId: esc.e.lunes.id,
          cambio: { tipo: 'bloquear' },
          liberar: 'ROLLBACK',
          enviar: orden === 'marcado-primero' ? [marcado, cobro] : [cobro, marcado],
        });

        expect(todasEsperaron, 'el marcado y el cobro debían quedar esperando la clase').toBe(true);
        const respuestaMarcado = resultados[orden === 'marcado-primero' ? 0 : 1] as RespuestaApi;
        const respuestaCobro = resultados[orden === 'marcado-primero' ? 1 : 0] as RespuestaApi;
        comprobarSinErrores([respuestaMarcado, respuestaCobro]);
        expect(respuestaCobro.status, respuestaCobro.texto.slice(0, 300)).toBe(201);
        expect(respuestaMarcado.status, respuestaMarcado.texto.slice(0, 300)).toBe(201);
        expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
        expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
      },
    );

    it.each(['posterior-primero', 'cobro-primero'] as const)(
      'criterio 37: el registro posterior y el cobro de otro alumno de la misma clase a la vez, con la clase retenida (%s): los dos esperan, el cobro responde 201, el registro posterior se registra y ninguno termina en 40P01',
      async (orden) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        const cookie = en(ctx, esc, enLima(LUNES, '19:30')).secretaria;
        await asegurarCajaDelDia(esc, LUNES);
        const cliente = await sembrarCobrable(esc.e, { reservaVenceEn: enLima('2026-11-20', '10:00') });
        const posterior = () => registrarPosterior(ctx, cookie, alumno.alumnoId, LUNES, '18:05');
        const cobro = () => ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie });

        const { resultados, todasEsperaron } = await conClaseRetenida({
          academiaId: A(),
          claseId: esc.e.lunes.id,
          cambio: { tipo: 'bloquear' },
          liberar: 'ROLLBACK',
          enviar: orden === 'posterior-primero' ? [posterior, cobro] : [cobro, posterior],
        });

        expect(todasEsperaron, 'el registro posterior y el cobro debían quedar esperando la clase').toBe(true);
        const respuestaPosterior = resultados[orden === 'posterior-primero' ? 0 : 1] as RespuestaApi;
        const respuestaCobro = resultados[orden === 'posterior-primero' ? 1 : 0] as RespuestaApi;
        comprobarSinErrores([respuestaPosterior, respuestaCobro]);
        expect(respuestaCobro.status, respuestaCobro.texto.slice(0, 300)).toBe(201);
        expect(respuestaPosterior.status, respuestaPosterior.texto.slice(0, 300)).toBe(201);
        expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      },
    );

    it('criterio 37: dos marcados de la misma clase (de dos alumnos) no se esperan entre sí: con la clase retenida con FOR NO KEY UPDATE, los dos responden 201', async () => {
      const uno = await crearAlumnoDeAsistencia(ctx, esc);
      const dos = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;
      const retenedor = await abrirRetenedor(A());
      try {
        await retenedor.consultar('UPDATE clases SET aforo = aforo WHERE academia_id = $1::uuid AND id = $2::uuid', [
          A(),
          esc.e.lunes.id,
        ]);

        const respuestas = await conLimite(
          Promise.all([marcar(ctx, 'QR', cookie, uno), marcar(ctx, 'MANUAL', cookie, dos)]),
          'Los marcados esperaron una clase modificada pero sin cambiar su llave: no deben esperarla ni esperarse entre sí.',
        );

        for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
        expect(respuestas.map((respuesta) => respuesta.texto).join('')).not.toMatch(INTERBLOQUEO);
        expect(
          (await leerMatriculas(A()))
            .filter((m) => [uno.matriculaId, dos.matriculaId].includes(m.id))
            .map((m) => m.clases_usadas),
        ).toEqual([1, 1]);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });
  });
});
