import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { cambiarHorarioSchema, type CambiarHorario, type RespuestaCambioHorario } from '@aquagestion/contratos';
import type { Request } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { HorarioService } from './horario.service';

/**
 * El cambio de horario de una matrícula (spec 010c, criterios 35 y 41; HU-03, RN-08). Es de `MODIFICAR_HORARIO_ALUMNO` (`ADMIN` y `SECRETARIA`, sección 2.1):
 * el alumno no cambia su horario desde su cuenta (D-14) y el entrenador tampoco. La academia sale siempre de la sesión: la ruta no recibe ninguna y el esquema
 * es estricto. Orden de las comprobaciones (el de 002): sesión → academia activa → cambio obligatorio → permiso → cuerpo → operación. El `{id}` no pasa por
 * pipes: uno que no es UUID responde el mismo 404 que uno que no existe, es de otra academia o es de un `CLIENTE`, después del cuerpo. `HEAD` responde 404
 * (`/matriculas` está en `PREFIJOS_SIN_HEAD`).
 */
@Controller('matriculas')
export class HorarioController {
  constructor(private readonly horario: HorarioService) {}

  @Post(':id/horario')
  @HttpCode(200)
  @Permiso('MODIFICAR_HORARIO_ALUMNO')
  cambiar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(cambiarHorarioSchema)) datos: CambiarHorario,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaCambioHorario> {
    return this.horario.cambiar(sesion, id, datos, solicitud.ip ?? null);
  }
}
