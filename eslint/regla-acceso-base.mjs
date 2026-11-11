// Regla de acceso a la base (spec 001, criterio 85, ataque ronda 2; complementa el criterio 28): los módulos del backend
// llegan a la base solo a través de `BaseDatos` (infraestructura/prisma). En `backend/src/`, fuera de
// `infraestructura/prisma/` y de `cli/`, ningún archivo llega a un valor de estos módulos: una ruta que contenga
// `generated/prisma`, `prisma.service`, `pg` (y `pg/…`, `pg-…`) o cualquier `@prisma/…`; por `import` de un valor,
// `export … from`, `import(…)`, `require(…)` o `import x = require(…)`. También falla `import(…)` o `require(…)` con un
// argumento que no es una cadena literal, y `createRequire` (de `module` o `node:module`). Los tipos (`import type`,
// `import { type X }`, `export type … from`) siguen permitidos. Un comentario `eslint-disable` no la apaga
// (`noInlineConfig`, P-15). Se exporta por separado para poder probarla con ESLint.

export const MENSAJE_ACCESO_BASE =
  'Los módulos acceden a la base solo a través de BaseDatos (infraestructura/prisma): usa conAcademia o ' +
  'comoPlataforma. No importes, exportes ni cargues valores del cliente de Prisma, PrismaService, pg ni @prisma/*, ' +
  'y no uses require ni createRequire (los tipos sí se pueden importar).';

export const MENSAJE_CARGA_DINAMICA =
  'import() y require() solo admiten una cadena literal fuera de infraestructura/prisma: así la regla de acceso a la ' +
  'base (BaseDatos es el único camino a Prisma y pg) puede ver qué módulo se carga.';

/** ¿La ruta del módulo lleva al cliente de la base? */
export function esModuloProhibido(ruta) {
  const limpia = ruta.replaceAll('\\', '/');
  return (
    limpia.includes('generated/prisma') ||
    limpia.includes('prisma.service') ||
    /^pg(?:-[\w-]+)?(?:\/|$)/.test(limpia) ||
    limpia.startsWith('@prisma/')
  );
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

const reglaAccesoBase = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { acceso: '{{ mensaje }}' },
  },
  create(context) {
    const informar = (nodo, mensaje = MENSAJE_ACCESO_BASE) =>
      context.report({ node: nodo, messageId: 'acceso', data: { mensaje } });

    /** Revisa la ruta de un módulo que se carga como valor. */
    function revisarRuta(nodo, ruta) {
      if (esModuloProhibido(ruta) || esModuloNode(ruta)) informar(nodo);
    }

    /** Revisa el argumento de `import(…)` o `require(…)`. */
    function revisarCarga(nodo, argumento) {
      const ruta = textoLiteral(argumento);
      if (ruta === null) informar(nodo, MENSAJE_CARGA_DINAMICA);
      else revisarRuta(nodo, ruta);
    }

    return {
      ImportDeclaration(nodo) {
        if (!importaValores(nodo)) return;
        const ruta = String(nodo.source.value);
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
        if (nodo.source && exportaValores(nodo)) revisarRuta(nodo, String(nodo.source.value));
      },
      ExportAllDeclaration(nodo) {
        if (nodo.source && exportaValores(nodo)) revisarRuta(nodo, String(nodo.source.value));
      },
      ImportExpression(nodo) {
        revisarCarga(nodo, nodo.source);
      },
      CallExpression(nodo) {
        if (nodo.callee.type === 'Identifier' && nodo.callee.name === 'require') revisarCarga(nodo, nodo.arguments[0]);
      },
      TSImportEqualsDeclaration(nodo) {
        if (nodo.importKind === 'type') return;
        const referencia = nodo.moduleReference;
        if (referencia.type === 'TSExternalModuleReference') revisarCarga(nodo, referencia.expression);
      },
    };
  },
};

export const pluginAccesoBase = {
  meta: { name: 'aquagestion-acceso-base' },
  rules: { 'sin-cliente-de-la-base': reglaAccesoBase },
};

/** Archivos a los que se aplica la regla. */
export const archivosConReglaAccesoBase = ['backend/src/**/*.ts'];

/** Exentos: el acceso a datos mismo, los comandos, el cliente generado y las pruebas. */
export const archivosExentosAccesoBase = [
  'backend/src/infraestructura/prisma/**',
  'backend/src/cli/**',
  'backend/src/generated/**',
  '**/*.test.ts',
];

/** Bloque de configuración plana listo para agregar a `eslint.config.mjs`. */
export const configuracionAccesoBase = [
  {
    name: 'aquagestion/regla-acceso-base',
    files: archivosConReglaAccesoBase,
    ignores: archivosExentosAccesoBase,
    plugins: { 'aquagestion-base': pluginAccesoBase },
    rules: { 'aquagestion-base/sin-cliente-de-la-base': 'error' },
  },
];
