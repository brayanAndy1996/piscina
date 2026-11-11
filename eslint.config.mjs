import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { configuracionReloj } from './eslint/regla-reloj.mjs';

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
    files: ['backend/**/*.ts', 'packages/**/*.ts', 'scripts/**/*.mjs', 'eslint/**/*.mjs', '*.config.*'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Regla del reloj inyectable.
  configuracionReloj,
);
