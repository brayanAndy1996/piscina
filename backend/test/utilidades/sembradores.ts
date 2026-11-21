// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomBytes, randomUUID } from 'node:crypto';
import { ejecutarComo } from './base-datos';
import { crearAlumnoSolo, filaValida, insertarFila, sembrarSolicitud } from './inscripciones';
import { insertarClase, insertarPlan } from './planes-clases';

/**
 * Sembradores por tabla de academia (criterio 133, precision P-33). La prueba de ejecucion de `rls-todas-las-tablas.test.ts`
 * descubre en el catalogo TODA tabla con `academia_id` y exige un sembrador en `SEMBRADORES_POR_TABLA`; si falta, falla nombrando la
 * tabla (como la lista del criterio 10).
 *
 * Un sembrador inserta al menos una fila de esa academia, corre como dueno con el contexto de esa academia (sirve con un dueno
 * superusuario o no: con `FORCE ROW LEVEL SECURITY` el dueno tambien pasa por las politicas) y crea, si las necesita, las filas padre
 * de la MISMA academia. Para una tabla particionada o una particion sirve el sembrador de la tabla padre (la fila cae en la
 * particion). Clave del registro: `'esquema.tabla'`.
 *
 * Cada historia que agregue una tabla con `academia_id` agrega aqui su sembrador, en sus pruebas protegidas.
 */
export type Sembrador = (academiaId: string) => Promise<void>;

/** Una clave de `configuraciones` que cumple el CHECK (`^[a-z][a-z0-9_]{0,63}$`) y no se repite. */
const claveAleatoria = (): string => `sembrada_${randomBytes(8).toString('hex')}`;

/**
 * Historia 005: un plan y una clase inactiva de la academia (la inactiva no entra en los índices únicos del bloque, así que ninguna
 * llamada choca con otra) y un cliente con su solicitud, su matrícula, sus clases y sus consentimientos. Cada llamada crea todo nuevo.
 */
async function sembrarClienteConSolicitud(academiaId: string) {
  const entrenadorId = randomUUID();
  const dni = String(10_000_000 + (randomBytes(4).readUInt32BE(0) % 89_999_999));
  await ejecutarComo(
    'propietario',
    `INSERT INTO public.usuarios (id, academia_id, dni, nombres, apellidos, rol, clave_hash, creado_en, actualizado_en)
     VALUES ($1::uuid, $2::uuid, $3, 'Entrenador', 'Sembrado', 'ENTRENADOR', 'no-es-un-hash-real', now(), now())`,
    [entrenadorId, academiaId, dni],
    { academiaId },
  );
  const planId = await insertarPlan('propietario', academiaId, {
    nombre: `sembrado_${randomBytes(8).toString('hex')}`,
  });
  const claseId = await insertarClase('propietario', academiaId, entrenadorId, { activo: false });
  return sembrarSolicitud(academiaId, { planId, claseIds: [claseId], conApoderado: true });
}

export const SEMBRADORES_POR_TABLA: Readonly<Record<string, Sembrador>> = {
  // hoy: 'public.auditoria', 'public.configuraciones', (historia 002) 'public.usuarios', (historia 004) 'public.planes' y 'public.clases' y
  // (historia 005) las siete tablas de la inscripción.
  'public.auditoria': async (academiaId) => {
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.auditoria (id, academia_id, fecha_hora, actor_tipo, accion, entidad)
       VALUES ($1::uuid, $2::uuid, now(), 'SISTEMA', 'SEMBRADA_PARA_RLS', 'prueba')`,
      [randomUUID(), academiaId],
      { academiaId },
    );
  },
  'public.configuraciones': async (academiaId) => {
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.configuraciones (academia_id, clave, valor, actualizado_en)
       VALUES ($1::uuid, $2, '{}'::jsonb, now())`,
      [academiaId, claveAleatoria()],
      { academiaId },
    );
  },
  // Historia 002 (criterio 1: las pruebas de catalogo de la 001 siguen pasando con la tabla nueva). Cada llamada crea un usuario
  // nuevo de la misma academia, con un DNI distinto de 8 digitos.
  'public.usuarios': async (academiaId) => {
    const dni = String(10_000_000 + (randomBytes(4).readUInt32BE(0) % 89_999_999));
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.usuarios (id, academia_id, dni, nombres, apellidos, rol, clave_hash, creado_en, actualizado_en)
       VALUES ($1::uuid, $2::uuid, $3, 'Sembrado', 'Para RLS', 'ALUMNO', 'no-es-un-hash-real', now(), now())`,
      [randomUUID(), academiaId, dni],
      { academiaId },
    );
  },
  // Historia 004 (criterio 1: las pruebas de catalogo de la 001 siguen pasando con las tablas nuevas). Cada llamada crea un plan nuevo
  // con un nombre distinto (el indice unico es sobre `lower(nombre)` de la academia).
  'public.planes': async (academiaId) => {
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.planes (id, academia_id, nombre, veces_por_semana, clases_por_mes, precio, dias_permitidos,
                                 franjas_permitidas, niveles_aplicables, creado_en, actualizado_en)
       VALUES ($1::uuid, $2::uuid, $3, 1, 4, 40.00, ARRAY[1]::smallint[], ARRAY['08:00']::time(0)[],
               ARRAY['BASICO']::nivel_natacion[], now(), now())`,
      [randomUUID(), academiaId, `sembrado_${randomBytes(8).toString('hex')}`],
      { academiaId },
    );
  },
  // Historia 004. Cada llamada crea un entrenador nuevo de la misma academia (la llave foranea compuesta lo exige, con un DNI distinto de
  // 8 digitos) y una clase inactiva suya: una clase inactiva no entra en los indices unicos parciales del bloque, asi que ninguna llamada
  // choca con otra aunque caiga en el mismo dia, hora y nivel.
  'public.clases': async (academiaId) => {
    const entrenadorId = randomUUID();
    const dni = String(10_000_000 + (randomBytes(4).readUInt32BE(0) % 89_999_999));
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.usuarios (id, academia_id, dni, nombres, apellidos, rol, clave_hash, creado_en, actualizado_en)
       VALUES ($1::uuid, $2::uuid, $3, 'Entrenador', 'Sembrado', 'ENTRENADOR', 'no-es-un-hash-real', now(), now())`,
      [entrenadorId, academiaId, dni],
      { academiaId },
    );
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.clases (id, academia_id, nivel, dia_semana, hora_inicio, hora_fin, entrenador_id, aforo, activo,
                                  creado_en, actualizado_en)
       VALUES ($1::uuid, $2::uuid, 'BASICO', 1, '08:00', '09:00', $3::uuid, 30, false, now(), now())`,
      [randomUUID(), academiaId, entrenadorId],
      { academiaId },
    );
  },
  // Historia 005 (criterio 1: las pruebas de catálogo de la 001 siguen pasando con las siete tablas nuevas).
  'public.alumnos': async (academiaId) => {
    await crearAlumnoSolo(academiaId);
  },
  'public.apoderados': async (academiaId) => {
    const alumnoId = await crearAlumnoSolo(academiaId);
    await insertarFila('propietario', 'apoderados', academiaId, await filaValida('apoderados', { alumnoId }));
  },
  'public.fichas_medicas': async (academiaId) => {
    const alumnoId = await crearAlumnoSolo(academiaId);
    await insertarFila('propietario', 'fichas_medicas', academiaId, await filaValida('fichas_medicas', { alumnoId }));
  },
  'public.consentimientos': async (academiaId) => {
    await sembrarClienteConSolicitud(academiaId);
  },
  'public.solicitudes_inscripcion': async (academiaId) => {
    await sembrarClienteConSolicitud(academiaId);
  },
  'public.matriculas': async (academiaId) => {
    await sembrarClienteConSolicitud(academiaId);
  },
  'public.matricula_clases': async (academiaId) => {
    await sembrarClienteConSolicitud(academiaId);
  },
};
