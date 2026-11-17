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

/** Una fecha de calendario `AAAA-MM-DD` (por ejemplo, la vigencia de un plan) como `dd/MM/yyyy`. Es texto: no pasa por zona horaria. */
export function formatearFechaCalendario(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : fecha;
}

const DIA_ISO: Readonly<Record<string, number>> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const DIA_EN_LIMA = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', weekday: 'short' });

/** El día de la semana de un instante en America/Lima, de 1 (lunes) a 7 (domingo), sin depender de la zona del navegador. */
export function diaDeLaSemanaEnLima(instante: Date = new Date()): number {
  return DIA_ISO[DIA_EN_LIMA.format(instante)] ?? 1;
}
