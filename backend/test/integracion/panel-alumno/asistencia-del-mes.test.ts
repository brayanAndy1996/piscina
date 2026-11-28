// spec: 011-panel-alumno (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  actualizarInasistencia,
  consultaDe,
  consultarMes,
  filaInasistenciaValida,
  insertarInasistencia,
} from '../../utilidades/escenario-faltas';
import {
  camposConError,
  codigoDe,
  pedirCrudo,
  prepararEscenarioDelPanel,
  RUTA_MI_ASISTENCIA,
  rutaMiAsistencia,
} from '../../utilidades/escenario-panel';

// Criterio 12 (crítico, D-08, sección 2.1 «propia», Ley 29733): `GET /api/mi-panel/asistencias?mes=AAAA-MM` (sin `mes`, el mes en curso de Lima) responde 200 con `asistenciaDelMesSchema` (criterio 31 de 009, sin cambios): `mes`, `matricula` (clases totales, usadas y restantes de la matrícula `VIGENTE` o `FINALIZADA` de ese
// mes, o `null`) y `registros` por fecha (cada asistencia con su clase, `horaLlegada`, `estadoLlegada`, `metodo`, `registroPosterior` y `faltaCubierta`; cada falta sin cubrir con su clase). El cuerpo es igual, byte a byte, al de `GET /api/alumnos/{id}/asistencias?mes=` del mismo alumno, el mismo mes y el mismo instante pedido por el
// administrador. Sin DNI, motivo ni quién registró. Un `mes` con otra forma, repetido, anterior a 2000-01 o posterior a M responde 400 `SOLICITUD_INVALIDA` con el campo `mes`; un mes sin datos, 200 con `matricula: null` y `registros: []`.
// Lecturas estrictas elegidas: «byte a byte» es el mismo texto de la respuesta (con el reloj fijo) pedido por el administrador y por la secretaria; un `mes` vacío no se prueba (la spec no lo dice); el mes posterior a M se prueba también en el borde de Lima (30/11 a las 23:59:59.999 y 1/12 a las 00:00:00.000, con el proceso en UTC y en Asia/Tokyo).

const ZONA_ORIGINAL = process.env['TZ'];
const AHORA = enLima('2026-11-24', '10:00:00.000');
const MOTIVO = 'MOTIVO-DEL-REGISTRO-POSTERIOR-ZQ91';

describe('la asistencia del mes que ve el alumno (criterio 12)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelPanel(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc, { dni: '34000001', clasesUsadas: 3 });
    await armarNoviembre();
    en(ctx, esc, AHORA);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });

  const A = () => esc.e.A.id;
  const CLASE_DE_LAS_18 = { horaInicio: '18:00', horaFin: '19:00' };

  async function asistencia(fecha: string, hora: string, sobre: Record<string, unknown> = {}): Promise<string> {
    const llegada = enLima(fecha, hora);
    const columnas = filaAsistenciaValida(
      {
        alumnoId: alumno.alumnoId,
        matriculaId: alumno.matriculaId,
        claseId: esc.e.lunes.id,
        usuarioId: esc.e.secretariaA.id,
      },
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

  async function falta(fecha: string): Promise<string> {
    const columnas = filaInasistenciaValida(
      { alumnoId: alumno.alumnoId, matriculaId: alumno.matriculaId, claseId: esc.e.lunes.id },
      { fecha, registrada_en: enLima(fecha, '19:05') },
    );
    await insertarInasistencia('propietario', A(), columnas);
    return columnas['id'] as string;
  }

  /** Noviembre: una asistencia puntual por QR, una falta sin cubrir, una asistencia tarde posterior que cubre su falta y otra manual. */
  async function armarNoviembre(): Promise<void> {
    await asistencia('2026-11-02', '18:03', { metodo: 'QR' });
    await falta('2026-11-09');
    const faltaDelDia16 = await falta(LUNES);
    const posterior = await asistencia(LUNES, '18:25', {
      metodo: 'MANUAL',
      estado_llegada: 'TARDE',
      registro_posterior: true,
      motivo: MOTIVO,
      registrado_en: enLima(LUNES, '19:30'),
    });
    await actualizarInasistencia('propietario', A(), faltaDelDia16, {
      asistencia_id: posterior,
      cubierta_en: enLima(LUNES, '19:30'),
    });
    await asistencia('2026-11-23', '18:00', { metodo: 'MANUAL' });
  }

  const delPanel = (mes?: string) => pedirCrudo(ctx.app, 'GET', rutaMiAsistencia(mes), { cookie: alumno.cookie });

  describe('el mismo cuerpo, byte a byte, que el de recepción', () => {
    it.each([undefined, '2026-11', '2026-10', '2026-09', '2000-01'])(
      'con el mes %s, el cuerpo es el mismo texto que pide el administrador y que pide la secretaria para ese alumno',
      async (mes) => {
        const galletas = en(ctx, esc, AHORA);

        const propio = await delPanel(mes);
        const deAdmin = await consultarMes(ctx, galletas.admin, alumno.alumnoId, mes);
        const deSecretaria = await consultarMes(ctx, galletas.secretaria, alumno.alumnoId, mes);

        expect(propio.status, propio.texto.slice(0, 300)).toBe(200);
        expect(deAdmin.status).toBe(200);
        expect(propio.texto).toBe(deAdmin.texto);
        expect(propio.texto).toBe(deSecretaria.texto);
      },
    );

    it('el cuerpo trae el mes, las clases de la matrícula y los registros por fecha: cada asistencia con su hora, estado, método, si fue posterior y si cubrió una falta, y cada falta sin cubrir; la falta cubierta solo sale como su asistencia', async () => {
      const consulta = consultaDe(await delPanel('2026-11'));

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

    it('sin ?mes devuelve el mes en curso de Lima (noviembre el 24/11), lo mismo que con el mes explícito', async () => {
      const porDefecto = consultaDe(await delPanel());
      const explicito = consultaDe(await delPanel('2026-11'));

      expect(porDefecto.mes).toBe('2026-11');
      expect(porDefecto).toEqual(explicito);
    });

    it('no lleva el DNI, el motivo del registro posterior, el token del QR, el id de la matrícula ni quién registró', async () => {
      const respuesta = await delPanel('2026-11');

      expect(respuesta.status).toBe(200);
      for (const prohibido of [
        alumno.dni,
        MOTIVO,
        alumno.token,
        alumno.matriculaId,
        alumno.alumnoId,
        alumno.usuarioId,
        esc.e.secretariaA.id,
      ]) {
        expect(respuesta.texto, `no puede salir «${prohibido}»`).not.toContain(prohibido);
      }
    });
  });

  describe('la matrícula del mes', () => {
    it.each(['VIGENTE', 'FINALIZADA'] as const)('con la matrícula %s de ese mes, trae sus clases', async (estado) => {
      await cambiarMatricula(A(), alumno.matriculaId, { estado });

      const consulta = consultaDe(await delPanel('2026-11'));

      expect(consulta.matricula).toEqual({ clasesTotales: 12, clasesUsadas: 3, clasesRestantes: 9 });
    });

    it.each(['RESERVADA', 'CANCELADA'] as const)(
      'con la matrícula %s de ese mes, matricula es null',
      async (estado) => {
        await cambiarMatricula(A(), alumno.matriculaId, { estado });

        const consulta = consultaDe(await delPanel('2026-11'));

        expect(consulta.matricula).toBeNull();
      },
    );

    it('un mes sin datos (octubre, septiembre, el mes más antiguo) responde 200 con matricula null y registros vacíos', async () => {
      for (const mes of ['2026-10', '2026-09', '2000-01']) {
        const consulta = consultaDe(await delPanel(mes));

        expect(consulta, mes).toEqual({ mes, matricula: null, registros: [] });
      }
    });

    it('los registros de un mes no aparecen en otro (el 30/11 es de noviembre y no de diciembre)', async () => {
      const octubre = consultaDe(await delPanel('2026-10'));
      const noviembre = consultaDe(await delPanel('2026-11'));

      expect(octubre.registros).toEqual([]);
      expect(noviembre.registros).toHaveLength(4);
    });
  });

  describe('400 SOLICITUD_INVALIDA con el campo mes', () => {
    it.each([
      '2026-13',
      '2026-00',
      '2026-1',
      '26-11',
      '2026/11',
      '2026-11-01',
      '202611',
      'noviembre',
      '1999-12',
      '10000-01',
      '0999-12',
      '2026-11x',
      '2026-12',
      '2027-01',
      '9999-12',
    ])('el mes «%s» responde 400 SOLICITUD_INVALIDA con el campo mes', async (mes) => {
      const respuesta = await pedirCrudo(ctx.app, 'GET', `${RUTA_MI_ASISTENCIA}?mes=${encodeURIComponent(mes)}`, {
        cookie: alumno.cookie,
      });

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
        400,
        'SOLICITUD_INVALIDA',
      ]);
      expect(camposConError(respuesta)).toEqual(['mes']);
    });

    it('un mes repetido (?mes=2026-11&mes=2026-10) responde 400 SOLICITUD_INVALIDA con el campo mes', async () => {
      const respuesta = await pedirCrudo(ctx.app, 'GET', `${RUTA_MI_ASISTENCIA}?mes=2026-11&mes=2026-10`, {
        cookie: alumno.cookie,
      });

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([400, 'SOLICITUD_INVALIDA']);
      expect(camposConError(respuesta)).toEqual(['mes']);
    });

    it.each(['2000-01', '2026-02', '2026-10', '2026-11'])('el mes «%s» es válido (200)', async (mes) => {
      const respuesta = await delPanel(mes);

      expect(consultaDe(respuesta).mes).toBe(mes);
    });
  });

  describe.each(['UTC', 'Asia/Tokyo'])(
    'el mes posterior al mes en curso, en el borde de Lima, con el proceso en TZ=%s',
    (zona) => {
      it('el 30/11 a las 23:59:59.999 de Lima (04:59 UTC del 1/12) diciembre es posterior (400); el 1/12 a las 00:00:00.000 ya es el mes en curso (200 sin datos)', async () => {
        process.env['TZ'] = zona;
        const consultar = async (instante: Date, mes: string) => {
          en(ctx, esc, instante);
          return pedirCrudo(ctx.app, 'GET', rutaMiAsistencia(mes), { cookie: alumno.cookie });
        };

        const antes = await consultar(enLima('2026-11-30', '23:59:59.999'), '2026-12');
        const justo = await consultar(enLima('2026-12-01', '00:00:00.000'), '2026-12');
        const porDefecto = await consultar(enLima('2026-12-01', '00:00:00.000'), '2026-11');

        expect([antes.status, codigoDe(antes)], antes.texto.slice(0, 200)).toEqual([400, 'SOLICITUD_INVALIDA']);
        expect(camposConError(antes)).toEqual(['mes']);
        expect(consultaDe(justo)).toEqual({ mes: '2026-12', matricula: null, registros: [] });
        expect(consultaDe(porDefecto).registros).toHaveLength(4);
      });
    },
  );
});
