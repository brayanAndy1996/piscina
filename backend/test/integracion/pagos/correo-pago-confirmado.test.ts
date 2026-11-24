// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  crearAppInscripciones,
  EnviadorDePrueba,
  leerSolicitudes,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { dejarPasarEventos } from '../../utilidades/inscripciones-ronda1';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 51 a (crítico, HU-09, D-08, D-19, DR-13 de 005): con `EnviadorCorreo` y `enviarSinEsperar`, después de confirmar la transacción, una vez por cada destinatario distinto entre el correo del alumno y, si es
// menor, el de su apoderado (DR-13 de 005), con los datos actuales del alumno (DR-8): al confirmar un pago (efectivo): plantilla `PAGO_CONFIRMADO`, con el nombre de la academia, el código, la dirección de ingreso
// (`/a/{nombreCorto}/ingresar`) y el aviso de que el usuario y la contraseña inicial son su DNI y que debe cambiarla al entrar. Ningún correo lleva el DNI ni el token. Si la transacción falla o es un reintento (200),
// no se envía nada. La respuesta no espera al correo, y un fallo se registra solo con el tipo del error (criterios 51 y 52 de 005). (El correo de rechazo, `PAGO_RECHAZADO`, es de la 007b.)

const { destino, lineas } = crearDestinoDeRegistro();

describe('correo de pago confirmado (criterio 51 a)', () => {
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
    cookies = cookiesDePagos(e);
    await abrirCajaDeHoy(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const cobrar = (c: SolicitudSembrada, monto = '42.00') =>
    ctx.http.post(rutaCobro(c.solicitudId), { ...cuerpoCobro(monto) }, { cookie: cookies.secretaria });
  const ponerCorreo = (c: SolicitudSembrada, direccion: string | null) =>
    ejecutarComo(
      'propietario',
      'UPDATE alumnos SET correo = $3 WHERE academia_id = $1::uuid AND id = $2::uuid',
      [e.A.id, c.alumnoId, direccion],
      {
        academiaId: e.A.id,
      },
    );
  const ponerCorreoDelApoderado = (c: SolicitudSembrada, direccion: string | null) =>
    ejecutarComo(
      'propietario',
      'UPDATE apoderados SET correo = $3 WHERE academia_id = $1::uuid AND alumno_id = $2::uuid',
      [e.A.id, c.alumnoId, direccion],
      {
        academiaId: e.A.id,
      },
    );

  describe('el mensaje', () => {
    it('criterio 51 a: con el correo del alumno, se envía una vez, después de confirmar, con la plantilla PAGO_CONFIRMADO, el nombre de la academia, el código y la dirección de ingreso', async () => {
      const cliente = await sembrarCobrable(e);
      await ponerCorreo(cliente, 'valeria.reservada@ejemplo.test');

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(correo.mensajes).toHaveLength(1);
      const [mensaje] = correo.mensajes;
      expect(mensaje).toMatchObject({
        academiaId: e.A.id,
        para: 'valeria.reservada@ejemplo.test',
        plantilla: 'PAGO_CONFIRMADO',
      });
      const valores = Object.values(mensaje?.datos ?? {});
      expect(
        valores.some((v) => v.includes('Academia A')),
        'el nombre de la academia viaja en los datos',
      ).toBe(true);
      expect(
        valores.some((v) => v.includes(cliente.codigo)),
        'el código viaja en los datos',
      ).toBe(true);
      expect(
        valores.some((v) => v.includes('/a/academia-a/ingresar')),
        'la dirección de ingreso viaja en los datos',
      ).toBe(true);
    });

    it('criterio 51 a: ningún correo lleva el DNI ni el token ni el hash (el DNI es el usuario, pero solo se dice «tu DNI»)', async () => {
      const cliente = await sembrarCobrable(e);
      await ponerCorreo(cliente, 'valeria.reservada@ejemplo.test');

      await cobrar(cliente);

      await esperarHasta(() => correo.mensajes.length >= 1);
      const texto = JSON.stringify(correo.mensajes);
      expect(texto).not.toContain(cliente.dni);
      expect(texto).not.toContain(cliente.token);
      expect(texto).not.toMatch(/\$argon2/);
    });

    it('criterio 51 a: la dirección de ingreso es la de la academia del cobro (la de B lleva /a/academia-b/ingresar)', async () => {
      // Misma plantilla, otra academia: el nombre corto sale de la academia del alumno.
      const cliente = await sembrarCobrable(e);
      await ponerCorreo(cliente, 'otra.persona@ejemplo.test');

      await cobrar(cliente);

      await esperarHasta(() => correo.mensajes.length >= 1);
      const valores = Object.values(correo.mensajes[0]?.datos ?? {}).join(' ');
      expect(valores).toContain('/a/academia-a/ingresar');
      expect(valores).not.toContain('academia-b');
    });
  });

  describe('los destinatarios: una vez por cada distinto entre el alumno y, si es menor, su apoderado (DR-13 de 005)', () => {
    it('criterio 51 a: un menor con correo propio y correo del apoderado: dos mensajes, uno a cada destinatario', async () => {
      const cliente = await sembrarCobrable(e, { conApoderado: true, fechaNacimiento: '2014-03-10' });
      await ponerCorreo(cliente, 'menor@ejemplo.test');
      await ponerCorreoDelApoderado(cliente, 'apoderado@ejemplo.test');

      await cobrar(cliente);

      await esperarHasta(() => correo.mensajes.length >= 2);
      expect(correo.mensajes.map((m) => m.para).sort()).toEqual(['apoderado@ejemplo.test', 'menor@ejemplo.test']);
      expect(correo.mensajes.every((m) => m.plantilla === 'PAGO_CONFIRMADO')).toBe(true);
    });

    it('criterio 51 a: un menor sin correo propio y con correo del apoderado: un mensaje al apoderado', async () => {
      const cliente = await sembrarCobrable(e, { conApoderado: true, fechaNacimiento: '2014-03-10' });
      await ponerCorreoDelApoderado(cliente, 'apoderado@ejemplo.test');

      await cobrar(cliente);

      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(correo.mensajes.map((m) => m.para)).toEqual(['apoderado@ejemplo.test']);
    });

    it('criterio 51 a: un menor cuyo correo y el del apoderado son el mismo recibe un solo mensaje (destinatarios distintos)', async () => {
      const cliente = await sembrarCobrable(e, { conApoderado: true, fechaNacimiento: '2014-03-10' });
      await ponerCorreo(cliente, 'familia@ejemplo.test');
      await ponerCorreoDelApoderado(cliente, 'familia@ejemplo.test');

      await cobrar(cliente);

      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(correo.mensajes.map((m) => m.para)).toEqual(['familia@ejemplo.test']);
    });

    it('criterio 51 a: un mayor de edad solo recibe el suyo: el correo de un apoderado que quedó guardado no cuenta', async () => {
      const cliente = await sembrarCobrable(e, { conApoderado: true, fechaNacimiento: '1995-05-20' });
      await ponerCorreo(cliente, 'mayor@ejemplo.test');
      await ponerCorreoDelApoderado(cliente, 'apoderado.viejo@ejemplo.test');

      await cobrar(cliente);

      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(correo.mensajes.map((m) => m.para)).toEqual(['mayor@ejemplo.test']);
    });

    it('criterio 51 a: sin ningún correo no se envía nada y el cobro se acepta igual', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      await dejarPasarEventos();
      expect(correo.mensajes).toEqual([]);
    });

    it('criterio 51 a: se usan los datos actuales del alumno: el correo que cambió después de enviar el formulario es el que recibe el aviso', async () => {
      const cliente = await sembrarCobrable(e);
      await ponerCorreo(cliente, 'viejo@ejemplo.test');
      await ponerCorreo(cliente, 'nuevo@ejemplo.test');

      await cobrar(cliente);

      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(correo.mensajes.map((m) => m.para)).toEqual(['nuevo@ejemplo.test']);
    });
  });

  describe('solo después de confirmar y solo si se confirma', () => {
    it('criterio 51 a: cuando el enviador recibe el mensaje, el pago, la cuenta y el movimiento ya están guardados y visibles', async () => {
      const cliente = await sembrarCobrable(e);
      await ponerCorreo(cliente, 'valeria.reservada@ejemplo.test');
      let visto: { pagos: number; solicitudes: string } | undefined;
      correo.alEnviar = async () => {
        visto = {
          pagos: (await leerPagos(e.A.id)).length,
          solicitudes: (await leerSolicitudes(e.A.id))[0]?.estado ?? '',
        };
      };

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      await esperarHasta(() => visto !== undefined);
      expect(visto).toEqual({ pagos: 1, solicitudes: 'CONFIRMADA' });
    });

    it('criterio 51 a: si el cobro se rechaza (409 por el monto, por la caja o por el estado) no se envía ningún correo', async () => {
      const cliente = await sembrarCobrable(e);
      await ponerCorreo(cliente, 'valeria.reservada@ejemplo.test');
      const vencida = await sembrarCobrable(e, { estado: 'PENDIENTE_PAGO_VENCIDA' });
      await ponerCorreo(vencida, 'otra.persona@ejemplo.test');

      const monto = await cobrar(cliente, '41.00');
      const estado = await cobrar(vencida);

      expect([monto.status, estado.status]).toEqual([409, 409]);
      await dejarPasarEventos();
      expect(correo.mensajes).toEqual([]);
    });

    it('criterio 51 a: un reintento con la misma clave (200) no vuelve a enviar nada', async () => {
      const cliente = await sembrarCobrable(e);
      await ponerCorreo(cliente, 'valeria.reservada@ejemplo.test');
      const cuerpo = cuerpoCobro('42.00');
      const primero = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpo, { cookie: cookies.secretaria });
      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(primero.status).toBe(201);

      const repetido = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpo, { cookie: cookies.secretaria });

      expect(repetido.status).toBe(200);
      await dejarPasarEventos();
      expect(correo.mensajes).toHaveLength(1);
    });

    it('criterio 51 a: la respuesta no espera al correo: con un enviador que no termina, el cobro responde 201 de todos modos', async () => {
      const cliente = await sembrarCobrable(e);
      await ponerCorreo(cliente, 'valeria.reservada@ejemplo.test');
      let soltar: () => void = () => undefined;
      correo.alEnviar = () => new Promise<void>((resolver) => (soltar = resolver));

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      await esperarHasta(() => correo.mensajes.length >= 1);
      expect(correo.mensajes, 'el enviador recibió el mensaje y sigue sin terminar').toHaveLength(1);
      soltar();
    });
  });

  describe('si el correo falla', () => {
    it('criterio 51 a: la respuesta sigue siendo 201, el pago queda confirmado y el fallo se registra como aviso o error, sin el destinatario, el DNI, el token ni el mensaje del proveedor', async () => {
      const cliente = await sembrarCobrable(e);
      await ponerCorreo(cliente, 'destino.reservado@ejemplo.test');
      correo.fallar = true;
      const antes = lineas.length;

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await leerPagos(e.A.id)).toHaveLength(1);
      await esperarHasta(() => lineas.slice(antes).some((linea) => /"level":(40|50)/.test(linea)));
      const nuevas = lineas.slice(antes);
      expect(
        nuevas.some((linea) => /"level":(40|50)/.test(linea)),
        'el fallo del correo queda registrado como aviso o error',
      ).toBe(true);
      const texto = nuevas.join('\n');
      expect(texto).not.toContain('destino.reservado@ejemplo.test');
      expect(texto).not.toContain(cliente.dni);
      expect(texto).not.toContain(cliente.token);
      expect(texto).not.toContain('El proveedor de correo falló');
    });
  });
});
