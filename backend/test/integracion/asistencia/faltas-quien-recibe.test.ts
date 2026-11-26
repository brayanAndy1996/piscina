// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  cambiarMatricula,
  clasesUsadasDe,
  crearAlumnoDeAsistencia,
  desactivarClase,
  type EscenarioDeAsistencia,
  en,
  enLima,
  filaAsistenciaValida,
  insertarAsistencia,
  LUNES,
  marcar,
  resultadoDe,
} from '../../utilidades/escenario-asistencia';
import {
  crearAlumnoSinPagoConfirmado,
  ejecutarFaltas,
  inasistenciasDe,
  leerInasistencias,
  prepararEscenarioDe009b,
} from '../../utilidades/escenario-faltas';

// Criterio 24 (crítico, D-08, D-16, RN-14; DR-1 y DR-4): para cada fecha D entre ayer y hoy (en Lima) y cada ocurrencia cuyo fin ya pasó (al terminar la clase, sin espera), `registrarFaltas(ahora)` registra una falta (`alumno_id`,
// `matricula_id`, `clase_id`, `fecha` D, `registrada_en` «ahora») por cada alumno que cumple todo esto: su matrícula del mes de D está `VIGENTE` o `FINALIZADA`, con D entre `fecha_inicio` y `fecha_fin` (la base impide una `fecha_fin` que no sea el fin del mes: solo se prueba `fecha_inicio`), y la clase es suya ese día
// (activa, en `matricula_clases`, con el día ISO de D); la ocurrencia está incluida en la mensualidad (su inicio es posterior a `matriculas.creado_en`) y su inicio no es anterior a la fecha de confirmación del pago (los bordes de la
// confirmación, con el reloj de Lima, están en `faltas-lima.test.ts`); no tiene ninguna asistencia (no `PARTICULAR`) con fecha D; le quedan clases (`clases_usadas < clases_totales`) y no está `INACTIVO`. La falta no descuenta
// clases. Volver a correr la tarea no crea nada nuevo.
// Lecturas estrictas elegidas: la clase de 18:00 a 19:00 tiene su falta desde las 19:00:00.000 (no antes: 18:59:59.999 no); «sin pago confirmado no hay falta» se prueba con una matrícula `VIGENTE` sembrada con solo un pago
// pendiente de verificación; el alumno con estado `ALUMNO_VENCIDO` y matrícula del día sí tiene falta (decide la matrícula, no la columna `estado`, como en el criterio 8); una matrícula con `fecha_inicio` igual a D
// cuenta (el rango es inclusivo); la ocurrencia que empieza justo en el instante de `creado_en` no está incluida (el inicio debe ser posterior), y una asistencia de otro día o `PARTICULAR` del mismo día no cubre la clase.

describe('a quién se le registra una falta (criterio 24)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDe009b(ctx, { rutas: false });
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const faltasDe = (alumno: Pick<AlumnoDeAsistencia, 'alumnoId'>) => inasistenciasDe(A(), alumno.alumnoId);
  /** La vuelta de la tarea el lunes 16/11 a las 19:00:00.000, justo cuando termina la clase de 18:00 a 19:00. */
  const AL_TERMINAR = enLima(LUNES, '19:00:00.000');

  describe('el caso base: al terminar la clase, sin espera', () => {
    it('criterio 24: quien no marcó tiene una falta con su alumno, su matrícula, su clase, la fecha de Lima y «ahora» como hora de registro, sin cubrir', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);

      await ejecutarFaltas(ctx, AL_TERMINAR);

      const faltas = await faltasDe(alumno);
      expect(faltas).toHaveLength(1);
      expect(faltas[0]).toMatchObject({
        academia_id: A(),
        alumno_id: alumno.alumnoId,
        matricula_id: alumno.matriculaId,
        clase_id: esc.e.lunes.id,
        fecha: LUNES,
        asistencia_id: null,
        cubierta_en: null,
      });
      expect(faltas[0]?.registrada_en.toISOString()).toBe(AL_TERMINAR.toISOString());
    });

    it('criterio 24: con la clase de 18:00 a 19:00, a las 18:59:59.999 todavía no hay falta y a las 19:00:00.000 sí (DR-1: al terminar la clase, sin espera ni tolerancia)', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);

      await ejecutarFaltas(ctx, enLima(LUNES, '18:59:59.999'));
      expect(await faltasDe(alumno), 'antes de que termine la clase').toEqual([]);
      await ejecutarFaltas(ctx, enLima(LUNES, '19:00:00.000'));

      expect(await faltasDe(alumno)).toHaveLength(1);
    });

    it('criterio 24: la falta no descuenta clases: clases_usadas queda igual (RN-14 descuenta solo asistencias)', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { clasesUsadas: 3 });

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await faltasDe(alumno)).toHaveLength(1);
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(3);
    });

    it('criterio 24: volver a correr la tarea (también más tarde) no crea nada nuevo ni cambia la falta ya registrada', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await ejecutarFaltas(ctx, AL_TERMINAR);
      const primera = (await faltasDe(alumno))[0];

      await ejecutarFaltas(ctx, AL_TERMINAR);
      await ejecutarFaltas(ctx, enLima(LUNES, '19:05:00.000'));
      await ejecutarFaltas(ctx, enLima('2026-11-17', '09:00:00.000'));

      const faltas = await faltasDe(alumno);
      expect(faltas).toHaveLength(1);
      expect(faltas[0]?.id).toBe(primera?.id);
      expect(faltas[0]?.registrada_en.toISOString()).toBe(AL_TERMINAR.toISOString());
    });
  });

  describe('quien sí vino no tiene falta', () => {
    it('criterio 24: quien marcó su asistencia ese día (por la API, dentro de la clase) no tiene falta', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const otro = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;
      resultadoDe(await marcar(ctx, 'QR', cookie, alumno), 201);

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await faltasDe(alumno)).toEqual([]);
      expect(await faltasDe(otro), 'el que no vino sí tiene falta').toHaveLength(1);
    });

    it('criterio 24: una asistencia PARTICULAR del mismo día no cubre la clase: la falta se registra', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await insertarAsistencia(
        'propietario',
        A(),
        filaAsistenciaValida(
          {
            alumnoId: alumno.alumnoId,
            matriculaId: alumno.matriculaId,
            claseId: esc.e.lunes.id,
            usuarioId: esc.e.secretariaA.id,
          },
          { tipo: 'PARTICULAR' },
        ),
      );

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await faltasDe(alumno)).toHaveLength(1);
    });

    it('criterio 24: una asistencia de otro día no cubre la clase de hoy: la falta se registra', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const otroDia = new Date('2026-11-09T23:05:00.000Z');
      await insertarAsistencia(
        'propietario',
        A(),
        filaAsistenciaValida(
          {
            alumnoId: alumno.alumnoId,
            matriculaId: alumno.matriculaId,
            claseId: esc.e.lunes.id,
            usuarioId: esc.e.secretariaA.id,
          },
          { fecha: '2026-11-09', llegada_en: otroDia, registrado_en: otroDia },
        ),
      );

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await faltasDe(alumno)).toHaveLength(1);
    });
  });

  describe('la matrícula del mes de D', () => {
    it.each([
      ['VIGENTE', true],
      ['FINALIZADA', true],
      ['RESERVADA', false],
      ['CANCELADA', false],
    ] as const)('criterio 24: con la matrícula %s, ¿hay falta? %s', async (estado, hay) => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await cambiarMatricula(A(), alumno.matriculaId, { estado });

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await faltasDe(alumno)).toHaveLength(hay ? 1 : 0);
    });

    it('criterio 24: la matrícula que empieza después de D (fecha_inicio 17/11) no da falta por el 16/11; la que empieza el mismo día D (fecha_inicio 16/11) sí', async () => {
      const despues = await crearAlumnoDeAsistencia(ctx, esc, { fechaInicio: '2026-11-17' });
      const mismoDia = await crearAlumnoDeAsistencia(ctx, esc, { fechaInicio: LUNES });

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await faltasDe(despues)).toEqual([]);
      expect(await faltasDe(mismoDia)).toHaveLength(1);
    });

    it('criterio 24: sin ningún pago confirmado (una matrícula VIGENTE con un Yape pendiente de verificación) no hay falta', async () => {
      const sinPago = await crearAlumnoSinPagoConfirmado(esc);
      const conPago = await crearAlumnoDeAsistencia(ctx, esc);

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await inasistenciasDe(A(), sinPago.alumnoId)).toEqual([]);
      expect(await faltasDe(conPago)).toHaveLength(1);
    });
  });

  describe('la clase es suya ese día', () => {
    it('criterio 24: solo la clase de su matrícula cuenta: con la de las 18:00 y otra clase de 19:00 de la academia a la misma hora, tiene una sola falta, de la suya', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);

      await ejecutarFaltas(ctx, enLima(LUNES, '20:00:00.000'));

      const faltas = await faltasDe(alumno);
      expect(faltas.map((falta) => falta.clase_id)).toEqual([esc.e.lunes.id]);
    });

    it('criterio 24: la clase desactivada no cuenta como clase del día', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id] });
      await desactivarClase(A(), esc.lunes19.id);

      await ejecutarFaltas(ctx, enLima(LUNES, '20:00:00.000'));

      expect(await faltasDe(alumno)).toEqual([]);
    });

    it('criterio 24: la clase de otro día de la semana no da falta hoy: con el lunes y el martes de 08:00, el lunes a las 19:00 solo hay falta del lunes', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.e.lunes.id, esc.martes08.id] });

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect((await faltasDe(alumno)).map((falta) => [falta.clase_id, falta.fecha])).toEqual([[esc.e.lunes.id, LUNES]]);
    });
  });

  describe('la ocurrencia está incluida en la mensualidad (DT-14)', () => {
    it('criterio 24: la matrícula creada a las 17:59:59.999 incluye la clase de las 18:00 (falta); la creada a las 18:00:00.000 exactas no (el inicio debe ser posterior); la creada a las 18:30, tampoco', async () => {
      const incluida = await crearAlumnoDeAsistencia(ctx, esc, { matriculaCreadaEn: enLima(LUNES, '17:59:59.999') });
      const justo = await crearAlumnoDeAsistencia(ctx, esc, { matriculaCreadaEn: enLima(LUNES, '18:00:00.000') });
      const despues = await crearAlumnoDeAsistencia(ctx, esc, { matriculaCreadaEn: enLima(LUNES, '18:30:00.000') });

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await faltasDe(incluida)).toHaveLength(1);
      expect(await faltasDe(justo)).toEqual([]);
      expect(await faltasDe(despues)).toEqual([]);
    });
  });

  describe('le quedan clases y no está inactivo (DR-4)', () => {
    it('criterio 24: sin clases restantes (clases_usadas = clases_totales) no hay falta; con una restante sí', async () => {
      const agotado = await crearAlumnoDeAsistencia(ctx, esc, { clasesTotales: 12, clasesUsadas: 12 });
      const ultima = await crearAlumnoDeAsistencia(ctx, esc, { clasesTotales: 12, clasesUsadas: 11 });

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await faltasDe(agotado)).toEqual([]);
      expect(await faltasDe(ultima)).toHaveLength(1);
    });

    it('criterio 24: el alumno INACTIVO no tiene falta; el ALUMNO_VENCIDO con matrícula del día sí (decide la matrícula, no la columna estado)', async () => {
      const inactivo = await crearAlumnoDeAsistencia(ctx, esc, { estadoDelAlumno: 'INACTIVO' });
      const vencido = await crearAlumnoDeAsistencia(ctx, esc, { estadoDelAlumno: 'ALUMNO_VENCIDO' });

      await ejecutarFaltas(ctx, AL_TERMINAR);

      expect(await faltasDe(inactivo)).toEqual([]);
      expect(await faltasDe(vencido)).toHaveLength(1);
    });
  });

  describe('la ventana de ayer y hoy', () => {
    it('criterio 24: el martes 17/11 a las 10:00 registra la falta de ayer (lunes 16) y la de hoy (martes, clase de las 08:00 ya terminada), cada una con su fecha', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.e.lunes.id, esc.martes08.id] });

      await ejecutarFaltas(ctx, enLima('2026-11-17', '10:00:00.000'));

      expect((await faltasDe(alumno)).map((falta) => [falta.fecha, falta.clase_id])).toEqual([
        [LUNES, esc.e.lunes.id],
        ['2026-11-17', esc.martes08.id],
      ]);
    });

    it('criterio 24: el martes 17/11 a las 08:30 la clase de hoy (08:00 a 09:00) no terminó: solo está la falta de ayer; a las 09:00:00.000 ya está la de hoy', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.e.lunes.id, esc.martes08.id] });

      await ejecutarFaltas(ctx, enLima('2026-11-17', '08:30:00.000'));
      expect((await faltasDe(alumno)).map((falta) => falta.fecha)).toEqual([LUNES]);
      await ejecutarFaltas(ctx, enLima('2026-11-17', '09:00:00.000'));

      expect((await faltasDe(alumno)).map((falta) => falta.fecha)).toEqual([LUNES, '2026-11-17']);
    });

    it('criterio 24: una vuelta de dos días después (miércoles 18/11) no registra las faltas del lunes 16/11: quedan fuera de la ventana de ayer y hoy', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);

      await ejecutarFaltas(ctx, enLima('2026-11-18', '10:00:00.000'));

      expect(await faltasDe(alumno)).toEqual([]);
    });

    it('criterio 24: la vuelta de ayer sí registra la del día anterior (martes 17/11 a las 10:00 registra las del lunes 16/11 que no corrieron la noche anterior)', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);

      await ejecutarFaltas(ctx, enLima('2026-11-17', '10:00:00.000'));

      expect((await faltasDe(alumno)).map((falta) => falta.fecha)).toEqual([LUNES]);
    });
  });

  describe('lo que ya existe no se pisa', () => {
    it('criterio 24: una falta ya registrada no se duplica ni cambia al volver a correr la tarea aunque después aparezca una asistencia del día', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await ejecutarFaltas(ctx, AL_TERMINAR);
      const [falta] = await faltasDe(alumno);
      const asistencia = filaAsistenciaValida({
        alumnoId: alumno.alumnoId,
        matriculaId: alumno.matriculaId,
        claseId: esc.e.lunes.id,
        usuarioId: esc.e.secretariaA.id,
      });
      await insertarAsistencia('propietario', A(), asistencia);

      await ejecutarFaltas(ctx, enLima(LUNES, '19:10:00.000'));

      expect(await faltasDe(alumno)).toHaveLength(1);
      expect((await faltasDe(alumno))[0]?.id).toBe(falta?.id);
      expect(await leerInasistencias(esc.e.B.id)).toEqual([]);
    });
  });
});
