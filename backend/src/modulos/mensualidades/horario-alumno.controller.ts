import { Controller, Get, Param } from '@nestjs/common';
import type { HorarioDelAlumno } from '@aquagestion/contratos';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { HorarioService } from './horario.service';

/**
 * La lectura del horario para el cambio (spec 010c, criterio 46, DT-38): `GET /api/alumnos/{id}/horario`. Es de `MODIFICAR_HORARIO_ALUMNO` (`ADMIN` y
 * `SECRETARIA`, sección 2.1): el alumno no ve su horario por aquí (D-14) y el entrenador tampoco. La academia sale siempre de la sesión: la ruta no recibe
 * ninguna y `?academiaId=` no cambia nada. El `{id}` no pasa por pipes: uno que no es UUID responde el mismo 404 que uno que no existe, es de otra academia o es
 * de un `CLIENTE`. Orden de las comprobaciones (el de 002): sesión → academia activa → cambio obligatorio → permiso → lectura. `HEAD` responde 404
 * (`/alumnos` está en `PREFIJOS_SIN_HEAD`). Es una lectura: sin bloqueos, sin escribir y sin auditar.
 */
@Controller('alumnos')
export class HorarioDelAlumnoController {
  constructor(private readonly horario: HorarioService) {}

  @Get(':id/horario')
  @Permiso('MODIFICAR_HORARIO_ALUMNO')
  leer(@SesionActual() sesion: SesionVerificada, @Param('id') id: string): Promise<HorarioDelAlumno> {
    return this.horario.leer(sesion.usuario.academiaId, id);
  }
}
