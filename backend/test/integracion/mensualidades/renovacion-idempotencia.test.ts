// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cerrarCajaDePrueba, leerCajas, leerMovimientos } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, conAlumnoRetenido, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { cuerpoCobro, rutaCobro, sembrarCobrable } from '../../utilidades/escenario-pagos';
import { sembrarEnVerificacion } from '../../utilidades/escenario-pagos-007b';
import {
  ACCION_RENOVACION,
  abrirCajaPara,
  crearAlumnoDeNoviembre,
  cuantasDelMes,
  DICIEMBRE,
  INSTANTES,
  instantaneaDeRenovacion,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
  resumen,
  sinErroresDelServidor,
  type Via,
} from '../../utilidades/escenario-renovacion';
import { archivosBajo } from '../../utilidades/inscripciones-005b';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 12 (crítico, `CLAUDE.md`: escrituras idempotentes): la `claveIdempotencia` es la del pago (`pagos_academia_id_clave_idempotencia_key`). Si ya creó el pago de una renovación de ese mismo alumno, con la misma ruta y los mismos datos, responde 200 con el mismo
// cuerpo y `repetida: true`, sin otra matrícula, pago, movimiento, ticket, auditoría ni archivo (el nuevo se borra), aunque la caja ya esté cerrada. Con otro alumno, otra ruta, otros datos o la clave de un pago de una solicitud: 409 `CLAVE_YA_USADA`. Dos peticiones a la vez
// con la misma clave dejan una renovación (una 201 y una 200). Dos renovaciones del mismo alumno y mes con claves distintas a la vez: una 201 y otra 409 `MENSUALIDAD_YA_REGISTRADA` (por el nombre del índice `matriculas_alumno_mes_ocupa_cupo_key`, después del `ROLLBACK`).
// Lecturas estrictas elegidas: (1) «el mismo cuerpo» es el del 201 con `repetida: true` (mismos ids, mismo ticket); (2) «otros datos» son el mes, el plan, las clases, el monto o, en el comprobante, el método, el número de operación o la fecha; (3) «otra ruta» es el efectivo
// con la clave de un comprobante y al revés; (4) la clave de un pago de otro alumno, de una solicitud o de la 007 responde 409 aunque el alumno tenga la matrícula del mes (la clave se decide antes que el mes); (5) las carreras son deterministas: las dos peticiones esperan la fila
// del alumno retenida por la prueba y se sueltan juntas, y la primera en la cola gana.

const VIAS: Via[] = ['EFECTIVO', 'YAPE'];

describe.each(VIAS)('la idempotencia de la renovación por %s (criterio 12)', (via) => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    await abrirCajaPara(esc, INSTANTES.viernes27);
    cookies = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const registrar = (alumnoId: string, opciones: Parameters<typeof registrarRenovacion>[5] = {}, deVia: Via = via) =>
    registrarRenovacion(ctx, esc, deVia, cookies.secretaria, alumnoId, opciones);
  /** La clave (y, en el comprobante, el número de operación) fijos de una petición: el cuerpo del efectivo no admite `numeroOperacion`. */
  const conClave = (clave: string, numero: string): Record<string, unknown> =>
    via === 'EFECTIVO' ? { claveIdempotencia: clave } : { claveIdempotencia: clave, numeroOperacion: numero };
  const repetir = (
    alumnoId: string,
    original: Record<string, unknown>,
    opciones: Parameters<typeof registrarRenovacion>[5] = {},
  ) =>
    registrar(alumnoId, {
      ...opciones,
      sobre: {
        claveIdempotencia: original['claveIdempotencia'],
        ...(via === 'EFECTIVO' ? {} : { numeroOperacion: original['numeroOperacion'] }),
        ...opciones.sobre,
      },
    });

  it('criterio 12: la misma clave y los mismos datos responden 200 con el mismo cuerpo y repetida: true, sin otra matrícula, pago, movimiento, ticket, auditoría ni archivo', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    const primero = await registrar(alumno.alumnoId);
    const original = renovacionDe(primero.respuesta, 201);
    const antes = await instantaneaDeRenovacion(ctx, esc);

    const segundo = await repetir(alumno.alumnoId, primero.cuerpo);

    expect(renovacionDe(segundo.respuesta, 200)).toEqual({ ...original, repetida: true });
    expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
    expect(await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION)).toHaveLength(1);
  });

  it('criterio 12: el reintento responde 200 aunque la caja ya esté cerrada, también el de un reintento por la otra sesión del personal', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    const primero = await registrar(alumno.alumnoId);
    const original = renovacionDe(primero.respuesta, 201);
    const abierta = (await leerCajas(esc.e.A.id)).find((c) => c.estado === 'ABIERTA');
    await cerrarCajaDePrueba(esc.e.A.id, abierta?.id ?? '', esc.e.secretariaA.id);
    const antes = await instantaneaDeRenovacion(ctx, esc);

    const segundo = await registrarRenovacion(ctx, esc, via, cookies.admin, alumno.alumnoId, {
      sobre: {
        claveIdempotencia: primero.cuerpo['claveIdempotencia'],
        ...(via === 'EFECTIVO' ? {} : { numeroOperacion: primero.cuerpo['numeroOperacion'] }),
      },
    });

    expect(renovacionDe(segundo.respuesta, 200)).toEqual({ ...original, repetida: true });
    expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
  });

  describe('409 CLAVE_YA_USADA', () => {
    it('criterio 12: con otro alumno (aunque tenga su propia renovación posible), con la clave de la primera', async () => {
      const [uno, otro] = [await crearAlumnoDeNoviembre(ctx, esc), await crearAlumnoDeNoviembre(ctx, esc)];
      const primero = await registrar(uno.alumnoId);
      expect(primero.respuesta.status).toBe(201);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const segundo = await repetir(otro.alumnoId, primero.cuerpo);

      expect(resumen(segundo.respuesta), segundo.respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    it('criterio 12: con otra ruta (el efectivo con la clave de un comprobante y el comprobante con la clave de un efectivo)', async () => {
      const [uno, otro] = [await crearAlumnoDeNoviembre(ctx, esc), await crearAlumnoDeNoviembre(ctx, esc)];
      const primero = await registrar(uno.alumnoId);
      expect(primero.respuesta.status).toBe(201);
      const otraVia: Via = via === 'EFECTIVO' ? 'YAPE' : 'EFECTIVO';
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const mismoAlumno = await registrar(
        uno.alumnoId,
        { sobre: { claveIdempotencia: primero.cuerpo['claveIdempotencia'] } },
        otraVia,
      );
      const otroAlumno = await registrar(
        otro.alumnoId,
        { sobre: { claveIdempotencia: primero.cuerpo['claveIdempotencia'] } },
        otraVia,
      );

      expect(resumen(mismoAlumno.respuesta), mismoAlumno.respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
      expect(resumen(otroAlumno.respuesta), otroAlumno.respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    it.each([
      ['otro mes', () => ({ seleccion: { mes: '2026-11' } })],
      ['otras clases', () => ({ seleccion: { claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.lunes17.id] } })],
      ['otro monto', () => ({ total: '119.00' })],
    ])('criterio 12: con otros datos (%s) y la misma clave', async (_nombre, cambio) => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const primero = await registrar(alumno.alumnoId);
      expect(primero.respuesta.status).toBe(201);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const segundo = await repetir(alumno.alumnoId, primero.cuerpo, cambio());

      expect(resumen(segundo.respuesta), segundo.respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    if (via !== 'EFECTIVO') {
      it.each([
        ['otro número de operación', { numeroOperacion: '99887766' }],
        ['otro método', { metodo: 'TRANSFERENCIA' }],
        ['otra fecha de operación', { fechaOperacion: '2026-11-27' }],
      ])('criterio 12: en el comprobante, con %s y la misma clave', async (_nombre, cambio) => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const primero = await registrar(alumno.alumnoId);
        expect(primero.respuesta.status).toBe(201);
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const segundo = await registrar(alumno.alumnoId, {
          sobre: {
            claveIdempotencia: primero.cuerpo['claveIdempotencia'],
            numeroOperacion: primero.cuerpo['numeroOperacion'],
            ...cambio,
          },
        });

        expect(resumen(segundo.respuesta), segundo.respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
        expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      });
    }

    it('criterio 12: con la clave de un pago de una solicitud (un cliente con su comprobante en revisión)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const cliente = await sembrarEnVerificacion(esc.e);
      const claveDeLaSolicitud = (await leerPagos(esc.e.A.id)).find((p) => p.id === cliente.pagoId)?.clave_idempotencia;
      expect(claveDeLaSolicitud).toBeTruthy();
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const { respuesta } = await registrar(alumno.alumnoId, { sobre: { claveIdempotencia: claveDeLaSolicitud } });

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    it('criterio 12: con la clave de un cobro en efectivo de una solicitud (007a)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const cliente = await sembrarCobrable(esc.e, { ahora: INSTANTES.viernes27 });
      const clave = randomUUID();
      const cobro = await ctx.http.post(
        rutaCobro(cliente.solicitudId),
        cuerpoCobro('42.00', { claveIdempotencia: clave }),
        {
          cookie: cookies.secretaria,
        },
      );
      expect(cobro.status, cobro.texto).toBe(201);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const { respuesta } = await registrar(alumno.alumnoId, { sobre: { claveIdempotencia: clave } });

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'CLAVE_YA_USADA']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });
  });

  describe('peticiones simultáneas', () => {
    it('criterio 12 (determinista): dos peticiones con la misma clave esperan la fila del alumno y, al soltarla, una responde 201 y la otra 200 repetida; queda una matrícula, un pago y una auditoría', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const clave = randomUUID();
      const hacer = () => registrar(alumno.alumnoId, { sobre: conClave(clave, '4040404') }).then((r) => r.respuesta);

      const { resultados, esperaron } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: alumno.alumnoId,
        enviar: [hacer, hacer],
        esperando: 2,
        liberar: 'COMMIT',
      });

      expect(esperaron, 'las dos peticiones debían quedar esperando la fila del alumno').toBe(true);
      sinErroresDelServidor(resultados);
      expect(resultados.map((r) => r.status).sort(), resultados.map((r) => r.texto).join(' | ')).toEqual([200, 201]);
      const [creada, repetida] = [resultados.find((r) => r.status === 201), resultados.find((r) => r.status === 200)];
      expect(renovacionDe(repetida as NonNullable<typeof repetida>, 200)).toEqual({
        ...renovacionDe(creada as NonNullable<typeof creada>, 201),
        repetida: true,
      });
      expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
      expect((await leerPagos(esc.e.A.id)).filter((p) => p.clave_idempotencia === clave)).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION)).toHaveLength(1);
      if (via === 'EFECTIVO')
        expect((await leerMovimientos(esc.e.A.id)).filter((m) => m.concepto === 'MENSUALIDAD')).toHaveLength(1);
      else expect(archivosBajo(ctx.raiz)).toHaveLength(1);
    });

    it('criterio 12: diez peticiones a la vez con la misma clave dejan una sola renovación: un 201 y nueve 200, sin 5xx', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const clave = randomUUID();

      const respuestas = await Promise.all(
        Array.from({ length: 10 }, () =>
          registrar(alumno.alumnoId, { sobre: conClave(clave, '5050505') }).then((r) => r.respuesta),
        ),
      );

      sinErroresDelServidor(respuestas);
      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
      expect(respuestas.filter((r) => r.status === 200)).toHaveLength(9);
      expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
    });

    it('criterio 12 (determinista): dos renovaciones del mismo alumno y mes con claves distintas: una 201 y otra 409 MENSUALIDAD_YA_REGISTRADA, y el 409 no deja nada escrito ni archivo', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const hacer = () => registrar(alumno.alumnoId).then((r) => r.respuesta);

      const { resultados, esperaron } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: alumno.alumnoId,
        enviar: [hacer, hacer],
        esperando: 2,
        liberar: 'COMMIT',
      });

      expect(esperaron).toBe(true);
      sinErroresDelServidor(resultados);
      expect(resultados.map((r) => r.status).sort(), resultados.map((r) => r.texto).join(' | ')).toEqual([201, 409]);
      const perdedora = resultados.find((r) => r.status === 409);
      expect(perdedora && resumen(perdedora)).toEqual([409, 'MENSUALIDAD_YA_REGISTRADA']);
      expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
      const claves = (await leerPagos(esc.e.A.id))
        .map((p) => p.comprobante_clave)
        .filter((c): c is string => c !== null);
      expect(archivosBajo(ctx.raiz)).toEqual([...claves].sort());
    });

    it('criterio 12: cinco renovaciones del mismo alumno y mes con claves distintas a la vez (sin retener nada): una 201 y cuatro 409 MENSUALIDAD_YA_REGISTRADA, nunca 5xx', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);

      const respuestas = await Promise.all(
        Array.from({ length: 5 }, () => registrar(alumno.alumnoId).then((r) => r.respuesta)),
      );

      sinErroresDelServidor(respuestas);
      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
      expect(respuestas.filter((r) => r.status === 409).map((r) => resumen(r)[1])).toEqual(
        Array(4).fill('MENSUALIDAD_YA_REGISTRADA'),
      );
      expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
    });
  });
});

describe('criterio 12: el efectivo y el comprobante del mismo alumno y mes a la vez', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    await abrirCajaPara(esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  it('criterio 12: un efectivo y un Yape del mismo alumno y mes con claves distintas: una renovación y un 409 MENSUALIDAD_YA_REGISTRADA', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    const cookies = en(ctx, esc, INSTANTES.viernes27);

    const [efectivo, yape] = await Promise.all([
      registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId),
      registrarRenovacion(ctx, esc, 'YAPE', cookies.admin, alumno.alumnoId),
    ]);

    sinErroresDelServidor([efectivo.respuesta, yape.respuesta]);
    const estados = [efectivo.respuesta.status, yape.respuesta.status].sort();
    expect(estados, `${efectivo.respuesta.texto} | ${yape.respuesta.texto}`).toEqual([201, 409]);
    expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
    const claves = (await leerPagos(esc.e.A.id)).map((p) => p.comprobante_clave).filter((c): c is string => c !== null);
    expect(archivosBajo(ctx.raiz), 'si ganó el efectivo no queda ningún archivo').toEqual([...claves].sort());
  });
});
