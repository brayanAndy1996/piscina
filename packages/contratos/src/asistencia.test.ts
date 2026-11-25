import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ALERTAS,
  CODIGOS_RECHAZO_ASISTENCIA,
  rechazoAsistenciaSchema,
  registrarAsistenciaManualSchema,
  registrarAsistenciaQrSchema,
  resultadoAsistenciaSchema,
} from './index';

const alumno = { id: randomUUID(), nombres: 'Valeria', apellidos: 'Mendoza Salas', nivel: 'BASICO', foto: null };
const clases = { usadas: 1, totales: 12, restantes: 11 };

describe('contratos de la asistencia (009a)', () => {
  it('el cuerpo del QR es estricto: contenido de hasta 200 caracteres y una clave UUID', () => {
    const clave = randomUUID();
    expect(registrarAsistenciaQrSchema.safeParse({ contenido: '', claveIdempotencia: clave }).success).toBe(true);
    expect(
      registrarAsistenciaQrSchema.safeParse({ contenido: 'x'.repeat(200), claveIdempotencia: clave }).success,
    ).toBe(true);
    expect(
      registrarAsistenciaQrSchema.safeParse({ contenido: 'x'.repeat(201), claveIdempotencia: clave }).success,
    ).toBe(false);
    expect(registrarAsistenciaQrSchema.safeParse({ contenido: 42, claveIdempotencia: clave }).success).toBe(false);
    expect(registrarAsistenciaQrSchema.safeParse({ contenido: 'a', claveIdempotencia: 'no-es-uuid' }).success).toBe(
      false,
    );
    expect(
      registrarAsistenciaQrSchema.safeParse({ contenido: 'a', claveIdempotencia: clave, academiaId: clave }).success,
    ).toBe(false);
  });

  it('el cuerpo manual es estricto: un texto como alumnoId (el 404 lo decide la API) y una clave UUID', () => {
    const clave = randomUUID();
    expect(
      registrarAsistenciaManualSchema.safeParse({ alumnoId: randomUUID(), claveIdempotencia: clave }).success,
    ).toBe(true);
    expect(
      registrarAsistenciaManualSchema.safeParse({ alumnoId: 'no-es-uuid', claveIdempotencia: clave }).success,
    ).toBe(true);
    expect(registrarAsistenciaManualSchema.safeParse({ alumnoId: 42, claveIdempotencia: clave }).success).toBe(false);
    expect(registrarAsistenciaManualSchema.safeParse({ claveIdempotencia: clave }).success).toBe(false);
  });

  it('cada código de rechazo tiene su alerta (criterio 7)', () => {
    expect(CODIGOS_RECHAZO_ASISTENCIA).toEqual({
      ALUMNO_INACTIVO: 'ROJA',
      ASISTENCIA_YA_REGISTRADA: 'AMARILLA',
      PAGO_EN_VERIFICACION: 'ROJA',
      MENSUALIDAD_NO_VIGENTE: 'ROJA',
      SIN_CLASES_RESTANTES: 'ROJA',
      FUERA_DE_HORARIO: 'AMARILLA',
      CLASE_NO_INCLUIDA: 'AMARILLA',
    });
    for (const alerta of Object.values(CODIGOS_RECHAZO_ASISTENCIA)) expect(ALERTAS).toContain(alerta);
  });

  it('el resultado y el rechazo son estrictos: ni el DNI ni un campo de más', () => {
    const resultado = {
      asistencia: {
        id: randomUUID(),
        fecha: '2026-11-16',
        horaLlegada: '18:05',
        llegadaEn: '2026-11-16T23:05:00.000Z',
        estadoLlegada: 'PUNTUAL',
        metodo: 'QR',
        registroPosterior: false,
      },
      alumno,
      clase: { id: randomUUID(), nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' },
      clases,
      repetida: false,
    };
    expect(resultadoAsistenciaSchema.safeParse(resultado).success).toBe(true);
    expect(resultadoAsistenciaSchema.safeParse({ ...resultado, alumno: { ...alumno, dni: '47811902' } }).success).toBe(
      false,
    );
    expect(resultadoAsistenciaSchema.safeParse({ ...resultado, token: 'x' }).success).toBe(false);

    const rechazo = { alerta: 'AMARILLA', alumno, claseDeHoy: null, asistenciaDeHoy: null, clases: null };
    expect(rechazoAsistenciaSchema.safeParse(rechazo).success).toBe(true);
    expect(rechazoAsistenciaSchema.safeParse({ ...rechazo, alerta: 'VERDE' }).success).toBe(false);
    expect(rechazoAsistenciaSchema.safeParse({ ...rechazo, dni: '1' }).success).toBe(false);
  });
});
