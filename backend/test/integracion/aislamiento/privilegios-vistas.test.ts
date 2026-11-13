// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { cargarPrisma, obtenerBaseDatos } from '../../utilidades/modulos';

// Criterio 125 (ataque ronda 5, F3; complementa el criterio 102): la comprobacion del rol ya calcula los privilegios sobre vistas
// y vistas materializadas de `public` (criterio 102), asi que la prueba lo fija con dos casos mas, como los del criterio 102 (una
// API nueva por caso y restaurando al final): `CREATE MATERIALIZED VIEW public.mv_prueba AS SELECT id, nombre FROM academias` con
// `GRANT SELECT ON mv_prueba TO aquagestion_app`, y `CREATE VIEW public.v_prueba WITH (security_invoker = true) AS SELECT id FROM
// academias` con `GRANT SELECT ON v_prueba TO aquagestion_app`. En cada caso `conAcademia`, `comoPlataforma` y `resolverAcademia`
// rechazan con `ErrorRolBaseDatosInseguro`. Ninguna historia concede privilegios sobre una vista materializada (no pasa por RLS;
// criterio 124). El caso de `db:crear` (codigo 1 nombrando el objeto y el privilegio, sin modificar nada) esta en
// scripts/test/integracion/rol-app-ronda5.test.mjs.
//
// Con las migraciones actuales pasa desde el principio: la comprobacion de la ronda 3 ya incluye `relkind` 'v' y 'm'. Es una guarda.

const APP = 'aquagestion_app';

const LIMPIAR = ['DROP VIEW IF EXISTS public.v_prueba', 'DROP MATERIALIZED VIEW IF EXISTS public.mv_prueba'];

async function limpiarObjetos(): Promise<void> {
  for (const sentencia of LIMPIAR) await ejecutarComo('propietario', sentencia);
}

interface Caso {
  readonly nombre: string;
  readonly preparar: readonly string[];
}

const CASOS: Caso[] = [
  {
    nombre: 'SELECT sobre una vista materializada (mv_prueba)',
    preparar: [
      'CREATE MATERIALIZED VIEW public.mv_prueba AS SELECT id, nombre FROM academias',
      `GRANT SELECT ON public.mv_prueba TO ${APP}`,
    ],
  },
  {
    nombre: 'SELECT sobre una vista con security_invoker = true (v_prueba)',
    preparar: [
      'CREATE VIEW public.v_prueba WITH (security_invoker = true) AS SELECT id FROM academias',
      `GRANT SELECT ON public.v_prueba TO ${APP}`,
    ],
  },
];

describe('criterio 125: la API rechaza un rol con privilegios sobre vistas y vistas materializadas', () => {
  let academia: AcademiaDePrueba;

  beforeAll(limpiarObjetos);
  afterAll(limpiarObjetos);
  beforeEach(async () => {
    await limpiarBase();
    academia = await crearAcademiaDePrueba();
  });
  afterEach(limpiarObjetos);

  it.each(CASOS.map((caso) => [caso.nombre, caso] as const))(
    'criterio 125: %s hace que conAcademia, comoPlataforma y resolverAcademia rechacen con ErrorRolBaseDatosInseguro',
    async (_nombre, caso) => {
      const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
      for (const sentencia of caso.preparar) await ejecutarComo('propietario', sentencia);
      const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
      try {
        const baseDatos = await obtenerBaseDatos(app);
        const trabajo = vi.fn(() => Promise.resolve('no'));

        await expect(baseDatos.conAcademia(academia.id, trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
        await expect(baseDatos.comoPlataforma(trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
        await expect(baseDatos.resolverAcademia(academia.nombreCorto)).rejects.toBeInstanceOf(
          ErrorRolBaseDatosInseguro,
        );
        expect(trabajo).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );

  it('criterio 125 (control): una vista materializada y una vista sin privilegios para la app no hacen rechazar el rol (un privilegio que falta no se rechaza)', async () => {
    await ejecutarComo('propietario', 'CREATE MATERIALIZED VIEW public.mv_prueba AS SELECT id, nombre FROM academias');
    await ejecutarComo(
      'propietario',
      'CREATE VIEW public.v_prueba WITH (security_invoker = true) AS SELECT id FROM academias',
    );
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
      await expect(baseDatos.conAcademia(academia.id, () => Promise.resolve('si'))).resolves.toBe('si');
    } finally {
      await app.close();
    }
  });

  it('criterio 125 (control): con los privilegios del criterio 2 y nada mas, la comprobacion pasa', async () => {
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comoPlataforma(() => Promise.resolve('si'))).resolves.toBe('si');
    } finally {
      await app.close();
    }
  });
});
