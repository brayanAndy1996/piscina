/**
 * Retira de `env` las variables con las que otro código podría conectarse como el dueño de las tablas (spec 001,
 * criterio 99, precisión P-21): toda clave que empiece por `DATABASE_URL` salvo `DATABASE_URL_APP` (la conexión del dueño y la
 * de las pruebas), toda clave que empiece por `PG` (las que `pg` toma como valores por defecto de conexión: `PGUSER`,
 * `PGPASSWORD`, `PGHOST`…) y `SUPERADMIN_CLAVE`. No toca las demás. Modifica el objeto recibido.
 *
 * `main.ts` la llama con `process.env` después de validar el entorno y antes de crear la aplicación: la API solo necesita
 * `DATABASE_URL_APP`, y así un módulo con un error no podría abrir una conexión como el dueño ni con `new pg.Client()`.
 * No la llaman `configurarApp` ni `crearAppDePruebas`: las pruebas corren la API en su mismo proceso y necesitan esas
 * variables.
 */
export function retirarVariablesSensibles(env: Record<string, string | undefined>): void {
  for (const nombre of Object.keys(env)) {
    const sensible =
      (nombre.startsWith('DATABASE_URL') && nombre !== 'DATABASE_URL_APP') ||
      nombre.startsWith('PG') ||
      nombre === 'SUPERADMIN_CLAVE';
    if (sensible) delete env[nombre];
  }
}
