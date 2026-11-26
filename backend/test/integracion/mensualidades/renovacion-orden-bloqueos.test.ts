// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enLima, leerCajas, leerMovimientos, retenerCaja } from '../../utilidades/caja';
import { conFilaRetenida } from '../../utilidades/carreras';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  asistenciasDe,
  clasesUsadasDe,
  en,
  type EscenarioDeAsistencia,
  marcarManual,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet, cuerpoRegenerar, rutaRegenerarQr } from '../../utilidades/escenario-carnet';
import { rutaFotoAlumno, subirFotoPanel } from '../../utilidades/escenario-foto-panel';
import { cuerpoCobro, rutaCobro, sembrarCobrable } from '../../utilidades/escenario-pagos';
import { rutaAprobacion, sembrarEnVerificacion } from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  ACCION_RENOVACION,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  cuantasDelMes,
  DICIEMBRE,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  resumen,
  retenerAlumno,
  retenerMatriculasDe,
  sinErroresDelServidor,
  type Via,
} from '../../utilidades/escenario-renovacion';
import { archivosBajo } from '../../utilidades/inscripciones-005b';
import { conRetencion, type RespuestaApi, retenerClases } from '../../utilidades/inscripciones';
import type { Retenedor } from '../../utilidades/planes-clases';
import { CLAVE_COMUN, cookieDeUsuario, crearUsuarioDePrueba } from '../../utilidades/usuarios';

// Criterio 13 (crítico, «Orden de bloqueos» de 005a, 006a y 007a): en una transacción: `bloquearActorVigente` → el bloqueo consultivo `inscripcion-dni:` del alumno → el alumno con `FOR UPDATE` → sus matrículas de M y M+1 con `FOR UPDATE` (ordenadas por id) →
// `bloquearClasesParaCupo` con las clases elegidas, en una sola llamada → «ahora», la configuración, la ocupación y las reservas → las escrituras → la caja, al final (solo el efectivo, dentro de `confirmarPagoEnTransaccion`). Pruebas deterministas sin `40P01`, a la vez
// que: el marcado de asistencia del mismo alumno (009), la regeneración de su QR y la foto del panel (008), el cobro de una solicitud con la misma clase (007a) y la aprobación de otro pago.
// Cómo se prueba: la prueba retiene una fila que las dos operaciones necesitan (el alumno, sus matrículas o la clase), envía las dos operaciones en los dos órdenes de llegada, comprueba que las dos esperan y recién entonces suelta. Una implementación que bloquee en otro
// orden (por ejemplo, la matrícula antes que el alumno, o la caja antes que la clase) forma un ciclo con la operación de la otra historia en alguno de los dos órdenes y termina en `40P01` (500).
// Lecturas estrictas elegidas: (1) «sin `40P01`» es: ninguna respuesta 5xx y ningún texto con `40P01`, `deadlock` o `interbloqueo`; (2) el 401 del actor que deja de ser vigente mientras la renovación espera (la primera sentencia es `bloquearActorVigente`) se prueba con el
// efectivo y con el comprobante y no deja nada escrito; (3) el marcado se hace el lunes 30/11 a las 18:05 de Lima (la clase de las 18:00 en la ventana), con la caja de ese día abierta.

const VIAS: Via[] = ['EFECTIVO', 'YAPE'];
const LUNES_30 = enLima('2026-11-30', '18:05');

describe.each(VIAS)('el orden de bloqueos de la renovación por %s (criterio 13)', (via) => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    await abrirCajaPara(esc, LUNES_30);
    cookies = en(ctx, esc, LUNES_30);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const renovar = (alumnoId: string) =>
    registrarRenovacion(ctx, esc, via, cookies.secretaria, alumnoId).then((r) => r.respuesta);

  /** Las dos operaciones esperan lo retenido y, al soltarlo, terminan: sin 5xx ni interbloqueo. Devuelve las respuestas en el orden de `enviar`. */
  async function cruce(
    retener: (retenedor: Retenedor) => Promise<void>,
    enviar: (() => Promise<RespuestaApi>)[],
  ): Promise<RespuestaApi[]> {
    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: esc.e.A.id,
      retener,
      enviar,
      enOrden: true,
      liberar: 'COMMIT',
    });
    expect(todasEsperaron, 'las operaciones debían quedar esperando lo que retuvo la prueba').toBe(true);
    sinErroresDelServidor(resultados);
    return resultados;
  }

  describe.each([
    ['la renovación llega primero', true],
    ['la otra operación llega primero', false],
  ])('%s', (_nombre, renovacionPrimero) => {
    const ordenar = (renovacion: () => Promise<RespuestaApi>, otra: () => Promise<RespuestaApi>) =>
      renovacionPrimero ? [renovacion, otra] : [otra, renovacion];
    const delOrden = (resultados: RespuestaApi[], cual: 'renovacion' | 'otra') =>
      resultados[(cual === 'renovacion') === renovacionPrimero ? 0 : 1] as RespuestaApi;

    it('criterio 13: con la fila del alumno retenida, la renovación y el marcado de asistencia del mismo alumno esperan, y al soltar terminan: 201 las dos, una asistencia y una renovación', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const marcar = () => marcarManual(ctx, cookies.secretaria, alumno.alumnoId);

      const resultados = await cruce(
        retenerAlumno(esc.e.A.id, alumno.alumnoId),
        ordenar(() => renovar(alumno.alumnoId), marcar),
      );

      expect(delOrden(resultados, 'renovacion').status, delOrden(resultados, 'renovacion').texto).toBe(201);
      expect(delOrden(resultados, 'otra').status, delOrden(resultados, 'otra').texto).toBe(201);
      expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
      expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
    });

    it('criterio 13: con las matrículas del alumno retenidas (después de su fila), la renovación y el marcado del mismo alumno terminan sin 40P01: alumno antes que matrícula en las dos', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const marcar = () => marcarManual(ctx, cookies.secretaria, alumno.alumnoId);

      const resultados = await cruce(
        retenerMatriculasDe(esc.e.A.id, alumno.alumnoId),
        ordenar(() => renovar(alumno.alumnoId), marcar),
      );

      expect(delOrden(resultados, 'renovacion').status, delOrden(resultados, 'renovacion').texto).toBe(201);
      expect(delOrden(resultados, 'otra').status, delOrden(resultados, 'otra').texto).toBe(201);
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(1);
    });

    it('criterio 13: la renovación y la regeneración del QR del mismo alumno (008) terminan sin 40P01 con la fila del alumno retenida', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const regenerar = () =>
        ctx.http.post(rutaRegenerarQr(alumno.alumnoId), cuerpoRegenerar(), { cookie: cookies.secretaria });

      const resultados = await cruce(
        retenerAlumno(esc.e.A.id, alumno.alumnoId),
        ordenar(() => renovar(alumno.alumnoId), regenerar),
      );

      expect(delOrden(resultados, 'renovacion').status, delOrden(resultados, 'renovacion').texto).toBe(201);
      expect(delOrden(resultados, 'otra').status, delOrden(resultados, 'otra').texto).toBe(200);
    });

    it('criterio 13: la renovación y la foto del panel del mismo alumno (008b) terminan sin 40P01 con la fila del alumno retenida', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const foto = () => subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: cookies.secretaria });

      const resultados = await cruce(
        retenerAlumno(esc.e.A.id, alumno.alumnoId),
        ordenar(() => renovar(alumno.alumnoId), foto),
      );

      expect(delOrden(resultados, 'renovacion').status, delOrden(resultados, 'renovacion').texto).toBe(201);
      expect(delOrden(resultados, 'otra').status, delOrden(resultados, 'otra').texto).toBe(204);
    });

    it('criterio 13: con la clase retenida, la renovación y el cobro en efectivo de una solicitud (007a) con la misma clase terminan sin 40P01: las dos 201 y la caja se bloquea al final', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const solicitud = await sembrarCobrable(esc.e, {
        claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
        ahora: LUNES_30,
        reservaVenceEn: enLima('2026-11-30', '23:59:00'),
      });
      const cobrar = () =>
        ctx.http.post(rutaCobro(solicitud.solicitudId), cuerpoCobro('42.00'), { cookie: cookies.secretaria });

      const resultados = await cruce(
        retenerClases([esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id], esc.e.A.id),
        ordenar(() => renovar(alumno.alumnoId), cobrar),
      );

      expect(delOrden(resultados, 'renovacion').status, delOrden(resultados, 'renovacion').texto).toBe(201);
      expect(delOrden(resultados, 'otra').status, delOrden(resultados, 'otra').texto).toBe(201);
      expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
      if (via === 'EFECTIVO') {
        const ingresos = (await leerMovimientos(esc.e.A.id)).filter(
          (m) => m.tipo === 'INGRESO' && m.concepto === 'MENSUALIDAD',
        );
        expect(ingresos.length).toBeGreaterThanOrEqual(2);
      }
    });

    // La aprobación de un comprobante no bloquea las clases (su cupo ya está contado): se cruza con el efectivo en lo que sí comparten, la caja, que va al final.
    if (via === 'EFECTIVO') {
      it('criterio 13: con la caja retenida, la renovación en efectivo y la aprobación del Yape de otro alumno (007b) terminan sin 40P01: la caja se bloquea al final en las dos', async () => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const otro = await sembrarEnVerificacion(esc.e, {
          claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
          ahora: LUNES_30,
        });
        const aprobar = () => ctx.http.post(rutaAprobacion(otro.pagoId), {}, { cookie: cookies.admin });
        const caja = (await leerCajas(esc.e.A.id)).find((c) => c.estado === 'ABIERTA');

        const resultados = await cruce(
          retenerCaja(esc.e.A.id, caja?.id ?? ''),
          ordenar(() => renovar(alumno.alumnoId), aprobar),
        );

        expect(delOrden(resultados, 'renovacion').status, delOrden(resultados, 'renovacion').texto).toBe(201);
        expect(delOrden(resultados, 'otra').status, delOrden(resultados, 'otra').texto).toBe(200);
        expect((await leerMovimientos(esc.e.A.id)).filter((m) => m.concepto === 'MENSUALIDAD')).toHaveLength(2);
      });
    }

    it('criterio 13: con la clase retenida, dos renovaciones de alumnos distintos con la misma clase (una de ellas de un alumno que no tiene matrícula de M) terminan sin 40P01', async () => {
      const [uno, otro] = [await crearAlumnoDeNoviembre(ctx, esc), await crearAlumnoVencido(ctx, esc)];

      const resultados = await cruce(
        retenerClases([esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id], esc.e.A.id),
        ordenar(
          () => renovar(uno.alumnoId),
          () => renovar(otro.alumnoId),
        ),
      );

      for (const respuesta of resultados) expect(respuesta.status, respuesta.texto).toBe(201);
    });
  });

  describe('bloquearActorVigente es la primera sentencia (el 401 gana a cualquier 201, 404 o 409)', () => {
    it.each(['desactivar', 'solo-version'] as const)(
      'criterio 13 (%s): si el actor deja de ser vigente mientras la renovación espera su fila, responde 401 NO_AUTENTICADO y no escribe ni audita',
      async (cambio) => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const x = await crearUsuarioDePrueba({ academiaId: esc.e.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
        const cookieX = cookieDeUsuario(x, LUNES_30);
        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: esc.e.A.id,
          actorId: x.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => registrarRenovacion(ctx, esc, via, cookieX, alumno.alumnoId).then((r) => r.respuesta),
        });

        expect(esperoElBloqueo, 'la renovación debía quedar esperando la fila del actor (bloquearActorVigente)').toBe(
          true,
        );
        expect(resumen(resultado), resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(0);
        expect(await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION)).toEqual([]);
        expect(archivosBajo(ctx.raiz), 'un 401 no deja archivo').toEqual([]);
      },
    );

    it('criterio 13 (control): si la prueba solo bloquea la fila del actor y hace ROLLBACK, la renovación espera y responde lo suyo (201)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const x = await crearUsuarioDePrueba({ academiaId: esc.e.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });
      const cookieX = cookieDeUsuario(x, LUNES_30);

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: esc.e.A.id,
        actorId: x.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'ROLLBACK',
        enviar: () => registrarRenovacion(ctx, esc, via, cookieX, alumno.alumnoId).then((r) => r.respuesta),
      });

      expect(esperoElBloqueo).toBe(true);
      expect(resultado.status, resultado.texto).toBe(201);
    });
  });
});
