/** Variables de entorno que lee la API, ya validadas. La API ya no lee `DATABASE_URL` (spec 001, criterio 5). */
export interface Entorno {
  /** Conexión del rol `aquagestion_app`, sin privilegios y sujeto a la seguridad por academia (RLS). */
  readonly DATABASE_URL_APP: string;
  /** Conexiones simultáneas de la API a la base (1 a 100, por defecto 10). */
  readonly DATABASE_POOL_MAX: number;
  /** Secreto para firmar las sesiones: al menos 32 caracteres. */
  readonly JWT_SECRETO: string;
  readonly PUERTO_API: number;
  readonly NODE_ENV: string | undefined;
}

/** Error de configuración: agrupa los problemas encontrados. Los mensajes nombran la variable, nunca su valor. */
export class ErrorEntorno extends Error {
  constructor(readonly problemas: readonly string[]) {
    super(`Configuración inválida:\n${problemas.map((problema) => `- ${problema}`).join('\n')}`);
    this.name = 'ErrorEntorno';
  }
}

/**
 * Valor de `JWT_SECRETO` en `.env.example`. Es público: con `NODE_ENV=production` la API se niega a usarlo. Una
 * prueba unitaria comprueba que coincide con `.env.example`.
 */
export const JWT_SECRETO_DE_EJEMPLO = 'solo-desarrollo-cambia-este-secreto-de-ejemplo-0001';

const PUERTO_API_POR_DEFECTO = 3000;
const POOL_MAXIMO_POR_DEFECTO = 10;
const POOL_MINIMO = 1;
const POOL_MAXIMO = 100;
const JWT_SECRETO_LARGO_MINIMO = 32;

function esUrlPostgres(valor: string): boolean {
  try {
    const { protocol } = new URL(valor);
    return protocol === 'postgresql:' || protocol === 'postgres:';
  } catch {
    return false;
  }
}

function esPuertoValido(valor: string): boolean {
  if (!/^\d+$/.test(valor)) return false;
  const numero = Number(valor);
  return numero >= 1 && numero <= 65535;
}

function esPoolValido(valor: string): boolean {
  if (!/^\d+$/.test(valor)) return false;
  const numero = Number(valor);
  return numero >= POOL_MINIMO && numero <= POOL_MAXIMO;
}

/**
 * Valida las variables de entorno de la API. Es una función pura: recibe el entorno y devuelve la configuración
 * o lanza `ErrorEntorno`. Nunca incluye valores de variables en los mensajes.
 */
export function validarEntorno(env: Readonly<Record<string, string | undefined>>): Entorno {
  const problemas: string[] = [];

  const urlApp = env['DATABASE_URL_APP']?.trim();
  if (!urlApp) {
    problemas.push('Falta la variable DATABASE_URL_APP.');
  } else if (!esUrlPostgres(urlApp)) {
    problemas.push('La variable DATABASE_URL_APP debe ser una URL de PostgreSQL (postgresql:// o postgres://).');
  }

  const secreto = env['JWT_SECRETO'];
  const nodeEnv = env['NODE_ENV'];
  if (!secreto) {
    problemas.push('Falta la variable JWT_SECRETO.');
  } else if (secreto.length < JWT_SECRETO_LARGO_MINIMO) {
    problemas.push(`La variable JWT_SECRETO debe tener al menos ${JWT_SECRETO_LARGO_MINIMO} caracteres.`);
  } else if (nodeEnv === 'production' && secreto === JWT_SECRETO_DE_EJEMPLO) {
    problemas.push('La variable JWT_SECRETO no puede ser la de ejemplo de .env.example en producción.');
  }

  const poolTexto = env['DATABASE_POOL_MAX']?.trim();
  let pool = POOL_MAXIMO_POR_DEFECTO;
  if (poolTexto) {
    if (esPoolValido(poolTexto)) pool = Number(poolTexto);
    else
      problemas.push(`La variable DATABASE_POOL_MAX debe ser un número entero entre ${POOL_MINIMO} y ${POOL_MAXIMO}.`);
  }

  const puertoTexto = env['PUERTO_API']?.trim();
  let puerto = PUERTO_API_POR_DEFECTO;
  if (puertoTexto) {
    if (esPuertoValido(puertoTexto)) puerto = Number(puertoTexto);
    else problemas.push('La variable PUERTO_API debe ser un número entero entre 1 y 65535.');
  }

  if (problemas.length > 0 || !urlApp || !secreto) throw new ErrorEntorno(problemas);
  return {
    DATABASE_URL_APP: urlApp,
    DATABASE_POOL_MAX: pool,
    JWT_SECRETO: secreto,
    PUERTO_API: puerto,
    NODE_ENV: nodeEnv,
  };
}
