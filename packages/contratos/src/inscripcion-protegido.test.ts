// spec: 005-inscripcion-publica (pruebas protegidas)
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Criterio 13 (crítico, RN-20, RNF-05): `esMenorDeEdad(fechaNacimiento, hoy)` es una función pura sobre textos `AAAA-MM-DD` (sin `Date`
// ni zona): la persona es menor si "hoy" todavía no cumplió 18 años; el día de su cumpleaños número 18 ya es mayor. Quien nació el 29 de
// febrero cumple el 1 de marzo en los años no bisiestos. La usan la API y la web.
// Criterio 14 (crítico, D-07, RNF-05): los textos de los consentimientos viven en `consentimientos.ts` con su versión; el de datos
// personales menciona de forma expresa los datos de salud y, si es menor, los de menores.
// Criterio 41 (crítico, DR-5 de 004): `actualizarClaseSchema` suma `confirmarAforoMenor` (booleano opcional que no cuenta como "un
// campo" para el "al menos uno").
// Se cargan con importación dinámica: antes de implementarlos la prueba falla con un mensaje claro y no con un error de tipos.

async function cargar<T>(archivo: string, exportaciones: readonly string[]): Promise<T> {
  const ruta = fileURLToPath(new URL(`./${archivo}`, import.meta.url));
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 005a: no se pudo cargar "packages/contratos/src/${archivo}" (${motivo}).`,
      {
        cause: error,
      },
    );
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 005a: "packages/contratos/src/${archivo}" no exporta ${nombre}.`);
    }
  }
  return modulo as T;
}

const ZONA_ORIGINAL = process.env['TZ'];
afterEach(() => {
  if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ZONA_ORIGINAL;
});

interface Edad {
  esMenorDeEdad: (fechaNacimiento: string, hoy: string) => boolean;
}
const edad = () => cargar<Edad>('inscripcion.ts', ['esMenorDeEdad']);

describe('criterio 13: esMenorDeEdad', () => {
  it.each([
    ['la víspera del cumpleaños número 18', '2008-11-21', '2026-11-20', true],
    ['el día del cumpleaños número 18 ya es mayor', '2008-11-20', '2026-11-20', false],
    ['un día después del cumpleaños número 18', '2008-11-19', '2026-11-20', false],
    ['17 años y casi un año', '2008-12-31', '2026-12-30', true],
    ['18 años recién cumplidos a fin de año', '2008-12-31', '2026-12-31', false],
    ['nació el 1 de enero: la víspera de los 18', '2008-01-01', '2025-12-31', true],
    ['nació el 1 de enero: el día de los 18', '2008-01-01', '2026-01-01', false],
    ['nació hoy', '2026-11-20', '2026-11-20', true],
    ['un bebé', '2025-11-20', '2026-11-20', true],
    ['un adulto de 31 años', '1995-05-20', '2026-11-20', false],
    ['una persona de 100 años', '1926-11-20', '2026-11-20', false],
    ['el mismo mes pero un día antes (mes igual, día mayor)', '2008-11-25', '2026-11-20', true],
    ['mes anterior del cumpleaños ya pasó', '2008-10-25', '2026-11-20', false],
    ['el mes del cumpleaños aún no llega', '2008-12-01', '2026-11-20', true],
  ])('criterio 13: %s', async (_nombre, nacimiento, hoy, esperado) => {
    const { esMenorDeEdad } = await edad();

    expect(esMenorDeEdad(nacimiento, hoy)).toBe(esperado);
  });

  it.each([
    ['2008-02-29', '2026-02-28', true],
    ['2008-02-29', '2026-03-01', false],
    ['2008-02-29', '2026-02-27', true],
    ['2004-02-29', '2022-02-28', true],
    ['2004-02-29', '2022-03-01', false],
    ['2012-02-29', '2030-02-28', true],
    ['2012-02-29', '2030-03-01', false],
  ])(
    'criterio 13: nacido el 29 de febrero (%s) con hoy %s es menor: %s (cumple el 1 de marzo en años no bisiestos)',
    async (nacimiento, hoy, esperado) => {
      const { esMenorDeEdad } = await edad();

      expect(esMenorDeEdad(nacimiento, hoy)).toBe(esperado);
    },
  );

  it.each(['Asia/Tokyo', 'Pacific/Kiritimati', 'America/Lima', 'UTC'])(
    'criterio 13: no depende de la zona del proceso (%s): la comparación es de textos',
    async (zona) => {
      const { esMenorDeEdad } = await edad();
      process.env['TZ'] = zona;

      expect(esMenorDeEdad('2008-11-21', '2026-11-20')).toBe(true);
      expect(esMenorDeEdad('2008-11-20', '2026-11-20')).toBe(false);
      expect(esMenorDeEdad('2008-02-29', '2026-02-28')).toBe(true);
      expect(esMenorDeEdad('2008-02-29', '2026-03-01')).toBe(false);
    },
  );
});

describe('criterio 14: los textos de los consentimientos', () => {
  interface Consentimientos {
    VERSION_CONSENTIMIENTOS: string;
    TIPOS_CONSENTIMIENTO: readonly string[];
    textosConsentimiento: (nombreAcademia: string, opciones: { menor: boolean }) => unknown;
  }
  const modulo = () =>
    cargar<Consentimientos>('consentimientos.ts', [
      'VERSION_CONSENTIMIENTOS',
      'TIPOS_CONSENTIMIENTO',
      'textosConsentimiento',
    ]);

  /** Los textos como una lista, sea cual sea la forma en que `textosConsentimiento` los entrega (objeto por tipo o lista). */
  function comoLista(textos: unknown): string[] {
    const valores = Array.isArray(textos) ? textos : Object.values(textos as Record<string, unknown>);
    return valores.map((valor) => (typeof valor === 'string' ? valor : JSON.stringify(valor)));
  }

  it('criterio 14: la versión es un texto no vacío y los tipos son DATOS_PERSONALES, DESLINDE e IMAGEN', async () => {
    const { VERSION_CONSENTIMIENTOS, TIPOS_CONSENTIMIENTO } = await modulo();

    expect(typeof VERSION_CONSENTIMIENTOS).toBe('string');
    expect(VERSION_CONSENTIMIENTOS.trim().length).toBeGreaterThan(0);
    expect([...TIPOS_CONSENTIMIENTO].sort()).toEqual(['DATOS_PERSONALES', 'DESLINDE', 'IMAGEN']);
  });

  it('criterio 14: trae un texto por tipo, con el nombre de la academia, y el de datos personales menciona de forma expresa los datos de salud', async () => {
    const { textosConsentimiento } = await modulo();

    const textos = comoLista(textosConsentimiento('Academia Los Delfines', { menor: false }));

    expect(textos).toHaveLength(3);
    for (const texto of textos) expect(texto.trim().length).toBeGreaterThan(20);
    expect(textos.join('\n')).toContain('Academia Los Delfines');
    expect(
      textos.some((texto) => /salud/i.test(texto)),
      'algún texto menciona los datos de salud',
    ).toBe(true);
  });

  it('criterio 14: si la persona es menor, el texto de datos personales menciona también los datos de menores', async () => {
    const { textosConsentimiento } = await modulo();

    const mayor = comoLista(textosConsentimiento('Academia Los Delfines', { menor: false })).join('\n');
    const menor = comoLista(textosConsentimiento('Academia Los Delfines', { menor: true })).join('\n');

    expect(menor).toMatch(/menores?/i);
    expect(menor).toMatch(/salud/i);
    expect(menor).not.toBe(mayor);
  });

  it('criterio 14: el nombre de la academia entra en el texto tal cual (no se interpreta como formato)', async () => {
    const { textosConsentimiento } = await modulo();

    const textos = comoLista(textosConsentimiento('Club $& Los Tiburones %s $1', { menor: false })).join('\n');

    expect(textos).toContain('Club $& Los Tiburones %s $1');
  });
});

describe('criterio 41: confirmarAforoMenor en actualizarClaseSchema', () => {
  interface Esquema {
    safeParse: (valor: unknown) => { success: boolean; data?: unknown };
  }
  const esquema = async () =>
    (await cargar<{ actualizarClaseSchema: Esquema }>('clases.ts', ['actualizarClaseSchema'])).actualizarClaseSchema;

  it('criterio 41: acepta confirmarAforoMenor booleano junto con un campo de la clase y lo conserva', async () => {
    const actualizarClaseSchema = await esquema();

    const resultado = actualizarClaseSchema.safeParse({ aforo: 20, confirmarAforoMenor: true });

    expect(resultado.success).toBe(true);
    expect(resultado.data).toEqual({ aforo: 20, confirmarAforoMenor: true });
    expect(actualizarClaseSchema.safeParse({ activo: false, confirmarAforoMenor: false }).success).toBe(true);
  });

  it('criterio 41: solo confirmarAforoMenor no cuenta como "un campo": el cuerpo se rechaza', async () => {
    const actualizarClaseSchema = await esquema();

    expect(actualizarClaseSchema.safeParse({ confirmarAforoMenor: true }).success).toBe(false);
    expect(actualizarClaseSchema.safeParse({ confirmarAforoMenor: false }).success).toBe(false);
  });

  it.each([
    ['un texto', 'true'],
    ['un número', 1],
    ['null', null],
    ['un objeto', {}],
  ])('criterio 41: confirmarAforoMenor debe ser un booleano (%s se rechaza)', async (_nombre, valor) => {
    const actualizarClaseSchema = await esquema();

    expect(actualizarClaseSchema.safeParse({ aforo: 25, confirmarAforoMenor: valor }).success).toBe(false);
  });

  it('criterio 41: sigue siendo estricto: un campo de más se rechaza y los de la 004 siguen igual', async () => {
    const actualizarClaseSchema = await esquema();

    expect(actualizarClaseSchema.safeParse({ aforo: 25, confirmar: true }).success).toBe(false);
    expect(actualizarClaseSchema.safeParse({ aforo: 25 }).success).toBe(true);
    expect(actualizarClaseSchema.safeParse({ aforo: 19 }).success).toBe(false);
    expect(actualizarClaseSchema.safeParse({}).success).toBe(false);
  });
});
