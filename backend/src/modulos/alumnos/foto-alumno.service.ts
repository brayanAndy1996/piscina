import { Inject, Injectable } from '@nestjs/common';
import type { FotoTipo } from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { BaseDatos, type TransaccionAcademia } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { auditarFotoDelPanel, reemplazarFotoDelAlumno } from '../inscripciones/foto-del-alumno';
import { alumnoNoEncontrado } from './errores';

/**
 * La foto de un alumno desde el panel (spec 008b, criterios 22 y 24 a 27): `PUT /api/alumnos/{id}/foto`. Orden de las comprobaciones: las de la
 * sesión, el permiso, el tipo y el tamaño ya las decidieron el middleware, el guard y el lector binario (a a f del criterio 24); aquí siguen:
 *
 * 1. Una transacción corta, sin archivos: `bloquearActorVigente` (401) y el alumno (404 `NO_ENCONTRADO` con un `{id}` que no es UUID, que no
 *    existe, de otra academia o `CLIENTE`, criterio 5).
 * 2. `reemplazarFotoDelAlumno` (la función común con la foto pública, DT-10): la imagen (400 `IMAGEN_NO_VALIDA`), el archivo y la transacción de
 *    escritura: `bloquearActorVigente`, `alumnos` `FOR UPDATE`, `foto_clave` y la auditoría `ALUMNO_FOTO_ACTUALIZADA` con origen `PANEL_ALUMNO`.
 */
@Injectable()
export class FotoAlumnoService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(FotoAlumnoService.name);
  }

  async subir(
    sesion: SesionVerificada,
    idPedido: string,
    cuerpo: Buffer,
    tipo: FotoTipo,
    ip: string | null,
  ): Promise<void> {
    const actor = actorDeSesion(sesion);
    const bloqueo = { id: actor.id, versionToken: actor.versionToken };
    const opciones = { registro: this.registro, ip };

    // Comprobación previa (g y h), sin tocar archivos.
    const alumnoId = await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      await bloquearActorVigente(tx, bloqueo, opciones);
      // Un id que no es UUID no se consulta: el mismo 404 que uno inexistente, de otra academia o de un cliente (criterio 5).
      if (!PATRON_UUID.test(idPedido)) throw alumnoNoEncontrado();
      const filas = await tx.cliente.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM alumnos
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${idPedido}::uuid AND estado <> 'CLIENTE'`;
      if (!filas[0]) throw alumnoNoEncontrado();
      return filas[0].id;
    });

    await reemplazarFotoDelAlumno(
      { baseDatos: this.baseDatos, reloj: this.reloj, almacen: this.almacen, registro: this.registro },
      {
        academiaId: actor.academiaId,
        alumnoId,
        cuerpo,
        tipo,
        mensajeGuardada: 'Foto del alumno guardada',
        confirmar: async (tx) => {
          await bloquearActorVigente(tx, bloqueo, opciones);
          return this.bloquearAlumno(tx, alumnoId);
        },
        despuesDeGuardar: (tx, ahora, anterior) =>
          auditarFotoDelPanel(tx, ahora, {
            actorId: actor.id,
            alumnoId,
            tuvoFoto: anterior !== null,
            origen: 'PANEL_ALUMNO',
            ip,
          }),
      },
    );
  }

  /** `alumnos` `FOR UPDATE`: la clave anterior de la foto, o 404 si el alumno ya no está o sigue (o volvió) a ser `CLIENTE`. */
  private async bloquearAlumno(tx: TransaccionAcademia, alumnoId: string): Promise<string | null> {
    const filas = await tx.cliente.$queryRaw<{ estado: string; foto_clave: string | null }[]>`
      SELECT estado::text AS estado, foto_clave FROM alumnos
       WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumnoId}::uuid
         FOR UPDATE`;
    const alumno = filas[0];
    if (!alumno || alumno.estado === 'CLIENTE') throw alumnoNoEncontrado();
    return alumno.foto_clave;
  }
}
