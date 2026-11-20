import type { DiaSemana } from '@aquagestion/contratos';

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

const DIA_ISO: Readonly<Record<string, DiaSemana>> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const DIA_EN_LIMA = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', weekday: 'short' });

/** El número ISO (1 lunes a 7 domingo) de la abreviatura inglesa del día. Si no la reconoce, falla en vez de adivinar un día. */
export function diaIsoDeAbreviatura(abreviatura: string): DiaSemana {
  const dia = DIA_ISO[abreviatura];
  if (dia === undefined) throw new Error(`No se reconoce el día de la semana "${abreviatura}" que devolvió Intl.`);
  return dia;
}

/** El día de la semana de un instante en America/Lima, de 1 (lunes) a 7 (domingo), sin depender de la zona del navegador. */
export function diaDeLaSemanaEnLima(instante: Date = new Date()): DiaSemana {
  return diaIsoDeAbreviatura(DIA_EN_LIMA.format(instante));
}

const NOMBRE_MES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** Un mes `AAAA-MM` como "noviembre de 2026". Es texto: no pasa por zona horaria. Si no es un mes, se muestra tal cual. */
export function formatearMes(mes: string): string {
  const partes = /^([0-9]{4})-(0[1-9]|1[0-2])$/.exec(mes);
  const nombre = partes ? NOMBRE_MES[Number(partes[2]) - 1] : undefined;
  return partes && nombre ? `${nombre} de ${partes[1]}` : mes;
}
