// Regla de formas del SQL (spec 001, criterio 92, ataque ronda 3): el SQL solo llega a la base en plantillas etiquetadas.
// En `backend/src/`, fuera de `infraestructura/prisma/` y de las pruebas (también en `cli/`), falla el lint si:
//   - se nombra `$queryRawUnsafe` o `$executeRawUnsafe` de cualquier forma (acceso con punto, con corchetes y un literal,
//     desestructuración, o una cadena o plantilla cuyo texto los contiene);
//   - `$queryRaw` o `$executeRaw` se usan de otra forma que como etiqueta directa de una plantilla o como llamada cuyo único
//     argumento es una plantilla etiquetada con `Prisma.sql` o `sql`;
//   - `Prisma.sql` o `sql` se llaman como función en lugar de usarse como etiqueta;
//   - se usa como valor `Prisma.raw`, `Prisma.Sql` o `Prisma.join` con más de un argumento, o se importan `raw`, `join` o `Sql`
//     de `generated/prisma` o de `@prisma/…` (con cualquier alias). `Prisma.Sql` como tipo sigue permitido.
// La regla que analiza el texto de las plantillas (SQL de sesión) está en `regla-sql-sesion.mjs`.

export const MENSAJE_FORMAS_DE_SQL =
  'El SQL solo llega a la base en plantillas etiquetadas: usa tx.cliente.$queryRaw`…`, tx.cliente.$executeRaw`…` o ' +
  'Prisma.sql`…` con valores interpolados con ${…}. No uses $queryRawUnsafe ni $executeRawUnsafe, no guardes ni pases ' +
  '$queryRaw/$executeRaw como valores, no llames a Prisma.sql como función y no uses Prisma.raw, Prisma.Sql como valor ni ' +
  'Prisma.join con separador.';

const NOMBRES_UNSAFE = new Set(['$queryRawUnsafe', '$executeRawUnsafe']);
const NOMBRES_RAW = new Set(['$queryRaw', '$executeRaw']);
const NOMBRES_DE_IMPORTACION_PROHIBIDOS = new Set(['raw', 'join', 'Sql']);
const PATRON_UNSAFE = /\$(?:query|execute)RawUnsafe/;

/** Nombre de la propiedad de un acceso `a.b` o `a['b']` (con un literal); `null` si no se puede saber. */
function nombreDePropiedad(acceso) {
  const propiedad = acceso.property;
  if (!acceso.computed) return propiedad.type === 'Identifier' ? propiedad.name : null;
  if (propiedad.type === 'Literal' && typeof propiedad.value === 'string') return propiedad.value;
  if (propiedad.type === 'TemplateLiteral' && propiedad.expressions.length === 0) {
    return propiedad.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** ¿El módulo es el cliente generado o un paquete de Prisma, por cualquier ruta? */
function esModuloDePrisma(ruta) {
  const limpia = String(ruta).replaceAll('\\', '/');
  return limpia.includes('generated/prisma') || /(?:^|\/)@prisma\//.test(limpia) || /(?:^|\/)\.prisma\//.test(limpia);
}

const reglaFormasDeSql = {
  meta: { type: 'problem', schema: [], messages: { forma: '{{ mensaje }}' } },
  create(context) {
    const informar = (nodo) =>
      context.report({ node: nodo, messageId: 'forma', data: { mensaje: MENSAJE_FORMAS_DE_SQL } });
    /** Nombres locales de `Prisma` (`import { Prisma as P }`). */
    const nombresDePrisma = new Set(['Prisma']);

    /** ¿Es el espacio de nombres `Prisma` (o un alias, o `<algo>.Prisma`)? */
    const esPrisma = (nodo) =>
      (nodo.type === 'Identifier' && nombresDePrisma.has(nodo.name)) ||
      (nodo.type === 'MemberExpression' && nombreDePropiedad(nodo) === 'Prisma');

    /** `Prisma.<nombre>` */
    const esDePrisma = (nodo, nombre) =>
      nodo.type === 'MemberExpression' && esPrisma(nodo.object) && nombreDePropiedad(nodo) === nombre;

    const esPlantillaDeSql = (nodo) =>
      nodo?.type === 'TaggedTemplateExpression' &&
      ((nodo.tag.type === 'Identifier' && nodo.tag.name === 'sql') || esDePrisma(nodo.tag, 'sql'));

    const esEtiquetaDe = (nodo) => nodo.parent?.type === 'TaggedTemplateExpression' && nodo.parent.tag === nodo;
    const esLlamadoDe = (nodo) => nodo.parent?.type === 'CallExpression' && nodo.parent.callee === nodo;

    /** Mira el texto de una cadena o plantilla que nombra un método sin plantilla. */
    function revisarTexto(nodo, texto) {
      if (PATRON_UNSAFE.test(texto)) informar(nodo);
    }

    return {
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
          // Solo `x.$queryRaw\`…\`` o `x.$queryRaw(Prisma.sql\`…\`)`; nunca con corchetes ni guardado, pasado o enlazado.
          const comoEtiqueta = !nodo.computed && esEtiquetaDe(nodo);
          const comoLlamada =
            !nodo.computed &&
            esLlamadoDe(nodo) &&
            nodo.parent.arguments.length === 1 &&
            esPlantillaDeSql(nodo.parent.arguments[0]);
          if (!comoEtiqueta && !comoLlamada) informar(nodo);
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
        // `sql(…)` llamado como función.
        if (nodo.callee.type === 'Identifier' && nodo.callee.name === 'sql') informar(nodo.callee);
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
