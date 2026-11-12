// Prepara la sesión de Claude Code en la nube (spec 000, criterios 43 a 47; D-26).
//
// Solo actúa si CLAUDE_CODE_REMOTE vale "true". En la PC del responsable y en la integración continua no hace nada:
// no escribe en la salida, no crea archivos y no ejecuta comandos.
//
// Pasos, en orden:
//   1. Crea .env copiando .env.example (nunca sobrescribe un .env existente).
//   2. Enciende PostgreSQL (cluster 16 main) si no responde en el host y puerto de DATABASE_URL.
//   3. Crea el rol de DATABASE_URL (LOGIN, CREATEDB, sin superusuario) si no existe, y después el rol de la API,
//      aquagestion_app (el de DATABASE_URL_APP: sin ningún privilegio, spec 001), también como el usuario postgres.
//   4. Ejecuta npm ci si falta node_modules o si package-lock.json cambió desde la última instalación hecha aquí.
//   5. Crea las bases, genera el cliente de Prisma y aplica las migraciones a la base de desarrollo y a la de pruebas.
//   6. Imprime un resumen breve, una línea por paso.
//
// Siempre termina con código 0 para no bloquear la sesión; si un paso falla, la salida dice cuál, por qué y cómo
// reintentar. Nunca imprime la contraseña de la base. Solo usa módulos incluidos en Node (se ejecuta antes de npm ci)
// y lanza los comandos externos sin shell, con los argumentos separados.
//
// Las utilidades de scripts/lib/entorno.mjs se cargan con import() dinámico, solo en la nube y dentro de try/catch:
// fuera de la nube nunca se leen, y en la nube un fallo al cargarlas se informa como paso fallido.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const COMANDO_REINTENTO = 'node .claude/hooks/preparar-sesion.mjs';
const CLUSTER = ['16', 'main'];
const SEGUNDOS_ESPERA_POSTGRES = 30;
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1']);
const CHROMIUM_NUBE = '/opt/pw-browsers/chromium';
const ARCHIVO_HUELLA = path.join('node_modules', '.preparar-sesion.sha256');
const RAIZ_DEL_REPOSITORIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let utilidadesEntorno = null;

/**
 * Carga scripts/lib/entorno.mjs (import dinámico, una sola vez). Debe llamarse después de comprobar que la sesión es
 * la nube. Lanza el error de la importación si el módulo no se puede cargar.
 */
export async function cargarUtilidadesEntorno() {
  utilidadesEntorno ??= await import('../../scripts/lib/entorno.mjs');
  return utilidadesEntorno;
}

let moduloRolApp = null;

/** Carga scripts/lib/rol-app.mjs (import dinámico, una sola vez; no tiene dependencias externas). */
export async function cargarEvaluacionRolApp() {
  moduloRolApp ??= await import('../../scripts/lib/rol-app.mjs');
  return moduloRolApp;
}

function utilidades() {
  if (!utilidadesEntorno) throw new Error('Las utilidades de entorno no se cargaron (falta cargarUtilidadesEntorno).');
  return utilidadesEntorno;
}

const esNombreValido = (nombre) => utilidades().esNombreValido(nombre);

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
 * Verificador SCRAM-SHA-256 de una contraseña (spec 001, criterio 104): la contraseña nunca viaja en claro en un `CREATE ROLE`.
 * Usa `verificadorScram` de `scripts/lib/rol-app.mjs` (solo `node:*`), que `prepararSesion` carga antes. Una contraseña fuera
 * de ASCII imprimible (U+0020 a U+007E) hace fallar el paso con un error que nombra la variable y no muestra la contraseña.
 */
function verificadorDeClave(clave, variable) {
  if (!moduloRolApp) throw new Error('La evaluación del rol no se cargó (falta cargarEvaluacionRolApp).');
  try {
    return moduloRolApp.verificadorScram(clave);
  } catch {
    throw new Error(
      `La contraseña de ${variable} tiene caracteres fuera de ASCII imprimible (U+0020 a U+007E): usa solo letras sin ` +
        'tilde, dígitos y signos ASCII (PostgreSQL la normalizaría con SASLprep y el verificador no coincidiría).',
    );
  }
}

/**
 * Sentencia SQL que crea el rol de la aplicación sin superusuario. La contraseña va como verificador SCRAM-SHA-256
 * calculado aquí (criterio 104), nunca en claro. El nombre se valida con `^[a-z_][a-z0-9_]*$` antes de usarlo entre
 * comillas dobles.
 */
export function sentenciaCrearRol(usuario, clave) {
  if (!esNombreValido(usuario)) {
    throw new Error('El usuario de DATABASE_URL debe tener solo minúsculas, dígitos y guiones bajos.');
  }
  if (clave.includes('\0')) throw new Error('La contraseña de DATABASE_URL no puede contener caracteres nulos.');
  const verificador = verificadorDeClave(clave, 'DATABASE_URL');
  return [
    'SET standard_conforming_strings = on;',
    `CREATE ROLE "${usuario}" LOGIN CREATEDB NOSUPERUSER PASSWORD '${verificador}';`,
    '',
  ].join('\n');
}

/**
 * Sentencia SQL que crea el rol de la API (spec 001, criterio 8) con todos los atributos negativos del criterio 1:
 * sin superusuario, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, `REPLICATION` ni herencia. Mismo cuidado con la
 * contraseña que `sentenciaCrearRol`.
 */
export function sentenciaCrearRolApp(usuario, clave) {
  if (!esNombreValido(usuario)) {
    throw new Error('El usuario de DATABASE_URL_APP debe tener solo minúsculas, dígitos y guiones bajos.');
  }
  if (clave.includes('\0')) throw new Error('La contraseña de DATABASE_URL_APP no puede contener caracteres nulos.');
  const verificador = verificadorDeClave(clave, 'DATABASE_URL_APP');
  return [
    'SET standard_conforming_strings = on;',
    `CREATE ROLE "${usuario}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD '${verificador}';`,
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

/**
 * Sentencia que consulta los atributos y las membresías de un rol (el nombre debe ser válido). Con `psql -tA` devuelve
 * una línea `super|bypassrls|replication|createrole|createdb|es_miembro|roles` o ninguna si el rol no existe.
 */
export function sentenciaAtributosRol(usuario) {
  if (!esNombreValido(usuario)) {
    throw new Error('El usuario de DATABASE_URL_APP debe tener solo minúsculas, dígitos y guiones bajos.');
  }
  return (
    `SELECT r.rolsuper, r.rolbypassrls, r.rolreplication, r.rolcreaterole, r.rolcreatedb, ` +
    `EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid), ` +
    `array_to_string(ARRAY(SELECT o.rolname::text FROM pg_auth_members m JOIN pg_roles o ON o.oid = m.roleid ` +
    `WHERE m.member = r.oid ORDER BY 1), ',') FROM pg_roles r WHERE r.rolname = '${usuario}';\n`
  );
}

/** Convierte la línea de `sentenciaAtributosRol` en la fila que evalúa `problemasDelRolApp`; `null` si no hay línea. */
export function filaDeAtributosRol(usuario, salida) {
  const linea = String(salida)
    .split(/\r?\n/)
    .map((texto) => texto.trim())
    .find((texto) => /^[tf]\|[tf]\|[tf]\|[tf]\|[tf]\|[tf]\|/.test(texto));
  if (!linea) return null;
  const [rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb, miembro, roles = ''] = linea.split('|');
  return {
    rolname: usuario,
    rolsuper: rolsuper === 't',
    rolbypassrls: rolbypassrls === 't',
    rolreplication: rolreplication === 't',
    rolcreaterole: rolcreaterole === 't',
    rolcreatedb: rolcreatedb === 't',
    es_miembro: miembro === 't',
    roles: roles === '' ? [] : roles.split(','),
  };
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
  const desarrollo = utilidades().analizarUrlPostgres(env['DATABASE_URL'], 'DATABASE_URL');
  const pruebas = utilidades().analizarUrlPostgres(env['DATABASE_URL_PRUEBAS'], 'DATABASE_URL_PRUEBAS');
  return { desarrollo, pruebas };
}

/**
 * Lee y valida `DATABASE_URL_APP` para el paso "Rol de la aplicación" (spec 001, criterios 6 y 148, P-35). `desarrollo` es
 * `leerConexion(...).desarrollo`. Comprueba el usuario (`aquagestion_app`, distinto del de `DATABASE_URL`) y que el servidor, el
 * puerto y la base coincidan con los de `DATABASE_URL`. Lanza el error sin ejecutar `psql` y sin incluir la URL ni la contraseña.
 * Devuelve las partes de la URL de la app.
 */
export function leerUrlAppParaRol(entorno, desarrollo) {
  const urlApp = utilidades().leerUrlApp(entorno);
  if (urlApp.usuario !== utilidades().USUARIO_APP) {
    throw new Error(`El usuario de DATABASE_URL_APP debe ser ${utilidades().USUARIO_APP}.`);
  }
  if (urlApp.usuario === desarrollo.usuario) {
    throw new Error('DATABASE_URL_APP debe usar un usuario distinto del de DATABASE_URL.');
  }
  const diferencias = utilidades().diferenciasConDesarrollo(urlApp, desarrollo);
  if (diferencias.length > 0) throw new Error(utilidades().mensajeDeDiferenciasConDesarrollo(diferencias));
  return urlApp;
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
  const [comando, argumentos] = esAdministrador
    ? ['runuser', ['-u', 'postgres', '--', 'psql', ...argumentosPsql]]
    : os.userInfo().username === 'postgres'
      ? ['psql', argumentosPsql]
      : ['sudo', ['-n', '-u', 'postgres', 'psql', ...argumentosPsql]];
  const resultado = ejecutar(comando, argumentos, { cwd: path.parse(process.cwd()).root, entrada: sentencia });
  if (resultado.noExiste) {
    return {
      ...resultado,
      salida: `${comando} no está instalado; no se puede ejecutar psql como el usuario postgres`,
    };
  }
  return resultado;
}

// ---------------------------------------------------------------------------------------------------------------
// Lectura del .env (spec 001, criterio 174, P-45)
// ---------------------------------------------------------------------------------------------------------------

const NOMBRE_DE_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Valor vacío, o sin espacios al principio ni al final y solo con U+0020 entre palabras; sin `#`, comillas ni `\`.
const VALOR_SIMPLE = /^(?:[^\s#"'`\\]+(?: [^\s#"'`\\]+)*)?$/;
// Control salvo \n y \r; espacios de `\s` que no son U+0020, \n ni \r; y un \r que no va antes de un \n.
// eslint-disable-next-line no-control-regex -- los caracteres de control son justo lo que se busca
const CARACTERES_PROHIBIDOS = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]|[^\S \n\r]|\r(?!\n)/;

const numeroDeLinea = (texto, indice) => texto.slice(0, indice).split('\n').length;

/**
 * Lector mínimo del `.env` para antes de `npm ci`, cuando `dotenv` todavía puede no estar instalado. Acepta solo la forma
 * simple que escriben `.env.example`, este hook y un editor normal, y para ella devuelve exactamente lo que daría
 * `dotenv.parse`; para cualquier otro texto, o con una variable repetida, lanza un error que pide `npm ci` y nunca incluye
 * un valor. Si una prueba encontrara un texto aceptado que no da lo mismo que `dotenv`, esta forma se estrecha, nunca se amplía.
 */
export function analizarEnvMinimo(texto) {
  const sinBom = texto.startsWith('﻿') ? texto.slice(1) : texto;
  const negarse = (detalle) => {
    throw new Error(
      `El .env tiene una forma que solo puede leer dotenv (${detalle}). Ejecuta npm ci para instalarlo y reintenta con ${COMANDO_REINTENTO}.`,
    );
  };
  const prohibido = CARACTERES_PROHIBIDOS.exec(sinBom);
  if (prohibido) negarse(`línea ${numeroDeLinea(sinBom, prohibido.index)}`);
  const valores = {};
  sinBom.split('\n').forEach((cruda, indice) => {
    const linea = cruda.endsWith('\r') ? cruda.slice(0, -1) : cruda;
    if (linea === '' || linea.startsWith('#')) return;
    const sinExport = linea.startsWith('export ') ? linea.slice(7) : linea;
    const igual = sinExport.indexOf('=');
    const nombre = igual > 0 ? sinExport.slice(0, igual) : '';
    const valor = sinExport.slice(igual + 1);
    if (!NOMBRE_DE_VARIABLE.test(nombre) || !VALOR_SIMPLE.test(valor)) negarse(`línea ${indice + 1}`);
    if (Object.hasOwn(valores, nombre)) negarse(`la variable ${nombre} está repetida`);
    valores[nombre] = valor;
  });
  return valores;
}

/**
 * El analizador del `.env` disponible ahora: `dotenv` si el espacio de trabajo `scripts` de `raizRepo` lo tiene instalado
 * (`{ origen: 'dotenv' }`), si no el lector mínimo (`{ origen: 'minimo' }`). Nunca lanza y no recuerda un fallo: cada llamada
 * lo vuelve a intentar con un `createRequire` nuevo, así que después de `npm ci` la siguiente usa `dotenv`. No importa
 * `dotenv` de forma estática: el hook corre antes de `npm ci` (criterio 47 de 000).
 */
export function cargarAnalizadorEnv(raizRepo = RAIZ_DEL_REPOSITORIO) {
  try {
    const dotenv = createRequire(path.join(raizRepo, 'scripts', 'package.json'))('dotenv');
    if (typeof dotenv?.parse === 'function') return { origen: 'dotenv', analizar: (texto) => dotenv.parse(texto) };
  } catch {
    // Sin dotenv (antes de npm ci): lector mínimo.
  }
  return { origen: 'minimo', analizar: analizarEnvMinimo };
}

/**
 * Variables de entorno para los procesos hijos: una copia de `entorno`, completada con las del .env de `raiz` sin
 * sobrescribir lo ya definido. Lee el .env con `analizador.analizar` y lanza el error de este si lanza (spec 001, criterio 174).
 */
export function entornoParaHijos(raiz, entorno = process.env, analizador = cargarAnalizadorEnv()) {
  const copia = { ...entorno };
  const rutaEnv = path.join(raiz, '.env');
  if (fs.existsSync(rutaEnv)) {
    const valores = analizador.analizar(fs.readFileSync(rutaEnv, 'utf8'));
    for (const [clave, valor] of Object.entries(valores)) {
      if (copia[clave] === undefined) copia[clave] = valor;
    }
  }
  return copia;
}

/**
 * Entorno para `npm ci`: `entornoParaHijos` y, si lanza, una copia de `entorno`. Instalar las dependencias no depende de
 * leer el .env (`prisma.config.ts` lo lee por su cuenta con `dotenv`).
 */
export function entornoParaInstalar(raiz, entorno = process.env, analizador = cargarAnalizadorEnv()) {
  try {
    return entornoParaHijos(raiz, entorno, analizador);
  } catch {
    return { ...entorno };
  }
}

/**
 * ¿El módulo de `urlDelModulo` es el punto de entrada del proceso? Copia de `esPuntoDeEntrada` de
 * scripts/lib/punto-de-entrada.mjs (spec 001, criterio 171, P-44; el hook no importa módulos del repositorio de forma
 * estática). Compara las rutas reales, y en Windows sin distinguir mayúsculas. Nunca lanza.
 */
export function esPuntoDeEntrada(
  urlDelModulo,
  argv1 = process.argv[1],
  { plataforma = process.platform, realpath = fs.realpathSync } = {},
) {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try {
    const delModulo = realpath(fileURLToPath(urlDelModulo));
    const delArgumento = realpath(path.resolve(argv1));
    return plataforma === 'win32' ? delModulo.toLowerCase() === delArgumento.toLowerCase() : delModulo === delArgumento;
  } catch {
    return false;
  }
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
  // Las sentencias que crean roles necesitan `verificadorScram`; si el módulo no carga, esos pasos fallan con su motivo.
  await cargarEvaluacionRolApp().catch(() => undefined);
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
      // Solo cuenta una línea activa: en .env.example la variable viene comentada.
      if (envCreado && !/^CHROMIUM_EJECUTABLE=/m.test(fs.readFileSync(rutaEnv, 'utf8'))) {
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
  let baseRemota = false;
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
  let rolAppListo = false;
  if (conexion) {
    const { host, puerto, usuario, clave } = conexion.desarrollo;
    if (!HOSTS_LOCALES.has(host)) {
      baseRemota = true;
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

      // 3b. Rol de la API (aquagestion_app). El de DATABASE_URL no puede crear roles en la nube: lo crea postgres.
      if (baseLista) {
        try {
          const urlApp = leerUrlAppParaRol(entornoParaHijos(raiz), conexion.desarrollo);
          claves.push(urlApp.clave);
          const consulta = ejecutarPsqlComoPostgres(sentenciaExisteRol(urlApp.usuario));
          if (!consulta.ok) throw new Error(resumirSalida(consulta.salida, claves));
          if (consulta.salida.split(/\r?\n/).some((linea) => linea.trim() === '1')) {
            // Criterio 81: el rol existente no puede ser superusuario, BYPASSRLS, REPLICATION, CREATEROLE ni CREATEDB, ni
            // miembro de otro rol. Las condiciones que dependen de cada base las comprueba `db:crear` a continuación.
            const atributos = ejecutarPsqlComoPostgres(sentenciaAtributosRol(urlApp.usuario));
            if (!atributos.ok) throw new Error(resumirSalida(atributos.salida, claves));
            const fila = filaDeAtributosRol(urlApp.usuario, atributos.salida);
            if (!fila) throw new Error(`no se pudieron leer los atributos del rol ${urlApp.usuario}`);
            const { problemasDelRolApp } = await cargarEvaluacionRolApp();
            const problemas = problemasDelRolApp(fila);
            if (problemas.length > 0) throw new Error(`el rol ya existe pero no es seguro. ${problemas.join(' ')}`);
            bien('Rol de la aplicación', `${urlApp.usuario} ya existía`);
            rolAppListo = true;
          } else {
            const creacion = ejecutarPsqlComoPostgres(sentenciaCrearRolApp(urlApp.usuario, urlApp.clave));
            if (!creacion.ok) throw new Error(resumirSalida(creacion.salida, claves));
            bien('Rol de la aplicación', `${urlApp.usuario} creado (LOGIN, sin ningún privilegio)`);
            rolAppListo = true;
          }
        } catch (error) {
          mal('Rol de la aplicación', error instanceof Error ? error.message : String(error));
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
      const instalacion = ejecutar('npm', ['ci'], { cwd: raiz, env: entornoParaInstalar(raiz), timeoutMs: 450_000 });
      if (!instalacion.ok) throw new Error(`npm ci falló: ${resumirSalida(instalacion.salida, claves)}`);
      fs.writeFileSync(rutaHuella, `${huellaActual}\n`);
      bien('Dependencias', 'instaladas con npm ci');
      dependenciasListas = true;
    }
  } catch (error) {
    mal('Dependencias', error instanceof Error ? error.message : String(error));
  }

  // 5. Cliente de Prisma, bases y migraciones.
  let entornoDePasos = null;
  if (dependenciasListas) {
    try {
      entornoDePasos = entornoParaHijos(raiz);
    } catch (error) {
      mal('Cliente de Prisma, bases y migraciones', error instanceof Error ? error.message : String(error));
    }
  }
  if (dependenciasListas && entornoDePasos) {
    const entorno = entornoDePasos;
    const correr = (paso, argumentos, timeoutMs = 120_000) => {
      const resultado = ejecutar('npm', argumentos, { cwd: raiz, env: entorno, timeoutMs });
      if (resultado.ok) bien(paso);
      else mal(paso, resumirSalida(resultado.salida, claves));
      return resultado.ok;
    };
    correr('Cliente de Prisma', ['run', 'postinstall', '-w', '@aquagestion/backend']);
    if (baseLista && rolAppListo) {
      if (correr('Bases de datos', ['run', 'db:crear'])) {
        correr('Migraciones de desarrollo', ['run', 'db:migrar']);
        correr('Migraciones de pruebas', ['run', 'db:migrar:pruebas']);
      }
    } else if (conexion && HOSTS_LOCALES.has(conexion.desarrollo.host)) {
      omitido('Bases de datos y migraciones', 'PostgreSQL o los roles no están listos (ver arriba)');
    } else if (!conexion) {
      omitido('Bases de datos y migraciones', 'falta una configuración válida de la base (ver arriba)');
    }
  } else if (!dependenciasListas) {
    omitido('Cliente de Prisma, bases y migraciones', 'las dependencias no están listas (ver arriba)');
  }

  if (!completo) lineas.push(`Preparación incompleta: reintenta con ${COMANDO_REINTENTO}`);
  else if (baseRemota) lineas.push('Sesión preparada sin gestionar la base de datos (host remoto).');
  else lineas.push('Sesión preparada.');
  return { lineas, completo };
}

// ---------------------------------------------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------------------------------------------

async function principal() {
  // Primera instrucción con efectos: fuera de la nube no se hace nada.
  if (!esSesionEnLaNube(process.env)) return;

  try {
    await cargarUtilidadesEntorno();
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    console.log(
      `✗ Utilidades de entorno (scripts/lib/entorno.mjs): ${motivo}\nPreparación incompleta: reintenta con ${COMANDO_REINTENTO}`,
    );
    return;
  }

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

if (esPuntoDeEntrada(import.meta.url)) {
  await principal();
  process.exit(0);
}
