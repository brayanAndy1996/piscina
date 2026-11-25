// spec: 008-carnet-qr (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AHORA_007 } from '../../utilidades/escenario-pagos';
import {
  type AlumnoConQr,
  type AppCarnet,
  codigoDeRespuesta,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
} from '../../utilidades/escenario-carnet';
import {
  instantaneaDeLaFoto,
  patronDeClave,
  prepararEscenarioFotoPanel,
  rutaFotoAlumno,
  rutaFotoSolicitud,
  sembrarCliente,
  subirFotoPanel,
} from '../../utilidades/escenario-foto-panel';
import { leerAlumnos, type RespuestaApi, type SolicitudSembrada } from '../../utilidades/inscripciones';
import {
  archivosBajo,
  archivosDelAlumno,
  existeArchivoDeClave,
  fotoClaveDe,
  png,
  subirFoto,
} from '../../utilidades/inscripciones-005b';
import { abrirRetenedor, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';

// Criterio 25 (crítico, DT-10 de 007: «ahora» después de bloquear), regresión de la revisión de la 008b: en la transacción de escritura de la foto, «ahora» (la hora con la que se repite la comprobación de vencimiento y la que se guarda en `actualizado_en`) se
// lee DESPUÉS de tomar los bloqueos de `alumnos` y `solicitudes_inscripcion`, no al abrir la transacción. Si la transacción espera un bloqueo, la comprobación usa la hora de después de esperar.
// Pruebas deterministas (espera comprobada en la cadena de bloqueos de PostgreSQL, como en `foto-panel-carreras.test.ts`): la prueba retiene la fila del alumno (`FOR UPDATE`), lanza la subida con el reloj en T0, espera a que la transacción de escritura de la API
// quede bloqueada (la comprobación previa, sin bloqueos, ya pasó con T0), mueve el reloj a T y suelta la fila.
//   a) ruta pública (`PUT /api/a/{nombreCorto}/solicitudes/foto`): una solicitud PENDIENTE_PAGO cuya reserva vence en T, con la subida lanzada en T0 < T: al soltar, 409 SOLICITUD_NO_EDITABLE, `foto_clave` sin cambio y el archivo nuevo borrado.
//   b) ruta del panel de la solicitud (`PUT /api/solicitudes/{id}/foto`): lo mismo.
//   c) las tres rutas, sin vencimiento de por medio: `actualizado_en` del alumno es la hora de después de la espera (T), no T0.
// Lecturas estrictas elegidas: «vence en T» y el reloj en T exactamente (el instante del vencimiento ya es 409, criterio 23 y 34 f de 005); la sesión del personal se firma en T0 y sigue siendo válida en T.

describe('«ahora» de la foto se lee después de los bloqueos (criterio 25)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;

  const T0 = AHORA_007;
  /** El instante de vencimiento de la reserva y la hora a la que se mueve el reloj mientras la subida espera. */
  const T = new Date(AHORA_007.getTime() + 30 * 60 * 1000);

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioFotoPanel(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc);
    ctx.reloj.fijar(T0);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const publica = (cliente: SolicitudSembrada, cuerpo: Buffer = png(100, 100)) =>
    subirFoto(ctx, 'academia-a', { token: cliente.token, cuerpo });
  const delPanelPorSolicitud = (solicitudId: string, cuerpo: Buffer = png(100, 100)) =>
    subirFotoPanel(ctx, rutaFotoSolicitud(solicitudId), { cookie: esc.cookies.secretaria, cuerpo });
  const delPanelPorAlumno = (alumnoId: string, cuerpo: Buffer = png(100, 100)) =>
    subirFotoPanel(ctx, rutaFotoAlumno(alumnoId), { cookie: esc.cookies.secretaria, cuerpo });
  const claveDe = (alumnoId: string) => fotoClaveDe(esc.e.A.id, alumnoId);

  /**
   * Retiene la fila del alumno, lanza la subida con el reloj en T0, espera a que la API quede bloqueada en esa fila, mueve el reloj a `nuevoAhora` y
   * suelta. Devuelve la respuesta y si de verdad quedó esperando.
   */
  async function subirMientrasElRelojAvanza(
    alumnoId: string,
    enviar: () => Promise<RespuestaApi>,
    nuevoAhora: Date,
  ): Promise<{ respuesta: RespuestaApi; esperando: boolean }> {
    ctx.reloj.fijar(T0);
    const retenedor = await abrirRetenedor(esc.e.A.id);
    try {
      await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
        esc.e.A.id,
        alumnoId,
      ]);
      const peticion = observar(enviar());
      const esperando = await esperarEspera(
        async () => (await retenedor.sesionesEsperando()) >= 1,
        [peticion],
        'la subida ni respondió ni quedó esperando la fila del alumno.',
      );
      ctx.reloj.fijar(nuevoAhora);
      await retenedor.liberar('ROLLBACK');
      const respuesta = await conLimite(
        peticion.resultado,
        'Límite de seguridad: la subida no respondió tras soltar la fila del alumno.',
      );
      return { respuesta, esperando };
    } finally {
      await retenedor.liberar('ROLLBACK');
    }
  }

  describe('a) y b) la reserva vence mientras la subida espera los bloqueos', () => {
    const RUTAS: [string, (cliente: SolicitudSembrada) => Promise<RespuestaApi>][] = [
      ['a) la ruta pública (enlace de seguimiento)', (cliente) => publica(cliente, png(120, 120))],
      ['b) la ruta del panel de la solicitud', (cliente) => delPanelPorSolicitud(cliente.solicitudId, png(120, 120))],
    ];

    it.each(RUTAS)(
      'criterio 25: %s: lanzada en T0 < T, la solicitud vence en T mientras espera: 409 SOLICITUD_NO_EDITABLE, foto_clave sin cambio y el archivo nuevo borrado',
      async (_nombre, subir) => {
        const cliente = await sembrarCliente(esc, { reservaVenceEn: T });
        const antes = await instantaneaDeLaFoto(ctx, esc);

        const { respuesta, esperando } = await subirMientrasElRelojAvanza(cliente.alumnoId, () => subir(cliente), T);

        expect(esperando, 'la subida debía quedar esperando la fila del alumno').toBe(true);
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
          409,
          'SOLICITUD_NO_EDITABLE',
        ]);
        expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['codigo', 'mensaje']);
        expect(await claveDe(cliente.alumnoId), 'alumnos.foto_clave').toBeNull();
        expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, cliente.alumnoId), 'el archivo nuevo debía borrarse').toEqual(
          [],
        );
        expect(archivosBajo(ctx.raiz)).toEqual([]);
        expect(await instantaneaDeLaFoto(ctx, esc), 'el rechazo no cambia nada (ni auditoría ni columnas del QR)').toBe(
          antes,
        );
      },
    );

    it.each(RUTAS)(
      'criterio 25: %s, con una foto anterior: el 409 deja intactos foto_clave y el archivo anterior, y no deja archivos nuevos',
      async (_nombre, subir) => {
        const cliente = await sembrarCliente(esc, { reservaVenceEn: T });
        expect((await publica(cliente)).status, 'la primera foto, en T0 < T').toBe(204);
        const anterior = (await claveDe(cliente.alumnoId)) as string;
        expect(anterior).toMatch(patronDeClave(esc.e.A.id, cliente.alumnoId));

        const { respuesta, esperando } = await subirMientrasElRelojAvanza(cliente.alumnoId, () => subir(cliente), T);

        expect(esperando, 'la subida debía quedar esperando la fila del alumno').toBe(true);
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
          409,
          'SOLICITUD_NO_EDITABLE',
        ]);
        expect(await claveDe(cliente.alumnoId)).toBe(anterior);
        expect(existeArchivoDeClave(ctx.raiz, anterior), 'el archivo anterior debía seguir').toBe(true);
        expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, cliente.alumnoId)).toEqual([anterior]);
      },
    );

    it.each(RUTAS)(
      'criterio 25 (control): %s: si el reloj no pasa de T mientras espera (T0 + 1 minuto < T), la subida se acepta: 204 y queda un solo archivo, el de foto_clave',
      async (_nombre, subir) => {
        const cliente = await sembrarCliente(esc, { reservaVenceEn: T });
        const antesDeT = new Date(T0.getTime() + 60 * 1000);

        const { respuesta, esperando } = await subirMientrasElRelojAvanza(
          cliente.alumnoId,
          () => subir(cliente),
          antesDeT,
        );

        expect(esperando).toBe(true);
        expect(respuesta.status, respuesta.texto).toBe(204);
        const clave = await claveDe(cliente.alumnoId);
        expect(clave).toMatch(patronDeClave(esc.e.A.id, cliente.alumnoId));
        expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, cliente.alumnoId)).toEqual([clave]);
      },
    );
  });

  describe('c) actualizado_en es la hora de después de la espera', () => {
    const DESPUES = new Date(T0.getTime() + 60 * 60 * 1000);

    async function actualizadoEn(alumnoId: string): Promise<Date> {
      const fila = (await leerAlumnos(esc.e.A.id)).find((f) => f.id === alumnoId);
      if (!fila) throw new Error(`El alumno ${alumnoId} no existe.`);
      return fila.actualizado_en;
    }

    it('criterio 25 c: la ruta del alumno (PUT /api/alumnos/{id}/foto), lanzada en T0 y soltada con el reloj en T0 + 1 h: 204 y actualizado_en es T0 + 1 h, no T0', async () => {
      const { respuesta, esperando } = await subirMientrasElRelojAvanza(
        alumno.alumnoId,
        () => delPanelPorAlumno(alumno.alumnoId),
        DESPUES,
      );

      expect(esperando, 'la subida debía quedar esperando la fila del alumno').toBe(true);
      expect(respuesta.status, respuesta.texto).toBe(204);
      expect(await claveDe(alumno.alumnoId)).toMatch(patronDeClave(esc.e.A.id, alumno.alumnoId));
      expect((await actualizadoEn(alumno.alumnoId)).toISOString()).toBe(DESPUES.toISOString());
    });

    it('criterio 25 c: la ruta de la solicitud del panel (PUT /api/solicitudes/{id}/foto): 204 y actualizado_en es la hora de después de la espera', async () => {
      const cliente = await sembrarCliente(esc);

      const { respuesta, esperando } = await subirMientrasElRelojAvanza(
        cliente.alumnoId,
        () => delPanelPorSolicitud(cliente.solicitudId),
        DESPUES,
      );

      expect(esperando).toBe(true);
      expect(respuesta.status, respuesta.texto).toBe(204);
      expect((await actualizadoEn(cliente.alumnoId)).toISOString()).toBe(DESPUES.toISOString());
    });

    it('criterio 25 c: la ruta pública (enlace de seguimiento): 204 y actualizado_en es la hora de después de la espera', async () => {
      const cliente = await sembrarCliente(esc);

      const { respuesta, esperando } = await subirMientrasElRelojAvanza(
        cliente.alumnoId,
        () => publica(cliente),
        DESPUES,
      );

      expect(esperando).toBe(true);
      expect(respuesta.status, respuesta.texto).toBe(204);
      expect((await actualizadoEn(cliente.alumnoId)).toISOString()).toBe(DESPUES.toISOString());
    });
  });
});
