import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export type VariablesEntorno = Readonly<Record<string, string | undefined>>;

/**
 * Valida la configuración de la base de pruebas, sin conectarse a ninguna base (spec 000, criterio 19).
 * Lanza un error en español si `DATABASE_URL_PRUEBAS` falta, es igual a `DATABASE_URL` o su base no termina en
 * `_pruebas`. Si es válida, devuelve la URL de la base de pruebas.
 */
export function validarBasePruebas(env: VariablesEntorno): string {
  const pruebas = env['DATABASE_URL_PRUEBAS']?.trim();
  if (!pruebas) {
    throw new Error(
      'Pruebas de integración canceladas: falta DATABASE_URL_PRUEBAS. Defínela en el .env (copia .env.example); ' +
        'su base debe terminar en _pruebas.',
    );
  }
  if (!env['DATABASE_URL']?.trim()) {
    throw new Error('Pruebas de integración canceladas: falta DATABASE_URL en el .env (copia .env.example).');
  }
  if (pruebas === env['DATABASE_URL']?.trim()) {
    throw new Error(
      'Pruebas de integración canceladas: DATABASE_URL_PRUEBAS es igual a DATABASE_URL. ' +
        'Las pruebas borran datos y nunca deben correr contra la base de desarrollo.',
    );
  }
  let nombreBase: string;
  try {
    nombreBase = decodeURIComponent(new URL(pruebas).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('Pruebas de integración canceladas: DATABASE_URL_PRUEBAS no es una URL válida.');
  }
  if (!nombreBase.endsWith('_pruebas')) {
    throw new Error(
      'Pruebas de integración canceladas: el nombre de la base de DATABASE_URL_PRUEBAS debe terminar en _pruebas.',
    );
  }
  return pruebas;
}

/**
 * Combina el entorno del proceso con el .env de la raíz. Las variables ya definidas mandan (por ejemplo, las de la CI).
 * Solo se leen las variables que necesita la base de pruebas, para no contaminar el entorno de las pruebas.
 * El `.env` se lee con `dotenv.parse`, el mismo analizador que usa el backend (spec 001, criterio 172).
 */
export function leerEntornoBases(raiz: string, entorno: VariablesEntorno = process.env): VariablesEntorno {
  const ruta = path.join(raiz, '.env');
  const delArchivo = fs.existsSync(ruta) ? dotenv.parse(fs.readFileSync(ruta, 'utf8')) : {};
  const resultado: Record<string, string | undefined> = {};
  for (const clave of ['DATABASE_URL', 'DATABASE_URL_PRUEBAS']) {
    resultado[clave] = entorno[clave] ?? delArchivo[clave];
  }
  return resultado;
}
