import { z } from 'zod';
import type { ClienteTransaccion } from '../infraestructura/prisma';
import { insertarEnAuditoriaPlataforma } from '../modulos/auditoria/insercion';
import { leerVariable } from './conexion';

const CORREO_MAXIMO = 254;
const NOMBRE_MINIMO = 3;
const NOMBRE_MAXIMO = 100;
const CLAVE_MINIMA = 12;
const CLAVE_MAXIMA = 128;
const VISIBLES_MINIMOS = 3;

/**
 * Reglas de texto de `packages/contratos/src/texto.ts` (criterios 76 y 77), repetidas aquí por la misma razón que el
 * correo: el comando y la semilla deben funcionar en un clon recién instalado, antes de compilar `packages/contratos`.
 * `superadmin-datos.test.ts` comprueba que dan el mismo resultado que los esquemas compartidos.
 */
const CONTROLES_O_SUSTITUTOS = /[\p{Cc}\p{Cs}]/u;
const BIDI_O_SEPARADORES = /[\p{Bidi_Control}\u2028\u2029]/u;
const VISIBLES = /[\p{L}\p{N}\p{P}\p{S}]/gu;

/**
 * Mismo criterio que el correo de `iniciarSesionPlataformaSchema` (contratos): recortado, en minúsculas, de hasta 254
 * caracteres y con formato de correo. Se repite aquí, y no se importa, para que el comando y la semilla funcionen en un
 * clon recién instalado, antes de compilar `packages/contratos`.
 */
const correoSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(CORREO_MAXIMO)
  .refine((valor) => !CONTROLES_O_SUSTITUTOS.test(valor))
  .pipe(z.email());

export interface DatosSuperadmin {
  readonly correo: string;
  readonly nombre: string;
  readonly clave: string;
}

export type LecturaDatosSuperadmin =
  | { readonly ok: true; readonly datos: DatosSuperadmin }
  | { readonly ok: false; readonly problemas: readonly string[] };

/** `true` si las tres variables `SUPERADMIN_*` están definidas (la semilla solo actúa entonces). */
export function hayDatosDeSuperadmin(env: Readonly<Record<string, string | undefined>>): boolean {
  return ['SUPERADMIN_CORREO', 'SUPERADMIN_NOMBRE', 'SUPERADMIN_CLAVE'].every(
    (nombre) => leerVariable(env, nombre) !== undefined,
  );
}

/**
 * Valida `SUPERADMIN_CORREO` (correo de hasta 254 caracteres, recortado y en minúsculas), `SUPERADMIN_NOMBRE` (3 a 100
 * caracteres, al menos 3 visibles, sin control bidireccional ni separadores de línea; criterio 77) y `SUPERADMIN_CLAVE`
 * (12 a 128 caracteres). Ninguna admite caracteres de control (criterio 76; la clave no se recorta, así que un control
 * en cualquier posición es error). Los problemas nombran la variable y nunca incluyen su valor.
 */
export function leerDatosSuperadmin(env: Readonly<Record<string, string | undefined>>): LecturaDatosSuperadmin {
  const problemas: string[] = [];

  const correoCrudo = leerVariable(env, 'SUPERADMIN_CORREO');
  let correo = '';
  if (correoCrudo === undefined) {
    problemas.push('Falta la variable SUPERADMIN_CORREO.');
  } else {
    const analisis = correoSchema.safeParse(correoCrudo);
    if (analisis.success) correo = analisis.data;
    else
      problemas.push(
        `La variable SUPERADMIN_CORREO debe ser un correo válido de hasta ${CORREO_MAXIMO} caracteres, sin caracteres de control.`,
      );
  }

  const nombreCrudo = leerVariable(env, 'SUPERADMIN_NOMBRE');
  let nombre = '';
  if (nombreCrudo === undefined) {
    problemas.push('Falta la variable SUPERADMIN_NOMBRE.');
  } else {
    nombre = nombreCrudo.trim();
    if (nombre.length < NOMBRE_MINIMO || nombre.length > NOMBRE_MAXIMO) {
      problemas.push(`La variable SUPERADMIN_NOMBRE debe tener de ${NOMBRE_MINIMO} a ${NOMBRE_MAXIMO} caracteres.`);
    } else if (CONTROLES_O_SUSTITUTOS.test(nombre)) {
      problemas.push('La variable SUPERADMIN_NOMBRE no puede contener caracteres de control ni caracteres no válidos.');
    } else if (BIDI_O_SEPARADORES.test(nombre)) {
      problemas.push(
        'La variable SUPERADMIN_NOMBRE no puede contener caracteres de dirección del texto ni separadores de línea.',
      );
    } else if ((nombre.match(VISIBLES) ?? []).length < VISIBLES_MINIMOS) {
      problemas.push(
        `La variable SUPERADMIN_NOMBRE debe tener al menos ${VISIBLES_MINIMOS} caracteres visibles (letras, números o símbolos).`,
      );
    }
  }

  const clave = env['SUPERADMIN_CLAVE'] ?? '';
  if (clave === '') {
    problemas.push('Falta la variable SUPERADMIN_CLAVE.');
  } else if (clave.length < CLAVE_MINIMA || clave.length > CLAVE_MAXIMA) {
    problemas.push(`La variable SUPERADMIN_CLAVE debe tener de ${CLAVE_MINIMA} a ${CLAVE_MAXIMA} caracteres.`);
  } else if (CONTROLES_O_SUSTITUTOS.test(clave)) {
    problemas.push('La variable SUPERADMIN_CLAVE no puede contener caracteres de control.');
  }

  return problemas.length > 0 ? { ok: false, problemas } : { ok: true, datos: { correo, nombre, clave } };
}

export type ResultadoSuperadmin = 'CREADO' | 'RESTABLECIDO' | 'YA_EXISTIA';

/**
 * Crea el superadmin o, si ya existe uno con ese correo, restablece su contraseña. Debe correr en una transacción de
 * plataforma (`enPlataforma`). Registra `SUPERADMIN_CREADO` o `SUPERADMIN_CLAVE_RESTABLECIDA` con actor `SISTEMA`;
 * la auditoría nunca incluye la contraseña ni su hash.
 *
 * - Al restablecer: reemplaza el hash y el nombre, pone los intentos fallidos en 0, quita el bloqueo y sube
 *   `version_token`, así que las sesiones abiertas dejan de valer.
 * - Con `restablecer: false` (la semilla), un superadmin existente no se toca.
 */
export async function guardarSuperadmin(
  tx: ClienteTransaccion,
  datos: Pick<DatosSuperadmin, 'correo' | 'nombre'>,
  claveHash: string,
  ahora: Date,
  opciones: { restablecer: boolean },
): Promise<ResultadoSuperadmin> {
  const creadas = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO superadmins (id, correo, nombre, clave_hash, version_token, intentos_fallidos, creado_en, actualizado_en)
    VALUES (gen_random_uuid(), ${datos.correo}, ${datos.nombre}, ${claveHash}, 0, 0,
            ${ahora}::timestamptz, ${ahora}::timestamptz)
    ON CONFLICT (correo) DO NOTHING
    RETURNING id::text AS id`;
  const creada = creadas[0];
  if (creada) {
    await auditar(tx, ahora, 'SUPERADMIN_CREADO', creada.id, datos);
    return 'CREADO';
  }
  if (!opciones.restablecer) return 'YA_EXISTIA';

  const restablecidas = await tx.$queryRaw<{ id: string }[]>`
    UPDATE superadmins
       SET clave_hash = ${claveHash}, nombre = ${datos.nombre}, intentos_fallidos = 0, bloqueado_hasta = NULL,
           version_token = version_token + 1, actualizado_en = ${ahora}::timestamptz
     WHERE correo = ${datos.correo}
    RETURNING id::text AS id`;
  const restablecida = restablecidas[0];
  if (!restablecida)
    throw new Error('No se pudo restablecer el superadmin: el correo desapareció durante la operación.');
  await auditar(tx, ahora, 'SUPERADMIN_CLAVE_RESTABLECIDA', restablecida.id, datos);
  return 'RESTABLECIDO';
}

function auditar(
  tx: ClienteTransaccion,
  ahora: Date,
  accion: string,
  id: string,
  datos: Pick<DatosSuperadmin, 'correo' | 'nombre'>,
): Promise<void> {
  return insertarEnAuditoriaPlataforma(tx, ahora, {
    actorTipo: 'SISTEMA',
    actorId: null,
    accion,
    entidad: 'superadmin',
    entidadId: id,
    // Solo los campos permitidos: nunca el hash ni la contraseña.
    datosDespues: { id, correo: datos.correo, nombre: datos.nombre },
  });
}
