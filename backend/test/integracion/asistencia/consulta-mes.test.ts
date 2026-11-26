// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  cambiarMatricula,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  filaAsistenciaValida,
  insertarAsistencia,
  LUNES,
} from '../../utilidades/escenario-asistencia';
import {
  actualizarInasistencia,
  CLAVES_DE_LA_CLASE_DEL_REGISTRO,
  CLAVES_DE_LA_CONSULTA,
  CLAVES_DE_LA_MATRICULA_DEL_MES,
  CLAVES_DE_UN_REGISTRO_DE_ASISTENCIA,
  CLAVES_DE_UN_REGISTRO_DE_FALTA,
  consultaDe,
  consultarMes,
  filaInasistenciaValida,
  insertarInasistencia,
  instantaneaDeFaltas,
  leerInasistencias,
  prepararEscenarioDe009b,
} from '../../utilidades/escenario-faltas';
import { abrirRetenedor } from '../../utilidades/planes-clases';

// Criterio 31 (crítico, sección 2.1, D-08, D-23), contenido: `GET /api/alumnos/{id}/asistencias?mes=AAAA-MM` (por defecto, el mes en curso de Lima) responde 200 con `asistenciaDelMesSchema` (estricto): `mes`, `matricula` (`{ clasesTotales, clasesUsadas,
// clasesRestantes }` de la matrícula `VIGENTE` o `FINALIZADA` de ese mes, o `null`) y `registros`, ordenados por fecha: cada asistencia (`tipo: 'ASISTENCIA'`, `fecha`, `clase` con sus horas, `horaLlegada`, `estadoLlegada`, `metodo`, `registroPosterior`,
// `faltaCubierta`) y cada falta sin cubrir (`tipo: 'FALTA'`, `fecha`, `clase`). Una falta cubierta aparece solo como su asistencia. Sin DNI ni motivo. No escribe, no bloquea y no audita. Los permisos, los 404, los 400 y el aislamiento están en
// `consulta-mes-permisos.test.ts`.
// Lecturas estrictas elegidas: «ordenados por fecha» es de la más antigua a la más nueva; `faltaCubierta` es `true` en la asistencia que cubre una falta (cualquier método) y `false` en las demás; las horas de `clase` son las de la clase de ese registro (`HH:MM`);
// `horaLlegada` es la hora de Lima de `llegada_en`; el mes en curso se calcula con el reloj en America/Lima (con el proceso en UTC y en Asia/Tokyo); una matrícula `RESERVADA` o `CANCELADA` del mes da `matricula: null`; «no bloquea» se prueba con la fila del alumno, la de su
// matrícula y la de su clase retenidas con `FOR UPDATE`: la respuesta llega sin esperar.

const ZONA_ORIGINAL = process.env['TZ'];

describe('la asistencia del mes de un alumno (criterio 31)', () => {
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
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });

  const A = () => esc.e.A.id;
  const AHORA = enLima('2026-11-17', '10:00:00.000');
  const cookie = () => en(ctx, esc, AHORA).secretaria;

  /** Una asistencia de la matrícula del alumno el día `fecha` (de la clase indicada, por defecto la de los lunes de las 18:00), a la hora de Lima `hora`. */
  async function asistencia(
    alumno: AlumnoDeAsistencia,
    fecha: string,
    hora: string,
    sobre: Record<string, unknown> = {},
    claseId: string = esc.e.lunes.id,
  ): Promise<string> {
    const llegada = enLima(fecha, hora);
    const columnas = filaAsistenciaValida(
      { alumnoId: alumno.alumnoId, matriculaId: alumno.matriculaId, claseId, usuarioId: esc.e.secretariaA.id },
      {
        fecha,
        llegada_en: llegada,
        registrado_en: new Date(llegada.getTime() + 60_000),
        estado_llegada: 'PUNTUAL',
        ...sobre,
      },
    );
    await insertarAsistencia('propietario', A(), columnas);
    return columnas['id'] as string;
  }

  async function falta(alumno: AlumnoDeAsistencia, fecha: string, claseId: string = esc.e.lunes.id): Promise<string> {
    const columnas = filaInasistenciaValida(
      { alumnoId: alumno.alumnoId, matriculaId: alumno.matriculaId, claseId },
      { fecha, registrada_en: enLima(fecha, '19:05') },
    );
    await insertarInasistencia('propietario', A(), columnas);
    return columnas['id'] as string;
  }

  /** Los registros de noviembre del alumno: una asistencia puntual por QR, una falta sin cubrir, una asistencia tarde posterior que cubre su falta y otra manual. */
  async function armarNoviembre(alumno: AlumnoDeAsistencia): Promise<void> {
    await asistencia(alumno, '2026-11-02', '18:03', { metodo: 'QR' });
    await falta(alumno, '2026-11-09');
    const faltaDelDia16 = await falta(alumno, LUNES);
    const posterior = await asistencia(alumno, LUNES, '18:25', {
      metodo: 'MANUAL',
      estado_llegada: 'TARDE',
      registro_posterior: true,
      motivo: 'La secretaria no estaba en la entrada',
      registrado_en: enLima(LUNES, '19:30'),
    });
    await actualizarInasistencia('propietario', A(), faltaDelDia16, {
      asistencia_id: posterior,
      cubierta_en: enLima(LUNES, '19:30'),
    });
    await asistencia(alumno, '2026-11-23', '18:00', { metodo: 'MANUAL' });
    await cambiarMatricula(A(), alumno.matriculaId, { clases_usadas: 3 });
  }

  const CLASE_DE_LAS_18 = { horaInicio: '18:00', horaFin: '19:00' };

  describe('lo que lleva la respuesta', () => {
    it('criterio 31: con el mes explícito devuelve el mes, las clases de la matrícula y los registros por fecha: cada asistencia con su hora, estado, método, si fue posterior y si cubrió una falta, y cada falta sin cubrir; la falta cubierta no sale sola', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await armarNoviembre(alumno);

      const consulta = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-11'));

      expect(consulta.mes).toBe('2026-11');
      expect(consulta.matricula).toEqual({ clasesTotales: 12, clasesUsadas: 3, clasesRestantes: 9 });
      expect(consulta.registros).toEqual([
        {
          tipo: 'ASISTENCIA',
          fecha: '2026-11-02',
          clase: CLASE_DE_LAS_18,
          horaLlegada: '18:03',
          estadoLlegada: 'PUNTUAL',
          metodo: 'QR',
          registroPosterior: false,
          faltaCubierta: false,
        },
        { tipo: 'FALTA', fecha: '2026-11-09', clase: CLASE_DE_LAS_18 },
        {
          tipo: 'ASISTENCIA',
          fecha: LUNES,
          clase: CLASE_DE_LAS_18,
          horaLlegada: '18:25',
          estadoLlegada: 'TARDE',
          metodo: 'MANUAL',
          registroPosterior: true,
          faltaCubierta: true,
        },
        {
          tipo: 'ASISTENCIA',
          fecha: '2026-11-23',
          clase: CLASE_DE_LAS_18,
          horaLlegada: '18:00',
          estadoLlegada: 'PUNTUAL',
          metodo: 'MANUAL',
          registroPosterior: false,
          faltaCubierta: false,
        },
      ]);
    });

    it('criterio 31: sin ?mes devuelve el mes en curso de Lima (noviembre el 17/11), con lo mismo que con el mes explícito', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await armarNoviembre(alumno);

      const porDefecto = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId));
      const explicito = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-11'));

      expect(porDefecto.mes).toBe('2026-11');
      expect(porDefecto).toEqual(explicito);
    });

    it('criterio 31: las claves son exactamente las de asistenciaDelMesSchema, en la respuesta, la matrícula, cada tipo de registro y la clase', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await armarNoviembre(alumno);

      const consulta = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-11'));

      expect(Object.keys(consulta).sort()).toEqual(CLAVES_DE_LA_CONSULTA);
      expect(Object.keys(consulta.matricula ?? {}).sort()).toEqual(CLAVES_DE_LA_MATRICULA_DEL_MES);
      for (const registro of consulta.registros) {
        expect(Object.keys(registro).sort()).toEqual(
          registro.tipo === 'ASISTENCIA' ? CLAVES_DE_UN_REGISTRO_DE_ASISTENCIA : CLAVES_DE_UN_REGISTRO_DE_FALTA,
        );
        expect(Object.keys(registro.clase).sort()).toEqual(CLAVES_DE_LA_CLASE_DEL_REGISTRO);
      }
    });

    it('criterio 31: no lleva el DNI, el motivo del registro posterior, el token del QR ni quién registró', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { dni: '47811902' });
      await armarNoviembre(alumno);

      const respuesta = await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-11');

      expect(respuesta.status).toBe(200);
      expect(respuesta.texto).not.toContain('47811902');
      expect(respuesta.texto).not.toContain('La secretaria no estaba');
      expect(respuesta.texto).not.toContain(alumno.token);
      expect(respuesta.texto).not.toContain(esc.e.secretariaA.id);
      expect(respuesta.texto).not.toContain(alumno.matriculaId);
    });

    it('criterio 31: cada registro lleva las horas de su propia clase (un alumno con la clase de los lunes de 19:00 a 20:00 y la de los martes de 08:00 a 09:00)', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id, esc.martes08.id] });
      await asistencia(alumno, LUNES, '19:02', {}, esc.lunes19.id);
      await falta(alumno, '2026-11-17', esc.martes08.id);

      const consulta = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-11'));

      expect(consulta.registros.map((registro) => [registro.tipo, registro.fecha, registro.clase])).toEqual([
        ['ASISTENCIA', LUNES, { horaInicio: '19:00', horaFin: '20:00' }],
        ['FALTA', '2026-11-17', { horaInicio: '08:00', horaFin: '09:00' }],
      ]);
    });

    it('criterio 31: la hora de llegada es la de Lima aunque en UTC ya sea otro día (llegada el 30/11 a las 19:30, 00:30 UTC del 1/12)', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id] });
      await asistencia(alumno, '2026-11-30', '19:30', { estado_llegada: 'TARDE' }, esc.lunes19.id);

      const consulta = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-11'));

      expect(consulta.registros).toHaveLength(1);
      expect(consulta.registros[0]).toMatchObject({ tipo: 'ASISTENCIA', fecha: '2026-11-30', horaLlegada: '19:30' });
      expect(consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-12')).registros).toEqual([]);
    });
  });

  describe('la matrícula del mes', () => {
    it.each(['VIGENTE', 'FINALIZADA'] as const)(
      'criterio 31: con la matrícula %s de ese mes, trae sus clases',
      async (estado) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc, { clasesUsadas: 5 });
        await cambiarMatricula(A(), alumno.matriculaId, { estado });

        const consulta = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-11'));

        expect(consulta.matricula).toEqual({ clasesTotales: 12, clasesUsadas: 5, clasesRestantes: 7 });
      },
    );

    it.each(['RESERVADA', 'CANCELADA'] as const)(
      'criterio 31: con la matrícula %s de ese mes, matricula es null',
      async (estado) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        await cambiarMatricula(A(), alumno.matriculaId, { estado });

        const consulta = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-11'));

        expect(consulta.matricula).toBeNull();
      },
    );

    it('criterio 31: un mes sin matrícula ni registros (octubre, diciembre, el mes más antiguo y el más nuevo) devuelve matricula null y registros vacíos', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await armarNoviembre(alumno);

      for (const mes of ['2026-10', '2026-12', '2000-01', '9999-12']) {
        const consulta = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, mes));
        expect(consulta, mes).toEqual({ mes, matricula: null, registros: [] });
      }
    });

    it('criterio 31: los registros de un mes no aparecen en otro (el 30/11 es de noviembre y no de diciembre)', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await armarNoviembre(alumno);

      const octubre = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-10'));
      const noviembre = consultaDe(await consultarMes(ctx, cookie(), alumno.alumnoId, '2026-11'));

      expect(octubre.registros).toEqual([]);
      expect(noviembre.registros.length).toBe(4);
    });
  });

  describe.each(['UTC', 'Asia/Tokyo'])('el mes en curso es el de Lima, con el proceso en TZ=%s', (zona) => {
    it('criterio 31: el 30/11 a las 22:00 de Lima (03:00 UTC del 1/12) el mes por defecto sigue siendo 2026-11, y a las 00:00 del 1/12 de Lima ya es 2026-12', async () => {
      process.env['TZ'] = zona;
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);

      const antes = consultaDe(
        await consultarMes(ctx, en(ctx, esc, enLima('2026-11-30', '22:00')).secretaria, alumno.alumnoId),
      );
      const justo = consultaDe(
        await consultarMes(ctx, en(ctx, esc, enLima('2026-11-30', '23:59:59.999')).secretaria, alumno.alumnoId),
      );
      const despues = consultaDe(
        await consultarMes(ctx, en(ctx, esc, enLima('2026-12-01', '00:00:00.000')).secretaria, alumno.alumnoId),
      );

      expect(antes.mes).toBe('2026-11');
      expect(justo.mes).toBe('2026-11');
      expect(despues.mes).toBe('2026-12');
      expect(despues.matricula).toBeNull();
    });
  });

  describe('solo lee', () => {
    it('criterio 31: no escribe ni audita: ni las faltas, ni las asistencias, ni las clases, ni la auditoría cambian', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await armarNoviembre(alumno);
      const antes = await instantaneaDeFaltas(esc.e);
      const auditoriaAntes = await leerAuditoriaDeAcademia(A());

      for (const mes of [undefined, '2026-11', '2026-10']) await consultarMes(ctx, cookie(), alumno.alumnoId, mes);

      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
      expect(await leerAuditoriaDeAcademia(A())).toEqual(auditoriaAntes);
      expect(await leerInasistencias(A())).toHaveLength(2);
    });

    it('criterio 31: no bloquea: con la fila del alumno, la de su matrícula y la de su clase retenidas con FOR UPDATE, la consulta responde sin esperar', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await armarNoviembre(alumno);
      const galleta = cookie();
      const retenedor = await abrirRetenedor(A());
      try {
        await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
          A(),
          alumno.alumnoId,
        ]);
        await retenedor.consultar(
          'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
          [A(), alumno.matriculaId],
        );
        await retenedor.consultar('SELECT id FROM clases WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
          A(),
          esc.e.lunes.id,
        ]);

        const respuesta = await conLimiteCorto(consultarMes(ctx, galleta, alumno.alumnoId, '2026-11'));

        expect(consultaDe(respuesta).registros).toHaveLength(4);
        expect(await retenedor.sesionesEsperando(), 'la consulta no espera ninguna fila').toBe(0);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });
  });
});

/** La respuesta o un error claro si tarda más de 5 segundos (la consulta no debe esperar los bloqueos de otras operaciones). */
async function conLimiteCorto<T>(peticion: Promise<T>): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  const vencida = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(
      () => rechazar(new Error('La consulta del mes esperó una fila retenida: no debe bloquear.')),
      5000,
    );
  });
  try {
    return await Promise.race([peticion, vencida]);
  } finally {
    clearTimeout(temporizador);
  }
}
