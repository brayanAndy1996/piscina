// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import { filaAsistenciaValida, insertarAsistencia } from '../../utilidades/escenario-asistencia';
import {
  actualizarInasistencia,
  type Columnas,
  exigirTablaDeInasistencias,
  filaInasistenciaValida,
  insertarInasistencia,
  leerInasistencias,
  type PadresDeLaInasistencia,
} from '../../utilidades/escenario-faltas';
import { sembrarSolicitud } from '../../utilidades/inscripciones';

// Criterio 22 (crítico, D-08, 9.1, D-23), parte del comportamiento: un INSERT o un UPDATE directo en `inasistencias`, como app y como dueño de las tablas (los CHECK, el único, el trigger y las llaves valen también
// para el dueño), falla con:
//   - 23505 (`inasistencias_una_por_clase_key`) con dos faltas del mismo alumno, la misma clase y la misma fecha; otra clase, otro día u otro alumno no chocan;
//   - 23514 (`inasistencias_cubierta_coherente`) si `asistencia_id` y `cubierta_en` no son nulos a la vez o no nulos a la vez (en un INSERT);
//   - 23503 al cubrir con la asistencia de otro alumno o de otro día (la llave `(academia_id, asistencia_id, alumno_id, fecha)`), y con una matrícula de otro alumno, un alumno, una clase o una asistencia de otra academia;
//   - 23514 del trigger `inasistencias_se_cubre_una_vez` al volver a cubrir una falta (con la misma asistencia, otra o la misma hora), al descubrirla, o con un UPDATE que no cambia nada sobre una falta ya cubierta;
//   - 23514 del trigger (como dueño) al cambiar cualquier otra columna de una falta, cubierta o no; como app, la base lo corta antes con 42501 (sin privilegio de columna: ver `inasistencias-privilegios.test.ts`).
// Una falta sin cubrir sí se cubre una vez con una asistencia del mismo alumno y del mismo día, con los dos valores a la vez (como app y como dueño).
// Lecturas estrictas elegidas: una asistencia `PARTICULAR` del mismo alumno y día sirve de «otra asistencia válida» para probar que el trigger, y no la llave foránea, impide volver a cubrir; cubrir con un solo de los dos
// valores falla con 23514 (la tabla no dice cuál de las dos reglas, el `CHECK` o el trigger, lo corta primero); lo que pasa con un UPDATE que no cambia nada sobre una falta sin cubrir no se prueba (la spec no lo dice).
// Cada rol corre con su propia base de filas: los datos de una prueba no chocan con los de otra.

const ROLES = ['propietario', 'app'] as const;

const FECHA = '2026-11-16';
const LLEGADA = new Date('2026-11-16T23:05:00.000Z');

describe.each(ROLES)('criterio 22: CHECK, único, trigger y llaves de inasistencias, como %s', (rol) => {
  let e: EscenarioPagos;

  beforeAll(async () => {
    e = await crearEscenarioDePagos();
  });
  // Cada prueba falla con el mensaje claro de la funcionalidad que falta (un `beforeAll` que falla dejaría las pruebas omitidas).
  beforeEach(exigirTablaDeInasistencias);

  type Padres = PadresDeLaInasistencia & { academiaId: string; usuarioId: string };

  /** Un alumno nuevo con su matrícula (de A o de B), la clase de la matrícula y el usuario que registra. */
  async function padresNuevos(academia: 'A' | 'B' = 'A'): Promise<Padres> {
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

  const fila = (p: Padres, sobre: Columnas = {}) => filaInasistenciaValida(p, sobre);
  const insertar = (p: Padres, columnas: Columnas) => insertarInasistencia(rol, p.academiaId, columnas);

  /** Una asistencia del alumno en `fecha` (como dueño), para cubrir con ella; devuelve su id. */
  async function asistenciaDe(p: Padres, fecha = FECHA, sobre: Columnas = {}): Promise<string> {
    const llegada = new Date(`${fecha}T23:05:00.000Z`);
    const columnas = filaAsistenciaValida(p, { fecha, llegada_en: llegada, registrado_en: llegada, ...sobre });
    await insertarAsistencia('propietario', p.academiaId, columnas);
    return columnas['id'] as string;
  }

  const leida = async (p: Padres, id: string) => (await leerInasistencias(p.academiaId)).find((f) => f.id === id);

  /** La fila se rechaza con `code` (y, si se indica, por esa restricción) y la academia no gana ninguna falta. */
  async function rechazada(p: Padres, columnas: Columnas, code: string, restriccion?: string): Promise<void> {
    const antes = (await leerInasistencias(p.academiaId)).length;
    await expect(insertar(p, columnas)).rejects.toMatchObject(
      restriccion ? { code, constraint: restriccion } : { code },
    );
    expect(await leerInasistencias(p.academiaId)).toHaveLength(antes);
  }

  /** El `UPDATE` se rechaza con `code` y la falta queda como estaba. */
  async function actualizacionRechazada(p: Padres, id: string, cambios: Columnas, code: string): Promise<void> {
    const antes = await leida(p, id);
    await expect(actualizarInasistencia(rol, p.academiaId, id, cambios)).rejects.toMatchObject({ code });
    expect(await leida(p, id), 'la falta no cambia').toEqual(antes);
  }

  describe('el control: una falta válida se acepta', () => {
    it('criterio 22: una falta sin cubrir se acepta, con asistencia_id y cubierta_en nulos', async () => {
      const p = await padresNuevos();
      const datos = fila(p);

      await insertar(p, datos);

      expect(await leida(p, datos['id'] as string)).toMatchObject({
        alumno_id: p.alumnoId,
        matricula_id: p.matriculaId,
        clase_id: p.claseId,
        fecha: FECHA,
        asistencia_id: null,
        cubierta_en: null,
      });
    });
  });

  describe('una falta por alumno, clase y fecha (inasistencias_una_por_clase_key)', () => {
    it('criterio 22: dos faltas del mismo alumno, la misma clase y la misma fecha fallan con 23505 en inasistencias_una_por_clase_key', async () => {
      const p = await padresNuevos();
      await insertar(p, fila(p));

      await rechazada(p, fila(p), '23505', 'inasistencias_una_por_clase_key');
    });

    it('criterio 22: el mismo alumno en otra clase el mismo día, en la misma clase otro día, y otro alumno en la misma clase y fecha, se aceptan', async () => {
      const p = await padresNuevos();
      const otro = await padresNuevos();
      await insertar(p, fila(p));

      await insertar(p, fila(p, { clase_id: e.miercoles.id }));
      await insertar(p, fila(p, { fecha: '2026-11-23' }));
      await insertar(otro, fila(otro));

      expect((await leerInasistencias(p.academiaId)).filter((f) => f.alumno_id === p.alumnoId)).toHaveLength(3);
    });
  });

  describe('asistencia_id y cubierta_en van juntos (inasistencias_cubierta_coherente)', () => {
    it('criterio 22: una falta con asistencia_id y sin cubierta_en falla con 23514', async () => {
      const p = await padresNuevos();
      const asistenciaId = await asistenciaDe(p);

      await rechazada(
        p,
        fila(p, { asistencia_id: asistenciaId, cubierta_en: null }),
        '23514',
        'inasistencias_cubierta_coherente',
      );
    });

    it('criterio 22: una falta con cubierta_en y sin asistencia_id falla con 23514', async () => {
      const p = await padresNuevos();

      await rechazada(
        p,
        fila(p, { asistencia_id: null, cubierta_en: new Date('2026-11-17T01:00:00.000Z') }),
        '23514',
        'inasistencias_cubierta_coherente',
      );
    });
  });

  describe('cubrir una falta con una asistencia', () => {
    it('criterio 22: una falta sin cubrir se cubre una vez con una asistencia del mismo alumno y del mismo día, con asistencia_id y cubierta_en a la vez', async () => {
      const p = await padresNuevos();
      const datos = fila(p);
      await insertar(p, datos);
      const asistenciaId = await asistenciaDe(p);
      const cubiertaEn = new Date('2026-11-17T01:00:00.000Z');

      const afectadas = await actualizarInasistencia(rol, p.academiaId, datos['id'] as string, {
        asistencia_id: asistenciaId,
        cubierta_en: cubiertaEn,
      });

      expect(afectadas).toBe(1);
      const cubierta = await leida(p, datos['id'] as string);
      expect(cubierta?.asistencia_id).toBe(asistenciaId);
      expect(cubierta?.cubierta_en?.toISOString()).toBe(cubiertaEn.toISOString());
    });

    it('criterio 22: cubrir con la asistencia de otro alumno falla con 23503 y la falta sigue sin cubrir', async () => {
      const p = await padresNuevos();
      const otro = await padresNuevos();
      const datos = fila(p);
      await insertar(p, datos);
      const deOtro = await asistenciaDe(otro);

      await actualizacionRechazada(
        p,
        datos['id'] as string,
        { asistencia_id: deOtro, cubierta_en: new Date('2026-11-17T01:00:00.000Z') },
        '23503',
      );
    });

    it('criterio 22: cubrir con la asistencia del mismo alumno de otro día falla con 23503 y la falta sigue sin cubrir', async () => {
      const p = await padresNuevos();
      const datos = fila(p);
      await insertar(p, datos);
      const deOtroDia = await asistenciaDe(p, '2026-11-23');

      await actualizacionRechazada(
        p,
        datos['id'] as string,
        { asistencia_id: deOtroDia, cubierta_en: new Date('2026-11-17T01:00:00.000Z') },
        '23503',
      );
    });

    it('criterio 22: cubrir con una asistencia de otra academia falla con 23503', async () => {
      const deA = await padresNuevos('A');
      const deB = await padresNuevos('B');
      const datos = fila(deA);
      await insertar(deA, datos);
      const asistenciaDeB = await asistenciaDe(deB);

      await actualizacionRechazada(
        deA,
        datos['id'] as string,
        { asistencia_id: asistenciaDeB, cubierta_en: new Date('2026-11-17T01:00:00.000Z') },
        '23503',
      );
    });

    it('criterio 22: poner solo asistencia_id, o solo cubierta_en, en una falta sin cubrir falla con 23514', async () => {
      const p = await padresNuevos();
      const datos = fila(p);
      await insertar(p, datos);
      const asistenciaId = await asistenciaDe(p);

      await actualizacionRechazada(p, datos['id'] as string, { asistencia_id: asistenciaId }, '23514');
      await actualizacionRechazada(
        p,
        datos['id'] as string,
        { cubierta_en: new Date('2026-11-17T01:00:00.000Z') },
        '23514',
      );
    });
  });

  describe('una falta cubierta no vuelve a cambiar (inasistencias_se_cubre_una_vez)', () => {
    /** Una falta ya cubierta con su asistencia; además una asistencia `PARTICULAR` del mismo alumno y día, válida para la llave. */
    async function faltaCubierta() {
      const p = await padresNuevos();
      const datos = fila(p);
      await insertar(p, datos);
      const id = datos['id'] as string;
      const asistenciaId = await asistenciaDe(p);
      const otraAsistenciaId = await asistenciaDe(p, FECHA, { tipo: 'PARTICULAR', llegada_en: LLEGADA });
      const cubiertaEn = new Date('2026-11-17T01:00:00.000Z');
      await actualizarInasistencia(rol, p.academiaId, id, { asistencia_id: asistenciaId, cubierta_en: cubiertaEn });
      return { p, id, asistenciaId, otraAsistenciaId, cubiertaEn };
    }

    it('criterio 22: volver a cubrir con otra asistencia (válida para la llave) falla con 23514', async () => {
      const { p, id, otraAsistenciaId } = await faltaCubierta();

      await actualizacionRechazada(
        p,
        id,
        { asistencia_id: otraAsistenciaId, cubierta_en: new Date('2026-11-17T02:00:00.000Z') },
        '23514',
      );
    });

    it('criterio 22: cambiar solo la hora de la cobertura falla con 23514', async () => {
      const { p, id } = await faltaCubierta();

      await actualizacionRechazada(p, id, { cubierta_en: new Date('2026-11-17T02:00:00.000Z') }, '23514');
    });

    it('criterio 22: descubrirla (asistencia_id y cubierta_en en nulo) falla con 23514', async () => {
      const { p, id } = await faltaCubierta();

      await actualizacionRechazada(p, id, { asistencia_id: null, cubierta_en: null }, '23514');
    });

    it('criterio 22: un UPDATE que no cambia nada (los mismos valores) sobre una falta ya cubierta también falla con 23514', async () => {
      const { p, id, asistenciaId, cubiertaEn } = await faltaCubierta();

      await actualizacionRechazada(p, id, { asistencia_id: asistenciaId, cubierta_en: cubiertaEn }, '23514');
      await actualizacionRechazada(p, id, { cubierta_en: cubiertaEn }, '23514');
    });
  });

  describe('las demás columnas no cambian', () => {
    // Como dueño, el trigger corta con 23514; como app, la falta de privilegio de columna corta antes con 42501.
    const codigoEsperado = rol === 'app' ? '42501' : '23514';

    it(`criterio 22: cambiar la fecha, la hora de registro, la clase, la matrícula o el alumno de una falta sin cubrir falla con ${codigoEsperado}`, async () => {
      const p = await padresNuevos();
      const otro = await padresNuevos();
      const datos = fila(p);
      await insertar(p, datos);
      const id = datos['id'] as string;

      await actualizacionRechazada(p, id, { fecha: '2026-11-23' }, codigoEsperado);
      await actualizacionRechazada(p, id, { registrada_en: new Date('2026-11-17T03:00:00.000Z') }, codigoEsperado);
      await actualizacionRechazada(p, id, { clase_id: e.miercoles.id }, codigoEsperado);
      await actualizacionRechazada(p, id, { matricula_id: otro.matriculaId, alumno_id: otro.alumnoId }, codigoEsperado);
    });

    it(`criterio 22: cambiar la fecha o la clase de una falta ya cubierta falla con ${codigoEsperado}`, async () => {
      const p = await padresNuevos();
      const datos = fila(p);
      await insertar(p, datos);
      const id = datos['id'] as string;
      const asistenciaId = await asistenciaDe(p);
      await actualizarInasistencia(rol, p.academiaId, id, {
        asistencia_id: asistenciaId,
        cubierta_en: new Date('2026-11-17T01:00:00.000Z'),
      });

      await actualizacionRechazada(p, id, { clase_id: e.miercoles.id }, codigoEsperado);
      await actualizacionRechazada(p, id, { registrada_en: new Date('2026-11-17T03:00:00.000Z') }, codigoEsperado);
    });
  });

  describe('llaves foráneas compuestas (23503)', () => {
    it('criterio 22: una matrícula de otro alumno de la misma academia falla con 23503 (la matrícula va junto con el alumno)', async () => {
      const p = await padresNuevos();
      const otro = await padresNuevos();

      await rechazada(p, fila(p, { matricula_id: otro.matriculaId }), '23503');
    });

    it('criterio 22: un alumno de otra academia falla con 23503', async () => {
      const deA = await padresNuevos('A');
      const deB = await padresNuevos('B');

      await rechazada(deA, fila(deA, { alumno_id: deB.alumnoId }), '23503');
    });

    it('criterio 22: la matrícula de B (con su alumno de B) en una falta de A falla con 23503', async () => {
      const deA = await padresNuevos('A');
      const deB = await padresNuevos('B');

      await rechazada(deA, fila(deA, { alumno_id: deB.alumnoId, matricula_id: deB.matriculaId }), '23503');
    });

    it('criterio 22: una clase de otra academia o que no existe falla con 23503', async () => {
      const deA = await padresNuevos('A');
      const deB = await padresNuevos('B');

      await rechazada(deA, fila(deA, { clase_id: deB.claseId }), '23503');
      await rechazada(deA, fila(deA, { clase_id: randomUUID() }), '23503');
    });

    it('criterio 22: con el alumno, la matrícula y la clase de la propia academia la misma falta se acepta (control)', async () => {
      const p = await padresNuevos();

      await insertar(p, fila(p));

      expect(await leerInasistencias(p.academiaId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ matricula_id: p.matriculaId, clase_id: p.claseId })]),
      );
    });
  });
});
