/**
 * A quién llega el enlace de seguimiento (spec 005, criterio 57; DR-13): el correo de la persona, si lo dio, y el del apoderado, si lo
 * dio. Sin repetir: se comparan los textos exactos ya normalizados por el esquema (recortados y en minúsculas), sin otras equivalencias.
 * Un mayor de edad no tiene apoderado (criterio 13), así que solo lleva el suyo.
 */
export function destinatariosDelEnlace(cuerpo: {
  readonly alumno: { readonly correo?: string | undefined };
  readonly apoderado?: { readonly correo?: string | undefined } | undefined;
}): string[] {
  const destinatarios: string[] = [];
  for (const correo of [cuerpo.alumno.correo, cuerpo.apoderado?.correo]) {
    if (correo !== undefined && !destinatarios.includes(correo)) destinatarios.push(correo);
  }
  return destinatarios;
}
