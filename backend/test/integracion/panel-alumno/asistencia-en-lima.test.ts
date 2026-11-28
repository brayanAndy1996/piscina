import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  crearAlumnoDeAsistencia,
  en,
  enLima,
  type EscenarioDeAsistencia,
  marcarPorQr,
  PRIMERO_DE_DICIEMBRE,
  ULTIMO_LUNES_DE_NOVIEMBRE,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { consultaDe, ejecutarFaltas } from '../../utilidades/escenario-faltas';
import { panelDe, prepararEscenarioDelPanel } from '../../utilidades/escenario-panel';
import { asistenciaEn, resumenEn } from '../../utilidades/panel-alumno-lima';

// Criterio 13 de la 011 (prueba obligatoria, RNF-12, D-11, D-16): con `RELOJ` fijo y el proceso en `TZ=Asia/Tokyo` (y en UTC), la asistencia de la clase de 19:00 a 20:00 del 30/11/2026
// marcada a las 19:05 sale en `2026-11` (puntual) y la consulta sin `mes` a las 19:30 de ese día es la de `2026-11`; la falta de esa clase que registra la tarea (009b) sale también en
// `2026-11`; el 1/12 a las 00:00:00.000 la consulta sin `mes` es la de `2026-12`. La asistencia se marca por la API y la falta la registra la tarea de verdad.

const ZONA_ORIGINAL = process.env['TZ'];

describe.each(['UTC', 'Asia/Tokyo'])(
  'la asistencia del panel en los bordes de Lima, con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppCarnet;
    let esc: EscenarioDeAsistencia;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppCarnet();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      esc = await prepararEscenarioDelPanel(ctx);
    });
    afterAll(async () => {
      await ctx?.cerrarTodo();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    it('la clase de 19:00 a 20:00 del 30/11 marcada a las 19:05 sale en 2026-11 como puntual, y la consulta sin mes a las 19:30 es la de 2026-11', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id], clasesUsadas: 4 });
      const marcado = enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '19:05');
      expect(marcado.toISOString().slice(0, 10), 'en UTC ya es el 1/12').toBe('2026-12-01');
      const respuesta = await marcarPorQr(ctx, en(ctx, esc, marcado).secretaria, alumno.contenido);
      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);

      const consulta = consultaDe(await asistenciaEn(ctx, alumno, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '19:30')));
      const explicita = consultaDe(
        await asistenciaEn(ctx, alumno, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '19:30'), '2026-11'),
      );

      expect(consulta.mes).toBe('2026-11');
      expect(consulta.matricula).toEqual({ clasesTotales: 12, clasesUsadas: 5, clasesRestantes: 7 });
      expect(consulta.registros).toEqual([
        {
          tipo: 'ASISTENCIA',
          fecha: '2026-11-30',
          clase: { horaInicio: '19:00', horaFin: '20:00' },
          horaLlegada: '19:05',
          estadoLlegada: 'PUNTUAL',
          metodo: 'QR',
          registroPosterior: false,
          faltaCubierta: false,
        },
      ]);
      expect(explicita).toEqual(consulta);
      const resumen = panelDe(await resumenEn(ctx, alumno, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '19:30')));
      expect(resumen.mensualidad.actual).toMatchObject({ clasesUsadas: 5, clasesRestantes: 7 });
    });

    it('la falta de esa clase que registra la tarea (009b) sale también en 2026-11, con su fecha de Lima, y no en 2026-12', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id] });
      await ejecutarFaltas(ctx, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '20:00:00.000'));

      const noviembre = consultaDe(await asistenciaEn(ctx, alumno, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '20:30')));
      const diciembre = consultaDe(await asistenciaEn(ctx, alumno, enLima(PRIMERO_DE_DICIEMBRE, '08:00'), '2026-12'));

      expect(noviembre.mes).toBe('2026-11');
      expect(noviembre.registros).toEqual([
        { tipo: 'FALTA', fecha: '2026-11-30', clase: { horaInicio: '19:00', horaFin: '20:00' } },
      ]);
      expect(diciembre).toEqual({ mes: '2026-12', matricula: null, registros: [] });
    });

    it('el 30/11 a las 23:59:59.999 la consulta sin mes es la de 2026-11 y el 1/12 a las 00:00:00.000 es la de 2026-12', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id] });
      await ejecutarFaltas(ctx, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '20:00:00.000'));

      const ultimo = consultaDe(await asistenciaEn(ctx, alumno, enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '23:59:59.999')));
      const primero = consultaDe(await asistenciaEn(ctx, alumno, enLima(PRIMERO_DE_DICIEMBRE, '00:00:00.000')));

      expect(ultimo.mes).toBe('2026-11');
      expect(ultimo.registros).toHaveLength(1);
      expect(primero).toEqual({ mes: '2026-12', matricula: null, registros: [] });
    });
  },
);
