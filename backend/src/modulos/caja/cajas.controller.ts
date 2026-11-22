import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import {
  type AbrirCaja,
  abrirCajaSchema,
  type CerrarCaja,
  cerrarCajaSchema,
  filtroHistorialCajasSchema,
  type ReabrirCaja,
  reabrirCajaSchema,
  type RegistrarEgreso,
  registrarEgresoSchema,
  type RespuestaCaja,
  type RespuestaCajaActual,
  type RespuestaEgreso,
  type RespuestaHistorialCajas,
} from '@aquagestion/contratos';
import type { Request, Response } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { CajasService } from './cajas.service';
import { HistorialService } from './historial.service';

/**
 * El valor crudo de un parámetro de la consulta (spec 006b, PQ3), como `estadoCrudo` de la 005b: `undefined` si no viene, el texto si viene una
 * vez (también vacío) y un arreglo si se repite o se escribe con corchetes (`desde[]=…`, `desde[x]=…`; Express 5 no los arma, así que se mira
 * la consulta tal como llegó). Un arreglo no pasa `fechaSchema`: 400 en ese campo.
 */
function parametroCrudo(solicitud: Request, nombre: string): string | string[] | undefined {
  const posicion = solicitud.originalUrl.indexOf('?');
  const parametros = new URLSearchParams(posicion === -1 ? '' : solicitud.originalUrl.slice(posicion + 1));
  const valores: string[] = [];
  let conCorchetes = false;
  for (const [clave, valor] of parametros) {
    if (clave === nombre) {
      valores.push(valor);
    } else if (clave.startsWith(`${nombre}[`)) {
      valores.push(valor);
      conCorchetes = true;
    }
  }
  if (valores.length === 0) return undefined;
  const [unico] = valores;
  return valores.length === 1 && !conCorchetes && unico !== undefined ? unico : valores;
}

/**
 * La caja del día (spec 006a, HU-25 a HU-27). La academia sale siempre de la sesión: ninguna ruta la recibe en la dirección, la consulta o el
 * cuerpo, y los esquemas son estrictos. Abrir, cerrar y registrar egresos: administrador y secretaria (`ABRIR_CERRAR_CAJA`, sección 2.1);
 * reabrir un cierre, solo el administrador (`REABRIR_CAJA`, DT-1). El Superadmin no tiene ruta aquí (D-29).
 *
 * Orden de las comprobaciones (el de 002): sesión → academia activa → cambio obligatorio → permiso → cuerpo (o consulta) → operación. No hay
 * rutas para cambiar ni borrar un movimiento ni un cierre (criterio 23, PQ15): esas direcciones responden 404. Las tres lecturas del historial
 * (006b) pasan por `HistorialService`.
 */
@Controller('cajas')
export class CajasController {
  private readonly validarConsultaDelHistorial = new ValidarCon(filtroHistorialCajasSchema);

  constructor(
    private readonly servicio: CajasService,
    private readonly historial: HistorialService,
  ) {}

  /**
   * `GET /api/cajas?desde=&hasta=` (006b, criterio 40): el historial de cajas con el alcance del rol (`VER_REPORTES_FINANCIEROS`: el
   * administrador todas, la secretaria las suyas y la de hoy, DR-9 y DR-13). Solo se leen `desde` y `hasta`; los demás parámetros (también
   * `?academiaId=`) se ignoran. Es una lectura: sin bloqueos, sin escritura y sin auditoría.
   */
  @Get()
  @Permiso('VER_REPORTES_FINANCIEROS')
  listar(@SesionActual() sesion: SesionVerificada, @Req() solicitud: Request): Promise<RespuestaHistorialCajas> {
    const consulta = this.validarConsultaDelHistorial.transform({
      desde: parametroCrudo(solicitud, 'desde'),
      hasta: parametroCrudo(solicitud, 'hasta'),
    });
    return this.historial.listar(sesion, consulta);
  }

  /** Declarada antes de cualquier ruta con `:id` (`GET /api/cajas/{id}`, 006b). Los parámetros de consulta se ignoran. */
  @Get('actual')
  @Permiso('ABRIR_CERRAR_CAJA')
  actual(@SesionActual() sesion: SesionVerificada): Promise<RespuestaCajaActual> {
    return this.servicio.actual(sesion.usuario.academiaId);
  }

  /**
   * `GET /api/cajas/{id}` (006b, criterio 41): el detalle de una caja con sus movimientos y cierres, igual que `/actual` para la misma caja.
   * Un id que no es UUID, que no existe, de otra academia o fuera del alcance de la secretaria responde el mismo 404 (PQ1), después del permiso.
   * Declarada después de `actual`.
   */
  @Get(':id')
  @Permiso('VER_REPORTES_FINANCIEROS')
  detalle(@SesionActual() sesion: SesionVerificada, @Param('id') id: string): Promise<RespuestaCaja> {
    return this.historial.detalle(sesion, id);
  }

  /**
   * `GET /api/cajas/{id}/cierres/{numero}/pdf` (006b, criterios 42 y 43): el PDF de un cierre, armado bajo pedido y fuera de la transacción de
   * lectura. El `id` y el `numero` no pasan por pipes: todo lo que no se puede mostrar es el mismo 404 (PQ1, PQ6). Las cabeceras se escriben
   * con el `Buffer` ya completo (PQ7): si el generador falla, el error sube antes de escribir nada y el filtro global responde el 500 JSON.
   */
  @Get(':id/cierres/:numero/pdf')
  @Permiso('VER_REPORTES_FINANCIEROS')
  async descargarPdf(
    @SesionActual() sesion: SesionVerificada,
    @Param('id') id: string,
    @Param('numero') numero: string,
    @Res() respuesta: Response,
  ): Promise<void> {
    const { nombreArchivo, contenido } = await this.historial.pdf(sesion, id, numero);
    respuesta.status(200);
    respuesta.setHeader('Content-Type', 'application/pdf');
    respuesta.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    respuesta.setHeader('Content-Length', String(contenido.length));
    respuesta.end(contenido);
  }

  /** 201 con la caja nueva; 200 con la caja ya creada si repite la clave (doble clic o reintento, criterio 16). */
  @Post()
  @Permiso('ABRIR_CERRAR_CAJA')
  async abrir(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(abrirCajaSchema)) datos: AbrirCaja,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaCaja> {
    const { caja, creada } = await this.servicio.abrir(sesion, datos, solicitud.ip ?? null);
    if (!creada) respuesta.status(200);
    return { caja };
  }

  /**
   * El `id` no pasa por `IdDeRuta`: un id que no es UUID responde el mismo 404 que uno que no existe o es de otra academia, después del cuerpo
   * y de `bloquearActorVigente` (lo decide el servicio). 201 con el egreso nuevo; 200 si repite la clave (criterio 22).
   */
  @Post(':id/egresos')
  @Permiso('ABRIR_CERRAR_CAJA')
  async registrarEgreso(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(registrarEgresoSchema)) datos: RegistrarEgreso,
    @Param('id') id: string,
    @Req() solicitud: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<RespuestaEgreso> {
    const { respuesta: cuerpo, creado } = await this.servicio.registrarEgreso(sesion, id, datos, solicitud.ip ?? null);
    if (!creado) respuesta.status(200);
    return cuerpo;
  }

  @Post(':id/cierre')
  @HttpCode(200)
  @Permiso('ABRIR_CERRAR_CAJA')
  cerrar(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(cerrarCajaSchema)) datos: CerrarCaja,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaCaja> {
    return this.servicio.cerrar(sesion, id, datos, solicitud.ip ?? null);
  }

  @Post(':id/reapertura')
  @HttpCode(200)
  @Permiso('REABRIR_CAJA')
  reabrir(
    @SesionActual() sesion: SesionVerificada,
    @Body(new ValidarCon(reabrirCajaSchema)) datos: ReabrirCaja,
    @Param('id') id: string,
    @Req() solicitud: Request,
  ): Promise<RespuestaCaja> {
    return this.servicio.reabrir(sesion, id, datos, solicitud.ip ?? null);
  }
}
