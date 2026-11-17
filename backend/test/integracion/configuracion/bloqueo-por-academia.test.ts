// spec: 003-configuracion-academia (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RelojFijo } from '../../../src/infraestructura/reloj';
import { fijarConfiguracion, MINUTO } from '../../utilidades/configuracion';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cookieDeAcademia,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  dniInventado,
  type ErrorCuerpo,
  type Escenario,
  leerUsuario,
  pedir,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 13 (crítico, D-07, criterio 9 de 002): el bloqueo por intentos fallidos del ingreso usa los valores de cada academia.
// A tiene `intentosInicioSesion` 3 y `minutosBloqueo` 30; B no tiene configuración (5 y 15). El mismo DNI tiene cuenta en las dos.
// Cada prueba usa su propia aplicación (cada una con su límite por IP del criterio 12, 10 por minuto) y no pasa de 10 peticiones de
// ingreso; las de 10 simultáneas son la única petición de esa aplicación.

const CLAVE_EQUIVOCADA = 'clave-equivocada-123';

describe('criterio 13: el bloqueo del ingreso usa los valores de cada academia', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let e: Escenario;
  let enA: UsuarioDePrueba;
  let enB: UsuarioDePrueba;

  const ingresar = (nombreCorto: string, usuario: string, clave: string) =>
    pedir(app, 'post', `/api/a/${nombreCorto}/sesion`, { cuerpo: { usuario, clave } });
  const fallarEnA = () => ingresar('academia-a', enA.dni, CLAVE_EQUIVOCADA);
  const entrarEnA = () => ingresar('academia-a', enA.dni, CLAVE_COMUN);
  const fallarEnB = () => ingresar('academia-b', enB.dni, CLAVE_EQUIVOCADA);
  const entrarEnB = () => ingresar('academia-b', enB.dni, CLAVE_COMUN);
  const filaA = () => leerUsuario(e.A.id, enA.id);
  const filaB = () => leerUsuario(e.B.id, enB.id);
  const instante = (minutos: number) => new Date(AHORA_PRUEBAS.getTime() + minutos * MINUTO).toISOString();
  const codigoDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).codigo;

  beforeEach(async () => {
    e = await crearEscenario();
    const dni = dniInventado();
    enA = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', dni, clave: CLAVE_COMUN });
    enB = await crearUsuarioDePrueba({ academiaId: e.B.id, rol: 'ENTRENADOR', dni, clave: CLAVE_COMUN });
    await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
    ({ app, reloj } = await crearAppConReloj());
  });
  afterEach(async () => {
    await app?.close();
  });

  describe('academia A: 3 intentos y 30 minutos', () => {
    it('criterio 13: los 2 primeros fallos responden 401 y el 3.º responde 423 CUENTA_BLOQUEADA con bloqueado_hasta = ahora + 30 min, sin tocar la cuenta del mismo DNI en B', async () => {
      for (let i = 1; i <= 2; i++) {
        const respuesta = await fallarEnA();
        expect(respuesta.status, `intento ${i}`).toBe(401);
        expect(codigoDe(respuesta)).toBe('CREDENCIALES_INVALIDAS');
      }
      expect((await filaA())?.intentos_fallidos).toBe(2);
      expect((await filaA())?.bloqueado_hasta).toBeNull();

      const tercero = await fallarEnA();

      expect(tercero.status, JSON.stringify(tercero.body)).toBe(423);
      expect(codigoDe(tercero)).toBe('CUENTA_BLOQUEADA');
      expect(tercero.headers['set-cookie']).toBeUndefined();
      expect((await filaA())?.intentos_fallidos).toBe(3);
      expect((await filaA())?.bloqueado_hasta?.toISOString()).toBe(instante(30));
      expect((await filaB())?.intentos_fallidos, 'la cuenta de B no cambia').toBe(0);
      expect((await filaB())?.bloqueado_hasta).toBeNull();
    });

    it('criterio 13: mientras dura el bloqueo todo intento responde 423, incluso con la clave correcta; a los 30 minutos la clave correcta entra y deja el contador en 0', async () => {
      for (let i = 0; i < 3; i++) await fallarEnA();
      const antes = await filaA();

      const inmediata = await entrarEnA();
      reloj.avanzar(29 * MINUTO + 59_000);
      const casiCumplido = await entrarEnA();
      const equivocada = await fallarEnA();

      for (const respuesta of [inmediata, casiCumplido, equivocada]) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(423);
        expect(codigoDe(respuesta)).toBe('CUENTA_BLOQUEADA');
        expect(respuesta.headers['set-cookie']).toBeUndefined();
      }
      const durante = await filaA();
      expect(durante?.intentos_fallidos).toBe(antes?.intentos_fallidos);
      expect(durante?.bloqueado_hasta?.toISOString(), 'un intento durante el bloqueo no lo alarga').toBe(instante(30));

      reloj.avanzar(1_000);
      const cumplido = await entrarEnA();

      expect(cumplido.status, JSON.stringify(cumplido.body)).toBe(200);
      expect(cookieDeAcademia(cumplido.headers)).toBeDefined();
      expect((await filaA())?.intentos_fallidos).toBe(0);
    });

    it('criterio 13: cumplidos los 30 minutos, una clave equivocada vuelve a contar desde 1', async () => {
      for (let i = 0; i < 3; i++) await fallarEnA();

      reloj.avanzar(30 * MINUTO);
      const respuesta = await fallarEnA();

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(401);
      expect((await filaA())?.intentos_fallidos).toBe(1);
    });

    it('criterio 13: dados 10 intentos fallidos simultáneos contra la cuenta de A, cada respuesta es 401 o 423, al menos una es 423, no más de 2 son 401 y la cuenta queda bloqueada por 30 minutos', async () => {
      const respuestas = await Promise.all(Array.from({ length: 10 }, () => fallarEnA()));

      const estados = respuestas.map((respuesta) => respuesta.status);
      expect(
        estados.every((estado) => estado === 401 || estado === 423),
        `estados: ${estados.join(',')}`,
      ).toBe(true);
      expect(estados.filter((estado) => estado === 423).length, `estados: ${estados.join(',')}`).toBeGreaterThanOrEqual(
        1,
      );
      expect(
        estados.filter((estado) => estado === 401).length,
        `con 3 intentos, a lo sumo 2 fallos pueden responder 401; estados: ${estados.join(',')}`,
      ).toBeLessThanOrEqual(2);
      for (const respuesta of respuestas) expect(respuesta.headers['set-cookie']).toBeUndefined();
      expect((await filaA())?.bloqueado_hasta?.toISOString(), 'la cuenta quedó bloqueada').toBe(instante(30));
      expect((await filaB())?.bloqueado_hasta, 'la de B no').toBeNull();
    });
  });

  describe('academia B: sin configuración, 5 intentos y 15 minutos', () => {
    it('criterio 13: los 4 primeros fallos responden 401 y el 5.º responde 423 con bloqueado_hasta = ahora + 15 min, aunque A esté configurada con otros valores', async () => {
      for (let i = 1; i <= 4; i++) {
        const respuesta = await fallarEnB();
        expect(respuesta.status, `intento ${i}`).toBe(401);
        expect(codigoDe(respuesta)).toBe('CREDENCIALES_INVALIDAS');
      }
      expect((await filaB())?.intentos_fallidos).toBe(4);

      const quinto = await fallarEnB();

      expect(quinto.status, JSON.stringify(quinto.body)).toBe(423);
      expect(codigoDe(quinto)).toBe('CUENTA_BLOQUEADA');
      expect((await filaB())?.bloqueado_hasta?.toISOString()).toBe(instante(15));
      expect((await filaA())?.intentos_fallidos, 'la cuenta de A no cambia').toBe(0);
      expect((await filaA())?.bloqueado_hasta).toBeNull();
    });

    it('criterio 13: el bloqueo de B dura 15 minutos: a los 14 min 59 s la clave correcta responde 423 y a los 15 minutos entra', async () => {
      for (let i = 0; i < 5; i++) await fallarEnB();

      reloj.avanzar(14 * MINUTO + 59_000);
      const casiCumplido = await entrarEnB();
      reloj.avanzar(1_000);
      const cumplido = await entrarEnB();

      expect(casiCumplido.status).toBe(423);
      expect(cumplido.status, JSON.stringify(cumplido.body)).toBe(200);
      expect((await filaB())?.intentos_fallidos).toBe(0);
    });
  });
});

describe('criterio 13: cada clave por separado y sin mezclar academias', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let enA: UsuarioDePrueba;

  beforeEach(async () => {
    e = await crearEscenario();
    enA = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', clave: CLAVE_COMUN });
    ({ app } = await crearAppConReloj());
  });
  afterEach(async () => {
    await app?.close();
  });

  const fallarEnA = () =>
    pedir(app, 'post', '/api/a/academia-a/sesion', { cuerpo: { usuario: enA.dni, clave: CLAVE_EQUIVOCADA } });

  it('criterio 13: con la configuración solo en B (3 intentos y 30 minutos), A usa los valores por defecto: el 5.º fallo la bloquea por 15 minutos', async () => {
    await fijarConfiguracion(e.B.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });

    for (let i = 1; i <= 4; i++) expect((await fallarEnA()).status, `intento ${i}`).toBe(401);
    const quinto = await fallarEnA();

    expect(quinto.status, JSON.stringify(quinto.body)).toBe(423);
    expect((await leerUsuario(e.A.id, enA.id))?.bloqueado_hasta?.toISOString()).toBe(
      new Date(AHORA_PRUEBAS.getTime() + 15 * MINUTO).toISOString(),
    );
  });

  it('criterio 13: con solo intentosInicioSesion = 3 en A, el 3.º fallo bloquea por 15 minutos (el valor por defecto de minutosBloqueo)', async () => {
    await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3 });

    expect((await fallarEnA()).status).toBe(401);
    expect((await fallarEnA()).status).toBe(401);
    const tercero = await fallarEnA();

    expect(tercero.status, JSON.stringify(tercero.body)).toBe(423);
    expect((await leerUsuario(e.A.id, enA.id))?.bloqueado_hasta?.toISOString()).toBe(
      new Date(AHORA_PRUEBAS.getTime() + 15 * MINUTO).toISOString(),
    );
  });

  it('criterio 13: con solo minutosBloqueo = 30 en A, el 5.º fallo bloquea por 30 minutos (el valor por defecto de intentosInicioSesion)', async () => {
    await fijarConfiguracion(e.A.id, { minutosBloqueo: 30 });

    for (let i = 1; i <= 4; i++) expect((await fallarEnA()).status, `intento ${i}`).toBe(401);
    const quinto = await fallarEnA();

    expect(quinto.status, JSON.stringify(quinto.body)).toBe(423);
    expect((await leerUsuario(e.A.id, enA.id))?.bloqueado_hasta?.toISOString()).toBe(
      new Date(AHORA_PRUEBAS.getTime() + 30 * MINUTO).toISOString(),
    );
  });

  it('criterio 13: los valores en los extremos del rango se aplican tal cual: 10 intentos y 60 minutos', async () => {
    await fijarConfiguracion(e.A.id, { intentosInicioSesion: 10, minutosBloqueo: 60 });

    for (let i = 1; i <= 9; i++) expect((await fallarEnA()).status, `intento ${i}`).toBe(401);
    const decimo = await fallarEnA();

    expect(decimo.status, JSON.stringify(decimo.body)).toBe(423);
    expect((await leerUsuario(e.A.id, enA.id))?.bloqueado_hasta?.toISOString()).toBe(
      new Date(AHORA_PRUEBAS.getTime() + 60 * MINUTO).toISOString(),
    );
  });

  it('criterio 13: los valores en el otro extremo del rango se aplican tal cual: 3 intentos y 5 minutos', async () => {
    await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 5 });

    expect((await fallarEnA()).status).toBe(401);
    expect((await fallarEnA()).status).toBe(401);
    const tercero = await fallarEnA();

    expect(tercero.status, JSON.stringify(tercero.body)).toBe(423);
    expect((await leerUsuario(e.A.id, enA.id))?.bloqueado_hasta?.toISOString()).toBe(
      new Date(AHORA_PRUEBAS.getTime() + 5 * MINUTO).toISOString(),
    );
  });
});
