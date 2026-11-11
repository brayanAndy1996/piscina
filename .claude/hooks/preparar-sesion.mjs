// Prepara la sesión de Claude Code en la nube (spec 000, criterios 43 a 47; D-26).
//
// Solo actúa si CLAUDE_CODE_REMOTE vale "true". En la PC del responsable y en la integración continua no hace nada:
// no escribe en la salida, no crea archivos y no ejecuta comandos.
//
// Pasos, en orden:
//   1. Crea .env copiando .env.example (nunca sobrescribe un .env existente).
//   2. Enciende PostgreSQL (cluster 16 main) si no responde en el host y puerto de DATABASE_URL.
//   3. Crea el rol de DATABASE_URL (LOGIN, CREATEDB, sin superusuario) si no existe.
//   4. Ejecuta npm ci si falta node_modules o si package-lock.json cambió desde la última instalación hecha aquí.
//   5. Crea las bases, genera el cliente de Prisma y aplica las migraciones a la base de desarrollo y a la de pruebas.
//   6. Imprime un resumen breve, una línea por paso.
//
// Siempre termina con código 0 para no bloquear la sesión; si un paso falla, la salida dice cuál, por qué y cómo
// reintentar. Nunca imprime la contraseña de la base. Solo usa módulos incluidos en Node (se ejecuta antes de npm ci)
// y lanza los comandos externos sin shell, con los argumentos separados.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { analizarUrlPostgres, esNombreValido } from '../../scripts/lib/entorno.mjs';

export const COMANDO_REINTENTO = 'node .claude/hooks/preparar-sesion.mjs';
const CLUSTER = ['16', 'main'];
const SEGUNDOS_ESPERA_POSTGRES = 30;
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1']);
const CHROMIUM_NUBE = '/opt/pw-browsers/chromium';
const ARCHIVO_HUELLA = path.join('node_modules', '.preparar-sesion.sha256');

// ---------------------------------------------------------------------------------------------------------------
// Funciones puras (se prueban por separado)
// ---------------------------------------------------------------------------------------------------------------

/** ¿Esta sesión es la nube? Solo con el valor exacto "true". */
export function esSesionEnLaNube(env) {
  return env['CLAUDE_CODE_REMOTE'] === 'true';
}

/** Reemplaza cada aparición de las contraseñas (y de sus formas codificadas) por "***". */
export function ocultarClaves(texto, claves) {
  let resultado = String(texto);
  const variantes = new Set();
  for (const clave of claves) {
    if (!clave) continue;
    variantes.add(clave);
    variantes.add(encodeURIComponent(clave));
    variantes.add(clave.replaceAll("'", "''"));
  }
  // Primero las más largas, para que una contraseña que contiene a otra variante se oculte completa.
  for (const variante of [...variantes].sort((a, b) => b.length - a.length)) {
    resultado = resultado.replaceAll(variante, '***');
  }
  return resultado;
}

/** Resume la salida de un comando en pocas líneas, sin contraseñas, para mostrar el motivo de un fallo. */
export function resumirSalida(salida, claves = [], maximoLineas = 3) {
  const lineas = String(salida)
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '');
  const ultimas = lineas.slice(-maximoLineas).join(' | ');
  return ocultarClaves(ultimas.length > 300 ? `${ultimas.slice(0, 300)}…` : ultimas, claves);
}

/** Texto de un paso fallido: qué paso, el motivo resumido y sin contraseñas. */
export function describirFallo(paso, motivo, claves = []) {
  return `✗ ${paso}: ${ocultarClaves(motivo, claves)}`;
}

/**
 * Sentencia SQL que crea el rol de la aplicación sin superusuario. La contraseña va entre comillas simples con las
 * comillas duplicadas (y con `standard_conforming_strings` activo, para que la barra invertida no sea especial).
 * El nombre se valida con `^[a-z_][a-z0-9_]*$` antes de usarlo entre comillas dobles.
 */
export function sentenciaCrearRol(usuario, clave) {
  if (!esNombreValido(usuario)) {
    throw new Error('El usuario de DATABASE_URL debe tener solo minúsculas, dígitos y guiones bajos.');
  }
  if (clave.includes('\0')) throw new Error('La contraseña de DATABASE_URL no puede contener caracteres nulos.');
  const literal = `'${clave.replaceAll("'", "''")}'`;
  return [
    'SET standard_conforming_strings = on;',
    `CREATE ROLE "${usuario}" LOGIN CREATEDB NOSUPERUSER PASSWORD ${literal};`,
    '',
  ].join('\n');
}

/** Sentencia que consulta si existe un rol (el nombre debe ser válido). */
export function sentenciaExisteRol(usuario) {
  if (!esNombreValido(usuario)) {
    throw new Error('El usuario de DATABASE_URL debe tener solo minúsculas, dígitos y guiones bajos.');
  }
  return `SELECT 1 FROM pg_roles WHERE rolname = '${usuario}';\n`;
}

/** Huella sha256 (hexadecimal) del contenido de un archivo. */
export function huellaDeArchivo(ruta) {
  return crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');
}

/** ¿Hay que instalar dependencias? Si falta node_modules, o la huella guardada no coincide con la del lock. */
export function necesitaInstalar({ existeNodeModules, huellaGuardada, huellaActual }) {
  return !existeNodeModules || huellaGuardada !== huellaActual;
}

/** Descompone DATABASE_URL y valida los nombres de usuario y bases. Lanza errores sin incluir valores. */
export function leerConexion(env) {
  const desarrollo = analizarUrlPostgres(env['DATABASE_URL'], 'DATABASE_URL');
  const pruebas = analizarUrlPostgres(env['DATABASE_URL_PRUEBAS'], 'DATABASE_URL_PRUEBAS');
  return { desarrollo, pruebas };
}

// ---------------------------------------------------------------------------------------------------------------
// Utilidades con efectos
// ---------------------------------------------------------------------------------------------------------------

/** Ejecuta un comando sin shell. Devuelve `{ ok, salida, noExiste }` con stdout y stderr juntos. */
export function ejecutar(comando, argumentos, { cwd, env, entrada, timeoutMs = 120_000 } = {}) {
  const resultado = spawnSync(comando, argumentos, {
    cwd,
    env,
    input: entrada,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (resultado.error) {
    const noExiste = resultado.error.code === 'ENOENT';
    return { ok: false, noExiste, salida: noExiste ? `${comando} no está instalado` : resultado.error.message };
  }
  const salida = `${resultado.stdout ?? ''}\n${resultado.stderr ?? ''}`;
  return { ok: resultado.status === 0, noExiste: false, salida };
}

/** ¿Responde algo en host:puerto? */
export function puertoResponde(host, puerto, esperaMs = 1000) {
  return new Promise((resolver) => {
    const conexion = net.createConnection({ host, port: puerto });
    const terminar = (valor) => {
      conexion.destroy();
      resolver(valor);
    };
    conexion.setTimeout(esperaMs, () => terminar(false));
    conexion.once('connect', () => terminar(true));
    conexion.once('error', () => terminar(false));
  });
}

const pausa = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

async function esperarPuerto(host, puerto, segundos) {
  const limite = Date.now() + segundos * 1000;
  for (;;) {
    if (await puertoResponde(host, puerto)) return true;
    if (Date.now() >= limite) return false;
    await pausa(1000);
  }
}

/** Ejecuta psql como el usuario del sistema `postgres`, con la sentencia por la entrada estándar. */
function ejecutarPsqlComoPostgres(sentencia, extra = []) {
  const argumentosPsql = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', ...extra];
  const esAdministrador = typeof process.getuid === 'function' && process.getuid() === 0;
  const candidatos = esAdministrador
    ? [
        ['runuser', ['-u', 'postgres', '--', 'psql', ...argumentosPsql]],
        ['su', ['postgres', '-c', `psql ${argumentosPsql.join(' ')}`]],
      ]
    : os.userInfo().username === 'postgres'
      ? [['psql', argumentosPsql]]
      : [['sudo', ['-n', '-u', 'postgres', 'psql', ...argumentosPsql]]];
  let ultimo = { ok: false, noExiste: true, salida: 'no hay forma de ejecutar psql como el usuario postgres' };
  for (const [comando, argumentos] of candidatos) {
    ultimo = ejecutar(comando, argumentos, { cwd: path.parse(process.cwd()).root, entrada: sentencia });
    if (!ultimo.noExiste) return ultimo;
  }
  return ultimo;
}

/** Variables de entorno para los procesos hijos: las del proceso, completadas con las del .env sin sobrescribir. */
function entornoParaHijos(raiz) {
  const entorno = { ...process.env };
  const rutaEnv = path.join(raiz, '.env');
  if (fs.existsSync(rutaEnv)) {
    for (const [clave, valor] of Object.entries(parseEnv(fs.readFileSync(rutaEnv, 'utf8')))) {
      if (entorno[clave] === undefined) entorno[clave] = valor;
    }
  }
  return entorno;
}

// ---------------------------------------------------------------------------------------------------------------
// Preparación
// ---------------------------------------------------------------------------------------------------------------

/**
 * Ejecuta los pasos de preparación en `raiz`. Devuelve `{ lineas, completo }`: el resumen (una línea por paso) y si
 * todos los pasos terminaron bien. No lanza errores: cada paso informa su propio fallo.
 */
export async function prepararSesion(raiz) {
  const lineas = [];
  const claves = [];
  let completo = true;
  const bien = (paso, detalle) => lineas.push(`✓ ${paso}${detalle ? `: ${detalle}` : ''}`);
  const omitido = (paso, motivo) => lineas.push(`- ${paso}: ${motivo}`);
  const mal = (paso, motivo) => {
    completo = false;
    lineas.push(describirFallo(paso, motivo, claves));
  };

  // 1. .env
  let envListo = false;
  let envCreado = false;
  const rutaEnv = path.join(raiz, '.env');
  try {
    if (fs.existsSync(rutaEnv)) {
      bien('.env', 'ya existía, no se modificó');
      envListo = true;
    } else {
      fs.copyFileSync(path.join(raiz, '.env.example'), rutaEnv, fs.constants.COPYFILE_EXCL);
      bien('.env', 'creado desde .env.example');
      envListo = true;
      envCreado = true;
    }
  } catch (error) {
    mal('.env', error instanceof Error ? error.message : String(error));
  }

  // 1b. Navegador de Playwright preinstalado en la nube (lo usa la prueba E2E).
  try {
    if (fs.existsSync(CHROMIUM_NUBE)) {
      const linea = `CHROMIUM_EJECUTABLE=${CHROMIUM_NUBE}`;
      if (envCreado && !fs.readFileSync(rutaEnv, 'utf8').includes('CHROMIUM_EJECUTABLE=')) {
        fs.appendFileSync(
          rutaEnv,
          `\n# Navegador preinstalado en la nube para las pruebas E2E (lo agrega el hook de sesión).\n${linea}\n`,
        );
      }
      const archivoEntorno = process.env['CLAUDE_ENV_FILE'];
      if (archivoEntorno) {
        const actual = fs.existsSync(archivoEntorno) ? fs.readFileSync(archivoEntorno, 'utf8') : '';
        if (!actual.includes(linea)) fs.appendFileSync(archivoEntorno, `export ${linea}\n`);
      }
      bien('Navegador para E2E', linea);
    }
  } catch (error) {
    mal('Navegador para E2E', error instanceof Error ? error.message : String(error));
  }

  // Conexión: de DATABASE_URL del entorno (el .env completa lo que falte).
  let conexion = null;
  if (envListo) {
    try {
      const entorno = entornoParaHijos(raiz);
      conexion = leerConexion(entorno);
      claves.push(conexion.desarrollo.clave, conexion.pruebas.clave);
      for (const nombre of [
        conexion.desarrollo.usuario,
        conexion.desarrollo.base,
        conexion.pruebas.usuario,
        conexion.pruebas.base,
      ]) {
        if (!esNombreValido(nombre)) {
          throw new Error('Los nombres de usuario y de base deben tener solo minúsculas, dígitos y guiones bajos.');
        }
      }
    } catch (error) {
      conexion = null;
      mal('Configuración de la base', error instanceof Error ? error.message : String(error));
    }
  }

  // 2 y 3. PostgreSQL y rol, solo si la base es local.
  let baseLista = false;
  if (conexion) {
    const { host, puerto, usuario, clave } = conexion.desarrollo;
    if (!HOSTS_LOCALES.has(host)) {
      omitido(
        'PostgreSQL',
        `el host de DATABASE_URL no es localhost ni 127.0.0.1; no se gestiona PostgreSQL, bases ni migraciones`,
      );
    } else {
      let responde = await puertoResponde(host, puerto);
      if (responde) {
        bien('PostgreSQL', `ya responde en ${host}:${puerto}`);
      } else {
        const inicio = ejecutar('pg_ctlcluster', [...CLUSTER, 'start'], { timeoutMs: 60_000 });
        if (!inicio.ok) {
          mal(
            'PostgreSQL',
            `no se pudo encender el cluster ${CLUSTER.join(' ')}: ${resumirSalida(inicio.salida, claves)}`,
          );
        } else {
          responde = await esperarPuerto(host, puerto, SEGUNDOS_ESPERA_POSTGRES);
          if (responde) bien('PostgreSQL', `cluster ${CLUSTER.join(' ')} encendido en ${host}:${puerto}`);
          else mal('PostgreSQL', `no respondió en ${host}:${puerto} tras ${SEGUNDOS_ESPERA_POSTGRES} segundos`);
        }
      }

      if (responde) {
        try {
          if (usuario === 'postgres') {
            bien('Rol de la base', 'postgres ya existe');
            baseLista = true;
          } else {
            const consulta = ejecutarPsqlComoPostgres(sentenciaExisteRol(usuario));
            if (!consulta.ok) throw new Error(resumirSalida(consulta.salida, claves));
            if (consulta.salida.split(/\r?\n/).some((linea) => linea.trim() === '1')) {
              bien('Rol de la base', `${usuario} ya existía`);
              baseLista = true;
            } else {
              const creacion = ejecutarPsqlComoPostgres(sentenciaCrearRol(usuario, clave));
              if (!creacion.ok) throw new Error(resumirSalida(creacion.salida, claves));
              bien('Rol de la base', `${usuario} creado (LOGIN, CREATEDB, sin superusuario)`);
              baseLista = true;
            }
          }
        } catch (error) {
          mal('Rol de la base', error instanceof Error ? error.message : String(error));
        }
      }
    }
  }

  // 4. Dependencias.
  let dependenciasListas = false;
  try {
    const rutaLock = path.join(raiz, 'package-lock.json');
    if (!fs.existsSync(rutaLock)) throw new Error('falta package-lock.json');
    const huellaActual = huellaDeArchivo(rutaLock);
    const rutaHuella = path.join(raiz, ARCHIVO_HUELLA);
    const huellaGuardada = fs.existsSync(rutaHuella) ? fs.readFileSync(rutaHuella, 'utf8').trim() : null;
    const existeNodeModules = fs.existsSync(path.join(raiz, 'node_modules'));
    if (!necesitaInstalar({ existeNodeModules, huellaGuardada, huellaActual })) {
      bien('Dependencias', 'ya instaladas');
      dependenciasListas = true;
    } else {
      const instalacion = ejecutar('npm', ['ci'], { cwd: raiz, env: entornoParaHijos(raiz), timeoutMs: 450_000 });
      if (!instalacion.ok) throw new Error(`npm ci falló: ${resumirSalida(instalacion.salida, claves)}`);
      fs.writeFileSync(rutaHuella, `${huellaActual}\n`);
      bien('Dependencias', 'instaladas con npm ci');
      dependenciasListas = true;
    }
  } catch (error) {
    mal('Dependencias', error instanceof Error ? error.message : String(error));
  }

  // 5. Cliente de Prisma, bases y migraciones.
  if (dependenciasListas) {
    const entorno = entornoParaHijos(raiz);
    const correr = (paso, argumentos, timeoutMs = 120_000) => {
      const resultado = ejecutar('npm', argumentos, { cwd: raiz, env: entorno, timeoutMs });
      if (resultado.ok) bien(paso);
      else mal(paso, resumirSalida(resultado.salida, claves));
      return resultado.ok;
    };
    correr('Cliente de Prisma', ['run', 'postinstall', '-w', '@aquagestion/backend']);
    if (baseLista) {
      if (correr('Bases de datos', ['run', 'db:crear'])) {
        correr('Migraciones de desarrollo', ['run', 'db:migrar']);
        correr('Migraciones de pruebas', ['run', 'db:migrar:pruebas']);
      }
    } else if (conexion && HOSTS_LOCALES.has(conexion.desarrollo.host)) {
      omitido('Bases de datos y migraciones', 'PostgreSQL o el rol no están listos (ver arriba)');
    } else if (!conexion) {
      omitido('Bases de datos y migraciones', 'falta una configuración válida de la base (ver arriba)');
    }
  } else {
    omitido('Cliente de Prisma, bases y migraciones', 'las dependencias no están listas (ver arriba)');
  }

  lineas.push(completo ? 'Sesión preparada.' : `Preparación incompleta: reintenta con ${COMANDO_REINTENTO}`);
  return { lineas, completo };
}

// ---------------------------------------------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------------------------------------------

async function principal() {
  // Primera instrucción con efectos: fuera de la nube no se hace nada.
  if (!esSesionEnLaNube(process.env)) return;

  const raiz = process.env['CLAUDE_PROJECT_DIR']
    ? path.resolve(process.env['CLAUDE_PROJECT_DIR'])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    const { lineas } = await prepararSesion(raiz);
    console.log(lineas.join('\n'));
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    console.log(`✗ Error inesperado: ${motivo}\nPreparación incompleta: reintenta con ${COMANDO_REINTENTO}`);
  }
}

const esEjecucionDirecta =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (esEjecucionDirecta) {
  await principal();
  process.exit(0);
}
