// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  asistenciasDe,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  LUNES,
  marcar,
  resultadoDe,
} from '../../utilidades/escenario-asistencia';
import { ejecutarFaltas, prepararEscenarioDe009b, registrarPosterior } from '../../utilidades/escenario-faltas';
import { IP_RE } from '../../utilidades/inscripciones';

// Criterio 29 (crítico, D-16, RNF-06): cada registro posterior escribe una sola entrada `ASISTENCIA_POSTERIOR_REGISTRADA` (entidad `asistencia`, `entidadId` el id de la asistencia, actor `USUARIO`, `motivo`, IP, `datosDespues: { alumnoId, claseId,
// fecha, horaLlegada, estadoLlegada, faltaCubierta }`), sin DNI, nombres ni datos médicos. Un reintento con la misma clave (200) no audita otra vez; un rechazo no audita; el marcado normal y las faltas no auditan (DT-10).
// Lecturas estrictas elegidas: `datosDespues` tiene exactamente esas seis claves (`horaLlegada` es la `HH:MM` de Lima, `fecha` la `AAAA-MM-DD`, `faltaCubierta` un booleano: `true` si había una falta de esa clase y fecha); la entrada nace en la misma transacción
// de la asistencia (si el registro se rechaza no hay ni asistencia ni entrada); el actor es el usuario de la sesión (administrador o secretaria).

describe('la auditoría del registro posterior (criterio 29)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDe009b(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const AHORA = enLima(LUNES, '19:30:00.000');
  const ACCION = 'ASISTENCIA_POSTERIOR_REGISTRADA';
  const MOTIVO = 'La secretaria no estaba en la entrada';
  const auditoria = () => leerAuditoriaDeAcademia(A(), ACCION);

  it('criterio 29: un registro posterior deja una sola entrada con la asistencia, el actor, el motivo, la IP y los datos de después, sin falta cubierta si no había falta', async () => {
    const alumno = await crearAlumnoDeAsistencia(ctx, esc);
    const cookies = en(ctx, esc, AHORA);

    const resultado = resultadoDe(
      await registrarPosterior(ctx, cookies.secretaria, alumno.alumnoId, LUNES, '18:20', { motivo: MOTIVO }),
      201,
    );

    const filas = await auditoria();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      accion: ACCION,
      entidad: 'asistencia',
      entidad_id: resultado.asistencia.id,
      actor_tipo: 'USUARIO',
      actor_id: esc.e.secretariaA.id,
      motivo: MOTIVO,
    });
    expect(filas[0]?.ip).toMatch(IP_RE);
    expect(filas[0]?.datos_despues).toEqual({
      alumnoId: alumno.alumnoId,
      claseId: esc.e.lunes.id,
      fecha: LUNES,
      horaLlegada: '18:20',
      estadoLlegada: 'TARDE',
      faltaCubierta: false,
    });
  });

  it('criterio 29: si había una falta de esa clase y fecha, la entrada lo dice (faltaCubierta true) y sigue siendo una sola', async () => {
    const alumno = await crearAlumnoDeAsistencia(ctx, esc);
    await ejecutarFaltas(ctx, enLima(LUNES, '19:00:00.000'));
    const cookies = en(ctx, esc, AHORA);

    const resultado = resultadoDe(
      await registrarPosterior(ctx, cookies.admin, alumno.alumnoId, LUNES, '18:05', { motivo: MOTIVO }),
      201,
    );

    const filas = await auditoria();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entidad_id: resultado.asistencia.id, actor_id: esc.e.adminA.id, motivo: MOTIVO });
    expect(filas[0]?.datos_despues).toMatchObject({ estadoLlegada: 'PUNTUAL', faltaCubierta: true });
  });

  it('criterio 29: la entrada no lleva DNI, nombres ni apellidos del alumno ni datos médicos', async () => {
    const alumno = await crearAlumnoDeAsistencia(ctx, esc, {
      dni: '47811902',
      nombres: 'Valeria',
      apellidos: 'Mendoza Salas',
    });
    const cookies = en(ctx, esc, AHORA);

    resultadoDe(
      await registrarPosterior(ctx, cookies.secretaria, alumno.alumnoId, LUNES, '18:05', { motivo: MOTIVO }),
      201,
    );

    const texto = JSON.stringify(await auditoria());
    expect(texto).not.toContain('47811902');
    expect(texto).not.toContain('Valeria');
    expect(texto).not.toContain('Mendoza');
    expect(texto).not.toMatch(/alergia|enfermedad|medicamento|tipo_sangre|seguro/i);
  });

  it('criterio 29: un reintento con la misma clave (200) no audita otra vez', async () => {
    const alumno = await crearAlumnoDeAsistencia(ctx, esc);
    const cookies = en(ctx, esc, AHORA);
    const clave = randomUUID();
    resultadoDe(
      await registrarPosterior(ctx, cookies.secretaria, alumno.alumnoId, LUNES, '18:05', { claveIdempotencia: clave }),
      201,
    );

    const reintento = await registrarPosterior(ctx, cookies.secretaria, alumno.alumnoId, LUNES, '18:05', {
      claveIdempotencia: clave,
    });

    expect(resultadoDe(reintento, 200).repetida).toBe(true);
    expect(await auditoria()).toHaveLength(1);
  });

  it('criterio 29: un rechazo (hora fuera de la clase, fecha no permitida, clase sin terminar) no audita ni deja asistencia', async () => {
    const alumno = await crearAlumnoDeAsistencia(ctx, esc);
    const cookies = en(ctx, esc, AHORA);

    for (const [fecha, hora] of [
      [LUNES, '19:30'],
      ['2026-11-23', '18:05'],
    ] as const) {
      const respuesta = await registrarPosterior(ctx, cookies.secretaria, alumno.alumnoId, fecha, hora);
      expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(409);
    }
    const temprano = await registrarPosterior(
      ctx,
      en(ctx, esc, enLima(LUNES, '18:30')).secretaria,
      alumno.alumnoId,
      LUNES,
      '18:05',
    );

    expect(temprano.status).toBe(409);
    expect(await auditoria()).toEqual([]);
    expect(await asistenciasDe(A(), alumno.alumnoId)).toEqual([]);
  });

  it('criterio 29: cada registro posterior de un alumno distinto deja su propia entrada, con su asistencia y su motivo', async () => {
    const uno = await crearAlumnoDeAsistencia(ctx, esc);
    const dos = await crearAlumnoDeAsistencia(ctx, esc);
    const cookies = en(ctx, esc, AHORA);

    const r1 = resultadoDe(
      await registrarPosterior(ctx, cookies.secretaria, uno.alumnoId, LUNES, '18:05', { motivo: 'Motivo del primero' }),
      201,
    );
    const r2 = resultadoDe(
      await registrarPosterior(ctx, cookies.admin, dos.alumnoId, LUNES, '18:05', { motivo: 'Motivo del segundo' }),
      201,
    );

    const filas = await auditoria();
    expect(filas.map((fila) => [fila.entidad_id, fila.motivo, fila.actor_id]).sort()).toEqual(
      [
        [r1.asistencia.id, 'Motivo del primero', esc.e.secretariaA.id],
        [r2.asistencia.id, 'Motivo del segundo', esc.e.adminA.id],
      ].sort(),
    );
  });

  it('criterio 29: el marcado normal (QR o manual, dentro de la clase) no escribe esta auditoría', async () => {
    const uno = await crearAlumnoDeAsistencia(ctx, esc);
    const dos = await crearAlumnoDeAsistencia(ctx, esc);
    const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;

    resultadoDe(await marcar(ctx, 'QR', cookie, uno), 201);
    resultadoDe(await marcar(ctx, 'MANUAL', cookie, dos), 201);

    expect(await auditoria()).toEqual([]);
  });

  it('criterio 29: las faltas que registra la tarea no auditan', async () => {
    await crearAlumnoDeAsistencia(ctx, esc);
    const antes = await leerAuditoriaDeAcademia(A());

    await ejecutarFaltas(ctx, enLima(LUNES, '19:00:00.000'));

    expect(await leerAuditoriaDeAcademia(A())).toEqual(antes);
  });
});
