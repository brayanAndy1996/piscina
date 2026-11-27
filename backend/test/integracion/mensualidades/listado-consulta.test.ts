import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, type EscenarioDeAsistencia, prepararEscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoConMatriculas,
  exigirRutasDe010b,
  listadoDe,
  NOVIEMBRE,
  rutaListado,
  sembrarAlumno,
} from '../../utilidades/escenario-cierre';
import { INSTANTES } from '../../utilidades/escenario-renovacion';
import type { RespuestaApi } from '../../utilidades/inscripciones';

// Ataque ronda 1 de la 010b, F3 y el filtro `alumnoId` (no protegidas): la consulta del listado se arma sin tocar el prototipo (`?__proto__=x` es un
// parámetro desconocido más), un `mes` vacío da un solo error y `alumnoId` deja solo a ese alumno (uno de otra academia o inexistente, la lista vacía).

describe('la consulta del listado de mensualidades (F3 y alumnoId)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let galletas: ReturnType<typeof en>;
  let deA: AlumnoConMatriculas[];
  let deB: AlumnoConMatriculas;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    exigirRutasDe010b(ctx.app);
    deA = [
      await sembrarAlumno(esc, {
        estado: 'ALUMNO_ACTIVO',
        apellidos: 'Uno',
        matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
      }),
      await sembrarAlumno(esc, {
        estado: 'ALUMNO_ACTIVO',
        apellidos: 'Dos',
        matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
      }),
    ];
    deB = await sembrarAlumno(esc, {
      academia: 'B',
      estado: 'ALUMNO_ACTIVO',
      matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
    });
    galletas = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const pedir = (ruta: string): Promise<RespuestaApi> => ctx.http.get(ruta, { cookie: galletas.secretaria });
  const campos = (respuesta: RespuestaApi): string[] => {
    const detalles = respuesta.body?.['detalles'] as { errores: { campo: string }[] } | undefined;
    return (detalles?.errores ?? []).map((error) => error.campo);
  };

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'F3: «?%s=x» es un parámetro desconocido: 400 SOLICITUD_INVALIDA con un mensaje de parámetro no reconocido',
    async (nombre) => {
      const respuesta = await pedir(`/api/mensualidades?${nombre}=x`);

      expect([respuesta.status, respuesta.body?.['codigo']]).toEqual([400, 'SOLICITUD_INVALIDA']);
      expect(respuesta.texto).toMatch(/unrecognized|no reconocid|desconocid/i);
    },
  );

  it('F3: «?__proto__=x» no cambia el prototipo de la consulta: el mismo listado con un parámetro válido sigue funcionando', async () => {
    await pedir('/api/mensualidades?__proto__=x');

    const respuesta = await pedir(rutaListado({ mes: '2026-11' }));

    expect(listadoDe(respuesta).alumnos).toHaveLength(2);
  });

  it('F3: «?mes=» vacío da un solo error, el de `mes`', async () => {
    const respuesta = await pedir('/api/mensualidades?mes=');

    expect(respuesta.status).toBe(400);
    expect(campos(respuesta)).toEqual(['mes']);
  });

  it('F3: un mes con otra forma o anterior a 2000-01 da un solo error', async () => {
    expect(campos(await pedir(rutaListado({ mes: '2026-13' })))).toEqual(['mes']);
    expect(campos(await pedir(rutaListado({ mes: '1999-12' })))).toEqual(['mes']);
  });

  describe('el filtro alumnoId', () => {
    it('deja solo a ese alumno, con sus totales, y no cambia los demás', async () => {
      const [uno, dos] = deA as [AlumnoConMatriculas, AlumnoConMatriculas];

      const delUno = listadoDe(await pedir(rutaListado({ mes: '2026-11', alumnoId: uno.alumnoId })));
      const enMayusculas = listadoDe(
        await pedir(rutaListado({ mes: '2026-11', alumnoId: dos.alumnoId.toUpperCase() })),
      );

      expect(delUno.alumnos.map((fila) => fila.alumnoId)).toEqual([uno.alumnoId]);
      expect(delUno.totales).toEqual({ AL_DIA: 0, POR_VENCER: 1, VENCIDO: 0, PENDIENTE_VERIFICACION: 0 });
      expect(delUno.hayMas).toBe(false);
      expect(enMayusculas.alumnos.map((fila) => fila.alumnoId)).toEqual([dos.alumnoId]);
    });

    it('un alumno de otra academia o que no existe da la lista vacía y totales en cero, sin nada de la otra academia', async () => {
      for (const alumnoId of [deB.alumnoId, '00000000-0000-4000-8000-0000000000ff']) {
        const respuesta = await pedir(rutaListado({ mes: '2026-11', alumnoId }));

        const listado = listadoDe(respuesta);
        expect(listado.alumnos).toEqual([]);
        expect(listado.totales).toEqual({ AL_DIA: 0, POR_VENCER: 0, VENCIDO: 0, PENDIENTE_VERIFICACION: 0 });
        expect(respuesta.texto).not.toContain(deB.matriculaIds[0]);
      }
    });

    it('se combina con los demás filtros y no acepta un valor que no es UUID ni repetido', async () => {
      const [uno] = deA as [AlumnoConMatriculas];

      const conOtroEstado = listadoDe(
        await pedir(rutaListado({ mes: '2026-11', alumnoId: uno.alumnoId, estado: 'VENCIDO' })),
      );
      const noUuid = await pedir(rutaListado({ alumnoId: 'no-es-un-uuid' }));
      const repetido = await pedir(rutaListado({ alumnoId: [uno.alumnoId, uno.alumnoId] }));

      expect(conOtroEstado.alumnos).toEqual([]);
      expect(noUuid.status).toBe(400);
      expect(campos(noUuid)).toEqual(['alumnoId']);
      expect(repetido.status).toBe(400);
    });
  });
});
