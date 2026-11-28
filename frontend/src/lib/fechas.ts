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

const FORMATO_HORA = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** La hora en America/Lima con formato `HH:mm` (24 horas) a partir de un instante ISO 8601 (UTC). */
export function formatearHora(iso: string): string {
  const partes = Object.fromEntries(FORMATO_HORA.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${partes['hour']}:${partes['minute']}`;
}

/** Una fecha de calendario `AAAA-MM-DD` (por ejemplo, la vigencia de un plan) como `dd/MM/yyyy`. Es texto: no pasa por zona horaria. */
export function formatearFechaCalendario(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : fecha;
}

const FORMATO_DIA_LIMA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** La fecha de calendario `AAAA-MM-DD` de hoy en America/Lima, sin depender de la zona del navegador. Se compara como texto. */
export function hoyEnLima(instante: Date = new Date()): string {
  const partes = Object.fromEntries(FORMATO_DIA_LIMA.formatToParts(instante).map((p) => [p.type, p.value]));
  return `${partes['year']}-${partes['month']}-${partes['day']}`;
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

/** El mes `AAAA-MM` de hoy en America/Lima, sin depender de la zona del navegador. */
export function mesActualEnLima(instante: Date = new Date()): string {
  return hoyEnLima(instante).slice(0, 7);
}

/** El mes anterior a `mes` (`AAAA-MM`): `2026-01` da `2025-12`. Es texto: no pasa por zona horaria. */
export function mesAnterior(mes: string): string {
  const [anio = 0, numero = 1] = mes.split('-').map(Number);
  const [anioAnterior, mesAnteriorNumero] = numero === 1 ? [anio - 1, 12] : [anio, numero - 1];
  return `${String(anioAnterior).padStart(4, '0')}-${String(mesAnteriorNumero).padStart(2, '0')}`;
}

/** El día de la semana (1 lunes a 7 domingo) de una fecha de calendario `AAAA-MM-DD`. Es texto: no pasa por zona horaria. */
export function diaDeLaSemanaDeFecha(fecha: string): DiaSemana {
  const [anio = 0, mes = 1, dia = 1] = fecha.split('-').map(Number);
  const diaJs = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return diaIsoDeAbreviatura(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][diaJs] ?? '');
}

/** El mes siguiente a `mes` (`AAAA-MM`): `2026-12` da `2027-01`. Es texto: no pasa por zona horaria. */
export function mesSiguiente(mes: string): string {
  const [anio = 0, numero = 1] = mes.split('-').map(Number);
  const [anioSiguiente, mesSiguienteNumero] = numero === 12 ? [anio + 1, 1] : [anio, numero + 1];
  return `${String(anioSiguiente).padStart(4, '0')}-${String(mesSiguienteNumero).padStart(2, '0')}`;
}

/** Solo el nombre de un mes `AAAA-MM`, en minúscula: "diciembre". Si no es un mes, se muestra tal cual. */
export function nombreDelMes(mes: string): string {
  const partes = /^([0-9]{4})-(0[1-9]|1[0-2])$/.exec(mes);
  return (partes ? NOMBRE_MES[Number(partes[2]) - 1] : undefined) ?? mes;
}

/** El día y el mes de una fecha de calendario `AAAA-MM-DD` como `d/MM` ("26/11", "1/12"). Es texto: no pasa por zona horaria. */
export function formatearDiaYMes(fecha: string): string {
  const [, mes, dia] = fecha.split('-');
  return mes && dia ? `${Number(dia)}/${mes}` : fecha;
}

/** Un mes `AAAA-MM` y el día en que empieza la inscripción: "Diciembre de 2026, desde el 1/12". */
export function formatearMesDesde(mes: string, fechaInicio: string): string {
  const texto = formatearMes(mes);
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}, desde el ${formatearDiaYMes(fechaInicio)}`;
}

/**
 * El mes de una inscripción para mostrarlo en el seguimiento, en las solicitudes y en la bandeja de pagos (010d, criterio 18). Un mes que
 * todavía no empieza (el siguiente, que se paga antes del día 1) dice desde qué día: "Diciembre de 2026, desde el 1/12". El mes en curso
 * y los pasados se dicen como siempre: "noviembre de 2026". `mesEnCurso` es el de hoy en Lima.
 */
export function formatearMesDeInscripcion(mes: string, mesEnCurso: string = mesActualEnLima()): string {
  return mes > mesEnCurso ? formatearMesDesde(mes, `${mes}-01`) : formatearMes(mes);
}
