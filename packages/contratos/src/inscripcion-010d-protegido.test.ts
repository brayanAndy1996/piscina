// spec: 010-mensualidades (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import * as contratos from './index';

// Criterio 16 (prueba obligatoria; spec 010d, «Contrato»): en `packages/contratos/src/inscripcion.ts`, reexportados en el índice: `cotizarInscripcionSchema` suma `mes: mesSchema` opcional (sigue estricto); `consultaFormularioSchema` (`{ mes?: mesSchema }`, estricto) para la consulta del `GET`; `mesesInscripcionSchema` (criterio 1: `hoy`, `meses` y `aperturaMesSiguiente`, estricto).
// `respuestaFormularioInscripcionSchema`, `enviarInscripcionSchema` y `respuestaInscripcionCreadaSchema` no cambian.
// Los esquemas se leen con una comprobación previa para que, antes de implementarlos, la prueba falle con un mensaje claro y no con un error de tipos.

interface Esquema {
  safeParse: (valor: unknown) => { success: boolean; data?: unknown };
}

function esquema(nombre: string): Esquema {
  const valor = (contratos as unknown as Record<string, unknown>)[nombre];
  if (valor === undefined) {
    throw new Error(`Falta la funcionalidad de la 010d: @aquagestion/contratos no exporta ${nombre}.`);
  }
  return valor as Esquema;
}

const ID = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';
const OTRO = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const SEGUNDO_OTRO = '2b8c1e3f-4a5d-4c6b-9e7f-0a1b2c3d4e5f';

describe('mesesInscripcionSchema (criterio 1 y 16)', () => {
  const solo = {
    hoy: '2026-11-25',
    meses: [{ mes: '2026-11', fechaInicio: '2026-11-25', inscripcionHasta: '2026-11-30' }],
    aperturaMesSiguiente: '2026-11-26',
  };
  const dos = {
    hoy: '2026-11-27',
    meses: [
      { mes: '2026-11', fechaInicio: '2026-11-27', inscripcionHasta: '2026-11-30' },
      { mes: '2026-12', fechaInicio: '2026-12-01', inscripcionHasta: '2026-11-30' },
    ],
    aperturaMesSiguiente: null,
  };

  it('acepta un solo mes con la fecha de apertura y dos meses con la apertura en null', () => {
    const schema = esquema('mesesInscripcionSchema');
    expect(schema.safeParse(solo).success).toBe(true);
    expect(schema.safeParse(dos).success).toBe(true);
  });

  it('acepta el cambio de año (diciembre y enero) y los meses de las fechas límite de febrero', () => {
    const cambioDeAnio = {
      hoy: '2026-12-31',
      meses: [
        { mes: '2026-12', fechaInicio: '2026-12-31', inscripcionHasta: '2026-12-31' },
        { mes: '2027-01', fechaInicio: '2027-01-01', inscripcionHasta: '2026-12-31' },
      ],
      aperturaMesSiguiente: null,
    };
    expect(esquema('mesesInscripcionSchema').safeParse(cambioDeAnio).success).toBe(true);
  });

  it('es estricto: rechaza claves de más en la respuesta y en cada mes', () => {
    const { safeParse } = esquema('mesesInscripcionSchema');
    expect(safeParse({ ...solo, x: 1 }).success).toBe(false);
    expect(safeParse({ ...solo, academiaId: ID }).success).toBe(false);
    expect(safeParse({ ...solo, meses: [{ ...solo.meses[0], extra: true }] }).success).toBe(false);
  });

  it('exige las tres claves de la respuesta y las tres de cada mes', () => {
    const { safeParse } = esquema('mesesInscripcionSchema');
    for (const clave of ['hoy', 'meses', 'aperturaMesSiguiente'] as const) {
      const sinLaClave: Record<string, unknown> = { ...solo };
      delete sinLaClave[clave];
      expect(safeParse(sinLaClave).success, `sin ${clave}`).toBe(false);
    }
    for (const clave of ['mes', 'fechaInicio', 'inscripcionHasta'] as const) {
      const sinLaClave: Record<string, unknown> = { ...solo.meses[0] };
      delete sinLaClave[clave];
      expect(safeParse({ ...solo, meses: [sinLaClave] }).success, `un mes sin ${clave}`).toBe(false);
    }
  });

  it('valida los formatos: `mes` es AAAA-MM; `hoy`, `fechaInicio`, `inscripcionHasta` y `aperturaMesSiguiente` son AAAA-MM-DD', () => {
    const { safeParse } = esquema('mesesInscripcionSchema');
    const conMes = (mes: unknown) => ({ ...solo, meses: [{ ...solo.meses[0], mes }] });
    for (const mal of ['2026-13', '2026-1', '202611', '2026-11-01', 'noviembre', 202611, null]) {
      expect(safeParse(conMes(mal)).success, `mes ${String(mal)}`).toBe(false);
    }
    for (const mal of ['2026-11', '2026-13-01', '26-11-25', '25/11/2026', '', 20261125, null]) {
      expect(safeParse({ ...solo, hoy: mal }).success, `hoy ${String(mal)}`).toBe(false);
      expect(
        safeParse({ ...solo, meses: [{ ...solo.meses[0], fechaInicio: mal }] }).success,
        `fechaInicio ${String(mal)}`,
      ).toBe(false);
      expect(
        safeParse({ ...solo, meses: [{ ...solo.meses[0], inscripcionHasta: mal }] }).success,
        `inscripcionHasta ${String(mal)}`,
      ).toBe(false);
    }
    for (const mal of ['2026-11', '26/11/2026', '', 20261126, undefined]) {
      expect(safeParse({ ...solo, aperturaMesSiguiente: mal }).success, `apertura ${String(mal)}`).toBe(false);
    }
  });

  it('exige `meses` como lista (no acepta un texto, un objeto ni null)', () => {
    const { safeParse } = esquema('mesesInscripcionSchema');
    for (const mal of ['2026-11', null, {}, 1]) {
      expect(safeParse({ ...solo, meses: mal }).success, JSON.stringify(mal)).toBe(false);
    }
  });
});

describe('consultaFormularioSchema (criterio 2 y 16)', () => {
  it('acepta una consulta sin `mes` y con un `mes` AAAA-MM', () => {
    const { safeParse } = esquema('consultaFormularioSchema');
    expect(safeParse({}).success).toBe(true);
    expect(safeParse({ mes: '2026-12' }).success).toBe(true);
    expect(safeParse({ mes: '2027-01' }).success).toBe(true);
  });

  it('rechaza un `mes` que no es AAAA-MM, vacío, repetido (una lista) o de otro tipo', () => {
    const { safeParse } = esquema('consultaFormularioSchema');
    for (const mal of [
      '202612',
      '2026-13',
      '2026-00',
      '2026-1',
      '2026-12-01',
      'diciembre',
      '',
      ' 2026-12',
      ['2026-11', '2026-12'],
      202612,
      null,
    ]) {
      expect(safeParse({ mes: mal }).success, JSON.stringify(mal)).toBe(false);
    }
  });

  it('es estricto: rechaza otras claves', () => {
    const { safeParse } = esquema('consultaFormularioSchema');
    expect(safeParse({ mes: '2026-12', academiaId: ID }).success).toBe(false);
    expect(safeParse({ planId: ID }).success).toBe(false);
  });
});

describe('cotizarInscripcionSchema con `mes` (criterio 3 y 16)', () => {
  const base = { planId: ID, nivel: 'BASICO', claseIds: [OTRO] };

  it('sigue aceptando el cuerpo sin `mes` y acepta uno con `mes` AAAA-MM', () => {
    const { safeParse } = esquema('cotizarInscripcionSchema');
    expect(safeParse(base).success).toBe(true);
    expect(safeParse({ ...base, mes: '2026-12' }).success).toBe(true);
    expect(safeParse({ ...base, mes: '2026-11', claseIds: [OTRO, SEGUNDO_OTRO] }).success).toBe(true);
  });

  it('rechaza un `mes` mal escrito, vacío, nulo, de otro tipo o repetido', () => {
    const { safeParse } = esquema('cotizarInscripcionSchema');
    for (const mal of ['202612', '2026-13', '2026-1', '2026-12-01', 'diciembre', '', null, 202612, ['2026-12']]) {
      expect(safeParse({ ...base, mes: mal }).success, JSON.stringify(mal)).toBe(false);
    }
  });

  it('sigue siendo estricto y sigue pidiendo plan, nivel y clases', () => {
    const { safeParse } = esquema('cotizarInscripcionSchema');
    expect(safeParse({ ...base, mes: '2026-12', x: 1 }).success).toBe(false);
    expect(safeParse({ ...base, academiaId: ID }).success).toBe(false);
    expect(safeParse({ nivel: 'BASICO', claseIds: [OTRO], mes: '2026-12' }).success).toBe(false);
    expect(safeParse({ planId: ID, claseIds: [OTRO], mes: '2026-12' }).success).toBe(false);
    expect(safeParse({ planId: ID, nivel: 'BASICO', mes: '2026-12' }).success).toBe(false);
    expect(safeParse({ ...base, nivel: 'EXPERTO', mes: '2026-12' }).success).toBe(false);
  });
});

describe('los demás esquemas de la inscripción no cambian (criterio 16)', () => {
  it('respuestaFormularioInscripcionSchema sigue siendo estricto, con las mismas claves (una clave nueva no entra al contrato del formulario)', () => {
    const schema = esquema('respuestaFormularioInscripcionSchema');
    const textos = { DATOS_PERSONALES: 'a', DESLINDE: 'b', IMAGEN: 'c' };
    const respuesta = {
      academia: { nombre: 'Los Delfines', telefono: null },
      mes: '2026-12',
      hoy: '2026-11-27',
      planes: [],
      clases: [],
      consentimientos: { version: contratos.VERSION_CONSENTIMIENTOS, textos, textosMenor: textos },
    };

    expect(schema.safeParse(respuesta).success, 'la respuesta de siempre sirve para el mes siguiente').toBe(true);
    expect(schema.safeParse({ ...respuesta, meses: [] }).success).toBe(false);
    expect(schema.safeParse({ ...respuesta, mesesDisponibles: [] }).success).toBe(false);
  });

  it('enviarInscripcionSchema sigue pidiendo `inscripcion.mes` y rechaza claves nuevas en `inscripcion`', () => {
    const schema = esquema('enviarInscripcionSchema');
    const inscripcion = { planId: ID, claseIds: [OTRO], mes: '2026-12', montoMostrado: '120.00' };
    const cuerpo = (insc: unknown) => ({
      claveIdempotencia: ID,
      alumno: {
        nombres: 'Camila',
        apellidos: 'Quispe Rojas',
        dni: '45678912',
        fechaNacimiento: '1995-05-20',
        telefono: '987654321',
        nivel: 'BASICO',
      },
      fichaMedica: {
        tipoSangre: contratos.TIPOS_SANGRE[0],
        contactoEmergencia: { nombre: 'Rosa Quispe', telefono: '912345678' },
      },
      inscripcion: insc,
      consentimientos: { version: contratos.VERSION_CONSENTIMIENTOS, datosPersonales: true, deslinde: true },
    });

    expect(schema.safeParse(cuerpo(inscripcion)).success, 'un envío para diciembre es un cuerpo válido').toBe(true);
    expect(
      schema.safeParse(cuerpo({ planId: ID, claseIds: [OTRO], montoMostrado: '120.00' })).success,
      'el mes sigue siendo obligatorio',
    ).toBe(false);
    expect(schema.safeParse(cuerpo({ ...inscripcion, otroMes: '2027-01' })).success).toBe(false);
  });

  it('respuestaInscripcionCreadaSchema sigue llevando solo los campos del 201 y acepta la cotización y el vencimiento del mes siguiente', () => {
    const schema = esquema('respuestaInscripcionCreadaSchema');
    const solicitud = {
      codigo: 'AQ-7F3K9X',
      token: 'A'.repeat(43),
      enlace: `/a/delfines/solicitud/${'A'.repeat(43)}`,
      estado: 'PENDIENTE_PAGO',
      reservaVenceEn: '2026-12-02T03:00:00.000Z',
      cotizacion: {
        mes: '2026-12',
        fechaInicio: '2026-12-01',
        fechaFin: '2026-12-31',
        clasesRestantes: 13,
        clasesTotales: 12,
        clasesPorMes: 12,
        precioPlan: '120.00',
        monto: '120.00',
        esProporcional: false,
      },
    };

    expect(schema.safeParse({ solicitud }).success).toBe(true);
    expect(schema.safeParse({ solicitud: { ...solicitud, id: ID } }).success).toBe(false);
  });
});
