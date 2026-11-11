// Ayudas de ámbito (scope) de las reglas de SQL (spec 001, criterios 112 y 113): deciden qué es un identificador por lo que
// importa o declara el archivo, no por su nombre. Una `sql` declarada en el archivo, un parámetro llamado `sql` o una `sql`
// importada de otro sitio no son la `sql` del punto autorizado; `Prisma` solo es el espacio de nombres del cliente si viene
// de `generated/prisma` o de `@prisma/…`.
import { contextoDeArchivo, esElPuntoAutorizado, resolverEspecificador } from './archivos-de-codigo.mjs';

/** Nombre importado de un `ImportSpecifier` (`import { sql as s }` -> `sql`). */
const nombreImportado = (especificador) => especificador.imported?.name ?? especificador.imported?.value ?? null;

/** ¿El módulo es el cliente generado o un paquete de Prisma, por cualquier ruta? */
export function esModuloDePrisma(ruta) {
  const limpia = String(ruta).replaceAll('\\', '/');
  return limpia.includes('generated/prisma') || /(?:^|\/)@prisma\//.test(limpia) || /(?:^|\/)\.prisma\//.test(limpia);
}

/** La variable a la que se refiere el identificador (busca desde el ámbito más cercano hacia afuera). */
export function variableDe(context, identificador) {
  let ambito = context.sourceCode.getScope(identificador);
  while (ambito) {
    const variable = ambito.set.get(identificador.name);
    if (variable) return variable;
    ambito = ambito.upper;
  }
  return null;
}

/** La importación única que define la variable: `{ declaracion, especificador }`, o `null` si no es solo una importación. */
export function importacionDe(variable) {
  if (!variable || variable.defs.length !== 1) return null;
  const definicion = variable.defs[0];
  if (definicion.type !== 'ImportBinding') return null;
  const especificador = definicion.node;
  const declaracion = definicion.parent;
  if (declaracion?.type !== 'ImportDeclaration') return null;
  // `import type …` e `import { type X }` no traen un valor.
  if (declaracion.importKind === 'type' || especificador.importKind === 'type') return null;
  return { declaracion, especificador };
}

/**
 * Análisis de las importaciones de un archivo: qué variables vienen del punto autorizado (`sql`, espacios de nombres) y del
 * cliente generado o de `@prisma/…` (`Prisma`, espacios de nombres). Se calcula una vez por archivo.
 */
export function analizarImportaciones(context) {
  const { raiz, carpetas } = contextoDeArchivo(context);
  const resultado = {
    sqlDelPunto: new Set(), // variables que son la `sql` del punto autorizado (con o sin alias)
    sqlImportada: new Set(), // variables importadas como `sql` de cualquier módulo (para analizar de más, criterio 112)
    espaciosDelPunto: new Set(), // `import * as bd from '…/infraestructura/prisma'`
    prismaDelCliente: new Set(), // `Prisma` (o un alias) del cliente generado o de @prisma/…
    espaciosDelCliente: new Set(), // `import * as G` o `import G` del cliente generado o de @prisma/…
  };
  const moduloDeAlcance = context.sourceCode.scopeManager?.scopes.find((ambito) => ambito.type === 'module');
  if (!moduloDeAlcance) return resultado;
  for (const variable of moduloDeAlcance.variables) {
    const importacion = importacionDe(variable);
    if (!importacion) continue;
    const { declaracion, especificador } = importacion;
    const origen = String(declaracion.source.value);
    if (especificador.type === 'ImportSpecifier' && nombreImportado(especificador) === 'sql') {
      resultado.sqlImportada.add(variable);
    }
    const esPunto = resolverEspecificador(origen, carpetas).some((destino) => esElPuntoAutorizado(destino, raiz));
    if (esPunto) {
      if (especificador.type === 'ImportSpecifier' && nombreImportado(especificador) === 'sql') {
        resultado.sqlDelPunto.add(variable);
      } else if (especificador.type === 'ImportNamespaceSpecifier') {
        resultado.espaciosDelPunto.add(variable);
      }
      continue;
    }
    if (!esModuloDePrisma(origen)) continue;
    if (especificador.type === 'ImportSpecifier') {
      if (nombreImportado(especificador) === 'Prisma') resultado.prismaDelCliente.add(variable);
    } else {
      // `import * as G` e `import G from` (la importación por defecto).
      resultado.espaciosDelCliente.add(variable);
    }
  }
  return resultado;
}

const aCadena = (nodo) => {
  if (nodo.type === 'Literal' && typeof nodo.value === 'string') return nodo.value;
  if (nodo.type === 'TemplateLiteral' && nodo.expressions.length === 0) return nodo.quasis[0]?.value.cooked ?? null;
  return null;
};

/** Nombre de la propiedad de un acceso `a.b` o `a['b']` (con un literal); `null` si no se puede saber. */
export function nombreDePropiedad(acceso) {
  const propiedad = acceso.property;
  if (!acceso.computed) return propiedad.type === 'Identifier' ? propiedad.name : null;
  return aCadena(propiedad);
}

/**
 * ¿La etiqueta de una plantilla es la `sql` del punto autorizado? Un identificador cuya variable es la `sql` importada de allí
 * (con su nombre o con un alias), o `<espacio>.sql` de un `import * as <espacio>` de ese punto.
 */
export function esSqlDelPunto(context, importaciones, etiqueta) {
  if (etiqueta.type === 'Identifier') return importaciones.sqlDelPunto.has(variableDe(context, etiqueta));
  if (etiqueta.type === 'MemberExpression' && !etiqueta.computed && nombreDePropiedad(etiqueta) === 'sql') {
    return (
      etiqueta.object.type === 'Identifier' && importaciones.espaciosDelPunto.has(variableDe(context, etiqueta.object))
    );
  }
  return false;
}

/**
 * ¿El nodo es el espacio de nombres `Prisma` del cliente generado? `Prisma` importado (con o sin alias) o `G.Prisma` con `G` un
 * espacio de nombres (o importación por defecto) del cliente generado. Por ámbito, no por nombre.
 */
export function esPrismaDelCliente(context, importaciones, nodo) {
  if (nodo.type === 'Identifier') return importaciones.prismaDelCliente.has(variableDe(context, nodo));
  if (nodo.type === 'MemberExpression' && !nodo.computed && nombreDePropiedad(nodo) === 'Prisma') {
    return nodo.object.type === 'Identifier' && importaciones.espaciosDelCliente.has(variableDe(context, nodo.object));
  }
  return false;
}
