import {
  type Caja,
  type CierreCaja,
  formatearSoles,
  type MetodoPago,
  type MovimientoCaja,
  type PersonaCaja,
  type ResultadoCierre,
} from '@aquagestion/contratos';
import PDFDocument from 'pdfkit';
import { fechaCortaEnLima, horaEnLima } from '../../../comun/fechas';
import { textoParaPdf } from './texto-pdf';

/**
 * El PDF del cierre de caja (spec 006b, criterios 42 y 43; HU-27: "se genera un PDF del cierre"; D-10). Se arma bajo pedido con lo que ya
 * está confirmado: el cierre y sus movimientos no cambian, así que dos descargas del mismo cierre dan los mismos bytes (PQ9 d) mientras no se
 * reabra ese cierre ni cambie un nombre. Nada se guarda en un archivo (DT-2).
 *
 * Determinista e independiente de la zona del proceso: `CreationDate` es `cerradoEn` (no la hora de la descarga); `pdfkit` calcula el `/ID`
 * del final con los datos de `info` que recibe en el constructor, así que también queda fijo; las horas se escriben en America/Lima con
 * `@date-fns/tz`. Los montos se escriben con `formatearSoles` sobre el texto, sin `Number`.
 *
 * Los textos que salen de los datos pasan por `textoParaPdf` (PQ11): la fuente estándar solo muestra Latin-1 y el texto se escribe codificado
 * (nunca como operadores del PDF), así que ningún texto puede cambiar la estructura del documento. Nunca lleva un DNI (RNF-05).
 */

/** Los datos que el servicio lee de la base, ya confirmados, y que `generarPdfCierre` convierte en el documento. Sin DNI. */
export interface DatosPdfCierre {
  /** El nombre de la academia (`sesion.academia.nombre`, D-22). */
  readonly academia: string;
  /** La caja del cierre: su fecha, el monto inicial y quién la abrió y cuándo. */
  readonly caja: Pick<Caja, 'id' | 'fecha' | 'montoInicial' | 'abiertaPor' | 'abiertaEn'>;
  /** La fila completa del cierre pedido, con su reapertura si la tiene (los montos son la foto del cierre). */
  readonly cierre: CierreCaja;
  /** Los movimientos de la caja con `numero` de 1 a `cierre.movimientosHasta`, por `numero`. */
  readonly movimientos: readonly MovimientoCaja[];
}

/** Lo que el servicio necesita del generador; el módulo provee `GENERADOR_PDF_CIERRE` con `generarPdfCierre` y las pruebas lo reemplazan. */
export interface GeneradorPdfCierre {
  generar(datos: DatosPdfCierre): Promise<Buffer>;
}

/** El token de Nest del generador (PQ8): `overrideProvider(GENERADOR_PDF_CIERRE)` en las pruebas de integración. */
export const GENERADOR_PDF_CIERRE = Symbol('GENERADOR_PDF_CIERRE');

const MARGEN = 40;
const FUENTE = 'Helvetica';
const FUENTE_NEGRITA = 'Helvetica-Bold';

const NOMBRE_DE_CONCEPTO: Readonly<Record<MovimientoCaja['concepto'], string>> = {
  INSCRIPCION: 'Inscripción',
  MENSUALIDAD: 'Mensualidad',
  CLASE_PARTICULAR: 'Clase particular',
  EGRESO_MENOR: 'Egreso menor',
};

const NOMBRE_DE_METODO: Readonly<Record<MetodoPago, string>> = {
  EFECTIVO: 'Efectivo',
  YAPE: 'Yape',
  TRANSFERENCIA: 'Transferencia',
};

const NOMBRE_DE_RESULTADO: Readonly<Record<ResultadoCierre, string>> = {
  CUADRA: 'Cuadra',
  SOBRANTE: 'Sobrante',
  FALTANTE: 'Faltante',
};

interface Columna {
  readonly titulo: string;
  readonly ancho: number;
  readonly alinear: 'left' | 'right';
}

/** Las siete columnas de los movimientos: suman 515 puntos, el ancho útil de una hoja A4 con márgenes de 40. */
const COLUMNAS: readonly Columna[] = [
  { titulo: 'N°', ancho: 24, alinear: 'left' },
  { titulo: 'Hora', ancho: 34, alinear: 'left' },
  { titulo: 'Tipo', ancho: 44, alinear: 'left' },
  { titulo: 'Concepto o descripción', ancho: 150, alinear: 'left' },
  { titulo: 'Método', ancho: 62, alinear: 'left' },
  { titulo: 'Alumno o comprobante', ancho: 130, alinear: 'left' },
  { titulo: 'Monto', ancho: 71, alinear: 'right' },
];

const RELLENO_DE_CELDA = 2;

const nombreCompleto = (persona: PersonaCaja): string => `${persona.nombres} ${persona.apellidos}`;

/** La diferencia con su signo y su resultado: `-S/ 4.50 (Faltante)`, `S/ 0.30 (Sobrante)`, `S/ 0.00 (Cuadra)` (PQ10). */
function textoDeDiferencia(diferencia: string, resultado: ResultadoCierre): string {
  const negativa = diferencia.startsWith('-');
  const sinSigno = negativa ? diferencia.slice(1) : diferencia;
  return `${negativa ? '-' : ''}${formatearSoles(sinSigno)} (${NOMBRE_DE_RESULTADO[resultado]})`;
}

/** Las celdas de un movimiento, en el orden de `COLUMNAS` (PQ10). */
function celdasDeMovimiento(movimiento: MovimientoCaja): string[] {
  const esIngreso = movimiento.tipo === 'INGRESO';
  const conceptoODescripcion = esIngreso
    ? NOMBRE_DE_CONCEPTO[movimiento.concepto]
    : (movimiento.descripcion ?? NOMBRE_DE_CONCEPTO[movimiento.concepto]);
  const alumnoOComprobante = esIngreso
    ? movimiento.alumno === null
      ? ''
      : nombreCompleto(movimiento.alumno)
    : (movimiento.comprobante ?? 'Sin comprobante');
  return [
    String(movimiento.numero),
    horaEnLima(new Date(movimiento.registradoEn)),
    esIngreso ? 'Ingreso' : 'Egreso',
    conceptoODescripcion,
    NOMBRE_DE_METODO[movimiento.metodo],
    alumnoOComprobante,
    formatearSoles(movimiento.monto),
  ].map(textoParaPdf);
}

type Documento = InstanceType<typeof PDFDocument>;

/** Una línea (o párrafo) a todo el ancho, debajo de lo último escrito. */
function linea(doc: Documento, texto: string, fuente: string = FUENTE, tamano = 10): void {
  doc
    .font(fuente)
    .fontSize(tamano)
    .text(textoParaPdf(texto), MARGEN, doc.y, { width: doc.page.width - 2 * MARGEN });
}

function filaDeTabla(doc: Documento, celdas: readonly string[], y: number, fuente: string): number {
  doc.font(fuente).fontSize(8);
  let alto = 0;
  COLUMNAS.forEach((columna, indice) => {
    alto = Math.max(
      alto,
      doc.heightOfString(celdas[indice] ?? '', { width: columna.ancho - 2 * RELLENO_DE_CELDA, align: columna.alinear }),
    );
  });
  alto += 2 * RELLENO_DE_CELDA;
  let x = MARGEN;
  COLUMNAS.forEach((columna, indice) => {
    doc.text(celdas[indice] ?? '', x + RELLENO_DE_CELDA, y + RELLENO_DE_CELDA, {
      width: columna.ancho - 2 * RELLENO_DE_CELDA,
      align: columna.alinear,
    });
    x += columna.ancho;
  });
  return alto;
}

function encabezadoDeTabla(doc: Documento, y: number): number {
  const alto = filaDeTabla(
    doc,
    COLUMNAS.map((columna) => textoParaPdf(columna.titulo)),
    y,
    FUENTE_NEGRITA,
  );
  const base = y + alto;
  doc
    .moveTo(MARGEN, base)
    .lineTo(doc.page.width - MARGEN, base)
    .lineWidth(0.5)
    .stroke();
  return alto;
}

/** La tabla de los movimientos; cuando una fila no cabe en la página, sigue en la siguiente con su encabezado. */
function tabla(doc: Documento, movimientos: readonly MovimientoCaja[]): void {
  const limite = doc.page.height - doc.page.margins.bottom;
  let y = doc.y;
  y += encabezadoDeTabla(doc, y);
  for (const movimiento of movimientos) {
    const celdas = celdasDeMovimiento(movimiento);
    doc.font(FUENTE).fontSize(8);
    const alto =
      Math.max(
        ...COLUMNAS.map((columna, indice) =>
          doc.heightOfString(celdas[indice] ?? '', {
            width: columna.ancho - 2 * RELLENO_DE_CELDA,
            align: columna.alinear,
          }),
        ),
      ) +
      2 * RELLENO_DE_CELDA;
    if (y + alto > limite) {
      doc.addPage();
      y = doc.page.margins.top;
      y += encabezadoDeTabla(doc, y);
    }
    y += filaDeTabla(doc, celdas, y, FUENTE);
  }
  doc.x = MARGEN;
  doc.y = y + 6;
}

function dibujar(doc: Documento, datos: DatosPdfCierre): void {
  const { caja, cierre } = datos;
  linea(doc, datos.academia, FUENTE_NEGRITA, 16);
  linea(doc, 'Cierre de caja', FUENTE_NEGRITA, 13);
  linea(doc, `Caja del ${caja.fecha.split('-').reverse().join('/')}`, FUENTE, 11);
  linea(doc, `Cierre ${cierre.numero}`, FUENTE_NEGRITA, 11);
  if (cierre.tardio) linea(doc, 'Cierre tardío', FUENTE_NEGRITA, 11);
  doc.moveDown(0.6);
  linea(doc, `Abierta por ${nombreCompleto(caja.abiertaPor)} a las ${horaEnLima(new Date(caja.abiertaEn))}`);
  linea(doc, `Monto inicial: ${formatearSoles(caja.montoInicial)}`);
  doc.moveDown(0.8);

  linea(doc, 'Movimientos', FUENTE_NEGRITA, 11);
  doc.moveDown(0.3);
  if (datos.movimientos.length === 0) linea(doc, 'Sin movimientos');
  else tabla(doc, datos.movimientos);
  doc.moveDown(0.5);

  linea(doc, 'Totales', FUENTE_NEGRITA, 11);
  linea(doc, `Ingresos en efectivo: ${formatearSoles(cierre.ingresos.efectivo)}`);
  linea(doc, `Ingresos por Yape: ${formatearSoles(cierre.ingresos.yape)}`);
  linea(doc, `Ingresos por transferencia: ${formatearSoles(cierre.ingresos.transferencia)}`);
  linea(doc, `Egresos: ${formatearSoles(cierre.egresos.efectivo)}`);
  linea(doc, `Esperado en efectivo: ${formatearSoles(cierre.esperado.efectivo)}`);
  linea(doc, `Declarado: ${formatearSoles(cierre.montoDeclarado)}`);
  linea(doc, `Diferencia: ${textoDeDiferencia(cierre.diferencia, cierre.resultado)}`, FUENTE_NEGRITA);
  if (cierre.observacion !== null) linea(doc, `Observación: ${cierre.observacion}`);
  doc.moveDown(0.6);

  linea(
    doc,
    `Cerrado por ${nombreCompleto(cierre.cerradoPor)} el ${fechaCortaEnLima(new Date(cierre.cerradoEn))} a las ${horaEnLima(new Date(cierre.cerradoEn))}`,
  );
  if (cierre.reapertura !== null) {
    const reabiertaEn = new Date(cierre.reapertura.reabiertaEn);
    linea(
      doc,
      `Reabierto por ${nombreCompleto(cierre.reapertura.reabiertaPor)} el ${fechaCortaEnLima(reabiertaEn)} a las ${horaEnLima(reabiertaEn)}`,
    );
    linea(doc, `Motivo: ${cierre.reapertura.motivo}`);
  }
}

/**
 * Arma el PDF del cierre (A4, Helvetica) y lo devuelve completo en un `Buffer`; no toca la base ni el disco. Rechaza si `pdfkit` falla.
 * `info.Title` es `Cierre de caja AAAA-MM-DD N`, sin textos de usuarios, y `info.CreationDate` es `cerradoEn`; van en el constructor porque
 * `pdfkit` calcula el `/ID` del documento ahí (PQ9 d).
 */
export function generarPdfCierre(datos: DatosPdfCierre): Promise<Buffer> {
  return new Promise<Buffer>((resolver, rechazarConCualquierCosa) => {
    const rechazar = (error: unknown) =>
      rechazarConCualquierCosa(
        error instanceof Error ? error : new Error('No se pudo armar el PDF del cierre.', { cause: error }),
      );
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: MARGEN,
        info: {
          Title: `Cierre de caja ${datos.caja.fecha} ${datos.cierre.numero}`,
          CreationDate: new Date(datos.cierre.cerradoEn),
        },
      });
      const partes: Buffer[] = [];
      doc.on('data', (parte: Buffer) => partes.push(parte));
      doc.on('end', () => resolver(Buffer.concat(partes)));
      doc.on('error', rechazar);
      dibujar(doc, datos);
      doc.end();
    } catch (error) {
      rechazar(error);
    }
  });
}
