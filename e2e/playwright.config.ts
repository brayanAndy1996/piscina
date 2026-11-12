import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { config as cargarEnv } from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Un solo .env en la raíz; las variables ya definidas (la CI) mandan.
// Las seis opciones escritas (criterio 175, P-45): las variables DOTENV_* del entorno no cambian cómo se carga el archivo.
cargarEnv({ path: path.join(raiz, '.env'), encoding: 'utf8', override: false, quiet: true, debug: false, fast: false });

// Puertos propios, distintos de los de `npm run dev` (3000 y 5173), para poder correr ambos a la vez.
const PUERTO_API_E2E = 3100;
const PUERTO_WEB_E2E = 5180;

const baseDatosPruebas = process.env['DATABASE_URL_PRUEBAS'];
if (!baseDatosPruebas) {
  throw new Error('Falta DATABASE_URL_PRUEBAS en el .env: las pruebas E2E usan solo la base de pruebas.');
}

// La API se conecta como el rol aquagestion_app (DATABASE_URL_APP): su usuario y contraseña, sobre la base de pruebas.
// Sin DATABASE_URL_APP en el .env se usa la credencial de desarrollo inventada de .env.example.
function urlAppSobrePruebas(): string {
  const url = new URL(baseDatosPruebas as string);
  const app = new URL(
    process.env['DATABASE_URL_APP'] ?? 'postgresql://aquagestion_app:aquagestion_app@127.0.0.1:5432/aquagestion',
  );
  url.username = app.username;
  url.password = app.password;
  return url.toString();
}

const JWT_SECRETO_E2E = process.env['JWT_SECRETO'] ?? 'secreto-solo-para-pruebas-e2e-de-aquagestion-0123456789';

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
  // Crea el superadmin de las pruebas en la base de pruebas.
  globalSetup: './global-setup.ts',
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
      env: {
        ...entornoComun,
        DATABASE_URL: baseDatosPruebas,
        DATABASE_URL_APP: urlAppSobrePruebas(),
        JWT_SECRETO: JWT_SECRETO_E2E,
      },
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
