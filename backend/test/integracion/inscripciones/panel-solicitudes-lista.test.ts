// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  type AppInscripciones,
  AHORA_005,
  camposConError,
  codigoDe,
  contarFilasDeInscripciones,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerApoderados,
  leerSolicitudes,
  type Objeto,
  type RespuestaApi,
  rutaPublica,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { sembrarEnMasa } from '../../utilidades/inscripciones-005b';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  contarAuditoria,
  cookieDeUsuario,
  fijarEstadoDeAcademia,
  rutasRegistradas,
  type RolUsuario,
} from '../../utilidades/usuarios';

// Criterio 38 (crítico, sección 2.1, RN-21, D-23; PB1, PB2 y PB11), lista de solicitudes del panel: `GET /api/solicitudes`, con
// `@Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')` (ADMIN y SECRETARIA), responde 200 con `{ solicitudes }` de la academia de la sesión, de la más nueva a
// la más antigua (`creadaEn` y, a igual `creadaEn`, `id`, descendentes), las 200 más recientes después de filtrar, por `?estado=` (ACTIVAS por defecto,
// VENCIDAS, CANCELADAS o TODAS; otro valor, minúsculas o el parámetro repetido, 400 SOLICITUD_INVALIDA en `estado`; los demás parámetros se ignoran).
// Cada elemento tiene exactamente `id`, `codigo`, `estado` (visible), `creadaEn`, `reservaVenceEn` (ISO si el estado visible es PENDIENTE_PAGO y la
// matrícula tiene vencimiento; si no, null), `nombres`, `apellidos`, `dni`, `telefono`, `menorDeEdad` (con la fecha de hoy en Lima), `plan`
// (`{ id, nombre }`), `clases` (`[{ id, nivel, diaSemana, horaInicio, horaFin }]`, por día y hora), `mes`, `clasesTotales` y `monto` (el ajustado si lo hay,
// si no el calculado). Sin datos médicos, apoderado, consentimientos, foto, IP ni token. ENTRENADOR y ALUMNO, 403; sin sesión, 401; con A suspendida,
// 403; el Superadmin no tiene la ruta. Los datos de la persona son los actuales del alumno, también en sus solicitudes anteriores. Nunca aparecen
// solicitudes de otra academia, tampoco con `?academiaId=`. La lectura no audita.

const CLAVES_DEL_ELEMENTO = [
  'apellidos',
  'clases',
  'clasesTotales',
  'codigo',
  'creadaEn',
  'dni',
  'estado',
  'id',
  'menorDeEdad',
  'mes',
  'monto',
  'nombres',
  'plan',
  'reservaVenceEn',
  'telefono',
];
const CLAVES_DE_LA_CLASE = ['diaSemana', 'horaFin', 'horaInicio', 'id', 'nivel'];
const hace = (ms: number, desde: Date = AHORA_005) => new Date(desde.getTime() - ms);
const HORA = 60 * 60 * 1000;

describe('lista de solicitudes del panel (criterio 38)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  const cookies = {} as Record<RolUsuario, string>;
  let activaVieja: SolicitudSembrada;
  let activaNueva: SolicitudSembrada;
  let activaSinVencimiento: SolicitudSembrada;
  let mixta: SolicitudSembrada;
  let vencidaPorTiempo: SolicitudSembrada;
  let filaVencida: SolicitudSembrada;
  let cancelada: SolicitudSembrada;
  let deB: SolicitudSembrada;

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
    const clases = [e.viernes.id, e.lunes.id, e.miercoles.id];
    const base = { planId: e.plan.id, claseIds: clases };
    activaVieja = await sembrarSolicitud(e.A.id, { ...base, creadaEn: hace(3 * HORA) });
    activaNueva = await sembrarSolicitud(e.A.id, { ...base, creadaEn: hace(1 * HORA), conApoderado: true });
    activaSinVencimiento = await sembrarSolicitud(e.A.id, { ...base, creadaEn: hace(2 * HORA), reservaVenceEn: null });
    mixta = await sembrarSolicitud(e.A.id, { ...base, creadaEn: hace(4 * HORA) });
    // Una solicitud PENDIENTE_PAGO cuya matrícula ya está CANCELADA se ve CANCELADA.
    await ejecutarComo(
      'propietario',
      "UPDATE matriculas SET estado = 'CANCELADA', reserva_vence_en = NULL WHERE academia_id = $1::uuid AND solicitud_id = $2::uuid",
      [e.A.id, mixta.solicitudId],
      { academiaId: e.A.id },
    );
    vencidaPorTiempo = await sembrarSolicitud(e.A.id, {
      ...base,
      creadaEn: hace(5 * HORA),
      estado: 'PENDIENTE_PAGO_VENCIDA',
    });
    filaVencida = await sembrarSolicitud(e.A.id, { ...base, creadaEn: hace(6 * HORA), estado: 'VENCIDA' });
    cancelada = await sembrarSolicitud(e.A.id, { ...base, creadaEn: hace(7 * HORA), estado: 'CANCELADA' });
    deB = await sembrarSolicitud(e.B.id, {
      planId: e.planB.id,
      claseIds: [e.lunesB.id],
      creadaEn: hace(30 * 60 * 1000),
    });
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const lista = (query = '', cookie = cookies.ADMIN): Promise<RespuestaApi> =>
    ctx.http.get(`/api/solicitudes${query}`, { cookie });
  const solicitudes = (respuesta: RespuestaApi): Objeto[] => {
    expect(respuesta.status, respuesta.texto).toBe(200);
    return respuesta.body?.['solicitudes'] as Objeto[];
  };
  const ids = (respuesta: RespuestaApi): string[] => solicitudes(respuesta).map((s) => s['id'] as string);

  describe('permisos', () => {
    it.each(['ADMIN', 'SECRETARIA'] as const)(
      'criterio 38: %s de A recibe 200 con { solicitudes } y Cache-Control: no-store',
      async (rol) => {
        const respuesta = await lista('', cookies[rol]);

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(respuesta.cacheControl).toBe('no-store');
        expect(Object.keys(respuesta.body ?? {})).toEqual(['solicitudes']);
      },
    );

    it.each(['ENTRENADOR', 'ALUMNO'] as const)(
      'criterio 38: %s recibe 403 SIN_PERMISO, sin datos de solicitudes',
      async (rol) => {
        const respuesta = await lista('?estado=TODAS', cookies[rol]);

        expect(respuesta.status, respuesta.texto).toBe(403);
        expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
        expect(respuesta.cacheControl).toBe('no-store');
        expect(respuesta.texto).not.toMatch(/AQ-|dni|nombres|solicitudes"/);
      },
    );

    it('criterio 38: sin sesión, 401 NO_AUTENTICADO; con una cookie que no es un token, 401', async () => {
      expect((await lista()).status, 'control: el ADMIN sí puede listar').toBe(200);
      const sin = await ctx.http.get('/api/solicitudes');
      const mala = await lista('', 'aq_sesion=no-es-un-token');

      expect([sin.status, mala.status]).toEqual([401, 401]);
      expect(codigoDe(sin)).toBe('NO_AUTENTICADO');
      expect(codigoDe(mala)).toBe('NO_AUTENTICADO');
    });

    it('criterio 38: con la sesión de plataforma del Superadmin (aq_plataforma), 401, y ninguna ruta de plataforma lista solicitudes (D-29)', async () => {
      const respuesta = await lista('', cookieDeSesion(e.superadmin, AHORA_005));

      expect(respuesta.status, respuesta.texto).toBe(401);
      const rutas = rutasRegistradas(ctx.app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
      expect(rutas).toContain('GET /api/solicitudes');
      expect(
        rutas.filter((ruta) => /^[A-Z]+ \/api\/plataforma/.test(ruta) && /solicitud|inscripci/i.test(ruta)),
      ).toEqual([]);
    });

    it('criterio 38: el cambio de contraseña pendiente da 403 CAMBIO_DE_CLAVE_OBLIGATORIO y se comprueba antes que el permiso', async () => {
      expect((await lista()).status, 'control: el ADMIN sí puede listar').toBe(200);
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(e.A.id, e.entrenadorA.id, { debe_cambiar_clave: true });

      for (const rol of ['SECRETARIA', 'ENTRENADOR'] as const) {
        const respuesta = await lista('', cookies[rol]);

        expect(respuesta.status, rol).toBe(403);
        expect(codigoDe(respuesta), rol).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
      }
    });

    it('criterio 38: con A suspendida, 403 ACADEMIA_SUSPENDIDA antes que el cambio pendiente y el permiso; B sigue sirviendo', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });

      for (const rol of ['ADMIN', 'SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const) {
        const respuesta = await lista('', cookies[rol]);

        expect(respuesta.status, rol).toBe(403);
        expect(codigoDe(respuesta), rol).toBe('ACADEMIA_SUSPENDIDA');
      }
      expect((await lista('', cookieDeUsuario(e.adminB, AHORA_005))).status).toBe(200);
    });

    it('criterio 38: el rol se lee de la base en cada petición: un ADMIN que pasa a ENTRENADOR pierde el permiso al instante', async () => {
      expect((await lista()).status).toBe(200);
      await actualizarUsuario(e.A.id, e.adminA.id, { rol: 'ENTRENADOR' });

      const respuesta = await lista();

      expect(respuesta.status).toBe(403);
      expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
    });
  });

  describe('filtro por estado', () => {
    it('criterio 38: sin el parámetro, y con ?estado=ACTIVAS, la lista son las solicitudes de estado visible PENDIENTE_PAGO, de la más nueva a la más antigua', async () => {
      const esperadas = [activaNueva, activaSinVencimiento, activaVieja].map((s) => s.solicitudId);

      expect(ids(await lista())).toEqual(esperadas);
      expect(ids(await lista('?estado=ACTIVAS'))).toEqual(esperadas);
    });

    it('criterio 38: VENCIDAS son la fila PENDIENTE_PAGO con la reserva vencida y la fila VENCIDA', async () => {
      expect(ids(await lista('?estado=VENCIDAS'))).toEqual([vencidaPorTiempo.solicitudId, filaVencida.solicitudId]);
    });

    it('criterio 38: CANCELADAS son la fila CANCELADA y la fila PENDIENTE_PAGO con la matrícula CANCELADA', async () => {
      expect(ids(await lista('?estado=CANCELADAS'))).toEqual([mixta.solicitudId, cancelada.solicitudId]);
    });

    it('criterio 38: TODAS trae las siete solicitudes de A, de la más nueva a la más antigua', async () => {
      expect(ids(await lista('?estado=TODAS'))).toEqual(
        [activaNueva, activaSinVencimiento, activaVieja, mixta, vencidaPorTiempo, filaVencida, cancelada].map(
          (s) => s.solicitudId,
        ),
      );
    });

    it('criterio 38: el estado de cada elemento es el visible (VENCIDA calculado aunque la fila diga PENDIENTE_PAGO)', async () => {
      const porId = new Map(solicitudes(await lista('?estado=TODAS')).map((s) => [s['id'], s['estado']]));

      expect(porId.get(activaVieja.solicitudId)).toBe('PENDIENTE_PAGO');
      expect(porId.get(activaSinVencimiento.solicitudId)).toBe('PENDIENTE_PAGO');
      expect(porId.get(vencidaPorTiempo.solicitudId)).toBe('VENCIDA');
      expect(porId.get(filaVencida.solicitudId)).toBe('VENCIDA');
      expect(porId.get(mixta.solicitudId)).toBe('CANCELADA');
      expect(porId.get(cancelada.solicitudId)).toBe('CANCELADA');
    });

    it('criterio 38: una reserva que vence en este mismo instante ya es VENCIDA; un milisegundo después, todavía ACTIVA', async () => {
      const justo = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        reservaVenceEn: new Date(AHORA_005.getTime()),
        creadaEn: hace(10 * 1000),
      });
      const casi = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        reservaVenceEn: new Date(AHORA_005.getTime() + 1),
        creadaEn: hace(20 * 1000),
      });

      expect(ids(await lista('?estado=VENCIDAS'))).toContain(justo.solicitudId);
      expect(ids(await lista('?estado=ACTIVAS'))).not.toContain(justo.solicitudId);
      expect(ids(await lista('?estado=ACTIVAS'))).toContain(casi.solicitudId);
    });

    it.each([
      ['en minúsculas', '?estado=activas'],
      ['un valor desconocido', '?estado=OTRO'],
      ['vacío', '?estado='],
      ['con un espacio', '?estado=%20ACTIVAS'],
      ['mezclando mayúsculas', '?estado=Todas'],
      ['repetido', '?estado=ACTIVAS&estado=TODAS'],
      ['repetido con el mismo valor', '?estado=ACTIVAS&estado=ACTIVAS'],
      ['como arreglo', '?estado[]=ACTIVAS'],
      ['como objeto', '?estado[a]=ACTIVAS'],
    ])(
      'criterio 38: el parámetro estado %s responde 400 SOLICITUD_INVALIDA en el campo estado',
      async (_nombre, query) => {
        const respuesta = await lista(query);

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)[0]).toBe('estado');
      },
    );

    it('criterio 38: los demás parámetros se ignoran: ?academiaId=<B>, ?limite=1 o ?foo=1 responden la lista de A', async () => {
      const esperada = ids(await lista());

      expect(ids(await lista(`?academiaId=${e.B.id}`))).toEqual(esperada);
      expect(ids(await lista('?foo=1&limite=1&pagina=2'))).toEqual(esperada);
      expect(ids(await lista(`?estado=TODAS&academiaId=${e.B.id}`))).toHaveLength(7);
    });
  });

  describe('forma de cada elemento', () => {
    it('criterio 38: cada elemento tiene exactamente las claves del contrato, y plan y clases con sus claves', async () => {
      const elementos = solicitudes(await lista('?estado=TODAS'));

      expect(elementos).toHaveLength(7);
      for (const elemento of elementos) {
        expect(Object.keys(elemento).sort()).toEqual(CLAVES_DEL_ELEMENTO);
        expect(Object.keys(elemento['plan'] as Objeto).sort()).toEqual(['id', 'nombre']);
        for (const clase of elemento['clases'] as Objeto[])
          expect(Object.keys(clase).sort()).toEqual(CLAVES_DE_LA_CLASE);
      }
    });

    it('criterio 38: los valores de una solicitud activa son los de la solicitud, el alumno, la matrícula, el plan y las clases (por día y hora)', async () => {
      const elemento = solicitudes(await lista()).find((s) => s['id'] === activaVieja.solicitudId);

      expect(elemento).toEqual({
        id: activaVieja.solicitudId,
        codigo: activaVieja.codigo,
        estado: 'PENDIENTE_PAGO',
        creadaEn: hace(3 * HORA).toISOString(),
        reservaVenceEn: new Date(AHORA_005.getTime() + 24 * HORA).toISOString(),
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        dni: activaVieja.dni,
        telefono: '987654321',
        menorDeEdad: false,
        plan: { id: e.plan.id, nombre: e.plan.nombre },
        clases: [e.lunes, e.miercoles, e.viernes].map((c) => ({
          id: c.id,
          nivel: 'BASICO',
          diaSemana: c.dia_semana,
          horaInicio: c.hora_inicio,
          horaFin: c.hora_fin,
        })),
        mes: '2026-11',
        clasesTotales: 12,
        monto: '120.00',
      });
    });

    it('criterio 38: reservaVenceEn es null si la matrícula no tiene vencimiento y si el estado visible no es PENDIENTE_PAGO', async () => {
      const porId = new Map(solicitudes(await lista('?estado=TODAS')).map((s) => [s['id'] as string, s]));

      expect(porId.get(activaSinVencimiento.solicitudId)?.['reservaVenceEn']).toBeNull();
      for (const s of [vencidaPorTiempo, filaVencida, mixta, cancelada]) {
        expect(porId.get(s.solicitudId)?.['reservaVenceEn'], s.codigo).toBeNull();
      }
      expect(typeof porId.get(activaNueva.solicitudId)?.['reservaVenceEn']).toBe('string');
    });

    it('criterio 38: el monto es el ajustado si lo hay, y si no el calculado, siempre con dos decimales', async () => {
      await ejecutarComo(
        'propietario',
        "UPDATE matriculas SET monto_ajustado = 99.5, motivo_ajuste = 'Descuento de la academia' WHERE academia_id = $1::uuid AND solicitud_id = $2::uuid",
        [e.A.id, activaVieja.solicitudId],
        { academiaId: e.A.id },
      );
      const porId = new Map(solicitudes(await lista()).map((s) => [s['id'] as string, s]));

      expect(porId.get(activaVieja.solicitudId)?.['monto']).toBe('99.50');
      expect(porId.get(activaNueva.solicitudId)?.['monto']).toBe('120.00');
    });

    it('criterio 38: menorDeEdad sale de la fecha de nacimiento y de la fecha de hoy en Lima (el día del cumpleaños número 18 ya es mayor), aunque el apoderado siga guardado', async () => {
      const casi = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        fechaNacimiento: '2008-11-12',
        conApoderado: true,
        creadaEn: hace(10 * 1000),
      });
      const del = async (ahora: Date) => {
        ctx.reloj.fijar(ahora);
        const respuesta = await lista('?estado=TODAS', cookieDeUsuario(e.adminA, ahora));
        return solicitudes(respuesta).find((s) => s['id'] === casi.solicitudId)?.['menorDeEdad'];
      };

      expect(await del(AHORA_005), 'el 11 de noviembre en Lima, 17 años').toBe(true);
      expect(await del(new Date('2026-11-12T04:59:59.999Z')), '23:59:59.999 del 11 en Lima').toBe(true);
      expect(await del(new Date('2026-11-12T05:00:00.000Z')), '00:00 del 12 en Lima: cumple 18').toBe(false);
      expect(
        (await leerApoderados(e.A.id)).some((a) => a.alumno_id === casi.alumnoId),
        'el apoderado sigue guardado',
      ).toBe(true);
    });

    it('criterio 38: una persona menor con apoderado se lista con menorDeEdad: true y sin ningún dato del apoderado', async () => {
      const respuesta = await lista();
      const elemento = solicitudes(respuesta).find((s) => s['id'] === activaNueva.solicitudId);
      const apoderado = (await leerApoderados(e.A.id)).find((a) => a.alumno_id === activaNueva.alumnoId);

      expect(elemento?.['menorDeEdad']).toBe(true);
      expect(apoderado).toBeDefined();
      for (const valor of [apoderado?.dni, apoderado?.nombres, apoderado?.telefono]) {
        expect(respuesta.texto.includes(valor as string), `la lista lleva ${valor} del apoderado`).toBe(false);
      }
    });
  });

  describe('lo que no puede llevar', () => {
    it('criterio 38: la lista no lleva datos médicos, apoderado, consentimientos, foto, IP, token, su hash, la clave de idempotencia, ids del alumno, fecha de nacimiento, correo ni dirección', async () => {
      await ejecutarComo(
        'propietario',
        `UPDATE alumnos SET correo = 'secreto@ejemplo.test', direccion = 'Calle Secreta 123',
                foto_clave = 'academias/' || academia_id::text || '/alumnos/' || id::text || '/foto-00000000-0000-4000-8000-000000000009.jpg'
          WHERE academia_id = $1::uuid`,
        [e.A.id],
        { academiaId: e.A.id },
      );
      await ejecutarComo(
        'propietario',
        "UPDATE fichas_medicas SET enfermedades = 'Asma-secreta', alergias = 'Polen-secreto', medicamentos = 'Inhalador-secreto' WHERE academia_id = $1::uuid",
        [e.A.id],
        { academiaId: e.A.id },
      );
      const respuesta = await lista('?estado=TODAS');
      expect(respuesta.status, respuesta.texto).toBe(200);
      const filas = await leerSolicitudes(e.A.id);
      const prohibidos = [
        'secreto@ejemplo.test',
        'Calle Secreta 123',
        'Asma-secreta',
        'Polen-secreto',
        'Inhalador-secreto',
        'Contacto',
        '912345678',
        'DATOS_PERSONALES',
        'DESLINDE',
        'v1-prueba',
        '198.51.100.9',
        '1995-05-20',
        '2014-03-10',
        'foto-0000',
        'fotoCargada',
        'foto_clave',
        'alumnoId',
        'claveIdempotencia',
        'tokenHash',
        'token',
        'ipOrigen',
        'fechaNacimiento',
        'fichaMedica',
        'apoderado',
        'consentimientos',
        ...filas.map((fila) => fila.clave_idempotencia),
        ...filas.map((fila) => fila.alumno_id),
        ...filas.map((fila) => fila.token_hash.toString('hex')),
        ...filas.map((fila) => fila.token_hash.toString('base64')),
        activaVieja.token,
      ];

      for (const prohibido of prohibidos) {
        expect(respuesta.texto, `la lista lleva ${prohibido}`).not.toContain(prohibido);
      }
    });
  });

  describe('orden y tope', () => {
    it('criterio 38: con la misma creadaEn, el orden sigue por id descendente', async () => {
      const instante = hace(30 * 1000);
      const mismas: SolicitudSembrada[] = [];
      for (let i = 0; i < 4; i++) {
        mismas.push(await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], creadaEn: instante }));
      }

      const orden = ids(await lista()).filter((id) => mismas.some((s) => s.solicitudId === id));

      expect(orden).toEqual(
        mismas
          .map((s) => s.solicitudId)
          .sort()
          .reverse(),
      );
      // Y todas ellas, que son las más nuevas, van antes que las demás.
      expect(
        ids(await lista())
          .slice(0, 4)
          .sort(),
      ).toEqual(orden.slice().sort());
    });

    it('criterio 38: la lista trae como mucho 200 solicitudes: las 200 más recientes (205 activas → las 5 más viejas no salen)', async () => {
      const sembradas = await sembrarEnMasa(e.A.id, {
        planId: e.plan.id,
        claseId: e.lunes.id,
        cantidad: 205,
        estado: 'PENDIENTE_PAGO',
        base: hace(50 * 60 * 1000),
        reservaVenceEn: new Date(AHORA_005.getTime() + 12 * HORA),
      });

      const respuesta = ids(await lista('?estado=TODAS'));

      expect(respuesta).toHaveLength(200);
      // Las 205 sembradas (de hace 50 minutos en adelante) son más nuevas que las demás de A (de hace 1 a 7 horas): salen las 200 más nuevas.
      expect(respuesta).toEqual(sembradas.slice(5).reverse());
      expect(ids(await lista())).toHaveLength(200);
    });

    it('criterio 38: el tope se aplica después de filtrar: con 120 canceladas más nuevas, ?estado=ACTIVAS sigue trayendo las 3 activas y ?estado=CANCELADAS las 120 más las 2 anteriores', async () => {
      await sembrarEnMasa(e.A.id, {
        planId: e.plan.id,
        claseId: e.lunes.id,
        cantidad: 120,
        estado: 'CANCELADA',
        base: hace(30 * 60 * 1000),
        reservaVenceEn: new Date(AHORA_005.getTime()),
      });

      expect(ids(await lista('?estado=ACTIVAS'))).toHaveLength(3);
      expect(ids(await lista('?estado=CANCELADAS'))).toHaveLength(122);
      expect(ids(await lista('?estado=TODAS'))).toHaveLength(127);
    });
  });

  describe('datos actuales del alumno', () => {
    it('criterio 38: tras un regreso por el criterio 21 b, la solicitud anterior se lista con los datos personales nuevos; su plan, clases, mes, clases totales y monto siguen siendo los suyos', async () => {
      const anterior = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        estado: 'PENDIENTE_PAGO_VENCIDA',
        clasesTotales: 5,
        monto: '77.00',
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        creadaEn: hace(2 * 24 * HORA),
      });
      const envio = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(e, {
          sobre: {
            alumno: { dni: anterior.dni, nombres: 'Intrusa', apellidos: 'Otra Persona', telefono: '911222333' },
          },
        }),
      );
      expect(envio.status, envio.texto).toBe(201);

      const porId = new Map(solicitudes(await lista('?estado=TODAS')).map((s) => [s['id'] as string, s]));
      const vieja = porId.get(anterior.solicitudId);

      expect(vieja).toBeDefined();
      expect(vieja).toMatchObject({
        estado: 'VENCIDA',
        reservaVenceEn: null,
        nombres: 'Intrusa',
        apellidos: 'Otra Persona',
        telefono: '911222333',
        dni: anterior.dni,
        clasesTotales: 5,
        monto: '77.00',
        mes: '2026-11',
        plan: { id: e.plan.id, nombre: e.plan.nombre },
      });
      expect((vieja?.['clases'] as Objeto[]).map((c) => c['id'])).toEqual([e.lunes.id]);
      const nueva = [...porId.values()].find((s) => s['dni'] === anterior.dni && s['id'] !== anterior.solicitudId);
      expect(nueva).toMatchObject({ estado: 'PENDIENTE_PAGO', nombres: 'Intrusa' });
      expect((nueva?.['clases'] as Objeto[]).length).toBe(3);
    });
  });

  describe('aislamiento entre academias', () => {
    it('criterio 38: la lista de A nunca trae solicitudes de B con ningún filtro, tampoco con ?academiaId=; la de B solo trae lo de B', async () => {
      const deAIds = new Set((await leerSolicitudes(e.A.id)).map((s) => s.id));

      for (const query of [
        '',
        '?estado=ACTIVAS',
        '?estado=VENCIDAS',
        '?estado=CANCELADAS',
        '?estado=TODAS',
        `?estado=TODAS&academiaId=${e.B.id}`,
        `?academiaId=${e.B.id}`,
      ]) {
        const respuesta = await lista(query);
        for (const id of ids(respuesta)) expect(deAIds.has(id), `${query}: ${id} no es de A`).toBe(true);
        expect(respuesta.texto, query).not.toContain(deB.solicitudId);
        expect(respuesta.texto, query).not.toContain(deB.codigo);
        expect(respuesta.texto, query).not.toContain(deB.dni);
      }
      const lasDeB = await lista('?estado=TODAS', cookieDeUsuario(e.adminB, AHORA_005));
      expect(ids(lasDeB)).toEqual([deB.solicitudId]);
    });
  });

  describe('la lectura no escribe ni audita', () => {
    it('criterio 38: listar no cambia ninguna fila ni escribe auditoría', async () => {
      const antes = {
        a: await instantaneaDeInscripciones(e.A.id),
        b: await instantaneaDeInscripciones(e.B.id),
        filas: await contarFilasDeInscripciones(e.A.id),
        auditoria: await contarAuditoria(e.A.id),
      };

      for (const query of ['', '?estado=TODAS', '?estado=VENCIDAS']) expect((await lista(query)).status).toBe(200);
      expect((await lista('?estado=OTRO')).status).toBe(400);

      expect(await instantaneaDeInscripciones(e.A.id)).toBe(antes.a);
      expect(await instantaneaDeInscripciones(e.B.id)).toBe(antes.b);
      expect(await contarFilasDeInscripciones(e.A.id)).toEqual(antes.filas);
      expect(await contarAuditoria(e.A.id)).toBe(antes.auditoria);
    });
  });
});
