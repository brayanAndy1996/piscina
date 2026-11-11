import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AcademiaResumen, CrearAcademia } from '@aquagestion/contratos';
import { ErrorNegocio } from '../../comun/errores';
import { fechaDeBase, fechaDeBaseONula } from '../../comun/fechas';
import { BaseDatos, type TransaccionPlataforma } from '../../infraestructura/prisma';
import { RELOJ, type Reloj } from '../../infraestructura/reloj';
import { AuditoriaService } from '../auditoria';
import type { SuperadminAutenticado } from './tipos';

interface FilaAcademia {
  id: string;
  nombre: string;
  nombre_corto: string;
  estado: 'ACTIVA' | 'SUSPENDIDA';
  motivo_suspension: string | null;
  suspendida_en: Date | null;
  creada_en: Date;
}

/** Falla cerrado (criterio 108): una fecha leída de la base que no es válida lanza un error interno, no se responde. */
function aResumen(fila: FilaAcademia): AcademiaResumen {
  const creadaEn = fechaDeBase(fila.creada_en);
  const suspendidaEn = fechaDeBaseONula(fila.suspendida_en);
  return {
    id: fila.id,
    nombre: fila.nombre,
    nombreCorto: fila.nombre_corto,
    estado: fila.estado,
    creadaEn: creadaEn.toISOString(),
    suspendidaEn: suspendidaEn ? suspendidaEn.toISOString() : null,
    motivoSuspension: fila.motivo_suspension,
  };
}

/**
 * Academias vistas desde la plataforma (D-29): crear, listar, suspender y reactivar. Solo maneja la tabla `academias`
 * (como plataforma): nunca lee datos internos de una academia ni borra academias (DR-10). Cada operación y su registro
 * de auditoría van en la misma transacción.
 */
@Injectable()
export class AcademiasService {
  constructor(
    private readonly baseDatos: BaseDatos,
    private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** Crea una academia activa. La restricción única de `nombre_corto` resuelve las creaciones simultáneas. */
  crear(datos: CrearAcademia, actor: SuperadminAutenticado, ip: string | null): Promise<AcademiaResumen> {
    return this.baseDatos.comoPlataforma(async (tx) => {
      const ahora = this.reloj.ahora();
      const filas = await tx.cliente.$queryRaw<FilaAcademia[]>`
        INSERT INTO academias (id, nombre, nombre_corto, estado, creada_en, actualizada_en)
        VALUES (gen_random_uuid(), ${datos.nombre}, ${datos.nombreCorto}, 'ACTIVA'::estado_academia,
                ${ahora}::timestamptz, ${ahora}::timestamptz)
        ON CONFLICT (nombre_corto) DO NOTHING
        RETURNING id::text AS id, nombre, nombre_corto, estado::text AS estado, motivo_suspension,
                  suspendida_en, creada_en`;
      const fila = filas[0];
      if (!fila) {
        throw new ErrorNegocio(409, 'NOMBRE_CORTO_EN_USO', 'Ya existe una academia con ese nombre corto.');
      }
      const academia = aResumen(fila);
      await this.auditoria.registrarEnPlataforma(tx, {
        actorTipo: 'SUPERADMIN',
        actorId: actor.id,
        accion: 'ACADEMIA_CREADA',
        entidad: 'academia',
        entidadId: academia.id,
        datosDespues: {
          id: academia.id,
          nombre: academia.nombre,
          nombreCorto: academia.nombreCorto,
          estado: academia.estado,
        },
        ip,
      });
      return academia;
    });
  }

  /** Todas las academias, activas y suspendidas, ordenadas por nombre corto. Solo los campos de `AcademiaResumen`. */
  async listar(): Promise<AcademiaResumen[]> {
    const filas = await this.baseDatos.comoPlataforma(
      (tx) =>
        tx.cliente.$queryRaw<FilaAcademia[]>`
        SELECT id::text AS id, nombre, nombre_corto, estado::text AS estado, motivo_suspension, suspendida_en,
               creada_en
          FROM academias ORDER BY nombre_corto COLLATE "C"`,
    );
    return filas.map(aResumen);
  }

  /** Suspende una academia activa (DR-4). Con la fila bloqueada, dos suspensiones simultáneas dan 200 y 409. */
  suspender(id: string, motivo: string, actor: SuperadminAutenticado, ip: string | null): Promise<AcademiaResumen> {
    return this.baseDatos.comoPlataforma(async (tx) => {
      const estado = await this.bloquearYLeerEstado(tx, id);
      if (estado === 'SUSPENDIDA') {
        throw new ErrorNegocio(409, 'ACADEMIA_YA_SUSPENDIDA', 'La academia ya está suspendida.');
      }
      const ahora = this.reloj.ahora();
      const filas = await tx.cliente.$queryRaw<FilaAcademia[]>`
        UPDATE academias
           SET estado = 'SUSPENDIDA'::estado_academia, motivo_suspension = ${motivo},
               suspendida_en = ${ahora}::timestamptz, actualizada_en = ${ahora}::timestamptz
         WHERE id = ${id}::uuid
        RETURNING id::text AS id, nombre, nombre_corto, estado::text AS estado, motivo_suspension,
                  suspendida_en, creada_en`;
      const academia = aResumen(this.exigirFila(filas));
      await this.auditoria.registrarEnPlataforma(tx, {
        actorTipo: 'SUPERADMIN',
        actorId: actor.id,
        accion: 'ACADEMIA_SUSPENDIDA',
        entidad: 'academia',
        entidadId: academia.id,
        datosAntes: { estado: 'ACTIVA' },
        datosDespues: { estado: 'SUSPENDIDA' },
        motivo,
        ip,
      });
      return academia;
    });
  }

  /** Reactiva una academia suspendida. El motivo es opcional. */
  reactivar(
    id: string,
    motivo: string | undefined,
    actor: SuperadminAutenticado,
    ip: string | null,
  ): Promise<AcademiaResumen> {
    return this.baseDatos.comoPlataforma(async (tx) => {
      const estado = await this.bloquearYLeerEstado(tx, id);
      if (estado === 'ACTIVA') {
        throw new ErrorNegocio(409, 'ACADEMIA_YA_ACTIVA', 'La academia ya está activa.');
      }
      const ahora = this.reloj.ahora();
      const filas = await tx.cliente.$queryRaw<FilaAcademia[]>`
        UPDATE academias
           SET estado = 'ACTIVA'::estado_academia, motivo_suspension = NULL, suspendida_en = NULL,
               actualizada_en = ${ahora}::timestamptz
         WHERE id = ${id}::uuid
        RETURNING id::text AS id, nombre, nombre_corto, estado::text AS estado, motivo_suspension,
                  suspendida_en, creada_en`;
      const academia = aResumen(this.exigirFila(filas));
      await this.auditoria.registrarEnPlataforma(tx, {
        actorTipo: 'SUPERADMIN',
        actorId: actor.id,
        accion: 'ACADEMIA_REACTIVADA',
        entidad: 'academia',
        entidadId: academia.id,
        datosAntes: { estado: 'SUSPENDIDA' },
        datosDespues: { estado: 'ACTIVA' },
        motivo: motivo ?? null,
        ip,
      });
      return academia;
    });
  }

  /**
   * Bloquea la fila de la academia hasta el final de la transacción y devuelve su estado. Quien llega segundo espera y
   * ve el estado ya cambiado (409), así que no hay doble cambio ni doble auditoría. 404 si no existe.
   */
  private async bloquearYLeerEstado(tx: TransaccionPlataforma, id: string): Promise<'ACTIVA' | 'SUSPENDIDA'> {
    const filas = await tx.cliente.$queryRaw<{ estado: 'ACTIVA' | 'SUSPENDIDA' }[]>`
      SELECT estado::text AS estado FROM academias WHERE id = ${id}::uuid FOR UPDATE`;
    const fila = filas[0];
    if (!fila) throw new NotFoundException();
    return fila.estado;
  }

  private exigirFila(filas: FilaAcademia[]): FilaAcademia {
    const fila = filas[0];
    if (!fila) throw new Error('La academia bloqueada no devolvió fila al actualizarla.');
    return fila;
  }
}
