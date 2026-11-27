// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asistenciasDe,
  clasesUsadasDe,
  en,
  enLima,
  type EscenarioDeAsistencia,
  LUNES,
  marcar,
  PRIMERO_DE_DICIEMBRE,
  rechazoDe,
  resultadoDe,
  ULTIMO_LUNES_DE_NOVIEMBRE,
  type Via as ViaDeMarcado,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { rutaAprobacion } from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  DICIEMBRE,
  INSTANTES,
  matriculaDelMes,
  MES_DICIEMBRE,
  MES_NOVIEMBRE,
  NOVIEMBRE,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
} from '../../utilidades/escenario-renovacion';
import { crearPlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 16 (crítico, RN-15, DR-3 de 009): un alumno sin matrícula de M y con su renovación de M en verificación recibe 409 `PAGO_EN_VERIFICACION` (roja) al marcar (criterio 7 f de 009, DR-3 de 009); al aprobarla, marca y descuenta de esa matrícula. Un alumno que renovó
// diciembre por Yape el 28/11 sin verificar recibe lo mismo el 1/12. Una renovación de diciembre no deja marcar en noviembre, y sus clases de diciembre no cuentan en noviembre.
// Lecturas estrictas elegidas: (1) la renovación de M es la tardía del lunes 16/11 a las 17:00 (quedan 7 clases de las 18:00 del mes: S/ 70.00) y el marcado, a las 18:05 por las dos vías (QR y manual); (2) «el 1/12» se prueba con un plan de los martes (el 1/12 de 2026 es
// martes) y la clase de los martes a las 08:00, porque el plan de los lunes, miércoles y viernes no tiene clase ese día; (3) «no deja marcar en noviembre» es `MENSUALIDAD_NO_VIGENTE` (roja): ni la renovación en verificación ni la vigente de diciembre son la mensualidad del 30/11,
// y no responde `PAGO_EN_VERIFICACION`; (4) «sus clases de diciembre no cuentan en noviembre» es que el marcado del 30/11 de un alumno con las dos mensualidades descuenta de la de noviembre y la de diciembre queda en 0 usadas.

const VIAS_DE_MARCADO: ViaDeMarcado[] = ['QR', 'MANUAL'];

describe('la asistencia con una renovación (criterio 16)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  describe('una renovación de M en verificación', () => {
    it.each(VIAS_DE_MARCADO)(
      'criterio 16: por %s, un alumno sin matrícula de noviembre con su renovación por Yape en verificación recibe 409 PAGO_EN_VERIFICACION (roja) al marcar; al aprobarla, marca (201) y descuenta de esa matrícula',
      async (via) => {
        const alumno = await crearAlumnoVencido(ctx, esc);
        const tardia = en(ctx, esc, enLima(LUNES, '17:00'));
        const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', tardia.secretaria, alumno.alumnoId, {
          seleccion: { mes: MES_NOVIEMBRE },
          total: '70.00',
          fechaOperacion: LUNES,
        });
        const renovacion = renovacionDe(respuesta, 201);
        expect(renovacion.renovacion).toMatchObject({ estado: 'EN_VERIFICACION', clasesTotales: 7, total: '70.00' });
        const alMarcar = en(ctx, esc, enLima(LUNES, '18:05'));

        const antes = await marcar(ctx, via, alMarcar.secretaria, alumno);

        const rechazo = rechazoDe(antes, 'PAGO_EN_VERIFICACION', 'ROJA');
        expect(rechazo.alumno.id).toBe(alumno.alumnoId);
        expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toEqual([]);
        expect(await clasesUsadasDe(esc.e.A.id, renovacion.renovacion.matriculaId)).toBe(0);

        await abrirCajaPara(esc, enLima(LUNES, '18:06'));
        const aprobacion = await ctx.http.post(
          rutaAprobacion(renovacion.pago.id),
          {},
          { cookie: en(ctx, esc, enLima(LUNES, '18:06')).secretaria },
        );
        expect(aprobacion.status, aprobacion.texto).toBe(200);
        const despues = await marcar(ctx, via, en(ctx, esc, enLima(LUNES, '18:07')).secretaria, alumno);

        const resultado = resultadoDe(despues, 201);
        expect(resultado.clases).toEqual({ usadas: 1, totales: 7, restantes: 6 });
        const [fila] = await asistenciasDe(esc.e.A.id, alumno.alumnoId);
        expect(fila).toMatchObject({
          matricula_id: renovacion.renovacion.matriculaId,
          fecha: LUNES,
          clase_id: esc.e.lunes.id,
        });
        expect(await clasesUsadasDe(esc.e.A.id, renovacion.renovacion.matriculaId)).toBe(1);
      },
    );

    it('criterio 16: si la renovación de M se rechaza, el marcado responde MENSUALIDAD_NO_VIGENTE (no PAGO_EN_VERIFICACION) y no descuenta nada', async () => {
      const alumno = await crearAlumnoVencido(ctx, esc);
      const tardia = en(ctx, esc, enLima(LUNES, '17:00'));
      const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', tardia.secretaria, alumno.alumnoId, {
        seleccion: { mes: MES_NOVIEMBRE },
        total: '70.00',
        fechaOperacion: LUNES,
      });
      const renovacion = renovacionDe(respuesta, 201);
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;
      const rechazo = await ctx.http.post(
        `/api/pagos/${renovacion.pago.id}/rechazo`,
        { motivo: 'La imagen no se lee' },
        { cookie },
      );
      expect(rechazo.status, rechazo.texto).toBe(200);

      const marcado = await marcar(ctx, 'MANUAL', cookie, alumno);

      rechazoDe(marcado, 'MENSUALIDAD_NO_VIGENTE', 'ROJA');
      expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toEqual([]);
    });
  });

  describe('una renovación de diciembre', () => {
    it('criterio 16: un alumno que renovó diciembre por Yape el 28/11 sin verificar y marca el martes 1/12 a las 08:05 (plan de los martes) recibe 409 PAGO_EN_VERIFICACION; al aprobarla, marca y descuenta de la matrícula de diciembre', async () => {
      const planMartes = await crearPlanDePrueba(esc.e.A.id, {
        nombre: 'Plan de los martes',
        veces_por_semana: 1,
        clases_por_mes: 4,
        precio: '40.00',
        dias_permitidos: [2],
        franjas_permitidas: ['08:00'],
        niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
      });
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const sabado = en(ctx, esc, INSTANTES.sabado28);
      const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', sabado.secretaria, alumno.alumnoId, {
        seleccion: { planId: planMartes.id, claseIds: [esc.martes08.id] },
        total: '40.00',
        fechaOperacion: '2026-11-28',
      });
      const renovacion = renovacionDe(respuesta, 201);
      expect(renovacion.renovacion).toMatchObject({
        mes: MES_DICIEMBRE,
        estado: 'EN_VERIFICACION',
        fechaInicio: PRIMERO_DE_DICIEMBRE,
      });
      const instante = enLima(PRIMERO_DE_DICIEMBRE, '08:05');
      const cookies = en(ctx, esc, instante);

      const antes = await marcar(ctx, 'QR', cookies.secretaria, alumno);

      rechazoDe(antes, 'PAGO_EN_VERIFICACION', 'ROJA');
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId), 'la de noviembre (ya terminó) no descuenta').toBe(0);

      await abrirCajaPara(esc, instante);
      const aprobacion = await ctx.http.post(rutaAprobacion(renovacion.pago.id), {}, { cookie: cookies.secretaria });
      expect(aprobacion.status, aprobacion.texto).toBe(200);
      const despues = await marcar(ctx, 'QR', cookies.secretaria, alumno);

      const resultado = resultadoDe(despues, 201);
      expect(resultado.asistencia).toMatchObject({ fecha: PRIMERO_DE_DICIEMBRE, horaLlegada: '08:05' });
      expect(resultado.clases).toEqual({ usadas: 1, totales: 4, restantes: 3 });
      expect(await clasesUsadasDe(esc.e.A.id, renovacion.renovacion.matriculaId)).toBe(1);
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(0);
    });

    it.each([
      ['en verificación (Yape)', 'YAPE' as const],
      ['vigente (efectivo)', 'EFECTIVO' as const],
    ])(
      'criterio 16: la renovación de diciembre %s no deja marcar en noviembre a un alumno sin la mensualidad de noviembre: el lunes 30/11 a las 18:05 responde MENSUALIDAD_NO_VIGENTE y no descuenta nada',
      async (_nombre, via) => {
        const alumno = await crearAlumnoVencido(ctx, esc);
        await abrirCajaPara(esc, INSTANTES.sabado28);
        const sabado = en(ctx, esc, INSTANTES.sabado28);
        const { respuesta } = await registrarRenovacion(ctx, esc, via, sabado.secretaria, alumno.alumnoId, {
          fechaOperacion: '2026-11-28',
        });
        const renovacion = renovacionDe(respuesta, 201);
        const lunes = en(ctx, esc, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '18:05'));

        const marcado = await marcar(ctx, 'MANUAL', lunes.secretaria, alumno);

        rechazoDe(marcado, 'MENSUALIDAD_NO_VIGENTE', 'ROJA');
        expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toEqual([]);
        expect(await clasesUsadasDe(esc.e.A.id, renovacion.renovacion.matriculaId)).toBe(0);
      },
    );

    it.each(VIAS_DE_MARCADO)(
      'criterio 16: por %s, con las dos mensualidades (noviembre vigente y diciembre renovada y vigente) el marcado del lunes 30/11 descuenta de la de noviembre y la de diciembre queda con 0 usadas',
      async (via) => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        await abrirCajaPara(esc, INSTANTES.sabado28);
        const sabado = en(ctx, esc, INSTANTES.sabado28);
        const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', sabado.secretaria, alumno.alumnoId);
        const renovacion = renovacionDe(respuesta, 201);
        const lunes = en(ctx, esc, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '18:05'));

        const marcado = await marcar(ctx, via, lunes.secretaria, alumno);

        const resultado = resultadoDe(marcado, 201);
        expect(resultado.clases).toEqual({ usadas: 1, totales: 12, restantes: 11 });
        expect(resultado.asistencia.fecha).toBe(ULTIMO_LUNES_DE_NOVIEMBRE);
        expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
        expect(await clasesUsadasDe(esc.e.A.id, renovacion.renovacion.matriculaId)).toBe(0);
        expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toMatchObject({
          estado: 'VIGENTE',
          clases_usadas: 0,
        });
        expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, NOVIEMBRE)).toMatchObject({ clases_usadas: 1 });
      },
    );

    it('criterio 16: con la renovación de diciembre en verificación y la de noviembre vigente, el marcado del 30/11 sigue siendo de noviembre (201) y el de la primera clase de diciembre (miércoles 2/12 a las 18:05) responde PAGO_EN_VERIFICACION hasta que se apruebe', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const sabado = en(ctx, esc, INSTANTES.sabado28);
      const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', sabado.secretaria, alumno.alumnoId, {
        fechaOperacion: '2026-11-28',
      });
      const renovacion = renovacionDe(respuesta, 201);
      const lunes = en(ctx, esc, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '18:05'));
      const deNoviembre = await marcar(ctx, 'MANUAL', lunes.secretaria, alumno);
      expect(deNoviembre.status, deNoviembre.texto).toBe(201);

      const miercolesDeDiciembre = en(ctx, esc, enLima('2026-12-02', '18:05'));
      const enVerificacion = await marcar(ctx, 'MANUAL', miercolesDeDiciembre.secretaria, alumno);

      rechazoDe(enVerificacion, 'PAGO_EN_VERIFICACION', 'ROJA');
      expect(await clasesUsadasDe(esc.e.A.id, renovacion.renovacion.matriculaId)).toBe(0);
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
    });
  });
});
