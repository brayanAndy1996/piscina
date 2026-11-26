// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conFilaRetenida } from '../../utilidades/carreras';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  asistenciasDe,
  clasesUsadasDe,
  codigoDeRespuesta,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  instantaneaDeAsistencia,
  leerAsistencias,
  LUNES,
  marcarManual,
  marcarPorQr,
  prepararEscenarioDeAsistencia,
  RUTA_ASISTENCIA_MANUAL,
  RUTA_ASISTENCIA_QR,
} from '../../utilidades/escenario-asistencia';
import type { Objeto } from '../../utilidades/inscripciones';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  CLAVE_COMUN,
  cookieDeUsuario,
  crearUsuarioDePrueba,
  fijarEstadoDeAcademia,
} from '../../utilidades/usuarios';

// Criterio 6 (crítico, sección 2.1, D-29, DT-5 de 002): las dos rutas de `/api/asistencias` son del `ADMIN` y la `SECRETARIA` (`REGISTRAR_ASISTENCIA`). `ENTRENADOR` y `ALUMNO` reciben 403 `SIN_PERMISO` (también sobre sí mismos y con un cuerpo
// inválido o un alumno que no existe); sin sesión o con solo la del Superadmin, 401 `NO_AUTENTICADO`; con el cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; con la academia suspendida, 403 `ACADEMIA_SUSPENDIDA`. Un cuerpo que no cumple
// su esquema (campos de más, como `academiaId`; una clave que no es UUID; `contenido` que no es texto o pasa de 200) responde 400 `SOLICITUD_INVALIDA` sin escribir. Cada transacción llama a `bloquearActorVigente` como primera sentencia, y su 401 gana a
// cualquier 404 o 409. La academia sale siempre de la sesión. Ningún rechazo escribe ni audita. Orden de las comprobaciones (002): sesión → academia activa → cambio de contraseña → permiso → cuerpo → operación.
// Lectura estricta elegida: el 401 de un actor que dejó de ser vigente mientras la petición esperaba el bloqueo de su fila se prueba con una petición que sin él habría dado 201, 404 o 409.

type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';
type Ruta = 'QR' | 'MANUAL';

describe('permisos de las rutas de asistencia (criterio 6)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;
  let galletas: ReturnType<typeof en>;

  const HORA = enLima(LUNES, '18:05:00.000');

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc);
    galletas = en(ctx, esc, HORA);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const cookieDe = (rol: Rol): string => (rol === 'alumno' ? alumno.cookie : galletas[rol]);
  const enviar = (ruta: Ruta, cuerpo: Objeto, cookie?: string, direccion?: string) =>
    ctx.http.post(direccion ?? (ruta === 'QR' ? RUTA_ASISTENCIA_QR : RUTA_ASISTENCIA_MANUAL), cuerpo, { cookie });
  const valido = (ruta: Ruta): Objeto =>
    ruta === 'QR'
      ? { contenido: alumno.contenido, claveIdempotencia: randomUUID() }
      : { alumnoId: alumno.alumnoId, claveIdempotencia: randomUUID() };
  /** Un cuerpo con la forma correcta que, de pasar el permiso, daría 404. */
  const desconocido = (ruta: Ruta): Objeto =>
    ruta === 'QR'
      ? { contenido: `AQ1:${'C'.repeat(43)}`, claveIdempotencia: randomUUID() }
      : { alumnoId: randomUUID(), claveIdempotencia: randomUUID() };
  const invalido = (ruta: Ruta): Objeto =>
    ruta === 'QR'
      ? { contenido: 42, claveIdempotencia: 'no-es-uuid', campoDeMas: true }
      : { alumnoId: 42, claveIdempotencia: 'no-es-uuid', campoDeMas: true };

  describe.each<Ruta>(['QR', 'MANUAL'])('POST /api/asistencias/%s', (ruta) => {
    it.each(['admin', 'secretaria'] as const)(
      'el rol %s pasa el permiso y registra la asistencia (201)',
      async (rol) => {
        const respuesta = await enviar(ruta, valido(ruta), cookieDe(rol));

        expect(respuesta.status, respuesta.texto.slice(0, 400)).toBe(201);
      },
    );

    it.each(['entrenador', 'alumno'] as const)(
      'el rol %s recibe 403 SIN_PERMISO sin escribir ni auditar, con un cuerpo válido, con uno inválido y con un alumno desconocido',
      async (rol) => {
        const antes = await instantaneaDeAsistencia(esc.e);

        for (const cuerpo of [valido(ruta), invalido(ruta), desconocido(ruta)]) {
          const respuesta = await enviar(ruta, cuerpo, cookieDe(rol));
          expect(respuesta.status, `${rol}: ${respuesta.texto.slice(0, 200)}`).toBe(403);
          expect(codigoDeRespuesta(respuesta), rol).toBe('SIN_PERMISO');
        }
        expect(await instantaneaDeAsistencia(esc.e)).toBe(antes);
      },
    );

    it('sin sesión, 401 NO_AUTENTICADO, aun con un cuerpo inválido; el Superadmin y una cookie rota también reciben 401', async () => {
      const antes = await instantaneaDeAsistencia(esc.e);

      const respuestas = [
        await enviar(ruta, valido(ruta)),
        await enviar(ruta, invalido(ruta)),
        await enviar(ruta, valido(ruta), cookieDeSesion(esc.e.superadmin, HORA)),
        await enviar(ruta, valido(ruta), 'aq_sesion=no-es-un-token'),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(401);
        expect(codigoDeRespuesta(respuesta)).toBe('NO_AUTENTICADO');
      }
      expect(await instantaneaDeAsistencia(esc.e)).toBe(antes);
    });

    it('con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso y el cuerpo', async () => {
      await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(esc.e.A.id, esc.e.entrenadorA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(esc.e.A.id, alumno.usuarioId, { debe_cambiar_clave: true });

      for (const rol of ['secretaria', 'entrenador', 'alumno'] as const) {
        for (const cuerpo of [valido(ruta), invalido(ruta)]) {
          const respuesta = await enviar(ruta, cuerpo, cookieDe(rol));
          expect(respuesta.status, rol).toBe(403);
          expect(codigoDeRespuesta(respuesta), rol).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
        }
      }
      expect(await leerAsistencias(esc.e.A.id)).toEqual([]);
    });

    it('con A suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso', async () => {
      await fijarEstadoDeAcademia(esc.e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        const respuesta = await enviar(ruta, valido(ruta), cookieDe(rol));
        expect(respuesta.status, rol).toBe(403);
        expect(codigoDeRespuesta(respuesta), rol).toBe('ACADEMIA_SUSPENDIDA');
      }
      expect(await leerAsistencias(esc.e.A.id)).toEqual([]);
    });

    it('el rol se lee de la base en cada petición: la secretaria que pasa a ENTRENADOR pierde el permiso al instante', async () => {
      await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { rol: 'ENTRENADOR' });

      const respuesta = await enviar(ruta, valido(ruta), galletas.secretaria);

      expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(403);
      expect(codigoDeRespuesta(respuesta)).toBe('SIN_PERMISO');
    });

    const variantes: [string, (c: Objeto, academiaDeB: string) => Objeto][] = [
      ['un campo de más (campoDeMas)', (c) => ({ ...c, campoDeMas: true })],
      ['un academiaId de B en el cuerpo', (c, academiaDeB) => ({ ...c, academiaId: academiaDeB })],
      ['una clave que no es UUID', (c) => ({ ...c, claveIdempotencia: 'no-es-un-uuid' })],
      ['una clave vacía', (c) => ({ ...c, claveIdempotencia: '' })],
      ['sin clave', (c) => ({ ...c, claveIdempotencia: undefined })],
      ['una clave que no es texto', (c) => ({ ...c, claveIdempotencia: 123 })],
    ];
    it.each(variantes)(
      'un cuerpo con %s responde 400 SOLICITUD_INVALIDA sin escribir ni auditar',
      async (_nombre, variar) => {
        const antes = await instantaneaDeAsistencia(esc.e);

        const respuesta = await enviar(ruta, variar(valido(ruta), esc.e.B.id), galletas.secretaria);

        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(400);
        expect(codigoDeRespuesta(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await instantaneaDeAsistencia(esc.e)).toBe(antes);
      },
    );

    it('un cuerpo que no es un objeto completo (lista o vacío) responde 400 SOLICITUD_INVALIDA', async () => {
      for (const cuerpo of [[], {}]) {
        const respuesta = await ctx.http.post(ruta === 'QR' ? RUTA_ASISTENCIA_QR : RUTA_ASISTENCIA_MANUAL, cuerpo, {
          cookie: galletas.secretaria,
        });
        expect([respuesta.status, codigoDeRespuesta(respuesta)], JSON.stringify(cuerpo)).toEqual([
          400,
          'SOLICITUD_INVALIDA',
        ]);
      }
      expect(await leerAsistencias(esc.e.A.id)).toEqual([]);
    });

    it('la academia sale de la sesión: ?academiaId=<B> en la dirección no cambia nada (marca en A, con los datos de A)', async () => {
      const direccion = `${ruta === 'QR' ? RUTA_ASISTENCIA_QR : RUTA_ASISTENCIA_MANUAL}?academiaId=${esc.e.B.id}`;

      const respuesta = await enviar(ruta, valido(ruta), galletas.secretaria, direccion);

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
      expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
      expect(await leerAsistencias(esc.e.B.id)).toEqual([]);
    });
  });

  describe('el actor deja de ser vigente mientras la petición espera: su 401 gana a cualquier 201, 404 o 409', () => {
    interface Caso {
      nombre: string;
      /** Prepara lo que la petición necesita y devuelve la petición. */
      peticion: (cookie: string) => Promise<{ status: number; body: Objeto | null; texto: string }>;
      esperado: string;
    }

    const casos = (): Caso[] => [
      {
        nombre: 'QR válido (daría 201)',
        peticion: (cookie) => marcarPorQr(ctx, cookie, alumno.contenido),
        esperado: '201',
      },
      {
        nombre: 'manual válido (daría 201)',
        peticion: (cookie) => marcarManual(ctx, cookie, alumno.alumnoId),
        esperado: '201',
      },
      {
        nombre: 'QR desconocido (daría 404)',
        peticion: (cookie) => marcarPorQr(ctx, cookie, `AQ1:${'D'.repeat(43)}`),
        esperado: '404',
      },
      {
        nombre: 'alumno manual desconocido (daría 404)',
        peticion: (cookie) => marcarManual(ctx, cookie, randomUUID()),
        esperado: '404',
      },
    ];

    it.each(
      casos().flatMap((caso, indice) =>
        (['desactivar', 'solo-version'] as const).map((cambio) => ({ indice, nombre: caso.nombre, cambio })),
      ),
    )(
      'criterio 6 ($nombre, $cambio): al confirmar la prueba la respuesta es 401 NO_AUTENTICADO y no se escribe ni se audita nada',
      async ({ indice, cambio }) => {
        const x = await crearUsuarioDePrueba({ academiaId: esc.e.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
        const cookieX = cookieDeUsuario(x, HORA);
        const auditoriaAntes = await leerAuditoriaDeAcademia(esc.e.A.id);
        const caso = casos()[indice] as Caso;

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: esc.e.A.id,
          actorId: x.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => caso.peticion(cookieX),
        });

        expect(
          esperoElBloqueo,
          'la petición debía quedar esperando el bloqueo de la fila del actor (bloquearActorVigente)',
        ).toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        expect(await leerAsistencias(esc.e.A.id)).toEqual([]);
        expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(0);
        expect(await leerAuditoriaDeAcademia(esc.e.A.id)).toEqual(auditoriaAntes);
      },
    );

    it('criterio 6 (control): si la prueba solo bloquea la fila del actor y hace ROLLBACK, la petición espera y responde lo suyo (201)', async () => {
      const x = await crearUsuarioDePrueba({ academiaId: esc.e.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
      const cookieX = cookieDeUsuario(x, HORA);

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: esc.e.A.id,
        actorId: x.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'ROLLBACK',
        enviar: () => marcarManual(ctx, cookieX, alumno.alumnoId),
      });

      expect(esperoElBloqueo, 'debía pasar por el bloqueo de la fila del actor').toBe(true);
      expect(resultado.status, resultado.texto.slice(0, 300)).toBe(201);
      expect((await asistenciasDe(esc.e.A.id, alumno.alumnoId))[0]?.registrado_por).toBe(x.id);
    });
  });
});
