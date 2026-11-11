/** Variables de entorno que lee la API, ya validadas. */
export interface Entorno {
  readonly DATABASE_URL: string;
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

const PUERTO_API_POR_DEFECTO = 3000;

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

/**
 * Valida las variables de entorno de la API. Es una función pura: recibe el entorno y devuelve la configuración
 * o lanza `ErrorEntorno`. Nunca incluye valores de variables en los mensajes.
 */
export function validarEntorno(env: Readonly<Record<string, string | undefined>>): Entorno {
  const problemas: string[] = [];

  const url = env['DATABASE_URL']?.trim();
  if (!url) {
    problemas.push('Falta la variable DATABASE_URL.');
  } else if (!esUrlPostgres(url)) {
    problemas.push('La variable DATABASE_URL debe ser una URL de PostgreSQL (postgresql:// o postgres://).');
  }

  const puertoTexto = env['PUERTO_API']?.trim();
  let puerto = PUERTO_API_POR_DEFECTO;
  if (puertoTexto) {
    if (esPuertoValido(puertoTexto)) puerto = Number(puertoTexto);
    else problemas.push('La variable PUERTO_API debe ser un número entero entre 1 y 65535.');
  }

  if (problemas.length > 0 || !url) throw new ErrorEntorno(problemas);

  return { DATABASE_URL: url, PUERTO_API: puerto, NODE_ENV: env['NODE_ENV'] };
}
