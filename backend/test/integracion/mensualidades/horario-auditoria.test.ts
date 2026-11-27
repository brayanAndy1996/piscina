// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { en } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  ACCION_HORARIO,
  cambiarHorario,
  cambioDe,
  crearAlumnoDeHorario,
  type EscenarioDeHorario,
  ordenados,
  prepararEscenarioDeHorario,
} from '../../utilidades/escenario-horario';
import { cambiarMatricula } from '../../utilidades/escenario-asistencia';
import { DICIEMBRE, INSTANTES, NOVIEMBRE } from '../../utilidades/escenario-renovacion';
import { IP_RE, leerAlumnos, llenarClase } from '../../utilidades/inscripciones';

// Criterio 40 (crítico, RN-22, HU-03): cada cambio escribe una sola entrada `MATRICULA_HORARIO_CAMBIADO` (entidad `matricula`, `entidadId`, actor `USUARIO`, `motivo`, IP, `datosAntes: { claseIds }` y `datosDespues: { claseIds }`), sin DNI ni nombres. Un rechazo o un cambio sin diferencias no audita.
// Lecturas estrictas elegidas: (1) `datosAntes` y `datosDespues` tienen exactamente la clave `claseIds`, con los ids de todas las clases de la matrícula antes y después del cambio (no solo las que cambian), que se comparan como conjuntos; (2) el `motivo` de la entrada es el del cuerpo, tal cual; (3) el cambio no escribe ninguna otra entrada de auditoría (ni de pagos, ni de caja, ni de renovación);
// (4) «sin DNI ni nombres» se comprueba con el texto de toda la fila, con los datos médicos de la ficha del alumno; (5) la entrada es de la matrícula pedida (también la de diciembre); (6) un rechazo es cualquier 400, 401, 403, 404 o 409 (incluido `SIN_CUPO`).

describe('la auditoría del cambio de horario (criterio 40)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeHorario;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeHorario(ctx);
    cookies = en(ctx, esc, INSTANTES.jueves26);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const delLunes17 = () => [esc.e.lunes17.id, esc.e.miercoles.id, esc.e.viernes.id];
  const clasesDeNoviembre = () => [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id];

  it.each([
    ['la secretaria', 'secretaria', 'secretariaA'],
    ['el administrador', 'admin', 'adminA'],
  ] as const)(
    'criterio 40: un cambio de %s escribe una sola entrada MATRICULA_HORARIO_CAMBIADO con la matrícula, el actor, el motivo, la IP y las clases de antes y de después, y ninguna otra',
    async (_nombre, rol, usuario) => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const antes = await leerAuditoriaDeAcademia(A());

      const respuesta = await cambiarHorario(ctx, cookies[rol], alumno.matriculaId, delLunes17(), {
        motivo: 'El alumno ya no puede los lunes a las 18:00',
      });

      cambioDe(respuesta);
      const todas = await leerAuditoriaDeAcademia(A());
      expect(todas, 'una sola entrada nueva, de ninguna otra acción').toHaveLength(antes.length + 1);
      const filas = await leerAuditoriaDeAcademia(A(), ACCION_HORARIO);
      expect(filas).toHaveLength(1);
      const [fila] = filas;
      expect(fila).toMatchObject({
        accion: ACCION_HORARIO,
        entidad: 'matricula',
        entidad_id: alumno.matriculaId,
        actor_tipo: 'USUARIO',
        actor_id: esc.e[usuario].id,
        motivo: 'El alumno ya no puede los lunes a las 18:00',
      });
      expect(fila?.ip).toMatch(IP_RE);
      const datosAntes = fila?.datos_antes as Record<string, unknown>;
      const datosDespues = fila?.datos_despues as Record<string, unknown>;
      expect(Object.keys(datosAntes)).toEqual(['claseIds']);
      expect(Object.keys(datosDespues)).toEqual(['claseIds']);
      expect(ordenados(datosAntes['claseIds'] as string[])).toEqual(ordenados(clasesDeNoviembre()));
      expect(ordenados(datosDespues['claseIds'] as string[])).toEqual(ordenados(delLunes17()));
    },
  );

  it('criterio 40: la entrada de un cambio de la matrícula de diciembre es de esa matrícula', async () => {
    const alumno = await crearAlumnoDeHorario(ctx, esc, { mes: DICIEMBRE });
    const galletas = en(ctx, esc, INSTANTES.viernes27);

    cambioDe(await cambiarHorario(ctx, galletas.secretaria, alumno.matriculaId, delLunes17()));

    const [fila] = await leerAuditoriaDeAcademia(A(), ACCION_HORARIO);
    expect(fila).toMatchObject({ entidad: 'matricula', entidad_id: alumno.matriculaId });
    expect(ordenados((fila?.datos_despues as { claseIds: string[] }).claseIds)).toEqual(ordenados(delLunes17()));
  });

  it('criterio 40: dos cambios seguidos escriben dos entradas, y el «antes» del segundo es el «después» del primero', async () => {
    const alumno = await crearAlumnoDeHorario(ctx, esc);
    const segundo = [esc.lunes19.id, esc.e.miercoles.id, esc.e.viernes.id];

    cambioDe(
      await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, delLunes17(), { motivo: 'Primer cambio' }),
    );
    cambioDe(await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, segundo, { motivo: 'Segundo cambio' }));

    const filas = await leerAuditoriaDeAcademia(A(), ACCION_HORARIO);
    expect(filas.map((fila) => fila.motivo)).toEqual(['Primer cambio', 'Segundo cambio']);
    const claseIds = (valor: unknown) => ordenados((valor as { claseIds: string[] }).claseIds);
    expect(claseIds(filas[0]?.datos_antes)).toEqual(ordenados(clasesDeNoviembre()));
    expect(claseIds(filas[0]?.datos_despues)).toEqual(ordenados(delLunes17()));
    expect(claseIds(filas[1]?.datos_antes)).toEqual(ordenados(delLunes17()));
    expect(claseIds(filas[1]?.datos_despues)).toEqual(ordenados(segundo));
  });

  it('criterio 40: la entrada no lleva el DNI, los nombres, los apellidos ni datos médicos del alumno (se comprueba el texto de toda la fila)', async () => {
    const alumno = await crearAlumnoDeHorario(ctx, esc);
    const datos = (await leerAlumnos(A())).find((a) => a.id === alumno.alumnoId);
    cambioDe(await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, delLunes17()));

    const filas = await leerAuditoriaDeAcademia(A(), ACCION_HORARIO);

    const texto = JSON.stringify(filas);
    expect(texto).not.toContain(alumno.dni);
    expect(texto).not.toContain(datos?.nombres ?? 'sin-nombres');
    expect(texto).not.toContain(datos?.apellidos ?? 'sin-apellidos');
    expect(texto).not.toMatch(/sangre|alergia|enfermedad|medicamento|seguro|emergencia/i);
  });

  describe('lo que no audita', () => {
    it('criterio 40: un cambio sin diferencias (las mismas clases) responde 200 y no escribe ninguna entrada', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const antes = await leerAuditoriaDeAcademia(A());

      const respuesta = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, clasesDeNoviembre());

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(await leerAuditoriaDeAcademia(A())).toEqual(antes);
    });

    it('criterio 40: ningún rechazo audita: matrícula que no se puede cambiar, selección que no vale, sin cupo, cuerpo inválido, sin permiso, matrícula que no existe y sin sesión', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const finalizada = await crearAlumnoDeHorario(ctx, esc);
      await cambiarMatricula(A(), finalizada.matriculaId, { estado: 'FINALIZADA' });
      await llenarClase(A(), esc.miercoles19.id, esc.e.plan.id, 20, { mes: NOVIEMBRE });
      const antes = await leerAuditoriaDeAcademia(A());

      const respuestas = [
        await cambiarHorario(ctx, cookies.secretaria, finalizada.matriculaId, delLunes17()),
        await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [esc.e.lunes17.id, esc.e.miercoles.id]),
        await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [
          esc.e.lunes17.id,
          esc.miercoles19.id,
          esc.e.viernes.id,
        ]),
        await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, delLunes17(), { motivo: 'ab' }),
        await cambiarHorario(ctx, cookies.entrenador, alumno.matriculaId, delLunes17()),
        await cambiarHorario(ctx, alumno.cookie, alumno.matriculaId, delLunes17()),
        await cambiarHorario(ctx, cookies.secretaria, randomUUID(), delLunes17()),
        await cambiarHorario(ctx, undefined, alumno.matriculaId, delLunes17()),
      ];

      expect(respuestas.map((r) => r.status)).toEqual([409, 409, 409, 400, 403, 403, 404, 401]);
      expect(await leerAuditoriaDeAcademia(A())).toEqual(antes);
    });
  });
});
