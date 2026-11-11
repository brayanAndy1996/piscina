// Regla de importaciones de Prisma (spec 001, criterio 28): los módulos del backend solo llegan a la base a través de
// `BaseDatos` (infraestructura/prisma). En `backend/src/`, fuera de `infraestructura/prisma/` y de `cli/`, no se
// importa ningún valor del cliente generado (`generated/prisma`) ni `PrismaService`; sí se pueden importar tipos.
// Se exporta por separado, como la del reloj, para poder probarla con ESLint.

export const MENSAJE_PRISMA =
  'Los módulos acceden a la base solo a través de BaseDatos (infraestructura/prisma): usa conAcademia o ' +
  'comoPlataforma. No importes valores del cliente de Prisma ni PrismaService (los tipos sí se pueden importar).';

/** Archivos a los que se aplica la regla. */
export const archivosConReglaPrisma = ['backend/src/**/*.ts'];

/** Archivos exentos: el acceso a datos mismo, los comandos y las pruebas. */
export const archivosExentosPrisma = [
  'backend/src/infraestructura/prisma/**',
  'backend/src/cli/**',
  'backend/src/generated/**',
  '**/*.test.ts',
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
        {
          group: ['**/infraestructura/prisma', '**/infraestructura/prisma/index'],
          importNames: ['PrismaService'],
          message: MENSAJE_PRISMA,
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
  rules: reglasPrisma,
};
