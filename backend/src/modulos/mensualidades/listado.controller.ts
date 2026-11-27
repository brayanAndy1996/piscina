import { Controller, Get, Req } from '@nestjs/common';
import {
  consultaListadoMensualidadesSchema,
  type ConsultaListadoMensualidades,
  type ListadoMensualidades,
} from '@aquagestion/contratos';
import type { Request } from 'express';
import { ValidarCon } from '../../comun/validacion';
import { Permiso } from '../autenticacion/permiso.decorator';
import type { SesionVerificada } from '../autenticacion/tipos';
import { SesionActual } from '../autenticacion/usuario-actual.decorator';
import { ListadoDeMensualidadesService } from './listado.service';

/**
 * Los parámetros de la dirección tal como llegaron: un nombre repetido (o con corchetes) pasa a ser un arreglo, que ningún esquema de texto acepta, y
 * uno que la API no define queda en el objeto para que el esquema estricto lo rechace. Express 5 no arma arreglos ni objetos con esa forma.
 */
function consultaCruda(solicitud: Request): Record<string, string | string[]> {
  const posicion = solicitud.originalUrl.indexOf('?');
  const parametros = new URLSearchParams(posicion === -1 ? '' : solicitud.originalUrl.slice(posicion + 1));
  // Un `Map` y no un objeto con claves del usuario: `__proto__` o `constructor` son un nombre más y el esquema estricto los rechaza como desconocidos.
  const consulta = new Map<string, string | string[]>();
  for (const [nombre, valor] of parametros) {
    const previo = consulta.get(nombre);
    if (previo === undefined) consulta.set(nombre, valor);
    else consulta.set(nombre, [...(Array.isArray(previo) ? previo : [previo]), valor]);
  }
  return Object.fromEntries(consulta);
}

/**
 * El listado de mensualidades de recepción (spec 010b, criterios 25 y 26; HU-11): `GET /api/mensualidades`. Es de `REGISTRAR_INSCRIPCION_Y_COBRO`
 * (`ADMIN` y `SECRETARIA`, DT-9). La academia sale siempre de la sesión: la ruta no recibe ninguna, y un parámetro que la API no define es un 400. Orden de
 * las comprobaciones (el de 002): sesión → academia activa → cambio obligatorio → permiso → parámetros → listado. `HEAD` responde 404 (`/mensualidades`
 * está en `PREFIJOS_SIN_HEAD`).
 */
@Controller('mensualidades')
export class ListadoDeMensualidadesController {
  private readonly validar = new ValidarCon(consultaListadoMensualidadesSchema);

  constructor(private readonly listado: ListadoDeMensualidadesService) {}

  @Get()
  @Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')
  listar(@SesionActual() sesion: SesionVerificada, @Req() solicitud: Request): Promise<ListadoMensualidades> {
    const consulta: ConsultaListadoMensualidades = this.validar.transform(consultaCruda(solicitud));
    return this.listado.listar(sesion.usuario.academiaId, consulta);
  }
}
