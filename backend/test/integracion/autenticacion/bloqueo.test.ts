// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cookieDeAcademia,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  leerUsuario,
  pedir,
  QUINCE_MINUTOS,
} from '../../utilidades/usuarios';
import type { RelojFijo } from '../../../src/infraestructura/reloj';

// Criterio 9: bloqueo tras 5 fallos seguidos durante 15 minutos (valores provisionales hasta que 003 los haga configurables).
// Cada prueba usa su propia aplicación y no pasa de 10 peticiones de ingreso (límite por IP, criterio 12).

describe('criterio 9: bloqueo de la cuenta', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let e: Escenario;

  const ingresar = (nombreCorto: string, usuario: string, clave: string) =>
    pedir(app, 'post', `/api/a/${nombreCorto}/sesion`, { cuerpo: { usuario, clave } });
  const fallar = () => ingresar('academia-a', e.secretariaA.dni, 'clave-equivocada-123');
  const entrar = () => ingresar('academia-a', e.secretariaA.dni, CLAVE_COMUN);
  const fila = () => leerUsuario(e.A.id, e.secretariaA.id);

  beforeEach(async () => {
    e = await crearEscenario();
    ({ app, reloj } = await crearAppConReloj());
  });
  afterEach(async () => {
    await app?.close();
  });

  it('criterio 9: los 4 primeros fallos responden 401 y el 5.º responde 423 CUENTA_BLOQUEADA con bloqueado_hasta = ahora + 15 min', async () => {
    for (let i = 1; i <= 4; i++) {
      const respuesta = await fallar();
      expect(respuesta.status, `intento ${i}`).toBe(401);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CREDENCIALES_INVALIDAS');
    }
    expect((await fila())?.intentos_fallidos).toBe(4);

    const quinto = await fallar();

    expect(quinto.status).toBe(423);
    expect((quinto.body as ErrorCuerpo).codigo).toBe('CUENTA_BLOQUEADA');
    expect(quinto.headers['set-cookie']).toBeUndefined();
    expect((await fila())?.bloqueado_hasta?.toISOString()).toBe(
      new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS).toISOString(),
    );
  });

  it('criterio 9: mientras dura el bloqueo, incluso la clave correcta responde 423 sin cookie ni cambiar el contador', async () => {
    for (let i = 0; i < 5; i++) await fallar();
    const antes = await fila();

    reloj.avanzar(14 * 60 * 1000 + 59_000);
    const conClaveCorrecta = await entrar();
    const conClaveEquivocada = await fallar();

    for (const respuesta of [conClaveCorrecta, conClaveEquivocada]) {
      expect(respuesta.status).toBe(423);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CUENTA_BLOQUEADA');
      expect(respuesta.headers['set-cookie']).toBeUndefined();
    }
    const despues = await fila();
    expect(despues?.intentos_fallidos).toBe(antes?.intentos_fallidos);
    expect(despues?.bloqueado_hasta?.toISOString()).toBe(antes?.bloqueado_hasta?.toISOString());
    expect(despues?.ultimo_acceso).toBeNull();
  });

  it('criterio 9: cumplidos los 15 minutos, la clave correcta entra y deja el contador en 0', async () => {
    for (let i = 0; i < 5; i++) await fallar();

    reloj.avanzar(QUINCE_MINUTOS);
    const respuesta = await entrar();

    expect(respuesta.status).toBe(200);
    expect(cookieDeAcademia(respuesta.headers)).toBeDefined();
    expect((await fila())?.intentos_fallidos).toBe(0);
  });

  it('criterio 9: cumplidos los 15 minutos, una clave equivocada vuelve a contar desde 1', async () => {
    for (let i = 0; i < 5; i++) await fallar();

    reloj.avanzar(QUINCE_MINUTOS);
    const respuesta = await fallar();

    expect(respuesta.status).toBe(401);
    expect((await fila())?.intentos_fallidos).toBe(1);
  });

  it('criterio 9: un ingreso correcto antes del 5.º fallo pone el contador en 0', async () => {
    for (let i = 0; i < 4; i++) await fallar();
    expect((await fila())?.intentos_fallidos).toBe(4);

    const ingreso = await entrar();
    expect(ingreso.status).toBe(200);
    expect((await fila())?.intentos_fallidos).toBe(0);

    for (let i = 1; i <= 4; i++) expect((await fallar()).status, `intento ${i} tras el ingreso`).toBe(401);
  });

  it('criterio 9: dados 10 intentos fallidos simultáneos, cada respuesta es 401 o 423, al menos una es 423 y la cuenta queda bloqueada', async () => {
    const respuestas = await Promise.all(Array.from({ length: 10 }, () => fallar()));

    const estados = respuestas.map((respuesta) => respuesta.status);
    expect(
      estados.every((estado) => estado === 401 || estado === 423),
      `estados: ${estados.join(',')}`,
    ).toBe(true);
    expect(estados.filter((estado) => estado === 423).length).toBeGreaterThanOrEqual(1);
    for (const respuesta of respuestas) expect(respuesta.headers['set-cookie']).toBeUndefined();
    const despues = await fila();
    expect(despues?.bloqueado_hasta?.toISOString()).toBe(
      new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS).toISOString(),
    );
  });

  it('criterio 9: con intentos_fallidos = 4 en la base, el siguiente fallo bloquea la cuenta', async () => {
    await actualizarUsuario(e.A.id, e.secretariaA.id, { intentos_fallidos: 4 });

    const respuesta = await fallar();

    expect(respuesta.status).toBe(423);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('CUENTA_BLOQUEADA');
  });

  it('criterio 9: bloquear la cuenta de A no afecta a la cuenta del mismo DNI en B (y al revés)', async () => {
    const dni = '20262026';
    const enA = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', dni, clave: CLAVE_COMUN });
    const enB = await crearUsuarioDePrueba({ academiaId: e.B.id, rol: 'ENTRENADOR', dni, clave: CLAVE_COMUN });

    for (let i = 0; i < 5; i++) await ingresar('academia-a', dni, 'clave-equivocada-123');
    const aBloqueada = await ingresar('academia-a', dni, CLAVE_COMUN);
    const bEntra = await ingresar('academia-b', dni, CLAVE_COMUN);

    expect(aBloqueada.status).toBe(423);
    expect(bEntra.status).toBe(200);
    expect((await leerUsuario(e.A.id, enA.id))?.bloqueado_hasta).not.toBeNull();
    expect((await leerUsuario(e.B.id, enB.id))?.bloqueado_hasta).toBeNull();
    expect((await leerUsuario(e.B.id, enB.id))?.intentos_fallidos).toBe(0);
  });

  it('criterio 9 y 10: un usuario INACTIVO también cuenta los fallos y se bloquea al 5.º', async () => {
    const inactivo = await crearUsuarioDePrueba({
      academiaId: e.A.id,
      rol: 'ENTRENADOR',
      clave: CLAVE_COMUN,
      estado: 'INACTIVO',
    });

    for (let i = 1; i <= 4; i++) {
      expect((await ingresar('academia-a', inactivo.dni, 'clave-equivocada-123')).status, `intento ${i}`).toBe(401);
    }
    const quinto = await ingresar('academia-a', inactivo.dni, 'clave-equivocada-123');

    expect(quinto.status).toBe(423);
    expect((await leerUsuario(e.A.id, inactivo.id))?.bloqueado_hasta).not.toBeNull();
  });

  it('criterio 9: la sesión abierta sigue valiendo mientras la cuenta está bloqueada por fallos de otra persona', async () => {
    const entrada = await entrar();
    const cookie = (cookieDeAcademia(entrada.headers) ?? '').split(';')[0] ?? '';
    for (let i = 0; i < 5; i++) await fallar();

    const sesion = await pedir(app, 'get', '/api/sesion', { cookie });

    expect(sesion.status).toBe(200);
  });
});
