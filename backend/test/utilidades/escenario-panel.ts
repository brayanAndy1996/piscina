// spec: 011-panel-alumno (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { expect } from 'vitest';
import { ejecutarComo, tablasDelNegocio } from './base-datos';
import type { AppCarnet } from './escenario-carnet';
import {
  type AlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  filaAsistenciaValida,
  insertarAsistencia,
} from './escenario-asistencia';
import { prepararEscenarioDe009b } from './escenario-faltas';
import { filaPagoValida, insertarPago } from './pagos';
import { filaValida, insertarFila, type Objeto } from './inscripciones';
import { rutasRegistradas } from './usuarios';

/**
 * Utilidades de las pruebas protegidas de la 011 (panel del alumno y del apoderado). Solo usan SQL, HTTP y los contratos públicos: no importan nada de la
 * implementación. Reutilizan el escenario de la 009b (A y B con sus usuarios, el plan, las clases, la caja de hoy y la tabla de faltas) y las cuentas de alumno
 * que crea un pago confirmado por la API. Lo que todavía no existe (las dos rutas `GET /api/mi-panel` y `GET /api/mi-panel/asistencias`) se exige con un
 * mensaje claro: ninguna prueba pasa por casualidad con una ruta inexistente (por ejemplo, el 401 sin sesión que ya da el guardia global de la 002).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------------------------------------------------

export const RUTA_MI_PANEL = '/api/mi-panel';
export const RUTA_MI_ASISTENCIA = '/api/mi-panel/asistencias';
export const rutaMiAsistencia = (mes?: string): string =>
  mes === undefined ? RUTA_MI_ASISTENCIA : `${RUTA_MI_ASISTENCIA}?mes=${mes}`;

/** Las dos rutas de la 011 con su nombre, para recorrerlas con las mismas pruebas. */
export const RUTAS_DEL_PANEL = [
  { nombre: 'GET /api/mi-panel', ruta: RUTA_MI_PANEL, permiso: 'VER_CARNET' },
  { nombre: 'GET /api/mi-panel/asistencias', ruta: RUTA_MI_ASISTENCIA, permiso: 'VER_REPORTES_ASISTENCIA' },
] as const;

const RUTAS_DE_LA_011: readonly RegExp[] = [/^GET \/api\/mi-panel$/, /^GET \/api\/mi-panel\/asistencias$/];

/** Falla con un mensaje claro si las dos rutas de la 011 no están registradas (la funcionalidad no existe todavía). */
export function exigirRutasDe011(app: NestExpressApplication): void {
  const registradas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
  for (const patron of RUTAS_DE_LA_011) {
    if (!registradas.some((ruta) => patron.test(ruta))) {
      throw new Error(`Falta la funcionalidad de la 011: ninguna ruta registrada coincide con ${String(patron)}.`);
    }
  }
}

/** El escenario de la 009b (con las faltas y la consulta del mes de recepción) más la comprobación de que las rutas de la 011 existen. */
export async function prepararEscenarioDelPanel(ctx: AppCarnet): Promise<EscenarioDeAsistencia> {
  const esc = await prepararEscenarioDe009b(ctx);
  exigirRutasDe011(ctx.app);
  return esc;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo que devuelve el panel (claves exactas del contrato, criterio 6)
// ---------------------------------------------------------------------------------------------------------------------

const ordenadas = (claves: readonly string[]): string[] => [...claves].sort();

export const CLAVES_DEL_PANEL = ordenadas(['hoy', 'mesEnCurso', 'alumno', 'mensualidad', 'mesesDeAsistencia']);
export const CLAVES_DEL_ALUMNO_DEL_PANEL = ordenadas(['nombres', 'apellidos', 'dni', 'nivel', 'edad', 'estado']);
export const CLAVES_DE_LA_MENSUALIDAD_DEL_PANEL = ordenadas(['estado', 'actual', 'siguiente']);
export const CLAVES_DE_UNA_MENSUALIDAD_DEL_PANEL = ordenadas([
  'mes',
  'plan',
  'clases',
  'clasesUsadas',
  'clasesTotales',
  'clasesRestantes',
  'desde',
  'hasta',
]);
export const CLAVES_DE_LA_SIGUIENTE_DEL_PANEL = ordenadas([...CLAVES_DE_UNA_MENSUALIDAD_DEL_PANEL, 'estado']);
export const CLAVES_DEL_PLAN_DEL_PANEL = ['nombre'];
export const CLAVES_DE_LA_CLASE_DEL_PANEL = ordenadas(['diaSemana', 'horaInicio', 'horaFin']);

export interface MensualidadDelPanelApi {
  mes: string;
  plan: { nombre: string };
  clases: { diaSemana: number; horaInicio: string; horaFin: string }[];
  clasesUsadas: number;
  clasesTotales: number;
  clasesRestantes: number;
  desde: string;
  hasta: string;
}

export interface MiPanelApi {
  hoy: string;
  mesEnCurso: string;
  alumno: { nombres: string; apellidos: string; dni: string; nivel: string; edad: number; estado: string };
  mensualidad: {
    estado: string | null;
    actual: MensualidadDelPanelApi | null;
    siguiente: (MensualidadDelPanelApi & { estado: string }) | null;
  };
  mesesDeAsistencia: string[];
}

/** El panel de una respuesta 200; si no lo es, falla con el estado y el cuerpo recibidos. */
export function panelDe(respuesta: { status: number; body: Objeto | null; texto: string }): MiPanelApi {
  expect(respuesta.status, `se esperaba 200 y fue HTTP ${respuesta.status}: ${respuesta.texto.slice(0, 500)}`).toBe(
    200,
  );
  expect(respuesta.body, 'la respuesta no es un objeto JSON').toBeTruthy();
  return respuesta.body as unknown as MiPanelApi;
}

export function codigoDe(respuesta: { body: Objeto | null }): string | undefined {
  const codigo = respuesta.body?.['codigo'];
  return typeof codigo === 'string' ? codigo : undefined;
}

/** Los campos con error de una respuesta 400 (`detalles.errores[].campo`). */
export function camposConError(respuesta: { body: Objeto | null }): string[] {
  const detalles = respuesta.body?.['detalles'] as { errores?: { campo: string }[] } | undefined;
  return (detalles?.errores ?? []).map((error) => error.campo);
}

/** Todas las claves de un valor JSON, a cualquier profundidad (sin repetir, ordenadas). */
export function clavesDe(valor: unknown): string[] {
  const claves = new Set<string>();
  const recorrer = (uno: unknown): void => {
    if (Array.isArray(uno)) {
      for (const elemento of uno) recorrer(elemento);
    } else if (uno !== null && typeof uno === 'object') {
      for (const [clave, hijo] of Object.entries(uno)) {
        claves.add(clave);
        recorrer(hijo);
      }
    }
  };
  recorrer(valor);
  return [...claves].sort();
}

export const FORMATO_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---------------------------------------------------------------------------------------------------------------------
// Peticiones con cuerpo en un GET (el `fetch` de Node no deja enviarlo)
// ---------------------------------------------------------------------------------------------------------------------

export interface RespuestaCruda {
  status: number;
  texto: string;
  body: Objeto | null;
  headers: http.IncomingHttpHeaders;
}

/** Una petición HTTP con el método y el cuerpo que se pidan (también un GET con cuerpo JSON). */
export function pedirCrudo(
  app: NestExpressApplication,
  metodo: string,
  ruta: string,
  opciones: { cookie?: string; headers?: Record<string, string>; cuerpo?: unknown; cuerpoCrudo?: string } = {},
): Promise<RespuestaCruda> {
  const { port } = app.getHttpServer().address() as { port: number };
  const headers: Record<string, string> = { ...opciones.headers };
  if (opciones.cookie) headers['cookie'] = opciones.cookie;
  const cuerpo = opciones.cuerpoCrudo ?? (opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo));
  if (cuerpo !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(cuerpo));
  }
  return new Promise((resolver, rechazar) => {
    const peticion = http.request({ host: '127.0.0.1', port, path: ruta, method: metodo, headers }, (respuesta) => {
      const trozos: Buffer[] = [];
      respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
      respuesta.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        let body: Objeto | null = null;
        try {
          const leido: unknown = JSON.parse(texto);
          if (leido !== null && typeof leido === 'object' && !Array.isArray(leido)) body = leido as Objeto;
        } catch {
          body = null;
        }
        resolver({ status: respuesta.statusCode ?? 0, texto, body, headers: respuesta.headers });
      });
    });
    peticion.on('error', rechazar);
    if (cuerpo !== undefined) peticion.write(cuerpo);
    peticion.end();
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo que ocurre en la base durante una petición
// ---------------------------------------------------------------------------------------------------------------------

type FuncionQuery = (this: pg.Client, ...argumentos: unknown[]) => unknown;

// eslint-disable-next-line @typescript-eslint/unbound-method -- se guarda para restaurarlo y para llamarlo con el `this` del cliente
const consultaOriginal = pg.Client.prototype.query as unknown as FuncionQuery;

function textoDeSentencia(primerArgumento: unknown): string {
  const texto =
    typeof primerArgumento === 'string'
      ? primerArgumento
      : ((primerArgumento as { text?: string } | undefined)?.text ?? '');
  return texto.replace(/\s+/g, ' ').trim();
}

export interface SentenciasGrabadas<T> {
  resultado: T;
  /** Todas las sentencias, en el orden en que llegaron a `pg`. */
  sentencias: string[];
  /** Las sentencias agrupadas por transacción (de `BEGIN` a `COMMIT` o `ROLLBACK` en la misma conexión); una sentencia fuera de una transacción es una transacción de una sola sentencia. */
  transacciones: string[][];
}

/**
 * Ejecuta `trabajo` y devuelve las sentencias SQL que llegaron al controlador de PostgreSQL (`pg`) mientras tanto, en orden y agrupadas por transacción. La API de las pruebas corre
 * en el mismo proceso y carga el mismo módulo `pg`: no debe haber otras consultas de la prueba en ese rato.
 */
export async function grabarSentencias<T>(trabajo: () => Promise<T>): Promise<SentenciasGrabadas<T>> {
  const sentencias: string[] = [];
  const transacciones: string[][] = [];
  const abiertas = new WeakMap<object, string[]>();
  pg.Client.prototype.query = function (this: pg.Client, ...argumentos: unknown[]) {
    const texto = textoDeSentencia(argumentos[0]);
    sentencias.push(texto);
    if (/^begin\b/i.test(texto)) {
      const nueva: string[] = [texto];
      abiertas.set(this, nueva);
      transacciones.push(nueva);
    } else if (/^(commit|rollback)\b/i.test(texto)) {
      abiertas.get(this)?.push(texto);
      abiertas.delete(this);
    } else {
      const abierta = abiertas.get(this);
      if (abierta) abierta.push(texto);
      else transacciones.push([texto]);
    }
    return consultaOriginal.apply(this, argumentos);
  } as unknown as typeof pg.Client.prototype.query;
  try {
    const resultado = await trabajo();
    return { resultado, sentencias, transacciones };
  } finally {
    pg.Client.prototype.query = consultaOriginal as unknown as typeof pg.Client.prototype.query;
  }
}

/** Una instantánea de todas las tablas del negocio de las dos academias (filas como texto JSON, ordenadas), para comprobar que una lectura no cambió nada. */
export async function instantaneaDeTodasLasTablas(
  academias: readonly { id: string }[],
): Promise<Record<string, string[]>> {
  const resultado: Record<string, string[]> = {};
  for (const tabla of await tablasDelNegocio()) {
    const columnas = await ejecutarComo(
      'propietario',
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'academia_id'",
      [tabla],
    );
    const filas: string[] = [];
    if (columnas.rows.length > 0) {
      for (const academia of academias) {
        const { rows } = await ejecutarComo(
          'propietario',
          `SELECT to_jsonb(t)::text AS fila FROM "public"."${tabla}" t WHERE t.academia_id = $1::uuid ORDER BY 1`,
          [academia.id],
          { academiaId: academia.id },
        );
        filas.push(...rows.map((fila: { fila: string }) => fila.fila));
      }
    } else {
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT to_jsonb(t)::text AS fila FROM "public"."${tabla}" t ORDER BY 1`,
        [],
        { plataforma: true },
      );
      filas.push(...rows.map((fila: { fila: string }) => fila.fila));
    }
    resultado[tabla] = filas;
  }
  return resultado;
}

// ---------------------------------------------------------------------------------------------------------------------
// Alumnos con datos sensibles sembrados (textos únicos que no pueden aparecer en el panel)
// ---------------------------------------------------------------------------------------------------------------------

export interface DatosSembrados {
  /** Textos únicos de datos que el panel nunca muestra (ficha médica, apoderado, contacto, pagos, motivos…). */
  textos: string[];
  /** Los ids, el token del QR y los códigos que el panel nunca muestra. */
  identificadores: string[];
}

const dosCifras = (n: number): string => String(n).padStart(2, '0');

export interface OpcionesDeDatosSensibles {
  /** Número del juego de textos (distinto para cada alumno de la prueba). */
  n: number;
  /** `true` si el alumno tiene apoderado (se siembran sus datos). */
  conApoderado?: boolean;
  /** La clase de diciembre (por defecto, la del alumno). */
  claseId?: string;
  /** Cómo está diciembre: `PAGADA` (matrícula `VIGENTE`) o `EN_VERIFICACION` (matrícula `RESERVADA` con un Yape pendiente y un pago rechazado anterior). */
  diciembre?: 'PAGADA' | 'EN_VERIFICACION' | 'NINGUNA';
}

/**
 * Llena, como dueño de las tablas, todo lo que el panel NO debe mostrar: la ficha médica, el apoderado, el teléfono, el correo y la dirección del alumno, su foto, un
 * consentimiento con su versión y su dirección IP, un ajuste de monto con su motivo, un Yape pendiente con su número de operación y su comprobante, un pago rechazado con
 * su motivo y una asistencia posterior con su motivo. Todo con textos únicos para buscarlos en las respuestas. Devuelve esos textos y los identificadores.
 */
export async function sembrarDatosSensibles(
  esc: EscenarioDeAsistencia,
  alumno: AlumnoDeAsistencia,
  opciones: OpcionesDeDatosSensibles,
): Promise<DatosSembrados> {
  const { n, conApoderado = false, diciembre = 'EN_VERIFICACION' } = opciones;
  const academiaId = alumno.academiaId;
  const contexto = { academiaId };
  const textos: string[] = [];
  const identificadores: string[] = [
    alumno.alumnoId,
    alumno.usuarioId,
    alumno.matriculaId,
    alumno.solicitudId,
    alumno.claseId,
    esc.e.plan.id,
    esc.e.secretariaA.id,
    esc.e.entrenadorA.id,
    alumno.codigoSolicitud,
    alumno.tokenSeguimiento,
    alumno.token,
  ];

  // El alumno: teléfono, correo, dirección y foto.
  const telefono = `TEL-ALUMNO-UNICO-${n}`;
  const correo = `alumno.unico${n}@ejemplo.invalid`;
  const direccion = `Jr. Direccion Unica ${n} Zq`;
  const fotoClave = `academias/${academiaId}/alumnos/foto-unica-${n}.jpg`;
  await ejecutarComo(
    'propietario',
    `UPDATE alumnos SET telefono = $3, correo = $4, direccion = $5, foto_clave = $6 WHERE academia_id = $1::uuid AND id = $2::uuid`,
    [academiaId, alumno.alumnoId, telefono, correo, direccion, fotoClave],
    contexto,
  );
  textos.push(telefono, correo, direccion, fotoClave);

  // El apoderado.
  if (conApoderado) {
    const apoderado = {
      nombres: `ApodNombre${n}Zq`,
      apellidos: `ApodApellido${n}Zq`,
      dni: `30${dosCifras(n)}${dosCifras(n)}01`,
      telefono: `TEL-APODERADO-UNICO-${n}`,
      correo: `apoderado.unico${n}@ejemplo.invalid`,
    };
    await ejecutarComo(
      'propietario',
      `UPDATE apoderados SET nombres = $3, apellidos = $4, dni = $5, telefono = $6, correo = $7
        WHERE academia_id = $1::uuid AND alumno_id = $2::uuid`,
      [
        academiaId,
        alumno.alumnoId,
        apoderado.nombres,
        apoderado.apellidos,
        apoderado.dni,
        apoderado.telefono,
        apoderado.correo,
      ],
      contexto,
    );
    textos.push(...Object.values(apoderado));
  }

  // La ficha médica y el contacto de emergencia.
  const ficha = {
    enfermedades: `ENFERMEDAD-UNICA-${n}`,
    alergias: `ALERGIA-UNICA-${n}`,
    medicamentos: `MEDICAMENTO-UNICO-${n}`,
    seguro: `SEGURO-UNICO-${n}`,
    contactoNombre: `CONTACTO-EMERGENCIA-UNICO-${n}`,
    contactoTelefono: `TEL-EMERGENCIA-UNICO-${n}`,
  };
  await ejecutarComo(
    'propietario',
    `UPDATE fichas_medicas SET enfermedades = $3, alergias = $4, medicamentos = $5, seguro = $6,
            contacto_emergencia_nombre = $7, contacto_emergencia_telefono = $8
      WHERE academia_id = $1::uuid AND alumno_id = $2::uuid`,
    [
      academiaId,
      alumno.alumnoId,
      ficha.enfermedades,
      ficha.alergias,
      ficha.medicamentos,
      ficha.seguro,
      ficha.contactoNombre,
      ficha.contactoTelefono,
    ],
    contexto,
  );
  textos.push(...Object.values(ficha));

  // Un consentimiento más (el de la imagen), con su versión y su dirección IP.
  const versionDelConsentimiento = `CONSENTIMIENTO-VERSION-UNICA-${n}`;
  const ipDelConsentimiento = `198.51.100.${100 + n}`;
  await insertarFila('propietario', 'consentimientos', academiaId, {
    ...(await filaValida('consentimientos', { alumnoId: alumno.alumnoId, solicitudId: alumno.solicitudId })),
    tipo: 'IMAGEN',
    version: versionDelConsentimiento,
    ip: ipDelConsentimiento,
  });
  textos.push(versionDelConsentimiento, ipDelConsentimiento);

  // El ajuste de monto de la matrícula de noviembre, con su motivo.
  const motivoDelAjuste = `MOTIVO-AJUSTE-UNICO-${n}`;
  await ejecutarComo(
    'propietario',
    `UPDATE matriculas SET monto_ajustado = 88.50, motivo_ajuste = $3 WHERE academia_id = $1::uuid AND id = $2::uuid`,
    [academiaId, alumno.matriculaId, motivoDelAjuste],
    contexto,
  );
  textos.push(motivoDelAjuste, '88.5');

  // Una asistencia posterior con su motivo y quién la registró.
  const motivoPosterior = `MOTIVO-POSTERIOR-UNICO-${n}`;
  const llegada = new Date('2026-11-02T23:04:00.000Z');
  await insertarAsistencia(
    'propietario',
    academiaId,
    filaAsistenciaValida(
      {
        alumnoId: alumno.alumnoId,
        matriculaId: alumno.matriculaId,
        claseId: alumno.claseId,
        usuarioId: esc.e.secretariaA.id,
      },
      {
        fecha: '2026-11-02',
        llegada_en: llegada,
        registrado_en: new Date('2026-11-02T23:40:00.000Z'),
        metodo: 'MANUAL',
        registro_posterior: true,
        motivo: motivoPosterior,
      },
    ),
  );
  textos.push(motivoPosterior);

  // Diciembre: pagada, o en verificación con un Yape pendiente (y un pago rechazado antes).
  if (diciembre !== 'NINGUNA') {
    const matriculaId = randomUUID();
    await insertarFila('propietario', 'matriculas', academiaId, {
      id: matriculaId,
      alumno_id: alumno.alumnoId,
      plan_id: esc.e.plan.id,
      anio: 2026,
      mes: 12,
      fecha_inicio: '2026-12-01',
      fecha_fin: '2026-12-31',
      clases_totales: 12,
      clases_usadas: 0,
      es_proporcional: false,
      precio_plan: '120.00',
      clases_por_mes_plan: 12,
      monto_calculado: '120.00',
      estado: diciembre === 'PAGADA' ? 'VIGENTE' : 'RESERVADA',
      reserva_vence_en: null,
      creado_en: new Date('2026-11-11T15:00:00.000Z'),
      actualizado_en: new Date('2026-11-11T15:00:00.000Z'),
    });
    await insertarFila('propietario', 'matricula_clases', academiaId, {
      matricula_id: matriculaId,
      clase_id: opciones.claseId ?? alumno.claseId,
    });
    identificadores.push(matriculaId);
    if (diciembre === 'EN_VERIFICACION') {
      const motivoDelRechazo = `MOTIVO-RECHAZO-UNICO-${n}`;
      const rechazado = filaPagoValida(
        academiaId,
        { alumnoId: alumno.alumnoId, matriculaId, usuarioId: esc.e.secretariaA.id },
        { metodo: 'YAPE', estado: 'RECHAZADO' },
        {
          motivo_rechazo: motivoDelRechazo,
          numero_operacion: `OPREC${n}X91`,
          numero_operacion_normalizado: `OPREC${n}X91`,
        },
      );
      await insertarPago('propietario', academiaId, rechazado);
      const numero = `OPYAPE${n}K77Q`;
      const comprobante = `COMPROBANTE-UNICO-${n}`;
      const pendiente = filaPagoValida(
        academiaId,
        { alumnoId: alumno.alumnoId, matriculaId },
        { metodo: 'YAPE', estado: 'PENDIENTE_VERIFICACION', monto: '77.25' },
        {
          numero_operacion: numero,
          numero_operacion_normalizado: numero,
          comprobante_clave: `academias/${academiaId}/pagos/${randomUUID()}/${comprobante}.jpg`,
        },
      );
      await insertarPago('propietario', academiaId, pendiente);
      identificadores.push(rechazado['id'] as string, pendiente['id'] as string);
      textos.push(motivoDelRechazo, numero, comprobante, '77.25');
    }
  }
  return { textos, identificadores };
}

/** Cambia el nombre del plan de una academia (como dueño), para distinguir los planes de dos academias o de dos hermanos. */
export async function renombrarPlan(academiaId: string, planId: string, nombre: string): Promise<void> {
  await ejecutarComo(
    'propietario',
    'UPDATE planes SET nombre = $3 WHERE academia_id = $1::uuid AND id = $2::uuid',
    [academiaId, planId, nombre],
    { academiaId },
  );
}

/** Pone al apoderado de los dos alumnos el mismo DNI, nombre y teléfono (hermanos con el mismo apoderado). */
export async function unirApoderado(
  academiaId: string,
  alumnoIds: readonly string[],
  datos: { nombres: string; apellidos: string; dni: string; telefono: string },
): Promise<void> {
  for (const alumnoId of alumnoIds) {
    await ejecutarComo(
      'propietario',
      `UPDATE apoderados SET nombres = $3, apellidos = $4, dni = $5, telefono = $6
        WHERE academia_id = $1::uuid AND alumno_id = $2::uuid`,
      [academiaId, alumnoId, datos.nombres, datos.apellidos, datos.dni, datos.telefono],
      { academiaId },
    );
  }
}
