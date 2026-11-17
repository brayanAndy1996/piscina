import { Inject, Injectable } from '@nestjs/common';
import type { ActualizarConfiguracion, RespuestaConfiguracion, RespuestaMiAcademia } from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { BaseDatos, join, sql } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { AuditoriaService } from '../auditoria';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { aplicarCambios, cambiosPedidos, configuracionEfectiva, datosDeAuditoria } from './dominio/valores';
import { avisarValoresInvalidos, leerConfiguracion, leerFilasDeConfiguracion } from './lectura';

/**
 * Configuración de cada academia (spec 003). Todo corre con `conAcademia(<academia de la sesión>, …)`: la academia nunca viene de
 * la dirección, la consulta ni el cuerpo (criterio 4). Sin caché: cada petición lee la base (arquitectura, "Datos, fechas y cachés").
 */
@Injectable()
export class ConfiguracionService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(ConfiguracionService.name);
  }

  /** `GET /api/configuracion`: los valores efectivos de la academia de la sesión (criterios 1 a 3). */
  async obtener(academiaId: string): Promise<RespuestaConfiguracion> {
    const configuracion = await this.baseDatos.conAcademia(academiaId, (tx) =>
      leerConfiguracion(tx, { registro: this.registro }),
    );
    return { configuracion };
  }

  /** `GET /api/mi-academia`: nombre y nombre corto de la academia de la sesión y su teléfono efectivo (criterio 20). */
  async miAcademia(sesion: SesionVerificada): Promise<RespuestaMiAcademia> {
    const configuracion = await this.baseDatos.conAcademia(sesion.usuario.academiaId, (tx) =>
      leerConfiguracion(tx, { registro: this.registro }),
    );
    return {
      academia: {
        nombre: sesion.academia.nombre,
        nombreCorto: sesion.academia.nombreCorto,
        telefono: configuracion.telefono,
      },
    };
  }

  /**
   * `PATCH /api/configuracion` (criterios 7, 9, 11 y 12). En una sola transacción: bloquea y comprueba la fila del administrador
   * (primera sentencia, DT-5 de 002), toma el bloqueo de la academia (los cambios de una misma academia se ordenan y su auditoría
   * queda encadenada), escribe todas las filas con una sola sentencia y audita `CONFIGURACION_ACTUALIZADA`. Sin cambios, no escribe ni
   * audita. Orden de bloqueos: fila del actor, luego la academia.
   */
  async actualizar(
    sesion: SesionVerificada,
    pedido: ActualizarConfiguracion,
    ip: string | null,
  ): Promise<RespuestaConfiguracion> {
    const actor = actorDeSesion(sesion);
    const configuracion = await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { registro: this.registro, ip },
      );
      await tx.cliente.$executeRaw`
        SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${`configuracion:${tx.academiaId}`}::text, 0))`;

      const filas = await leerFilasDeConfiguracion(tx);
      const { configuracion: antes, clavesInvalidas } = configuracionEfectiva(filas);
      avisarValoresInvalidos(this.registro, tx.academiaId, clavesInvalidas);
      const cambios = cambiosPedidos(filas, pedido);
      if (cambios.length === 0) return antes;

      const ahora = this.reloj.ahora();
      const valores = cambios.map(
        (cambio) =>
          sql`(${tx.academiaId}::uuid, ${cambio.clave}, ${JSON.stringify(cambio.despues)}::jsonb, ${ahora}::timestamptz)`,
      );
      await tx.cliente.$executeRaw`
        INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
        VALUES ${join(valores)}
        ON CONFLICT (academia_id, clave) DO UPDATE
          SET valor = EXCLUDED.valor, actualizado_en = EXCLUDED.actualizado_en`;
      await this.auditoria.registrarEnAcademia(tx, {
        actorTipo: 'USUARIO',
        actorId: actor.id,
        accion: 'CONFIGURACION_ACTUALIZADA',
        entidad: 'configuracion',
        entidadId: null,
        ...datosDeAuditoria(cambios),
        ip,
      });
      return aplicarCambios(antes, cambios);
    });
    return { configuracion };
  }
}
