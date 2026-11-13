// spec: 001-academias-aislamiento (pruebas protegidas)
import { expect } from 'vitest';
import { ejecutarComo } from './base-datos';
import type { BaseDatosRonda3 } from './ronda3';

/**
 * Ayudas de las pruebas protegidas de la ronda 12 del ataque (criterios 156 a 158): consultas encadenadas sin `await` dentro de
 * `trabajo` y escrituras de un delegado con relaciones anidadas que fallan a medias. Todo lo escrito se lee como duenio, con una
 * conexion nueva.
 */

export {
  contarAuditoriaDeAcademia,
  contarAuditoriaDePlataforma,
  ignorarP2025,
  leerAcademiasPorPrefijo,
  leerConfiguraciones,
  leerValorDeConfiguracion,
  nada,
} from './ronda11';

let contador = 0;
/** Un numero distinto por caso ejecutado en este proceso: claves `prueba_r12_<n>`, nombres cortos `prueba-r12-<n>` y acciones `PRUEBA_R12_<n>`. */
export function siguienteNumero(): number {
  contador += 1;
  return contador;
}
/** La clave cumple `^[a-z][a-z0-9_]{0,63}$`: los sufijos con guion ('-a', '-1') van con `_`. */
export const claveDe = (n: number, sufijo = ''): string => `prueba_r12_${n}${sufijo.replaceAll('-', '_')}`;
export const nombreCortoDe = (n: number, sufijo = ''): string => `prueba-r12-${n}${sufijo}`;
export const accionDe = (n: number): string => `PRUEBA_R12_${n}`;

/** Valor reconocible que devuelve `trabajo`: si una llamada resuelve con el, la transaccion se reporto como confirmada. */
export const VALOR = 'valor-reconocible-r12';

/** Los delegados que usan estas pruebas, con la forma amplia que tiene el envoltorio (criterio 100). */
export interface DelegadosRonda12 {
  configuracion: {
    create(argumentos: object): Promise<unknown>;
    createMany(argumentos: object): Promise<unknown>;
    createManyAndReturn(argumentos: object): Promise<unknown>;
    update(argumentos: object): Promise<unknown>;
    updateMany(argumentos: object): Promise<unknown>;
    updateManyAndReturn(argumentos: object): Promise<unknown>;
    upsert(argumentos: object): Promise<unknown>;
    delete(argumentos: object): Promise<unknown>;
    deleteMany(argumentos: object): Promise<unknown>;
    findMany(argumentos?: object): Promise<unknown>;
  };
  academia: {
    create(argumentos: object): Promise<unknown>;
    update(argumentos: object): Promise<unknown>;
  };
}

/** Estado de una academia leido como duenio. */
export interface EstadoDeAcademia {
  readonly estado: string;
  readonly suspendida_en: Date | null;
  readonly motivo_suspension: string | null;
  readonly actualizada_en: Date;
}

export async function leerEstadoDeAcademia(academiaId: string): Promise<EstadoDeAcademia | undefined> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT estado::text AS estado, suspendida_en, motivo_suspension, actualizada_en FROM academias WHERE id = $1::uuid',
    [academiaId],
    { plataforma: true },
  );
  return rows[0] as EstadoDeAcademia | undefined;
}

/**
 * Con `DATABASE_POOL_MAX=1`, la siguiente transaccion usa la misma conexion: `conAcademia(B, ...)` resuelve, lee su propio contexto
 * (criterio 23) y no ve nada del caso (nada con la clave `prueba_r12_`).
 */
export async function esperarConexionSana(base: BaseDatosRonda3, academiaIdB: string, contexto: string): Promise<void> {
  const visto = await base.conAcademia(academiaIdB, async (tx) => {
    const filas = await tx.cliente.$queryRaw<
      { academia: string | null; plataforma: string | null; del_caso: number; propias: number }[]
    >`SELECT current_setting('app.academia_id', true) AS academia, current_setting('app.plataforma', true) AS plataforma,
        (SELECT count(*)::int FROM configuraciones WHERE starts_with(clave, 'prueba_r12_')) AS del_caso,
        (SELECT count(*)::int FROM configuraciones) AS propias`;
    return filas[0];
  });
  expect(visto?.academia?.toLowerCase(), `${contexto}: contexto de B`).toBe(academiaIdB.toLowerCase());
  expect(visto?.plataforma, `${contexto}: no debe quedar el contexto de plataforma`).not.toBe('si');
  expect(visto?.del_caso, `${contexto}: B no ve nada del caso`).toBe(0);
  expect(visto?.propias, `${contexto}: B ve sus propias configuraciones`).toBe(4);
}
