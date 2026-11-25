/** Datos de prueba del carnet, compartidos por las pruebas de componentes de `carnet/` y `alumnos/`. Inventados. */

export const ID_ALUMNO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
/** 43 caracteres de base64url, como el token real. */
export const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
export const CONTENIDO = `AQ1:${TOKEN}`;

export function carnetDePrueba(extra: Record<string, unknown> = {}) {
  return {
    academia: { nombre: 'Academia de Natación Los Delfines' },
    alumno: {
      id: ID_ALUMNO,
      nombres: 'Lucía Fernanda',
      apellidos: 'Prado Quispe',
      dni: '45678912',
      nivel: 'INTERMEDIO',
      estado: 'ALUMNO_ACTIVO',
    },
    foto: null,
    matricula: {
      plan: 'Plan 3 veces',
      clases: [
        { diaSemana: 2, horaInicio: '18:00', horaFin: '19:00' },
        { diaSemana: 3, horaInicio: '18:00', horaFin: '19:00' },
        { diaSemana: 4, horaInicio: '18:00', horaFin: '19:00' },
      ],
      desde: '2026-11-01',
      hasta: '2026-11-30',
      vigenteHoy: true,
    },
    qr: { contenido: CONTENIDO, generadoEn: '2026-11-24T15:00:00.000Z' },
    ...extra,
  };
}
