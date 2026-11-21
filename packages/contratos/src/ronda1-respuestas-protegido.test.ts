// spec: 005-inscripcion-publica (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Criterio 50 (crítico, RN-25, HU-34, D-03; ataque ronda 1, F2): `montoCotizadoSchema` (nuevo, en `dinero.ts`) valida `montoMostrado`: un
// texto con hasta dos decimales, mayor que 0 y como mucho "100000.00", con las mismas reglas de forma que `montoSchema` (sin espacios,
// signos, exponentes ni comas). Acepta "100000", "100000.0" y "100000.00"; rechaza "100000.01", "100001" y "1000000". `montoSchema` y
// `MONTO_MAXIMO` no cambian. `MONTO_COTIZADO_MAXIMO` vale "100000.00". `enviarInscripcionSchema` lo usa en `inscripcion.montoMostrado`
// (criterio 12).
// Criterio 58 e (crítico, RNF-05, Ley 29733, D-05, DR-9, DR-14; respuesta R3, ronda 1): `vistaSolicitudSchema` acepta la vista completa
// en `PENDIENTE_PAGO` y la reducida (sin `nombres`, `fotoCargada` ni `reservaVenceEn`) en `VENCIDA` y `CANCELADA`, y rechaza una
// `VENCIDA` o `CANCELADA` con `nombres` o con `fotoCargada`, y una `PENDIENTE_PAGO` sin ellos.
// Se cargan con importación dinámica: antes de implementarlos la prueba falla con un mensaje claro y no con un error de tipos.

interface Resultado {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}
interface Esquema {
  safeParse(valor: unknown): Resultado;
}

async function cargar<T>(archivo: string, exportaciones: readonly string[]): Promise<T> {
  const ruta = fileURLToPath(new URL(`./${archivo}`, import.meta.url));
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 005a: no se pudo cargar "packages/contratos/src/${archivo}" (${motivo}).`,
      { cause: error },
    );
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 005a: "packages/contratos/src/${archivo}" no exporta ${nombre}.`);
    }
  }
  return modulo as T;
}

interface Dinero {
  MONTO_MAXIMO: string;
  MONTO_COTIZADO_MAXIMO: string;
  montoSchema: Esquema;
  montoCotizadoSchema: Esquema;
}
const dinero = () =>
  cargar<Dinero>('dinero.ts', ['MONTO_MAXIMO', 'MONTO_COTIZADO_MAXIMO', 'montoSchema', 'montoCotizadoSchema']);

describe('criterio 50: montoCotizadoSchema', () => {
  it('criterio 50: MONTO_COTIZADO_MAXIMO vale "100000.00"', async () => {
    const { MONTO_COTIZADO_MAXIMO } = await dinero();

    expect(MONTO_COTIZADO_MAXIMO).toBe('100000.00');
  });

  it.each(['100000', '100000.0', '100000.00', '99999.99', '99999.01', '99999', '120', '120.5', '120.50', '0.01', '1'])(
    'criterio 50: acepta %s',
    async (monto) => {
      const { montoCotizadoSchema } = await dinero();

      expect(montoCotizadoSchema.safeParse(monto).success).toBe(true);
    },
  );

  it.each([
    '100000.01',
    '100001',
    '1000000',
    '100000.1',
    '100000.001',
    '999999.99',
    '0',
    '0.00',
    '0.0',
    '-1',
    '+120',
    '120.505',
    '1e2',
    '1E5',
    '120,50',
    ' 120',
    '120 ',
    '1 000',
    '0120.00',
    '00',
    '.5',
    '120.',
    '',
    '١٠٠',
  ])('criterio 50: rechaza %j', async (monto) => {
    const { montoCotizadoSchema } = await dinero();

    expect(montoCotizadoSchema.safeParse(monto).success).toBe(false);
  });

  it.each([100000, 120, 0, null, undefined, true, {}, []])(
    'criterio 50: rechaza un valor que no es texto (%j)',
    async (valor) => {
      const { montoCotizadoSchema } = await dinero();

      expect(montoCotizadoSchema.safeParse(valor).success).toBe(false);
    },
  );

  it('criterio 50: montoSchema y MONTO_MAXIMO no cambian: siguen rechazando "100000", "100000.00" y "100000.01" (el precio de un plan sigue con tope 99999.99)', async () => {
    const { montoSchema, MONTO_MAXIMO } = await cargar<Pick<Dinero, 'montoSchema' | 'MONTO_MAXIMO'>>('dinero.ts', [
      'montoSchema',
      'MONTO_MAXIMO',
    ]);

    expect(MONTO_MAXIMO).toBe('99999.99');
    for (const monto of ['100000', '100000.00', '100000.01']) {
      expect(montoSchema.safeParse(monto).success, monto).toBe(false);
    }
    expect(montoSchema.safeParse('99999.99').success).toBe(true);
  });
});

describe('criterio 12 y 50: enviarInscripcionSchema valida montoMostrado con montoCotizadoSchema', () => {
  interface Inscripcion {
    enviarInscripcionSchema: Esquema;
    TIPOS_SANGRE: readonly string[];
  }
  interface Consentimientos {
    VERSION_CONSENTIMIENTOS: string;
  }

  async function cuerpo(montoMostrado: unknown): Promise<Record<string, unknown>> {
    const { TIPOS_SANGRE } = await cargar<Inscripcion>('inscripcion.ts', ['enviarInscripcionSchema', 'TIPOS_SANGRE']);
    const { VERSION_CONSENTIMIENTOS } = await cargar<Consentimientos>('consentimientos.ts', [
      'VERSION_CONSENTIMIENTOS',
    ]);
    return {
      claveIdempotencia: randomUUID(),
      alumno: {
        nombres: 'Camila',
        apellidos: 'Quispe Rojas',
        dni: '45678912',
        fechaNacimiento: '1995-05-20',
        telefono: '987654321',
        nivel: 'BASICO',
      },
      fichaMedica: {
        tipoSangre: TIPOS_SANGRE[0],
        contactoEmergencia: { nombre: 'Rosa Quispe', telefono: '912345678' },
      },
      inscripcion: { planId: randomUUID(), claseIds: [randomUUID()], mes: '2026-11', montoMostrado },
      consentimientos: { version: VERSION_CONSENTIMIENTOS, datosPersonales: true, deslinde: true },
    };
  }
  const esquema = async () =>
    (await cargar<Inscripcion>('inscripcion.ts', ['enviarInscripcionSchema'])).enviarInscripcionSchema;

  it('criterio 12: control: un cuerpo válido con un monto común se acepta', async () => {
    expect((await esquema()).safeParse(await cuerpo('90.00')).success).toBe(true);
  });

  it.each(['100000', '100000.0', '100000.00'])(
    'criterio 50: montoMostrado %s (el monto de un mes completo que se redondea hacia arriba) se acepta',
    async (monto) => {
      const resultado = (await esquema()).safeParse(await cuerpo(monto));

      expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
    },
  );

  it.each(['100000.01', '100001', '1000000'])(
    'criterio 50: montoMostrado %s se rechaza con el error en inscripcion.montoMostrado',
    async (monto) => {
      const resultado = (await esquema()).safeParse(await cuerpo(monto));

      expect(resultado.success).toBe(false);
      expect(resultado.error?.issues.map((problema) => problema.path.join('.'))).toContain('inscripcion.montoMostrado');
    },
  );
});

describe('criterio 58 e: vistaSolicitudSchema es una unión estricta por estado', () => {
  interface Solicitudes {
    vistaSolicitudSchema: Esquema;
    respuestaConsultaSolicitudSchema: Esquema;
  }
  const esquema = async () =>
    (await cargar<Solicitudes>('solicitudes.ts', ['vistaSolicitudSchema'])).vistaSolicitudSchema;

  const clase = { nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' };
  const reducida = {
    codigo: 'AQ-7F3K9X',
    estado: 'VENCIDA',
    creadaEn: '2026-11-11T15:00:00.000Z',
    plan: { nombre: 'Plan 3 por semana' },
    clases: [clase],
    mes: '2026-11',
    clasesTotales: 9,
    monto: '90.00',
    esProporcional: true,
  };
  const completa = {
    ...reducida,
    estado: 'PENDIENTE_PAGO',
    reservaVenceEn: '2026-11-12T15:00:00.000Z',
    nombres: 'Valeria',
    fotoCargada: false,
  };

  it('criterio 58 e: acepta la vista completa en PENDIENTE_PAGO', async () => {
    expect((await esquema()).safeParse(completa).success).toBe(true);
  });

  it.each(['VENCIDA', 'CANCELADA'])('criterio 58 e: acepta la vista reducida en %s', async (estado) => {
    expect((await esquema()).safeParse({ ...reducida, estado }).success).toBe(true);
  });

  it.each(['VENCIDA', 'CANCELADA'])('criterio 58 e: rechaza una %s con nombres', async (estado) => {
    expect((await esquema()).safeParse({ ...reducida, estado, nombres: 'Valeria' }).success).toBe(false);
  });

  it.each(['VENCIDA', 'CANCELADA'])(
    'criterio 58 e: rechaza la vista completa (con nombres, fotoCargada y reservaVenceEn) con el estado %s',
    async (estado) => {
      expect((await esquema()).safeParse({ ...completa, estado }).success).toBe(false);
      expect((await esquema()).safeParse({ ...reducida, estado, nombres: 'Valeria', fotoCargada: false }).success).toBe(
        false,
      );
    },
  );

  it.each(['VENCIDA', 'CANCELADA'])('criterio 58 e: rechaza una %s con fotoCargada', async (estado) => {
    expect((await esquema()).safeParse({ ...reducida, estado, fotoCargada: false }).success).toBe(false);
  });

  it.each(['VENCIDA', 'CANCELADA'])('criterio 58 e: rechaza una %s con reservaVenceEn (P3)', async (estado) => {
    expect(
      (await esquema()).safeParse({ ...reducida, estado, reservaVenceEn: '2026-11-12T15:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('criterio 58 e: rechaza una PENDIENTE_PAGO sin nombres, sin fotoCargada o sin ninguno de los dos', async () => {
    const sin = (...claves: string[]): Record<string, unknown> =>
      Object.fromEntries(Object.entries(completa).filter(([clave]) => !claves.includes(clave)));
    const vista = await esquema();

    expect(vista.safeParse(sin('nombres')).success, 'sin nombres').toBe(false);
    expect(vista.safeParse(sin('fotoCargada')).success, 'sin fotoCargada').toBe(false);
    expect(vista.safeParse(sin('nombres', 'fotoCargada')).success, 'sin ninguno').toBe(false);
  });

  it('criterio 58 e: sigue siendo estricta: una clave de más (el DNI, un id) se rechaza en las dos vistas', async () => {
    const vista = await esquema();

    expect(vista.safeParse({ ...completa, dni: '45678912' }).success).toBe(false);
    expect(vista.safeParse({ ...reducida, dni: '45678912' }).success).toBe(false);
    expect(vista.safeParse({ ...reducida, solicitudId: randomUUID() }).success).toBe(false);
  });

  it('criterio 58 e: rechaza un estado que no es uno de los tres', async () => {
    expect((await esquema()).safeParse({ ...reducida, estado: 'PAGADA' }).success).toBe(false);
  });

  it('criterio 58: la respuesta de la consulta acepta la vista reducida de una solicitud VENCIDA y rechaza una VENCIDA con nombres', async () => {
    const { respuestaConsultaSolicitudSchema } = await cargar<Solicitudes>('solicitudes.ts', [
      'respuestaConsultaSolicitudSchema',
    ]);
    const academia = { nombre: 'Academia A', telefono: null };

    expect(respuestaConsultaSolicitudSchema.safeParse({ solicitud: reducida, academia }).success).toBe(true);
    expect(
      respuestaConsultaSolicitudSchema.safeParse({ solicitud: { ...reducida, nombres: 'Valeria' }, academia }).success,
    ).toBe(false);
  });
});
