import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Un solo .env en la raíz del repositorio (D-21). Las variables ya definidas en el entorno (la CI, Playwright) mandan.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, raiz, ''), ...process.env };
  const puertoWeb = Number(env['PUERTO_WEB'] ?? 5173);
  const puertoApi = Number(env['PUERTO_API'] ?? 3000);

  return {
    plugins: [react(), tailwindcss()],
    envDir: raiz,
    server: {
      // 127.0.0.1 y no localhost: en Windows, localhost puede resolverse a ::1.
      host: '127.0.0.1',
      port: puertoWeb,
      // Si el puerto está ocupado, falla en lugar de cambiarlo.
      strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${puertoApi}` },
      // Lista cerrada (spec 005, criterio 62 a): por defecto Vite deja leer por `/@fs/` toda la raíz del workspace, incluido el almacén de
      // archivos (`backend/almacenamiento`). Si una dependencia futura se resuelve fuera de estas carpetas, se suma aquí y en
      // `validarEntorno` (CARPETAS_DE_LA_WEB).
      fs: {
        allow: [path.join(raiz, 'frontend'), path.join(raiz, 'packages', 'contratos'), path.join(raiz, 'node_modules')],
        // Criterio 65: npm enlaza cada workspace en `node_modules/@aquagestion/` (una unión en Windows). Vite compara la ruta pedida sin
        // resolver enlaces, así que `node_modules/` permitido dejaba leer `backend/`, `e2e/` y `scripts/` por esos enlaces. La web no usa esa
        // ruta (Vite resuelve `@aquagestion/contratos` a `packages/contratos`). `deny` reemplaza la lista de Vite, por eso se copian sus
        // valores por defecto (vite 8.3.8, `server.fs.deny`); si se actualiza Vite, se revisan.
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem,key,p12,pfx,cer,der}',
          '.npmrc',
          '.yarnrc.yml',
          '**/.git/**',
          '**/node_modules/@aquagestion',
          '**/node_modules/@aquagestion/**',
        ],
      },
    },
    preview: {
      host: '127.0.0.1',
      port: puertoWeb,
      strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${puertoApi}` },
    },
  };
});
