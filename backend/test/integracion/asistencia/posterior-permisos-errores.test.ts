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
  LUNES,
  resultadoDe,
} from '../../utilidades/escenario-asistencia';
import {
  cuerpoPosterior,
  ejecutarFaltas,
  inasistenciasDe,
  instantaneaDeFaltas,
  leerInasistencias,
  prepararEscenarioDe009b,
  RUTA_ASISTENCIA_POSTERIOR,
  registrarPosterior,
} from '../../utilidades/escenario-faltas';
import { sembrarCobrable } from '../../utilidades/escenario-pagos';
import { type Objeto } from '../../utilidades/inscripciones';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  CLAVE_COMUN,
  cookieDeUsuario,
  crearUsuarioDePrueba,
  fijarEstadoDeAcademia,
} from '../../utilidades/usuarios';

// Criterio 30 (crítico, D-16, D-23): permisos y errores del registro posterior. Los del criterio 6: `ADMIN` y `SECRETARIA` pasan; `ENTRENADOR` y `ALUMNO` reciben 403 `SIN_PERMISO` (con un cuerpo válido, inválido o con un alumno que no existe); sin sesión o con solo la
// del Superadmin, 401 `NO_AUTENTICADO`; con el cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; con la academia suspendida, 403 `ACADEMIA_SUSPENDIDA`; el actor que deja de ser vigente mientras la petición espera (`bloquearActorVigente`)
// recibe 401 antes que cualquier 201, 404 o 409. El 404 `NO_ENCONTRADO` del criterio 5: un alumno que no existe, que es de otra academia o que es un `CLIENTE`, con el mismo cuerpo y sin el id. Una fecha o una hora con otra forma, un motivo corto, largo o sin
// caracteres visibles, campos de más, una clave que no es UUID o campos que faltan responden 400 `SOLICITUD_INVALIDA` sin escribir. La prueba de aislamiento del criterio 16 vale también aquí: la academia sale de la sesión.
// Lecturas estrictas elegidas: `alumnoId` es un UUID en el cuerpo (`registrarAsistenciaPosteriorSchema`), así que solo se prueban como 404 los UUID que no son un alumno de la academia (no se decide aquí qué pasa con un texto que no es UUID); no se prueba qué pasa con
// una fecha de calendario imposible (`2026-02-30`), que la spec no define; un motivo de exactamente 3 y de exactamente 200 caracteres visibles se acepta; el motivo con espacios, ceros de ancho cero o el patrón Braille en blanco no cuenta como visible.

describe('permisos, errores y aislamiento del registro posterior (criterio 30)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;
  let galletas: ReturnType<typeof en>;

  const AHORA = enLima(LUNES, '19:30:00.000');

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDe009b(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc);
    galletas = en(ctx, esc, AHORA);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const enviar = (cuerpo: Objeto, cookie?: string, direccion?: string) =>
    ctx.http.post(direccion ?? RUTA_ASISTENCIA_POSTERIOR, cuerpo, { cookie });
  const valido = (sobre: Objeto = {}): Objeto => cuerpoPosterior(alumno.alumnoId, LUNES, '18:05', sobre);
  const desconocido = (): Objeto => cuerpoPosterior(randomUUID(), LUNES, '18:05');
  const invalido = (): Objeto => ({ alumnoId: 42, fecha: 20261116, claveIdempotencia: 'no-es-uuid', campoDeMas: true });
  const cookieDe = (rol: 'admin' | 'secretaria' | 'entrenador' | 'alumno'): string =>
    rol === 'alumno' ? alumno.cookie : galletas[rol];

  describe('quién registra', () => {
    it.each(['admin', 'secretaria'] as const)(
      'el rol %s pasa el permiso y registra la asistencia posterior (201)',
      async (rol) => {
        const respuesta = await enviar(valido(), cookieDe(rol));

        expect(respuesta.status, respuesta.texto.slice(0, 400)).toBe(201);
      },
    );

    it.each(['entrenador', 'alumno'] as const)(
      'el rol %s recibe 403 SIN_PERMISO sin escribir ni auditar, con un cuerpo válido, con uno inválido y con un alumno desconocido',
      async (rol) => {
        const antes = await instantaneaDeFaltas(esc.e);

        for (const cuerpo of [valido(), invalido(), desconocido()]) {
          const respuesta = await enviar(cuerpo, cookieDe(rol));
          expect(respuesta.status, `${rol}: ${respuesta.texto.slice(0, 200)}`).toBe(403);
          expect(codigoDeRespuesta(respuesta), rol).toBe('SIN_PERMISO');
        }
        expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
      },
    );

    it('sin sesión, 401 NO_AUTENTICADO, aun con un cuerpo inválido; el Superadmin y una cookie rota también reciben 401', async () => {
      const antes = await instantaneaDeFaltas(esc.e);

      const respuestas = [
        await enviar(valido()),
        await enviar(invalido()),
        await enviar(valido(), cookieDeSesion(esc.e.superadmin, AHORA)),
        await enviar(valido(), 'aq_sesion=no-es-un-token'),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(401);
        expect(codigoDeRespuesta(respuesta)).toBe('NO_AUTENTICADO');
      }
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
    });

    it('con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso y el cuerpo', async () => {
      await actualizarUsuario(A(), esc.e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), esc.e.entrenadorA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), alumno.usuarioId, { debe_cambiar_clave: true });

      for (const rol of ['secretaria', 'entrenador', 'alumno'] as const) {
        for (const cuerpo of [valido(), invalido()]) {
          const respuesta = await enviar(cuerpo, cookieDe(rol));
          expect(respuesta.status, rol).toBe(403);
          expect(codigoDeRespuesta(respuesta), rol).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
        }
      }
      expect(await asistenciasDe(A(), alumno.alumnoId)).toEqual([]);
    });

    it('con A suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso', async () => {
      await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');
      await actualizarUsuario(A(), esc.e.secretariaA.id, { debe_cambiar_clave: true });

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        const respuesta = await enviar(valido(), cookieDe(rol));
        expect(respuesta.status, rol).toBe(403);
        expect(codigoDeRespuesta(respuesta), rol).toBe('ACADEMIA_SUSPENDIDA');
      }
      expect(await asistenciasDe(A(), alumno.alumnoId)).toEqual([]);
    });

    it('el rol se lee de la base en cada petición: la secretaria que pasa a ENTRENADOR pierde el permiso al instante', async () => {
      await actualizarUsuario(A(), esc.e.secretariaA.id, { rol: 'ENTRENADOR' });

      const respuesta = await enviar(valido(), galletas.secretaria);

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([403, 'SIN_PERMISO']);
    });
  });

  describe('el actor deja de ser vigente mientras la petición espera: su 401 gana a cualquier 201 o 404', () => {
    it.each([
      ['un registro válido (daría 201)', 'valido'],
      ['un alumno desconocido (daría 404)', 'desconocido'],
    ] as const)(
      'criterio 30 (%s, desactivar): al confirmar la prueba la respuesta es 401 NO_AUTENTICADO y no se escribe ni se audita nada',
      async (_nombre, cual) => {
        const x = await crearUsuarioDePrueba({ academiaId: A(), rol: 'SECRETARIA', clave: CLAVE_COMUN });
        const cookieX = cookieDeUsuario(x, AHORA);
        const auditoriaAntes = await leerAuditoriaDeAcademia(A());

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: A(),
          actorId: x.id,
          cambio: 'desactivar',
          liberar: 'COMMIT',
          enviar: () => enviar(cual === 'valido' ? valido() : desconocido(), cookieX),
        });

        expect(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        expect(await asistenciasDe(A(), alumno.alumnoId)).toEqual([]);
        expect(await clasesUsadasDe(A(), alumno.matriculaId)).toBe(0);
        expect(await leerAuditoriaDeAcademia(A())).toEqual(auditoriaAntes);
      },
    );
  });

  describe('el 404 NO_ENCONTRADO del criterio 5', () => {
    it('un alumno que no existe, que es de otra academia o que es un CLIENTE responde el mismo 404 sin el id, sin escribir ni auditar', async () => {
      const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' });
      const cliente = await sembrarCobrable(esc.e);
      const antes = await instantaneaDeFaltas(esc.e);
      const cuerpos = new Set<string>();

      for (const id of [randomUUID(), deB.alumnoId, cliente.alumnoId]) {
        const respuesta = await enviar(cuerpoPosterior(id, LUNES, '18:05'), galletas.secretaria);
        expect([respuesta.status, codigoDeRespuesta(respuesta)], `${id}: ${respuesta.texto.slice(0, 200)}`).toEqual([
          404,
          'NO_ENCONTRADO',
        ]);
        expect(respuesta.texto, 'sin el id en el cuerpo').not.toContain(id);
        cuerpos.add(respuesta.texto.replaceAll(id, '<id>'));
      }

      expect(cuerpos.size, 'el mismo cuerpo para los tres').toBe(1);
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
    });
  });

  describe('400 SOLICITUD_INVALIDA sin escribir', () => {
    const variantes: [string, (c: Objeto, academiaDeB: string) => Objeto][] = [
      ['un campo de más (campoDeMas)', (c) => ({ ...c, campoDeMas: true })],
      ['un academiaId de B en el cuerpo', (c, academiaDeB) => ({ ...c, academiaId: academiaDeB })],
      ['una clave que no es UUID', (c) => ({ ...c, claveIdempotencia: 'no-es-un-uuid' })],
      ['sin clave', (c) => ({ ...c, claveIdempotencia: undefined })],
      ['sin alumnoId', (c) => ({ ...c, alumnoId: undefined })],
      ['sin fecha', (c) => ({ ...c, fecha: undefined })],
      ['sin horaLlegada', (c) => ({ ...c, horaLlegada: undefined })],
      ['sin motivo', (c) => ({ ...c, motivo: undefined })],
      ['una fecha con otra forma (16/11/2026)', (c) => ({ ...c, fecha: '16/11/2026' })],
      ['una fecha con hora (2026-11-16T00:00:00Z)', (c) => ({ ...c, fecha: '2026-11-16T00:00:00Z' })],
      ['una fecha sin ceros (2026-1-6)', (c) => ({ ...c, fecha: '2026-1-6' })],
      ['una fecha numérica', (c) => ({ ...c, fecha: 20261116 })],
      ['una fecha vacía', (c) => ({ ...c, fecha: '' })],
      ['una hora sin cero (18:5)', (c) => ({ ...c, horaLlegada: '18:5' })],
      ['una hora con segundos (18:05:00)', (c) => ({ ...c, horaLlegada: '18:05:00' })],
      ['una hora imposible (24:00)', (c) => ({ ...c, horaLlegada: '24:00' })],
      ['unos minutos imposibles (18:60)', (c) => ({ ...c, horaLlegada: '18:60' })],
      ['una hora sin dos puntos (1805)', (c) => ({ ...c, horaLlegada: '1805' })],
      ['una hora con sufijo (6:05 pm)', (c) => ({ ...c, horaLlegada: '6:05 pm' })],
      ['una hora vacía', (c) => ({ ...c, horaLlegada: '' })],
      ['una hora numérica', (c) => ({ ...c, horaLlegada: 1805 })],
      ['un motivo de 2 caracteres', (c) => ({ ...c, motivo: 'ab' })],
      ['un motivo de 201 caracteres', (c) => ({ ...c, motivo: 'm'.repeat(201) })],
      ['un motivo en blanco', (c) => ({ ...c, motivo: '     ' })],
      ['un motivo vacío', (c) => ({ ...c, motivo: '' })],
      ['un motivo de espacios de ancho cero', (c) => ({ ...c, motivo: '​​​​' })],
      ['un motivo con el patrón Braille en blanco', (c) => ({ ...c, motivo: '⠀⠀⠀⠀' })],
      ['un motivo con un carácter de control', (c) => ({ ...c, motivo: 'Llegó tarde\u0000' })],
      ['un motivo que no es texto', (c) => ({ ...c, motivo: 12345 })],
      ['un alumnoId que no es texto', (c) => ({ ...c, alumnoId: 42 })],
    ];

    it.each(variantes)(
      'un cuerpo con %s responde 400 SOLICITUD_INVALIDA sin escribir ni auditar',
      async (_nombre, variar) => {
        const antes = await instantaneaDeFaltas(esc.e);

        const respuesta = await enviar(variar(valido(), esc.e.B.id), galletas.secretaria);

        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(400);
        expect(codigoDeRespuesta(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
      },
    );

    it('un cuerpo que no es un objeto completo (lista o vacío) responde 400 SOLICITUD_INVALIDA', async () => {
      for (const cuerpo of [[], {}]) {
        const respuesta = await ctx.http.post(RUTA_ASISTENCIA_POSTERIOR, cuerpo, { cookie: galletas.secretaria });
        expect([respuesta.status, codigoDeRespuesta(respuesta)], JSON.stringify(cuerpo)).toEqual([
          400,
          'SOLICITUD_INVALIDA',
        ]);
      }
      expect(await asistenciasDe(A(), alumno.alumnoId)).toEqual([]);
    });

    it.each([
      ['de 3 caracteres', 'abc'],
      ['de 200 caracteres', 'm'.repeat(200)],
      ['con tildes y signos', 'Llegó 5 minutos antes; no se marcó (cámara caída).'],
    ])('un motivo %s se acepta (control)', async (_nombre, motivo) => {
      const respuesta = await enviar(valido({ motivo }), galletas.secretaria);

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
      expect((await asistenciasDe(A(), alumno.alumnoId))[0]?.motivo).toBe(motivo);
    });
  });

  describe('aislamiento entre academias (criterio 16 también aquí)', () => {
    it('con el mismo DNI y clases a la misma hora en A y en B, el alumno de B con la sesión de A responde 404 y no escribe en ninguna; el de A con la de B, también', async () => {
      const deA = await crearAlumnoDeAsistencia(ctx, esc, { dni: '47811902' });
      const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B', dni: '47811902' });
      const antes = await instantaneaDeFaltas(esc.e);

      const aConB = await enviar(cuerpoPosterior(deB.alumnoId, LUNES, '18:05'), galletas.secretaria);
      const bConA = await enviar(cuerpoPosterior(deA.alumnoId, LUNES, '18:05'), galletas.secretariaB);

      for (const respuesta of [aConB, bConA]) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
          404,
          'NO_ENCONTRADO',
        ]);
      }
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
    });

    it('?academiaId=<B> en la dirección no cambia nada: registra en A, con los datos de A', async () => {
      const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' });

      const respuesta = await enviar(
        valido(),
        galletas.secretaria,
        `${RUTA_ASISTENCIA_POSTERIOR}?academiaId=${esc.e.B.id}`,
      );

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
      expect(await asistenciasDe(A(), alumno.alumnoId)).toHaveLength(1);
      expect(await asistenciasDe(esc.e.B.id, deB.alumnoId)).toEqual([]);
    });

    it('el registro posterior de A no cubre ni toca las faltas de B, y la misma clave en las dos academias no choca', async () => {
      const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' });
      await ejecutarFaltas(ctx, enLima(LUNES, '19:00:00.000'));
      expect(await inasistenciasDe(esc.e.B.id, deB.alumnoId)).toHaveLength(1);
      const faltasDeBAntes = await leerInasistencias(esc.e.B.id);
      const clave = randomUUID();

      const enA = await registrarPosterior(ctx, galletas.secretaria, alumno.alumnoId, LUNES, '18:05', {
        claveIdempotencia: clave,
      });
      const enB = await registrarPosterior(ctx, galletas.secretariaB, deB.alumnoId, LUNES, '18:05', {
        claveIdempotencia: clave,
      });

      expect(resultadoDe(enA, 201).repetida).toBe(false);
      expect(resultadoDe(enB, 201).repetida).toBe(false);
      const faltasDeBDespues = await leerInasistencias(esc.e.B.id);
      expect(faltasDeBDespues.map((falta) => falta.alumno_id)).toEqual(faltasDeBAntes.map((falta) => falta.alumno_id));
      expect(
        faltasDeBDespues.every((falta) => falta.asistencia_id !== null),
        'la de B se cubrió con la asistencia de B',
      ).toBe(true);
      expect((await inasistenciasDe(A(), alumno.alumnoId))[0]?.asistencia_id).toBe(
        (await asistenciasDe(A(), alumno.alumnoId))[0]?.id,
      );
      expect((await asistenciasDe(esc.e.B.id, deB.alumnoId))[0]?.id).toBe(faltasDeBDespues[0]?.asistencia_id);
    });
  });
});
