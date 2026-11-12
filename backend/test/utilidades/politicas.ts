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

/** Parte el texto por cada `AND` de profundidad 0 (fuera de parentesis y de cadenas). */
function partirPorAnd(texto: string): string[] {
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

const FUNCION = String.raw`(?:"?public"?\s*\.\s*)?"?app_academia_actual"?\s*\(\s*\)`;
const COLUMNA = String.raw`"?academia_id"?`;
const COMPARACION = new RegExp(`^(?:${COLUMNA}\\s*=\\s*${FUNCION}|${FUNCION}\\s*=\\s*${COLUMNA})$`, 'i');

/**
 * Regla del criterio 132 para UNA expresion (`USING` o `WITH CHECK`): verdadera si algun termino de primer nivel, sin parentesis
 * exteriores y sin `public.` delante de la funcion, es `academia_id = app_academia_actual()` o `app_academia_actual() = academia_id`,
 * y la expresion no menciona `app_es_plataforma` ni `set_config` en ningun termino. Una expresion vacia no cumple.
 */
export function cumpleFormaDeAcademia(expresion: string): boolean {
  if (expresion.trim() === '') return false;
  if (/app_es_plataforma|set_config/i.test(expresion)) return false;
  return terminosDeConjuncion(expresion).some((termino) => COMPARACION.test(sinParentesisExteriores(termino)));
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
