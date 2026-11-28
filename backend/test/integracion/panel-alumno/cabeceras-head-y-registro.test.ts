import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  en,
  enLima,
  type EscenarioDeAsistencia,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  codigoDe,
  grabarSentencias,
  pedirCrudo,
  prepararEscenarioDelPanel,
  RUTA_MI_ASISTENCIA,
  RUTA_MI_PANEL,
  rutaMiAsistencia,
} from '../../utilidades/escenario-panel';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';

// Criterio 16 de la 011 (prueba obligatoria, Ley 29733, criterio 43 de 002): las respuestas 200 de las dos rutas llevan `Cache-Control: no-store`; `HEAD` sobre `/api/mi-panel` y lo que cuelga de él
// responde 404 sin leer las tablas del negocio (`/mi-panel` está en `PREFIJOS_SIN_HEAD`); con el registro técnico en `debug`, ninguna línea de estas peticiones lleva el DNI, los nombres, la edad
// ni el cuerpo de la respuesta.

const AHORA = enLima('2026-11-24', '10:00:00.000');

describe('cabeceras, HEAD y registro técnico del panel (criterio 16)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet({ nivelRegistro: 'debug', destinoRegistro: destino });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelPanel(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc, {
      dni: '37123456',
      nombres: 'Zoilo',
      apellidos: 'Registrado Unico',
      clasesUsadas: 2,
    });
    en(ctx, esc, AHORA);
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const pedir = (ruta: string, metodo = 'GET', cookie: string | undefined = alumno.cookie) =>
    pedirCrudo(ctx.app, metodo, ruta, { cookie });

  it.each([
    ['GET /api/mi-panel', RUTA_MI_PANEL],
    ['GET /api/mi-panel/asistencias', RUTA_MI_ASISTENCIA],
    ['GET /api/mi-panel/asistencias?mes=2026-11', rutaMiAsistencia('2026-11')],
    ['GET /api/mi-panel/asistencias?mes=2026-10', rutaMiAsistencia('2026-10')],
  ])('%s: la respuesta 200 lleva Cache-Control: no-store', async (_nombre, ruta) => {
    const respuesta = await pedir(ruta);

    expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
    expect(respuesta.headers['cache-control']).toBe('no-store');
  });

  it('HEAD sobre /api/mi-panel y lo que cuelga de él responde 404 NO_ENCONTRADO sin cuerpo y sin leer las tablas del negocio, con la sesión del alumno, con la del personal y sin sesión', async () => {
    const TABLAS =
      /\b(alumnos|matriculas|matricula_clases|asistencias|inasistencias|configuraciones|pagos|planes|clases)\b/i;
    const cookies = en(ctx, esc, AHORA);
    const rutas = [
      RUTA_MI_PANEL,
      `${RUTA_MI_PANEL}/`,
      RUTA_MI_ASISTENCIA,
      rutaMiAsistencia('2026-11'),
      `${RUTA_MI_PANEL}/${alumno.alumnoId}`,
      `${RUTA_MI_ASISTENCIA}/${alumno.alumnoId}`,
      '/api/MI-PANEL',
    ];

    for (const [nombre, cookie] of [
      ['alumno', alumno.cookie],
      ['secretaria', cookies.secretaria],
      ['sin sesión', undefined],
    ] as const) {
      for (const ruta of rutas) {
        const { resultado, sentencias } = await grabarSentencias(() => pedir(ruta, 'HEAD', cookie));

        if (cookie === undefined) {
          // Sin sesión responde lo mismo que otra ruta sin HEAD de la API, como `/api/mi-carnet`.
          const delCarnet = await pedir('/api/mi-carnet', 'HEAD', cookie);
          expect([resultado.status, resultado.texto], `${nombre} ${ruta}`).toEqual([delCarnet.status, delCarnet.texto]);
        } else {
          expect([resultado.status, resultado.texto], `${nombre} ${ruta}`).toEqual([404, '']);
        }
        expect(
          sentencias.filter((sentencia) => TABLAS.test(sentencia) && !/\b(usuarios|academias)\b/i.test(sentencia)),
          `${nombre} ${ruta}: HEAD no lee las tablas del negocio`,
        ).toEqual([]);
      }
    }
    // Un GET sigue funcionando después de los HEAD.
    expect((await pedir(RUTA_MI_PANEL)).status).toBe(200);
  });

  it('con el registro técnico en debug, ninguna línea de las peticiones del panel lleva el DNI, los nombres, la edad ni el cuerpo de la respuesta', async () => {
    lineas.length = 0;
    const respuestas = [
      await pedir(RUTA_MI_PANEL),
      await pedir(RUTA_MI_ASISTENCIA),
      await pedir(rutaMiAsistencia('2026-11')),
      await pedir(rutaMiAsistencia('2026-12')),
      await pedir(rutaMiAsistencia('no-es-un-mes')),
      await pedir(RUTA_MI_PANEL, 'HEAD'),
      await pedir(RUTA_MI_PANEL, 'POST'),
    ];

    expect(respuestas.map((respuesta) => respuesta.status)).toEqual([200, 200, 200, 400, 400, 404, 404]);
    expect(lineas.length, 'el registro técnico en debug debe tener líneas de estas peticiones').toBeGreaterThan(0);
    const registro = lineas.join('\n');
    for (const secreto of [
      alumno.dni,
      'Zoilo',
      'Registrado Unico',
      '"edad"',
      '"dni"',
      '"nombres"',
      '"mesesDeAsistencia"',
      '"registros"',
      '"clasesUsadas"',
      esc.e.plan.nombre,
      alumno.alumnoId,
      alumno.matriculaId,
      alumno.token,
    ]) {
      expect(registro, `el registro no puede llevar «${secreto}»`).not.toContain(secreto);
    }
    for (const respuesta of respuestas.filter((uno) => uno.status === 200)) {
      expect(registro, 'el registro no lleva el cuerpo de la respuesta').not.toContain(respuesta.texto);
    }
    expect(codigoDe(respuestas[3] as { body: Record<string, unknown> | null })).toBe('SOLICITUD_INVALIDA');
  });
});
