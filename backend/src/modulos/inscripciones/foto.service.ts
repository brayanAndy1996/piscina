import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  FOTO_LADO_GUARDADO,
  FOTO_LADO_MAXIMO,
  FOTO_LADO_MINIMO,
  FOTO_PIXELES_MAXIMOS,
  type FotoTipo,
  PATRON_TOKEN,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import sharp from 'sharp';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { tipoDeError } from '../../infraestructura/correo';
import { type AcademiaResuelta, BaseDatos, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { hashDeToken } from './dominio/codigos';
import { imagenNoValida, solicitudNoEditable, solicitudNoEncontrada } from './errores';
import { estadoVisible } from './estado-visible';

// `sharp` guarda en memoria las últimas operaciones por defecto: en un servidor que recibe fotos de desconocidos no sirve de nada.
sharp.cache(false);

/** Las firmas de los primeros bytes: lo que dice ser el archivo tiene que coincidir con el tipo que declara el cliente (criterio 34 g). */
const FIRMA_JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FORMATO_DE_SHARP: Readonly<Record<FotoTipo, string>> = { 'image/jpeg': 'jpeg', 'image/png': 'png' };
const CALIDAD_JPEG = 85;

interface FilaDeLaSolicitud {
  solicitud_id: string;
  alumno_id: string;
  estado_solicitud: 'PENDIENTE_PAGO' | 'VENCIDA' | 'CANCELADA';
  estado_matricula: 'RESERVADA' | 'VIGENTE' | 'FINALIZADA' | 'CANCELADA';
  reserva_vence_en: Date | null;
  estado_alumno: string;
}

/**
 * La foto opcional de la solicitud (spec 005b, criterios 34 a 37; D-20, D-21, D-24, RNF-05). Orden de las comprobaciones: las tres primeras
 * (límite por conexión, tipo y codificación, tamaño) son middlewares de Express; aquí siguen la academia (el pipe del controlador), el
 * token, el estado de la solicitud y, al final, la imagen. Después:
 *
 * 1. La imagen se valida y se vuelve a codificar con `sharp` como JPEG de como mucho 800 píxeles de lado mayor, con la orientación
 *    aplicada y sin metadatos (EXIF, GPS, XMP, ICC, comentarios): lo guardado nunca es el archivo subido. Todo fuera de la transacción.
 * 2. Se guarda con una clave nueva del servidor, `academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`, **antes** de la transacción
 *    (un archivo sin referencia no lo ve nadie; una referencia a un archivo que no existe, sí).
 * 3. Una transacción corta bloquea `alumnos` y después `solicitudes_inscripcion` (el orden de "Orden de bloqueos": el envío con el mismo
 *    DNI toma el alumno antes que sus solicitudes), repite la comprobación de que la solicitud sigue editable y guarda la clave.
 * 4. Después de confirmar se borra el archivo anterior; si la transacción falla, se borra el nuevo. Un borrado que falla solo deja un aviso
 *    con el tipo del error (nunca su mensaje, que lleva la ruta) y no cambia la respuesta.
 *
 * Sin auditoría: la foto no es una operación de caja, pago ni horario (criterio 37).
 */
@Injectable()
export class FotoService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(FotoService.name);
  }

  /** `token` es la cabecera cruda: cualquier cosa que no sea un token con su forma exacta es "no encontrada" (criterio 34 e). */
  async subir(academia: AcademiaResuelta, token: unknown, cuerpo: Buffer, tipo: FotoTipo): Promise<void> {
    if (typeof token !== 'string' || !PATRON_TOKEN.test(token)) throw solicitudNoEncontrada();
    const hash = hashDeToken(token);

    // Comprobación previa (d a f): una lectura corta, sin bloqueos y sin tocar archivos, para no gastar CPU en un token que no sirve.
    const previa = await this.baseDatos.conAcademia(academia.id, async (tx) => {
      const fila = await this.leerPorToken(tx, hash);
      if (!fila) throw solicitudNoEncontrada();
      if (!this.esEditable(fila, this.reloj.ahora())) throw solicitudNoEditable();
      return fila;
    });

    // Imagen (g), fuera de toda transacción.
    const jpeg = await this.recodificar(cuerpo, tipo);

    const clave = `academias/${academia.id}/alumnos/${previa.alumno_id}/foto-${randomUUID()}.jpg`;
    const guardado = await Promise.resolve()
      .then(() => this.almacen.guardar(academia.id, clave, jpeg, 'image/jpeg'))
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    if (!guardado.ok) {
      this.registro.error(
        { academiaId: academia.id, error: { tipo: tipoDeError(guardado.error) } },
        'No se pudo guardar la foto',
      );
      // Un error nuevo y sin causa: el del almacén lleva la ruta. La respuesta es 500 `ERROR_INTERNO` y la base no cambió.
      throw new Error('No se pudo guardar la foto de la solicitud.');
    }

    let anterior: string | null;
    try {
      anterior = await this.baseDatos.conAcademia(academia.id, (tx) =>
        this.confirmar(tx, previa.solicitud_id, previa.alumno_id, clave),
      );
    } catch (error) {
      // La transacción falló (409 por una carrera o un error de la base): el archivo nuevo no lo referencia nadie.
      await this.borrarSinFallar(academia.id, clave);
      throw error;
    }
    if (anterior !== null && anterior !== clave) await this.borrarSinFallar(academia.id, anterior);
    this.registro.info({ academiaId: academia.id }, 'Foto de la solicitud guardada');
  }

  /** La solicitud del token con su matrícula y su alumno, sin bloquear nada. */
  private async leerPorToken(tx: TransaccionAcademia, hash: string): Promise<FilaDeLaSolicitud | undefined> {
    const filas = await tx.cliente.$queryRaw<FilaDeLaSolicitud[]>`
      SELECT s.id::text AS solicitud_id, s.alumno_id::text AS alumno_id, s.estado::text AS estado_solicitud,
             m.estado::text AS estado_matricula, m.reserva_vence_en, a.estado::text AS estado_alumno
        FROM solicitudes_inscripcion s
        JOIN alumnos a ON a.academia_id = s.academia_id AND a.id = s.alumno_id
        JOIN matriculas m ON m.academia_id = s.academia_id AND m.solicitud_id = s.id
       WHERE s.academia_id = ${tx.academiaId}::uuid AND s.token_hash = decode(${hash}::text, 'hex')
       ORDER BY m.creado_en DESC
       LIMIT 1`;
    return filas[0];
  }

  /**
   * ¿Admite la foto? Solo con la vista completa (PB5): estado visible `PENDIENTE_PAGO`, fila `PENDIENTE_PAGO` y alumno `CLIENTE`. Una
   * `PENDIENTE_PAGO` sin vencimiento (pago en verificación, desde la 007) sigue aceptándola. En el instante exacto del vencimiento (con el
   * tope del fin de mes, criterio 54) ya es `VENCIDA`.
   */
  private esEditable(fila: FilaDeLaSolicitud, ahora: Date): boolean {
    return (
      fila.estado_solicitud === 'PENDIENTE_PAGO' &&
      fila.estado_alumno === 'CLIENTE' &&
      estadoVisible(fila, ahora) === 'PENDIENTE_PAGO'
    );
  }

  /**
   * La transacción de la foto: `alumnos` `FOR UPDATE` y después `solicitudes_inscripcion` `FOR UPDATE`, se repite la comprobación (409 si la
   * solicitud cambió mientras se procesaba la imagen), se lee la clave anterior y se guarda la nueva. Devuelve la clave anterior.
   */
  private async confirmar(
    tx: TransaccionAcademia,
    solicitudId: string,
    alumnoId: string,
    clave: string,
  ): Promise<string | null> {
    const alumnos = await tx.cliente.$queryRaw<{ estado: string; foto_clave: string | null }[]>`
      SELECT estado::text AS estado, foto_clave FROM alumnos
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumnoId}::uuid
         FOR UPDATE`;
    const solicitudes = await tx.cliente.$queryRaw<{ estado: FilaDeLaSolicitud['estado_solicitud'] }[]>`
      SELECT estado::text AS estado FROM solicitudes_inscripcion
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${solicitudId}::uuid
         FOR UPDATE`;
    const matriculas = await tx.cliente.$queryRaw<
      { estado: FilaDeLaSolicitud['estado_matricula']; reserva_vence_en: Date | null }[]
    >`
      SELECT estado::text AS estado, reserva_vence_en FROM matriculas
       WHERE academia_id = ${tx.academiaId}::uuid AND solicitud_id = ${solicitudId}::uuid
       ORDER BY creado_en DESC
       LIMIT 1`;
    const alumno = alumnos[0];
    const solicitud = solicitudes[0];
    const matricula = matriculas[0];
    if (!alumno || !solicitud || !matricula) throw solicitudNoEncontrada();
    const ahora = this.reloj.ahora();
    const fila: FilaDeLaSolicitud = {
      solicitud_id: solicitudId,
      alumno_id: alumnoId,
      estado_solicitud: solicitud.estado,
      estado_matricula: matricula.estado,
      reserva_vence_en: matricula.reserva_vence_en,
      estado_alumno: alumno.estado,
    };
    if (!this.esEditable(fila, ahora)) throw solicitudNoEditable();
    await tx.cliente.$executeRaw`
      UPDATE alumnos SET foto_clave = ${clave}, actualizado_en = ${ahora}::timestamptz
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumnoId}::uuid`;
    return alumno.foto_clave;
  }

  /**
   * Valida la imagen y la vuelve a codificar (criterios 34 g y 35): firma coherente con el tipo declarado, que `sharp` la decodifique
   * (también una cortada), lados de 100 a 8000 píxeles y como mucho 40 megapíxeles, tal como vienen en el archivo (antes de la
   * orientación). Sale un JPEG de como mucho 800 píxeles de lado mayor (sin agrandar), con la orientación aplicada y sin metadatos
   * (`sharp` no copia ninguno si no se le pide). Cualquier fallo, de lo que sea, es el mismo 400 `IMAGEN_NO_VALIDA`.
   */
  private async recodificar(cuerpo: Buffer, tipo: FotoTipo): Promise<Buffer> {
    const firma = tipo === 'image/jpeg' ? FIRMA_JPEG : FIRMA_PNG;
    if (cuerpo.length < firma.length || !cuerpo.subarray(0, firma.length).equals(firma)) throw imagenNoValida();
    try {
      const imagen = sharp(cuerpo, { limitInputPixels: FOTO_PIXELES_MAXIMOS, failOn: 'error' });
      const { format, width, height } = await imagen.metadata();
      if (format !== FORMATO_DE_SHARP[tipo] || width === undefined || height === undefined) throw imagenNoValida();
      if (
        Math.min(width, height) < FOTO_LADO_MINIMO ||
        Math.max(width, height) > FOTO_LADO_MAXIMO ||
        width * height > FOTO_PIXELES_MAXIMOS
      ) {
        throw imagenNoValida();
      }
      return await imagen
        .rotate()
        .resize({ width: FOTO_LADO_GUARDADO, height: FOTO_LADO_GUARDADO, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .toColourspace('srgb')
        .jpeg({ quality: CALIDAD_JPEG, mozjpeg: true })
        .toBuffer();
    } catch {
      throw imagenNoValida();
    }
  }

  /** Borra un archivo después de confirmar (o tras un fallo): un borrado que falla deja un aviso con el tipo del error y nada más. */
  private async borrarSinFallar(academiaId: string, clave: string): Promise<void> {
    try {
      await this.almacen.borrar(academiaId, clave);
    } catch (error) {
      try {
        this.registro.warn({ academiaId, error: { tipo: tipoDeError(error) } }, 'No se pudo borrar un archivo');
      } catch {
        // Un registro que falla no cambia la respuesta.
      }
    }
  }
}
