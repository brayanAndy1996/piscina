import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  ErrorAcademiaNoEncontrada,
  ErrorAcademiaSuspendida,
  ErrorRolBaseDatosInseguro,
  MENSAJE_ROL_INSEGURO,
} from './errores';
import { PrismaService } from './prisma.service';
import type {
  AcademiaResuelta,
  ClienteTransaccion,
  OpcionesTransaccion,
  TransaccionAcademia,
  TransaccionPlataforma,
} from './tipos';

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tiempo máximo para obtener una conexión del pool y para que termine una transacción, en milisegundos. */
const ESPERA_CONEXION_MS = 10_000;
const DURACION_MAXIMA_MS = 15_000;

interface FilaRol {
  rolsuper: boolean;
  rolbypassrls: boolean;
  es_miembro: boolean;
  es_dueno: boolean;
}

interface FilaAcademia {
  id: string;
  nombre: string;
  nombre_corto: string;
  estado: 'ACTIVA' | 'SUSPENDIDA';
}

/**
 * El único camino de la API a la base de datos (D-23, spec 001). Cada operación corre en una transacción en la que
 * se fija el contexto con `set_config(..., true)` (local a la transacción: no se filtra a otra operación por el pool)
 * y PostgreSQL aplica la seguridad a nivel de fila (RLS) al rol `aquagestion_app`.
 *
 * Los módulos nunca importan el cliente de Prisma ni `PrismaService` (lo exige ESLint): reciben `tx.cliente` dentro
 * de `trabajo`. Cuándo usar cada método:
 *
 * - Petición con sesión de una academia (002 en adelante): la academia sale de la sesión, nunca del cuerpo ni de la
 *   dirección, y se llama a `conAcademia(sesion.academiaId, ...)`.
 * - Página pública `/a/{nombreCorto}` (005): `resolverAcademia(nombreCorto)`; si está activa, `conAcademia(id, ...)`.
 * - Rutas de la plataforma (Superadmin): `comoPlataforma(...)`, que solo ve las tablas de la plataforma.
 * - Tarea programada: `comoPlataforma` para listar las academias activas y un `conAcademia` por cada una; nunca una
 *   sola transacción para todas.
 *
 * Seguridad: antes de la primera operación se comprueba que el rol de `DATABASE_URL_APP` no sea superusuario, no
 * tenga BYPASSRLS, no sea dueño de tablas ni miembro de otro rol; si lo es, todas las operaciones rechazan con
 * `ErrorRolBaseDatosInseguro` sin ejecutar el trabajo. La comprobación no se hace al arrancar para que la API arranque
 * con la base caída.
 */
@Injectable()
export class BaseDatos {
  private verificacion: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registro: PinoLogger,
  ) {
    this.registro.setContext(BaseDatos.name);
  }

  /**
   * Ejecuta `trabajo` en una transacción de la academia: `app.academia_id` es `academiaId` y `app.plataforma` no es
   * `si`. Rechaza con `ErrorAcademiaNoEncontrada` si el id no es un UUID o la academia no existe, y con
   * `ErrorAcademiaSuspendida` si está suspendida; en ambos casos sin ejecutar `trabajo`. Si `trabajo` lanza un error,
   * se revierte todo y se relanza el mismo error.
   */
  async conAcademia<T>(
    academiaId: string,
    trabajo: (tx: TransaccionAcademia) => Promise<T>,
    opciones: OpcionesTransaccion = {},
  ): Promise<T> {
    if (typeof academiaId !== 'string' || !PATRON_UUID.test(academiaId)) throw new ErrorAcademiaNoEncontrada();
    const id = academiaId.toLowerCase();
    await this.verificarRol();
    return this.transaccion(opciones, async (cliente) => {
      await this.fijarContexto(cliente, { academiaId: id, plataforma: false });
      // RLS deja ver solo la fila de la propia academia.
      const filas = await cliente.$queryRaw<{ estado: string }[]>`
        SELECT estado::text AS estado FROM academias WHERE id = ${id}::uuid`;
      const academia = filas[0];
      if (!academia) throw new ErrorAcademiaNoEncontrada();
      if (academia.estado === 'SUSPENDIDA') throw new ErrorAcademiaSuspendida();
      return trabajo({ academiaId: id, cliente });
    });
  }

  /**
   * Ejecuta `trabajo` en una transacción de la plataforma: `app.plataforma` es `si` y no hay academia. Solo se ven y
   * escriben las tablas de la plataforma (academias, superadmins, auditoría de la plataforma), nunca datos internos de
   * una academia (D-29).
   */
  async comoPlataforma<T>(
    trabajo: (tx: TransaccionPlataforma) => Promise<T>,
    opciones: OpcionesTransaccion = {},
  ): Promise<T> {
    await this.verificarRol();
    return this.transaccion(opciones, async (cliente) => {
      await this.fijarContexto(cliente, { academiaId: '', plataforma: true });
      return trabajo({ cliente });
    });
  }

  /**
   * Busca una academia por su nombre corto, sin contexto, con la función `resolver_academia` (igualdad exacta). Devuelve
   * también las suspendidas, o `null` si no existe. La normalización y el formato del nombre los valida quien llama.
   */
  async resolverAcademia(nombreCorto: string): Promise<AcademiaResuelta | null> {
    await this.verificarRol();
    const filas = await this.prisma.$transaction(
      async (cliente) => {
        // Sin contexto: los dos valores en vacío, aunque la conexión traiga otros (criterio 72).
        await this.fijarContexto(cliente, { academiaId: '', plataforma: false });
        return cliente.$queryRaw<FilaAcademia[]>`
          SELECT id::text AS id, nombre, nombre_corto, estado FROM resolver_academia(${nombreCorto})`;
      },
      { maxWait: ESPERA_CONEXION_MS, timeout: DURACION_MAXIMA_MS },
    );
    const fila = filas[0];
    if (!fila) return null;
    return { id: fila.id, nombre: fila.nombre, nombreCorto: fila.nombre_corto, estado: fila.estado };
  }

  /** `SELECT 1`, para la salud de la API. No comprueba el rol: `GET /api/salud` conserva su contrato. */
  async comprobarConexion(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  /**
   * Primera sentencia de toda transacción: fija **los dos** valores de contexto con `set_config(..., true)` (locales a
   * la transacción), sin importar lo que traiga la conexión del pool: valores de sesión de un módulo, `options` de la
   * URL o valores por defecto del rol o de la base (criterio 72). Una sola sentencia, para no gastar un viaje extra.
   * Sin academia, `academiaId` va vacío; sin plataforma, `app.plataforma` va vacío.
   */
  private async fijarContexto(
    cliente: ClienteTransaccion,
    contexto: { readonly academiaId: string; readonly plataforma: boolean },
  ): Promise<void> {
    const plataforma = contexto.plataforma ? 'si' : '';
    await cliente.$queryRaw`
      SELECT set_config('app.plataforma', ${plataforma}, true), set_config('app.academia_id', ${contexto.academiaId}, true)`;
  }

  private transaccion<T>(
    opciones: OpcionesTransaccion,
    trabajo: (cliente: ClienteTransaccion) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(trabajo, {
      isolationLevel: opciones.aislamiento,
      maxWait: ESPERA_CONEXION_MS,
      timeout: DURACION_MAXIMA_MS,
    });
  }

  /**
   * Comprueba, una sola vez por proceso, que el rol de la conexión es seguro. Un rechazo por rol inseguro se guarda
   * (el rol no cambia mientras corre la API); un fallo de conexión no, para reintentar en la siguiente operación.
   */
  private verificarRol(): Promise<void> {
    this.verificacion ??= this.comprobarRol().catch((error: unknown) => {
      if (!(error instanceof ErrorRolBaseDatosInseguro)) this.verificacion = undefined;
      throw error;
    });
    return this.verificacion;
  }

  private async comprobarRol(): Promise<void> {
    const filas = await this.prisma.$queryRaw<FilaRol[]>`
      SELECT r.rolsuper, r.rolbypassrls,
             EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS es_miembro,
             (EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'public' AND c.relowner = r.oid)
              OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'public' AND p.proowner = r.oid)) AS es_dueno
        FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`;
    const rol = filas[0];
    if (!rol || rol.rolsuper || rol.rolbypassrls || rol.es_miembro || rol.es_dueno) {
      // El mensaje nombra la variable y nunca incluye la URL ni la contraseña.
      this.registro.error(MENSAJE_ROL_INSEGURO);
      throw new ErrorRolBaseDatosInseguro();
    }
  }
}
