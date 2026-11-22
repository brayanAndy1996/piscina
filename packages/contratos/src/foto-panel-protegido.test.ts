// spec: 005-inscripcion-publica (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Contratos públicos de la 005b (PB4, PB11 y PB12). Se cargan con importación dinámica: antes de implementarlos la prueba falla con un mensaje claro y
// no con un error de tipos.
//   - `fotos.ts` (criterio 34): FOTO_TIPOS = ['image/jpeg', 'image/png'], FOTO_TAMANO_MAXIMO = 5 * 1024 * 1024 (5 242 880 bytes), FOTO_LADO_MINIMO = 100,
//     FOTO_LADO_MAXIMO = 8000, FOTO_PIXELES_MAXIMOS = 40_000_000, FOTO_LADO_GUARDADO = 800 y CABECERA_TOKEN_SOLICITUD = 'X-Token-Solicitud'.
//   - `solicitudes.ts` (criterios 38 y 39), todos estrictos: `solicitudPanelSchema` con las claves exactas del criterio 38;
//     `respuestaListaSolicitudesSchema = { solicitudes: SolicitudPanel[] }`; `respuestaSolicitudPanelSchema = { solicitud: SolicitudPanel }`;
//     `cancelarSolicitudSchema = { motivo }` con `textoVisibleSchema({ sujeto: 'El motivo', min: 3, max: 200 })`; `filtroEstadoSolicitudesSchema`:
//     'ACTIVAS' | 'VENCIDAS' | 'CANCELADAS' | 'TODAS', 'ACTIVAS' si falta.
//   - El paquete los reexporta desde su índice (`@aquagestion/contratos`).

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
      `Falta la funcionalidad de la 005b: no se pudo cargar "packages/contratos/src/${archivo}" (${motivo}).`,
      {
        cause: error,
      },
    );
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 005b: "packages/contratos/src/${archivo}" no exporta ${nombre}.`);
    }
  }
  return modulo;
}

const esquema = async (nombre: string): Promise<Esquema> =>
  (await cargar('solicitudes.ts', [nombre]))[nombre] as Esquema;

describe('constantes de la foto (criterio 34, PB4)', () => {
  it('criterio 34: fotos.ts exporta los tipos, el tamaño, los límites de lado y de píxeles, el lado guardado y la cabecera del token', async () => {
    const modulo = await cargar('fotos.ts', [
      'FOTO_TIPOS',
      'FOTO_TAMANO_MAXIMO',
      'FOTO_LADO_MINIMO',
      'FOTO_LADO_MAXIMO',
      'FOTO_PIXELES_MAXIMOS',
      'FOTO_LADO_GUARDADO',
      'CABECERA_TOKEN_SOLICITUD',
    ]);

    expect([...(modulo['FOTO_TIPOS'] as string[])]).toEqual(['image/jpeg', 'image/png']);
    expect(modulo['FOTO_TAMANO_MAXIMO']).toBe(5_242_880);
    expect(modulo['FOTO_LADO_MINIMO']).toBe(100);
    expect(modulo['FOTO_LADO_MAXIMO']).toBe(8000);
    expect(modulo['FOTO_PIXELES_MAXIMOS']).toBe(40_000_000);
    expect(modulo['FOTO_LADO_GUARDADO']).toBe(800);
    expect(modulo['CABECERA_TOKEN_SOLICITUD']).toBe('X-Token-Solicitud');
  });

  it('criterio 34: el índice del paquete reexporta las constantes de la foto y los esquemas del panel (la API y la web los importan de @aquagestion/contratos)', async () => {
    const indice = await cargar('index.ts', [
      'FOTO_TIPOS',
      'FOTO_TAMANO_MAXIMO',
      'CABECERA_TOKEN_SOLICITUD',
      'solicitudPanelSchema',
      'respuestaListaSolicitudesSchema',
      'respuestaSolicitudPanelSchema',
      'cancelarSolicitudSchema',
      'filtroEstadoSolicitudesSchema',
    ]);

    expect(indice['FOTO_TAMANO_MAXIMO']).toBe(5_242_880);
  });
});

const elemento = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: randomUUID(),
  codigo: 'AQ-7F3K9X',
  estado: 'PENDIENTE_PAGO',
  creadaEn: '2026-11-11T15:00:00.000Z',
  reservaVenceEn: '2026-11-12T15:00:00.000Z',
  nombres: 'Valeria',
  apellidos: 'Mendoza Salas',
  dni: '47811902',
  telefono: '987654321',
  menorDeEdad: false,
  plan: { id: randomUUID(), nombre: 'Plan 3 por semana' },
  clases: [{ id: randomUUID(), nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
  mes: '2026-11',
  clasesTotales: 12,
  monto: '120.00',
  ...cambios,
});

describe('solicitudPanelSchema (criterio 38, PB11)', () => {
  it('criterio 38: acepta un elemento con las claves exactas, en los tres estados, con reservaVenceEn como texto o null', async () => {
    const schema = await esquema('solicitudPanelSchema');

    for (const cambios of [
      {},
      { estado: 'VENCIDA', reservaVenceEn: null },
      { estado: 'CANCELADA', reservaVenceEn: null },
      { estado: 'PENDIENTE_PAGO', reservaVenceEn: null },
      { menorDeEdad: true },
      { clases: [] },
    ]) {
      const resultado = schema.safeParse(elemento(cambios));
      expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
    }
  });

  it.each([
    ['fotoCargada', true],
    ['alumnoId', randomUUID()],
    ['fechaNacimiento', '1995-05-20'],
    ['correo', 'a@b.test'],
    ['direccion', 'Calle 1'],
    ['fichaMedica', {}],
    ['apoderado', {}],
    ['consentimientos', []],
    ['token', 'x'],
    ['tokenHash', 'x'],
    ['ipOrigen', '127.0.0.1'],
    ['claveIdempotencia', randomUUID()],
    ['fotoClave', 'academias/x'],
  ])('criterio 38: rechaza un elemento con el campo de más %s (estricto)', async (clave, valor) => {
    const schema = await esquema('solicitudPanelSchema');

    expect(schema.safeParse(elemento({ [clave]: valor })).success).toBe(false);
  });

  it.each([
    'id',
    'codigo',
    'estado',
    'creadaEn',
    'reservaVenceEn',
    'nombres',
    'apellidos',
    'dni',
    'telefono',
    'menorDeEdad',
    'plan',
    'clases',
    'mes',
    'clasesTotales',
    'monto',
  ])('criterio 38: rechaza un elemento sin la clave %s', async (clave) => {
    const schema = await esquema('solicitudPanelSchema');
    const sin = elemento();
    delete sin[clave];

    expect(schema.safeParse(sin).success).toBe(false);
  });

  it.each([
    ['un estado desconocido', { estado: 'PAGADA' }],
    ['menorDeEdad que no es booleano', { menorDeEdad: 'no' }],
    ['un monto con coma', { monto: '120,00' }],
    ['un monto sin decimales', { monto: '120' }],
    ['un mes mal escrito', { mes: '11-2026' }],
    ['clasesTotales negativas', { clasesTotales: -1 }],
    ['clasesTotales decimales', { clasesTotales: 1.5 }],
    ['un plan con claves de más', { plan: { id: randomUUID(), nombre: 'x', precio: '1.00' } }],
    [
      'una clase con claves de más',
      {
        clases: [{ id: randomUUID(), nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00', aforo: 20 }],
      },
    ],
    [
      'un nivel desconocido en una clase',
      { clases: [{ id: randomUUID(), nivel: 'EXPERTO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }] },
    ],
    ['un id que no es UUID', { id: 'abc' }],
  ])('criterio 38: rechaza %s', async (_nombre, cambios) => {
    const schema = await esquema('solicitudPanelSchema');

    expect(schema.safeParse(elemento(cambios)).success).toBe(false);
  });
});

describe('respuestas del panel (criterios 38 y 39, PB11 y PB12)', () => {
  it('criterio 38: respuestaListaSolicitudesSchema acepta { solicitudes: [] } y una lista de elementos, y rechaza claves de más o una lista que no es un arreglo', async () => {
    const schema = await esquema('respuestaListaSolicitudesSchema');

    expect(schema.safeParse({ solicitudes: [] }).success).toBe(true);
    expect(
      schema.safeParse({ solicitudes: [elemento(), elemento({ estado: 'CANCELADA', reservaVenceEn: null })] }).success,
    ).toBe(true);
    expect(schema.safeParse({ solicitudes: [], total: 0 }).success).toBe(false);
    expect(schema.safeParse({ solicitudes: {} }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ solicitudes: [elemento({ extra: 1 })] }).success).toBe(false);
  });

  it('criterio 39: respuestaSolicitudPanelSchema acepta { solicitud } con un elemento y rechaza claves de más o sin la solicitud', async () => {
    const schema = await esquema('respuestaSolicitudPanelSchema');

    expect(schema.safeParse({ solicitud: elemento({ estado: 'CANCELADA', reservaVenceEn: null }) }).success).toBe(true);
    expect(schema.safeParse({ solicitud: elemento(), otra: 1 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ solicitud: null }).success).toBe(false);
  });
});

describe('cancelarSolicitudSchema (criterio 39, PB12)', () => {
  it('criterio 39: acepta un motivo de 3 a 200 caracteres y lo recorta', async () => {
    const schema = await esquema('cancelarSolicitudSchema');

    expect(schema.safeParse({ motivo: 'abc' }).success).toBe(true);
    expect(schema.safeParse({ motivo: 'a'.repeat(200) }).success).toBe(true);
    expect(schema.safeParse({ motivo: '  Pidió la baja  ' }).data).toEqual({ motivo: 'Pidió la baja' });
  });

  it.each([
    ['sin motivo', {}],
    ['motivo vacío', { motivo: '' }],
    ['motivo de 2 caracteres', { motivo: 'ab' }],
    ['motivo que recortado queda en 2 caracteres', { motivo: '  ab  ' }],
    ['motivo de 201 caracteres', { motivo: 'a'.repeat(201) }],
    ['motivo con solo espacios', { motivo: '        ' }],
    ['motivo con un salto de línea', { motivo: 'Dos\nlíneas' }],
    ['motivo con un separador de línea', { motivo: 'Dos líneas' }],
    ['motivo con un carácter de control', { motivo: 'Con\u0000nulo' }],
    ['motivo con un carácter bidireccional', { motivo: 'Con‮invertido' }],
    ['motivo que no es un texto', { motivo: 12345 }],
    ['un campo de más', { motivo: 'Motivo válido', estado: 'CANCELADA' }],
  ])('criterio 39: rechaza %s', async (_nombre, cuerpo) => {
    const schema = await esquema('cancelarSolicitudSchema');

    expect(schema.safeParse(cuerpo).success).toBe(false);
  });

  it('criterio 39: el error de un motivo inválido apunta al campo motivo', async () => {
    const schema = await esquema('cancelarSolicitudSchema');

    const resultado = schema.safeParse({ motivo: 'x' });

    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['motivo']);
  });
});

describe('filtroEstadoSolicitudesSchema (criterio 38, PB11)', () => {
  it.each(['ACTIVAS', 'VENCIDAS', 'CANCELADAS', 'TODAS'])('criterio 38: acepta %s tal cual', async (valor) => {
    const schema = await esquema('filtroEstadoSolicitudesSchema');

    expect(schema.safeParse(valor).data).toBe(valor);
  });

  it('criterio 38: si falta (undefined) vale ACTIVAS', async () => {
    const schema = await esquema('filtroEstadoSolicitudesSchema');

    const resultado = schema.safeParse(undefined);

    expect(resultado.success).toBe(true);
    expect(resultado.data).toBe('ACTIVAS');
  });

  it.each([
    ['activas'],
    ['Activas'],
    ['OTRO'],
    [''],
    [' ACTIVAS'],
    ['ACTIVAS '],
    [null],
    [['ACTIVAS']],
    [['ACTIVAS', 'TODAS']],
    [{ a: 1 }],
    [1],
  ])('criterio 38: rechaza %j', async (valor) => {
    const schema = await esquema('filtroEstadoSolicitudesSchema');

    expect(schema.safeParse(valor).success).toBe(false);
  });
});
