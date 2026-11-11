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
    },
    preview: {
      host: '127.0.0.1',
      port: puertoWeb,
      strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${puertoApi}` },
    },
  };
});
