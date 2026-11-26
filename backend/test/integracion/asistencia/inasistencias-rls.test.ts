// spec: 009-asistencia (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { filaAsistenciaValida, insertarAsistencia } from '../../utilidades/escenario-asistencia';
import {
  actualizarInasistencia,
  type Columnas,
  exigirTablaDeInasistencias,
  filaInasistenciaValida,
  insertarInasistencia,
  leerInasistencias,
} from '../../utilidades/escenario-faltas';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import { sembrarSolicitud } from '../../utilidades/inscripciones';

// Criterio 22 (crítico, D-23, D-29) y criterio 26 (parte de la base): con faltas de A y de B, como app: en contexto de A, SELECT devuelve solo las de A; un INSERT con `academia_id` de B falla con 42501; un UPDATE de una falta
// de B desde el contexto de A afecta 0 filas; en contexto de plataforma o sin contexto, 0 filas (D-29), el INSERT falla con 42501 y el UPDATE afecta 0 filas. En contexto de A tampoco se ven las de B filtrando por `academia_id`
// de B. Las filas se leen como dueño filtrando por `academia_id` (sirve con un dueño superusuario o no).

describe('criterio 22: RLS de inasistencias', () => {
  let e: EscenarioPagos;
  const sembradas: { A: string[]; B: string[] } = { A: [], B: [] };

  async function nueva(academia: 'A' | 'B', sobre: Columnas = {}): Promise<Columnas> {
    const esA = academia === 'A';
    const cliente = await sembrarSolicitud(esA ? e.A.id : e.B.id, {
      planId: esA ? e.plan.id : e.planB.id,
      claseIds: [esA ? e.lunes.id : e.lunesB.id],
    });
    return filaInasistenciaValida(
      { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId, claseId: esA ? e.lunes.id : e.lunesB.id },
      sobre,
    );
  }

  beforeEach(async () => {
    await exigirTablaDeInasistencias();
    e = await crearEscenarioDePagos();
    sembradas.A = [];
    sembradas.B = [];
    for (const academia of ['A', 'B'] as const) {
      for (let i = 0; i < 2; i++) {
        const fila = await nueva(academia);
        await insertarInasistencia('propietario', academia === 'A' ? e.A.id : e.B.id, fila);
        sembradas[academia].push(fila['id'] as string);
      }
    }
  });

  const idsDe = async (contexto: { academiaId?: string; plataforma?: boolean | string }) => {
    const { rows } = await ejecutarComo('app', 'SELECT id::text AS id FROM inasistencias ORDER BY 1', [], contexto);
    return (rows as { id: string }[]).map((fila) => fila.id);
  };

  describe('SELECT', () => {
    it('criterio 22: en contexto de A devuelve solo las faltas de A; en el de B, solo las de B (cada una tiene dos)', async () => {
      expect((await idsDe({ academiaId: e.A.id })).sort()).toEqual([...sembradas.A].sort());
      expect((await idsDe({ academiaId: e.B.id })).sort()).toEqual([...sembradas.B].sort());
    });

    it('criterio 22: en contexto de plataforma, sin contexto o con la academia vacía devuelve 0 filas (el Superadmin no ve faltas, D-29)', async () => {
      expect(await idsDe({ plataforma: true })).toEqual([]);
      expect(await idsDe({})).toEqual([]);
      expect(await idsDe({ academiaId: '' })).toEqual([]);
    });

    it('criterio 22: en contexto de plataforma y de A a la vez solo se ven las de A (la marca de plataforma no abre nada)', async () => {
      expect(await idsDe({ plataforma: true, academiaId: e.A.id })).toEqual(await idsDe({ academiaId: e.A.id }));
    });

    it('criterio 22: en contexto de A, pedir las de B por su academia_id, por su id o por su alumno no devuelve nada', async () => {
      const deB = (await leerInasistencias(e.B.id))[0];
      const consulta = (sql: string, valor: unknown) => ejecutarComo('app', sql, [valor], { academiaId: e.A.id });

      expect((await consulta('SELECT id FROM inasistencias WHERE academia_id = $1::uuid', e.B.id)).rows).toEqual([]);
      expect((await consulta('SELECT id FROM inasistencias WHERE id = $1::uuid', deB?.id)).rows).toEqual([]);
      expect((await consulta('SELECT id FROM inasistencias WHERE alumno_id = $1::uuid', deB?.alumno_id)).rows).toEqual(
        [],
      );
    });
  });

  describe('INSERT', () => {
    it('criterio 22: un INSERT con la academia_id de B en contexto de A falla con 42501 y B no recibe nada', async () => {
      const fila = await nueva('B');

      await expect(
        insertarInasistencia('app', e.B.id, fila, { contexto: { academiaId: e.A.id } }),
      ).rejects.toMatchObject({
        code: '42501',
      });

      expect(await leerInasistencias(e.B.id)).toHaveLength(2);
    });

    it('criterio 22: en contexto de plataforma o sin contexto, un INSERT falla con 42501 (con la academia de A o de B)', async () => {
      for (const contexto of [{ plataforma: true }, {}] as const) {
        for (const academia of ['A', 'B'] as const) {
          await expect(
            insertarInasistencia('app', academia === 'A' ? e.A.id : e.B.id, await nueva(academia), { contexto }),
            `${JSON.stringify(contexto)} en ${academia}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
      }
    });

    it('criterio 22: un INSERT de la propia academia en su contexto sí se acepta (control)', async () => {
      await insertarInasistencia('app', e.A.id, await nueva('A'));

      expect(await leerInasistencias(e.A.id)).toHaveLength(3);
    });
  });

  describe('UPDATE', () => {
    /** Una asistencia del mismo alumno y día que la falta, para cubrirla. */
    async function asistenciaQueCubre(academia: 'A' | 'B', alumnoId: string, matriculaId: string): Promise<string> {
      const esA = academia === 'A';
      const columnas = filaAsistenciaValida({
        alumnoId,
        matriculaId,
        claseId: esA ? e.lunes.id : e.lunesB.id,
        usuarioId: esA ? e.secretariaA.id : e.secretariaB.id,
      });
      await insertarAsistencia('propietario', esA ? e.A.id : e.B.id, columnas);
      return columnas['id'] as string;
    }

    it('criterio 22: desde el contexto de A, cubrir una falta de B afecta 0 filas (RLS) y la falta de B sigue sin cubrir', async () => {
      const faltaDeB = (await leerInasistencias(e.B.id))[0]!;
      const asistenciaId = await asistenciaQueCubre('B', faltaDeB.alumno_id, faltaDeB.matricula_id);

      const afectadas = await actualizarInasistencia(
        'app',
        e.B.id,
        faltaDeB.id,
        { asistencia_id: asistenciaId, cubierta_en: new Date('2026-11-17T01:00:00.000Z') },
        { contexto: { academiaId: e.A.id } },
      );

      expect(afectadas).toBe(0);
      expect((await leerInasistencias(e.B.id)).find((f) => f.id === faltaDeB.id)?.asistencia_id).toBeNull();
    });

    it('criterio 22: en contexto de plataforma o sin contexto, cubrir una falta afecta 0 filas', async () => {
      const faltaDeA = (await leerInasistencias(e.A.id))[0]!;
      const asistenciaId = await asistenciaQueCubre('A', faltaDeA.alumno_id, faltaDeA.matricula_id);

      for (const contexto of [{ plataforma: true }, {}] as const) {
        const afectadas = await actualizarInasistencia(
          'app',
          e.A.id,
          faltaDeA.id,
          { asistencia_id: asistenciaId, cubierta_en: new Date('2026-11-17T01:00:00.000Z') },
          { contexto },
        );
        expect(afectadas, JSON.stringify(contexto)).toBe(0);
      }
      expect((await leerInasistencias(e.A.id)).find((f) => f.id === faltaDeA.id)?.asistencia_id).toBeNull();
    });

    it('criterio 22: desde el contexto de A, cubrir una falta de A sí afecta 1 fila (control)', async () => {
      const faltaDeA = (await leerInasistencias(e.A.id))[0]!;
      const asistenciaId = await asistenciaQueCubre('A', faltaDeA.alumno_id, faltaDeA.matricula_id);

      const afectadas = await actualizarInasistencia('app', e.A.id, faltaDeA.id, {
        asistencia_id: asistenciaId,
        cubierta_en: new Date('2026-11-17T01:00:00.000Z'),
      });

      expect(afectadas).toBe(1);
    });
  });
});
