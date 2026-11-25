// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { cerrarCajaDePrueba } from '../../utilidades/caja';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  type EscenarioPagos,
  exigirRutasDePagos,
} from '../../utilidades/escenario-pagos';
import {
  exigirRutasDe007b,
  rutaAprobacion,
  rutaRechazo,
  sembrarEnVerificacion,
  type SolicitudConPago,
} from '../../utilidades/escenario-pagos-007b';
import {
  type AppInscripciones,
  crearAppInscripciones,
  EnviadorDePrueba,
  leerMatriculas,
} from '../../utilidades/inscripciones';
import { dejarPasarEventos } from '../../utilidades/inscripciones-ronda1';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 51 b (crítico, HU-09, D-08, D-19, DR-13 de 005): con `EnviadorCorreo` y `enviarSinEsperar`, después de confirmar la transacción, una vez por cada destinatario distinto entre el correo del alumno y, si es menor, el de su apoderado,
// con los datos actuales del alumno (DR-8): al rechazar, plantilla `PAGO_RECHAZADO`, con el código, el motivo y la indicación de entrar con su enlace o con el código y su DNI para subir otro comprobante. No lleva el enlace (el token no se
// guarda). Ningún correo lleva el DNI ni el token. Si la transacción falla o es un reintento (200), no se envía nada. La respuesta no espera al correo, y un fallo se registra solo con el tipo del error (criterios 51 y 52 de 005).
// Criterio 51 a, parte de la aprobación (crítico): al aprobar un pago, plantilla `PAGO_CONFIRMADO` (nombre de la academia, código, dirección de ingreso y el aviso del usuario y la contraseña iniciales), una vez por destinatario, y nada en un 200 repetido.

const { destino, lineas } = crearDestinoDeRegistro();

describe('correo de pago rechazado y de pago aprobado (criterio 51, partes de la 007b)', () => {
  const correo = new EnviadorDePrueba();
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    // nestjs-pino crea un único registrador por proceso: el registro se inspecciona en la primera aplicación que crea este archivo.
    ctx = await crearAppInscripciones({ correo, nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_007);
    correo.mensajes.length = 0;
    correo.fallar = false;
    correo.alEnviar = undefined;
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const MOTIVO = 'La imagen no se lee, sube otra foto';
  const rechazar = (c: Pick<SolicitudConPago, 'pagoId'>, motivo = MOTIVO) =>
    ctx.http.post(rutaRechazo(c.pagoId), { motivo }, { cookie: cookies.secretaria });
  const aprobar = (c: Pick<SolicitudConPago, 'pagoId'>) =>
    ctx.http.post(rutaAprobacion(c.pagoId), {}, { cookie: cookies.secretaria });
  const ponerCorreo = (c: SolicitudConPago, direccion: string | null) =>
    ejecutarComo(
      'propietario',
      'UPDATE alumnos SET correo = $3 WHERE academia_id = $1::uuid AND id = $2::uuid',
      [e.A.id, c.alumnoId, direccion],
      { academiaId: e.A.id },
    );
  const ponerCorreoDelApoderado = (c: SolicitudConPago, direccion: string | null) =>
    ejecutarComo(
      'propietario',
      'UPDATE apoderados SET correo = $3 WHERE academia_id = $1::uuid AND alumno_id = $2::uuid',
      [e.A.id, c.alumnoId, direccion],
      { academiaId: e.A.id },
    );

  describe('el rechazo: plantilla PAGO_RECHAZADO', () => {
    it('criterio 51 b: con el correo del alumno, se envía una vez, con la plantilla PAGO_RECHAZADO, el código y el motivo', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await ponerCorreo(cliente, 'valeria.rechazada@ejemplo.test');

      const respuesta = await rechazar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(200);
      await esperarHasta(() => correo.mensajes.length >= 1);
      await dejarPasarEventos();
      expect(correo.mensajes).toHaveLength(1);
      const [mensaje] = correo.mensajes;
      expect(mensaje).toMatchObject({
        academiaId: e.A.id,
        para: 'valeria.rechazada@ejemplo.test',
        plantilla: 'PAGO_RECHAZADO',
      });
      const valores = Object.values(mensaje?.datos ?? {});
      expect(
        valores.some((v) => v.includes(cliente.codigo)),
        'el código viaja en los datos',
      ).toBe(true);
      expect(
        valores.some((v) => v.includes(MOTIVO)),
        'el motivo viaja en los datos',
      ).toBe(true);
    });

    it('criterio 51 b: ningún correo lleva el DNI, el token ni su hash, ni el enlace de seguimiento (el token no se guarda)', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await ponerCorreo(cliente, 'valeria.rechazada@ejemplo.test');

      const respuesta = await rechazar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(200);
      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(correo.mensajes, 'el rechazo envía el correo').toHaveLength(1);
      const texto = JSON.stringify(correo.mensajes);
      expect(texto).not.toContain(cliente.dni);
      expect(texto).not.toContain(cliente.token);
      expect(texto).not.toMatch(/\$argon2/);
      expect(texto, 'el correo no lleva el enlace de seguimiento').not.toContain('/solicitud/');
    });

    it('criterio 51 b: un menor con correo propio y correo del apoderado: dos mensajes, uno a cada destinatario', async () => {
      const cliente = await sembrarEnVerificacion(e, { conApoderado: true, fechaNacimiento: '2014-03-10' });
      await ponerCorreo(cliente, 'menor@ejemplo.test');
      await ponerCorreoDelApoderado(cliente, 'apoderado@ejemplo.test');

      await rechazar(cliente);

      await esperarHasta(() => correo.mensajes.length >= 2);
      await dejarPasarEventos();
      expect(correo.mensajes.map((m) => m.para).sort()).toEqual(['apoderado@ejemplo.test', 'menor@ejemplo.test']);
      expect(correo.mensajes.every((m) => m.plantilla === 'PAGO_RECHAZADO')).toBe(true);
    });

    it('criterio 51 b: un menor sin correo propio y con correo del apoderado: un mensaje al apoderado; con el mismo correo en los dos, uno solo; un mayor de edad ignora el correo de un apoderado guardado', async () => {
      const sinPropio = await sembrarEnVerificacion(e, { conApoderado: true, fechaNacimiento: '2014-03-10' });
      await ponerCorreoDelApoderado(sinPropio, 'apoderado@ejemplo.test');
      const igual = await sembrarEnVerificacion(e, { conApoderado: true, fechaNacimiento: '2014-03-10' });
      await ponerCorreo(igual, 'familia@ejemplo.test');
      await ponerCorreoDelApoderado(igual, 'familia@ejemplo.test');
      const mayor = await sembrarEnVerificacion(e, { conApoderado: true, fechaNacimiento: '1995-05-20' });
      await ponerCorreo(mayor, 'mayor@ejemplo.test');
      await ponerCorreoDelApoderado(mayor, 'apoderado.viejo@ejemplo.test');

      await rechazar(sinPropio);
      await rechazar(igual);
      await rechazar(mayor);

      await esperarHasta(() => correo.mensajes.length >= 3);
      await dejarPasarEventos();
      expect(correo.mensajes.map((m) => m.para).sort()).toEqual([
        'apoderado@ejemplo.test',
        'familia@ejemplo.test',
        'mayor@ejemplo.test',
      ]);
    });

    it('criterio 51 b: sin ningún correo no se envía nada y el rechazo se acepta igual; se usan los datos actuales del alumno (el correo que cambió después)', async () => {
      const sinCorreo = await sembrarEnVerificacion(e);
      const conCambio = await sembrarEnVerificacion(e);
      await ponerCorreo(conCambio, 'viejo@ejemplo.test');
      await ponerCorreo(conCambio, 'nuevo@ejemplo.test');

      const a = await rechazar(sinCorreo);
      const b = await rechazar(conCambio);

      expect([a.status, b.status]).toEqual([200, 200]);
      await esperarHasta(() => correo.mensajes.length >= 1);
      await dejarPasarEventos();
      expect(correo.mensajes.map((m) => m.para)).toEqual(['nuevo@ejemplo.test']);
    });
  });

  describe('después de confirmar, y solo si se confirma', () => {
    it('criterio 51 b: cuando el enviador recibe el mensaje, el pago RECHAZADO y la matrícula CANCELADA ya están guardados y visibles', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await ponerCorreo(cliente, 'valeria.rechazada@ejemplo.test');
      let visto: { pago: string; matricula: string } | undefined;
      correo.alEnviar = async () => {
        visto = {
          pago: (await leerPagos(e.A.id))[0]?.estado ?? '',
          matricula: (await leerMatriculas(e.A.id))[0]?.estado ?? '',
        };
      };

      const respuesta = await rechazar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(200);
      await esperarHasta(() => visto !== undefined);
      expect(visto).toEqual({ pago: 'RECHAZADO', matricula: 'CANCELADA' });
    });

    it('criterio 51 b: si el rechazo falla (pago ya confirmado, 409; motivo inválido, 400; pago que no existe, 404) no se envía ningún correo', async () => {
      await abrirCajaDeHoy(e);
      const confirmado = await sembrarEnVerificacion(e);
      await ponerCorreo(confirmado, 'confirmada@ejemplo.test');
      expect((await aprobar(confirmado)).status).toBe(200);
      await esperarHasta(() => correo.mensajes.length >= 1);
      correo.mensajes.length = 0;
      const pendiente = await sembrarEnVerificacion(e);
      await ponerCorreo(pendiente, 'pendiente@ejemplo.test');

      const yaConfirmado = await rechazar(confirmado);
      const motivoMalo = await rechazar(pendiente, 'ab');
      const inexistente = await rechazar({ pagoId: '00000000-0000-4000-8000-000000000999' });

      expect([yaConfirmado.status, motivoMalo.status, inexistente.status]).toEqual([409, 400, 404]);
      expect(codigoDeRespuesta(yaConfirmado)).toBe('PAGO_YA_CONFIRMADO');
      await dejarPasarEventos();
      expect(correo.mensajes).toEqual([]);
    });

    it('criterio 51 b: un segundo rechazo del mismo pago (200 como está) no vuelve a enviar nada', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await ponerCorreo(cliente, 'valeria.rechazada@ejemplo.test');
      const primero = await rechazar(cliente);
      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(primero.status).toBe(200);

      const repetido = await rechazar(cliente, 'Otro motivo');

      expect(repetido.status).toBe(200);
      await dejarPasarEventos();
      expect(correo.mensajes).toHaveLength(1);
    });

    it('criterio 51 b: la respuesta no espera al correo: con un enviador que no termina, el rechazo responde 200 de todos modos', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await ponerCorreo(cliente, 'valeria.rechazada@ejemplo.test');
      let soltar: () => void = () => undefined;
      correo.alEnviar = () => new Promise<void>((resolver) => (soltar = resolver));

      const respuesta = await rechazar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(200);
      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(correo.mensajes, 'el enviador recibió el mensaje y sigue sin terminar').toHaveLength(1);
      soltar();
    });

    it('criterio 51 b: si el correo falla, el rechazo sigue siendo 200 y queda guardado, y el fallo se registra como aviso o error sin el destinatario, el DNI, el token ni el mensaje del proveedor', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await ponerCorreo(cliente, 'destino.reservado@ejemplo.test');
      correo.fallar = true;
      const antes = lineas.length;

      const respuesta = await rechazar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((await leerPagos(e.A.id))[0]?.estado).toBe('RECHAZADO');
      await esperarHasta(() => lineas.slice(antes).some((linea) => /"level":(40|50)/.test(linea)));
      const nuevas = lineas.slice(antes);
      expect(
        nuevas.some((linea) => /"level":(40|50)/.test(linea)),
        'el fallo del correo queda registrado',
      ).toBe(true);
      const texto = nuevas.join('\n');
      expect(texto).not.toContain('destino.reservado@ejemplo.test');
      expect(texto).not.toContain(cliente.dni);
      expect(texto).not.toContain(cliente.token);
      expect(texto).not.toContain('El proveedor de correo falló');
    });
  });

  describe('la aprobación: plantilla PAGO_CONFIRMADO (criterio 51 a)', () => {
    let cajaId: string;
    beforeEach(async () => {
      cajaId = (await abrirCajaDeHoy(e)).id;
    });

    it('criterio 51 a: al aprobar se envía una vez PAGO_CONFIRMADO con el nombre de la academia, el código y la dirección de ingreso; sin el DNI ni el token', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await ponerCorreo(cliente, 'valeria.aprobada@ejemplo.test');

      const respuesta = await aprobar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(200);
      await esperarHasta(() => correo.mensajes.length >= 1);
      await dejarPasarEventos();
      expect(correo.mensajes).toHaveLength(1);
      expect(correo.mensajes[0]).toMatchObject({
        academiaId: e.A.id,
        para: 'valeria.aprobada@ejemplo.test',
        plantilla: 'PAGO_CONFIRMADO',
      });
      const valores = Object.values(correo.mensajes[0]?.datos ?? {});
      expect(valores.some((v) => v.includes('Academia A'))).toBe(true);
      expect(valores.some((v) => v.includes(cliente.codigo))).toBe(true);
      expect(valores.some((v) => v.includes('/a/academia-a/ingresar'))).toBe(true);
      const texto = JSON.stringify(correo.mensajes);
      expect(texto).not.toContain(cliente.dni);
      expect(texto).not.toContain(cliente.token);
    });

    it('criterio 51 a: un menor con correo propio y del apoderado recibe dos mensajes; una aprobación repetida (200) y una aprobación que falla (sin caja) no envían nada', async () => {
      const cliente = await sembrarEnVerificacion(e, { conApoderado: true, fechaNacimiento: '2014-03-10' });
      await ponerCorreo(cliente, 'menor@ejemplo.test');
      await ponerCorreoDelApoderado(cliente, 'apoderado@ejemplo.test');
      const otro = await sembrarEnVerificacion(e);
      await ponerCorreo(otro, 'otra@ejemplo.test');
      const primera = await aprobar(cliente);
      expect(primera.status, primera.texto).toBe(200);
      await esperarHasta(() => correo.mensajes.length >= 2);
      await cerrarCajaDePrueba(e.A.id, cajaId, e.secretariaA.id);

      const repetida = await aprobar(cliente);
      const sinCaja = await aprobar(otro);

      expect(repetida.status).toBe(200);
      expect([sinCaja.status, codigoDeRespuesta(sinCaja)]).toEqual([409, 'SIN_CAJA_ABIERTA']);
      await dejarPasarEventos();
      expect(correo.mensajes.map((m) => m.para).sort()).toEqual(['apoderado@ejemplo.test', 'menor@ejemplo.test']);
      expect(correo.mensajes.every((m) => m.plantilla === 'PAGO_CONFIRMADO')).toBe(true);
    });
  });
});
