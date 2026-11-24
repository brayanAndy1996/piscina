import type { CierreCaja, MovimientoCaja, PersonaCaja } from '@aquagestion/contratos';
import { afterEach, describe, expect, it } from 'vitest';
import { contarPaginasPdf, extraerTextoPdf, leerInfoPdf, tieneFormaDePdf } from '../../../../test/utilidades/pdf';
import { type DatosPdfCierre, generarPdfCierre } from './cierre-pdf';

// Spec 006b, criterio 42 y PQ10 (prueba obligatoria no protegida): el contenido del PDF del cierre, comprobado extrayendo el texto con la utilidad
// de pruebas `backend/test/utilidades/pdf.ts`. Son pruebas del generador solo, con datos armados a mano: no tocan la base. Las pruebas protegidas
// de integración (`pdf-*.test.ts`) cubren las rutas, el alcance, las cabeceras, el determinismo y los textos raros. Las pruebas corren con TZ=UTC.

const ZONA_ORIGINAL = process.env['TZ'];

afterEach(() => {
  if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ZONA_ORIGINAL;
});

const persona = (nombres: string, apellidos: string, id = '0b5f6b2e-2a1c-4e0e-8f55-7c0a9a1d2b33'): PersonaCaja => ({
  id,
  nombres,
  apellidos,
});

const LUCIA = persona('Lucia', 'Benites');
const ROSA = persona('Rosa', 'Alvarez', '1c6a7c3f-3b52-4d4b-9a40-0a7a3d6c9f12');
const ANA = persona('Ana María', 'Quispe Rojas', '2d7b8d4a-4c63-4e5c-8b51-1b8b4e7d0a23');

function movimiento(numero: number, cambios: Partial<MovimientoCaja>): MovimientoCaja {
  return {
    id: `3e8c9e5b-5d74-4f6d-9c62-2c9c5f8e1b${String(numero).padStart(2, '0')}`,
    numero,
    tipo: 'INGRESO',
    concepto: 'INSCRIPCION',
    metodo: 'EFECTIVO',
    monto: '42.00',
    descripcion: null,
    comprobante: null,
    alumno: ANA,
    registradoPor: ROSA,
    // 15:00 UTC = 10:00 en Lima.
    registradoEn: '2026-11-02T15:00:00.000Z',
    ...cambios,
  };
}

function cierre(cambios: Partial<CierreCaja> = {}): CierreCaja {
  return {
    numero: 1,
    cerradoPor: LUCIA,
    // 23:00 UTC = 18:00 en Lima.
    cerradoEn: '2026-11-02T23:00:00.000Z',
    montoInicial: '100.00',
    ingresos: { efectivo: '42.00', yape: '88.00', transferencia: '120.00' },
    egresos: { efectivo: '15.50' },
    esperado: { efectivo: '126.50', yape: '88.00', transferencia: '120.00' },
    montoDeclarado: '122.00',
    diferencia: '-4.50',
    resultado: 'FALTANTE',
    observacion: 'Faltó sencillo',
    tardio: false,
    movimientosHasta: 4,
    reapertura: null,
    ...cambios,
  };
}

function datos(cambios: Partial<DatosPdfCierre> = {}): DatosPdfCierre {
  return {
    academia: 'Delfines',
    caja: {
      id: '6f1c6d3e-3b52-4d4b-9a40-0a7a3d6c9f11',
      fecha: '2026-11-02',
      montoInicial: '100.00',
      abiertaPor: LUCIA,
      // 14:05 UTC = 09:05 en Lima.
      abiertaEn: '2026-11-02T14:05:00.000Z',
    },
    cierre: cierre(),
    movimientos: [
      movimiento(1, {}),
      movimiento(2, {
        metodo: 'YAPE',
        concepto: 'MENSUALIDAD',
        monto: '88.00',
        // 19:30 en Lima del mismo día = 00:30 UTC del siguiente.
        registradoEn: '2026-11-03T00:30:00.000Z',
      }),
      movimiento(3, { metodo: 'TRANSFERENCIA', concepto: 'CLASE_PARTICULAR', monto: '120.00' }),
      movimiento(4, {
        tipo: 'EGRESO',
        concepto: 'EGRESO_MENOR',
        monto: '15.50',
        descripcion: 'Compra de jabón',
        comprobante: 'Boleta 7',
        alumno: null,
      }),
    ],
    ...cambios,
  };
}

async function textoDe(entrada: DatosPdfCierre): Promise<string> {
  const pdf = await generarPdfCierre(entrada);
  expect(tieneFormaDePdf(pdf), 'empieza con %PDF- y termina con %%EOF').toBe(true);
  return extraerTextoPdf(pdf).texto;
}

describe('generarPdfCierre: contenido (PQ10)', () => {
  it('lleva el nombre de la academia, el título, la fecha de la caja, el número del cierre y quién abrió, con la hora de Lima', async () => {
    const texto = await textoDe(datos());

    for (const esperado of [
      'Delfines',
      'Cierre de caja',
      'Caja del 02/11/2026',
      'Cierre 1',
      'Abierta por Lucia Benites a las 09:05',
      'Monto inicial: S/ 100.00',
    ]) {
      expect(texto, esperado).toContain(esperado);
    }
    expect(texto).not.toContain('Cierre tardío');
    expect(texto).not.toContain('Reabierto por');
    expect(texto).not.toContain('Motivo:');
  });

  it('cada movimiento de 1 a movimientosHasta, en orden, con número, hora de Lima, tipo, concepto o descripción, método, alumno o comprobante y monto', async () => {
    const texto = await textoDe(datos());
    const lineas = texto.split('\n');

    for (const esperado of [
      'Ingreso',
      'Egreso',
      'Inscripción',
      'Mensualidad',
      'Clase particular',
      'Compra de jabón',
      'Efectivo',
      'Yape',
      'Transferencia',
      'Ana María Quispe Rojas',
      'Boleta 7',
      'S/ 42.00',
      'S/ 88.00',
      'S/ 120.00',
      'S/ 15.50',
      '10:00',
      '19:30',
    ]) {
      expect(lineas, esperado).toContain(esperado);
    }
    const posicion = (cadena: string) => lineas.indexOf(cadena);
    expect(posicion('Inscripción')).toBeLessThan(posicion('Mensualidad'));
    expect(posicion('Mensualidad')).toBeLessThan(posicion('Clase particular'));
    expect(posicion('Clase particular')).toBeLessThan(posicion('Compra de jabón'));
  });

  it('un egreso sin comprobante dice "Sin comprobante"', async () => {
    const entrada = datos({
      movimientos: [movimiento(1, { tipo: 'EGRESO', concepto: 'EGRESO_MENOR', descripcion: 'Escoba', alumno: null })],
      cierre: cierre({ movimientosHasta: 1 }),
    });

    expect(await textoDe(entrada)).toContain('Sin comprobante');
  });

  it('una caja sin movimientos lo dice y no escribe la tabla', async () => {
    const entrada = datos({
      movimientos: [],
      cierre: cierre({ movimientosHasta: 0, ingresos: { efectivo: '0.00', yape: '0.00', transferencia: '0.00' } }),
    });

    const texto = await textoDe(entrada);

    expect(texto).toContain('Sin movimientos');
    expect(texto).not.toContain('Concepto o descripción');
  });

  it('los totales por método, el esperado, el declarado, la diferencia con su signo y resultado, y la observación son los de la foto del cierre', async () => {
    const texto = await textoDe(datos());

    for (const esperado of [
      'Ingresos en efectivo: S/ 42.00',
      'Ingresos por Yape: S/ 88.00',
      'Ingresos por transferencia: S/ 120.00',
      'Egresos: S/ 15.50',
      'Esperado en efectivo: S/ 126.50',
      'Declarado: S/ 122.00',
      'Diferencia: -S/ 4.50 (Faltante)',
      'Observación: Faltó sencillo',
      'Cerrado por Lucia Benites el 02/11/2026 a las 18:00',
    ]) {
      expect(texto, esperado).toContain(esperado);
    }
  });

  it.each([
    ['0.30', 'SOBRANTE', 'Diferencia: S/ 0.30 (Sobrante)'],
    ['0.00', 'CUADRA', 'Diferencia: S/ 0.00 (Cuadra)'],
    ['-4.50', 'FALTANTE', 'Diferencia: -S/ 4.50 (Faltante)'],
    ['-1200.00', 'FALTANTE', 'Diferencia: -S/ 1,200.00 (Faltante)'],
  ] as const)('la diferencia %s (%s) se escribe "%s"', async (diferencia, resultado, esperado) => {
    const texto = await textoDe(datos({ cierre: cierre({ diferencia, resultado, observacion: null }) }));

    expect(texto).toContain(esperado);
    expect(texto).not.toContain('Observación:');
  });

  it('un cierre tardío lo dice', async () => {
    expect(await textoDe(datos({ cierre: cierre({ tardio: true }) }))).toContain('Cierre tardío');
  });

  it('el número del cierre sale en "Cierre N" y en el título del documento', async () => {
    const pdf = await generarPdfCierre(datos({ cierre: cierre({ numero: 12 }) }));

    expect(extraerTextoPdf(pdf).texto).toContain('Cierre 12');
    expect(leerInfoPdf(pdf).Title).toBe('Cierre de caja 2026-11-02 12');
  });

  it('un cierre reabierto lleva quién lo reabrió, cuándo (hora de Lima) y el motivo', async () => {
    const texto = await textoDe(
      datos({
        cierre: cierre({
          reapertura: { reabiertaPor: ROSA, reabiertaEn: '2026-11-03T00:15:00.000Z', motivo: 'Faltó contar un sobre' },
        }),
      }),
    );

    expect(texto).toContain('Reabierto por Rosa Alvarez el 02/11/2026 a las 19:15');
    expect(texto).toContain('Motivo: Faltó contar un sobre');
  });

  it('una caja abierta a las 19:30 de Lima (00:30 del día siguiente en UTC) muestra su fecha y su hora de Lima', async () => {
    const texto = await textoDe(
      datos({
        caja: { ...datos().caja, abiertaEn: '2026-11-03T00:30:00.000Z' },
        cierre: cierre({ cerradoEn: '2026-11-03T01:15:00.000Z' }),
      }),
    );

    expect(texto).toContain('Abierta por Lucia Benites a las 19:30');
    expect(texto).toContain('Cerrado por Lucia Benites el 02/11/2026 a las 20:15');
    expect(texto).not.toContain('03/11/2026');
    expect(texto).not.toContain('00:30');
  });

  it('nunca escribe un DNI, ni los ids de las personas', async () => {
    const pdf = await generarPdfCierre(datos());
    const crudo = pdf.toString('latin1');
    const texto = extraerTextoPdf(pdf).texto;

    for (const prohibido of [LUCIA.id, ROSA.id, ANA.id]) {
      expect(texto).not.toContain(prohibido);
      expect(crudo).not.toContain(prohibido);
    }
    expect(texto).not.toMatch(/\b\d{8}\b/);
  });

  it('un monto grande se escribe con coma de millares, sin perder precisión', async () => {
    const texto = await textoDe(
      datos({ cierre: cierre({ esperado: { efectivo: '9999999999.99', yape: '0.00', transferencia: '0.00' } }) }),
    );

    expect(texto).toContain('Esperado en efectivo: S/ 9,999,999,999.99');
  });
});

describe('generarPdfCierre: documento', () => {
  it('es una hoja A4, la fecha de creación es la de cierre y el título no lleva textos de usuarios', async () => {
    const pdf = await generarPdfCierre(datos());

    const info = leerInfoPdf(pdf);

    expect(info.CreationDate?.toISOString()).toBe('2026-11-02T23:00:00.000Z');
    expect(info.Title).toBe('Cierre de caja 2026-11-02 1');
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  });

  it('dos generaciones con los mismos datos dan los mismos bytes, también con el proceso en otra zona horaria', async () => {
    const una = await generarPdfCierre(datos());
    process.env['TZ'] = 'Asia/Tokyo';
    const otra = await generarPdfCierre(datos());
    process.env['TZ'] = 'America/New_York';
    const tercera = await generarPdfCierre(datos());

    expect(otra.equals(una)).toBe(true);
    expect(tercera.equals(una)).toBe(true);
  });

  it('cambia solo si cambian los datos del cierre: una reapertura da otro documento con la misma fecha de creación', async () => {
    const sin = await generarPdfCierre(datos());
    const con = await generarPdfCierre(
      datos({
        cierre: cierre({
          reapertura: { reabiertaPor: ROSA, reabiertaEn: '2026-11-03T00:15:00.000Z', motivo: 'Faltó contar un sobre' },
        }),
      }),
    );

    expect(con.equals(sin)).toBe(false);
    expect(leerInfoPdf(con).CreationDate).toEqual(leerInfoPdf(sin).CreationDate);
  });

  it('con cientos de movimientos sigue en varias páginas y no pierde ninguno', async () => {
    const muchos = Array.from({ length: 150 }, (_, i) =>
      movimiento(i + 1, { monto: `${i + 1}.00`, alumno: persona('Ana', `Apellido${i + 1}`) }),
    );
    const pdf = await generarPdfCierre(datos({ movimientos: muchos, cierre: cierre({ movimientosHasta: 150 }) }));

    const { lineas } = extraerTextoPdf(pdf);

    expect(contarPaginasPdf(pdf)).toBeGreaterThan(2);
    for (const i of [1, 75, 150]) expect(lineas, `Apellido${i}`).toContain(`Ana Apellido${i}`);
    // El encabezado de la tabla se repite en cada página que tiene filas.
    expect(lineas.filter((linea) => linea === 'Concepto o descripción').length).toBeGreaterThanOrEqual(2);
  });

  it('un texto largo se parte en líneas y no se pierde ni sale de la hoja', async () => {
    const largo = 'Faltó sencillo en la caja de la tarde. '.repeat(10).trim();
    const texto = await textoDe(datos({ cierre: cierre({ observacion: largo }) }));

    expect(texto.replace(/\n/g, ' ')).toContain('Observación: Faltó sencillo en la caja de la tarde.');
    expect(texto.match(/sencillo/g)).toHaveLength(10);
    expect(texto.match(/tarde\./g)).toHaveLength(10);
  });

  it('un texto con caracteres que la fuente no puede mostrar sale con ? y el documento sigue siendo válido', async () => {
    const entrada = datos({
      academia: 'Delfines \u{1F600}',
      cierre: cierre({ observacion: 'Faltó ’sencillo’ ​ ‮ fin' }),
    });

    const texto = await textoDe(entrada);

    expect(texto).toContain('Delfines ?');
    expect(texto).toContain('Observación: Faltó ?sencillo? ? ? fin');
  });

  it('rechaza (no lanza de forma síncrona) si los datos no sirven', async () => {
    const roto = { ...datos(), cierre: undefined } as unknown as DatosPdfCierre;

    await expect(generarPdfCierre(roto)).rejects.toBeInstanceOf(Error);
  });
});
