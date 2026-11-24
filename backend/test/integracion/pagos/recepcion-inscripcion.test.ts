// spec: 007-pagos (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { conFilaRetenida } from '../../utilidades/carreras';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  detallesDeRespuesta,
  type EscenarioPagos,
  partesDeLaAcademia,
} from '../../utilidades/escenario-pagos';
import {
  contarFilasDeInscripciones,
  cuerpoInscripcion,
  EnviadorDePrueba,
  IP_RE,
  llenarClase,
  rutaPublica,
  sembrarSolicitud,
  solicitudDe,
} from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  png,
  subirFoto,
  subirFotoValida,
} from '../../utilidades/inscripciones-005b';
import { esperarHasta } from '../../utilidades/modulos';
import { actualizarUsuario } from '../../utilidades/usuarios';

// Criterio 34 (crítico, DR-20 de 005, DT-5 de 002, RN-22): un envío del formulario con la sesión de recepción: a) llama a `bloquearActorVigente` como primera sentencia de su transacción (si el actor ya no está vigente,
// 401 `NO_AUTENTICADO` sin escribir) y luego sigue el orden de la 005; b) no aplica el límite de 5 solicitudes sin pagar por conexión (criterio 25 de 005), y su solicitud guarda `registrada_por` (el actor) y no cuenta
// en el límite de la conexión desde la que se envió; c) audita `SOLICITUD_INSCRIPCION_CREADA` con actor `USUARIO` (quien inscribe) en lugar de `PUBLICO`. Todo lo demás de la 005 (validación, cupo, DNI, idempotencia,
// correo, respuesta) es igual.
// Criterio 35 (crítico, DR-20 de 005): una subida de la foto con esa sesión no cuenta en la regla `foto`; todo lo demás del criterio 34 de 005 es igual.

interface FilaDeOrigen {
  id: string;
  registrada_por: string | null;
  ip_origen: string | null;
}

describe('la inscripción desde recepción (criterio 34)', () => {
  const correo = new EnviadorDePrueba();
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ correo });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    correo.mensajes.length = 0;
    correo.fallar = false;
    e = await crearEscenarioDePagos();
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const enviar = (cuerpo: unknown, cookie?: string) =>
    ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo, { cookie });
  const origenes = async (): Promise<FilaDeOrigen[]> =>
    (
      await ejecutarComo(
        'propietario',
        'SELECT id, registrada_por, host(ip_origen) AS ip_origen FROM solicitudes_inscripcion WHERE academia_id = $1::uuid ORDER BY creado_en, id',
        [e.A.id],
        { academiaId: e.A.id },
      )
    ).rows as FilaDeOrigen[];

  describe('criterio 34 b y c: quién inscribe', () => {
    it('criterio 34 c: con la sesión de la secretaria, la solicitud queda con registrada_por, la auditoría SOLICITUD_INSCRIPCION_CREADA es de un USUARIO (la secretaria) y no PUBLICO, y la respuesta es la de siempre (201 con el seguimiento)', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e), cookies.secretaria);

      expect(respuesta.status, respuesta.texto).toBe(201);
      const creada = solicitudDe(respuesta);
      expect(creada.estado).toBe('PENDIENTE_PAGO');
      expect(creada.codigo).toMatch(/^AQ-/);
      const [fila] = await origenes();
      expect(fila?.registrada_por).toBe(e.secretariaA.id);
      expect(fila?.ip_origen, 'la IP de origen se guarda igual').toMatch(IP_RE);
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, 'SOLICITUD_INSCRIPCION_CREADA');
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({
        actor_tipo: 'USUARIO',
        actor_id: e.secretariaA.id,
        entidad: 'solicitud_inscripcion',
      });
    });

    it('criterio 34 c: con la sesión del administrador, el actor es el administrador', async () => {
      await enviar(await cuerpoInscripcion(e), cookies.admin);

      expect((await origenes())[0]?.registrada_por).toBe(e.adminA.id);
      expect((await leerAuditoriaDeAcademia(e.A.id, 'SOLICITUD_INSCRIPCION_CREADA'))[0]).toMatchObject({
        actor_tipo: 'USUARIO',
        actor_id: e.adminA.id,
      });
    });

    it('criterio 34: un envío anónimo no cambia: registrada_por nula y actor PUBLICO sin id', async () => {
      await enviar(await cuerpoInscripcion(e));

      expect((await origenes())[0]?.registrada_por).toBeNull();
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, 'SOLICITUD_INSCRIPCION_CREADA');
      expect(auditoria[0]).toMatchObject({ actor_tipo: 'PUBLICO', actor_id: null });
    });

    it.each([
      ['un ENTRENADOR', 'entrenador'],
      ['un ALUMNO', 'alumno'],
      ['la secretaria de B (otra academia)', 'secretariaB'],
    ] as const)(
      'criterio 34: con la sesión de %s el envío se trata como anónimo (201, registrada_por nula, actor PUBLICO), sin 401 ni 403 por la cookie',
      async (_nombre, cookie) => {
        const respuesta = await enviar(await cuerpoInscripcion(e), cookies[cookie]);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect((await origenes())[0]?.registrada_por).toBeNull();
        expect((await leerAuditoriaDeAcademia(e.A.id, 'SOLICITUD_INSCRIPCION_CREADA'))[0]).toMatchObject({
          actor_tipo: 'PUBLICO',
          actor_id: null,
        });
      },
    );

    it('criterio 34: con una cookie inválida o con el cambio de contraseña pendiente, el envío se trata como anónimo (201)', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA2.id, { debe_cambiar_clave: true });

      const invalida = await enviar(await cuerpoInscripcion(e), 'aq_sesion=no-es-un-token');
      const pendiente = await enviar(await cuerpoInscripcion(e), cookies.secretaria2);

      expect([invalida.status, pendiente.status]).toEqual([201, 201]);
      expect((await origenes()).map((f) => f.registrada_por)).toEqual([null, null]);
    });
  });

  describe('criterio 34 b: sin el límite de 5 solicitudes sin pagar por conexión', () => {
    it('criterio 34 b: la recepción envía 7 solicitudes seguidas desde la misma conexión (todas 201, todas con registrada_por) y no cuentan en el límite: un anónimo desde la misma conexión todavía envía 5 y recién la sexta responde 409 LIMITE_DE_RESERVAS_PENDIENTES', async () => {
      for (let i = 0; i < 7; i++) {
        const respuesta = await enviar(await cuerpoInscripcion(e), cookies.secretaria);
        expect(respuesta.status, `recepción ${i + 1}: ${respuesta.texto}`).toBe(201);
      }
      expect((await origenes()).filter((f) => f.registrada_por === e.secretariaA.id)).toHaveLength(7);

      for (let i = 0; i < 5; i++) {
        const respuesta = await enviar(await cuerpoInscripcion(e));
        expect(respuesta.status, `anónimo ${i + 1}: ${respuesta.texto}`).toBe(201);
      }
      const sexta = await enviar(await cuerpoInscripcion(e));

      expect([sexta.status, codigoDeRespuesta(sexta)], sexta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
    });

    it('criterio 34 b: las solicitudes anónimas de la conexión no frenan a la recepción: con 5 anónimas pendientes, la secretaria sigue enviando', async () => {
      for (let i = 0; i < 5; i++) expect((await enviar(await cuerpoInscripcion(e))).status).toBe(201);

      const deRecepcion = await enviar(await cuerpoInscripcion(e), cookies.secretaria);

      expect(deRecepcion.status, deRecepcion.texto).toBe(201);
    });
  });

  describe('criterio 34 a: el actor sigue vigente dentro de la transacción', () => {
    it.each([
      ['desactivado', 'desactivar'],
      ['con la versión de token cambiada', 'solo-version'],
    ] as const)(
      'criterio 34 a: si la secretaria deja de estar vigente (%s) mientras el envío espera, responde 401 NO_AUTENTICADO y no escribe nada',
      async (_nombre, cambio) => {
        const cuerpo = await cuerpoInscripcion(e);
        const antes = await partesDeLaAcademia(e.A.id);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: e.secretariaA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => enviar(cuerpo, cookies.secretaria),
        });

        expect(
          esperoElBloqueo,
          'el envío de recepción debía quedar esperando la fila del actor: bloquearActorVigente es su primera sentencia',
        ).toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        expect(await contarFilasDeInscripciones(e.A.id)).toMatchObject({
          alumnos: 0,
          solicitudes_inscripcion: 0,
          matriculas: 0,
        });
        expect((await partesDeLaAcademia(e.A.id)).auditoria).toEqual(antes.auditoria);
      },
    );

    it('criterio 34 a (control): si la prueba solo bloquea la fila del actor, el envío espera y luego se acepta', async () => {
      const cuerpo = await cuerpoInscripcion(e);

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: e.A.id,
        actorId: e.secretariaA.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'COMMIT',
        enviar: () => enviar(cuerpo, cookies.secretaria),
      });

      expect(esperoElBloqueo).toBe(true);
      expect(resultado.status, resultado.texto).toBe(201);
    });
  });

  describe('todo lo demás de la 005 es igual', () => {
    it('criterio 34: un cuerpo inválido responde 400 SOLICITUD_INVALIDA sin escribir', async () => {
      const respuesta = await enviar({ basura: true }, cookies.secretaria);

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([400, 'SOLICITUD_INVALIDA']);
      expect(await contarFilasDeInscripciones(e.A.id)).toMatchObject({ solicitudes_inscripcion: 0 });
    });

    it('criterio 34: una clase llena responde 409 SIN_CUPO y un DNI ya registrado, 409 DNI_YA_REGISTRADO, también desde recepción', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);
      const sinCupo = await enviar(await cuerpoInscripcion(e), cookies.secretaria);
      const existente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.miercoles.id] });
      const repetido = await enviar(
        await cuerpoInscripcion(e, { sobre: { alumno: { dni: existente.dni } } }),
        cookies.secretaria,
      );

      expect([sinCupo.status, codigoDeRespuesta(sinCupo)]).toEqual([409, 'SIN_CUPO']);
      expect([repetido.status, codigoDeRespuesta(repetido)]).toEqual([409, 'DNI_YA_REGISTRADO']);
    });

    it('criterio 34: la misma clave de idempotencia con el mismo cuerpo desde recepción responde lo mismo que en la 005 (409 SOLICITUD_YA_REGISTRADA con el código; no crea otra solicitud)', async () => {
      const cuerpo = await cuerpoInscripcion(e);

      const primera = await enviar(cuerpo, cookies.secretaria);
      const segunda = await enviar(cuerpo, cookies.secretaria);

      expect(primera.status, primera.texto).toBe(201);
      // Criterio 23 de la 005: el reintento responde 409 SOLICITUD_YA_REGISTRADA con `detalles.codigo` (el código de la solicitud, nunca el token).
      expect([segunda.status, codigoDeRespuesta(segunda)], segunda.texto).toEqual([409, 'SOLICITUD_YA_REGISTRADA']);
      expect(detallesDeRespuesta(segunda)).toEqual({ codigo: solicitudDe(primera).codigo });
      expect(await contarFilasDeInscripciones(e.A.id)).toMatchObject({ solicitudes_inscripcion: 1, alumnos: 1 });
    });

    it('criterio 34: con correo del alumno, el aviso de seguimiento se envía una vez, después de confirmar, también desde recepción', async () => {
      const respuesta = await enviar(
        await cuerpoInscripcion(e, { sobre: { alumno: { correo: 'alumno.nuevo@ejemplo.test' } } }),
        cookies.secretaria,
      );

      expect(respuesta.status, respuesta.texto).toBe(201);
      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(correo.mensajes).toHaveLength(1);
      expect(correo.mensajes[0]).toMatchObject({
        para: 'alumno.nuevo@ejemplo.test',
        plantilla: 'SEGUIMIENTO_SOLICITUD',
      });
    });
  });
});

describe('la foto desde recepción (criterio 35)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeEach(async () => {
    e = await crearEscenarioDePagos();
    ctx = await crearAppConAlmacen({ conLimites: true, ahora: AHORA_007 });
    exigirAlmacen(ctx);
    cookies = cookiesDePagos(e);
  });
  afterEach(async () => {
    await ctx?.cerrarTodo();
  });

  it('criterio 35: una subida con la sesión de recepción no cuenta en la regla foto: con las 10 subidas por hora agotadas por anónimos, la secretaria sube la foto (204) y el anónimo sigue recibiendo 429', async () => {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    for (let i = 0; i < 10; i++) await subirFoto(ctx, 'academia-a', { token: 'A'.repeat(43), tipo: 'image/gif' });
    const anonimo = await subirFoto(ctx, 'academia-a', { token: cliente.token, cuerpo: png(100, 100) });
    expect([anonimo.status, codigoDeRespuesta(anonimo)]).toEqual([429, 'DEMASIADAS_SOLICITUDES']);

    const recepcion = await subirFotoValida(ctx, 'academia-a', cliente.token, {
      headers: { cookie: cookies.secretaria },
    });

    expect(recepcion.status, recepcion.texto).toBe(204);
    const otraVez = await subirFoto(ctx, 'academia-a', { token: cliente.token, cuerpo: png(100, 100) });
    expect(otraVez.status).toBe(429);
  });

  it('criterio 35: la recepción tampoco gasta el contador: 12 subidas con la sesión no impiden que un anónimo suba 10', async () => {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
    for (let i = 0; i < 12; i++) {
      const respuesta = await subirFotoValida(ctx, 'academia-a', cliente.token, {
        headers: { cookie: cookies.secretaria },
      });
      expect(respuesta.status, `recepción ${i + 1}`).toBe(204);
    }

    const estados: number[] = [];
    for (let i = 0; i < 10; i++) estados.push((await subirFotoValida(ctx, 'academia-a', cliente.token)).status);

    expect(estados.filter((estado) => estado === 429)).toEqual([]);
    expect((await subirFotoValida(ctx, 'academia-a', cliente.token)).status).toBe(429);
  });

  it('criterio 35: todo lo demás del criterio 34 de 005 es igual: la sesión no reemplaza al token (sin el token, el mismo 404) ni abre otra academia', async () => {
    const cliente = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });

    const sinToken = await subirFoto(ctx, 'academia-a', {
      cuerpo: png(100, 100),
      headers: { cookie: cookies.secretaria },
    });
    const deOtraAcademia = await subirFoto(ctx, 'academia-b', {
      token: cliente.token,
      cuerpo: png(100, 100),
      headers: { cookie: cookies.secretaria },
    });
    const tipoMalo = await subirFoto(ctx, 'academia-a', {
      token: cliente.token,
      tipo: 'image/gif',
      headers: { cookie: cookies.secretaria },
    });

    expect(sinToken.status, sinToken.texto).toBe(404);
    expect(deOtraAcademia.status, deOtraAcademia.texto).toBe(404);
    expect([tipoMalo.status, codigoDeRespuesta(tipoMalo)]).toEqual([400, 'IMAGEN_NO_VALIDA']);
  });
});
