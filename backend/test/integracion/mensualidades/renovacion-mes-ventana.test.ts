// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { en } from '../../utilidades/escenario-asistencia';
import type { EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import {
  abrirCajaPara,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  detallesDe,
  DICIEMBRE,
  diaDeLima,
  INSTANTES,
  instantaneaDeRenovacion,
  MES_DICIEMBRE,
  MES_ENERO,
  MES_NOVIEMBRE,
  NOVIEMBRE,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
  resumen,
  sembrarMatriculaDelMes,
  cuantasDelMes,
  matriculaDelMes,
  type Via,
} from '../../utilidades/escenario-renovacion';
import { ejecutarComo } from '../../utilidades/base-datos';
import { enLima } from '../../utilidades/caja';
import type { RespuestaApi } from '../../utilidades/inscripciones';
import { abrirRetenedor, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';

// Criterio 3 (crítico, D-06, DR-2, DR-4): el registro responde 409 `MES_NO_PERMITIDO` con `detalles.mesesPermitidos` si el `mes` pedido no es uno de los permitidos, evaluado con «ahora» después de los bloqueos. Con `RELOJ` fijo, N = 5 y el
// proceso en `TZ=Asia/Tokyo` (y en UTC): diciembre de 2026 no se permite el 25/11 a las 23:59:59.999 de Lima y sí el 26/11 a las 00:00:00.000 y el 30/11 a las 23:59:59.999; el 1/12 a las 00:00:00.000 diciembre ya es M (renovación tardía, con su
// monto proporcional) y enero de 2027 no se permite. Con la mensualidad de diciembre ya pagada o en verificación, pedir diciembre responde 409 `MENSUALIDAD_YA_REGISTRADA`. Un `PATCH /api/configuracion` de `diasPrioridadRenovacion` confirmado vale
// para la siguiente operación, sin reiniciar.
// Lecturas estrictas elegidas: (1) los bordes se prueban con un alumno `ALUMNO_VENCIDO` sin matrícula de noviembre (así `mesesPermitidos` es exactamente M, o M y M+1 dentro de la ventana, en orden cronológico) y con el comprobante de Yape (no depende de la
// caja, que el efectivo exige abierta de hoy); (2) «con su monto proporcional» del 1/12 a las 00:00:00.000 es S/ 120.00 porque desde ese instante quedan las 13 ocurrencias de diciembre (tope 12, DR-3); (3) el 25/11 a las 23:59:59.999 la renovación de
// noviembre (M) se permite y sus clases restantes son las del viernes 27 y el lunes 30 (S/ 20.00); (4) con la mensualidad de diciembre registrada, `MENSUALIDAD_YA_REGISTRADA` gana a todo lo que sigue en el orden del criterio 8 (también al plan y a las
// clases); (5) «ahora» se lee después de tomar los bloqueos: una petición que espera el bloqueo del alumno decide con el reloj de cuando lo obtiene, no con el de cuando llegó.

const ZONA_ORIGINAL = process.env['TZ'];

interface CasoDeVentana {
  nombre: string;
  instante: Date;
  mes: string;
  /** `null` si el mes no se permite. */
  total: string | null;
  mesesPermitidos: string[];
  fechaInicio?: string;
  fechaFin?: string;
}

const CASOS: CasoDeVentana[] = [
  {
    nombre: 'diciembre el 25/11 a las 23:59:59.999 de Lima: todavía no',
    instante: INSTANTES.ultimoAntesDeLaVentana,
    mes: MES_DICIEMBRE,
    total: null,
    mesesPermitidos: [MES_NOVIEMBRE],
  },
  {
    nombre: 'diciembre el 26/11 a las 00:00:00.000 de Lima: ya',
    instante: INSTANTES.primeroDeLaVentana,
    mes: MES_DICIEMBRE,
    total: '120.00',
    mesesPermitidos: [MES_NOVIEMBRE, MES_DICIEMBRE],
    fechaInicio: '2026-12-01',
    fechaFin: '2026-12-31',
  },
  {
    nombre: 'diciembre el 30/11 a las 23:59:59.999 de Lima (ya es 1/12 en UTC): todavía',
    instante: INSTANTES.ultimoDeLaVentana,
    mes: MES_DICIEMBRE,
    total: '120.00',
    mesesPermitidos: [MES_NOVIEMBRE, MES_DICIEMBRE],
    fechaInicio: '2026-12-01',
    fechaFin: '2026-12-31',
  },
  {
    nombre: 'diciembre el 1/12 a las 00:00:00.000 de Lima: ya es M (renovación tardía)',
    instante: INSTANTES.primeroDeDiciembre,
    mes: MES_DICIEMBRE,
    total: '120.00',
    mesesPermitidos: [MES_DICIEMBRE],
    fechaInicio: '2026-12-01',
    fechaFin: '2026-12-31',
  },
  {
    nombre: 'enero de 2027 el 1/12: no',
    instante: INSTANTES.primeroDeDiciembre,
    mes: MES_ENERO,
    total: null,
    mesesPermitidos: [MES_DICIEMBRE],
  },
  {
    nombre: 'enero de 2027 el 30/11 a las 23:59:59.999: no',
    instante: INSTANTES.ultimoDeLaVentana,
    mes: MES_ENERO,
    total: null,
    mesesPermitidos: [MES_NOVIEMBRE, MES_DICIEMBRE],
  },
  {
    nombre: 'noviembre el 1/12 a las 00:00:00.000: ya pasó',
    instante: INSTANTES.primeroDeDiciembre,
    mes: MES_NOVIEMBRE,
    total: null,
    mesesPermitidos: [MES_DICIEMBRE],
  },
  {
    nombre:
      'noviembre el 25/11 a las 23:59:59.999: se permite (renovación tardía de M, clases del viernes 27 y el lunes 30)',
    instante: INSTANTES.ultimoAntesDeLaVentana,
    mes: MES_NOVIEMBRE,
    total: '20.00',
    mesesPermitidos: [MES_NOVIEMBRE],
    fechaInicio: '2026-11-25',
    fechaFin: '2026-11-30',
  },
];

describe.each(['UTC', 'Asia/Tokyo'])(
  'el mes destino y la ventana de renovación (criterio 3) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppCarnet;
    let esc: EscenarioDeAsistencia;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppCarnet();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      esc = await prepararEscenarioDeRenovacion(ctx);
    });
    afterAll(async () => {
      await ctx?.cerrarTodo();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    describe('los bordes de la ventana, con N = 5 (el valor por defecto)', () => {
      it.each(CASOS)('criterio 3: $nombre', async (caso) => {
        const alumno = await crearAlumnoVencido(ctx, esc);
        const cookies = en(ctx, esc, caso.instante);
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
          seleccion: { mes: caso.mes },
          total: caso.total ?? '120.00',
          fechaOperacion: diaDeLima(caso.instante),
        });

        if (caso.total === null) {
          expect(resumen(respuesta), respuesta.texto).toEqual([409, 'MES_NO_PERMITIDO']);
          expect(detallesDe(respuesta)['mesesPermitidos'], 'los meses permitidos, en orden').toEqual(
            caso.mesesPermitidos,
          );
          expect(await instantaneaDeRenovacion(ctx, esc), 'un rechazo no escribe').toBe(antes);
          return;
        }
        const cuerpo = renovacionDe(respuesta, 201);
        expect(cuerpo.renovacion).toMatchObject({
          mes: caso.mes,
          estado: 'EN_VERIFICACION',
          fechaInicio: caso.fechaInicio,
          fechaFin: caso.fechaFin,
          total: caso.total,
        });
        const [anio, mes] = caso.mes.split('-').map(Number) as [number, number];
        expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, { anio, mes })).toMatchObject({
          estado: 'RESERVADA',
          reserva_vence_en: null,
          solicitud_id: null,
          fecha_inicio: caso.fechaInicio,
          fecha_fin: caso.fechaFin,
          monto_calculado: caso.total,
        });
      });

      it('criterio 3: lo mismo con el efectivo: diciembre el 26/11 a las 00:00:00.000 de Lima se cobra con la caja de ese día (201) y el 25/11 a las 23:59:59.999 no (409 MES_NO_PERMITIDO)', async () => {
        const antesDeLaVentana = await crearAlumnoVencido(ctx, esc);
        const enLaVentana = await crearAlumnoVencido(ctx, esc);
        await abrirCajaPara(esc, INSTANTES.primeroDeLaVentana);

        const tarde = en(ctx, esc, INSTANTES.ultimoAntesDeLaVentana);
        const no = await registrarRenovacion(ctx, esc, 'EFECTIVO', tarde.secretaria, antesDeLaVentana.alumnoId);
        const temprano = en(ctx, esc, INSTANTES.primeroDeLaVentana);
        const si = await registrarRenovacion(ctx, esc, 'EFECTIVO', temprano.secretaria, enLaVentana.alumnoId);

        expect(resumen(no.respuesta), no.respuesta.texto).toEqual([409, 'MES_NO_PERMITIDO']);
        expect(renovacionDe(si.respuesta, 201).renovacion).toMatchObject({
          mes: MES_DICIEMBRE,
          estado: 'VIGENTE',
          total: '120.00',
        });
      });

      it('criterio 3: el 1/12 a las 00:00:00.000 de Lima un alumno vencido renueva diciembre en efectivo como M: la matrícula empieza el 1/12 y es de S/ 120.00 (13 ocurrencias, tope 12)', async () => {
        const alumno = await crearAlumnoVencido(ctx, esc);
        await abrirCajaPara(esc, INSTANTES.primeroDeDiciembre);
        const cookies = en(ctx, esc, INSTANTES.primeroDeDiciembre);

        const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId);

        const cuerpo = renovacionDe(respuesta, 201);
        expect(cuerpo.renovacion).toMatchObject({
          mes: MES_DICIEMBRE,
          estado: 'VIGENTE',
          fechaInicio: '2026-12-01',
          fechaFin: '2026-12-31',
          clasesTotales: 12,
          total: '120.00',
        });
        expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toMatchObject({ es_proporcional: false });
      });
    });

    describe('MENSUALIDAD_YA_REGISTRADA', () => {
      const VIAS: Via[] = ['EFECTIVO', 'YAPE'];

      describe.each(VIAS)('por %s', (via) => {
        it.each([
          { estado: 'VIGENTE', descripcion: 'ya pagada' },
          { estado: 'RESERVADA', descripcion: 'en verificación' },
        ] as const)(
          'criterio 3: con la mensualidad de diciembre $descripcion ($estado) pedir diciembre responde 409 MENSUALIDAD_YA_REGISTRADA, también con un plan que no existe, y no escribe',
          async ({ estado }) => {
            const alumno = await crearAlumnoDeNoviembre(ctx, esc);
            await sembrarMatriculaDelMes(
              esc.e.A.id,
              esc.e.plan.id,
              [alumno.alumnoId],
              [esc.e.lunes.id],
              DICIEMBRE,
              estado,
            );
            await abrirCajaPara(esc, INSTANTES.viernes27);
            const cookies = en(ctx, esc, INSTANTES.viernes27);
            const antes = await instantaneaDeRenovacion(ctx, esc);

            const normal = await registrarRenovacion(ctx, esc, via, cookies.secretaria, alumno.alumnoId);
            const planInexistente = await registrarRenovacion(ctx, esc, via, cookies.secretaria, alumno.alumnoId, {
              seleccion: { planId: '00000000-0000-4000-8000-000000000000' },
            });

            expect(resumen(normal.respuesta), normal.respuesta.texto).toEqual([409, 'MENSUALIDAD_YA_REGISTRADA']);
            expect(resumen(planInexistente.respuesta), planInexistente.respuesta.texto).toEqual([
              409,
              'MENSUALIDAD_YA_REGISTRADA',
            ]);
            expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
            expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
          },
        );

        it('criterio 3: una matrícula CANCELADA o FINALIZADA de diciembre no cuenta: se puede renovar', async () => {
          const alumno = await crearAlumnoDeNoviembre(ctx, esc);
          await sembrarMatriculaDelMes(
            esc.e.A.id,
            esc.e.plan.id,
            [alumno.alumnoId],
            [esc.e.lunes.id],
            DICIEMBRE,
            'VIGENTE',
          );
          await abrirCajaPara(esc, INSTANTES.viernes27);
          const cookies = en(ctx, esc, INSTANTES.viernes27);
          await cancelarDiciembre(alumno.alumnoId);

          const { respuesta } = await registrarRenovacion(ctx, esc, via, cookies.secretaria, alumno.alumnoId);

          expect(renovacionDe(respuesta, 201).renovacion.mes).toBe(MES_DICIEMBRE);
          expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(2);
        });
      });

      async function cancelarDiciembre(alumnoId: string): Promise<void> {
        await ejecutarComo(
          'propietario',
          `UPDATE matriculas SET estado = 'CANCELADA' WHERE academia_id = $1::uuid AND alumno_id = $2::uuid AND anio = 2026 AND mes = 12`,
          [esc.e.A.id, alumnoId],
          { academiaId: esc.e.A.id },
        );
      }
    });

    describe('«ahora» se lee después de tomar los bloqueos', () => {
      /** Retiene la fila del alumno, envía la petición con el reloj en `alLlegar`, comprueba que espera y, antes de soltar, pasa el reloj a `alObtener`. */
      async function conRelojQueCambiaMientrasEspera(
        alumnoId: string,
        alLlegar: Date,
        alObtener: Date,
        peticion: () => Promise<RespuestaApi>,
      ) {
        const retenedor = await abrirRetenedor(esc.e.A.id);
        try {
          await retenedor.consultar(
            'SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [esc.e.A.id, alumnoId],
          );
          ctx.reloj.fijar(alLlegar);
          const enviada = observar(peticion());
          const espero = await esperarEspera(
            async () => (await retenedor.sesionesEsperando()) >= 1,
            [enviada],
            'la renovación ni respondió ni quedó esperando la fila del alumno.',
          );
          ctx.reloj.fijar(alObtener);
          await retenedor.liberar('COMMIT');
          const resultado = await conLimite(
            enviada.resultado,
            'la renovación no respondió tras soltar la fila del alumno.',
          );
          return { espero, resultado };
        } finally {
          await retenedor.liberar('ROLLBACK');
        }
      }

      it('criterio 3 y casos límite: una petición de diciembre que llega el 25/11 a las 23:59:59.999 y obtiene el bloqueo el 26/11 a las 00:00:00.000 se decide con el segundo reloj: 201', async () => {
        const alumno = await crearAlumnoVencido(ctx, esc);
        const cookies = en(ctx, esc, INSTANTES.primeroDeLaVentana);

        const { espero, resultado } = await conRelojQueCambiaMientrasEspera(
          alumno.alumnoId,
          INSTANTES.ultimoAntesDeLaVentana,
          INSTANTES.primeroDeLaVentana,
          async () =>
            (
              await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
                fechaOperacion: '2026-11-26',
              })
            ).respuesta,
        );

        expect(espero, 'la renovación debía esperar el bloqueo de la fila del alumno').toBe(true);
        expect(renovacionDe(resultado, 201).renovacion.mes).toBe(MES_DICIEMBRE);
      });

      it('criterio 3 y casos límite: una petición de noviembre que llega el 30/11 a las 23:59:59.999 y obtiene el bloqueo el 1/12 a las 00:00:00.000 ya no es de un mes permitido: 409 MES_NO_PERMITIDO', async () => {
        const alumno = await crearAlumnoVencido(ctx, esc);
        const cookies = en(ctx, esc, INSTANTES.primeroDeDiciembre);
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const { espero, resultado } = await conRelojQueCambiaMientrasEspera(
          alumno.alumnoId,
          INSTANTES.ultimoDeLaVentana,
          INSTANTES.primeroDeDiciembre,
          async () =>
            (
              await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
                seleccion: { mes: MES_NOVIEMBRE },
                total: '20.00',
                fechaOperacion: '2026-11-30',
              })
            ).respuesta,
        );

        expect(espero).toBe(true);
        expect(resumen(resultado), resultado.texto).toEqual([409, 'MES_NO_PERMITIDO']);
        expect(detallesDe(resultado)['mesesPermitidos']).toEqual([MES_DICIEMBRE]);
        expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      });
    });

    describe('diasPrioridadRenovacion cambia sin reiniciar', () => {
      const antesDeLaVentanaDeCinco = enLima('2026-11-21', '10:00');

      it('criterio 3: con N = 5 el 21/11 todavía no se renueva diciembre; después de un PATCH a 10 (ventana desde el 21/11) sí, y de otro PATCH a 3 (ventana desde el 28/11) el 27/11 vuelve a no poder', async () => {
        const primero = await crearAlumnoVencido(ctx, esc);
        const segundo = await crearAlumnoVencido(ctx, esc);
        const tercero = await crearAlumnoVencido(ctx, esc);
        const cookies = en(ctx, esc, antesDeLaVentanaDeCinco);
        const patch = (n: number) =>
          ctx.http.enviar('PATCH', '/api/configuracion', {
            cookie: cookies.admin,
            cuerpo: { diasPrioridadRenovacion: n },
          });

        const conCinco = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, primero.alumnoId, {
          fechaOperacion: '2026-11-21',
        });
        const aDiez = await patch(10);
        const conDiez = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, segundo.alumnoId, {
          fechaOperacion: '2026-11-21',
        });

        expect(resumen(conCinco.respuesta), conCinco.respuesta.texto).toEqual([409, 'MES_NO_PERMITIDO']);
        expect(aDiez.status, aDiez.texto).toBe(200);
        expect(renovacionDe(conDiez.respuesta, 201).renovacion.mes).toBe(MES_DICIEMBRE);

        const tarde = en(ctx, esc, INSTANTES.viernes27);
        const aTres = await ctx.http.enviar('PATCH', '/api/configuracion', {
          cookie: tarde.admin,
          cuerpo: { diasPrioridadRenovacion: 3 },
        });
        const conTres = await registrarRenovacion(ctx, esc, 'YAPE', tarde.secretaria, tercero.alumnoId, {
          fechaOperacion: '2026-11-27',
        });

        expect(aTres.status, aTres.texto).toBe(200);
        expect(resumen(conTres.respuesta), conTres.respuesta.texto).toEqual([409, 'MES_NO_PERMITIDO']);
        expect(detallesDe(conTres.respuesta)['mesesPermitidos']).toEqual([MES_NOVIEMBRE]);
      });
    });

    it('criterio 3: el mes de noviembre sigue siendo un mes permitido solo mientras sea M: el alumno con la mensualidad de noviembre pagada recibe MENSUALIDAD_YA_REGISTRADA al pedirla', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.jueves26);

      const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
        seleccion: { mes: MES_NOVIEMBRE },
        total: '20.00',
        fechaOperacion: '2026-11-26',
      });

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'MENSUALIDAD_YA_REGISTRADA']);
      expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, NOVIEMBRE)).toBe(1);
    });
  },
);
