// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Contratos públicos de la 007a en `solicitudes.ts` (spec 007-pagos, criterios 28 y 29 y «Esquemas compartidos»): `ESTADOS_SOLICITUD` suma `EN_VERIFICACION`, `PAGO_RECHAZADO` y `CONFIRMADA`; `vistaSolicitudSchema` (unión estricta por
// estado) suma los tres, todos con las claves de la vista completa de 005 salvo `reservaVenceEn`: `CONFIRMADA` (007a) sin `fotoCargada` y con `pago: { metodo, monto, confirmadoEn, numeroTicket }`; `EN_VERIFICACION` con
// `fotoCargada` y `pago: { metodo, monto, fechaOperacion, enviadoEn }`; `PAGO_RECHAZADO` con `fotoCargada`, `rechazo: { motivo, rechazadoEn }` y `pagableHasta`. Ninguna lleva DNI, apellidos, número de operación, comprobante, quién verificó,
// ids internos ni el hash del token. `solicitudPanelSchema` suma `ajuste` (`{ montoCalculado, motivo }` o `null`) y `pago` (el último pago de la matrícula o `null`); `FILTROS_ESTADO_SOLICITUDES` suma `CONFIRMADAS`. Las vistas de la 005
// (`PENDIENTE_PAGO`, `VENCIDA` y `CANCELADA`) no cambian. Se cargan con importación dinámica.

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

const esquema = async (nombre: string): Promise<Esquema> =>
  (await cargar('solicitudes.ts', [nombre]))[nombre] as Esquema;

const base = (): Record<string, unknown> => ({
  codigo: 'AQ-7F3K9X',
  creadaEn: '2026-11-11T15:00:00.000Z',
  plan: { nombre: 'Plan 3 por semana' },
  clases: [{ nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
  mes: '2026-11',
  clasesTotales: 5,
  monto: '42.00',
  esProporcional: true,
  nombres: 'Valeria',
});
const confirmada = (cambios: Record<string, unknown> = {}) => ({
  ...base(),
  estado: 'CONFIRMADA',
  pago: { metodo: 'EFECTIVO', monto: '42.00', confirmadoEn: '2026-11-11T15:00:00.000Z', numeroTicket: 1 },
  ...cambios,
});
const enVerificacion = (cambios: Record<string, unknown> = {}) => ({
  ...base(),
  estado: 'EN_VERIFICACION',
  fotoCargada: true,
  pago: { metodo: 'YAPE', monto: '42.00', fechaOperacion: '2026-11-10', enviadoEn: '2026-11-11T15:00:00.000Z' },
  ...cambios,
});
const pagoRechazado = (cambios: Record<string, unknown> = {}) => ({
  ...base(),
  estado: 'PAGO_RECHAZADO',
  fotoCargada: true,
  rechazo: { motivo: 'La imagen no se lee', rechazadoEn: '2026-11-11T16:00:00.000Z' },
  pagableHasta: '2026-12-01T04:59:59.999Z',
  ...cambios,
});

describe('estados de la solicitud (criterio 28)', () => {
  it('007a: ESTADOS_SOLICITUD suma EN_VERIFICACION, PAGO_RECHAZADO y CONFIRMADA a los de la 005', async () => {
    const modulo = await cargar('solicitudes.ts', ['ESTADOS_SOLICITUD', 'estadoSolicitudSchema']);

    expect([...(modulo['ESTADOS_SOLICITUD'] as string[])].sort()).toEqual([
      'CANCELADA',
      'CONFIRMADA',
      'EN_VERIFICACION',
      'PAGO_RECHAZADO',
      'PENDIENTE_PAGO',
      'VENCIDA',
    ]);
    for (const estado of ['EN_VERIFICACION', 'PAGO_RECHAZADO', 'CONFIRMADA']) {
      expect((modulo['estadoSolicitudSchema'] as Esquema).safeParse(estado).success, estado).toBe(true);
    }
    expect((modulo['estadoSolicitudSchema'] as Esquema).safeParse('PAGADA').success).toBe(false);
  });

  it('007a: el índice del paquete reexporta ESTADOS_SOLICITUD, vistaSolicitudSchema y FILTROS_ESTADO_SOLICITUDES', async () => {
    await cargar('index.ts', [
      'ESTADOS_SOLICITUD',
      'vistaSolicitudSchema',
      'FILTROS_ESTADO_SOLICITUDES',
      'solicitudPanelSchema',
    ]);
  });
});

describe('vistaSolicitudSchema con los estados nuevos (criterio 28)', () => {
  it.each([
    ['CONFIRMADA (007a), sin fotoCargada ni reservaVenceEn, con su pago', confirmada()],
    [
      'CONFIRMADA de una transferencia',
      confirmada({
        pago: { metodo: 'TRANSFERENCIA', monto: '88.00', confirmadoEn: '2026-11-12T15:00:00.000Z', numeroTicket: 12 },
      }),
    ],
    ['EN_VERIFICACION, con fotoCargada y los datos del pago enviado', enVerificacion()],
    ['EN_VERIFICACION sin foto cargada', enVerificacion({ fotoCargada: false })],
    ['PAGO_RECHAZADO, con su motivo y el fin del mes en que se puede pagar', pagoRechazado()],
  ])('007a: acepta %s', async (_nombre, vista) => {
    const resultado = (await esquema('vistaSolicitudSchema')).safeParse(vista);

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it.each([
    ['CONFIRMADA con fotoCargada', confirmada({ fotoCargada: true })],
    ['CONFIRMADA con reservaVenceEn', confirmada({ reservaVenceEn: '2026-11-12T15:00:00.000Z' })],
    [
      'CONFIRMADA sin el pago',
      (() => {
        const v: Record<string, unknown> = confirmada();
        delete v['pago'];
        return v;
      })(),
    ],
    ['CONFIRMADA con el DNI', confirmada({ dni: '47811902' })],
    ['CONFIRMADA con los apellidos', confirmada({ apellidos: 'Mendoza Salas' })],
    [
      'CONFIRMADA con el número de operación dentro del pago',
      confirmada({
        pago: {
          metodo: 'YAPE',
          monto: '42.00',
          confirmadoEn: '2026-11-11T15:00:00.000Z',
          numeroTicket: 1,
          numeroOperacion: '12345',
        },
      }),
    ],
    [
      'CONFIRMADA con quién verificó dentro del pago',
      confirmada({
        pago: {
          metodo: 'EFECTIVO',
          monto: '42.00',
          confirmadoEn: '2026-11-11T15:00:00.000Z',
          numeroTicket: 1,
          verificadoPor: randomUUID(),
        },
      }),
    ],
    [
      'CONFIRMADA con un ticket que no es entero',
      confirmada({
        pago: { metodo: 'EFECTIVO', monto: '42.00', confirmadoEn: '2026-11-11T15:00:00.000Z', numeroTicket: '1' },
      }),
    ],
    [
      'CONFIRMADA con el ticket nulo',
      confirmada({
        pago: { metodo: 'EFECTIVO', monto: '42.00', confirmadoEn: '2026-11-11T15:00:00.000Z', numeroTicket: null },
      }),
    ],
    ['CONFIRMADA con un id interno', confirmada({ id: randomUUID() })],
    ['CONFIRMADA con el hash del token', confirmada({ tokenHash: 'abc' })],
    ['EN_VERIFICACION con reservaVenceEn', enVerificacion({ reservaVenceEn: '2026-11-12T15:00:00.000Z' })],
    [
      'EN_VERIFICACION sin fotoCargada',
      (() => {
        const v: Record<string, unknown> = enVerificacion();
        delete v['fotoCargada'];
        return v;
      })(),
    ],
    [
      'EN_VERIFICACION con el número de operación dentro del pago',
      enVerificacion({
        pago: {
          metodo: 'YAPE',
          monto: '42.00',
          fechaOperacion: '2026-11-10',
          enviadoEn: '2026-11-11T15:00:00.000Z',
          numeroOperacion: '12345',
        },
      }),
    ],
    ['EN_VERIFICACION con el comprobante', enVerificacion({ comprobante: 'academias/x' })],
    [
      'PAGO_RECHAZADO sin el rechazo',
      (() => {
        const v: Record<string, unknown> = pagoRechazado();
        delete v['rechazo'];
        return v;
      })(),
    ],
    [
      'PAGO_RECHAZADO sin pagableHasta',
      (() => {
        const v: Record<string, unknown> = pagoRechazado();
        delete v['pagableHasta'];
        return v;
      })(),
    ],
    ['PAGO_RECHAZADO con reservaVenceEn', pagoRechazado({ reservaVenceEn: '2026-11-12T15:00:00.000Z' })],
    [
      'PAGO_RECHAZADO con quién rechazó dentro del rechazo',
      pagoRechazado({ rechazo: { motivo: 'x', rechazadoEn: '2026-11-11T16:00:00.000Z', rechazadoPor: randomUUID() } }),
    ],
    ['un estado desconocido', { ...base(), estado: 'PAGADA' }],
  ])('007a: rechaza %s (estricto)', async (_nombre, vista) => {
    expect((await esquema('vistaSolicitudSchema')).safeParse(vista).success).toBe(false);
  });

  it('007a: las vistas de la 005 no cambian: PENDIENTE_PAGO con fotoCargada y reservaVenceEn opcional, VENCIDA y CANCELADA reducidas (sin nombres ni foto)', async () => {
    const schema = await esquema('vistaSolicitudSchema');
    const reducida = Object.fromEntries(Object.entries(base()).filter(([clave]) => clave !== 'nombres'));

    expect(
      schema.safeParse({
        ...base(),
        estado: 'PENDIENTE_PAGO',
        fotoCargada: false,
        reservaVenceEn: '2026-11-12T15:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...reducida, estado: 'VENCIDA' }).success).toBe(true);
    expect(schema.safeParse({ ...reducida, estado: 'CANCELADA' }).success).toBe(true);
    expect(schema.safeParse({ ...base(), estado: 'VENCIDA' }).success, 'la reducida no lleva el nombre').toBe(false);
  });

  it('007a: la respuesta de la consulta (respuestaConsultaSolicitudSchema) acepta la vista CONFIRMADA con la academia', async () => {
    const schema = await esquema('respuestaConsultaSolicitudSchema');

    expect(
      schema.safeParse({ solicitud: confirmada(), academia: { nombre: 'Academia A', telefono: null } }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ solicitud: confirmada(), academia: { nombre: 'Academia A', telefono: null }, dni: '1' })
        .success,
    ).toBe(false);
  });
});

describe('solicitudPanelSchema con ajuste y pago (criterio 29)', () => {
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
    clasesTotales: 5,
    monto: '42.00',
    ajuste: null,
    pago: null,
    ...cambios,
  });
  const pagoDelElemento = (cambios: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    metodo: 'EFECTIVO',
    estado: 'CONFIRMADO',
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
    ['sin ajuste ni pago', {}],
    ['con ajuste', { ajuste: { montoCalculado: '42.00', motivo: 'Descuento autorizado' }, monto: '35.00' }],
    ['CONFIRMADA con su pago de efectivo', { estado: 'CONFIRMADA', reservaVenceEn: null, pago: pagoDelElemento() }],
    [
      'con un Yape pendiente (número y fecha de operación)',
      {
        estado: 'EN_VERIFICACION',
        reservaVenceEn: null,
        pago: pagoDelElemento({
          metodo: 'YAPE',
          estado: 'PENDIENTE_VERIFICACION',
          verificadoEn: null,
          numeroOperacion: '12345',
          fechaOperacion: '2026-11-10',
          numeroTicket: null,
        }),
      },
    ],
    [
      'PAGO_RECHAZADO con el motivo del último pago',
      {
        estado: 'PAGO_RECHAZADO',
        reservaVenceEn: null,
        pago: pagoDelElemento({
          metodo: 'YAPE',
          estado: 'RECHAZADO',
          numeroOperacion: '12345',
          fechaOperacion: '2026-11-10',
          motivoRechazo: 'La imagen no se lee',
          numeroTicket: null,
        }),
      },
    ],
  ])('007a: acepta un elemento %s', async (_nombre, cambios) => {
    const resultado = (await esquema('solicitudPanelSchema')).safeParse(elemento(cambios));

    expect(resultado.success, JSON.stringify(resultado.error?.issues)).toBe(true);
  });

  it.each([
    ['un ajuste con claves de más', { ajuste: { montoCalculado: '42.00', motivo: 'x', ajustadoPor: randomUUID() } }],
    ['un ajuste sin motivo', { ajuste: { montoCalculado: '42.00' } }],
    ['un ajuste con el monto calculado sin decimales', { ajuste: { montoCalculado: '42', motivo: 'Descuento' } }],
    ['un pago con la clave del comprobante', { pago: pagoDelElemento({ comprobanteClave: 'academias/x' }) }],
    ['un pago con la IP de origen', { pago: pagoDelElemento({ ipOrigen: '127.0.0.1' }) }],
    ['un pago con quién lo registró', { pago: pagoDelElemento({ registradoPor: randomUUID() }) }],
    [
      'un pago sin el ticket',
      {
        pago: (() => {
          const p: Record<string, unknown> = pagoDelElemento();
          delete p['numeroTicket'];
          return p;
        })(),
      },
    ],
    ['un pago con un estado desconocido', { pago: pagoDelElemento({ estado: 'PAGADO' }) }],
    ['un pago con el monto sin decimales', { pago: pagoDelElemento({ monto: '42' }) }],
    ['un estado desconocido', { estado: 'PAGADA' }],
  ])('007a: rechaza un elemento con %s', async (_nombre, cambios) => {
    expect((await esquema('solicitudPanelSchema')).safeParse(elemento(cambios)).success).toBe(false);
  });

  it('007a: respuestaListaSolicitudesSchema y respuestaSolicitudPanelSchema aceptan elementos con ajuste y pago', async () => {
    const lista = await esquema('respuestaListaSolicitudesSchema');
    const una = await esquema('respuestaSolicitudPanelSchema');
    const conPago = elemento({
      estado: 'CONFIRMADA',
      reservaVenceEn: null,
      pago: pagoDelElemento(),
      ajuste: { montoCalculado: '42.00', motivo: 'Descuento' },
    });

    expect(lista.safeParse({ solicitudes: [elemento(), conPago] }).success).toBe(true);
    expect(una.safeParse({ solicitud: conPago }).success).toBe(true);
  });
});

describe('FILTROS_ESTADO_SOLICITUDES con CONFIRMADAS (criterio 29)', () => {
  it('007a: suma CONFIRMADAS a ACTIVAS, VENCIDAS, CANCELADAS y TODAS', async () => {
    const modulo = await cargar('solicitudes.ts', ['FILTROS_ESTADO_SOLICITUDES']);

    expect([...(modulo['FILTROS_ESTADO_SOLICITUDES'] as string[])].sort()).toEqual([
      'ACTIVAS',
      'CANCELADAS',
      'CONFIRMADAS',
      'TODAS',
      'VENCIDAS',
    ]);
  });

  it('007a: filtroEstadoSolicitudesSchema acepta CONFIRMADAS, sigue valiendo ACTIVAS si falta y rechaza las variantes', async () => {
    const schema = await esquema('filtroEstadoSolicitudesSchema');

    expect(schema.safeParse('CONFIRMADAS').data).toBe('CONFIRMADAS');
    expect(schema.safeParse(undefined).data).toBe('ACTIVAS');
    for (const valor of ['confirmadas', 'CONFIRMADA', ' CONFIRMADAS', ['CONFIRMADAS'], ['CONFIRMADAS', 'TODAS']]) {
      expect(schema.safeParse(valor).success, JSON.stringify(valor)).toBe(false);
    }
  });
});
