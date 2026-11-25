// spec: 008-carnet-qr (pruebas protegidas)
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cerrarCajaDePrueba, crearCajaDePrueba } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { AHORA_007, cookiesDePagos, cuerpoCobro, rutaCobro, sembrarCobrable } from '../../utilidades/escenario-pagos';
import {
  rutaAprobacion,
  rutaRechazo,
  sembrarEnVerificacion,
  sembrarRechazada,
} from '../../utilidades/escenario-pagos-007b';
import {
  type AppCarnet,
  cambiarAlumno,
  codigoDeRespuesta,
  crearAppCarnet,
  crearAlumnoPorPago,
  type EscenarioDelCarnet,
  FORMATO_TOKEN_QR,
  instantaneaDelCarnet,
  fijarQr,
  leerQr,
  leerQrs,
  prepararEscenarioDelCarnet,
} from '../../utilidades/escenario-carnet';
import { leerAlumnos, leerSolicitudes } from '../../utilidades/inscripciones';
import { sembrarEnMasa } from '../../utilidades/inscripciones-005b';
import { crearUsuarioDePrueba, leerUsuarioPorDni, leerUsuarios } from '../../utilidades/usuarios';

// Criterio 2 (crítico, RN-05, HU-04, 4.1): en la transacción de `confirmarPagoEnTransaccion` en la que el alumno pasa de `CLIENTE` a `ALUMNO_ACTIVO`, la misma sentencia que cambia el estado guarda un token nuevo en `qr_token` y «ahora» en
// `qr_generado_en`. Vale para el cobro en efectivo y para la aprobación de un Yape o una transferencia. Si la transacción se revierte (caja cerrada, `DNI_DEL_PERSONAL`, error de la base), el alumno sigue en `CLIENTE` sin token. Un reintento
// del cobro (200, criterio 17 de 007) o la aprobación repetida (criterio 48 de 007) no cambian el token. Una confirmación de un alumno que ya tiene cuenta (renovación, 010) no toca el token. Un cliente `PENDIENTE_PAGO`, `EN_VERIFICACION`,
// `PAGO_RECHAZADO`, `VENCIDA` o `CANCELADA` no tiene token.
// Criterio 3 (crítico, RN-06, 8.6): los tokens de 200 alumnos confirmados en la misma prueba son todos distintos, cumplen `^[A-Za-z0-9_-]{43}$`, ninguno contiene el DNI, el id del alumno, el de su usuario ni el código de la solicitud, y ninguno es
// igual al token de seguimiento de su solicitud. (Las funciones `contenidoQr` y `tokenDelContenidoQr`, en `packages/contratos/src/carnet-protegido.test.ts`.)
// Ambigüedad (lectura estricta): «el token de seguimiento» de las solicitudes sembradas en masa no existe en claro (solo su hash): para ellas se comprueba que el token del QR no es el hash ni su forma hexadecimal o base64url.

describe('el QR nace con el pago confirmado (criterios 2 y 3)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const cobrar = (
    solicitudId: string,
    cuerpo: Record<string, unknown> = cuerpoCobro('42.00'),
    cookie = esc.cookies.secretaria,
  ) => ctx.http.post(rutaCobro(solicitudId), cuerpo, { cookie });
  const aprobar = (pagoId: string, cookie = esc.cookies.secretaria) =>
    ctx.http.post(rutaAprobacion(pagoId), {}, { cookie });

  describe('criterio 2: al confirmar el pago', () => {
    it('criterio 2: el cobro en efectivo deja al alumno en ALUMNO_ACTIVO con un token nuevo de 43 caracteres y «ahora» como fecha, y sin clave de idempotencia', async () => {
      const cliente = await sembrarCobrable(esc.e);
      expect((await leerQr(esc.e.A.id, cliente.alumnoId)).qr_token, 'antes del pago, sin token').toBeNull();

      const respuesta = await cobrar(cliente.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(201);
      const fila = await leerQr(esc.e.A.id, cliente.alumnoId);
      expect(fila.estado).toBe('ALUMNO_ACTIVO');
      expect(fila.qr_token).toMatch(FORMATO_TOKEN_QR);
      expect(fila.qr_generado_en?.getTime(), 'qr_generado_en es «ahora» (RELOJ)').toBe(AHORA_007.getTime());
      expect(
        fila.qr_clave_idempotencia,
        'la clave de idempotencia es de la regeneración, no del nacimiento',
      ).toBeNull();
    });

    it('criterio 2: la aprobación de un Yape también (y la de una transferencia)', async () => {
      const yape = await sembrarEnVerificacion(esc.e, { metodo: 'YAPE' });
      const transferencia = await sembrarEnVerificacion(esc.e, { metodo: 'TRANSFERENCIA' });

      const a = await aprobar(yape.pagoId);
      const b = await aprobar(transferencia.pagoId);

      expect([a.status, b.status], `${a.texto} | ${b.texto}`).toEqual([200, 200]);
      for (const cliente of [yape, transferencia]) {
        const fila = await leerQr(esc.e.A.id, cliente.alumnoId);
        expect(fila.estado).toBe('ALUMNO_ACTIVO');
        expect(fila.qr_token).toMatch(FORMATO_TOKEN_QR);
        expect(fila.qr_generado_en?.getTime()).toBe(AHORA_007.getTime());
      }
      const tokens = (await leerQrs(esc.e.A.id)).map((f) => f.qr_token);
      expect(new Set(tokens).size, 'dos alumnos, dos tokens distintos').toBe(2);
    });

    it('criterio 2: «ahora» es el reloj de la aplicación: la aprobación de un Yape a las 19:00 de Lima del último día del mes (ya es 1/12 en UTC) guarda esa fecha', async () => {
      const tarde = new Date('2026-12-01T00:00:00.000Z');
      const cliente = await sembrarEnVerificacion(esc.e, { ahora: tarde });
      // La caja de hoy es la del 11/11: se cierra y se abre la del día de la aprobación (30/11 en Lima).
      await cerrarCajaDePrueba(esc.e.A.id, esc.cajaA, esc.e.secretariaA.id);
      await crearCajaDePrueba(esc.e.A.id, esc.e.secretariaA.id, {
        fecha: '2026-11-30',
        abierta_en: new Date('2026-11-30T13:00:00.000Z'),
      });
      ctx.reloj.fijar(tarde);

      const respuesta = await aprobar(cliente.pagoId, cookiesDePagos(esc.e, tarde).secretaria);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const fila = await leerQr(esc.e.A.id, cliente.alumnoId);
      expect(fila.qr_token).toMatch(FORMATO_TOKEN_QR);
      expect(fila.qr_generado_en?.getTime()).toBe(tarde.getTime());
    });

    it('criterio 2: el alumno de B recibe su token en B; el de A no cambia', async () => {
      const deA = await crearAlumnoPorPago(ctx, esc);
      const tokenA = (await leerQr(esc.e.A.id, deA.alumnoId)).qr_token;

      const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });

      const tokenB = (await leerQr(esc.e.B.id, deB.alumnoId)).qr_token;
      expect(tokenB).toMatch(FORMATO_TOKEN_QR);
      expect(tokenB).not.toBe(tokenA);
      expect((await leerQr(esc.e.A.id, deA.alumnoId)).qr_token).toBe(tokenA);
    });

    it('criterio 2: cinco cobros simultáneos dejan cinco tokens distintos', async () => {
      const clientes = [];
      for (let i = 0; i < 5; i += 1) clientes.push(await sembrarCobrable(esc.e));

      const respuestas = await Promise.all(clientes.map((c) => cobrar(c.solicitudId)));

      for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto).toBe(201);
      const tokens = (await leerQrs(esc.e.A.id)).map((f) => f.qr_token);
      expect(tokens.every((t) => t !== null && FORMATO_TOKEN_QR.test(t))).toBe(true);
      expect(new Set(tokens).size).toBe(5);
    });
  });

  describe('criterio 2: si la confirmación se revierte, el alumno sigue en CLIENTE sin token', () => {
    it('criterio 2: con la caja cerrada, el cobro responde 409 SIN_CAJA_ABIERTA y no queda token', async () => {
      await cerrarCajaDePrueba(esc.e.A.id, esc.cajaA, esc.e.secretariaA.id);
      const cliente = await sembrarCobrable(esc.e);
      const antes = await instantaneaDelCarnet(esc.e);

      const respuesta = await cobrar(cliente.solicitudId);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SIN_CAJA_ABIERTA']);
      const fila = await leerQr(esc.e.A.id, cliente.alumnoId);
      expect(fila).toMatchObject({
        estado: 'CLIENTE',
        qr_token: null,
        qr_generado_en: null,
        qr_clave_idempotencia: null,
      });
      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    });

    it('criterio 2: con la caja cerrada, la aprobación de un Yape responde 409 y no queda token', async () => {
      const cliente = await sembrarEnVerificacion(esc.e);
      await cerrarCajaDePrueba(esc.e.A.id, esc.cajaA, esc.e.secretariaA.id);
      const antes = await instantaneaDelCarnet(esc.e);

      const respuesta = await aprobar(cliente.pagoId);

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(await leerQr(esc.e.A.id, cliente.alumnoId)).toMatchObject({
        estado: 'CLIENTE',
        qr_token: null,
        qr_generado_en: null,
      });
      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    });

    it('criterio 2: con el DNI de un usuario del personal, el cobro responde 409 DNI_DEL_PERSONAL y no queda token', async () => {
      const cliente = await sembrarCobrable(esc.e);
      await crearUsuarioDePrueba({ academiaId: esc.e.A.id, rol: 'ENTRENADOR', dni: cliente.dni });
      const antes = await instantaneaDelCarnet(esc.e);

      const respuesta = await cobrar(cliente.solicitudId);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'DNI_DEL_PERSONAL']);
      expect(await leerQr(esc.e.A.id, cliente.alumnoId)).toMatchObject({
        estado: 'CLIENTE',
        qr_token: null,
        qr_generado_en: null,
      });
      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    });

    it('criterio 2: un monto distinto del mostrado responde 409 y no queda token', async () => {
      const cliente = await sembrarCobrable(esc.e);

      const respuesta = await cobrar(cliente.solicitudId, cuerpoCobro('41.00'));

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect((await leerQr(esc.e.A.id, cliente.alumnoId)).qr_token).toBeNull();
    });
  });

  describe('criterio 2: reintentos y confirmaciones repetidas no cambian el token', () => {
    it('criterio 2: el reintento del cobro con la misma clave responde 200 y deja el mismo token y la misma fecha', async () => {
      const cliente = await sembrarCobrable(esc.e);
      const cuerpo = cuerpoCobro('42.00');
      const primero = await cobrar(cliente.solicitudId, cuerpo);
      expect(primero.status, primero.texto).toBe(201);
      const antes = await leerQr(esc.e.A.id, cliente.alumnoId);
      ctx.reloj.avanzar(60 * 60 * 1000);

      const reintento = await cobrar(cliente.solicitudId, cuerpo);

      expect(reintento.status, reintento.texto).toBe(200);
      const despues = await leerQr(esc.e.A.id, cliente.alumnoId);
      expect(despues.qr_token).toBe(antes.qr_token);
      expect(despues.qr_generado_en?.getTime()).toBe(antes.qr_generado_en?.getTime());
    });

    it('criterio 2: aprobar dos veces el mismo Yape responde 200 las dos y deja el mismo token y la misma fecha', async () => {
      const cliente = await sembrarEnVerificacion(esc.e);
      const primera = await aprobar(cliente.pagoId);
      expect(primera.status, primera.texto).toBe(200);
      const antes = await leerQr(esc.e.A.id, cliente.alumnoId);
      ctx.reloj.avanzar(60 * 60 * 1000);

      const segunda = await aprobar(cliente.pagoId, esc.cookies.admin);

      expect(segunda.status, segunda.texto).toBe(200);
      const despues = await leerQr(esc.e.A.id, cliente.alumnoId);
      expect(despues.qr_token).toBe(antes.qr_token);
      expect(despues.qr_generado_en?.getTime()).toBe(antes.qr_generado_en?.getTime());
    });

    it('criterio 2: dos cobros simultáneos con la misma clave dejan un solo token', async () => {
      const cliente = await sembrarCobrable(esc.e);
      const cuerpo = cuerpoCobro('42.00');

      const [uno, otro] = await Promise.all([
        cobrar(cliente.solicitudId, cuerpo),
        cobrar(cliente.solicitudId, cuerpo, esc.cookies.admin),
      ]);

      expect([uno.status, otro.status].sort(), `${uno.texto} | ${otro.texto}`).toEqual([200, 201]);
      const fila = await leerQr(esc.e.A.id, cliente.alumnoId);
      expect(fila.qr_token).toMatch(FORMATO_TOKEN_QR);
      expect(fila.qr_generado_en?.getTime()).toBe(AHORA_007.getTime());
    });

    it('criterio 2 (renovación, 010): la confirmación de un alumno que ya tiene cuenta y token no toca el token ni su fecha', async () => {
      const cliente = await sembrarCobrable(esc.e, { estadoAlumno: 'ALUMNO_ACTIVO' });
      const cuenta = await crearUsuarioDePrueba({ academiaId: esc.e.A.id, rol: 'ALUMNO', dni: cliente.dni });
      await cambiarAlumno(esc.e.A.id, cliente.alumnoId, { usuario_id: cuenta.id });
      const tokenConocido = 'T'.repeat(43);
      const fechaConocida = new Date('2026-10-05T15:00:00.000Z');
      await fijarQr(esc.e.A.id, cliente.alumnoId, { token: tokenConocido, generadoEn: fechaConocida });

      const respuesta = await cobrar(cliente.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(201);
      const despues = await leerQr(esc.e.A.id, cliente.alumnoId);
      expect(despues.qr_token, 'el token que ya tenía').toBe(tokenConocido);
      expect(despues.qr_generado_en?.getTime(), 'la fecha que ya tenía').toBe(fechaConocida.getTime());
    });
  });

  describe('criterio 2: un cliente que no pagó no tiene token', () => {
    it.each([
      ['PENDIENTE_PAGO', { estado: 'PENDIENTE_PAGO' as const }],
      ['PENDIENTE_PAGO con la reserva vencida (se ve VENCIDA)', { estado: 'PENDIENTE_PAGO_VENCIDA' as const }],
      ['VENCIDA', { estado: 'VENCIDA' as const }],
      ['CANCELADA', { estado: 'CANCELADA' as const }],
    ])('criterio 2: un cliente %s no tiene token', async (_nombre, opciones) => {
      const cliente = await sembrarCobrable(esc.e, opciones);

      const fila = await leerQr(esc.e.A.id, cliente.alumnoId);

      expect(fila).toMatchObject({
        estado: 'CLIENTE',
        qr_token: null,
        qr_generado_en: null,
        qr_clave_idempotencia: null,
      });
    });

    it('criterio 2: un cliente EN_VERIFICACION (comprobante enviado) no tiene token', async () => {
      const cliente = await sembrarEnVerificacion(esc.e);

      expect(await leerQr(esc.e.A.id, cliente.alumnoId)).toMatchObject({
        estado: 'CLIENTE',
        qr_token: null,
        qr_generado_en: null,
      });
    });

    it('criterio 2: un cliente PAGO_RECHAZADO no tiene token, ni sembrado ni después de rechazarlo por la API', async () => {
      const sembrado = await sembrarRechazada(esc.e);
      const enRevision = await sembrarEnVerificacion(esc.e);

      const rechazo = await ctx.http.post(
        rutaRechazo(enRevision.pagoId),
        { motivo: 'La imagen no se lee' },
        { cookie: esc.cookies.secretaria },
      );

      expect(rechazo.status, rechazo.texto).toBe(200);
      for (const cliente of [sembrado, enRevision]) {
        expect(await leerQr(esc.e.A.id, cliente.alumnoId)).toMatchObject({
          estado: 'CLIENTE',
          qr_token: null,
          qr_generado_en: null,
        });
      }
    });

    it('criterio 2 y 1: la base no deja a un CLIENTE con token ni por una escritura directa (RN-05)', async () => {
      const cliente = await sembrarCobrable(esc.e);

      await expect(
        fijarQr(esc.e.A.id, cliente.alumnoId, { token: 'A'.repeat(43), generadoEn: AHORA_007 }),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('criterio 2: la auditoría de la confirmación no cambia: el cobro sigue auditando PAGO_REGISTRADO y USUARIO_CREADO (el token no es una acción nueva)', async () => {
      const cliente = await sembrarCobrable(esc.e);

      await cobrar(cliente.solicitudId);

      const acciones = (await leerAuditoriaDeAcademia(esc.e.A.id)).map((fila) => fila.accion).sort();
      expect(acciones).toContain('PAGO_REGISTRADO');
      expect(acciones).toContain('USUARIO_CREADO');
      expect(
        acciones.filter((a) => /CARNET|QR/i.test(a)),
        'nacer con el pago no audita CARNET_QR_REGENERADO',
      ).toEqual([]);
    });
  });

  describe('criterio 3: el token es aleatorio y no lleva datos', () => {
    it('criterio 3: 200 alumnos confirmados dan 200 tokens distintos, de 43 caracteres de base64url, sin el DNI, el id del alumno, el de su usuario, el código de la solicitud ni el hash de su token de seguimiento', async () => {
      const total = 200;
      const solicitudesIds = await sembrarEnMasa(esc.e.A.id, {
        planId: esc.e.plan.id,
        claseId: esc.e.lunes.id,
        cantidad: total,
        estado: 'PENDIENTE_PAGO',
        base: AHORA_007,
        reservaVenceEn: new Date(AHORA_007.getTime() + 24 * 60 * 60 * 1000),
      });
      expect(solicitudesIds).toHaveLength(total);

      for (let desde = 0; desde < total; desde += 10) {
        const lote = solicitudesIds.slice(desde, desde + 10);
        const respuestas = await Promise.all(lote.map((id) => cobrar(id, cuerpoCobro('120.00'))));
        for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto).toBe(201);
      }

      const alumnos = (await leerAlumnos(esc.e.A.id)).filter((a) => a.estado === 'ALUMNO_ACTIVO');
      expect(alumnos).toHaveLength(total);
      const solicitudes = await leerSolicitudes(esc.e.A.id);
      const usuarios = await leerUsuarios(esc.e.A.id);
      const qrs = new Map((await leerQrs(esc.e.A.id)).map((fila) => [fila.id, fila]));
      const tokens: string[] = [];
      for (const alumno of alumnos) {
        const token = qrs.get(alumno.id)?.qr_token;
        expect(token, `el alumno ${alumno.id} debía tener token`).toMatch(FORMATO_TOKEN_QR);
        const dato = token as string;
        tokens.push(dato);
        const solicitud = solicitudes.find((s) => s.alumno_id === alumno.id);
        const usuario = usuarios.find((u) => u.dni === alumno.dni);
        const minusculas = dato.toLowerCase();
        expect(dato, 'no lleva el DNI').not.toContain(alumno.dni);
        expect(minusculas, 'no lleva el id del alumno').not.toContain(alumno.id.toLowerCase());
        expect(minusculas, 'no lleva el id del alumno sin guiones').not.toContain(
          alumno.id.replaceAll('-', '').toLowerCase(),
        );
        expect(usuario?.id, 'el alumno tiene su cuenta').toBeTruthy();
        expect(minusculas, 'no lleva el id de su usuario').not.toContain((usuario?.id as string).toLowerCase());
        expect(minusculas, 'no lleva el id de su usuario sin guiones').not.toContain(
          (usuario?.id as string).replaceAll('-', '').toLowerCase(),
        );
        expect(dato.toLowerCase(), 'no lleva el código de la solicitud').not.toContain(
          (solicitud?.codigo as string).toLowerCase(),
        );
        const hash = solicitud?.token_hash as Buffer;
        expect(dato, 'no es el hash del token de seguimiento').not.toBe(hash.toString('base64url'));
        expect(dato, 'no contiene el hash en hexadecimal').not.toContain(hash.toString('hex'));
      }
      expect(new Set(tokens).size, 'los 200 tokens son distintos').toBe(total);
      // No hay un patrón fijo: en cada posición (menos la última, que solo lleva 4 bits) aparecen varios caracteres distintos.
      for (let posicion = 0; posicion < 42; posicion += 1) {
        const distintos = new Set(tokens.map((token) => token.charAt(posicion)));
        expect(distintos.size, `la posición ${posicion} de los tokens varía`).toBeGreaterThanOrEqual(8);
      }
    }, 300_000);

    it('criterio 3: ningún token es igual al token de seguimiento de su solicitud ni lo contiene, ni es derivado de él', async () => {
      const clientes = [];
      for (let i = 0; i < 8; i += 1) clientes.push(await sembrarCobrable(esc.e));

      for (const cliente of clientes) {
        const respuesta = await cobrar(cliente.solicitudId);
        expect(respuesta.status, respuesta.texto).toBe(201);
      }

      for (const cliente of clientes) {
        const token = (await leerQr(esc.e.A.id, cliente.alumnoId)).qr_token as string;
        expect(token).toMatch(FORMATO_TOKEN_QR);
        expect(token, 'no es el token de seguimiento').not.toBe(cliente.token);
        expect(token, 'no contiene el token de seguimiento').not.toContain(cliente.token);
        expect(token, 'no contiene el código de la solicitud').not.toContain(cliente.codigo);
        expect(token, 'no es el hash del token de seguimiento').not.toBe(
          createHash('sha256').update(cliente.token).digest('base64url'),
        );
        expect(token.toLowerCase()).not.toContain(cliente.alumnoId.replaceAll('-', '').toLowerCase());
        expect(token).not.toContain(cliente.dni);
        const usuario = await leerUsuarioPorDni(esc.e.A.id, cliente.dni);
        expect(token.toLowerCase()).not.toContain((usuario?.id as string).replaceAll('-', '').toLowerCase());
      }
    });
  });
});
