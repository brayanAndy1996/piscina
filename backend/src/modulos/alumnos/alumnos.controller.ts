import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import {
  buscarAlumnosSchema,
  type Carnet,
  type RegenerarQr,
  regenerarQrSchema,
  type ResultadoBusquedaAlumnos,
} from '@aquagestion/contratos';
import type { Request, Response } from 'express';
import { tipoDeMedio } from '../../comun/http/cuerpo-imagen';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { exigirAlcanceDelCarnet } from './alcance';
import { BusquedaService } from './busqueda.service';
import { CarnetService } from './carnet.service';
import { FotoAlumnoService } from './foto-alumno.service';
import { responderConPdf } from './pdf/responder-pdf';

/**
 * Los alumnos y su carnet para el personal (spec 008a, criterios 4, 5, 11, 13 a 16). La academia sale siempre de la sesión: ninguna ruta la
 * recibe en la dirección, la consulta o el cuerpo. Orden de las comprobaciones (el de 002): sesión → academia activa → cambio obligatorio →
 * permiso → alcance de `VER_CARNET` (`TODO`: el `ALUMNO` recibe 403 también con su propio id) → cuerpo → operación. El `{id}` no pasa por
 * pipes: lo valida el servicio y todo lo que no se puede mostrar es el mismo 404 (criterio 5). `HEAD` responde 404 (criterio 18, middleware de
 * `configurarApp`; no hay ningún `@Head()` aquí).
 */
@Controller('alumnos')
export class AlumnosController {
  private readonly validarBusqueda = new ValidarCon(buscarAlumnosSchema);

  constructor(
    private readonly carnets: CarnetService,
    private readonly busqueda: BusquedaService,
    private readonly foto: FotoAlumnoService,
  ) {}

  /**
   * Declarada como `POST` y no como `GET` para que el DNI o el nombre no viajen en la dirección (regla de 002). El cuerpo se valida a mano, después
   * del alcance: el `ALUMNO` recibe 403 aunque su cuerpo no cumpla el esquema (un pipe habría respondido 400 antes).
   */
  @Post('buscar')
  @HttpCode(200)
  @Permiso('VER_CARNET')
  buscar(@SesionActual() sesion: SesionVerificada, @Body() cuerpo: unknown): Promise<ResultadoBusquedaAlumnos> {
    exigirAlcanceDelCarnet(sesion, 'TODO');
    return this.busqueda.buscar(sesion.usuario.academiaId, this.validarBusqueda.transform(cuerpo));
  }

  @Get(':id/carnet')
  @Permiso('VER_CARNET')
  carnet(@SesionActual() sesion: SesionVerificada, @Param('id') id: string): Promise<Carnet> {
    exigirAlcanceDelCarnet(sesion, 'TODO');
    return this.carnets.leer(sesion.usuario.academiaId, { alumnoId: id });
  }

  @Get(':id/carnet/pdf')
  @Permiso('VER_CARNET')
  async pdf(
    @SesionActual() sesion: SesionVerificada,
    @Param('id') id: string,
    @Res() respuesta: Response,
  ): Promise<void> {
    exigirAlcanceDelCarnet(sesion, 'TODO');
    responderConPdf(respuesta, await this.carnets.pdf(sesion.usuario.academiaId, { alumnoId: id }));
  }

  /** 200 con el carnet con el QR nuevo; con la misma clave que la última regeneración, 200 con el carnet actual sin cambiar nada (criterio 14). */
  @Post(':id/carnet/qr')
  @HttpCode(200)
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  regenerar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(regenerarQrSchema)) datos: RegenerarQr,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<Carnet> {
    return this.carnets.regenerar(sesion, id, datos, solicitud.ip ?? null);
  }

  /**
   * La foto del alumno desde el panel (008b, criterios 22 y 24 a 27): 204 sin cuerpo. El tipo, la codificación y el tamaño ya los decidió el lector
   * binario (`cuerpo-imagen.ts`), que solo lee el cuerpo si la sesión tiene el permiso; el `{id}`, el alumno y la imagen los comprueba
   * `FotoAlumnoService`, en ese orden.
   */
  @Put(':id/foto')
  @HttpCode(204)
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  async subirFoto(
    @SesionActual() sesion: SesionVerificada,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<void> {
    const cuerpo: unknown = solicitud.body;
    const imagen = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.alloc(0);
    // El lector binario ya comprobó que el tipo es uno de `FOTO_TIPOS`.
    const tipo = tipoDeMedio(solicitud.headers['content-type']) === 'image/png' ? 'image/png' : 'image/jpeg';
    await this.foto.subir(sesion, id, imagen, tipo, solicitud.ip ?? null);
  }
}
