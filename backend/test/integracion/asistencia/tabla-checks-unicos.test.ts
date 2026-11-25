// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import {
  type Columnas,
  exigirTablaDeAsistencias,
  filaAsistenciaValida,
  insertarAsistencia,
  leerAsistencias,
  type PadresDeLaAsistencia,
} from '../../utilidades/escenario-asistencia';
import { sembrarSolicitud } from '../../utilidades/inscripciones';
import { ejecutarTransaccion } from '../../utilidades/pagos';

// Criterio 1 (crítico, RN-16, D-07, D-23), parte del comportamiento: un INSERT directo en `asistencias`, como app y como dueño de las tablas (los CHECK, los únicos y las llaves valen
// también para el dueño), falla con:
//   - 23505 (`asistencias_un_dia_key`) con dos filas `NORMAL` (o de cualquier tipo distinto de `PARTICULAR`) del mismo alumno y la misma fecha (RN-16); las `PARTICULAR` no cuentan para el índice;
//   - 23505 (`asistencias_academia_id_clave_idempotencia_key`) con la misma clave en la misma academia; la misma clave en otra academia no choca;
//   - 23514 (`asistencias_fecha_de_lima`) si `fecha` no es la fecha de Lima de `llegada_en` (`llegada_en` 2026-12-01 00:30 UTC con `fecha` 2026-12-01), también con la sesión de la base en otra zona;
//   - 23514 (`asistencias_registro_despues`) si `registrado_en` es anterior a `llegada_en`;
//   - 23514 (`asistencias_posterior_coherente`) con un posterior sin motivo o con un método que no es `MANUAL`, con un motivo de menos de 3 o de más de 200 caracteres, o con un motivo sin posterior;
//   - 23503 con una matrícula de otro alumno, y con un alumno, una matrícula, una clase o un usuario de otra academia (o que no existe).
// Cada rol corre con su propia base de filas: los datos de una prueba no chocan con los de otra.

const ROLES = ['propietario', 'app'] as const;

describe.each(ROLES)('criterio 1: CHECK, únicos y llaves de asistencias, como %s', (rol) => {
  let e: EscenarioPagos;

  beforeAll(async () => {
    e = await crearEscenarioDePagos();
  });
  // Cada prueba falla con el mensaje claro de la funcionalidad que falta (un `beforeAll` que falla dejaría las pruebas omitidas).
  beforeEach(exigirTablaDeAsistencias);

  /** Un alumno nuevo con su matrícula (de A o de B), la clase de la matrícula y el usuario que registra. */
  async function padresNuevos(academia: 'A' | 'B' = 'A'): Promise<PadresDeLaAsistencia & { academiaId: string }> {
    const esA = academia === 'A';
    const cliente = await sembrarSolicitud(esA ? e.A.id : e.B.id, {
      planId: esA ? e.plan.id : e.planB.id,
      claseIds: [esA ? e.lunes.id : e.lunesB.id],
    });
    return {
      academiaId: esA ? e.A.id : e.B.id,
      alumnoId: cliente.alumnoId,
      matriculaId: cliente.matriculaId,
      claseId: esA ? e.lunes.id : e.lunesB.id,
      usuarioId: esA ? e.secretariaA.id : e.secretariaB.id,
    };
  }

  type Padres = Awaited<ReturnType<typeof padresNuevos>>;

  const fila = (p: Padres, sobre: Columnas = {}) => filaAsistenciaValida(p, sobre);
  const insertar = (p: Padres, columnas: Columnas) => insertarAsistencia(rol, p.academiaId, columnas);

  /** La fila se rechaza con `code` (y, si se indica, por esa restricción) y la academia no gana ninguna fila. */
  async function rechazada(p: Padres, columnas: Columnas, code: string, restriccion?: string): Promise<void> {
    const antes = (await leerAsistencias(p.academiaId)).length;
    await expect(insertar(p, columnas)).rejects.toMatchObject(
      restriccion ? { code, constraint: restriccion } : { code },
    );
    expect(await leerAsistencias(p.academiaId)).toHaveLength(antes);
  }

  describe('el control: una fila válida se acepta', () => {
    it('criterio 1: una asistencia con los valores por defecto de tipo (NORMAL) y registro_posterior (false) se acepta', async () => {
      const p = await padresNuevos();

      await insertar(p, fila(p));

      expect((await leerAsistencias(p.academiaId)).find((a) => a.alumno_id === p.alumnoId)).toMatchObject({
        tipo: 'NORMAL',
        registro_posterior: false,
        motivo: null,
        metodo: 'QR',
        estado_llegada: 'PUNTUAL',
        fecha: '2026-11-16',
      });
    });
  });

  describe('una por día (RN-16)', () => {
    it('criterio 1: dos filas NORMAL del mismo alumno y la misma fecha fallan con 23505 en asistencias_un_dia_key', async () => {
      const p = await padresNuevos();
      await insertar(p, fila(p));

      await rechazada(p, fila(p), '23505', 'asistencias_un_dia_key');
    });

    it.each(['RECUPERACION', 'FUERA_HORARIO', 'NORMAL'])(
      'criterio 1: una fila NORMAL y otra %s del mismo alumno y fecha fallan con 23505 en asistencias_un_dia_key (solo PARTICULAR queda fuera)',
      async (tipo) => {
        const p = await padresNuevos();
        await insertar(p, fila(p));

        await rechazada(p, fila(p, { tipo }), '23505', 'asistencias_un_dia_key');
      },
    );

    it('criterio 1: dos PARTICULAR del mismo alumno y fecha se aceptan, y una PARTICULAR con una NORMAL del mismo día también, en cualquier orden', async () => {
      const p = await padresNuevos();
      const q = await padresNuevos();

      await insertar(p, fila(p, { tipo: 'PARTICULAR' }));
      await insertar(p, fila(p, { tipo: 'PARTICULAR' }));
      await insertar(p, fila(p, { tipo: 'NORMAL' }));
      await insertar(q, fila(q, { tipo: 'NORMAL' }));
      await insertar(q, fila(q, { tipo: 'PARTICULAR' }));

      expect((await leerAsistencias(p.academiaId)).filter((a) => a.alumno_id === p.alumnoId)).toHaveLength(3);
      expect((await leerAsistencias(q.academiaId)).filter((a) => a.alumno_id === q.alumnoId)).toHaveLength(2);
    });

    it('criterio 1: el mismo alumno otro día, y otro alumno el mismo día, se aceptan', async () => {
      const p = await padresNuevos();
      const otro = await padresNuevos();
      await insertar(p, fila(p));

      await insertar(
        p,
        fila(p, {
          fecha: '2026-11-23',
          llegada_en: new Date('2026-11-23T23:05:00.000Z'),
          registrado_en: new Date('2026-11-23T23:05:00.000Z'),
        }),
      );
      await insertar(otro, fila(otro));

      expect((await leerAsistencias(p.academiaId)).filter((a) => a.alumno_id === p.alumnoId)).toHaveLength(2);
    });

    it('criterio 1: la fecha de Lima, no la de UTC, decide el día: 19:30 del lunes (00:30 UTC del martes) y 08:30 del martes son dos días distintos', async () => {
      const p = await padresNuevos();

      await insertar(
        p,
        fila(p, {
          fecha: '2026-11-16',
          llegada_en: new Date('2026-11-17T00:30:00.000Z'),
          registrado_en: new Date('2026-11-17T00:30:00.000Z'),
        }),
      );
      await insertar(
        p,
        fila(p, {
          fecha: '2026-11-17',
          llegada_en: new Date('2026-11-17T13:30:00.000Z'),
          registrado_en: new Date('2026-11-17T13:30:00.000Z'),
        }),
      );

      expect((await leerAsistencias(p.academiaId)).filter((a) => a.alumno_id === p.alumnoId)).toHaveLength(2);
    });
  });

  describe('la clave de idempotencia', () => {
    it('criterio 1: la misma clave en la misma academia falla con 23505 en asistencias_academia_id_clave_idempotencia_key, aunque sea de otro alumno y otro día', async () => {
      const p = await padresNuevos();
      const otro = await padresNuevos();
      const clave = randomUUID();
      await insertar(p, fila(p, { clave_idempotencia: clave }));

      await rechazada(
        otro,
        fila(otro, {
          clave_idempotencia: clave,
          fecha: '2026-11-23',
          llegada_en: new Date('2026-11-23T23:05:00.000Z'),
          registrado_en: new Date('2026-11-23T23:05:00.000Z'),
        }),
        '23505',
        'asistencias_academia_id_clave_idempotencia_key',
      );
    });

    it('criterio 1: la misma clave en otra academia se acepta (el único es por academia)', async () => {
      const deA = await padresNuevos('A');
      const deB = await padresNuevos('B');
      const clave = randomUUID();

      await insertar(deA, fila(deA, { clave_idempotencia: clave }));
      await insertar(deB, fila(deB, { clave_idempotencia: clave }));

      expect((await leerAsistencias(deB.academiaId)).some((a) => a.clave_idempotencia === clave)).toBe(true);
    });
  });

  describe('la fecha es la de Lima (asistencias_fecha_de_lima)', () => {
    it('criterio 1: llegada_en 2026-12-01 00:30 UTC (19:30 del 30/11 en Lima) con fecha 2026-12-01 falla con 23514', async () => {
      const p = await padresNuevos();
      const llegada = new Date('2026-12-01T00:30:00.000Z');

      await rechazada(
        p,
        fila(p, { fecha: '2026-12-01', llegada_en: llegada, registrado_en: llegada }),
        '23514',
        'asistencias_fecha_de_lima',
      );
    });

    it('criterio 1: la misma llegada con fecha 2026-11-30 se acepta (control)', async () => {
      const p = await padresNuevos();
      const llegada = new Date('2026-12-01T00:30:00.000Z');

      await insertar(p, fila(p, { fecha: '2026-11-30', llegada_en: llegada, registrado_en: llegada }));

      expect((await leerAsistencias(p.academiaId)).find((a) => a.alumno_id === p.alumnoId)?.fecha).toBe('2026-11-30');
    });

    it.each([
      ['2026-12-01T04:59:59.999Z', '2026-11-30', true],
      ['2026-12-01T04:59:59.999Z', '2026-12-01', false],
      ['2026-12-01T05:00:00.000Z', '2026-11-30', false],
      ['2026-12-01T05:00:00.000Z', '2026-12-01', true],
    ])(
      'criterio 1: el borde de la medianoche de Lima: llegada %s con fecha %s → aceptada = %s',
      async (instante, fecha, ok) => {
        const p = await padresNuevos();
        const llegada = new Date(instante);
        const columnas = fila(p, { fecha, llegada_en: llegada, registrado_en: llegada });

        if (ok) await insertar(p, columnas);
        else await rechazada(p, columnas, '23514', 'asistencias_fecha_de_lima');
      },
    );

    it('criterio 1: la regla no depende de la zona de la sesión de la base: con la sesión en Asia/Tokyo se juzga igual', async () => {
      const p = await padresNuevos();
      const llegada = new Date('2026-12-01T00:30:00.000Z');
      const sesionEnTokyo = async (fecha: string) => {
        const columnas = fila(p, { fecha, llegada_en: llegada, registrado_en: llegada });
        const nombres = Object.keys({ academia_id: p.academiaId, ...columnas });
        const tipos: Record<string, string> = {
          id: 'uuid',
          academia_id: 'uuid',
          alumno_id: 'uuid',
          matricula_id: 'uuid',
          clase_id: 'uuid',
          fecha: 'date',
          llegada_en: 'timestamptz',
          registrado_en: 'timestamptz',
          metodo: 'metodo_asistencia',
          tipo: 'tipo_asistencia',
          estado_llegada: 'estado_llegada',
          registrado_por: 'uuid',
          registro_posterior: 'boolean',
          motivo: 'text',
          clave_idempotencia: 'uuid',
        };
        await ejecutarTransaccion(rol, { academiaId: p.academiaId }, [
          { sql: "SET LOCAL TIME ZONE 'Asia/Tokyo'" },
          {
            sql: `INSERT INTO asistencias (${nombres.join(', ')}) VALUES (${nombres.map((n, i) => `$${i + 1}::${tipos[n] as string}`).join(', ')})`,
            valores: Object.values({ academia_id: p.academiaId, ...columnas }),
          },
        ]);
      };

      await expect(sesionEnTokyo('2026-12-01')).rejects.toMatchObject({
        code: '23514',
        constraint: 'asistencias_fecha_de_lima',
      });
      await sesionEnTokyo('2026-11-30');

      expect((await leerAsistencias(p.academiaId)).find((a) => a.alumno_id === p.alumnoId)?.fecha).toBe('2026-11-30');
    });
  });

  describe('el registro no es anterior a la llegada (asistencias_registro_despues)', () => {
    it('criterio 1: registrado_en un milisegundo antes de llegada_en falla con 23514', async () => {
      const p = await padresNuevos();

      await rechazada(
        p,
        fila(p, { registrado_en: new Date('2026-11-16T23:04:59.999Z') }),
        '23514',
        'asistencias_registro_despues',
      );
    });

    it.each([
      ['igual', '2026-11-16T23:05:00.000Z'],
      ['posterior', '2026-11-17T09:00:00.000Z'],
    ])('criterio 1: registrado_en %s a llegada_en se acepta (control)', async (_nombre, registrado) => {
      const p = await padresNuevos();

      await insertar(p, fila(p, { registrado_en: new Date(registrado) }));

      expect(await leerAsistencias(p.academiaId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ alumno_id: p.alumnoId })]),
      );
    });
  });

  describe('el registro posterior es coherente (asistencias_posterior_coherente)', () => {
    const MOTIVO = 'La secretaria no estaba en la entrada';

    it.each([
      ['sin motivo', { registro_posterior: true, metodo: 'MANUAL', motivo: null }],
      ['con un método QR', { registro_posterior: true, metodo: 'QR', motivo: MOTIVO }],
      ['con un motivo de 2 caracteres', { registro_posterior: true, metodo: 'MANUAL', motivo: 'ab' }],
      ['con un motivo de 201 caracteres', { registro_posterior: true, metodo: 'MANUAL', motivo: 'm'.repeat(201) }],
      ['con un motivo vacío', { registro_posterior: true, metodo: 'MANUAL', motivo: '' }],
      ['sin ser posterior pero con motivo', { registro_posterior: false, metodo: 'MANUAL', motivo: MOTIVO }],
      [
        'sin ser posterior, por defecto, pero con motivo',
        { registro_posterior: undefined, metodo: 'MANUAL', motivo: MOTIVO },
      ],
    ])('criterio 1: una asistencia %s falla con 23514', async (_nombre, sobre) => {
      const p = await padresNuevos();

      await rechazada(p, fila(p, sobre), '23514', 'asistencias_posterior_coherente');
    });

    it.each([
      ['de 3 caracteres', 'abc'],
      ['de 200 caracteres', 'm'.repeat(200)],
      ['normal', MOTIVO],
    ])('criterio 1: un registro posterior MANUAL con un motivo %s se acepta (control)', async (_nombre, motivo) => {
      const p = await padresNuevos();

      await insertar(
        p,
        fila(p, {
          registro_posterior: true,
          metodo: 'MANUAL',
          motivo,
          registrado_en: new Date('2026-11-17T14:00:00.000Z'),
        }),
      );

      expect((await leerAsistencias(p.academiaId)).find((a) => a.alumno_id === p.alumnoId)).toMatchObject({
        registro_posterior: true,
        metodo: 'MANUAL',
        motivo,
      });
    });
  });

  describe('llaves foráneas compuestas (23503)', () => {
    it('criterio 1: una matrícula de otro alumno de la misma academia falla con 23503 (la matrícula va junto con el alumno)', async () => {
      const p = await padresNuevos();
      const otro = await padresNuevos();

      await rechazada(p, fila(p, { matricula_id: otro.matriculaId }), '23503');
    });

    it('criterio 1: un alumno de otra academia falla con 23503', async () => {
      const deA = await padresNuevos('A');
      const deB = await padresNuevos('B');

      await rechazada(deA, fila(deA, { alumno_id: deB.alumnoId }), '23503');
    });

    it('criterio 1: la matrícula de B (con su alumno de B) en una asistencia de A falla con 23503', async () => {
      const deA = await padresNuevos('A');
      const deB = await padresNuevos('B');

      await rechazada(deA, fila(deA, { alumno_id: deB.alumnoId, matricula_id: deB.matriculaId }), '23503');
    });

    it('criterio 1: una clase de otra academia o que no existe falla con 23503', async () => {
      const deA = await padresNuevos('A');
      const deB = await padresNuevos('B');

      await rechazada(deA, fila(deA, { clase_id: deB.claseId }), '23503');
      await rechazada(deA, fila(deA, { clase_id: randomUUID() }), '23503');
    });

    it('criterio 1: un registrado_por de otra academia o que no existe falla con 23503', async () => {
      const deA = await padresNuevos('A');
      const deB = await padresNuevos('B');

      await rechazada(deA, fila(deA, { registrado_por: deB.usuarioId }), '23503');
      await rechazada(deA, fila(deA, { registrado_por: randomUUID() }), '23503');
    });

    it('criterio 1: con el alumno, la matrícula, la clase y el usuario de la propia academia la misma fila se acepta (control)', async () => {
      const p = await padresNuevos();

      await insertar(p, fila(p));

      expect(await leerAsistencias(p.academiaId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ matricula_id: p.matriculaId, clase_id: p.claseId })]),
      );
    });
  });
});
