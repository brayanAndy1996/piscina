import { randomBytes } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { type Carnet, contenidoQr } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import { generarPdfCarnet } from './carnet-pdf';

// Spec 008a, criterios 11 y 12 (prueba no protegida del dibujo): el generador real arma un PDF con forma de PDF, una imagen (el QR), sin el texto del
// token ni `AQ1:` y con los metadatos sin datos personales; sin QR escribe el aviso; un nombre largo no rompe el documento.

const token = randomBytes(32).toString('base64url');
const GENERADO_EN = new Date('2026-11-25T15:00:00.000Z');

const carnet = (cambios: Partial<Carnet> = {}): Carnet => ({
  academia: { nombre: 'Academia de Prueba' },
  alumno: {
    id: '5f9b3c1e-6d3a-4a52-9d57-0c1a3b2e4f10',
    nombres: 'Valeria',
    apellidos: 'Mendoza Salas',
    dni: '47811902',
    nivel: 'BASICO',
    estado: 'ALUMNO_ACTIVO',
  },
  foto: null,
  matricula: {
    plan: 'Plan 3 por semana',
    clases: [
      { diaSemana: 2, horaInicio: '18:00', horaFin: '19:00' },
      { diaSemana: 4, horaInicio: '18:00', horaFin: '19:00' },
    ],
    desde: '2026-11-01',
    hasta: '2026-11-30',
    vigenteHoy: true,
  },
  qr: { contenido: contenidoQr(token), generadoEn: '2026-11-11T15:00:00.000Z' },
  ...cambios,
});

/** Los flujos del PDF descomprimidos (los que no se pueden descomprimir, tal cual), como texto latin1. */
function flujos(pdf: Buffer): string {
  const texto = pdf.toString('latin1');
  const partes: string[] = [];
  let desde = 0;
  for (;;) {
    const marca = texto.indexOf('stream', desde);
    if (marca === -1) break;
    desde = marca + 6;
    if (texto.startsWith('end', marca - 3)) continue;
    let inicio = marca + 6;
    if (texto.startsWith('\r\n', inicio)) inicio += 2;
    else if (texto.startsWith('\n', inicio)) inicio += 1;
    const fin = texto.indexOf('endstream', inicio);
    if (fin === -1) break;
    desde = fin + 9;
    try {
      partes.push(inflateSync(pdf.subarray(inicio, fin)).toString('latin1'));
    } catch {
      partes.push(pdf.subarray(inicio, fin).toString('latin1'));
    }
  }
  return partes.join('\n');
}

/** El texto que dibuja el PDF: las cadenas hexadecimales de cada operador `TJ`, unidas (el kerning las parte), una línea por operador. */
function texto(pdf: Buffer): string {
  const lineas: string[] = [];
  for (const operador of flujos(pdf).matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    const partes = [...(operador[1] ?? '').matchAll(/<([0-9a-fA-F]*)>/g)].map((parte) =>
      Buffer.from(parte[1] ?? '', 'hex').toString('latin1'),
    );
    lineas.push(partes.join(''));
  }
  return lineas.join('\n');
}

const datos = (cambios: Partial<Carnet> = {}, contenido: string | null = contenidoQr(token)) => ({
  carnet: carnet(cambios),
  contenidoQr: contenido,
  fechaDatos: '25/11/2026',
  generadoEn: GENERADO_EN,
});

describe('generarPdfCarnet', () => {
  it('arma un PDF A4 con una imagen (el QR), la fecha de los datos y sin el token como texto', async () => {
    const pdf = await generarPdfCarnet(datos());

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
    // El QR es una imagen PNG con su máscara de transparencia: una o dos imágenes en el PDF, nunca ninguna.
    expect((pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length).toBeGreaterThanOrEqual(1);
    const todo = `${pdf.toString('latin1')}\n${flujos(pdf)}`;
    expect(todo).not.toContain(token);
    expect(todo).not.toContain('AQ1:');
    expect(texto(pdf)).toContain('Datos al 25/11/2026');
  });

  it('los metadatos son solo el título: sin nombres, DNI ni token', async () => {
    const pdf = (await generarPdfCarnet(datos())).toString('latin1');
    const referencia = /\/Title (\d+) 0 R/.exec(pdf)?.[1];

    expect(referencia).toBeDefined();
    expect(pdf).toMatch(new RegExp(`\\n${referencia} 0 obj\\n\\(Carnet\\)\\nendobj`));
    expect(pdf).not.toMatch(/\/Author|\/Subject|\/Keywords/);
  });

  it('sin QR no dibuja ninguna imagen y escribe el aviso', async () => {
    const pdf = await generarPdfCarnet(datos({ qr: null }, null));

    expect(pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).toHaveLength(0);
    expect(texto(pdf)).toContain('QR sin generar');
  });

  it('un nombre larguísimo, con emojis y comillas curvas, no rompe el documento', async () => {
    const largo = 'María ❤️ “José” '.repeat(30);
    const pdf = await generarPdfCarnet(
      datos({ alumno: { ...carnet().alumno, nombres: largo, apellidos: largo }, academia: { nombre: largo } }),
    );

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(texto(pdf)).toContain('...');
  });

  it('con una foto que no se puede dibujar, sigue con «Foto pendiente»', async () => {
    const pdf = await generarPdfCarnet(datos({ foto: 'data:image/jpeg;base64,AAAA' }));

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(texto(pdf)).toContain('Foto pendiente');
  });

  it('sin matrícula dice «Sin matrícula»', async () => {
    const pdf = await generarPdfCarnet(datos({ matricula: null }));

    expect(texto(pdf)).toContain('Sin matrícula');
  });
});
