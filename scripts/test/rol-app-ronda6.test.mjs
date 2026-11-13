// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 130 (ataque ronda 6, F1 (a) y (c); amplia los criterios 102 y 123), precision P-31, parte de `scripts/lib/rol-app.mjs`
// (solo modulos `node:*`): exporta `FUNCIONES_APP`, `ESQUEMAS_PERMITIDOS` y `privilegiosDeMasEnEsquemas(efectivos)` con el mismo
// contenido que `backend/src/infraestructura/prisma/privilegios-app.ts` (la igualdad de las listas la prueba
// `privilegios-esquemas.test.ts` del backend). Reglas: `tabla`, `columna` y `secuencia` de `public` se permiten como en
// `privilegiosDeMas` (P-20) y de cualquier otro esquema nunca; `funcion` solo con `EXECUTE` y `(esquema, objeto, argumentos)` en
// `FUNCIONES_APP`; `esquema` con `USAGE` sobre `public`, o sobre otro esquema si `conObjetosPropios` es exactamente `false` o el
// esquema esta en `ESQUEMAS_PERMITIDOS` (hoy vacia); cualquier otro privilegio de esquema (tambien `CREATE`), un `tipo` desconocido o
// un campo que falta se informan (falla cerrada). Cada texto contiene el esquema, el objeto, la columna y el privilegio. Es una
// funcion separada de `privilegiosDeMas` (P-20), cuyas pruebas no cambian.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const carpetaScripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUTA_MODULO = path.join(carpetaScripts, 'lib', 'rol-app.mjs');

async function cargar() {
  const modulo = await import(/* @vite-ignore */ pathToFileURL(RUTA_MODULO).href);
  for (const nombre of ['FUNCIONES_APP', 'ESQUEMAS_PERMITIDOS', 'privilegiosDeMasEnEsquemas']) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 001 (ronda 6): scripts/lib/rol-app.mjs no exporta ${nombre}.`);
    }
  }
  return modulo;
}

const tabla = (esquema, objeto, privilegio) => ({
  esquema,
  tipo: 'tabla',
  objeto,
  columna: null,
  argumentos: null,
  privilegio,
});
const columna = (esquema, objeto, col, privilegio) => ({
  esquema,
  tipo: 'columna',
  objeto,
  columna: col,
  argumentos: null,
  privilegio,
});
const secuencia = (esquema, objeto, privilegio) => ({
  esquema,
  tipo: 'secuencia',
  objeto,
  columna: null,
  argumentos: null,
  privilegio,
});
const funcion = (esquema, objeto, argumentos, privilegio = 'EXECUTE') => ({
  esquema,
  tipo: 'funcion',
  objeto,
  columna: null,
  argumentos,
  privilegio,
});
const esquemaConUso = (esquema, conObjetosPropios, privilegio = 'USAGE') => ({
  esquema,
  tipo: 'esquema',
  objeto: null,
  columna: null,
  argumentos: null,
  privilegio,
  ...(conObjetosPropios === undefined ? {} : { conObjetosPropios }),
});

/** La lista del criterio 2, escrita aqui de forma independiente, como privilegios efectivos de `public`. */
const LISTA_DEL_CRITERIO_2 = [
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

const PERMITIDAS = [
  funcion('public', 'app_academia_actual', ''),
  funcion('public', 'app_es_plataforma', ''),
  funcion('public', 'resolver_academia', 'p_nombre_corto text'),
];

/** Casos que se rechazan: [descripcion, efectivo, palabras que el texto debe contener]. */
const RECHAZADOS = [
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

describe('criterio 130 (P-31): privilegiosDeMasEnEsquemas de scripts/lib/rol-app.mjs', () => {
  it('criterio 130: sin privilegios efectivos devuelve []', async () => {
    const { privilegiosDeMasEnEsquemas } = await cargar();

    expect(privilegiosDeMasEnEsquemas([])).toEqual([]);
  });

  it('criterio 130: los privilegios de tabla y de columna del criterio 2 sobre public se permiten', async () => {
    const { privilegiosDeMasEnEsquemas } = await cargar();

    expect(privilegiosDeMasEnEsquemas(LISTA_DEL_CRITERIO_2)).toEqual([]);
  });

  it.each(PERMITIDAS.map((f) => [`${f.objeto}(${f.argumentos})`, f]))(
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

  it('criterio 130: uno por privilegio de mas, con textos distintos', async () => {
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
    expect(new Set(problemas).size).toBe(4);
  });

  it('criterio 130: FUNCIONES_APP son las tres funciones de public, por nombre y argumentos, y ESQUEMAS_PERMITIDOS esta vacia', async () => {
    const { FUNCIONES_APP, ESQUEMAS_PERMITIDOS } = await cargar();

    expect(
      [...FUNCIONES_APP]
        .map((f) => ({ esquema: f.esquema, nombre: f.nombre, argumentos: f.argumentos }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    ).toEqual([
      { esquema: 'public', nombre: 'app_academia_actual', argumentos: '' },
      { esquema: 'public', nombre: 'app_es_plataforma', argumentos: '' },
      { esquema: 'public', nombre: 'resolver_academia', argumentos: 'p_nombre_corto text' },
    ]);
    expect([...ESQUEMAS_PERMITIDOS]).toEqual([]);
  });
});
