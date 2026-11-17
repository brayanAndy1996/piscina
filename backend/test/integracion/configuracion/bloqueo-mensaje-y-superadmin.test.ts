import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RelojFijo } from '../../../src/infraestructura/reloj';
import { fijarConfiguracion, MINUTO } from '../../utilidades/configuracion';
import { leerSuperadmin } from '../../utilidades/datos';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  leerUsuario,
  pedir,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Spec 003, criterio 18 (el bloqueo del Superadmin no cambia con la configuración de ninguna academia) y criterio 19 (el mensaje del 423
// de las rutas de academia dice cuántos minutos faltan, calculados con `bloqueado_hasta` y `RELOJ`, hacia arriba y como mínimo 1).
// Pruebas de integración no protegidas: las de integración protegidas comprueban el código y el estado, no el texto.

const CLAVE_EQUIVOCADA = 'clave-equivocada-123';

describe('criterios 18 y 19: bloqueo del Superadmin y mensaje del 423', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let e: Escenario;
  let cuenta: UsuarioDePrueba;

  beforeEach(async () => {
    e = await crearEscenario();
    cuenta = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', clave: CLAVE_COMUN });
    ({ app, reloj } = await crearAppConReloj());
  });
  afterEach(async () => {
    await app?.close();
  });

  const ingresar = (clave: string) =>
    pedir(app, 'post', '/api/a/academia-a/sesion', { cuerpo: { usuario: cuenta.dni, clave } });
  const mensajeDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).mensaje;

  describe('criterio 19: minutos que faltan en el mensaje', () => {
    it('con 30 minutos de bloqueo, el 3.º fallo dice 30 minutos y el mensaje baja con el reloj, redondeado hacia arriba', async () => {
      await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
      await ingresar(CLAVE_EQUIVOCADA);
      await ingresar(CLAVE_EQUIVOCADA);

      const tercero = await ingresar(CLAVE_EQUIVOCADA);
      expect(tercero.status).toBe(423);
      expect(mensajeDe(tercero)).toContain('30 minutos');

      reloj.avanzar(10 * MINUTO);
      expect(mensajeDe(await ingresar(CLAVE_COMUN))).toContain('20 minutos');
      reloj.avanzar(MINUTO + 1);
      expect(mensajeDe(await ingresar(CLAVE_EQUIVOCADA))).toContain('19 minutos');
      reloj.avanzar(18 * MINUTO);
      expect(mensajeDe(await ingresar(CLAVE_COMUN))).toMatch(/\b1 minuto\b(?!s)/);
      reloj.avanzar(29_999);
      const ultimo = await ingresar(CLAVE_COMUN);
      expect(ultimo.status).toBe(423);
      expect(mensajeDe(ultimo)).toMatch(/\b1 minuto\b(?!s)/);
    });

    it('con los valores por defecto, el 5.º fallo dice 15 minutos', async () => {
      await ingresar(CLAVE_EQUIVOCADA);
      await ingresar(CLAVE_EQUIVOCADA);
      await ingresar(CLAVE_EQUIVOCADA);
      await ingresar(CLAVE_EQUIVOCADA);

      const quinto = await ingresar(CLAVE_EQUIVOCADA);

      expect(quinto.status).toBe(423);
      expect(mensajeDe(quinto)).toContain('15 minutos');
    });

    it('cambiar los minutos de bloqueo con la cuenta bloqueada no cambia lo que falta (sale de bloqueado_hasta)', async () => {
      await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
      for (let i = 0; i < 3; i++) await ingresar(CLAVE_EQUIVOCADA);
      const bloqueadoHasta = (await leerUsuario(e.A.id, cuenta.id))?.bloqueado_hasta?.toISOString();
      expect(bloqueadoHasta).toBe(new Date(AHORA_PRUEBAS.getTime() + 30 * MINUTO).toISOString());

      await fijarConfiguracion(e.A.id, { minutosBloqueo: 5, intentosInicioSesion: 10 });
      reloj.avanzar(5 * MINUTO);
      const respuesta = await ingresar(CLAVE_COMUN);

      expect(respuesta.status).toBe(423);
      expect(mensajeDe(respuesta)).toContain('25 minutos');
      expect((await leerUsuario(e.A.id, cuenta.id))?.bloqueado_hasta?.toISOString()).toBe(bloqueadoHasta);
    });

    it('el cambio de contraseña con la cuenta bloqueada también dice los minutos que faltan', async () => {
      await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 20 });
      const cookie = await (async () => {
        const entrada = await ingresar(CLAVE_COMUN);
        expect(entrada.status).toBe(200);
        return (entrada.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0] ?? '';
      })();
      for (let i = 0; i < 3; i++) {
        const fallo = await pedir(app, 'post', '/api/sesion/clave', {
          cookie,
          cuerpo: { claveActual: CLAVE_EQUIVOCADA, claveNueva: 'Una-Clave-Nueva-2026' },
        });
        expect(fallo.status).toBe(i < 2 ? 400 : 423);
        if (i === 2) expect(mensajeDe(fallo)).toContain('20 minutos');
      }
      reloj.avanzar(4 * MINUTO + 1);

      const bloqueada = await pedir(app, 'post', '/api/sesion/clave', {
        cookie,
        cuerpo: { claveActual: CLAVE_COMUN, claveNueva: 'Una-Clave-Nueva-2026' },
      });

      expect(bloqueada.status).toBe(423);
      expect(mensajeDe(bloqueada)).toContain('16 minutos');
    });
  });

  describe('criterio 18: el bloqueo del Superadmin es fijo', () => {
    it('con intentosInicioSesion 3 y minutosBloqueo 30 en una academia, el Superadmin se bloquea al 5.º fallo por 15 minutos', async () => {
      await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
      const fallar = () =>
        request(app.getHttpServer())
          .post('/api/plataforma/sesion')
          .send({ correo: e.superadmin.correo, clave: CLAVE_EQUIVOCADA });

      for (let i = 1; i <= 4; i++) {
        const respuesta = await fallar();
        expect(respuesta.status, `intento ${i}`).toBe(401);
      }
      const quinto = await fallar();

      expect(quinto.status).toBe(423);
      expect((quinto.body as ErrorCuerpo).codigo).toBe('CUENTA_BLOQUEADA');
      expect((await leerSuperadmin(e.superadmin.id))?.bloqueado_hasta?.toISOString()).toBe(
        new Date(AHORA_PRUEBAS.getTime() + 15 * MINUTO).toISOString(),
      );
    });
  });
});
