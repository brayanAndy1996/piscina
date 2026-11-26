// spec: 001-academias-aislamiento (pruebas protegidas)
// Actualizada por la 007 (spec 007-pagos, criterios 1 y 5 y «Pruebas protegidas anteriores que amplía la 007a»): el sembrador de `movimientos_caja` crea, en la misma
// transacción, el pago `CONFIRMADO` de su ingreso (la base lo exige desde la 007) y se suma el sembrador de `public.pagos`. No se quitó ni se cambió nada más.
// Actualizada por la 009 (spec 009-asistencia, criterio 1 y «Impacto en especificaciones anteriores»): se suma el sembrador de `public.asistencias`, para que la prueba de RLS de todas las tablas (criterio 133 de la 001) la cubra. No se quitó ni se cambió nada más.
// Actualizada por la 009b (spec 009-asistencia, criterio 22): se suma el sembrador de `public.inasistencias`, para que la misma prueba de RLS de todas las tablas la cubra. No se quitó ni se cambió nada más.
import { randomBytes, randomUUID } from 'node:crypto';
import { ejecutarComo } from './base-datos';
import { ejecutarTransaccion, filaPagoValida, insertarPago, sentenciasDelPagoDeSoporte } from './pagos';
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

/** Un usuario nuevo de la academia (la caja lo necesita para `abierta_por`, `registrado_por` y `cerrado_por`), con un DNI distinto. */
async function sembrarUsuarioDeCaja(academiaId: string): Promise<string> {
  const id = randomUUID();
  const dni = String(10_000_000 + (randomBytes(4).readUInt32BE(0) % 89_999_999));
  await ejecutarComo(
    'propietario',
    `INSERT INTO public.usuarios (id, academia_id, dni, nombres, apellidos, rol, clave_hash, creado_en, actualizado_en)
     VALUES ($1::uuid, $2::uuid, $3, 'Secretaria', 'Sembrada', 'SECRETARIA', 'no-es-un-hash-real', now(), now())`,
    [id, academiaId, dni],
    { academiaId },
  );
  return id;
}

let contadorDeCajas = 0;
const diaBaseDeCajas = Math.floor(Math.random() * 9_000);

/**
 * Historia 006: una caja nueva de la academia (siempre `CERRADA` y con un día distinto en cada llamada: la base exige una sola caja
 * abierta y una sola por fecha en cada academia, así que ninguna llamada choca con otra). El día se cuenta desde 2000-01-01 y
 * `abierta_en` es las 09:00 de ese día en Lima (el `CHECK` de la fecha de Lima).
 */
async function sembrarCaja(academiaId: string, estado: 'ABIERTA' | 'CERRADA' = 'CERRADA') {
  contadorDeCajas += 1;
  const dias = diaBaseDeCajas + contadorDeCajas;
  const usuarioId = await sembrarUsuarioDeCaja(academiaId);
  const cajaId = randomUUID();
  await ejecutarComo(
    'propietario',
    `INSERT INTO public.cajas (id, academia_id, fecha, estado, monto_inicial, abierta_por, abierta_en, clave_idempotencia, creado_en,
                              actualizado_en)
     VALUES ($1::uuid, $2::uuid, (DATE '2000-01-01' + $3::int), $4::estado_caja, 0, $5::uuid,
             ((DATE '2000-01-01' + $3::int) + TIME '09:00') AT TIME ZONE 'America/Lima', $6::uuid, now(), now())`,
    [cajaId, academiaId, dias, estado, usuarioId, randomUUID()],
    { academiaId },
  );
  return { cajaId, usuarioId };
}

export const SEMBRADORES_POR_TABLA: Readonly<Record<string, Sembrador>> = {
  // hoy: 'public.auditoria', 'public.configuraciones', (historia 002) 'public.usuarios', (historia 004) 'public.planes' y 'public.clases',
  // (historia 005) las siete tablas de la inscripción y (historia 006) las tres tablas de la caja.
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
  // Historia 006 (criterio 1: las pruebas de catálogo de la 001 siguen pasando con las tres tablas nuevas). Cada llamada crea una caja
  // nueva (cerrada, de un día distinto) y lo que cuelga de ella.
  'public.cajas': async (academiaId) => {
    await sembrarCaja(academiaId);
  },
  // Un ingreso en una caja que se abre, se usa y se cierra enseguida: la base no deja insertar en una caja cerrada ni tener dos abiertas.
  'public.movimientos_caja': async (academiaId) => {
    const { cajaId, usuarioId } = await sembrarCaja(academiaId, 'ABIERTA');
    const alumnoId = await crearAlumnoSolo(academiaId);
    const pagoId = randomUUID();
    await ejecutarTransaccion('propietario', { academiaId }, [
      {
        sql: `INSERT INTO public.movimientos_caja (id, academia_id, caja_id, numero, tipo, concepto, metodo, monto, alumno_id, pago_id,
                                                 registrado_por, registrado_en)
              VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'INGRESO', 'INSCRIPCION', 'EFECTIVO', 42.00, $4::uuid, $5::uuid, $6::uuid, now())`,
        valores: [randomUUID(), academiaId, cajaId, alumnoId, pagoId, usuarioId],
      },
      ...sentenciasDelPagoDeSoporte({
        academiaId,
        pagoId,
        alumnoId,
        metodo: 'EFECTIVO',
        monto: '42.00',
        concepto: 'INSCRIPCION',
        usuarioId,
        registradoEn: new Date(),
      }),
    ]);
    await ejecutarComo(
      'propietario',
      "UPDATE public.cajas SET estado = 'CERRADA' WHERE academia_id = $1::uuid AND id = $2::uuid",
      [academiaId, cajaId],
      { academiaId },
    );
  },
  // Historia 007 (criterio 1: las pruebas de catálogo de la 001 siguen pasando con la tabla nueva). Un Yape pendiente de verificación de un cliente
  // con su solicitud y su matrícula (lo mismo que el sembrador de `solicitudes_inscripcion`, más el pago).
  'public.pagos': async (academiaId) => {
    const cliente = await sembrarClienteConSolicitud(academiaId);
    await insertarPago(
      'propietario',
      academiaId,
      filaPagoValida(academiaId, { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId }),
    );
  },
  // Historia 009 (criterio 1: las pruebas de catálogo de la 001 siguen pasando con la tabla nueva). Una asistencia por QR de un alumno con su matrícula y la
  // clase de esa matrícula (la de `sembrarClienteConSolicitud`), registrada por una secretaria nueva. Cada llamada crea todo nuevo: el alumno es distinto, así
  // que ninguna choca con «una por día» ni con la clave de idempotencia.
  'public.asistencias': async (academiaId) => {
    const cliente = await sembrarClienteConSolicitud(academiaId);
    const usuarioId = await sembrarUsuarioDeCaja(academiaId);
    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT clase_id FROM public.matricula_clases WHERE academia_id = $1::uuid AND matricula_id = $2::uuid',
      [academiaId, cliente.matriculaId],
      { academiaId },
    );
    const claseId = (rows[0] as { clase_id: string }).clase_id;
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.asistencias (id, academia_id, alumno_id, matricula_id, clase_id, fecha, llegada_en, registrado_en, metodo, tipo,
                                      estado_llegada, registrado_por, registro_posterior, motivo, clave_idempotencia)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, DATE '2026-11-16', TIMESTAMPTZ '2026-11-16 18:05:00-05',
               TIMESTAMPTZ '2026-11-16 18:05:00-05', 'QR', 'NORMAL', 'PUNTUAL', $6::uuid, false, NULL, $7::uuid)`,
      [randomUUID(), academiaId, cliente.alumnoId, cliente.matriculaId, claseId, usuarioId, randomUUID()],
      { academiaId },
    );
  },
  // Historia 009b (criterio 22: las pruebas de catálogo de la 001 siguen pasando con la tabla nueva). Una falta sin cubrir de un alumno con su matrícula y la clase
  // de esa matrícula (la de `sembrarClienteConSolicitud`). Cada llamada crea todo nuevo: el alumno es distinto, así que ninguna choca con `inasistencias_una_por_clase_key`.
  'public.inasistencias': async (academiaId) => {
    const cliente = await sembrarClienteConSolicitud(academiaId);
    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT clase_id FROM public.matricula_clases WHERE academia_id = $1::uuid AND matricula_id = $2::uuid',
      [academiaId, cliente.matriculaId],
      { academiaId },
    );
    const claseId = (rows[0] as { clase_id: string }).clase_id;
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.inasistencias (id, academia_id, alumno_id, matricula_id, clase_id, fecha, registrada_en, asistencia_id, cubierta_en)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, DATE '2026-11-16', TIMESTAMPTZ '2026-11-16 19:05:00-05', NULL, NULL)`,
      [randomUUID(), academiaId, cliente.alumnoId, cliente.matriculaId, claseId],
      { academiaId },
    );
  },
  // Un cierre vigente con todos los montos en cero (las cuentas cuadran).
  'public.cierres_caja': async (academiaId) => {
    const { cajaId, usuarioId } = await sembrarCaja(academiaId);
    await ejecutarComo(
      'propietario',
      `INSERT INTO public.cierres_caja (id, academia_id, caja_id, numero, movimientos_hasta, monto_inicial, ingresos_efectivo,
                                       ingresos_yape, ingresos_transferencia, egresos_efectivo, esperado_efectivo, monto_declarado,
                                       diferencia, observacion, tardio, cerrado_por, cerrado_en, clave_idempotencia, creado_en)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, false, $4::uuid, now(), $5::uuid, now())`,
      [randomUUID(), academiaId, cajaId, usuarioId, randomUUID()],
      { academiaId },
    );
  },
};
