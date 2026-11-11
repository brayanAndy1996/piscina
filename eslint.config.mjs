import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { configuracionPrisma } from './eslint/regla-prisma.mjs';
import { configuracionReloj } from './eslint/regla-reloj.mjs';
import { configuracionSqlSesion } from './eslint/regla-sql-sesion.mjs';

export default tseslint.config(
  {
    name: 'aquagestion/ignorados',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'backend/src/generated/**',
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

  // Configuración en TypeScript de la raíz (por ejemplo, vitest.config.mts): sin información de tipos.
  {
    name: 'aquagestion/typescript-sin-tipos',
    files: ['**/*.mts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },

  // Archivos JavaScript y de configuración: sin información de tipos.
  {
    name: 'aquagestion/javascript',
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
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

  // Regla del SQL de sesión: solo BaseDatos cambia el contexto de PostgreSQL (criterio 73).
  ...configuracionSqlSesion,
);
