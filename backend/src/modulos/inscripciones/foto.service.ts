import { Inject, Injectable } from '@nestjs/common';
import { type FotoTipo, PATRON_TOKEN } from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { type AcademiaResuelta, BaseDatos, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { hashDeToken } from './dominio/codigos';
import { solicitudNoEditable, solicitudNoEncontrada } from './errores';
import { unirUltimoPago } from './estado-visible';
import { reemplazarFotoDelAlumno } from './foto-del-alumno';
import { bloquearYLeerLaSolicitud, esEditable, type FilaDeLaSolicitud } from './foto-solicitud';

/**
 * La foto opcional de la solicitud (spec 005b, criterios 34 a 37; D-20, D-21, D-24, RNF-05). Orden de las comprobaciones: las tres primeras
 * (límite por conexión, tipo y codificación, tamaño) son middlewares de Express; aquí siguen la academia (el pipe del controlador), el
 * token, el estado de la solicitud y, al final, la imagen. Después, `reemplazarFotoDelAlumno` (la función común de la 005b y la 008b, DT-10):
 * recodifica la imagen sin metadatos, la guarda con una clave nueva antes de la transacción, bloquea `alumnos` y después
 * `solicitudes_inscripcion` (el orden de "Orden de bloqueos"), repite la comprobación de que la solicitud sigue editable (409), guarda la clave,
 * borra el archivo anterior después de confirmar y resuelve la confirmación incierta (criterio 61).
 *
 * Sin auditoría: la foto pública no es una operación de caja, pago ni horario (criterio 37). La foto del panel sí se audita (008b, criterio 27).
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
      if (!esEditable(fila, this.reloj.ahora())) throw solicitudNoEditable();
      return fila;
    });

    await reemplazarFotoDelAlumno(
      { baseDatos: this.baseDatos, reloj: this.reloj, almacen: this.almacen, registro: this.registro },
      {
        academiaId: academia.id,
        alumnoId: previa.alumno_id,
        cuerpo,
        tipo,
        mensajeGuardada: 'Foto de la solicitud guardada',
        confirmar: async (tx) => {
          const bloqueada = await bloquearYLeerLaSolicitud(tx, previa.solicitud_id, previa.alumno_id);
          if (!bloqueada) throw solicitudNoEncontrada();
          // «Ahora» después de los bloqueos (DT-10 de la 007).
          const ahora = this.reloj.ahora();
          if (!esEditable(bloqueada.fila, ahora)) throw solicitudNoEditable();
          return { anterior: bloqueada.fotoClaveAnterior, ahora };
        },
      },
    );
  }

  /** La solicitud del token con su matrícula y su alumno, sin bloquear nada. */
  private async leerPorToken(tx: TransaccionAcademia, hash: string): Promise<FilaDeLaSolicitud | undefined> {
    const filas = await tx.cliente.$queryRaw<FilaDeLaSolicitud[]>`
      SELECT s.id::text AS solicitud_id, s.alumno_id::text AS alumno_id, s.estado::text AS estado_solicitud,
             m.estado::text AS estado_matricula, m.reserva_vence_en, a.estado::text AS estado_alumno,
             up.estado::text AS estado_ultimo_pago, up.hay_pendiente AS hay_pago_pendiente, m.anio::int AS anio, m.mes::int AS mes
        FROM solicitudes_inscripcion s
        JOIN alumnos a ON a.academia_id = s.academia_id AND a.id = s.alumno_id
        JOIN matriculas m ON m.academia_id = s.academia_id AND m.solicitud_id = s.id
        ${unirUltimoPago}
       WHERE s.academia_id = ${tx.academiaId}::uuid AND s.token_hash = decode(${hash}::text, 'hex')
       ORDER BY m.creado_en DESC
       LIMIT 1`;
    return filas[0];
  }
}
