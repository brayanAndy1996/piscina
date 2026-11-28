import { Inject, Injectable } from '@nestjs/common';
import { edadEnFecha, type MensualidadDelPanel, type MiPanel, miPanelSchema } from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { hoyEnLima } from '../../comun/fechas';
import { BaseDatos } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { leerAlumnoDeLaSesion } from '../alumnos';
import { leerConfiguracion } from '../configuracion/lectura';
import { mesDeTexto, mesSiguiente, textoDelMes } from '../mensualidades/dominio/ventana';
import {
  agruparPorMes,
  claveDelMes,
  type FilaDeMatricula,
  indiceDelMes,
  leerMensualidadesParaEstado,
} from '../mensualidades/lectura-de-estado';
import { elegirMensualidades, mesesDeAsistencia } from './dominio/mensualidad-del-panel';

/**
 * El resumen del panel del alumno y del apoderado (spec 011, criterios 6 a 11; HU-06, D-08, D-14). Una sola transacción de la academia de la sesión, solo de lectura y
 * sin bloqueos: el alumno de la cuenta de la sesión (única fuente del alumno, criterio 2), la configuración (`diasPorVencer`, sin caché), las mensualidades de M−1, M y
 * M+1 con la misma lectura del listado de recepción (DT-4) y los meses con una mensualidad pagada. «Hoy» es la fecha de Lima del reloj de la aplicación, tomada una
 * vez antes de abrir la transacción. La respuesta no lleva ningún id (DT-6) y se valida con `miPanelSchema`: si sobrara una clave, falla en lugar de filtrarla. No audita.
 */
@Injectable()
export class MiPanelService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(MiPanelService.name);
  }

  /** El mes en curso de Lima, `AAAA-MM`, con el reloj de la aplicación. */
  mesEnCurso(): string {
    return hoyEnLima(this.reloj.ahora()).slice(0, 7);
  }

  async resumen(academiaId: string, usuarioId: string): Promise<MiPanel> {
    const hoy = hoyEnLima(this.reloj.ahora());
    const mesEnCurso = hoy.slice(0, 7);
    const enCurso = mesDeTexto(mesEnCurso);
    const anterior =
      enCurso.mes === 1 ? { anio: enCurso.anio - 1, mes: 12 } : { anio: enCurso.anio, mes: enCurso.mes - 1 };
    const siguiente = mesSiguiente(enCurso);

    const leido = await this.baseDatos.conAcademia(academiaId, async (tx) => {
      const alumno = await leerAlumnoDeLaSesion(tx, usuarioId);
      const configuracion = await leerConfiguracion(tx, { registro: this.registro });
      const filas = await leerMensualidadesParaEstado(tx, [anterior, enCurso, siguiente], alumno.id);
      const pagados = await tx.cliente.$queryRaw<{ anio: number; mes: number }[]>`
        SELECT DISTINCT anio::int AS anio, mes::int AS mes
          FROM matriculas
         WHERE academia_id = ${tx.academiaId}::uuid AND alumno_id = ${alumno.id}::uuid AND estado IN ('VIGENTE', 'FINALIZADA')
           AND (anio::int * 12 + mes::int - 1) <= ${indiceDelMes(enCurso)}::int`;
      return { alumno, diasPorVencer: configuracion.diasPorVencer, filas, pagados };
    });

    const { alumno } = leido;
    const elegidas = elegirMensualidades({
      hoy,
      diasPorVencer: leido.diasPorVencer,
      meses: agruparPorMes(leido.filas).get(alumno.id) ?? new Map(),
    });
    return miPanelSchema.parse({
      hoy,
      mesEnCurso,
      alumno: {
        nombres: alumno.nombres,
        apellidos: alumno.apellidos,
        dni: alumno.dni,
        nivel: alumno.nivel,
        edad: edadEnFecha(alumno.fechaNacimiento, hoy),
        estado: alumno.estado,
      },
      mensualidad: {
        estado: elegidas.estado,
        actual: elegidas.actual === null ? null : aMensualidadDelPanel(elegidas.actual),
        siguiente:
          elegidas.siguiente === null
            ? null
            : { ...aMensualidadDelPanel(elegidas.siguiente.fila), estado: elegidas.siguiente.estado },
      },
      mesesDeAsistencia: mesesDeAsistencia(
        mesEnCurso,
        leido.pagados.map((fila) => textoDelMes(fila)),
      ),
    });
  }
}

/** Una mensualidad del panel: sin los ids que trae la lectura (matrícula, plan y clases) y con las clases restantes. */
function aMensualidadDelPanel(fila: FilaDeMatricula): MensualidadDelPanel {
  return {
    mes: claveDelMes({ anio: fila.anio, mes: fila.mes }),
    plan: { nombre: fila.plan_nombre },
    clases: fila.clases.map(({ diaSemana, horaInicio, horaFin }) => ({ diaSemana, horaInicio, horaFin })),
    clasesUsadas: fila.clases_usadas,
    clasesTotales: fila.clases_totales,
    clasesRestantes: fila.clases_totales - fila.clases_usadas,
    desde: fila.desde,
    hasta: fila.hasta,
  };
}
