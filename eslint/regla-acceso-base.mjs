// Regla de acceso a la base (spec 001, criterios 85 y 95, ataque rondas 2 y 3; complementa el criterio 28): los módulos del
// backend llegan a la base solo a través de `BaseDatos` (infraestructura/prisma). En `backend/src/**/*.{ts,tsx,mts,cts,js,mjs,
// cjs}` (sin las pruebas):
//   - fuera de `infraestructura/prisma/` y de `cli/`, ningún archivo llega a un valor de estos módulos: una ruta que contenga
//     `generated/prisma`, `prisma.service`, `pg` (y `pg/…`, `pg-…`) o cualquier `@prisma/…`, también cuando la ruta pasa por
//     `node_modules/` (`../../node_modules/pg`, rutas absolutas y URL `file:`); por `import` de un valor, `export … from`,
//     `import(…)`, `require(…)` o `import x = require(…)`. También falla `import(…)` o `require(…)` con un argumento que no
//     es una cadena literal, y `createRequire` (de `module` o `node:module`). Los tipos (`import type`, `import { type X }`,
//     `export type … from`) siguen permitidos;
//   - fuera de `cli/`, ninguna importación (de valor o de tipo) de un archivo de `backend/src/cli/`, con la ruta resuelta
//     respecto del archivo que importa;
//   - fuera de `infraestructura/prisma/` (también en `cli/`), ninguna importación de un archivo de esa carpeta que no sea su
//     `index` (se aceptan `…/infraestructura/prisma` y `…/infraestructura/prisma/index`, con o sin extensión).
// Un comentario `eslint-disable` apaga la regla en el lint normal, pero no en el paso protegido (criterio 96). Se exporta por
// separado para poder probarla con ESLint.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MENSAJE_ACCESO_BASE =
  'Los módulos acceden a la base solo a través de BaseDatos (infraestructura/prisma): usa conAcademia o ' +
  'comoPlataforma. No importes, exportes ni cargues valores del cliente de Prisma, PrismaService, pg ni @prisma/*, ' +
  'y no uses require ni createRequire (los tipos sí se pueden importar).';

export const MENSAJE_CARGA_DINAMICA =
  'import() y require() solo admiten una cadena literal fuera de infraestructura/prisma: así la regla de acceso a la ' +
  'base (BaseDatos es el único camino a Prisma y pg) puede ver qué módulo se carga.';

export const MENSAJE_IMPORTA_CLI =
  'Nada fuera de backend/src/cli/ importa archivos de cli/: los comandos usan la conexión del dueño de las tablas y no ' +
  'forman parte de la API.';

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

const EXTENSIONES = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;

/** Ruta con `/` como separador y, en Windows, en minúsculas (el sistema de archivos no distingue mayúsculas). */
function comparable(ruta) {
  const posix = ruta.replaceAll('\\', '/');
  return process.platform === 'win32' ? posix.toLowerCase() : posix;
}

/** ¿`ruta` es la carpeta `carpeta` o está dentro de ella? Las dos ya en forma comparable. */
function estaDentro(ruta, carpeta) {
  return ruta === carpeta || ruta.startsWith(`${carpeta}/`);
}

/**
 * Ruta absoluta (comparable) a la que apunta el especificador de un módulo relativo, absoluto o `file:`, resuelto respecto del
 * archivo que importa; `null` si es un paquete (`pg`, `@nestjs/common`…) o no se puede resolver.
 */
function resolverEspecificador(especificador, archivo) {
  let ruta;
  if (especificador.startsWith('file:')) {
    try {
      ruta = fileURLToPath(especificador);
    } catch {
      return null;
    }
  } else if (/^(?:\.{1,2}(?:[\\/]|$)|[\\/]|[a-zA-Z]:[\\/])/.test(especificador)) {
    ruta = path.resolve(path.dirname(archivo), especificador);
  } else {
    return null;
  }
  return comparable(path.normalize(ruta));
}

const reglaAccesoBase = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { acceso: '{{ mensaje }}' },
  },
  create(context) {
    const archivo = path.resolve(context.cwd, context.filename);
    const raiz = comparable(path.resolve(context.cwd));
    const carpetaCli = `${raiz}/backend/src/cli`;
    const carpetaPrisma = `${raiz}/backend/src/infraestructura/prisma`;
    const archivoComparable = comparable(archivo);
    const enCli = estaDentro(archivoComparable, carpetaCli);
    const enPrisma = estaDentro(archivoComparable, carpetaPrisma);
    // El acceso a la base solo se exige a los módulos: `infraestructura/prisma/` y `cli/` sí llegan a Prisma y a pg.
    const revisaModulos = !enCli && !enPrisma;

    const informar = (nodo, mensaje = MENSAJE_ACCESO_BASE) =>
      context.report({ node: nodo, messageId: 'acceso', data: { mensaje } });

    /** Criterio 95: importaciones de `cli/` y de los internos de `infraestructura/prisma/` (de valor o de tipo). */
    function revisarDestino(nodo, especificador) {
      const destino = resolverEspecificador(especificador, archivo);
      if (destino === null) return;
      if (!enCli && estaDentro(destino, carpetaCli)) {
        informar(nodo, MENSAJE_IMPORTA_CLI);
        return;
      }
      if (!enPrisma && estaDentro(destino, carpetaPrisma)) {
        const sinExtension = destino.replace(EXTENSIONES, '');
        if (sinExtension !== carpetaPrisma && sinExtension !== `${carpetaPrisma}/index`) {
          informar(nodo, MENSAJE_IMPORTA_INTERNOS_PRISMA);
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
        if (revisaModulos) informar(nodo, MENSAJE_CARGA_DINAMICA);
        return;
      }
      revisarRuta(nodo, ruta);
      revisarDestino(nodo, ruta);
    }

    return {
      ImportDeclaration(nodo) {
        const ruta = String(nodo.source.value);
        revisarDestino(nodo, ruta);
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
        if (exportaValores(nodo)) revisarRuta(nodo, ruta);
      },
      ExportAllDeclaration(nodo) {
        if (!nodo.source) return;
        const ruta = String(nodo.source.value);
        revisarDestino(nodo, ruta);
        if (exportaValores(nodo)) revisarRuta(nodo, ruta);
      },
      ImportExpression(nodo) {
        revisarCarga(nodo, nodo.source);
      },
      CallExpression(nodo) {
        if (nodo.callee.type === 'Identifier' && nodo.callee.name === 'require') revisarCarga(nodo, nodo.arguments[0]);
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

/** Archivos a los que se aplica la regla: todas las extensiones que `tsx` ejecuta (criterio 95). */
export const archivosConReglaAccesoBase = ['backend/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}'];

/** Exentos: el cliente generado y las pruebas. Dentro de la regla, `cli/` y `infraestructura/prisma/` se tratan aparte. */
export const archivosExentosAccesoBase = ['backend/src/generated/**', '**/*.test.*'];

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
