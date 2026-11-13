// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 148 (ataque ronda 9, O1; AMPLIA los criterios 6 y 8 y complementa el 81 y el 143), precision P-35, parte del hook de sesion
// (`.claude/hooks/preparar-sesion.mjs`): el hook exporta una funcion con lo que hacia el paso 3b antes de consultar el rol de la app: lee
// `DATABASE_URL_APP` con `leerUrlApp`, comprueba el usuario (criterio 6) y compara el servidor, el puerto y la base con los de `DATABASE_URL`
// (`conexion.desarrollo`) con `diferenciasConDesarrollo`. Con alguna diferencia lanza un error que nombra `DATABASE_URL_APP`, `DATABASE_URL` y
// cada parte que difiere, sin la contrasena ni la URL, y no ejecuta `psql`; el paso "Rol de la aplicacion" del hook falla y lo informa, sin
// consultar ni crear el rol. El nombre de la funcion es orientativo en la especificacion (P-35): estas pruebas usan `leerUrlAppParaRol(entorno,
// desarrollo)`, con `entorno` con `DATABASE_URL_APP` y `desarrollo` el objeto de `leerConexion(...).desarrollo`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as hook from '../../.claude/hooks/preparar-sesion.mjs';

const HOOK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.claude',
  'hooks',
  'preparar-sesion.mjs',
);
const esWindows = process.platform === 'win32';
const CLAVE_DUENO = 'ClaveDuenoR9x';
const CLAVE_APP = 'ClaveAppR9y';
const DESARROLLO = `postgresql://aquagestion:${CLAVE_DUENO}@127.0.0.1:5432/aquagestion`;
const PRUEBAS = `postgresql://aquagestion:${CLAVE_DUENO}@127.0.0.1:5432/aquagestion_pruebas`;
const APP = `postgresql://aquagestion_app:${CLAVE_APP}@127.0.0.1:5432/aquagestion`;

beforeAll(async () => {
  // Como hace el hook en la nube: las utilidades de entorno se cargan con import() dinamico antes de leer las URL.
  await hook.cargarUtilidadesEntorno();
  await hook.cargarEvaluacionRolApp();
});

/** La funcion de P-35 del hook, con una falla clara si todavia no existe. */
function leerUrlAppParaRol(entorno, desarrollo) {
  if (typeof hook.leerUrlAppParaRol !== 'function') {
    throw new Error(
      'Falta la funcionalidad de la 001: .claude/hooks/preparar-sesion.mjs no exporta leerUrlAppParaRol (P-35, criterio 148).',
    );
  }
  return hook.leerUrlAppParaRol(entorno, desarrollo);
}

const conexionDe = (urlDesarrollo) =>
  hook.leerConexion({ DATABASE_URL: urlDesarrollo, DATABASE_URL_PRUEBAS: PRUEBAS }).desarrollo;

function mensajeDe(f) {
  try {
    f();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('La lectura de DATABASE_URL_APP debia fallar y no fallo.');
}

/** El mensaje nombra las dos variables (DATABASE_URL por si sola, no solo dentro de DATABASE_URL_APP) y las partes, y no trae secretos ni URL. */
function esperarMensaje(mensaje, partes, urls) {
  expect(mensaje, 'el mensaje debe nombrar DATABASE_URL_APP').toContain('DATABASE_URL_APP');
  expect(mensaje, 'el mensaje debe nombrar DATABASE_URL por si sola').toMatch(/DATABASE_URL(?![A-Z_])/);
  for (const parte of partes)
    expect(mensaje.toLowerCase(), `el mensaje debe nombrar la parte ${parte}`).toContain(parte);
  expect(mensaje, 'el mensaje no puede traer la contrasena de la app').not.toContain(CLAVE_APP);
  expect(mensaje, 'el mensaje no puede traer la contrasena del duenio').not.toContain(CLAVE_DUENO);
  for (const url of urls) {
    expect(mensaje, 'el mensaje no puede traer la URL').not.toContain(url);
    expect(mensaje, 'el mensaje no puede traer la URL codificada').not.toContain(encodeURIComponent(url));
  }
}

const CASOS_QUE_DIFIEREN = [
  ['otra base', `postgresql://aquagestion_app:${CLAVE_APP}@127.0.0.1:5432/otra_base_r9`, ['base']],
  ['otro puerto', `postgresql://aquagestion_app:${CLAVE_APP}@127.0.0.1:5433/aquagestion`, ['puerto']],
  ['otro servidor', `postgresql://aquagestion_app:${CLAVE_APP}@db-otro.example:5432/aquagestion`, ['servidor']],
  [
    'localhost en lugar de 127.0.0.1',
    `postgresql://aquagestion_app:${CLAVE_APP}@localhost:5432/aquagestion`,
    ['servidor'],
  ],
  [
    'servidor, puerto y base a la vez',
    `postgresql://aquagestion_app:${CLAVE_APP}@db-otro.example:5433/otra_base_r9`,
    ['servidor', 'puerto', 'base'],
  ],
];

describe('criterio 148 (P-35): la funcion del hook que lee y valida DATABASE_URL_APP compara con DATABASE_URL', () => {
  let binFalso;
  let marcador;
  let pathOriginal;

  beforeEach(() => {
    binFalso = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-bin-r9-'));
    marcador = path.join(binFalso, 'marcador.txt');
    pathOriginal = process.env.PATH;
    if (!esWindows) {
      for (const comando of ['psql', 'runuser', 'sudo', 'su']) {
        const ruta = path.join(binFalso, comando);
        fs.writeFileSync(ruta, `#!/bin/sh\necho ${comando} >> "${marcador}"\nexit 0\n`);
        fs.chmodSync(ruta, 0o755);
      }
      // La funcion no debe lanzar ningun comando: si lo hiciera, quedaria una marca (y se usaria uno de estos falsos).
      process.env.PATH = `${binFalso}${path.delimiter}${pathOriginal ?? ''}`;
    }
  });
  afterEach(() => {
    process.env.PATH = pathOriginal;
    fs.rmSync(binFalso, { recursive: true, force: true });
  });

  it('criterio 148: con el mismo servidor, puerto y base que DATABASE_URL no lanza y no ejecuta psql (control)', () => {
    expect(() => leerUrlAppParaRol({ DATABASE_URL_APP: APP }, conexionDe(DESARROLLO))).not.toThrow();
    expect(fs.existsSync(marcador), 'no debe ejecutar psql').toBe(false);
  });

  it.each(CASOS_QUE_DIFIEREN)(
    'criterio 148: con %s lanza un error que nombra las dos variables y la parte, sin la contrasena ni la URL, y no ejecuta psql',
    (_caso, urlApp, partes) => {
      const mensaje = mensajeDe(() => leerUrlAppParaRol({ DATABASE_URL_APP: urlApp }, conexionDe(DESARROLLO)));

      esperarMensaje(mensaje, partes, [urlApp, DESARROLLO]);
      expect(fs.existsSync(marcador), 'no debe ejecutar psql').toBe(false);
    },
  );

  it('criterio 148: el mensaje pide corregir DATABASE_URL_APP', () => {
    const mensaje = mensajeDe(() =>
      leerUrlAppParaRol(
        { DATABASE_URL_APP: `postgresql://aquagestion_app:${CLAVE_APP}@127.0.0.1:5432/otra_base_r9` },
        conexionDe(DESARROLLO),
      ),
    );

    expect(mensaje).toMatch(/corrig/i);
  });

  it.each([
    [
      'LOCALHOST frente a localhost',
      'postgresql://aquagestion_app:x@LOCALHOST:5432/aquagestion',
      'postgresql://aquagestion:y@localhost:5432/aquagestion',
    ],
    [
      'sin puerto frente a :5432',
      'postgresql://aquagestion_app:x@127.0.0.1/aquagestion',
      'postgresql://aquagestion:y@127.0.0.1:5432/aquagestion',
    ],
    [
      ':5432 frente a sin puerto en DATABASE_URL',
      'postgresql://aquagestion_app:x@127.0.0.1:5432/aquagestion',
      'postgresql://aquagestion:y@127.0.0.1/aquagestion',
    ],
    [
      'base codificada que coincide',
      'postgresql://aquagestion_app:x@127.0.0.1:5432/aqua%5Fdev',
      'postgresql://aquagestion:y@127.0.0.1:5432/aqua_dev',
    ],
    [
      'options y sslmode solo en DATABASE_URL_APP',
      `postgresql://aquagestion_app:x@127.0.0.1:5432/aquagestion?sslmode=disable&options=${encodeURIComponent('-c TimeZone=UTC')}`,
      'postgresql://aquagestion:y@127.0.0.1:5432/aquagestion',
    ],
  ])('criterio 148: %s coincide y no lanza', (_caso, urlApp, urlDesarrollo) => {
    expect(() => leerUrlAppParaRol({ DATABASE_URL_APP: urlApp }, conexionDe(urlDesarrollo))).not.toThrow();
    expect(fs.existsSync(marcador), 'no debe ejecutar psql').toBe(false);
  });

  it('criterio 148 (criterio 6, sin perderlo al extraer la funcion): un usuario que no es aquagestion_app o igual al de DATABASE_URL sigue lanzando', () => {
    const otroUsuario = mensajeDe(() =>
      leerUrlAppParaRol(
        { DATABASE_URL_APP: `postgresql://otro_usuario:${CLAVE_APP}@127.0.0.1:5432/aquagestion` },
        conexionDe(DESARROLLO),
      ),
    );
    expect(otroUsuario).toContain('DATABASE_URL_APP');
    expect(otroUsuario).not.toContain(CLAVE_APP);

    const mismoUsuario = mensajeDe(() =>
      leerUrlAppParaRol(
        { DATABASE_URL_APP: `postgresql://aquagestion_app:${CLAVE_APP}@127.0.0.1:5432/aquagestion` },
        conexionDe(`postgresql://aquagestion_app:${CLAVE_DUENO}@127.0.0.1:5432/aquagestion`),
      ),
    );
    expect(mismoUsuario).toContain('DATABASE_URL_APP');
    expect(mismoUsuario).not.toContain(CLAVE_APP);
  });

  it('criterio 148 (criterios 5 y 143, sin perderlos): sin DATABASE_URL_APP, con una URL que no es de PostgreSQL o con ?user= lanza nombrando la variable', () => {
    for (const entorno of [
      {},
      { DATABASE_URL_APP: 'mysql://aquagestion_app:x@127.0.0.1:5432/aquagestion' },
      { DATABASE_URL_APP: `${APP}?user=aquagestion` },
    ]) {
      const mensaje = mensajeDe(() => leerUrlAppParaRol(entorno, conexionDe(DESARROLLO)));
      expect(mensaje).toContain('DATABASE_URL_APP');
      expect(mensaje).not.toContain(CLAVE_APP);
    }
  });
});

describe.skipIf(esWindows)(
  'criterio 148: el paso "Rol de la aplicacion" del hook falla y lo informa, sin consultar ni crear el rol',
  () => {
    let proyecto;
    let binFalso;
    let marcador;
    let servidor;
    let puerto;

    beforeEach(async () => {
      proyecto = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-hook-r9-'));
      binFalso = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-bin-r9-'));
      marcador = path.join(binFalso, 'marcador.txt');
      servidor = net.createServer();
      await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
      puerto = servidor.address().port;
      fs.writeFileSync(path.join(proyecto, 'package-lock.json'), '{}\n');
      fs.mkdirSync(path.join(proyecto, 'node_modules'));
      // psql falso (sirve tambien para runuser y sudo): registra lo que recibe por la entrada estandar y responde como un servidor donde
      // todos los roles existen y el rol de la app es seguro. Solo usa comandos internos del shell (el PATH de la prueba es solo esta carpeta).
      const cuerpo = [
        '#!/bin/sh',
        'entrada=""',
        'while IFS= read -r linea || [ -n "$linea" ]; do entrada="$entrada$linea',
        '"; done',
        `printf '%s\\n' "$entrada" >> "${marcador}"`,
        'case "$entrada" in',
        "  *rolsuper*) echo 'f|f|f|f|f|f|' ;;",
        '  *) echo 1 ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n');
      for (const comando of ['psql', 'runuser', 'sudo']) {
        const ruta = path.join(binFalso, comando);
        fs.writeFileSync(ruta, cuerpo);
        fs.chmodSync(ruta, 0o755);
      }
      const npm = path.join(binFalso, 'npm');
      fs.writeFileSync(npm, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(npm, 0o755);
    });
    afterEach(async () => {
      await new Promise((resolver) => servidor.close(resolver));
      fs.rmSync(proyecto, { recursive: true, force: true });
      fs.rmSync(binFalso, { recursive: true, force: true });
    });

    function ejecutarHook(urlApp) {
      fs.writeFileSync(
        path.join(proyecto, '.env.example'),
        [
          `DATABASE_URL=postgresql://aqua:${CLAVE_DUENO}@127.0.0.1:${puerto}/aqua`,
          `DATABASE_URL_PRUEBAS=postgresql://aqua:${CLAVE_DUENO}@127.0.0.1:${puerto}/aqua_pruebas`,
          `DATABASE_URL_APP=${urlApp}`,
          '',
        ].join('\n'),
      );
      const entorno = { ...process.env, CLAUDE_PROJECT_DIR: proyecto, CLAUDE_CODE_REMOTE: 'true', PATH: binFalso };
      for (const clave of ['DATABASE_URL', 'DATABASE_URL_PRUEBAS', 'DATABASE_URL_APP', 'CLAUDE_ENV_FILE'])
        delete entorno[clave];
      const resultado = spawnSync(process.execPath, [HOOK], { cwd: proyecto, env: entorno, encoding: 'utf8' });
      return { codigo: resultado.status, texto: `${resultado.stdout}${resultado.stderr}` };
    }

    const registrado = () => (fs.existsSync(marcador) ? fs.readFileSync(marcador, 'utf8') : '');

    it('criterio 148 (control): con el mismo servidor, puerto y base, el paso consulta el rol y lo da por existente', () => {
      const resultado = ejecutarHook(
        `postgresql://aquagestion_app:${CLAVE_APP}@127.0.0.1:${puerto}/aqua?sslmode=disable`,
      );

      expect(resultado.codigo).toBe(0);
      expect(resultado.texto).toContain('✓ Rol de la aplicación');
      expect(registrado(), 'el hook debia consultar el rol de la app').toContain("rolname = 'aquagestion_app'");
    });

    it.each([
      ['otra base', (p) => `postgresql://aquagestion_app:${CLAVE_APP}@127.0.0.1:${p}/otra_base_r9`, 'base'],
      ['otro puerto', (p) => `postgresql://aquagestion_app:${CLAVE_APP}@127.0.0.1:${p + 1}/aqua`, 'puerto'],
      [
        'localhost en lugar de 127.0.0.1',
        (p) => `postgresql://aquagestion_app:${CLAVE_APP}@localhost:${p}/aqua`,
        'servidor',
      ],
    ])(
      'criterio 148: con %s el paso "Rol de la aplicación" falla nombrando la parte, sin la contraseña, y no consulta ni crea el rol',
      (_caso, urlDe, parte) => {
        const urlApp = urlDe(puerto);

        const resultado = ejecutarHook(urlApp);

        expect(resultado.codigo, 'el hook siempre termina en 0').toBe(0);
        expect(resultado.texto).toContain('✗ Rol de la aplicación');
        const linea = resultado.texto.split('\n').find((texto) => texto.includes('✗ Rol de la aplicación')) ?? '';
        expect(linea).toContain('DATABASE_URL_APP');
        expect(linea).toMatch(/DATABASE_URL(?![A-Z_])/);
        expect(linea.toLowerCase()).toContain(parte);
        expect(resultado.texto).not.toContain(CLAVE_APP);
        expect(resultado.texto).not.toContain(CLAVE_DUENO);
        expect(resultado.texto).not.toContain(urlApp);
        expect(resultado.texto).toContain('Preparación incompleta');
        // El rol del duenio ("aqua") se consulta antes; el de la app, ni se consulta ni se crea.
        expect(registrado()).toContain("rolname = 'aqua'");
        expect(registrado(), 'no debe consultar ni crear aquagestion_app').not.toContain('aquagestion_app');
      },
    );
  },
);
