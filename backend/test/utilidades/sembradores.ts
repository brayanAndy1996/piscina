// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomBytes, randomUUID } from 'node:crypto';
import { ejecutarComo } from './base-datos';

/**
 * Sembradores por tabla de academia (criterio 133, precision P-33). La prueba de ejecucion de `rls-todas-las-tablas.test.ts`
 * descubre en el catalogo TODA tabla con `academia_id` y exige un sembrador en `SEMBRADORES_POR_TABLA`; si falta, falla nombrando la
 * tabla (como la lista del criterio 10).
 *
 * Un sembrador inserta al menos una fila de esa academia, corre como dueno con el contexto de esa academia (sirve con un dueno
 * superusuario o no: con `FORCE ROW LEVEL SECURITY` el dueno tambien pasa por las politicas) y crea, si las necesita, las filas padre
 * de la MISMA academia. Para una tabla particionada o una particion sirve el sembrador de la tabla padre (la fila cae en la
 * particion). Clave del registro: `'esquema.tabla'`.
 *
 * Cada historia que agregue una tabla con `academia_id` agrega aqui su sembrador, en sus pruebas protegidas.
 */
export type Sembrador = (academiaId: string) => Promise<void>;

/** Una clave de `configuraciones` que cumple el CHECK (`^[a-z][a-z0-9_]{0,63}$`) y no se repite. */
const claveAleatoria = (): string => `sembrada_${randomBytes(8).toString('hex')}`;

export const SEMBRADORES_POR_TABLA: Readonly<Record<string, Sembrador>> = {
  // hoy: 'public.auditoria' y 'public.configuraciones'.
  'public.auditoria': async (academiaId) => {
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.auditoria (id, academia_id, fecha_hora, actor_tipo, accion, entidad)
       VALUES ($1::uuid, $2::uuid, now(), 'SISTEMA', 'SEMBRADA_PARA_RLS', 'prueba')`,
      [randomUUID(), academiaId],
      { academiaId },
    );
  },
  'public.configuraciones': async (academiaId) => {
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.configuraciones (academia_id, clave, valor, actualizado_en)
       VALUES ($1::uuid, $2, '{}'::jsonb, now())`,
      [academiaId, claveAleatoria()],
      { academiaId },
    );
  },
};
