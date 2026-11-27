// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AlumnoDeAsistencia, en } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  ACCION_HORARIO,
  cambiarHorario,
  cambioDe,
  clasesDeLaMatricula,
  codigoDeRespuesta,
  crearAlumnoDeHorario,
  type EscenarioDeHorario,
  instantaneaDeHorario,
  ordenados,
  prepararEscenarioDeHorario,
  resumen,
  rutaHorario,
} from '../../utilidades/escenario-horario';
import { instantaneaDeLaAcademia } from '../../utilidades/escenario-pagos';
import { INSTANTES } from '../../utilidades/escenario-renovacion';
import { type Objeto, type RespuestaApi, sembrarSolicitud, sinUuid } from '../../utilidades/inscripciones';
import { crearClaseDePrueba } from '../../utilidades/planes-clases';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 41 (crítico, sección 2.1, D-14, D-23, D-29): `MODIFICAR_HORARIO_ALUMNO` (`ADMIN` y `SECRETARIA`); `ENTRENADOR` y `ALUMNO`, 403 (HU-03: el alumno no cambia su horario; D-14); las demás respuestas de acceso del criterio 17 (sin sesión o con solo la del Superadmin, 401; cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; academia suspendida,
// 403 `ACADEMIA_SUSPENDIDA`; un cuerpo con campos de más, 400 `SOLICITUD_INVALIDA`). Un `{id}` que no es UUID, inexistente, de otra academia o de un `CLIENTE`: 404 `NO_ENCONTRADO`; una clase de otra academia, `SELECCION_NO_VALIDA`. `HEAD` sobre `/api/matriculas` responde 404.
// Orden de las comprobaciones (002): sesión → academia activa → cambio de contraseña → permiso → cuerpo → operación. Lecturas estrictas elegidas: (1) el rol se lee de la base en cada petición; (2) el 400 de un cuerpo con campos de más va antes que cualquier 404 o 409 de la operación pero después del permiso (como en el criterio 17 de la 010a); (3) el 404 de una matrícula de otra academia, de un `CLIENTE` o inexistente
// es el mismo (el mismo cuerpo, sin ids); (4) «una clase de otra academia» responde lo mismo que clases que no existen en ninguna academia; (5) `?academiaId=` no cambia nada; (6) `HEAD` responde 404 con la sesión de cualquier rol, también sobre la ruta del cambio.

type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';

describe('permisos y aislamiento del cambio de horario (criterio 41)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeHorario;
  let alumno: AlumnoDeAsistencia;
  let galletas: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeHorario(ctx);
    alumno = await crearAlumnoDeHorario(ctx, esc);
    galletas = en(ctx, esc, INSTANTES.jueves26);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const delLunes17 = () => [esc.e.lunes17.id, esc.e.miercoles.id, esc.e.viernes.id];
  const cookieDe = (rol: Rol): string => (rol === 'alumno' ? alumno.cookie : galletas[rol]);
  const enviar = (cookie: string | undefined, matriculaId: string, sobre: Objeto = {}): Promise<RespuestaApi> =>
    cambiarHorario(ctx, cookie, matriculaId, delLunes17(), sobre);

  describe('quién puede cambiar el horario', () => {
    it.each(['admin', 'secretaria'] as const)('el rol %s pasa el permiso y cambia el horario (200)', async (rol) => {
      const respuesta = await enviar(cookieDe(rol), alumno.matriculaId);

      expect(respuesta.status, respuesta.texto.slice(0, 400)).toBe(200);
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(ordenados(delLunes17()));
    });

    it.each(['entrenador', 'alumno'] as const)(
      'el rol %s recibe 403 SIN_PERMISO sin escribir ni auditar, con una petición válida, con campos de más, con una matrícula que no existe y con un id que no es UUID',
      async (rol) => {
        const antes = await instantaneaDeHorario(esc);

        const respuestas = [
          await enviar(cookieDe(rol), alumno.matriculaId),
          await enviar(cookieDe(rol), alumno.matriculaId, { campoDeMas: true }),
          await enviar(cookieDe(rol), randomUUID()),
          await enviar(cookieDe(rol), 'no-es-un-uuid'),
        ];

        for (const respuesta of respuestas) {
          expect([respuesta.status, codigoDeRespuesta(respuesta)], `${rol}: ${respuesta.texto.slice(0, 200)}`).toEqual([
            403,
            'SIN_PERMISO',
          ]);
        }
        expect(await instantaneaDeHorario(esc)).toBe(antes);
        expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).toEqual([]);
      },
    );

    it('el alumno no cambia su propio horario desde su cuenta (HU-03, D-14): 403 SIN_PERMISO sobre su propia matrícula', async () => {
      const respuesta = await enviar(alumno.cookie, alumno.matriculaId);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        403,
        'SIN_PERMISO',
      ]);
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(
        ordenados([esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id]),
      );
    });

    it('el rol se lee de la base en cada petición: la secretaria que pasa a ENTRENADOR pierde el permiso al instante', async () => {
      await actualizarUsuario(A(), esc.e.secretariaA.id, { rol: 'ENTRENADOR' });

      const respuesta = await enviar(galletas.secretaria, alumno.matriculaId);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        403,
        'SIN_PERMISO',
      ]);
    });
  });

  describe('sesión, contraseña y academia', () => {
    it('sin sesión, 401 NO_AUTENTICADO, aun con campos de más o una matrícula que no existe; el Superadmin y una cookie rota también reciben 401', async () => {
      const antes = await instantaneaDeHorario(esc);

      const respuestas = [
        await enviar(undefined, alumno.matriculaId),
        await enviar(undefined, alumno.matriculaId, { campoDeMas: true }),
        await enviar(undefined, randomUUID()),
        await enviar(cookieDeSesion(esc.e.superadmin, INSTANTES.jueves26), alumno.matriculaId),
        await enviar('aq_sesion=no-es-un-token', alumno.matriculaId),
      ];

      for (const respuesta of respuestas) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
          401,
          'NO_AUTENTICADO',
        ]);
      }
      expect(await instantaneaDeHorario(esc)).toBe(antes);
    });

    it('con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso, el cuerpo y la matrícula', async () => {
      await actualizarUsuario(A(), esc.e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), esc.e.entrenadorA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), alumno.usuarioId, { debe_cambiar_clave: true });

      for (const rol of ['secretaria', 'entrenador', 'alumno'] as const) {
        for (const respuesta of [
          await enviar(cookieDe(rol), alumno.matriculaId),
          await enviar(cookieDe(rol), randomUUID(), { campoDeMas: true }),
        ]) {
          expect([respuesta.status, codigoDeRespuesta(respuesta)], rol).toEqual([403, 'CAMBIO_DE_CLAVE_OBLIGATORIO']);
        }
      }
    });

    it('con la academia suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso, para todos los roles', async () => {
      await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');
      await actualizarUsuario(A(), esc.e.secretariaA.id, { debe_cambiar_clave: true });

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        const respuesta = await enviar(cookieDe(rol), alumno.matriculaId);
        expect([respuesta.status, codigoDeRespuesta(respuesta)], rol).toEqual([403, 'ACADEMIA_SUSPENDIDA']);
      }
    });

    it('HEAD sobre /api/matriculas y sobre la ruta del cambio responde 404 con la sesión de cualquier rol y no escribe', async () => {
      const antes = await instantaneaDeHorario(esc);

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        for (const direccion of [
          '/api/matriculas',
          rutaHorario(alumno.matriculaId),
          `/api/matriculas/${alumno.matriculaId}`,
        ]) {
          const respuesta = await ctx.http.enviar('HEAD', direccion, { cookie: cookieDe(rol) });
          expect(respuesta.status, `${rol} ${direccion}`).toBe(404);
        }
      }

      expect(await instantaneaDeHorario(esc)).toBe(antes);
    });
  });

  describe('el cuerpo con campos de más', () => {
    const CAMPOS_DE_MAS: [string, Objeto][] = [
      ['un campo de más (campoDeMas)', { campoDeMas: true }],
      ['un academiaId de B', { academiaId: '00000000-0000-4000-8000-00000000000b' }],
      ['un alumnoId', { alumnoId: '00000000-0000-4000-8000-00000000000a' }],
      ['un montoAjustado', { montoAjustado: '10' }],
    ];

    it.each(CAMPOS_DE_MAS)(
      'un cuerpo con %s responde 400 SOLICITUD_INVALIDA sin escribir ni auditar',
      async (_nombre, sobre) => {
        const antes = await instantaneaDeHorario(esc);

        const respuesta = await enviar(galletas.secretaria, alumno.matriculaId, sobre);

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
          400,
          'SOLICITUD_INVALIDA',
        ]);
        expect(await instantaneaDeHorario(esc)).toBe(antes);
      },
    );

    it('el 400 de un cuerpo con campos de más gana al 404 de una matrícula que no existe, pero pierde ante el 403 del permiso', async () => {
      const conCampoDeMas = await enviar(galletas.secretaria, randomUUID(), { campoDeMas: true });
      const sinPermiso = await enviar(galletas.entrenador, randomUUID(), { campoDeMas: true });

      expect(resumen(conCampoDeMas)).toEqual([400, 'SOLICITUD_INVALIDA']);
      expect(resumen(sinPermiso)).toEqual([403, 'SIN_PERMISO']);
    });
  });

  describe('aislamiento: la matrícula que no es de la academia de la sesión no existe (404 NO_ENCONTRADO)', () => {
    const DNI_COMUN = '45612378';

    it('un id que no es UUID y uno que no existe responden 404 NO_ENCONTRADO, con el mismo cuerpo, sin escribir ni auditar', async () => {
      const antes = await instantaneaDeHorario(esc);

      const noUuid = await enviar(galletas.secretaria, 'no-es-un-uuid');
      const inexistente = await enviar(galletas.secretaria, randomUUID());

      expect(resumen(noUuid), noUuid.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(resumen(inexistente), inexistente.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(sinUuid(inexistente.texto)).toBe(sinUuid(noUuid.texto));
      expect(await instantaneaDeHorario(esc)).toBe(antes);
    });

    it('con la sesión de A, la matrícula de B (con el mismo DNI y clases a la misma hora) responde el mismo 404 que una matrícula inexistente, sin tocar nada de B', async () => {
      const deA = await crearAlumnoDeHorario(ctx, esc, { dni: DNI_COMUN });
      const deB = await crearAlumnoDeHorario(ctx, esc, { academia: 'B', dni: DNI_COMUN });
      const antesDeB = await instantaneaDeLaAcademia(esc.e.B.id);

      const deLaOtra = await enviar(galletas.secretaria, deB.matriculaId);
      const inexistente = await enviar(galletas.secretaria, randomUUID());
      const propia = await enviar(galletas.secretaria, deA.matriculaId);

      expect(resumen(deLaOtra), deLaOtra.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(sinUuid(deLaOtra.texto)).toBe(sinUuid(inexistente.texto));
      expect(propia.status, propia.texto).toBe(200);
      expect(await clasesDeLaMatricula(esc.e.B.id, deB.matriculaId), 'las clases de B no cambian').toEqual(
        ordenados([esc.e.lunesB.id, esc.e.miercolesB.id, esc.e.viernesB.id]),
      );
      expect(await instantaneaDeLaAcademia(esc.e.B.id), 'B no cambia (ni matrículas, ni caja, ni auditoría)').toBe(
        antesDeB,
      );
    });

    it('con la sesión de B, la matrícula de A también es un 404; la de B se cambia con las clases de B (200) y A no cambia', async () => {
      const deA = await crearAlumnoDeHorario(ctx, esc, { dni: DNI_COMUN });
      const deB = await crearAlumnoDeHorario(ctx, esc, { academia: 'B', dni: DNI_COMUN });
      const lunes17B = await crearClaseDePrueba(esc.e.B.id, esc.e.lunesB.entrenador_id, {
        nivel: 'BASICO',
        dia_semana: 1,
        hora_inicio: '17:00',
        aforo: 20,
      });
      const antesDeA = await clasesDeLaMatricula(A(), deA.matriculaId);

      const deLaOtra = await cambiarHorario(ctx, galletas.secretariaB, deA.matriculaId, [
        lunes17B.id,
        esc.e.miercolesB.id,
        esc.e.viernesB.id,
      ]);
      const propia = await cambiarHorario(ctx, galletas.secretariaB, deB.matriculaId, [
        lunes17B.id,
        esc.e.miercolesB.id,
        esc.e.viernesB.id,
      ]);

      expect(resumen(deLaOtra), deLaOtra.texto).toEqual([404, 'NO_ENCONTRADO']);
      cambioDe(propia);
      expect(await clasesDeLaMatricula(A(), deA.matriculaId)).toEqual(antesDeA);
      expect(await clasesDeLaMatricula(esc.e.B.id, deB.matriculaId)).toEqual(
        ordenados([lunes17B.id, esc.e.miercolesB.id, esc.e.viernesB.id]),
      );
      expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO), 'nada se audita en A').toEqual([]);
      expect(await leerAuditoriaDeAcademia(esc.e.B.id, ACCION_HORARIO)).toHaveLength(1);
    });

    it('la matrícula de un CLIENTE (su reserva de 24 horas) responde 404 NO_ENCONTRADO, igual que una que no existe, sin escribir ni auditar', async () => {
      const cliente = await sembrarSolicitud(A(), {
        planId: esc.e.plan.id,
        claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
        ahora: INSTANTES.jueves26,
      });
      const antes = await instantaneaDeHorario(esc);

      const respuesta = await enviar(galletas.secretaria, cliente.matriculaId);
      const inexistente = await enviar(galletas.secretaria, randomUUID());

      expect(resumen(respuesta), respuesta.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(sinUuid(respuesta.texto)).toBe(sinUuid(inexistente.texto));
      expect(await instantaneaDeHorario(esc)).toBe(antes);
    });

    it('?academiaId= en la dirección no cambia nada: con la academia de B no abre la matrícula de B y con la de A no estorba la propia', async () => {
      const deB = await crearAlumnoDeHorario(ctx, esc, { academia: 'B' });

      const deLaOtra = await ctx.http.post(
        `${rutaHorario(deB.matriculaId)}?academiaId=${esc.e.B.id}`,
        { claseIds: delLunes17(), motivo: 'Cambio pedido' },
        { cookie: galletas.secretaria },
      );
      const propia = await ctx.http.post(
        `${rutaHorario(alumno.matriculaId)}?academiaId=${esc.e.B.id}`,
        { claseIds: delLunes17(), motivo: 'Cambio pedido' },
        { cookie: galletas.secretaria },
      );

      expect(resumen(deLaOtra), deLaOtra.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(propia.status, propia.texto).toBe(200);
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(ordenados(delLunes17()));
    });

    it.each([
      ['las tres clases de B', () => [esc.e.lunesB.id, esc.e.miercolesB.id, esc.e.viernesB.id]],
      ['una sola clase de B entre las de A', () => [esc.e.lunes17.id, esc.e.miercoles.id, esc.e.viernesB.id]],
    ])(
      'con %s en la petición de A responde 409 SELECCION_NO_VALIDA, igual que clases que no existen en ninguna academia, sin escribir ni auditar',
      async (_nombre, clases) => {
        const antes = await instantaneaDeHorario(esc);

        const deOtraAcademia = await cambiarHorario(ctx, galletas.secretaria, alumno.matriculaId, clases());
        const inexistentes = await cambiarHorario(ctx, galletas.secretaria, alumno.matriculaId, [
          randomUUID(),
          randomUUID(),
          randomUUID(),
        ]);

        expect(resumen(deOtraAcademia), deOtraAcademia.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
        expect(sinUuid(deOtraAcademia.texto)).toBe(sinUuid(inexistentes.texto));
        expect(await instantaneaDeHorario(esc)).toBe(antes);
        expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).toEqual([]);
      },
    );
  });
});
