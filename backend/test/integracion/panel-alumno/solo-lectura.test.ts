// spec: 011-panel-alumno (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  filaAsistenciaValida,
  insertarAsistencia,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { filaInasistenciaValida, insertarInasistencia } from '../../utilidades/escenario-faltas';
import {
  codigoDe,
  grabarSentencias,
  instantaneaDeTodasLasTablas,
  pedirCrudo,
  prepararEscenarioDelPanel,
  RUTA_MI_ASISTENCIA,
  RUTA_MI_PANEL,
  rutaMiAsistencia,
} from '../../utilidades/escenario-panel';
import { abrirRetenedor } from '../../utilidades/planes-clases';

// Criterio 14 (crítico, D-14): después de llamar 20 veces a cada ruta del panel (con y sin `mes`), ninguna fila de `usuarios`, `alumnos`, `apoderados`, `fichas_medicas`, `matriculas`, `matricula_clases`, `pagos`, `asistencias`, `inasistencias`, `movimientos_caja` ni `auditoria` cambia (comparación del contenido de cada
// tabla, como dueño) y no se registra auditoría. Las dos lecturas corren en una sola transacción de la academia cada una, sin `FOR UPDATE`, `FOR SHARE` ni bloqueos consultivos. `POST`, `PUT`, `PATCH` y `DELETE` sobre `/api/mi-panel` y `/api/mi-panel/asistencias`, con la sesión del alumno, responden 404 como una ruta inexistente.
// Lecturas estrictas elegidas: se comparan todas las tablas del negocio de A y de B (un superconjunto de las del criterio); «una sola transacción» es que las sentencias de las tablas del panel (`alumnos`, `matriculas`, `matricula_clases`, `asistencias`, `inasistencias` y, en el resumen, `configuraciones`) llegan todas dentro de una misma transacción
// (la de la sesión, que lee `usuarios` y `academias`, es otra, como en `/api/mi-carnet`); «sin bloqueos» se prueba de dos maneras: ninguna sentencia lleva `FOR UPDATE`, `FOR SHARE`, `FOR NO KEY UPDATE`, `FOR KEY SHARE`, `LOCK` ni `advisory`, y con las filas del alumno, de su matrícula y de su clase retenidas con `FOR UPDATE` las dos rutas responden sin esperar.

const AHORA = enLima('2026-11-24', '10:00:00.000');

describe('el panel solo lee (criterio 14)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelPanel(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc, { dni: '35000001', clasesUsadas: 3 });
    const A = esc.e.A.id;
    const llegada = enLima('2026-11-02', '18:03');
    await insertarAsistencia(
      'propietario',
      A,
      filaAsistenciaValida(
        {
          alumnoId: alumno.alumnoId,
          matriculaId: alumno.matriculaId,
          claseId: esc.e.lunes.id,
          usuarioId: esc.e.secretariaA.id,
        },
        { fecha: '2026-11-02', llegada_en: llegada, registrado_en: llegada },
      ),
    );
    await insertarInasistencia(
      'propietario',
      A,
      filaInasistenciaValida(
        { alumnoId: alumno.alumnoId, matriculaId: alumno.matriculaId, claseId: esc.e.lunes.id },
        { fecha: '2026-11-09', registrada_en: enLima('2026-11-09', '19:05') },
      ),
    );
    await insertarAuditoria(A, 'ACCION_PREVIA_A');
    en(ctx, esc, AHORA);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const pedir = (ruta: string, metodo = 'GET') => pedirCrudo(ctx.app, metodo, ruta, { cookie: alumno.cookie });
  const instantanea = () => instantaneaDeTodasLasTablas([esc.e.A, esc.e.B]);

  describe('20 lecturas de cada ruta no cambian ninguna tabla ni dejan auditoría', () => {
    it.each([
      ['GET /api/mi-panel', RUTA_MI_PANEL],
      ['GET /api/mi-panel/asistencias', RUTA_MI_ASISTENCIA],
      ['GET /api/mi-panel/asistencias?mes=2026-11', rutaMiAsistencia('2026-11')],
      ['GET /api/mi-panel/asistencias?mes=2026-10', rutaMiAsistencia('2026-10')],
    ])('%s', async (_nombre, ruta) => {
      const antes = await instantanea();
      const auditoriaAntes = await leerAuditoriaDeAcademia(A());

      for (let vez = 0; vez < 20; vez += 1) {
        const respuesta = await pedir(ruta);
        expect(respuesta.status, `vez ${vez + 1}: ${respuesta.texto.slice(0, 200)}`).toBe(200);
      }

      expect(await instantanea()).toEqual(antes);
      expect(await leerAuditoriaDeAcademia(A())).toEqual(auditoriaAntes);
      expect(await leerAuditoriaDeAcademia(esc.e.B.id)).toEqual([]);
    });
  });

  describe('una sola transacción de la academia, sin bloqueos', () => {
    const TABLAS_DEL_PANEL = /\b(alumnos|matriculas|matricula_clases|asistencias|inasistencias)\b/i;
    const BLOQUEOS = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b|\block\s+table\b|advisory/i;
    const ESCRITURAS = /^(insert|update|delete|truncate|merge|alter|drop|create)\b/i;

    const CASOS: [string, string, RegExp | undefined][] = [
      ['GET /api/mi-panel', RUTA_MI_PANEL, /\bconfiguraciones\b/i],
      ['GET /api/mi-panel/asistencias', rutaMiAsistencia('2026-11'), undefined],
    ];

    it.each(CASOS)(
      '%s: las lecturas de las tablas del panel llegan todas en una misma transacción, sin FOR UPDATE, FOR SHARE ni bloqueos consultivos y sin escribir',
      async (_nombre, ruta, extra) => {
        await pedir(ruta);

        const { resultado, sentencias, transacciones } = await grabarSentencias(() => pedir(ruta));

        expect(resultado.status, resultado.texto.slice(0, 200)).toBe(200);
        const conTablasDelPanel = transacciones.filter((transaccion) =>
          transaccion.some((sentencia) => /\balumnos\b/i.test(sentencia)),
        );
        expect(conTablasDelPanel, 'la búsqueda del alumno de la sesión ocurre en una sola transacción').toHaveLength(1);
        const unica = conTablasDelPanel[0] as string[];
        expect(unica[0], 'la transacción empieza con BEGIN').toMatch(/^begin\b/i);
        expect(unica.at(-1), 'y termina con COMMIT').toMatch(/^commit\b/i);
        const fuera = transacciones
          .filter((transaccion) => transaccion !== unica)
          .flat()
          .filter((sentencia) => TABLAS_DEL_PANEL.test(sentencia) || (extra?.test(sentencia) ?? false));
        expect(fuera, 'ninguna lectura de las tablas del panel queda fuera de esa transacción').toEqual([]);
        if (extra)
          expect(
            unica.some((sentencia) => extra.test(sentencia)),
            'lee la configuración en la misma transacción',
          ).toBe(true);
        expect(
          unica.some((sentencia) => /\bmatriculas\b/i.test(sentencia)),
          'lee las matrículas en esa transacción',
        ).toBe(true);
        expect(
          sentencias.filter((sentencia) => BLOQUEOS.test(sentencia)),
          'sin bloqueos',
        ).toEqual([]);
        expect(
          sentencias.filter((sentencia) => ESCRITURAS.test(sentencia)),
          'sin escrituras',
        ).toEqual([]);
      },
    );

    it('con la fila del alumno, la de sus matrículas y la de su clase retenidas con FOR UPDATE, las dos rutas responden sin esperar', async () => {
      const retenedor = await abrirRetenedor(A());
      try {
        await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
          A(),
          alumno.alumnoId,
        ]);
        await retenedor.consultar(
          'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND alumno_id = $2::uuid ORDER BY id FOR UPDATE',
          [A(), alumno.alumnoId],
        );
        await retenedor.consultar('SELECT id FROM clases WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
          A(),
          esc.e.lunes.id,
        ]);

        const respuestas = await conLimiteCorto(
          Promise.all([pedir(RUTA_MI_PANEL), pedir(rutaMiAsistencia('2026-11'))]),
        );

        for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(200);
        expect(await retenedor.sesionesEsperando(), 'ninguna lectura espera una fila').toBe(0);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });
  });

  describe('POST, PUT, PATCH y DELETE sobre las rutas del panel responden 404 como una ruta inexistente', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s', async (metodo) => {
      const antes = await instantanea();
      const inexistente = await pedir('/api/ruta-que-no-existe-011', metodo);

      for (const ruta of [RUTA_MI_PANEL, RUTA_MI_ASISTENCIA, rutaMiAsistencia('2026-11')]) {
        const sinCuerpo = await pedir(ruta, metodo);
        const conCuerpo = await pedirCrudo(ctx.app, metodo, ruta, { cookie: alumno.cookie, cuerpo: {} });

        for (const respuesta of [sinCuerpo, conCuerpo]) {
          expect(
            [respuesta.status, codigoDe(respuesta)],
            `${metodo} ${ruta}: ${respuesta.texto.slice(0, 200)}`,
          ).toEqual([404, 'NO_ENCONTRADO']);
          expect(respuesta.texto, `${metodo} ${ruta}`).toBe(inexistente.texto);
        }
      }

      expect(await instantanea()).toEqual(antes);
    });
  });
});

/** La respuesta o un error claro si tarda más de 5 segundos (una lectura no debe esperar los bloqueos de otras operaciones). */
async function conLimiteCorto<T>(peticion: Promise<T>): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  const vencida = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error('El panel esperó una fila retenida: no debe bloquear.')), 5000);
  });
  try {
    return await Promise.race([peticion, vencida]);
  } finally {
    clearTimeout(temporizador);
  }
}
