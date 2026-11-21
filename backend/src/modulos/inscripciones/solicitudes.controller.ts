import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  type CancelarSolicitud,
  cancelarSolicitudSchema,
  consultaListaSolicitudesSchema,
  type RespuestaListaSolicitudes,
  type RespuestaSolicitudPanel,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { SolicitudesService } from './solicitudes.service';

/**
 * El valor crudo de `?estado=` (criterio 38): `undefined` si no viene, el texto si viene una vez y un arreglo si se repite o se escribe
 * como `estado[]=…` o `estado[a]=…` (Express 5 no arma arreglos ni objetos con esa forma, así que se mira la consulta tal cual llegó).
 * Un arreglo no pasa `filtroEstadoSolicitudesSchema`: 400 en el campo `estado`.
 */
function estadoCrudo(solicitud: Request): string | string[] | undefined {
  const posicion = solicitud.originalUrl.indexOf('?');
  const parametros = new URLSearchParams(posicion === -1 ? '' : solicitud.originalUrl.slice(posicion + 1));
  const valores: string[] = [];
  let conCorchetes = false;
  for (const [nombre, valor] of parametros) {
    if (nombre === 'estado') {
      valores.push(valor);
    } else if (nombre.startsWith('estado[')) {
      valores.push(valor);
      conCorchetes = true;
    }
  }
  if (valores.length === 0) return undefined;
  const [unico] = valores;
  return valores.length === 1 && !conCorchetes && unico !== undefined ? unico : valores;
}

/**
 * Panel de solicitudes de inscripción (spec 005b, criterios 38 y 39). La academia sale siempre de la sesión: ninguna ruta la recibe en la
 * dirección, la consulta o el cuerpo. Solo `ADMIN` y `SECRETARIA` (`REGISTRAR_INSCRIPCION_Y_COBRO`, sección 2.1); el Superadmin no tiene
 * ruta aquí (D-29).
 */
@Controller('solicitudes')
export class SolicitudesController {
  private readonly validarConsulta = new ValidarCon(consultaListaSolicitudesSchema);

  constructor(private readonly servicio: SolicitudesService) {}

  @Get()
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  listar(@SesionActual() sesion: SesionVerificada, @Req() solicitud: Request): Promise<RespuestaListaSolicitudes> {
    const { estado } = this.validarConsulta.transform({ estado: estadoCrudo(solicitud) });
    return this.servicio.listar(sesion.usuario.academiaId, estado);
  }

  /**
   * El `id` no pasa por `IdDeRuta`: un id que no es UUID responde el mismo 404 que uno que no existe o es de otra academia, después del
   * cuerpo y de `bloquearActorVigente` (lo decide el servicio).
   */
  @Post(':id/cancelar')
  @HttpCode(200)
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  cancelar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(cancelarSolicitudSchema)) datos: CancelarSolicitud,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaSolicitudPanel> {
    return this.servicio.cancelar(sesion, id, datos, solicitud.ip ?? null);
  }
}
