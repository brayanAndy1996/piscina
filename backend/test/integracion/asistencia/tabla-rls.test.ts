// spec: 009-asistencia (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import {
  type Columnas,
  exigirTablaDeAsistencias,
  filaAsistenciaValida,
  insertarAsistencia,
  leerAsistencias,
} from '../../utilidades/escenario-asistencia';
import { sembrarSolicitud } from '../../utilidades/inscripciones';

// Criterio 1 (crítico, D-23, D-29) y criterio 16 (parte de la base): con asistencias de A y de B, como app: en contexto de A, SELECT devuelve solo las de A; un INSERT con `academia_id` de B
// falla con 42501; en contexto de plataforma o sin contexto, 0 filas (D-29) y el INSERT falla con 42501. En contexto de A tampoco se ven las de B filtrando por `academia_id` de B. Las filas
// se leen como dueño filtrando por `academia_id` (sirve con un dueño superusuario o no).

describe('criterio 1 y 16: RLS de asistencias', () => {
  let e: EscenarioPagos;
  const sembradas: { A: string[]; B: string[] } = { A: [], B: [] };

  async function nueva(academia: 'A' | 'B', sobre: Columnas = {}): Promise<Columnas> {
    const esA = academia === 'A';
    const academiaId = esA ? e.A.id : e.B.id;
    const cliente = await sembrarSolicitud(academiaId, {
      planId: esA ? e.plan.id : e.planB.id,
      claseIds: [esA ? e.lunes.id : e.lunesB.id],
    });
    return filaAsistenciaValida(
      {
        alumnoId: cliente.alumnoId,
        matriculaId: cliente.matriculaId,
        claseId: esA ? e.lunes.id : e.lunesB.id,
        usuarioId: esA ? e.secretariaA.id : e.secretariaB.id,
      },
      sobre,
    );
  }

  beforeEach(async () => {
    await exigirTablaDeAsistencias();
    e = await crearEscenarioDePagos();
    sembradas.A = [];
    sembradas.B = [];
    for (const academia of ['A', 'B'] as const) {
      for (let i = 0; i < 2; i++) {
        const fila = await nueva(academia);
        await insertarAsistencia('propietario', academia === 'A' ? e.A.id : e.B.id, fila);
        sembradas[academia].push(fila['id'] as string);
      }
    }
  });

  const idsDe = async (contexto: { academiaId?: string; plataforma?: boolean | string }) => {
    const { rows } = await ejecutarComo('app', 'SELECT id::text AS id FROM asistencias ORDER BY 1', [], contexto);
    return (rows as { id: string }[]).map((fila) => fila.id);
  };

  describe('SELECT', () => {
    it('criterio 1: en contexto de A devuelve solo las asistencias de A; en el de B, solo las de B (cada una tiene dos)', async () => {
      expect((await idsDe({ academiaId: e.A.id })).sort()).toEqual([...sembradas.A].sort());
      expect((await idsDe({ academiaId: e.B.id })).sort()).toEqual([...sembradas.B].sort());
    });

    it('criterio 1: en contexto de plataforma, sin contexto o con la academia vacía devuelve 0 filas (el Superadmin no ve asistencias, D-29)', async () => {
      expect(await idsDe({ plataforma: true })).toEqual([]);
      expect(await idsDe({})).toEqual([]);
      expect(await idsDe({ academiaId: '' })).toEqual([]);
    });

    it('criterio 1: en contexto de plataforma y de A a la vez solo se ven las de A (la marca de plataforma no abre nada)', async () => {
      expect(await idsDe({ plataforma: true, academiaId: e.A.id })).toEqual(await idsDe({ academiaId: e.A.id }));
    });

    it('criterio 16: en contexto de A, pedir las de B por su academia_id, por su id o por su alumno no devuelve nada', async () => {
      const deB = (await leerAsistencias(e.B.id))[0];
      const porAcademia = await ejecutarComo(
        'app',
        'SELECT id FROM asistencias WHERE academia_id = $1::uuid',
        [e.B.id],
        {
          academiaId: e.A.id,
        },
      );
      const porId = await ejecutarComo('app', 'SELECT id FROM asistencias WHERE id = $1::uuid', [deB?.id], {
        academiaId: e.A.id,
      });
      const porAlumno = await ejecutarComo(
        'app',
        'SELECT id FROM asistencias WHERE alumno_id = $1::uuid',
        [deB?.alumno_id],
        {
          academiaId: e.A.id,
        },
      );

      expect(porAcademia.rows).toEqual([]);
      expect(porId.rows).toEqual([]);
      expect(porAlumno.rows).toEqual([]);
    });
  });

  describe('INSERT', () => {
    it('criterio 1: un INSERT con la academia_id de B en contexto de A falla con 42501 y B no recibe nada', async () => {
      const fila = await nueva('B');

      await expect(insertarAsistencia('app', e.B.id, fila, { contexto: { academiaId: e.A.id } })).rejects.toMatchObject(
        { code: '42501' },
      );

      expect(await leerAsistencias(e.B.id)).toHaveLength(2);
    });

    it('criterio 1: en contexto de plataforma o sin contexto, un INSERT falla con 42501 (con la academia de A o de B)', async () => {
      for (const contexto of [{ plataforma: true }, {}] as const) {
        for (const academia of ['A', 'B'] as const) {
          await expect(
            insertarAsistencia('app', academia === 'A' ? e.A.id : e.B.id, await nueva(academia), { contexto }),
            `${JSON.stringify(contexto)} en ${academia}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
      }
    });

    it('criterio 1: un INSERT de la propia academia en su contexto sí se acepta (control)', async () => {
      await insertarAsistencia('app', e.A.id, await nueva('A'));

      expect(await leerAsistencias(e.A.id)).toHaveLength(3);
    });
  });

  describe('matriculas.clases_usadas, la única columna nueva que la app puede cambiar fuera de su academia', () => {
    it('criterio 1 y 16: desde el contexto de A, subir clases_usadas de una matrícula de B afecta 0 filas (RLS) y B no cambia', async () => {
      const matriculaDeB = ((await leerAsistencias(e.B.id))[0] as { matricula_id: string }).matricula_id;

      const resultado = await ejecutarComo(
        'app',
        'UPDATE matriculas SET clases_usadas = clases_usadas + 1 WHERE id = $1::uuid',
        [matriculaDeB],
        { academiaId: e.A.id },
      );

      expect(resultado.rowCount).toBe(0);
    });
  });
});
