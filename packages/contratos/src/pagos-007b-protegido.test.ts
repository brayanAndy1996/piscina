// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Contratos públicos de la 007b (spec 007-pagos, «Esquemas compartidos» y criterios 36, 38, 39, 45 y 49): `packages/contratos/src/pagos.ts` suma `datosComprobanteSchema` (estricto: `{ claveIdempotencia, metodo: 'YAPE' |
// 'TRANSFERENCIA', numeroOperacion, monto, fechaOperacion }`), `CABECERA_DATOS_PAGO = 'X-Pago-Datos'`, `pagoPendienteSchema` (estricto: `id`, `metodo`, `monto`, `numeroOperacion`, `fechaOperacion`, `enviadoEn`, `solicitud` (`id` y
// `codigo`), `cliente` (`nombres`, `apellidos`, `dni`), `mes` y `mesTerminado`), `rechazarPagoSchema` (`{ motivo }`, estricto, de 3 a 200 caracteres visibles) y `COMPROBANTE_LADO_GUARDADO = 2000`. El índice del paquete los reexporta.
// `normalizarNumeroOperacion` ya existe desde la 007a: aquí se fijan los ejemplos de la lista del criterio 39 (la misma función la usan la API, la web y las pruebas). Se cargan con importación dinámica: antes de implementarlos la prueba
// falla con un mensaje claro y no con un error de tipos.

interface Resultado {
  success: boolean;
  data?: unknown;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}
interface Esquema {
  safeParse(valor: unknown): Resultado;
}

async function cargar(archivo: string, exportaciones: readonly string[]): Promise<Record<string, unknown>> {
  const ruta = fileURLToPath(new URL(`./${archivo}`, import.meta.url));
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 007b: no se pudo cargar "packages/contratos/src/${archivo}" (${motivo}).`,
      { cause: error },
    );
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 007b: "packages/contratos/src/${archivo}" no exporta ${nombre}.`);
    }
  }
  return modulo;
}

const esquema = async (nombre: string): Promise<Esquema> => (await cargar('pagos.ts', [nombre]))[nombre] as Esquema;
const normalizar = async (): Promise<(escrito: string) => string | null> =>
  (await cargar('pagos.ts', ['normalizarNumeroOperacion']))['normalizarNumeroOperacion'] as (
    escrito: string,
  ) => string | null;

const camposConError = (resultado: Resultado): string[] =>
  (resultado.error?.issues ?? []).map((problema) => problema.path.map(String).join('.'));

describe('exportaciones de la 007b', () => {
  it('007b: pagos.ts exporta los datos del comprobante, la cabecera, la bandeja, el rechazo y el lado guardado', async () => {
    const modulo = await cargar('pagos.ts', [
      'datosComprobanteSchema',
      'CABECERA_DATOS_PAGO',
      'pagoPendienteSchema',
      'rechazarPagoSchema',
      'COMPROBANTE_LADO_GUARDADO',
    ]);

    expect(modulo['CABECERA_DATOS_PAGO']).toBe('X-Pago-Datos');
    expect(modulo['COMPROBANTE_LADO_GUARDADO']).toBe(2000);
  });

  it('007b: el índice del paquete reexporta los esquemas de la 007b', async () => {
    await cargar('index.ts', [
      'datosComprobanteSchema',
      'CABECERA_DATOS_PAGO',
      'pagoPendienteSchema',
      'rechazarPagoSchema',
      'COMPROBANTE_LADO_GUARDADO',
      'normalizarNumeroOperacion',
    ]);
  });
});

describe('datosComprobanteSchema (criterios 36 y 38)', () => {
  const valido = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
    claveIdempotencia: randomUUID(),
    metodo: 'YAPE',
    numeroOperacion: '00012345',
    monto: '42.00',
    fechaOperacion: '2026-11-11',
    ...cambios,
  });
  const sin = (campo: string): Record<string, unknown> => {
    const datos = valido();
    delete datos[campo];
    return datos;
  };

  it.each([
    ['un Yape', valido()],
    ['una transferencia', valido({ metodo: 'TRANSFERENCIA' })],
    ['un número con espacios, guiones y letras en minúscula', valido({ numeroOperacion: ' ab-12 34 ' })],
    ['un número de 40 caracteres que normalizado tiene 30', valido({ numeroOperacion: `0000000000${'1'.repeat(30)}` })],
    ['un monto con un decimal', valido({ monto: '42.5' })],
    ['un monto entero', valido({ monto: '42' })],
  ])('007b: acepta %s', async (_nombre, datos) => {
    const resultado = (await esquema('datosComprobanteSchema')).safeParse(datos);

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it('007b: guarda el número de operación recortado (el escrito) y no lo normaliza', async () => {
    const resultado = (await esquema('datosComprobanteSchema')).safeParse(valido({ numeroOperacion: ' 00012 345 ' }));

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
    expect((resultado.data as { numeroOperacion: string }).numeroOperacion).toBe('00012 345');
  });

  it.each(['claveIdempotencia', 'metodo', 'numeroOperacion', 'monto', 'fechaOperacion'])(
    '007b: rechaza los datos sin %s',
    async (campo) => {
      const resultado = (await esquema('datosComprobanteSchema')).safeParse(sin(campo));

      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toContain(campo);
    },
  );

  it.each([
    ['claveIdempotencia', 'no-es-un-uuid'],
    ['metodo', 'EFECTIVO'],
    ['metodo', 'PAYPAL'],
    ['metodo', 'yape'],
    ['numeroOperacion', ''],
    ['numeroOperacion', '   '],
    ['numeroOperacion', '1'.repeat(41)],
    ['numeroOperacion', '1'.repeat(31)],
    ['numeroOperacion', 'operación123'],
    ['numeroOperacion', '12\u202E345'],
    ['numeroOperacion', '12\u0007345'],
    ['numeroOperacion', 12345],
    ['monto', '0'],
    ['monto', '0.00'],
    ['monto', '-42'],
    ['monto', '42.001'],
    ['monto', '100000'],
    ['monto', 'abc'],
    ['monto', 42],
    ['fechaOperacion', '2026-02-30'],
    ['fechaOperacion', '2026-13-01'],
    ['fechaOperacion', '11/11/2026'],
    ['fechaOperacion', '2026-11-1'],
    ['fechaOperacion', '2026-11-11T10:00:00Z'],
    ['fechaOperacion', ''],
  ])('007b: rechaza %s = %j', async (campo, valor) => {
    const resultado = (await esquema('datosComprobanteSchema')).safeParse(valido({ [campo]: valor }));

    expect(resultado.success, `${campo}=${JSON.stringify(valor)}`).toBe(false);
    expect(camposConError(resultado)).toContain(campo);
  });

  it.each([['academiaId'], ['comprobante'], ['registradoPor'], ['estado']])(
    '007b: es estricto: un campo de más (%s) falla',
    async (extra) => {
      const resultado = (await esquema('datosComprobanteSchema')).safeParse(valido({ [extra]: 'x' }));

      expect(resultado.success).toBe(false);
    },
  );

  it('007b: no acepta un valor que no es un objeto', async () => {
    const schema = await esquema('datosComprobanteSchema');

    for (const valor of [null, [], 'texto', 42, undefined]) {
      expect(schema.safeParse(valor).success, JSON.stringify(valor)).toBe(false);
    }
  });
});

describe('rechazarPagoSchema (criterio 49)', () => {
  it.each([
    ['un motivo corto de 3 caracteres', 'Mal'],
    ['un motivo normal', 'La imagen no se lee, sube otra foto del Yape'],
    ['un motivo de 200 caracteres', 'a'.repeat(200)],
  ])('007b: acepta %s', async (_nombre, motivo) => {
    const resultado = (await esquema('rechazarPagoSchema')).safeParse({ motivo });

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it.each([
    ['sin motivo', {}],
    ['un motivo de 2 caracteres', { motivo: 'ab' }],
    ['un motivo vacío', { motivo: '' }],
    ['un motivo solo de espacios', { motivo: '      ' }],
    ['un motivo de 201 caracteres', { motivo: 'a'.repeat(201) }],
    ['un motivo con un carácter de control', { motivo: 'Foto ilegible\u0000' }],
    ['un motivo con un carácter de dirección', { motivo: 'Foto \u202Eilegible' }],
    ['un motivo que no es un texto', { motivo: 123 }],
    ['un campo de más', { motivo: 'Foto ilegible', academiaId: randomUUID() }],
  ])('007b: rechaza %s', async (_nombre, cuerpo) => {
    const resultado = (await esquema('rechazarPagoSchema')).safeParse(cuerpo);

    expect(resultado.success, JSON.stringify(cuerpo)).toBe(false);
  });
});

describe('pagoPendienteSchema (criterio 45)', () => {
  const valido = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: randomUUID(),
    metodo: 'YAPE',
    monto: '42.00',
    numeroOperacion: '00012 345',
    fechaOperacion: '2026-11-10',
    enviadoEn: '2026-11-11T14:30:00.000Z',
    solicitud: { id: randomUUID(), codigo: 'AQ-7F3K9X' },
    cliente: { nombres: 'Valeria', apellidos: 'Mendoza Salas', dni: '47811902' },
    mes: '2026-11',
    mesTerminado: false,
    ...cambios,
  });

  it.each([
    ['un Yape del mes en curso', valido()],
    ['una transferencia de un mes terminado', valido({ metodo: 'TRANSFERENCIA', mesTerminado: true })],
  ])('007b: acepta %s', async (_nombre, pago) => {
    const resultado = (await esquema('pagoPendienteSchema')).safeParse(pago);

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it.each(['id', 'metodo', 'monto', 'numeroOperacion', 'fechaOperacion', 'enviadoEn', 'solicitud', 'cliente', 'mes'])(
    '007b: rechaza un pago pendiente sin %s',
    async (campo) => {
      const pago = valido();
      delete pago[campo];

      expect((await esquema('pagoPendienteSchema')).safeParse(pago).success).toBe(false);
    },
  );

  it('007b: mesTerminado es obligatorio y booleano', async () => {
    const schema = await esquema('pagoPendienteSchema');
    const sinCampo = valido();
    delete sinCampo['mesTerminado'];

    expect(schema.safeParse(sinCampo).success).toBe(false);
    expect(schema.safeParse(valido({ mesTerminado: 'no' })).success).toBe(false);
  });

  it.each([
    ['la clave del archivo', { comprobanteClave: 'academias/x/pagos/y/comprobante-z.jpg' }],
    ['el token', { token: 'abc' }],
    ['datos médicos', { fichaMedica: { alergias: 'ninguna' } }],
    ['el apoderado', { apoderado: { nombres: 'Rosa' } }],
    ['quién lo registró', { registradoPor: randomUUID() }],
    ['la IP', { ip: '203.0.113.7' }],
    ['el número normalizado', { numeroOperacionNormalizado: '12345' }],
    ['el estado', { estado: 'PENDIENTE_VERIFICACION' }],
  ])('007b: es estricto: no deja pasar %s', async (_nombre, extra) => {
    const resultado = (await esquema('pagoPendienteSchema')).safeParse(valido(extra));

    expect(resultado.success).toBe(false);
  });

  it('007b: la solicitud y el cliente son estrictos: sin campos de más y con todos los que el contrato dice', async () => {
    const schema = await esquema('pagoPendienteSchema');

    expect(schema.safeParse(valido({ solicitud: { id: randomUUID() } })).success).toBe(false);
    expect(schema.safeParse(valido({ solicitud: { id: randomUUID(), codigo: 'AQ-7F3K9X', token: 'x' } })).success).toBe(
      false,
    );
    expect(schema.safeParse(valido({ cliente: { nombres: 'Valeria', apellidos: 'Mendoza Salas' } })).success).toBe(
      false,
    );
    expect(
      schema.safeParse(
        valido({ cliente: { nombres: 'Valeria', apellidos: 'Mendoza Salas', dni: '47811902', telefono: '987654321' } }),
      ).success,
    ).toBe(false);
  });
});

describe('normalizarNumeroOperacion: los ejemplos del criterio 39 (la misma función de la API, la web y las pruebas)', () => {
  it.each(['12345', ' 12 345 ', '00012345', '0001-2345', '1.2345', '１２３４５', '12/345', '12_345', ' 00012 345 '])(
    '007b: %j se normaliza a "12345"',
    async (escrito) => {
      expect((await normalizar())(escrito)).toBe('12345');
    },
  );

  it.each([
    ['ab12', 'AB12'],
    ['AB12', 'AB12'],
    ['ab-01', 'AB01'],
    ['a b.c/d_e', 'ABCDE'],
    ['000', '0'],
    ['0', '0'],
    ['12\u00A0345', '12345'],
    ['12\u3000345', '12345'],
    ['ａｂ１２', 'AB12'],
  ])('007b: %j se normaliza a %j', async (escrito, esperado) => {
    expect((await normalizar())(escrito)).toBe(esperado);
  });

  it.each(['', '   ', '---', 'operación1', 'ñ12', '12\u202E345', '12\u0007345', '1'.repeat(31)])(
    '007b: %j no cumple ^[0-9A-Z]{1,30}$ y devuelve null',
    async (escrito) => {
      expect((await normalizar())(escrito)).toBeNull();
    },
  );

  it('007b: el mismo número escrito de dos formas da el mismo normalizado, y el de otro método no se mezcla (la función no sabe de métodos)', async () => {
    const f = await normalizar();

    expect(f(' ab12 ')).toBe(f('AB-12'));
    expect(f('0012')).toBe(f('12'));
    expect(f('12')).not.toBe(f('21'));
  });
});
