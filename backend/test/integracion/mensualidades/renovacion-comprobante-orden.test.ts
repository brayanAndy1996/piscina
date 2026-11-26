// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  codigoDeRespuesta,
  crearAlumnoDeNoviembre,
  datosComprobanteRenovacion,
  INSTANTES,
  instantaneaDeRenovacion,
  prepararEscenarioDeRenovacion,
  renovarConComprobante,
  seleccionDeDiciembre,
  type OpcionesDelComprobante,
} from '../../utilidades/escenario-renovacion';
import type { RespuestaApi } from '../../utilidades/inscripciones';
import { FIRMA_JPEG } from '../../utilidades/inscripciones-005b';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterios 7 y 8 (crítico, criterio 24 de 008, criterio 34 de 005): el orden de las comprobaciones de `PUT /api/alumnos/{id}/renovacion/comprobante` antes de leer el cuerpo: (a) sesión, 401 `NO_AUTENTICADO`; (b) academia suspendida, 403 `ACADEMIA_SUSPENDIDA`; (c) cambio de contraseña
// pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; (d) permiso, 403 `SIN_PERMISO` (`ALUMNO`, `ENTRENADOR`); (e) tipo y codificación, 400 `IMAGEN_NO_VALIDA`; (f) tamaño, 413 `CARGA_EXCESIVA`. Con (a) a (d) la API responde sin leer el cuerpo: una petición que declara 5 MB y no los envía
// recibe su 401 o 403 sin esperar. Ningún rechazo cambia nada ni deja un archivo.
// Lecturas estrictas elegidas: (1) «sin esperar» es una petición con `Content-Length` de exactamente 5 MiB y un cuerpo de unos cientos de bytes, con un plazo de 5 s; (2) el orden entre la cabecera inválida (400 `SOLICITUD_INVALIDA`) y el tipo o el tamaño no se fija aquí porque la spec no lo
// dice; sí se fija que (a) a (d) van antes que la cabecera; (3) el tipo (e) se decide antes que el tamaño (f).

const MB5 = 5 * 1024 * 1024;
const SIN_ESPERAR = { largoDeclarado: MB5, plazoMs: 5000 } as const;

describe('el orden de las comprobaciones del comprobante de la renovación (criterios 7 y 8)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumnoId: string;
  let alumnoCookie: string;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    alumnoId = alumno.alumnoId;
    alumnoCookie = alumno.cookie;
    cookies = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const datosValidos = () => datosComprobanteRenovacion(seleccionDeDiciembre(esc), '120.00', '2026-11-27');
  const subir = (cookie: string | undefined, extra: Omit<OpcionesDelComprobante, 'cookie'> = {}) =>
    renovarConComprobante(ctx, alumnoId, { cookie, datos: datosValidos(), ...extra });

  async function rechazados(
    intentos: readonly (readonly [string, () => Promise<RespuestaApi>])[],
    esperado: [number, string],
  ): Promise<string[]> {
    const antes = await instantaneaDeRenovacion(ctx, esc);
    const cuerpos: string[] = [];
    for (const [descripcion, hacer] of intentos) {
      const respuesta = await hacer();
      expect(
        [respuesta.status, codigoDeRespuesta(respuesta)],
        `${descripcion}: ${respuesta.texto.slice(0, 200)}`,
      ).toEqual(esperado);
      cuerpos.push(respuesta.texto);
    }
    expect(await instantaneaDeRenovacion(ctx, esc), 'un rechazo cambió la base, un archivo o la auditoría').toBe(antes);
    return cuerpos;
  }

  it('(a) sin sesión, con la sesión del Superadmin o con una cookie rota: 401 NO_AUTENTICADO sin esperar el cuerpo, antes que la cabecera, el tipo, el tamaño y el id', async () => {
    const sesiones: [string, string | undefined][] = [
      ['sin sesión', undefined],
      ['Superadmin', cookieDeSesion(esc.e.superadmin, INSTANTES.viernes27)],
      ['cookie rota', 'aq_sesion=no-es-un-token'],
    ];
    const intentos = sesiones.flatMap(([nombre, cookie]) => [
      [`${nombre}, 5 MB declarados`, () => subir(cookie, SIN_ESPERAR)] as const,
      [`${nombre}, sin cabecera`, () => subir(cookie, { ...SIN_ESPERAR, datos: null })] as const,
      [`${nombre}, tipo malo`, () => subir(cookie, { ...SIN_ESPERAR, tipo: 'image/gif' })] as const,
    ]);

    await rechazados(intentos, [401, 'NO_AUTENTICADO']);
  });

  it('(b) con la academia suspendida: 403 ACADEMIA_SUSPENDIDA sin esperar el cuerpo, para todos los roles y antes que el cambio de contraseña, el permiso, la cabecera, el tipo y el tamaño', async () => {
    await fijarEstadoDeAcademia(esc.e.A.id, 'SUSPENDIDA');
    await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });
    const roles = [cookies.admin, cookies.secretaria, cookies.entrenador, alumnoCookie];
    const intentos = roles.flatMap((cookie, i) => [
      [`rol ${i}, 5 MB declarados`, () => subir(cookie, SIN_ESPERAR)] as const,
      [`rol ${i}, sin cabecera`, () => subir(cookie, { ...SIN_ESPERAR, datos: null })] as const,
      [`rol ${i}, tipo malo`, () => subir(cookie, { ...SIN_ESPERAR, tipo: 'image/gif' })] as const,
    ]);

    await rechazados(intentos, [403, 'ACADEMIA_SUSPENDIDA']);
  });

  it('(c) con el cambio de contraseña pendiente: 403 CAMBIO_DE_CLAVE_OBLIGATORIO sin esperar el cuerpo, antes que el permiso, la cabecera, el tipo y el tamaño', async () => {
    await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });
    await actualizarUsuario(esc.e.A.id, esc.e.entrenadorA.id, { debe_cambiar_clave: true });
    const intentos = [cookies.secretaria, cookies.entrenador].flatMap((cookie, i) => [
      [`rol ${i}, 5 MB declarados`, () => subir(cookie, SIN_ESPERAR)] as const,
      [`rol ${i}, sin cabecera`, () => subir(cookie, { ...SIN_ESPERAR, datos: null })] as const,
      [`rol ${i}, tipo malo`, () => subir(cookie, { ...SIN_ESPERAR, tipo: 'image/gif' })] as const,
    ]);

    await rechazados(intentos, [403, 'CAMBIO_DE_CLAVE_OBLIGATORIO']);
  });

  it('(d) el entrenador y el alumno: 403 SIN_PERMISO sin leer el cuerpo, antes que la cabecera, el tipo, el tamaño y el id; también con un cuerpo real de 6 MB', async () => {
    const enorme = Buffer.concat([FIRMA_JPEG, Buffer.alloc(6 * 1024 * 1024)]);
    const intentos = [cookies.entrenador, alumnoCookie].flatMap((cookie, i) => [
      [`rol ${i}, 5 MB declarados`, () => subir(cookie, SIN_ESPERAR)] as const,
      [`rol ${i}, sin cabecera`, () => subir(cookie, { ...SIN_ESPERAR, datos: null })] as const,
      [`rol ${i}, tipo malo`, () => subir(cookie, { ...SIN_ESPERAR, tipo: 'image/gif' })] as const,
      [`rol ${i}, sin tipo`, () => subir(cookie, { ...SIN_ESPERAR, tipo: null })] as const,
      [`rol ${i}, cuerpo real de 6 MB`, () => subir(cookie, { cuerpo: enorme, tipo: 'image/jpeg' })] as const,
      [`rol ${i}, un texto como imagen`, () => subir(cookie, { cuerpo: Buffer.from('basura') })] as const,
    ]);

    await rechazados(intentos, [403, 'SIN_PERMISO']);
  });

  it('(e) el tipo se decide antes que el tamaño: un tipo malo con 5 MB declarados o con un cuerpo de 6 MB responde 400 IMAGEN_NO_VALIDA, no 413', async () => {
    const enorme = Buffer.concat([FIRMA_JPEG, Buffer.alloc(6 * 1024 * 1024)]);

    await rechazados(
      [
        [
          'tipo malo, 5 MB + 1 declarados',
          () => subir(cookies.secretaria, { largoDeclarado: MB5 + 1, plazoMs: 5000, tipo: 'image/gif' }),
        ],
        ['tipo malo, cuerpo de 6 MB', () => subir(cookies.secretaria, { cuerpo: enorme, tipo: 'image/gif' })],
        ['sin tipo, cuerpo de 6 MB', () => subir(cookies.secretaria, { cuerpo: enorme, tipo: null })],
      ],
      [400, 'IMAGEN_NO_VALIDA'],
    );
  });

  it('(f) el tamaño: más de 5 MiB declarados con un tipo bueno responde 413 CARGA_EXCESIVA sin esperar el cuerpo', async () => {
    await rechazados(
      [
        [
          '5 MiB + 1 declarados',
          () => subir(cookies.secretaria, { largoDeclarado: MB5 + 1, plazoMs: 5000, tipo: 'image/jpeg' }),
        ],
        [
          '10 MiB declarados',
          () => subir(cookies.secretaria, { largoDeclarado: 2 * MB5, plazoMs: 5000, tipo: 'image/png' }),
        ],
      ],
      [413, 'CARGA_EXCESIVA'],
    );
  });
});
