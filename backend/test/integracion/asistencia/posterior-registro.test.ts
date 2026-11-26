// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fijarConfiguracion } from '../../utilidades/configuracion';
import { type AppCarnet, conAlumnoRetenido, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  type AlumnoDeAsistencia,
  asistenciasDe,
  cambiarMatricula,
  CLAVES_DE_LA_ASISTENCIA,
  CLAVES_DE_LA_CLASE,
  CLAVES_DE_LAS_CLASES,
  CLAVES_DEL_ALUMNO,
  CLAVES_DEL_RESULTADO,
  clasesUsadasDe,
  codigoDeRespuesta,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  filaAsistenciaValida,
  insertarAsistencia,
  LUNES,
  marcar,
  rechazoDe,
  resultadoDe,
} from '../../utilidades/escenario-asistencia';
import {
  ejecutarFaltas,
  inasistenciasDe,
  instantaneaDeFaltas,
  prepararEscenarioDe009b,
  registrarPosterior,
} from '../../utilidades/escenario-faltas';
import { leerMatriculas, type Objeto, type RespuestaApi } from '../../utilidades/inscripciones';

// Criterio 28 (crítico, D-16, RN-14; DR-2): `POST /api/asistencias/posterior` registra la asistencia de una clase que ya terminó: `fecha` es del mes en curso de Lima y no posterior a hoy (si no, 409 `FECHA_NO_PERMITIDA`); el alumno tiene clase
// ese día y su fin ya pasó (sin clase, 409 `FUERA_DE_HORARIO`; sin terminar, 409 `CLASE_NO_TERMINADA`); `horaLlegada` está dentro de la ventana de esa clase (si no, 409 `HORA_FUERA_DE_LA_CLASE`); valen d, e, g, h y j del criterio 7 con la fecha D en
// lugar de hoy. Inserta la fila con `metodo` `MANUAL`, `registro_posterior` `true`, el motivo, `llegada_en` = D + `horaLlegada` en Lima, `registrado_en` «ahora» y el estado de llegada con la tolerancia de hoy; descuenta una clase; si hay una falta de
// esa clase y fecha, la cubre (`asistencia_id`, `cubierta_en`). Responde 201 con `resultadoAsistenciaSchema` (`registroPosterior: true`). Idempotente con la clave (criterio 13): 200 con `repetida: true`; la misma clave con otro alumno, 409
// `CLAVE_YA_USADA`; la clave de un intento rechazado no queda guardada. Un rechazo no escribe, no descuenta, no cubre una falta ni audita.
// Lecturas estrictas elegidas: la clase «terminó» desde su fin exacto (19:00:00.000 para la de 18:00 a 19:00; a las 18:59:59.999 todavía no); `horaLlegada` dentro de la ventana `[inicio, fin)` como en el criterio 9 (18:00 y 18:59 valen; 17:59 y 19:00 no);
// el estado se calcula con la tolerancia de hoy y por minuto (como el criterio 10); un día anterior del mismo mes vale (la secretaria puede corregir la semana pasada); para los tres códigos nuevos solo se exige el 409 con su código (no se fija su
// alerta ni el contenido de `detalles`); el 409 de d, e, g, h y j lleva los `detalles` del rechazo con la alerta del criterio 7; una asistencia `PARTICULAR` del mismo día no cuenta como «ya tiene una» (fila e); el registro posterior del mismo día en que la tarea
// aún no registró la falta no deja ninguna falta (la tarea ya no la crea).

describe('el registro posterior de una asistencia (criterio 28)', () => {
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
  /** Las 19:30 del lunes 16/11: la clase de 18:00 a 19:00 ya terminó. */
  const AHORA = enLima(LUNES, '19:30:00.000');
  const MOTIVO = 'La secretaria no estaba en la entrada';
  const nuevo = (opciones: Parameters<typeof crearAlumnoDeAsistencia>[2] = {}) =>
    crearAlumnoDeAsistencia(ctx, esc, opciones);
  const cookieEn = (instante: Date = AHORA) => en(ctx, esc, instante).secretaria;
  const registrar = (
    alumno: Pick<AlumnoDeAsistencia, 'alumnoId'>,
    hora: string,
    sobre: Objeto = {},
    opciones: { fecha?: string; instante?: Date; cookie?: string } = {},
  ): Promise<RespuestaApi> =>
    registrarPosterior(
      ctx,
      opciones.cookie ?? cookieEn(opciones.instante),
      alumno.alumnoId,
      opciones.fecha ?? LUNES,
      hora,
      {
        motivo: MOTIVO,
        ...sobre,
      },
    );

  describe('el registro correcto', () => {
    it('criterio 28: devuelve 201 con el resultado (registroPosterior true, método MANUAL, la clase de ese día y las clases después del descuento), con las claves exactas de resultadoAsistenciaSchema', async () => {
      const alumno = await nuevo();

      const respuesta = await registrar(alumno, '18:05');

      const resultado = resultadoDe(respuesta, 201);
      expect(Object.keys(resultado).sort()).toEqual(CLAVES_DEL_RESULTADO);
      expect(Object.keys(resultado.asistencia).sort()).toEqual(CLAVES_DE_LA_ASISTENCIA);
      expect(Object.keys(resultado.alumno).sort()).toEqual(CLAVES_DEL_ALUMNO);
      expect(Object.keys(resultado.clase).sort()).toEqual(CLAVES_DE_LA_CLASE);
      expect(Object.keys(resultado.clases).sort()).toEqual(CLAVES_DE_LAS_CLASES);
      expect(resultado.asistencia).toMatchObject({
        fecha: LUNES,
        horaLlegada: '18:05',
        llegadaEn: enLima(LUNES, '18:05').toISOString(),
        estadoLlegada: 'PUNTUAL',
        metodo: 'MANUAL',
        registroPosterior: true,
      });
      expect(resultado.alumno.id).toBe(alumno.alumnoId);
      expect(resultado.clase).toMatchObject({
        id: esc.e.lunes.id,
        diaSemana: 1,
        horaInicio: '18:00',
        horaFin: '19:00',
      });
      expect(resultado.clases).toEqual({ usadas: 1, totales: 12, restantes: 11 });
      expect(resultado.repetida).toBe(false);
    });

    it('criterio 28: la fila lleva MANUAL, registro_posterior, el motivo, la hora de llegada de Lima, «ahora» como hora de registro, la clave, la matrícula, la clase y quien registra; la matrícula descuenta una clase con actualizado_en «ahora»', async () => {
      const alumno = await nuevo();
      const clave = randomUUID();

      resultadoDe(await registrar(alumno, '18:05', { claveIdempotencia: clave }), 201);

      const [fila] = await asistenciasDe(A(), alumno.alumnoId);
      expect(fila).toMatchObject({
        fecha: LUNES,
        matricula_id: alumno.matriculaId,
        clase_id: esc.e.lunes.id,
        metodo: 'MANUAL',
        tipo: 'NORMAL',
        estado_llegada: 'PUNTUAL',
        registrado_por: esc.e.secretariaA.id,
        registro_posterior: true,
        motivo: MOTIVO,
        clave_idempotencia: clave,
      });
      expect(fila?.llegada_en.toISOString()).toBe(enLima(LUNES, '18:05').toISOString());
      expect(fila?.registrado_en.toISOString()).toBe(AHORA.toISOString());
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
      const matricula = (await leerMatriculas(A())).find((m) => m.id === alumno.matriculaId);
      expect(matricula?.actualizado_en.toISOString()).toBe(AHORA.toISOString());
    });

    it('criterio 28: también lo registra el administrador', async () => {
      const alumno = await nuevo();

      const respuesta = await registrar(alumno, '18:05', {}, { cookie: en(ctx, esc, AHORA).admin });

      expect(resultadoDe(respuesta, 201).asistencia.registroPosterior).toBe(true);
      expect((await asistenciasDe(A(), alumno.alumnoId))[0]?.registrado_por).toBe(esc.e.adminA.id);
    });

    it('criterio 28: sirve para un día anterior del mismo mes (miércoles 18/11 para la clase del lunes 16/11)', async () => {
      const alumno = await nuevo();

      const respuesta = await registrar(alumno, '18:20', {}, { instante: enLima('2026-11-18', '10:00') });

      const resultado = resultadoDe(respuesta, 201);
      expect(resultado.asistencia).toMatchObject({ fecha: LUNES, horaLlegada: '18:20', estadoLlegada: 'TARDE' });
      const [fila] = await asistenciasDe(A(), alumno.alumnoId);
      expect(fila?.registrado_en.toISOString()).toBe(enLima('2026-11-18', '10:00').toISOString());
      expect(fila?.llegada_en.toISOString()).toBe(enLima(LUNES, '18:20').toISOString());
    });

    it('criterio 28: una asistencia PARTICULAR del mismo día no cuenta como «ya tiene una»: se registra', async () => {
      const alumno = await nuevo();
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

      const respuesta = await registrar(alumno, '18:05');

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
    });
  });

  describe('puntual o tarde con la tolerancia de hoy', () => {
    const CASOS: { tolerancia: number | 'por defecto'; hora: string; estado: 'PUNTUAL' | 'TARDE' }[] = [
      { tolerancia: 'por defecto', hora: '18:10', estado: 'PUNTUAL' },
      { tolerancia: 'por defecto', hora: '18:11', estado: 'TARDE' },
      { tolerancia: 10, hora: '18:00', estado: 'PUNTUAL' },
      { tolerancia: 10, hora: '18:59', estado: 'TARDE' },
      { tolerancia: 0, hora: '18:00', estado: 'PUNTUAL' },
      { tolerancia: 0, hora: '18:01', estado: 'TARDE' },
      { tolerancia: 30, hora: '18:30', estado: 'PUNTUAL' },
      { tolerancia: 30, hora: '18:31', estado: 'TARDE' },
    ];

    it.each(CASOS)(
      'criterio 28: con tolerancia $tolerancia, la llegada a las $hora es $estado',
      async ({ tolerancia, hora, estado }) => {
        if (tolerancia !== 'por defecto') await fijarConfiguracion(A(), { toleranciaTardanzaMinutos: tolerancia });
        const alumno = await nuevo();

        const respuesta = await registrar(alumno, hora);

        expect(resultadoDe(respuesta, 201).asistencia.estadoLlegada).toBe(estado);
        expect((await asistenciasDe(A(), alumno.alumnoId))[0]?.estado_llegada).toBe(estado);
      },
    );
  });

  describe('la hora de llegada está dentro de la clase', () => {
    it.each(['18:00', '18:30', '18:59'])(
      'criterio 28: la hora %s está dentro de la clase de 18:00 a 19:00 y se registra',
      async (hora) => {
        const alumno = await nuevo();

        const respuesta = await registrar(alumno, hora);

        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
      },
    );

    it.each(['17:59', '19:00', '19:01', '00:00', '23:59'])(
      'criterio 28: la hora %s está fuera de la clase de 18:00 a 19:00: 409 HORA_FUERA_DE_LA_CLASE, sin escribir ni descontar ni auditar',
      async (hora) => {
        const alumno = await nuevo();
        const cookie = cookieEn();
        const antes = await instantaneaDeFaltas(esc.e);

        const respuesta = await registrar(alumno, hora, {}, { cookie });

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
          409,
          'HORA_FUERA_DE_LA_CLASE',
        ]);
        expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
        expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(0);
      },
    );
  });

  describe('la clase ya terminó', () => {
    it('criterio 28: a las 18:59:59.999 la clase de 18:00 a 19:00 no terminó (409 CLASE_NO_TERMINADA); a las 19:00:00.000 sí (201)', async () => {
      const alumno = await nuevo();
      const antes = await instantaneaDeFaltas(esc.e);

      const temprano = await registrar(alumno, '18:05', {}, { instante: enLima(LUNES, '18:59:59.999') });
      expect([temprano.status, codigoDeRespuesta(temprano)], temprano.texto.slice(0, 300)).toEqual([
        409,
        'CLASE_NO_TERMINADA',
      ]);
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
      const justo = await registrar(alumno, '18:05', {}, { instante: enLima(LUNES, '19:00:00.000') });

      expect(justo.status, justo.texto.slice(0, 300)).toBe(201);
    });

    it('criterio 28: antes de que empiece la clase (17:00) y durante ella (18:30), 409 CLASE_NO_TERMINADA: durante la clase se usa el marcado normal', async () => {
      const alumno = await nuevo();
      const antes = await instantaneaDeFaltas(esc.e);

      for (const hora of ['17:00', '18:30']) {
        const respuesta = await registrar(alumno, '18:05', {}, { instante: enLima(LUNES, hora) });
        expect([respuesta.status, codigoDeRespuesta(respuesta)], `${hora}: ${respuesta.texto.slice(0, 200)}`).toEqual([
          409,
          'CLASE_NO_TERMINADA',
        ]);
      }
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
    });

    it('criterio 28: con la clase de 19:00 a 20:00 a las 19:30 (en curso), 409 CLASE_NO_TERMINADA; a las 20:00:00.000 se registra', async () => {
      const alumno = await nuevo({ claseIds: [esc.lunes19.id] });

      const enCurso = await registrar(alumno, '19:10', {}, { instante: AHORA });
      expect([enCurso.status, codigoDeRespuesta(enCurso)], enCurso.texto.slice(0, 300)).toEqual([
        409,
        'CLASE_NO_TERMINADA',
      ]);
      const terminada = await registrar(alumno, '19:10', {}, { instante: enLima(LUNES, '20:00:00.000') });

      expect(resultadoDe(terminada, 201).clase).toMatchObject({ horaInicio: '19:00', horaFin: '20:00' });
    });
  });

  describe('la fecha y el día de clase', () => {
    it('criterio 28: una fecha posterior a hoy (el lunes 23/11, que sí tiene clase) responde 409 FECHA_NO_PERMITIDA', async () => {
      const alumno = await nuevo();
      const antes = await instantaneaDeFaltas(esc.e);

      const respuesta = await registrar(alumno, '18:05', {}, { fecha: '2026-11-23' });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
        409,
        'FECHA_NO_PERMITIDA',
      ]);
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
    });

    it('criterio 28: una fecha de un mes anterior (el 30/11 desde el 1/12 a las 20:30, con la clase de 19:00 a 20:00 ya terminada) responde 409 FECHA_NO_PERMITIDA: solo el mes en curso', async () => {
      const alumno = await nuevo({ claseIds: [esc.lunes19.id] });
      const antes = await instantaneaDeFaltas(esc.e);

      const respuesta = await registrar(
        alumno,
        '19:10',
        {},
        { fecha: '2026-11-30', instante: enLima('2026-12-01', '20:30') },
      );

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
        409,
        'FECHA_NO_PERMITIDA',
      ]);
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
    });

    it('criterio 28: la fecha de hoy es la de Lima: el 30/11 a las 20:30 (ya es 1/12 en UTC) la clase de 19:00 a 20:00 del 30/11 se registra', async () => {
      const alumno = await nuevo({ claseIds: [esc.lunes19.id] });

      const respuesta = await registrar(
        alumno,
        '19:10',
        {},
        { fecha: '2026-11-30', instante: enLima('2026-11-30', '20:30') },
      );

      expect(resultadoDe(respuesta, 201).asistencia).toMatchObject({ fecha: '2026-11-30', horaLlegada: '19:10' });
    });

    it('criterio 28: un día sin clase del alumno (el martes 17/11, con solo la clase de los lunes) responde 409 FUERA_DE_HORARIO', async () => {
      const alumno = await nuevo();
      const antes = await instantaneaDeFaltas(esc.e);

      const respuesta = await registrar(
        alumno,
        '18:05',
        {},
        { fecha: '2026-11-17', instante: enLima('2026-11-17', '20:00') },
      );

      expect(rechazoDe(respuesta, 'FUERA_DE_HORARIO', 'AMARILLA').alumno.id).toBe(alumno.alumnoId);
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
    });
  });

  describe('los rechazos del marcado que valen con la fecha D (d, e, g, h y j del criterio 7)', () => {
    /** Cada caso arma un alumno que solo incumple esa condición y comprueba que el rechazo no escribe, no descuenta, no cubre una falta ni audita. */
    const CASOS: {
      nombre: string;
      codigo: string;
      alerta: 'ROJA' | 'AMARILLA';
      armar: () => Promise<AlumnoDeAsistencia>;
    }[] = [
      {
        nombre: 'd: alumno INACTIVO',
        codigo: 'ALUMNO_INACTIVO',
        alerta: 'ROJA',
        armar: () => nuevo({ estadoDelAlumno: 'INACTIVO' }),
      },
      {
        nombre: 'g: matrícula CANCELADA',
        codigo: 'MENSUALIDAD_NO_VIGENTE',
        alerta: 'ROJA',
        armar: async () => {
          const alumno = await nuevo();
          await cambiarMatricula(A(), alumno.matriculaId, { estado: 'CANCELADA' });
          return alumno;
        },
      },
      {
        nombre: 'g: matrícula FINALIZADA',
        codigo: 'MENSUALIDAD_NO_VIGENTE',
        alerta: 'ROJA',
        armar: async () => {
          const alumno = await nuevo();
          await cambiarMatricula(A(), alumno.matriculaId, { estado: 'FINALIZADA' });
          return alumno;
        },
      },
      {
        nombre: 'g: matrícula que empieza después de D',
        codigo: 'MENSUALIDAD_NO_VIGENTE',
        alerta: 'ROJA',
        armar: () => nuevo({ fechaInicio: '2026-11-17' }),
      },
      {
        nombre: 'h: sin clases restantes',
        codigo: 'SIN_CLASES_RESTANTES',
        alerta: 'ROJA',
        armar: () => nuevo({ clasesTotales: 12, clasesUsadas: 12 }),
      },
      {
        nombre: 'j: la clase empezó antes de que se creara la matrícula',
        codigo: 'CLASE_NO_INCLUIDA',
        alerta: 'AMARILLA',
        armar: () => nuevo({ matriculaCreadaEn: enLima(LUNES, '18:30:00.000') }),
      },
    ];

    it.each(CASOS)(
      'criterio 28: $nombre responde 409 $codigo con su alerta, sin escribir ni descontar ni auditar',
      async ({ codigo, alerta, armar }) => {
        const alumno = await armar();
        const cookie = cookieEn();
        const antes = await instantaneaDeFaltas(esc.e);
        const usadasAntes = await clasesUsadasDe(A(), alumno.matriculaId);

        const respuesta = await registrar(alumno, '18:05', {}, { cookie });

        const detalles = rechazoDe(respuesta, codigo, alerta);
        expect(detalles.alumno.id).toBe(alumno.alumnoId);
        expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
        expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(usadasAntes);
        expect(await leerAuditoriaDeAcademia(A(), 'ASISTENCIA_POSTERIOR_REGISTRADA')).toEqual([]);
      },
    );

    it('criterio 28 (fila e): si el alumno ya tiene una asistencia ese día, 409 ASISTENCIA_YA_REGISTRADA con su hora y estado, sin otra fila ni otro descuento', async () => {
      const alumno = await nuevo();
      resultadoDe(await marcar(ctx, 'QR', cookieEn(enLima(LUNES, '18:05')), alumno), 201);
      const antes = await instantaneaDeFaltas(esc.e);

      const respuesta = await registrar(alumno, '18:30', {}, { cookie: cookieEn() });

      const detalles = rechazoDe(respuesta, 'ASISTENCIA_YA_REGISTRADA', 'AMARILLA');
      expect(detalles.asistenciaDeHoy).toMatchObject({ horaLlegada: '18:05', estadoLlegada: 'PUNTUAL', metodo: 'QR' });
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
    });
  });

  describe('la falta de esa clase y fecha se cubre', () => {
    it('criterio 28: si la tarea ya registró la falta, el registro posterior la cubre con su asistencia (asistencia_id y cubierta_en «ahora») y la falta no se duplica', async () => {
      const alumno = await nuevo();
      await ejecutarFaltas(ctx, enLima(LUNES, '19:00:00.000'));
      expect(await inasistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);

      const resultado = resultadoDe(await registrar(alumno, '18:05'), 201);

      const faltas = await inasistenciasDe(A(), alumno.alumnoId);
      expect(faltas).toHaveLength(1);
      expect(faltas[0]?.asistencia_id).toBe(resultado.asistencia.id);
      expect(faltas[0]?.cubierta_en?.toISOString()).toBe(AHORA.toISOString());
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
    });

    it('criterio 28: volver a correr la tarea después no crea otra falta ni toca la cubierta', async () => {
      const alumno = await nuevo();
      await ejecutarFaltas(ctx, enLima(LUNES, '19:00:00.000'));
      resultadoDe(await registrar(alumno, '18:05'), 201);
      const cubierta = (await inasistenciasDe(A(), alumno.alumnoId))[0];

      await ejecutarFaltas(ctx, AHORA);

      expect(await inasistenciasDe(A(), alumno.alumnoId)).toEqual([cubierta]);
    });

    it('criterio 28: solo cubre la falta de esa clase y fecha: la falta de otro día del mismo alumno y la de otro alumno siguen sin cubrir', async () => {
      const alumno = await nuevo({ claseIds: [esc.e.lunes.id, esc.e.miercoles.id] });
      const otro = await nuevo();
      await ejecutarFaltas(ctx, enLima('2026-11-17', '10:00')); // la del lunes 16
      await ejecutarFaltas(ctx, enLima('2026-11-18', '19:00')); // la del miércoles 18
      expect((await inasistenciasDe(A(), alumno.alumnoId)).map((falta) => falta.fecha)).toEqual([LUNES, '2026-11-18']);

      resultadoDe(await registrar(alumno, '18:05', {}, { instante: enLima('2026-11-18', '19:30') }), 201);

      const faltas = await inasistenciasDe(A(), alumno.alumnoId);
      expect(faltas.map((falta) => [falta.fecha, falta.asistencia_id !== null])).toEqual([
        [LUNES, true],
        ['2026-11-18', false],
      ]);
      expect((await inasistenciasDe(A(), otro.alumnoId)).every((falta) => falta.asistencia_id === null)).toBe(true);
    });

    it('criterio 28: si la tarea todavía no registró la falta, el registro posterior se registra igual y la tarea ya no crea la falta de ese día', async () => {
      const alumno = await nuevo();

      resultadoDe(await registrar(alumno, '18:05'), 201);
      expect(await inasistenciasDe(A(), alumno.alumnoId)).toEqual([]);
      await ejecutarFaltas(ctx, AHORA);

      expect(await inasistenciasDe(A(), alumno.alumnoId)).toEqual([]);
    });
  });

  describe('idempotente con la clave (criterios 13 y 36)', () => {
    it('criterio 28: la misma clave otra vez responde 200 con el mismo cuerpo del 201 y repetida: true, aunque pase el día, sin otra fila, otro descuento ni otra auditoría', async () => {
      const alumno = await nuevo();
      const clave = randomUUID();
      const primera = await registrar(alumno, '18:05', { claveIdempotencia: clave });
      const resultado = resultadoDe(primera, 201);
      const antes = await instantaneaDeFaltas(esc.e);

      for (const cuando of [AHORA, enLima('2026-11-17', '09:00'), enLima('2026-11-18', '19:30')]) {
        const reintento = await registrar(alumno, '18:05', { claveIdempotencia: clave }, { instante: cuando });

        const repetido = resultadoDe(reintento, 200);
        expect(repetido.repetida).toBe(true);
        expect({ ...repetido, repetida: false }, 'el mismo cuerpo del 201').toEqual(resultado);
      }
      expect(await instantaneaDeFaltas(esc.e), 'ni otra fila, ni otro descuento, ni otra auditoría').toBe(antes);
      expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
    });

    it('criterio 28: la misma clave con otro alumno responde 409 CLAVE_YA_USADA, sin detalles, sin escribir ni auditar', async () => {
      const dueño = await nuevo();
      const otro = await nuevo();
      const clave = randomUUID();
      await registrar(dueño, '18:05', { claveIdempotencia: clave });
      const antes = await instantaneaDeFaltas(esc.e);

      const respuesta = await registrar(otro, '18:05', { claveIdempotencia: clave });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
        409,
        'CLAVE_YA_USADA',
      ]);
      expect(respuesta.body?.['detalles']).toBeUndefined();
      expect(respuesta.texto).not.toContain(dueño.alumnoId);
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
      expect(await clasesUsadasDe(A(), otro.matriculaId)).toBe(0);
    });

    it('criterio 28: la clave de un intento rechazado no queda guardada: se puede volver a usar con una fecha correcta', async () => {
      const alumno = await nuevo();
      const clave = randomUUID();

      const rechazado = await registrar(alumno, '18:05', { claveIdempotencia: clave }, { fecha: '2026-11-23' });
      expect([rechazado.status, codigoDeRespuesta(rechazado)]).toEqual([409, 'FECHA_NO_PERMITIDA']);
      const bueno = await registrar(alumno, '18:05', { claveIdempotencia: clave });

      expect(resultadoDe(bueno, 201).repetida).toBe(false);
    });

    it('criterio 28: dos peticiones a la vez con la misma clave dejan una sola asistencia (una 201 y una 200), un solo descuento y una sola auditoría', async () => {
      const alumno = await nuevo();
      const cookie = cookieEn();
      const clave = randomUUID();

      const { resultados, esperaron } = await conAlumnoRetenido({
        academiaId: A(),
        alumnoId: alumno.alumnoId,
        esperando: 2,
        enviar: [
          () => registrar(alumno, '18:05', { claveIdempotencia: clave }, { cookie }),
          () => registrar(alumno, '18:05', { claveIdempotencia: clave }, { cookie }),
        ],
      });

      expect(esperaron, 'las dos peticiones debían quedar esperando la fila del alumno').toBe(true);
      expect(resultados.map((r) => r.status).sort(), resultados.map((r) => r.texto.slice(0, 120)).join(' | ')).toEqual([
        200, 201,
      ]);
      expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
      expect(await leerAuditoriaDeAcademia(A(), 'ASISTENCIA_POSTERIOR_REGISTRADA')).toHaveLength(1);
    });

    it('criterio 28: dos registros posteriores distintos del mismo alumno y día, a la vez, dejan una sola asistencia: el otro responde 409 ASISTENCIA_YA_REGISTRADA', async () => {
      const alumno = await nuevo();
      const cookie = cookieEn();

      const { resultados, esperaron } = await conAlumnoRetenido({
        academiaId: A(),
        alumnoId: alumno.alumnoId,
        esperando: 2,
        enviar: [() => registrar(alumno, '18:05', {}, { cookie }), () => registrar(alumno, '18:20', {}, { cookie })],
      });

      expect(esperaron).toBe(true);
      expect(resultados.map((r) => r.status).sort()).toEqual([201, 409]);
      const rechazada = resultados.find((r) => r.status === 409) as RespuestaApi;
      expect(codigoDeRespuesta(rechazada)).toBe('ASISTENCIA_YA_REGISTRADA');
      expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(1);
    });
  });
});
