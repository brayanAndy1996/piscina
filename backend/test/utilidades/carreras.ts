// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { urlPropietarioPruebas } from './base-datos';

/**
 * Utilidades de las pruebas de carrera de la historia 002 (criterios 56 y 57, ataque ronda 2). Sin esperas fijas: la prueba abre su
 * propia transacción, retiene la fila del actor sin confirmar, envía la petición sin esperarla y, con `pg_blocking_pids`, detecta
 * que la conexión de la API quedó esperando el bloqueo (o que la petición respondió) antes de confirmar o revertir. El límite de
 * seguridad solo evita que una prueba se cuelgue; no es una espera: si se alcanza, la prueba falla con un mensaje claro.
 *
 * Solo usan SQL y HTTP: no importan nada de la implementación. Las conexiones propias usan el rol dueño y fijan el contexto de la
 * academia en la transacción (sirve con un dueño superusuario y con uno que no lo es, con la RLS forzada).
 */

/** Límite de seguridad (ms) de cualquier espera de una carrera. */
export const LIMITE_DE_SEGURIDAD_MS = 15_000;

/** Lo que la transacción de la prueba hace sobre la fila del actor mientras retiene su bloqueo. */
export type CambioDelActor =
  /** `estado = 'INACTIVO'` y `version_token + 1`: una desactivación. */
  | 'desactivar'
  /** Solo `version_token + 1`: un cierre de sesión en otro dispositivo. */
  | 'solo-version'
  /** Solo `debe_cambiar_clave = true`: un restablecimiento pendiente de cambio. */
  | 'solo-cambio-pendiente'
  /** `SELECT … FOR UPDATE` sin cambiar nada (el caso de control). */
  | 'bloquear-sin-cambiar';

const SQL_DEL_CAMBIO: Record<CambioDelActor, string> = {
  desactivar: `UPDATE usuarios SET estado = 'INACTIVO'::estado_usuario, version_token = version_token + 1
                WHERE academia_id = $1::uuid AND id = $2::uuid`,
  'solo-version': `UPDATE usuarios SET version_token = version_token + 1 WHERE academia_id = $1::uuid AND id = $2::uuid`,
  'solo-cambio-pendiente': `UPDATE usuarios SET debe_cambiar_clave = true WHERE academia_id = $1::uuid AND id = $2::uuid`,
  'bloquear-sin-cambiar': `SELECT id FROM usuarios WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
};

export interface RespuestaHttp {
  status: number;
  body: { codigo?: string; mensaje?: string; detalles?: unknown; usuario?: { id?: string; estado?: string } } | null;
}

/** Cliente HTTP sobre la aplicación escuchando en un puerto efímero (las peticiones se pueden lanzar sin esperar). */
export interface ClienteHttp {
  /** `POST` con cuerpo JSON y la cabecera `Cookie`. Devuelve el estado y el cuerpo ya leído. */
  post(ruta: string, cookie: string, cuerpo: unknown): Promise<RespuestaHttp>;
  cerrar(): Promise<void>;
}

function leerCuerpo(texto: string): RespuestaHttp['body'] {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as RespuestaHttp['body'];
  } catch {
    return null;
  }
}

/** Pone la aplicación a escuchar en `127.0.0.1` con un puerto libre (portable a Windows). La aplicación se cierra con `cerrar()`. */
export async function escucharAplicacion(app: NestExpressApplication): Promise<ClienteHttp> {
  await app.listen(0, '127.0.0.1');
  const direccion = app.getHttpServer().address() as { port: number };
  const base = `http://127.0.0.1:${direccion.port}`;
  return {
    async post(ruta, cookie, cuerpo) {
      const respuesta = await fetch(`${base}${ruta}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const texto = await respuesta.text();
      return { status: respuesta.status, body: leerCuerpo(texto) };
    },
    async cerrar() {
      await app.close();
    },
  };
}

/**
 * Sesiones cuya cadena de bloqueos llega al `pid` de la prueba: las bloqueadas directamente por ella y, transitivamente, las que
 * esperan a una de esas (por ejemplo, el candado de tupla que la segunda petición pide a la primera cuando ambas quieren la misma
 * fila). `UNION` descarta repetidos y corta cualquier ciclo. Las esperas ajenas al bloqueo de la prueba no entran.
 */
const SQL_SESIONES_EN_LA_CADENA = `
  WITH RECURSIVE cadena(pid) AS (
    SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
    UNION
    SELECT a.pid FROM pg_stat_activity a JOIN cadena c ON c.pid = ANY(pg_blocking_pids(a.pid))
  )
  SELECT count(*)::int AS n FROM cadena`;

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/** Espera `promesa` con el límite de seguridad; el temporizador se cancela al terminar. */
async function conLimite<T>(promesa: Promise<T>, mensaje: string): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  const vencido = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(mensaje)), LIMITE_DE_SEGURIDAD_MS);
  });
  try {
    return await Promise.race([promesa, vencido]);
  } finally {
    clearTimeout(temporizador);
  }
}

/** Observa una promesa sin consumirla: `terminada()` dice si ya se resolvió o rechazó. */
function observar<T>(promesa: Promise<T>): { terminada: () => boolean; resultado: Promise<T> } {
  let terminada = false;
  const resultado = promesa.finally(() => {
    terminada = true;
  });
  // Evita un rechazo sin atender si la prueba falla antes de esperar el resultado.
  resultado.catch(() => undefined);
  return { terminada: () => terminada, resultado };
}

async function conectar(): Promise<pg.Client> {
  const cliente = new pg.Client({ connectionString: urlPropietarioPruebas() });
  await cliente.connect();
  return cliente;
}

async function abrirTransaccion(cliente: pg.Client, academiaId: string): Promise<number> {
  await cliente.query('BEGIN');
  await cliente.query("SELECT set_config('app.academia_id', $1, true)", [academiaId]);
  const { rows } = await cliente.query('SELECT pg_backend_pid() AS pid');
  return (rows[0] as { pid: number }).pid;
}

async function cerrarSinFallar(cliente: pg.Client): Promise<void> {
  await cliente.query('ROLLBACK').catch(() => undefined);
  await cliente.end().catch(() => undefined);
}

export interface ResultadoDeCarrera<T> {
  /** Lo que respondió la petición, después de confirmar o revertir la transacción de la prueba. */
  resultado: T;
  /**
   * `true` si, antes de que llegara la respuesta, la conexión de la API quedó esperando el bloqueo de la prueba (su `pid` estaba en
   * `pg_blocking_pids` de otra conexión). `false` si la petición respondió sin esperar nunca.
   */
  esperoElBloqueo: boolean;
}

/**
 * Criterio 56: retiene la fila de `actorId` en una transacción propia y sin confirmar (con `cambio`), envía la petición
 * (`enviar`, que NO se espera antes), espera a que ocurra una de dos cosas (la API queda esperando el bloqueo o llega la respuesta),
 * y entonces confirma (`COMMIT`) o revierte (`ROLLBACK`) y devuelve la respuesta. La petición debe pasar por el middleware con la
 * fila como estaba confirmada (su lectura no ve lo que la prueba no confirmó).
 */
export async function conFilaRetenida<T>(opciones: {
  academiaId: string;
  actorId: string;
  cambio: CambioDelActor;
  liberar: 'COMMIT' | 'ROLLBACK';
  enviar: () => Promise<T>;
}): Promise<ResultadoDeCarrera<T>> {
  const retenedor = await conectar();
  const vigia = await conectar();
  try {
    const pidDeLaPrueba = await abrirTransaccion(retenedor, opciones.academiaId);
    await retenedor.query(SQL_DEL_CAMBIO[opciones.cambio], [opciones.academiaId, opciones.actorId]);

    const peticion = observar(opciones.enviar());
    let esperoElBloqueo = false;
    const limite = Date.now() + LIMITE_DE_SEGURIDAD_MS;
    let limiteAlcanzado = false;
    while (!peticion.terminada()) {
      const { rows } = await vigia.query(
        'SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))',
        [pidDeLaPrueba],
      );
      if (rows.length > 0) {
        esperoElBloqueo = true;
        break;
      }
      if (Date.now() > limite) {
        limiteAlcanzado = true;
        break;
      }
      await pausa(5);
    }

    await retenedor.query(opciones.liberar);
    if (limiteAlcanzado) {
      throw new Error(
        `Límite de seguridad (${LIMITE_DE_SEGURIDAD_MS} ms): la petición ni respondió ni quedó esperando el bloqueo de la fila.`,
      );
    }
    const resultado = await conLimite(
      peticion.resultado,
      'Límite de seguridad: la petición no respondió tras liberar el bloqueo.',
    );
    return { resultado, esperoElBloqueo };
  } finally {
    await cerrarSinFallar(retenedor);
    await cerrarSinFallar(vigia);
  }
}

/**
 * Criterio 57 (variante determinista): retiene con `SELECT … FOR UPDATE` las filas de `ids` (en una sola sentencia, en el orden de
 * `id`), envía las peticiones de `enviar` sin esperarlas, espera a que todas queden esperando el bloqueo de la prueba, directa o
 * transitivamente (con una sola sentencia `… ORDER BY id FOR UPDATE`, ambas piden primero la misma fila: una espera a la prueba y la
 * otra a esa primera petición), o a que alguna responda, revierte y devuelve las respuestas en el orden de `enviar`. Así las dos peticiones se cruzan siempre, sin depender de
 * tiempos.
 */
export async function conFilasRetenidas<T>(opciones: {
  academiaId: string;
  ids: string[];
  enviar: (() => Promise<T>)[];
}): Promise<{ resultados: T[]; todasEsperaron: boolean }> {
  const retenedor = await conectar();
  const vigia = await conectar();
  try {
    const pidDeLaPrueba = await abrirTransaccion(retenedor, opciones.academiaId);
    await retenedor.query(
      'SELECT id FROM usuarios WHERE academia_id = $1::uuid AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE',
      [opciones.academiaId, opciones.ids],
    );

    const peticiones = opciones.enviar.map((enviar) => observar(enviar()));
    let todasEsperaron = false;
    const limite = Date.now() + LIMITE_DE_SEGURIDAD_MS;
    let limiteAlcanzado = false;
    while (!peticiones.some((peticion) => peticion.terminada())) {
      const { rows } = await vigia.query(SQL_SESIONES_EN_LA_CADENA, [pidDeLaPrueba]);
      if ((rows[0] as { n: number }).n >= peticiones.length) {
        todasEsperaron = true;
        break;
      }
      if (Date.now() > limite) {
        limiteAlcanzado = true;
        break;
      }
      await pausa(5);
    }

    await retenedor.query('ROLLBACK');
    if (limiteAlcanzado) {
      throw new Error(
        `Límite de seguridad (${LIMITE_DE_SEGURIDAD_MS} ms): las peticiones ni respondieron ni quedaron esperando el bloqueo.`,
      );
    }
    const resultados = await conLimite(
      Promise.all(peticiones.map((peticion) => peticion.resultado)),
      'Límite de seguridad: las peticiones no respondieron tras liberar el bloqueo.',
    );
    return { resultados, todasEsperaron };
  } finally {
    await cerrarSinFallar(retenedor);
    await cerrarSinFallar(vigia);
  }
}
