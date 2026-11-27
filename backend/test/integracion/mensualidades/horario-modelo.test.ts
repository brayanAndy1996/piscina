// spec: 010-mensualidades (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { conTransaccionRevertida, ejecutarComo, limpiarBase, type RolPruebas } from '../../utilidades/base-datos';
import {
  actualizarFilas,
  exigirTablasDeInscripcion,
  leerMatriculaClases,
  type SolicitudSembrada,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';
import {
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  crearPlanDePrueba,
  type PlanDePrueba,
} from '../../utilidades/planes-clases';
import { type PoliticaLeida, problemasDeLaPolitica } from '../../utilidades/politicas';

// Criterio 34 (crítico, RN-08, D-23): la migración `<marca>_cambio_horario` agrega `matricula_clases.agregada_en` (`timestamptz(3)`, nula: las filas de la inscripción y de la renovación la dejan nula) y la política `matricula_clases_borrar` (`DELETE`, de la forma de 001) con el privilegio
// `DELETE` para `aquagestion_app`. El trigger `matricula_clases_solo_matricula_abierta` (`BEFORE INSERT OR DELETE`, por fila, `SECURITY INVOKER`, con `search_path` fijo y `REVOKE ALL … FROM PUBLIC`) rechaza con 23514 una fila cuya matrícula no está `RESERVADA` ni `VIGENTE`, y cierra por defecto si no la ve.
// Prueba como app y como dueño: borrar o agregar una clase de una matrícula `FINALIZADA` o `CANCELADA` (23514); como app, borrar una fila de otra academia no borra nada (RLS). Los criterios 1 y 2 de 005 se ajustaron en `inscripciones/tablas.test.ts` y `inscripciones/privilegios.test.ts` (A2).
// Lecturas estrictas elegidas: (1) el trigger se prueba por el código `23514` (la spec no fija el nombre de la restricción en el error); (2) «cierra por defecto si no la ve» es que agregar una clase a una matrícula que no existe, o que existe en otra academia (la academia de la sesión no la ve), responde 23514 y no 23503 ni 42501,
// porque el trigger es `BEFORE` y corre antes de las llaves y de la política de inserción; (3) la columna no tiene valor por defecto (las filas de la inscripción y de la renovación la dejan nula, y el cambio de horario la escribe con «ahora»); (4) la política de `DELETE` se comprueba con el catálogo y con la ejecución como app, no como dueño
// (el dueño puede estar exento de la RLS según cómo se haya creado el entorno); (5) el cierre de mes (`UPDATE matriculas SET estado = 'FINALIZADA'`) no se ve afectado: el trigger es solo de `INSERT` y `DELETE` de `matricula_clases`.

const ROLES: readonly RolPruebas[] = ['app', 'propietario'];
const TRIGGER = 'matricula_clases_solo_matricula_abierta';
const AGREGADA_EN = new Date('2026-11-27T15:00:00.123Z');

interface TriggerLeido {
  nombre: string;
  tipo: number;
  habilitado: string;
  es_restriccion: boolean;
  funcion: string;
  security_definer: boolean;
  configuracion: string[] | null;
  ejecuta_public: boolean;
}

describe('el modelo del cambio de horario (criterio 34)', () => {
  let A: AcademiaDePrueba;
  let B: AcademiaDePrueba;
  let planA: PlanDePrueba;
  let claseA1: { id: string };
  let claseA2: { id: string };
  let claseB1: { id: string };
  let clienteA: SolicitudSembrada;
  let clienteB: SolicitudSembrada;

  beforeEach(exigirTablasDeInscripcion);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    B = await crearAcademiaDePrueba();
    const entrenadorA = await crearEntrenadorDePrueba(A.id);
    const entrenadorB = await crearEntrenadorDePrueba(B.id);
    planA = await crearPlanDePrueba(A.id);
    const planB = await crearPlanDePrueba(B.id);
    claseA1 = await crearClaseDePrueba(A.id, entrenadorA.id, { hora_inicio: '08:00' });
    claseA2 = await crearClaseDePrueba(A.id, entrenadorA.id, { hora_inicio: '09:00' });
    claseB1 = await crearClaseDePrueba(B.id, entrenadorB.id, { hora_inicio: '08:00' });
    clienteA = await sembrarSolicitud(A.id, { planId: planA.id, claseIds: [claseA1.id] });
    clienteB = await sembrarSolicitud(B.id, { planId: planB.id, claseIds: [claseB1.id] });
  });

  /** Una fila de `matricula_clases` de la matrícula dada (con o sin `agregada_en`), con el rol y el contexto de la academia indicados. */
  function agregarClase(
    rol: RolPruebas,
    matriculaId: string,
    claseId: string,
    opciones: { agregadaEn?: Date | null; academiaId?: string; contexto?: string } = {},
  ) {
    const academiaId = opciones.academiaId ?? A.id;
    const conAgregada = opciones.agregadaEn !== undefined;
    return ejecutarComo(
      rol,
      `INSERT INTO matricula_clases (academia_id, matricula_id, clase_id${conAgregada ? ', agregada_en' : ''})
       VALUES ($1::uuid, $2::uuid, $3::uuid${conAgregada ? ', $4::timestamptz' : ''})`,
      conAgregada ? [academiaId, matriculaId, claseId, opciones.agregadaEn] : [academiaId, matriculaId, claseId],
      { academiaId: opciones.contexto ?? academiaId },
    );
  }

  function quitarClase(rol: RolPruebas, matriculaId: string, claseId: string, contexto: string = A.id) {
    return ejecutarComo(
      rol,
      'DELETE FROM matricula_clases WHERE matricula_id = $1::uuid AND clase_id = $2::uuid',
      [matriculaId, claseId],
      { academiaId: contexto },
    );
  }

  const ponerEstado = (matriculaId: string, estado: string, academiaId: string = A.id) =>
    actualizarFilas('propietario', 'matriculas', academiaId, { id: matriculaId }, { estado, reserva_vence_en: null });

  const clasesDe = async (academiaId: string, matriculaId: string) =>
    (await leerMatriculaClases(academiaId)).filter((fila) => fila.matricula_id === matriculaId).map((f) => f.clase_id);

  describe('en el catálogo', () => {
    it('criterio 34: matricula_clases tiene la columna agregada_en, timestamptz(3), nula y sin valor por defecto', async () => {
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS obligatoria,
                pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS por_defecto
           FROM pg_catalog.pg_attribute a
           LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = 'public.matricula_clases'::regclass AND a.attname = 'agregada_en' AND NOT a.attisdropped`,
      );

      expect(rows, 'falta la columna matricula_clases.agregada_en (010c)').toHaveLength(1);
      expect(rows[0]).toEqual({ tipo: 'timestamp(3) with time zone', obligatoria: false, por_defecto: null });
    });

    it('criterio 34: la política matricula_clases_borrar es de DELETE, permisiva, con la forma de la 001, y las demás políticas de la tabla siguen (SELECT, INSERT y UPDATE)', async () => {
      const politicas = await conTransaccionRevertida('propietario', undefined, async (cliente) => {
        await cliente.query('SET LOCAL search_path = pg_catalog, public');
        const { rows } = await cliente.query(
          `SELECT n.nspname AS esquema, c.relname AS tabla, p.polname AS nombre, p.polcmd::text AS comando,
                  p.polpermissive AS permisiva,
                  pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS usando,
                  pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS comprobando
             FROM pg_catalog.pg_policy p
             JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = 'matricula_clases'`,
        );
        return rows as PoliticaLeida[];
      });

      const borrar = politicas.find((politica) => politica.nombre === 'matricula_clases_borrar');
      expect(borrar, 'falta la política matricula_clases_borrar (010c)').toBeDefined();
      expect(borrar?.comando, 'DELETE').toBe('d');
      expect(`${borrar?.usando ?? ''}`).toMatch(/academia_id\s*=\s*\(?\s*(SELECT )?\s*app_academia_actual\(\)/);
      expect(politicas.map((politica) => politica.comando).sort()).toEqual(['a', 'd', 'r', 'w']);
      expect(politicas.every((politica) => politica.permisiva)).toBe(true);
      expect(politicas.flatMap(problemasDeLaPolitica)).toEqual([]);
    });

    it('criterio 34: aquagestion_app tiene DELETE en matricula_clases, y sigue sin UPDATE (ni de tabla ni de columna), TRUNCATE, REFERENCES ni TRIGGER', async () => {
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT pg_catalog.has_table_privilege('aquagestion_app', 'public.matricula_clases', 'DELETE') AS "DELETE",
                pg_catalog.has_table_privilege('aquagestion_app', 'public.matricula_clases', 'SELECT') AS "SELECT",
                pg_catalog.has_table_privilege('aquagestion_app', 'public.matricula_clases', 'INSERT') AS "INSERT",
                pg_catalog.has_any_column_privilege('aquagestion_app', 'public.matricula_clases', 'UPDATE') AS "UPDATE",
                pg_catalog.has_table_privilege('aquagestion_app', 'public.matricula_clases', 'TRUNCATE') AS "TRUNCATE",
                pg_catalog.has_any_column_privilege('aquagestion_app', 'public.matricula_clases', 'REFERENCES') AS "REFERENCES",
                pg_catalog.has_table_privilege('aquagestion_app', 'public.matricula_clases', 'TRIGGER') AS "TRIGGER"`,
      );

      expect(rows).toEqual([
        { DELETE: true, SELECT: true, INSERT: true, UPDATE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false },
      ]);
    });

    async function triggersDe(tabla: string): Promise<TriggerLeido[]> {
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT t.tgname AS nombre, t.tgtype::int AS tipo, t.tgenabled::text AS habilitado, t.tgconstraint <> 0 AS es_restriccion,
                p.proname AS funcion, p.prosecdef AS security_definer, p.proconfig AS configuracion,
                coalesce((SELECT bool_or(a.grantee = 0) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), false) AS ejecuta_public
           FROM pg_catalog.pg_trigger t
           JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = ('public.' || $1)::regclass AND NOT t.tgisinternal`,
        [tabla],
      );
      return rows as TriggerLeido[];
    }

    // tgtype: 1 = por fila, 2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE.
    const POR_FILA = 1;
    const ANTES = 2;
    const AL_INSERTAR = 4;
    const AL_BORRAR = 8;
    const AL_ACTUALIZAR = 16;

    it('criterio 34: matricula_clases tiene el trigger matricula_clases_solo_matricula_abierta, BEFORE INSERT OR DELETE por fila, habilitado y sin UPDATE', async () => {
      const trigger = (await triggersDe('matricula_clases')).find((t) => t.nombre === TRIGGER);

      expect(trigger, `falta el trigger ${TRIGGER} (010c)`).toBeDefined();
      expect(trigger!.tipo & POR_FILA, 'por fila').toBeTruthy();
      expect(trigger!.tipo & ANTES, 'BEFORE').toBeTruthy();
      expect(trigger!.tipo & AL_INSERTAR, 'INSERT').toBeTruthy();
      expect(trigger!.tipo & AL_BORRAR, 'DELETE').toBeTruthy();
      expect(trigger!.tipo & AL_ACTUALIZAR, 'no es de UPDATE').toBeFalsy();
      expect(trigger!.es_restriccion, 'un trigger común, no de restricción').toBe(false);
      expect(trigger!.habilitado, 'habilitado siempre (también para el dueño)').toBe('O');
    });

    it('criterio 34: la función del trigger es SECURITY INVOKER, con search_path fijo y sin EXECUTE para PUBLIC (REVOKE ALL … FROM PUBLIC)', async () => {
      const trigger = (await triggersDe('matricula_clases')).find((t) => t.nombre === TRIGGER);

      expect(trigger, `falta el trigger ${TRIGGER} (010c)`).toBeDefined();
      expect(trigger!.security_definer, `${trigger!.funcion} no es SECURITY DEFINER`).toBe(false);
      expect(
        (trigger!.configuracion ?? []).some((valor) => /^search_path=/.test(valor)),
        `${trigger!.funcion} fija su search_path`,
      ).toBe(true);
      expect(trigger!.ejecuta_public, `${trigger!.funcion}: REVOKE ALL … FROM PUBLIC`).toBe(false);
    });
  });

  describe.each(ROLES)('la columna agregada_en, como %s', (rol) => {
    it('criterio 34: una clase agregada sin agregada_en la deja nula (así quedan las de la inscripción y la renovación)', async () => {
      await agregarClase(rol, clienteA.matriculaId, claseA2.id);

      const { rows } = await ejecutarComo(
        'propietario',
        'SELECT clase_id, agregada_en FROM matricula_clases WHERE matricula_id = $1::uuid ORDER BY clase_id',
        [clienteA.matriculaId],
        { academiaId: A.id },
      );
      expect(rows).toHaveLength(2);
      expect((rows as { agregada_en: Date | null }[]).map((fila) => fila.agregada_en)).toEqual([null, null]);
    });

    it('criterio 34: una clase agregada con agregada_en la guarda con milisegundos', async () => {
      await agregarClase(rol, clienteA.matriculaId, claseA2.id, { agregadaEn: AGREGADA_EN });

      const { rows } = await ejecutarComo(
        'propietario',
        'SELECT agregada_en FROM matricula_clases WHERE matricula_id = $1::uuid AND clase_id = $2::uuid',
        [clienteA.matriculaId, claseA2.id],
        { academiaId: A.id },
      );
      expect((rows[0] as { agregada_en: Date }).agregada_en.toISOString()).toBe(AGREGADA_EN.toISOString());
    });
  });

  describe.each(ROLES)('el trigger con una matrícula cerrada, como %s', (rol) => {
    describe.each(['FINALIZADA', 'CANCELADA'])('matrícula %s', (estado) => {
      beforeEach(async () => {
        await ponerEstado(clienteA.matriculaId, estado);
      });

      it('criterio 34: agregar una clase falla con 23514 y no deja la fila', async () => {
        await expect(agregarClase(rol, clienteA.matriculaId, claseA2.id)).rejects.toMatchObject({ code: '23514' });
        await expect(
          agregarClase(rol, clienteA.matriculaId, claseA2.id, { agregadaEn: AGREGADA_EN }),
        ).rejects.toMatchObject({ code: '23514' });

        expect(await clasesDe(A.id, clienteA.matriculaId)).toEqual([claseA1.id]);
      });

      it('criterio 34: borrar una clase falla con 23514 y la fila sigue', async () => {
        await expect(quitarClase(rol, clienteA.matriculaId, claseA1.id)).rejects.toMatchObject({ code: '23514' });

        expect(await clasesDe(A.id, clienteA.matriculaId)).toEqual([claseA1.id]);
      });

      it('criterio 34: borrar todas las clases de la academia con un DELETE sin filtro por matrícula también falla con 23514 y no borra ninguna', async () => {
        await expect(ejecutarComo(rol, 'DELETE FROM matricula_clases', [], { academiaId: A.id })).rejects.toMatchObject(
          { code: '23514' },
        );

        expect(await clasesDe(A.id, clienteA.matriculaId)).toEqual([claseA1.id]);
      });
    });

    describe.each(['RESERVADA', 'VIGENTE'])('matrícula %s (control)', (estado) => {
      beforeEach(async () => {
        await ponerEstado(clienteA.matriculaId, estado);
      });

      it('criterio 34: agregar y borrar una clase se aceptan', async () => {
        await agregarClase(rol, clienteA.matriculaId, claseA2.id, { agregadaEn: AGREGADA_EN });
        expect((await clasesDe(A.id, clienteA.matriculaId)).sort()).toEqual([claseA1.id, claseA2.id].sort());

        const borradas = await quitarClase(rol, clienteA.matriculaId, claseA1.id);

        expect(borradas.rowCount).toBe(1);
        expect(await clasesDe(A.id, clienteA.matriculaId)).toEqual([claseA2.id]);
      });
    });

    it('criterio 34: cierra por defecto: agregar una clase a una matrícula que no existe falla con 23514', async () => {
      await expect(agregarClase(rol, '00000000-0000-4000-8000-000000000999', claseA2.id)).rejects.toMatchObject({
        code: '23514',
      });

      expect(await clasesDe(A.id, clienteA.matriculaId)).toEqual([claseA1.id]);
    });

    it('criterio 34: cierra por defecto: agregar una clase a una matrícula de otra academia (que la sesión no ve) falla con 23514', async () => {
      await expect(agregarClase(rol, clienteB.matriculaId, claseA2.id, { academiaId: A.id })).rejects.toMatchObject({
        code: '23514',
      });

      expect(await clasesDe(B.id, clienteB.matriculaId)).toEqual([claseB1.id]);
    });

    it('criterio 34: un cambio de la matrícula a FINALIZADA con clases (el cierre de mes) no se ve afectado por el trigger', async () => {
      const filas = await actualizarFilas(
        rol,
        'matriculas',
        A.id,
        { id: clienteA.matriculaId },
        { estado: 'FINALIZADA', reserva_vence_en: null },
      );

      expect(filas).toBe(1);
      expect(await clasesDe(A.id, clienteA.matriculaId)).toEqual([claseA1.id]);
    });
  });

  describe('la política de borrado (RLS), como app', () => {
    const comoApp = (sql: string, parametros: unknown[] = [], contexto?: string) =>
      ejecutarComo('app', sql, parametros, contexto === undefined ? undefined : { academiaId: contexto });

    it('criterio 34: borrar con la academia de la sesión una fila de otra academia no borra nada (0 filas, sin error)', async () => {
      const porMatricula = await comoApp(
        'DELETE FROM matricula_clases WHERE matricula_id = $1::uuid',
        [clienteB.matriculaId],
        A.id,
      );
      const porAcademia = await comoApp('DELETE FROM matricula_clases WHERE academia_id = $1::uuid', [B.id], A.id);
      const porClase = await comoApp('DELETE FROM matricula_clases WHERE clase_id = $1::uuid', [claseB1.id], A.id);

      expect([porMatricula.rowCount, porAcademia.rowCount, porClase.rowCount]).toEqual([0, 0, 0]);
      expect(await clasesDe(B.id, clienteB.matriculaId)).toEqual([claseB1.id]);
      expect(await clasesDe(A.id, clienteA.matriculaId)).toEqual([claseA1.id]);
    });

    it('criterio 34: un DELETE sin filtro con la academia A borra solo las filas de A y deja las de B', async () => {
      const borradas = await comoApp('DELETE FROM matricula_clases', [], A.id);

      expect(borradas.rowCount).toBe(1);
      expect(await clasesDe(A.id, clienteA.matriculaId)).toEqual([]);
      expect(await clasesDe(B.id, clienteB.matriculaId)).toEqual([claseB1.id]);
    });

    it('criterio 34: sin academia en la sesión, borrar no borra nada', async () => {
      const borradas = await comoApp('DELETE FROM matricula_clases');

      expect(borradas.rowCount).toBe(0);
      expect(await clasesDe(A.id, clienteA.matriculaId)).toEqual([claseA1.id]);
      expect(await clasesDe(B.id, clienteB.matriculaId)).toEqual([claseB1.id]);
    });

    it('criterio 34 (control): con la academia B, la app sí borra la fila de B', async () => {
      const borradas = await comoApp(
        'DELETE FROM matricula_clases WHERE matricula_id = $1::uuid',
        [clienteB.matriculaId],
        B.id,
      );

      expect(borradas.rowCount).toBe(1);
      expect(await clasesDe(B.id, clienteB.matriculaId)).toEqual([]);
    });
  });
});
