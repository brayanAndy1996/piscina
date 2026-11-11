import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { config as cargarEnv } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Un solo .env en la raíz; las variables ya definidas (la CI) mandan.
cargarEnv({ path: path.join(raiz, '.env'), quiet: true });

// Puertos propios, distintos de los de `npm run dev` (3000 y 5173), para poder correr ambos a la vez.
const PUERTO_API_E2E = 3100;
const PUERTO_WEB_E2E = 5180;

const baseDatosPruebas = process.env['DATABASE_URL_PRUEBAS'];
if (!baseDatosPruebas) {
  throw new Error('Falta DATABASE_URL_PRUEBAS en el .env: las pruebas E2E usan solo la base de pruebas.');
}

const entornoComun = {
  ...process.env,
  PUERTO_API: String(PUERTO_API_E2E),
  PUERTO_WEB: String(PUERTO_WEB_E2E),
};

// En la nube el navegador viene preinstalado en otra ruta: se indica con CHROMIUM_EJECUTABLE. En la CI y en Windows
// no se define y se usa el Chromium que instala Playwright.
const ejecutableChromium = process.env['CHROMIUM_EJECUTABLE'];

export default defineConfig({
  testDir: './pruebas',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PUERTO_WEB_E2E}`,
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(ejecutableChromium ? { launchOptions: { executablePath: ejecutableChromium } } : {}),
      },
    },
  ],
  webServer: [
    {
      // La API contra la base de pruebas, nunca la de desarrollo.
      name: 'API',
      command: 'npm run start -w @aquagestion/backend',
      cwd: raiz,
      url: `http://127.0.0.1:${PUERTO_API_E2E}/api/salud`,
      env: { ...entornoComun, DATABASE_URL: baseDatosPruebas },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'Web',
      command: 'npm run dev -w @aquagestion/frontend',
      cwd: raiz,
      url: `http://127.0.0.1:${PUERTO_WEB_E2E}/`,
      env: entornoComun,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
