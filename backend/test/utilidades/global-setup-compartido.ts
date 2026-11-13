// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import prepararBasePruebas from './global-setup';

/**
 * Preparacion de la base de pruebas compartida por los proyectos `backend-integracion` y `backend-aislado`. Todos los
 * `globalSetup` de los proyectos corren en el mismo proceso y el primero que corra (el orden entre proyectos no esta fijado) deja
 * `DATABASE_URL` igual a `DATABASE_URL_PRUEBAS`, lo que una segunda llamada a `global-setup.ts` rechazaria ("es igual a
 * DATABASE_URL").
 *
 * La segunda llamada solo se salta la preparacion si encuentra la MARCA que dejo la primera llamada al terminar con exito (un
 * simbolo en `globalThis` con un valor aleatorio), nunca por deducirlo de las URL. Aun asi vuelve a validar que `DATABASE_URL`,
 * `DATABASE_URL_PRUEBAS` y `DATABASE_URL_APP` apuntan a una base cuyo nombre termina en `_pruebas`, que `DATABASE_URL_PRUEBAS`
 * es la que fijo la primera llamada y que `DATABASE_URL_APP` apunta a la misma base (servidor, puerto y nombre) que
 * `DATABASE_URL_PRUEBAS`. Sin la marca se ejecuta siempre la preparacion normal, que rechaza una base de desarrollo.
 */
export const MARCA_BASE_PREPARADA = Symbol.for('aquagestion.base-de-pruebas-preparada');

export interface MarcaDePreparacion {
  readonly id: string;
  readonly urlPruebas: string;
}

type Variables = Record<string, string | undefined>;

export interface DependenciasDeLaPreparacion {
  /** La preparacion normal (valida, migra y fija las variables). Por defecto, `global-setup.ts`. */
  readonly preparar: () => void;
  /** Variables de entorno que se leen y se fijan. Por defecto, `process.env`. */
  readonly entorno: Variables;
  /** Donde se deja la marca. Por defecto, `globalThis`. */
  readonly almacen: Record<symbol, unknown>;
}

function baseDe(nombre: string, valor: string | undefined): { servidor: string; base: string } {
  if (!valor?.trim()) throw new Error(`Pruebas de integración canceladas: falta ${nombre}.`);
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`Pruebas de integración canceladas: ${nombre} no es una URL válida.`);
  }
  const base = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!base.endsWith('_pruebas')) {
    throw new Error(
      `Pruebas de integración canceladas: la base de ${nombre} debe terminar en _pruebas (las pruebas borran datos).`,
    );
  }
  return { servidor: `${url.hostname}:${url.port}`, base };
}

/** Vuelve a validar las tres URL cuando la preparacion ya se hizo. Lanza un error en español si algo no cuadra. */
function validarPreparada(entorno: Variables, marca: MarcaDePreparacion): void {
  baseDe('DATABASE_URL', entorno['DATABASE_URL']);
  const pruebas = baseDe('DATABASE_URL_PRUEBAS', entorno['DATABASE_URL_PRUEBAS']);
  const app = baseDe('DATABASE_URL_APP', entorno['DATABASE_URL_APP']);
  if (entorno['DATABASE_URL_PRUEBAS'] !== marca.urlPruebas || entorno['DATABASE_URL'] !== marca.urlPruebas) {
    throw new Error(
      'Pruebas de integración canceladas: DATABASE_URL o DATABASE_URL_PRUEBAS cambiaron despues de preparar la base de pruebas.',
    );
  }
  if (app.servidor !== pruebas.servidor || app.base !== pruebas.base) {
    throw new Error(
      'Pruebas de integración canceladas: DATABASE_URL_APP no apunta a la misma base que DATABASE_URL_PRUEBAS.',
    );
  }
}

/** Crea la funcion de preparacion con sus dependencias (para probarla sin migrar ninguna base). */
export function crearPreparacionUnaVez(dependencias: DependenciasDeLaPreparacion): () => void {
  const { preparar, entorno, almacen } = dependencias;
  return () => {
    const marca = almacen[MARCA_BASE_PREPARADA] as MarcaDePreparacion | undefined;
    if (marca !== undefined) {
      validarPreparada(entorno, marca);
      return;
    }
    preparar();
    const urlPruebas = entorno['DATABASE_URL_PRUEBAS'];
    if (urlPruebas === undefined) throw new Error('La preparacion de la base de pruebas no fijo DATABASE_URL_PRUEBAS.');
    almacen[MARCA_BASE_PREPARADA] = { id: randomUUID(), urlPruebas } satisfies MarcaDePreparacion;
  };
}

export default function prepararBasePruebasUnaVez(): void {
  crearPreparacionUnaVez({
    preparar: prepararBasePruebas,
    entorno: process.env,
    almacen: globalThis,
  })();
}
