// Paso protegido del lint (spec 001, criterio 96): solo las reglas de seguridad de `backend/src` (criterios 28, 73, 83, 84, 85 y
// 92 a 95, 109 a 113, 115, 117 y 119, más la regla propia de promesas descartadas del criterio 159, que no usa tipos), sobre todas
// las extensiones que `tsx` ejecuta (también `.jsx`), sin ninguna otra regla. Solo
// el cliente generado (`backend/src/generated/prisma/**`, criterio 118) y las pruebas (`*.test.<ts|mts|cts|js|mjs|cjs>`, criterio
// 110) quedan fuera. Antes de ESLint, `npm run lint:protegido` ejecuta `scripts/comprobar-fuentes-protegidas.mjs` (enlaces
// simbólicos y archivos ajenos en `backend/src/generated/`, criterios 111 y 118). `npm run lint` lo ejecuta con
// `--no-inline-config`, así que ningún comentario `eslint-disable` ni `/* eslint … */` puede apagarlas. El lint normal
// (`eslint.config.mjs`) aplica las mismas reglas, pero allí un comentario sí las apaga.
//
// Está en la raíz para que las rutas de `files` se resuelvan igual que en la configuración principal.
import tseslint from 'typescript-eslint';
import { ARCHIVOS_DE_CODIGO, EXENCION_CLIENTE_GENERADO } from './eslint/archivos-de-codigo.mjs';
import { configuracionAccesoBase } from './eslint/regla-acceso-base.mjs';
import { configuracionPrisma } from './eslint/regla-prisma.mjs';
import { configuracionPromesasDescartadas } from './eslint/regla-promesas-descartadas.mjs';
import { configuracionSqlSesion } from './eslint/regla-sql-sesion.mjs';

export default tseslint.config(
  {
    name: 'aquagestion/protegido/ignorados',
    ignores: ['**/node_modules/**', '**/dist/**', EXENCION_CLIENTE_GENERADO],
  },
  {
    // Solo el analizador y el complemento de TypeScript (sin reglas y sin información de tipos).
    name: 'aquagestion/protegido/analizador',
    files: ARCHIVOS_DE_CODIGO,
    extends: [tseslint.configs.base],
    // Los `.jsx` (y los `.tsx`) llevan JSX (criterio 119).
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  },
  configuracionPrisma,
  ...configuracionAccesoBase,
  ...configuracionSqlSesion,
  configuracionPromesasDescartadas,
);
