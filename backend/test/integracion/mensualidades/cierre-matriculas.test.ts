// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clasesUsadasDe,
  codigoDeRespuesta,
  en,
  type EscenarioDeAsistencia,
  enLima,
  marcarManual,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoConMatriculas,
  DICIEMBRE,
  ejecutarCierre,
  estadoDeLaMatricula,
  estadoDelAlumno,
  instantaneaDelCierre,
  matriculasPorMes,
  NOVIEMBRE,
  OCTUBRE,
  prepararEscenarioDeCierre,
  sembrarAlumno,
  vigilarCierre,
} from '../../utilidades/escenario-cierre';

// Criterio 27 (crítico, RN-23, 8.8, D-23, D-10), la parte de lo que el cierre hace en cada academia: toda matrícula `VIGENTE` de un mes anterior a M pasa a `FINALIZADA` (sus clases no usadas se pierden: `clases_totales − clases_usadas` queda como registro y ya
// no sirven para marcar); todo alumno `ALUMNO_ACTIVO` sin matrícula `VIGENTE` de M pasa a `ALUMNO_VENCIDO`, y todo `ALUMNO_VENCIDO` con matrícula `VIGENTE` de M pasa a `ALUMNO_ACTIVO` (8.8, 4.5); `CLIENTE` e `INACTIVO` no cambian. Escribe con sentencias de
// muchas filas, sin bucles de escrituras. Volver a correrla no cambia nada.
// `CierreDeMesService.cerrar(ahora)` se llama directamente con un instante fijo (con `TAREAS_PROGRAMADAS` apagada en las pruebas): las matrículas y los alumnos se siembran como dueño de las tablas, sin cuenta ni QR, porque el cierre solo mira los estados.
// Lecturas estrictas elegidas: (1) «`clases_totales − clases_usadas` queda como registro» se lee como que las dos columnas conservan su valor al finalizar (nada se pone en cero ni se resta); (2) la matrícula `FINALIZADA` de un alumno `INACTIVO` también se
// finaliza (la regla de las matrículas no mira al alumno) y su estado no cambia; (3) solo las matrículas `VIGENTE` se finalizan: una `RESERVADA` (un Yape en verificación) o una `CANCELADA`, de cualquier mes, no cambian; (4) «sin matrícula `VIGENTE` de M» es
// literal: un alumno `ALUMNO_ACTIVO` cuya única matrícula de M está en verificación (`RESERVADA`) o `CANCELADA` pasa a `ALUMNO_VENCIDO` hasta que se apruebe su pago (la aprobación lo vuelve `ALUMNO_ACTIVO`, criterio 15); (5) la regla de los alumnos corre en
// cada vuelta, no solo el día 1 (una vuelta del 15/11 deja `ALUMNO_ACTIVO` al vencido con matrícula `VIGENTE` de noviembre); (6) «sentencias de muchas filas»: como mucho dos `UPDATE` por tabla y academia en una vuelta con muchos alumnos que cambian (un bucle de
// escrituras daría tantas como alumnos).

const PRIMERO_DE_DICIEMBRE = enLima('2026-12-01', '00:00:00.000');

describe('lo que el cierre de mes hace en una academia (criterio 27)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeCierre(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const sembrar = (
    estado: Parameters<typeof sembrarAlumno>[1]['estado'],
    matriculas: Parameters<typeof sembrarAlumno>[1]['matriculas'],
  ): Promise<AlumnoConMatriculas> => sembrarAlumno(esc, { estado, matriculas });

  /** Un alumno de cada caso del criterio, todos de A. */
  async function sembrarMatriz() {
    return {
      sinRenovar: await sembrar('ALUMNO_ACTIVO', [
        { mes: NOVIEMBRE, estado: 'VIGENTE', clasesTotales: 12, clasesUsadas: 5 },
      ]),
      sinRenovarCompleto: await sembrar('ALUMNO_ACTIVO', [
        { mes: NOVIEMBRE, estado: 'VIGENTE', clasesTotales: 12, clasesUsadas: 12 },
      ]),
      renovo: await sembrar('ALUMNO_ACTIVO', [
        { mes: NOVIEMBRE, estado: 'VIGENTE', clasesTotales: 12, clasesUsadas: 7 },
        { mes: DICIEMBRE, estado: 'VIGENTE' },
      ]),
      vencidoQuePago: await sembrar('ALUMNO_VENCIDO', [
        { mes: OCTUBRE, estado: 'FINALIZADA', clasesTotales: 12, clasesUsadas: 12 },
        { mes: DICIEMBRE, estado: 'VIGENTE' },
      ]),
      vencidoQueSigue: await sembrar('ALUMNO_VENCIDO', [
        { mes: OCTUBRE, estado: 'FINALIZADA', clasesTotales: 12, clasesUsadas: 12 },
      ]),
      cliente: await sembrar('CLIENTE', [{ mes: NOVIEMBRE, estado: 'RESERVADA' }]),
      inactivo: await sembrar('INACTIVO', [{ mes: NOVIEMBRE, estado: 'VIGENTE', clasesTotales: 12, clasesUsadas: 3 }]),
      conRenovacionEnVerificacion: await sembrar('ALUMNO_ACTIVO', [
        { mes: NOVIEMBRE, estado: 'VIGENTE', clasesTotales: 12, clasesUsadas: 9 },
        { mes: DICIEMBRE, estado: 'RESERVADA' },
      ]),
      conRenovacionCancelada: await sembrar('ALUMNO_ACTIVO', [
        { mes: NOVIEMBRE, estado: 'VIGENTE', clasesTotales: 12, clasesUsadas: 1 },
        { mes: DICIEMBRE, estado: 'CANCELADA' },
      ]),
      deUnMesAntiguo: await sembrar('ALUMNO_ACTIVO', [
        { mes: OCTUBRE, estado: 'VIGENTE', clasesTotales: 12, clasesUsadas: 2 },
      ]),
    };
  }
  type Matriz = Awaited<ReturnType<typeof sembrarMatriz>>;

  describe('el 1/12 a las 00:00 de Lima', () => {
    let matriz: Matriz;
    beforeEach(async () => {
      matriz = await sembrarMatriz();
    });

    it.each<[string, keyof Matriz, Record<string, [string, number?, number?]>]>([
      [
        'la de noviembre sin renovar se finaliza y conserva sus clases (12 totales, 5 usadas)',
        'sinRenovar',
        { '2026-11': ['FINALIZADA', 12, 5] },
      ],
      [
        'la de noviembre con las 12 clases usadas se finaliza (no pierde nada)',
        'sinRenovarCompleto',
        { '2026-11': ['FINALIZADA', 12, 12] },
      ],
      [
        'la de noviembre de quien renovó se finaliza y la de diciembre sigue VIGENTE',
        'renovo',
        { '2026-11': ['FINALIZADA', 12, 7], '2026-12': ['VIGENTE', 12, 0] },
      ],
      [
        'la de octubre (FINALIZADA) y la de diciembre (VIGENTE) del vencido que pagó no cambian',
        'vencidoQuePago',
        { '2026-10': ['FINALIZADA'], '2026-12': ['VIGENTE'] },
      ],
      [
        'la RESERVADA de noviembre de un cliente (un Yape en verificación) no se finaliza',
        'cliente',
        { '2026-11': ['RESERVADA'] },
      ],
      [
        'la VIGENTE de noviembre de un alumno INACTIVO también se finaliza',
        'inactivo',
        { '2026-11': ['FINALIZADA', 12, 3] },
      ],
      [
        'la de diciembre en verificación (RESERVADA) no se toca y la de noviembre se finaliza',
        'conRenovacionEnVerificacion',
        { '2026-11': ['FINALIZADA', 12, 9], '2026-12': ['RESERVADA'] },
      ],
      [
        'la de diciembre CANCELADA no se toca y la de noviembre se finaliza',
        'conRenovacionCancelada',
        { '2026-11': ['FINALIZADA', 12, 1], '2026-12': ['CANCELADA'] },
      ],
      [
        'una VIGENTE de un mes más antiguo que nadie cerró (octubre) también se finaliza',
        'deUnMesAntiguo',
        { '2026-10': ['FINALIZADA', 12, 2] },
      ],
    ])('criterio 27: %s', async (_nombre, quien, esperadas) => {
      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

      const alumno = matriz[quien];
      const matriculas = await matriculasPorMes(alumno.academiaId, alumno.alumnoId);
      for (const [mes, [estado, totales, usadas]] of Object.entries(esperadas)) {
        expect(matriculas[mes]?.estado, `la matrícula de ${mes}`).toBe(estado);
        if (totales !== undefined) expect(matriculas[mes]?.clasesTotales, `clases_totales de ${mes}`).toBe(totales);
        if (usadas !== undefined) expect(matriculas[mes]?.clasesUsadas, `clases_usadas de ${mes}`).toBe(usadas);
      }
      expect(Object.keys(matriculas).sort(), 'no se crea ni se borra ninguna matrícula').toEqual(
        Object.keys(esperadas).sort(),
      );
    });

    it.each<[string, keyof Matriz, string]>([
      ['ALUMNO_ACTIVO sin matrícula VIGENTE de diciembre pasa a ALUMNO_VENCIDO', 'sinRenovar', 'ALUMNO_VENCIDO'],
      [
        'ALUMNO_ACTIVO con las 12 clases usadas y sin diciembre pasa a ALUMNO_VENCIDO',
        'sinRenovarCompleto',
        'ALUMNO_VENCIDO',
      ],
      ['ALUMNO_ACTIVO con la matrícula VIGENTE de diciembre sigue ALUMNO_ACTIVO', 'renovo', 'ALUMNO_ACTIVO'],
      ['ALUMNO_VENCIDO con la matrícula VIGENTE de diciembre pasa a ALUMNO_ACTIVO', 'vencidoQuePago', 'ALUMNO_ACTIVO'],
      ['ALUMNO_VENCIDO sin diciembre sigue ALUMNO_VENCIDO', 'vencidoQueSigue', 'ALUMNO_VENCIDO'],
      ['CLIENTE no cambia', 'cliente', 'CLIENTE'],
      ['INACTIVO no cambia (aunque su matrícula se finalice)', 'inactivo', 'INACTIVO'],
      [
        'ALUMNO_ACTIVO cuya renovación de diciembre está en verificación (sin matrícula VIGENTE de M) pasa a ALUMNO_VENCIDO hasta que se apruebe',
        'conRenovacionEnVerificacion',
        'ALUMNO_VENCIDO',
      ],
      [
        'ALUMNO_ACTIVO cuya renovación de diciembre está CANCELADA pasa a ALUMNO_VENCIDO',
        'conRenovacionCancelada',
        'ALUMNO_VENCIDO',
      ],
      [
        'ALUMNO_ACTIVO con una matrícula VIGENTE de octubre y nada de diciembre pasa a ALUMNO_VENCIDO',
        'deUnMesAntiguo',
        'ALUMNO_VENCIDO',
      ],
    ])('criterio 27: %s', async (_nombre, quien, esperado) => {
      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

      const alumno = matriz[quien];
      expect(await estadoDelAlumno(alumno.academiaId, alumno.alumnoId)).toBe(esperado);
    });

    it('criterio 27: volver a correrla no cambia nada (ni los estados ni las fechas de actualización), en la misma vuelta, 15 minutos después y días después', async () => {
      const antes = await instantaneaDelCierre(esc);
      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);
      const despuesDeLaPrimera = await instantaneaDelCierre(esc);
      expect(despuesDeLaPrimera, 'la primera vuelta sí cambió algo').not.toBe(antes);

      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);
      await ejecutarCierre(ctx, enLima('2026-12-01', '00:15:00.000'));
      await ejecutarCierre(ctx, enLima('2026-12-05', '10:00'));

      expect(await instantaneaDelCierre(esc)).toBe(despuesDeLaPrimera);
    });

    it('criterio 27: escribe con sentencias de muchas filas: con diez alumnos y siete matrículas que cambian, como mucho dos UPDATE de matriculas y dos de alumnos, y todos con el contexto de la academia', async () => {
      const vigilancia = await vigilarCierre();
      try {
        await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);

        const sentencias = await vigilancia.sentencias();
        const deA = sentencias.filter((sentencia) => sentencia.academia === A());
        expect(
          sentencias.filter((sentencia) => sentencia.academia !== A() && sentencia.academia !== esc.e.B.id),
          'ninguna escritura fuera del contexto de una academia',
        ).toEqual([]);
        expect(
          deA.filter((sentencia) => sentencia.tabla === 'matriculas').length,
          'UPDATE de matriculas',
        ).toBeLessThanOrEqual(2);
        expect(
          deA.filter((sentencia) => sentencia.tabla === 'alumnos').length,
          'UPDATE de alumnos',
        ).toBeLessThanOrEqual(2);
        // Sí cambió algo: el bucle no se esconde detrás de «no hubo trabajo».
        expect(await estadoDeLaMatricula(A(), matriz.sinRenovar.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
        expect(await estadoDelAlumno(A(), matriz.sinRenovar.alumnoId)).toBe('ALUMNO_VENCIDO');
      } finally {
        await vigilancia.quitar();
      }
    });

    it('criterio 27: las clases no usadas se pierden: el alumno cuya matrícula de noviembre se finalizó con 7 clases sin usar no marca más con ella (MENSUALIDAD_NO_VIGENTE) y sus clases usadas no cambian', async () => {
      await ejecutarCierre(ctx, PRIMERO_DE_DICIEMBRE);
      const cookie = en(ctx, esc, enLima('2026-12-02', '18:05')).secretaria;

      const respuesta = await marcarManual(ctx, cookie, matriz.sinRenovar.alumnoId);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
        409,
        'MENSUALIDAD_NO_VIGENTE',
      ]);
      expect(await clasesUsadasDe(A(), matriz.sinRenovar.matriculaIds[0] as string)).toBe(5);
    });
  });

  describe('una vuelta a mitad de mes (el 15/11) no cierra nada, pero mantiene el estado de los alumnos', () => {
    it('criterio 27: las matrículas VIGENTE de noviembre no se tocan; el ALUMNO_VENCIDO con matrícula VIGENTE de noviembre pasa a ALUMNO_ACTIVO y el ALUMNO_ACTIVO sin ninguna VIGENTE de noviembre, a ALUMNO_VENCIDO', async () => {
      const alDia = await sembrar('ALUMNO_ACTIVO', [{ mes: NOVIEMBRE, estado: 'VIGENTE' }]);
      const vencidoQuePago = await sembrar('ALUMNO_VENCIDO', [
        { mes: OCTUBRE, estado: 'FINALIZADA' },
        { mes: NOVIEMBRE, estado: 'VIGENTE' },
      ]);
      const activoSinNoviembre = await sembrar('ALUMNO_ACTIVO', [{ mes: OCTUBRE, estado: 'FINALIZADA' }]);
      const cliente = await sembrar('CLIENTE', [{ mes: NOVIEMBRE, estado: 'RESERVADA' }]);

      await ejecutarCierre(ctx, enLima('2026-11-15', '10:00'));

      expect(await estadoDelAlumno(A(), alDia.alumnoId)).toBe('ALUMNO_ACTIVO');
      expect(await estadoDelAlumno(A(), vencidoQuePago.alumnoId)).toBe('ALUMNO_ACTIVO');
      expect(await estadoDelAlumno(A(), activoSinNoviembre.alumnoId)).toBe('ALUMNO_VENCIDO');
      expect(await estadoDelAlumno(A(), cliente.alumnoId)).toBe('CLIENTE');
      for (const alumno of [alDia, vencidoQuePago]) {
        expect((await matriculasPorMes(A(), alumno.alumnoId))['2026-11']?.estado).toBe('VIGENTE');
      }
    });

    it('criterio 27: sin nada que hacer (todo ya está como debe), la vuelta no escribe: ni estados ni fechas de actualización cambian', async () => {
      await sembrar('ALUMNO_ACTIVO', [{ mes: NOVIEMBRE, estado: 'VIGENTE' }]);
      await sembrar('ALUMNO_VENCIDO', [{ mes: OCTUBRE, estado: 'FINALIZADA' }]);
      await sembrar('CLIENTE', [{ mes: NOVIEMBRE, estado: 'RESERVADA' }]);
      await sembrar('INACTIVO', [{ mes: OCTUBRE, estado: 'FINALIZADA' }]);
      const antes = await instantaneaDelCierre(esc);

      await ejecutarCierre(ctx, enLima('2026-11-15', '10:00'));

      expect(await instantaneaDelCierre(esc)).toBe(antes);
    });
  });
});
