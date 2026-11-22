import type { Socket } from 'node:net';
import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Req, Res } from '@nestjs/common';
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
import { PinoLogger } from 'nestjs-pino';
import { ValidarCon } from '../../comun/validacion';
import { errorParaRegistro } from '../../infraestructura/prisma';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionAcademiaService } from '../autenticacion/sesion-academia.service';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { CajasService } from './cajas.service';
import { esDescargaAbandonada, HistorialService } from './historial.service';

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
 * `true` si la conexión de una descarga ya se cerró (criterio 55 a): la respuesta se cerró sin terminar de enviarse, o el socket de la petición
 * está destruido. No se mira `solicitud.destroyed` solo: en Node 22 puede ser `true` después de leer una petición sin cuerpo (plan 2.13).
 */
function conexionCerrada(solicitud: Request, respuesta: Response): boolean {
  const socket = solicitud.socket as Socket | null;
  return respuesta.destroyed || (respuesta.closed && !respuesta.writableFinished) || socket?.destroyed === true;
}

/**
 * La caja del día (spec 006a, HU-25 a HU-27). La academia sale siempre de la sesión: ninguna ruta la recibe en la dirección, la consulta o el
 * cuerpo, y los esquemas son estrictos. Abrir, cerrar y registrar egresos: administrador y secretaria (`ABRIR_CERRAR_CAJA`, sección 2.1);
 * reabrir un cierre, solo el administrador (`REABRIR_CAJA`, DT-1). El Superadmin no tiene ruta aquí (D-29).
 *
 * Orden de las comprobaciones (el de 002): sesión → academia activa → cambio obligatorio → permiso → cuerpo (o consulta) → operación. No hay
 * rutas para cambiar ni borrar un movimiento ni un cierre (criterio 23, PQ15): esas direcciones responden 404, igual que cualquier método que no
 * sea `GET` sobre las rutas de lectura. Eso incluye `HEAD` (criterio 50): Express lo atendería con el manejador del `GET`, así que un middleware
 * (`instalarHeadSinRutasDeCaja`, instalado en `configurarApp` antes de las rutas de Nest) lo responde con el 404 de siempre, también al
 * `ENTRENADOR` y al `ALUMNO`; no hay ningún `@Head()` aquí. Las tres lecturas del historial (006b) pasan por `HistorialService`.
 */
@Controller('cajas')
export class CajasController {
  private readonly validarConsultaDelHistorial = new ValidarCon(filtroHistorialCajasSchema);

  constructor(
    private readonly servicio: CajasService,
    private readonly historial: HistorialService,
    private readonly sesiones: SesionAcademiaService,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(CajasController.name);
  }

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
   * `GET /api/cajas/{id}/cierres/{numero}/pdf` (006b, criterios 42, 43 y 49 a 53): el PDF de un cierre, armado bajo pedido y fuera de la transacción
   * de lectura. El `id` y el `numero` no pasan por pipes: todo lo que no se puede mostrar es el mismo 404 (PQ1, PQ6). Con la cola de generación
   * llena, o con 2 descargas de la misma persona o 4 de la misma academia en curso o en espera, responde 429 `DEMASIADAS_SOLICITUDES` (criterios
   * 49 b y c, y 52; lo decide `HistorialService`). Cuando le toca el turno, la sesión se vuelve a comprobar con `volverAVerificar` (criterio 53).
   * Las cabeceras se escriben con el `Buffer` ya completo (PQ7): si el generador falla, el error sube antes de escribir nada y el filtro global
   * responde el 500 JSON. Solo `GET`: `HEAD` responde 404 (criterio 50).
   *
   * Si el cliente corta la conexión antes de que la respuesta termine de enviarse (criterio 51), la respuesta emite `close` sin `writableFinished`
   * y se activa la señal que el servicio pasa a la cola y al generador. Esa descarga no escribe nada, no audita y no se registra como un 500: a lo
   * sumo, una línea `info`. Se mira la respuesta y no la petición: en Node 22 la petición puede emitir `close` al terminar de leerse.
   *
   * Criterio 55 (DT-15): al entrar se comprueba si la conexión ya está cerrada (un corte durante el middleware o los guards ya pasó) y, en el
   * mismo paso síncrono, se escucha también el `close` del socket, que avisa a una petición en pipelining. Los oyentes se quitan en `finally`.
   */
  @Get(':id/cierres/:numero/pdf')
  @Permiso('VER_REPORTES_FINANCIEROS')
  async descargarPdf(
    @SesionActual() sesion: SesionVerificada,
    @Param('id') id: string,
    @Param('numero') numero: string,
    @Req() solicitud: Request,
    @Res() respuesta: Response,
  ): Promise<void> {
    // Lo primero y en un solo paso síncrono (criterio 55, DT-15): mirar si la conexión ya se cerró e instalar los oyentes. Sin un `await` en
    // medio, un corte no se pierde. El del socket avisa también a una petición en pipelining, cuya respuesta todavía no tiene socket.
    const controlador = new AbortController();
    const socket = solicitud.socket as Socket | null;
    const contexto = { usuarioId: sesion.usuario.id, academiaId: sesion.usuario.academiaId };
    if (conexionCerrada(solicitud, respuesta)) {
      this.registro.info(contexto, 'Descarga del PDF del cierre abandonada antes de empezar');
      return;
    }
    const cortar = (): void => {
      if (!respuesta.writableFinished) controlador.abort();
    };
    respuesta.once('close', cortar);
    socket?.once('close', cortar);
    try {
      const { nombreArchivo, contenido } = await this.historial.pdf(sesion, id, numero, {
        senal: controlador.signal,
        volverAVerificar: () => this.sesiones.volverAVerificar(solicitud, 'VER_REPORTES_FINANCIEROS'),
      });
      if (controlador.signal.aborted) return;
      respuesta.status(200);
      respuesta.setHeader('Content-Type', 'application/pdf');
      respuesta.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
      respuesta.setHeader('Content-Length', String(contenido.length));
      respuesta.end(contenido);
    } catch (error) {
      // Con la señal activa nunca se escribe en la respuesta, tampoco un JSON de error (criterio 55 d): el error no llega al filtro global.
      if (!controlador.signal.aborted) throw error;
      if (esDescargaAbandonada(error) || (error instanceof HttpException && error.getStatus() < 500)) {
        this.registro.info(contexto, 'Descarga del PDF del cierre abandonada por el cliente');
      } else {
        this.registro.error(
          { ...contexto, err: errorParaRegistro(error) },
          'Error al generar el PDF de una descarga abandonada',
        );
      }
    } finally {
      // En keep-alive el socket atiende las peticiones siguientes: el oyente no puede quedarse ni acumularse (criterio 55 c).
      respuesta.off('close', cortar);
      socket?.off('close', cortar);
    }
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
