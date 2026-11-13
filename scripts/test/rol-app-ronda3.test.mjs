// spec: 001-academias-aislamiento (pruebas protegidas)
// Pruebas unitarias de la ronda 3 del ataque sobre `scripts/lib/rol-app.mjs` (solo modulos `node:*`) y las sentencias del hook de
// sesion:
//  - Criterio 103, precision P-19: `problemasDeConfiguracionApp({ rolconfig, bases })` con `rolconfig: string[] | null` (de
//    `pg_roles`) y `bases: string[]` (nombres de las bases con filas de `pg_db_role_setting` para el rol): `[]` si `rolconfig` es
//    nulo o vacio y `bases` esta vacia; si no, un problema con `ALTER ROLE aquagestion_app RESET ALL;` y uno por base con
//    `ALTER ROLE aquagestion_app IN DATABASE <base> RESET ALL;`.
//  - Criterio 102, precision P-20: `PRIVILEGIOS_APP` y `privilegiosDeMas` (la comparacion con la lista de la API esta en
//    backend/src/infraestructura/prisma/privilegios-app.test.ts).
//  - Criterio 104, precision P-22: `verificadorScram(clave, { sal, iteraciones })` devuelve
//    `SCRAM-SHA-256$<iteraciones>:<sal en base64>$<StoredKey en base64>:<ServerKey en base64>` (por defecto 4096 iteraciones y 16
//    bytes de sal aleatoria) y lanza un error que no contiene la clave si esta tiene caracteres fuera de U+0020 a U+007E. Las
//    sentencias que fijan una contrasena (`sentenciaCrearRolApp` y `sentenciaCrearRol` del hook) la envian como verificador, nunca
//    en claro: el texto no contiene la contrasena, ni escapada ni codificada como en la URL; con caracteres fuera de ASCII
//    imprimible el paso falla nombrando la variable (DATABASE_URL_APP o DATABASE_URL) sin mostrar la contrasena.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cargarEvaluacionRolApp,
  cargarUtilidadesEntorno,
  sentenciaCrearRol,
  sentenciaCrearRolApp,
} from '../../.claude/hooks/preparar-sesion.mjs';

const carpetaScripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUTA_MODULO = path.join(carpetaScripts, 'lib', 'rol-app.mjs');

/** Carga una exportacion de scripts/lib/rol-app.mjs; si falta, la prueba falla con un mensaje claro. */
async function cargar(nombre) {
  const modulo = await import(/* @vite-ignore */ pathToFileURL(RUTA_MODULO).href);
  if (modulo[nombre] === undefined) {
    throw new Error(`Falta la funcionalidad de la 001 (ronda 3): scripts/lib/rol-app.mjs no exporta ${nombre}.`);
  }
  return modulo[nombre];
}

beforeAll(async () => {
  await cargarUtilidadesEntorno();
  await cargarEvaluacionRolApp();
});

const comoTexto = (problema) => (typeof problema === 'string' ? problema : JSON.stringify(problema));

// ---------------------------------------------------------------------------------------------------------------------
// Criterio 103 (P-19)
// ---------------------------------------------------------------------------------------------------------------------

describe('criterio 103 (P-19): problemasDeConfiguracionApp', () => {
  it.each([
    ['rolconfig nulo y sin bases', { rolconfig: null, bases: [] }],
    ['rolconfig vacio y sin bases', { rolconfig: [], bases: [] }],
  ])('criterio 103: %s no devuelve ningun problema', async (_nombre, fila) => {
    const problemasDeConfiguracionApp = await cargar('problemasDeConfiguracionApp');

    expect(problemasDeConfiguracionApp(fila)).toEqual([]);
  });

  it('criterio 103: un rolconfig con valores devuelve un problema con ALTER ROLE aquagestion_app RESET ALL;', async () => {
    const problemasDeConfiguracionApp = await cargar('problemasDeConfiguracionApp');

    const problemas = problemasDeConfiguracionApp({ rolconfig: ['statement_timeout=1min'], bases: [] });

    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas.map(comoTexto).join('\n')).toContain('ALTER ROLE aquagestion_app RESET ALL;');
  });

  it('criterio 103: una base con valores propios devuelve un problema con ALTER ROLE aquagestion_app IN DATABASE <base> RESET ALL;', async () => {
    const problemasDeConfiguracionApp = await cargar('problemasDeConfiguracionApp');

    const problemas = problemasDeConfiguracionApp({ rolconfig: null, bases: ['aquagestion_pruebas'] });

    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas.map(comoTexto).join('\n')).toContain(
      'ALTER ROLE aquagestion_app IN DATABASE aquagestion_pruebas RESET ALL;',
    );
  });

  it('criterio 103: devuelve un problema por cada base', async () => {
    const problemasDeConfiguracionApp = await cargar('problemasDeConfiguracionApp');

    const problemas = problemasDeConfiguracionApp({
      rolconfig: [],
      bases: ['aquagestion', 'aquagestion_pruebas', 'otra_base'],
    });

    const texto = problemas.map(comoTexto).join('\n');
    for (const base of ['aquagestion', 'aquagestion_pruebas', 'otra_base']) {
      expect(texto).toContain(`ALTER ROLE aquagestion_app IN DATABASE ${base} RESET ALL;`);
    }
    expect(problemas.filter((problema) => comoTexto(problema).includes('IN DATABASE'))).toHaveLength(3);
  });

  it('criterio 103: con rolconfig y bases devuelve los dos tipos de problema', async () => {
    const problemasDeConfiguracionApp = await cargar('problemasDeConfiguracionApp');

    const texto = problemasDeConfiguracionApp({ rolconfig: ['row_security=off'], bases: ['aquagestion'] })
      .map(comoTexto)
      .join('\n');

    expect(texto).toContain('ALTER ROLE aquagestion_app RESET ALL;');
    expect(texto).toContain('ALTER ROLE aquagestion_app IN DATABASE aquagestion RESET ALL;');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criterio 102 (P-20), lado de los scripts
// ---------------------------------------------------------------------------------------------------------------------

describe('criterio 102 (P-20): PRIVILEGIOS_APP y privilegiosDeMas en scripts/lib/rol-app.mjs', () => {
  const clave = (p) => `${p.tabla}|${p.columna ?? '*'}|${p.privilegio}`;
  const efectivo = (tabla, columna, privilegio) => ({ tabla, columna, privilegio });

  it('criterio 102: PRIVILEGIOS_APP es exactamente la lista del criterio 2', async () => {
    const PRIVILEGIOS_APP = await cargar('PRIVILEGIOS_APP');

    const esperada = [
      'academias|*|SELECT',
      'academias|*|INSERT',
      'academias|estado|UPDATE',
      'academias|motivo_suspension|UPDATE',
      'academias|suspendida_en|UPDATE',
      'academias|actualizada_en|UPDATE',
      'superadmins|*|SELECT',
      'superadmins|intentos_fallidos|UPDATE',
      'superadmins|bloqueado_hasta|UPDATE',
      'superadmins|ultimo_acceso|UPDATE',
      'superadmins|version_token|UPDATE',
      'superadmins|actualizado_en|UPDATE',
      'auditoria|*|SELECT',
      'auditoria|*|INSERT',
      'auditoria_plataforma|*|SELECT',
      'auditoria_plataforma|*|INSERT',
      'configuraciones|*|SELECT',
      'configuraciones|*|INSERT',
      'configuraciones|*|UPDATE',
    ];
    expect([...PRIVILEGIOS_APP].map(clave).sort()).toEqual([...esperada].sort());
  });

  it('criterio 102: privilegiosDeMas no informa nada con los privilegios del criterio 2 y uno por cada privilegio de mas', async () => {
    const PRIVILEGIOS_APP = await cargar('PRIVILEGIOS_APP');
    const privilegiosDeMas = await cargar('privilegiosDeMas');

    expect(privilegiosDeMas([...PRIVILEGIOS_APP])).toEqual([]);
    const textos = privilegiosDeMas([
      ...PRIVILEGIOS_APP,
      efectivo('auditoria', null, 'TRUNCATE'),
      efectivo('academias', 'nombre_corto', 'UPDATE'),
    ]);
    expect(textos).toHaveLength(2);
    expect(textos[0]).toContain('auditoria');
    expect(textos[0]).toContain('TRUNCATE');
    expect(textos[1]).toContain('nombre_corto');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Criterio 104 (P-22)
// ---------------------------------------------------------------------------------------------------------------------

/** El verificador SCRAM-SHA-256 recalculado con las formulas de RFC 5802 y RFC 7677 (PostgreSQL usa HMAC-SHA-256 y PBKDF2). */
function verificadorEsperado(clave, sal, iteraciones) {
  const salted = pbkdf2Sync(clave, sal, iteraciones, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iteraciones}:${sal.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

const FORMATO = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2}):([A-Za-z0-9+/]+={0,2})$/;

/** Contrasenas con comillas, `$$`, barras invertidas y signos que se escapan en una URL. */
const CLAVES_HOSTILES = [
  'a\'b\\c$$d"e;--',
  "'; DROP ROLE postgres; --",
  'Clave con espacios y %20 y ñ'.replace('ñ', 'n'),
  'p@ss:w/rd?x=1&y=2#frag',
  'barra\\invertida\\\\doble',
  '$$cuerpo$$',
  "comilla''doble",
];

describe('criterio 104 (P-22): verificadorScram', () => {
  it('criterio 104: devuelve SCRAM-SHA-256$4096:<sal>$<StoredKey>:<ServerKey> con la sal y las claves en base64', async () => {
    const verificadorScram = await cargar('verificadorScram');

    const verificador = verificadorScram('una-clave-de-prueba');

    const partes = FORMATO.exec(verificador);
    expect(partes, verificador).not.toBeNull();
    expect(partes[1]).toBe('4096');
    expect(Buffer.from(partes[2], 'base64')).toHaveLength(16);
    expect(Buffer.from(partes[3], 'base64')).toHaveLength(32);
    expect(Buffer.from(partes[4], 'base64')).toHaveLength(32);
  });

  it('criterio 104: con una sal dada, los valores coinciden con los recalculados con las formulas de RFC 5802', async () => {
    const verificadorScram = await cargar('verificadorScram');
    const sal = Buffer.from('0123456789abcdef', 'utf8');

    for (const clave of ['pencil', 'una-clave-de-prueba', ...CLAVES_HOSTILES]) {
      expect(verificadorScram(clave, { sal }), clave).toBe(verificadorEsperado(clave, sal, 4096));
    }
  });

  it('criterio 104: con las iteraciones indicadas, las usa en el texto y en el calculo', async () => {
    const verificadorScram = await cargar('verificadorScram');
    const sal = randomBytes(16);

    expect(verificadorScram('otra-clave-1234', { sal, iteraciones: 5000 })).toBe(
      verificadorEsperado('otra-clave-1234', sal, 5000),
    );
    expect(verificadorScram('otra-clave-1234', { sal, iteraciones: 5000 })).toMatch(/^SCRAM-SHA-256\$5000:/);
  });

  it('criterio 104: acepta una sal de otra longitud (se usa tal cual)', async () => {
    const verificadorScram = await cargar('verificadorScram');
    const sal = randomBytes(24);

    expect(verificadorScram('clave-de-prueba', { sal })).toBe(verificadorEsperado('clave-de-prueba', sal, 4096));
  });

  it('criterio 104: sin sal indicada usa una sal aleatoria distinta en cada llamada', async () => {
    const verificadorScram = await cargar('verificadorScram');

    const uno = verificadorScram('misma-clave-1234');
    const otro = verificadorScram('misma-clave-1234');

    expect(uno).not.toBe(otro);
    expect(FORMATO.exec(uno)?.[2]).not.toBe(FORMATO.exec(otro)?.[2]);
  });

  it('criterio 104: el verificador no contiene la clave ni sus formas escapadas', async () => {
    const verificadorScram = await cargar('verificadorScram');

    for (const clave of CLAVES_HOSTILES) {
      const verificador = verificadorScram(clave);
      expect(verificador).not.toContain(clave);
      expect(verificador).not.toContain(encodeURIComponent(clave));
    }
  });

  it('criterio 104: acepta todo el ASCII imprimible, de U+0020 a U+007E', async () => {
    const verificadorScram = await cargar('verificadorScram');
    let todo = '';
    for (let codigo = 0x20; codigo <= 0x7e; codigo++) todo += String.fromCharCode(codigo);

    expect(() => verificadorScram(todo)).not.toThrow();
    expect(FORMATO.test(verificadorScram(todo))).toBe(true);
    expect(() => verificadorScram(' ')).not.toThrow();
  });

  it.each([
    ['una letra con tilde', 'contraseña-1234'],
    ['una letra con acento', 'clavé-1234'],
    ['el simbolo del euro', 'clave€1234'],
    ['un emoji', 'clave😀1234'],
    ['un espacio duro (U+00A0)', 'clave 1234'],
    ['un tabulador', 'clave\t1234'],
    ['un salto de linea', 'clave\n1234'],
    ['un retorno de carro', 'clave\r1234'],
    ['el caracter nulo', 'clave\u00001234'],
    ['el caracter DEL (U+007F)', 'clave\u007f1234'],
    ['un caracter de control (U+001F)', 'clave\u001f1234'],
    ['letras cirilicas', 'пароль-1234'],
  ])('criterio 104: una clave con %s lanza un error que no contiene la clave', async (_nombre, clave) => {
    const verificadorScram = await cargar('verificadorScram');

    let error;
    try {
      verificadorScram(clave);
    } catch (causa) {
      error = causa;
    }

    expect(error, 'debia lanzar').toBeInstanceOf(Error);
    expect(error.message).not.toContain(clave);
    expect(error.message).not.toContain(encodeURIComponent(clave));
    expect(String(error.stack ?? '')).not.toContain(clave);
  });
});

describe('criterio 104: las sentencias del hook envian el verificador y nunca la contrasena', () => {
  it.each([
    ['sentenciaCrearRolApp (rol de la API)', () => sentenciaCrearRolApp],
    ['sentenciaCrearRol (rol del dueno)', () => sentenciaCrearRol],
  ])(
    'criterio 104: %s lleva PASSWORD con un verificador SCRAM-SHA-256$4096: y no la contrasena',
    async (_nombre, obtener) => {
      const sentencia = obtener();

      for (const clave of ['clave-sencilla-1234', ...CLAVES_HOSTILES]) {
        const sql = sentencia('aquagestion_x', clave);

        expect(sql, clave).toMatch(/PASSWORD 'SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+'/);
        expect(sql).not.toContain(clave);
        expect(sql).not.toContain(clave.replaceAll("'", "''"));
        expect(sql).not.toContain(encodeURIComponent(clave));
      }
    },
  );

  it('criterio 104: el rol de la API conserva todos los atributos negativos del criterio 1', async () => {
    const sql = sentenciaCrearRolApp('aquagestion_app', 'clave-de-prueba-1234');

    expect(sql).toMatch(
      /CREATE ROLE "aquagestion_app" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT\b/,
    );
    expect(sql).not.toMatch(/(?<!NO)(SUPERUSER|BYPASSRLS|CREATEDB|CREATEROLE|REPLICATION)/);
  });

  it('criterio 104: el rol del dueno conserva LOGIN y CREATEDB y sigue sin ser superusuario', async () => {
    const sql = sentenciaCrearRol('aquagestion', 'clave-de-prueba-1234');

    expect(sql).toMatch(/CREATE ROLE "aquagestion" LOGIN CREATEDB NOSUPERUSER\b/);
  });

  it('criterio 104: el verificador de la sentencia se puede recalcular con la misma sal (la sal va en el propio texto)', async () => {
    const clave = 'clave-que-se-recalcula-1';
    const sql = sentenciaCrearRolApp('aquagestion_app', clave);

    const [, iteraciones, sal] = /SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$/.exec(sql) ?? [];

    expect(iteraciones).toBe('4096');
    expect(sql).toContain(verificadorEsperado(clave, Buffer.from(sal, 'base64'), 4096));
  });

  it('criterio 104: una contrasena fuera de ASCII imprimible hace fallar el paso del rol de la API nombrando DATABASE_URL_APP sin mostrar la clave', async () => {
    const clave = 'contraseña-secreta-1234';

    let error;
    try {
      sentenciaCrearRolApp('aquagestion_app', clave);
    } catch (causa) {
      error = causa;
    }

    expect(error, 'debia fallar').toBeInstanceOf(Error);
    expect(error.message).toContain('DATABASE_URL_APP');
    expect(error.message).not.toContain(clave);
    expect(error.message).not.toContain(encodeURIComponent(clave));
  });

  it('criterio 104: una contrasena fuera de ASCII imprimible hace fallar el paso del rol del dueno nombrando DATABASE_URL sin mostrar la clave', async () => {
    const clave = 'contraseña-secreta-1234';

    let error;
    try {
      sentenciaCrearRol('aquagestion', clave);
    } catch (causa) {
      error = causa;
    }

    expect(error, 'debia fallar').toBeInstanceOf(Error);
    expect(error.message).toMatch(/DATABASE_URL\b/);
    expect(error.message).not.toMatch(/DATABASE_URL_APP/);
    expect(error.message).not.toContain(clave);
    expect(error.message).not.toContain(encodeURIComponent(clave));
  });
});
