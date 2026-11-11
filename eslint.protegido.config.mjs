// Paso protegido del lint (spec 001, criterio 96): solo las reglas de seguridad de `backend/src` (criterios 28, 73, 83, 84, 85 y
// 92 a 95), sobre todas las extensiones que `tsx` ejecuta, sin ninguna otra regla. `npm run lint` lo ejecuta con
// `--no-inline-config`, así que ningún comentario `eslint-disable` ni `/* eslint … */` puede apagarlas. El lint normal
// (`eslint.config.mjs`) aplica las mismas reglas, pero allí un comentario sí las apaga.
//
// Está en la raíz para que las rutas de `files` se resuelvan igual que en la configuración principal.
import tseslint from 'typescript-eslint';
import { configuracionAccesoBase } from './eslint/regla-acceso-base.mjs';
import { configuracionPrisma } from './eslint/regla-prisma.mjs';
import { configuracionSqlSesion } from './eslint/regla-sql-sesion.mjs';

export default tseslint.config(
  {
    name: 'aquagestion/protegido/ignorados',
    ignores: ['**/node_modules/**', '**/dist/**', 'backend/src/generated/**'],
  },
  {
    // Solo el analizador y el complemento de TypeScript (sin reglas y sin información de tipos).
    name: 'aquagestion/protegido/analizador',
    files: ['backend/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    extends: [tseslint.configs.base],
  },
  configuracionPrisma,
  ...configuracionAccesoBase,
  ...configuracionSqlSesion,
);
