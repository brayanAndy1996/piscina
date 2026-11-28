import { Controller, Get, Header, HttpStatus, Req } from '@nestjs/common';
import { type AsistenciaDelMes, mesDeAsistenciaSchema, type MiPanel } from '@aquagestion/contratos';
import type { Request } from 'express';
import { z } from 'zod';
import { ErrorNegocio } from '../../comun/errores';
import { parametroCrudo } from '../../comun/http/parametro-crudo';
import { MENSAJE_SOLICITUD_INVALIDA, ValidarCon } from '../../comun/validacion';
import { ConsultaDeAsistenciaService } from '../asistencia';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { exigirAlcancePropio } from './alcance';
import { MiPanelService } from './mi-panel.service';

/** El único parámetro de la asistencia del panel: `mes`, que se valida con el valor crudo (uno repetido o con corchetes no pasa) y se informa con el campo `mes`. */
const consultaDeAsistenciaSchema = z.object({ mes: mesDeAsistenciaSchema.optional() });

/**
 * El panel del alumno y del apoderado (spec 011; HU-06, D-08, D-14): dos lecturas de la cuenta de la sesión, sin ningún id. `GET /api/mi-panel` (`VER_CARNET`) y
 * `GET /api/mi-panel/asistencias?mes=AAAA-MM` (`VER_REPORTES_ASISTENCIA`), las dos con alcance `PROPIO`. El alumno sale solo de la sesión: un `?id=`, `?alumnoId=`,
 * `?usuarioId=`, `?academiaId=`, un cuerpo o una cabecera se ignoran. Orden de las comprobaciones (el de 002): sesión → academia activa → cambio obligatorio → permiso →
 * alcance → `mes` → alumno de la sesión (404). Respuestas con `Cache-Control: no-store` (DT-8). Solo `GET`: otros métodos son una ruta inexistente (404) y `HEAD`
 * también (`/mi-panel` está en `PREFIJOS_SIN_HEAD`).
 */
@Controller('mi-panel')
export class MiPanelController {
  private readonly validarConsulta = new ValidarCon(consultaDeAsistenciaSchema);

  constructor(
    private readonly panel: MiPanelService,
    private readonly asistencia: ConsultaDeAsistenciaService,
  ) {}

  @Get()
  @Permiso('VER_CARNET')
  @Header('Cache-Control', 'no-store')
  resumen(@SesionActual() sesion: SesionVerificada): Promise<MiPanel> {
    exigirAlcancePropio(sesion, 'VER_CARNET');
    return this.panel.resumen(sesion.usuario.academiaId, sesion.usuario.id);
  }

  @Get('asistencias')
  @Permiso('VER_REPORTES_ASISTENCIA')
  @Header('Cache-Control', 'no-store')
  asistencias(@SesionActual() sesion: SesionVerificada, @Req() solicitud: Request): Promise<AsistenciaDelMes> {
    exigirAlcancePropio(sesion, 'VER_REPORTES_ASISTENCIA');
    const { mes } = this.validarConsulta.transform({ mes: parametroCrudo(solicitud, 'mes') });
    if (mes !== undefined && mes > this.panel.mesEnCurso()) {
      throw new ErrorNegocio(HttpStatus.BAD_REQUEST, 'SOLICITUD_INVALIDA', MENSAJE_SOLICITUD_INVALIDA, {
        errores: [{ campo: 'mes', mensaje: 'El mes no puede ser posterior al mes en curso.' }],
      });
    }
    return this.asistencia.delMesDelUsuario(sesion.usuario.academiaId, sesion.usuario.id, mes);
  }
}
