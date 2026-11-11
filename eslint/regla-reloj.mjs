// Regla del reloj (spec 000, criterio 15): en `backend/src/`, la hora se pide al reloj inyectable (`RELOJ`), nunca
// a `new Date()` sin argumentos ni a `Date.now()`. Así las pruebas pueden fijar la hora con `RelojFijo`.
// Se exporta por separado para poder probarla con la clase `Linter` de ESLint.

export const MENSAJE_RELOJ = 'Usa el reloj inyectable (RELOJ) en lugar de la hora del sistema.';

/** Archivos a los que se aplica la regla. */
export const archivosConRegla = ['backend/src/**/*.ts'];

/** Archivos exentos: el reloj mismo y las pruebas. */
export const archivosExentos = ['backend/src/infraestructura/reloj/**', '**/*.test.ts'];

/** Regla de ESLint (`no-restricted-syntax`) con los dos selectores prohibidos. */
export const reglasReloj = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: MENSAJE_RELOJ,
    },
    {
      selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
      message: MENSAJE_RELOJ,
    },
  ],
};

/** Bloque de configuración plana listo para agregar a `eslint.config.mjs`. */
export const configuracionReloj = {
  name: 'aquagestion/regla-reloj',
  files: archivosConRegla,
  ignores: archivosExentos,
  rules: reglasReloj,
};
