// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { obtenerBaseDatos, type TransaccionAcademiaPrueba } from '../../utilidades/modulos';
import {
  ACCION_SOLICITUD_CREADA,
  type AppInscripciones,
  cargarFuncionalidad005,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  llenarClase,
  type Objeto,
  rutaPublica,
  sembrarSolicitud,
  solicitudDe,
} from '../../utilidades/inscripciones';

// Criterio 54 (crítico, RN-28, DR-1, DR-12, RNF-12; respuesta R1, ronda 1), pruebas de integración con `RELOJ`: la reserva sin pago vence a las
// 24 horas o a las 23:59:59.999 del último día del mes en America/Lima, lo que ocurra primero; ese mismo instante es `matriculas.reserva_vence_en`,
// el `reservaVenceEn` de la respuesta 201, el de `datosDespues` de la auditoría y el de la vista de seguimiento. Un envío el lunes 30 de
// noviembre a las 10:00 de Lima da `2026-12-01T04:59:59.999Z`; uno el domingo 29 a las 10:00 de Lima da `2026-11-30T15:00:00.000Z`.
// Criterio 55 (crítico, RN-11, RN-28, DR-12; criterios 20, 21 y 25): al terminar el mes, la reserva ya no cuenta. Con una solicitud enviada
// el lunes 30 de noviembre a las 10:00 de Lima y `RELOJ` fijo: a) a las 23:59:59.998 ocupa el cupo y la consulta la muestra PENDIENTE_PAGO; a
// las 23:59:59.999 ya no ocupa cupo y la consulta la muestra VENCIDA con la vista reducida; b) el 1 de diciembre a las 00:00 de Lima, un envío
// con el mismo DNI responde 201 (criterio 21 b) y su matrícula es de diciembre; c) con 5 solicitudes activas creadas el 30 desde una conexión,
// un envío a las 23:59:59.998 responde 409 LIMITE_DE_RESERVAS_PENDIENTES y uno el 1 de diciembre a las 00:00, 201; d) con "ahora" en diciembre,
// ninguna matrícula de noviembre cuenta en la ocupación ni en los inscritos. Las mismas pruebas pasan con el proceso en TZ=Asia/Tokyo.

interface ModuloMatriculas {
  contarOcupacion(
    tx: TransaccionAcademiaPrueba,
    claseIds: readonly string[],
    mes: { anio: number; mes: number },
    ahora: Date,
  ): Promise<Map<string, number>>;
  contarInscritos(
    tx: TransaccionAcademiaPrueba,
    claseIds: readonly string[],
    ahora: Date,
  ): Promise<Map<string, number>>;
}

const LUNES_30_A_LAS_10 = new Date('2026-11-30T15:00:00.000Z');
const DOMINGO_29_A_LAS_10 = new Date('2026-11-29T15:00:00.000Z');
const FIN_DE_NOVIEMBRE = '2026-12-01T04:59:59.999Z';
const MS_ANTES_DEL_FIN = new Date('2026-12-01T04:59:59.998Z');
const ULTIMO_MS = new Date('2026-12-01T04:59:59.999Z');
const PRIMER_INSTANTE_DE_DICIEMBRE = new Date('2026-12-01T05:00:00.000Z');
const ZONA_ORIGINAL = process.env['TZ'];

describe.each(['UTC', 'Asia/Tokyo'])(
  'la reserva y el fin de mes (criterios 54 y 55) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppInscripciones;
    let e: EscenarioInscripcion;
    let modulo: ModuloMatriculas;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppInscripciones();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      await exigirTablasDeInscripcion();
      ctx.reloj.fijar(LUNES_30_A_LAS_10);
      e = await crearEscenarioInscripcion();
    });
    afterAll(async () => {
      await ctx?.http.cerrar();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
    const enviarEn = async (ahora: Date, sobre: Objeto = {}, cotizadoEn: Date = ahora) => {
      ctx.reloj.fijar(ahora);
      return enviar(await cuerpoInscripcion(e, { ahora: cotizadoEn, sobre }));
    };
    const consultar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), cuerpo);
    const vista = (respuesta: { body: Objeto | null }): Objeto => respuesta.body?.['solicitud'] as Objeto;
    const cuposDeLunes = async (): Promise<number | undefined> => {
      const lectura = await ctx.http.get(rutaPublica('academia-a', '/inscripcion'));
      return (lectura.body?.['clases'] as { id: string; cuposRestantes: number }[]).find((c) => c.id === e.lunes.id)
        ?.cuposRestantes;
    };
    async function cargarModulo(): Promise<ModuloMatriculas> {
      modulo = await cargarFuncionalidad005<ModuloMatriculas>('modulos/matriculas/index.ts', [
        'contarOcupacion',
        'contarInscritos',
      ]);
      return modulo;
    }
    const ocupacion = async (mes: { anio: number; mes: number }, ahora: Date): Promise<number> => {
      const matriculas = await cargarModulo();
      const base = await obtenerBaseDatos(ctx.app);
      return (
        (await base.conAcademia(e.A.id, (tx) => matriculas.contarOcupacion(tx, [e.lunes.id], mes, ahora))).get(
          e.lunes.id,
        ) ?? 0
      );
    };
    const inscritos = async (ahora: Date): Promise<number> => {
      const matriculas = await cargarModulo();
      const base = await obtenerBaseDatos(ctx.app);
      return (
        (await base.conAcademia(e.A.id, (tx) => matriculas.contarInscritos(tx, [e.lunes.id], ahora))).get(e.lunes.id) ??
        0
      );
    };

    describe('criterio 54: el vencimiento de la reserva guardado y mostrado', () => {
      it('criterio 54: un envío el lunes 30 de noviembre a las 10:00 de Lima responde 201 con reservaVenceEn 2026-12-01T04:59:59.999Z, el mismo valor en la matrícula, la auditoría y la consulta de seguimiento', async () => {
        const respuesta = await enviarEn(LUNES_30_A_LAS_10);

        expect(respuesta.status, respuesta.texto).toBe(201);
        const solicitud = solicitudDe(respuesta);
        expect(solicitud.reservaVenceEn, 'la respuesta, en ISO con milisegundos').toBe(FIN_DE_NOVIEMBRE);
        const [matricula] = await leerMatriculas(e.A.id);
        expect(matricula?.reserva_vence_en?.toISOString(), 'la matrícula').toBe(FIN_DE_NOVIEMBRE);
        const [auditoria] = await leerAuditoriaDeAcademia(e.A.id, ACCION_SOLICITUD_CREADA);
        expect((auditoria?.datos_despues as Objeto)['reservaVenceEn'], 'la auditoría').toBe(FIN_DE_NOVIEMBRE);
        const porToken = vista(await consultar({ token: solicitud.token }));
        expect(porToken['estado']).toBe('PENDIENTE_PAGO');
        expect(porToken['reservaVenceEn'], 'la consulta por token').toBe(FIN_DE_NOVIEMBRE);
        const [alumno] = await leerAlumnos(e.A.id);
        const porCodigo = vista(await consultar({ codigo: solicitud.codigo, dni: alumno?.dni }));
        expect(porCodigo['reservaVenceEn'], 'la consulta por código y DNI').toBe(FIN_DE_NOVIEMBRE);
      });

      it('criterio 54: un envío el domingo 29 de noviembre a las 10:00 de Lima da 2026-11-30T15:00:00.000Z (alcanzan las 24 horas) en la respuesta, la matrícula, la auditoría y la consulta', async () => {
        const respuesta = await enviarEn(DOMINGO_29_A_LAS_10);

        expect(respuesta.status, respuesta.texto).toBe(201);
        const solicitud = solicitudDe(respuesta);
        expect(solicitud.reservaVenceEn).toBe('2026-11-30T15:00:00.000Z');
        const [matricula] = await leerMatriculas(e.A.id);
        expect(matricula?.reserva_vence_en?.toISOString()).toBe('2026-11-30T15:00:00.000Z');
        const [auditoria] = await leerAuditoriaDeAcademia(e.A.id, ACCION_SOLICITUD_CREADA);
        expect((auditoria?.datos_despues as Objeto)['reservaVenceEn']).toBe('2026-11-30T15:00:00.000Z');
        expect(vista(await consultar({ token: solicitud.token }))['reservaVenceEn']).toBe('2026-11-30T15:00:00.000Z');
      });
    });

    describe('criterio 55: al terminar el mes, la reserva ya no cuenta', () => {
      it('criterio 55 a: a las 23:59:59.998 del 30 la reserva ocupa el cupo de noviembre y la consulta la muestra PENDIENTE_PAGO con reservaVenceEn; a las 23:59:59.999 ya no ocupa cupo (cupos restantes, contarOcupacion y contarInscritos) y la consulta la muestra VENCIDA con la vista reducida', async () => {
        const solicitud = solicitudDe(await enviarEn(LUNES_30_A_LAS_10));
        const [alumno] = await leerAlumnos(e.A.id);

        ctx.reloj.fijar(MS_ANTES_DEL_FIN);
        expect(await cuposDeLunes(), 'cupos restantes un milisegundo antes').toBe(19);
        expect(await ocupacion({ anio: 2026, mes: 11 }, MS_ANTES_DEL_FIN), 'contarOcupacion').toBe(1);
        expect(await inscritos(MS_ANTES_DEL_FIN), 'contarInscritos').toBe(1);
        const antes = vista(await consultar({ token: solicitud.token }));
        expect(antes['estado']).toBe('PENDIENTE_PAGO');
        expect(antes['reservaVenceEn']).toBe(FIN_DE_NOVIEMBRE);

        ctx.reloj.fijar(ULTIMO_MS);
        expect(await cuposDeLunes(), 'cupos restantes en el último milisegundo del mes').toBe(20);
        expect(await ocupacion({ anio: 2026, mes: 11 }, ULTIMO_MS), 'contarOcupacion').toBe(0);
        expect(await inscritos(ULTIMO_MS), 'contarInscritos').toBe(0);
        const despuesPorToken = await consultar({ token: solicitud.token });
        const despuesPorCodigo = await consultar({ codigo: solicitud.codigo, dni: alumno?.dni });
        expect(vista(despuesPorToken)['estado']).toBe('VENCIDA');
        expect(Object.keys(vista(despuesPorToken)).sort(), 'vista reducida').toEqual([
          'clases',
          'clasesTotales',
          'codigo',
          'creadaEn',
          'esProporcional',
          'estado',
          'mes',
          'monto',
          'plan',
        ]);
        expect(despuesPorCodigo.body).toEqual(despuesPorToken.body);
      });

      it('criterio 55 b: el martes 1 de diciembre a las 00:00 de Lima, un envío con el mismo DNI responde 201 (no DNI_YA_REGISTRADO): la solicitud de noviembre pasa a VENCIDA, su matrícula a CANCELADA y la nueva matrícula es de diciembre con su propio vencimiento', async () => {
        await enviarEn(LUNES_30_A_LAS_10);
        const [alumno] = await leerAlumnos(e.A.id);

        const respuesta = await enviarEn(PRIMER_INSTANTE_DE_DICIEMBRE, { alumno: { dni: alumno?.dni } });

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(solicitudDe(respuesta).reservaVenceEn).toBe('2026-12-02T05:00:00.000Z');
        const solicitudes = await leerSolicitudes(e.A.id);
        expect(solicitudes.map((s) => s.estado).sort()).toEqual(['PENDIENTE_PAGO', 'VENCIDA']);
        const matriculas = await leerMatriculas(e.A.id);
        const [noviembre] = matriculas.filter((m) => m.mes === 11);
        const [diciembre] = matriculas.filter((m) => m.mes === 12);
        expect(noviembre).toMatchObject({ anio: 2026, estado: 'CANCELADA', reserva_vence_en: null });
        expect(diciembre).toMatchObject({ anio: 2026, estado: 'RESERVADA' });
        expect(diciembre?.reserva_vence_en?.toISOString()).toBe('2026-12-02T05:00:00.000Z');
        expect(await leerAlumnos(e.A.id)).toHaveLength(1);
      });

      it('criterio 55 c: con 5 solicitudes activas creadas el 30 desde una conexión, un envío a las 23:59:59.998 del 30 responde 409 LIMITE_DE_RESERVAS_PENDIENTES y uno el 1 de diciembre a las 00:00 responde 201 (las 5 ya vencieron)', async () => {
        for (let i = 0; i < 5; i++) {
          const creada = await enviarEn(LUNES_30_A_LAS_10);
          expect(creada.status, `reserva ${i + 1}: ${creada.texto}`).toBe(201);
        }

        const sexta = await enviarEn(MS_ANTES_DEL_FIN, {}, LUNES_30_A_LAS_10);
        expect([sexta.status, codigoDe(sexta)], sexta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);

        const enDiciembre = await enviarEn(PRIMER_INSTANTE_DE_DICIEMBRE);
        expect(enDiciembre.status, enDiciembre.texto).toBe(201);
      });

      it('criterio 55 d: con "ahora" en diciembre, ninguna matrícula de noviembre cuenta en la ocupación ni en los inscritos de ninguna clase', async () => {
        const fin = new Date(FIN_DE_NOVIEMBRE);
        const noviembre = { anio: 2026, mes: 11 };
        await sembrarSolicitud(e.A.id, {
          planId: e.plan.id,
          claseIds: [e.lunes.id],
          ahora: LUNES_30_A_LAS_10,
          mes: noviembre,
          reservaVenceEn: fin,
        });
        await sembrarSolicitud(e.A.id, {
          planId: e.plan.id,
          claseIds: [e.lunes.id],
          ahora: LUNES_30_A_LAS_10,
          mes: noviembre,
          reservaVenceEn: null,
        });
        await llenarClase(e.A.id, e.lunes.id, e.plan.id, 3, { mes: noviembre, estado: 'VIGENTE' });

        ctx.reloj.fijar(PRIMER_INSTANTE_DE_DICIEMBRE);
        expect(await ocupacion({ anio: 2026, mes: 12 }, PRIMER_INSTANTE_DE_DICIEMBRE)).toBe(0);
        expect(await inscritos(PRIMER_INSTANTE_DE_DICIEMBRE)).toBe(0);
        expect(await cuposDeLunes()).toBe(20);
      });
    });
  },
);
