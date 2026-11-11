// spec: 001-academias-aislamiento (pruebas protegidas)
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { urlAppPruebas, urlPropietarioPruebas } from '../../utilidades/base-datos';

// Criterio 99 (ataque ronda 3, F2; complementa los criterios 5 y 95): dada la API arrancada con su punto de entrada real
// (`backend/src/main.ts`), con `DATABASE_URL`, `DATABASE_URL_PRUEBAS`, `PGUSER`, `PGPASSWORD` y `SUPERADMIN_CLAVE` definidas en
// el entorno, cuando ya atiende (`GET /api/salud` responde), `process.env` no tiene ninguna variable cuyo nombre empiece por
// `DATABASE_URL` salvo `DATABASE_URL_APP`, ninguna que empiece por `PG` ni `SUPERADMIN_CLAVE`; `DATABASE_URL_APP`, `JWT_SECRETO`
// y las demas siguen. Las retira `retirarVariablesSensibles(env)` (P-21), que `main.ts` llama con `process.env` despues de
// `validarEntorno` y antes de crear la aplicacion; no lo hacen `configurarApp` ni `crearAppDePruebas`.
//
// Como lo pide la especificacion, la API real corre como proceso hijo con un modulo precargado (`--import`) que, al recibir un
// mensaje por IPC, responde con los nombres de las variables de `process.env`. Una diferencia con la especificacion: se ejecuta
// el `main.js` compilado con `tsc` (la misma compilacion que `nest build`, en una carpeta temporal dentro de backend/dist/) y no
// `tsx backend/src/main.ts`, porque `tsx` (esbuild) no emite los metadatos de los decoradores y NestJS no podria inyectar las
// dependencias.

const raiz = path.resolve(__dirname, '..', '..', '..', '..');
const carpetaBackend = path.join(raiz, 'backend');
const PRECARGA = path.join(carpetaBackend, 'test', 'utilidades', 'precarga-entorno.mjs');
const TIEMPO_COMPILACION = 240_000;
const TIEMPO_ARRANQUE = 90_000;

const SECRETO_PRUEBA = randomBytes(24).toString('base64url');
const CLAVE_SUPERADMIN = 'Clave-Superadmin-Del-Proceso-1';

let carpetaSalida = '';
let hijo: ChildProcess | undefined;
let salidaDelHijo = '';
let nombresDeVariables: string[] = [];

async function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const servidor = net.createServer();
    servidor.once('error', rechazar);
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address() as net.AddressInfo;
      servidor.close(() => resolver(port));
    });
  });
}

/** Compila `backend/src` con `tsc` (como `nest build`) en `carpetaSalida`. */
function compilar(salida: string): void {
  const tsc = path.join(raiz, 'node_modules', 'typescript', 'bin', 'tsc');
  const resultado = spawnSync(
    process.execPath,
    [tsc, '-p', path.join(carpetaBackend, 'tsconfig.build.json'), '--outDir', salida, '--noEmitOnError', 'false'],
    { cwd: carpetaBackend, encoding: 'utf8', timeout: TIEMPO_COMPILACION },
  );
  // `tsc` devuelve 2 si hay errores de tipos aunque emita; lo que importa es que `main.js` exista.
  if (!fs.existsSync(path.join(salida, 'main.js'))) {
    throw new Error(`No se pudo compilar el backend para la prueba.\n${resultado.stdout}\n${resultado.stderr}`);
  }
}

async function esperarAtencion(puerto: number): Promise<void> {
  const limite = Date.now() + TIEMPO_ARRANQUE - 5000;
  while (Date.now() < limite) {
    if (hijo?.exitCode !== null && hijo?.exitCode !== undefined) {
      throw new Error(`La API terminó antes de atender (código ${hijo.exitCode}).\n${salidaDelHijo}`);
    }
    try {
      await fetch(`http://127.0.0.1:${puerto}/api/salud`);
      return;
    } catch {
      await new Promise((resolver) => setTimeout(resolver, 250));
    }
  }
  throw new Error(`La API no atendió GET /api/salud a tiempo.\n${salidaDelHijo}`);
}

async function pedirVariables(proceso: ChildProcess): Promise<string[]> {
  return new Promise((resolver, rechazar) => {
    const temporizador = setTimeout(() => rechazar(new Error('El proceso no respondió por IPC.')), 15_000);
    proceso.once('message', (mensaje) => {
      clearTimeout(temporizador);
      resolver((mensaje as { variables: string[] }).variables);
    });
    proceso.send('variables');
  });
}

describe('criterio 99: la API real no guarda en su entorno las conexiones del dueño', () => {
  beforeAll(async () => {
    carpetaSalida = path.join(carpetaBackend, 'dist', `pruebas-entorno-${randomBytes(4).toString('hex')}`);
    compilar(carpetaSalida);
    const puerto = await puertoLibre();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Lo que el proceso debe olvidar: las conexiones del dueño, los valores por defecto de `pg` y la clave del superadmin.
      DATABASE_URL: urlPropietarioPruebas(),
      DATABASE_URL_PRUEBAS: urlPropietarioPruebas(),
      DATABASE_URL_EXTRA: urlPropietarioPruebas(),
      PGUSER: 'usuario-del-dueno',
      PGPASSWORD: 'clave-del-dueno',
      PGHOST: '127.0.0.1',
      SUPERADMIN_CLAVE: CLAVE_SUPERADMIN,
      // Lo que debe seguir.
      DATABASE_URL_APP: urlAppPruebas(),
      JWT_SECRETO: SECRETO_PRUEBA + SECRETO_PRUEBA,
      SUPERADMIN_CORREO: 'dueno@aquagestion.test',
      SUPERADMIN_NOMBRE: 'Dueño del proceso',
      PUERTO_API: String(puerto),
      NODE_ENV: 'test',
    };
    hijo = spawn(process.execPath, ['--import', pathToFileURL(PRECARGA).href, path.join(carpetaSalida, 'main.js')], {
      cwd: carpetaBackend,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    hijo.stdout?.on('data', (trozo: Buffer) => (salidaDelHijo += trozo.toString('utf8')));
    hijo.stderr?.on('data', (trozo: Buffer) => (salidaDelHijo += trozo.toString('utf8')));
    await esperarAtencion(puerto);
    nombresDeVariables = await pedirVariables(hijo);
  }, TIEMPO_COMPILACION + TIEMPO_ARRANQUE);

  afterAll(() => {
    hijo?.kill();
    if (carpetaSalida) fs.rmSync(carpetaSalida, { recursive: true, force: true });
  });

  it('criterio 99: el proceso hijo atiende GET /api/salud y responde por IPC con las variables de process.env', () => {
    expect(nombresDeVariables.length).toBeGreaterThan(0);
    expect(nombresDeVariables).toContain('PATH');
  });

  it('criterio 99: ninguna variable empieza por DATABASE_URL salvo DATABASE_URL_APP', () => {
    const restantes = nombresDeVariables.filter(
      (nombre) => nombre.startsWith('DATABASE_URL') && nombre !== 'DATABASE_URL_APP',
    );

    expect(restantes).toEqual([]);
  });

  it('criterio 99: ninguna variable empieza por PG', () => {
    expect(nombresDeVariables.filter((nombre) => nombre.startsWith('PG'))).toEqual([]);
  });

  it('criterio 99: SUPERADMIN_CLAVE ya no esta', () => {
    expect(nombresDeVariables).not.toContain('SUPERADMIN_CLAVE');
  });

  it('criterio 99: DATABASE_URL_APP, JWT_SECRETO y las demas variables siguen', () => {
    for (const nombre of [
      'DATABASE_URL_APP',
      'JWT_SECRETO',
      'PUERTO_API',
      'NODE_ENV',
      'SUPERADMIN_CORREO',
      'SUPERADMIN_NOMBRE',
    ]) {
      expect(nombresDeVariables, `falta ${nombre}`).toContain(nombre);
    }
  });

  it('criterio 99: el proceso de las pruebas conserva sus variables al crear la aplicacion con crearAppDePruebas', async () => {
    const antes = {
      DATABASE_URL: process.env['DATABASE_URL'],
      DATABASE_URL_PRUEBAS: process.env['DATABASE_URL_PRUEBAS'],
      DATABASE_URL_APP: process.env['DATABASE_URL_APP'],
    };
    expect(antes.DATABASE_URL_PRUEBAS, 'el globalSetup debia fijar DATABASE_URL_PRUEBAS').toBeDefined();

    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    try {
      expect({
        DATABASE_URL: process.env['DATABASE_URL'],
        DATABASE_URL_PRUEBAS: process.env['DATABASE_URL_PRUEBAS'],
        DATABASE_URL_APP: process.env['DATABASE_URL_APP'],
      }).toEqual(antes);
    } finally {
      await app.close();
    }
  });
});
