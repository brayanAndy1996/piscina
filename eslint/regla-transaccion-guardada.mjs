// Regla de la transacción guardada (spec 001, criterio 135, ataque ronda 6; complementa el criterio 134). Un servicio de Nest es una
// sola instancia para todas las peticiones: guardar la transacción en un campo (`this.tx = tx`) o en una variable del módulo deja que
// otra petición la use mientras sigue abierta. El envoltorio ya lo rechaza en ejecución (criterio 134); esta regla lo señala al
// escribir el código. En `backend/src/` (sin las pruebas y sin el cliente generado), regla `aquagestion/sin-transaccion-guardada`:
//   - falla una asignación (`=`, `??=`, `||=` o `&&=`) a una propiedad de `this` (`this.x`, `this.#x`, `this.a.b`, `this[x]`), a una
//     variable declarada en el nivel del módulo (o global) o a una propiedad de ella, cuyo valor, quitando `as`, `satisfies`, `!` y
//     paréntesis, es: un identificador que ESLint resuelve (por ámbito) a un parámetro, o a una propiedad desestructurada de un
//     parámetro, de una función pasada como `trabajo` a `<algo>.conAcademia(id, trabajo)` o `<algo>.comoPlataforma(trabajo)`; un
//     identificador declarado con una anotación de tipo `TransaccionAcademia`, `TransaccionPlataforma` o `ClienteTransaccion` (también
//     calificada, `X.TransaccionAcademia`); o un acceso `.cliente` sobre uno de esos. También falla una propiedad de parámetro de
//     constructor (`constructor(private tx: TransaccionAcademia)`), que es esa misma asignación a `this`.
//   - fuera de `backend/src/infraestructura/`, falla cualquier importación de `async_hooks` o `node:async_hooks` (por las vías del
//     criterio 85): `AsyncLocalStorage.snapshot()` o `AsyncResource.bind` guardados dentro de `trabajo` y ejecutados desde otra petición
//     llevarían el contexto de la transacción.
//   - fuera de `backend/src/infraestructura/` (criterio 139, ataque ronda 7), falla toda aparición del nombre
//     `EventEmitterAsyncResource` (importado con o sin alias, reexportado, propiedad con punto o calculada con un literal o una
//     plantilla sin marcadores, clave de desestructuración, `extends` o identificador propio): sus listeners corren en el contexto
//     asíncrono donde se creó el emisor. Y falla toda aparición de `getBuiltinModule` (carga `async_hooks` sin importarlo) salvo la
//     llamada directa `<objeto>.getBuiltinModule('<literal>')` con un literal de cadena distinto de `async_hooks` y `node:async_hooks`.
// No se siguen las copias por alias (`const t = tx; this.x = t`), `Object.assign(this, { tx })` ni una transacción guardada dentro de un
// arreglo o de una función: esa garantía es el criterio 134. La propiedad desestructurada `academiaId` es un dato (un texto), no la
// transacción, y no cuenta. Va en el lint normal (`eslint.config.mjs`), no en el paso protegido: un comentario `eslint-disable` la apaga.
import {
  ARCHIVOS_DE_CODIGO,
  EXENCION_CLIENTE_GENERADO,
  EXENCION_PRUEBAS,
  contextoDeArchivo,
} from './archivos-de-codigo.mjs';
import { variableDe } from './ayuda-ambito.mjs';

export const MENSAJE_TRANSACCION_GUARDADA =
  'No guardes la transacción (ni su cliente) en this ni en una variable del módulo: un servicio es una sola instancia para todas las ' +
  'peticiones y otra petición podría usar la transacción de esta academia mientras sigue abierta. Pásala como parámetro a las ' +
  'funciones que la necesitan, dentro de trabajo.';

export const MENSAJE_ASYNC_HOOKS =
  'Fuera de infraestructura/ no se importa async_hooks: AsyncLocalStorage.snapshot() o AsyncResource.bind guardados dentro de trabajo y ' +
  'ejecutados desde otra petición llevarían el contexto de la transacción de esta academia.';

export const MENSAJE_EMISOR_ASINCRONO =
  'No uses EventEmitterAsyncResource ni cargues async_hooks fuera de infraestructura/: conservan el contexto de una transacción y otra ' +
  'petición podría usarla (criterios 134 y 139).';

const NOMBRE_EMISOR_ASINCRONO = 'EventEmitterAsyncResource';
const NOMBRE_CARGA_DE_MODULO = 'getBuiltinModule';

/** Tipos de la transacción (spec 001, P-2): una variable anotada con alguno de ellos es una transacción. */
const TIPOS_DE_TRANSACCION = new Set(['TransaccionAcademia', 'TransaccionPlataforma', 'ClienteTransaccion']);

/** Operadores de asignación que guardan el valor de la derecha (`+=` y similares no). */
const OPERADORES = new Set(['=', '??=', '||=', '&&=']);

/** Propiedad desestructurada de un parámetro de `trabajo` que es un dato y no la transacción. */
const PROPIEDAD_DE_DATO = 'academiaId';

const ENVOLTURAS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'ChainExpression',
]);

/** Quita `as`, `satisfies`, `!`, `<T>x` y la cadena opcional (los paréntesis no existen en el árbol). */
function sinEnvolturas(nodo) {
  let actual = nodo;
  while (actual && ENVOLTURAS.has(actual.type)) actual = actual.expression;
  return actual;
}

/** Nombre de una propiedad de acceso con punto o con una cadena literal; `null` si el acceso es calculado. */
function nombreDePropiedad(acceso) {
  if (!acceso.computed) return acceso.property.type === 'Identifier' ? acceso.property.name : null;
  return acceso.property.type === 'Literal' && typeof acceso.property.value === 'string' ? acceso.property.value : null;
}

/** Nombre del tipo de una anotación (`TransaccionAcademia` o `X.TransaccionAcademia`); `null` si no es una referencia a un tipo. */
function nombreDelTipo(anotacion) {
  const tipo = anotacion?.typeAnnotation;
  if (tipo?.type !== 'TSTypeReference') return null;
  const nombre = tipo.typeName;
  if (nombre.type === 'Identifier') return nombre.name;
  if (nombre.type === 'TSQualifiedName') return nombre.right.name;
  return null;
}

/** ¿La función es el argumento `trabajo` de `<algo>.conAcademia(id, trabajo)` o `<algo>.comoPlataforma(trabajo)`? */
function esTrabajoDeTransaccion(funcion) {
  let llamada = funcion.parent;
  // `await`, paréntesis o `as` no envuelven al argumento en el árbol, pero `conAcademia(id, (async (tx) => …) as X)` sí.
  while (llamada && ENVOLTURAS.has(llamada.type)) llamada = llamada.parent;
  if (llamada?.type !== 'CallExpression') return false;
  const destino = sinEnvolturas(llamada.callee);
  if (destino?.type !== 'MemberExpression') return false;
  const nombre = nombreDePropiedad(destino);
  const posicion = nombre === 'conAcademia' ? 1 : nombre === 'comoPlataforma' ? 0 : -1;
  if (posicion === -1) return false;
  const argumento = llamada.arguments[posicion];
  return argumento !== undefined && sinEnvolturas(argumento) === funcion;
}

/** ¿La definición es un parámetro de una función `trabajo` (o una propiedad desestructurada de uno) que no sea un dato? */
function esParametroDeTrabajo(definicion) {
  if (definicion.type !== 'Parameter') return false;
  const funcion = definicion.node;
  if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(funcion.type)) return false;
  if (!esTrabajoDeTransaccion(funcion)) return false;
  const padre = definicion.name.parent;
  if (padre?.type === 'Property' && padre.value === definicion.name && !padre.computed) {
    const clave = padre.key;
    if (clave.type === 'Identifier' && clave.name === PROPIEDAD_DE_DATO) return false;
  }
  return true;
}

/** ¿La definición declara el identificador con una anotación de tipo de transacción? */
function estaAnotadaComoTransaccion(definicion) {
  return TIPOS_DE_TRANSACCION.has(nombreDelTipo(definicion.name?.typeAnnotation));
}

const esquema = [];

const reglaTransaccionGuardada = {
  meta: {
    type: 'problem',
    schema: esquema,
    messages: { guardada: '{{ mensaje }}' },
  },
  create(context) {
    const { archivoComparable, raiz } = contextoDeArchivo(context);
    const carpetaInfraestructura = `${raiz}/backend/src/infraestructura`;
    const enInfraestructura =
      archivoComparable === carpetaInfraestructura || archivoComparable.startsWith(`${carpetaInfraestructura}/`);

    const informar = (nodo, mensaje) => context.report({ node: nodo, messageId: 'guardada', data: { mensaje } });

    /** ¿El identificador se resuelve a un parámetro de `trabajo` o a una variable anotada como transacción? */
    function esTransaccion(identificador) {
      const variable = variableDe(context, identificador);
      if (!variable) return false;
      return variable.defs.some(
        (definicion) => esParametroDeTrabajo(definicion) || estaAnotadaComoTransaccion(definicion),
      );
    }

    /** ¿El valor es una transacción, o su `.cliente`? */
    function valorEsTransaccion(valor) {
      const nodo = sinEnvolturas(valor);
      if (!nodo) return false;
      if (nodo.type === 'Identifier') return esTransaccion(nodo);
      if (nodo.type === 'MemberExpression' && nombreDePropiedad(nodo) === 'cliente') {
        const objeto = sinEnvolturas(nodo.object);
        return objeto?.type === 'Identifier' && esTransaccion(objeto);
      }
      return false;
    }

    /** ¿El destino es una propiedad de `this`, o una variable del nivel del módulo (o global) o una propiedad de ella? */
    function destinoPersistente(izquierda) {
      let actual = sinEnvolturas(izquierda);
      while (actual?.type === 'MemberExpression') actual = sinEnvolturas(actual.object);
      if (actual?.type === 'ThisExpression') return true;
      if (actual?.type !== 'Identifier') return false;
      const variable = variableDe(context, actual);
      // Sin declaración (un global implícito) cuenta como del nivel del módulo.
      return !variable || variable.scope.type === 'module' || variable.scope.type === 'global';
    }

    /** Importación de `async_hooks` por cualquiera de las vías del criterio 85. */
    function revisarModulo(nodo, ruta) {
      if (enInfraestructura) return;
      if (ruta === 'async_hooks' || ruta === 'node:async_hooks') informar(nodo, MENSAJE_ASYNC_HOOKS);
    }

    /** Texto de un argumento si es una cadena literal o una plantilla sin `${}`; `null` si no. */
    function textoLiteral(nodo) {
      if (!nodo) return null;
      if (nodo.type === 'Literal' && typeof nodo.value === 'string') return nodo.value;
      if (nodo.type === 'TemplateLiteral' && nodo.expressions.length === 0) return nodo.quasis[0]?.value.cooked ?? '';
      return null;
    }

    /** Texto de una clave de propiedad o nombre exportado si es un identificador (sin corchetes) o un literal; `null` si no. */
    function nombreDeClave(nodo, calculada) {
      if (!nodo) return null;
      if (nodo.type === 'Identifier') return calculada ? null : nodo.name;
      return textoLiteral(nodo);
    }

    /** ¿El nodo es el `callee` (la propiedad) de una llamada directa con un literal de cadena que no sea `async_hooks`? */
    function esCargaPermitida(acceso) {
      const llamada = acceso.parent;
      if (llamada?.type !== 'CallExpression' || llamada.callee !== acceso) return false;
      const ruta = textoLiteral(llamada.arguments[0]);
      return ruta !== null && ruta !== 'async_hooks' && ruta !== 'node:async_hooks';
    }

    /** Informa el nombre prohibido (criterio 139); `acceso` es el `MemberExpression` si el nombre es su propiedad. */
    function revisarNombre(nodo, nombre, acceso) {
      if (enInfraestructura || nombre === null) return;
      if (nombre === NOMBRE_EMISOR_ASINCRONO) informar(nodo, MENSAJE_EMISOR_ASINCRONO);
      else if (nombre === NOMBRE_CARGA_DE_MODULO && !(acceso && esCargaPermitida(acceso)))
        informar(nodo, MENSAJE_EMISOR_ASINCRONO);
    }

    return {
      // Identificadores en cualquier posición: importado/local, reexportado, propiedad con punto, clave de patrón, `extends`, declarado.
      Identifier(nodo) {
        const padre = nodo.parent;
        // Un miembro de un tipo (`{ getBuiltinModule(n: string): unknown }`) solo describe una forma, no carga nada.
        if (['TSMethodSignature', 'TSPropertySignature'].includes(padre?.type) && padre.key === nodo) return;
        const acceso =
          padre?.type === 'MemberExpression' && padre.property === nodo && !padre.computed ? padre : undefined;
        revisarNombre(nodo, nodo.name, acceso);
      },
      // Propiedad calculada con un literal o una plantilla sin marcadores: `x['EventEmitterAsyncResource']`.
      MemberExpression(nodo) {
        if (!nodo.computed || nodo.property.type === 'Identifier') return;
        revisarNombre(nodo.property, textoLiteral(nodo.property), nodo);
      },
      // Nombres con cadena: `{ 'EventEmitterAsyncResource': E } = x`, `import { 'X' as y }`, `export { 'X' } from`.
      Property(nodo) {
        if (nodo.key.type === 'Identifier') return;
        revisarNombre(nodo.key, nombreDeClave(nodo.key, nodo.computed), undefined);
      },
      ImportSpecifier(nodo) {
        if (nodo.imported.type !== 'Identifier') revisarNombre(nodo.imported, textoLiteral(nodo.imported), undefined);
      },
      ExportSpecifier(nodo) {
        for (const lado of [nodo.local, nodo.exported]) {
          if (lado.type !== 'Identifier') revisarNombre(lado, textoLiteral(lado), undefined);
        }
      },
      AssignmentExpression(nodo) {
        if (!OPERADORES.has(nodo.operator)) return;
        if (!destinoPersistente(nodo.left)) return;
        if (valorEsTransaccion(nodo.right)) informar(nodo, MENSAJE_TRANSACCION_GUARDADA);
      },
      // `constructor(private tx: TransaccionAcademia)` asigna el parámetro a `this.tx`.
      TSParameterProperty(nodo) {
        const parametro = nodo.parameter.type === 'AssignmentPattern' ? nodo.parameter.left : nodo.parameter;
        if (parametro.type === 'Identifier' && TIPOS_DE_TRANSACCION.has(nombreDelTipo(parametro.typeAnnotation))) {
          informar(nodo, MENSAJE_TRANSACCION_GUARDADA);
        }
      },
      ImportDeclaration(nodo) {
        if (nodo.importKind === 'type') return;
        if (nodo.specifiers.length > 0 && nodo.specifiers.every((especificador) => especificador.importKind === 'type'))
          return;
        revisarModulo(nodo, String(nodo.source.value));
      },
      ExportNamedDeclaration(nodo) {
        if (!nodo.source || nodo.exportKind === 'type') return;
        revisarModulo(nodo, String(nodo.source.value));
      },
      ExportAllDeclaration(nodo) {
        if (!nodo.source || nodo.exportKind === 'type') return;
        revisarModulo(nodo, String(nodo.source.value));
      },
      ImportExpression(nodo) {
        const ruta = textoLiteral(nodo.source);
        if (ruta !== null) revisarModulo(nodo, ruta);
      },
      CallExpression(nodo) {
        if (nodo.callee.type !== 'Identifier' || nodo.callee.name !== 'require') return;
        const ruta = textoLiteral(nodo.arguments[0]);
        if (ruta !== null) revisarModulo(nodo, ruta);
      },
      TSImportEqualsDeclaration(nodo) {
        const referencia = nodo.moduleReference;
        if (referencia.type !== 'TSExternalModuleReference' || nodo.importKind === 'type') return;
        const ruta = textoLiteral(referencia.expression);
        if (ruta !== null) revisarModulo(nodo, ruta);
      },
    };
  },
};

export const pluginTransaccionGuardada = {
  meta: { name: 'aquagestion' },
  rules: { 'sin-transaccion-guardada': reglaTransaccionGuardada },
};

/** Archivos a los que se aplica la regla: el código de `backend/src/`, sin las pruebas ni el cliente generado (criterio 110). */
export const archivosConReglaTransaccionGuardada = ARCHIVOS_DE_CODIGO;

/** Exentos: el cliente generado y las pruebas (solo `.test.<ts|mts|cts|js|mjs|cjs>`; criterios 110 y 118). */
export const archivosExentosTransaccionGuardada = [EXENCION_CLIENTE_GENERADO, EXENCION_PRUEBAS];

/** Bloque de configuración plana para `eslint.config.mjs` (el lint normal; no va en el paso protegido). */
export const configuracionTransaccionGuardada = {
  name: 'aquagestion/regla-transaccion-guardada',
  files: archivosConReglaTransaccionGuardada,
  ignores: archivosExentosTransaccionGuardada,
  plugins: { aquagestion: pluginTransaccionGuardada },
  rules: { 'aquagestion/sin-transaccion-guardada': 'error' },
};
