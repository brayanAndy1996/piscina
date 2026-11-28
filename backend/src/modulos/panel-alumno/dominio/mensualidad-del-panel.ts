/**
 * Lo que el panel muestra de la mensualidad de un alumno (spec 011, criterio 11). Función pura, sin base de datos ni Nest y sin depender de la zona del proceso: los
 * meses van como `AAAA-MM`. La elección del estado, de `actual` y de `siguiente` es la del listado de recepción: `elegirMensualidades`, de `mensualidades/dominio`.
 */

/**
 * Los meses de asistencia que el alumno puede consultar (criterio 11, DR-2): M siempre y cada mes anterior a M con una mensualidad pagada, del más nuevo al más
 * viejo y sin repetir. Nunca M+1 ni uno posterior, aunque ya esté pagado.
 */
export function mesesDeAsistencia(mesEnCurso: string, mesesPagados: readonly string[]): string[] {
  const meses = new Set<string>([mesEnCurso]);
  for (const mes of mesesPagados) if (mes < mesEnCurso) meses.add(mes);
  return [...meses].sort().reverse();
}
