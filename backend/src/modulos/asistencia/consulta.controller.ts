import { Controller, Get, Param, Req } from '@nestjs/common';
import { type AsistenciaDelMes, mesDeAsistenciaSchema } from '@aquagestion/contratos';
import type { Request } from 'express';
import { parametroCrudo } from '../../comun/http/parametro-crudo';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { exigirAlcanceDelPersonal } from './alcance';
import { ConsultaDeAsistenciaService } from './consulta.service';

/**
 * La asistencia del mes de un alumno para el personal (spec 009b, criterio 31): `GET /api/alumnos/{id}/asistencias?mes=AAAA-MM`. Es de `VER_REPORTES_ASISTENCIA`
 * con alcance `TODO` (`ADMIN` y `SECRETARIA`); el `ENTRENADOR` (`SUS_CLASES`) y el `ALUMNO` (`PROPIO`) reciben 403 `SIN_PERMISO` (sus vistas son de la 012 y la
 * 011). La academia sale de la sesión. Orden de las comprobaciones (el de 002): sesión → academia activa → cambio obligatorio → permiso → alcance → `mes`
 * (el valor crudo, para rechazar uno repetido) → alumno (404, el mismo de la 008). `HEAD` responde 404 (`/alumnos` está en `PREFIJOS_SIN_HEAD`).
 */
@Controller('alumnos')
export class ConsultaDeAsistenciaController {
  private readonly validarMes = new ValidarCon(mesDeAsistenciaSchema);

  constructor(private readonly consulta: ConsultaDeAsistenciaService) {}

  @Get(':id/asistencias')
  @Permiso('VER_REPORTES_ASISTENCIA')
  async delMes(
    @SesionActual() sesion: SesionVerificada,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<AsistenciaDelMes> {
    exigirAlcanceDelPersonal(sesion);
    const crudo = parametroCrudo(solicitud, 'mes');
    const mes = crudo === undefined ? undefined : this.validarMes.transform(crudo);
    return this.consulta.delMes(sesion.usuario.academiaId, id, mes);
  }
}
