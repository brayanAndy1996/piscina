// spec: 006-caja (pruebas protegidas)
import { inflateSync } from 'node:zlib';

/**
 * Utilidad de las pruebas protegidas de la 006b (PQ10): lee el texto de un PDF sin dependencias nuevas. Descomprime los flujos
 * `FlateDecode` con `node:zlib`, lee las cadenas de los operadores `Tj` y `TJ` (literales `( … )` y hexadecimales `< … >`) y las pasa de
 * WinAnsi (la codificación de las fuentes estándar de `pdfkit`) a Unicode. También lee el diccionario de información (`Title`,
 * `CreationDate`) y comprueba que el archivo empiece con `%PDF-` y termine con `%%EOF`.
 *
 * No es un lector general de PDF: sirve para los documentos que arma `pdfkit` con fuentes estándar y textos cortos. Las pruebas buscan cada
 * dato como subcadena del texto extraído.
 */

/** Los caracteres de WinAnsi (Windows-1252) de 0x80 a 0x9F; los cinco códigos sin uso salen como U+FFFD. */
const WINANSI_80_A_9F =
  '\u20AC\uFFFD\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\uFFFD\u017D\uFFFD' +
  '\uFFFD\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\uFFFD\u017E\u0178';

/** Un byte de WinAnsi como carácter Unicode. */
function deWinAnsi(byte: number): string {
  if (byte >= 0x80 && byte <= 0x9f) return WINANSI_80_A_9F.charAt(byte - 0x80);
  return String.fromCharCode(byte);
}

function bytesDeWinAnsi(bytes: readonly number[]): string {
  return bytes.map(deWinAnsi).join('');
}

// ---------------------------------------------------------------------------------------------------------------------
// Flujos de contenido
// ---------------------------------------------------------------------------------------------------------------------

/** Los flujos de contenido del documento, descomprimidos y como texto latin1 (un carácter por byte). */
function flujosDeContenido(pdf: Buffer): string[] {
  const texto = pdf.toString('latin1');
  const flujos: string[] = [];
  let posicion = 0;
  for (;;) {
    const marca = texto.indexOf('stream', posicion);
    if (marca === -1) break;
    posicion = marca + 'stream'.length;
    if (texto.startsWith('end', marca - 3)) continue;
    let inicio = marca + 'stream'.length;
    if (texto.startsWith('\r\n', inicio)) inicio += 2;
    else if (texto.startsWith('\n', inicio)) inicio += 1;
    const fin = texto.indexOf('endstream', inicio);
    if (fin === -1) break;
    posicion = fin + 'endstream'.length;
    const crudo = pdf.subarray(inicio, fin);
    try {
      flujos.push(inflateSync(crudo).toString('latin1'));
    } catch {
      // Un flujo sin `FlateDecode` (o que no es de contenido): se lee tal cual, por si trae texto sin comprimir.
      flujos.push(crudo.toString('latin1'));
    }
  }
  return flujos;
}

type Ficha =
  | { tipo: 'cadena'; texto: string }
  | { tipo: 'inicio-arreglo' }
  | { tipo: 'fin-arreglo' }
  | { tipo: 'palabra'; palabra: string };

const ESPACIOS = new Set([' ', '\n', '\r', '\t', '\f', '\0']);
const DELIMITADORES = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

function valorDeEscape(contenido: string, posicion: number): { bytes: number[]; siguiente: number } {
  const c = contenido.charAt(posicion);
  const simples: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
  if (c in simples) return { bytes: [simples[c] as number], siguiente: posicion + 1 };
  if (c >= '0' && c <= '7') {
    let octal = c;
    let siguiente = posicion + 1;
    while (octal.length < 3 && contenido.charAt(siguiente) >= '0' && contenido.charAt(siguiente) <= '7') {
      octal += contenido.charAt(siguiente);
      siguiente += 1;
    }
    return { bytes: [parseInt(octal, 8) & 0xff], siguiente };
  }
  if (c === '\r')
    return { bytes: [], siguiente: contenido.charAt(posicion + 1) === '\n' ? posicion + 2 : posicion + 1 };
  if (c === '\n') return { bytes: [], siguiente: posicion + 1 };
  return { bytes: [c.charCodeAt(0)], siguiente: posicion + 1 };
}

function fichasDe(contenido: string): Ficha[] {
  const fichas: Ficha[] = [];
  let i = 0;
  while (i < contenido.length) {
    const c = contenido.charAt(i);
    if (ESPACIOS.has(c)) {
      i += 1;
    } else if (c === '(') {
      const bytes: number[] = [];
      let profundidad = 1;
      i += 1;
      while (i < contenido.length && profundidad > 0) {
        const actual = contenido.charAt(i);
        if (actual === '\\') {
          const { bytes: escapados, siguiente } = valorDeEscape(contenido, i + 1);
          bytes.push(...escapados);
          i = siguiente;
          continue;
        }
        if (actual === '(') profundidad += 1;
        if (actual === ')') profundidad -= 1;
        if (profundidad > 0) bytes.push(actual.charCodeAt(0));
        i += 1;
      }
      fichas.push({ tipo: 'cadena', texto: bytesDeWinAnsi(bytes) });
    } else if (c === '<' && contenido.charAt(i + 1) !== '<') {
      const cierre = contenido.indexOf('>', i);
      const fin = cierre === -1 ? contenido.length : cierre;
      const hex = contenido.slice(i + 1, fin).replace(/\s+/g, '');
      const bytes: number[] = [];
      for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16));
      fichas.push({ tipo: 'cadena', texto: bytesDeWinAnsi(bytes) });
      i = fin + 1;
    } else if (c === '[') {
      fichas.push({ tipo: 'inicio-arreglo' });
      i += 1;
    } else if (c === ']') {
      fichas.push({ tipo: 'fin-arreglo' });
      i += 1;
    } else if (c === '%') {
      while (i < contenido.length && contenido.charAt(i) !== '\n' && contenido.charAt(i) !== '\r') i += 1;
    } else if (DELIMITADORES.has(c)) {
      // `<<`, `>>`, `/Nombre`, `{`, `}`: no traen texto. Un nombre se lee como una palabra.
      let fin = i + 1;
      if (c === '/') {
        while (
          fin < contenido.length &&
          !ESPACIOS.has(contenido.charAt(fin)) &&
          !DELIMITADORES.has(contenido.charAt(fin))
        ) {
          fin += 1;
        }
      }
      fichas.push({ tipo: 'palabra', palabra: contenido.slice(i, fin) });
      i = fin;
    } else {
      let fin = i;
      while (
        fin < contenido.length &&
        !ESPACIOS.has(contenido.charAt(fin)) &&
        !DELIMITADORES.has(contenido.charAt(fin))
      ) {
        fin += 1;
      }
      fichas.push({ tipo: 'palabra', palabra: contenido.slice(i, fin) });
      i = fin;
    }
  }
  return fichas;
}

/** Las líneas de texto de un flujo de contenido: una por cada operador `Tj` o `TJ` (las cadenas de un `TJ` se unen, sin los ajustes). */
function lineasDeTexto(contenido: string): string[] {
  const lineas: string[] = [];
  let enArreglo = false;
  let delArreglo: string[] = [];
  let ultimaCadena: string | undefined;
  for (const ficha of fichasDe(contenido)) {
    if (ficha.tipo === 'inicio-arreglo') {
      enArreglo = true;
      delArreglo = [];
    } else if (ficha.tipo === 'fin-arreglo') {
      enArreglo = false;
      ultimaCadena = delArreglo.join('');
    } else if (ficha.tipo === 'cadena') {
      if (enArreglo) delArreglo.push(ficha.texto);
      else ultimaCadena = ficha.texto;
    } else if (ficha.palabra === 'TJ' || ficha.palabra === 'Tj') {
      if (ultimaCadena !== undefined) lineas.push(ultimaCadena);
      ultimaCadena = undefined;
    } else if (!enArreglo) {
      ultimaCadena = undefined;
    }
  }
  return lineas;
}

export interface TextoDelPdf {
  /** Una entrada por operador de texto (`Tj` o `TJ`), en el orden del documento. */
  readonly lineas: readonly string[];
  /** Todas las líneas unidas con `\n`. */
  readonly texto: string;
}

/** El texto de todas las páginas del PDF, en el orden del documento. */
export function extraerTextoPdf(pdf: Buffer): TextoDelPdf {
  const lineas = flujosDeContenido(pdf).flatMap(lineasDeTexto);
  return { lineas, texto: lineas.join('\n') };
}

// ---------------------------------------------------------------------------------------------------------------------
// Información del documento y forma del archivo
// ---------------------------------------------------------------------------------------------------------------------

export interface InfoDelPdf {
  Title?: string;
  /** `CreationDate` como instante (el PDF la guarda con precisión de segundos). */
  CreationDate?: Date;
  Producer?: string;
  Creator?: string;
  Author?: string;
}

function decodificarCadenaLiteral(crudo: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < crudo.length; i += 1) {
    if (crudo.charAt(i) === '\\') {
      const { bytes: escapados, siguiente } = valorDeEscape(crudo, i + 1);
      bytes.push(...escapados);
      i = siguiente - 1;
    } else {
      bytes.push(crudo.charCodeAt(i));
    }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let texto = '';
    for (let i = 2; i + 1 < bytes.length; i += 2)
      texto += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
    return texto;
  }
  return bytesDeWinAnsi(bytes);
}

function decodificarCadenaHexadecimal(hex: string): string {
  const limpio = hex.replace(/\s+/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < limpio.length; i += 2) bytes.push(parseInt(limpio.slice(i, i + 2).padEnd(2, '0'), 16));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let texto = '';
    for (let i = 2; i + 1 < bytes.length; i += 2)
      texto += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
    return texto;
  }
  return bytesDeWinAnsi(bytes);
}

function cadenaEn(texto: string): string | undefined {
  const literal = /^\s*\(((?:\\[\s\S]|[^\\)])*)\)/.exec(texto);
  if (literal?.[1] !== undefined) return decodificarCadenaLiteral(literal[1]);
  const hexadecimal = /^\s*<([0-9a-fA-F\s]*)>/.exec(texto);
  if (hexadecimal?.[1] !== undefined) return decodificarCadenaHexadecimal(hexadecimal[1]);
  return undefined;
}

/** El valor de un campo del diccionario de información: una cadena directa o una referencia (`11 0 R`) a un objeto que es la cadena. */
function campoDeInfo(texto: string, nombre: string): string | undefined {
  const inicio = new RegExp(`/${nombre}(?![A-Za-z])`).exec(texto);
  if (!inicio) return undefined;
  const resto = texto.slice(inicio.index + inicio[0].length);
  const directa = cadenaEn(resto);
  if (directa !== undefined) return directa;
  const referencia = /^\s*(\d+)\s+(\d+)\s+R/.exec(resto);
  if (!referencia) return undefined;
  const objeto = new RegExp(`(?:^|[\\r\\n])${referencia[1]}\\s+${referencia[2]}\\s+obj\\s*`).exec(texto);
  return objeto ? cadenaEn(texto.slice(objeto.index + objeto[0].length)) : undefined;
}

/** `D:AAAAMMDDHHmmSS` con `Z`, `+HH'mm'` o sin zona (UTC) como instante; `undefined` si no tiene esa forma. */
export function fechaDePdf(valor: string): Date | undefined {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})'?(\d{2})?'?)?$/.exec(valor);
  if (!m) return undefined;
  const [
    ,
    anio,
    mes,
    dia,
    hora = '00',
    minuto = '00',
    segundo = '00',
    zeta,
    signo,
    horasZona = '00',
    minutosZona = '00',
  ] = m;
  const base = Date.UTC(Number(anio), Number(mes) - 1, Number(dia), Number(hora), Number(minuto), Number(segundo));
  if (zeta !== undefined || signo === undefined) return new Date(base);
  const desfase = (Number(horasZona) * 60 + Number(minutosZona)) * 60_000;
  return new Date(signo === '+' ? base - desfase : base + desfase);
}

/** El diccionario de información (`/Info`) del PDF: título, fecha de creación y quién lo produjo. */
export function leerInfoPdf(pdf: Buffer): InfoDelPdf {
  const texto = pdf.toString('latin1');
  const info: InfoDelPdf = {};
  const titulo = campoDeInfo(texto, 'Title');
  if (titulo !== undefined) info.Title = titulo;
  const productor = campoDeInfo(texto, 'Producer');
  if (productor !== undefined) info.Producer = productor;
  const creador = campoDeInfo(texto, 'Creator');
  if (creador !== undefined) info.Creator = creador;
  const autor = campoDeInfo(texto, 'Author');
  if (autor !== undefined) info.Author = autor;
  const creacion = campoDeInfo(texto, 'CreationDate');
  const fecha = creacion === undefined ? undefined : fechaDePdf(creacion);
  if (fecha !== undefined) info.CreationDate = fecha;
  return info;
}

/** `true` si el archivo empieza con `%PDF-` y termina con `%%EOF` (con o sin salto de línea final). */
export function tieneFormaDePdf(pdf: Buffer): boolean {
  return pdf.subarray(0, 5).toString('latin1') === '%PDF-' && /%%EOF\r?\n?$/.test(pdf.subarray(-16).toString('latin1'));
}

/** La cantidad de páginas (`/Type /Page`, sin contar `/Pages`). */
export function contarPaginasPdf(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}
