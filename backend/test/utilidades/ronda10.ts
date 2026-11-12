// spec: 001-academias-aislamiento (pruebas protegidas)
import { expect } from 'vitest';
import type { ClienteTransaccion } from '../../src/infraestructura/prisma';
import { insertarEnAuditoriaPlataforma } from '../../src/modulos/auditoria/insercion';
import { ejecutarComo } from './base-datos';
import { leerAuditoriaDeAcademia, leerAuditoriaPlataforma } from './datos';
import type { AuditoriaServicePrueba } from './modulos';
import { cargarPuntoAutorizado } from './ronda4';
import {
  cargarFuncionalidad,
  esperarCondicion,
  type BaseDatosRonda3,
  type TransaccionAcademiaRonda3,
  type TransaccionPlataformaRonda3,
} from './ronda3';

/**
 * Ayudas de las pruebas protegidas de la ronda 10 del ataque (criterios 149 a 152): una transaccion abortada nunca se reporta
 * como confirmada. Cada "variante" es un `trabajo` que primero escribe (una fila o una academia y un registro de auditoria) y
 * despues hace algo con un error de la base; el contrato dice que, si `trabajo` termina bien con la transaccion abortada, la
 * llamada rechaza con `ErrorTransaccionAbortada` (P-36) y no queda nada escrito.
 */

/** Valor reconocible que devuelve `trabajo`: si una llamada resuelve con el, la transaccion se reporto como confirmada. */
export const VALOR = 'valor-reconocible-r10';

/** Texto que viaja como parametro de las consultas: nunca debe aparecer en el registro tecnico (criterio 149). */
export const SENTINELA = 'SENTINELA-R10';

export type Variante =
  | 'unicidad' // 149.1: inserta un duplicado sin ON CONFLICT, atrapa con esViolacionDeUnicidad y devuelve el valor
  | 'error-try' // 149.2: SELECT 1/0 dentro de try/catch vacio
  | 'error-catch' // 149.2: SELECT 1/0 con .catch(() => undefined)
  | 'sin-await-cruda' // 149.3: consulta cruda lenta que falla despues de que trabajo termino, sin await
  | 'sin-await-modelo' // 149.3: consulta de un modelo que falla, sin await
  | 'rollback' // 151: ROLLBACK escrito dentro de trabajo
  | 'commit' // 151: COMMIT escrito dentro de trabajo
  | 'sin-fallo' // control: sin el paso que falla
  | 'sin-await-ok' // control: consulta lenta sin await que NO falla
  | 'relanza-unicidad' // control: el duplicado se atrapa y se relanza (23505)
  | 'relanza-division' // control: SELECT 1/0 se atrapa y se relanza (22012)
  | 'relanza-propio'; // control: SELECT 1/0 atrapado y despues se lanza un error propio

export const VARIANTES_149: readonly { readonly variante: Variante; readonly titulo: string }[] = [
  { variante: 'unicidad', titulo: 'variante 1, reintento que atrapa esViolacionDeUnicidad tras una escritura previa' },
  { variante: 'error-try', titulo: 'variante 2, SELECT 1/0 atrapado con try/catch vacio' },
  { variante: 'error-catch', titulo: 'variante 2, SELECT 1/0 atrapado con .catch(() => undefined)' },
  {
    variante: 'sin-await-cruda',
    titulo: 'variante 3, consulta cruda sin await que falla despues de que trabajo termina',
  },
  { variante: 'sin-await-modelo', titulo: 'variante 3, consulta de un modelo sin await que falla' },
];

/** Lo que `correrVariante` anota para que la prueba compruebe el orden de los hechos. */
export interface Seguimiento {
  terminoEn?: number;
  falloEn?: number;
  errorPropio?: Error;
}

/** Los pasos concretos de cada contexto (academia, plataforma o comando); `correrVariante` los combina. */
export interface Pasos {
  /** La escritura previa: una fila (o una academia) nueva y su registro de auditoria. */
  escribir(): Promise<void>;
  /** Inserta un duplicado sin `ON CONFLICT`: rechaza con 23505. */
  duplicar(): Promise<unknown>;
  /** `SELECT 1/0`: rechaza con 22012. */
  dividirPorCero(): Promise<unknown>;
  /** Una consulta cruda que tarda unos 200 ms y despues falla (22012). Se envia al llamarla. */
  lentaQueFalla(): Promise<unknown>;
  /** Una consulta cruda que tarda unos 200 ms y termina bien. */
  lentaQueNoFalla(): Promise<unknown>;
  /** La consulta de un modelo que falla (clave que ya existe). Ausente donde no aplica (`enPlataforma`). */
  modeloQueFalla?(): Promise<unknown>;
  /** `ROLLBACK` o `COMMIT` ejecutados con `$executeRaw`. */
  sentenciaDeControl(sentencia: 'ROLLBACK' | 'COMMIT'): Promise<unknown>;
}

/** Ejecuta la variante dentro del `trabajo` de la prueba y devuelve `VALOR` (o lanza, en las variantes que relanzan). */
export async function correrVariante(variante: Variante, pasos: Pasos, seguimiento: Seguimiento = {}): Promise<string> {
  const { esViolacionDeUnicidad } = await cargarPuntoAutorizado();
  const sinAwait = (consulta: Promise<unknown>): void => {
    void consulta.catch(() => {
      seguimiento.falloEn = performance.now();
    });
  };
  switch (variante) {
    case 'sin-fallo':
      await pasos.escribir();
      return VALOR;
    case 'unicidad':
      await pasos.escribir();
      try {
        await pasos.duplicar();
      } catch (error) {
        if (!esViolacionDeUnicidad(error)) throw error;
      }
      return VALOR;
    case 'relanza-unicidad':
      await pasos.escribir();
      await pasos.duplicar();
      return VALOR;
    case 'error-try':
      await pasos.escribir();
      try {
        await pasos.dividirPorCero();
      } catch {
        // Atrapado a proposito: la transaccion queda abortada.
      }
      return VALOR;
    case 'error-catch':
      await pasos.escribir();
      await pasos.dividirPorCero().catch(() => undefined);
      return VALOR;
    case 'relanza-division':
      await pasos.escribir();
      await pasos.dividirPorCero();
      return VALOR;
    case 'relanza-propio':
      await pasos.escribir();
      try {
        await pasos.dividirPorCero();
      } catch {
        // Atrapado a proposito; despues se lanza otro error.
      }
      throw seguimiento.errorPropio ?? new Error('error propio de la prueba');
    case 'sin-await-cruda':
      await pasos.escribir();
      sinAwait(pasos.lentaQueFalla());
      seguimiento.terminoEn = performance.now();
      return VALOR;
    case 'sin-await-modelo': {
      await pasos.escribir();
      if (pasos.modeloQueFalla === undefined) throw new Error('Esta variante no aplica en este contexto.');
      sinAwait(pasos.modeloQueFalla());
      seguimiento.terminoEn = performance.now();
      return VALOR;
    }
    case 'sin-await-ok':
      await pasos.escribir();
      void pasos.lentaQueNoFalla().catch(() => undefined);
      seguimiento.terminoEn = performance.now();
      return VALOR;
    case 'rollback':
      await pasos.escribir();
      await pasos.sentenciaDeControl('ROLLBACK');
      return VALOR;
    case 'commit':
      await pasos.escribir();
      await pasos.sentenciaDeControl('COMMIT');
      return VALOR;
  }
}

let contador = 0;
/** Un numero distinto por variante ejecutada en este proceso: `prueba_r10_<n>`, `prueba-r10-<n>` y `PRUEBA_R10_<n>`. */
export function siguienteNumero(): number {
  contador += 1;
  return contador;
}
export const claveDe = (n: number): string => `prueba_r10_${n}`;
export const nombreCortoDe = (n: number): string => `prueba-r10-${n}`;
export const accionDe = (n: number): string => `PRUEBA_R10_${n}`;

interface ModelosAmplios {
  configuracion: { create(argumentos: object): Promise<unknown> };
  academia: { create(argumentos: object): Promise<unknown> };
}

/** Pasos de `conAcademia(academiaId, ...)`: escribe en `configuraciones` y audita con `registrarEnAcademia`. */
export function pasosDeAcademia(
  auditoria: AuditoriaServicePrueba,
  tx: TransaccionAcademiaRonda3,
  n: number,
  claveExistente = 'clave_a_1',
): Pasos {
  const c = tx.cliente;
  return {
    async escribir() {
      await c.$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
        VALUES (${tx.academiaId}::uuid, ${claveDe(n)}, ${JSON.stringify({ sentinela: SENTINELA })}::jsonb, now())`;
      await auditoria.registrarEnAcademia(tx, {
        actorTipo: 'SISTEMA',
        actorId: null,
        accion: accionDe(n),
        entidad: 'prueba',
        entidadId: null,
        datosDespues: { sentinela: SENTINELA },
      });
    },
    duplicar: () =>
      c.$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
        VALUES (${tx.academiaId}::uuid, ${claveExistente}, '{}'::jsonb, now())`,
    dividirPorCero: () => c.$queryRaw`SELECT 1/0`,
    lentaQueFalla: () => c.$queryRaw`SELECT 1 / (SELECT 0 FROM pg_catalog.pg_sleep(0.2))`,
    lentaQueNoFalla: () => c.$queryRaw`SELECT 1 AS uno FROM pg_catalog.pg_sleep(0.2)`,
    modeloQueFalla: () =>
      (c as unknown as ModelosAmplios).configuracion.create({
        data: { academiaId: tx.academiaId, clave: claveExistente, valor: {} },
      }),
    sentenciaDeControl: (sentencia) => (sentencia === 'ROLLBACK' ? c.$executeRaw`ROLLBACK` : c.$executeRaw`COMMIT`),
  };
}

/** Pasos de `comoPlataforma(...)`: crea una academia nueva y audita con `registrarEnPlataforma`. */
export function pasosDePlataforma(
  auditoria: AuditoriaServicePrueba,
  tx: TransaccionPlataformaRonda3,
  n: number,
  nombreCortoExistente = 'academia-a',
): Pasos {
  const c = tx.cliente;
  return {
    async escribir() {
      await c.$executeRaw`INSERT INTO academias (id, nombre, nombre_corto, estado, creada_en, actualizada_en)
        VALUES (gen_random_uuid(), ${`Academia ${SENTINELA} ${n}`}, ${nombreCortoDe(n)}, 'ACTIVA'::estado_academia, now(), now())`;
      await auditoria.registrarEnPlataforma(tx, {
        actorTipo: 'SISTEMA',
        actorId: null,
        accion: accionDe(n),
        entidad: 'prueba',
        entidadId: null,
        datosDespues: { sentinela: SENTINELA },
      });
    },
    duplicar: () =>
      c.$executeRaw`INSERT INTO academias (id, nombre, nombre_corto, estado, creada_en, actualizada_en)
        VALUES (gen_random_uuid(), 'Duplicada', ${nombreCortoExistente}, 'ACTIVA'::estado_academia, now(), now())`,
    dividirPorCero: () => c.$queryRaw`SELECT 1/0`,
    lentaQueFalla: () => c.$queryRaw`SELECT 1 / (SELECT 0 FROM pg_catalog.pg_sleep(0.2))`,
    lentaQueNoFalla: () => c.$queryRaw`SELECT 1 AS uno FROM pg_catalog.pg_sleep(0.2)`,
    modeloQueFalla: () =>
      (c as unknown as ModelosAmplios).academia.create({
        data: { nombre: 'Duplicada', nombreCorto: nombreCortoExistente },
      }),
    sentenciaDeControl: (sentencia) => (sentencia === 'ROLLBACK' ? c.$executeRaw`ROLLBACK` : c.$executeRaw`COMMIT`),
  };
}

/**
 * Pasos de `enPlataforma(cliente, ...)` (comandos y semilla): la transaccion completa de Prisma, una academia nueva y un registro
 * con `insertarEnAuditoriaPlataforma`. La consulta sin `await` se envia con `$executeRaw(...).catch(...)` (una `PrismaPromise` sin
 * `then` ni `catch` no se envia). No hay variante de modelo: riesgo aceptado del criterio 150.
 */
export function pasosDeEnPlataforma(tx: ClienteTransaccion, n: number, nombreCortoExistente = 'academia-a'): Pasos {
  return {
    async escribir() {
      await tx.$executeRaw`INSERT INTO academias (id, nombre, nombre_corto, estado, creada_en, actualizada_en)
        VALUES (gen_random_uuid(), ${`Academia ${SENTINELA} ${n}`}, ${nombreCortoDe(n)}, 'ACTIVA', now(), now())`;
      await insertarEnAuditoriaPlataforma(tx, new Date(), {
        actorTipo: 'SISTEMA',
        actorId: null,
        accion: accionDe(n),
        entidad: 'prueba',
        entidadId: null,
        datosDespues: { sentinela: SENTINELA },
      });
    },
    duplicar: () =>
      tx.$executeRaw`INSERT INTO academias (id, nombre, nombre_corto, estado, creada_en, actualizada_en)
        VALUES (gen_random_uuid(), 'Duplicada', ${nombreCortoExistente}, 'ACTIVA', now(), now())`,
    dividirPorCero: () => tx.$executeRaw`SELECT 1/0`,
    lentaQueFalla: () => tx.$executeRaw`SELECT 1 / (SELECT 0 FROM pg_catalog.pg_sleep(0.2))`,
    lentaQueNoFalla: () => tx.$executeRaw`SELECT 1 AS uno FROM pg_catalog.pg_sleep(0.2)`,
    sentenciaDeControl: (sentencia) => (sentencia === 'ROLLBACK' ? tx.$executeRaw`ROLLBACK` : tx.$executeRaw`COMMIT`),
  };
}

export interface Resultado {
  readonly resolvio: boolean;
  readonly valor?: unknown;
  readonly error?: unknown;
}

/** Ejecuta `llamada` y devuelve si resolvio (con que valor) o rechazo (con que error). */
export async function resultadoDe(llamada: () => Promise<unknown>): Promise<Resultado> {
  try {
    return { resolvio: true, valor: await llamada() };
  } catch (error) {
    return { resolvio: false, error };
  }
}

interface ModuloErrores {
  ErrorTransaccionAbortada: new (opciones?: { readonly cause?: unknown }) => Error;
}

/** `ErrorTransaccionAbortada` de `infraestructura/prisma/index.ts` (P-36); si falta, falla con "falta la funcionalidad". */
export function cargarErrorTransaccionAbortada(): Promise<ModuloErrores> {
  return cargarFuncionalidad<ModuloErrores>('infraestructura/prisma/index.ts', ['ErrorTransaccionAbortada']);
}

/** La llamada debia rechazar con `ErrorTransaccionAbortada` (P-36: 500 `ERROR_INTERNO`), nunca resolver con el valor de `trabajo`. */
export async function esperarTransaccionAbortada(resultado: Resultado, contexto: string): Promise<void> {
  expect(
    resultado.resolvio,
    `${contexto}: debia rechazar con ErrorTransaccionAbortada y resolvio con ${JSON.stringify(resultado.valor)}`,
  ).toBe(false);
  const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
  expect(resultado.error, contexto).toBeInstanceOf(ErrorTransaccionAbortada);
  expect(resultado.error).toMatchObject({ name: 'ErrorTransaccionAbortada', estado: 500, codigo: 'ERROR_INTERNO' });
}

/** La llamada rechazo con un error que NO es `ErrorTransaccionAbortada` (se compara por nombre: no hace falta cargar la clase). */
export function esperarRechazoPropio(resultado: Resultado, contexto: string): unknown {
  expect(resultado.resolvio, `${contexto}: debia rechazar y resolvio con ${JSON.stringify(resultado.valor)}`).toBe(
    false,
  );
  expect(
    (resultado.error as { name?: unknown } | undefined)?.name,
    `${contexto}: no debia ser ErrorTransaccionAbortada`,
  ).not.toBe('ErrorTransaccionAbortada');
  return resultado.error;
}

/** Que paso con el orden: `trabajo` termino antes de que la consulta enviada sin `await` fallara. */
export async function esperarFalloPosterior(seguimiento: Seguimiento): Promise<void> {
  await esperarCondicion(() => seguimiento.falloEn !== undefined, 2000);
  expect(seguimiento.terminoEn, 'trabajo debia terminar').toBeDefined();
  expect(seguimiento.falloEn, 'la consulta enviada sin await debia fallar').toBeDefined();
  expect(
    seguimiento.terminoEn as number,
    'trabajo debia terminar antes de que la consulta enviada sin await fallara',
  ).toBeLessThan(seguimiento.falloEn as number);
}

/** Lo que quedo escrito de la variante `n`, leido como duenio con una conexion nueva. */
export interface Escrito {
  readonly filas: number;
  readonly auditoria: number;
}

/** `configuraciones` (clave `prueba_r10_<n>`) y registros `PRUEBA_R10_<n>` de la academia `academiaId`. */
export async function leerEscritoDeAcademia(academiaId: string, n: number): Promise<Escrito> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT count(*)::int AS n FROM configuraciones WHERE academia_id = $1::uuid AND clave = $2',
    [academiaId, claveDe(n)],
    { academiaId },
  );
  return {
    filas: (rows[0] as { n: number }).n,
    auditoria: (await leerAuditoriaDeAcademia(academiaId, accionDe(n))).length,
  };
}

/** La academia `prueba-r10-<n>` y los registros `PRUEBA_R10_<n>` de `auditoria_plataforma`. */
export async function leerEscritoDePlataforma(n: number): Promise<Escrito> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT count(*)::int AS n FROM academias WHERE nombre_corto = $1',
    [nombreCortoDe(n)],
    { plataforma: true },
  );
  return {
    filas: (rows[0] as { n: number }).n,
    auditoria: (await leerAuditoriaPlataforma(accionDe(n))).length,
  };
}

export const NADA: Escrito = { filas: 0, auditoria: 0 };
export const TODO: Escrito = { filas: 1, auditoria: 1 };

/**
 * Con `DATABASE_POOL_MAX=1`, la siguiente transaccion usa la misma conexion: `conAcademia(B, ...)` resuelve, lee su propio contexto
 * (criterio 23) y no ve nada de la variante.
 */
export async function esperarConexionSana(base: BaseDatosRonda3, academiaIdB: string, contexto: string): Promise<void> {
  const visto = await base.conAcademia(academiaIdB, async (tx) => {
    const filas = await tx.cliente.$queryRaw<
      { academia: string | null; plataforma: string | null; de_la_variante: number; propias: number }[]
    >`SELECT current_setting('app.academia_id', true) AS academia, current_setting('app.plataforma', true) AS plataforma,
        (SELECT count(*)::int FROM configuraciones WHERE starts_with(clave, 'prueba_r10_')) AS de_la_variante,
        (SELECT count(*)::int FROM configuraciones) AS propias`;
    return filas[0];
  });
  expect(visto?.academia?.toLowerCase(), `${contexto}: contexto de B`).toBe(academiaIdB.toLowerCase());
  expect(visto?.plataforma, `${contexto}: no debe quedar el contexto de plataforma`).not.toBe('si');
  expect(visto?.de_la_variante, `${contexto}: B no ve nada de la variante`).toBe(0);
  expect(visto?.propias, `${contexto}: B ve sus propias configuraciones`).toBe(4);
}
