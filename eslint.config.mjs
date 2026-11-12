import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { configuracionAccesoBase } from './eslint/regla-acceso-base.mjs';
import { configuracionPrisma } from './eslint/regla-prisma.mjs';
import { configuracionReloj } from './eslint/regla-reloj.mjs';
import { configuracionSqlSesion } from './eslint/regla-sql-sesion.mjs';
import { configuracionTransaccionGuardada } from './eslint/regla-transaccion-guardada.mjs';

export default tseslint.config(
  {
    name: 'aquagestion/ignorados',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'backend/src/generated/prisma/**',
      'backend/prisma/migrations/**',
      'playwright-report/**',
      'test-results/**',
      'frontend/dist/**',
    ],
  },

  js.configs.recommended,

  // TypeScript con reglas que usan información de tipos (backend y contratos).
  {
    name: 'aquagestion/typescript',
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Configuración en TypeScript de la raíz (por ejemplo, vitest.config.mts) y archivos .mts/.cts: sin información de tipos.
  {
    name: 'aquagestion/typescript-sin-tipos',
    files: ['**/*.mts', '**/*.cts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },

  // Archivos JavaScript y de configuración: sin información de tipos.
  {
    name: 'aquagestion/javascript',
    files: ['**/*.{js,jsx,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } },
  },

  {
    name: 'aquagestion/node',
    files: ['backend/**/*.ts', 'packages/**/*.ts', 'scripts/**/*.mjs', 'eslint/**/*.mjs', 'e2e/**/*.ts', '*.config.*'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Web: navegador y reglas de hooks de React.
  {
    name: 'aquagestion/frontend',
    files: ['frontend/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Configuración de Vite del frontend: se ejecuta en Node.
  {
    name: 'aquagestion/frontend-config',
    files: ['frontend/vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Regla del reloj inyectable.
  configuracionReloj,

  // Regla de importaciones de Prisma: solo BaseDatos llega a la base.
  configuracionPrisma,

  // Regla de acceso a la base: ningún otro camino al cliente de Prisma ni a pg; nadie fuera de cli/ importa cli/ ni los internos
  // de infraestructura/prisma/ (criterios 85 y 95).
  ...configuracionAccesoBase,

  // Reglas del SQL: el SQL solo llega a la base en plantillas etiquetadas y solo ese texto se analiza (criterios 73, 83, 84 y
  // 92 a 94). Un comentario `eslint-disable` las apaga aquí; el paso protegido (eslint.protegido.config.mjs, con
  // `--no-inline-config`) las revisa otra vez sin que ningún comentario pueda apagarlas (criterio 96).
  ...configuracionSqlSesion,

  // Una transacción no se guarda fuera de su `trabajo` (en this ni en una variable del módulo) y fuera de infraestructura/ no se importa
  // async_hooks (criterio 135). Solo en el lint normal: el criterio 134 es la garantía en ejecución.
  configuracionTransaccionGuardada,
);
