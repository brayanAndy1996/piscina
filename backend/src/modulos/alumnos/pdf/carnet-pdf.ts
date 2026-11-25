import { type Carnet, NOMBRE_NIVEL, OPCIONES_QR, resumenDeHorario } from '@aquagestion/contratos';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { textoParaPdf } from '../../caja/pdf/texto-pdf';

/**
 * El PDF del carnet (spec 008a, criterios 11 y 12; HU-13; DR-1 a DR-3; DT-9). Una hoja A4 con la tarjeta de 85,6 × 54 mm (como una tarjeta
 * bancaria) y una línea punteada para recortarla, y debajo «Datos al dd/mm/aaaa»: el carnet impreso lleva lo que dice HU-13 tal como está el día
 * de la descarga, pero el QR sigue sirviendo aunque el plan, el horario o la vigencia cambien (DR-2). El DNI va completo (DR-3).
 *
 * El QR se dibuja con `qrcode` y las mismas opciones que la web (`OPCIONES_QR`, DT-5) a partir de `contenidoQr`, el mismo texto que devuelve el
 * carnet: el token solo va dentro de la imagen, nunca como texto del PDF. Los metadatos del documento son solo el título: sin nombres, DNI ni
 * token. Todo texto que sale de los datos pasa por `textoParaPdf` (la fuente estándar solo muestra Latin-1 y el texto se escribe codificado, así
 * que ningún dato puede cambiar la estructura del PDF). Se arma en memoria, sin cola (una página, DT-9).
 */

/** Lo que el servicio entrega al generador. `contenidoQr` es `AQ1:` + el token guardado, o `null` si el alumno no tiene QR (criterio 10). */
export interface DatosPdfCarnet {
  readonly carnet: Carnet;
  readonly contenidoQr: string | null;
  /** La fecha de los datos, `dd/mm/aaaa` en America/Lima. */
  readonly fechaDatos: string;
  /** El instante de la descarga (la fecha de creación del documento). */
  readonly generadoEn: Date;
}

/** El generador que el módulo provee con `GENERADOR_PDF_CARNET` y que las pruebas reemplazan. */
export interface GeneradorPdfCarnet {
  generar(datos: DatosPdfCarnet): Promise<Buffer>;
}

export const GENERADOR_PDF_CARNET = Symbol('GENERADOR_PDF_CARNET');

const FUENTE = 'Helvetica';
const FUENTE_NEGRITA = 'Helvetica-Bold';
/** Puntos por milímetro (72 / 25,4). */
const PT_POR_MM = 72 / 25.4;
const ANCHO_TARJETA = 85.6 * PT_POR_MM;
const ALTO_TARJETA = 54 * PT_POR_MM;
const MENSAJE_SIN_QR = 'QR sin generar: pide en recepción que lo generen';

/** `AAAA-MM-DD` → `dd/mm/aaaa`. */
function fechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return `${dia ?? ''}/${mes ?? ''}/${anio ?? ''}`;
}

/** El texto de los datos, ya seguro para la fuente estándar, cortado con «...» para que quepa en `maxLineas` líneas del ancho dado. */
function ajustado(doc: PDFKit.PDFDocument, texto: string, ancho: number, maxLineas: number): string {
  const limpio = textoParaPdf(texto);
  const alto = (valor: string): number => doc.heightOfString(valor, { width: ancho });
  const maximo = doc.currentLineHeight(true) * maxLineas + 0.5;
  if (alto(limpio) <= maximo) return limpio;
  let corte = limpio.length;
  while (corte > 0 && alto(`${limpio.slice(0, corte).trimEnd()}...`) > maximo) corte -= 1;
  return `${limpio.slice(0, corte).trimEnd()}...`;
}

function dibujarFoto(
  doc: PDFKit.PDFDocument,
  foto: string | null,
  x: number,
  y: number,
  ancho: number,
  alto: number,
): void {
  doc.save().lineWidth(0.5).strokeColor('#888888').rect(x, y, ancho, alto).stroke().restore();
  if (foto !== null) {
    try {
      const bytes = Buffer.from(foto.slice(foto.indexOf(',') + 1), 'base64');
      doc.image(bytes, x + 1, y + 1, { fit: [ancho - 2, alto - 2], align: 'center', valign: 'center' });
      return;
    } catch {
      // Una imagen que no se puede dibujar se muestra como «Foto pendiente».
    }
  }
  doc
    .font(FUENTE)
    .fontSize(7)
    .fillColor('#555555')
    .text('Foto pendiente', x, y + alto / 2 - 4, { width: ancho, align: 'center', lineBreak: false });
}

async function dibujarQr(
  doc: PDFKit.PDFDocument,
  contenido: string | null,
  x: number,
  y: number,
  lado: number,
): Promise<void> {
  if (contenido === null) {
    doc
      .font(FUENTE)
      .fontSize(6.5)
      .fillColor('#555555')
      .text(textoParaPdf(MENSAJE_SIN_QR), x, y + lado / 2 - 12, { width: lado, align: 'center' });
    return;
  }
  const imagen = await QRCode.toBuffer(contenido, { ...OPCIONES_QR, type: 'png', width: 400 });
  doc.image(imagen, x, y, { width: lado, height: lado });
}

/** Arma el PDF del carnet en memoria. Rechaza si no se puede dibujar (el servicio responde 500 y no cambia nada). */
export async function generarPdfCarnet(datos: DatosPdfCarnet): Promise<Buffer> {
  const { carnet } = datos;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: { Title: 'Carnet', CreationDate: datos.generadoEn },
  });
  const partes: Buffer[] = [];
  const terminado = new Promise<Buffer>((resolver, rechazar) => {
    doc.on('data', (parte: Buffer) => partes.push(parte));
    doc.on('end', () => resolver(Buffer.concat(partes)));
    doc.on('error', rechazar);
  });

  try {
    const x = (doc.page.width - ANCHO_TARJETA) / 2;
    const y = 70;

    doc
      .font(FUENTE_NEGRITA)
      .fontSize(11)
      .fillColor('#000000')
      .text('Carnet digital', 40, 36, { width: doc.page.width - 80, align: 'center' });
    doc
      .font(FUENTE)
      .fontSize(8)
      .fillColor('#555555')
      .text('Recorta la tarjeta por la línea punteada.', 40, 50, { width: doc.page.width - 80, align: 'center' });

    // La tarjeta, con su línea de corte punteada (DR-1).
    doc
      .save()
      .lineWidth(0.6)
      .strokeColor('#444444')
      .dash(3, { space: 3 })
      .rect(x, y, ANCHO_TARJETA, ALTO_TARJETA)
      .stroke()
      .undash()
      .restore();

    // Encabezado: la academia.
    doc.font(FUENTE_NEGRITA).fontSize(9).fillColor('#000000');
    doc.text(ajustado(doc, carnet.academia.nombre, ANCHO_TARJETA - 16, 1), x + 8, y + 7, {
      width: ANCHO_TARJETA - 16,
      lineBreak: false,
    });

    // La foto, a la izquierda.
    dibujarFoto(doc, carnet.foto, x + 8, y + 24, 58, 74);

    // Los datos del alumno, a la derecha de la foto.
    const xTexto = x + 74;
    const anchoTexto = ANCHO_TARJETA - 74 - 8;
    doc.font(FUENTE_NEGRITA).fontSize(8.5).fillColor('#000000');
    const nombre = ajustado(doc, `${carnet.alumno.nombres} ${carnet.alumno.apellidos}`, anchoTexto, 2);
    doc.text(nombre, xTexto, y + 24, { width: anchoTexto });
    let yActual = doc.y + 2;
    doc.font(FUENTE).fontSize(7.5).fillColor('#000000');
    doc.text(`DNI: ${textoParaPdf(carnet.alumno.dni)}`, xTexto, yActual, { width: anchoTexto, lineBreak: false });
    yActual = doc.y + 1;
    doc.text(`Nivel: ${NOMBRE_NIVEL[carnet.alumno.nivel]}`, xTexto, yActual, { width: anchoTexto, lineBreak: false });
    yActual = doc.y + 1;

    // Plan, horario y vigencia, y el QR a la derecha y abajo.
    const lado = 62;
    const xQr = x + ANCHO_TARJETA - 8 - lado;
    const yQr = y + ALTO_TARJETA - 6 - lado;
    const anchoDatos = xQr - xTexto - 4;
    if (carnet.matricula) {
      const { plan, clases, desde, hasta } = carnet.matricula;
      doc.font(FUENTE).fontSize(7);
      doc.text(ajustado(doc, `Plan: ${plan}`, anchoTexto, 2), xTexto, yActual, { width: anchoTexto });
      yActual = doc.y + 1;
      doc.text(ajustado(doc, `Horario: ${resumenDeHorario(clases)}`, anchoDatos, 3), xTexto, yActual, {
        width: anchoDatos,
      });
      yActual = doc.y + 1;
      doc.text(`Vigencia: ${fechaCorta(desde)} al ${fechaCorta(hasta)}`, xTexto, yActual, { width: anchoDatos });
    } else {
      doc.font(FUENTE).fontSize(7).text('Sin matrícula', xTexto, yActual, { width: anchoTexto, lineBreak: false });
    }
    await dibujarQr(doc, datos.contenidoQr, xQr, yQr, lado);

    // Fuera de la tarjeta: la fecha de los datos (DR-2).
    doc
      .font(FUENTE)
      .fontSize(8)
      .fillColor('#555555')
      .text(`Datos al ${textoParaPdf(datos.fechaDatos)}`, 40, y + ALTO_TARJETA + 10, {
        width: doc.page.width - 80,
        align: 'center',
      });
    doc.end();
  } catch (error) {
    // El documento queda sin terminar y se descarta; no se deja ninguna promesa colgada.
    terminado.catch(() => undefined);
    throw error;
  }
  return terminado;
}
