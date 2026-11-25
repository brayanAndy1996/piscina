// spec: 009-asistencia (pruebas protegidas)
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sembrarCobrable } from '../../utilidades/escenario-pagos';
import {
  type AppCarnet,
  cuerpoRegenerar,
  crearAppCarnet,
  rutaCarnet,
  rutaRegenerarQr,
} from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  codigoDeRespuesta,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  instantaneaDeAsistencia,
  LUNES,
  marcarManual,
  marcarPorQr,
  prepararEscenarioDeAsistencia,
  RUTA_ASISTENCIA_QR,
} from '../../utilidades/escenario-asistencia';
import { sembrarSolicitud, sinUuid } from '../../utilidades/inscripciones';

// Criterio 3 (crítico, RN-06, 8.6, D-23): el token sale solo de `tokenDelContenidoQr(contenido)` y se busca solo por `(academia_id de la sesión, qr_token)`. Un texto vacío, sin el prefijo `AQ1:`, con espacios,
// saltos o minúsculas en el prefijo, con un token de 42 o 44 caracteres, una dirección web, el DNI, el id del alumno, el token de seguimiento de su solicitud, el token de un alumno de otra academia, un token ya regenerado y
// un token con la forma correcta pero que no existe responden todos el mismo 404 `QR_NO_RECONOCIDO` («El QR no corresponde a ningún alumno de esta academia»), con el mismo cuerpo y sin `detalles`. Nada se escribe ni se audita.
// Criterio 5 (crítico, HU-15, D-23), parte del 404: un `alumnoId` que no es UUID, que no existe, que es de otra academia o que es de un `CLIENTE` responde el mismo 404 `NO_ENCONTRADO` de la 008, con el mismo cuerpo.
// Lectura estricta elegida: el contrato dice `alumnoId: uuid`, pero el criterio 5 dice expresamente que un `alumnoId` que no es UUID responde 404 y no 400 (como el `{id}` de las rutas de la 008); por eso un texto que no es UUID
// responde 404 `NO_ENCONTRADO`; un `alumnoId` que no es texto (número, nulo, objeto) responde 400 `SOLICITUD_INVALIDA` (criterio 6). El cuerpo y el mensaje del 404 son los mismos que da la 008 para un alumno que no existe.
// El `contenido` de 200 caracteres es el máximo del esquema: se rechaza como QR desconocido (404); uno de 201 es un cuerpo inválido (400, criterio 6).

const MENSAJE_QR = 'El QR no corresponde a ningún alumno de esta academia';

describe('lo que no es un QR de un alumno de la academia responde 404 (criterios 3 y 5)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;
  let deB: AlumnoDeAsistencia;
  let cookie: string;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc);
    deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' });
    // Una hora dentro de la clase: si el QR fuera reconocido, el alumno marcaría (201).
    cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  /** Los contenidos que no son el QR vigente de un alumno de A, armados con el alumno de la prueba. */
  async function contenidosInvalidos(): Promise<[string, string][]> {
    const token = alumno.token;
    const regenerado = await ctx.http.post(rutaRegenerarQr(alumno.alumnoId), cuerpoRegenerar(), { cookie });
    expect(regenerado.status, regenerado.texto.slice(0, 200)).toBe(200);
    const otroCliente = await sembrarCobrable(esc.e);
    return [
      ['texto vacío', ''],
      ['sin el prefijo', token],
      ['solo el prefijo', 'AQ1:'],
      ['prefijo en minúsculas', `aq1:${token}`],
      ['prefijo con mayúscula y minúscula', `Aq1:${token}`],
      ['otro prefijo', `AQ2:${token}`],
      ['con un espacio antes', ` AQ1:${token}`],
      ['con un espacio después', `AQ1:${token} `],
      ['con un salto de línea al final', `AQ1:${token}\n`],
      ['con un salto de línea y retorno al final', `AQ1:${token}\r\n`],
      ['con un tabulador', `AQ1:\t${token}`],
      ['con un espacio dentro del token', `AQ1:${token.slice(0, 20)} ${token.slice(21)}`],
      ['un token de 42 caracteres', `AQ1:${token.slice(0, 42)}`],
      ['un token de 44 caracteres', `AQ1:${token}A`],
      ['un token con caracteres fuera de base64url', `AQ1:${token.slice(0, 42)}=`],
      ['un token con +', `AQ1:${token.slice(0, 42)}+`],
      ['un token con /', `AQ1:${token.slice(0, 42)}/`],
      ['una dirección web con el token', `https://aquagestion.example/a/academia-a?qr=AQ1:${token}`],
      ['la dirección web del carnet', `https://aquagestion.example${rutaCarnet(alumno.alumnoId)}`],
      ['el DNI', alumno.dni],
      ['el id del alumno', alumno.alumnoId],
      ['el id del alumno con el prefijo', `AQ1:${alumno.alumnoId}`],
      ['el token de seguimiento de su solicitud', alumno.tokenSeguimiento],
      ['el token de seguimiento con el prefijo', `AQ1:${alumno.tokenSeguimiento}`],
      ['el código de su solicitud', alumno.codigoSolicitud],
      ['el token de un alumno de otra academia', deB.contenido],
      ['el token de un alumno de otra academia sin el prefijo', deB.token],
      ['un token ya regenerado (el anterior del mismo alumno)', `AQ1:${token}`],
      ['un token con la forma correcta que no existe', `AQ1:${randomBytes(32).toString('base64url')}`],
      ['un cliente sin QR (su id)', otroCliente.alumnoId],
      ['40 caracteres de relleno', 'x'.repeat(40)],
      ['200 caracteres (el máximo del esquema)', 'AQ1:'.padEnd(200, 'A')],
      ['con comillas y caracteres de SQL', `AQ1:' OR '1'='1`],
      ['con un carácter nulo', `AQ1:${token.slice(0, 20)}\u0000${token.slice(21)}`],
    ];
  }

  it('criterio 3: cada contenido que no es un QR vigente de la academia responde 404 QR_NO_RECONOCIDO con el mismo cuerpo, sin detalles, sin repetir el contenido y sin escribir ni auditar', async () => {
    const casos = await contenidosInvalidos();
    const antes = await instantaneaDeAsistencia(esc.e);
    const cuerpos = new Set<string>();

    for (const [nombre, contenido] of casos) {
      const respuesta = await marcarPorQr(ctx, cookie, contenido);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], `${nombre}: ${respuesta.texto.slice(0, 200)}`).toEqual([
        404,
        'QR_NO_RECONOCIDO',
      ]);
      expect(respuesta.body?.['mensaje'], nombre).toBe(MENSAJE_QR);
      expect(Object.keys(respuesta.body ?? {}).sort(), `${nombre}: sin detalles`).toEqual(['codigo', 'mensaje']);
      if (contenido.length >= 10) expect(respuesta.texto, `${nombre}: no repite el contenido`).not.toContain(contenido);
      cuerpos.add(respuesta.texto);
    }

    expect(cuerpos.size, 'el mismo cuerpo para todos los casos').toBe(1);
    expect(await instantaneaDeAsistencia(esc.e), 'nada se escribe ni se audita').toBe(antes);
  });

  it('criterio 3 (control): el QR vigente del alumno sí registra (201) con la misma hora y la misma sesión', async () => {
    const respuesta = await marcarPorQr(ctx, cookie, alumno.contenido);

    expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
  });

  it('criterio 3: el QR de un alumno de B leído con la sesión de A responde 404 aunque lleve el mismo DNI y el mismo nombre; con la sesión de B sí marca', async () => {
    const homonimo = await crearAlumnoDeAsistencia(ctx, esc, {
      academia: 'B',
      dni: alumno.dni,
      nombres: 'Valeria',
      apellidos: 'Mendoza Salas',
    });
    const cookies = en(ctx, esc, enLima(LUNES, '18:05'));
    const antes = await instantaneaDeAsistencia(esc.e);

    const deAConElDeB = await marcarPorQr(ctx, cookies.secretaria, homonimo.contenido);

    expect([deAConElDeB.status, codigoDeRespuesta(deAConElDeB)]).toEqual([404, 'QR_NO_RECONOCIDO']);
    expect(await instantaneaDeAsistencia(esc.e)).toBe(antes);
    expect(homonimo.token).not.toBe(alumno.token);
    const conLaSuyaDeB = await marcarPorQr(ctx, cookies.secretariaB, homonimo.contenido);
    expect(conLaSuyaDeB.status, conLaSuyaDeB.texto.slice(0, 300)).toBe(201);
  });

  it('criterio 3: un contenido de 201 caracteres es un cuerpo inválido (400), no un QR desconocido', async () => {
    const respuesta = await marcarPorQr(ctx, cookie, `AQ1:${'A'.repeat(197)}`);

    expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([400, 'SOLICITUD_INVALIDA']);
  });

  it('criterio 3: el contenido del QR en la dirección (?qr=…, ?contenido=…) no se lee: solo vale el del cuerpo', async () => {
    const respuesta = await ctx.http.post(
      `${RUTA_ASISTENCIA_QR}?qr=${encodeURIComponent(alumno.contenido)}&contenido=${encodeURIComponent(alumno.contenido)}`,
      { contenido: 'AQ1:' + 'B'.repeat(43), claveIdempotencia: randomUUID() },
      { cookie },
    );

    expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([404, 'QR_NO_RECONOCIDO']);
  });

  describe('criterio 5: el alumnoId de la vía manual que no es de un alumno de la academia', () => {
    it('un id que no es UUID, que no existe, que es de otra academia o que es de un CLIENTE (de A o de B) responde el mismo 404 NO_ENCONTRADO de la 008, con el mismo cuerpo y sin el id', async () => {
      const clienteDeA = await sembrarCobrable(esc.e);
      const clienteDeB = await sembrarSolicitud(esc.e.B.id, {
        planId: esc.e.planB.id,
        claseIds: [esc.e.lunesB.id],
        clasesTotales: 5,
        clasesPorMesPlan: 12,
        precioPlan: '100.00',
        monto: '42.00',
      });
      const ids = [
        'no-es-un-uuid',
        'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
        `${randomUUID()}x`,
        '',
        randomUUID(),
        deB.alumnoId,
        clienteDeA.alumnoId,
        clienteDeB.alumnoId,
      ];
      const referencia = await ctx.http.get(rutaCarnet(randomUUID()), { cookie });
      expect([referencia.status, codigoDeRespuesta(referencia)], 'la 008 responde 404 NO_ENCONTRADO').toEqual([
        404,
        'NO_ENCONTRADO',
      ]);
      const antes = await instantaneaDeAsistencia(esc.e);
      const cuerpos = new Set<string>();

      for (const id of ids) {
        const respuesta = await marcarManual(ctx, cookie, id);

        expect([respuesta.status, codigoDeRespuesta(respuesta)], `${id}: ${respuesta.texto.slice(0, 200)}`).toEqual([
          404,
          'NO_ENCONTRADO',
        ]);
        expect(respuesta.body?.['mensaje'], 'el mismo mensaje que la 008').toBe(referencia.body?.['mensaje']);
        expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['codigo', 'mensaje']);
        if (id.length > 8) expect(respuesta.texto, 'sin el id en el cuerpo').not.toContain(id);
        cuerpos.add(sinUuid(respuesta.texto));
      }

      expect(cuerpos.size, 'el mismo cuerpo para todos los casos').toBe(1);
      expect(await instantaneaDeAsistencia(esc.e)).toBe(antes);
    });

    it('un alumnoId que no es texto (número, nulo, lista, objeto) o falta es un cuerpo inválido: 400 SOLICITUD_INVALIDA', async () => {
      for (const alumnoId of [42, null, ['x'], { id: 'x' }, true, undefined]) {
        const respuesta = await ctx.http.post(
          '/api/asistencias/manual',
          { alumnoId, claveIdempotencia: randomUUID() },
          { cookie },
        );

        expect([respuesta.status, codigoDeRespuesta(respuesta)], JSON.stringify(alumnoId)).toEqual([
          400,
          'SOLICITUD_INVALIDA',
        ]);
      }
    });
  });
});
