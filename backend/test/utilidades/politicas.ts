// spec: 001-academias-aislamiento (pruebas protegidas)

/**
 * Lector de las expresiones de las politicas de RLS (criterio 132, precision P-33). Trabaja sobre el TEXTO que devuelve
 * `pg_catalog.pg_get_expr(polqual, polrelid)` / `pg_get_expr(polwithcheck, polrelid)` con `search_path = pg_catalog, public`, por
 * ejemplo `(academia_id = app_academia_actual())` o `((academia_id = app_academia_actual()) AND (clave <> 'x'::text))`. No es un
 * analizador de SQL: solo cuenta parentesis y comillas para separar las conjunciones de primer nivel.
 */

/** Posicion de cada caracter con su profundidad de parentesis, ignorando lo que esta entre comillas simples o dobles. */
function recorrer(texto: string, alVer: (posicion: number, profundidad: number) => void): void {
  let profundidad = 0;
  let comilla: "'" | '"' | null = null;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charAt(i);
    if (comilla !== null) {
      if (c === comilla) {
        if (texto.charAt(i + 1) === comilla) i++;
        else comilla = null;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      comilla = c;
      continue;
    }
    if (c === '(') profundidad++;
    else if (c === ')') profundidad--;
    alVer(i, profundidad);
  }
}

/** Quita los parentesis exteriores mientras un solo par encierre toda la expresion. */
function sinParentesisExteriores(texto: string): string {
  let actual = texto.trim();
  for (;;) {
    if (!actual.startsWith('(') || !actual.endsWith(')')) return actual;
    let cierraAlFinal = true;
    recorrer(actual, (posicion, profundidad) => {
      // Si la profundidad llega a 0 antes del ultimo caracter, el primer parentesis cierra antes del final.
      if (posicion < actual.length - 1 && profundidad === 0) cierraAlFinal = false;
    });
    if (!cierraAlFinal) return actual;
    actual = actual.slice(1, -1).trim();
  }
}

const esDeIdentificador = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);

/** ¿Hay un `OR` de profundidad 0 (fuera de parentesis y de cadenas)? Con el, `a AND b OR c` es `(a AND b) OR c`. */
function tieneOrDePrimerNivel(texto: string): boolean {
  let hay = false;
  recorrer(texto, (posicion, profundidad) => {
    if (profundidad !== 0 || texto.slice(posicion, posicion + 2).toUpperCase() !== 'OR') return;
    const antes = posicion === 0 ? ' ' : texto.charAt(posicion - 1);
    const despues = posicion + 2 >= texto.length ? ' ' : texto.charAt(posicion + 2);
    if (!esDeIdentificador(antes) && !esDeIdentificador(despues)) hay = true;
  });
  return hay;
}

/**
 * Parte el texto por cada `AND` de profundidad 0 (fuera de parentesis y de cadenas). Si hay un `OR` de primer nivel, el `OR` tiene
 * menos precedencia que el `AND`: el texto entero es un solo termino (una disyuncion), no una conjuncion.
 */
function partirPorAnd(texto: string): string[] {
  if (tieneOrDePrimerNivel(texto)) return [texto.trim()];
  const cortes: number[] = [];
  recorrer(texto, (posicion, profundidad) => {
    if (profundidad !== 0) return;
    if (texto.slice(posicion, posicion + 3).toUpperCase() !== 'AND') return;
    const antes = posicion === 0 ? ' ' : texto.charAt(posicion - 1);
    const despues = posicion + 3 >= texto.length ? ' ' : texto.charAt(posicion + 3);
    if (!esDeIdentificador(antes) && !esDeIdentificador(despues)) cortes.push(posicion);
  });
  const partes: string[] = [];
  let desde = 0;
  for (const corte of cortes) {
    partes.push(texto.slice(desde, corte).trim());
    desde = corte + 3;
  }
  partes.push(texto.slice(desde).trim());
  return partes;
}

/**
 * Terminos de primer nivel de una conjuncion: quita los parentesis exteriores que encierran toda la expresion, separa por `AND` de
 * primer nivel y aplana los terminos que son a su vez una conjuncion entre parentesis (`a AND (b AND c)` da `a`, `b`, `c`). Un
 * texto sin `AND` de primer nivel devuelve un solo termino. Los terminos conservan sus parentesis.
 */
export function terminosDeConjuncion(expresion: string): string[] {
  const exterior = sinParentesisExteriores(expresion);
  return partirPorAnd(exterior).flatMap((termino) => {
    const interior = sinParentesisExteriores(termino);
    return partirPorAnd(interior).length > 1 ? terminosDeConjuncion(interior) : [termino];
  });
}

// Los identificadores distinguen mayusculas: sin comillas, solo en minusculas (como los escribe `pg_get_expr`); con comillas, exactamente
// en minusculas (`"public"`, `"app_academia_actual"`, `"academia_id"`). `"APP_ACADEMIA_ACTUAL"` o `"PUBLIC"` son otros objetos. Las
// palabras clave (`SELECT`, `AS`) no distinguen mayusculas.
const FUNCION = String.raw`(?:(?:"public"|public)\s*\.\s*)?(?:"app_academia_actual"|app_academia_actual)\s*\(\s*\)`;
const COLUMNA = new RegExp(String.raw`^(?:"academia_id"|academia_id)$`);

const palabra = (texto: string): string =>
  [...texto].map((letra) => `[${letra.toLowerCase()}${letra.toUpperCase()}]`).join('');
// Un alias simple: sin comillas y en minusculas, o entre comillas dobles. Sin `AS`, un alias no puede ser una palabra que abre otra
// clausula (`FROM`, `WHERE`, `LIMIT`, `UNION`, ...): aqui nunca se acepta nada despues del alias.
const RESERVADAS = [
  'from',
  'where',
  'limit',
  'union',
  'intersect',
  'except',
  'group',
  'having',
  'order',
  'offset',
  'fetch',
];
const ALIAS_SIMPLE = String.raw`(?:"[^"]+"|(?!(?:${RESERVADAS.map(palabra).join('|')})\b)[a-z_][a-z0-9_]*)`;
/** Criterio 140 (precision P-33, ronda 7): el lado de la funcion es la llamada o una subconsulta que solo la selecciona. */
const LADO_FUNCION = new RegExp(
  String.raw`^(?:${FUNCION}|${palabra('select')}\s+${FUNCION}(?:\s+(?:${palabra('as')}\s+)?${ALIAS_SIMPLE})?)$`,
);

/**
 * Parte un termino por el unico `=` de primer nivel (fuera de parentesis y de cadenas, y que no es parte de `<=`, `>=`, `<>`, `!=` ni
 * `==`). Devuelve los dos lados, o `null` si no hay exactamente uno (`IN`, `= ANY`, `IS NOT DISTINCT FROM` y `OPERATOR(x.=)` no
 * cuentan: no tienen un `=` suelto de primer nivel con dos lados validos).
 */
function ladosDeLaIgualdad(termino: string): [string, string] | null {
  const posiciones: number[] = [];
  recorrer(termino, (posicion, profundidad) => {
    if (profundidad !== 0 || termino.charAt(posicion) !== '=') return;
    const antes = termino.charAt(posicion - 1);
    const despues = termino.charAt(posicion + 1);
    if (['<', '>', '!', '='].includes(antes) || despues === '=' || despues === '>') return;
    posiciones.push(posicion);
  });
  const [posicion, ...otras] = posiciones;
  if (posicion === undefined || otras.length > 0) return null;
  return [termino.slice(0, posicion).trim(), termino.slice(posicion + 1).trim()];
}

/** ¿El termino es `academia_id = <lado de la funcion>` o `<lado de la funcion> = academia_id`? */
function esLaComparacion(termino: string): boolean {
  const lados = ladosDeLaIgualdad(sinParentesisExteriores(termino));
  if (lados === null) return false;
  const [izquierdo, derecho] = lados;
  const esFuncion = (lado: string): boolean => LADO_FUNCION.test(sinParentesisExteriores(lado));
  return (COLUMNA.test(izquierdo) && esFuncion(derecho)) || (esFuncion(izquierdo) && COLUMNA.test(derecho));
}

/**
 * Regla del criterio 132 para UNA expresion (`USING` o `WITH CHECK`): verdadera si algun termino de primer nivel, sin parentesis
 * exteriores y sin `public.` delante de la funcion, es `academia_id = app_academia_actual()` o `app_academia_actual() = academia_id`,
 * y la expresion no menciona `app_es_plataforma` ni `set_config` en ningun termino. Una expresion vacia no cumple.
 *
 * Criterio 140 (ataque ronda 7, O5; precision P-33): el lado de la funcion puede ser la llamada o la subconsulta escalar que solo la
 * selecciona, `(SELECT app_academia_actual())`, con o sin `public.` y con o sin un alias simple (`pg_get_expr` escribe
 * `( SELECT app_academia_actual() AS app_academia_actual)`), con cualquier espaciado y en cualquier orden. La subconsulta no puede tener
 * nada mas (`FROM`, `WHERE`, `LIMIT`, `UNION`, otra columna u otra funcion) y el operador sigue siendo `=`.
 */
export function cumpleFormaDeAcademia(expresion: string): boolean {
  if (expresion.trim() === '') return false;
  if (/app_es_plataforma|set_config/i.test(expresion)) return false;
  return terminosDeConjuncion(expresion).some(esLaComparacion);
}

/** Politica tal como la lee la consulta del criterio 132. */
export interface PoliticaLeida {
  readonly esquema: string;
  readonly tabla: string;
  readonly nombre: string;
  /** `r` SELECT, `a` INSERT, `w` UPDATE, `d` DELETE, `*` ALL. */
  readonly comando: string;
  readonly permisiva: boolean;
  readonly usando: string | null;
  readonly comprobando: string | null;
}

/**
 * Lo que incumple una politica de una tabla con `academia_id` (criterio 132): las de `INSERT` deben tener `WITH CHECK` y las de
 * `SELECT`, `UPDATE`, `DELETE` y `ALL`, `USING` (criterio 11); cada expresion que tenga (`USING` y `WITH CHECK`), permisiva o
 * restrictiva, debe cumplir `cumpleFormaDeAcademia`. Devuelve un texto por cada incumplimiento (`[]` si cumple).
 */
export function problemasDeLaPolitica(politica: PoliticaLeida): string[] {
  const etiqueta = `${politica.esquema}.${politica.tabla}.${politica.nombre} (${politica.permisiva ? 'permisiva' : 'restrictiva'}, ${politica.comando})`;
  const problemas: string[] = [];
  if (politica.comando === 'a') {
    if (politica.comprobando === null) problemas.push(`${etiqueta}: falta WITH CHECK`);
  } else if (politica.usando === null) {
    problemas.push(`${etiqueta}: falta USING`);
  }
  for (const [parte, expresion] of [
    ['USING', politica.usando],
    ['WITH CHECK', politica.comprobando],
  ] as const) {
    if (expresion !== null && !cumpleFormaDeAcademia(expresion)) {
      problemas.push(`${etiqueta}: ${parte} (${expresion}) no es exactamente la comparacion con la academia`);
    }
  }
  return problemas;
}
