// spec: 008-carnet-qr (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { AHORA_007 } from '../../utilidades/escenario-pagos';
import {
  type AlumnoConQr,
  type AppCarnet,
  carnetDe,
  conAlumnoRetenido,
  crearAlumnoPorPago,
  crearAppCarnet,
  cuerpoRegenerar,
  type EscenarioDelCarnet,
  instantaneaDelCarnet,
  leerQr,
  prepararEscenarioDelCarnet,
  rutaRegenerarQr,
} from '../../utilidades/escenario-carnet';

// Criterio 14 (crítico): con la misma `claveIdempotencia` que la última regeneración de ese alumno, la regeneración responde 200 con el carnet actual sin cambiar el token ni auditar (un doble clic no deja inservible el carnet recién impreso). Dos
// peticiones a la vez con la misma clave dejan un solo cambio de token y una sola auditoría. Con claves distintas, cada una regenera y audita, una después de la otra. La misma clave usada antes con otro alumno no cuenta.
// Plan, «Regeneración»: dos peticiones a la vez con la misma clave: la segunda espera el `FOR UPDATE`, lee la clave ya guardada y no regenera. La espera se comprueba en `pg_locks` (retención de la fila del alumno).
// Lectura estricta elegida: solo cuenta la ÚLTIMA clave de cada alumno (`qr_clave_idempotencia`): K1, K2 y otra vez K1 regenera de nuevo; y la clave vale aunque el motivo o quien regenera (secretaria o administrador) sean otros.

describe('regenerar el QR es idempotente (criterio 14)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const regenerar = (cuerpo: unknown, cookie = esc.cookies.secretaria, alumnoId = alumno.alumnoId) =>
    ctx.http.post(rutaRegenerarQr(alumnoId), cuerpo, { cookie });
  const auditorias = (accion = 'CARNET_QR_REGENERADO') => leerAuditoriaDeAcademia(esc.e.A.id, accion);
  const tokenActual = async (alumnoId = alumno.alumnoId) => (await leerQr(esc.e.A.id, alumnoId)).qr_token as string;
  const MAS_TARDE = new Date(AHORA_007.getTime() + 60 * 60 * 1000);

  it('criterio 14: el reintento con la misma clave responde 200 con el carnet actual, sin cambiar el token, la fecha ni actualizado_en, y sin auditar otra vez', async () => {
    const cuerpo = cuerpoRegenerar();
    ctx.reloj.fijar(MAS_TARDE);
    const primera = await regenerar(cuerpo);
    expect(primera.status, primera.texto.slice(0, 300)).toBe(200);
    const despuesDelPrimero = await leerQr(esc.e.A.id, alumno.alumnoId);
    ctx.reloj.avanzar(2 * 60 * 60 * 1000);

    const segunda = await regenerar(cuerpo);

    expect(segunda.status, segunda.texto.slice(0, 300)).toBe(200);
    expect(segunda.cacheControl).toBe('no-store');
    expect(carnetDe(segunda), 'el mismo carnet actual').toEqual(carnetDe(primera));
    expect(await leerQr(esc.e.A.id, alumno.alumnoId), 'ni el token, ni la fecha, ni actualizado_en cambian').toEqual(
      despuesDelPrimero,
    );
    expect(await auditorias(), 'una sola auditoría').toHaveLength(1);
  });

  it('criterio 14: el reintento con la misma clave pero otro motivo, o hecho por el administrador, tampoco cambia nada', async () => {
    const clave = randomUUID();
    const primera = await regenerar(cuerpoRegenerar({ claveIdempotencia: clave, motivo: 'Se perdió el carnet' }));
    expect(primera.status, primera.texto.slice(0, 300)).toBe(200);
    const antes = await instantaneaDelCarnet(esc.e);

    const otroMotivo = await regenerar(cuerpoRegenerar({ claveIdempotencia: clave, motivo: 'Otro motivo distinto' }));
    const delAdmin = await regenerar(cuerpoRegenerar({ claveIdempotencia: clave }), esc.cookies.admin);

    expect([otroMotivo.status, delAdmin.status]).toEqual([200, 200]);
    expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    expect(await auditorias()).toHaveLength(1);
  });

  it('criterio 14: con claves distintas, cada una regenera y audita: tres claves, tres tokens distintos y tres auditorías', async () => {
    const tokens = [await tokenActual()];
    for (let i = 0; i < 3; i += 1) {
      const respuesta = await regenerar(cuerpoRegenerar());
      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      tokens.push(await tokenActual());
    }

    expect(new Set(tokens).size).toBe(4);
    expect(await auditorias()).toHaveLength(3);
  });

  it('criterio 14: la misma clave usada antes con otro alumno no cuenta: los dos alumnos regeneran', async () => {
    const otro = await crearAlumnoPorPago(ctx, esc, { nombres: 'Camila', apellidos: 'Torres Vega' });
    const clave = randomUUID();
    const tokenDelOtroAntes = await tokenActual(otro.alumnoId);
    const tokenAntes = await tokenActual();

    const primero = await regenerar(
      cuerpoRegenerar({ claveIdempotencia: clave }),
      esc.cookies.secretaria,
      otro.alumnoId,
    );
    const segundo = await regenerar(
      cuerpoRegenerar({ claveIdempotencia: clave }),
      esc.cookies.secretaria,
      alumno.alumnoId,
    );

    expect([primero.status, segundo.status]).toEqual([200, 200]);
    expect(await tokenActual(otro.alumnoId)).not.toBe(tokenDelOtroAntes);
    expect(await tokenActual(), 'el segundo alumno regeneró aunque la clave ya se había usado con el primero').not.toBe(
      tokenAntes,
    );
    const filas = await auditorias();
    expect(filas.map((f) => f.entidad_id).sort()).toEqual([alumno.alumnoId, otro.alumnoId].sort());
  });

  it('criterio 14: solo cuenta la última clave de cada alumno: K1, K2 y otra vez K1 regenera de nuevo', async () => {
    const k1 = randomUUID();
    const k2 = randomUUID();
    const tokens: string[] = [await tokenActual()];
    for (const clave of [k1, k2, k1]) {
      const respuesta = await regenerar(cuerpoRegenerar({ claveIdempotencia: clave }));
      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      tokens.push(await tokenActual());
    }

    expect(
      new Set(tokens).size,
      'cuatro tokens distintos: la tercera petición (K1 otra vez) no era el último reintento',
    ).toBe(4);
    expect(await auditorias()).toHaveLength(3);
    expect((await leerQr(esc.e.A.id, alumno.alumnoId)).qr_clave_idempotencia).toBe(k1);
  });

  it('criterio 14: cinco clics a la vez con la misma clave dejan un solo cambio de token y una sola auditoría, y las cinco respuestas traen el mismo carnet nuevo', async () => {
    const antes = await tokenActual();
    const cuerpo = cuerpoRegenerar();

    const respuestas = await Promise.all([
      regenerar(cuerpo),
      regenerar(cuerpo, esc.cookies.admin),
      regenerar(cuerpo),
      regenerar(cuerpo, esc.cookies.admin),
      regenerar(cuerpo),
    ]);

    for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
    const despues = await tokenActual();
    expect(despues).not.toBe(antes);
    expect(await auditorias()).toHaveLength(1);
    for (const respuesta of respuestas)
      expect(carnetDe(respuesta).qr?.contenido, 'todas devuelven el carnet vigente').toBe(`AQ1:${despues}`);
  });

  it('criterio 14 (determinista, pg_locks): con la fila del alumno retenida, dos peticiones con la misma clave esperan las dos; al soltarla responden 200 las dos, con un solo cambio de token y una sola auditoría', async () => {
    const antes = await tokenActual();
    const cuerpo = cuerpoRegenerar();

    const { resultados, esperaron, maximoEnEspera } = await conAlumnoRetenido({
      academiaId: esc.e.A.id,
      alumnoId: alumno.alumnoId,
      enviar: [() => regenerar(cuerpo, esc.cookies.secretaria), () => regenerar(cuerpo, esc.cookies.admin)],
      esperando: 2,
    });

    expect(esperaron, `las dos peticiones debían quedar esperando en pg_locks (máximo visto: ${maximoEnEspera})`).toBe(
      true,
    );
    expect(
      resultados.map((r) => r.status),
      resultados.map((r) => r.texto.slice(0, 200)).join(' | '),
    ).toEqual([200, 200]);
    const despues = await tokenActual();
    expect(despues).not.toBe(antes);
    expect(await auditorias(), 'la segunda leyó la clave ya guardada y no regeneró').toHaveLength(1);
    for (const respuesta of resultados) expect(carnetDe(respuesta).qr?.contenido).toBe(`AQ1:${despues}`);
  });

  it('criterio 14 (determinista, pg_locks): con la fila retenida, dos peticiones con claves distintas esperan las dos; al soltarla regeneran una después de la otra: dos auditorías y vale el último token', async () => {
    const antes = await tokenActual();

    const { resultados, esperaron, maximoEnEspera } = await conAlumnoRetenido({
      academiaId: esc.e.A.id,
      alumnoId: alumno.alumnoId,
      enviar: [
        () => regenerar(cuerpoRegenerar(), esc.cookies.secretaria),
        () => regenerar(cuerpoRegenerar(), esc.cookies.admin),
      ],
      esperando: 2,
    });

    expect(esperaron, `las dos peticiones debían quedar esperando en pg_locks (máximo visto: ${maximoEnEspera})`).toBe(
      true,
    );
    expect(
      resultados.map((r) => r.status),
      resultados.map((r) => r.texto.slice(0, 200)).join(' | '),
    ).toEqual([200, 200]);
    const despues = await tokenActual();
    expect(despues).not.toBe(antes);
    const filas = await auditorias();
    expect(filas, 'dos regeneraciones, dos auditorías').toHaveLength(2);
    expect(new Set(filas.map((f) => f.actor_id)), 'una de cada actor').toEqual(
      new Set([esc.e.secretariaA.id, esc.e.adminA.id]),
    );
    const contenidos = resultados.map((r) => carnetDe(r).qr?.contenido);
    expect(contenidos, 'cada respuesta trae el carnet vigente al terminar; el definitivo es el de la base').toContain(
      `AQ1:${despues}`,
    );
    // Ningún token intermedio queda en la base: solo el último.
    const tokensDeLaBase = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token;
    expect(tokensDeLaBase).toBe(despues);
  });

  it('criterio 14 y 13: tras un doble clic el carnet recién impreso sigue siendo el vigente: el token de la primera respuesta es el de la base y el reintento no lo invalida', async () => {
    const cuerpo = cuerpoRegenerar();
    const impreso = carnetDe(await regenerar(cuerpo)).qr?.contenido;

    const reintento = carnetDe(await regenerar(cuerpo)).qr?.contenido;

    expect(reintento).toBe(impreso);
    expect(impreso).toBe(`AQ1:${await tokenActual()}`);
  });
});
