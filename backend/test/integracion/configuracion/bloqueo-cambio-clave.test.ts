// spec: 003-configuracion-academia (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RelojFijo } from '../../../src/infraestructura/reloj';
import { conFilaRetenida } from '../../utilidades/carreras';
import {
  type ClienteDeConfiguracion,
  escucharParaConfiguracion,
  fijarConfiguracion,
  MINUTO,
  quitarFilaConfiguracion,
} from '../../utilidades/configuracion';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  contarAuditoria,
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

// Criterio 14 (crítico, D-07, criterios 24, 58 y 60 de 002): POST /api/sesion/clave cuenta los fallos de la `claveActual` con los
// valores de la academia del usuario. Con A en 3 intentos y 30 minutos, el 3.º fallo responde 423 y bloquea la cuenta por 30 minutos;
// B (sin configuración) sigue con 5 y 15. Cada prueba tiene su propia aplicación (con su reloj fijo).

const CLAVE_ACTUAL_EQUIVOCADA = 'Equivocada-2026';
const CLAVE_NUEVA = 'Una-Clave-Nueva-2026';

describe('criterio 14: el cambio de contraseña bloquea con los valores de la academia', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let e: Escenario;
  let enA: UsuarioDePrueba;
  let enB: UsuarioDePrueba;
  let cookieA: string;
  let cookieB: string;

  const cambiar = (cookie: string, claveActual: string) =>
    pedir(app, 'post', '/api/sesion/clave', { cookie, cuerpo: { claveActual, claveNueva: CLAVE_NUEVA } });
  const equivocarseEnA = () => cambiar(cookieA, CLAVE_ACTUAL_EQUIVOCADA);
  const equivocarseEnB = () => cambiar(cookieB, CLAVE_ACTUAL_EQUIVOCADA);
  const filaA = () => leerUsuario(e.A.id, enA.id);
  const filaB = () => leerUsuario(e.B.id, enB.id);
  const instante = (minutos: number) => new Date(AHORA_PRUEBAS.getTime() + minutos * MINUTO).toISOString();
  const codigoDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).codigo;

  beforeEach(async () => {
    e = await crearEscenario();
    enA = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
    enB = await crearUsuarioDePrueba({ academiaId: e.B.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
    cookieA = cookieDeUsuario(enA, AHORA_PRUEBAS);
    cookieB = cookieDeUsuario(enB, AHORA_PRUEBAS);
    await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
    ({ app, reloj } = await crearAppConReloj());
  });
  afterEach(async () => {
    await app?.close();
  });

  it('criterio 14: en A, los 2 primeros fallos de la claveActual responden 400 CLAVE_ACTUAL_INCORRECTA y el 3.º responde 423 CUENTA_BLOQUEADA con bloqueado_hasta = ahora + 30 min; la sesión sigue valiendo', async () => {
    for (let i = 1; i <= 2; i++) {
      const respuesta = await equivocarseEnA();
      expect(respuesta.status, `intento ${i}: ${JSON.stringify(respuesta.body)}`).toBe(400);
      expect(codigoDe(respuesta)).toBe('CLAVE_ACTUAL_INCORRECTA');
    }
    expect((await filaA())?.intentos_fallidos).toBe(2);

    const tercero = await equivocarseEnA();

    expect(tercero.status, JSON.stringify(tercero.body)).toBe(423);
    expect(codigoDe(tercero)).toBe('CUENTA_BLOQUEADA');
    expect((await filaA())?.intentos_fallidos).toBe(3);
    expect((await filaA())?.bloqueado_hasta?.toISOString()).toBe(instante(30));
    expect((await pedir(app, 'get', '/api/sesion', { cookie: cookieA })).status, 'la sesión sigue valiendo').toBe(200);
    expect((await filaB())?.intentos_fallidos, 'la cuenta de B no cambia').toBe(0);
  });

  it('criterio 14: con la cuenta bloqueada responde 423 aunque la claveActual sea correcta, sin cambiar la clave, el contador ni el bloqueo (criterio 24 de 002)', async () => {
    for (let i = 0; i < 3; i++) await equivocarseEnA();
    const antes = await filaA();

    reloj.avanzar(29 * MINUTO + 59_000);
    const correcta = await cambiar(cookieA, CLAVE_COMUN);
    const equivocada = await equivocarseEnA();

    for (const respuesta of [correcta, equivocada]) {
      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(423);
      expect(codigoDe(respuesta)).toBe('CUENTA_BLOQUEADA');
    }
    const despues = await filaA();
    expect(despues?.clave_hash).toBe(antes?.clave_hash);
    expect(despues?.intentos_fallidos).toBe(antes?.intentos_fallidos);
    expect(despues?.bloqueado_hasta?.toISOString()).toBe(instante(30));
    expect(await contarAuditoria(e.A.id, 'USUARIO_CLAVE_CAMBIADA')).toBe(0);
  });

  it('criterio 14: cumplidos los 30 minutos, la claveActual correcta vuelve a permitir el cambio y deja el contador en 0', async () => {
    for (let i = 1; i <= 2; i++) expect((await equivocarseEnA()).status, `intento ${i}`).toBe(400);
    expect((await equivocarseEnA()).status, 'el 3.º fallo bloquea la cuenta').toBe(423);

    reloj.avanzar(30 * MINUTO);
    const respuesta = await cambiar(cookieA, CLAVE_COMUN);

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
    expect((await filaA())?.intentos_fallidos).toBe(0);
  });

  it('criterio 14: en B (sin configuración), los 4 primeros fallos responden 400 y el 5.º 423 con bloqueado_hasta = ahora + 15 min', async () => {
    for (let i = 1; i <= 4; i++) {
      const respuesta = await equivocarseEnB();
      expect(respuesta.status, `intento ${i}: ${JSON.stringify(respuesta.body)}`).toBe(400);
      expect(codigoDe(respuesta)).toBe('CLAVE_ACTUAL_INCORRECTA');
    }

    const quinto = await equivocarseEnB();

    expect(quinto.status, JSON.stringify(quinto.body)).toBe(423);
    expect(codigoDe(quinto)).toBe('CUENTA_BLOQUEADA');
    expect((await filaB())?.bloqueado_hasta?.toISOString()).toBe(instante(15));
    expect((await filaA())?.intentos_fallidos, 'la cuenta de A no cambia').toBe(0);
  });

  it('criterio 14: con la configuración solo en B (3 y 30), A usa los valores por defecto: el 5.º fallo bloquea por 15 minutos', async () => {
    await quitarFilaConfiguracion(e.A.id, 'intentos_inicio_sesion');
    await quitarFilaConfiguracion(e.A.id, 'minutos_bloqueo');
    await fijarConfiguracion(e.B.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });

    for (let i = 1; i <= 4; i++) expect((await equivocarseEnA()).status, `intento ${i}`).toBe(400);
    const quinto = await equivocarseEnA();

    expect(quinto.status, JSON.stringify(quinto.body)).toBe(423);
    expect((await filaA())?.bloqueado_hasta?.toISOString()).toBe(instante(15));
  });
});

describe('criterio 14: el valor de la academia se lee en la transacción que cuenta el fallo (criterio 60 de 002)', () => {
  let http: ClienteDeConfiguracion;
  let e: Escenario;

  beforeEach(async () => {
    const { app } = await crearAppConReloj();
    http = await escucharParaConfiguracion(app);
    e = await crearEscenario();
  });
  afterEach(async () => {
    await http?.cerrar();
  });

  it('criterio 14: con 2 fallos previos en A (3 intentos y 30 minutos), el fallo que espera el bloqueo de la fila responde 423 con el contador en 3 y bloqueado_hasta = ahora + 30 min', async () => {
    await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
    const x = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_COMUN });
    await actualizarUsuario(e.A.id, x.id, { intentos_fallidos: 2 });

    const { resultado, esperoElBloqueo } = await conFilaRetenida({
      academiaId: e.A.id,
      actorId: x.id,
      cambio: 'bloquear-sin-cambiar',
      liberar: 'ROLLBACK',
      enviar: () =>
        http.post('/api/sesion/clave', cookieDeUsuario(x, AHORA_PRUEBAS), {
          claveActual: CLAVE_ACTUAL_EQUIVOCADA,
          claveNueva: CLAVE_NUEVA,
        }),
    });

    expect.soft(esperoElBloqueo, 'el conteo debía pasar por el bloqueo de la fila del actor').toBe(true);
    expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(423);
    expect.soft(resultado.body?.codigo).toBe('CUENTA_BLOQUEADA');
    const despues = await leerUsuario(e.A.id, x.id);
    expect(despues?.intentos_fallidos).toBe(3);
    expect(despues?.bloqueado_hasta?.toISOString()).toBe(new Date(AHORA_PRUEBAS.getTime() + 30 * MINUTO).toISOString());
  });

  it('criterio 14: el mismo caso en B, sin configuración, con 2 fallos previos: responde 400 y el contador queda en 3 sin bloqueo', async () => {
    await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
    const x = await crearUsuarioDePrueba({ academiaId: e.B.id, rol: 'ADMIN', clave: CLAVE_COMUN });
    await actualizarUsuario(e.B.id, x.id, { intentos_fallidos: 2 });

    const { resultado, esperoElBloqueo } = await conFilaRetenida({
      academiaId: e.B.id,
      actorId: x.id,
      cambio: 'bloquear-sin-cambiar',
      liberar: 'ROLLBACK',
      enviar: () =>
        http.post('/api/sesion/clave', cookieDeUsuario(x, AHORA_PRUEBAS), {
          claveActual: CLAVE_ACTUAL_EQUIVOCADA,
          claveNueva: CLAVE_NUEVA,
        }),
    });

    expect.soft(esperoElBloqueo, 'el conteo debía pasar por el bloqueo de la fila del actor').toBe(true);
    expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(400);
    expect.soft(resultado.body?.codigo).toBe('CLAVE_ACTUAL_INCORRECTA');
    const despues = await leerUsuario(e.B.id, x.id);
    expect(despues?.intentos_fallidos).toBe(3);
    expect(despues?.bloqueado_hasta).toBeNull();
  });
});
