import { Inject, Injectable } from '@nestjs/common';
import type { FotoTipo } from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { BaseDatos } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { noEncontrado, solicitudNoEditable } from './errores';
import { auditarFotoDelPanel, reemplazarFotoDelAlumno } from './foto-del-alumno';
import { bloquearYLeerLaSolicitud, esEditableDesdeElPanel, leerSolicitudParaLaFoto } from './foto-solicitud';

/**
 * La foto de la solicitud desde el panel (spec 008b, criterios 23 a 27): `PUT /api/solicitudes/{id}/foto`. Orden de las comprobaciones: las de la
 * sesión, el permiso, el tipo y el tamaño ya las decidieron el middleware, el guard y el lector binario (a a f del criterio 24); aquí siguen:
 *
 * 1. Una transacción corta, sin archivos: `bloquearActorVigente` (401), un `{id}` que no es UUID o que no existe en la academia (404
 *    `NO_ENCONTRADO`) y que la solicitud siga admitiendo la foto (409 `SOLICITUD_NO_EDITABLE`; `esEditableDesdeElPanel`).
 * 2. `reemplazarFotoDelAlumno` (la función común con la foto pública, DT-10): la imagen (400 `IMAGEN_NO_VALIDA`), el archivo y la transacción de
 *    escritura: `bloquearActorVigente`, `alumnos` `FOR UPDATE`, `solicitudes_inscripcion` `FOR UPDATE`, la repetición de la comprobación del
 *    409, `foto_clave` y la auditoría `ALUMNO_FOTO_ACTUALIZADA` con origen `PANEL_SOLICITUD`.
 */
@Injectable()
export class FotoPanelService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(FotoPanelService.name);
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

    // Comprobación previa (g a i), sin tocar archivos: una lectura corta que no gasta CPU en una imagen que no se va a guardar.
    const previa = await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      await bloquearActorVigente(tx, bloqueo, opciones);
      if (!PATRON_UUID.test(idPedido)) throw noEncontrado();
      const fila = await leerSolicitudParaLaFoto(tx, idPedido);
      if (!fila) throw noEncontrado();
      if (!esEditableDesdeElPanel(fila, this.reloj.ahora())) throw solicitudNoEditable();
      return fila;
    });

    await reemplazarFotoDelAlumno(
      { baseDatos: this.baseDatos, reloj: this.reloj, almacen: this.almacen, registro: this.registro },
      {
        academiaId: actor.academiaId,
        alumnoId: previa.alumno_id,
        cuerpo,
        tipo,
        mensajeGuardada: 'Foto del alumno guardada',
        confirmar: async (tx, ahora) => {
          await bloquearActorVigente(tx, bloqueo, opciones);
          const bloqueada = await bloquearYLeerLaSolicitud(tx, previa.solicitud_id, previa.alumno_id);
          if (!bloqueada) throw noEncontrado();
          if (!esEditableDesdeElPanel(bloqueada.fila, ahora)) throw solicitudNoEditable();
          return bloqueada.fotoClaveAnterior;
        },
        despuesDeGuardar: (tx, ahora, anterior) =>
          auditarFotoDelPanel(tx, ahora, {
            actorId: actor.id,
            alumnoId: previa.alumno_id,
            tuvoFoto: anterior !== null,
            origen: 'PANEL_SOLICITUD',
            ip,
          }),
      },
    );
  }
}
