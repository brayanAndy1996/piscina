const FORMATO_FECHA = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Fecha en America/Lima con formato `dd/MM/yyyy` a partir de un instante ISO 8601 (UTC). */
export function formatearFecha(iso: string): string {
  return FORMATO_FECHA.format(new Date(iso));
}
