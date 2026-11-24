// spec: 006-caja (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  cerrarCajaDePrueba,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  enLima,
  type EscenarioCaja,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  cargarFuncionalidad006b,
  crearAppHistorial,
  exigirRutasDeHistorial,
  reabrirCajaDePrueba,
  rutaPdf,
} from '../../utilidades/caja-historial';
import { extraerTextoPdf, tieneFormaDePdf } from '../../utilidades/pdf';
import { AHORA_PRUEBAS, crearUsuarioDePrueba } from '../../utilidades/usuarios';

// Criterio 42 (parte crítica: nada que salga del PDF puede cambiar su estructura ni mostrar un DNI) y PQ11 (crítico, regla de la 006b; Ley 29733):
// todo texto que sale de los datos (nombre de la academia, nombres, descripción, comprobante, observación y motivo) pasa por una función pura,
// `textoParaPdf`, antes de escribirse: primero se normaliza a NFC; después, cada punto de código que no esté entre U+0020 y U+007E ni entre U+00A0 y U+00FF
// se reemplaza por un `?` (uno por punto de código: un emoji, aunque en UTF-16 sean dos unidades, es un solo `?`; un sustituto suelto, también).
// Ejemplos: `Piña` y `Ñandú` quedan igual; `e` + U+0301 queda `é` (NFC); un emoji, `Ω` y `’` (comilla curva) salen `?` cada uno; `B` + U+200B + `1` sale
// `B?1`; U+00A0 y U+00AD están en el rango y quedan; un tabulador o un salto de línea escritos directo en la base salen `?`. La base no cambia: solo el PDF.
// Con `pdfkit`, el texto se escribe codificado (nunca como operadores del PDF), así que ningún texto puede cambiar la estructura del documento.
// PQ10 (el contenido, prueba obligatoria no protegida): aquí solo se comprueban lo que toca a la privacidad y a la zona horaria: nunca un DNI, y una caja de
// las 19:30 en Lima (00:30 del día siguiente en UTC) muestra su fecha de Lima y "19:30". Los caracteres invisibles se escriben con escapes \uXXXX.

interface ModuloTextoPdf {
  textoParaPdf: (texto: string) => string;
}

describe('textoParaPdf (PQ11)', () => {
  let textoParaPdf: (texto: string) => string;

  // En un `beforeEach` (y no en un `beforeAll`) para que cada caso falle con el mensaje de "falta la funcionalidad" y no quede omitido.
  beforeEach(async () => {
    ({ textoParaPdf } = await cargarFuncionalidad006b<ModuloTextoPdf>('modulos/caja/pdf/texto-pdf.ts', [
      'textoParaPdf',
    ]));
  });

  it.each([
    ['letras con tilde y eñe de Latin-1', 'Piña', 'Piña'],
    ['Ñandú', 'Ñandú', 'Ñandú'],
    [
      'ASCII imprimible completo',
      ' !"#$%&\'()*+,-./0123456789:;<=>?@AZaz[\\]^_`{|}~',
      ' !"#$%&\'()*+,-./0123456789:;<=>?@AZaz[\\]^_`{|}~',
    ],
    ['e con acento combinante se compone en NFC (é)', 'e\u0301', '\u00E9'],
    ['A con anillo combinante se compone en NFC (Å)', 'A\u030A', '\u00C5'],
    ['un emoji es un solo ?', '\u{1F600}', '?'],
    ['un emoji entre letras', 'a\u{1F600}b', 'a?b'],
    ['dos emojis son dos ?', '\u{1F600}\u{1F600}', '??'],
    ['una letra matemática de otro plano es un solo ?', '\u{1D4B3}', '?'],
    ['omega griega', '\u03A9', '?'],
    ['comilla curva derecha', '\u2019', '?'],
    ['comillas curvas dobles', '\u201Chola\u201D', '?hola?'],
    ['guion largo y euro', 'a\u2014b\u20AC', 'a?b?'],
    ['espacio de ancho cero entre dos caracteres', 'B\u200B1', 'B?1'],
    ['relleno hangul (se ve en blanco)', '\u3164', '?'],
    ['marca de orden de bytes', '\uFEFFx', '?x'],
    ['carácter de dirección del texto (U+202E)', 'ab\u202Ecd', 'ab?cd'],
    ['separador de línea (U+2028) y de párrafo (U+2029)', 'a\u2028b\u2029c', 'a?b?c'],
    ['el espacio sin separación (U+00A0) está en el rango y queda', 'a\u00A0b', 'a\u00A0b'],
    ['el guion blando (U+00AD) está en el rango y queda', 'a\u00ADb', 'a\u00ADb'],
    ['el último de Latin-1 (U+00FF) queda', '\u00FF', '\u00FF'],
    ['el primero fuera de Latin-1 (U+0100) es ?', '\u0100', '?'],
    ['un tabulador escrito directo en la base', 'a\tb', 'a?b'],
    ['un salto de línea', 'a\nb', 'a?b'],
    ['un retorno de carro', 'a\rb', 'a?b'],
    ['el carácter nulo', 'a\u0000b', 'a?b'],
    ['DEL (U+007F)', 'a\u007Fb', 'a?b'],
    ['controles C1 (U+0080 y U+009F)', '\u0080\u009F', '??'],
    ['un sustituto alto suelto es un solo ?', 'a\uD800b', 'a?b'],
    ['un sustituto bajo suelto es un solo ?', 'a\uDC00b', 'a?b'],
    ['una letra que compone fuera del rango en NFC (ǟ) es un ?', 'a\u0308\u0304', '?'],
    ['texto vacío', '', ''],
    ['texto que parece operadores de PDF queda como texto', ') Tj ET Q (', ') Tj ET Q ('],
    ['una barra invertida queda', 'a\\b', 'a\\b'],
  ])('PQ11: %s', (_nombre, entrada, esperado) => {
    expect(textoParaPdf(entrada)).toBe(esperado);
  });

  it('PQ11: nunca lanza y nunca devuelve un carácter fuera de U+0020 a U+007E y U+00A0 a U+00FF, para ningún punto de código de los primeros planos', () => {
    const permitido = (texto: string) =>
      [...texto].every((c) => {
        const punto = c.codePointAt(0) ?? 0;
        return (punto >= 0x20 && punto <= 0x7e) || (punto >= 0xa0 && punto <= 0xff);
      });

    for (let punto = 0; punto <= 0x30ff; punto += 1) {
      const salida = textoParaPdf(`a${String.fromCharCode(punto)}b`);

      expect(
        permitido(salida),
        `U+${punto.toString(16).toUpperCase().padStart(4, '0')} -> ${JSON.stringify(salida)}`,
      ).toBe(true);
    }
    for (const punto of [0x10000, 0x1f600, 0x1f9ff, 0x2ffff, 0xe0001, 0x10ffff]) {
      const salida = textoParaPdf(`a${String.fromCodePoint(punto)}b`);

      expect(salida, `U+${punto.toString(16).toUpperCase()}`).toBe('a?b');
    }
  });

  it('PQ11: es idempotente: aplicarla dos veces da lo mismo que una', () => {
    for (const texto of ['Piña \u{1F600} Ω ’ B\u200B1 e\u0301', 'a\tb\nc', '\uD800\uDC00']) {
      const una = textoParaPdf(texto);

      expect(textoParaPdf(una)).toBe(una);
    }
  });

  it('PQ11: un texto largo se conserva entero (no recorta ni agrega nada)', () => {
    const largo = 'Compra de útiles de limpieza '.repeat(40);

    expect(textoParaPdf(largo)).toBe(largo);
  });
});

const ZONA_ORIGINAL = process.env['TZ'];

describe.each(['UTC', 'Asia/Tokyo'])(
  'los textos raros en el PDF real (PQ11) y su fecha de Lima, con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppHistorial;
    let e: EscenarioCaja;
    let cookies: ReturnType<typeof cookiesDeCaja>;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      // Sin reemplazar el generador: se prueba el que provee el módulo (`GENERADOR_PDF_CIERRE` con `generarPdfCierre`).
      ctx = await crearAppHistorial();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      exigirRutasDeHistorial(ctx.app);
      ctx.reloj.fijar(AHORA_PRUEBAS);
      e = await crearEscenarioDeCaja();
      cookies = cookiesDeCaja(e);
    });
    afterEach(() => {
      process.env['TZ'] = zona;
    });
    afterAll(async () => {
      await ctx?.http.cerrar();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    async function descargar(cajaId: string, numero = 1): Promise<{ texto: string; crudo: Buffer }> {
      const respuesta = await ctx.http.get(rutaPdf(cajaId, numero), cookies.admin);
      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      expect(respuesta.headers.get('content-type')).toBe('application/pdf');
      expect(tieneFormaDePdf(respuesta.cuerpo), 'el PDF empieza con %PDF- y termina con %%EOF').toBe(true);
      return { texto: extraerTextoPdf(respuesta.cuerpo).texto, crudo: respuesta.cuerpo };
    }

    it('PQ11: los nombres, la descripción, el comprobante, la observación y el nombre de la academia salen con ? en lugar de lo que la fuente no puede mostrar', async () => {
      await ejecutarComo(
        'propietario',
        'UPDATE academias SET nombre = $1 WHERE id = $2::uuid',
        ['Delfines Piña \u{1F600}', e.A.id],
        { plataforma: true },
      );
      const quienAbre = await crearUsuarioDePrueba({
        academiaId: e.A.id,
        rol: 'SECRETARIA',
        nombres: 'Zoë \u{1F600}',
        apellidos: 'Núñez Ω',
      });
      const quienCierra = await crearUsuarioDePrueba({
        academiaId: e.A.id,
        rol: 'ADMIN',
        nombres: 'Ítalo’s',
        apellidos: 'B\u200Bz',
      });
      const alumno = await crearAlumnoDeCaja(e.A.id, 'Ana\u{1F600}', 'Ω');
      const caja = await crearCajaDePrueba(e.A.id, quienAbre.id, { fecha: '2026-11-03', monto_inicial: '100.00' });
      await crearIngresoDePrueba(e.A.id, caja.id, quienAbre.id, alumno.id, {
        monto: '42.00',
        registrado_en: enLima('2026-11-03', '10:00'),
      });
      let hora = 10;
      for (const [descripcion, comprobante] of [
        ['Zumo\u{1F600}Ñ', 'B001-Ω'],
        ['Pan’X', null],
        ['Ajo\tAjo', null],
        ['Sal\u200BSal', null],
        ['Luz\u202EZuL', null],
        ['Gas\u2028Gas', null],
      ] as const) {
        hora += 1;
        await crearEgresoDePrueba(e.A.id, caja.id, quienAbre.id, {
          monto: '1.00',
          descripcion,
          comprobante,
          registrado_en: enLima('2026-11-03', `${hora}:00`),
        });
      }
      await cerrarCajaDePrueba(e.A.id, caja.id, quienCierra.id, {
        montoDeclarado: '130.00',
        observacion: 'Faltó ’sencillo’',
        cerradoEn: enLima('2026-11-03', '18:00:00'),
      });

      const { texto } = await descargar(caja.id);

      for (const esperado of [
        'Delfines Piña ?',
        'Zoë ? Núñez ?',
        'Ítalo?s B?z',
        'Ana? ?',
        'Zumo?Ñ',
        'B001-?',
        'Pan?X',
        'Ajo?Ajo',
        'Sal?Sal',
        'Luz?ZuL',
        'Gas?Gas',
        'Faltó ?sencillo?',
      ]) {
        expect(texto, `falta "${esperado}" en el texto del PDF:\n${texto}`).toContain(esperado);
      }
    });

    it('PQ11: un texto con operadores de PDF, paréntesis y barras es solo texto: sale tal cual y no cambia la estructura del documento', async () => {
      const hostil = 'a) Tj (b\\) ET Q';
      const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-03', monto_inicial: '100.00' });
      await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, {
        monto: '1.00',
        descripcion: hostil,
        comprobante: '>> endobj',
      });
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, {
        montoDeclarado: '99.00',
        observacion: ') Tj ET Q (',
        cerradoEn: enLima('2026-11-03', '18:00:00'),
      });

      const { texto, crudo } = await descargar(caja.id);

      expect(texto).toContain(hostil);
      expect(texto).toContain('>> endobj');
      expect(crudo.toString('latin1').match(/%PDF-/g), 'un solo documento').toHaveLength(1);
      expect(crudo.toString('latin1').match(/%%EOF/g), 'un solo final de archivo').toHaveLength(1);
    });

    it('PQ10 y PQ11: nunca sale un DNI (ni del alumno ni de quien abrió, cerró o reabrió), ni en el texto ni en el archivo', async () => {
      const alumno = await crearAlumnoDeCaja(e.A.id, 'Ana María', 'Quispe Rojas');
      const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-03', monto_inicial: '100.00' });
      await crearIngresoDePrueba(e.A.id, caja.id, e.adminA.id, alumno.id, {
        monto: '42.00',
        registrado_en: enLima('2026-11-03', '10:00'),
      });
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA2.id, {
        montoDeclarado: '140.00',
        cerradoEn: enLima('2026-11-03', '18:00:00'),
      });
      await reabrirCajaDePrueba(
        e.A.id,
        caja.id,
        1,
        e.adminA2.id,
        enLima('2026-11-03', '19:00:00'),
        'Falto contar un sobre',
      );
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, { cerradoEn: enLima('2026-11-03', '20:00:00') });

      const primero = await descargar(caja.id, 1);
      const segundo = await descargar(caja.id, 2);

      for (const { texto, crudo } of [primero, segundo]) {
        for (const dni of [alumno.dni, e.secretariaA.dni, e.secretariaA2.dni, e.adminA.dni, e.adminA2.dni]) {
          expect(texto).not.toContain(dni);
          expect(crudo.toString('latin1')).not.toContain(dni);
        }
      }
      expect(primero.texto).toContain('Ana María');
    });

    it('PQ10: una caja abierta a las 19:30 en Lima (00:30 del día siguiente en UTC) muestra su fecha de Lima y "19:30"', async () => {
      const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, {
        fecha: '2026-11-03',
        abierta_en: enLima('2026-11-03', '19:30:00'),
        monto_inicial: '100.00',
      });
      await cerrarCajaDePrueba(e.A.id, caja.id, e.adminA.id, { cerradoEn: enLima('2026-11-03', '20:15:00') });

      const { texto } = await descargar(caja.id);

      expect(texto).toContain('Caja del 03/11/2026');
      expect(texto).toContain('Abierta por Lucia Benites a las 19:30');
      expect(texto).toContain('Cerrado por Rosa Alvarez el 03/11/2026 a las 20:15');
      expect(texto, 'ninguna hora de UTC ni de la zona del proceso').not.toContain('00:30');
      expect(texto).not.toContain('04/11/2026');
    });
  },
);
