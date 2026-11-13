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

const PARTES_FECHA_HORA = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Fecha y hora en America/Lima con formato `dd/MM/yyyy HH:mm` (24 horas) a partir de un instante ISO 8601 (UTC). */
export function formatearFechaHora(iso: string): string {
  const partes = Object.fromEntries(PARTES_FECHA_HORA.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${partes['day']}/${partes['month']}/${partes['year']} ${partes['hour']}:${partes['minute']}`;
}
