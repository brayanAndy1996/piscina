// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  LUNES,
  marcarManual,
  marcarPorQr,
  prepararEscenarioDeAsistencia,
  RUTA_ASISTENCIA_QR,
} from '../../utilidades/escenario-asistencia';
import { lineasJson } from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import { rutasRegistradas } from '../../utilidades/usuarios';

// Criterio 17 (crítico, RN-06, criterio 17 de 008): el contenido del QR y el token nunca aparecen en una dirección, en la respuesta (ni en el 404), en la auditoría ni en el registro técnico de ningún nivel; tampoco el DNI. Prueba: el registro técnico capturado (nivel `trace`) durante
// una lectura correcta, una rechazada, una repetida, una 404, un cuerpo inválido, una sin permiso y una sin sesión no contiene el token ni el contenido (ni codificados para una dirección o para un JSON), ni el DNI.
// Va en su propio archivo, con una sola aplicación y la primera del proceso: el registro técnico de pino (nivel y redacción) es global del proceso y lo fija la primera aplicación que se crea.
// Lectura estricta elegida: se busca el token vigente de cada alumno y el prefijo `AQ1:` en todas las líneas del registro técnico, en todas las filas de la auditoría de las dos academias, en todos los correos y en todas las respuestas de la prueba que no son un resultado de alumno; el DNI y
// el contenido que se envía también se buscan en las respuestas de las lecturas y en el registro; ninguna ruta de `/api/asistencias` lleva un segmento `:token`, `:qr` o `:contenido`, y la dirección que usa la prueba nunca lleva el token.

describe('el token del QR no sale de su sitio en el marcado (criterio 17)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;
  let otro: AlumnoDeAsistencia;
  let deB: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc, { dni: '47811902' });
    otro = await crearAlumnoDeAsistencia(ctx, esc, { dni: '45678912' });
    deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B', dni: '40123456' });
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  it('criterio 17: tras una lectura correcta, una rechazada, una repetida, una 404, un cuerpo inválido, una sin permiso y una sin sesión, ni el token ni el contenido ni el DNI están en el registro técnico, la auditoría, los correos ni las respuestas', async () => {
    const cookies = en(ctx, esc, enLima(LUNES, '18:05'));
    const respuestas: { nombre: string; texto: string }[] = [];
    const guardar = <T extends { status: number; texto: string }>(nombre: string, respuesta: T): T => {
      respuestas.push({ nombre, texto: respuesta.texto });
      return respuesta;
    };
    const clave = randomUUID();

    const correcta = guardar(
      '201 por QR',
      await marcarPorQr(ctx, cookies.secretaria, alumno.contenido, { claveIdempotencia: clave }),
    );
    const repetida = guardar(
      '200 repetida',
      await marcarPorQr(ctx, cookies.secretaria, alumno.contenido, { claveIdempotencia: clave }),
    );
    const yaMarco = guardar('409 ya registrada', await marcarPorQr(ctx, cookies.secretaria, alumno.contenido));
    const fueraDeHorario = guardar(
      '409 fuera de horario',
      await marcarPorQr(ctx, en(ctx, esc, enLima(LUNES, '20:00')).secretaria, otro.contenido),
    );
    const porManual = guardar(
      'manual',
      await marcarManual(ctx, en(ctx, esc, enLima(LUNES, '18:10')).secretaria, otro.alumnoId),
    );
    const noReconocido = guardar('404 de otra academia', await marcarPorQr(ctx, cookies.secretaria, deB.contenido));
    const inventado = guardar('404 inventado', await marcarPorQr(ctx, cookies.secretaria, `AQ1:${'F'.repeat(43)}`));
    const conCampoDeMas = guardar(
      '400 con campo de más',
      await ctx.http.post(
        RUTA_ASISTENCIA_QR,
        { contenido: alumno.contenido, claveIdempotencia: randomUUID(), academiaId: esc.e.B.id },
        { cookie: cookies.secretaria },
      ),
    );
    const sinClave = guardar(
      '400 sin clave',
      await ctx.http.post(RUTA_ASISTENCIA_QR, { contenido: alumno.contenido }, { cookie: cookies.secretaria }),
    );
    const sinPermiso = guardar('403 entrenador', await marcarPorQr(ctx, cookies.entrenador, alumno.contenido));
    const sinSesion = guardar('401 sin sesión', await marcarPorQr(ctx, undefined, alumno.contenido));
    const deAlumno = guardar('403 el propio alumno', await marcarPorQr(ctx, alumno.cookie, alumno.contenido));

    expect(correcta.status, correcta.texto.slice(0, 300)).toBe(201);
    expect(repetida.status).toBe(200);
    expect([yaMarco.status, fueraDeHorario.status, noReconocido.status, inventado.status]).toEqual([
      409, 409, 404, 404,
    ]);
    expect(porManual.status, porManual.texto.slice(0, 300)).toBe(201);
    expect([conCampoDeMas.status, sinClave.status, sinPermiso.status, sinSesion.status, deAlumno.status]).toEqual([
      400, 400, 403, 401, 403,
    ]);

    const tokens = [alumno.token, otro.token, deB.token];
    const buscados = [...tokens, 'AQ1:', ...tokens.map((token) => `AQ1:${token}`)];
    const dnis = [alumno.dni, otro.dni, deB.dni];
    const donde: [string, string, string[]][] = [
      ['la auditoría de A', JSON.stringify(await leerAuditoriaDeAcademia(esc.e.A.id)), buscados],
      ['la auditoría de B', JSON.stringify(await leerAuditoriaDeAcademia(esc.e.B.id)), buscados],
      ['los correos', JSON.stringify(ctx.correo.mensajes), buscados],
      ...respuestas.map((respuesta): [string, string, string[]] => [
        `la respuesta «${respuesta.nombre}»`,
        respuesta.texto,
        [...buscados, ...dnis],
      ]),
    ];
    for (const [nombre, texto, prohibidos] of donde) {
      for (const prohibido of prohibidos)
        expect(texto, `«${prohibido}» no aparece en ${nombre}`).not.toContain(prohibido);
    }

    expect(lineas.length, 'el registro técnico quedó con líneas (nivel trace)').toBeGreaterThan(0);
    expect(lineasJson(lineas).length).toBeGreaterThan(0);
    const registro = lineas.join('\n');
    for (const prohibido of [...buscados, ...dnis]) {
      expect(registro, `«${prohibido}» no aparece en ninguna línea del registro técnico (ningún nivel)`).not.toContain(
        prohibido,
      );
    }
    // También el contenido codificado para una dirección o para un JSON dentro del registro.
    for (const token of tokens) {
      expect(registro).not.toContain(encodeURIComponent(`AQ1:${token}`));
      expect(registro).not.toContain(JSON.stringify(`AQ1:${token}`));
      expect(registro).not.toContain(Buffer.from(`AQ1:${token}`).toString('base64'));
    }
  });

  it('criterio 17: ninguna ruta de /api/asistencias recibe el token o el contenido del QR en la dirección (sin segmentos :token, :qr ni :contenido), y la prueba nunca lo pone en la dirección', () => {
    const rutas = rutasRegistradas(ctx.app)
      .map(([metodo, ruta]) => `${metodo} ${ruta}`)
      .filter((ruta) => /\/api\/asistencias/.test(ruta));

    expect(rutas.length).toBeGreaterThanOrEqual(2);
    for (const ruta of rutas) expect(ruta, ruta).not.toMatch(/:(token|qr|contenido|qrToken)\b/i);
    expect(RUTA_ASISTENCIA_QR).not.toContain('AQ1');
  });

  it('criterio 17: ni la clave de idempotencia ni el contenido enviado se registran en la auditoría del marcado (no hay filas nuevas) y el DNI no está en ninguna fila de auditoría escrita por el marcado', async () => {
    const antes = await leerAuditoriaDeAcademia(esc.e.A.id);
    const cookies = en(ctx, esc, enLima(LUNES, '18:05'));

    await marcarPorQr(ctx, cookies.secretaria, alumno.contenido);
    await marcarManual(ctx, cookies.secretaria, otro.alumnoId);

    expect(await leerAuditoriaDeAcademia(esc.e.A.id)).toEqual(antes);
  });
});
