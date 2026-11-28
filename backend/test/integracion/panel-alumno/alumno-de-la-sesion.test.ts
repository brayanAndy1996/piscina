// spec: 011-panel-alumno (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  filaAsistenciaValida,
  insertarAsistencia,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, cambiarAlumno, crearAppCarnet, RUTA_MI_CARNET } from '../../utilidades/escenario-carnet';
import { ejecutarComo } from '../../utilidades/base-datos';
import { sembrarCobrable } from '../../utilidades/escenario-pagos';
import {
  codigoDe,
  pedirCrudo,
  prepararEscenarioDelPanel,
  type RespuestaCruda,
  RUTA_MI_ASISTENCIA,
  RUTA_MI_PANEL,
  RUTAS_DEL_PANEL,
} from '../../utilidades/escenario-panel';
import { cookieDeUsuario, crearUsuarioDePrueba, dniInventado } from '../../utilidades/usuarios';

// Criterio 2 (crítico, D-14, D-23): `GET /api/mi-panel` y `GET /api/mi-panel/asistencias` no reciben ningún id. Con la sesión del alumno A1, la respuesta es idéntica (mismo estado y mismo cuerpo) con y sin cualquiera de estos agregados que apuntan a otro alumno, a otro
// usuario o a otra academia: `?id=`, `?alumnoId=`, `?usuarioId=`, `?academiaId=`, `?nombreCorto=`, un cuerpo JSON con esos campos, y las cabeceras `X-Alumno-Id`, `X-Usuario-Id` y `X-Academia-Id`. Una cuenta `ALUMNO` sin alumno de la sesión (por ejemplo, con su fila de
// `alumnos` puesta a mano, como dueño, en `CLIENTE` o sin `usuario_id`) recibe 404 `NO_ENCONTRADO` (el mismo cuerpo que `GET /api/mi-carnet`, 008). Si la consulta del alumno de la sesión devolviera más de una fila, la petición falla con 500 `ERROR_INTERNO` sin datos (falla cerrada).
// Orden (criterio 3): sesión → academia → cambio obligatorio → permiso → alcance → `mes` → alumno de la sesión.
// Lecturas estrictas elegidas: «idéntica» es el mismo estado HTTP y el mismo texto del cuerpo, con el reloj fijo; la 500 se prueba quitando el índice del criterio 1 a mano y volviéndolo a crear al terminar (si el índice no existe todavía, la prueba no lo crea);
// una ruta con un id en la dirección (`/api/mi-panel/{id}`) no existe: 404.

const INDICE = 'alumnos_academia_id_usuario_id_key';
const AHORA = enLima('2026-11-17', '10:00:00.000');

describe('el alumno de la sesión sale de la sesión y nunca de lo que manda quien pide (criterio 2)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let a1: AlumnoDeAsistencia;
  let a2: AlumnoDeAsistencia;
  let deB: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelPanel(ctx);
    a1 = await crearAlumnoDeAsistencia(ctx, esc, { nombres: 'Alma', apellidos: 'Sesion Uno', clasesUsadas: 3 });
    a2 = await crearAlumnoDeAsistencia(ctx, esc, {
      nombres: 'Bruno',
      apellidos: 'Sesion Dos',
      clasesUsadas: 9,
      claseIds: [esc.martes08.id],
    });
    deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B', nombres: 'Celia', apellidos: 'Sesion Tres' });
    const llegada = enLima('2026-11-09', '18:02');
    await insertarAsistencia(
      'propietario',
      esc.e.A.id,
      filaAsistenciaValida(
        {
          alumnoId: a1.alumnoId,
          matriculaId: a1.matriculaId,
          claseId: esc.e.lunes.id,
          usuarioId: esc.e.secretariaA.id,
        },
        { fecha: '2026-11-09', llegada_en: llegada, registrado_en: llegada },
      ),
    );
    en(ctx, esc, AHORA);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  /** Lo que apunta a otro alumno, a otro usuario o a otra academia. */
  const ajenos = () => ({
    id: a2.alumnoId,
    alumnoId: a2.alumnoId,
    usuarioId: a2.usuarioId,
    academiaId: esc.e.B.id,
    nombreCorto: 'academia-b',
  });

  const conConsulta = (ruta: string, extra: Record<string, string>): string => {
    const consulta = Object.entries(extra)
      .map(([clave, valor]) => `${clave}=${encodeURIComponent(valor)}`)
      .join('&');
    return ruta.includes('?') ? `${ruta}&${consulta}` : `${ruta}?${consulta}`;
  };

  /** La misma petición de A1 con cada agregado; todas deben ser idénticas a la que no lo lleva. */
  const agregados = (ruta: string, cookie: string): [string, () => Promise<RespuestaCruda>][] => {
    const otros = ajenos();
    const variantes: [string, () => Promise<RespuestaCruda>][] = [];
    for (const [clave, valor] of Object.entries(otros)) {
      variantes.push([
        `?${clave}=`,
        () => pedirCrudo(ctx.app, 'GET', conConsulta(ruta, { [clave]: valor }), { cookie }),
      ]);
    }
    variantes.push(
      ['todos los parámetros de la dirección', () => pedirCrudo(ctx.app, 'GET', conConsulta(ruta, otros), { cookie })],
      [
        'los ids de B',
        () =>
          pedirCrudo(
            ctx.app,
            'GET',
            conConsulta(ruta, {
              id: deB.alumnoId,
              alumnoId: deB.alumnoId,
              usuarioId: deB.usuarioId,
              academiaId: esc.e.B.id,
            }),
            { cookie },
          ),
      ],
      ['un cuerpo JSON con esos campos', () => pedirCrudo(ctx.app, 'GET', ruta, { cookie, cuerpo: otros })],
      [
        'un cuerpo JSON con los ids de B',
        () =>
          pedirCrudo(ctx.app, 'GET', ruta, {
            cookie,
            cuerpo: { id: deB.alumnoId, alumnoId: deB.alumnoId, usuarioId: deB.usuarioId, academiaId: esc.e.B.id },
          }),
      ],
      [
        'las cabeceras X-Alumno-Id, X-Usuario-Id y X-Academia-Id',
        () =>
          pedirCrudo(ctx.app, 'GET', ruta, {
            cookie,
            headers: { 'x-alumno-id': a2.alumnoId, 'x-usuario-id': a2.usuarioId, 'x-academia-id': esc.e.B.id },
          }),
      ],
      [
        'las cabeceras con los ids de B',
        () =>
          pedirCrudo(ctx.app, 'GET', ruta, {
            cookie,
            headers: { 'x-alumno-id': deB.alumnoId, 'x-usuario-id': deB.usuarioId, 'x-academia-id': esc.e.B.id },
          }),
      ],
      [
        'la dirección, el cuerpo y las cabeceras a la vez',
        () =>
          pedirCrudo(ctx.app, 'GET', conConsulta(ruta, otros), {
            cookie,
            cuerpo: otros,
            headers: { 'x-alumno-id': a2.alumnoId, 'x-usuario-id': a2.usuarioId, 'x-academia-id': esc.e.B.id },
          }),
      ],
    );
    return variantes;
  };

  describe.each([
    ['GET /api/mi-panel', RUTA_MI_PANEL],
    ['GET /api/mi-panel/asistencias', `${RUTA_MI_ASISTENCIA}?mes=2026-11`],
  ])('%s', (_nombre, ruta) => {
    it('con la sesión de A1, la respuesta es la misma con y sin cualquier agregado que apunte a otro alumno, a otro usuario o a otra academia, y es la de A1', async () => {
      const base = await pedirCrudo(ctx.app, 'GET', ruta, { cookie: a1.cookie });
      expect(base.status, base.texto.slice(0, 300)).toBe(200);
      const delOtro = await pedirCrudo(ctx.app, 'GET', ruta, { cookie: a2.cookie });
      expect(delOtro.texto, 'control: A2 recibe otra respuesta').not.toBe(base.texto);

      for (const [nombre, pedir] of agregados(ruta, a1.cookie)) {
        const respuesta = await pedir();

        expect([respuesta.status, respuesta.texto], nombre).toEqual([base.status, base.texto]);
      }
      expect(base.texto).not.toContain('Bruno');
      expect(base.texto).not.toContain('Celia');
      expect(base.texto).not.toContain(a2.dni);
      expect(base.texto).not.toContain(deB.dni);
    });

    it('con la sesión de A1, un id en la dirección no es una ruta: /api/mi-panel/{id} y las rutas con un id responden 404 como cualquier ruta inexistente', async () => {
      const inexistente = await pedirCrudo(ctx.app, 'GET', '/api/ruta-que-no-existe-011', { cookie: a1.cookie });
      const rutaBase = ruta.split('?')[0] as string;

      for (const camino of [
        `${rutaBase}/${a2.alumnoId}`,
        `${rutaBase}/${a1.alumnoId}`,
        `${rutaBase}/${a2.usuarioId}`,
        `${RUTA_MI_PANEL}/${a2.alumnoId}/asistencias`,
        `${RUTA_MI_ASISTENCIA}/${a2.alumnoId}`,
      ]) {
        const respuesta = await pedirCrudo(ctx.app, 'GET', camino, { cookie: a1.cookie });

        expect([respuesta.status, respuesta.texto], camino).toEqual([404, inexistente.texto]);
        expect(respuesta.texto).not.toContain(a2.alumnoId);
      }
    });
  });

  describe('una cuenta ALUMNO sin alumno de la sesión recibe 404 NO_ENCONTRADO (el mismo cuerpo de /api/mi-carnet)', () => {
    /** Las dos rutas del panel y el carnet con la misma cookie: los dos del panel deben dar el 404 del carnet. */
    async function comprobarElMismo404(cookie: string, etiqueta: string): Promise<void> {
      const carnet = await pedirCrudo(ctx.app, 'GET', RUTA_MI_CARNET, { cookie });
      expect([carnet.status, codigoDe(carnet)], `control: ${etiqueta}, el carnet`).toEqual([404, 'NO_ENCONTRADO']);
      for (const { nombre, ruta } of RUTAS_DEL_PANEL) {
        const respuesta = await pedirCrudo(ctx.app, 'GET', ruta, { cookie });
        expect(
          [respuesta.status, codigoDe(respuesta)],
          `${etiqueta}: ${nombre}: ${respuesta.texto.slice(0, 200)}`,
        ).toEqual([404, 'NO_ENCONTRADO']);
        expect(respuesta.texto, `${etiqueta}: ${nombre}`).toBe(carnet.texto);
      }
      const conMes = await pedirCrudo(ctx.app, 'GET', `${RUTA_MI_ASISTENCIA}?mes=2026-11`, { cookie });
      expect([conMes.status, codigoDe(conMes)], `${etiqueta}: con mes`).toEqual([404, 'NO_ENCONTRADO']);
    }

    it('una cuenta de ALUMNO que nunca tuvo ficha de alumno', async () => {
      await comprobarElMismo404(esc.cookies.alumno, 'sin ficha');
    });

    it('una cuenta unida, a mano y como dueño, a un alumno que sigue en CLIENTE', async () => {
      const cliente = await sembrarCobrable(esc.e);
      const cuenta = await crearUsuarioDePrueba({ academiaId: esc.e.A.id, rol: 'ALUMNO' });
      await cambiarAlumno(esc.e.A.id, cliente.alumnoId, { usuario_id: cuenta.id });

      await comprobarElMismo404(
        cookieDeUsuario({ id: cuenta.id, academiaId: esc.e.A.id, rol: 'ALUMNO' }, AHORA),
        'CLIENTE',
      );
    });

    it('la cuenta de un alumno al que se le quitó el usuario_id (sin usuario_id)', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { usuario_id: null });

      await comprobarElMismo404(alumno.cookie, 'sin usuario_id');
    });

    it('la cuenta de un alumno que pasó a CLIENTE después de tener cuenta', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      await ejecutarComo(
        'propietario',
        `UPDATE alumnos SET estado = 'CLIENTE'::estado_alumno, qr_token = NULL, qr_generado_en = NULL, qr_clave_idempotencia = NULL
          WHERE academia_id = $1::uuid AND id = $2::uuid`,
        [esc.e.A.id, alumno.alumnoId],
        { academiaId: esc.e.A.id },
      );

      await comprobarElMismo404(alumno.cookie, 'pasó a CLIENTE');
    });

    it('un alumno de B con el mismo DNI de una cuenta de A que no tiene ficha: la cuenta de A recibe 404 y nada de B', async () => {
      const dni = dniInventado();
      const cuentaDeA = await crearUsuarioDePrueba({ academiaId: esc.e.A.id, rol: 'ALUMNO', dni });
      const enB = await crearAlumnoDeAsistencia(ctx, esc, {
        academia: 'B',
        dni,
        nombres: 'Elena',
        apellidos: 'Solo En B',
      });

      const cookie = cookieDeUsuario({ id: cuentaDeA.id, academiaId: esc.e.A.id, rol: 'ALUMNO' }, AHORA);

      await comprobarElMismo404(cookie, 'ficha solo en B');
      for (const { ruta } of RUTAS_DEL_PANEL) {
        const respuesta = await pedirCrudo(ctx.app, 'GET', ruta, { cookie });
        expect(respuesta.texto).not.toContain('Elena');
        expect(respuesta.texto).not.toContain(enB.alumnoId);
      }
    });

    it('el 404 va después de los demás errores: con un mes inválido o posterior al mes en curso responde 400 SOLICITUD_INVALIDA aunque no haya alumno', async () => {
      for (const mes of ['no-es-un-mes', '2026-13', '1999-12', '2026-12']) {
        const respuesta = await pedirCrudo(ctx.app, 'GET', `${RUTA_MI_ASISTENCIA}?mes=${mes}`, {
          cookie: esc.cookies.alumno,
        });

        expect([respuesta.status, codigoDe(respuesta)], mes).toEqual([400, 'SOLICITUD_INVALIDA']);
      }
    });
  });

  describe('falla cerrada: si la consulta del alumno de la sesión devolviera más de una fila', () => {
    it('responde 500 ERROR_INTERNO sin ningún dato, en las dos rutas (se quita el índice del criterio 1 a mano y se vuelve a crear al terminar)', async () => {
      const { rows } = await ejecutarComo(
        'propietario',
        'SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2',
        ['alumnos', INDICE],
      );
      const hayIndice = rows.length > 0;
      const gemelo = randomUUID();
      try {
        if (hayIndice) await ejecutarComo('propietario', `DROP INDEX "${INDICE}"`);
        await ejecutarComo(
          'propietario',
          `INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, usuario_id, creado_en, actualizado_en)
           VALUES ($1::uuid, $2::uuid, $3, 'Gemelo', 'Fila Duplicada', DATE '2000-01-15', '987654321', 'BASICO'::nivel_natacion,
                   'ALUMNO_ACTIVO'::estado_alumno, $4::uuid, now(), now())`,
          [gemelo, esc.e.A.id, dniInventado(), a1.usuarioId],
          { academiaId: esc.e.A.id },
        );

        for (const { nombre, ruta } of RUTAS_DEL_PANEL) {
          const respuesta = await pedirCrudo(ctx.app, 'GET', ruta, { cookie: a1.cookie });

          expect([respuesta.status, codigoDe(respuesta)], `${nombre}: ${respuesta.texto.slice(0, 200)}`).toEqual([
            500,
            'ERROR_INTERNO',
          ]);
          expect(respuesta.texto, nombre).not.toContain('Alma');
          expect(respuesta.texto, nombre).not.toContain('Gemelo');
          expect(respuesta.texto, nombre).not.toContain(a1.dni);
        }
      } finally {
        await ejecutarComo(
          'propietario',
          'DELETE FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid',
          [esc.e.A.id, gemelo],
          {
            academiaId: esc.e.A.id,
          },
        );
        if (hayIndice) {
          await ejecutarComo(
            'propietario',
            `CREATE UNIQUE INDEX "${INDICE}" ON "alumnos" ("academia_id", "usuario_id")`,
          );
        }
      }
    });
  });
});
