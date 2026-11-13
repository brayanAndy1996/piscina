import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  type CrearAcademia,
  crearAcademiaSchema,
  type ReactivarAcademia,
  reactivarAcademiaSchema,
  type RespuestaAcademia,
  type RespuestaListaAcademias,
  type SuspenderAcademia,
  suspenderAcademiaSchema,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { IdDeRuta, ValidarCon } from '../../comun/validacion';
import { AcademiasService } from './academias.service';
import { SesionPlataformaGuard } from './sesion-plataforma.guard';
import { SuperadminActual } from './superadmin-actual.decorator';
import type { SuperadminAutenticado } from './tipos';

/** Academias vistas desde la plataforma: solo crear, listar, suspender y reactivar; no hay forma de borrarlas. */
@Controller('plataforma/academias')
@UseGuards(SesionPlataformaGuard)
export class AcademiasPlataformaController {
  constructor(private readonly servicio: AcademiasService) {}

  @Get()
  async listar(): Promise<RespuestaListaAcademias> {
    return { academias: await this.servicio.listar() };
  }

  @Post()
  @HttpCode(201)
  async crear(
    @Body(new ValidarCon(crearAcademiaSchema)) datos: CrearAcademia,
    @SuperadminActual() superadmin: SuperadminAutenticado,
    @Req() solicitud: Request,
  ): Promise<RespuestaAcademia> {
    return { academia: await this.servicio.crear(datos, superadmin, solicitud.ip ?? null) };
  }

  @Post(':id/suspender')
  @HttpCode(200)
  async suspender(
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(suspenderAcademiaSchema)) datos: SuspenderAcademia,
    @SuperadminActual() superadmin: SuperadminAutenticado,
    @Req() solicitud: Request,
  ): Promise<RespuestaAcademia> {
    return { academia: await this.servicio.suspender(id, datos.motivo, superadmin, solicitud.ip ?? null) };
  }

  @Post(':id/reactivar')
  @HttpCode(200)
  async reactivar(
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(reactivarAcademiaSchema)) datos: ReactivarAcademia,
    @SuperadminActual() superadmin: SuperadminAutenticado,
    @Req() solicitud: Request,
  ): Promise<RespuestaAcademia> {
    return { academia: await this.servicio.reactivar(id, datos.motivo, superadmin, solicitud.ip ?? null) };
  }
}
