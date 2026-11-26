// spec: 009-asistencia (pruebas protegidas)
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AppCarnet,
  crearAppCarnet,
  cuerpoRegenerar,
  leerQr,
  rutaRegenerarQr,
} from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  asistenciasDe,
  codigoDeRespuesta,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  LUNES,
  marcarPorQr,
  prepararEscenarioDeAsistencia,
  resultadoDe,
} from '../../utilidades/escenario-asistencia';
import { abrirRetenedor, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';

// Criterio 4 (crítico, 8.6, criterio 13 de 008): un QR regenerado deja de valer al instante. La búsqueda por token toma la fila del alumno con `FOR SHARE`. Prueba determinista (espera comprobada en la cadena de bloqueos de
// PostgreSQL): una lectura con el token viejo que espera mientras la regeneración de la 008 tiene la fila (`UPDATE alumnos SET qr_token`, sin confirmar) responde 404 `QR_NO_RECONOCIDO` cuando la regeneración confirma; después, el token viejo
// da 404 y el nuevo registra. Si la regeneración se revierte, el token viejo sigue valiendo (control).
// Lectura estricta elegida: la regeneración que retiene la fila es una transacción de la prueba con el mismo `UPDATE` que hace la 008 (`qr_token`, `qr_generado_en`), porque la regeneración real no se puede pausar a mitad; también se prueba la
// regeneración real de la 008 (`POST /api/alumnos/{id}/carnet/qr`) antes y después de la lectura.

describe('un QR regenerado deja de valer al instante (criterio 4)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const HORA = enLima(LUNES, '18:05:00.000');
  const tokenNuevo = () => randomBytes(32).toString('base64url');

  /**
   * La regeneración tiene la fila del alumno (UPDATE del token sin confirmar); la lectura con el token viejo se envía y la prueba espera, con la cadena de bloqueos de
   * PostgreSQL, a que quede esperando esa fila; entonces la regeneración confirma o se revierte. Devuelve la respuesta de la lectura.
   */
  async function leerMientrasSeRegenera(contenido: string, nuevo: string, como: 'COMMIT' | 'ROLLBACK') {
    const cookie = en(ctx, esc, HORA).secretaria;
    const retenedor = await abrirRetenedor(esc.e.A.id);
    try {
      await retenedor.consultar(
        'UPDATE alumnos SET qr_token = $3, qr_generado_en = now() WHERE academia_id = $1::uuid AND id = $2::uuid',
        [esc.e.A.id, alumno.alumnoId, nuevo],
      );
      const peticion = observar(marcarPorQr(ctx, cookie, contenido));
      const esperando = await esperarEspera(
        async () => (await retenedor.sesionesEsperando()) >= 1,
        [peticion],
        'la lectura ni respondió ni quedó esperando la fila del alumno que la regeneración tiene.',
      );
      await retenedor.liberar(como);
      const respuesta = await conLimite(
        peticion.resultado,
        'Límite de seguridad: la lectura no respondió tras soltar la fila del alumno.',
      );
      return { respuesta, esperando };
    } finally {
      await retenedor.liberar('ROLLBACK');
    }
  }

  it('criterio 4: la lectura con el token viejo que espera la fila mientras la regeneración la tiene responde 404 QR_NO_RECONOCIDO al confirmarse la regeneración; no registra ninguna asistencia', async () => {
    const nuevo = tokenNuevo();
    const { respuesta, esperando } = await leerMientrasSeRegenera(alumno.contenido, nuevo, 'COMMIT');

    expect(esperando, 'la lectura debía quedar esperando la fila del alumno (FOR SHARE)').toBe(true);
    expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
      404,
      'QR_NO_RECONOCIDO',
    ]);
    expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toEqual([]);
    expect(await leerQr(esc.e.A.id, alumno.alumnoId)).toMatchObject({ qr_token: nuevo });
  });

  it('criterio 4: después de la regeneración, el token viejo da 404 y el nuevo registra la asistencia', async () => {
    const nuevo = tokenNuevo();
    await leerMientrasSeRegenera(alumno.contenido, nuevo, 'COMMIT');
    const cookie = en(ctx, esc, HORA).secretaria;

    const conElViejo = await marcarPorQr(ctx, cookie, alumno.contenido);
    const conElNuevo = await marcarPorQr(ctx, cookie, `AQ1:${nuevo}`);

    expect([conElViejo.status, codigoDeRespuesta(conElViejo)]).toEqual([404, 'QR_NO_RECONOCIDO']);
    expect(resultadoDe(conElNuevo, 201).alumno.id).toBe(alumno.alumnoId);
    expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
  });

  it('criterio 4 (control): si la regeneración se revierte, la lectura con el token viejo espera igual y registra la asistencia (201)', async () => {
    const { respuesta, esperando } = await leerMientrasSeRegenera(alumno.contenido, tokenNuevo(), 'ROLLBACK');

    expect(esperando).toBe(true);
    expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
    expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
  });

  it('criterio 4: con la regeneración real de la 008, el token anterior da 404 de inmediato, el nuevo registra, y la regeneración no cambia las asistencias anteriores', async () => {
    const cookie = en(ctx, esc, HORA).secretaria;
    const antes = await marcarPorQr(ctx, cookie, alumno.contenido);
    expect(antes.status, antes.texto.slice(0, 200)).toBe(201);

    const regeneracion = await ctx.http.post(rutaRegenerarQr(alumno.alumnoId), cuerpoRegenerar(), { cookie });
    expect(regeneracion.status, regeneracion.texto.slice(0, 200)).toBe(200);
    const nuevo = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token as string;

    const conElViejo = await marcarPorQr(ctx, cookie, alumno.contenido);
    const conElNuevo = await marcarPorQr(ctx, cookie, `AQ1:${nuevo}`);

    expect(nuevo).not.toBe(alumno.token);
    expect([conElViejo.status, codigoDeRespuesta(conElViejo)]).toEqual([404, 'QR_NO_RECONOCIDO']);
    expect(
      [conElNuevo.status, codigoDeRespuesta(conElNuevo)],
      'el nuevo QR llega al alumno que ya marcó hoy: 409',
    ).toEqual([409, 'ASISTENCIA_YA_REGISTRADA']);
    expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
  });
});
