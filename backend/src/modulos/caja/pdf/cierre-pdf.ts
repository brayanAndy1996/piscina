import {
  type Caja,
  type CierreCaja,
  formatearSoles,
  type MetodoPago,
  type MovimientoCaja,
  type PersonaCaja,
  type ResultadoCierre,
} from '@aquagestion/contratos';
import { performance } from 'node:perf_hooks';
import PDFDocument from 'pdfkit';
import { fechaCortaEnLima, horaEnLima } from '../../../comun/fechas';
import { errorDeAborto, esErrorDeAborto } from './aborto';
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
 * No detiene la API (criterio 49 a, plan 2.12): el documento se dibuja en el hilo principal pero por tramos de unos 5 ms medidos con el reloj
 * (`TRAMO_MS`); entre un tramo y el siguiente se cede el bucle con `setImmediate`, así las demás peticiones (de cualquier academia) avanzan
 * mientras se arma un PDF grande. Se cede solo entre filas de la tabla, nunca entre dos llamadas que dependan una de otra, y las llamadas a
 * `pdfkit` son las mismas y en el mismo orden que sin tramos: los bytes no cambian. No hay un `worker_thread`: no toca el build ni el cargador de
 * las pruebas.
 *
 * Se puede abandonar (criterio 51 b y c): `generarPdfCierre(datos, senal?)` comprueba la señal al empezar y entre tramos; con la señal activa deja de
 * dibujar, no termina el documento (nada se escribe ni se guarda) y rechaza con un `AbortError`. La comprobación no llama a `pdfkit`, así que sin
 * señal, o con una que nunca se activa, los bytes son los mismos.
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
  /** `senal` (criterio 51 c) es opcional: un generador que la ignora sigue siendo válido, y su lugar en la cola se libera cuando termina. */
  generar(datos: DatosPdfCierre, senal?: AbortSignal): Promise<Buffer>;
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

/**
 * Cuánto trabaja el generador seguido antes de ceder el bucle de eventos (criterio 49 a, plan 2.12): unos 5 ms, medidos por tiempo y no por filas.
 * Con 2 generaciones a la vez, cada vuelta del bucle corre un tramo de cada una, y cada ida y vuelta a la base de otra petición espera esa suma.
 * Medido con la prueba del 49 a (5 000 movimientos, 3 descargas): con tramos de 10 ms el egreso de otra academia tardaba unos 580 ms (el límite
 * es 1 000); con 5 ms, unos 330 ms; con 4 ms, unos 250 ms. El retraso máximo del bucle es de unos 25 ms en los tres casos (el límite es 200).
 */
const TRAMO_MS = 5;

/** Cede el bucle de eventos (deja correr lo que esté esperando: otras peticiones, la base, los temporizadores) y sigue en la siguiente vuelta. */
const cederElBucle = (): Promise<void> => new Promise((resolver) => setImmediate(resolver));

/**
 * Mide el tramo en curso: `cederSiToca` cede el bucle cuando el tramo ya duró `TRAMO_MS` y empieza otro. Una instancia por documento, así que dos
 * generaciones a la vez no comparten el reloj. Después de ceder (que es cuando la señal puede haberse activado), comprueba la señal y lanza el
 * `AbortError` (criterio 51 b).
 */
class Tramos {
  private inicio = performance.now();

  constructor(private readonly senal?: AbortSignal) {}

  async cederSiToca(): Promise<void> {
    if (performance.now() - this.inicio < TRAMO_MS) return;
    await cederElBucle();
    this.comprobarSenal();
    this.inicio = performance.now();
  }

  /** Lanza un `AbortError` si la señal ya está activa. */
  comprobarSenal(): void {
    if (this.senal?.aborted) throw errorDeAborto();
  }
}

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

/** La tabla de los movimientos; cuando una fila no cabe en la página, sigue en la siguiente con su encabezado. Cede el bucle entre filas. */
async function tabla(doc: Documento, movimientos: readonly MovimientoCaja[], tramos: Tramos): Promise<void> {
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
    await tramos.cederSiToca();
  }
  doc.x = MARGEN;
  doc.y = y + 6;
}

async function dibujar(doc: Documento, datos: DatosPdfCierre, tramos: Tramos): Promise<void> {
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
  else await tabla(doc, datos.movimientos, tramos);
  tramos.comprobarSenal();
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
 * Arma el PDF del cierre (A4, Helvetica) y lo devuelve completo en un `Buffer`; no toca la base ni el disco. Rechaza si `pdfkit` falla. Cede el
 * bucle de eventos por tramos (criterio 49 a): la promesa se resuelve cuando el documento termina, no en la misma vuelta.
 * `info.Title` es `Cierre de caja AAAA-MM-DD N`, sin textos de usuarios, y `info.CreationDate` es `cerradoEn`; van en el constructor porque
 * `pdfkit` calcula el `/ID` del documento ahí (PQ9 d).
 *
 * Con `senal` (criterio 51 b y c): si ya está activa al empezar, o se activa mientras se arma, rechaza con un `AbortError` sin terminar el documento
 * (no llama a `doc.end()`: el documento queda sin terminar y se descarta). Nunca lanza de forma síncrona.
 */
export function generarPdfCierre(datos: DatosPdfCierre, senal?: AbortSignal): Promise<Buffer> {
  return new Promise<Buffer>((resolver, rechazarConCualquierCosa) => {
    const rechazar = (error: unknown) => {
      if (error instanceof Error) rechazarConCualquierCosa(error);
      else if (esErrorDeAborto(error)) rechazarConCualquierCosa(errorDeAborto());
      else rechazarConCualquierCosa(new Error('No se pudo armar el PDF del cierre.', { cause: error }));
    };
    try {
      if (senal?.aborted) throw errorDeAborto();
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
      const tramos = new Tramos(senal);
      dibujar(doc, datos, tramos)
        .then(() => {
          tramos.comprobarSenal();
          doc.end();
        })
        .catch(rechazar);
    } catch (error) {
      rechazar(error);
    }
  });
}
