/**
 * La matrícula que muestra el carnet (spec 008a, criterio 8; DT-12). Funciones puras: reciben la fecha de hoy en Lima ya calculada
 * (`AAAA-MM-DD`) y nunca leen el reloj ni la zona del proceso. Las fechas `AAAA-MM-DD` se comparan como texto.
 */
export interface MatriculaCandidata {
  readonly estado: string;
  readonly anio: number;
  readonly mes: number;
  readonly desde: string;
  readonly hasta: string;
  readonly creadoEn: Date;
}

/** `true` si la matrícula está `VIGENTE` y hoy está entre su inicio y su fin, ambos incluidos. */
export function vigenteHoy(matricula: Pick<MatriculaCandidata, 'estado' | 'desde' | 'hasta'>, hoy: string): boolean {
  return matricula.estado === 'VIGENTE' && matricula.desde <= hoy && hoy <= matricula.hasta;
}

/** Más reciente primero: el mes (año y mes) y, con el mismo mes, la que se creó después. */
function masReciente(a: MatriculaCandidata, b: MatriculaCandidata): number {
  return b.anio - a.anio || b.mes - a.mes || b.creadoEn.getTime() - a.creadoEn.getTime();
}

/**
 * De las matrículas del alumno, la `VIGENTE` cuyo período contiene hoy; si no hay, la `VIGENTE` o `FINALIZADA` con el mes más reciente; si
 * tampoco hay, ninguna. Una `RESERVADA` o `CANCELADA` nunca es la del carnet.
 */
export function elegirMatriculaDelCarnet<T extends MatriculaCandidata>(
  matriculas: readonly T[],
  hoy: string,
): T | null {
  const validas = matriculas.filter((matricula) => matricula.estado === 'VIGENTE' || matricula.estado === 'FINALIZADA');
  const deHoy = validas.filter((matricula) => vigenteHoy(matricula, hoy)).sort(masReciente);
  if (deHoy[0]) return deHoy[0];
  return [...validas].sort(masReciente)[0] ?? null;
}
