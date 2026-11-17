// spec: 003-configuracion-academia (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RelojFijo } from '../../../src/infraestructura/reloj';
import { fijarConfiguracion, MINUTO } from '../../utilidades/configuracion';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cookieDeAcademia,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  leerUsuario,
  pedir,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 15 (crítico, D-07): cambiar los valores con cuentas a medias.
//   a) 3 fallos seguidos con los valores por defecto y el administrador pone `intentosInicioSesion` en 3: el siguiente fallo la bloquea
//      (el contador llega a 4, que alcanza el máximo); la clave correcta todavía entra (el bloqueo lo decide `bloqueado_hasta`).
//   b) bloqueada hasta T y el administrador cambia `minutosBloqueo` o `intentosInicioSesion`: sigue bloqueada hasta T exactamente.
//   c) bloqueada y se restablece su contraseña: queda desbloqueada (criterio 35 de 002).
// Cada prueba tiene su propia aplicación (con su límite por IP de 10 ingresos por minuto) y no pasa de 6 ingresos.

const CLAVE_EQUIVOCADA = 'clave-equivocada-123';
const QUINCE = 15 * MINUTO;

describe('criterio 15: cambiar los valores con cuentas a medias', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let e: Escenario;
  let cuenta: UsuarioDePrueba;
  let cookieAdmin: string;

  const ingresar = (usuario: string, clave: string) =>
    pedir(app, 'post', '/api/a/academia-a/sesion', { cuerpo: { usuario, clave } });
  const fallar = () => ingresar(cuenta.dni, CLAVE_EQUIVOCADA);
  const entrar = () => ingresar(cuenta.dni, CLAVE_COMUN);
  const fila = () => leerUsuario(e.A.id, cuenta.id);
  const configurar = (cuerpo: unknown) => pedir(app, 'patch', '/api/configuracion', { cookie: cookieAdmin, cuerpo });
  const codigoDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).codigo;
  const instante = (milisegundos: number) => new Date(AHORA_PRUEBAS.getTime() + milisegundos).toISOString();

  beforeEach(async () => {
    e = await crearEscenario();
    cuenta = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', clave: CLAVE_COMUN });
    cookieAdmin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    ({ app, reloj } = await crearAppConReloj());
  });
  afterEach(async () => {
    await app?.close();
  });

  describe('a) bajar el máximo de intentos por debajo de los fallos que ya tiene la cuenta', () => {
    it('criterio 15 a): con 3 fallos y los valores por defecto, al poner intentosInicioSesion en 3 el siguiente fallo responde 423, el contador llega a 4 y la cuenta queda bloqueada por 15 minutos', async () => {
      for (let i = 1; i <= 3; i++) expect((await fallar()).status, `intento ${i}`).toBe(401);
      expect((await fila())?.intentos_fallidos).toBe(3);

      const cambio = await configurar({ intentosInicioSesion: 3 });
      expect(cambio.status, JSON.stringify(cambio.body)).toBe(200);
      const siguiente = await fallar();

      expect(siguiente.status, JSON.stringify(siguiente.body)).toBe(423);
      expect(codigoDe(siguiente)).toBe('CUENTA_BLOQUEADA');
      const despues = await fila();
      expect(despues?.intentos_fallidos).toBe(4);
      expect(despues?.bloqueado_hasta?.toISOString()).toBe(instante(QUINCE));
    });

    it('criterio 15 a): con 3 fallos, al poner intentosInicioSesion en 3 la clave correcta todavía entra y deja el contador en 0 (el bloqueo lo decide bloqueado_hasta, no el contador)', async () => {
      for (let i = 1; i <= 3; i++) expect((await fallar()).status, `intento ${i}`).toBe(401);
      expect((await configurar({ intentosInicioSesion: 3 })).status).toBe(200);

      const respuesta = await entrar();

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(cookieDeAcademia(respuesta.headers)).toBeDefined();
      const despues = await fila();
      expect(despues?.intentos_fallidos).toBe(0);
      expect(despues?.bloqueado_hasta).toBeNull();
    });

    it('criterio 15 a): subir el máximo después de bajarlo no desbloquea a nadie y el nuevo valor vale desde ese momento', async () => {
      for (let i = 1; i <= 3; i++) await fallar();
      expect((await configurar({ intentosInicioSesion: 3 })).status).toBe(200);
      expect((await fallar()).status).toBe(423);
      const bloqueadaHasta = (await fila())?.bloqueado_hasta?.toISOString();

      expect((await configurar({ intentosInicioSesion: 10 })).status).toBe(200);
      const conClaveCorrecta = await entrar();

      expect(conClaveCorrecta.status).toBe(423);
      expect(codigoDe(conClaveCorrecta)).toBe('CUENTA_BLOQUEADA');
      expect((await fila())?.bloqueado_hasta?.toISOString()).toBe(bloqueadaHasta);
    });

    it('criterio 15 a): un cambio de minutosBloqueo vale para los bloqueos nuevos: una cuenta con 4 fallos que falla después de poner 5 minutos queda bloqueada solo 5 minutos', async () => {
      await actualizarUsuario(e.A.id, cuenta.id, { intentos_fallidos: 4 });
      expect((await configurar({ minutosBloqueo: 5 })).status).toBe(200);

      const quinto = await fallar();

      expect(quinto.status, JSON.stringify(quinto.body)).toBe(423);
      expect((await fila())?.bloqueado_hasta?.toISOString()).toBe(instante(5 * MINUTO));
    });
  });

  describe('b) un bloqueo ya puesto no cambia con los valores nuevos', () => {
    const casos: { nombre: string; cuerpo: Record<string, number> }[] = [
      { nombre: 'minutosBloqueo = 5 (más corto)', cuerpo: { minutosBloqueo: 5 } },
      { nombre: 'minutosBloqueo = 60 (más largo)', cuerpo: { minutosBloqueo: 60 } },
      { nombre: 'intentosInicioSesion = 3', cuerpo: { intentosInicioSesion: 3 } },
      { nombre: 'intentosInicioSesion = 10', cuerpo: { intentosInicioSesion: 10 } },
      {
        nombre: 'minutosBloqueo = 5 e intentosInicioSesion = 3',
        cuerpo: { minutosBloqueo: 5, intentosInicioSesion: 3 },
      },
    ];

    it.each(casos)(
      'criterio 15 b): bloqueada hasta T, el administrador pone $nombre y la cuenta sigue bloqueada hasta T exactamente: a 1 minuto y a 14 min 59 s responde 423 y a los 15 minutos entra',
      async ({ cuerpo }) => {
        await actualizarUsuario(e.A.id, cuenta.id, {
          intentos_fallidos: 5,
          bloqueado_hasta: new Date(AHORA_PRUEBAS.getTime() + QUINCE),
        });

        const cambio = await configurar(cuerpo);
        expect(cambio.status, JSON.stringify(cambio.body)).toBe(200);
        expect((await fila())?.bloqueado_hasta?.toISOString(), 'cambiar la configuración no toca la cuenta').toBe(
          instante(QUINCE),
        );

        reloj.avanzar(1 * MINUTO);
        const equivocada = await fallar();
        reloj.avanzar(13 * MINUTO + 59_000);
        const casiCumplido = await entrar();

        for (const respuesta of [equivocada, casiCumplido]) {
          expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(423);
          expect(codigoDe(respuesta)).toBe('CUENTA_BLOQUEADA');
        }
        const durante = await fila();
        expect(durante?.bloqueado_hasta?.toISOString(), 'ni se alarga ni se acorta').toBe(instante(QUINCE));
        expect(durante?.intentos_fallidos).toBe(5);

        reloj.avanzar(1_000);
        const cumplido = await entrar();

        expect(cumplido.status, JSON.stringify(cumplido.body)).toBe(200);
        expect((await fila())?.intentos_fallidos).toBe(0);
      },
    );

    it('criterio 15 b): bloqueada por 30 minutos con los valores de la academia, al bajar minutosBloqueo a 5 sigue bloqueada hasta T (a los 6 minutos todavía responde 423)', async () => {
      await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
      for (let i = 1; i <= 3; i++) await fallar();
      const bloqueadaHasta = (await fila())?.bloqueado_hasta?.toISOString();
      expect(bloqueadaHasta).toBe(instante(30 * MINUTO));

      expect((await configurar({ minutosBloqueo: 5 })).status).toBe(200);
      reloj.avanzar(6 * MINUTO);
      const respuesta = await entrar();

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(423);
      expect((await fila())?.bloqueado_hasta?.toISOString()).toBe(bloqueadaHasta);
    });
  });

  describe('c) restablecer la contraseña desbloquea la cuenta', () => {
    it('criterio 15 c): una cuenta bloqueada con los valores de la academia queda desbloqueada al restablecer su contraseña, como dice el criterio 35 de 002, y entra con su DNI', async () => {
      await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
      for (let i = 1; i <= 3; i++) await fallar();
      expect((await fila())?.bloqueado_hasta).not.toBeNull();

      const restablecer = await pedir(app, 'post', `/api/usuarios/${cuenta.id}/restablecer-clave`, {
        cookie: cookieAdmin,
        cuerpo: {},
      });

      expect(restablecer.status, JSON.stringify(restablecer.body)).toBe(200);
      const despues = await fila();
      expect(despues?.bloqueado_hasta).toBeNull();
      expect(despues?.intentos_fallidos).toBe(0);
      expect(despues?.debe_cambiar_clave).toBe(true);
      const ingreso = await ingresar(cuenta.dni, cuenta.dni);
      expect(ingreso.status, JSON.stringify(ingreso.body)).toBe(200);
    });
  });
});
