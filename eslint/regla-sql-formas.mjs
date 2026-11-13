// Regla de formas del SQL (spec 001, criterios 92, 112 y 113, ataque rondas 3 y 4): el SQL solo llega a la base en plantillas
// etiquetadas. En `backend/src/`, fuera de `infraestructura/prisma/` y de las pruebas (también en `cli/`), falla el lint si:
//   - se nombra `$queryRawUnsafe` o `$executeRawUnsafe` de cualquier forma (acceso con punto, con corchetes y un literal,
//     desestructuración, o una cadena o plantilla cuyo texto los contiene);
//   - `$queryRaw` o `$executeRaw` se usan de otra forma que como etiqueta directa de una plantilla o como llamada cuyo único
//     argumento es una plantilla etiquetada con la `sql` del punto autorizado (`infraestructura/prisma`; la regla lo decide por el
//     ámbito, no por el nombre: una `sql` declarada en el archivo, un parámetro llamado `sql` o una `sql` de otro sitio no sirven)
//     o, solo en `cli/`, con `Prisma.sql` y `Prisma` importado del cliente generado (criterio 112);
//   - `Prisma.sql` o `sql` se llaman como función en lugar de usarse como etiqueta;
//   - se usa como valor `Prisma.raw`, `Prisma.Sql` o `Prisma.join` con más de un argumento, o se importan `raw`, `join` o `Sql`
//     de `generated/prisma` o de `@prisma/…` (con cualquier alias). `Prisma.Sql` como tipo sigue permitido;
//   - (criterio 113) `Prisma`, un alias suyo, `G.Prisma` o el espacio de nombres `G` del cliente generado o de `@prisma/…` se usa
//     como valor de otra forma que como objeto de un acceso con punto a un nombre fijo (asignado, pasado, propagado, devuelto,
//     exportado, desestructurado o con acceso calculado); una cadena de miembros que parte de ellos toca `constructor`,
//     `prototype` o `__proto__`, o se pasa a `Reflect.*` o a `Object.getPrototypeOf|getOwnPropertyDescriptor(s)|entries|values|
//     keys|assign`; o el cliente generado o `@prisma/…` se cargan con `require(…)` o `import(…)` en lugar de un `import` estático.
// La regla que analiza el texto de las plantillas (SQL de sesión) está en `regla-sql-sesion.mjs`.

import {
  analizarImportaciones,
  esModuloDePrisma,
  esPrismaDelCliente,
  esSqlDelPunto,
  nombreDePropiedad,
  variableDe,
} from './ayuda-ambito.mjs';
import { contextoDeArchivo } from './archivos-de-codigo.mjs';

export const MENSAJE_FORMAS_DE_SQL =
  'El SQL solo llega a la base en plantillas etiquetadas: usa tx.cliente.$queryRaw`…`, tx.cliente.$executeRaw`…` o ' +
  'tx.cliente.$queryRaw(sql`…`) con la sql de infraestructura/prisma (en cli/, también Prisma.sql), con valores interpolados con ' +
  '${…}. No uses $queryRawUnsafe ni $executeRawUnsafe, no guardes ni pases $queryRaw/$executeRaw como valores, no llames a ' +
  'sql ni a Prisma.sql como función y no uses Prisma.raw, Prisma.Sql como valor ni Prisma.join con separador.';

export const MENSAJE_PRISMA_COMO_VALOR =
  'En cli/, Prisma (y el espacio de nombres del cliente generado) solo se usa como objeto de un acceso con punto a un nombre ' +
  'fijo (Prisma.sql`…`, new Prisma.Decimal(…)): no lo asignes, pases, propagues, devuelvas, exportes ni desestructures, no uses ' +
  'accesos calculados, constructor, prototype ni __proto__, y no lo pases a Reflect ni a Object.*.';

export const MENSAJE_CARGA_DEL_CLIENTE =
  'El cliente generado y @prisma/… se importan con un import estático: no los cargues con require() ni import().';

const NOMBRES_UNSAFE = new Set(['$queryRawUnsafe', '$executeRawUnsafe']);
const NOMBRES_RAW = new Set(['$queryRaw', '$executeRaw']);
const NOMBRES_DE_IMPORTACION_PROHIBIDOS = new Set(['raw', 'join', 'Sql']);
const NOMBRES_DE_LA_CADENA_PROHIBIDOS = new Set(['constructor', 'prototype', '__proto__']);
const FUNCIONES_DE_OBJECT_PROHIBIDAS = new Set([
  'getPrototypeOf',
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
  'entries',
  'values',
  'keys',
  'assign',
]);
const PATRON_UNSAFE = /\$(?:query|execute)RawUnsafe/;

/** Texto de un argumento si es una cadena literal o una plantilla sin `${}`; `null` si no. */
function textoLiteral(nodo) {
  if (!nodo) return null;
  if (nodo.type === 'Literal' && typeof nodo.value === 'string') return nodo.value;
  if (nodo.type === 'TemplateLiteral' && nodo.expressions.length === 0) return nodo.quasis[0]?.value.cooked ?? '';
  return null;
}

/**
 * ¿El especificador de `require(…)` o `import(…)` carga el cliente generado (`…/generated/prisma/…`) o un paquete `@prisma/…`?
 * Una ruta que pasa por `node_modules/` (`../../node_modules/@prisma/client/index.js`) no cuenta: es la ruta de un archivo, no el
 * nombre del paquete (la regla de acceso a la base la sigue revisando fuera de `cli/`).
 */
function esCargaDelCliente(ruta) {
  const limpia = ruta.replaceAll('\\', '/');
  if (limpia.includes('node_modules/')) return false;
  return limpia.startsWith('@prisma/') || limpia.includes('generated/prisma');
}

const reglaFormasDeSql = {
  meta: { type: 'problem', schema: [], messages: { forma: '{{ mensaje }}' } },
  create(context) {
    const informar = (nodo, mensaje = MENSAJE_FORMAS_DE_SQL) =>
      context.report({ node: nodo, messageId: 'forma', data: { mensaje } });
    const { archivoComparable, raiz } = contextoDeArchivo(context);
    const enCli =
      archivoComparable === `${raiz}/backend/src/cli` || archivoComparable.startsWith(`${raiz}/backend/src/cli/`);
    /** Nombres locales de `Prisma` (`import { Prisma as P }`), para las prohibiciones por nombre. */
    const nombresDePrisma = new Set(['Prisma']);
    let importacionesCache;
    const importaciones = () => (importacionesCache ??= analizarImportaciones(context));

    /** ¿Es el espacio de nombres `Prisma` (o un alias, o `<algo>.Prisma`)? Por nombre: analizar de más no abre caminos. */
    const esPrisma = (nodo) =>
      (nodo.type === 'Identifier' && nombresDePrisma.has(nodo.name)) ||
      (nodo.type === 'MemberExpression' && nombreDePropiedad(nodo) === 'Prisma');

    /** ¿Es una plantilla etiquetada que se acepta como único argumento de `$queryRaw` / `$executeRaw` (criterio 112)? */
    const esPlantillaAutorizada = (nodo) => {
      if (nodo?.type !== 'TaggedTemplateExpression') return false;
      if (esSqlDelPunto(context, importaciones(), nodo.tag)) return true;
      // Solo en cli/: `Prisma.sql` con `Prisma` importado del cliente generado.
      return (
        enCli &&
        nodo.tag.type === 'MemberExpression' &&
        nombreDePropiedad(nodo.tag) === 'sql' &&
        esPrismaDelCliente(context, importaciones(), nodo.tag.object)
      );
    };

    /** ¿El identificador es la `sql` del punto autorizado (con su nombre o con un alias)? */
    const esSqlImportada = (nodo) => importaciones().sqlDelPunto.has(variableDe(context, nodo));
    /** ¿El nodo es el espacio de nombres del punto autorizado (`import * as bd`)? */
    const esEspacioDelPunto = (nodo) =>
      nodo.type === 'Identifier' && importaciones().espaciosDelPunto.has(variableDe(context, nodo));

    const esEtiquetaDe = (nodo) => nodo.parent?.type === 'TaggedTemplateExpression' && nodo.parent.tag === nodo;
    const esLlamadoDe = (nodo) => nodo.parent?.type === 'CallExpression' && nodo.parent.callee === nodo;

    /** Mira el texto de una cadena o plantilla que nombra un método sin plantilla. */
    function revisarTexto(nodo, texto) {
      if (PATRON_UNSAFE.test(texto)) informar(nodo);
    }

    /**
     * Criterio 113: la cadena de miembros que parte de `Prisma` o del espacio de nombres `G` y dónde termina. Con `G`, la expresión
     * `G.Prisma` es a su vez el espacio de nombres `Prisma`: tampoco puede quedar suelta.
     */
    function revisarUsoDePrisma(identificador, esEspacioDeNombres) {
      let nodo = identificador;
      let raiz = identificador;
      let raizEsEspacio = esEspacioDeNombres;
      for (;;) {
        const padre = nodo.parent;
        if (padre?.type === 'MemberExpression' && padre.object === nodo) {
          const nombre = padre.computed ? null : nombreDePropiedad(padre);
          if (padre.computed || nombre === null || NOMBRES_DE_LA_CADENA_PROHIBIDOS.has(nombre)) {
            informar(padre, MENSAJE_PRISMA_COMO_VALOR);
            return;
          }
          nodo = padre;
          if (raizEsEspacio && nodo.object === raiz && nombre === 'Prisma') {
            raiz = nodo;
            raizEsEspacio = false;
          }
          continue;
        }
        if (nodo === raiz) {
          // Usado como valor suelto: asignado, pasado, propagado, devuelto, exportado, desestructurado, comparado…
          informar(raiz, MENSAJE_PRISMA_COMO_VALOR);
          return;
        }
        const sigue =
          (padre?.type === 'CallExpression' && padre.callee === nodo) ||
          (padre?.type === 'TaggedTemplateExpression' && padre.tag === nodo) ||
          padre?.type === 'ChainExpression' ||
          padre?.type === 'TSNonNullExpression' ||
          padre?.type === 'TSInstantiationExpression';
        if (sigue) {
          nodo = padre;
          continue;
        }
        // Fin de la cadena: no puede ser argumento de `Reflect.*` ni de las funciones de `Object` que miran el prototipo.
        if (padre?.type === 'CallExpression' && padre.callee !== nodo && padre.callee.type === 'MemberExpression') {
          const dueno = padre.callee.object;
          const funcion = nombreDePropiedad(padre.callee);
          if (
            dueno.type === 'Identifier' &&
            (dueno.name === 'Reflect' || (dueno.name === 'Object' && FUNCIONES_DE_OBJECT_PROHIBIDAS.has(funcion)))
          ) {
            informar(nodo, MENSAJE_PRISMA_COMO_VALOR);
          }
        }
        return;
      }
    }

    /** `require(…)`, `import(…)` e `import x = require(…)` del cliente generado o de `@prisma/…`. */
    function revisarCargaDelCliente(nodo, argumento) {
      const ruta = textoLiteral(argumento);
      if (ruta !== null && esCargaDelCliente(ruta)) informar(nodo, MENSAJE_CARGA_DEL_CLIENTE);
    }

    return {
      Program() {
        // Criterio 113: todo uso de `Prisma` o del espacio de nombres del cliente generado importados como valor.
        const { prismaDelCliente, espaciosDelCliente } = importaciones();
        const variables = [
          ...[...prismaDelCliente].map((variable) => [variable, false]),
          ...[...espaciosDelCliente].map((variable) => [variable, true]),
        ];
        for (const [variable, esEspacio] of variables) {
          for (const referencia of variable.references) {
            // Un uso como tipo (`Prisma.TransactionClient` en una anotación) no es un valor.
            if (referencia.isTypeReference === true && referencia.isValueReference !== true) continue;
            revisarUsoDePrisma(referencia.identifier, esEspacio);
          }
        }
      },
      ImportDeclaration(nodo) {
        for (const especificador of nodo.specifiers) {
          if (especificador.type !== 'ImportSpecifier') continue;
          // `import { Prisma as P }`: `P` también es el espacio de nombres.
          const importado = especificador.imported.name ?? especificador.imported.value;
          if (importado === 'Prisma') nombresDePrisma.add(especificador.local.name);
          if (nodo.importKind === 'type' || especificador.importKind === 'type') continue;
          if (esModuloDePrisma(nodo.source.value) && NOMBRES_DE_IMPORTACION_PROHIBIDOS.has(importado)) {
            informar(especificador);
          }
        }
      },
      ExportNamedDeclaration(nodo) {
        if (!nodo.source || nodo.exportKind === 'type' || !esModuloDePrisma(nodo.source.value)) return;
        for (const especificador of nodo.specifiers) {
          if (especificador.exportKind === 'type') continue;
          const local = especificador.local.name ?? especificador.local.value;
          if (NOMBRES_DE_IMPORTACION_PROHIBIDOS.has(local)) informar(especificador);
        }
      },
      Identifier(nodo) {
        // Los accesos `a.$queryRaw` los revisa `MemberExpression`; aquí, el nombre suelto (desestructuración, parámetros,
        // claves de objetos, variables).
        const padre = nodo.parent;
        if (padre?.type === 'MemberExpression' && padre.property === nodo && !padre.computed) return;
        if (NOMBRES_UNSAFE.has(nodo.name) || NOMBRES_RAW.has(nodo.name)) informar(nodo);
      },
      Literal(nodo) {
        if (typeof nodo.value === 'string') revisarTexto(nodo, nodo.value);
      },
      TemplateLiteral(nodo) {
        for (const quasi of nodo.quasis) revisarTexto(nodo, quasi.value.cooked ?? quasi.value.raw);
      },
      MemberExpression(nodo) {
        const nombre = nombreDePropiedad(nodo);
        if (nombre !== null && NOMBRES_UNSAFE.has(nombre)) {
          informar(nodo);
          return;
        }
        if (nombre !== null && NOMBRES_RAW.has(nombre)) {
          // Solo `x.$queryRaw\`…\`` o `x.$queryRaw(sql\`…\`)` (criterio 112); nunca con corchetes ni guardado, pasado o enlazado.
          const comoEtiqueta = !nodo.computed && esEtiquetaDe(nodo);
          const comoLlamada =
            !nodo.computed &&
            esLlamadoDe(nodo) &&
            nodo.parent.arguments.length === 1 &&
            esPlantillaAutorizada(nodo.parent.arguments[0]);
          if (!comoEtiqueta && !comoLlamada) informar(nodo);
          return;
        }
        if (nombre === 'sql' && esEspacioDelPunto(nodo.object)) {
          // `bd.sql` (del punto autorizado) solo como etiqueta.
          if (!esEtiquetaDe(nodo)) informar(nodo);
          return;
        }
        if (esPrisma(nodo.object)) {
          if (nombre === 'sql') {
            // `Prisma.sql` solo como etiqueta.
            if (!esEtiquetaDe(nodo)) informar(nodo);
          } else if (nombre === 'raw' || nombre === 'Sql') {
            informar(nodo);
          } else if (nombre === 'join') {
            const argumentos = esLlamadoDe(nodo) ? nodo.parent.arguments : null;
            if (!argumentos || argumentos.length !== 1 || argumentos[0].type === 'SpreadElement') informar(nodo);
          }
        }
      },
      CallExpression(nodo) {
        // `sql(…)` llamado como función, con ese nombre o con un alias de la `sql` del punto autorizado.
        if (nodo.callee.type === 'Identifier' && (nodo.callee.name === 'sql' || esSqlImportada(nodo.callee))) {
          informar(nodo.callee);
        }
        // `require(…)` del cliente generado o de @prisma/…
        if (nodo.callee.type === 'Identifier' && nodo.callee.name === 'require') {
          revisarCargaDelCliente(nodo, nodo.arguments[0]);
        }
      },
      ImportExpression(nodo) {
        revisarCargaDelCliente(nodo, nodo.source);
      },
      TSImportEqualsDeclaration(nodo) {
        const referencia = nodo.moduleReference;
        if (referencia.type !== 'TSExternalModuleReference' || nodo.importKind === 'type') return;
        revisarCargaDelCliente(nodo, referencia.expression);
      },
      VariableDeclarator(nodo) {
        // `const { raw, Sql, join } = Prisma`
        if (nodo.id.type !== 'ObjectPattern' || !nodo.init || !esPrisma(nodo.init)) return;
        for (const propiedad of nodo.id.properties) {
          if (propiedad.type !== 'Property' || propiedad.computed) {
            informar(propiedad);
            continue;
          }
          const clave = propiedad.key.name ?? propiedad.key.value;
          if (NOMBRES_DE_IMPORTACION_PROHIBIDOS.has(clave)) informar(propiedad);
        }
      },
    };
  },
};

export { reglaFormasDeSql };
