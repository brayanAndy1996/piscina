import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  en,
  enLima,
  type EscenarioDeAsistencia,
  prepararEscenarioDeAsistencia,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoConMatriculas,
  DICIEMBRE,
  exigirRutasDe010b,
  listadoDe,
  NOVIEMBRE,
  OCTUBRE,
  rutaListado,
  sembrarAlumno,
} from '../../utilidades/escenario-cierre';
import {
  abrirCajaPara,
  crearAlumnoDeNoviembre,
  INSTANTES,
  registrarRenovacion,
} from '../../utilidades/escenario-renovacion';
import type { RespuestaApi } from '../../utilidades/inscripciones';

// Criterio 25 de la 010b (prueba obligatoria): el listado de HU-11. Estados con el reloj fijo (N = 5), `siguiente`, totales con los demás filtros, filtros por
// plan, clase y nivel, orden, el mes pedido, los 400 y la renovación en verificación de verdad (un Yape registrado por la API). Los permisos y el aislamiento
// entre academias del criterio 26 están en `listado-permisos` y `listado-aislamiento` (pruebas protegidas).

describe('el listado de mensualidades (criterio 25)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumnos: Record<'alDia' | 'conDiciembre' | 'vencido' | 'sinNada' | 'cliente' | 'inactivo', AlumnoConMatriculas>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    exigirRutasDe010b(ctx.app);
    alumnos = {
      alDia: await sembrarAlumno(esc, {
        estado: 'ALUMNO_ACTIVO',
        apellidos: 'Zapata',
        nombres: 'Ana',
        matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE', clasesUsadas: 3 }],
      }),
      conDiciembre: await sembrarAlumno(esc, {
        estado: 'ALUMNO_ACTIVO',
        apellidos: 'Apaza',
        nombres: 'Beto',
        matriculas: [
          { mes: NOVIEMBRE, estado: 'VIGENTE' },
          { mes: DICIEMBRE, estado: 'VIGENTE' },
        ],
      }),
      vencido: await sembrarAlumno(esc, {
        estado: 'ALUMNO_VENCIDO',
        apellidos: 'Mamani',
        nombres: 'Carla',
        matriculas: [{ mes: OCTUBRE, estado: 'FINALIZADA', clasesTotales: 12, clasesUsadas: 12 }],
      }),
      sinNada: await sembrarAlumno(esc, {
        estado: 'ALUMNO_VENCIDO',
        apellidos: 'Quispe',
        nombres: 'Dante',
        matriculas: [{ mes: { anio: 2026, mes: 9 }, estado: 'FINALIZADA' }],
      }),
      cliente: await sembrarAlumno(esc, {
        estado: 'CLIENTE',
        apellidos: 'Rojas',
        matriculas: [{ mes: NOVIEMBRE, estado: 'RESERVADA' }],
      }),
      inactivo: await sembrarAlumno(esc, {
        estado: 'INACTIVO',
        apellidos: 'Soto',
        matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
      }),
    };
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const pedir = (consulta: Record<string, string | readonly string[]> = {}): Promise<RespuestaApi> =>
    ctx.http.get(rutaListado(consulta), { cookie: en(ctx, esc, INSTANTES.viernes27).secretaria });
  const estados = (respuesta: RespuestaApi): Record<string, string> =>
    Object.fromEntries(listadoDe(respuesta).alumnos.map((fila) => [fila.alumnoId, fila.estado]));

  it('el 27/11 (por vencer) sin `mes` es noviembre: por vencer, al día con diciembre pagado y vencido con octubre; no salen el cliente, el inactivo ni el que no pagó nada reciente', async () => {
    const respuesta = await pedir();

    const listado = listadoDe(respuesta);
    expect([listado.mes, listado.hoy]).toEqual(['2026-11', '2026-11-27']);
    expect(estados(respuesta)).toEqual({
      [alumnos.alDia.alumnoId]: 'POR_VENCER',
      [alumnos.conDiciembre.alumnoId]: 'AL_DIA',
      [alumnos.vencido.alumnoId]: 'VENCIDO',
    });
    expect(listado.totales).toEqual({ AL_DIA: 1, POR_VENCER: 1, VENCIDO: 1, PENDIENTE_VERIFICACION: 0 });
    expect(listado.hayMas).toBe(false);
  });

  it('cada fila lleva la mensualidad (la de octubre para el vencido), el plan, las clases y `siguiente`; sin DNI', async () => {
    const listado = listadoDe(await pedir());

    const alDia = listado.alumnos.find((fila) => fila.alumnoId === alumnos.alDia.alumnoId);
    expect(alDia).toMatchObject({
      nombres: 'Ana',
      apellidos: 'Zapata',
      nivel: 'BASICO',
      siguiente: null,
      mensualidad: { mes: '2026-11', plan: { id: esc.e.plan.id }, clasesUsadas: 3, clasesTotales: 12 },
    });
    expect(alDia?.mensualidad?.clases).toHaveLength(3);
    const conDiciembre = listado.alumnos.find((fila) => fila.alumnoId === alumnos.conDiciembre.alumnoId);
    expect(conDiciembre?.siguiente).toEqual({ mes: '2026-12', estado: 'PAGADA' });
    const vencido = listado.alumnos.find((fila) => fila.alumnoId === alumnos.vencido.alumnoId);
    expect(vencido?.mensualidad).toMatchObject({ mes: '2026-10', clasesUsadas: 12, clasesTotales: 12 });
    for (const fila of listado.alumnos) expect(JSON.stringify(fila)).not.toContain(alumnos.alDia.dni);
  });

  it('a mitad de mes (15/11) todos los de noviembre están AL_DIA', async () => {
    const cookie = en(ctx, esc, enLima('2026-11-15', '10:00')).secretaria;

    const respuesta = await ctx.http.get(rutaListado(), { cookie });

    expect(Object.values(estados(respuesta))).toEqual(['AL_DIA', 'VENCIDO', 'AL_DIA']);
  });

  it('el orden es por apellidos, nombres e id', async () => {
    const listado = listadoDe(await pedir());

    expect(listado.alumnos.map((fila) => fila.apellidos)).toEqual(['Apaza', 'Mamani', 'Zapata']);
  });

  it('el filtro de estado deja las filas del estado, pero los totales siguen contando los demás estados', async () => {
    const listado = listadoDe(await pedir({ estado: 'VENCIDO' }));

    expect(listado.alumnos.map((fila) => fila.alumnoId)).toEqual([alumnos.vencido.alumnoId]);
    expect(listado.totales).toEqual({ AL_DIA: 1, POR_VENCER: 1, VENCIDO: 1, PENDIENTE_VERIFICACION: 0 });
  });

  it('planId y claseId filtran por la mensualidad de la fila y también cambian los totales; nivel, por el del alumno', async () => {
    const delPlan = listadoDe(await pedir({ planId: esc.e.plan.id }));
    const deLaClase = listadoDe(await pedir({ claseId: esc.e.lunes.id }));
    const deOtroNivel = listadoDe(await pedir({ nivel: 'AVANZADO' }));
    const deSuNivel = listadoDe(await pedir({ nivel: 'BASICO' }));

    expect(delPlan.alumnos).toHaveLength(3);
    expect(deLaClase.alumnos).toHaveLength(3);
    expect(deOtroNivel.alumnos).toEqual([]);
    expect(deOtroNivel.totales).toEqual({ AL_DIA: 0, POR_VENCER: 0, VENCIDO: 0, PENDIENTE_VERIFICACION: 0 });
    expect(deSuNivel.alumnos).toHaveLength(3);
  });

  it('octubre (un mes pasado): quien pagó octubre está AL_DIA, quien solo pagó septiembre está VENCIDO y no hay `siguiente`; diciembre es posterior al mes en curso: 400', async () => {
    const octubre = listadoDe(await pedir({ mes: '2026-10' }));
    const diciembre = await pedir({ mes: '2026-12' });

    expect(octubre.mes).toBe('2026-10');
    expect(octubre.alumnos.map((fila) => [fila.alumnoId, fila.estado])).toEqual([
      [alumnos.vencido.alumnoId, 'AL_DIA'],
      [alumnos.sinNada.alumnoId, 'VENCIDO'],
    ]);
    expect(octubre.alumnos.every((fila) => fila.siguiente === null)).toBe(true);
    expect(diciembre.status).toBe(400);
    expect(diciembre.body?.['codigo']).toBe('SOLICITUD_INVALIDA');
  });

  it.each([
    ['un mes con otra forma', { mes: '2026-13' }],
    ['un mes anterior a 2000-01', { mes: '1999-12' }],
    ['un mes repetido', { mes: ['2026-10', '2026-11'] }],
    ['un estado que no existe', { estado: 'ATRASADO' }],
    ['un plan que no es uuid', { planId: 'plan' }],
    ['una clase que no es uuid', { claseId: '123' }],
    ['un nivel que no existe', { nivel: 'EXPERTO' }],
    ['un parámetro que no se define', { dni: '12345678' }],
  ] as const)('%s responde 400 SOLICITUD_INVALIDA', async (_nombre, consulta) => {
    const respuesta = await pedir(consulta);

    expect([respuesta.status, respuesta.body?.['codigo']]).toEqual([400, 'SOLICITUD_INVALIDA']);
    expect(respuesta.texto).not.toContain('12345678');
  });

  it('la renovación de diciembre con Yape en verificación: quien la pidió está PENDIENTE_VERIFICACION y `siguiente` es EN_VERIFICACION; sin Yape, solo POR_VENCER', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    const cookies = en(ctx, esc, INSTANTES.viernes27);
    await abrirCajaPara(esc, INSTANTES.viernes27);
    const registro = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId);
    expect(registro.respuesta.status, registro.respuesta.texto.slice(0, 300)).toBe(201);

    const listado = listadoDe(await pedir());

    const fila = listado.alumnos.find((uno) => uno.alumnoId === alumno.alumnoId);
    expect(fila).toMatchObject({
      estado: 'PENDIENTE_VERIFICACION',
      siguiente: { mes: '2026-12', estado: 'EN_VERIFICACION' },
    });
    expect(listado.totales.PENDIENTE_VERIFICACION).toBe(1);
    // Diciembre en verificación: quien no tiene nada más reciente aparece con la de diciembre, y el del mes siguiente (diciembre) lo ve como pendiente.
    const diciembre = listadoDe(await pedir()).alumnos.filter((uno) => uno.estado === 'PENDIENTE_VERIFICACION');
    expect(diciembre.map((uno) => uno.alumnoId)).toEqual([alumno.alumnoId]);
  });
});
