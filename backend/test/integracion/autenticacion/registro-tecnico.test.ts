// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  cookieDeAcademia,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  dniInventado,
  type Escenario,
  fijarEstadoDeAcademia,
  pedir,
  tokenDeCookie,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 43 (Ley 29733, RNF-05): el registro técnico anota el resultado de los ingresos, cambios y restablecimientos con el id del
// usuario (si existe), el id de la academia y la IP, y nunca contiene la clave, la clave nueva, la clave actual, el token ni el DNI
// escrito en el formulario. nestjs-pino crea un único registrador por proceso: este archivo tiene una sola aplicación con el
// destino de registros en memoria, y no pasa de 10 peticiones de ingreso (límite por IP, criterio 12).

describe('criterio 43: el registro técnico no contiene secretos ni el DNI del formulario', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let app: NestExpressApplication;
  let e: Escenario;
  let usuario: UsuarioDePrueba; // con clave propia, distinta del DNI
  let bloqueable: UsuarioDePrueba;
  let dniInexistente: string;
  const CLAVE_PROPIA = 'Clave-Unica-Propia-48151';
  const CLAVE_FALLIDA = 'Clave-Fallida-Unica-62342';
  const CLAVE_NUEVA = 'Clave-Nueva-Unica-10815';
  const CLAVE_INVALIDA = `Invalida-Unica-${'z'.repeat(130)}`;
  const tokens: string[] = [];

  beforeAll(async () => {
    e = await crearEscenario();
    usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA', clave: CLAVE_PROPIA });
    bloqueable = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', clave: CLAVE_PROPIA });
    dniInexistente = dniInventado();
    ({ app } = await crearAppConReloj(AHORA_PRUEBAS, { nivelRegistro: 'trace', destinoRegistro: destino }));
  });
  afterAll(async () => {
    await app?.close();
  });

  it('criterio 43: los ingresos correctos, fallidos, bloqueados, de DNI inexistente, de academia inexistente o suspendida y los cuerpos inválidos no escriben la clave, el token ni el DNI escrito', async () => {
    const servidor = (usuarioEscrito: string, clave: string, nombreCorto = 'academia-a') =>
      pedir(app, 'post', `/api/a/${nombreCorto}/sesion`, { cuerpo: { usuario: usuarioEscrito, clave } });
    await actualizarUsuario(e.A.id, bloqueable.id, { intentos_fallidos: 4 });

    const correcto = await servidor(usuario.dni, CLAVE_PROPIA);
    const fallido = await servidor(usuario.dni, CLAVE_FALLIDA);
    const inexistente = await servidor(dniInexistente, CLAVE_FALLIDA);
    const quintoFallo = await servidor(bloqueable.dni, CLAVE_FALLIDA);
    const bloqueado = await servidor(bloqueable.dni, CLAVE_PROPIA);
    const academiaInexistente = await servidor(usuario.dni, CLAVE_FALLIDA, 'no-existe');
    await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');
    const suspendida = await servidor(e.secretariaB.dni, CLAVE_FALLIDA, 'academia-b');
    const invalido = await servidor(usuario.dni, CLAVE_INVALIDA);

    expect([
      correcto.status,
      fallido.status,
      inexistente.status,
      quintoFallo.status,
      bloqueado.status,
      academiaInexistente.status,
      suspendida.status,
      invalido.status,
    ]).toEqual([200, 401, 401, 423, 423, 404, 403, 400]);
    tokens.push(tokenDeCookie(cookieDeAcademia(correcto.headers) ?? ''));
    await esperarHasta(() => lineas.length >= 8);

    expect(lineas.length, 'la aplicación no escribió ningún registro').toBeGreaterThan(0);
    const todo = lineas.join('\n');
    for (const secreto of [CLAVE_PROPIA, CLAVE_FALLIDA, CLAVE_INVALIDA, 'z'.repeat(130)]) {
      expect(todo, `el registro contiene un secreto: ${secreto.slice(0, 12)}…`).not.toContain(secreto);
    }
    for (const dni of [usuario.dni, bloqueable.dni, dniInexistente, e.secretariaB.dni]) {
      expect(todo, `el registro contiene el DNI escrito ${dni}`).not.toContain(dni);
    }
    expect(tokens[0]?.length).toBeGreaterThan(20);
    expect(todo).not.toContain(tokens[0]);
    expect(todo).not.toContain('$argon2');
  });

  it('criterio 43: el resultado del ingreso queda anotado con el id del usuario y el id de la academia', () => {
    const anotados = lineas.filter((linea) => linea.includes(usuario.id) && linea.includes(e.A.id));
    const anotadosBloqueado = lineas.filter((linea) => linea.includes(bloqueable.id) && linea.includes(e.A.id));

    expect(anotados.length, 'ninguna línea del registro lleva el id del usuario y el de su academia').toBeGreaterThan(
      0,
    );
    expect(anotadosBloqueado.length, 'el bloqueo no quedó anotado con el id del usuario').toBeGreaterThan(0);
  });

  it('criterio 43: un ingreso con un DNI inexistente se anota con el id de la academia', () => {
    const lineasDeLaAcademia = lineas.filter((linea) => linea.includes(e.A.id));

    expect(lineasDeLaAcademia.length).toBeGreaterThan(3);
  });

  it('criterio 43: el cambio de contraseña (correcto y con la clave actual equivocada) y el restablecimiento no escriben las claves ni el token', async () => {
    const admin = e.adminA;
    const cookieUsuario = cookieDeUsuario(usuario, AHORA_PRUEBAS);
    const cookieAdmin = cookieDeUsuario(admin, AHORA_PRUEBAS);
    const antes = lineas.length;

    const equivocada = await pedir(app, 'post', '/api/sesion/clave', {
      cookie: cookieUsuario,
      cuerpo: { claveActual: CLAVE_FALLIDA, claveNueva: CLAVE_NUEVA },
    });
    const correcta = await pedir(app, 'post', '/api/sesion/clave', {
      cookie: cookieUsuario,
      cuerpo: { claveActual: CLAVE_PROPIA, claveNueva: CLAVE_NUEVA },
    });
    const restablecida = await pedir(app, 'post', `/api/usuarios/${e.alumnoA.id}/restablecer-clave`, {
      cookie: cookieAdmin,
      cuerpo: {},
    });
    const nuevaCookie = tokenDeCookie(cookieDeAcademia(correcta.headers) ?? '');
    const consulta = await pedir(app, 'get', '/api/sesion', { cookie: `aq_sesion=${nuevaCookie}` });
    expect([equivocada.status, correcta.status, restablecida.status, consulta.status]).toEqual([400, 200, 200, 200]);
    await esperarHasta(() => lineas.length >= antes + 4);

    const nuevas = lineas.slice(antes);
    expect(nuevas.length, 'el cambio y el restablecimiento no escribieron nada').toBeGreaterThan(0);
    const todo = nuevas.join('\n');
    for (const secreto of [CLAVE_PROPIA, CLAVE_FALLIDA, CLAVE_NUEVA, nuevaCookie, e.alumnoA.dni]) {
      expect(todo, `el registro contiene un secreto: ${secreto.slice(0, 12)}…`).not.toContain(secreto);
    }
    expect(todo).not.toContain('$argon2');
    expect(
      nuevas.some((linea) => linea.includes(usuario.id) && linea.includes(e.A.id)),
      'el cambio de contraseña no quedó anotado con el id del usuario y el de la academia',
    ).toBe(true);
    expect(
      nuevas.some((linea) => linea.includes(e.alumnoA.id) && linea.includes(e.A.id)),
      'el restablecimiento no quedó anotado con el id del usuario y el de la academia',
    ).toBe(true);
  });
});
