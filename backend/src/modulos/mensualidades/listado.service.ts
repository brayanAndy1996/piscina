import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  ConsultaListadoMensualidades,
  EstadoMensualidad,
  FilaDelListadoMensualidades,
  ListadoMensualidades,
  MensualidadDelListado,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { ErrorNegocio } from '../../comun/errores';
import { hoyEnLima } from '../../comun/fechas';
import { MENSAJE_SOLICITUD_INVALIDA } from '../../comun/validacion';
import { BaseDatos } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { leerConfiguracion } from '../configuracion/lectura';
import { estadoDeMensualidad } from './dominio/estado';
import { type MesDeCalendario, mesDeTexto, mesSiguiente } from './dominio/ventana';
import {
  agruparPorMes,
  claveDelMes,
  type FilaDeMatricula,
  indiceDelMes,
  leerMensualidadesParaEstado,
} from './lectura-de-estado';

/** Como mucho estas filas por respuesta (DT-14); `hayMas` avisa si había más. */
export const MAXIMO_DE_FILAS_DEL_LISTADO = 500;

const COMPARADOR = new Intl.Collator('es');

interface Candidato {
  readonly fila: FilaDelListadoMensualidades;
  readonly planId: string;
  readonly claseIds: readonly string[];
}

const clave = claveDelMes;
const mesAnterior = ({ anio, mes }: MesDeCalendario): MesDeCalendario =>
  mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };

/**
 * El listado de mensualidades (spec 010b, criterios 25 y 26; HU-11, DT-14). Una sola lectura de la academia de la sesión, sin bloqueos, sin escribir y
 * sin auditar: las matrículas pagadas o en verificación de los meses X−1, X y (si X es el mes en curso) X+1 de los alumnos que no son `CLIENTE` ni
 * `INACTIVO`, con su plan y sus clases. `estadoDeMensualidad` decide el estado de cada alumno en memoria; los filtros y los totales se aplican después
 * y la respuesta corta en `MAXIMO_DE_FILAS_DEL_LISTADO` filas. «Ahora» es el reloj de la aplicación y «hoy» es el de Lima.
 */
@Injectable()
export class ListadoDeMensualidadesService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(ListadoDeMensualidadesService.name);
  }

  async listar(academiaId: string, consulta: ConsultaListadoMensualidades): Promise<ListadoMensualidades> {
    return this.baseDatos.conAcademia(academiaId, async (tx) => {
      const ahora = this.reloj.ahora();
      const hoy = hoyEnLima(ahora);
      const enCurso = mesDeTexto(hoy.slice(0, 7));
      const pedido = consulta.mes === undefined ? enCurso : mesDeTexto(consulta.mes);
      if (indiceDelMes(pedido) > indiceDelMes(enCurso)) {
        throw new ErrorNegocio(HttpStatus.BAD_REQUEST, 'SOLICITUD_INVALIDA', MENSAJE_SOLICITUD_INVALIDA, {
          errores: [{ campo: 'mes', mensaje: 'El mes no puede ser posterior al mes en curso.' }],
        });
      }
      const esElMesEnCurso = indiceDelMes(pedido) === indiceDelMes(enCurso);
      const configuracion = await leerConfiguracion(tx, { registro: this.registro });

      const anterior = mesAnterior(pedido);
      const siguiente = mesSiguiente(pedido);
      const filas = await leerMensualidadesParaEstado(
        tx,
        esElMesEnCurso ? [anterior, pedido, siguiente] : [anterior, pedido],
        consulta.alumnoId?.toLowerCase() ?? null,
      );
      const porAlumno = agruparPorMes(filas);

      const candidatos: (Candidato & { estado: EstadoMensualidad })[] = [];
      for (const [alumnoId, meses] of porAlumno) {
        const delMes = meses.get(clave(pedido));
        const delAnterior = meses.get(clave(anterior));
        const delSiguiente = esElMesEnCurso ? meses.get(clave(siguiente)) : undefined;
        const estado = estadoDeMensualidad({
          hoy,
          mes: clave(pedido),
          diasPorVencer: configuracion.diasPorVencer,
          pagadaDelMes: delMes?.pagada === true,
          enVerificacionDelMes: delMes !== undefined && !delMes.pagada,
          pagadaDelMesAnterior: delAnterior?.pagada === true,
          siguiente: delSiguiente === undefined ? null : delSiguiente.pagada ? 'PAGADA' : 'EN_VERIFICACION',
        });
        if (estado === null) continue;
        const elegida = estado === 'VENCIDO' ? delAnterior : delMes;
        if (elegida === undefined) continue;
        const alumno = elegida.fila;
        candidatos.push({
          estado,
          planId: alumno.plan_id,
          claseIds: alumno.clases.map((clase) => clase.id),
          fila: {
            alumnoId,
            nombres: alumno.nombres,
            apellidos: alumno.apellidos,
            nivel: alumno.nivel,
            estado,
            mensualidad: aMensualidad(alumno),
            siguiente:
              delSiguiente === undefined
                ? null
                : { mes: clave(siguiente), estado: delSiguiente.pagada ? 'PAGADA' : 'EN_VERIFICACION' },
          },
        });
      }

      // Los filtros de plan, clase y nivel (por la mensualidad de la fila y por el nivel del alumno); los totales los cuentan antes del filtro de estado.
      const planId = consulta.planId?.toLowerCase();
      const claseId = consulta.claseId?.toLowerCase();
      const conFiltros = candidatos.filter(
        (candidato) =>
          (planId === undefined || candidato.planId === planId) &&
          (claseId === undefined || candidato.claseIds.includes(claseId)) &&
          (consulta.nivel === undefined || candidato.fila.nivel === consulta.nivel),
      );
      const totales = { AL_DIA: 0, POR_VENCER: 0, VENCIDO: 0, PENDIENTE_VERIFICACION: 0 };
      for (const candidato of conFiltros) totales[candidato.estado] += 1;

      const mostradas = conFiltros
        .filter((candidato) => consulta.estado === undefined || candidato.estado === consulta.estado)
        .map((candidato) => candidato.fila)
        .sort(
          (a, b) =>
            COMPARADOR.compare(a.apellidos, b.apellidos) ||
            COMPARADOR.compare(a.nombres, b.nombres) ||
            (a.alumnoId < b.alumnoId ? -1 : a.alumnoId > b.alumnoId ? 1 : 0),
        );
      return {
        mes: clave(pedido),
        hoy,
        totales,
        alumnos: mostradas.slice(0, MAXIMO_DE_FILAS_DEL_LISTADO),
        hayMas: mostradas.length > MAXIMO_DE_FILAS_DEL_LISTADO,
      };
    });
  }
}

function aMensualidad(fila: FilaDeMatricula): MensualidadDelListado {
  return {
    mes: clave({ anio: fila.anio, mes: fila.mes }),
    plan: { id: fila.plan_id, nombre: fila.plan_nombre },
    clases: fila.clases,
    clasesUsadas: fila.clases_usadas,
    clasesTotales: fila.clases_totales,
  };
}
