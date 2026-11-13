// spec: 001-academias-aislamiento (pruebas protegidas)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 130 (ataque ronda 6, F1 (a) y (c); amplia los criterios 102 y 123), precision P-31: `privilegios-app.ts` (aqui) y
// `scripts/lib/rol-app.mjs` exportan, con los mismos nombres y el mismo contenido, `FUNCIONES_APP`, `ESQUEMAS_PERMITIDOS` y
// `privilegiosDeMasEnEsquemas(efectivos)`. Reglas: `tabla`, `columna` y `secuencia` de `public` se permiten como en `privilegiosDeMas`
// (P-20) y de cualquier otro esquema nunca; `funcion` se permite solo con `EXECUTE` y `(esquema, objeto, argumentos)` en
// `FUNCIONES_APP`; `esquema` se permite con `USAGE` sobre `public`, o sobre otro esquema si `conObjetosPropios` es exactamente `false`
// o el esquema esta en `ESQUEMAS_PERMITIDOS` (hoy vacia); cualquier otro privilegio de esquema (tambien `CREATE`), un `tipo` desconocido
// o un campo que falta se informan (falla cerrada). Cada texto devuelto contiene el esquema, el objeto si lo hay, la columna si la hay
// y el privilegio. Prueba unitaria: cada regla sola, las tres funciones permitidas, `USAGE` sobre un esquema vacio y sobre uno con
// objetos propios, y un valor desconocido; y de que `FUNCIONES_APP` y `ESQUEMAS_PERMITIDOS` de la API y de `scripts/lib/rol-app.mjs`
// son iguales. La misma bateria se prueba sobre `scripts/lib/rol-app.mjs` en `scripts/test/rol-app-ronda6.test.mjs`.

interface FuncionApp {
  readonly esquema: 'public';
  readonly nombre: string;
  readonly argumentos: string;
}
type Efectivo = Record<string, unknown>;
interface Modulo {
  readonly FUNCIONES_APP: readonly FuncionApp[];
  readonly ESQUEMAS_PERMITIDOS: readonly string[];
  readonly privilegiosDeMasEnEsquemas: (efectivos: readonly Efectivo[]) => string[];
}

const EXPORTACIONES = ['FUNCIONES_APP', 'ESQUEMAS_PERMITIDOS', 'privilegiosDeMasEnEsquemas'] as const;

function cargarDeLaApi(): Promise<Modulo> {
  return cargarFuncionalidad<Modulo>('infraestructura/prisma/privilegios-app.ts', EXPORTACIONES);
}

async function cargarDeLosScripts(): Promise<Modulo> {
  const ruta = path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'rol-app.mjs');
  const modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Partial<Modulo>;
  for (const nombre of EXPORTACIONES) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 001 (criterio 130): scripts/lib/rol-app.mjs no exporta ${nombre}.`);
    }
  }
  return modulo as Modulo;
}

const tabla = (esquema: string, objeto: string, privilegio: string): Efectivo => ({
  esquema,
  tipo: 'tabla',
  objeto,
  columna: null,
  argumentos: null,
  privilegio,
});
const columna = (esquema: string, objeto: string, col: string, privilegio: string): Efectivo => ({
  esquema,
  tipo: 'columna',
  objeto,
  columna: col,
  argumentos: null,
  privilegio,
});
const secuencia = (esquema: string, objeto: string, privilegio: string): Efectivo => ({
  esquema,
  tipo: 'secuencia',
  objeto,
  columna: null,
  argumentos: null,
  privilegio,
});
const funcion = (esquema: string, objeto: string, argumentos: string, privilegio = 'EXECUTE'): Efectivo => ({
  esquema,
  tipo: 'funcion',
  objeto,
  columna: null,
  argumentos,
  privilegio,
});
const esquemaConUso = (esquema: string, conObjetosPropios?: unknown, privilegio = 'USAGE'): Efectivo => ({
  esquema,
  tipo: 'esquema',
  objeto: null,
  columna: null,
  argumentos: null,
  privilegio,
  ...(conObjetosPropios === undefined ? {} : { conObjetosPropios }),
});

/** La lista del criterio 2, escrita aqui de forma independiente, como privilegios efectivos de `public`. */
const LISTA_DEL_CRITERIO_2: Efectivo[] = [
  tabla('public', 'academias', 'SELECT'),
  tabla('public', 'academias', 'INSERT'),
  ...['estado', 'motivo_suspension', 'suspendida_en', 'actualizada_en'].map((c) =>
    columna('public', 'academias', c, 'UPDATE'),
  ),
  tabla('public', 'superadmins', 'SELECT'),
  ...['intentos_fallidos', 'bloqueado_hasta', 'ultimo_acceso', 'version_token', 'actualizado_en'].map((c) =>
    columna('public', 'superadmins', c, 'UPDATE'),
  ),
  tabla('public', 'auditoria', 'SELECT'),
  tabla('public', 'auditoria', 'INSERT'),
  tabla('public', 'auditoria_plataforma', 'SELECT'),
  tabla('public', 'auditoria_plataforma', 'INSERT'),
  tabla('public', 'configuraciones', 'SELECT'),
  tabla('public', 'configuraciones', 'INSERT'),
  tabla('public', 'configuraciones', 'UPDATE'),
];

const PERMITIDAS: Efectivo[] = [
  funcion('public', 'app_academia_actual', ''),
  funcion('public', 'app_es_plataforma', ''),
  funcion('public', 'resolver_academia', 'p_nombre_corto text'),
];

/** Casos que se rechazan: [descripcion, efectivo, palabras que el texto debe contener]. */
const RECHAZADOS: readonly (readonly [string, Efectivo, readonly string[]])[] = [
  ['TRUNCATE sobre una tabla de public', tabla('public', 'auditoria', 'TRUNCATE'), ['public', 'auditoria', 'TRUNCATE']],
  [
    'SELECT sobre una vista de otro esquema (el ataque: reportes.auditoria_todas)',
    tabla('reportes', 'auditoria_todas', 'SELECT'),
    ['reportes', 'auditoria_todas', 'SELECT'],
  ],
  [
    'SELECT sobre una tabla de otro esquema con el nombre de una permitida en public (reportes.academias)',
    tabla('reportes', 'academias', 'SELECT'),
    ['reportes', 'academias', 'SELECT'],
  ],
  [
    'SELECT de una columna de una tabla de otro esquema (reportes.t.id)',
    columna('reportes', 't', 'id', 'SELECT'),
    ['reportes', 't', 'id', 'SELECT'],
  ],
  [
    'UPDATE de una columna de public que no esta permitida (academias.nombre_corto)',
    columna('public', 'academias', 'nombre_corto', 'UPDATE'),
    ['academias', 'nombre_corto', 'UPDATE'],
  ],
  [
    'UPDATE de una columna de otro esquema con el nombre de una permitida (reportes.academias.estado)',
    columna('reportes', 'academias', 'estado', 'UPDATE'),
    ['reportes', 'academias', 'estado', 'UPDATE'],
  ],
  ['USAGE sobre una secuencia de otro esquema', secuencia('reportes', 's', 'USAGE'), ['reportes', 's', 'USAGE']],
  [
    'USAGE sobre una secuencia de public',
    secuencia('public', 'secuencia_x', 'USAGE'),
    ['public', 'secuencia_x', 'USAGE'],
  ],
  [
    'EXECUTE sobre una funcion nueva de public (public.funcion_extra())',
    funcion('public', 'funcion_extra', ''),
    ['public', 'funcion_extra', 'EXECUTE'],
  ],
  [
    'EXECUTE sobre una funcion de otro esquema (reportes.f())',
    funcion('reportes', 'f', ''),
    ['reportes', 'f', 'EXECUTE'],
  ],
  [
    'EXECUTE sobre una funcion con el nombre de una permitida pero en otro esquema',
    funcion('reportes', 'app_academia_actual', ''),
    ['reportes', 'app_academia_actual', 'EXECUTE'],
  ],
  [
    'EXECUTE sobre resolver_academia con otros argumentos (otra sobrecarga)',
    funcion('public', 'resolver_academia', 'text, integer'),
    ['resolver_academia', 'EXECUTE'],
  ],
  [
    'EXECUTE sobre resolver_academia con los argumentos escritos de otra manera',
    funcion('public', 'resolver_academia', 'p_otro text'),
    ['resolver_academia', 'EXECUTE'],
  ],
  [
    'EXECUTE sobre app_academia_actual con un argumento',
    funcion('public', 'app_academia_actual', 'integer'),
    ['app_academia_actual', 'EXECUTE'],
  ],
  [
    'otro privilegio (ALTER) sobre una funcion permitida',
    funcion('public', 'app_academia_actual', '', 'ALTER'),
    ['app_academia_actual', 'ALTER'],
  ],
  ['USAGE sobre un esquema con objetos propios', esquemaConUso('reportes', true), ['reportes', 'USAGE']],
  [
    'USAGE sobre un esquema sin saber si tiene objetos propios (conObjetosPropios ausente: falla cerrada)',
    esquemaConUso('reportes'),
    ['reportes', 'USAGE'],
  ],
  [
    'USAGE sobre un esquema con conObjetosPropios nulo (falla cerrada)',
    esquemaConUso('reportes', null),
    ['reportes', 'USAGE'],
  ],
  [
    'USAGE sobre un esquema con conObjetosPropios que no es exactamente false (falla cerrada)',
    esquemaConUso('reportes', 'false'),
    ['reportes', 'USAGE'],
  ],
  ['CREATE sobre public', esquemaConUso('public', false, 'CREATE'), ['public', 'CREATE']],
  ['CREATE sobre otro esquema vacio', esquemaConUso('reportes', false, 'CREATE'), ['reportes', 'CREATE']],
  [
    'un tipo desconocido (indice)',
    {
      esquema: 'public',
      tipo: 'indice',
      objeto: 'academias_pkey',
      columna: null,
      argumentos: null,
      privilegio: 'SELECT',
    },
    ['academias_pkey'],
  ],
  [
    'sin privilegio (campo que falta)',
    { esquema: 'reportes', tipo: 'tabla', objeto: 'tabla_x', columna: null, argumentos: null },
    [],
  ],
  [
    'sin tipo (campo que falta)',
    { esquema: 'public', objeto: 'auditoria', columna: null, argumentos: null, privilegio: 'SELECT' },
    [],
  ],
  [
    'sin esquema (campo que falta)',
    { tipo: 'tabla', objeto: 'auditoria', columna: null, argumentos: null, privilegio: 'SELECT' },
    [],
  ],
  [
    'una funcion sin argumentos conocidos (falla cerrada)',
    { esquema: 'public', tipo: 'funcion', objeto: 'app_academia_actual', columna: null, privilegio: 'EXECUTE' },
    ['app_academia_actual'],
  ],
];

describe.each([
  ['privilegios-app.ts (API)', cargarDeLaApi],
  ['scripts/lib/rol-app.mjs (db:crear)', cargarDeLosScripts],
] as const)('criterio 130 (P-31): privilegiosDeMasEnEsquemas en %s', (_nombre, cargar) => {
  it('criterio 130: sin privilegios efectivos devuelve []', async () => {
    const { privilegiosDeMasEnEsquemas } = await cargar();

    expect(privilegiosDeMasEnEsquemas([])).toEqual([]);
  });

  it('criterio 130: los privilegios de tabla y de columna del criterio 2 sobre public se permiten', async () => {
    const { privilegiosDeMasEnEsquemas } = await cargar();

    expect(privilegiosDeMasEnEsquemas(LISTA_DEL_CRITERIO_2)).toEqual([]);
  });

  it.each(PERMITIDAS.map((f) => [`${String(f['objeto'])}(${String(f['argumentos'])})`, f] as const))(
    'criterio 130: EXECUTE sobre la funcion permitida %s no se informa',
    async (_funcion, efectivo) => {
      const { privilegiosDeMasEnEsquemas } = await cargar();

      expect(privilegiosDeMasEnEsquemas([efectivo])).toEqual([]);
    },
  );

  it('criterio 130: USAGE sobre public se permite, tenga o no objetos propios', async () => {
    const { privilegiosDeMasEnEsquemas } = await cargar();

    expect(privilegiosDeMasEnEsquemas([esquemaConUso('public', true)])).toEqual([]);
    expect(privilegiosDeMasEnEsquemas([esquemaConUso('public', false)])).toEqual([]);
    expect(privilegiosDeMasEnEsquemas([esquemaConUso('public')])).toEqual([]);
  });

  it('criterio 130: USAGE sobre un esquema vacio (conObjetosPropios = false) se permite (criterio 123)', async () => {
    const { privilegiosDeMasEnEsquemas } = await cargar();

    expect(privilegiosDeMasEnEsquemas([esquemaConUso('trampa', false)])).toEqual([]);
  });

  it.each(RECHAZADOS)('criterio 130: se informa %s', async (_nombre, efectivo, palabras) => {
    const { privilegiosDeMasEnEsquemas } = await cargar();

    const problemas = privilegiosDeMasEnEsquemas([efectivo]);

    expect(problemas).toHaveLength(1);
    for (const palabra of palabras) expect(problemas[0], `el texto no nombra ${palabra}`).toContain(palabra);
  });

  it('criterio 130: cada regla sola da un problema aunque el resto de la lista este permitido; uno por privilegio de mas', async () => {
    const { privilegiosDeMasEnEsquemas } = await cargar();
    const mezcla = [
      ...LISTA_DEL_CRITERIO_2,
      tabla('reportes', 'auditoria_todas', 'SELECT'),
      ...PERMITIDAS,
      funcion('public', 'funcion_extra', ''),
      esquemaConUso('public', true),
      esquemaConUso('reportes', true),
      secuencia('reportes', 's', 'USAGE'),
    ];

    const problemas = privilegiosDeMasEnEsquemas(mezcla);

    expect(problemas).toHaveLength(4);
    expect(new Set(problemas).size, 'los textos no deben repetirse').toBe(4);
  });

  it('criterio 130: no modifica la lista que recibe', async () => {
    const { privilegiosDeMasEnEsquemas } = await cargar();
    const efectivos = [tabla('reportes', 'auditoria_todas', 'SELECT'), esquemaConUso('reportes', true)];
    const copia = JSON.stringify(efectivos);

    privilegiosDeMasEnEsquemas(efectivos);

    expect(JSON.stringify(efectivos)).toBe(copia);
  });
});

describe('criterio 130 (P-31): FUNCIONES_APP y ESQUEMAS_PERMITIDOS', () => {
  const ordenadas = (lista: readonly FuncionApp[]): FuncionApp[] =>
    [...lista]
      .map((f) => ({ esquema: f.esquema, nombre: f.nombre, argumentos: f.argumentos }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

  it('criterio 130: FUNCIONES_APP de la API son las tres funciones de public, identificadas por nombre y argumentos', async () => {
    const { FUNCIONES_APP } = await cargarDeLaApi();

    expect(ordenadas(FUNCIONES_APP)).toEqual([
      { esquema: 'public', nombre: 'app_academia_actual', argumentos: '' },
      { esquema: 'public', nombre: 'app_es_plataforma', argumentos: '' },
      { esquema: 'public', nombre: 'resolver_academia', argumentos: 'p_nombre_corto text' },
    ]);
  });

  it('criterio 130: ESQUEMAS_PERMITIDOS esta vacia (hoy ningun esquema ademas de public)', async () => {
    const { ESQUEMAS_PERMITIDOS } = await cargarDeLaApi();

    expect([...ESQUEMAS_PERMITIDOS]).toEqual([]);
  });

  it('criterio 130: FUNCIONES_APP y ESQUEMAS_PERMITIDOS de la API y de scripts/lib/rol-app.mjs son iguales', async () => {
    const api = await cargarDeLaApi();
    const scripts = await cargarDeLosScripts();

    expect(ordenadas(scripts.FUNCIONES_APP)).toEqual(ordenadas(api.FUNCIONES_APP));
    expect([...scripts.ESQUEMAS_PERMITIDOS].sort()).toEqual([...api.ESQUEMAS_PERMITIDOS].sort());
  });
});
