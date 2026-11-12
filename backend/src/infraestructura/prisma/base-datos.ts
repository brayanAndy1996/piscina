import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PinoLogger } from 'nestjs-pino';
import { PrismaClient, type Prisma } from '../../generated/prisma/client';
import { ENTORNO, type Entorno } from '../entorno';
import { cerrarCursores } from './cursores';
import { envolver } from './envoltorio';
import {
  ErrorAcademiaNoEncontrada,
  ErrorAcademiaSuspendida,
  ErrorRolBaseDatosInseguro,
  ErrorTransaccionAbortada,
  MENSAJE_ROL_INSEGURO,
} from './errores';
import { codigoDeErrorDeBase } from './errores-base';
import { privilegiosDeMasEnEsquemas, type PrivilegioEnEsquema } from './privilegios-app';
import {
  problemasDeConfiguracion,
  problemasDeEsquemas,
  problemasDelRol,
  type FilaConfiguracionRol,
  type FilaEsquemas,
  type FilaRol,
} from './rol-seguro';
import { comprobarTransaccionViva } from './transaccion-viva';
import type {
  AcademiaResuelta,
  ClienteTransaccion,
  OpcionesTransaccion,
  TransaccionAcademia,
  TransaccionPlataforma,
} from './tipos';

/** Un esquema que hace inseguro al rol (solo para el registro técnico). */
interface FilaEsquemaAfectado {
  esquema: string;
  propio: boolean;
  crea: boolean;
  su_nombre: boolean;
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tiempo máximo para obtener una conexión del pool y para que termine una transacción, en milisegundos. */
const ESPERA_CONEXION_MS = 10_000;
const DURACION_MAXIMA_MS = 15_000;

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
 * Los módulos nunca importan el cliente de Prisma (lo exige ESLint): reciben `tx.cliente` dentro
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
 * tenga BYPASSRLS, REPLICATION, CREATEROLE ni CREATEDB, no sea miembro de otro rol (ni dueño de la base), no pueda
 * crear en la base ni en `public`, no tenga TEMPORARY y no sea dueño de objetos de `public` (`problemasDelRol`), no tenga
 * valores por defecto propios (`problemasDeConfiguracion`) ni privilegios de más en ningún esquema (`privilegiosDeMasEnEsquemas`, criterio 130); si
 * algo de eso se cumple, todas las operaciones rechazan con `ErrorRolBaseDatosInseguro` sin ejecutar el trabajo. La
 * comprobación no se hace al arrancar para que la API arranque con la base caída.
 *
 * El cliente de Prisma vive en un campo privado real (`#prisma`) y no es un proveedor de Nest; `trabajo` recibe un
 * envoltorio con solo `$queryRaw`, `$executeRaw` y los modelos (criterio 100). Los métodos que usan el cliente sin envoltorio
 * son privados reales (`#…`) y el prototipo está congelado al final del archivo.
 */
@Injectable()
export class BaseDatos implements OnModuleDestroy {
  /**
   * El cliente vive en un campo privado real de JavaScript (`#prisma`), no en una propiedad con `private` de
   * TypeScript: en tiempo de ejecución no se puede alcanzar desde fuera de la clase (criterios 86 y 100). Se crea aquí y no en
   * un proveedor de Nest: ningún token del contenedor lleva a él. La conexión es perezosa (no se conecta al arrancar), así la
   * API arranca con la base caída y se recupera sola cuando vuelve (spec 000, criterio 8).
   */
  readonly #prisma: PrismaClient;
  #verificacion: Promise<void> | undefined;

  constructor(
    @Inject(ENTORNO) entorno: Entorno,
    private readonly registro: PinoLogger,
  ) {
    this.#prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: entorno.DATABASE_URL_APP, max: entorno.DATABASE_POOL_MAX }),
    });
    this.registro.setContext(BaseDatos.name);
  }

  async onModuleDestroy(): Promise<void> {
    await this.#prisma.$disconnect();
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
    await this.#verificarRol();
    return this.#transaccion(opciones, { academiaId: id, plataforma: false }, async (cliente) => {
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
    await this.#verificarRol();
    return this.#transaccion(opciones, { academiaId: '', plataforma: true }, (cliente) => trabajo({ cliente }));
  }

  /**
   * Busca una academia por su nombre corto, sin contexto, con la función `resolver_academia` (igualdad exacta). Devuelve
   * también las suspendidas, o `null` si no existe. La normalización y el formato del nombre los valida quien llama.
   */
  async resolverAcademia(nombreCorto: string): Promise<AcademiaResuelta | null> {
    await this.#verificarRol();
    // Sin contexto: los dos valores en vacío, aunque la conexión traiga otros (criterio 72).
    const filas = await this.#transaccion(
      {},
      { academiaId: '', plataforma: false },
      (cliente) =>
        cliente.$queryRaw<FilaAcademia[]>`
        SELECT id::text AS id, nombre, nombre_corto, estado FROM resolver_academia(${nombreCorto})`,
    );
    const fila = filas[0];
    if (!fila) return null;
    return { id: fila.id, nombre: fila.nombre, nombreCorto: fila.nombre_corto, estado: fila.estado };
  }

  /** `SELECT 1`, para la salud de la API. No comprueba el rol: `GET /api/salud` conserva su contrato. */
  async comprobarConexion(): Promise<void> {
    await this.#prisma.$queryRaw`SELECT 1`;
  }

  /**
   * Primera sentencia de toda transacción: fija **los dos** valores de contexto con `set_config(..., true)` (locales a
   * la transacción), el `search_path` en `pg_catalog, public, pg_temp` y `standard_conforming_strings` en `on` (criterios 121 y
   * 122), la zona horaria en `UTC` y los parámetros de formato que el adaptador de Prisma interpreta
   * (`DateStyle`, `IntervalStyle`, `extra_float_digits` y `bytea_output`), `client_encoding` en `UTF8` (criterio 146), y
   * `synchronous_commit` en `on`, `array_nulls` en `on` y `transform_null_equals` en `off` (criterio 147), y la marca aleatoria de la
   * transacción en `app.transaccion` (criterios 149 a 151: al final se comprueba que sigue abierta la misma), sin importar lo que traiga la conexión del pool:
   * valores de sesión de un módulo, `options` de la URL o valores por defecto del rol, de la base o del servidor (criterios 72,
   * 98, 107, 121 y 122). Cada función va calificada con `pg_catalog.`: PostgreSQL la resuelve con el `search_path` que trae la
   * conexión, antes de fijarlo, y un esquema del atacante antes de `pg_catalog` podría tapar `set_config`. Una sola sentencia,
   * sin barras invertidas, para no gastar un viaje extra. Sin academia, `academiaId` va vacío; sin plataforma, `app.plataforma` va vacío. Después cierra
   * todo cursor que haya sobrevivido (`CLOSE ALL`, criterio 101): se ejecuta aparte porque `CLOSE` no se puede combinar con
   * un `SELECT` en el protocolo extendido.
   */
  async #fijarContexto(
    tx: Prisma.TransactionClient,
    contexto: { readonly academiaId: string; readonly plataforma: boolean; readonly marca: string },
  ): Promise<void> {
    const plataforma = contexto.plataforma ? 'si' : '';
    await tx.$queryRaw`
      SELECT pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true),
             pg_catalog.set_config('standard_conforming_strings', 'on', true),
             pg_catalog.set_config('app.plataforma', ${plataforma}, true),
             pg_catalog.set_config('app.academia_id', ${contexto.academiaId}, true),
             pg_catalog.set_config('TimeZone', 'UTC', true), pg_catalog.set_config('DateStyle', 'ISO, MDY', true),
             pg_catalog.set_config('IntervalStyle', 'postgres', true), pg_catalog.set_config('extra_float_digits', '1', true),
             pg_catalog.set_config('bytea_output', 'hex', true), pg_catalog.set_config('client_encoding', 'UTF8', true),
             pg_catalog.set_config('synchronous_commit', 'on', true), pg_catalog.set_config('array_nulls', 'on', true),
             pg_catalog.set_config('transform_null_equals', 'off', true),
             pg_catalog.set_config('app.transaccion', ${contexto.marca}, true)`;
    await cerrarCursores(tx);
  }

  /**
   * Abre la transacción, fija el contexto y entrega a `trabajo` el envoltorio (nunca el cliente de la transacción). Al
   * terminar `trabajo`, con éxito o con error, el envoltorio deja de aceptar llamadas (criterio 106).
   */
  #transaccion<T>(
    opciones: OpcionesTransaccion,
    contexto: { readonly academiaId: string; readonly plataforma: boolean },
    trabajo: (cliente: ClienteTransaccion) => Promise<T>,
  ): Promise<T> {
    return this.#prisma.$transaction(
      async (tx) => {
        const marca = randomUUID();
        await this.#fijarContexto(tx, { ...contexto, marca });
        const { cliente, terminar, ejecutar, asentar, descartar, exigirCompleta } = envolver(tx);
        let resultado: T;
        try {
          // Criterio 134: `trabajo` corre en el contexto asíncrono de esta transacción; el envoltorio no responde en otro.
          resultado = await ejecutar(() => trabajo(cliente));
        } catch (error) {
          // Criterio 153: las consultas que seguían en la cola no se entregan a Prisma; el error de `trabajo` sale tal cual.
          descartar();
          throw error;
        } finally {
          terminar();
        }
        // Criterios 149 a 151: solo en el camino bueno (si `trabajo` lanza, ese error sale tal cual, criterio 22). Primero se
        // esperan las consultas que `trabajo` envió sin `await`; luego se comprueba que la transacción sigue viva y es la misma
        // y, antes del `COMMIT` de Prisma, se rechaza si no lo es: un `COMMIT` sobre una transacción abortada solo responde
        // `ROLLBACK`, sin error.
        await asentar();
        try {
          // Criterio 154: una operación que volvió con `undefined` marcó la transacción aunque `trabajo` atrapara el rechazo.
          exigirCompleta();
          await comprobarTransaccionViva(tx, marca);
        } catch (error) {
          if (error instanceof ErrorTransaccionAbortada) this.#registrarAbortada(error);
          throw error;
        }
        return resultado;
      },
      {
        isolationLevel: opciones.aislamiento,
        maxWait: ESPERA_CONEXION_MS,
        timeout: DURACION_MAXIMA_MS,
      },
    );
  }

  /**
   * Registro técnico del criterio 149: un mensaje fijo y, si se conoce, el SQLSTATE. Nunca el mensaje del error de Prisma (puede
   * llevar valores de los parámetros), ni los parámetros, ni la URL.
   */
  #registrarAbortada(error: ErrorTransaccionAbortada): void {
    if (error.motivo === 'incompleta') {
      // La causa es solo "Operación sin resultado: <nombre>": nunca argumentos ni parámetros.
      const operacion = error.cause instanceof Error ? ` ${error.cause.message}.` : '';
      this.registro.warn(`${error.mensaje}${operacion}`);
      return;
    }
    const sqlstate = codigoDeErrorDeBase(error.cause);
    this.registro.warn(`${error.mensaje}${sqlstate === null ? '' : ` SQLSTATE: ${sqlstate}.`}`);
  }

  /**
   * Comprueba, una sola vez por proceso, que el rol de la conexión es seguro. Un rechazo por rol inseguro se guarda
   * (el rol no cambia mientras corre la API); un fallo de conexión no, para reintentar en la siguiente operación.
   */
  #verificarRol(): Promise<void> {
    this.#verificacion ??= this.#comprobarRol().catch((error: unknown) => {
      if (!(error instanceof ErrorRolBaseDatosInseguro)) this.#verificacion = undefined;
      throw error;
    });
    return this.#verificacion;
  }

  /**
   * Las consultas corren en una sola transacción cuya primera sentencia fija el `search_path` (criterio 121), sin contexto de
   * academia ni de plataforma. Toda función y tabla del catálogo va calificada con `pg_catalog.` (también `unnest`):
   * PostgreSQL las resuelve con el `search_path` que trae la conexión, y un esquema del atacante podría tapar alguna.
   */
  async #comprobarRol(): Promise<void> {
    const { rol, configuracion, efectivos, esquemas, afectados } = await this.#prisma.$transaction(
      async (tx) => {
        await this.#fijarContexto(tx, { academiaId: '', plataforma: false, marca: randomUUID() });
        const filas = await tx.$queryRaw<FilaRol[]>`
          SELECT r.rolsuper, r.rolbypassrls, r.rolreplication, r.rolcreaterole, r.rolcreatedb,
                 EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS es_miembro,
                 pg_catalog.pg_has_role(r.oid, 'pg_database_owner', 'MEMBER') AS dueno_de_la_base,
                 pg_catalog.has_database_privilege(r.oid, pg_catalog.current_database(), 'CREATE') AS crea_en_base,
                 pg_catalog.has_database_privilege(r.oid, pg_catalog.current_database(), 'TEMPORARY') AS temporales,
                 pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE') AS crea_en_public,
                 (EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = 'public' AND c.relowner = r.oid)
                  OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                               JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.proowner = r.oid)
                  OR EXISTS (SELECT 1 FROM pg_catalog.pg_type t
                               JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                              WHERE n.nspname = 'public' AND t.typowner = r.oid)
                  OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = 'public' AND n.nspowner = r.oid))
                   AS es_dueno
            FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`;

        // Criterio 103: valores por defecto propios del rol (`rolconfig`) o del rol en alguna base (`pg_db_role_setting`).
        const configuraciones = await tx.$queryRaw<FilaConfiguracionRol[]>`
          SELECT (COALESCE(pg_catalog.cardinality(r.rolconfig), 0) > 0
                  OR EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole = r.oid)) AS tiene_configuracion
            FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`;

        // Criterios 102 y 130: privilegios efectivos (concedidos al rol o a PUBLIC) en todos los esquemas revisados, sin los objetos
        // de extensiones: de tabla y de columna (las de columna solo si no vienen de la tabla entera), de secuencia, EXECUTE de las
        // funciones de public y de los esquemas con USAGE, y USAGE de cada esquema con `conObjetosPropios`.
        const efectivos = await tx.$queryRaw<PrivilegioEnEsquema[]>`
          WITH esquemas AS (
            SELECT n.oid, n.nspname::text AS nombre
              FROM pg_catalog.pg_namespace n
             WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
               AND n.nspname !~ '^pg_(toast_)?temp_'
          ), relaciones AS (
            SELECT e.nombre AS esquema, c.oid, c.relname::text AS nombre, c.relkind
              FROM esquemas e
              JOIN pg_catalog.pg_class c ON c.relnamespace = e.oid
             WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                                WHERE d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e'
                                  AND ((d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND d.objid = c.oid)
                                       OR (c.relkind = 'c' AND d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
                                           AND d.objid = c.reltype)))
          ), funciones AS (
            SELECT e.nombre AS esquema, e.oid AS esquema_oid, p.oid, p.proname::text AS nombre,
                   pg_catalog.pg_get_function_identity_arguments(p.oid)::text AS argumentos
              FROM esquemas e
              JOIN pg_catalog.pg_proc p ON p.pronamespace = e.oid
             WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                                WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND d.objid = p.oid
                                  AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype = 'e')
          )
          SELECT r.esquema, 'tabla'::text AS tipo, r.nombre AS objeto, NULL::text AS columna, NULL::text AS argumentos,
                 p.privilegio::text AS privilegio, NULL::boolean AS "conObjetosPropios"
            FROM relaciones r
            CROSS JOIN pg_catalog.unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilegio)
           WHERE r.relkind IN ('r', 'p', 'v', 'm', 'f')
             AND pg_catalog.has_table_privilege(current_user, r.oid, p.privilegio)
          UNION ALL
          SELECT r.esquema, 'secuencia'::text, r.nombre, NULL::text, NULL::text, p.privilegio::text, NULL::boolean
            FROM relaciones r
            CROSS JOIN pg_catalog.unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p(privilegio)
           WHERE r.relkind = 'S'
             AND pg_catalog.has_sequence_privilege(current_user, r.oid, p.privilegio)
          UNION ALL
          SELECT r.esquema, 'columna'::text, r.nombre, a.attname::text, NULL::text, p.privilegio::text, NULL::boolean
            FROM relaciones r
            JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
            CROSS JOIN pg_catalog.unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(privilegio)
           WHERE r.relkind IN ('r', 'p', 'v', 'm', 'f')
             AND pg_catalog.has_column_privilege(current_user, r.oid, a.attnum, p.privilegio)
             AND NOT pg_catalog.has_table_privilege(current_user, r.oid, p.privilegio)
          UNION ALL
          SELECT f.esquema, 'funcion'::text, f.nombre, NULL::text, f.argumentos, 'EXECUTE'::text, NULL::boolean
            FROM funciones f
           WHERE (f.esquema = 'public' OR pg_catalog.has_schema_privilege(current_user, f.esquema_oid, 'USAGE'))
             AND pg_catalog.has_function_privilege(current_user, f.oid, 'EXECUTE')
          UNION ALL
          SELECT e.nombre, 'esquema'::text, NULL::text, NULL::text, NULL::text, 'USAGE'::text,
                 (EXISTS (SELECT 1 FROM relaciones r WHERE r.esquema = e.nombre AND r.relkind NOT IN ('i', 'I', 't'))
                  OR EXISTS (SELECT 1 FROM funciones f WHERE f.esquema = e.nombre)) AS "conObjetosPropios"
            FROM esquemas e
           WHERE pg_catalog.has_schema_privilege(current_user, e.oid, 'USAGE')`;

        // Criterio 123: esquemas propios, con CREATE o con el nombre del rol (el `search_path` por defecto lo buscaría antes).
        const esquemas = await tx.$queryRaw<FilaEsquemas[]>`
          SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspowner = r.oid) AS dueno_de_esquema,
                 EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                          WHERE pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')) AS crea_en_esquema,
                 EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = r.rolname) AS esquema_con_su_nombre
            FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`;
        // Solo para el registro técnico: qué esquemas causan la condición (nombres de esquemas, nunca la URL ni la contraseña).
        const afectados = await tx.$queryRaw<FilaEsquemaAfectado[]>`
          SELECT n.nspname::text AS esquema, (n.nspowner = r.oid) AS propio,
                 pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE') AS crea, (n.nspname = r.rolname) AS su_nombre
            FROM pg_catalog.pg_namespace n
           CROSS JOIN pg_catalog.pg_roles r
           WHERE r.rolname = current_user
             AND (n.nspowner = r.oid OR pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE') OR n.nspname = r.rolname)
           ORDER BY 1`;
        return { rol: filas[0], configuracion: configuraciones[0], efectivos, esquemas: esquemas[0], afectados };
      },
      { maxWait: ESPERA_CONEXION_MS, timeout: DURACION_MAXIMA_MS },
    );

    const problemas = rol ? problemasDelRol(rol) : ['el rol de la conexión no aparece en el catálogo'];
    problemas.push(
      ...(configuracion
        ? problemasDeConfiguracion(configuracion)
        : ['los valores por defecto del rol no se pudieron leer del catálogo']),
    );
    problemas.push(...privilegiosDeMasEnEsquemas(efectivos));
    problemas.push(
      ...(esquemas ? problemasDeEsquemas(esquemas) : ['los esquemas del rol no se pudieron leer del catálogo']),
    );

    if (problemas.length > 0) {
      // El mensaje nombra la variable y las condiciones; nunca incluye la URL ni la contraseña.
      const detalleEsquemas = afectados.map((fila) => {
        const motivos = [fila.propio ? 'dueño' : '', fila.crea ? 'CREATE' : '', fila.su_nombre ? 'nombre del rol' : ''];
        return `${fila.esquema} (${motivos.filter((motivo) => motivo !== '').join(', ')})`;
      });
      const esquemasTexto = detalleEsquemas.length > 0 ? ` Esquemas: ${detalleEsquemas.join('; ')}.` : '';
      this.registro.error(`${MENSAJE_ROL_INSEGURO} Condiciones: ${problemas.join('; ')}.${esquemasTexto}`);
      throw new ErrorRolBaseDatosInseguro();
    }
  }
}

// Los decoradores y los metadatos ya corrieron (`reflect-metadata` los guarda aparte, en un `WeakMap`): ningún código puede
// reemplazar ni agregar métodos de `BaseDatos` después de cargar el módulo (criterio 100).
Object.freeze(BaseDatos.prototype);
