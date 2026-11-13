// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { cumpleFormaDeAcademia, problemasDeLaPolitica, terminosDeConjuncion } from './politicas';

// Criterio 132 (ataque ronda 6, F2 (a)), precision P-33: el lector de las expresiones de las politicas. Lo que escribe PostgreSQL con
// `pg_get_expr` y `search_path = pg_catalog, public` es, por ejemplo, `(academia_id = app_academia_actual())` y
// `((academia_id = app_academia_actual()) AND (clave <> 'x'::text))`. Pruebas unitarias, sin base de datos.
// Criterio 140 (ataque ronda 7, O5; precision P-33, ronda 7): el lado de la funcion de la comparacion puede ser tambien la subconsulta
// escalar que solo selecciona la funcion, `(SELECT app_academia_actual())` (`pg_get_expr` la escribe `( SELECT app_academia_actual() AS
// app_academia_actual)`); los casos nuevos estan marcados "criterio 140". Los casos de antes no cambian de resultado.

/** Quita los parentesis que encierran toda la expresion (solo para comparar los terminos en estas pruebas). */
function sinParentesis(texto: string): string {
  let actual = texto.trim();
  while (actual.startsWith('(') && actual.endsWith(')')) {
    let profundidad = 0;
    let cierraAlFinal = true;
    for (let i = 0; i < actual.length; i++) {
      if (actual.charAt(i) === '(') profundidad++;
      else if (actual.charAt(i) === ')') profundidad--;
      if (profundidad === 0 && i < actual.length - 1) {
        cierraAlFinal = false;
        break;
      }
    }
    if (!cierraAlFinal) break;
    actual = actual.slice(1, -1).trim();
  }
  return actual;
}
const limpios = (expresion: string): string[] => terminosDeConjuncion(expresion).map(sinParentesis);

describe('criterio 132 (P-33): terminosDeConjuncion', () => {
  it('criterio 132: una comparacion sola es un solo termino, con o sin parentesis exteriores', () => {
    expect(limpios('(academia_id = app_academia_actual())')).toEqual(['academia_id = app_academia_actual()']);
    expect(limpios('academia_id = app_academia_actual()')).toEqual(['academia_id = app_academia_actual()']);
    expect(limpios('((academia_id = app_academia_actual()))')).toEqual(['academia_id = app_academia_actual()']);
  });

  it('criterio 132: una conjuncion se separa por los AND de primer nivel', () => {
    expect(limpios("((academia_id = app_academia_actual()) AND (clave <> 'x'::text))")).toEqual([
      'academia_id = app_academia_actual()',
      "clave <> 'x'::text",
    ]);
    expect(limpios('a = 1 AND b = 2 AND c = 3')).toEqual(['a = 1', 'b = 2', 'c = 3']);
  });

  it('criterio 132: una conjuncion anidada, a AND (b AND c), se aplana', () => {
    expect(
      limpios("((clave <> 'x'::text) AND ((academia_id = app_academia_actual()) AND (valor IS NOT NULL)))"),
    ).toEqual(["clave <> 'x'::text", 'academia_id = app_academia_actual()', 'valor IS NOT NULL']);
  });

  it('criterio 132: un AND dentro de un OR, de un NOT, de un CASE o de una subconsulta no es de primer nivel', () => {
    expect(terminosDeConjuncion('((a = 1) AND (b = 2)) OR (c = 3)')).toHaveLength(1);
    expect(terminosDeConjuncion('(NOT ((a = 1) AND (b = 2)))')).toHaveLength(1);
    expect(terminosDeConjuncion('(CASE WHEN ((a = 1) AND (b = 2)) THEN true ELSE false END)')).toHaveLength(1);
    expect(
      terminosDeConjuncion(
        '(EXISTS ( SELECT 1 FROM auditoria a WHERE ((a.x = 1) AND (a.academia_id = app_academia_actual()))))',
      ),
    ).toHaveLength(1);
  });

  it('criterio 132: con un OR de primer nivel el texto entero es un solo termino (OR tiene menos precedencia que AND)', () => {
    expect(terminosDeConjuncion('a = 1 AND b = 2 OR c = 3')).toHaveLength(1);
    expect(terminosDeConjuncion('a = 1 OR b = 2 AND c = 3')).toHaveLength(1);
    expect(terminosDeConjuncion('(a = 1 AND b = 2 OR c = 3)')).toHaveLength(1);
    expect(limpios('x = 0 AND (a = 1 AND b = 2 OR c = 3)')).toEqual(['x = 0', 'a = 1 AND b = 2 OR c = 3']);
  });

  it('criterio 132: un AND dentro de una cadena o de un identificador entre comillas no separa', () => {
    expect(terminosDeConjuncion("(clave = 'a AND b'::text)")).toHaveLength(1);
    expect(terminosDeConjuncion('("A AND B" = 1)')).toHaveLength(1);
    expect(terminosDeConjuncion("((clave = 'it''s AND ('::text) AND (b = 2))")).toHaveLength(2);
  });

  it('criterio 132: AND como parte de un identificador (BRAND, ANDES) no separa', () => {
    expect(terminosDeConjuncion('(BRAND = 1)')).toHaveLength(1);
    expect(terminosDeConjuncion('(ANDES = ANDROIDE)')).toHaveLength(1);
  });
});

describe('criterio 132 (P-33): cumpleFormaDeAcademia', () => {
  it.each([
    ['la comparacion con parentesis, como la escribe pg_get_expr', '(academia_id = app_academia_actual())'],
    ['la comparacion sin parentesis', 'academia_id = app_academia_actual()'],
    ['la comparacion en el otro orden', '(app_academia_actual() = academia_id)'],
    ['con public. delante de la funcion', '(public.app_academia_actual() = academia_id)'],
    ['con public. y la columna a la izquierda', '(academia_id = public.app_academia_actual())'],
    ['con parentesis de mas', '(((academia_id = app_academia_actual())))'],
    ['una conjuncion con otra condicion', "((academia_id = app_academia_actual()) AND (clave <> 'x'::text))"],
    ['una conjuncion con la comparacion al final', "((clave <> 'x'::text) AND (academia_id = app_academia_actual()))"],
    [
      'una conjuncion anidada, a AND (b AND c)',
      "((clave <> 'x'::text) AND ((academia_id = app_academia_actual()) AND (valor IS NOT NULL)))",
    ],
    ['con el esquema y la funcion entre comillas en minusculas', '(academia_id = "public"."app_academia_actual"())'],
    ['con la columna entre comillas en minusculas', '("academia_id" = app_academia_actual())'],
    [
      'un OR dentro de un termino entre parentesis de una conjuncion',
      '((academia_id = app_academia_actual()) AND ((a = 1) OR (b = 2)))',
    ],
    [
      'una conjuncion con una condicion siempre verdadera (la comparacion sigue exigiendose)',
      '((academia_id = app_academia_actual()) AND true)',
    ],
    // Criterio 140 (ataque ronda 7, O5): la subconsulta escalar que solo selecciona la funcion cuenta como la comparacion.
    ['criterio 140: la subconsulta, como la escribe el usuario', '(academia_id = (SELECT app_academia_actual()))'],
    [
      'criterio 140: la subconsulta con alias, como la escribe pg_get_expr',
      '(academia_id = ( SELECT app_academia_actual() AS app_academia_actual))',
    ],
    [
      'criterio 140: la subconsulta a la izquierda, con public. delante de la funcion',
      '((SELECT public.app_academia_actual()) = academia_id)',
    ],
    [
      'criterio 140: la subconsulta a la izquierda con alias, como la escribe pg_get_expr',
      '(( SELECT app_academia_actual() AS app_academia_actual) = academia_id)',
    ],
    ['criterio 140: la subconsulta con un alias corto', '(academia_id = (SELECT app_academia_actual() AS a))'],
    [
      'criterio 140: la subconsulta con un alias entre comillas dobles',
      '(academia_id = (SELECT app_academia_actual() AS "Mi alias"))',
    ],
    [
      'criterio 140: la subconsulta con cualquier espaciado, sin parentesis exteriores',
      'academia_id=(  SELECT\n   app_academia_actual( )\t )',
    ],
    [
      'criterio 140: la subconsulta con la funcion entre comillas en minusculas',
      '(academia_id = (SELECT "public"."app_academia_actual"()))',
    ],
    [
      'criterio 140: la subconsulta con select en minusculas',
      '(academia_id = (select app_academia_actual() as app_academia_actual))',
    ],
    ['criterio 140: la subconsulta con parentesis de mas', '(((academia_id = ((SELECT app_academia_actual())))))'],
    [
      'criterio 140: la subconsulta en una conjuncion con otra condicion',
      "((academia_id = ( SELECT app_academia_actual() AS app_academia_actual)) AND (clave <> 'x'::text))",
    ],
    [
      'criterio 140: la subconsulta en una conjuncion con la comparacion al final',
      "((clave <> 'x'::text) AND (( SELECT app_academia_actual() AS app_academia_actual) = academia_id))",
    ],
  ])('criterio 132: cumple %s', (_nombre, expresion) => {
    expect(cumpleFormaDeAcademia(expresion), expresion).toBe(true);
  });

  it.each([
    ['la comparacion con OR app_es_plataforma()', '((academia_id = app_academia_actual()) OR app_es_plataforma())'],
    ['la comparacion con OR true', '((academia_id = app_academia_actual()) OR true)'],
    ['la comparacion con OR de cualquier cosa', '((academia_id = app_academia_actual()) OR (clave = 1))'],
    [
      'un EXISTS que no depende de la fila',
      '(EXISTS ( SELECT 1 FROM auditoria a WHERE (a.academia_id = app_academia_actual())))',
    ],
    ['academia_id IS NOT NULL', '(academia_id IS NOT NULL)'],
    ['solo app_es_plataforma()', 'app_es_plataforma()'],
    ['true', 'true'],
    ['la comparacion negada', '(NOT (academia_id = app_academia_actual()))'],
    ['la comparacion dentro de un CASE', '(CASE WHEN (academia_id = app_academia_actual()) THEN true ELSE false END)'],
    ['una comparacion con otra columna', '(id = app_academia_actual())'],
    ['la comparacion con otro operador', '(academia_id <> app_academia_actual())'],
    ['una funcion de otro esquema', '(academia_id = otro.app_academia_actual())'],
    ['un operador = de otro esquema', '(academia_id OPERATOR(otro.=) app_academia_actual())'],
    ['una funcion con otro nombre', '(academia_id = app_academia_siguiente())'],
    ['una funcion con argumentos', '(academia_id = app_academia_actual(1))'],
    [
      'la comparacion junto a app_es_plataforma en una conjuncion',
      '((academia_id = app_academia_actual()) AND app_es_plataforma())',
    ],
    [
      'la comparacion junto a set_config en una conjuncion',
      "((academia_id = app_academia_actual()) AND (pg_catalog.set_config('app.academia_id'::text, ''::text, true) IS NOT NULL))",
    ],
    ['una expresion vacia', ''],
    // Reservas del tester (T83): un OR de primer nivel (la precedencia de OR) y los identificadores entre comillas.
    [
      'AND con true y OR true sin parentesis (OR de primer nivel)',
      'academia_id = app_academia_actual() AND true OR true',
    ],
    [
      'AND con una condicion y OR IS NULL sin parentesis',
      'academia_id = app_academia_actual() AND estado = 1 OR estado IS NULL',
    ],
    ['un OR de primer nivel antes del AND', 'estado IS NULL OR academia_id = app_academia_actual() AND estado = 1'],
    ['una funcion entre comillas en mayusculas', '(academia_id = "APP_ACADEMIA_ACTUAL"())'],
    ['un esquema entre comillas en mayusculas', '(academia_id = "PUBLIC".app_academia_actual())'],
    ['una columna entre comillas en mayusculas', '("ACADEMIA_ID" = app_academia_actual())'],
    ['la funcion sin comillas en mayusculas', '(academia_id = APP_ACADEMIA_ACTUAL())'],
    ['la columna sin comillas en mayusculas', '(ACADEMIA_ID = app_academia_actual())'],
    // Criterio 140 (ataque ronda 7, O5): la subconsulta no puede tener nada mas, y el operador sigue siendo `=`.
    [
      'criterio 140: la subconsulta con FROM y LIMIT',
      '(academia_id = ( SELECT app_academia_actual() AS app_academia_actual FROM academias LIMIT 1))',
    ],
    [
      'criterio 140: la subconsulta con FROM sin alias',
      '(academia_id = (SELECT app_academia_actual() FROM academias LIMIT 1))',
    ],
    [
      'criterio 140: la subconsulta con WHERE',
      '(academia_id = ( SELECT app_academia_actual() AS app_academia_actual WHERE true))',
    ],
    ['criterio 140: la subconsulta con LIMIT', '(academia_id = (SELECT app_academia_actual() LIMIT 1))'],
    [
      'criterio 140: la subconsulta con UNION',
      '(academia_id = ( SELECT app_academia_actual() AS app_academia_actual UNION SELECT app_academia_actual() AS app_academia_actual))',
    ],
    ['criterio 140: la subconsulta con otra columna', '(academia_id = (SELECT app_academia_actual(), 1))'],
    ['criterio 140: la subconsulta con otra funcion', '(academia_id = (SELECT app_academia_actual(), now()))'],
    [
      'criterio 140: la subconsulta con la funcion dentro de otra funcion',
      '(academia_id = (SELECT coalesce(app_academia_actual(), NULL::uuid)))',
    ],
    [
      'criterio 140: la subconsulta de otra funcion',
      '(academia_id = ( SELECT app_academia_siguiente() AS app_academia_siguiente))',
    ],
    [
      'criterio 140: la subconsulta de una funcion de otro esquema',
      '(academia_id = (SELECT otro.app_academia_actual()))',
    ],
    ['criterio 140: la subconsulta que selecciona una columna', '(academia_id = (SELECT academia_id))'],
    [
      'criterio 140: = ANY (ARRAY(SELECT ...))',
      '(academia_id = ANY (ARRAY( SELECT app_academia_actual() AS app_academia_actual)))',
    ],
    ['criterio 140: IN (SELECT ...)', '(academia_id IN ( SELECT app_academia_actual() AS app_academia_actual))'],
    ['criterio 140: = ANY (SELECT ...)', '(academia_id = ANY ( SELECT app_academia_actual() AS app_academia_actual))'],
    [
      'criterio 140: IS NOT DISTINCT FROM (SELECT ...)',
      '(academia_id IS NOT DISTINCT FROM ( SELECT app_academia_actual() AS app_academia_actual))',
    ],
    [
      'criterio 140: la subconsulta con OR app_es_plataforma()',
      '((academia_id = ( SELECT app_academia_actual() AS app_academia_actual)) OR app_es_plataforma())',
    ],
    [
      'criterio 140: la subconsulta con OR true',
      '((academia_id = ( SELECT app_academia_actual() AS app_academia_actual)) OR true)',
    ],
    [
      'criterio 140: la subconsulta con app_es_plataforma() en una conjuncion',
      '((academia_id = ( SELECT app_academia_actual() AS app_academia_actual)) AND app_es_plataforma())',
    ],
    [
      'criterio 140: la subconsulta con set_config en una conjuncion',
      "((academia_id = (SELECT app_academia_actual())) AND (pg_catalog.set_config('app.academia_id'::text, ''::text, true) IS NOT NULL))",
    ],
    [
      'criterio 140: la subconsulta a ambos lados, sin la columna',
      '((SELECT app_academia_actual()) = (SELECT app_academia_actual()))',
    ],
    ['criterio 140: la subconsulta con otra columna a la izquierda', '(id = (SELECT app_academia_actual()))'],
    ['criterio 140: la subconsulta con <>', '(academia_id <> (SELECT app_academia_actual()))'],
    ['criterio 140: la subconsulta negada', '(NOT (academia_id = (SELECT app_academia_actual())))'],
    [
      'criterio 140: la subconsulta dentro de un CASE',
      '(CASE WHEN (academia_id = (SELECT app_academia_actual())) THEN true ELSE false END)',
    ],
    [
      'criterio 140: lo excluido sigue siendo una comparacion con academia_id dentro de una subconsulta (el EXISTS)',
      '(EXISTS ( SELECT 1 FROM auditoria a WHERE (a.academia_id = ( SELECT app_academia_actual() AS app_academia_actual))))',
    ],
    [
      'criterio 140: la subconsulta con la funcion sin comillas en mayusculas',
      '(academia_id = (SELECT APP_ACADEMIA_ACTUAL()))',
    ],
  ])('criterio 132: no cumple %s', (_nombre, expresion) => {
    expect(cumpleFormaDeAcademia(expresion), expresion).toBe(false);
  });

  it('criterio 132: app_es_plataforma o set_config en cualquier termino, con cualquier combinacion de mayusculas, no cumple', () => {
    expect(cumpleFormaDeAcademia('((academia_id = app_academia_actual()) AND APP_ES_PLATAFORMA())')).toBe(false);
    expect(
      cumpleFormaDeAcademia("((academia_id = app_academia_actual()) AND (SET_CONFIG('x', 'y', true) = 'y'))"),
    ).toBe(false);
  });
});

describe('criterio 132: problemasDeLaPolitica', () => {
  const base = { esquema: 'public', tabla: 't', nombre: 'p', permisiva: true } as const;
  const bien = '(academia_id = app_academia_actual())';

  it('criterio 132: una politica ALL correcta no tiene problemas', () => {
    expect(problemasDeLaPolitica({ ...base, comando: '*', usando: bien, comprobando: bien })).toEqual([]);
  });

  it('criterio 132: una politica de INSERT sin WITH CHECK, y una de SELECT, UPDATE, DELETE o ALL sin USING, tienen un problema', () => {
    expect(problemasDeLaPolitica({ ...base, comando: 'a', usando: null, comprobando: null })).toHaveLength(1);
    for (const comando of ['r', 'w', 'd', '*']) {
      expect(
        problemasDeLaPolitica({ ...base, comando, usando: null, comprobando: bien }).length,
        comando,
      ).toBeGreaterThan(0);
    }
  });

  it('criterio 132: cada expresion se revisa, permisiva o restrictiva', () => {
    expect(
      problemasDeLaPolitica({ ...base, comando: '*', usando: bien, comprobando: '(academia_id IS NOT NULL)' }).length,
    ).toBeGreaterThan(0);
    expect(
      problemasDeLaPolitica({
        ...base,
        comando: 'r',
        permisiva: false,
        usando: 'app_es_plataforma()',
        comprobando: null,
      }).length,
    ).toBeGreaterThan(0);
  });
});
