import { Inject, Injectable } from '@nestjs/common';
import {
  type Caja,
  type CajaHistorial,
  type FiltroHistorialCajas,
  MATRIZ_PERMISOS,
  mensajeDelRangoDelHistorial,
  rangoDelHistorial,
  type RespuestaCaja,
  type RespuestaHistorialCajas,
} from '@aquagestion/contratos';
import { aDecimal, aTextoMonto } from '../../comun/dinero';
import { ErrorNegocio } from '../../comun/errores';
import { fechaDeBase, hoyEnLima } from '../../comun/fechas';
import { MENSAJE_SOLICITUD_INVALIDA } from '../../comun/validacion';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { BaseDatos, type Fragmento, sql, type TransaccionAcademia, vacio } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import type { SesionVerificada } from '../autenticacion/tipos';
import { esDeOtroDia } from './dominio/dia';
import { calcularDiferencia } from './dominio/esperado';
import { noEncontrado } from './errores';
import { leerCaja } from './lectura';
import { GENERADOR_PDF_CIERRE, type DatosPdfCierre, type GeneradorPdfCierre } from './pdf/cierre-pdf';

/** El `numero` de un cierre en la dirección del PDF (PQ6): un entero de 1 a 5 dígitos sin ceros a la izquierda ni signo, y como mucho `smallint`. */
const PATRON_NUMERO_DE_CIERRE = /^[1-9][0-9]{0,4}$/;
const NUMERO_MAXIMO_DE_CIERRE = 32_767;

/** El PDF ya armado: el nombre del archivo y los bytes completos. */
export interface PdfDeCierre {
  readonly nombreArchivo: string;
  readonly contenido: Buffer;
}

interface FilaDeLista {
  id: string;
  fecha: string;
  estado: 'ABIERTA' | 'CERRADA';
  monto_inicial: string;
  abierta_por_id: string;
  abierta_por_nombres: string;
  abierta_por_apellidos: string;
  ingresos_efectivo: string;
  ingresos_yape: string;
  ingresos_transferencia: string;
  egresos_efectivo: string;
  cierre_numero: number | null;
  cierre_monto_declarado: string | null;
  cierre_diferencia: string | null;
  cierre_esperado_efectivo: string | null;
  cierre_tardio: boolean | null;
  cierre_cerrado_por_id: string | null;
  cierre_cerrado_por_nombres: string | null;
  cierre_cerrado_por_apellidos: string | null;
  cierre_cerrado_en: Date | null;
}

/**
 * El alcance de quien lee el historial (spec 006b, PQ2; DR-9 y DR-13), como una condición sobre `cajas c` que se agrega al `WHERE`. Sale de
 * la matriz de permisos (`VER_REPORTES_FINANCIEROS[rol]`), no del nombre del rol:
 * - `TODO`: todas las cajas de la academia;
 * - `SU_CAJA`: las que abrió, las que cerró alguna vez (algún cierre, vigente o reabierto), la que está `ABIERTA` ahora y la de hoy en Lima;
 * - cualquier otro valor, o ninguno: nada (falla cerrada).
 * Una sola función para la lista, el detalle y el PDF: no pueden desviarse. La condición de la academia (`c.academia_id`) la pone quien llama.
 */
function condicionDeAlcance(rol: string, usuarioId: string, hoy: string): Fragmento {
  const fila = Object.hasOwn(MATRIZ_PERMISOS.VER_REPORTES_FINANCIEROS, rol)
    ? MATRIZ_PERMISOS.VER_REPORTES_FINANCIEROS[rol as keyof typeof MATRIZ_PERMISOS.VER_REPORTES_FINANCIEROS]
    : undefined;
  if (fila === 'TODO') return vacio;
  if (fila === 'SU_CAJA') {
    return sql`AND (c.abierta_por = ${usuarioId}::uuid
                 OR c.estado = 'ABIERTA'::estado_caja
                 OR c.fecha = ${hoy}::date
                 OR EXISTS (SELECT 1 FROM cierres_caja k
                             WHERE k.academia_id = c.academia_id AND k.caja_id = c.id AND k.cerrado_por = ${usuarioId}::uuid))`;
  }
  return sql`AND false`;
}

/** El 400 de la consulta de la lista: el mismo formato de los esquemas (`detalles.errores[].campo`). */
function consultaInvalida(campo: string, mensaje: string): ErrorNegocio {
  return new ErrorNegocio(400, 'SOLICITUD_INVALIDA', MENSAJE_SOLICITUD_INVALIDA, { errores: [{ campo, mensaje }] });
}

/**
 * El historial de cajas, el detalle de una caja y el PDF de un cierre (spec 006b, criterios 40 a 43; HU-27; D-23). Solo lecturas: cada una
 * corre en un `conAcademia` de la academia de la sesión, sin `bloquearActorVigente`, sin `FOR UPDATE` y sin auditoría (PQ1). "Hoy" sale de
 * `RELOJ` en America/Lima. Lo que no se puede mostrar (otra academia, un id que no existe o que no es UUID, una caja fuera del alcance de
 * la secretaria, un cierre que no existe) responde el mismo 404 `NO_ENCONTRADO` (PQ1).
 *
 * El PDF se arma fuera de la transacción: la lectura termina (`COMMIT`) antes de llamar al generador (criterio 43, PQ8), así que ninguna
 * conexión queda ocupada mientras se arma el documento y una falla del generador no cambia nada.
 */
@Injectable()
export class HistorialService {
  constructor(
    private readonly baseDatos: BaseDatos,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(GENERADOR_PDF_CIERRE) private readonly generador: GeneradorPdfCierre,
  ) {}

  /**
   * `GET /api/cajas` (criterio 40, PQ3 y PQ4): las cajas con fecha entre `desde` y `hasta` (los dos incluidos) dentro del alcance, de la fecha
   * más reciente a la más antigua, con una sola consulta (una sola foto de la base). `consulta` ya pasó por `filtroHistorialCajasSchema`; aquí
   * se aplican los valores por defecto con el reloj y se vuelve a comprobar el rango (con un solo valor, el otro sale del valor por defecto).
   */
  async listar(sesion: SesionVerificada, consulta: FiltroHistorialCajas): Promise<RespuestaHistorialCajas> {
    const ahora = this.reloj.ahora();
    const hoy = hoyEnLima(ahora);
    const { desde, hasta } = rangoDelHistorial(consulta, hoy);
    const mensajeDelRango = mensajeDelRangoDelHistorial(desde, hasta);
    if (mensajeDelRango !== null) throw consultaInvalida('desde', mensajeDelRango);

    const usuario = sesion.usuario;
    const cajas = await this.baseDatos.conAcademia(usuario.academiaId, async (tx) => {
      const alcance = condicionDeAlcance(usuario.rol, usuario.id, hoy);
      const filas = await tx.cliente.$queryRaw<FilaDeLista[]>`
        SELECT c.id::text AS id, c.fecha::text AS fecha, c.estado::text AS estado, c.monto_inicial::text AS monto_inicial,
               u.id::text AS abierta_por_id, u.nombres AS abierta_por_nombres, u.apellidos AS abierta_por_apellidos,
               s.ingresos_efectivo::text AS ingresos_efectivo, s.ingresos_yape::text AS ingresos_yape,
               s.ingresos_transferencia::text AS ingresos_transferencia, s.egresos_efectivo::text AS egresos_efectivo,
               uc.numero::int AS cierre_numero, uc.monto_declarado::text AS cierre_monto_declarado,
               uc.diferencia::text AS cierre_diferencia, uc.esperado_efectivo::text AS cierre_esperado_efectivo,
               uc.tardio AS cierre_tardio, uc.cerrado_por::text AS cierre_cerrado_por_id,
               uc.nombres AS cierre_cerrado_por_nombres, uc.apellidos AS cierre_cerrado_por_apellidos,
               uc.cerrado_en AS cierre_cerrado_en
          FROM cajas c
          JOIN usuarios u ON u.academia_id = c.academia_id AND u.id = c.abierta_por
          CROSS JOIN LATERAL (
            SELECT coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'INGRESO'::tipo_movimiento_caja AND m.metodo = 'EFECTIVO'::metodo_pago), 0) AS ingresos_efectivo,
                   coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'INGRESO'::tipo_movimiento_caja AND m.metodo = 'YAPE'::metodo_pago), 0) AS ingresos_yape,
                   coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'INGRESO'::tipo_movimiento_caja AND m.metodo = 'TRANSFERENCIA'::metodo_pago), 0) AS ingresos_transferencia,
                   coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'EGRESO'::tipo_movimiento_caja), 0) AS egresos_efectivo
              FROM movimientos_caja m
             WHERE m.academia_id = c.academia_id AND m.caja_id = c.id
          ) s
          LEFT JOIN LATERAL (
            SELECT k.numero, k.monto_declarado, k.diferencia, k.esperado_efectivo, k.tardio, k.cerrado_por, k.cerrado_en,
                   cp.nombres, cp.apellidos
              FROM cierres_caja k
              JOIN usuarios cp ON cp.academia_id = k.academia_id AND cp.id = k.cerrado_por
             WHERE k.academia_id = c.academia_id AND k.caja_id = c.id
             ORDER BY k.numero DESC
             LIMIT 1
          ) uc ON true
         WHERE c.academia_id = ${tx.academiaId}::uuid
           AND c.fecha >= ${desde}::date AND c.fecha <= ${hasta}::date
           ${alcance}
         ORDER BY c.fecha DESC`;
      return filas.map((fila) => this.cajaDeLista(fila, ahora));
    });
    return { desde, hasta, cajas };
  }

  /** `GET /api/cajas/{id}` (criterio 41, PQ5): la caja con todos sus movimientos y cierres, armada con `leerCaja` (la misma de `/actual`). */
  async detalle(sesion: SesionVerificada, idPedido: string): Promise<RespuestaCaja> {
    if (!PATRON_UUID.test(idPedido)) throw noEncontrado();
    const caja = await this.baseDatos.conAcademia(sesion.usuario.academiaId, (tx) =>
      this.leerCajaConAlcance(tx, sesion, idPedido.toLowerCase()),
    );
    if (caja === null) throw noEncontrado();
    return { caja };
  }

  /**
   * `GET /api/cajas/{id}/cierres/{numero}/pdf` (criterio 42, PQ6 a PQ9). Después del permiso, un id o un `numero` con forma inválida son 404
   * sin tocar la base. Una transacción corta lee la caja (con el alcance) y su cierre; al terminar, y recién entonces, se llama al generador.
   */
  async pdf(sesion: SesionVerificada, idPedido: string, numeroPedido: string): Promise<PdfDeCierre> {
    if (!PATRON_UUID.test(idPedido)) throw noEncontrado();
    if (!PATRON_NUMERO_DE_CIERRE.test(numeroPedido)) throw noEncontrado();
    const numero = Number(numeroPedido);
    if (numero > NUMERO_MAXIMO_DE_CIERRE) throw noEncontrado();

    const datos = await this.baseDatos.conAcademia(sesion.usuario.academiaId, async (tx) => {
      const caja = await this.leerCajaConAlcance(tx, sesion, idPedido.toLowerCase());
      const cierre = caja?.cierres.find((candidato) => candidato.numero === numero);
      if (!caja || !cierre) return null;
      return {
        academia: sesion.academia.nombre,
        caja: {
          id: caja.id,
          fecha: caja.fecha,
          montoInicial: caja.montoInicial,
          abiertaPor: caja.abiertaPor,
          abiertaEn: caja.abiertaEn,
        },
        cierre,
        movimientos: caja.movimientos.filter((movimiento) => movimiento.numero <= cierre.movimientosHasta),
      } satisfies DatosPdfCierre;
    });
    if (datos === null) throw noEncontrado();

    // La transacción ya terminó: nada de la base queda abierto mientras se arma el documento. Si el generador falla, el error sube aquí.
    const contenido = await this.generador.generar(datos);
    return { nombreArchivo: `cierre-caja-${datos.caja.fecha}-${datos.cierre.numero}.pdf`, contenido };
  }

  /** La caja `id` con su detalle si está dentro del alcance de quien lee; `null` si no existe, es de otra academia o queda fuera del alcance. */
  private async leerCajaConAlcance(
    tx: TransaccionAcademia,
    sesion: SesionVerificada,
    id: string,
  ): Promise<Caja | null> {
    const ahora = this.reloj.ahora();
    const alcance = condicionDeAlcance(sesion.usuario.rol, sesion.usuario.id, hoyEnLima(ahora));
    const visibles = await tx.cliente.$queryRaw<{ id: string }[]>`
      SELECT c.id::text AS id FROM cajas c
       WHERE c.academia_id = ${tx.academiaId}::uuid AND c.id = ${id}::uuid ${alcance}`;
    if (visibles.length === 0) return null;
    return leerCaja(tx, id, ahora);
  }

  private cajaDeLista(fila: FilaDeLista, ahora: Date): CajaHistorial {
    let ultimoCierre: CajaHistorial['ultimoCierre'] = null;
    if (
      fila.cierre_numero !== null &&
      fila.cierre_monto_declarado !== null &&
      fila.cierre_diferencia !== null &&
      fila.cierre_esperado_efectivo !== null &&
      fila.cierre_tardio !== null &&
      fila.cierre_cerrado_por_id !== null
    ) {
      const { resultado } = calcularDiferencia(
        aDecimal(fila.cierre_monto_declarado),
        aDecimal(fila.cierre_esperado_efectivo),
      );
      ultimoCierre = {
        numero: fila.cierre_numero,
        montoDeclarado: aTextoMonto(fila.cierre_monto_declarado),
        diferencia: aTextoMonto(fila.cierre_diferencia),
        resultado,
        tardio: fila.cierre_tardio,
        cerradoPor: {
          id: fila.cierre_cerrado_por_id,
          nombres: fila.cierre_cerrado_por_nombres ?? '',
          apellidos: fila.cierre_cerrado_por_apellidos ?? '',
        },
        cerradoEn: fechaDeBase(fila.cierre_cerrado_en).toISOString(),
      };
    }
    return {
      id: fila.id,
      fecha: fila.fecha,
      estado: fila.estado,
      deOtroDia: esDeOtroDia(fila.fecha, ahora),
      montoInicial: aTextoMonto(fila.monto_inicial),
      abiertaPor: { id: fila.abierta_por_id, nombres: fila.abierta_por_nombres, apellidos: fila.abierta_por_apellidos },
      totalIngresos: {
        efectivo: aTextoMonto(fila.ingresos_efectivo),
        yape: aTextoMonto(fila.ingresos_yape),
        transferencia: aTextoMonto(fila.ingresos_transferencia),
      },
      totalEgresos: { efectivo: aTextoMonto(fila.egresos_efectivo) },
      ultimoCierre,
    };
  }
}
