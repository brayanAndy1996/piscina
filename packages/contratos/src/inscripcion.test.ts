import { describe, expect, it } from 'vitest';
import {
  cotizarInscripcionSchema,
  enviarInscripcionSchema,
  esMenorDeEdad,
  GRADOS_COLEGIO,
  PARENTESCOS,
  respuestaFormularioInscripcionSchema,
  respuestaInscripcionCreadaSchema,
  telefonoCelularSchema,
  TIPOS_SANGRE,
  validarFechaNacimiento,
  VERSION_CONSENTIMIENTOS,
} from './index';

const ID = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';
const OTRO = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

function cuerpoValido() {
  return {
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
      tipoSangre: TIPOS_SANGRE[0],
      contactoEmergencia: { nombre: 'Rosa Quispe', telefono: '912345678' },
    },
    inscripcion: { planId: ID, claseIds: [ID, OTRO], mes: '2026-11', montoMostrado: '90.00' },
    consentimientos: { version: VERSION_CONSENTIMIENTOS, datosPersonales: true, deslinde: true },
  };
}

describe('telefonoCelularSchema (criterio 12, DR-5 de 005)', () => {
  it.each([
    ['987654321', '987654321'],
    [' 987 654 321 ', '987654321'],
    ['987-654-321', '987654321'],
    ['912345678', '912345678'],
  ])('acepta %j y guarda %j', (entrada, esperado) => {
    expect(telefonoCelularSchema.parse(entrada)).toBe(esperado);
  });

  it.each(['98765432', '887654321', '9876543210', '98765432a', '', '+51987654321', '9 8765 432'])(
    'rechaza %j',
    (entrada) => {
      expect(telefonoCelularSchema.safeParse(entrada).success).toBe(false);
    },
  );

  it('rechaza lo que no es texto', () => {
    expect(telefonoCelularSchema.safeParse(987654321).success).toBe(false);
    expect(telefonoCelularSchema.safeParse(null).success).toBe(false);
  });
});

describe('esMenorDeEdad y validarFechaNacimiento', () => {
  it('compara textos AAAA-MM-DD: la víspera de los 18 es menor y el día de los 18 ya es mayor', () => {
    expect(esMenorDeEdad('2008-11-21', '2026-11-20')).toBe(true);
    expect(esMenorDeEdad('2008-11-20', '2026-11-20')).toBe(false);
  });

  it('el 29 de febrero cumple el 1 de marzo en los años no bisiestos', () => {
    expect(esMenorDeEdad('2008-02-29', '2026-02-28')).toBe(true);
    expect(esMenorDeEdad('2008-02-29', '2026-03-01')).toBe(false);
  });

  it('no acepta una fecha futura ni de hace más de 100 años; sí el día de hoy y justo 100 años atrás', () => {
    expect(validarFechaNacimiento('2026-11-12', '2026-11-11')).toMatch(/futura/);
    expect(validarFechaNacimiento('1925-11-10', '2026-11-11')).toMatch(/100 años/);
    expect(validarFechaNacimiento('1926-11-10', '2026-11-11')).toMatch(/100 años/);
    expect(validarFechaNacimiento('1926-11-11', '2026-11-11')).toBeNull();
    expect(validarFechaNacimiento('2026-11-11', '2026-11-11')).toBeNull();
    expect(validarFechaNacimiento('1995-05-20', '2026-11-11')).toBeNull();
  });
});

describe('enviarInscripcionSchema (criterios 12 a 14)', () => {
  it('acepta el cuerpo mínimo y normaliza el correo, el celular y el DNI', () => {
    const cuerpo = cuerpoValido();
    const resultado = enviarInscripcionSchema.safeParse({
      ...cuerpo,
      alumno: { ...cuerpo.alumno, dni: ' 45678912 ', telefono: '987 654 321', correo: ' Familia@Ejemplo.TEST ' },
    });

    expect(resultado.success).toBe(true);
    expect(resultado.data?.alumno).toMatchObject({
      dni: '45678912',
      telefono: '987654321',
      correo: 'familia@ejemplo.test',
    });
  });

  it('es estricto en todos los niveles: un campo de más es un error', () => {
    const cuerpo = cuerpoValido();
    const conExtra = [
      { ...cuerpo, academiaId: ID },
      { ...cuerpo, alumno: { ...cuerpo.alumno, estado: 'ALUMNO_ACTIVO' } },
      { ...cuerpo, fichaMedica: { ...cuerpo.fichaMedica, observaciones: 'x' } },
      {
        ...cuerpo,
        fichaMedica: { ...cuerpo.fichaMedica, contactoEmergencia: { nombre: 'Rosa', telefono: '912345678', x: 1 } },
      },
      { ...cuerpo, inscripcion: { ...cuerpo.inscripcion, monto: '1.00' } },
      { ...cuerpo, consentimientos: { ...cuerpo.consentimientos, whatsapp: true } },
    ];
    for (const caso of conExtra) expect(enviarInscripcionSchema.safeParse(caso).success).toBe(false);
  });

  it('los consentimientos obligatorios deben ser true (literal) y la imagen es opcional y booleana', () => {
    const cuerpo = cuerpoValido();
    for (const cambio of [
      { datosPersonales: false },
      { deslinde: false },
      { datosPersonales: 'true' },
      { deslinde: 1 },
    ]) {
      const resultado = enviarInscripcionSchema.safeParse({
        ...cuerpo,
        consentimientos: { ...cuerpo.consentimientos, ...cambio },
      });
      expect(resultado.success).toBe(false);
    }
    expect(
      enviarInscripcionSchema.safeParse({ ...cuerpo, consentimientos: { ...cuerpo.consentimientos, imagen: false } })
        .success,
    ).toBe(true);
    expect(
      enviarInscripcionSchema.safeParse({ ...cuerpo, consentimientos: { ...cuerpo.consentimientos, imagen: 'si' } })
        .success,
    ).toBe(false);
  });

  it('las clases son de 1 a 7, sin repetidos (sin distinguir mayúsculas) y UUID', () => {
    const cuerpo = cuerpoValido();
    const con = (claseIds: unknown) =>
      enviarInscripcionSchema.safeParse({ ...cuerpo, inscripcion: { ...cuerpo.inscripcion, claseIds } }).success;

    expect(con([])).toBe(false);
    expect(con([ID, ID])).toBe(false);
    expect(con([OTRO, OTRO.toUpperCase()])).toBe(false);
    expect(con(['uno'])).toBe(false);
    expect(con(Array.from({ length: 8 }, (_, i) => `3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e0${i}`))).toBe(false);
    expect(con([ID])).toBe(true);
  });

  it('el mes es AAAA-MM y el monto mostrado cumple montoSchema', () => {
    const cuerpo = cuerpoValido();
    const con = (cambio: object) =>
      enviarInscripcionSchema.safeParse({ ...cuerpo, inscripcion: { ...cuerpo.inscripcion, ...cambio } }).success;

    for (const mes of ['2026-13', '2026-1', 'noviembre', '2026-11-01']) expect(con({ mes })).toBe(false);
    for (const montoMostrado of ['90.123', '-90.00', 90, '', '0.00']) expect(con({ montoMostrado })).toBe(false);
    expect(con({ mes: '2026-12', montoMostrado: '120' })).toBe(true);
  });

  it('el tipo de sangre, el grado y el parentesco salen de sus listas', () => {
    const cuerpo = cuerpoValido();
    expect(
      enviarInscripcionSchema.safeParse({ ...cuerpo, fichaMedica: { ...cuerpo.fichaMedica, tipoSangre: 'Z+' } })
        .success,
    ).toBe(false);
    expect(
      enviarInscripcionSchema.safeParse({ ...cuerpo, alumno: { ...cuerpo.alumno, gradoColegio: 'DOCTORADO' } }).success,
    ).toBe(false);
    expect(
      enviarInscripcionSchema.safeParse({ ...cuerpo, alumno: { ...cuerpo.alumno, gradoColegio: GRADOS_COLEGIO[0] } })
        .success,
    ).toBe(true);
    const apoderado = { nombres: 'Rosa', apellidos: 'Rojas Vega', dni: '12345678', telefono: '955123456' };
    expect(
      enviarInscripcionSchema.safeParse({ ...cuerpo, apoderado: { ...apoderado, parentesco: PARENTESCOS[0] } }).success,
    ).toBe(true);
    expect(
      enviarInscripcionSchema.safeParse({ ...cuerpo, apoderado: { ...apoderado, parentesco: 'vecino' } }).success,
    ).toBe(false);
  });

  it('los textos no admiten controles, bidireccionales ni quedan sin letras visibles', () => {
    const cuerpo = cuerpoValido();
    const con = (alumno: object) =>
      enviarInscripcionSchema.safeParse({ ...cuerpo, alumno: { ...cuerpo.alumno, ...alumno } }).success;

    expect(con({ nombres: 'Cami\u0007la' })).toBe(false);
    expect(con({ nombres: 'Camila‮' })).toBe(false);
    expect(con({ nombres: '​​​' })).toBe(false);
    expect(con({ nombres: 'A' })).toBe(false);
    expect(con({ nombres: 'a'.repeat(61) })).toBe(false);
    expect(con({ nombres: 'María José', apellidos: 'Peña Núñez' })).toBe(true);
    expect(con({ direccion: 'Jr. Uno\u0000 123' })).toBe(false);
  });

  it('el correo tiene como máximo 254 caracteres y un formato válido', () => {
    const cuerpo = cuerpoValido();
    const con = (correo: string) =>
      enviarInscripcionSchema.safeParse({ ...cuerpo, alumno: { ...cuerpo.alumno, correo } }).success;

    expect(con('sin-arroba.test')).toBe(false);
    expect(con('a@@ejemplo.test')).toBe(false);
    expect(con(`${'x'.repeat(250)}@ejemplo.test`)).toBe(false);
    expect(con('familia@ejemplo.test')).toBe(true);
  });
});

describe('cotizarInscripcionSchema', () => {
  it('pide plan, nivel y clases, y es estricto', () => {
    expect(cotizarInscripcionSchema.safeParse({ planId: ID, nivel: 'BASICO', claseIds: [OTRO] }).success).toBe(true);
    expect(cotizarInscripcionSchema.safeParse({ planId: ID, nivel: 'EXPERTO', claseIds: [OTRO] }).success).toBe(false);
    expect(cotizarInscripcionSchema.safeParse({ planId: ID, nivel: 'BASICO', claseIds: [OTRO], x: 1 }).success).toBe(
      false,
    );
    expect(cotizarInscripcionSchema.safeParse({ planId: ID, nivel: 'BASICO' }).success).toBe(false);
  });
});

describe('respuestas de la inscripción', () => {
  const cotizacion = {
    mes: '2026-11',
    fechaInicio: '2026-11-11',
    fechaFin: '2026-11-30',
    clasesRestantes: 9,
    clasesTotales: 9,
    clasesPorMes: 12,
    precioPlan: '120.00',
    monto: '90.00',
    esProporcional: true,
  };

  it('respuestaInscripcionCreadaSchema lleva solo los campos del 201', () => {
    const solicitud = {
      codigo: 'AQ-7F3K9X',
      token: 'A'.repeat(43),
      enlace: `/a/delfines/solicitud/${'A'.repeat(43)}`,
      estado: 'PENDIENTE_PAGO',
      reservaVenceEn: '2026-11-12T15:00:00.000Z',
      cotizacion,
    };

    expect(respuestaInscripcionCreadaSchema.safeParse({ solicitud }).success).toBe(true);
    expect(respuestaInscripcionCreadaSchema.safeParse({ solicitud: { ...solicitud, id: ID } }).success).toBe(false);
    expect(respuestaInscripcionCreadaSchema.safeParse({ solicitud: { ...solicitud, estado: 'VENCIDA' } }).success).toBe(
      false,
    );
  });

  it('respuestaFormularioInscripcionSchema no admite entrenador, aforo ni ocupación en las clases', () => {
    const clase = { id: ID, nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00', cuposRestantes: 20 };
    const textos = { DATOS_PERSONALES: 'a', DESLINDE: 'b', IMAGEN: 'c' };
    const base = {
      academia: { nombre: 'Los Delfines', telefono: null },
      mes: '2026-11',
      hoy: '2026-11-11',
      planes: [],
      clases: [clase],
      consentimientos: { version: VERSION_CONSENTIMIENTOS, textos, textosMenor: textos },
    };

    expect(respuestaFormularioInscripcionSchema.safeParse(base).success).toBe(true);
    expect(respuestaFormularioInscripcionSchema.safeParse({ ...base, clases: [{ ...clase, aforo: 20 }] }).success).toBe(
      false,
    );
    expect(
      respuestaFormularioInscripcionSchema.safeParse({ ...base, clases: [{ ...clase, entrenador: { id: ID } }] })
        .success,
    ).toBe(false);
  });
});
