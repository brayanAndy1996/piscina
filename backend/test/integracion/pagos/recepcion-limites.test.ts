// spec: 007-pagos (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AHORA_007,
  cookiesDePagos,
  crearEscenarioDePagos,
  type EscenarioPagos,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  codigoDe,
  crearAppInscripciones,
  cuerpoCotizacion,
  type RespuestaApi,
  rutaPublica,
} from '../../utilidades/inscripciones';
import { subirFoto } from '../../utilidades/inscripciones-005b';
import {
  actualizarUsuario,
  claimsDeUsuario,
  cookieDeUsuario,
  firmarTokenAcademia,
  NOMBRE_COOKIE_ACADEMIA,
} from '../../utilidades/usuarios';

// Criterio 33 (crítico, DR-20 de 005; criterios 25 y 33 de 005): una petición a una ruta pública de `/api/a/{nombreCorto}/…` con límite propio (`LIMITES_PUBLICOS`: lecturas, cotización, envío, consulta y foto) que
// trae una cookie `aq_sesion` válida de un `ADMIN` o una `SECRETARIA` activos, sin cambio de contraseña pendiente, de la academia de ese nombre corto, no suma en esos contadores ni recibe 429 por ellos. Cualquier otra
// (sin cookie, con una cookie inválida, vencida o de una versión de token anterior, de otra academia, de un `ENTRENADOR` o un `ALUMNO`, o con el cambio pendiente) cuenta como hasta ahora y nunca responde 401 ni 403
// por la cookie. El límite del ingreso (002) no cambia. Pruebas: con 10 envíos por hora agotados desde una conexión, la secretaria con su sesión envía el 11 (201) desde la misma conexión, y un anónimo desde ella
// sigue recibiendo 429; la cookie de la secretaria de A en una ruta de B cuenta. Cada prueba crea su aplicación y arranca con los contadores en cero.

describe('recepción sin los límites por conexión (criterio 33)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeEach(async () => {
    e = await crearEscenarioDePagos();
    ctx = await crearAppInscripciones({ conLimites: true, ahora: AHORA_007 });
    cookies = cookiesDePagos(e);
  });
  afterEach(async () => {
    await ctx?.http.cerrar();
  });

  const NO_ES_UN_TOKEN = 'A'.repeat(43);

  interface Limite {
    nombre: string;
    maximo: number;
    /** Una petición que cuenta en ese límite (con o sin la cookie, de A por defecto). */
    pedir: (cookie?: string, nombreCorto?: string) => Promise<RespuestaApi>;
  }

  const LIMITES: Limite[] = [
    {
      nombre: 'las lecturas (GET de la academia), 60 por minuto',
      maximo: 60,
      pedir: (cookie, nombreCorto = 'academia-a') => ctx.http.get(rutaPublica(nombreCorto), { cookie }),
    },
    {
      nombre: 'el formulario (GET), que comparte las 60 lecturas por minuto',
      maximo: 60,
      pedir: (cookie, nombreCorto = 'academia-a') => ctx.http.get(rutaPublica(nombreCorto, '/inscripcion'), { cookie }),
    },
    {
      nombre: 'la cotización, 30 por minuto',
      maximo: 30,
      pedir: (cookie, nombreCorto = 'academia-a') =>
        ctx.http.post(rutaPublica(nombreCorto, '/inscripcion/cotizacion'), cuerpoCotizacion(e), { cookie }),
    },
    {
      nombre: 'el envío, 10 por hora',
      maximo: 10,
      pedir: (cookie, nombreCorto = 'academia-a') =>
        ctx.http.post(rutaPublica(nombreCorto, '/inscripcion'), { basura: true }, { cookie }),
    },
    {
      nombre: 'la consulta de seguimiento, 10 por minuto',
      maximo: 10,
      pedir: (cookie, nombreCorto = 'academia-a') =>
        ctx.http.post(rutaPublica(nombreCorto, '/solicitudes/consulta'), { token: NO_ES_UN_TOKEN }, { cookie }),
    },
    {
      nombre: 'la foto, 10 por hora',
      maximo: 10,
      pedir: (cookie, nombreCorto = 'academia-a') =>
        subirFoto(ctx, nombreCorto, { token: NO_ES_UN_TOKEN, tipo: 'image/gif', headers: cookie ? { cookie } : {} }),
    },
  ];

  const esLimite = (respuesta: RespuestaApi, descripcion = '') => {
    expect(respuesta.status, `${descripcion} ${respuesta.texto}`).toBe(429);
    expect(codigoDe(respuesta)).toBe('DEMASIADAS_SOLICITUDES');
  };

  describe.each(LIMITES)('$nombre', (limite) => {
    it('criterio 33: la recepción (secretaria y administrador de A, en A) no suma en el contador ni recibe 429: hace más del máximo y después un anónimo todavía tiene todo el máximo', async () => {
      const estadosDeRecepcion: number[] = [];
      for (let i = 0; i < limite.maximo + 5; i++) {
        estadosDeRecepcion.push((await limite.pedir(i % 2 === 0 ? cookies.secretaria : cookies.admin)).status);
      }
      expect(
        estadosDeRecepcion.filter((estado) => estado === 429),
        'la recepción no recibe 429',
      ).toEqual([]);
      expect(
        estadosDeRecepcion.filter((estado) => estado === 401 || estado === 403),
        'ni 401 ni 403 por la cookie',
      ).toEqual([]);

      const estadosAnonimos: number[] = [];
      for (let i = 0; i < limite.maximo; i++) estadosAnonimos.push((await limite.pedir()).status);

      expect(
        estadosAnonimos.filter((estado) => estado === 429),
        'el anónimo conserva sus peticiones',
      ).toEqual([]);
      esLimite(await limite.pedir(), 'la siguiente del anónimo');
    });

    it('criterio 33: con el contador agotado por anónimos, la recepción sigue pasando desde la misma conexión y el anónimo sigue recibiendo 429', async () => {
      for (let i = 0; i < limite.maximo; i++) await limite.pedir();
      esLimite(await limite.pedir(), 'el anónimo, agotado');

      const secretaria = await limite.pedir(cookies.secretaria);
      const admin = await limite.pedir(cookies.admin);

      expect(secretaria.status, secretaria.texto).not.toBe(429);
      expect(admin.status, admin.texto).not.toBe(429);
      esLimite(await limite.pedir(), 'el anónimo, otra vez');
    });
  });

  describe('lo que no es recepción cuenta como hasta ahora y nunca responde 401 ni 403 por la cookie', () => {
    const enviar = (cookie?: string, nombreCorto = 'academia-a') =>
      ctx.http.post(rutaPublica(nombreCorto, '/inscripcion'), { basura: true }, { cookie });

    async function agotarElEnvio() {
      for (let i = 0; i < 10; i++) await enviar();
      esLimite(await enviar(), 'el anónimo, agotado');
    }

    it.each([
      ['sin cookie', () => undefined],
      ['con una cookie que no es un token', () => `${NOMBRE_COOKIE_ACADEMIA}=no-es-un-token`],
      [
        'con una cookie firmada con otro secreto',
        () =>
          `${NOMBRE_COOKIE_ACADEMIA}=${firmarTokenAcademia(claimsDeUsuario(e.secretariaA, AHORA_007), { secreto: 'otro-secreto-que-no-es-el-de-la-api-0123456789' })}`,
      ],
      [
        'con una cookie sin firma (alg none)',
        () =>
          `${NOMBRE_COOKIE_ACADEMIA}=${firmarTokenAcademia(claimsDeUsuario(e.secretariaA, AHORA_007), { algoritmo: 'none' })}`,
      ],
      [
        'con una cookie vencida (emitida hace 13 horas, dura 12)',
        () => cookieDeUsuario(e.secretariaA, new Date(AHORA_007.getTime() - 13 * 3_600_000)),
      ],
      ['con una cookie de una versión de token anterior', () => cookieDeUsuario(e.secretariaA, AHORA_007, {}, 7)],
      ['con la cookie de la secretaria de B (otra academia) en una ruta de A', () => cookies.secretariaB],
      ['con la cookie de un ENTRENADOR', () => cookies.entrenador],
      ['con la cookie de un ALUMNO', () => cookies.alumno],
    ])('criterio 33: %s: con el envío agotado, responde 429 (cuenta) y no 401 ni 403', async (_nombre, cookie) => {
      await agotarElEnvio();

      esLimite(await enviar(cookie()), 'la petición con esa cookie');
    });

    it('criterio 33: con el cambio de contraseña pendiente, una secretaria cuenta como anónima (429 con el envío agotado)', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA2.id, { debe_cambiar_clave: true });
      await agotarElEnvio();

      esLimite(await enviar(cookies.secretaria2), 'la secretaria con el cambio pendiente');
    });

    it('criterio 33: una cuenta desactivada cuenta como anónima aunque su cookie siga firmada y vigente (el estado se lee de la base)', async () => {
      await actualizarUsuario(e.A.id, e.adminA2.id, { estado: 'INACTIVO', version_token: 1 });
      await agotarElEnvio();

      esLimite(await enviar(cookies.admin2), 'el administrador desactivado');
    });

    it('criterio 33: la cookie de la secretaria de A en una ruta de B cuenta (el nombre corto de la dirección es el de otra academia)', async () => {
      for (let i = 0; i < 10; i++) await enviar(cookies.secretaria, 'academia-b');

      esLimite(await enviar(cookies.secretaria, 'academia-b'), 'la secretaria de A en B, agotada');
      esLimite(await enviar(), 'el anónimo en A comparte el contador con todas las academias');
    });

    it('criterio 33: sin el límite agotado, una cookie inválida o de otra academia se comporta como un anónimo: la lectura pública responde 200, no 401 ni 403', async () => {
      for (const cookie of [
        `${NOMBRE_COOKIE_ACADEMIA}=no-es-un-token`,
        cookies.secretariaB,
        cookies.alumno,
        cookieDeUsuario(e.secretariaA, new Date(AHORA_007.getTime() - 13 * 3_600_000)),
      ]) {
        const respuesta = await ctx.http.get(rutaPublica('academia-a'), { cookie });
        expect(respuesta.status, respuesta.texto).toBe(200);
      }
    });
  });

  describe('el límite del ingreso (002) no cambia', () => {
    it('criterio 33: la sesión de recepción no exime del límite de 10 por minuto del ingreso: el ingreso 11 responde 429 aunque traiga la cookie de la secretaria', async () => {
      const ingresar = (cookie?: string) =>
        ctx.http.post(
          rutaPublica('academia-a', '/sesion'),
          { usuario: '10000000', clave: 'no-es-la-clave' },
          { cookie },
        );
      for (let i = 0; i < 10; i++) expect((await ingresar(cookies.secretaria)).status).toBe(401);

      const undecima = await ingresar(cookies.secretaria);
      const anonima = await ingresar();

      esLimite(undecima, 'el ingreso 11 con la cookie de la secretaria');
      esLimite(anonima, 'el ingreso 11 sin cookie');
    });
  });
});
