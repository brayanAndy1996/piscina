// Regla de acceso a la base (spec 001, criterios 85 y 95, ataque rondas 2 y 3; complementa el criterio 28): los módulos del
// backend llegan a la base solo a través de `BaseDatos` (infraestructura/prisma). En `backend/src/**/*.{ts,tsx,mts,cts,js,mjs,
// cjs}` (sin las pruebas):
//   - fuera de `infraestructura/prisma/` y de `cli/`, ningún archivo llega a un valor de estos módulos: una ruta que contenga
//     `generated/prisma`, `prisma.service`, `pg` (y `pg/…`, `pg-…`) o cualquier `@prisma/…`, también cuando la ruta pasa por
//     `node_modules/` (`../../node_modules/pg`, rutas absolutas y URL `file:`); por `import` de un valor, `export … from`,
//     `import(…)`, `require(…)` o `import x = require(…)`. También falla `import(…)` o `require(…)` con un argumento que no
//     es una cadena literal (también en `cli/`, criterio 113), y `createRequire` (de `module` o `node:module`; en `cli/`
//     también por cualquiera de sus vías y la función que devuelve, criterio 113). Los tipos (`import type`, `import { type X }`,
//     `export type … from`) siguen permitidos;
//   - fuera de `cli/`, ninguna importación (de valor o de tipo) de un archivo de `backend/src/cli/`, con la ruta resuelta
//     respecto del archivo que importa;
//   - fuera de `infraestructura/prisma/` (también en `cli/`), ninguna importación de un archivo de esa carpeta que no sea su
//     `index` (se aceptan `…/infraestructura/prisma` y `…/infraestructura/prisma/index`, con o sin extensión).
//   - ataque ronda 4: un archivo que no es prueba no importa un archivo de pruebas (criterio 110: nombre que termina en `.test` o
//     `.test.<extensión>`, o ruta dentro de `backend/test/`); nada fuera de `main.ts`, `cli/` e `infraestructura/entorno/` importa
//     `infraestructura/entorno/cargar-env` ni el paquete `dotenv` (criterio 117); las rutas del archivo, de la raíz y de lo
//     importado se resuelven con `realpath` cuando existen, así que un enlace simbólico no evade las reglas (criterio 111); las
//     exenciones son solo `.test.<ts|mts|cts|js|mjs|cjs>` y el cliente generado (criterios 110 y 118), y se cubre `.jsx` (119).
// Un comentario `eslint-disable` apaga la regla en el lint normal, pero no en el paso protegido (criterio 96). Se exporta por
// separado para poder probarla con ESLint.
import {
  ARCHIVOS_DE_CODIGO,
  EXENCION_CLIENTE_GENERADO,
  EXENCION_PRUEBAS,
  contextoDeArchivo,
  resolverEspecificador,
} from './archivos-de-codigo.mjs';

export const MENSAJE_ACCESO_BASE =
  'Los módulos acceden a la base solo a través de BaseDatos (infraestructura/prisma): usa conAcademia o ' +
  'comoPlataforma. No importes, exportes ni cargues valores del cliente de Prisma, PrismaService, pg ni @prisma/*, ' +
  'y no uses require ni createRequire (los tipos sí se pueden importar).';

export const MENSAJE_CARGA_DINAMICA =
  'import() y require() solo admiten una cadena literal fuera de infraestructura/prisma (también en cli/): así la regla ' +
  'de acceso a la base (BaseDatos es el único camino a Prisma y pg) puede ver qué módulo se carga.';

export const MENSAJE_CREATE_REQUIRE =
  'En cli/ no se usa createRequire ni se carga module/node:module con require() o import(): permiten cargar cualquier ' +
  "módulo sin que la regla de acceso a la base lo vea (sí se puede importar otro nombre, como `import { builtinModules } from 'node:module'`).";

export const MENSAJE_IMPORTA_CLI =
  'Nada fuera de backend/src/cli/ importa archivos de cli/: los comandos usan la conexión del dueño de las tablas y no ' +
  'forman parte de la API.';

export const MENSAJE_IMPORTA_PRUEBAS =
  'Un archivo que no es una prueba no importa archivos de pruebas (*.test.*) ni nada de backend/test/: el código de producción ' +
  'no depende de las pruebas ni de sus utilidades.';

export const MENSAJE_CARGA_ENV =
  'Solo main.ts, cli/ e infraestructura/entorno/ cargan el .env (cargar-env o dotenv): los módulos reciben el entorno ya ' +
  'validado, y no tienen que poder leer ni cambiar lo que se cargó.';

export const MENSAJE_IMPORTA_INTERNOS_PRISMA =
  'Nada fuera de infraestructura/prisma/ importa sus archivos internos: usa solo su index ' +
  "(import … from '…/infraestructura/prisma').";

/** ¿El nombre de un paquete es uno de los que llevan a la base (`pg`, `pg/…`, `pg-pool`, `@prisma/…`, `.prisma/…`)? */
function esPaqueteProhibido(nombre) {
  return /^pg(?:-[\w-]+)?(?:\/|$)/.test(nombre) || nombre.startsWith('@prisma/') || nombre.startsWith('.prisma/');
}

/** ¿La ruta del módulo lleva al cliente de la base? */
export function esModuloProhibido(ruta) {
  const limpia = ruta.replaceAll('\\', '/');
  if (limpia.includes('generated/prisma') || limpia.includes('prisma.service')) return true;
  if (esPaqueteProhibido(limpia)) return true;
  // Una ruta que pasa por `node_modules/`: lo que sigue al último `node_modules/` es el nombre del paquete.
  const marca = limpia.lastIndexOf('node_modules/');
  return marca !== -1 && esPaqueteProhibido(limpia.slice(marca + 'node_modules/'.length));
}

/** `module` y `node:module`: de ahí sale `createRequire`. */
function esModuloNode(ruta) {
  return ruta === 'module' || ruta === 'node:module';
}

/** Nombre de una propiedad de acceso con punto o con una cadena literal; `null` si el acceso es calculado. */
function nombreDePropiedad(acceso) {
  if (!acceso.computed) return acceso.property.type === 'Identifier' ? acceso.property.name : null;
  return acceso.property.type === 'Literal' && typeof acceso.property.value === 'string' ? acceso.property.value : null;
}

/** Nombre de una clave de propiedad de un patrón o de un objeto (`{ createRequire }`, `{ 'createRequire': x }`); `null` si es calculada. */
function nombreDeClave(propiedad) {
  if (propiedad.computed) return null;
  if (propiedad.key.type === 'Identifier') return propiedad.key.name;
  return propiedad.key.type === 'Literal' && typeof propiedad.key.value === 'string' ? propiedad.key.value : null;
}

/** Texto de un argumento si es una cadena literal o una plantilla sin `${}`; `null` si no. */
function textoLiteral(nodo) {
  if (!nodo) return null;
  if (nodo.type === 'Literal' && typeof nodo.value === 'string') return nodo.value;
  if (nodo.type === 'TemplateLiteral' && nodo.expressions.length === 0) return nodo.quasis[0]?.value.cooked ?? '';
  return null;
}

/** ¿El `import` trae algún valor? (`import type` y `import { type X }` no; `import 'x'` y `import {} from 'x'` sí). */
function importaValores(nodo) {
  if (nodo.importKind === 'type') return false;
  if (nodo.specifiers.length === 0) return true;
  return nodo.specifiers.some((especificador) => especificador.importKind !== 'type');
}

/** ¿El `export … from` reexporta algún valor? */
function exportaValores(nodo) {
  if (nodo.exportKind === 'type') return false;
  if (nodo.type === 'ExportAllDeclaration') return true;
  if (nodo.specifiers.length === 0) return true;
  return nodo.specifiers.some((especificador) => especificador.exportKind !== 'type');
}

// ---------------------------------------------------------------------------------------------------------------------
// Rutas (criterio 95)
// ---------------------------------------------------------------------------------------------------------------------

const EXTENSION_DE_CODIGO = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Nombre de un archivo de pruebas: termina en `.test` o `.test.<extensión>` (criterio 110). */
const ARCHIVO_DE_PRUEBAS = /\.test(?:\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))?$/;

/** El paquete `dotenv` o un archivo suyo (`dotenv/config`, `dotenv/lib/main.js`). */
const esDotenv = (especificador) => especificador === 'dotenv' || especificador.startsWith('dotenv/');

/** ¿`ruta` es la carpeta `carpeta` o está dentro de ella? Las dos ya en forma comparable. */
function estaDentro(ruta, carpeta) {
  return ruta === carpeta || ruta.startsWith(`${carpeta}/`);
}

const reglaAccesoBase = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { acceso: '{{ mensaje }}' },
  },
  create(context) {
    // Las rutas del archivo y de la raíz pasan por `realpath` (criterio 111): un enlace no cambia en qué carpeta "está" un archivo.
    const { archivoComparable, raiz, carpetas: carpetasDeResolucion } = contextoDeArchivo(context);
    const carpetaCli = `${raiz}/backend/src/cli`;
    const carpetaPrisma = `${raiz}/backend/src/infraestructura/prisma`;
    const carpetaEntorno = `${raiz}/backend/src/infraestructura/entorno`;
    const carpetaPruebas = `${raiz}/backend/test`;
    const archivoCargarEnv = `${carpetaEntorno}/cargar-env`;
    const enCli = estaDentro(archivoComparable, carpetaCli);
    const enPrisma = estaDentro(archivoComparable, carpetaPrisma);
    const enEntorno = estaDentro(archivoComparable, carpetaEntorno);
    const esPrincipal = archivoComparable === `${raiz}/backend/src/main.ts`;
    // El acceso a la base solo se exige a los módulos: `infraestructura/prisma/` y `cli/` sí llegan a Prisma y a pg.
    const revisaModulos = !enCli && !enPrisma;

    const informar = (nodo, mensaje = MENSAJE_ACCESO_BASE) =>
      context.report({ node: nodo, messageId: 'acceso', data: { mensaje } });

    /**
     * Criterios 95, 110 y 117: importaciones de `cli/`, de los internos de `infraestructura/prisma/`, de archivos de pruebas, de
     * `cargar-env` y de `dotenv` (de valor o de tipo, por cualquiera de las vías).
     */
    function revisarDestino(nodo, especificador) {
      if (!esPrincipal && !enCli && !enEntorno && esDotenv(especificador)) {
        informar(nodo, MENSAJE_CARGA_ENV);
        return;
      }
      const destinos = resolverEspecificador(especificador, carpetasDeResolucion);
      if (destinos.length === 0) {
        // Un paquete o una ruta que no se resuelve: solo el nombre puede delatar un archivo de pruebas.
        if (ARCHIVO_DE_PRUEBAS.test(especificador)) informar(nodo, MENSAJE_IMPORTA_PRUEBAS);
        return;
      }
      for (const destino of destinos) {
        const sinExtension = destino.replace(EXTENSION_DE_CODIGO, '');
        if (
          ARCHIVO_DE_PRUEBAS.test(destino) ||
          ARCHIVO_DE_PRUEBAS.test(sinExtension) ||
          estaDentro(destino, carpetaPruebas)
        ) {
          informar(nodo, MENSAJE_IMPORTA_PRUEBAS);
          return;
        }
        if (!esPrincipal && !enCli && !enEntorno && sinExtension === archivoCargarEnv) {
          informar(nodo, MENSAJE_CARGA_ENV);
          return;
        }
        if (!enCli && estaDentro(destino, carpetaCli)) {
          informar(nodo, MENSAJE_IMPORTA_CLI);
          return;
        }
        if (!enPrisma && estaDentro(destino, carpetaPrisma)) {
          if (sinExtension !== carpetaPrisma && sinExtension !== `${carpetaPrisma}/index`) {
            informar(nodo, MENSAJE_IMPORTA_INTERNOS_PRISMA);
            return;
          }
        }
      }
    }

    /** Revisa la ruta de un módulo que se carga como valor. */
    function revisarRuta(nodo, ruta) {
      if (revisaModulos && (esModuloProhibido(ruta) || esModuloNode(ruta))) informar(nodo);
    }

    /** Revisa el argumento de `import(…)` o `require(…)`. */
    function revisarCarga(nodo, argumento) {
      const ruta = textoLiteral(argumento);
      if (ruta === null) {
        // Criterio 113: la ruta que se calcula tampoco se puede seguir en cli/; solo infraestructura/prisma/ queda libre.
        if (!enPrisma) informar(nodo, MENSAJE_CARGA_DINAMICA);
        return;
      }
      // En cli/, `module` y `node:module` no se cargan con require() ni import(): de ahí sale createRequire.
      if (enCli && esModuloNode(ruta)) {
        informar(nodo, MENSAJE_CREATE_REQUIRE);
        return;
      }
      revisarRuta(nodo, ruta);
      revisarDestino(nodo, ruta);
    }

    /**
     * Criterio 113 (cli/): lo que se importa de `module` o `node:module`. `createRequire` por nombre falla (aunque no se use);
     * el espacio de nombres (`import * as m`) o la importación por defecto solo se pueden usar como `m.<nombre fijo>` distinto de
     * `createRequire` o desestructurando nombres fijos distintos de `createRequire`: cualquier otro uso (asignarlo, pasarlo,
     * devolverlo) deja llegar a `createRequire` sin que se vea.
     */
    function revisarCreateRequireImportado(nodo) {
      for (const especificador of nodo.specifiers) {
        if (especificador.importKind === 'type') continue;
        if (especificador.type === 'ImportSpecifier') {
          if ((especificador.imported.name ?? especificador.imported.value) === 'createRequire') {
            informar(nodo, MENSAJE_CREATE_REQUIRE);
            return;
          }
          continue;
        }
        for (const variable of context.sourceCode.getDeclaredVariables(especificador)) {
          for (const referencia of variable.references) {
            if (!referencia.isValueReference && referencia.isTypeReference) continue;
            if (!usoSeguroDelModulo(referencia.identifier)) {
              informar(referencia.identifier, MENSAJE_CREATE_REQUIRE);
              return;
            }
          }
        }
      }
    }

    /** ¿El identificador del espacio de nombres de `module` se usa solo para llegar a un nombre fijo que no es `createRequire`? */
    function usoSeguroDelModulo(identificador) {
      const padre = identificador.parent;
      if (padre.type === 'MemberExpression' && padre.object === identificador) {
        const nombre = nombreDePropiedad(padre);
        return nombre !== null && nombre !== 'createRequire' && nombre !== 'getBuiltinModule';
      }
      if (padre.type === 'VariableDeclarator' && padre.init === identificador && padre.id.type === 'ObjectPattern') {
        return padre.id.properties.every(
          (propiedad) =>
            propiedad.type === 'Property' &&
            nombreDeClave(propiedad) !== null &&
            nombreDeClave(propiedad) !== 'createRequire',
        );
      }
      return false;
    }

    return {
      ImportDeclaration(nodo) {
        const ruta = String(nodo.source.value);
        revisarDestino(nodo, ruta);
        if (enCli && esModuloNode(ruta) && importaValores(nodo)) revisarCreateRequireImportado(nodo);
        if (!revisaModulos || !importaValores(nodo)) return;
        if (esModuloProhibido(ruta)) {
          informar(nodo);
          return;
        }
        if (esModuloNode(ruta)) {
          // `createRequire` por nombre, o el módulo entero (por defecto o con `*`) para llegar a `module.createRequire`.
          const peligroso = nodo.specifiers.some(
            (especificador) =>
              especificador.importKind !== 'type' &&
              (especificador.type !== 'ImportSpecifier' ||
                (especificador.imported.name ?? especificador.imported.value) === 'createRequire'),
          );
          if (peligroso) informar(nodo);
        }
      },
      ExportNamedDeclaration(nodo) {
        if (!nodo.source) return;
        const ruta = String(nodo.source.value);
        revisarDestino(nodo, ruta);
        if (enCli && esModuloNode(ruta) && exportaValores(nodo)) {
          const peligroso = nodo.specifiers.some(
            (especificador) =>
              especificador.exportKind !== 'type' &&
              ['createRequire', 'default'].includes(especificador.local.name ?? especificador.local.value),
          );
          if (peligroso) informar(nodo, MENSAJE_CREATE_REQUIRE);
        }
        if (exportaValores(nodo)) revisarRuta(nodo, ruta);
      },
      ExportAllDeclaration(nodo) {
        if (!nodo.source) return;
        const ruta = String(nodo.source.value);
        revisarDestino(nodo, ruta);
        if (enCli && esModuloNode(ruta) && exportaValores(nodo)) informar(nodo, MENSAJE_CREATE_REQUIRE);
        if (exportaValores(nodo)) revisarRuta(nodo, ruta);
      },
      ImportExpression(nodo) {
        revisarCarga(nodo, nodo.source);
      },
      CallExpression(nodo) {
        if (nodo.callee.type === 'Identifier' && nodo.callee.name === 'require') revisarCarga(nodo, nodo.arguments[0]);
      },
      // En cli/, `createRequire` como propiedad (`x.createRequire`, `x['createRequire']`) o como clave de un patrón
      // (`const { createRequire } = x`), y `process.getBuiltinModule(…)`, que da el módulo `module` sin importarlo.
      MemberExpression(nodo) {
        if (!enCli) return;
        const nombre = nombreDePropiedad(nodo);
        if (nombre === 'createRequire' || nombre === 'getBuiltinModule') informar(nodo, MENSAJE_CREATE_REQUIRE);
      },
      Property(nodo) {
        if (!enCli || nodo.parent.type !== 'ObjectPattern') return;
        if (nombreDeClave(nodo) === 'createRequire') informar(nodo, MENSAJE_CREATE_REQUIRE);
      },
      TSImportEqualsDeclaration(nodo) {
        const referencia = nodo.moduleReference;
        if (referencia.type !== 'TSExternalModuleReference') return;
        if (nodo.importKind === 'type') {
          const ruta = textoLiteral(referencia.expression);
          if (ruta !== null) revisarDestino(nodo, ruta);
          return;
        }
        revisarCarga(nodo, referencia.expression);
      },
    };
  },
};

export const pluginAccesoBase = {
  meta: { name: 'aquagestion-acceso-base' },
  rules: { 'sin-cliente-de-la-base': reglaAccesoBase },
};

/** Archivos a los que se aplica la regla: todas las extensiones que `tsx` ejecuta, también `.jsx` (criterios 95 y 119). */
export const archivosConReglaAccesoBase = ARCHIVOS_DE_CODIGO;

/** Exentos: el cliente generado y las pruebas (solo `.test.<ts|mts|cts|js|mjs|cjs>`; criterios 110 y 118). */
export const archivosExentosAccesoBase = [EXENCION_CLIENTE_GENERADO, EXENCION_PRUEBAS];

/** Bloque de configuración plana listo para agregar a `eslint.config.mjs` y a la del paso protegido. */
export const configuracionAccesoBase = [
  {
    name: 'aquagestion/regla-acceso-base',
    files: archivosConReglaAccesoBase,
    ignores: archivosExentosAccesoBase,
    plugins: { 'aquagestion-base': pluginAccesoBase },
    rules: { 'aquagestion-base/sin-cliente-de-la-base': 'error' },
  },
];
