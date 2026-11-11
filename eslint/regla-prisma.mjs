// Regla de importaciones de Prisma (spec 001, criterio 28): los módulos del backend solo llegan a la base a través de
// `BaseDatos` (infraestructura/prisma). En `backend/src/`, fuera de `infraestructura/prisma/` y de `cli/`, no se
// importa ningún valor del cliente generado (`generated/prisma`) ni `PrismaService`; sí se pueden importar tipos.
// Se exporta por separado, como la del reloj, para poder probarla con ESLint.
import tseslint from 'typescript-eslint';
import { ARCHIVOS_DE_CODIGO, EXENCION_CLIENTE_GENERADO, EXENCION_PRUEBAS } from './archivos-de-codigo.mjs';

export const MENSAJE_PRISMA =
  'Los módulos acceden a la base solo a través de BaseDatos (infraestructura/prisma): usa conAcademia o ' +
  'comoPlataforma. No importes valores del cliente de Prisma ni PrismaService (los tipos sí se pueden importar).';

/** Archivos a los que se aplica la regla. */
export const archivosConReglaPrisma = ARCHIVOS_DE_CODIGO;

/**
 * Archivos exentos: el acceso a datos mismo, los comandos, el cliente generado y las pruebas (solo `.test.<ts|mts|cts|js|mjs|
 * cjs>`; criterios 110 y 118).
 */
export const archivosExentosPrisma = [
  'backend/src/infraestructura/prisma/**',
  'backend/src/cli/**',
  EXENCION_CLIENTE_GENERADO,
  EXENCION_PRUEBAS,
];

/** Regla `@typescript-eslint/no-restricted-imports`: permite los tipos (`import type` o `type` en línea). */
export const reglasPrisma = {
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      patterns: [
        { group: ['**/generated/prisma', '**/generated/prisma/**'], message: MENSAJE_PRISMA, allowTypeImports: true },
        {
          group: ['**/prisma.service', '**/prisma.service.ts'],
          message: MENSAJE_PRISMA,
          allowTypeImports: false,
        },
      ],
    },
  ],
};

/** Bloque de configuración plana listo para agregar a `eslint.config.mjs`. */
export const configuracionPrisma = {
  name: 'aquagestion/regla-prisma',
  files: archivosConReglaPrisma,
  ignores: archivosExentosPrisma,
  // El complemento se declara aquí para que la regla también funcione en los archivos .js/.mjs/.cjs y en el paso protegido.
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: reglasPrisma,
};
