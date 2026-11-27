import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { ejecutarComo, limpiarBase, urlAppPruebas, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { exigirTablasDeInscripcion, sembrarSolicitud, type SolicitudSembrada } from '../../utilidades/inscripciones';
import { crearClaseDePrueba, crearEntrenadorDePrueba, crearPlanDePrueba } from '../../utilidades/planes-clases';

// Prueba no protegida de la ronda 1 del ataque a la 010c (F1): el trigger `matricula_clases_solo_matricula_abierta` toma la fila de la matrícula con `FOR SHARE`.
// Si otra transacción la está cerrando (`UPDATE … estado = 'FINALIZADA'` sin confirmar), el `INSERT` o el `DELETE` en `matricula_clases` espera y, al confirmarse el
// cierre, falla con 23514: nunca queda una matrícula cerrada con las clases cambiadas. Con el cierre revertido, el cambio sigue. Sin esperas fijas: se detecta que el
// cambio espera con `pg_blocking_pids`; el límite de seguridad solo evita que la prueba se cuelgue.

const LIMITE_MS = 15_000;
const ROLES = ['app', 'propietario'] as const;

describe('el trigger de matricula_clases y el cierre concurrente de la matrícula (010c, F1)', () => {
  let A: AcademiaDePrueba;
  let c1: { id: string };
  let c2: { id: string };
  let cliente: SolicitudSembrada;
  const abiertos: pg.Client[] = [];

  beforeEach(exigirTablasDeInscripcion);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    const entrenador = await crearEntrenadorDePrueba(A.id);
    const plan = await crearPlanDePrueba(A.id);
    c1 = await crearClaseDePrueba(A.id, entrenador.id, { hora_inicio: '08:00' });
    c2 = await crearClaseDePrueba(A.id, entrenador.id, { hora_inicio: '09:00' });
    cliente = await sembrarSolicitud(A.id, { planId: plan.id, claseIds: [c1.id] });
    await ejecutarComo(
      'propietario',
      `UPDATE matriculas SET estado = 'VIGENTE', reserva_vence_en = NULL WHERE id = $1::uuid`,
      [cliente.matriculaId],
      { academiaId: A.id },
    );
  });
  afterEach(async () => {
    for (const conexion of abiertos.splice(0)) {
      await conexion.query('ROLLBACK').catch(() => undefined);
      await conexion.end().catch(() => undefined);
    }
  });

  /** Una conexión con una transacción abierta y la academia de la prueba fijada. */
  async function transaccion(rol: (typeof ROLES)[number]): Promise<pg.Client> {
    const conexion = new pg.Client({ connectionString: rol === 'app' ? urlAppPruebas() : urlPropietarioPruebas() });
    await conexion.connect();
    abiertos.push(conexion);
    await conexion.query('BEGIN');
    await conexion.query("SELECT set_config('app.academia_id', $1, true)", [A.id]);
    return conexion;
  }

  /** Espera (con `pg_blocking_pids`) a que la conexión `pid` esté bloqueada por otra. */
  async function esperaHastaEstarBloqueada(pid: number): Promise<void> {
    const inicio = Date.now();
    for (;;) {
      const { rows } = await ejecutarComo(
        'propietario',
        'SELECT cardinality(pg_blocking_pids($1::int)) AS bloqueos',
        [pid],
        { academiaId: A.id },
      );
      if (Number((rows[0] as { bloqueos: number }).bloqueos) > 0) return;
      if (Date.now() - inicio > LIMITE_MS)
        throw new Error('El cambio debía quedar esperando el cierre de la matrícula.');
      await new Promise((resolver) => setTimeout(resolver, 20));
    }
  }

  const cerrarSinConfirmar = async () => {
    const cierre = await transaccion('propietario');
    await cierre.query(`UPDATE matriculas SET estado = 'FINALIZADA' WHERE academia_id = $1::uuid AND id = $2::uuid`, [
      A.id,
      cliente.matriculaId,
    ]);
    return cierre;
  };
  const pidDe = async (conexion: pg.Client) =>
    Number(((await conexion.query('SELECT pg_backend_pid() AS pid')).rows[0] as { pid: number }).pid);
  const clasesDeLaMatricula = async () =>
    (
      await ejecutarComo(
        'propietario',
        `SELECT clase_id::text FROM matricula_clases WHERE matricula_id = $1::uuid ORDER BY 1`,
        [cliente.matriculaId],
        { academiaId: A.id },
      )
    ).rows.map((fila) => (fila as { clase_id: string }).clase_id);
  const estadoDeLaMatricula = async () =>
    (
      await ejecutarComo(
        'propietario',
        `SELECT estado::text AS estado FROM matriculas WHERE id = $1::uuid`,
        [cliente.matriculaId],
        { academiaId: A.id },
      )
    ).rows[0] as { estado: string };

  describe.each(ROLES)('como %s', (rol) => {
    it('un INSERT de una clase espera al cierre sin confirmar y, al confirmarse el cierre, falla con 23514 y no deja la fila', async () => {
      const cierre = await cerrarSinConfirmar();
      const cambio = await transaccion(rol);
      const pid = await pidDe(cambio);
      const insercion = cambio.query(
        `INSERT INTO matricula_clases (academia_id, matricula_id, clase_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`,
        [A.id, cliente.matriculaId, c2.id],
      );
      const resultado = insercion.then(
        () => 'insertó',
        (error: { code?: string }) => error.code,
      );

      await esperaHastaEstarBloqueada(pid);
      await cierre.query('COMMIT');

      expect(await resultado).toBe('23514');
      await cambio.query('ROLLBACK');
      expect(await estadoDeLaMatricula()).toEqual({ estado: 'FINALIZADA' });
      expect(await clasesDeLaMatricula()).toEqual([c1.id]);
    });

    it('un DELETE de una clase espera al cierre sin confirmar y, al confirmarse el cierre, falla con 23514 y la fila sigue', async () => {
      const cierre = await cerrarSinConfirmar();
      const cambio = await transaccion(rol);
      const pid = await pidDe(cambio);
      const borrado = cambio.query(
        `DELETE FROM matricula_clases WHERE matricula_id = $1::uuid AND clase_id = $2::uuid`,
        [cliente.matriculaId, c1.id],
      );
      const resultado = borrado.then(
        () => 'borró',
        (error: { code?: string }) => error.code,
      );

      await esperaHastaEstarBloqueada(pid);
      await cierre.query('COMMIT');

      expect(await resultado).toBe('23514');
      await cambio.query('ROLLBACK');
      expect(await estadoDeLaMatricula()).toEqual({ estado: 'FINALIZADA' });
      expect(await clasesDeLaMatricula()).toEqual([c1.id]);
    });

    it('control: si el cierre se revierte, el INSERT que esperaba sigue y la matrícula queda VIGENTE con las dos clases', async () => {
      const cierre = await cerrarSinConfirmar();
      const cambio = await transaccion(rol);
      const pid = await pidDe(cambio);
      const insercion = cambio.query(
        `INSERT INTO matricula_clases (academia_id, matricula_id, clase_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`,
        [A.id, cliente.matriculaId, c2.id],
      );

      await esperaHastaEstarBloqueada(pid);
      await cierre.query('ROLLBACK');
      await insercion;
      await cambio.query('COMMIT');

      expect(await estadoDeLaMatricula()).toEqual({ estado: 'VIGENTE' });
      expect(await clasesDeLaMatricula()).toEqual([c1.id, c2.id].sort());
    });
  });
});
