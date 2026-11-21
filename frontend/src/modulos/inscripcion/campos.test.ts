import type { ClasePublica, PlanPublico } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import {
  alternarClase,
  CAMPOS_INICIALES,
  type CamposInscripcion,
  clasesParaPlan,
  construirEnvio,
  esMenor,
  nuevaClaveDeEnvio,
  pasoDeCampo,
  pasosDeInscripcion,
  planesParaNivel,
  validarPaso,
} from './campos';

const PLAN: PlanPublico = {
  id: 'a1111111-1111-4111-8111-111111111111',
  nombre: 'Plan 2 veces',
  vecesPorSemana: 2,
  clasesPorMes: 8,
  duracionMinutos: 60,
  precio: '90.00',
  diasPermitidos: [1, 3],
  franjasPermitidas: ['17:00', '18:00'],
  nivelesAplicables: ['BASICO'],
};

function clase(
  id: string,
  nivel: ClasePublica['nivel'],
  diaSemana: ClasePublica['diaSemana'],
  horaInicio: ClasePublica['horaInicio'],
) {
  return { id, nivel, diaSemana, horaInicio, horaFin: '20:00', cuposRestantes: 3 } satisfies ClasePublica;
}

const LUN_17 = clase('c1111111-1111-4111-8111-111111111111', 'BASICO', 1, '17:00');
const LUN_18 = clase('c2222222-2222-4222-8222-222222222222', 'BASICO', 1, '18:00');
const MIE_18 = clase('c3333333-3333-4333-8333-333333333333', 'BASICO', 3, '18:00');
const MIE_19 = clase('c4444444-4444-4444-8444-444444444444', 'BASICO', 3, '19:00');
const MAR_17 = clase('c5555555-5555-4555-8555-555555555555', 'BASICO', 2, '17:00');
const INT_LUN_17 = clase('c6666666-6666-4666-8666-666666666666', 'INTERMEDIO', 1, '17:00');

function campos(extra: Partial<CamposInscripcion> = {}): CamposInscripcion {
  return {
    ...CAMPOS_INICIALES,
    alumno: {
      ...CAMPOS_INICIALES.alumno,
      nombres: 'Lucía',
      apellidos: 'Prado',
      dni: '45678912',
      fechaNacimiento: '2000-05-10',
      telefono: '987654321',
    },
    ...extra,
  };
}

const CONTEXTO = { hoy: '2026-11-20', plan: PLAN };

describe('pasos y edad', () => {
  it('el paso del apoderado solo está para menores', () => {
    expect(pasosDeInscripcion(false)).toEqual(['datos', 'ficha', 'plan', 'foto', 'resumen']);
    expect(pasosDeInscripcion(true)).toEqual(['datos', 'ficha', 'apoderado', 'plan', 'foto', 'resumen']);
  });

  it('es menor según la fecha de hoy que se le da, sin usar el reloj del navegador', () => {
    expect(esMenor('2008-11-21', '2026-11-20')).toBe(true);
    expect(esMenor('2008-11-20', '2026-11-20')).toBe(false);
    // 29 de febrero: en un año que no es bisiesto cumple el 1 de marzo.
    expect(esMenor('2008-02-29', '2026-02-28')).toBe(true);
    expect(esMenor('2008-02-29', '2026-03-01')).toBe(false);
    // Una fecha incompleta o imposible no cuenta como menor.
    expect(esMenor('', '2026-11-20')).toBe(false);
    expect(esMenor('2010-02-30', '2026-11-20')).toBe(false);
  });

  it('cada campo pertenece a su paso', () => {
    expect(pasoDeCampo('alumno.dni')).toBe('datos');
    expect(pasoDeCampo('alumno.nivel')).toBe('plan');
    expect(pasoDeCampo('fichaMedica.contactoEmergencia.telefono')).toBe('ficha');
    expect(pasoDeCampo('apoderado')).toBe('apoderado');
    expect(pasoDeCampo('inscripcion.claseIds')).toBe('plan');
    expect(pasoDeCampo('consentimientos.deslinde')).toBe('resumen');
  });
});

describe('validación por paso con los esquemas compartidos', () => {
  it('datos: un campo obligatorio vacío es "obligatorio", no un mensaje técnico', () => {
    const errores = validarPaso('datos', CAMPOS_INICIALES, CONTEXTO);
    expect(Object.keys(errores).sort()).toEqual([
      'alumno.apellidos',
      'alumno.dni',
      'alumno.fechaNacimiento',
      'alumno.nombres',
      'alumno.telefono',
    ]);
    expect(new Set(Object.values(errores))).toEqual(new Set(['Este dato es obligatorio.']));
  });

  it('datos: celular, DNI, correo y fecha con los mensajes de los esquemas', () => {
    const errores = validarPaso(
      'datos',
      campos({
        alumno: {
          ...campos().alumno,
          dni: '123',
          telefono: '12345',
          correo: 'sin-arroba',
          fechaNacimiento: '2100-01-01',
        },
      }),
      CONTEXTO,
    );
    expect(errores['alumno.dni']).toBe('El DNI debe tener exactamente 8 dígitos.');
    expect(errores['alumno.telefono']).toBe('El celular debe tener 9 dígitos y empezar con 9.');
    expect(errores['alumno.correo']).toBe('El correo no tiene un formato válido.');
    expect(errores['alumno.fechaNacimiento']).toBe('La fecha de nacimiento no puede ser futura.');
  });

  it('datos: el celular se acepta con espacios y guiones, y los opcionales vacíos no estorban', () => {
    expect(validarPaso('datos', campos({ alumno: { ...campos().alumno, telefono: '987-654 321' } }), CONTEXTO)).toEqual(
      {},
    );
  });

  it('datos: una persona de más de 100 años se rechaza', () => {
    const errores = validarPaso(
      'datos',
      campos({ alumno: { ...campos().alumno, fechaNacimiento: '1920-01-01' } }),
      CONTEXTO,
    );
    expect(errores['alumno.fechaNacimiento']).toBe('La fecha de nacimiento no puede ser de hace más de 100 años.');
  });

  it('ficha: tipo de sangre y contacto de emergencia son obligatorios', () => {
    const errores = validarPaso('ficha', CAMPOS_INICIALES, CONTEXTO);
    expect(errores['fichaMedica.tipoSangre']).toBe('Elige una opción.');
    expect(errores['fichaMedica.contactoEmergencia.nombre']).toBe('Este dato es obligatorio.');
    expect(errores['fichaMedica.contactoEmergencia.telefono']).toBe('Este dato es obligatorio.');
    const bien = campos({
      fichaMedica: {
        ...CAMPOS_INICIALES.fichaMedica,
        tipoSangre: 'NO_SABE',
        contactoEmergencia: { nombre: 'Marta Prado', telefono: '955443322' },
      },
    });
    expect(validarPaso('ficha', bien, CONTEXTO)).toEqual({});
  });

  it('apoderado: el DNI no puede ser el de la persona que se inscribe', () => {
    const apoderado = {
      nombres: 'Marta',
      apellidos: 'Quispe',
      dni: '45678912',
      telefono: '955443322',
      parentesco: 'MADRE',
      correo: '',
    };
    expect(validarPaso('apoderado', campos({ apoderado }), CONTEXTO)['apoderado.dni']).toBe(
      'El DNI del apoderado no puede ser igual al de la persona que se inscribe.',
    );
    expect(validarPaso('apoderado', campos({ apoderado: { ...apoderado, dni: '41234567' } }), CONTEXTO)).toEqual({});
  });

  it('plan: pide nivel, plan y exactamente tantas clases como veces por semana', () => {
    const errores = validarPaso('plan', CAMPOS_INICIALES, { hoy: CONTEXTO.hoy, plan: undefined });
    expect(errores['alumno.nivel']).toBe('Elige tu nivel.');
    expect(errores['inscripcion.planId']).toBe('Elige un plan.');

    const conUna = campos({
      alumno: { ...campos().alumno, nivel: 'BASICO' },
      inscripcion: { planId: PLAN.id, claseIds: [LUN_17.id] },
    });
    expect(validarPaso('plan', conUna, CONTEXTO)['inscripcion.claseIds']).toBe('Elige 2 clases, una por día.');
    const completo = campos({
      alumno: { ...campos().alumno, nivel: 'BASICO' },
      inscripcion: { planId: PLAN.id, claseIds: [LUN_17.id, MIE_18.id] },
    });
    expect(validarPaso('plan', completo, CONTEXTO)).toEqual({});
  });

  it('foto: es opcional, así que el paso no pide nada', () => {
    expect(validarPaso('foto', CAMPOS_INICIALES, CONTEXTO)).toEqual({});
  });

  it('resumen: los dos consentimientos obligatorios, no el de imagen', () => {
    expect(Object.keys(validarPaso('resumen', CAMPOS_INICIALES, CONTEXTO)).sort()).toEqual([
      'consentimientos.datosPersonales',
      'consentimientos.deslinde',
    ]);
    const aceptados = campos({ consentimientos: { datosPersonales: true, deslinde: true, imagen: false } });
    expect(validarPaso('resumen', aceptados, CONTEXTO)).toEqual({});
  });
});

describe('cuerpo del envío', () => {
  it('no envía los opcionales vacíos ni el apoderado de un mayor', () => {
    const cuerpo = construirEnvio(campos(), {
      claveIdempotencia: 'a1111111-1111-4111-8111-111111111111',
      mes: '2026-11',
      montoMostrado: '34.00',
      version: 'v1',
      menor: false,
    }) as Record<string, Record<string, unknown>>;
    expect(cuerpo['alumno']).not.toHaveProperty('correo');
    expect(cuerpo['alumno']).not.toHaveProperty('direccion');
    expect(cuerpo['alumno']).not.toHaveProperty('gradoColegio');
    expect(cuerpo).not.toHaveProperty('apoderado');
    expect(cuerpo['fichaMedica']).not.toHaveProperty('alergias');
  });

  it('lleva el apoderado de un menor', () => {
    const cuerpo = construirEnvio(
      campos({
        apoderado: {
          nombres: 'Marta',
          apellidos: 'Quispe',
          dni: '41234567',
          telefono: '955443322',
          parentesco: 'MADRE',
          correo: '',
        },
      }),
      {
        claveIdempotencia: 'a1111111-1111-4111-8111-111111111111',
        mes: '2026-11',
        montoMostrado: '34.00',
        version: 'v1',
        menor: true,
      },
    ) as Record<string, unknown>;
    expect(cuerpo['apoderado']).toEqual({
      nombres: 'Marta',
      apellidos: 'Quispe',
      dni: '41234567',
      telefono: '955443322',
      parentesco: 'MADRE',
    });
  });
});

describe('oferta de planes y clases', () => {
  it('los planes del nivel', () => {
    expect(planesParaNivel([PLAN], 'BASICO')).toEqual([PLAN]);
    expect(planesParaNivel([PLAN], 'AVANZADO')).toEqual([]);
    expect(planesParaNivel([PLAN], '')).toEqual([]);
  });

  it('las clases del nivel en los días y franjas del plan, por día y hora', () => {
    const todas = [MIE_18, LUN_18, MIE_19, MAR_17, INT_LUN_17, LUN_17];
    expect(clasesParaPlan(todas, PLAN, 'BASICO').map((c) => c.id)).toEqual([LUN_17.id, LUN_18.id, MIE_18.id]);
  });

  it('una sola clase por día: otra del mismo día reemplaza a la anterior', () => {
    const conocidas = [LUN_17, LUN_18, MIE_18];
    expect(alternarClase([LUN_17.id], LUN_18, conocidas, 2)).toEqual([LUN_18.id]);
    expect(alternarClase([LUN_17.id], MIE_18, conocidas, 2)).toEqual([LUN_17.id, MIE_18.id]);
    // Quitar la elegida.
    expect(alternarClase([LUN_17.id, MIE_18.id], MIE_18, conocidas, 2)).toEqual([LUN_17.id]);
  });

  it('no agrega un día más que las veces por semana del plan', () => {
    const viernes = clase('c7777777-7777-4777-8777-777777777777', 'BASICO', 5, '18:00');
    const conocidas = [LUN_17, MIE_18, viernes];
    expect(alternarClase([LUN_17.id, MIE_18.id], viernes, conocidas, 2)).toEqual([LUN_17.id, MIE_18.id]);
    // Pero cambiar la hora de un día ya elegido sí se puede.
    expect(alternarClase([LUN_17.id, MIE_18.id], LUN_18, [...conocidas, LUN_18], 2)).toEqual([MIE_18.id, LUN_18.id]);
  });
});

describe('clave de idempotencia', () => {
  it('es un UUID y es distinta en cada formulario', () => {
    const a = nuevaClaveDeEnvio();
    const b = nuevaClaveDeEnvio();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
