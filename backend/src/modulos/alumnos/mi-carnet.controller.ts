import { Controller, Get, Res } from '@nestjs/common';
import type { Carnet } from '@aquagestion/contratos';
import type { Response } from 'express';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { exigirAlcanceDelCarnet } from './alcance';
import { CarnetService } from './carnet.service';
import { responderConPdf } from './pdf/responder-pdf';

/**
 * El carnet del propio alumno (spec 008a, criterio 6; D-14: solo lectura). No recibe ningún id: el alumno es el de la cuenta de la sesión, en la
 * academia de la sesión; un `?id=`, un `?alumnoId=` o un cuerpo se ignoran. El alcance de `VER_CARNET` aquí es `PROPIO`: el personal recibe 403.
 * Un alumno con la matrícula vencida también ve su carnet. `HEAD` responde 404 (criterio 18).
 */
@Controller('mi-carnet')
export class MiCarnetController {
  constructor(private readonly carnets: CarnetService) {}

  @Get()
  @Permiso('VER_CARNET')
  carnet(@SesionActual() sesion: SesionVerificada): Promise<Carnet> {
    exigirAlcanceDelCarnet(sesion, 'PROPIO');
    return this.carnets.leer(sesion.usuario.academiaId, { usuarioId: sesion.usuario.id });
  }

  @Get('pdf')
  @Permiso('VER_CARNET')
  async pdf(@SesionActual() sesion: SesionVerificada, @Res() respuesta: Response): Promise<void> {
    exigirAlcanceDelCarnet(sesion, 'PROPIO');
    responderConPdf(respuesta, await this.carnets.pdf(sesion.usuario.academiaId, { usuarioId: sesion.usuario.id }));
  }
}
