// spec: 005-inscripcion-publica (pruebas protegidas)
// Actualizada por la 007 (spec 007-pagos, criterio 29 y «Pruebas protegidas anteriores que amplía la 007a»): `CLAVES_DEL_ELEMENTO` suma `ajuste` y `pago`.
// No se quitó ni se cambió nada más.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  type AppInscripciones,
  AHORA_005,
  camposConError,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  IP_RE,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  llenarClase,
  type Objeto,
  ocupacionDeClase,
  type RespuestaApi,
  rutaPublica,
  sembrarSolicitud,
  sinUuid,
  type SolicitudSembrada,
  solicitudDe,
} from '../../utilidades/inscripciones';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  contarAuditoria,
  cookieDeUsuario,
  fijarEstadoDeAcademia,
  type RolUsuario,
} from '../../utilidades/usuarios';

// Criterio 39 (crítico, RN-22, RN-28, DT-5 de 002; PB2 y PB12), cancelar una solicitud: `POST /api/solicitudes/{id}/cancelar` con `{ motivo }` (3 a 200
// caracteres visibles) y el permiso REGISTRAR_INSCRIPCION_Y_COBRO (ADMIN y SECRETARIA). Orden de comprobaciones: sesión → academia activa → cambio
// obligatorio → permiso → cuerpo (400 aunque el id tampoco sirva) → operación. Una solicitud de fila PENDIENTE_PAGO con estado visible PENDIENTE_PAGO o
// VENCIDA pasa a CANCELADA y su matrícula (si está RESERVADA) a CANCELADA con `reserva_vence_en = NULL`, las dos con `actualizado_en` igual a "ahora": el
// cupo se libera en ese momento. Una ya CANCELADA (fila o estado visible) responde 200 sin escribir ni auditar; cualquier otra fila (la VENCIDA del
// criterio 21 b), 409 SOLICITUD_NO_CANCELABLE `{ codigo, mensaje }` sin escribir ni auditar; un id que no existe, de otra academia o que no es UUID,
// 404 NO_ENCONTRADO. Responde 200 con `{ solicitud }` (el mismo elemento de la lista, con `estado: 'CANCELADA'` y `reservaVenceEn: null`).
// Auditoría SOLICITUD_INSCRIPCION_CANCELADA: entidad solicitud_inscripcion, entidadId, actor USUARIO con el id de quien cancela, `motivo` recortado, la IP,
// `datosAntes: { estado }` con el estado visible de antes y `datosDespues: { estado: 'CANCELADA' }`; nada más. Sin aviso al cliente (DR-17) y sin tocar la
// foto (DR-18): ver `panel-solicitudes-cancelar-foto.test.ts`. Carreras: `panel-solicitudes-cancelar-carreras.test.ts`.

const ACCION = 'SOLICITUD_INSCRIPCION_CANCELADA';
const MOTIVO = 'Pidió que la cancelen por teléfono';
const CLAVES_DEL_ELEMENTO = [
  'ajuste',
  'apellidos',
  'clases',
  'clasesTotales',
  'codigo',
  'creadaEn',
  'dni',
  'estado',
  'id',
  'menorDeEdad',
  'mes',
  'monto',
  'nombres',
  'pago',
  'plan',
  'reservaVenceEn',
  'telefono',
];

describe('cancelar una solicitud (criterio 39)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  const cookies = {} as Record<RolUsuario, string>;
  let activa: SolicitudSembrada;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ ahora: AHORA_005 });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
    cookies.ADMIN = cookieDeUsuario(e.adminA, AHORA_005);
    cookies.SECRETARIA = cookieDeUsuario(e.secretariaA, AHORA_005);
    cookies.ENTRENADOR = cookieDeUsuario(e.entrenadorA, AHORA_005);
    cookies.ALUMNO = cookieDeUsuario(e.alumnoA, AHORA_005);
    activa = await sembrar();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const sembrar = (opciones: Partial<Parameters<typeof sembrarSolicitud>[1]> = {}) =>
    sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
      ...opciones,
    });
  const cancelar = (id: string, cuerpo: unknown = { motivo: MOTIVO }, cookie = cookies.ADMIN): Promise<RespuestaApi> =>
    ctx.http.post(`/api/solicitudes/${id}/cancelar`, cuerpo, { cookie });
  const lista = (query = '?estado=TODAS') => ctx.http.get(`/api/solicitudes${query}`, { cookie: cookies.ADMIN });

  /** Todo lo que un rechazo no puede cambiar: las siete tablas de A y de B y la auditoría de las dos. */
  async function estado() {
    return {
      a: await instantaneaDeInscripciones(e.A.id),
      b: await instantaneaDeInscripciones(e.B.id),
      auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
      auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
    };
  }

  describe('permisos y orden de comprobaciones', () => {
    it.each(['ADMIN', 'SECRETARIA'] as const)(
      'criterio 39: %s de A cancela una solicitud activa: 200 con Cache-Control: no-store',
      async (rol) => {
        const respuesta = await cancelar(activa.solicitudId, { motivo: MOTIVO }, cookies[rol]);

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(respuesta.cacheControl).toBe('no-store');
      },
    );

    it.each(['ENTRENADOR', 'ALUMNO'] as const)(
      'criterio 39: %s recibe 403 SIN_PERMISO sin escribir ni auditar, aun con un cuerpo inválido',
      async (rol) => {
        const antes = await estado();

        for (const cuerpo of [{ motivo: MOTIVO }, {}, { motivo: 'x' }]) {
          const respuesta = await cancelar(activa.solicitudId, cuerpo, cookies[rol]);
          expect(respuesta.status, rol).toBe(403);
          expect(codigoDe(respuesta), rol).toBe('SIN_PERMISO');
        }
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 39: sin sesión, 401 NO_AUTENTICADO, aun con un cuerpo inválido; el Superadmin (aq_plataforma) también recibe 401', async () => {
      const control = await sembrar();
      expect((await cancelar(control.solicitudId)).status, 'control: el ADMIN sí puede cancelar').toBe(200);
      const antes = await estado();

      const sin = await ctx.http.post(`/api/solicitudes/${activa.solicitudId}/cancelar`, { motivo: MOTIVO });
      const sinCuerpo = await ctx.http.post(`/api/solicitudes/${activa.solicitudId}/cancelar`, {});
      const superadmin = await cancelar(
        activa.solicitudId,
        { motivo: MOTIVO },
        cookieDeSesion(e.superadmin, AHORA_005),
      );

      for (const respuesta of [sin, sinCuerpo, superadmin]) {
        expect(respuesta.status, respuesta.texto).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
      }
      expect(await estado()).toEqual(antes);
    });

    it('criterio 39: con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso y el cuerpo', async () => {
      const control = await sembrar();
      expect((await cancelar(control.solicitudId)).status, 'control: el ADMIN sí puede cancelar').toBe(200);
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(e.A.id, e.entrenadorA.id, { debe_cambiar_clave: true });
      const antes = await estado();

      for (const rol of ['SECRETARIA', 'ENTRENADOR'] as const) {
        const respuesta = await cancelar(activa.solicitudId, {}, cookies[rol]);
        expect(respuesta.status, rol).toBe(403);
        expect(codigoDe(respuesta), rol).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
      }
      expect(await estado()).toEqual(antes);
    });

    it('criterio 39: con A suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso', async () => {
      const control = await sembrar();
      expect((await cancelar(control.solicitudId)).status, 'control: el ADMIN sí puede cancelar').toBe(200);
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });
      const antes = await estado();

      for (const rol of ['ADMIN', 'SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const) {
        const respuesta = await cancelar(activa.solicitudId, { motivo: MOTIVO }, cookies[rol]);
        expect(respuesta.status, rol).toBe(403);
        expect(codigoDe(respuesta), rol).toBe('ACADEMIA_SUSPENDIDA');
      }
      expect(await estado()).toEqual(antes);
    });
  });

  describe('cuerpo (400 antes que el id)', () => {
    const MALOS: [string, unknown][] = [
      ['sin motivo', {}],
      ['con el motivo vacío', { motivo: '' }],
      ['con el motivo de 2 caracteres', { motivo: 'ab' }],
      ['con 3 caracteres que no son visibles', { motivo: '   \t ' }],
      ['con un motivo de 201 caracteres', { motivo: 'a'.repeat(201) }],
      ['con un salto de línea', { motivo: 'Dos\nlíneas' }],
      ['con un separador de línea Unicode', { motivo: 'Dos líneas' }],
      ['con un carácter de control', { motivo: 'Con\u0000nulo' }],
      ['con un carácter bidireccional', { motivo: 'Texto‮invertido' }],
      ['con el motivo que no es un texto', { motivo: 123 }],
      ['con un campo de más (academiaId)', { motivo: MOTIVO, academiaId: '00000000-0000-4000-8000-000000000000' }],
      ['con un campo de más (estado)', { motivo: MOTIVO, estado: 'CANCELADA' }],
      ['que es un arreglo', []],
    ];

    it.each(MALOS)(
      'criterio 39: un cuerpo %s responde 400 SOLICITUD_INVALIDA sin escribir ni auditar',
      async (_nombre, cuerpo) => {
        const antes = await estado();

        const respuesta = await cancelar(activa.solicitudId, cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(['motivo', '']).toContain(camposConError(respuesta)[0]);
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 39: el cuerpo se valida antes que el id: con un id que no es UUID, que no existe o que es de B, un cuerpo inválido responde 400, no 404', async () => {
      const deB = await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });
      const antes = await estado();

      for (const id of ['no-es-un-uuid', '00000000-0000-4000-8000-000000000000', deB.solicitudId]) {
        const respuesta = await cancelar(id, { motivo: 'x' });
        expect(respuesta.status, `${id}: ${respuesta.texto}`).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
      }
      expect(await estado()).toEqual(antes);
    });

    it('criterio 39: un JSON roto responde 400 y no escribe nada', async () => {
      const antes = await estado();

      const respuesta = await ctx.http.post(`/api/solicitudes/${activa.solicitudId}/cancelar`, undefined, {
        cookie: cookies.ADMIN,
        crudo: '{"motivo": ',
      });

      expect(respuesta.status).toBe(400);
      expect(await estado()).toEqual(antes);
    });

    it.each([3, 200])('criterio 39: un motivo de %i caracteres visibles se acepta (los bordes)', async (largo) => {
      const respuesta = await cancelar(activa.solicitudId, { motivo: 'a'.repeat(largo) });

      expect(respuesta.status, respuesta.texto).toBe(200);
      const [fila] = await leerAuditoriaDeAcademia(e.A.id, ACCION);
      expect(fila?.motivo).toBe('a'.repeat(largo));
    });

    it('criterio 39: el motivo se recorta (espacios en los extremos) antes de guardarse y de auditarse', async () => {
      const respuesta = await cancelar(activa.solicitudId, { motivo: `   ${MOTIVO}   ` });

      expect(respuesta.status, respuesta.texto).toBe(200);
      const [fila] = await leerAuditoriaDeAcademia(e.A.id, ACCION);
      expect(fila?.motivo).toBe(MOTIVO);
    });
  });

  describe('id que no existe o no es de la academia', () => {
    it('criterio 39 y 39 g: un id que no es UUID, que no existe o que es de B responden 404 NO_ENCONTRADO con el mismo cuerpo, y nada cambia (ni las filas ni la auditoría de B)', async () => {
      const deB = await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });
      const control = await sembrar();
      expect((await cancelar(control.solicitudId)).status, 'control: el ADMIN sí puede cancelar').toBe(200);
      const antes = await estado();
      const cuerpos = new Set<string>();

      for (const id of [
        'no-es-un-uuid',
        '123',
        '00000000-0000-4000-8000-000000000000',
        deB.solicitudId,
        e.B.id,
        activa.alumnoId,
      ]) {
        const respuesta = await cancelar(id);
        expect(respuesta.status, `${id}: ${respuesta.texto}`).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
        cuerpos.add(sinUuid(respuesta.texto));
      }

      expect([...cuerpos], 'los 404 no tienen todos el mismo cuerpo').toHaveLength(1);
      expect(await estado()).toEqual(antes);
      expect((await leerSolicitudes(e.B.id))[0]?.estado).toBe('PENDIENTE_PAGO');
      expect((await leerMatriculas(e.B.id))[0]?.estado).toBe('RESERVADA');
    });

    it('criterio 39 g: el ADMIN de B puede cancelar la solicitud de B pero no la de A', async () => {
      const deB = await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });
      const cookieB = cookieDeUsuario(e.adminB, AHORA_005);

      const aDeA = await cancelar(activa.solicitudId, { motivo: MOTIVO }, cookieB);
      const aDeB = await cancelar(deB.solicitudId, { motivo: MOTIVO }, cookieB);

      expect(aDeA.status).toBe(404);
      expect(aDeB.status).toBe(200);
      expect((await leerSolicitudes(e.A.id))[0]?.estado).toBe('PENDIENTE_PAGO');
    });
  });

  describe('cancelación de una solicitud activa', () => {
    it('criterio 39: pasa la solicitud y su matrícula a CANCELADA, con reserva_vence_en NULL y actualizado_en igual a "ahora", sin tocar nada más', async () => {
      const otra = await sembrar();
      const alumnosAntes = await leerAlumnos(e.A.id);
      const filaOtra = (await leerSolicitudes(e.A.id)).find((s) => s.id === otra.solicitudId);
      const matriculaOtra = (await leerMatriculas(e.A.id)).find((m) => m.id === otra.matriculaId);
      const antesDeB = await instantaneaDeInscripciones(e.B.id);

      const respuesta = await cancelar(activa.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const solicitud = (await leerSolicitudes(e.A.id)).find((s) => s.id === activa.solicitudId);
      const matricula = (await leerMatriculas(e.A.id)).find((m) => m.id === activa.matriculaId);
      expect(solicitud?.estado).toBe('CANCELADA');
      expect(solicitud?.actualizado_en.toISOString()).toBe(AHORA_005.toISOString());
      expect(matricula?.estado).toBe('CANCELADA');
      expect(matricula?.reserva_vence_en).toBeNull();
      expect(matricula?.actualizado_en.toISOString()).toBe(AHORA_005.toISOString());
      // Lo demás queda igual: el alumno sigue como cliente, con sus datos y su foto, y la otra solicitud no cambia.
      expect(await leerAlumnos(e.A.id)).toEqual(alumnosAntes);
      expect((await leerSolicitudes(e.A.id)).find((s) => s.id === otra.solicitudId)).toEqual(filaOtra);
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === otra.matriculaId)).toEqual(matriculaOtra);
      expect(await instantaneaDeInscripciones(e.B.id)).toBe(antesDeB);
    });

    it('criterio 39: responde 200 con { solicitud }: el mismo elemento de la lista, con estado CANCELADA y reservaVenceEn null', async () => {
      const respuesta = await cancelar(activa.solicitudId);

      expect(Object.keys(respuesta.body ?? {})).toEqual(['solicitud']);
      const solicitud = respuesta.body?.['solicitud'] as Objeto;
      expect(Object.keys(solicitud).sort()).toEqual(CLAVES_DEL_ELEMENTO);
      expect(solicitud).toMatchObject({
        id: activa.solicitudId,
        codigo: activa.codigo,
        estado: 'CANCELADA',
        reservaVenceEn: null,
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        dni: activa.dni,
        mes: '2026-11',
        plan: { id: e.plan.id, nombre: e.plan.nombre },
      });
      const enLaLista = ((await lista()).body?.['solicitudes'] as Objeto[]).find((s) => s['id'] === activa.solicitudId);
      expect(solicitud).toEqual(enLaLista);
    });

    it('criterio 39: la solicitud cancelada sale de las activas y entra en las canceladas de la lista', async () => {
      await cancelar(activa.solicitudId);

      const activas = ((await lista('?estado=ACTIVAS')).body?.['solicitudes'] as Objeto[]).map((s) => s['id']);
      const canceladas = ((await lista('?estado=CANCELADAS')).body?.['solicitudes'] as Objeto[]).map((s) => s['id']);
      expect(activas).not.toContain(activa.solicitudId);
      expect(canceladas).toEqual([activa.solicitudId]);
    });

    it('criterio 39: la cancelación registra SOLICITUD_INSCRIPCION_CANCELADA con el actor USUARIO, la entidad, el motivo, la IP y los estados antes y después, sin datos personales', async () => {
      await cancelar(activa.solicitudId, { motivo: MOTIVO }, cookies.SECRETARIA);

      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION);
      expect(auditoria).toHaveLength(1);
      const fila = auditoria[0];
      expect(fila).toMatchObject({
        actor_tipo: 'USUARIO',
        actor_id: e.secretariaA.id,
        accion: ACCION,
        entidad: 'solicitud_inscripcion',
        entidad_id: activa.solicitudId,
        motivo: MOTIVO,
        datos_antes: { estado: 'PENDIENTE_PAGO' },
        datos_despues: { estado: 'CANCELADA' },
      });
      expect(fila?.ip).toMatch(IP_RE);
      expect(Object.keys(fila?.datos_antes as Objeto)).toEqual(['estado']);
      expect(Object.keys(fila?.datos_despues as Objeto)).toEqual(['estado']);
      const texto = JSON.stringify(fila);
      for (const secreto of [activa.dni, 'Valeria', 'Mendoza', activa.token, activa.codigo]) {
        expect(texto, `la auditoría lleva ${secreto}`).not.toContain(secreto);
      }
      expect(await contarAuditoria(e.A.id)).toBe(1);
      expect(await contarAuditoria(e.B.id)).toBe(0);
    });

    it('criterio 39 b: una solicitud vencida (fila PENDIENTE_PAGO con la reserva vencida) se cancela igual, con datosAntes.estado VENCIDA, y la matrícula queda CANCELADA con reserva_vence_en NULL', async () => {
      const vencida = await sembrar({ estado: 'PENDIENTE_PAGO_VENCIDA' });

      const respuesta = await cancelar(vencida.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((respuesta.body?.['solicitud'] as Objeto)['estado']).toBe('CANCELADA');
      const [fila] = await leerAuditoriaDeAcademia(e.A.id, ACCION);
      expect(fila?.datos_antes).toEqual({ estado: 'VENCIDA' });
      expect(fila?.datos_despues).toEqual({ estado: 'CANCELADA' });
      expect((await leerSolicitudes(e.A.id)).find((s) => s.id === vencida.solicitudId)?.estado).toBe('CANCELADA');
      const matricula = (await leerMatriculas(e.A.id)).find((m) => m.id === vencida.matriculaId);
      expect(matricula?.estado).toBe('CANCELADA');
      expect(matricula?.reserva_vence_en).toBeNull();
    });

    it('criterio 39: la reserva que vence en este mismo instante también se cancela (estado visible VENCIDA)', async () => {
      const justo = await sembrar({ reservaVenceEn: new Date(AHORA_005.getTime()) });

      const respuesta = await cancelar(justo.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const [fila] = await leerAuditoriaDeAcademia(e.A.id, ACCION);
      expect(fila?.datos_antes).toEqual({ estado: 'VENCIDA' });
    });

    it('criterio 39: una solicitud sin vencimiento (pago en verificación) se cancela con datosAntes.estado PENDIENTE_PAGO', async () => {
      const enVerificacion = await sembrar({ reservaVenceEn: null });

      const respuesta = await cancelar(enVerificacion.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const [fila] = await leerAuditoriaDeAcademia(e.A.id, ACCION);
      expect(fila?.datos_antes).toEqual({ estado: 'PENDIENTE_PAGO' });
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === enVerificacion.matriculaId)?.estado).toBe('CANCELADA');
    });
  });

  describe('decisión por el estado', () => {
    it('criterio 39: una solicitud ya CANCELADA responde 200 con la solicitud, sin escribir ni auditar; dos cancelaciones seguidas dejan una sola auditoría', async () => {
      const primera = await cancelar(activa.solicitudId);
      const despuesDeLaPrimera = await estado();

      const segunda = await cancelar(activa.solicitudId, { motivo: 'Otro motivo distinto' });

      expect([primera.status, segunda.status]).toEqual([200, 200]);
      expect((segunda.body?.['solicitud'] as Objeto)['estado']).toBe('CANCELADA');
      expect(await estado()).toEqual(despuesDeLaPrimera);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION)).toHaveLength(1);
    });

    it('criterio 39: una solicitud sembrada CANCELADA (fila y matrícula) responde 200 sin escribir ni auditar', async () => {
      const cancelada = await sembrar({ estado: 'CANCELADA' });
      const antes = await estado();

      const respuesta = await cancelar(cancelada.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((respuesta.body?.['solicitud'] as Objeto)['estado']).toBe('CANCELADA');
      expect(await estado()).toEqual(antes);
    });

    it('criterio 39: una fila PENDIENTE_PAGO cuya matrícula ya está CANCELADA (estado visible CANCELADA) responde 200 sin escribir ni auditar', async () => {
      await ejecutarComo(
        'propietario',
        "UPDATE matriculas SET estado = 'CANCELADA', reserva_vence_en = NULL WHERE academia_id = $1::uuid AND id = $2::uuid",
        [e.A.id, activa.matriculaId],
        { academiaId: e.A.id },
      );
      const antes = await estado();

      const respuesta = await cancelar(activa.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((respuesta.body?.['solicitud'] as Objeto)['estado']).toBe('CANCELADA');
      expect(await estado()).toEqual(antes);
    });

    it('criterio 39: la fila VENCIDA (la solicitud anterior de un cliente que volvió, criterio 21 b) responde 409 SOLICITUD_NO_CANCELABLE con { codigo, mensaje }, sin escribir ni auditar', async () => {
      const anterior = await sembrar({ estado: 'PENDIENTE_PAGO_VENCIDA' });
      const envio = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(e, { sobre: { alumno: { dni: anterior.dni } } }),
      );
      expect(envio.status, envio.texto).toBe(201);
      expect((await leerSolicitudes(e.A.id)).find((s) => s.id === anterior.solicitudId)?.estado).toBe('VENCIDA');
      const antes = await estado();

      const respuesta = await cancelar(anterior.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('SOLICITUD_NO_CANCELABLE');
      expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['codigo', 'mensaje']);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(await estado()).toEqual(antes);
      // La nueva solicitud del mismo cliente sí se puede cancelar.
      const nueva = (await leerSolicitudes(e.A.id)).find(
        (s) => s.id !== anterior.solicitudId && s.alumno_id === anterior.alumnoId,
      );
      expect((await cancelar(nueva?.id as string)).status).toBe(200);
    });

    it('criterio 39: la fila VENCIDA sembrada directamente responde 409 SOLICITUD_NO_CANCELABLE', async () => {
      const vencida = await sembrar({ estado: 'VENCIDA' });
      const antes = await estado();

      const respuesta = await cancelar(vencida.solicitudId);

      expect(respuesta.status).toBe(409);
      expect(codigoDe(respuesta)).toBe('SOLICITUD_NO_CANCELABLE');
      expect(await estado()).toEqual(antes);
    });
  });

  describe('el cupo se libera (a)', () => {
    it('criterio 39 a: una solicitud activa en una clase llena: después del 200 la ocupación de sus clases baja en 1, un envío por esa clase responde 201 (antes, 409 SIN_CUPO) y el seguimiento la muestra CANCELADA con la vista reducida', async () => {
      // 18 matrículas de relleno y la solicitud sembrada de `activa` (que también ocupa el lunes) dejan un solo cupo.
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 18);
      const envio = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));
      expect(envio.status, envio.texto).toBe(201);
      const creada = solicitudDe(envio);
      const mes = { anio: 2026, mes: 11 };
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_005)).toBe(20);
      const lleno = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));
      expect(lleno.status, 'antes de cancelar la clase está llena').toBe(409);
      expect(codigoDe(lleno)).toBe('SIN_CUPO');
      const filas = await leerSolicitudes(e.A.id);
      const idDeLaCreada = (filas.find((s) => s.codigo === creada.codigo) as { id: string }).id;

      const respuesta = await cancelar(idDeLaCreada);

      expect(respuesta.status, respuesta.texto).toBe(200);
      for (const clase of [e.lunes, e.miercoles, e.viernes]) {
        const antes = clase.id === e.lunes.id ? 20 : 2;
        expect(await ocupacionDeClase(e.A.id, clase.id, mes, AHORA_005), clase.id).toBe(antes - 1);
      }
      const libre = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));
      expect(libre.status, libre.texto).toBe(201);
      const seguimiento = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
        token: creada.token,
      });
      expect(seguimiento.status).toBe(200);
      const vista = seguimiento.body?.['solicitud'] as Objeto;
      expect(vista['estado']).toBe('CANCELADA');
      expect(Object.keys(vista).sort()).toEqual([
        'clases',
        'clasesTotales',
        'codigo',
        'creadaEn',
        'esProporcional',
        'estado',
        'mes',
        'monto',
        'plan',
      ]);
      expect(JSON.stringify(seguimiento.body)).not.toContain('Camila');
    });

    it('criterio 39 a y 25: la solicitud cancelada deja de contar en el límite de 5 reservas por conexión: con 5 activas desde la misma IP el sexto envío responde 409 LIMITE_DE_RESERVAS_PENDIENTES, y después de cancelar una, 201', async () => {
      const creadas: { codigo: string }[] = [];
      for (let i = 0; i < 5; i++) {
        const envio = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));
        expect(envio.status, envio.texto).toBe(201);
        creadas.push(solicitudDe(envio));
      }
      const sexta = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));
      expect(sexta.status, 'con 5 activas desde la misma conexión').toBe(409);
      expect(codigoDe(sexta)).toBe('LIMITE_DE_RESERVAS_PENDIENTES');
      const primera = (await leerSolicitudes(e.A.id)).find((s) => s.codigo === creadas[0]?.codigo);

      expect((await cancelar(primera?.id as string)).status).toBe(200);

      const otra = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));
      expect(otra.status, otra.texto).toBe(201);
    });

    it('criterio 39: el seguimiento por código y DNI de una solicitud cancelada muestra CANCELADA con la vista reducida, sin nombre', async () => {
      await cancelar(activa.solicitudId);

      const porCodigo = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
        codigo: activa.codigo,
        dni: activa.dni,
      });
      const porToken = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { token: activa.token });

      for (const respuesta of [porCodigo, porToken]) {
        expect(respuesta.status).toBe(200);
        const vista = respuesta.body?.['solicitud'] as Objeto;
        expect(vista['estado']).toBe('CANCELADA');
        expect('nombres' in vista).toBe(false);
        expect('fotoCargada' in vista).toBe(false);
        expect('reservaVenceEn' in vista).toBe(false);
      }
    });
  });
});
