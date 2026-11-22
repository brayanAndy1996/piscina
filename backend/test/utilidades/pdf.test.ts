// spec: 006-caja (pruebas protegidas)
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { contarPaginasPdf, extraerTextoPdf, fechaDePdf, leerInfoPdf, tieneFormaDePdf } from './pdf';

// Prueba de la utilidad `pdf.ts` (PQ10 de la 006b): extrae las cadenas de `Tj` y `TJ` (literales y hexadecimales, con los ajustes entre
// cadenas), pasa de WinAnsi a Unicode, lee `Title` y `CreationDate` y reconoce la forma de un PDF. Los documentos de esta prueba se arman a
// mano (no usan `pdfkit`, que todavía no es dependencia del backend), con la misma estructura que escribe `pdfkit`: un flujo de contenido
// comprimido con `FlateDecode` y un diccionario de información.

function pdfDe(contenido: string, info = '', comprimir = true): Buffer {
  const datos = comprimir ? deflateSync(Buffer.from(contenido, 'latin1')) : Buffer.from(contenido, 'latin1');
  const filtro = comprimir ? '/Filter /FlateDecode\n' : '';
  return Buffer.concat([
    Buffer.from(`%PDF-1.3\n5 0 obj\n<<\n/Length ${datos.length}\n${filtro}>>\nstream\n`, 'latin1'),
    datos,
    Buffer.from(
      `\nendstream\nendobj\n10 0 obj\n<<\n${info}>>\nendobj\ntrailer\n<<\n/Root 3 0 R\n>>\n%%EOF\n`,
      'latin1',
    ),
  ]);
}

describe('pdf.ts: extraerTextoPdf', () => {
  it('une las cadenas hexadecimales de un TJ y descarta los ajustes entre ellas', () => {
    const pdf = pdfDe('BT\n/F1 10 Tf\n[<4162696572> -40 <746120706f72> 0] TJ\nET\n');

    expect(extraerTextoPdf(pdf).lineas).toEqual(['Abierta por']);
  });

  it('lee las cadenas literales de Tj y TJ con sus escapes (paréntesis, barra, octales)', () => {
    const pdf = pdfDe('BT\n(a \\(b\\) \\\\ c) Tj\n[(Pi\\361a) 10 ( \\321and\\372)] TJ\n(\\101) Tj\nET\n');

    expect(extraerTextoPdf(pdf).lineas).toEqual(['a (b) \\ c', 'Piña Ñandú', 'A']);
  });

  it('pasa de WinAnsi a Unicode: Latin-1 directo y la zona 0x80 a 0x9F (euro, comillas curvas)', () => {
    const pdf = pdfDe('BT\n[<c1e9ee8091929394>] TJ\nET\n');

    expect(extraerTextoPdf(pdf).lineas).toEqual(['Áéî€‘’“”']);
  });

  it('devuelve una línea por operador, en orden, y el texto unido con saltos de línea', () => {
    const pdf = pdfDe('BT\n[<31>] TJ\n[<32>] TJ\n(3) Tj\nET\n');

    const { lineas, texto } = extraerTextoPdf(pdf);

    expect(lineas).toEqual(['1', '2', '3']);
    expect(texto).toBe('1\n2\n3');
  });

  it('lee un flujo sin comprimir y varios flujos', () => {
    const sinComprimir = pdfDe('BT\n[<486f6c61>] TJ\nET\n', '', false);
    const dos = Buffer.concat([pdfDe('BT\n(uno) Tj\nET\n'), pdfDe('BT\n(dos) Tj\nET\n')]);

    expect(extraerTextoPdf(sinComprimir).texto).toBe('Hola');
    expect(extraerTextoPdf(dos).lineas).toEqual(['uno', 'dos']);
  });

  it('un texto que parece un operador de PDF se lee como texto, no como operador', () => {
    const pdf = pdfDe('BT\n[<29205469202f46> 0] TJ\n(\\) Tj \\(x) Tj\nET\n');

    expect(extraerTextoPdf(pdf).lineas).toEqual([') Ti /F', ') Tj (x']);
  });

  it('un documento sin texto da cero líneas', () => {
    expect(extraerTextoPdf(pdfDe('q\n1 0 0 1 0 0 cm\nQ\n')).lineas).toEqual([]);
  });
});

describe('pdf.ts: información y forma del archivo', () => {
  it('lee Title y CreationDate (con Z, con desfase y con zona ausente)', () => {
    const info = '/Producer (PDFKit)\n/CreationDate (D:20261102230000Z)\n/Title (Cierre de caja 2026-11-02 1)\n';

    expect(leerInfoPdf(pdfDe('BT ET', info))).toEqual({
      Producer: 'PDFKit',
      CreationDate: new Date('2026-11-02T23:00:00.000Z'),
      Title: 'Cierre de caja 2026-11-02 1',
    });
    expect(fechaDePdf("D:20261102180000-05'00'")?.toISOString()).toBe('2026-11-02T23:00:00.000Z');
    expect(fechaDePdf('D:20261102230000')?.toISOString()).toBe('2026-11-02T23:00:00.000Z');
    expect(fechaDePdf('mañana')).toBeUndefined();
  });

  it('lee los campos que pdfkit escribe como objetos indirectos (/Title 14 0 R)', () => {
    const pdf = Buffer.from(
      [
        '%PDF-1.3',
        '10 0 obj',
        '<<',
        '/Producer 11 0 R',
        '/CreationDate 13 0 R',
        '/Title 14 0 R',
        '>>',
        'endobj',
        '11 0 obj',
        '(PDFKit)',
        'endobj',
        '13 0 obj',
        '(D:20261102230000Z)',
        'endobj',
        '14 0 obj',
        '(Cierre de caja 2026-11-02 1)',
        'endobj',
        '%%EOF',
      ].join('\n'),
      'latin1',
    );

    expect(leerInfoPdf(pdf)).toEqual({
      Producer: 'PDFKit',
      CreationDate: new Date('2026-11-02T23:00:00.000Z'),
      Title: 'Cierre de caja 2026-11-02 1',
    });
  });

  it('lee un título en UTF-16 hexadecimal', () => {
    const info = '/Title <FEFF00480069>\n';

    expect(leerInfoPdf(pdfDe('BT ET', info)).Title).toBe('Hi');
  });

  it('tieneFormaDePdf pide %PDF- al inicio y %%EOF al final, con o sin salto de línea', () => {
    const bueno = pdfDe('BT ET');

    expect(tieneFormaDePdf(bueno)).toBe(true);
    expect(tieneFormaDePdf(Buffer.from(bueno.toString('latin1').trimEnd(), 'latin1'))).toBe(true);
    expect(tieneFormaDePdf(Buffer.from('%PDF-1.3\nsin fin', 'latin1'))).toBe(false);
    expect(tieneFormaDePdf(Buffer.from('<html>%%EOF', 'latin1'))).toBe(false);
    expect(tieneFormaDePdf(Buffer.alloc(0))).toBe(false);
  });

  it('contarPaginasPdf cuenta /Type /Page y no /Type /Pages', () => {
    const pdf = Buffer.from(
      '%PDF-1.3\n<< /Type /Pages /Count 2 >>\n<< /Type /Page >>\n<< /Type /Page >>\n%%EOF',
      'latin1',
    );

    expect(contarPaginasPdf(pdf)).toBe(2);
  });
});
