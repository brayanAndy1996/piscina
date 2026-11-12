// spec: 001-academias-aislamiento (pruebas protegidas)
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { urlAppPruebas } from '../../utilidades/base-datos';

// Criterio 157 (ataque ronda 12, F1, forma `void`; P-40), parte de proceso: dada la API arrancada con su punto de entrada real
// (`backend/src/main.ts`), cuando ya atiende (`GET /api/salud` responde), una promesa rechazada que nadie maneja (en Node 22, modo `throw`, esto
// termina el proceso) se registra con el registro de pino de la app en nivel `error` y el proceso sigue atendiendo: la API responde a la peticion
// siguiente, el proceso no termina ni cambia `process.exitCode`, el registro no contiene el valor de lo rechazado cuando no es un `Error` (solo su
// tipo) y no se agrega un manejador de `uncaughtException` (una excepcion sincrona sin atrapar sigue terminando el proceso).
//
// Como en la prueba del criterio 99, la API real corre como proceso hijo con un modulo precargado (`--import`) que, al recibir un mensaje por IPC,
// deja una promesa rechazada sin manejar. Se ejecuta el `main.js` compilado con `tsc` (la misma compilacion que `nest build`, en una carpeta
// temporal dentro de backend/dist/) y no `tsx`, porque `tsx` no emite los metadatos de los decoradores y NestJS no podria inyectar las
// dependencias. `NODE_ENV=production` para que el registro de pino salga en JSON por la salida estandar.

const raiz = path.resolve(__dirname, '..', '..', '..', '..');
const carpetaBackend = path.join(raiz, 'backend');
const PRECARGA = path.join(carpetaBackend, 'test', 'utilidades', 'precarga-rechazos-ronda12.mjs');
const TIEMPO_COMPILACION = 240_000;
const TIEMPO_ARRANQUE = 90_000;

const SECRETO_PRUEBA = randomBytes(24).toString('base64url');

let carpetaSalida = '';
let hijo: ChildProcess | undefined;
let salidaDelHijo = '';
let puertoDeLaApi = 0;
let terminoElHijo: { codigo: number | null; senal: NodeJS.Signals | null } | undefined;

/** Las ultimas lineas de la salida del hijo, para los mensajes de error. */
function cola(salida: string): string {
  return salida.split('\n').slice(-6).join('\n').slice(-1800);
}

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

/** Compila `backend/src` con `tsc` (como `nest build`) en `salida`. */
function compilar(salida: string): void {
  const tsc = path.join(raiz, 'node_modules', 'typescript', 'bin', 'tsc');
  const resultado = spawnSync(
    process.execPath,
    [tsc, '-p', path.join(carpetaBackend, 'tsconfig.build.json'), '--outDir', salida, '--noEmitOnError', 'false'],
    { cwd: carpetaBackend, encoding: 'utf8', timeout: TIEMPO_COMPILACION },
  );
  if (!fs.existsSync(path.join(salida, 'main.js'))) {
    throw new Error(`No se pudo compilar el backend para la prueba.\n${resultado.stdout}\n${resultado.stderr}`);
  }
}

async function esperarAtencion(puerto: number): Promise<void> {
  const limite = Date.now() + TIEMPO_ARRANQUE - 5000;
  while (Date.now() < limite) {
    if (terminoElHijo !== undefined) {
      throw new Error(`La API termino antes de atender (codigo ${terminoElHijo.codigo}).\n${cola(salidaDelHijo)}`);
    }
    try {
      await fetch(`http://127.0.0.1:${puerto}/api/salud`);
      return;
    } catch {
      await new Promise((resolver) => setTimeout(resolver, 250));
    }
  }
  throw new Error(`La API no atendio GET /api/salud a tiempo.\n${cola(salidaDelHijo)}`);
}

/** Envia un mensaje al hijo y espera su respuesta por IPC; si el proceso termina antes, falla diciendo que termino. */
function preguntar<T extends object>(mensaje: string): Promise<T> {
  const proceso = hijo as ChildProcess;
  return new Promise((resolver, rechazar) => {
    if (terminoElHijo !== undefined) {
      rechazar(
        new Error(
          `El proceso de la API ya habia terminado (codigo ${terminoElHijo.codigo}) cuando se envio "${mensaje}".\n${cola(salidaDelHijo)}`,
        ),
      );
      return;
    }
    const alTerminar = (): void => {
      clearTimeout(temporizador);
      rechazar(
        new Error(
          `El proceso de la API termino (codigo ${terminoElHijo?.codigo ?? 'desconocido'}) en vez de seguir atendiendo tras "${mensaje}".\n${cola(salidaDelHijo)}`,
        ),
      );
    };
    const temporizador = setTimeout(() => {
      proceso.off('exit', alTerminar);
      rechazar(new Error(`El proceso no respondio por IPC a "${mensaje}".\n${cola(salidaDelHijo)}`));
    }, 15_000);
    proceso.once('exit', alTerminar);
    proceso.once('message', (respuesta) => {
      clearTimeout(temporizador);
      proceso.off('exit', alTerminar);
      resolver(respuesta as T);
    });
    proceso.send(mensaje);
  });
}

async function saludar(): Promise<number> {
  const respuesta = await fetch(`http://127.0.0.1:${puertoDeLaApi}/api/salud`);
  return respuesta.status;
}

/** Las lineas JSON de la salida del hijo que son registros de pino. */
function registrosDeLaSalida(): Record<string, unknown>[] {
  return salidaDelHijo
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea.startsWith('{'))
    .flatMap((linea) => {
      try {
        return [JSON.parse(linea) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

/** Registros de pino de nivel error (50) que aparecieron en la salida despues de que habia `antes` registros. */
function erroresDesde(antes: number): string[] {
  return registrosDeLaSalida()
    .slice(antes)
    .filter((registro) => registro['level'] === 50)
    .map((registro) => JSON.stringify(registro));
}

describe('criterio 157: la API real registra un rechazo sin manejar y sigue atendiendo', () => {
  beforeAll(async () => {
    carpetaSalida = path.join(carpetaBackend, 'dist', `pruebas-rechazos-${randomBytes(4).toString('hex')}`);
    compilar(carpetaSalida);
    puertoDeLaApi = await puertoLibre();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL_APP: urlAppPruebas(),
      JWT_SECRETO: SECRETO_PRUEBA + SECRETO_PRUEBA,
      SUPERADMIN_CORREO: 'dueno@aquagestion.test',
      SUPERADMIN_NOMBRE: 'Dueño del proceso',
      PUERTO_API: String(puertoDeLaApi),
      NODE_ENV: 'production',
    };
    hijo = spawn(process.execPath, ['--import', pathToFileURL(PRECARGA).href, path.join(carpetaSalida, 'main.js')], {
      cwd: carpetaBackend,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    hijo.stdout?.on('data', (trozo: Buffer) => (salidaDelHijo += trozo.toString('utf8')));
    hijo.stderr?.on('data', (trozo: Buffer) => (salidaDelHijo += trozo.toString('utf8')));
    hijo.once('exit', (codigo, senal) => {
      terminoElHijo = { codigo, senal };
    });
    await esperarAtencion(puertoDeLaApi);
  }, TIEMPO_COMPILACION + TIEMPO_ARRANQUE);

  afterAll(() => {
    hijo?.kill();
    if (carpetaSalida) fs.rmSync(carpetaSalida, { recursive: true, force: true });
  });

  it('criterio 157: main.ts no registra ningun manejador de uncaughtException (una excepcion sincrona sin atrapar sigue terminando el proceso)', async () => {
    const { estado } = await preguntar<{ estado: { uncaughtException: number } }>('estado');

    expect(estado.uncaughtException, 'manejadores de uncaughtException agregados por la API').toBe(0);
  });

  it('criterio 157: main.ts registra un manejador de unhandledRejection (ya esta registrado cuando la API atiende)', async () => {
    const { estado } = await preguntar<{ estado: { unhandledRejection: number } }>('estado');

    expect(estado.unhandledRejection, 'manejadores de unhandledRejection agregados por la API').toBeGreaterThanOrEqual(
      1,
    );
  });

  it('criterio 157: tras un Error rechazado sin manejar, el proceso sigue vivo, no cambia process.exitCode y GET /api/salud responde', async () => {
    await preguntar('rechazar-error');

    expect(terminoElHijo, 'el proceso no debia terminar').toBeUndefined();
    expect(await saludar()).toBe(200);
    const { estado } = await preguntar<{ estado: { exitCode: number | null } }>('estado');
    expect(estado.exitCode, 'process.exitCode no cambia').toBeNull();
  });

  it('criterio 157: el rechazo de un Error se registra en nivel error (50) con el error', async () => {
    const antes = registrosDeLaSalida().length;

    await preguntar('rechazar-error');

    const errores = erroresDesde(antes);
    expect(
      errores.some((registro) => registro.includes('rechazo-sin-manejar-r12')),
      `debia haber un registro de nivel error con el Error rechazado\n${cola(salidaDelHijo)}`,
    ).toBe(true);
    expect(terminoElHijo, 'el proceso no debia terminar').toBeUndefined();
  });

  it('criterio 157: una cadena rechazada sin manejar se registra solo por su tipo, nunca su valor, y la API sigue respondiendo', async () => {
    const antes = registrosDeLaSalida().length;

    await preguntar('rechazar-cadena');

    expect(await saludar()).toBe(200);
    expect(terminoElHijo, 'el proceso no debia terminar').toBeUndefined();
    expect(salidaDelHijo, 'el registro no contiene la cadena rechazada').not.toContain('dato-secreto-r12');
    const errores = erroresDesde(antes);
    expect(
      errores.some((registro) => registro.includes('"tipo":"string"')),
      `un registro de nivel error con el tipo "string"\n${cola(salidaDelHijo)}`,
    ).toBe(true);
  });

  it('criterio 157: un objeto rechazado sin manejar se registra solo por su tipo, nunca su valor, y la API sigue respondiendo', async () => {
    const antes = registrosDeLaSalida().length;

    await preguntar('rechazar-objeto');

    expect(await saludar()).toBe(200);
    expect(terminoElHijo, 'el proceso no debia terminar').toBeUndefined();
    const errores = erroresDesde(antes);
    expect(
      errores.some((registro) => registro.includes('"tipo":"object"')),
      `un registro de nivel error con el tipo "object"\n${cola(salidaDelHijo)}`,
    ).toBe(true);
    for (const registro of errores) {
      expect(registro, 'el registro no contiene el valor del objeto rechazado').not.toContain('12345678');
      expect(registro, 'el registro no contiene las claves del objeto rechazado').not.toContain('"dni"');
    }
  });
});
