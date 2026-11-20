// spec: 005-inscripcion-publica (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AcademiaDePrueba, crearAcademiaDePrueba } from '../../utilidades/academias';
import { limpiarBase } from '../../utilidades/base-datos';
import {
  actualizarFilas,
  codigoAleatorio,
  crearAlumnoSolo,
  exigirTablasDeInscripcion,
  filaValida,
  insertarFila,
  sha256,
  tokenAleatorio,
  type Libre,
  type PadresDeFila,
  type Tabla005,
} from '../../utilidades/inscripciones';
import { crearClaseDePrueba, crearEntrenadorDePrueba, crearPlanDePrueba } from '../../utilidades/planes-clases';

// Criterio 4 (crítico, RN-11, RN-25, D-07, D-28): invariantes en la base. Un INSERT o UPDATE directo, como app y como dueño de las
// tablas, falla con 23514 (CHECK) o 23505 (único) en cada caso:
//   a) DNI que no sean 8 dígitos; dos alumnos de A con el mismo DNI (en B se acepta, D-28);
//   b) fecha de nacimiento no finita;
//   c) matrículas: mes fuera de 1 a 12, clases_totales < 1 o mayor que clases_por_mes_plan, clases_usadas negativas o mayores que
//      clases_totales, precio_plan o monto_calculado <= 0 o NaN, clases_por_mes_plan < 1, fecha_fin anterior a fecha_inicio o fuera del mes,
//      reserva_vence_en no nula en una matrícula que no está RESERVADA;
//   d) dos matrículas que ocupan cupo del mismo alumno en el mismo mes;
//   e) dos solicitudes PENDIENTE_PAGO del mismo alumno; dos solicitudes de A con el mismo código o el mismo hash de token;
//   f) código que no cumple el formato del criterio 24 y token_hash que no tiene 32 bytes;
//   g) consentimientos con un tipo fuera de los tres o una versión vacía (P6: el tipo es un enumerado; se acepta 22P02 o 23514).

const ROLES = ['propietario', 'app'] as const;
type Rol = (typeof ROLES)[number];

describe('criterio 4: invariantes de las tablas de la inscripción', () => {
  let A: AcademiaDePrueba;
  let B: AcademiaDePrueba;
  let planId: string;
  let claseId: string;

  beforeEach(exigirTablasDeInscripcion);
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    B = await crearAcademiaDePrueba();
    const entrenador = await crearEntrenadorDePrueba(A.id);
    planId = (await crearPlanDePrueba(A.id)).id;
    claseId = (await crearClaseDePrueba(A.id, entrenador.id)).id;
  });

  async function padres(): Promise<Partial<PadresDeFila>> {
    return { alumnoId: await crearAlumnoSolo(A.id), planId, claseId };
  }

  /** Una fila válida de la tabla con un alumno nuevo (y, si hace falta, una solicitud nueva) y los cambios dados. */
  async function fila(tabla: Tabla005, cambios: Libre = {}): Promise<Libre> {
    const base = await padres();
    if (tabla === 'consentimientos') {
      const alumnoId = base.alumnoId as string;
      const solicitudId = randomUUID();
      await insertarFila('propietario', 'solicitudes_inscripcion', A.id, {
        ...(await filaValida('solicitudes_inscripcion', { alumnoId })),
        id: solicitudId,
      });
      return { ...(await filaValida(tabla, { ...base, solicitudId })), ...cambios };
    }
    return { ...(await filaValida(tabla, base)), ...cambios };
  }

  async function rechaza(rol: Rol, tabla: Tabla005, cambios: Libre, codigo: string | RegExp, nombre: string) {
    const datos = await fila(tabla, cambios);
    const esperado = typeof codigo === 'string' ? { code: codigo } : { code: expect.stringMatching(codigo) as string };
    await expect(insertarFila(rol, tabla, A.id, datos), `${rol}: ${nombre}`).rejects.toMatchObject(esperado);
  }

  describe('a) DNI del alumno', () => {
    it.each(ROLES)('criterio 4 a: un DNI que no son 8 dígitos falla con 23514 (%s)', async (rol) => {
      for (const dni of [
        '1234567',
        '123456789',
        'abcdefgh',
        '1234567a',
        '',
        ' 1234567',
        '12345678\n',
        '١٢٣٤٥٦٧٨',
        '1234 678',
      ]) {
        await rechaza(rol, 'alumnos', { dni }, '23514', `DNI ${JSON.stringify(dni)}`);
      }
    });

    it.each(ROLES)('criterio 4 a: un DNI de 8 dígitos se acepta, también con ceros al inicio (%s)', async (rol) => {
      await expect(
        insertarFila(rol, 'alumnos', A.id, await fila('alumnos', { dni: '00123456' })),
      ).resolves.toBeUndefined();
    });

    it('criterio 4 a: un UPDATE directo del DNI a algo inválido, como dueño, falla con 23514', async () => {
      const id = await crearAlumnoSolo(A.id);

      await expect(actualizarFilas('propietario', 'alumnos', A.id, { id }, { dni: '123' })).rejects.toMatchObject({
        code: '23514',
      });
    });

    it.each(ROLES)(
      'criterio 4 a: dos alumnos de A con el mismo DNI fallan con 23505; en B se acepta (D-28) (%s)',
      async (rol) => {
        await crearAlumnoSolo(A.id, { dni: '45678912' });

        await rechaza(rol, 'alumnos', { dni: '45678912' }, '23505', 'mismo DNI en A');
        await expect(
          insertarFila(rol, 'alumnos', B.id, { ...(await filaValida('alumnos', {})), dni: '45678912' }),
        ).resolves.toBeUndefined();
      },
    );
  });

  describe('b) fecha de nacimiento', () => {
    it.each(ROLES)('criterio 4 b: infinity y -infinity fallan con 23514 (%s)', async (rol) => {
      for (const fecha of ['infinity', '-infinity']) {
        await rechaza(rol, 'alumnos', { fecha_nacimiento: fecha }, '23514', `fecha ${fecha}`);
      }
    });

    it('criterio 4 b: un UPDATE directo a infinity, como dueño, falla con 23514', async () => {
      const id = await crearAlumnoSolo(A.id);

      await expect(
        actualizarFilas('propietario', 'alumnos', A.id, { id }, { fecha_nacimiento: 'infinity' }),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('c) matrículas', () => {
    it.each(ROLES)('criterio 4 c (control): la matrícula válida se acepta (%s)', async (rol) => {
      await expect(insertarFila(rol, 'matriculas', A.id, await fila('matriculas'))).resolves.toBeUndefined();
    });

    it.each(ROLES)('criterio 4 c: mes fuera de 1 a 12 falla con 23514 (%s)', async (rol) => {
      for (const mes of [0, 13, -1, 99]) {
        await rechaza(rol, 'matriculas', { mes }, '23514', `mes ${mes}`);
      }
    });

    it.each(ROLES)(
      'criterio 4 c: clases_totales menor que 1 o mayor que clases_por_mes_plan falla con 23514 (%s)',
      async (rol) => {
        for (const clases_totales of [0, -1, 13, 100]) {
          await rechaza(rol, 'matriculas', { clases_totales }, '23514', `clases_totales ${clases_totales}`);
        }
        await expect(
          insertarFila(rol, 'matriculas', A.id, await fila('matriculas', { clases_totales: 12 })),
          'clases_totales igual al plan se acepta',
        ).resolves.toBeUndefined();
      },
    );

    it.each(ROLES)(
      'criterio 4 c: clases_usadas negativas o mayores que clases_totales fallan con 23514 (%s)',
      async (rol) => {
        for (const clases_usadas of [-1, 11, 12]) {
          await rechaza(rol, 'matriculas', { clases_usadas }, '23514', `clases_usadas ${clases_usadas}`);
        }
        await expect(
          insertarFila(rol, 'matriculas', A.id, await fila('matriculas', { clases_usadas: 10 })),
          'clases_usadas igual a clases_totales se acepta',
        ).resolves.toBeUndefined();
      },
    );

    it.each(ROLES)(
      'criterio 4 c: precio_plan o monto_calculado menores o iguales que 0, o NaN, fallan con 23514 (%s)',
      async (rol) => {
        for (const valor of ['0', '0.00', '-1', '-0.01', 'NaN']) {
          await rechaza(rol, 'matriculas', { precio_plan: valor }, '23514', `precio_plan ${valor}`);
          await rechaza(rol, 'matriculas', { monto_calculado: valor }, '23514', `monto_calculado ${valor}`);
        }
      },
    );

    it.each(ROLES)('criterio 4 c: clases_por_mes_plan menor que 1 falla con 23514 (%s)', async (rol) => {
      for (const clases_por_mes_plan of [0, -1]) {
        await rechaza(
          rol,
          'matriculas',
          { clases_por_mes_plan },
          '23514',
          `clases_por_mes_plan ${clases_por_mes_plan}`,
        );
      }
    });

    it.each(ROLES)(
      'criterio 4 c: fecha_fin anterior a fecha_inicio, o fuera del mes de anio y mes, falla con 23514 (%s)',
      async (rol) => {
        await rechaza(rol, 'matriculas', { fecha_fin: '2026-11-10' }, '23514', 'fin antes del inicio');
        await rechaza(rol, 'matriculas', { fecha_fin: '2026-12-05' }, '23514', 'fin en el mes siguiente');
        await rechaza(rol, 'matriculas', { fecha_inicio: '2026-10-31' }, '23514', 'inicio en el mes anterior');
        await rechaza(
          rol,
          'matriculas',
          { fecha_inicio: '2025-11-11', fecha_fin: '2025-11-30' },
          '23514',
          'fechas de otro año',
        );
      },
    );

    it.each(ROLES)(
      'criterio 4 c: reserva_vence_en no nula en una matrícula que no está RESERVADA falla con 23514 (%s)',
      async (rol) => {
        for (const estado of ['VIGENTE', 'CANCELADA', 'FINALIZADA']) {
          await rechaza(
            rol,
            'matriculas',
            { estado, reserva_vence_en: '2026-11-12T15:00:00.000Z' },
            '23514',
            `estado ${estado} con vencimiento`,
          );
        }
        for (const estado of ['VIGENTE', 'CANCELADA', 'FINALIZADA']) {
          await expect(
            insertarFila(rol, 'matriculas', A.id, await fila('matriculas', { estado, reserva_vence_en: null })),
            `${estado} sin vencimiento se acepta`,
          ).resolves.toBeUndefined();
        }
        await expect(
          insertarFila(
            rol,
            'matriculas',
            A.id,
            await fila('matriculas', { estado: 'RESERVADA', reserva_vence_en: null }),
          ),
          'RESERVADA sin vencimiento (pago en verificación) se acepta',
        ).resolves.toBeUndefined();
      },
    );

    it('criterio 4 c: un UPDATE como app que deja un vencimiento en una matrícula cancelada falla con 23514; como dueño, un UPDATE con clases_totales 0 también', async () => {
      const datos = await fila('matriculas', { estado: 'CANCELADA', reserva_vence_en: null });
      await insertarFila('propietario', 'matriculas', A.id, datos);

      await expect(
        actualizarFilas(
          'app',
          'matriculas',
          A.id,
          { id: datos['id'] },
          { reserva_vence_en: '2026-11-12T15:00:00.000Z' },
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        actualizarFilas('propietario', 'matriculas', A.id, { id: datos['id'] }, { clases_totales: 0 }),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('d) una matrícula que ocupa cupo por alumno y mes', () => {
    it.each(ROLES)(
      'criterio 4 d: dos matrículas RESERVADA o VIGENTE del mismo alumno en el mismo mes fallan con 23505 (%s)',
      async (rol) => {
        const combinaciones: [string, string][] = [
          ['RESERVADA', 'RESERVADA'],
          ['RESERVADA', 'VIGENTE'],
          ['VIGENTE', 'RESERVADA'],
          ['VIGENTE', 'VIGENTE'],
        ];
        for (const [primera, segunda] of combinaciones) {
          const alumnoId = await crearAlumnoSolo(A.id);
          const cupo = (estado: string) => ({
            alumno_id: alumnoId,
            estado,
            reserva_vence_en: estado === 'RESERVADA' ? '2026-11-12T15:00:00.000Z' : null,
          });
          await insertarFila('propietario', 'matriculas', A.id, await fila('matriculas', cupo(primera)));

          await expect(
            insertarFila(rol, 'matriculas', A.id, await fila('matriculas', cupo(segunda))),
            `${rol}: ${primera} y ${segunda}`,
          ).rejects.toMatchObject({ code: '23505' });
        }
      },
    );

    it.each(ROLES)(
      'criterio 4 d: una cancelada o finalizada no cuenta, ni otro mes, ni otro alumno (%s)',
      async (rol) => {
        const alumnoId = await crearAlumnoSolo(A.id);
        await insertarFila(
          'propietario',
          'matriculas',
          A.id,
          await fila('matriculas', { alumno_id: alumnoId, estado: 'VIGENTE', reserva_vence_en: null }),
        );

        for (const estado of ['CANCELADA', 'FINALIZADA']) {
          await expect(
            insertarFila(
              rol,
              'matriculas',
              A.id,
              await fila('matriculas', { alumno_id: alumnoId, estado, reserva_vence_en: null }),
            ),
            estado,
          ).resolves.toBeUndefined();
        }
        await expect(
          insertarFila(
            rol,
            'matriculas',
            A.id,
            await fila('matriculas', {
              alumno_id: alumnoId,
              mes: 12,
              fecha_inicio: '2026-12-01',
              fecha_fin: '2026-12-31',
            }),
          ),
          'otro mes',
        ).resolves.toBeUndefined();
        await expect(
          insertarFila(rol, 'matriculas', A.id, await fila('matriculas')),
          'otro alumno',
        ).resolves.toBeUndefined();
      },
    );
  });

  describe('e) solicitudes', () => {
    it.each(ROLES)(
      'criterio 4 e: dos solicitudes PENDIENTE_PAGO del mismo alumno fallan con 23505; con VENCIDA o CANCELADA no (%s)',
      async (rol) => {
        const alumnoId = await crearAlumnoSolo(A.id);
        await insertarFila('propietario', 'solicitudes_inscripcion', A.id, {
          ...(await filaValida('solicitudes_inscripcion', { alumnoId })),
          estado: 'PENDIENTE_PAGO',
        });

        await expect(
          insertarFila(rol, 'solicitudes_inscripcion', A.id, {
            ...(await filaValida('solicitudes_inscripcion', { alumnoId })),
            estado: 'PENDIENTE_PAGO',
          }),
        ).rejects.toMatchObject({ code: '23505' });
        for (const estado of ['VENCIDA', 'CANCELADA']) {
          await expect(
            insertarFila(rol, 'solicitudes_inscripcion', A.id, {
              ...(await filaValida('solicitudes_inscripcion', { alumnoId })),
              estado,
            }),
            estado,
          ).resolves.toBeUndefined();
        }
      },
    );

    it.each(ROLES)(
      'criterio 4 e: dos solicitudes de A con el mismo código, el mismo hash de token o la misma clave de idempotencia fallan con 23505; en B se acepta (%s)',
      async (rol) => {
        const codigo = codigoAleatorio();
        const tokenHash = sha256(tokenAleatorio());
        const clave = randomUUID();
        const alumnoA = await crearAlumnoSolo(A.id);
        await insertarFila('propietario', 'solicitudes_inscripcion', A.id, {
          ...(await filaValida('solicitudes_inscripcion', { alumnoId: alumnoA })),
          codigo,
          token_hash: tokenHash,
          clave_idempotencia: clave,
        });

        for (const repetido of [{ codigo }, { token_hash: tokenHash }, { clave_idempotencia: clave }]) {
          await rechaza(rol, 'solicitudes_inscripcion', repetido, '23505', JSON.stringify(Object.keys(repetido)));
        }
        const alumnoB = await crearAlumnoSolo(B.id);
        await expect(
          insertarFila(rol, 'solicitudes_inscripcion', B.id, {
            ...(await filaValida('solicitudes_inscripcion', { alumnoId: alumnoB })),
            codigo,
            token_hash: tokenHash,
            clave_idempotencia: clave,
          }),
          'en B se acepta',
        ).resolves.toBeUndefined();
      },
    );
  });

  describe('f) formato del código y del token', () => {
    it.each(ROLES)(
      'criterio 4 f: un código fuera del formato AQ-XXXXXX (alfabeto de Crockford en mayúsculas) falla con 23514 (%s)',
      async (rol) => {
        const invalidos = [
          'AQ-ABCDE',
          'AQ-ABCDEFG',
          'aq-abcdef',
          'AQ-abcdef',
          'AQ-ABCDEI',
          'AQ-ABCDEL',
          'AQ-ABCDEO',
          'AQ-ABCDEU',
          'XX-ABCDEF',
          'AQ-ABCDE\n',
          'AQ-ABCDEF\n',
          'AQ ABCDEF',
          'AQ-ABC-EF',
          ' AQ-ABCDEF',
          '',
        ];
        for (const codigo of invalidos) {
          await rechaza(rol, 'solicitudes_inscripcion', { codigo }, '23514', `código ${JSON.stringify(codigo)}`);
        }
      },
    );

    it.each(ROLES)(
      'criterio 4 f: un código válido se acepta, también con todas las letras permitidas (%s)',
      async (rol) => {
        for (const codigo of ['AQ-7F3K9X', 'AQ-000000', 'AQ-ZZZZZZ', 'AQ-ABCDEF']) {
          await expect(
            insertarFila(rol, 'solicitudes_inscripcion', A.id, await fila('solicitudes_inscripcion', { codigo })),
            codigo,
          ).resolves.toBeUndefined();
        }
      },
    );

    it.each(ROLES)('criterio 4 f: un token_hash que no tiene 32 bytes falla con 23514 (%s)', async (rol) => {
      for (const largo of [0, 1, 31, 33, 64]) {
        await rechaza(
          rol,
          'solicitudes_inscripcion',
          { token_hash: Buffer.alloc(largo, 7) },
          '23514',
          `token_hash de ${largo} bytes`,
        );
      }
      await expect(
        insertarFila(
          rol,
          'solicitudes_inscripcion',
          A.id,
          await fila('solicitudes_inscripcion', { token_hash: Buffer.alloc(32, 7) }),
        ),
        '32 bytes',
      ).resolves.toBeUndefined();
    });
  });

  describe('g) consentimientos', () => {
    it.each(ROLES)(
      'criterio 4 g: un tipo fuera de DATOS_PERSONALES, DESLINDE e IMAGEN no se acepta (%s)',
      async (rol) => {
        for (const tipo of ['WHATSAPP', 'datos_personales', '', 'OTRO']) {
          await rechaza(rol, 'consentimientos', { tipo }, /^(22P02|23514)$/, `tipo ${JSON.stringify(tipo)}`);
        }
        for (const tipo of ['DATOS_PERSONALES', 'DESLINDE', 'IMAGEN']) {
          await expect(
            insertarFila(rol, 'consentimientos', A.id, await fila('consentimientos', { tipo })),
            tipo,
          ).resolves.toBeUndefined();
        }
      },
    );

    it.each(ROLES)('criterio 4 g: una versión vacía falla con 23514 (%s)', async (rol) => {
      await rechaza(rol, 'consentimientos', { version: '' }, '23514', 'versión vacía');
    });
  });
});
