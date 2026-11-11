// Pruebas del hook de sesión (spec 000, criterios 43 a 46): el caso fuera de la nube se ejecuta de verdad en un
// directorio temporal; los fallos se simulan con comandos falsos en el PATH (solo en sistemas tipo Unix).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cargarUtilidadesEntorno,
  COMANDO_REINTENTO,
  describirFallo,
  esSesionEnLaNube,
  huellaDeArchivo,
  leerConexion,
  necesitaInstalar,
  ocultarClaves,
  resumirSalida,
  sentenciaCrearRol,
  sentenciaCrearRolApp,
  sentenciaExisteRol,
} from '../../.claude/hooks/preparar-sesion.mjs';

const HOOK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.claude',
  'hooks',
  'preparar-sesion.mjs',
);
const esWindows = process.platform === 'win32';

// Las funciones puras del hook usan scripts/lib/entorno.mjs, que el hook carga solo en la nube.
beforeAll(async () => {
  await cargarUtilidadesEntorno();
});

describe('esSesionEnLaNube', () => {
  it('solo con el valor exacto "true"', () => {
    expect(esSesionEnLaNube({ CLAUDE_CODE_REMOTE: 'true' })).toBe(true);
    for (const valor of [undefined, '', 'false', '1', 'TRUE', 'True', ' true']) {
      expect(esSesionEnLaNube({ CLAUDE_CODE_REMOTE: valor })).toBe(false);
    }
  });
});

describe('ocultarClaves y describirFallo (criterio 46)', () => {
  it('reemplaza la contraseña, su forma codificada y su forma con comillas duplicadas', () => {
    const clave = "p@ss'w/rd";
    const texto = `fallo con ${clave}, url ${encodeURIComponent(clave)} y sql 'p@ss''w/rd'`;
    const oculto = ocultarClaves(texto, [clave]);
    expect(oculto).not.toContain('p@ss');
    expect(oculto).not.toContain(encodeURIComponent(clave));
    expect(oculto).toContain('***');
  });

  it('no cambia el texto si no hay contraseña', () => {
    expect(ocultarClaves('sin secretos', ['', undefined])).toBe('sin secretos');
  });

  it('el texto de un fallo nombra el paso y no contiene la contraseña', () => {
    const texto = describirFallo('Rol de la base', 'LINE 1: CREATE ROLE x PASSWORD SuperClave123', ['SuperClave123']);
    expect(texto.startsWith('✗ Rol de la base: ')).toBe(true);
    expect(texto).not.toContain('SuperClave123');
  });

  it('resumirSalida conserva las últimas líneas, acotadas y sin contraseña', () => {
    const salida = ['uno', 'dos', 'tres', 'cuatro con Clave123', 'cinco', ''].join('\n');
    const resumen = resumirSalida(salida, ['Clave123']);
    expect(resumen).toBe('tres | cuatro con *** | cinco');
    expect(resumirSalida('x'.repeat(1000)).length).toBeLessThanOrEqual(301);
  });
});

describe('sentenciaCrearRol (casos límite: contraseña con comillas o caracteres especiales)', () => {
  it('crea el rol con LOGIN y CREATEDB y sin superusuario', () => {
    const sql = sentenciaCrearRol('aquagestion', 'aquagestion');
    expect(sql).toContain('CREATE ROLE "aquagestion" LOGIN CREATEDB NOSUPERUSER PASSWORD \'aquagestion\';');
    expect(sql).not.toMatch(/(?<!NO)SUPERUSER/);
  });

  it('duplica las comillas simples y deja intactas las barras y los signos de dólar', () => {
    const sql = sentenciaCrearRol('usuario_1', 'a\'b\\c$$d"e;--');
    expect(sql).toContain("PASSWORD 'a''b\\c$$d\"e;--';");
    expect(sql.startsWith('SET standard_conforming_strings = on;')).toBe(true);
    // Una contraseña con una comilla simple no puede cerrar el literal antes de tiempo.
    const hostil = sentenciaCrearRol('usuario_1', "'; DROP ROLE postgres; --");
    expect(hostil).toContain("PASSWORD '''; DROP ROLE postgres; --';");
  });

  it.each(['Aqua', '1aqua', 'aqua-gestion', 'aqua gestion', 'aqua"x', "aqua'x", '', 'ñandú'])(
    'rechaza el usuario %j con un mensaje claro',
    (usuario) => {
      expect(() => sentenciaCrearRol(usuario, 'x')).toThrow(/minúsculas, dígitos y guiones bajos/);
      expect(() => sentenciaExisteRol(usuario)).toThrow(/minúsculas, dígitos y guiones bajos/);
    },
  );

  it('rechaza una contraseña con caracteres nulos', () => {
    expect(() => sentenciaCrearRol('aqua', 'a\0b')).toThrow(/nulos/);
  });

  it('la consulta de existencia usa el nombre validado', () => {
    expect(sentenciaExisteRol('aquagestion')).toBe("SELECT 1 FROM pg_roles WHERE rolname = 'aquagestion';\n");
  });
});

describe('sentenciaCrearRolApp (spec 001, criterios 1 y 8)', () => {
  it('crea el rol de la API con todos los atributos negativos', () => {
    const sql = sentenciaCrearRolApp('aquagestion_app', 'clave-app');
    expect(sql).toContain(
      'CREATE ROLE "aquagestion_app" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ' +
        "PASSWORD 'clave-app';",
    );
    expect(sql.startsWith('SET standard_conforming_strings = on;')).toBe(true);
    expect(sql).not.toMatch(/(?<!NO)(SUPERUSER|BYPASSRLS|CREATEDB|CREATEROLE|REPLICATION)/);
  });

  it('duplica las comillas simples y deja intactas las barras y los signos de dólar', () => {
    const sql = sentenciaCrearRolApp('aquagestion_app', 'a\'b\\c$$d"e;--');
    expect(sql).toContain("PASSWORD 'a''b\\c$$d\"e;--';");
    const hostil = sentenciaCrearRolApp('aquagestion_app', "'; DROP ROLE postgres; --");
    expect(hostil).toContain("PASSWORD '''; DROP ROLE postgres; --';");
  });

  it.each(['Aqua', '1aqua', 'aqua-app', 'aqua app', 'aqua"x', '', 'ñandú'])('rechaza el usuario %j', (usuario) => {
    expect(() => sentenciaCrearRolApp(usuario, 'x')).toThrow(/minúsculas, dígitos y guiones bajos/);
  });

  it('rechaza una contraseña con caracteres nulos sin mostrarla', () => {
    expect(() => sentenciaCrearRolApp('aquagestion_app', 'a\0b')).toThrow(/nulos/);
  });
});

describe('dependencias y conexión', () => {
  it('necesitaInstalar: falta node_modules o la huella cambió', () => {
    expect(necesitaInstalar({ existeNodeModules: false, huellaGuardada: 'a', huellaActual: 'a' })).toBe(true);
    expect(necesitaInstalar({ existeNodeModules: true, huellaGuardada: null, huellaActual: 'a' })).toBe(true);
    expect(necesitaInstalar({ existeNodeModules: true, huellaGuardada: 'a', huellaActual: 'b' })).toBe(true);
    expect(necesitaInstalar({ existeNodeModules: true, huellaGuardada: 'a', huellaActual: 'a' })).toBe(false);
  });

  it('huellaDeArchivo cambia con el contenido', () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-huella-'));
    try {
      const archivo = path.join(carpeta, 'lock.json');
      fs.writeFileSync(archivo, '{"a":1}');
      const uno = huellaDeArchivo(archivo);
      fs.writeFileSync(archivo, '{"a":2}');
      expect(uno).toMatch(/^[0-9a-f]{64}$/);
      expect(huellaDeArchivo(archivo)).not.toBe(uno);
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
    }
  });

  it('leerConexion descompone las dos URL y nombra la variable inválida sin mostrar su valor', () => {
    const { desarrollo, pruebas } = leerConexion({
      DATABASE_URL: 'postgresql://u:clave@127.0.0.1:5432/base',
      DATABASE_URL_PRUEBAS: 'postgresql://u:clave@127.0.0.1:5432/base_pruebas',
    });
    expect(desarrollo.base).toBe('base');
    expect(pruebas.base).toBe('base_pruebas');
    expect(() => leerConexion({ DATABASE_URL: 'mysql://u:SecretoXYZ@h/b', DATABASE_URL_PRUEBAS: '' })).toThrow(
      /DATABASE_URL(?!_)/,
    );
    try {
      leerConexion({ DATABASE_URL: 'mysql://u:SecretoXYZ@h/b' });
    } catch (error) {
      expect(String(error)).not.toContain('SecretoXYZ');
    }
  });
});

/** Instantánea de un directorio: rutas, contenidos y fechas de modificación. */
function instantanea(carpeta) {
  const resultado = {};
  const recorrer = (actual) => {
    for (const entrada of fs.readdirSync(actual, { withFileTypes: true })) {
      const ruta = path.join(actual, entrada.name);
      const relativa = path.relative(carpeta, ruta);
      if (entrada.isDirectory()) {
        resultado[relativa] = 'carpeta';
        recorrer(ruta);
      } else {
        resultado[relativa] = `${fs.statSync(ruta).mtimeMs}:${fs.readFileSync(ruta, 'utf8')}`;
      }
    }
  };
  recorrer(carpeta);
  return resultado;
}

/** Ejecuta el hook como proceso hijo con un entorno controlado. */
function ejecutarHook({ proyecto, remoto, extra = {}, path: rutaBusqueda }) {
  const entorno = { ...process.env, ...extra, CLAUDE_PROJECT_DIR: proyecto };
  delete entorno.CLAUDE_CODE_REMOTE;
  delete entorno.CLAUDE_ENV_FILE;
  for (const clave of ['DATABASE_URL', 'DATABASE_URL_PRUEBAS']) {
    if (!(clave in extra)) delete entorno[clave];
  }
  if (remoto !== undefined) entorno.CLAUDE_CODE_REMOTE = remoto;
  if (rutaBusqueda !== undefined) entorno.PATH = rutaBusqueda;
  const resultado = spawnSync(process.execPath, [HOOK], { cwd: proyecto, env: entorno, encoding: 'utf8' });
  return { codigo: resultado.status, salida: resultado.stdout, error: resultado.stderr };
}

describe('hook de sesión fuera de la nube (criterio 43)', () => {
  let proyecto;
  let binFalso;

  beforeEach(() => {
    proyecto = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-hook-'));
    fs.writeFileSync(path.join(proyecto, '.env.example'), 'DATABASE_URL=postgresql://u:p@127.0.0.1:5432/b\n');
    fs.writeFileSync(path.join(proyecto, 'package-lock.json'), '{}\n');
    binFalso = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-bin-'));
  });
  afterEach(() => {
    fs.rmSync(proyecto, { recursive: true, force: true });
    fs.rmSync(binFalso, { recursive: true, force: true });
  });

  it.each([[undefined], ['false'], ['1'], ['TRUE'], ['']])(
    'con CLAUDE_CODE_REMOTE=%j termina en 0, sin salida y sin tocar nada',
    (valor) => {
      const antes = instantanea(proyecto);
      const resultado = ejecutarHook({ proyecto, remoto: valor });
      expect(resultado.codigo).toBe(0);
      expect(resultado.salida).toBe('');
      expect(resultado.error).toBe('');
      expect(instantanea(proyecto)).toEqual(antes);
      expect(fs.existsSync(path.join(proyecto, '.env'))).toBe(false);
    },
  );

  it.skipIf(esWindows)('no ejecuta ningún comando externo', () => {
    const marcador = path.join(binFalso, 'marcador.txt');
    for (const comando of ['npm', 'pg_ctlcluster', 'runuser', 'psql', 'su', 'sudo']) {
      const ruta = path.join(binFalso, comando);
      fs.writeFileSync(ruta, `#!/bin/sh\necho ${comando} >> "${marcador}"\nexit 0\n`);
      fs.chmodSync(ruta, 0o755);
    }
    const resultado = ejecutarHook({ proyecto, remoto: undefined, path: binFalso });
    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toBe('');
    expect(fs.existsSync(marcador)).toBe(false);
  });
});

describe('carga perezosa de scripts/lib/entorno.mjs (criterios 43 y 46)', () => {
  let proyecto;

  /** Proyecto temporal con una copia del hook y SIN scripts/lib/entorno.mjs (o con uno que falla al cargarse). */
  function proyectoConHook(contenidoEntorno) {
    fs.mkdirSync(path.join(proyecto, '.claude', 'hooks'), { recursive: true });
    fs.copyFileSync(HOOK, path.join(proyecto, '.claude', 'hooks', 'preparar-sesion.mjs'));
    if (contenidoEntorno !== undefined) {
      fs.mkdirSync(path.join(proyecto, 'scripts', 'lib'), { recursive: true });
      fs.writeFileSync(path.join(proyecto, 'scripts', 'lib', 'entorno.mjs'), contenidoEntorno);
    }
    return path.join(proyecto, '.claude', 'hooks', 'preparar-sesion.mjs');
  }

  function correr(hook, remoto) {
    const entorno = { ...process.env, CLAUDE_PROJECT_DIR: proyecto };
    delete entorno.CLAUDE_CODE_REMOTE;
    delete entorno.CLAUDE_ENV_FILE;
    if (remoto !== undefined) entorno.CLAUDE_CODE_REMOTE = remoto;
    const resultado = spawnSync(process.execPath, [hook], { cwd: proyecto, env: entorno, encoding: 'utf8' });
    return { codigo: resultado.status, salida: resultado.stdout, error: resultado.stderr };
  }

  beforeEach(() => {
    proyecto = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-hook-'));
  });
  afterEach(() => {
    fs.rmSync(proyecto, { recursive: true, force: true });
  });

  it.each([
    ['falta el módulo', undefined],
    ['el módulo falla al cargarse', "throw new Error('no debería cargarse fuera de la nube');\n"],
  ])('fuera de la nube nunca lo carga (%s): termina en 0 y sin salida', (_caso, contenido) => {
    const hook = proyectoConHook(contenido);
    const resultado = correr(hook, undefined);
    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toBe('');
    expect(resultado.error).toBe('');
  });

  it.each([
    ['falta el módulo', undefined],
    ['el módulo falla al cargarse', "throw new Error('módulo roto');\n"],
  ])('en la nube, si no se puede cargar (%s) lo informa como paso fallido y termina en 0', (_caso, contenido) => {
    const hook = proyectoConHook(contenido);
    const resultado = correr(hook, 'true');
    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toContain('✗ Utilidades de entorno');
    expect(resultado.salida).toContain(`Preparación incompleta: reintenta con ${COMANDO_REINTENTO}`);
    expect(fs.existsSync(path.join(proyecto, '.env'))).toBe(false);
  });
});

describe.skipIf(esWindows)('hook de sesión en la nube con fallos (criterio 46)', () => {
  const CLAVE = 'SuperClave123';
  let proyecto;
  let binFalso;

  beforeEach(() => {
    proyecto = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-hook-'));
    binFalso = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-bin-'));
  });
  afterEach(() => {
    fs.rmSync(proyecto, { recursive: true, force: true });
    fs.rmSync(binFalso, { recursive: true, force: true });
  });

  function comandoFalso(nombre, cuerpo) {
    const ruta = path.join(binFalso, nombre);
    fs.writeFileSync(ruta, `#!/bin/sh\n${cuerpo}\n`);
    fs.chmodSync(ruta, 0o755);
  }

  function escribirEnvExample(host, puerto = 5432) {
    fs.writeFileSync(
      path.join(proyecto, '.env.example'),
      [
        `DATABASE_URL=postgresql://aqua:${CLAVE}@${host}:${puerto}/aqua`,
        `DATABASE_URL_PRUEBAS=postgresql://aqua:${CLAVE}@${host}:${puerto}/aqua_pruebas`,
        '',
      ].join('\n'),
    );
  }

  it('con un host remoto no gestiona PostgreSQL, lo informa, termina en 0 y no muestra la contraseña', () => {
    escribirEnvExample('db.remota.example');
    fs.writeFileSync(path.join(proyecto, 'package-lock.json'), '{}\n');
    comandoFalso('npm', `echo "error con ${CLAVE}" >&2\nexit 1`);
    comandoFalso('pg_ctlcluster', 'echo no debe ejecutarse >&2\nexit 1');
    const resultado = ejecutarHook({ proyecto, remoto: 'true', path: binFalso });
    expect(resultado.codigo).toBe(0);
    const texto = resultado.salida + resultado.error;
    expect(texto).toContain('no es localhost ni 127.0.0.1');
    expect(texto).toContain('✗ Dependencias');
    expect(texto).toContain('Preparación incompleta');
    expect(texto).toContain(COMANDO_REINTENTO);
    expect(texto).not.toContain(CLAVE);
    expect(texto).not.toContain('no debe ejecutarse');
  });

  it('con un host remoto y todo bien, el resumen final dice que no se gestionó la base', () => {
    escribirEnvExample('db.remota.example');
    fs.writeFileSync(path.join(proyecto, 'package-lock.json'), '{}\n');
    fs.mkdirSync(path.join(proyecto, 'node_modules'));
    comandoFalso('npm', 'exit 0');
    const resultado = ejecutarHook({ proyecto, remoto: 'true', path: binFalso });
    expect(resultado.codigo).toBe(0);
    const lineas = resultado.salida.trim().split('\n');
    expect(lineas.at(-1)).toBe('Sesión preparada sin gestionar la base de datos (host remoto).');
    expect(resultado.salida).not.toContain('Preparación incompleta');
  });

  it('si no existe el comando para ejecutar psql como postgres, el paso falla con un mensaje claro, sin usar su', async () => {
    const servidor = net.createServer();
    await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    const puerto = servidor.address().port;
    try {
      escribirEnvExample('127.0.0.1', puerto);
      fs.writeFileSync(path.join(proyecto, 'package-lock.json'), '{}\n');
      const marcador = path.join(binFalso, 'marcador.txt');
      comandoFalso('su', `echo su >> "${marcador}"\nexit 0`);
      comandoFalso('npm', 'exit 1');
      const resultado = ejecutarHook({ proyecto, remoto: 'true', path: binFalso });
      expect(resultado.codigo).toBe(0);
      expect(resultado.salida).toContain('✗ Rol de la base');
      expect(resultado.salida).toMatch(/no está instalado; no se puede ejecutar psql como el usuario postgres/);
      expect(resultado.salida).toContain(`reintenta con ${COMANDO_REINTENTO}`);
      expect(fs.existsSync(marcador)).toBe(false);
    } finally {
      await new Promise((resolver) => servidor.close(resolver));
    }
  });

  it('crea .env desde .env.example y nunca sobrescribe uno existente', () => {
    escribirEnvExample('db.remota.example');
    comandoFalso('npm', 'exit 1');
    ejecutarHook({ proyecto, remoto: 'true', path: binFalso });
    const creado = fs.readFileSync(path.join(proyecto, '.env'), 'utf8');
    expect(creado.startsWith(fs.readFileSync(path.join(proyecto, '.env.example'), 'utf8'))).toBe(true);

    fs.writeFileSync(path.join(proyecto, '.env'), 'DATABASE_URL=postgresql://otro:otra@db.remota.example/otra\n');
    const resultado = ejecutarHook({ proyecto, remoto: 'true', path: binFalso });
    expect(resultado.salida).toContain('ya existía');
    expect(fs.readFileSync(path.join(proyecto, '.env'), 'utf8')).toBe(
      'DATABASE_URL=postgresql://otro:otra@db.remota.example/otra\n',
    );
  });

  it('si PostgreSQL no enciende informa el paso, el motivo y el reintento, sin la contraseña', async () => {
    const servidor = net.createServer();
    await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    const puertoLibre = servidor.address().port;
    await new Promise((resolver) => servidor.close(resolver));
    escribirEnvExample('127.0.0.1', puertoLibre);
    fs.writeFileSync(path.join(proyecto, 'package-lock.json'), '{}\n');
    comandoFalso('pg_ctlcluster', `echo "Error: no hay datos, ${CLAVE}" >&2\nexit 2`);
    comandoFalso('npm', 'exit 1');
    const resultado = ejecutarHook({ proyecto, remoto: 'true', path: binFalso });
    expect(resultado.codigo).toBe(0);
    const texto = resultado.salida + resultado.error;
    expect(texto).toContain('✗ PostgreSQL');
    expect(texto).toContain('no se pudo encender el cluster 16 main');
    expect(texto).toContain(`reintenta con ${COMANDO_REINTENTO}`);
    expect(texto).not.toContain(CLAVE);
  });

  it('el CLAUDE_ENV_FILE recibe CHROMIUM_EJECUTABLE solo si el navegador de la nube existe', () => {
    escribirEnvExample('db.remota.example');
    comandoFalso('npm', 'exit 1');
    const archivoEntorno = path.join(binFalso, 'entorno.sh');
    const entorno = { ...process.env, CLAUDE_PROJECT_DIR: proyecto, CLAUDE_CODE_REMOTE: 'true', PATH: binFalso };
    entorno.CLAUDE_ENV_FILE = archivoEntorno;
    spawnSync(process.execPath, [HOOK], { cwd: proyecto, env: entorno, encoding: 'utf8' });
    const hayNavegador = fs.existsSync('/opt/pw-browsers/chromium');
    const contenido = fs.existsSync(archivoEntorno) ? fs.readFileSync(archivoEntorno, 'utf8') : '';
    if (hayNavegador) expect(contenido).toBe('export CHROMIUM_EJECUTABLE=/opt/pw-browsers/chromium\n');
    else expect(contenido).toBe('');
  });
});
