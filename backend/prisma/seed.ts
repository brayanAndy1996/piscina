// Semilla de datos de ejemplo para desarrollo (spec 001, criterio 61): las academias `delfines` y `tiburones` y el
// superadmin de desarrollo. Solo agrega lo que falta: repetirla no falla ni duplica ni modifica lo que ya existe.
// Nunca corre con NODE_ENV=production. No imprime la contraseña.
import { createHash } from 'node:crypto';
import {
  cargarEnvDeLaRaiz,
  crearClienteDelDueno,
  enAcademia,
  enPlataforma,
  leerVariable,
  problemaDeUrlDeConexion,
} from '../src/cli/conexion';
import { mensajeSeguro } from '../src/cli/mensaje-seguro';
import { hoyEnLima } from '../src/comun/fechas';
import { guardarSuperadmin, hayDatosDeSuperadmin, leerDatosSuperadmin } from '../src/cli/superadmin-datos';
import { leerNodeEnv } from '../src/infraestructura/entorno/node-env';
import { hashearClave } from '../src/infraestructura/seguridad/claves';

const ACADEMIAS_DE_EJEMPLO = [
  { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines' },
  { nombreCorto: 'tiburones', nombre: 'Club de Natación Tiburones' },
] as const;

/**
 * Usuarios de ejemplo (spec 002, criterio 45; spec 004, criterio 30): uno por rol en `delfines`, más un segundo entrenador, y un administrador en `tiburones` con el mismo DNI que el de
 * `delfines` (D-28: la misma persona en dos academias es dos cuentas). DNIs inventados. La contraseña inicial es el DNI y deben
 * cambiarla al entrar (RN-02); por eso la salida de la semilla no los muestra: están en `docs/guia-local-windows.md`.
 */
const USUARIOS_DE_EJEMPLO = [
  { academia: 'delfines', dni: '10000001', rol: 'ADMIN', nombres: 'Rosa', apellidos: 'Alvarez Prado' },
  { academia: 'delfines', dni: '10000002', rol: 'SECRETARIA', nombres: 'Lucia', apellidos: 'Benites Rojas' },
  { academia: 'delfines', dni: '10000003', rol: 'ENTRENADOR', nombres: 'Mario', apellidos: 'Castro Vega' },
  { academia: 'delfines', dni: '10000005', rol: 'ENTRENADOR', nombres: 'Paula', apellidos: 'Fuentes Ibarra' },
  { academia: 'delfines', dni: '10000004', rol: 'ALUMNO', nombres: 'Diego', apellidos: 'Delgado Soto' },
  { academia: 'tiburones', dni: '10000001', rol: 'ADMIN', nombres: 'Elena', apellidos: 'Espinoza Luna' },
] as const;

/**
 * Configuración de ejemplo (spec 003, criterio 25): `delfines` tiene un teléfono inventado y `tiburones` queda sin filas, con los
 * valores por defecto. El valor de `configuraciones.valor` es el JSON del valor (un texto).
 */
const TELEFONO_DE_DELFINES = '+51 999 000 111';

/**
 * Planes de ejemplo de `delfines` (spec 004, criterio 30): con todas las franjas y los tres niveles. Los precios ya incluyen IGV
 * (D-03). `tiburones` queda sin planes ni clases.
 */
const PLANES_DE_EJEMPLO = [
  { nombre: '3 veces por semana', vecesPorSemana: 3, clasesPorMes: 12, precio: '120.00', dias: [1, 3, 5] },
  { nombre: '2 veces por semana', vecesPorSemana: 2, clasesPorMes: 8, precio: '90.00', dias: [2, 4] },
] as const;
const FRANJAS_DE_EJEMPLO = [
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
];
const NIVELES_DE_EJEMPLO = ['BASICO', 'INTERMEDIO', 'AVANZADO'];

/**
 * Clases de ejemplo de `delfines` (spec 004, criterio 30): los tres niveles y, el lunes a las 18:00, dos clases en el mismo bloque con
 * entrenadores distintos (10000003 y 10000005; RN-10, HU-17).
 */
const CLASES_DE_EJEMPLO = [
  { nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', aforo: 30, dniEntrenador: '10000003' },
  { nivel: 'INTERMEDIO', diaSemana: 1, horaInicio: '18:00', aforo: 25, dniEntrenador: '10000005' },
  { nivel: 'INTERMEDIO', diaSemana: 1, horaInicio: '19:00', aforo: 25, dniEntrenador: '10000003' },
  { nivel: 'AVANZADO', diaSemana: 3, horaInicio: '18:00', aforo: 20, dniEntrenador: '10000003' },
  { nivel: 'BASICO', diaSemana: 5, horaInicio: '18:00', aforo: 30, dniEntrenador: '10000003' },
] as const;

/**
 * Clientes de ejemplo de `delfines` (spec 005, criterio 47), inventados, sobre los planes y las clases de la 004: uno con una solicitud
 * en espera de pago con su reserva vigente, uno con la reserva vencida y uno menor de edad con apoderado. `tiburones` queda sin
 * solicitudes. Cada cliente se reconoce por su DNI: repetir la semilla no duplica ni pisa lo que ya existe. Del token solo se guarda su
 * SHA-256 (de un texto de ejemplo que no tiene el formato de un token, así que ningún enlace los abre); nada se imprime. Los datos
 * médicos son inventados y neutros. La semilla no usa `RELOJ`: la reserva vigente vence dentro de un año y la vencida, ayer.
 */
const VERSION_DE_CONSENTIMIENTOS_DE_LA_SEMILLA = '2026-11-v1-provisional';
const CLIENTES_DE_EJEMPLO = [
  {
    dni: '20000001',
    nombres: 'Valeria Andrea',
    apellidos: 'Mendoza Salas',
    fechaNacimiento: '1996-04-12',
    codigo: 'AQ-SM0001',
    textoDelToken: 'semilla-delfines-solicitud-1',
    estado: 'VIGENTE',
    apoderado: null,
  },
  {
    dni: '20000002',
    nombres: 'Rodrigo',
    apellidos: 'Paredes Linares',
    fechaNacimiento: '1989-09-30',
    codigo: 'AQ-SM0002',
    textoDelToken: 'semilla-delfines-solicitud-2',
    estado: 'VENCIDA',
    apoderado: null,
  },
  {
    dni: '20000003',
    nombres: 'Mateo',
    apellidos: 'Quispe Rojas',
    fechaNacimiento: '2014-03-10',
    codigo: 'AQ-SM0003',
    textoDelToken: 'semilla-delfines-solicitud-3',
    estado: 'VIGENTE',
    apoderado: {
      dni: '20000013',
      nombres: 'Rosa',
      apellidos: 'Rojas Vega',
      telefono: '955123456',
      parentesco: 'MADRE',
    },
  },
] as const;
/** Las clases de ejemplo que eligen los clientes (BASICO, lunes y viernes a las 18:00) y el plan de 12 clases al mes. */
const CLASES_DE_LOS_CLIENTES = [
  { dia: 1, hora: '18:00' },
  { dia: 5, hora: '18:00' },
] as const;
const PLAN_DE_LOS_CLIENTES = '3 veces por semana';

async function sembrar(): Promise<number> {
  cargarEnvDeLaRaiz();

  // NODE_ENV, si está definida (aunque sea vacía), debe ser exactamente development, test o production (criterio 78).
  const nodeEnv = leerNodeEnv(process.env);
  if (!nodeEnv.ok) {
    console.error(`No se hizo ningún cambio. ${nodeEnv.problema}`);
    return 1;
  }
  if (nodeEnv.valor === 'production') {
    console.error('La semilla no se ejecuta con NODE_ENV=production: solo agrega datos de ejemplo para desarrollo.');
    return 1;
  }
  const url = leerVariable(process.env, 'DATABASE_URL');
  if (url === undefined) {
    console.error('Falta la variable DATABASE_URL.');
    return 1;
  }
  const problemaUrl = problemaDeUrlDeConexion(url, 'DATABASE_URL');
  if (problemaUrl) {
    console.error(`No se hizo ningún cambio. ${problemaUrl}`);
    return 1;
  }

  // Si las tres variables SUPERADMIN_* están definidas, deben ser válidas; se comprueba antes de escribir nada.
  const quiereSuperadmin = hayDatosDeSuperadmin(process.env);
  const superadmin = quiereSuperadmin ? leerDatosSuperadmin(process.env) : undefined;
  if (superadmin && !superadmin.ok) {
    console.error(
      `No se hizo ningún cambio. Corrige la configuración:\n${superadmin.problemas.map((p) => `- ${p}`).join('\n')}`,
    );
    return 1;
  }

  const cliente = crearClienteDelDueno(url);
  try {
    const ahora = new Date();
    const claveHash = superadmin?.ok ? await hashearClave(superadmin.datos.clave) : undefined;
    // La clave inicial de cada usuario de ejemplo es su DNI (RN-02): el hash se calcula antes de abrir las transacciones.
    const hashesDeUsuarios = new Map<string, string>();
    for (const usuario of USUARIOS_DE_EJEMPLO) hashesDeUsuarios.set(usuario.dni, await hashearClave(usuario.dni));
    const resumen = await enPlataforma(cliente, async (tx) => {
      const lineas: string[] = [];
      for (const academia of ACADEMIAS_DE_EJEMPLO) {
        const creadas = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO academias (id, nombre, nombre_corto, estado, creada_en, actualizada_en)
          VALUES (gen_random_uuid(), ${academia.nombre}, ${academia.nombreCorto}, 'ACTIVA'::estado_academia,
                  ${ahora}::timestamptz, ${ahora}::timestamptz)
          ON CONFLICT (nombre_corto) DO NOTHING
          RETURNING id::text AS id`;
        lineas.push(
          creadas.length > 0
            ? `Academia de ejemplo creada: ${academia.nombreCorto}`
            : `La academia de ejemplo ya existía: ${academia.nombreCorto}`,
        );
      }
      if (superadmin?.ok && claveHash) {
        const resultado = await guardarSuperadmin(tx, superadmin.datos, claveHash, ahora, { restablecer: false });
        lineas.push(
          resultado === 'CREADO'
            ? `Superadmin de desarrollo creado: ${superadmin.datos.correo}`
            : `El superadmin de desarrollo ya existía: ${superadmin.datos.correo}`,
        );
      } else {
        lineas.push(
          'No se creó el superadmin de desarrollo: define SUPERADMIN_CORREO, SUPERADMIN_NOMBRE y SUPERADMIN_CLAVE ' +
            '(npm run env:completar los agrega al .env).',
        );
      }
      return lineas;
    });
    for (const linea of resumen) console.log(linea);
    // Los usuarios van en transacciones de cada academia (RLS forzada): la de la plataforma no ve `usuarios`.
    for (const usuario of USUARIOS_DE_EJEMPLO) {
      const academias = await enPlataforma(
        cliente,
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM academias WHERE nombre_corto = ${usuario.academia}`,
      );
      const academiaId = academias[0]?.id;
      if (!academiaId) throw new Error(`No se encontró la academia de ejemplo ${usuario.academia}.`);
      const claveDelUsuario = hashesDeUsuarios.get(usuario.dni);
      if (!claveDelUsuario) throw new Error('Falta el hash de un usuario de ejemplo.');
      const creados = await enAcademia(
        cliente,
        academiaId,
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`
          INSERT INTO usuarios (id, academia_id, dni, nombres, apellidos, rol, clave_hash, debe_cambiar_clave, estado,
                                version_token, intentos_fallidos, creado_en, actualizado_en)
          VALUES (gen_random_uuid(), ${academiaId}::uuid, ${usuario.dni}, ${usuario.nombres}, ${usuario.apellidos},
                  ${usuario.rol}::rol_usuario, ${claveDelUsuario}, true, 'ACTIVO'::estado_usuario, 0, 0,
                  ${ahora}::timestamptz, ${ahora}::timestamptz)
          ON CONFLICT (academia_id, dni) DO NOTHING
          RETURNING id::text AS id`,
      );
      console.log(
        creados.length > 0
          ? `Usuario de ejemplo creado: ${usuario.academia}, ${usuario.rol}`
          : `El usuario de ejemplo ya existía: ${usuario.academia}, ${usuario.rol}`,
      );
    }
    // La configuración va en la transacción de su academia (RLS forzada). Solo se agrega si falta: repetir la semilla no la pisa.
    const delfines = await enPlataforma(
      cliente,
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM academias WHERE nombre_corto = 'delfines'`,
    );
    const delfinesId = delfines[0]?.id;
    if (!delfinesId) throw new Error('No se encontró la academia de ejemplo delfines.');
    const telefono = await enAcademia(
      cliente,
      delfinesId,
      (tx) =>
        tx.$queryRaw<{ clave: string }[]>`
          INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
          VALUES (${delfinesId}::uuid, 'telefono', ${JSON.stringify(TELEFONO_DE_DELFINES)}::jsonb, ${ahora}::timestamptz)
          ON CONFLICT (academia_id, clave) DO NOTHING
          RETURNING clave`,
    );
    console.log(
      telefono.length > 0
        ? 'Teléfono de ejemplo agregado a la configuración de delfines'
        : 'La configuración de ejemplo de delfines ya existía',
    );
    // Los planes y las clases también van en la transacción de su academia. Solo se agregan si faltan: repetir la semilla no duplica
    // ni pisa lo que el administrador haya cambiado (un plan se reconoce por su nombre y una clase por su nivel, día y hora).
    let planesCreados = 0;
    for (const plan of PLANES_DE_EJEMPLO) {
      const creados = await enAcademia(
        cliente,
        delfinesId,
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`
          INSERT INTO planes (id, academia_id, nombre, veces_por_semana, clases_por_mes, duracion_minutos, precio, dias_permitidos,
                              franjas_permitidas, niveles_aplicables, activo, creado_en, actualizado_en)
          VALUES (gen_random_uuid(), ${delfinesId}::uuid, ${plan.nombre}, ${plan.vecesPorSemana}::smallint,
                  ${plan.clasesPorMes}::smallint, 60, ${plan.precio}::numeric(10,2), ${[...plan.dias]}::smallint[],
                  ${FRANJAS_DE_EJEMPLO}::time(0)[], ${NIVELES_DE_EJEMPLO}::text[]::nivel_natacion[], true,
                  ${ahora}::timestamptz, ${ahora}::timestamptz)
          ON CONFLICT DO NOTHING
          RETURNING id::text AS id`,
      );
      planesCreados += creados.length;
    }
    console.log(
      planesCreados > 0
        ? `Planes de ejemplo agregados a delfines: ${planesCreados}`
        : 'Los planes de ejemplo de delfines ya existían',
    );
    const entrenadores = await enAcademia(
      cliente,
      delfinesId,
      (tx) =>
        tx.$queryRaw<{ id: string; dni: string }[]>`
          SELECT id::text AS id, dni FROM usuarios
           WHERE academia_id = ${delfinesId}::uuid AND rol = 'ENTRENADOR'::rol_usuario`,
    );
    const entrenadorPorDni = new Map(entrenadores.map((entrenador) => [entrenador.dni, entrenador.id]));
    let clasesCreadas = 0;
    for (const clase of CLASES_DE_EJEMPLO) {
      const entrenadorId = entrenadorPorDni.get(clase.dniEntrenador);
      if (!entrenadorId) throw new Error('No se encontró un entrenador de ejemplo de delfines.');
      const horaFin = `${String(Number(clase.horaInicio.slice(0, 2)) + 1).padStart(2, '0')}:00`;
      const creadas = await enAcademia(
        cliente,
        delfinesId,
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`
          INSERT INTO clases (id, academia_id, nivel, dia_semana, hora_inicio, hora_fin, entrenador_id, aforo, activo, creado_en,
                              actualizado_en)
          SELECT gen_random_uuid(), ${delfinesId}::uuid, ${clase.nivel}::nivel_natacion, ${clase.diaSemana}::smallint,
                 ${clase.horaInicio}::time(0), ${horaFin}::time(0), ${entrenadorId}::uuid, ${clase.aforo}::smallint, true,
                 ${ahora}::timestamptz, ${ahora}::timestamptz
           WHERE NOT EXISTS (SELECT 1 FROM clases
                              WHERE academia_id = ${delfinesId}::uuid AND nivel = ${clase.nivel}::nivel_natacion
                                AND dia_semana = ${clase.diaSemana}::smallint AND hora_inicio = ${clase.horaInicio}::time(0))
          ON CONFLICT DO NOTHING
          RETURNING id::text AS id`,
      );
      clasesCreadas += creadas.length;
    }
    console.log(
      clasesCreadas > 0
        ? `Clases de ejemplo agregadas a delfines: ${clasesCreadas}`
        : 'Las clases de ejemplo de delfines ya existían',
    );
    // Los clientes de ejemplo van en la transacción de su academia (RLS forzada), uno por transacción: solo se agregan si faltan.
    const hoy = hoyEnLima(ahora);
    const [anioTexto = '0', mesTexto = '0'] = hoy.split('-');
    const anio = Number(anioTexto);
    const mes = Number(mesTexto);
    const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const inicioDelMes = `${anioTexto}-${mesTexto}-01`;
    const finDelMes = `${anioTexto}-${mesTexto}-${String(ultimoDia).padStart(2, '0')}`;
    // Los clientes cuelgan del plan de ejemplo (se reconoce por su nombre): si el administrador lo renombró, no se agregan.
    const planes = await enAcademia(
      cliente,
      delfinesId,
      (tx) =>
        tx.$queryRaw<{ id: string; precio: string; clases_por_mes: number }[]>`
          SELECT id::text AS id, precio::text AS precio, clases_por_mes::int AS clases_por_mes
            FROM planes WHERE academia_id = ${delfinesId}::uuid AND nombre = ${PLAN_DE_LOS_CLIENTES}`,
    );
    const plan = planes[0];
    // 8 de las 12 clases del plan (a mitad de mes), nunca más que las del plan si el administrador lo cambió.
    const clasesTotales = Math.min(8, plan?.clases_por_mes ?? 8);
    let clientesCreados = 0;
    for (const ejemplo of plan ? CLIENTES_DE_EJEMPLO : []) {
      const hashDelToken = createHash('sha256').update(ejemplo.textoDelToken).digest('hex');
      const vence =
        ejemplo.estado === 'VIGENTE'
          ? new Date(ahora.getTime() + 365 * 24 * 60 * 60 * 1000)
          : new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
      const creado = await enAcademia(cliente, delfinesId, async (tx) => {
        const alumnos = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO alumnos (id, academia_id, dni, nombres, apellidos, fecha_nacimiento, telefono, nivel, estado, creado_en,
                               actualizado_en)
          VALUES (gen_random_uuid(), ${delfinesId}::uuid, ${ejemplo.dni}, ${ejemplo.nombres}, ${ejemplo.apellidos},
                  ${ejemplo.fechaNacimiento}::date, '987000111', 'BASICO'::nivel_natacion, 'CLIENTE'::estado_alumno,
                  ${ahora}::timestamptz, ${ahora}::timestamptz)
          ON CONFLICT (academia_id, dni) DO NOTHING
          RETURNING id::text AS id`;
        const alumno = alumnos[0];
        if (!alumno) return false;
        await tx.$executeRaw`
          INSERT INTO fichas_medicas (alumno_id, academia_id, tipo_sangre, alergias, contacto_emergencia_nombre,
                                      contacto_emergencia_telefono, creado_en, actualizado_en)
          VALUES (${alumno.id}::uuid, ${delfinesId}::uuid, 'O_POSITIVO'::tipo_sangre, 'Ninguna conocida', 'Contacto de ejemplo',
                  '987000222', ${ahora}::timestamptz, ${ahora}::timestamptz)`;
        if (ejemplo.apoderado) {
          await tx.$executeRaw`
            INSERT INTO apoderados (alumno_id, academia_id, nombres, apellidos, dni, telefono, parentesco, creado_en, actualizado_en)
            VALUES (${alumno.id}::uuid, ${delfinesId}::uuid, ${ejemplo.apoderado.nombres}, ${ejemplo.apoderado.apellidos},
                    ${ejemplo.apoderado.dni}, ${ejemplo.apoderado.telefono}, ${ejemplo.apoderado.parentesco}::parentesco,
                    ${ahora}::timestamptz, ${ahora}::timestamptz)`;
        }
        const solicitudes = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO solicitudes_inscripcion (id, academia_id, alumno_id, codigo, token_hash, clave_idempotencia, estado,
                                               creado_en, actualizado_en)
          VALUES (gen_random_uuid(), ${delfinesId}::uuid, ${alumno.id}::uuid, ${ejemplo.codigo}, decode(${hashDelToken}::text, 'hex'),
                  gen_random_uuid(), 'PENDIENTE_PAGO'::estado_solicitud, ${ahora}::timestamptz, ${ahora}::timestamptz)
          RETURNING id::text AS id`;
        const solicitud = solicitudes[0];
        if (!solicitud) throw new Error('No se pudo crear una solicitud de ejemplo.');
        const matriculas = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO matriculas (id, academia_id, alumno_id, plan_id, solicitud_id, anio, mes, fecha_inicio, fecha_fin, clases_totales,
                                  clases_usadas, es_proporcional, precio_plan, clases_por_mes_plan, monto_calculado, estado,
                                  reserva_vence_en, creado_en, actualizado_en)
          VALUES (gen_random_uuid(), ${delfinesId}::uuid, ${alumno.id}::uuid, ${plan?.id}::uuid, ${solicitud.id}::uuid,
                  ${anio}::smallint, ${mes}::smallint, ${inicioDelMes}::date, ${finDelMes}::date, ${clasesTotales}::smallint, 0, ${clasesTotales < (plan?.clases_por_mes ?? 0)},
                  ${plan?.precio}::numeric(10,2), ${plan?.clases_por_mes}::smallint, 80.00, 'RESERVADA'::estado_matricula,
                  ${vence}::timestamptz, ${ahora}::timestamptz, ${ahora}::timestamptz)
          RETURNING id::text AS id`;
        const matricula = matriculas[0];
        if (!matricula) throw new Error('No se pudo crear la matrícula de un cliente de ejemplo.');
        for (const clase of CLASES_DE_LOS_CLIENTES) {
          await tx.$executeRaw`
            INSERT INTO matricula_clases (academia_id, matricula_id, clase_id)
            SELECT ${delfinesId}::uuid, ${matricula.id}::uuid, c.id
              FROM clases c
             WHERE c.academia_id = ${delfinesId}::uuid AND c.nivel = 'BASICO'::nivel_natacion AND c.dia_semana = ${clase.dia}::smallint
               AND c.hora_inicio = ${clase.hora}::time(0)`;
        }
        const otorgante = ejemplo.apoderado ? 'APODERADO' : 'TITULAR';
        for (const tipo of ['DATOS_PERSONALES', 'DESLINDE'] as const) {
          await tx.$executeRaw`
            INSERT INTO consentimientos (id, academia_id, alumno_id, solicitud_id, tipo, version, aceptado_en, otorgado_por, aceptado)
            VALUES (gen_random_uuid(), ${delfinesId}::uuid, ${alumno.id}::uuid, ${solicitud.id}::uuid, ${tipo}::tipo_consentimiento,
                    ${VERSION_DE_CONSENTIMIENTOS_DE_LA_SEMILLA}, ${ahora}::timestamptz, ${otorgante}::otorgante_consentimiento, true)`;
        }
        return true;
      });
      if (creado) clientesCreados += 1;
    }
    console.log(
      !plan
        ? 'No se agregaron clientes de ejemplo a delfines: falta el plan de ejemplo'
        : clientesCreados > 0
          ? `Clientes de ejemplo con solicitud agregados a delfines: ${clientesCreados}`
          : 'Los clientes de ejemplo de delfines ya existían',
    );
    return 0;
  } catch (error) {
    const secretos = [
      url,
      superadmin?.ok ? superadmin.datos.clave : undefined,
      ...USUARIOS_DE_EJEMPLO.map((u) => u.dni),
    ];
    console.error(`No se pudo ejecutar la semilla: ${mensajeSeguro(error, secretos)}`);
    return 1;
  } finally {
    await cliente.$disconnect().catch(() => undefined);
  }
}

sembrar().then(
  (codigo) => {
    process.exitCode = codigo;
  },
  () => {
    console.error('No se pudo ejecutar la semilla por un error inesperado.');
    process.exitCode = 1;
  },
);
