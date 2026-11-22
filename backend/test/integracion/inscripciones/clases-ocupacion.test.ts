import { respuestaOcupacionSchema } from '@aquagestion/contratos';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  AHORA_005,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  llenarClase,
  type Objeto,
  type AppInscripciones,
  type RespuestaApi,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  contarAuditoria,
  cookieDeUsuario,
  fijarEstadoDeAcademia,
  type RolUsuario,
} from '../../utilidades/usuarios';

// Prueba NO protegida de la 005b (criterio 40, PB13): `GET /api/clases/ocupacion`, con `@Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')`, responde
// `{ mes, ocupacion: [{ claseId, inscritos, cuposRestantes }] }` con un elemento por cada clase de la academia, activa o no. `inscritos` es la mayor
// ocupación entre el mes en curso y los siguientes (`contarInscritos`, la cifra de los 409 de DR-5) y `cuposRestantes`, `max(0, aforo − ocupación del
// mes en curso)` (`contarOcupacion`). Las reservas vencidas y las matrículas canceladas no cuentan. Solo ADMIN; sin sesión, 401; nunca clases de otra
// academia; los parámetros de consulta se ignoran; no audita ni escribe.

describe('GET /api/clases/ocupacion (criterio 40)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  const cookies = {} as Record<RolUsuario, string>;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ ahora: AHORA_005 });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
    cookies.ADMIN = cookieDeUsuario(e.adminA, AHORA_005);
    cookies.SECRETARIA = cookieDeUsuario(e.secretariaA, AHORA_005);
    cookies.ENTRENADOR = cookieDeUsuario(e.entrenadorA, AHORA_005);
    cookies.ALUMNO = cookieDeUsuario(e.alumnoA, AHORA_005);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const ocupacion = (query = '', cookie = cookies.ADMIN): Promise<RespuestaApi> =>
    ctx.http.get(`/api/clases/ocupacion${query}`, { cookie });
  const elementos = (respuesta: RespuestaApi): Objeto[] => {
    expect(respuesta.status, respuesta.texto).toBe(200);
    return respuesta.body?.['ocupacion'] as Objeto[];
  };
  const de = (respuesta: RespuestaApi, claseId: string): Objeto | undefined =>
    elementos(respuesta).find((elemento) => elemento['claseId'] === claseId);
  const idsDeClases = async (academiaId: string): Promise<string[]> => {
    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT id::text AS id FROM clases WHERE academia_id = $1::uuid',
      [academiaId],
      { academiaId },
    );
    return (rows as { id: string }[]).map((fila) => fila.id).sort();
  };

  describe('permisos', () => {
    it('criterio 40: el ADMIN de A recibe 200 con Cache-Control: no-store y la respuesta cumple respuestaOcupacionSchema', async () => {
      const respuesta = await ocupacion();

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['mes', 'ocupacion']);
      expect(respuestaOcupacionSchema.safeParse(respuesta.body).success).toBe(true);
      expect(respuesta.body?.['mes']).toBe('2026-11');
    });

    it.each(['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const)('criterio 40: %s recibe 403 SIN_PERMISO', async (rol) => {
      const respuesta = await ocupacion('', cookies[rol]);

      expect(respuesta.status, respuesta.texto).toBe(403);
      expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
      expect(respuesta.texto).not.toContain('claseId');
    });

    it('criterio 40: sin sesión, 401 NO_AUTENTICADO; con una cookie que no es un token o con la del Superadmin (aq_plataforma), también 401', async () => {
      expect((await ocupacion()).status, 'control: el ADMIN sí puede').toBe(200);

      const sin = await ctx.http.get('/api/clases/ocupacion');
      const mala = await ocupacion('', 'aq_sesion=no-es-un-token');
      const superadmin = await ocupacion('', cookieDeSesion(e.superadmin, AHORA_005));

      for (const respuesta of [sin, mala, superadmin]) {
        expect(respuesta.status, respuesta.texto).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
      }
    });

    it('criterio 40: con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO; con A suspendida, 403 ACADEMIA_SUSPENDIDA antes que cualquier otro', async () => {
      await actualizarUsuario(e.A.id, e.adminA.id, { debe_cambiar_clave: true });
      const pendiente = await ocupacion();
      expect(pendiente.status).toBe(403);
      expect(codigoDe(pendiente)).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');

      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      const suspendida = await ocupacion();
      expect(suspendida.status).toBe(403);
      expect(codigoDe(suspendida)).toBe('ACADEMIA_SUSPENDIDA');
    });

    it('criterio 40: el rol se lee de la base en cada petición: un ADMIN que pasa a SECRETARIA pierde el permiso al instante', async () => {
      expect((await ocupacion()).status).toBe(200);
      await actualizarUsuario(e.A.id, e.adminA.id, { rol: 'SECRETARIA' });

      const respuesta = await ocupacion();

      expect(respuesta.status).toBe(403);
      expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
    });
  });

  describe('contenido', () => {
    it('criterio 40: hay exactamente un elemento por cada clase de A, activa o inactiva, y las que no tienen inscritos van con 0 y todo el aforo libre', async () => {
      await ejecutarComo(
        'propietario',
        'UPDATE clases SET activo = false WHERE academia_id = $1::uuid AND id = $2::uuid',
        [e.A.id, e.martes.id],
        { academiaId: e.A.id },
      );

      const respuesta = await ocupacion();

      const ids = elementos(respuesta).map((elemento) => elemento['claseId'] as string);
      expect([...ids].sort()).toEqual(await idsDeClases(e.A.id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const elemento of elementos(respuesta)) {
        expect(Object.keys(elemento).sort()).toEqual(['claseId', 'cuposRestantes', 'inscritos']);
        expect(elemento['inscritos']).toBe(0);
        expect(elemento['cuposRestantes']).toBe(20);
      }
      expect(de(respuesta, e.martes.id), 'la clase inactiva también sale').toBeDefined();
    });

    it('criterio 40: la ocupación de una clase cuenta las reservas vigentes y las matrículas vigentes; las reservas vencidas y las canceladas no', async () => {
      const base = { planId: e.plan.id, claseIds: [e.lunes.id] };
      await sembrarSolicitud(e.A.id, base);
      await sembrarSolicitud(e.A.id, { ...base, reservaVenceEn: null });
      await sembrarSolicitud(e.A.id, { ...base, estado: 'PENDIENTE_PAGO_VENCIDA' });
      await sembrarSolicitud(e.A.id, { ...base, estado: 'CANCELADA' });
      await sembrarSolicitud(e.A.id, { ...base, estado: 'VENCIDA' });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 3, { estado: 'VIGENTE' });

      const respuesta = await ocupacion();

      expect(de(respuesta, e.lunes.id)).toEqual({ claseId: e.lunes.id, inscritos: 5, cuposRestantes: 15 });
      expect(de(respuesta, e.miercoles.id)).toEqual({ claseId: e.miercoles.id, inscritos: 0, cuposRestantes: 20 });
    });

    it('criterio 40: una matrícula del mes siguiente cuenta en inscritos (la mayor ocupación entre este mes y los siguientes) y no en cuposRestantes (solo el mes en curso)', async () => {
      const base = { planId: e.plan.id, claseIds: [e.lunes.id] };
      // Noviembre: 1 inscrito. Diciembre: 2. Enero (otro año): 3.
      await sembrarSolicitud(e.A.id, base);
      await sembrarSolicitud(e.A.id, { ...base, mes: { anio: 2026, mes: 12 } });
      await sembrarSolicitud(e.A.id, { ...base, mes: { anio: 2026, mes: 12 } });
      for (let i = 0; i < 3; i++) await sembrarSolicitud(e.A.id, { ...base, mes: { anio: 2027, mes: 1 } });
      // Un mes pasado no cuenta en nada.
      await sembrarSolicitud(e.A.id, { ...base, mes: { anio: 2026, mes: 10 }, reservaVenceEn: null });

      const respuesta = await ocupacion();

      expect(respuesta.body?.['mes']).toBe('2026-11');
      expect(de(respuesta, e.lunes.id)).toEqual({ claseId: e.lunes.id, inscritos: 3, cuposRestantes: 19 });
    });

    it('criterio 40: una clase solo con matrículas del mes siguiente tiene inscritos y todo el aforo libre este mes', async () => {
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.viernes.id], mes: { anio: 2026, mes: 12 } });

      const respuesta = await ocupacion();

      expect(de(respuesta, e.viernes.id)).toEqual({ claseId: e.viernes.id, inscritos: 1, cuposRestantes: 20 });
    });

    it('criterio 40: con más inscritos que aforo (aforo bajado con confirmación) los cupos restantes quedan en 0, nunca negativos', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);
      await ejecutarComo(
        'propietario',
        'UPDATE clases SET aforo = 20 WHERE academia_id = $1::uuid AND id = $2::uuid',
        [e.A.id, e.lunes.id],
        { academiaId: e.A.id },
      );
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });

      const respuesta = await ocupacion();

      expect(de(respuesta, e.lunes.id)).toEqual({ claseId: e.lunes.id, inscritos: 21, cuposRestantes: 0 });
    });

    it('criterio 40: el mes en curso es el de Lima: a las 23:59:59.999 del 30 de noviembre sigue siendo 2026-11 y un milisegundo después, 2026-12', async () => {
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });

      ctx.reloj.fijar(new Date('2026-12-01T04:59:59.999Z'));
      const antes = await ocupacion('', cookieDeUsuario(e.adminA, new Date('2026-12-01T04:59:59.999Z')));
      ctx.reloj.fijar(new Date('2026-12-01T05:00:00.000Z'));
      const despues = await ocupacion('', cookieDeUsuario(e.adminA, new Date('2026-12-01T05:00:00.000Z')));

      expect(antes.body?.['mes']).toBe('2026-11');
      expect(despues.body?.['mes']).toBe('2026-12');
      // La reserva sembrada (de noviembre) ya venció y no cuenta en diciembre.
      expect(de(despues, e.lunes.id)).toEqual({ claseId: e.lunes.id, inscritos: 0, cuposRestantes: 20 });
    });
  });

  describe('aislamiento entre academias', () => {
    it('criterio 40: A nunca ve clases ni ocupación de B, tampoco con ?academiaId=; B solo ve las suyas', async () => {
      await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });
      const deB = await idsDeClases(e.B.id);
      const deA = await idsDeClases(e.A.id);

      for (const query of ['', `?academiaId=${e.B.id}`, '?foo=1&limite=1']) {
        const respuesta = await ocupacion(query);
        const ids = elementos(respuesta).map((elemento) => elemento['claseId'] as string);
        expect([...ids].sort(), query).toEqual(deA);
        for (const id of deB) expect(respuesta.texto, query).not.toContain(id);
      }
      const lasDeB = await ocupacion('', cookieDeUsuario(e.adminB, AHORA_005));
      expect(
        elementos(lasDeB)
          .map((elemento) => elemento['claseId'] as string)
          .sort(),
      ).toEqual(deB);
      expect(de(lasDeB, e.lunesB.id)).toEqual({ claseId: e.lunesB.id, inscritos: 1, cuposRestantes: 19 });
      for (const id of deA) expect(lasDeB.texto).not.toContain(id);
    });
  });

  describe('la lectura no escribe ni audita', () => {
    it('criterio 40: consultar la ocupación no cambia ninguna fila ni escribe auditoría', async () => {
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
      const antes = {
        a: await instantaneaDeInscripciones(e.A.id),
        b: await instantaneaDeInscripciones(e.B.id),
        auditoria: await contarAuditoria(e.A.id),
      };

      for (let i = 0; i < 3; i++) expect((await ocupacion()).status).toBe(200);

      expect(await instantaneaDeInscripciones(e.A.id)).toBe(antes.a);
      expect(await instantaneaDeInscripciones(e.B.id)).toBe(antes.b);
      expect(await contarAuditoria(e.A.id)).toBe(antes.auditoria);
    });
  });
});
