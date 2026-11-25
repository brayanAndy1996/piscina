import { Inject, Injectable } from '@nestjs/common';
import {
  carnetSchema,
  type Carnet,
  contenidoQr,
  type NivelNatacion,
  type RegenerarQr,
  type EstadoConCarnet,
} from '@aquagestion/contratos';
import { PinoLogger } from 'nestjs-pino';
import { fechaCortaEnLima, hoyEnLima } from '../../comun/fechas';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../infraestructura/almacen-archivos';
import { BaseDatos } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { insertarEnAuditoriaDeAcademia } from '../auditoria/insercion';
import { actorDeSesion, bloquearActorVigente } from '../autenticacion/actor-vigente';
import type { SesionVerificada } from '../autenticacion/tipos';
import { elegirMatriculaDelCarnet, vigenteHoy } from './dominio/matricula-del-carnet';
import { nuevoTokenQr } from './dominio/token-qr';
import { alumnoNoEncontrado } from './errores';
import { leerFotoComoData } from './foto-como-data';
import { GENERADOR_PDF_CARNET, type GeneradorPdfCarnet } from './pdf/carnet-pdf';

/** A quién pertenece el carnet que se lee: un alumno por su id (rutas del personal) o el alumno de una cuenta (`/api/mi-carnet`). */
export type CriterioDeCarnet = { readonly alumnoId: string } | { readonly usuarioId: string };

interface FilaDelAlumno {
  id: string;
  nombres: string;
  apellidos: string;
  dni: string;
  nivel: NivelNatacion;
  estado: EstadoConCarnet;
  foto_clave: string | null;
  qr_token: string | null;
  qr_generado_en: Date | null;
  academia_nombre: string;
}

interface FilaDeMatricula {
  estado: 'VIGENTE' | 'FINALIZADA';
  anio: number;
  mes: number;
  desde: string;
  hasta: string;
  creado_en: Date;
  plan: string;
  clases: { diaSemana: number; horaInicio: string; horaFin: string }[];
}

interface FilaParaRegenerar {
  id: string;
  estado: string;
  qr_token: string | null;
  qr_generado_en: Date | null;
  misma_clave: boolean;
}

/** El carnet leído, con el instante en que se leyó (el PDF escribe «Datos al …» con él). */
interface CarnetLeido {
  readonly carnet: Carnet;
  readonly ahora: Date;
}

/**
 * El carnet digital del alumno y la regeneración de su QR (spec 008a; HU-13, RN-05, RN-06, sección 8.6).
 *
 * Lectura (`leer`, criterios 4 a 10): una transacción de la academia de la sesión, solo de lectura y sin bloqueos, que trae al alumno (nunca un
 * `CLIENTE`, RN-05), el nombre de la academia y sus matrículas `VIGENTE` y `FINALIZADA` con su plan y sus clases; la foto se lee del almacén
 * **después** de cerrar la transacción (DT-6) con la academia de la sesión, y si no se puede leer queda `foto: null` y un `warn` con el tipo del
 * error (DT-13). La respuesta se valida con `carnetSchema`: si sobrara un campo, falla en lugar de filtrarlo. No audita.
 *
 * Regeneración (`regenerar`, criterios 13 a 15), en una sola transacción y en este orden: `bloquearActorVigente`, la fila del alumno con
 * `FOR UPDATE`, token nuevo, y la auditoría. Con la misma clave que la última regeneración del alumno no escribe nada (un doble clic no inutiliza
 * el carnet recién impreso, DT-7). Sin correo (DR-5).
 */
@Injectable()
export class CarnetService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    @Inject(GENERADOR_PDF_CARNET) private readonly generador: GeneradorPdfCarnet,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(CarnetService.name);
  }

  /** El carnet de un alumno de la academia, o 404 `NO_ENCONTRADO` si no hay uno (id que no es UUID, inexistente, de otra academia o `CLIENTE`). */
  async leer(academiaId: string, criterio: CriterioDeCarnet): Promise<Carnet> {
    return (await this.leerConFecha(academiaId, criterio)).carnet;
  }

  /** El PDF del carnet: los datos se leen con `leer` (la transacción ya terminó) y después se dibuja con el generador inyectado. */
  async pdf(academiaId: string, criterio: CriterioDeCarnet): Promise<Buffer> {
    const { carnet, ahora } = await this.leerConFecha(academiaId, criterio);
    return this.generador.generar({
      carnet,
      contenidoQr: carnet.qr?.contenido ?? null,
      fechaDatos: fechaCortaEnLima(ahora),
      generadoEn: ahora,
    });
  }

  async regenerar(sesion: SesionVerificada, idPedido: string, datos: RegenerarQr, ip: string | null): Promise<Carnet> {
    const actor = actorDeSesion(sesion);
    await this.baseDatos.conAcademia(actor.academiaId, async (tx) => {
      await bloquearActorVigente(
        tx,
        { id: actor.id, versionToken: actor.versionToken },
        { registro: this.registro, ip },
      );
      // Un id que no es UUID no se consulta: el mismo 404 que uno inexistente, de otra academia o de un cliente (criterio 5).
      if (!PATRON_UUID.test(idPedido)) throw alumnoNoEncontrado();
      const filas = await tx.cliente.$queryRaw<FilaParaRegenerar[]>`
        SELECT id::text AS id, estado::text AS estado, qr_token, qr_generado_en,
               (qr_clave_idempotencia IS NOT NULL AND qr_clave_idempotencia = ${datos.claveIdempotencia}::uuid) AS misma_clave
          FROM alumnos
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${idPedido}::uuid
           FOR UPDATE`;
      const alumno = filas[0];
      if (!alumno || alumno.estado === 'CLIENTE') throw alumnoNoEncontrado();
      // Un reintento con la misma clave: nada se escribe ni se audita (criterio 14).
      if (alumno.misma_clave) return;

      const ahora = this.reloj.ahora();
      await tx.cliente.$executeRaw`
        UPDATE alumnos
           SET qr_token = ${nuevoTokenQrDistinto(alumno.qr_token)},
               qr_generado_en = ${ahora}::timestamptz,
               qr_clave_idempotencia = ${datos.claveIdempotencia}::uuid,
               actualizado_en = ${ahora}::timestamptz
         WHERE academia_id = ${tx.academiaId}::uuid AND id = ${alumno.id}::uuid`;
      await insertarEnAuditoriaDeAcademia(tx.cliente, tx.academiaId, ahora, {
        actorTipo: 'USUARIO',
        actorId: actor.id,
        accion: 'CARNET_QR_REGENERADO',
        entidad: 'alumno',
        entidadId: alumno.id,
        datosAntes: { qrGeneradoEn: alumno.qr_generado_en?.toISOString() ?? null },
        datosDespues: { qrGeneradoEn: ahora.toISOString() },
        motivo: datos.motivo,
        ip,
      });
    });
    // Después de confirmar: el carnet como quedó (con la foto, que se lee fuera de la transacción).
    return this.leer(actor.academiaId, { alumnoId: idPedido });
  }

  private async leerConFecha(academiaId: string, criterio: CriterioDeCarnet): Promise<CarnetLeido> {
    const porId = 'alumnoId' in criterio;
    const valor = porId ? criterio.alumnoId : criterio.usuarioId;
    // Un id que no es UUID no se consulta: el mismo 404 (criterio 5).
    if (!PATRON_UUID.test(valor)) throw alumnoNoEncontrado();

    const ahora = this.reloj.ahora();
    const hoy = hoyEnLima(ahora);
    const leido = await this.baseDatos.conAcademia(academiaId, async (tx) => {
      const filas = porId
        ? await tx.cliente.$queryRaw<FilaDelAlumno[]>`
            SELECT a.id::text AS id, a.nombres, a.apellidos, a.dni, a.nivel::text AS nivel, a.estado::text AS estado, a.foto_clave,
                   a.qr_token, a.qr_generado_en, ac.nombre AS academia_nombre
              FROM alumnos a JOIN academias ac ON ac.id = a.academia_id
             WHERE a.academia_id = ${tx.academiaId}::uuid AND a.id = ${valor}::uuid AND a.estado <> 'CLIENTE'`
        : await tx.cliente.$queryRaw<FilaDelAlumno[]>`
            SELECT a.id::text AS id, a.nombres, a.apellidos, a.dni, a.nivel::text AS nivel, a.estado::text AS estado, a.foto_clave,
                   a.qr_token, a.qr_generado_en, ac.nombre AS academia_nombre
              FROM alumnos a JOIN academias ac ON ac.id = a.academia_id
             WHERE a.academia_id = ${tx.academiaId}::uuid AND a.usuario_id = ${valor}::uuid AND a.estado <> 'CLIENTE'`;
      const alumno = filas[0];
      if (!alumno) throw alumnoNoEncontrado();
      const matriculas = await tx.cliente.$queryRaw<FilaDeMatricula[]>`
        SELECT m.estado::text AS estado, m.anio::int AS anio, m.mes::int AS mes,
               to_char(m.fecha_inicio, 'YYYY-MM-DD') AS desde, to_char(m.fecha_fin, 'YYYY-MM-DD') AS hasta, m.creado_en, p.nombre AS plan,
               COALESCE((
                 SELECT json_agg(json_build_object(
                          'diaSemana', c.dia_semana::int,
                          'horaInicio', to_char(c.hora_inicio, 'HH24:MI'),
                          'horaFin', to_char(c.hora_fin, 'HH24:MI'))
                        ORDER BY c.dia_semana, c.hora_inicio, c.id)
                   FROM matricula_clases mc
                   JOIN clases c ON c.academia_id = mc.academia_id AND c.id = mc.clase_id
                  WHERE mc.academia_id = m.academia_id AND mc.matricula_id = m.id
               ), '[]'::json) AS clases
          FROM matriculas m JOIN planes p ON p.academia_id = m.academia_id AND p.id = m.plan_id
         WHERE m.academia_id = ${tx.academiaId}::uuid AND m.alumno_id = ${alumno.id}::uuid AND m.estado IN ('VIGENTE', 'FINALIZADA')`;
      return { alumno, matriculas };
    });
    const { alumno } = leido;
    const elegida = elegirMatriculaDelCarnet(
      leido.matriculas.map((fila) => ({ ...fila, creadoEn: fila.creado_en })),
      hoy,
    );
    const matricula = elegida
      ? {
          plan: elegida.plan,
          clases: elegida.clases.map(({ diaSemana, horaInicio, horaFin }) => ({ diaSemana, horaInicio, horaFin })),
          desde: elegida.desde,
          hasta: elegida.hasta,
          vigenteHoy: vigenteHoy(elegida, hoy),
        }
      : null;

    // La foto, fuera de toda transacción y con la academia de la sesión (DT-6, criterio 9).
    const foto = await leerFotoComoData(this.almacen, this.registro, academiaId, alumno.foto_clave);

    const carnet = carnetSchema.parse({
      academia: { nombre: alumno.academia_nombre },
      alumno: {
        id: alumno.id,
        nombres: alumno.nombres,
        apellidos: alumno.apellidos,
        dni: alumno.dni,
        nivel: alumno.nivel,
        estado: alumno.estado,
      },
      foto,
      matricula,
      qr:
        alumno.qr_token !== null && alumno.qr_generado_en !== null
          ? { contenido: contenidoQr(alumno.qr_token), generadoEn: alumno.qr_generado_en.toISOString() }
          : null,
    });
    return { carnet, ahora };
  }
}

/** Un token nuevo, distinto del anterior (con 256 bits al azar, coincidir es imposible en la práctica; se comprueba igual). */
function nuevoTokenQrDistinto(anterior: string | null): string {
  let token = nuevoTokenQr();
  while (token === anterior) token = nuevoTokenQr();
  return token;
}
