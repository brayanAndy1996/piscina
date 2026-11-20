import { describe, expect, it } from 'vitest';
import {
  ALFABETO_CROCKFORD,
  codigoSolicitudSchema,
  consultarSolicitudSchema,
  respuestaConsultaSolicitudSchema,
  tokenSeguimientoSchema,
  vistaSolicitudSchema,
} from './index';

const TOKEN = 'Ab3_-'.repeat(8) + 'Ab3';

const vista = {
  codigo: 'AQ-7F3K9X',
  estado: 'PENDIENTE_PAGO',
  creadaEn: '2026-11-11T15:00:00.000Z',
  reservaVenceEn: '2026-11-12T15:00:00.000Z',
  nombres: 'Valeria',
  plan: { nombre: 'Plan 3 por semana' },
  clases: [{ nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
  mes: '2026-11',
  clasesTotales: 9,
  monto: '90.00',
  esProporcional: true,
  fotoCargada: false,
};

describe('codigoSolicitudSchema (criterios 24 y 30)', () => {
  it('el alfabeto de Crockford no tiene I, L, O ni U', () => {
    expect(ALFABETO_CROCKFORD).toHaveLength(32);
    expect(ALFABETO_CROCKFORD).not.toMatch(/[ILOU]/);
  });

  it.each([
    ['AQ-7F3K9X', 'AQ-7F3K9X'],
    ['aq-7f3k9x', 'AQ-7F3K9X'],
    ['  aq-7f3k9x\t', 'AQ-7F3K9X'],
    ['AQ-000000', 'AQ-000000'],
    ['AQ-ZZZZZZ', 'AQ-ZZZZZZ'],
  ])('acepta %j y lo guarda como %j', (entrada, esperado) => {
    expect(codigoSolicitudSchema.parse(entrada)).toBe(esperado);
  });

  it.each(['AQ-12', 'XX-ABCDEF', 'AQ-ILOUIL', 'AQ-ABCDEFG', 'AQ ABCDEF', 'AQ-OAOBOC', '', 'AQ-ABC-EF'])(
    'rechaza %j (no corrige letras parecidas)',
    (entrada) => {
      expect(codigoSolicitudSchema.safeParse(entrada).success).toBe(false);
    },
  );
});

describe('tokenSeguimientoSchema', () => {
  it('acepta 43 caracteres base64url y nada más', () => {
    expect(tokenSeguimientoSchema.safeParse(TOKEN).success).toBe(true);
    for (const malo of [TOKEN.slice(1), `${TOKEN}A`, `${TOKEN.slice(0, 41)}+/`, ` ${TOKEN.slice(1)}`, '']) {
      expect(tokenSeguimientoSchema.safeParse(malo).success).toBe(false);
    }
  });
});

describe('consultarSolicitudSchema (criterios 29 a 31)', () => {
  it('acepta solo { token } o { codigo, dni }, cada dato de hasta 100 caracteres', () => {
    expect(consultarSolicitudSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(consultarSolicitudSchema.safeParse({ codigo: 'aq-7f3k9x', dni: '45678912' }).success).toBe(true);
    // El formato no lo decide el esquema: un token o un código inválidos llegan al servicio, que responde el 404 único.
    expect(consultarSolicitudSchema.safeParse({ token: 'corto' }).success).toBe(true);
    expect(consultarSolicitudSchema.safeParse({ codigo: 'AQ-12', dni: '1' }).success).toBe(true);
  });

  it.each([
    ['token y código a la vez', { token: TOKEN, codigo: 'AQ-7F3K9X' }],
    ['token, código y DNI', { token: TOKEN, codigo: 'AQ-7F3K9X', dni: '45678912' }],
    ['ninguno', {}],
    ['solo el código', { codigo: 'AQ-7F3K9X' }],
    ['solo el DNI', { dni: '45678912' }],
    ['un campo de más', { token: TOKEN, academiaId: 'x' }],
    ['el token como número', { token: 123456 }],
    ['el DNI como número', { codigo: 'AQ-7F3K9X', dni: 45678912 }],
    ['un token de más de 100 caracteres', { token: 'A'.repeat(101) }],
  ])('rechaza %s', (_nombre, cuerpo) => {
    expect(consultarSolicitudSchema.safeParse(cuerpo).success).toBe(false);
  });
});

describe('vistaSolicitudSchema (criterio 32)', () => {
  it('acepta la vista completa en PENDIENTE_PAGO y la reducida (sin nombres, fotoCargada ni reservaVenceEn) en VENCIDA y CANCELADA', () => {
    expect(vistaSolicitudSchema.safeParse(vista).success).toBe(true);
    const reducida: Partial<typeof vista> = { ...vista };
    delete reducida.reservaVenceEn;
    delete reducida.nombres;
    delete reducida.fotoCargada;
    for (const estado of ['VENCIDA', 'CANCELADA']) {
      expect(vistaSolicitudSchema.safeParse({ ...reducida, estado }).success).toBe(true);
    }
  });

  it('reservaVenceEn es opcional en la vista completa (pago en verificación) y la reducida lo rechaza', () => {
    const sinVencimiento: Partial<typeof vista> = { ...vista };
    delete sinVencimiento.reservaVenceEn;
    expect(vistaSolicitudSchema.safeParse(sinVencimiento).success).toBe(true);
    expect(vistaSolicitudSchema.safeParse({ ...vista, estado: 'CANCELADA' }).success).toBe(false);
  });

  it.each([
    'dni',
    'apellidos',
    'fechaNacimiento',
    'edad',
    'telefono',
    'correo',
    'direccion',
    'apoderado',
    'fichaMedica',
    'id',
    'tokenHash',
  ])('es estricta: rechaza el campo de más %s', (campo) => {
    expect(vistaSolicitudSchema.safeParse({ ...vista, [campo]: 'x' }).success).toBe(false);
  });

  it('el plan y las clases no llevan ids ni datos de más, y el estado es uno de los tres', () => {
    expect(vistaSolicitudSchema.safeParse({ ...vista, plan: { nombre: 'x', id: 'y' } }).success).toBe(false);
    expect(vistaSolicitudSchema.safeParse({ ...vista, clases: [{ ...vista.clases[0], id: 'x' }] }).success).toBe(false);
    expect(vistaSolicitudSchema.safeParse({ ...vista, estado: 'PAGADA' }).success).toBe(false);
  });

  it('la respuesta lleva la solicitud y el nombre y el teléfono de la academia', () => {
    const respuesta = { solicitud: vista, academia: { nombre: 'Los Delfines', telefono: null } };

    expect(respuestaConsultaSolicitudSchema.safeParse(respuesta).success).toBe(true);
    expect(
      respuestaConsultaSolicitudSchema.safeParse({ ...respuesta, academia: { nombre: 'x', telefono: null, id: 'y' } })
        .success,
    ).toBe(false);
  });
});
