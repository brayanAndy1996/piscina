// Regla de promesas descartadas (spec 001, criterio 159, P-41): en `backend/src`, una promesa no se descarta. Una consulta que
// falla después de que `trabajo` terminó, dentro de una función `async` lanzada con `void`, no la ve nadie: nada marca la
// transacción y se confirma lo anterior sin la auditoría (RN-22).
//
// Dos garantías:
//   - esta regla propia, SIN información de tipos (por eso va también en el paso protegido, donde ningún comentario la apaga):
//     falla con (i) todo operador `void`, salvo `void 0`; y (ii) una sentencia que es la llamada directa a una función `async`
//     escrita en el lugar, sin `await` (`(async () => { … })();`, también con `?.()`);
//   - `@typescript-eslint/no-floating-promises` CON tipos, en el lint normal y solo en `backend/src` (opciones más estrictas
//     que las de `recommendedTypeChecked`: sin excepción para `void` ni para las funciones invocadas en el lugar).
import { ARCHIVOS_DE_CODIGO, EXENCION_CLIENTE_GENERADO, EXENCION_PRUEBAS } from './archivos-de-codigo.mjs';

const esAsyncEnElLugar = (nodo) =>
  (nodo.type === 'ArrowFunctionExpression' || nodo.type === 'FunctionExpression') && nodo.async === true;

export const reglaSinPromesasDescartadas = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      void: 'No descartes promesas con void en backend/src: usa await o atrapa el rechazo con .catch (spec 001, criterio 159).',
      enElLugar:
        'Una función async escrita en el lugar se espera con await o se atrapa con .catch (spec 001, criterio 159).',
    },
  },
  create: (context) => ({
    UnaryExpression(nodo) {
      if (nodo.operator !== 'void') return;
      if (nodo.argument.type === 'Literal' && nodo.argument.value === 0) return;
      context.report({ node: nodo, messageId: 'void' });
    },
    ExpressionStatement(nodo) {
      const expresion = nodo.expression.type === 'ChainExpression' ? nodo.expression.expression : nodo.expression;
      if (expresion.type === 'CallExpression' && esAsyncEnElLugar(expresion.callee)) {
        context.report({ node: nodo, messageId: 'enElLugar' });
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
