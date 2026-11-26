// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  asistenciasDe,
  clasesUsadasDe,
  codigoDeRespuesta,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  instantaneaDeAsistencia,
  leerAsistencias,
  LUNES,
  marcar,
  prepararEscenarioDeAsistencia,
  RUTA_ASISTENCIA_MANUAL,
  RUTA_ASISTENCIA_QR,
  resultadoDe,
} from '../../utilidades/escenario-asistencia';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { rutasRegistradas } from '../../utilidades/usuarios';

// Criterio 16 (crítico, D-23, D-29): con dos academias A y B con el mismo DNI, el mismo nombre y clases a la misma hora: el QR de un alumno de B leído con la sesión de A responde 404 y no escribe en ninguna; el `alumnoId` de B, 404; un `?academiaId=` no cambia nada. Con la transacción de A,
// `SELECT` de `asistencias` no devuelve filas de B (RLS). La tolerancia y la matrícula salen siempre de la academia de la sesión. El Superadmin no tiene estas rutas.
// Aislamiento entre alumnos (`CLAUDE.md`): marcar a un alumno no toca la matrícula ni las asistencias de otro, ni siquiera de uno con el mismo DNI y nombre en la otra academia.
// Lecturas estrictas elegidas: el Superadmin (sesión de plataforma) recibe 401 en las dos rutas y no hay ninguna ruta de asistencias bajo la plataforma; un `academiaId` en el cuerpo es un cuerpo inválido (400, criterio 6) y en la dirección se ignora; el alumno homónimo de B marca solo con la sesión de B.

describe('aislamiento entre academias en el marcado (criterio 16)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let deA: AlumnoDeAsistencia;
  let deB: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    // El mismo DNI y el mismo nombre en las dos academias, con la clase de los lunes a las 18:00 en cada una (el alumno estudia en las dos, D-28).
    deA = await crearAlumnoDeAsistencia(ctx, esc, { dni: '47811902', nombres: 'Valeria', apellidos: 'Mendoza Salas' });
    deB = await crearAlumnoDeAsistencia(ctx, esc, {
      academia: 'B',
      dni: '47811902',
      nombres: 'Valeria',
      apellidos: 'Mendoza Salas',
    });
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const HORA = enLima(LUNES, '18:05:00.000');

  it('criterio 16: cada academia tiene su propio token (D-28): el alumno que estudia en las dos tiene dos QR distintos', () => {
    expect(deA.token).not.toBe(deB.token);
    expect(deA.dni).toBe(deB.dni);
    expect(deA.alumnoId).not.toBe(deB.alumnoId);
  });

  it('criterio 16: el QR del alumno de B leído con la sesión de A responde 404 QR_NO_RECONOCIDO y no escribe en ninguna academia; y al revés', async () => {
    const cookies = en(ctx, esc, HORA);
    const antes = await instantaneaDeAsistencia(esc.e);

    const deBConLaDeA = await marcar(ctx, 'QR', cookies.secretaria, deB);
    const deAConLaDeB = await marcar(ctx, 'QR', cookies.secretariaB, deA);
    const adminAConDeB = await marcar(ctx, 'QR', cookies.admin, deB);

    for (const respuesta of [deBConLaDeA, deAConLaDeB, adminAConDeB]) {
      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        404,
        'QR_NO_RECONOCIDO',
      ]);
    }
    expect(await instantaneaDeAsistencia(esc.e)).toBe(antes);
  });

  it('criterio 16: el alumnoId de B con la sesión de A responde 404 NO_ENCONTRADO (y el de A con la de B), sin escribir', async () => {
    const cookies = en(ctx, esc, HORA);
    const antes = await instantaneaDeAsistencia(esc.e);

    const deBConLaDeA = await marcar(ctx, 'MANUAL', cookies.secretaria, deB);
    const deAConLaDeB = await marcar(ctx, 'MANUAL', cookies.secretariaB, deA);

    for (const respuesta of [deBConLaDeA, deAConLaDeB]) {
      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        404,
        'NO_ENCONTRADO',
      ]);
      expect(respuesta.texto).not.toContain(deA.alumnoId);
      expect(respuesta.texto).not.toContain(deB.alumnoId);
    }
    expect(await instantaneaDeAsistencia(esc.e)).toBe(antes);
  });

  it('criterio 16: ?academiaId=<B> en la dirección no cambia nada: el QR y el alumnoId de B siguen siendo 404 para A, y el alumno de A marca con los datos de A', async () => {
    const cookies = en(ctx, esc, HORA);
    const conB = `?academiaId=${esc.e.B.id}`;

    const qrDeB = await ctx.http.post(
      `${RUTA_ASISTENCIA_QR}${conB}`,
      { contenido: deB.contenido, claveIdempotencia: randomUUID() },
      { cookie: cookies.secretaria },
    );
    const manualDeB = await ctx.http.post(
      `${RUTA_ASISTENCIA_MANUAL}${conB}`,
      { alumnoId: deB.alumnoId, claveIdempotencia: randomUUID() },
      { cookie: cookies.secretaria },
    );
    const propio = await ctx.http.post(
      `${RUTA_ASISTENCIA_QR}${conB}`,
      { contenido: deA.contenido, claveIdempotencia: randomUUID() },
      { cookie: cookies.secretaria },
    );

    expect([qrDeB.status, codigoDeRespuesta(qrDeB)]).toEqual([404, 'QR_NO_RECONOCIDO']);
    expect([manualDeB.status, codigoDeRespuesta(manualDeB)]).toEqual([404, 'NO_ENCONTRADO']);
    expect(resultadoDe(propio, 201).alumno.id).toBe(deA.alumnoId);
    expect(await leerAsistencias(esc.e.B.id)).toEqual([]);
  });

  it('criterio 16: cada academia marca a su alumno homónimo con su sesión y su matrícula: el descuento, la fila y la academia son las de cada una', async () => {
    const cookies = en(ctx, esc, HORA);

    const respuestaA = resultadoDe(await marcar(ctx, 'QR', cookies.secretaria, deA), 201);
    const respuestaB = resultadoDe(await marcar(ctx, 'MANUAL', cookies.secretariaB, deB), 201);

    expect(respuestaA.alumno.id).toBe(deA.alumnoId);
    expect(respuestaB.alumno.id).toBe(deB.alumnoId);
    expect(respuestaA.clase.id).toBe(esc.e.lunes.id);
    expect(respuestaB.clase.id).toBe(esc.e.lunesB.id);
    expect(await asistenciasDe(esc.e.A.id, deA.alumnoId)).toHaveLength(1);
    expect(await asistenciasDe(esc.e.B.id, deB.alumnoId)).toHaveLength(1);
    expect(
      (await leerAsistencias(esc.e.A.id)).every(
        (fila) => fila.academia_id === esc.e.A.id && fila.registrado_por === esc.e.secretariaA.id,
      ),
    ).toBe(true);
    expect(
      (await leerAsistencias(esc.e.B.id)).every(
        (fila) => fila.academia_id === esc.e.B.id && fila.registrado_por === esc.e.secretariaB.id,
      ),
    ).toBe(true);
    expect(await clasesUsadasDe(esc.e.A.id, deA.matriculaId)).toBe(1);
    expect(await clasesUsadasDe(esc.e.B.id, deB.matriculaId)).toBe(1);
  });

  it('criterio 16: marcar al alumno de A no cuenta como «ya marcó» del homónimo de B (una por día es por alumno de cada academia)', async () => {
    const cookies = en(ctx, esc, HORA);
    await marcar(ctx, 'QR', cookies.secretaria, deA);

    const respuestaB = await marcar(ctx, 'QR', cookies.secretariaB, deB);

    expect(respuestaB.status, respuestaB.texto.slice(0, 300)).toBe(201);
  });

  it('criterio 16: con la transacción de A, SELECT de asistencias no devuelve filas de B (RLS), ni pidiéndolas por la academia, el alumno o el id; con la de B, sí las suyas', async () => {
    const cookies = en(ctx, esc, HORA);
    await marcar(ctx, 'QR', cookies.secretaria, deA);
    await marcar(ctx, 'QR', cookies.secretariaB, deB);
    const filaDeB = (await asistenciasDe(esc.e.B.id, deB.alumnoId))[0];

    const comoA = await ejecutarComo('app', 'SELECT id, academia_id FROM asistencias', [], { academiaId: esc.e.A.id });
    const deBDesdeA = await ejecutarComo(
      'app',
      'SELECT id FROM asistencias WHERE academia_id = $1::uuid OR alumno_id = $2::uuid OR id = $3::uuid',
      [esc.e.B.id, deB.alumnoId, filaDeB?.id],
      { academiaId: esc.e.A.id },
    );
    const comoB = await ejecutarComo('app', 'SELECT id FROM asistencias', [], { academiaId: esc.e.B.id });
    const sinContexto = await ejecutarComo('app', 'SELECT id FROM asistencias');

    expect((comoA.rows as { academia_id: string }[]).map((fila) => fila.academia_id)).toEqual([esc.e.A.id]);
    expect(deBDesdeA.rows).toEqual([]);
    expect(comoB.rows).toEqual([{ id: filaDeB?.id }]);
    expect(sinContexto.rows).toEqual([]);
  });

  it('criterio 16 (D-29): el Superadmin no tiene estas rutas: con su sesión, las dos responden 401, y no hay rutas de asistencias en la plataforma', async () => {
    const cookie = cookieDeSesion(esc.e.superadmin, HORA);

    const qr = await ctx.http.post(
      RUTA_ASISTENCIA_QR,
      { contenido: deA.contenido, claveIdempotencia: randomUUID() },
      { cookie },
    );
    const manual = await ctx.http.post(
      RUTA_ASISTENCIA_MANUAL,
      { alumnoId: deA.alumnoId, claveIdempotencia: randomUUID() },
      { cookie },
    );

    for (const respuesta of [qr, manual]) {
      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([401, 'NO_AUTENTICADO']);
    }
    const rutas = rutasRegistradas(ctx.app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
    expect(rutas.filter((ruta) => /asistencias/.test(ruta) && /plataforma/.test(ruta))).toEqual([]);
    expect(rutas).toEqual(expect.arrayContaining(['POST /api/asistencias/manual', 'POST /api/asistencias/qr']));
    expect(await leerAsistencias(esc.e.A.id)).toEqual([]);
  });
});
