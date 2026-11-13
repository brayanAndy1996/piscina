// spec: 001-academias-aislamiento (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 102 (ataque ronda 3, O3; complementa los criterios 2, 80 y 81), precision P-20: `privilegios-app.ts` (aqui) y
// `scripts/lib/rol-app.mjs` exportan, con los mismos nombres y el mismo contenido, `PRIVILEGIOS_APP` (la lista permitida del
// criterio 2; `columna: null` es toda la tabla y el privilegio va en mayusculas) y `privilegiosDeMas(efectivos)`, que devuelve un
// texto por cada privilegio efectivo que no esta permitido (con la tabla, el privilegio y, si es de columna, la columna) y `[]`
// si todo esta permitido. Un efectivo `(t, null, p)` se permite si `(t, null, p)` esta en la lista; uno `(t, c, p)`, si esta
// `(t, null, p)` o `(t, c, p)`. Un privilegio que falta no lo rechaza esta funcion.

interface PrivilegioApp {
  readonly tabla: string;
  readonly columna: string | null;
  readonly privilegio: string;
}
interface Modulo {
  PRIVILEGIOS_APP: readonly PrivilegioApp[];
  readonly privilegiosDeMas: (efectivos: readonly PrivilegioApp[]) => string[];
}

const clave = (p: PrivilegioApp): string => `${p.tabla}|${p.columna ?? '*'}|${p.privilegio}`;
const efectivo = (tabla: string, columna: string | null, privilegio: string): PrivilegioApp => ({
  tabla,
  columna,
  privilegio,
});

/** La lista del criterio 2, escrita aqui de forma independiente. */
const LISTA_DEL_CRITERIO_2: PrivilegioApp[] = [
  efectivo('academias', null, 'SELECT'),
  efectivo('academias', null, 'INSERT'),
  ...['estado', 'motivo_suspension', 'suspendida_en', 'actualizada_en'].map((c) => efectivo('academias', c, 'UPDATE')),
  efectivo('superadmins', null, 'SELECT'),
  ...['intentos_fallidos', 'bloqueado_hasta', 'ultimo_acceso', 'version_token', 'actualizado_en'].map((c) =>
    efectivo('superadmins', c, 'UPDATE'),
  ),
  efectivo('auditoria', null, 'SELECT'),
  efectivo('auditoria', null, 'INSERT'),
  efectivo('auditoria_plataforma', null, 'SELECT'),
  efectivo('auditoria_plataforma', null, 'INSERT'),
  efectivo('configuraciones', null, 'SELECT'),
  efectivo('configuraciones', null, 'INSERT'),
  efectivo('configuraciones', null, 'UPDATE'),
  // Historia 002, criterio 2: la lista exacta suma los privilegios de `usuarios` (no se quita nada de lo anterior).
  efectivo('usuarios', null, 'SELECT'),
  efectivo('usuarios', null, 'INSERT'),
  ...[
    'clave_hash',
    'debe_cambiar_clave',
    'estado',
    'version_token',
    'intentos_fallidos',
    'bloqueado_hasta',
    'ultimo_acceso',
    'actualizado_en',
  ].map((c) => efectivo('usuarios', c, 'UPDATE')),
];

async function cargarDeLaApi(): Promise<Modulo> {
  return cargarFuncionalidad<Modulo>('infraestructura/prisma/privilegios-app.ts', [
    'PRIVILEGIOS_APP',
    'privilegiosDeMas',
  ]);
}

async function cargarDeLosScripts(): Promise<Modulo> {
  const ruta = path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'rol-app.mjs');
  const modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Partial<Modulo>;
  if (modulo.PRIVILEGIOS_APP === undefined || typeof modulo.privilegiosDeMas !== 'function') {
    throw new Error(
      'Falta la funcionalidad de la 001 (criterio 102): scripts/lib/rol-app.mjs no exporta PRIVILEGIOS_APP y privilegiosDeMas.',
    );
  }
  return modulo as Modulo;
}

describe('criterio 102 (P-20): PRIVILEGIOS_APP', () => {
  it('criterio 102: la lista de la API es exactamente la del criterio 2', async () => {
    const { PRIVILEGIOS_APP } = await cargarDeLaApi();

    expect(PRIVILEGIOS_APP.map(clave).sort()).toEqual(LISTA_DEL_CRITERIO_2.map(clave).sort());
  });

  it('criterio 102: cada elemento tiene tabla, columna (texto o null) y privilegio en mayusculas', async () => {
    const { PRIVILEGIOS_APP } = await cargarDeLaApi();

    for (const elemento of PRIVILEGIOS_APP) {
      expect(typeof elemento.tabla).toBe('string');
      expect(elemento.columna === null || typeof elemento.columna === 'string').toBe(true);
      expect(elemento.privilegio).toBe(elemento.privilegio.toUpperCase());
    }
  });

  it('criterio 102: ninguna entrada concede DELETE, TRUNCATE, REFERENCES ni TRIGGER', async () => {
    const { PRIVILEGIOS_APP } = await cargarDeLaApi();

    expect(
      PRIVILEGIOS_APP.filter((p) => ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'].includes(p.privilegio)),
    ).toEqual([]);
  });

  it('criterio 102: la lista de la API y la de scripts/lib/rol-app.mjs son iguales', async () => {
    const api = await cargarDeLaApi();
    const scripts = await cargarDeLosScripts();

    expect(scripts.PRIVILEGIOS_APP.map(clave).sort()).toEqual(api.PRIVILEGIOS_APP.map(clave).sort());
    expect(scripts.PRIVILEGIOS_APP.length).toBe(api.PRIVILEGIOS_APP.length);
  });

  it('criterio 102: privilegiosDeMas de la API y la de los scripts dan el mismo resultado para las mismas entradas', async () => {
    const api = await cargarDeLaApi();
    const scripts = await cargarDeLosScripts();
    const casos: PrivilegioApp[][] = [
      [],
      [...LISTA_DEL_CRITERIO_2],
      [efectivo('auditoria', null, 'TRUNCATE')],
      [efectivo('academias', 'nombre_corto', 'UPDATE'), efectivo('superadmins', null, 'REFERENCES')],
    ];

    for (const caso of casos) {
      expect(scripts.privilegiosDeMas(caso).length).toBe(api.privilegiosDeMas(caso).length);
    }
  });
});

describe.each([
  ['la API', cargarDeLaApi],
  ['scripts/lib/rol-app.mjs', cargarDeLosScripts],
])('criterio 102 (P-20): privilegiosDeMas en %s', (_nombre, cargar) => {
  it('criterio 102: sin privilegios efectivos devuelve una lista vacia', async () => {
    const { privilegiosDeMas } = await cargar();

    expect(privilegiosDeMas([])).toEqual([]);
  });

  it('criterio 102: los privilegios exactos del criterio 2 no tienen nada de mas', async () => {
    const { privilegiosDeMas } = await cargar();

    expect(privilegiosDeMas(LISTA_DEL_CRITERIO_2)).toEqual([]);
  });

  it('criterio 102: los privilegios de columna que la tabla entera ya permite no cuentan (SELECT de cada columna de academias)', async () => {
    const { privilegiosDeMas } = await cargar();

    const columnas = [
      'id',
      'nombre',
      'nombre_corto',
      'estado',
      'motivo_suspension',
      'suspendida_en',
      'creada_en',
      'actualizada_en',
    ];

    expect(privilegiosDeMas(columnas.map((c) => efectivo('academias', c, 'SELECT')))).toEqual([]);
    expect(privilegiosDeMas(columnas.map((c) => efectivo('academias', c, 'INSERT')))).toEqual([]);
  });

  it('criterio 102: UPDATE de columna sobre una tabla con UPDATE de tabla entera no cuenta (configuraciones)', async () => {
    const { privilegiosDeMas } = await cargar();

    expect(privilegiosDeMas([efectivo('configuraciones', 'valor', 'UPDATE')])).toEqual([]);
  });

  it('criterio 102: UPDATE de las columnas permitidas de academias y superadmins no cuenta', async () => {
    const { privilegiosDeMas } = await cargar();

    expect(
      privilegiosDeMas([
        efectivo('academias', 'estado', 'UPDATE'),
        efectivo('academias', 'actualizada_en', 'UPDATE'),
        efectivo('superadmins', 'ultimo_acceso', 'UPDATE'),
        efectivo('superadmins', 'version_token', 'UPDATE'),
      ]),
    ).toEqual([]);
  });

  it.each([
    ['TRUNCATE de auditoria', efectivo('auditoria', null, 'TRUNCATE'), ['auditoria', 'TRUNCATE']],
    ['DELETE de configuraciones', efectivo('configuraciones', null, 'DELETE'), ['configuraciones', 'DELETE']],
    [
      'UPDATE de auditoria_plataforma',
      efectivo('auditoria_plataforma', null, 'UPDATE'),
      ['auditoria_plataforma', 'UPDATE'],
    ],
    ['UPDATE de toda la tabla academias', efectivo('academias', null, 'UPDATE'), ['academias', 'UPDATE']],
    ['REFERENCES de superadmins', efectivo('superadmins', null, 'REFERENCES'), ['superadmins', 'REFERENCES']],
    ['TRIGGER de auditoria', efectivo('auditoria', null, 'TRIGGER'), ['auditoria', 'TRIGGER']],
    ['SELECT de _prisma_migrations', efectivo('_prisma_migrations', null, 'SELECT'), ['_prisma_migrations', 'SELECT']],
    ['UPDATE de auditoria', efectivo('auditoria', null, 'UPDATE'), ['auditoria', 'UPDATE']],
    ['SELECT de una tabla que no esta en la lista', efectivo('tabla_nueva', null, 'SELECT'), ['tabla_nueva', 'SELECT']],
    ['USAGE de una secuencia', efectivo('secuencia_nueva', null, 'USAGE'), ['secuencia_nueva', 'USAGE']],
  ])('criterio 102: %s se informa con la tabla y el privilegio', async (_nombre, privilegio, palabras) => {
    const { privilegiosDeMas } = await cargar();

    const textos = privilegiosDeMas([privilegio]);

    expect(textos).toHaveLength(1);
    for (const palabra of palabras) expect(textos[0]).toContain(palabra);
  });

  it.each([
    [
      'UPDATE (nombre_corto) de academias',
      efectivo('academias', 'nombre_corto', 'UPDATE'),
      ['academias', 'nombre_corto', 'UPDATE'],
    ],
    [
      'UPDATE (clave_hash) de superadmins',
      efectivo('superadmins', 'clave_hash', 'UPDATE'),
      ['superadmins', 'clave_hash', 'UPDATE'],
    ],
    ['UPDATE (id) de academias', efectivo('academias', 'id', 'UPDATE'), ['academias', 'id', 'UPDATE']],
    ['REFERENCES (id) de academias', efectivo('academias', 'id', 'REFERENCES'), ['academias', 'REFERENCES']],
    [
      'UPDATE (correo) de superadmins',
      efectivo('superadmins', 'correo', 'UPDATE'),
      ['superadmins', 'correo', 'UPDATE'],
    ],
    ['INSERT (id) de superadmins', efectivo('superadmins', 'id', 'INSERT'), ['superadmins', 'INSERT']],
  ])('criterio 102: %s se informa con la tabla, la columna y el privilegio', async (_nombre, privilegio, palabras) => {
    const { privilegiosDeMas } = await cargar();

    const textos = privilegiosDeMas([privilegio]);

    expect(textos).toHaveLength(1);
    for (const palabra of palabras) expect(textos[0]).toContain(palabra);
  });

  it('criterio 102: devuelve un texto por cada privilegio de mas, no solo el primero', async () => {
    const { privilegiosDeMas } = await cargar();

    const textos = privilegiosDeMas([
      ...LISTA_DEL_CRITERIO_2,
      efectivo('auditoria', null, 'TRUNCATE'),
      efectivo('configuraciones', null, 'DELETE'),
      efectivo('academias', 'nombre_corto', 'UPDATE'),
    ]);

    expect(textos).toHaveLength(3);
    expect(new Set(textos).size).toBe(3);
  });

  it('criterio 102: un privilegio que falta no se informa (solo importan los de mas)', async () => {
    const { privilegiosDeMas } = await cargar();

    expect(
      privilegiosDeMas(
        LISTA_DEL_CRITERIO_2.filter((p) => !(p.tabla === 'configuraciones' && p.privilegio === 'UPDATE')),
      ),
    ).toEqual([]);
    expect(privilegiosDeMas([efectivo('auditoria', null, 'SELECT')])).toEqual([]);
  });

  it('criterio 102: el nombre de la tabla no se confunde con otro parecido (auditoria vs auditoria_plataforma)', async () => {
    const { privilegiosDeMas } = await cargar();

    expect(privilegiosDeMas([efectivo('auditoria_plataforma', null, 'INSERT')])).toEqual([]);
    expect(privilegiosDeMas([efectivo('auditoria_plataforma_x', null, 'INSERT')])).toHaveLength(1);
  });
});
