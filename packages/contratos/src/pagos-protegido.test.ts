// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Contratos públicos de la 007a (spec 007-pagos, «Esquemas compartidos»): `packages/contratos/src/pagos.ts` (nuevo) exporta `ESTADOS_PAGO`, `numeroOperacionSchema` y `normalizarNumeroOperacion` (función pura que usan la API, la web y
// las pruebas), `cobrarEnEfectivoSchema` (`{ claveIdempotencia, montoMostrado }`), `ajustarMontoSchema` (`{ montoAjustado, motivo }`), `pagoSchema` (`{ id, estado, metodo, concepto, monto, registradoEn, verificadoEn, numeroOperacion,
// fechaOperacion, motivoRechazo, numeroTicket }`) y `ticketSchema`. El índice del paquete los reexporta. Los de la 007b (`datosComprobanteSchema`, `pagoPendienteSchema`, `rechazarPagoSchema`…) los prueba la 007b. Se cargan con
// importación dinámica: antes de implementarlos la prueba falla con un mensaje claro y no con un error de tipos.
//   - Número de operación normalizado (definición): el texto que escribió la persona, en forma NFKC, sin espacios de ningún tipo ni los caracteres `-`, `.`, `/` y `_`, en mayúsculas y sin ceros a la izquierda (si solo tiene
//     ceros, queda `0`). ` 00012 345 `, `12345`, `0001-2345` y `１２３４５` (dígitos de ancho completo) dan `12345`; `ab-01` da `AB01`. Devuelve `null` si no cumple `^[0-9A-Z]{1,30}$` después de normalizar.
//   - `cobrarEnEfectivoSchema` y `ajustarMontoSchema` son estrictos; `ajustarMontoSchema`: un monto en soles enteros de "1" a "99999" (DR-11) y un `motivo` de 3 a 200 caracteres visibles (`textoVisibleSchema`).

interface Resultado {
  success: boolean;
  data?: unknown;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}
interface Esquema {
  safeParse(valor: unknown): Resultado;
  shape?: Record<string, unknown>;
}

async function cargar(archivo: string, exportaciones: readonly string[]): Promise<Record<string, unknown>> {
  const ruta = fileURLToPath(new URL(`./${archivo}`, import.meta.url));
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 007a: no se pudo cargar "packages/contratos/src/${archivo}" (${motivo}).`,
      {
        cause: error,
      },
    );
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 007a: "packages/contratos/src/${archivo}" no exporta ${nombre}.`);
    }
  }
  return modulo;
}

const esquema = async (nombre: string): Promise<Esquema> => (await cargar('pagos.ts', [nombre]))[nombre] as Esquema;
const normalizar = async (): Promise<(escrito: string) => string | null> =>
  (await cargar('pagos.ts', ['normalizarNumeroOperacion']))['normalizarNumeroOperacion'] as (
    escrito: string,
  ) => string | null;

describe('exportaciones de pagos.ts y del índice del paquete', () => {
  it('007a: pagos.ts exporta los estados, el número de operación, el cobro, el ajuste, el pago y el ticket', async () => {
    const modulo = await cargar('pagos.ts', [
      'ESTADOS_PAGO',
      'numeroOperacionSchema',
      'normalizarNumeroOperacion',
      'cobrarEnEfectivoSchema',
      'ajustarMontoSchema',
      'pagoSchema',
      'ticketSchema',
    ]);

    expect([...(modulo['ESTADOS_PAGO'] as string[])].sort()).toEqual([
      'CONFIRMADO',
      'PENDIENTE_VERIFICACION',
      'RECHAZADO',
    ]);
  });

  it('007a: el índice del paquete reexporta lo de pagos.ts (la API y la web lo importan de @aquagestion/contratos)', async () => {
    const indice = await cargar('index.ts', [
      'ESTADOS_PAGO',
      'numeroOperacionSchema',
      'normalizarNumeroOperacion',
      'cobrarEnEfectivoSchema',
      'ajustarMontoSchema',
      'pagoSchema',
      'ticketSchema',
    ]);

    expect(typeof indice['normalizarNumeroOperacion']).toBe('function');
  });
});

describe('normalizarNumeroOperacion (definición «Número de operación normalizado»)', () => {
  it.each([
    [' 00012 345 ', '12345'],
    ['12345', '12345'],
    ['0001-2345', '12345'],
    ['１２３４５', '12345'],
    ['ab-01', 'AB01'],
    ['AB01', 'AB01'],
    ['ab01', 'AB01'],
    ['1.2345', '12345'],
    ['1/23_45', '12345'],
    ['0', '0'],
    ['000', '0'],
    ['0-0 0', '0'],
    ['００１２', '12'],
    ['ａｂ１２', 'AB12'],
    ['\t12 345\n', '12345'],
    ['0A', 'A'],
    ['A'.repeat(30), 'A'.repeat(30)],
    [`000${'9'.repeat(30)}`, '9'.repeat(30)],
  ])('007a: %j se normaliza a %j', async (escrito, esperado) => {
    expect((await normalizar())(escrito)).toBe(esperado);
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['solo separadores', ' - . / _ '],
    ['de 31 caracteres', 'A'.repeat(31)],
    ['con una letra con tilde', 'Ñ12'],
    ['con una vocal con tilde', 'éxito1'],
    ['con un signo', '12#45'],
    ['con una coma', '12,345'],
    ['con un carácter de dirección del texto', '12‮45'],
    ['con un carácter de control', '12\u000045'],
    ['con un emoji', '12😀45'],
  ])('007a: un número %s no cumple y devuelve null', async (_nombre, escrito) => {
    expect((await normalizar())(escrito)).toBeNull();
  });

  it('007a: es una función pura e idempotente: normalizar lo ya normalizado no cambia nada', async () => {
    const f = await normalizar();

    for (const escrito of [' 00012 345 ', 'ab-01', '１２３４５', '000', 'Z9']) {
      const una = f(escrito);
      expect(una).not.toBeNull();
      expect(f(una as string)).toBe(una);
    }
  });

  it('007a: dos escrituras distintas del mismo número dan el mismo resultado (la base de la prevención de duplicados, HU-08)', async () => {
    const f = await normalizar();

    const distintas = ['12345', ' 12 345 ', '00012345', '0001-2345', '1.2345', '１２３４５'].map((escrito) =>
      f(escrito),
    );

    expect(new Set(distintas)).toEqual(new Set(['12345']));
    expect(f('ab12')).toBe(f('AB12'));
  });
});

describe('numeroOperacionSchema (criterio 38 de 007, DR-6)', () => {
  it.each([
    '12345',
    ' 12 345 ',
    '00012345',
    '0001-2345',
    'ab-01',
    'AB12',
    '0',
    '１２３４５',
    '1'.repeat(30),
    `${'0'.repeat(10)}${'1'.repeat(30)}`,
  ])('007a: acepta %j', async (valor) => {
    const resultado = (await esquema('numeroOperacionSchema')).safeParse(valor);

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '    '],
    ['de más de 40 caracteres', '1'.repeat(41)],
    ['que normalizado pasa de 30 caracteres', '1'.repeat(31)],
    ['con una letra con tilde', 'Ñ123'],
    ['con un carácter de control', '12\u000034'],
    ['con un carácter de dirección del texto', '12‮34'],
    ['que no es un texto', 12345],
    ['nulo', null],
  ])('007a: rechaza un número %s', async (_nombre, valor) => {
    expect((await esquema('numeroOperacionSchema')).safeParse(valor).success).toBe(false);
  });
});

describe('cobrarEnEfectivoSchema (criterios 13 y 16)', () => {
  const cuerpo = (cambios: Record<string, unknown> = {}) => ({
    claveIdempotencia: randomUUID(),
    montoMostrado: '42.00',
    ...cambios,
  });

  it.each(['42', '42.00', '42.5', '0.01', '99999.99'])('007a: acepta el monto mostrado %j', async (montoMostrado) => {
    const resultado = (await esquema('cobrarEnEfectivoSchema')).safeParse(cuerpo({ montoMostrado }));

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it.each([
    ['sin la clave de idempotencia', { claveIdempotencia: undefined }],
    ['con una clave que no es UUID', { claveIdempotencia: 'no-es-uuid' }],
    ['sin el monto mostrado', { montoMostrado: undefined }],
    ['con el monto mostrado vacío', { montoMostrado: '' }],
    ['con el monto mostrado en cero', { montoMostrado: '0.00' }],
    ['con el monto mostrado negativo', { montoMostrado: '-42' }],
    ['con el monto mostrado de tres decimales', { montoMostrado: '42.001' }],
    ['con el monto mostrado con coma', { montoMostrado: '42,00' }],
    ['con el monto mostrado como número', { montoMostrado: 42 }],
    ['con el monto mostrado con espacios', { montoMostrado: ' 42' }],
    ['con un campo de más (monto)', { monto: '42.00' }],
    ['con un campo de más (metodo)', { metodo: 'YAPE' }],
    ['con un campo de más (academiaId)', { academiaId: randomUUID() }],
  ])('007a: rechaza el cuerpo %s', async (_nombre, cambios) => {
    const base = cuerpo();
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor === undefined) delete (base as Record<string, unknown>)[clave];
      else (base as Record<string, unknown>)[clave] = valor;
    }

    expect((await esquema('cobrarEnEfectivoSchema')).safeParse(base).success).toBe(false);
  });

  it('007a: el error de un monto inválido apunta al campo montoMostrado', async () => {
    const resultado = (await esquema('cobrarEnEfectivoSchema')).safeParse(cuerpo({ montoMostrado: 'abc' }));

    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['montoMostrado']);
  });
});

describe('ajustarMontoSchema (criterio 11, DR-11)', () => {
  const cuerpo = (cambios: Record<string, unknown> = {}) => ({
    montoAjustado: '35',
    motivo: 'Descuento autorizado',
    ...cambios,
  });

  it.each(['1', '35', '42', '99999', '100'])('007a: acepta un monto de %j soles enteros', async (montoAjustado) => {
    const resultado = (await esquema('ajustarMontoSchema')).safeParse(cuerpo({ montoAjustado }));

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it('007a: recorta el motivo y acepta de 3 a 200 caracteres', async () => {
    const schema = await esquema('ajustarMontoSchema');

    expect(schema.safeParse(cuerpo({ motivo: '  Beca  ' })).data).toEqual({ montoAjustado: '35', motivo: 'Beca' });
    expect(schema.safeParse(cuerpo({ motivo: 'abc' })).success).toBe(true);
    expect(schema.safeParse(cuerpo({ motivo: 'a'.repeat(200) })).success).toBe(true);
  });

  it.each([
    ['sin monto', { montoAjustado: undefined }],
    ['con el monto "0" (sin becas de S/ 0: llegan con los códigos de descuento)', { montoAjustado: '0' }],
    ['con un monto negativo', { montoAjustado: '-5' }],
    ['con el monto "100000"', { montoAjustado: '100000' }],
    ['con céntimos', { montoAjustado: '35.5' }],
    ['con el monto con ceros adelante', { montoAjustado: '035' }],
    ['con un monto que no es un número', { montoAjustado: 'abc' }],
    ['con el monto como número', { montoAjustado: 35 }],
    ['sin motivo', { motivo: undefined }],
    ['con el motivo vacío', { motivo: '' }],
    ['con el motivo de 2 caracteres', { motivo: 'ab' }],
    ['con el motivo de 201 caracteres', { motivo: 'a'.repeat(201) }],
    ['con el motivo de solo espacios', { motivo: '        ' }],
    ['con un salto de línea en el motivo', { motivo: 'Dos\nlíneas' }],
    ['con un carácter bidireccional en el motivo', { motivo: 'Con‮invertido' }],
    ['con un campo de más', { clasesTotales: 3 }],
  ])('007a: rechaza el cuerpo %s', async (_nombre, cambios) => {
    const base = cuerpo();
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor === undefined) delete (base as Record<string, unknown>)[clave];
      else (base as Record<string, unknown>)[clave] = valor;
    }

    expect((await esquema('ajustarMontoSchema')).safeParse(base).success).toBe(false);
  });

  it('007a: el error de un monto inválido apunta a montoAjustado y el de un motivo inválido, a motivo', async () => {
    const schema = await esquema('ajustarMontoSchema');

    expect(schema.safeParse(cuerpo({ montoAjustado: '0' })).error?.issues[0]?.path).toEqual(['montoAjustado']);
    expect(schema.safeParse(cuerpo({ motivo: 'x' })).error?.issues[0]?.path).toEqual(['motivo']);
  });
});

describe('pagoSchema (criterio 13)', () => {
  const pago = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: randomUUID(),
    estado: 'CONFIRMADO',
    metodo: 'EFECTIVO',
    concepto: 'INSCRIPCION',
    monto: '42.00',
    registradoEn: '2026-11-11T15:00:00.000Z',
    verificadoEn: '2026-11-11T15:00:00.000Z',
    numeroOperacion: null,
    fechaOperacion: null,
    motivoRechazo: null,
    numeroTicket: 1,
    ...cambios,
  });

  it.each([
    ['un efectivo confirmado', {}],
    [
      'un Yape pendiente (sin verificación ni ticket)',
      {
        estado: 'PENDIENTE_VERIFICACION',
        metodo: 'YAPE',
        verificadoEn: null,
        numeroOperacion: '12345',
        fechaOperacion: '2026-11-10',
        numeroTicket: null,
      },
    ],
    [
      'una transferencia rechazada con su motivo',
      {
        estado: 'RECHAZADO',
        metodo: 'TRANSFERENCIA',
        numeroOperacion: 'AB12',
        fechaOperacion: '2026-11-10',
        motivoRechazo: 'La imagen no se lee',
        numeroTicket: null,
      },
    ],
  ])('007a: acepta %s', async (_nombre, cambios) => {
    const resultado = (await esquema('pagoSchema')).safeParse(pago(cambios));

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it.each([
    ['comprobanteClave', 'academias/x'],
    ['claveIdempotencia', randomUUID()],
    ['registradoPor', randomUUID()],
    ['alumnoId', randomUUID()],
    ['ipOrigen', '127.0.0.1'],
    ['dni', '47811902'],
  ])('007a: rechaza un pago con el campo de más %s (estricto)', async (clave, valor) => {
    expect((await esquema('pagoSchema')).safeParse(pago({ [clave]: valor })).success).toBe(false);
  });

  it.each([
    'id',
    'estado',
    'metodo',
    'concepto',
    'monto',
    'registradoEn',
    'verificadoEn',
    'numeroOperacion',
    'fechaOperacion',
    'motivoRechazo',
    'numeroTicket',
  ])('007a: rechaza un pago sin la clave %s', async (clave) => {
    const sin = pago();
    delete sin[clave];

    expect((await esquema('pagoSchema')).safeParse(sin).success).toBe(false);
  });

  it.each([
    ['un estado desconocido', { estado: 'PAGADO' }],
    ['un método desconocido', { metodo: 'TARJETA' }],
    ['un concepto que no existe', { concepto: 'MATRICULA' }],
    ['un monto con coma', { monto: '42,00' }],
    ['un monto sin decimales', { monto: '42' }],
    ['un ticket que no es entero', { numeroTicket: 1.5 }],
    ['un ticket en texto', { numeroTicket: '1' }],
    ['un id que no es UUID', { id: 'abc' }],
    ['una fecha de registro que no es ISO', { registradoEn: '11/11/2026' }],
  ])('007a: rechaza %s', async (_nombre, cambios) => {
    expect((await esquema('pagoSchema')).safeParse(pago(cambios)).success).toBe(false);
  });
});

describe('ticketSchema (criterio 26)', () => {
  it('007a: es estricto y tiene las claves que la spec nombra: academia { nombre, telefono }, numero, fechaHora, alumno { nombres, apellidos }, concepto, metodo, monto y la leyenda fija', async () => {
    const schema = await esquema('ticketSchema');
    const claves = Object.keys(schema.shape ?? {});

    for (const clave of ['academia', 'numero', 'fechaHora', 'alumno', 'concepto', 'metodo', 'monto', 'leyenda']) {
      expect(claves, `falta la clave ${clave}`).toContain(clave);
    }
    for (const prohibida of ['dni', 'alumnoId', 'matriculaId', 'claveIdempotencia', 'ipOrigen']) {
      expect(claves, `la clave ${prohibida} no puede estar`).not.toContain(prohibida);
    }
    const academia = (schema.shape?.['academia'] as Esquema | undefined)?.shape;
    const alumno = (schema.shape?.['alumno'] as Esquema | undefined)?.shape;
    expect(Object.keys(academia ?? {}).sort()).toEqual(['nombre', 'telefono']);
    expect(Object.keys(alumno ?? {}).sort()).toEqual(['apellidos', 'nombres']);
  });

  it('007a: la leyenda es la del criterio 26 (DR-4) y un ticket vacío o con el DNI del alumno no es válido', async () => {
    const schema = await esquema('ticketSchema');
    const leyenda = schema.shape?.['leyenda'] as Esquema | undefined;

    expect(leyenda?.safeParse('Comprobante interno de pago. No es un comprobante electrónico SUNAT').success).toBe(
      true,
    );
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ alumno: { nombres: 'Ana', apellidos: 'Quispe', dni: '47811902' } }).success).toBe(false);
  });
});
