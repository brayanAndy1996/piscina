// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  codigoDeRespuesta,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  filaAsistenciaValida,
  insertarAsistencia,
  LUNES,
} from '../../utilidades/escenario-asistencia';
import {
  consultaDe,
  consultarMes,
  filaInasistenciaValida,
  insertarInasistencia,
  instantaneaDeFaltas,
  prepararEscenarioDe009b,
  rutaAsistenciasDelMes,
} from '../../utilidades/escenario-faltas';
import { sembrarCobrable } from '../../utilidades/escenario-pagos';
import { sinUuid } from '../../utilidades/inscripciones';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 31 (crítico, sección 2.1, D-29, D-23), permisos y errores: la consulta es del personal de recepción (`VER_REPORTES_ASISTENCIA` con alcance `TODO`: `ADMIN` y `SECRETARIA`); en esta historia `ENTRENADOR` (`SUS_CLASES`) y `ALUMNO` (`PROPIO`) reciben
// 403 `SIN_PERMISO` (sus vistas son de la 012 y la 011), también sobre sí mismo; sin sesión o con solo la del Superadmin, 401 `NO_AUTENTICADO`; con el cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; con la academia suspendida, 403
// `ACADEMIA_SUSPENDIDA`. Los 404 del criterio 5 de la 008 (un id que no es UUID, que no existe, que es de otra academia o que es de un `CLIENTE`, con el mismo cuerpo y sin el id). Un `mes` con otra forma, repetido o fuera de 2000-01 a 9999-12, 400
// `SOLICITUD_INVALIDA`. Aislamiento entre academias y entre alumnos: la respuesta solo lleva los registros de ese alumno y de su academia.
// Lecturas estrictas elegidas: el orden de las comprobaciones es el de la 002 (sesión → academia activa → cambio de contraseña → permiso → parámetro y alumno); un `mes` vacío o con espacios no se prueba (la spec no dice si cae al mes en curso o es un 400), ni qué gana entre el 400 del mes y el 404 del alumno
// cuando fallan los dos; `?academiaId=` en la dirección no surte efecto.

describe('permisos, errores y aislamiento de la consulta del mes (criterio 31)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;
  let galletas: ReturnType<typeof en>;

  const AHORA = enLima('2026-11-17', '10:00:00.000');

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
  const cookieDe = (rol: 'admin' | 'secretaria' | 'entrenador' | 'alumno'): string =>
    rol === 'alumno' ? alumno.cookie : galletas[rol];

  describe('quién consulta', () => {
    it.each(['admin', 'secretaria'] as const)(
      'el rol %s consulta la asistencia del mes de un alumno (200)',
      async (rol) => {
        const respuesta = await consultarMes(ctx, cookieDe(rol), alumno.alumnoId, '2026-11');

        expect(consultaDe(respuesta).mes).toBe('2026-11');
      },
    );

    it.each(['entrenador', 'alumno'] as const)(
      'el rol %s recibe 403 SIN_PERMISO, también sobre sí mismo y con un mes inválido o un alumno desconocido',
      async (rol) => {
        const intentos = [
          consultarMes(ctx, cookieDe(rol), alumno.alumnoId, '2026-11'),
          consultarMes(ctx, cookieDe(rol), alumno.alumnoId, 'no-es-un-mes'),
          consultarMes(ctx, cookieDe(rol), randomUUID(), '2026-11'),
        ];

        for (const respuesta of await Promise.all(intentos)) {
          expect(respuesta.status, `${rol}: ${respuesta.texto.slice(0, 200)}`).toBe(403);
          expect(codigoDeRespuesta(respuesta), rol).toBe('SIN_PERMISO');
        }
      },
    );

    it('sin sesión, 401 NO_AUTENTICADO, aun con un mes inválido o un alumno desconocido; el Superadmin y una cookie rota también reciben 401', async () => {
      const respuestas = [
        await consultarMes(ctx, undefined, alumno.alumnoId, '2026-11'),
        await consultarMes(ctx, undefined, alumno.alumnoId, 'no-es-un-mes'),
        await consultarMes(ctx, undefined, randomUUID()),
        await consultarMes(ctx, cookieDeSesion(esc.e.superadmin, AHORA), alumno.alumnoId, '2026-11'),
        await consultarMes(ctx, 'aq_sesion=no-es-un-token', alumno.alumnoId, '2026-11'),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(401);
        expect(codigoDeRespuesta(respuesta)).toBe('NO_AUTENTICADO');
      }
    });

    it('con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso y el parámetro', async () => {
      await actualizarUsuario(A(), esc.e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), esc.e.entrenadorA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), alumno.usuarioId, { debe_cambiar_clave: true });

      for (const rol of ['secretaria', 'entrenador', 'alumno'] as const) {
        for (const mes of ['2026-11', 'no-es-un-mes']) {
          const respuesta = await consultarMes(ctx, cookieDe(rol), alumno.alumnoId, mes);
          expect([respuesta.status, codigoDeRespuesta(respuesta)], `${rol} ${mes}`).toEqual([
            403,
            'CAMBIO_DE_CLAVE_OBLIGATORIO',
          ]);
        }
      }
    });

    it('con A suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso', async () => {
      await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');
      await actualizarUsuario(A(), esc.e.secretariaA.id, { debe_cambiar_clave: true });

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        const respuesta = await consultarMes(ctx, cookieDe(rol), alumno.alumnoId, '2026-11');
        expect([respuesta.status, codigoDeRespuesta(respuesta)], rol).toEqual([403, 'ACADEMIA_SUSPENDIDA']);
      }
    });

    it('el rol se lee de la base en cada petición: la secretaria que pasa a ENTRENADOR pierde el permiso al instante', async () => {
      await actualizarUsuario(A(), esc.e.secretariaA.id, { rol: 'ENTRENADOR' });

      const respuesta = await consultarMes(ctx, galletas.secretaria, alumno.alumnoId, '2026-11');

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([403, 'SIN_PERMISO']);
    });
  });

  describe('el 404 NO_ENCONTRADO del criterio 5 de la 008', () => {
    it('un id que no es UUID, que no existe, que es de otra academia o que es de un CLIENTE responde el mismo 404 sin el id, sin escribir ni auditar', async () => {
      const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' });
      const cliente = await sembrarCobrable(esc.e);
      const antes = await instantaneaDeFaltas(esc.e);
      const auditoriaAntes = await leerAuditoriaDeAcademia(A());
      const ids = [
        'no-es-un-uuid',
        'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
        `${randomUUID()}x`,
        randomUUID(),
        deB.alumnoId,
        cliente.alumnoId,
      ];
      const cuerpos = new Set<string>();

      for (const id of ids) {
        const respuesta = await consultarMes(ctx, galletas.secretaria, id, '2026-11');
        expect([respuesta.status, codigoDeRespuesta(respuesta)], `${id}: ${respuesta.texto.slice(0, 200)}`).toEqual([
          404,
          'NO_ENCONTRADO',
        ]);
        expect(respuesta.texto, 'sin el id en el cuerpo').not.toContain(id);
        cuerpos.add(sinUuid(respuesta.texto));
      }

      expect(cuerpos.size, 'el mismo cuerpo para todos los casos').toBe(1);
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
      expect(await leerAuditoriaDeAcademia(A())).toEqual(auditoriaAntes);
    });
  });

  describe('400 SOLICITUD_INVALIDA con un mes inválido', () => {
    it.each([
      '2026-13',
      '2026-00',
      '2026-1',
      '26-11',
      '2026/11',
      '2026-11-01',
      '202611',
      'noviembre',
      '1999-12',
      '10000-01',
      '0999-12',
      '2026-11x',
    ])('el mes «%s» responde 400 SOLICITUD_INVALIDA sin escribir', async (mes) => {
      const antes = await instantaneaDeFaltas(esc.e);

      const respuesta = await ctx.http.get(
        `/api/alumnos/${alumno.alumnoId}/asistencias?mes=${encodeURIComponent(mes)}`,
        {
          cookie: galletas.secretaria,
        },
      );

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        400,
        'SOLICITUD_INVALIDA',
      ]);
      expect(await instantaneaDeFaltas(esc.e)).toBe(antes);
    });

    it('un mes repetido (?mes=2026-11&mes=2026-10) responde 400 SOLICITUD_INVALIDA', async () => {
      const respuesta = await ctx.http.get(`/api/alumnos/${alumno.alumnoId}/asistencias?mes=2026-11&mes=2026-10`, {
        cookie: galletas.secretaria,
      });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        400,
        'SOLICITUD_INVALIDA',
      ]);
    });

    it.each(['2000-01', '9999-12', '2026-02', '2026-12'])('el mes «%s» es válido (200)', async (mes) => {
      const respuesta = await consultarMes(ctx, galletas.secretaria, alumno.alumnoId, mes);

      expect(consultaDe(respuesta).mes).toBe(mes);
    });
  });

  describe('aislamiento entre academias y entre alumnos', () => {
    /** Una asistencia y una falta del alumno el lunes 16/11 y el 23/11, para reconocer sus registros. */
    async function conRegistros(
      a: AlumnoDeAsistencia,
      claseId: string,
      usuarioId: string,
      fechas: [string, string],
    ): Promise<void> {
      const llegada = enLima(fechas[0], '18:03');
      await insertarAsistencia(
        'propietario',
        a.academiaId,
        filaAsistenciaValida(
          { alumnoId: a.alumnoId, matriculaId: a.matriculaId, claseId, usuarioId },
          { fecha: fechas[0], llegada_en: llegada, registrado_en: llegada },
        ),
      );
      await insertarInasistencia(
        'propietario',
        a.academiaId,
        filaInasistenciaValida({ alumnoId: a.alumnoId, matriculaId: a.matriculaId, claseId }, { fecha: fechas[1] }),
      );
    }

    it('con el mismo DNI y clases a la misma hora en A y en B, el alumno de B con la sesión de A responde 404 y el de A con la de B, también; cada uno ve solo lo suyo', async () => {
      const deA = await crearAlumnoDeAsistencia(ctx, esc, { dni: '47811902' });
      const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B', dni: '47811902' });
      await conRegistros(deA, esc.e.lunes.id, esc.e.secretariaA.id, [LUNES, '2026-11-23']);
      await conRegistros(deB, esc.e.lunesB.id, esc.e.secretariaB.id, ['2026-11-09', '2026-11-30']);

      const aConB = await consultarMes(ctx, galletas.secretaria, deB.alumnoId, '2026-11');
      const bConA = await consultarMes(ctx, galletas.secretariaB, deA.alumnoId, '2026-11');
      const propiaA = consultaDe(await consultarMes(ctx, galletas.secretaria, deA.alumnoId, '2026-11'));
      const propiaB = consultaDe(await consultarMes(ctx, galletas.secretariaB, deB.alumnoId, '2026-11'));

      for (const respuesta of [aConB, bConA]) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
          404,
          'NO_ENCONTRADO',
        ]);
      }
      expect(propiaA.registros.map((registro) => registro.fecha)).toEqual([LUNES, '2026-11-23']);
      expect(propiaB.registros.map((registro) => registro.fecha)).toEqual(['2026-11-09', '2026-11-30']);
    });

    it('?academiaId=<B> en la dirección no cambia la academia: el alumno de B sigue siendo un 404 para A y el de A se sirve con sus datos', async () => {
      const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' });

      const aConB = await ctx.http.get(`${rutaAsistenciasDelMes(deB.alumnoId, '2026-11')}&academiaId=${esc.e.B.id}`, {
        cookie: galletas.secretaria,
      });
      const propia = await ctx.http.get(
        `${rutaAsistenciasDelMes(alumno.alumnoId, '2026-11')}&academiaId=${esc.e.B.id}`,
        { cookie: galletas.secretaria },
      );

      expect([aConB.status, codigoDeRespuesta(aConB)]).toEqual([404, 'NO_ENCONTRADO']);
      expect(consultaDe(propia).matricula).toEqual({ clasesTotales: 12, clasesUsadas: 0, clasesRestantes: 12 });
    });

    it('entre alumnos de la misma academia: la consulta de un alumno no lleva los registros de otro, ni su matrícula', async () => {
      const otro = await crearAlumnoDeAsistencia(ctx, esc, { clasesUsadas: 7 });
      await conRegistros(otro, esc.e.lunes.id, esc.e.secretariaA.id, [LUNES, '2026-11-23']);

      const delOtro = consultaDe(await consultarMes(ctx, galletas.secretaria, otro.alumnoId, '2026-11'));
      const delAlumno = consultaDe(await consultarMes(ctx, galletas.secretaria, alumno.alumnoId, '2026-11'));

      expect(delOtro.registros).toHaveLength(2);
      expect(delOtro.matricula).toEqual({ clasesTotales: 12, clasesUsadas: 7, clasesRestantes: 5 });
      expect(delAlumno.registros).toEqual([]);
      expect(delAlumno.matricula).toEqual({ clasesTotales: 12, clasesUsadas: 0, clasesRestantes: 12 });
    });
  });
});
