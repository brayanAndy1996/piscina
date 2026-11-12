/**
 * Opciones de `dotenv.config` para cargar el `.env` de la raíz (spec 001, criterio 175, P-45).
 *
 * `dotenv` 18 arma las opciones como `{ ...opcionesDelEntorno, ...opciones }`: las variables `DOTENV_*` y `DOTENV_CONFIG_*`
 * del entorno (`ENCODING`, `PATH`, `QUIET`, `DEBUG`, `OVERRIDE` y `FAST`) cambian cómo se carga el archivo, salvo las que se
 * escriban en la llamada. Por eso se escriben las seis: lo escrito manda sobre el entorno. `override: false` mantiene que lo
 * ya definido (por ejemplo, por la integración continua) no se pise, y `fast: false` asegura el mismo analizador que usan
 * `dotenv.parse` en los scripts y el hook.
 *
 * No importa `dotenv` (ni un tipo): el criterio 117 solo permite importarlo a los cargadores del entorno.
 */
export function opcionesDotenv(ruta: string) {
  return { path: ruta, encoding: 'utf8', override: false, quiet: true, debug: false, fast: false } as const;
}
