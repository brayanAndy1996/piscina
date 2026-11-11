import react from '@vitejs/plugin-react';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Las pruebas corren siempre en UTC, en cualquier sistema operativo (spec 000, criterio 16): así, cualquier código
// que dependa de la zona del servidor en vez de America/Lima falla en las pruebas. Se fija aquí, antes de crear los
// procesos de prueba (pool 'forks'), que heredan esta variable de entorno.
process.env['TZ'] = 'UTC';

// NestJS necesita los metadatos de los decoradores, que esbuild/oxc no emiten: el backend usa SWC.
const swcNest = () =>
  swc.vite({
    jsc: {
      target: 'es2023',
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      keepClassNames: true,
    },
    module: { type: 'es6' },
  });

const comun = { environment: 'node' as const, env: { TZ: 'UTC' } };

export default defineConfig({
  test: {
    pool: 'forks',
    // En la integración continua, una prueba con `.only` hace fallar la ejecución.
    allowOnly: !process.env['CI'],
    projects: [
      {
        root: 'packages/contratos',
        test: { ...comun, name: 'contratos', include: ['src/**/*.test.ts'] },
      },
      {
        root: 'eslint',
        test: { ...comun, name: 'eslint', include: ['*.test.mjs'] },
      },
      {
        root: 'scripts',
        test: {
          ...comun,
          name: 'scripts',
          include: ['test/**/*.test.mjs'],
          exclude: ['test/integracion/**', 'test/integracion-aislada/**'],
          // Algunas pruebas crean repositorios git temporales y ejecutan git muchas veces (más lento en Windows).
          testTimeout: 60_000,
        },
      },
      {
        root: 'scripts',
        test: {
          ...comun,
          name: 'scripts-integracion',
          include: ['test/integracion/**/*.test.mjs'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 60_000,
        },
      },
      {
        // Pruebas que modifican el rol compartido `aquagestion_app` (spec 001, criterio 103): una API de pruebas que arrancara
        // mientras el rol tiene valores por defecto propios seria rechazada. Corren en serie y despues de todos los demas
        // proyectos (`sequence.groupOrder` 2; las pruebas de integracion, que usan el servidor de PostgreSQL, tienen 1), sin dejar de formar parte de `npm test`.
        root: 'scripts',
        test: {
          ...comun,
          name: 'scripts-aislado',
          include: ['test/integracion-aislada/**/*.test.mjs'],
          fileParallelism: false,
          testTimeout: 60_000,
          sequence: { groupOrder: 2 },
        },
      },
      {
        root: 'frontend',
        plugins: [react()],
        test: {
          name: 'frontend',
          environment: 'jsdom',
          env: { TZ: 'UTC' },
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/pruebas-preparacion.ts'],
        },
      },
      {
        root: 'backend',
        plugins: [swcNest()],
        test: {
          ...comun,
          name: 'backend-unit',
          include: ['src/**/*.test.ts', 'test/utilidades/**/*.test.ts'],
        },
      },
      {
        root: 'backend',
        plugins: [swcNest()],
        test: {
          ...comun,
          name: 'backend-integracion',
          include: ['test/integracion/**/*.test.ts'],
          sequence: { groupOrder: 1 },
          // Valida DATABASE_URL_PRUEBAS (criterio 19) y migra la base de pruebas antes de cualquier prueba.
          globalSetup: ['./test/utilidades/global-setup.ts'],
          // Una sola base de datos: los archivos de prueba no corren en paralelo.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
