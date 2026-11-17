// spec: 004-planes-clases-aforo (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Criterio 10 (crítico, RN-25, D-03): `montoSchema` es un texto con hasta dos decimales, mayor que 0 y como mucho "99999.99";
// `clasesPorMes` es un entero de 1 en adelante. Criterio 18 (crítico, RN-11): `aforo` es un entero de 20 a 50, con los dos extremos
// incluidos, en `crearClaseSchema` y `actualizarClaseSchema`; AFORO_MINIMO vale 20 y AFORO_MAXIMO, 50. Los esquemas de la 004 se cargan
// con importación dinámica: antes de implementarlos la prueba falla con un mensaje claro y no con un error de tipos. Los casos
// están escritos a mano, de forma independiente de la implementación. Se pide la forma pública del contrato (`safeParse` de zod).

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
      `Falta la funcionalidad de la 004: no se pudo cargar "packages/contratos/src/${archivo}" (${motivo}).`,
      {
        cause: error,
      },
    );
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 004: "packages/contratos/src/${archivo}" no exporta ${nombre}.`);
    }
  }
  return modulo as T;
}

const camposConError = (resultado: Resultado): string[] =>
  (resultado.error?.issues ?? []).map((problema) => problema.path.map(String).join('.'));

// ---------------------------------------------------------------------------------------------------------------------------
// montoSchema
// ---------------------------------------------------------------------------------------------------------------------------

describe('criterio 10: montoSchema', () => {
  const montoSchema = async () => (await cargar<{ montoSchema: Esquema }>('dinero.ts', ['montoSchema'])).montoSchema;

  it.each([
    '120',
    '120.5',
    '120.50',
    '120.0',
    '120.00',
    '0.01',
    '0.5',
    '0.57',
    '1.15',
    '8.2',
    '99999.99',
    '99999',
    '1',
    '19.99',
  ])('criterio 10: acepta el texto "%s"', async (texto) => {
    expect((await montoSchema()).safeParse(texto).success).toBe(true);
  });

  it.each([
    ['un número JSON (120)', 120],
    ['un número JSON con decimales (120.5)', 120.5],
    ['el número 0', 0],
    ['"0"', '0'],
    ['"0.0"', '0.0'],
    ['"0.00"', '0.00'],
    ['"-1"', '-1'],
    ['"-0.01"', '-0.01'],
    ['"120.505"', '120.505'],
    ['"99999.995"', '99999.995'],
    ['"1e2"', '1e2'],
    ['"1E2"', '1E2'],
    ['"120,50"', '120,50'],
    ['" 120" (espacio delante)', ' 120'],
    ['"120 " (espacio detrás)', '120 '],
    ['"120\\n" (salto de línea)', '120\n'],
    ['"\\t120" (tabulación)', '\t120'],
    ['"100000" (por encima del máximo)', '100000'],
    ['"100000.00"', '100000.00'],
    ['"100000.01"', '100000.01'],
    ['"" (vacío)', ''],
    ['null', null],
    ['undefined', undefined],
    ['true', true],
    ['una lista', ['120']],
    ['un objeto', { valor: '120' }],
    ['"abc"', 'abc'],
    ['"1.2.3"', '1.2.3'],
    ['"+120"', '+120'],
    ['"NaN"', 'NaN'],
    ['"Infinity"', 'Infinity'],
    ['"0x10"', '0x10'],
    ['dígitos de ancho completo ("１２０")', '１２０'],
    ['dígitos arábigos ("١٢٠")', '١٢٠'],
    ['"S/ 120"', 'S/ 120'],
  ])('criterio 10: rechaza %s', async (_nombre, valor) => {
    expect((await montoSchema()).safeParse(valor).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Planes: precio y clases por mes
// ---------------------------------------------------------------------------------------------------------------------------

const PLAN_VALIDO = {
  nombre: 'Plan Mensual',
  vecesPorSemana: 3,
  clasesPorMes: 12,
  precio: '120.00',
  diasPermitidos: [1, 3, 5],
  franjasPermitidas: ['08:00', '09:00'],
  nivelesAplicables: ['BASICO', 'INTERMEDIO'],
};

describe('criterio 10: precio y clases por mes en crearPlanSchema y actualizarPlanSchema', () => {
  const esquemas = () =>
    cargar<{ crearPlanSchema: Esquema; actualizarPlanSchema: Esquema }>('planes.ts', [
      'crearPlanSchema',
      'actualizarPlanSchema',
    ]);

  it('criterio 10 (control): el plan de ejemplo es válido al crear', async () => {
    const { crearPlanSchema } = await esquemas();

    const resultado = crearPlanSchema.safeParse(PLAN_VALIDO);

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it.each(['120', '120.5', '0.01', '99999.99'])(
    'criterio 10: el precio "%s" se acepta al crear y al editar',
    async (precio) => {
      const { crearPlanSchema, actualizarPlanSchema } = await esquemas();

      expect(crearPlanSchema.safeParse({ ...PLAN_VALIDO, precio }).success).toBe(true);
      expect(actualizarPlanSchema.safeParse({ precio }).success).toBe(true);
    },
  );

  it.each([120, '0', '0.00', '-1', '120.505', '1e2', '120,50', ' 120', '100000', '', null, true])(
    'criterio 10: el precio %j se rechaza al crear y al editar, con el error en precio',
    async (precio) => {
      const { crearPlanSchema, actualizarPlanSchema } = await esquemas();

      const crear = crearPlanSchema.safeParse({ ...PLAN_VALIDO, precio });
      const editar = actualizarPlanSchema.safeParse({ precio });

      expect(crear.success).toBe(false);
      expect(camposConError(crear)).toContain('precio');
      expect(editar.success).toBe(false);
      expect(camposConError(editar)).toContain('precio');
    },
  );

  it('criterio 10: sin precio no se puede crear un plan', async () => {
    const { crearPlanSchema } = await esquemas();
    const sinPrecio: Record<string, unknown> = { ...PLAN_VALIDO };
    delete sinPrecio['precio'];

    const resultado = crearPlanSchema.safeParse(sinPrecio);

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('precio');
  });

  it.each([1, 8, 12])('criterio 10: clasesPorMes %i se acepta al crear y al editar', async (clasesPorMes) => {
    const { crearPlanSchema, actualizarPlanSchema } = await esquemas();

    expect(crearPlanSchema.safeParse({ ...PLAN_VALIDO, clasesPorMes }).success).toBe(true);
    expect(actualizarPlanSchema.safeParse({ clasesPorMes }).success).toBe(true);
  });

  it.each([0, -1, 1.5, '12', null, true, ''])(
    'criterio 10: clasesPorMes %j se rechaza al crear y al editar, con el error en clasesPorMes (es el divisor de RN-25)',
    async (clasesPorMes) => {
      const { crearPlanSchema, actualizarPlanSchema } = await esquemas();

      const crear = crearPlanSchema.safeParse({ ...PLAN_VALIDO, clasesPorMes });
      const editar = actualizarPlanSchema.safeParse({ clasesPorMes });

      expect(crear.success).toBe(false);
      expect(camposConError(crear)).toContain('clasesPorMes');
      expect(editar.success).toBe(false);
      expect(camposConError(editar)).toContain('clasesPorMes');
    },
  );

  it('criterio 6/10: los esquemas son estrictos: un campo que no es del contrato (academiaId) se rechaza al crear y al editar', async () => {
    const { crearPlanSchema, actualizarPlanSchema } = await esquemas();
    const academiaId = randomUUID();

    expect(crearPlanSchema.safeParse({ ...PLAN_VALIDO, academiaId }).success).toBe(false);
    expect(actualizarPlanSchema.safeParse({ precio: '120', academiaId }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Clases: aforo
// ---------------------------------------------------------------------------------------------------------------------------

const CLASE_VALIDA = {
  nivel: 'BASICO',
  diaSemana: 1,
  horaInicio: '08:00',
  entrenadorId: randomUUID(),
  aforo: 30,
};

const AFOROS_INVALIDOS: [string, unknown][] = [
  ['19', 19],
  ['51', 51],
  ['0', 0],
  ['-20', -20],
  ['20.5', 20.5],
  ['100', 100],
  ['"30" (un texto)', '30'],
  ['"" (vacío)', ''],
  ['null', null],
  ['true', true],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['una lista', [30]],
];

describe('criterio 18: el aforo en crearClaseSchema y actualizarClaseSchema', () => {
  const modulo = () =>
    cargar<{
      crearClaseSchema: Esquema;
      actualizarClaseSchema: Esquema;
      AFORO_MINIMO: number;
      AFORO_MAXIMO: number;
    }>('clases.ts', ['crearClaseSchema', 'actualizarClaseSchema', 'AFORO_MINIMO', 'AFORO_MAXIMO']);

  it('criterio 18: AFORO_MINIMO vale 20 y AFORO_MAXIMO vale 50 (RN-11)', async () => {
    const { AFORO_MINIMO, AFORO_MAXIMO } = await modulo();

    expect(AFORO_MINIMO).toBe(20);
    expect(AFORO_MAXIMO).toBe(50);
  });

  it('criterio 18 (control): la clase de ejemplo es válida al crear', async () => {
    const { crearClaseSchema } = await modulo();

    const resultado = crearClaseSchema.safeParse(CLASE_VALIDA);

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it('criterio 18: todos los enteros de 20 a 50 se aceptan al crear y al editar', async () => {
    const { crearClaseSchema, actualizarClaseSchema } = await modulo();

    for (let aforo = 20; aforo <= 50; aforo++) {
      expect(crearClaseSchema.safeParse({ ...CLASE_VALIDA, aforo }).success, `crear ${aforo}`).toBe(true);
      expect(actualizarClaseSchema.safeParse({ aforo }).success, `editar ${aforo}`).toBe(true);
    }
  });

  it.each(AFOROS_INVALIDOS)(
    'criterio 18: el aforo %s se rechaza al crear y al editar, con el error en aforo',
    async (_nombre, aforo) => {
      const { crearClaseSchema, actualizarClaseSchema } = await modulo();

      const crear = crearClaseSchema.safeParse({ ...CLASE_VALIDA, aforo });
      const editar = actualizarClaseSchema.safeParse({ aforo });

      expect(crear.success).toBe(false);
      expect(camposConError(crear)).toContain('aforo');
      expect(editar.success).toBe(false);
      expect(camposConError(editar)).toContain('aforo');
    },
  );

  it('criterio 18: sin aforo no se puede crear una clase', async () => {
    const { crearClaseSchema } = await modulo();
    const sinAforo: Record<string, unknown> = { ...CLASE_VALIDA };
    delete sinAforo['aforo'];

    const resultado = crearClaseSchema.safeParse(sinAforo);

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('aforo');
  });

  it('criterio 18: un aforo inválido junto a otros campos válidos se rechaza entero al editar', async () => {
    const { actualizarClaseSchema } = await modulo();

    const resultado = actualizarClaseSchema.safeParse({ aforo: 19, activo: false, entrenadorId: randomUUID() });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('aforo');
  });

  it('criterio 6/18: los esquemas son estrictos: academiaId no es del contrato y se rechaza al crear y al editar', async () => {
    const { crearClaseSchema, actualizarClaseSchema } = await modulo();
    const academiaId = randomUUID();

    expect(crearClaseSchema.safeParse({ ...CLASE_VALIDA, academiaId }).success).toBe(false);
    expect(actualizarClaseSchema.safeParse({ aforo: 30, academiaId }).success).toBe(false);
  });
});
