// spec: 008-carnet-qr (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  type AlumnoConQr,
  type AppCarnet,
  carnetDe,
  codigoDeRespuesta,
  conAlumnoRetenido,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
  leerQr,
  rutaCarnet,
} from '../../utilidades/escenario-carnet';
import {
  patronDeClave,
  prepararEscenarioFotoPanel,
  rutaFotoAlumno,
  rutaFotoSolicitud,
  sembrarCliente,
  subirFotoPanel,
} from '../../utilidades/escenario-foto-panel';
import { cuerpoCobro, rutaCancelar, rutaCobro } from '../../utilidades/escenario-pagos';
import { rutaAprobacion, sembrarEnVerificacion } from '../../utilidades/escenario-pagos-007b';
import {
  conRetencion,
  leerMatriculas,
  leerSolicitudes,
  type RespuestaApi,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import {
  archivosBajo,
  archivosDelAlumno,
  existeArchivoDeClave,
  fotoClaveDe,
  leerArchivoDeClave,
  png,
  subirFoto,
} from '../../utilidades/inscripciones-005b';
import type { Retenedor } from '../../utilidades/planes-clases';

// Criterio 26 (crítico): subidas a la vez de la foto del panel. Pruebas deterministas (espera comprobada en `pg_locks`): (a) una subida del panel y una del enlace de seguimiento (005b) del mismo cliente a la vez responden 204 las dos, y en la carpeta del alumno queda
// exactamente un archivo, el de `foto_clave`; (b) dos subidas del panel a la vez, ídem; (c) una subida a una solicitud que se cancela mientras espera la fila del alumno responde 409 y no deja archivo nuevo; (d) una subida a un cliente cuyo pago se confirma mientras espera
// (pasa a `CONFIRMADA`) responde 204 y el alumno queda con su foto y su QR.
// Cómo se cruzan: la prueba retiene la fila del alumno (`FOR UPDATE`) en una transacción propia; las peticiones llegan a la espera de esa fila (la subida ya guardó su archivo nuevo, antes de la transacción de escritura); la prueba comprueba en `pg_locks` que todas esperan
// y suelta la fila. Con `enOrden`, cada petición se envía cuando la anterior ya espera, así se sabe quién llegó primero.
// Lecturas estrictas elegidas: en (a) y (b) el archivo que queda es el de la subida que confirmó última (no se exige cuál); en (c) también con la cancelación real (`POST /api/solicitudes/{id}/cancelar`), y la cancelación que llega después de la subida no borra la foto (DR-18 de 005);
// en (d) el pago se confirma con el cobro en efectivo y con la aprobación de un Yape, y la subida que llega antes que la confirmación también deja la foto y el QR.

describe('subidas a la vez de la foto del panel (criterio 26)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;
  let cliente: SolicitudSembrada;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioFotoPanel(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc);
    cliente = await sembrarCliente(esc);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const delAlumno = (cual: 'alumno' | 'solicitud', cookie = esc.cookies.secretaria, cuerpo: Buffer = png(100, 100)) =>
    subirFotoPanel(ctx, cual === 'alumno' ? rutaFotoAlumno(alumno.alumnoId) : rutaFotoSolicitud(cliente.solicitudId), {
      cookie,
      cuerpo,
    });
  const deSolicitud = (solicitudId: string, cookie = esc.cookies.secretaria, cuerpo: Buffer = png(100, 100)) =>
    subirFotoPanel(ctx, rutaFotoSolicitud(solicitudId), { cookie, cuerpo });
  const publica = (cuerpo: Buffer = png(100, 100)) => subirFoto(ctx, 'academia-a', { token: cliente.token, cuerpo });
  const claveDe = (alumnoId: string) => fotoClaveDe(esc.e.A.id, alumnoId);
  const archivos = (alumnoId: string) => archivosDelAlumno(ctx.raiz, esc.e.A.id, alumnoId);

  /** El invariante de la foto: foto_clave apunta a un archivo que existe y es el único de la carpeta del alumno. */
  async function comprobarUnSoloArchivo(alumnoId: string, anterior?: string): Promise<string> {
    const clave = await claveDe(alumnoId);
    expect(clave, 'alumnos.foto_clave').not.toBeNull();
    expect(clave).toMatch(patronDeClave(esc.e.A.id, alumnoId));
    expect(existeArchivoDeClave(ctx.raiz, clave as string), 'foto_clave apunta a un archivo que no existe').toBe(true);
    expect(archivos(alumnoId), 'quedan archivos sin referencia o falta el de foto_clave').toEqual([clave]);
    if (anterior !== undefined) expect(clave, 'la foto anterior debía reemplazarse').not.toBe(anterior);
    return clave as string;
  }

  describe('a) una subida del panel y una del enlace de seguimiento del mismo cliente', () => {
    it('criterio 26 a: con la fila del alumno retenida, las dos esperan; al soltarla responden 204 las dos y queda exactamente un archivo, el de foto_clave', async () => {
      const { resultados, esperaron, maximoEnEspera } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: cliente.alumnoId,
        enviar: [
          () => deSolicitud(cliente.solicitudId, esc.cookies.secretaria, png(110, 110)),
          () => publica(png(130, 130)),
        ],
        esperando: 2,
      });

      expect(esperaron, `las dos subidas debían quedar esperando en pg_locks (máximo visto: ${maximoEnEspera})`).toBe(
        true,
      );
      expect(
        resultados.map((r) => r.status),
        resultados.map((r) => r.texto.slice(0, 200)).join(' | '),
      ).toEqual([204, 204]);
      await comprobarUnSoloArchivo(cliente.alumnoId);
      expect(archivosBajo(ctx.raiz)).toHaveLength(1);
    });

    it('criterio 26 a: lo mismo con la subida pública primero y la del panel después, y con una foto anterior que se reemplaza', async () => {
      expect((await publica(png(100, 100))).status).toBe(204);
      const anterior = (await claveDe(cliente.alumnoId)) as string;

      const { resultados, esperaron, maximoEnEspera } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: cliente.alumnoId,
        enviar: [
          () => publica(png(140, 140)),
          () => deSolicitud(cliente.solicitudId, esc.cookies.admin, png(150, 150)),
        ],
        esperando: 2,
      });

      expect(esperaron, `las dos subidas debían quedar esperando en pg_locks (máximo visto: ${maximoEnEspera})`).toBe(
        true,
      );
      expect(resultados.map((r) => r.status)).toEqual([204, 204]);
      await comprobarUnSoloArchivo(cliente.alumnoId, anterior);
      expect(existeArchivoDeClave(ctx.raiz, anterior), 'el archivo anterior debía borrarse').toBe(false);
    });
  });

  describe('b) dos subidas del panel a la vez', () => {
    it('criterio 26 b: dos subidas del panel a un alumno responden 204 las dos; foto_clave apunta a un archivo que existe y es el único de la carpeta del alumno', async () => {
      const { resultados, esperaron, maximoEnEspera } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: alumno.alumnoId,
        enviar: [
          () => delAlumno('alumno', esc.cookies.secretaria, png(100, 100)),
          () => delAlumno('alumno', esc.cookies.admin, png(130, 130)),
        ],
        esperando: 2,
      });

      expect(esperaron, `las dos subidas debían quedar esperando en pg_locks (máximo visto: ${maximoEnEspera})`).toBe(
        true,
      );
      expect(resultados.map((r) => r.status)).toEqual([204, 204]);
      await comprobarUnSoloArchivo(alumno.alumnoId);
    });

    it('criterio 26 b: con una foto anterior, dos subidas simultáneas dejan una sola foto (la de foto_clave) y borran la anterior', async () => {
      expect((await delAlumno('alumno')).status).toBe(204);
      const anterior = (await claveDe(alumno.alumnoId)) as string;

      const { resultados, esperaron } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: alumno.alumnoId,
        enviar: [
          () => delAlumno('alumno', esc.cookies.secretaria, png(110, 110)),
          () => delAlumno('alumno', esc.cookies.admin, png(140, 140)),
        ],
        esperando: 2,
      });

      expect(esperaron).toBe(true);
      expect(resultados.map((r) => r.status)).toEqual([204, 204]);
      await comprobarUnSoloArchivo(alumno.alumnoId, anterior);
      expect(existeArchivoDeClave(ctx.raiz, anterior)).toBe(false);
    });

    it('criterio 26 b: dos subidas a la solicitud de un cliente (la secretaria y el administrador) responden 204 las dos y dejan un solo archivo', async () => {
      const { resultados, esperaron } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: cliente.alumnoId,
        enviar: [
          () => deSolicitud(cliente.solicitudId, esc.cookies.secretaria, png(100, 100)),
          () => deSolicitud(cliente.solicitudId, esc.cookies.admin, png(130, 130)),
        ],
        esperando: 2,
      });

      expect(esperaron).toBe(true);
      expect(resultados.map((r) => r.status)).toEqual([204, 204]);
      await comprobarUnSoloArchivo(cliente.alumnoId);
    });

    it('criterio 26 b: una subida por /api/alumnos/{id}/foto y otra por la solicitud confirmada del mismo alumno responden 204 las dos y dejan un solo archivo', async () => {
      const { resultados, esperaron } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: alumno.alumnoId,
        enviar: [
          () => delAlumno('alumno', esc.cookies.secretaria, png(100, 100)),
          () => deSolicitud(alumno.solicitudId, esc.cookies.admin, png(130, 130)),
        ],
        esperando: 2,
      });

      expect(esperaron).toBe(true);
      expect(resultados.map((r) => r.status)).toEqual([204, 204]);
      await comprobarUnSoloArchivo(alumno.alumnoId);
    });

    it('criterio 26 b: tres subidas a la vez (dos del panel y una pública) dejan un solo archivo y ningún 500', async () => {
      const { resultados, esperaron } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: cliente.alumnoId,
        enviar: [
          () => deSolicitud(cliente.solicitudId, esc.cookies.secretaria, png(100, 100)),
          () => publica(png(120, 120)),
          () => deSolicitud(cliente.solicitudId, esc.cookies.admin, png(140, 140)),
        ],
        esperando: 3,
      });

      expect(esperaron).toBe(true);
      expect(resultados.map((r) => r.status)).toEqual([204, 204, 204]);
      await comprobarUnSoloArchivo(cliente.alumnoId);
    });
  });

  describe('c) la solicitud se cancela mientras la subida espera la fila del alumno', () => {
    /** Pasa la solicitud y su matrícula a CANCELADA dentro de la transacción de la prueba (como dueño). */
    const cancelarSinConfirmar = (alumnoId: string, solicitudId: string) => async (retenedor: Retenedor) => {
      await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
        esc.e.A.id,
        alumnoId,
      ]);
      await retenedor.consultar(
        "UPDATE solicitudes_inscripcion SET estado = 'CANCELADA', actualizado_en = now() WHERE academia_id = $1::uuid AND id = $2::uuid",
        [esc.e.A.id, solicitudId],
      );
      await retenedor.consultar(
        "UPDATE matriculas SET estado = 'CANCELADA', reserva_vence_en = NULL, actualizado_en = now() WHERE academia_id = $1::uuid AND solicitud_id = $2::uuid",
        [esc.e.A.id, solicitudId],
      );
    };

    it('criterio 26 c: la prueba bloquea la fila del alumno, la subida válida queda esperando; la prueba cancela la solicitud y su matrícula y confirma: 409 SOLICITUD_NO_EDITABLE, foto_clave nula y ningún archivo nuevo', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: esc.e.A.id,
        retener: cancelarSinConfirmar(cliente.alumnoId, cliente.solicitudId),
        enviar: [() => deSolicitud(cliente.solicitudId)],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron, 'la subida no quedó esperando la fila del alumno').toBe(true);
      const [respuesta] = resultados;
      expect([respuesta?.status, respuesta?.body?.['codigo']], respuesta?.texto).toEqual([
        409,
        'SOLICITUD_NO_EDITABLE',
      ]);
      expect(await claveDe(cliente.alumnoId)).toBeNull();
      expect(archivos(cliente.alumnoId), 'quedó un archivo nuevo en la carpeta del alumno').toEqual([]);
      expect(archivosBajo(ctx.raiz)).toEqual([]);
      expect((await leerSolicitudes(esc.e.A.id)).find((s) => s.id === cliente.solicitudId)?.estado).toBe('CANCELADA');
      expect((await leerMatriculas(esc.e.A.id)).find((m) => m.solicitud_id === cliente.solicitudId)?.estado).toBe(
        'CANCELADA',
      );
    });

    it('criterio 26 c: con una foto anterior, la subida que pierde la carrera deja foto_clave y el archivo anterior intactos y sin archivos nuevos', async () => {
      expect((await deSolicitud(cliente.solicitudId)).status).toBe(204);
      const anterior = (await claveDe(cliente.alumnoId)) as string;

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: esc.e.A.id,
        retener: cancelarSinConfirmar(cliente.alumnoId, cliente.solicitudId),
        enviar: [() => deSolicitud(cliente.solicitudId, esc.cookies.admin, png(150, 150))],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      expect(resultados[0]?.status).toBe(409);
      expect(await claveDe(cliente.alumnoId)).toBe(anterior);
      expect(archivos(cliente.alumnoId)).toEqual([anterior]);
    });

    it('criterio 26 c: con la cancelación real (POST /api/solicitudes/{id}/cancelar) que llega primero a la fila del alumno, la subida responde 409 y no deja archivo nuevo', async () => {
      const { resultados, todasEsperaron } = await conRetencion<RespuestaApi>({
        academiaId: esc.e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar(
            'SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [esc.e.A.id, cliente.alumnoId],
          );
        },
        enviar: [
          () =>
            ctx.http.post(
              rutaCancelar(cliente.solicitudId),
              { motivo: 'Pidió que la cancelen por teléfono' },
              { cookie: esc.cookies.admin },
            ),
          () => deSolicitud(cliente.solicitudId, esc.cookies.secretaria),
        ],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron, 'la cancelación y la subida debían quedar esperando la fila del alumno').toBe(true);
      const [cancelacion, subida] = resultados;
      expect(cancelacion?.status, cancelacion?.texto).toBe(200);
      expect([subida?.status, codigoDeRespuesta(subida as RespuestaApi)], subida?.texto).toEqual([
        409,
        'SOLICITUD_NO_EDITABLE',
      ]);
      expect(await claveDe(cliente.alumnoId)).toBeNull();
      expect(archivosBajo(ctx.raiz)).toEqual([]);
    });

    it('criterio 26 c (el orden contrario): si la subida llega primero a la fila del alumno, gana la subida (204) y la cancelación que llega después (200) no borra la foto', async () => {
      const { resultados, todasEsperaron } = await conRetencion<RespuestaApi>({
        academiaId: esc.e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar(
            'SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [esc.e.A.id, cliente.alumnoId],
          );
        },
        enviar: [
          () => deSolicitud(cliente.solicitudId, esc.cookies.secretaria),
          () =>
            ctx.http.post(
              rutaCancelar(cliente.solicitudId),
              { motivo: 'Pidió que la cancelen por teléfono' },
              { cookie: esc.cookies.admin },
            ),
        ],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      expect(todasEsperaron).toBe(true);
      const [subida, cancelacion] = resultados;
      expect(subida?.status, subida?.texto).toBe(204);
      expect(cancelacion?.status, cancelacion?.texto).toBe(200);
      await comprobarUnSoloArchivo(cliente.alumnoId);
    });
  });

  describe('d) el pago se confirma mientras la subida espera la fila del alumno', () => {
    /** Retiene la fila del alumno; primero llega la confirmación y después la subida (o al revés), y las dos esperan. */
    async function retenerYEnviar(alumnoId: string, enviar: readonly (() => Promise<RespuestaApi>)[]) {
      return conRetencion<RespuestaApi>({
        academiaId: esc.e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar(
            'SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [esc.e.A.id, alumnoId],
          );
        },
        enviar,
        liberar: 'ROLLBACK',
        enOrden: true,
      });
    }

    async function comprobarConFotoYQr(alumnoId: string): Promise<void> {
      const clave = await comprobarUnSoloArchivo(alumnoId);
      const qr = await leerQr(esc.e.A.id, alumnoId);
      expect(qr.estado, 'el pago se confirmó: el alumno ya no es CLIENTE').toBe('ALUMNO_ACTIVO');
      expect(qr.qr_token, 'el alumno queda con su QR').not.toBeNull();
      expect(qr.foto_clave).toBe(clave);
      const carnet = carnetDe(await ctx.http.get(rutaCarnet(alumnoId), { cookie: esc.cookies.secretaria }));
      expect(carnet.foto, 'el carnet muestra la foto').toBe(
        `data:image/jpeg;base64,${leerArchivoDeClave(ctx.raiz, clave).toString('base64')}`,
      );
      expect(carnet.qr, 'el carnet muestra el QR').not.toBeNull();
    }

    it('criterio 26 d: el cobro en efectivo llega primero y la subida del panel espera; al soltar, el cobro se confirma (201) y la subida responde 204: el alumno queda con su foto y su QR', async () => {
      const { resultados, todasEsperaron } = await retenerYEnviar(cliente.alumnoId, [
        () => ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie: esc.cookies.secretaria }),
        () => deSolicitud(cliente.solicitudId, esc.cookies.admin),
      ]);

      expect(todasEsperaron, 'el cobro y la subida debían quedar esperando la fila del alumno').toBe(true);
      const [cobro, subida] = resultados;
      expect(cobro?.status, cobro?.texto).toBe(201);
      expect(subida?.status, subida?.texto).toBe(204);
      await comprobarConFotoYQr(cliente.alumnoId);
    });

    it('criterio 26 d: lo mismo con la aprobación de un Yape en revisión (200) y la subida (204)', async () => {
      const enRevision = await sembrarEnVerificacion(esc.e);

      const { resultados, todasEsperaron } = await retenerYEnviar(enRevision.alumnoId, [
        () => ctx.http.post(rutaAprobacion(enRevision.pagoId), {}, { cookie: esc.cookies.secretaria }),
        () => deSolicitud(enRevision.solicitudId, esc.cookies.admin),
      ]);

      expect(todasEsperaron).toBe(true);
      const [aprobacion, subida] = resultados;
      expect(aprobacion?.status, aprobacion?.texto).toBe(200);
      expect(subida?.status, subida?.texto).toBe(204);
      await comprobarConFotoYQr(enRevision.alumnoId);
    });

    it('criterio 26 d (el orden contrario): si la subida llega primero a la fila del alumno, también termina en 204 y la confirmación del pago que llega después no pierde la foto', async () => {
      const { resultados, todasEsperaron } = await retenerYEnviar(cliente.alumnoId, [
        () => deSolicitud(cliente.solicitudId, esc.cookies.admin),
        () => ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie: esc.cookies.secretaria }),
      ]);

      expect(todasEsperaron).toBe(true);
      const [subida, cobro] = resultados;
      expect(subida?.status, subida?.texto).toBe(204);
      expect(cobro?.status, cobro?.texto).toBe(201);
      await comprobarConFotoYQr(cliente.alumnoId);
    });

    it('criterio 26 d: la subida que espera mientras el pago se confirma no cambia el token del QR que nació con el pago ni deja la fila del alumno en un estado distinto de ALUMNO_ACTIVO', async () => {
      const { resultados } = await retenerYEnviar(cliente.alumnoId, [
        () => ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie: esc.cookies.secretaria }),
        () => deSolicitud(cliente.solicitudId, esc.cookies.admin),
      ]);
      expect(resultados.map((r) => r.status)).toEqual([201, 204]);

      const { rows } = await ejecutarComo(
        'propietario',
        'SELECT estado::text AS estado, qr_token, qr_generado_en, foto_clave FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid',
        [esc.e.A.id, cliente.alumnoId],
        { academiaId: esc.e.A.id },
      );
      const fila = rows[0] as {
        estado: string;
        qr_token: string | null;
        qr_generado_en: Date | null;
        foto_clave: string | null;
      };
      expect(fila.estado).toBe('ALUMNO_ACTIVO');
      expect(fila.qr_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fila.qr_generado_en).not.toBeNull();
      expect(fila.foto_clave).toMatch(patronDeClave(esc.e.A.id, cliente.alumnoId));
    });
  });
});
