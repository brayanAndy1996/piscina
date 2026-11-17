// spec: 003-configuracion-academia (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLAVE_EN_BASE, fijarConfiguracion, fijarFilaConfiguracion, MINUTO } from '../../utilidades/configuracion';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  CLAVE_COMUN,
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

// Criterio 16 (crítico, D-07, RN-02, sección 11.4): con una fila de `intentos_inicio_sesion` o de `minutos_bloqueo` con un valor inválido
// (escrita directamente en la base por el dueño de las tablas: un texto, un booleano, un objeto, una lista, JSON null, un decimal, 0, un
// negativo, 1000, un valor fuera del rango 3 a 10 o 5 a 60), el inicio de sesión y el cambio de contraseña usan el valor por defecto de
// esa clave (5 o 15): la cuenta se bloquea al 5.º fallo por 15 minutos, nunca queda sin bloqueo ni responde 500.
//
// Para distinguir "usa el valor por defecto de esa clave" de "usa otro valor", cada caso inválido se prueba junto a un valor válido de
// la otra clave (intentos inválido con minutosBloqueo = 30; minutos inválido con intentosInicioSesion = 3): la clave válida se aplica y
// la inválida vale 5 o 15. Para no gastar el límite por IP del ingreso (10 por minuto), el ingreso parte con el contador de la cuenta ya
// puesto en la base (la cuenta "a medias") y cada prueba tiene su propia aplicación; el cambio de contraseña no tiene ese límite.

const CLAVE_EQUIVOCADA = 'clave-equivocada-123';
const CLAVE_NUEVA = 'Una-Clave-Nueva-2026';

type Caso = readonly [nombre: string, valor: unknown];

/** Valores inválidos para cualquier clave numérica (criterio 3, más 0, negativos y 1000 del criterio 16). */
const INVALIDOS_COMUNES: readonly Caso[] = [
  ['un texto', 'cinco'],
  ['un texto con dígitos', '5'],
  ['true', true],
  ['false', false],
  ['un objeto', { valor: 5 }],
  ['un objeto vacío', {}],
  ['una lista', [5]],
  ['una lista vacía', []],
  ['JSON null', null],
  ['cero', 0],
  ['un negativo', -1],
  ['mil', 1000],
];
const INVALIDOS_INTENTOS: readonly Caso[] = [
  ...INVALIDOS_COMUNES,
  ['2.5', 2.5],
  ['3.5 (dentro del rango, con decimales)', 3.5],
  ['2 (uno menos que el mínimo)', 2],
  ['11 (uno más que el máximo)', 11],
];
const INVALIDOS_MINUTOS: readonly Caso[] = [
  ...INVALIDOS_COMUNES,
  ['2.5', 2.5],
  ['15.5 (dentro del rango, con decimales)', 15.5],
  ['4 (uno menos que el mínimo)', 4],
  ['61 (uno más que el máximo)', 61],
];

describe('criterio 16: valor inválido guardado y bloqueo del ingreso', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let cuenta: UsuarioDePrueba;

  beforeEach(async () => {
    e = await crearEscenario();
    cuenta = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', clave: CLAVE_COMUN });
    ({ app } = await crearAppConReloj());
  });
  afterEach(async () => {
    await app?.close();
  });

  const fallar = () =>
    pedir(app, 'post', '/api/a/academia-a/sesion', { cuerpo: { usuario: cuenta.dni, clave: CLAVE_EQUIVOCADA } });
  const fila = () => leerUsuario(e.A.id, cuenta.id);
  const instante = (minutos: number) => new Date(AHORA_PRUEBAS.getTime() + minutos * MINUTO).toISOString();
  const codigoDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).codigo;

  it.each(INVALIDOS_INTENTOS)(
    'criterio 16 (ingreso): intentos_inicio_sesion = %s (con minutos_bloqueo = 30): con 3 fallos previos el siguiente responde 401, el 5.º fallo bloquea y por 30 minutos; nunca 500',
    async (_nombre, valor) => {
      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.intentosInicioSesion, valor);
      await fijarConfiguracion(e.A.id, { minutosBloqueo: 30 });
      await actualizarUsuario(e.A.id, cuenta.id, { intentos_fallidos: 3 });

      const cuarto = await fallar();
      expect(cuarto.status, `4.º fallo: ${JSON.stringify(cuarto.body)}`).toBe(401);
      expect(codigoDe(cuarto)).toBe('CREDENCIALES_INVALIDAS');
      expect((await fila())?.bloqueado_hasta).toBeNull();
      const quinto = await fallar();

      expect(quinto.status, `5.º fallo: ${JSON.stringify(quinto.body)}`).toBe(423);
      expect(codigoDe(quinto)).toBe('CUENTA_BLOQUEADA');
      const despues = await fila();
      expect(despues?.intentos_fallidos).toBe(5);
      expect(despues?.bloqueado_hasta?.toISOString()).toBe(instante(30));
    },
  );

  it.each(INVALIDOS_MINUTOS)(
    'criterio 16 (ingreso): minutos_bloqueo = %s (con intentos_inicio_sesion = 3): el 3.º fallo bloquea y por 15 minutos; nunca queda sin bloqueo ni responde 500',
    async (_nombre, valor) => {
      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.minutosBloqueo, valor);
      await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3 });
      await actualizarUsuario(e.A.id, cuenta.id, { intentos_fallidos: 1 });

      const segundo = await fallar();
      expect(segundo.status, `2.º fallo: ${JSON.stringify(segundo.body)}`).toBe(401);
      const tercero = await fallar();

      expect(tercero.status, `3.º fallo: ${JSON.stringify(tercero.body)}`).toBe(423);
      expect(codigoDe(tercero)).toBe('CUENTA_BLOQUEADA');
      const despues = await fila();
      expect(despues?.intentos_fallidos).toBe(3);
      expect(despues?.bloqueado_hasta?.toISOString()).toBe(instante(15));
    },
  );

  it.each([
    ['un texto', 'cinco'],
    ['cero', 0],
    ['1000', 1000],
    ['2.5', 2.5],
  ] as const)(
    'criterio 16 (ingreso): con intentos_inicio_sesion = %s y minutos_bloqueo = %s en la base, desde cero los 4 primeros fallos responden 401 y el 5.º 423 por 15 minutos',
    async (_nombre, valor) => {
      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.intentosInicioSesion, valor);
      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.minutosBloqueo, valor);

      for (let i = 1; i <= 4; i++) {
        const respuesta = await fallar();
        expect(respuesta.status, `intento ${i}: ${JSON.stringify(respuesta.body)}`).toBe(401);
      }
      const quinto = await fallar();

      expect(quinto.status, JSON.stringify(quinto.body)).toBe(423);
      expect((await fila())?.bloqueado_hasta?.toISOString()).toBe(instante(15));
    },
  );

  it('criterio 16 (ingreso): una fila inválida de una academia no afecta a la otra: B, con valores válidos de 3 y 30, bloquea con ellos', async () => {
    await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.intentosInicioSesion, 'cinco');
    await fijarConfiguracion(e.B.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
    const enB = await crearUsuarioDePrueba({ academiaId: e.B.id, rol: 'ENTRENADOR', clave: CLAVE_COMUN });

    for (let i = 1; i <= 2; i++) {
      const respuesta = await pedir(app, 'post', '/api/a/academia-b/sesion', {
        cuerpo: { usuario: enB.dni, clave: CLAVE_EQUIVOCADA },
      });
      expect(respuesta.status, `intento ${i}`).toBe(401);
    }
    const tercero = await pedir(app, 'post', '/api/a/academia-b/sesion', {
      cuerpo: { usuario: enB.dni, clave: CLAVE_EQUIVOCADA },
    });

    expect(tercero.status, JSON.stringify(tercero.body)).toBe(423);
    expect((await leerUsuario(e.B.id, enB.id))?.bloqueado_hasta?.toISOString()).toBe(instante(30));
  });
});

describe('criterio 16: valor inválido guardado y bloqueo del cambio de contraseña', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let cuenta: UsuarioDePrueba;
  let cookie: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
    cuenta = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
    cookie = cookieDeUsuario(cuenta, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  const equivocarse = () =>
    pedir(app, 'post', '/api/sesion/clave', {
      cookie,
      cuerpo: { claveActual: 'Equivocada-2026', claveNueva: CLAVE_NUEVA },
    });
  const fila = () => leerUsuario(e.A.id, cuenta.id);
  const instante = (minutos: number) => new Date(AHORA_PRUEBAS.getTime() + minutos * MINUTO).toISOString();
  const codigoDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).codigo;

  it.each(INVALIDOS_INTENTOS)(
    'criterio 16 (cambio de contraseña): intentos_inicio_sesion = %s (con minutos_bloqueo = 30): con 3 fallos previos el siguiente responde 400, el 5.º fallo bloquea y por 30 minutos; nunca 500',
    async (_nombre, valor) => {
      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.intentosInicioSesion, valor);
      await fijarConfiguracion(e.A.id, { minutosBloqueo: 30 });
      await actualizarUsuario(e.A.id, cuenta.id, { intentos_fallidos: 3 });

      const cuarto = await equivocarse();
      expect(cuarto.status, `4.º fallo: ${JSON.stringify(cuarto.body)}`).toBe(400);
      expect(codigoDe(cuarto)).toBe('CLAVE_ACTUAL_INCORRECTA');
      const quinto = await equivocarse();

      expect(quinto.status, `5.º fallo: ${JSON.stringify(quinto.body)}`).toBe(423);
      expect(codigoDe(quinto)).toBe('CUENTA_BLOQUEADA');
      expect((await fila())?.bloqueado_hasta?.toISOString()).toBe(instante(30));
    },
  );

  it.each(INVALIDOS_MINUTOS)(
    'criterio 16 (cambio de contraseña): minutos_bloqueo = %s (con intentos_inicio_sesion = 3): el 3.º fallo bloquea y por 15 minutos; nunca queda sin bloqueo ni responde 500',
    async (_nombre, valor) => {
      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.minutosBloqueo, valor);
      await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3 });
      await actualizarUsuario(e.A.id, cuenta.id, { intentos_fallidos: 1 });

      const segundo = await equivocarse();
      expect(segundo.status, `2.º fallo: ${JSON.stringify(segundo.body)}`).toBe(400);
      const tercero = await equivocarse();

      expect(tercero.status, `3.º fallo: ${JSON.stringify(tercero.body)}`).toBe(423);
      expect(codigoDe(tercero)).toBe('CUENTA_BLOQUEADA');
      expect((await fila())?.bloqueado_hasta?.toISOString()).toBe(instante(15));
    },
  );

  it.each([
    ['un texto', 'cinco'],
    ['cero', 0],
    ['1000', 1000],
    ['2.5', 2.5],
    ['JSON null', null],
  ] as const)(
    'criterio 16 (cambio de contraseña): con intentos_inicio_sesion y minutos_bloqueo = %s en la base, desde cero los 4 primeros fallos responden 400 y el 5.º 423 por 15 minutos',
    async (_nombre, valor) => {
      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.intentosInicioSesion, valor);
      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.minutosBloqueo, valor);

      for (let i = 1; i <= 4; i++) {
        const respuesta = await equivocarse();
        expect(respuesta.status, `intento ${i}: ${JSON.stringify(respuesta.body)}`).toBe(400);
      }
      const quinto = await equivocarse();

      expect(quinto.status, JSON.stringify(quinto.body)).toBe(423);
      expect((await fila())?.bloqueado_hasta?.toISOString()).toBe(instante(15));
    },
  );
});
