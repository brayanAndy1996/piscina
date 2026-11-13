// Regla de promesas descartadas (spec 001, criterio 159, P-41): en `backend/src`, una promesa no se descarta. Una consulta que
// falla después de que `trabajo` terminó, dentro de una función `async` lanzada con `void`, no la ve nadie: nada marca la
// transacción y se confirma lo anterior sin la auditoría (RN-22).
//
// Dos garantías:
//   - esta regla propia, SIN información de tipos (por eso va también en el paso protegido, donde ningún comentario la apaga):
//     falla con (i) todo operador `void`, salvo `void 0`; (ii) una sentencia que es la llamada directa a una función `async`
//     escrita en el lugar, sin `await` (`(async () => { … })();`, también con `?.()`); y (iii) (criterio 164) una llamada a
//     `nextTick`, `setImmediate`, `setTimeout`, `setInterval` o `queueMicrotask` con una función `async` escrita en el lugar
//     como argumento. En (ii) y (iii) se miran a través de los envoltorios de tipos de TypeScript (`as`, `satisfies`, `!`, `<T>`);
//   - `@typescript-eslint/no-floating-promises` CON tipos, en el lint normal y solo en `backend/src` (opciones más estrictas
//     que las de `recommendedTypeChecked`: sin excepción para `void` ni para las funciones invocadas en el lugar).
import { ARCHIVOS_DE_CODIGO, EXENCION_CLIENTE_GENERADO, EXENCION_PRUEBAS } from './archivos-de-codigo.mjs';

const ENVOLTORIOS_DE_TIPOS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
]);
const FUNCIONES_DIFERIDAS = new Set(['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask']);

/** Quita los envoltorios de tipos (también anidados); los paréntesis no forman nodo. Con `cadena`, también las cadenas opcionales. */
const sinEnvoltorios = (nodo, cadena = false) => {
  let actual = nodo;
  while (actual && (ENVOLTORIOS_DE_TIPOS.has(actual.type) || (cadena && actual.type === 'ChainExpression'))) {
    actual = actual.expression;
  }
  return actual;
};

const esAsyncEnElLugar = (nodo) => {
  const sin = sinEnvoltorios(nodo);
  return (
    sin !== undefined &&
    (sin.type === 'ArrowFunctionExpression' || sin.type === 'FunctionExpression') &&
    sin.async === true
  );
};

/** El nombre de la propiedad de un acceso a miembro: con punto, o con corchetes y una cadena o plantilla sin expresiones. */
const nombreDePropiedad = (miembro) => {
  if (!miembro.computed) return miembro.property.type === 'Identifier' ? miembro.property.name : undefined;
  const propiedad = sinEnvoltorios(miembro.property);
  if (propiedad.type === 'Literal' && typeof propiedad.value === 'string') return propiedad.value;
  if (propiedad.type === 'TemplateLiteral' && propiedad.expressions.length === 0) {
    return propiedad.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
};

/** ¿La llamada es a una de las funciones que difieren trabajo (por el nombre del identificador o de la propiedad)? */
const llamaAFuncionDiferida = (llamada) => {
  const funcion = sinEnvoltorios(llamada.callee, true);
  if (funcion.type === 'Identifier') return FUNCIONES_DIFERIDAS.has(funcion.name);
  if (funcion.type === 'MemberExpression') return FUNCIONES_DIFERIDAS.has(nombreDePropiedad(funcion));
  return false;
};

export const reglaSinPromesasDescartadas = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      void: 'No descartes promesas con void en backend/src: usa await o atrapa el rechazo con .catch (spec 001, criterio 159).',
      enElLugar:
        'Una función async escrita en el lugar se espera con await o se atrapa con .catch (spec 001, criterio 159).',
      diferida:
        'No pases una función async a nextTick, setImmediate, setTimeout, setInterval ni queueMicrotask: espera la operación con await dentro de trabajo o haz el trabajo diferido después de confirmar la transacción (spec 001, criterio 164).',
    },
  },
  create: (context) => ({
    UnaryExpression(nodo) {
      if (nodo.operator !== 'void') return;
      if (nodo.argument.type === 'Literal' && nodo.argument.value === 0) return;
      context.report({ node: nodo, messageId: 'void' });
    },
    ExpressionStatement(nodo) {
      const expresion = sinEnvoltorios(nodo.expression, true);
      if (expresion.type === 'CallExpression' && esAsyncEnElLugar(sinEnvoltorios(expresion.callee, true))) {
        context.report({ node: nodo, messageId: 'enElLugar' });
      }
    },
    CallExpression(nodo) {
      if (!llamaAFuncionDiferida(nodo)) return;
      if (nodo.arguments.some((argumento) => esAsyncEnElLugar(argumento))) {
        context.report({ node: nodo, messageId: 'diferida' });
      }
    },
  }),
};

export const pluginPromesas = {
  meta: { name: 'aquagestion-promesas' },
  rules: { 'sin-promesas-descartadas': reglaSinPromesasDescartadas },
};

/** Los dos pasos (normal y protegido): sin información de tipos. */
export const configuracionPromesasDescartadas = {
  name: 'aquagestion/promesas-descartadas',
  files: ARCHIVOS_DE_CODIGO,
  ignores: [EXENCION_PRUEBAS, EXENCION_CLIENTE_GENERADO],
  plugins: { 'aquagestion-promesas': pluginPromesas },
  rules: { 'aquagestion-promesas/sin-promesas-descartadas': 'error' },
};

/** Solo el lint normal: con información de tipos (el bloque `aquagestion/typescript` ya activa el analizador con tipos). */
export const configuracionPromesasConTipos = {
  name: 'aquagestion/promesas-con-tipos',
  files: ['backend/src/**/*.{ts,tsx}'],
  ignores: [EXENCION_PRUEBAS, EXENCION_CLIENTE_GENERADO],
  rules: {
    '@typescript-eslint/no-floating-promises': [
      'error',
      { ignoreVoid: false, ignoreIIFE: false, checkThenables: true },
    ],
  },
};
