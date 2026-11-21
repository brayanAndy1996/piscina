// spec: 005-inscripcion-publica (pruebas protegidas)
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { urlAppPruebas, urlPropietarioPruebas } from '../../utilidades/base-datos';
import {
  AHORA_005,
  crearEscenarioInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  rutaPublica,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import {
  AlmacenDeFallosDePrueba,
  type AppConAlmacen,
  archivosDelAlumno,
  crearAppConAlmacen,
  exigirAlmacen,
  existeArchivoDeClave,
  fotoClaveDe,
  lineasJson,
  png,
  subirFoto,
} from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { conUrlDeAppEnElProxy, ProxyPostgres } from '../../utilidades/proxy-postgres';
import { contarAuditoria } from '../../utilidades/usuarios';

// Criterio 64 (crítico, ronda 2 del ataque de la 005b, falla 1; amplía el 61 y cambia su punto b): la relectura de `foto_clave` que hace la API cuando
// la confirmación de la foto termina con un error incierto es una transacción nueva de la academia que fija `lock_timeout` en 5000 ms y lee la fila del
// alumno con `FOR SHARE`. Si el `COMMIT` de la transacción de confirmación todavía puede aplicarse (un segmento TCP retrasado, un `COMMIT` lento), esa
// transacción sigue abierta en el servidor con la fila bloqueada y la relectura espera a que confirme o revierta; lo que lee después es definitivo.
//   b1) con el bloqueo obtenido y la clave nueva: 204 y se borra la anterior; b2) si no es la nueva: se borra el archivo nuevo y 500 ERROR_INTERNO;
//   b3) si la espera se agota (55P03) o la relectura falla por otro motivo: no se borra ningún archivo y 500 ERROR_INTERNO.
//
// Pruebas deterministas con el proxy TCP de `proxy-postgres.ts`, que suma el modo `retenerCommit` (no reenvía el primer `COMMIT` de la conexión de la
// confirmación, cierra solo el lado de la API y deja la transacción abierta en el servidor; `pidRetenido`, `liberar()` y `descartar()`). La espera se
// comprueba con `pg_stat_activity` y `pg_blocking_pids`, sin depender de tiempos salvo el caso 3, que espera a que se agote el plazo.
//   Caso 1) el COMMIT llega tarde y confirma (`liberar`): 204 y un solo archivo, también sin F1;
//   Caso 2) el COMMIT no llega y la transacción se revierte (`descartar`): 500 y F1 intacta;
//   Caso 3) la espera se agota: 500 sin borrar nada; después, `liberar` (la clave nueva) o `descartar` (la de F1);
//   Caso 4) después de los casos 1 y 2, una subida F3 sin cortes responde 204 sin sesiones bloqueadas y deja un solo archivo;
//   Caso 5) el invariante, sin auditoría y un `warn` por subida retenida sin el token, en todos los casos.

const MENSAJE_INCIERTO = 'Confirmación de la foto incierta';
const MENSAJE_GUARDADA = 'Foto de la solicitud guardada';
const NIVEL_INFO = 30;
const NIVEL_WARN = 40;
/** Límite de seguridad (ms) de la espera de una sesión bloqueada: solo evita que la prueba se cuelgue, no es una espera. */
const LIMITE_DE_SEGURIDAD_MS = 15_000;
const MENSAJE_SIN_ESPERA = 'la relectura no esperó a la transacción original';

type RespuestaDeSubida = Awaited<ReturnType<typeof subirFoto>>;

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/** Observa una promesa sin consumirla: `terminada()` dice si ya se resolvió o rechazó. */
function observar<T>(promesa: Promise<T>): { terminada: () => boolean; resultado: Promise<T> } {
  let terminada = false;
  const resultado = promesa.finally(() => {
    terminada = true;
  });
  resultado.catch(() => undefined);
  return { terminada: () => terminada, resultado };
}

async function conectarComoDueno(): Promise<pg.Client> {
  const cliente = new pg.Client({ connectionString: urlPropietarioPruebas() });
  await cliente.connect();
  return cliente;
}

describe('la relectura espera a la transacción de confirmación (criterio 64)', () => {
  let proxy: ProxyPostgres | undefined;
  let ctx: AppConAlmacen | undefined;
  let fallos: AlmacenDeFallosDePrueba | undefined;
  let vigia: pg.Client | undefined;
  let lineas: string[] = [];
  let e: EscenarioInscripcion;
  let cliente: SolicitudSembrada;

  const banco = () => {
    if (!proxy || !ctx || !fallos || !vigia) throw new Error('La aplicación de la prueba no se levantó.');
    return { proxy, ctx, fallos, vigia };
  };

  beforeAll(async () => {
    const destinoDeRegistro = crearDestinoDeRegistro();
    lineas = destinoDeRegistro.lineas;
    try {
      proxy = await ProxyPostgres.iniciar(urlAppPruebas());
      const elProxy = proxy;
      ctx = await conUrlDeAppEnElProxy(elProxy, () =>
        crearAppConAlmacen({
          ahora: AHORA_005,
          nivelRegistro: 'trace',
          destinoRegistro: destinoDeRegistro.destino,
          envolver: (real) => {
            fallos = new AlmacenDeFallosDePrueba(real);
            return fallos;
          },
        }),
      );
      if (!fallos)
        throw new Error('No se pudo envolver el almacén de la prueba (¿falta el módulo del almacén de la 005b?).');
      vigia = await conectarComoDueno();
    } catch (error) {
      await vigia?.end().catch(() => undefined);
      await ctx?.cerrarTodo().catch(() => undefined);
      await proxy?.cerrar();
      throw error;
    }
  });

  beforeEach(async () => {
    const b = banco();
    exigirAlmacen(b.ctx);
    await exigirTablasDeInscripcion();
    b.ctx.reloj.fijar(AHORA_005);
    b.ctx.vaciarAlmacen();
    b.fallos.fallarGuardar = false;
    b.fallos.fallarBorrar = false;
    b.fallos.alGuardar = undefined;
    b.fallos.alBorrar = undefined;
    b.fallos.llamadas.length = 0;
    b.proxy.restablecer();
    b.proxy.reiniciarContador();
    lineas.length = 0;
    e = await crearEscenarioInscripcion();
    cliente = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
    });
  });

  afterEach(async () => {
    // Nunca queda una conexión retenida abierta, tampoco si la prueba falló a medias.
    if (fallos) fallos.alGuardar = undefined;
    proxy?.desarmar();
    if (proxy && proxy.pidRetenido !== null) await proxy.descartar().catch(() => undefined);
  });

  afterAll(async () => {
    try {
      await vigia?.end().catch(() => undefined);
      await ctx?.cerrarTodo();
    } finally {
      await proxy?.cerrar();
    }
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------------------------------------------------

  const subir = (cuerpo: Buffer = png(100, 100), plazoMs = 25_000) =>
    subirFoto(banco().ctx, 'academia-a', { token: cliente.token, cuerpo, plazoMs });
  const claveDeFoto = () => fotoClaveDe(e.A.id, cliente.alumnoId);
  const archivos = () =>
    archivosDelAlumno(banco().ctx.raiz, e.A.id, cliente.alumnoId).sort((a, b) => a.localeCompare(b));
  const existe = (clave: string) => existeArchivoDeClave(banco().ctx.raiz, clave);
  const vistaCompleta = () =>
    banco().ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { token: cliente.token });
  const avisosInciertos = () => lineasJson(lineas).filter((linea) => linea['msg'] === MENSAJE_INCIERTO);

  /** `true` si alguna sesión de la base espera un bloqueo que tiene la sesión `pid` (por `pg_blocking_pids`). */
  async function haySesionBloqueadaPor(pid: number): Promise<boolean> {
    const { rows } = await banco().vigia.query(
      'SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))',
      [pid],
    );
    return rows.length > 0;
  }

  /** `true` si alguna sesión de la base de pruebas está esperando un bloqueo de otra. */
  async function hayAlgunaSesionBloqueada(): Promise<boolean> {
    const { rows } = await banco().vigia.query(
      'SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0',
    );
    return rows.length > 0;
  }

  /** Que ya no quede ningún bloqueo sobre la fila del alumno: el dueño la toma con `FOR UPDATE NOWAIT` (55P03 si alguien la retiene). */
  async function exigirFilaSinBloqueos(): Promise<void> {
    const dueno = await conectarComoDueno();
    try {
      await dueno.query('BEGIN');
      await dueno.query("SELECT set_config('app.academia_id', $1, true)", [e.A.id]);
      await dueno.query('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE NOWAIT', [
        e.A.id,
        cliente.alumnoId,
      ]);
    } finally {
      await dueno.query('ROLLBACK').catch(() => undefined);
      await dueno.end().catch(() => undefined);
    }
  }

  interface SubidaRetenida {
    respuesta: RespuestaDeSubida;
    /** La sesión de la relectura se vio bloqueada por la transacción retenida antes de que la subida respondiera. */
    esperoElBloqueo: boolean;
    /** La subida ya había respondido cuando se llegó a ver (o no) la sesión bloqueada. */
    respondioAntes: boolean;
  }

  /**
   * Sube `cuerpo` con el `COMMIT` de la confirmación retenido por el proxy. La subida se envía sin esperarla; se espera, con
   * `pg_blocking_pids`, a que alguna sesión quede bloqueada por `pidRetenido` o a que la subida responda. Entonces:
   * - `liberar` / `descartar`: se aplica esa acción sobre lo retenido (también si la relectura no esperó, para no dejar nada abierto);
   * - `esperar`: no se hace nada hasta que la subida responda (lo hará al agotarse la espera), y la conexión sigue retenida.
   */
  async function subirConCommitRetenido(opciones: {
    accion: 'liberar' | 'descartar' | 'esperar';
    cuerpo?: Buffer;
    plazoMs?: number;
  }): Promise<SubidaRetenida> {
    const b = banco();
    b.fallos.alGuardar = () => {
      b.proxy.armar('retenerCommit');
      return Promise.resolve();
    };
    const peticion = observar(subir(opciones.cuerpo ?? png(140, 140), opciones.plazoMs));
    let esperoElBloqueo = false;
    let limiteAlcanzado = false;
    const limite = Date.now() + LIMITE_DE_SEGURIDAD_MS;
    while (!peticion.terminada()) {
      const pid = b.proxy.pidRetenido;
      if (pid !== null && (await haySesionBloqueadaPor(pid))) {
        esperoElBloqueo = true;
        break;
      }
      if (Date.now() > limite) {
        limiteAlcanzado = true;
        break;
      }
      await pausa(5);
    }
    const respondioAntes = peticion.terminada();
    b.fallos.alGuardar = undefined;
    b.proxy.desarmar();

    if (opciones.accion !== 'esperar' && b.proxy.pidRetenido !== null) {
      if (opciones.accion === 'liberar') await b.proxy.liberar();
      else await b.proxy.descartar();
    }
    if (limiteAlcanzado) {
      throw new Error(
        `Límite de seguridad (${LIMITE_DE_SEGURIDAD_MS} ms): la subida ni respondió ni quedó esperando el bloqueo de la transacción retenida.`,
      );
    }
    const respuesta = await peticion.resultado;
    return { respuesta, esperoElBloqueo, respondioAntes };
  }

  /** Caso 5: el invariante 61 c), nada en `auditoria`, el `warn` por cada subida retenida sin secretos y ninguna línea con el token. */
  async function comprobarComun(opciones: { subidasRetenidas: number; claves: readonly string[] }): Promise<void> {
    const clave = await claveDeFoto();
    if (clave !== null) {
      expect(existe(clave), 'foto_clave apunta a un archivo que no existe (referencia rota)').toBe(true);
    }
    expect(await contarAuditoria(e.A.id), 'una subida escribió en auditoria').toBe(0);
    expect(await contarAuditoria(e.B.id)).toBe(0);

    if (opciones.subidasRetenidas > 0) {
      await esperarHasta(() => avisosInciertos().length >= opciones.subidasRetenidas);
      const avisos = avisosInciertos();
      expect(avisos, `el registro técnico debía tener un warn '${MENSAJE_INCIERTO}' por subida retenida`).toHaveLength(
        opciones.subidasRetenidas,
      );
      for (const aviso of avisos) {
        expect(aviso['level'], 'es un warn').toBe(NIVEL_WARN);
        expect(aviso['academiaId']).toBe(e.A.id);
        const error = aviso['error'] as Record<string, unknown> | undefined;
        expect(error, 'el warn debe traer error: { tipo }').toBeDefined();
        expect(Object.keys(error ?? {}), 'solo el tipo del error, sin message, stack ni otras propiedades').toEqual([
          'tipo',
        ]);
        expect(typeof error?.['tipo']).toBe('string');
        const lineaDelAviso = JSON.stringify(aviso);
        for (const secreto of [cliente.token, cliente.dni, 'Valeria', ...opciones.claves]) {
          expect(lineaDelAviso, `el warn lleva ${secreto}`).not.toContain(secreto);
        }
      }
    } else {
      expect(avisosInciertos(), 'una subida sin incertidumbre no debe registrar el warn').toHaveLength(0);
    }
    expect(lineas.join('\n'), 'alguna línea del registro lleva el token').not.toContain(cliente.token);
  }

  /** La primera foto `F1`, subida sin cortes. Devuelve su clave y deja el registro técnico vacío. */
  async function subirPrimeraFoto(): Promise<string> {
    const primera = await subir(png(100, 100));
    expect(primera.status, primera.texto).toBe(204);
    const f1 = await claveDeFoto();
    expect(f1, 'la primera subida debía guardar la foto').not.toBeNull();
    lineas.length = 0;
    return f1 as string;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Caso 1: el COMMIT llega tarde y confirma
  // -------------------------------------------------------------------------------------------------------------------

  describe('caso 1: el COMMIT llega tarde y confirma', () => {
    it('criterio 64 b1: la relectura espera al COMMIT retenido; tras liberar responde 204, foto_clave es una clave nueva con su archivo, el de F1 ya no y queda un solo archivo', async () => {
      const f1 = await subirPrimeraFoto();

      const resultado = await subirConCommitRetenido({ accion: 'liberar' });

      expect(resultado.esperoElBloqueo, MENSAJE_SIN_ESPERA).toBe(true);
      expect(resultado.respondioAntes, MENSAJE_SIN_ESPERA).toBe(false);
      expect(banco().proxy.cortes, 'el proxy debía retener una vez el COMMIT').toBe(1);
      expect(resultado.respuesta.status, resultado.respuesta.texto).toBe(204);
      expect(resultado.respuesta.texto).toBe('');
      const f2 = await claveDeFoto();
      expect(f2, 'la foto quedó guardada: foto_clave no puede ser nula').not.toBeNull();
      expect(f2).not.toBe(f1);
      expect(existe(f2 as string), 'foto_clave apunta a un archivo borrado').toBe(true);
      expect(existe(f1), 'el archivo anterior debía borrarse').toBe(false);
      expect(archivos(), 'en la carpeta del alumno debe quedar solo el archivo de foto_clave').toEqual([f2]);
      const solicitud = (await vistaCompleta()).body?.['solicitud'] as Record<string, unknown>;
      expect(solicitud['fotoCargada']).toBe(true);
      await esperarHasta(() => lineasJson(lineas).some((linea) => linea['msg'] === MENSAJE_GUARDADA));
      const guardadas = lineasJson(lineas).filter((linea) => linea['msg'] === MENSAJE_GUARDADA);
      expect(guardadas, `debía registrarse el info '${MENSAJE_GUARDADA}'`).toHaveLength(1);
      expect(guardadas[0]?.['level']).toBe(NIVEL_INFO);
      expect(guardadas[0]?.['academiaId']).toBe(e.A.id);
      await comprobarComun({ subidasRetenidas: 1, claves: [f1, f2 as string] });
    }, 60_000);

    it('criterio 64 b1: lo mismo cuando la primera subida es la retenida (sin F1): 204, foto_clave con su archivo y un solo archivo', async () => {
      const resultado = await subirConCommitRetenido({ accion: 'liberar', cuerpo: png(120, 120) });

      expect(resultado.esperoElBloqueo, MENSAJE_SIN_ESPERA).toBe(true);
      expect(resultado.respondioAntes, MENSAJE_SIN_ESPERA).toBe(false);
      expect(banco().proxy.cortes, 'el proxy debía retener una vez el COMMIT').toBe(1);
      expect(resultado.respuesta.status, resultado.respuesta.texto).toBe(204);
      const clave = await claveDeFoto();
      expect(clave, 'la foto quedó guardada: foto_clave no puede ser nula').not.toBeNull();
      expect(existe(clave as string), 'foto_clave apunta a un archivo borrado').toBe(true);
      expect(archivos()).toEqual([clave]);
      const solicitud = (await vistaCompleta()).body?.['solicitud'] as Record<string, unknown>;
      expect(solicitud['fotoCargada']).toBe(true);
      await comprobarComun({ subidasRetenidas: 1, claves: [clave as string] });
    }, 60_000);
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Caso 2: el COMMIT no llega y la transacción se revierte
  // -------------------------------------------------------------------------------------------------------------------

  describe('caso 2: el COMMIT no llega y la transacción se revierte', () => {
    it('criterio 64 b2: la relectura espera; tras descartar responde 500 ERROR_INTERNO, foto_clave sigue siendo la de F1 y su archivo existe, y queda solo ese archivo', async () => {
      const f1 = await subirPrimeraFoto();

      const resultado = await subirConCommitRetenido({ accion: 'descartar' });

      expect(resultado.esperoElBloqueo, MENSAJE_SIN_ESPERA).toBe(true);
      expect(resultado.respondioAntes, MENSAJE_SIN_ESPERA).toBe(false);
      expect(banco().proxy.cortes, 'el proxy debía retener una vez el COMMIT').toBe(1);
      expect(resultado.respuesta.status, resultado.respuesta.texto).toBe(500);
      expect(resultado.respuesta.body?.['codigo']).toBe('ERROR_INTERNO');
      expect(await claveDeFoto()).toBe(f1);
      expect(existe(f1), 'el archivo de F1 debía seguir en el disco').toBe(true);
      expect(archivos(), 'el archivo nuevo debía borrarse y el anterior quedar solo').toEqual([f1]);
      await comprobarComun({ subidasRetenidas: 1, claves: [f1] });
    }, 60_000);
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Caso 3: la espera se agota
  // -------------------------------------------------------------------------------------------------------------------

  describe('caso 3: la espera se agota', () => {
    it('criterio 64 b3: sin liberar ni descartar, responde 500 ERROR_INTERNO sin borrar nada; después de liberar, foto_clave es la clave nueva y su archivo existe', async () => {
      const f1 = await subirPrimeraFoto();

      // Plazo amplio: la API responde cuando se agota `lock_timeout` (5 s); el resultado no depende de nada más.
      const resultado = await subirConCommitRetenido({ accion: 'esperar', plazoMs: 60_000 });

      expect(
        resultado.esperoElBloqueo,
        `antes de responder, la sesión de la relectura debía verse bloqueada (${MENSAJE_SIN_ESPERA})`,
      ).toBe(true);
      expect(resultado.respondioAntes, MENSAJE_SIN_ESPERA).toBe(false);
      expect(resultado.respuesta.status, resultado.respuesta.texto).toBe(500);
      expect(resultado.respuesta.body?.['codigo']).toBe('ERROR_INTERNO');
      expect(banco().proxy.cortes, 'el proxy debía retener una vez el COMMIT').toBe(1);
      const enElDisco = archivos();
      expect(enElDisco, 'no se debía borrar ningún archivo: siguen el de F1 y el nuevo').toHaveLength(2);
      expect(enElDisco).toContain(f1);

      await banco().proxy.liberar();
      const f2 = await claveDeFoto();
      expect(f2, 'el COMMIT retenido se aplicó: foto_clave es la clave nueva').not.toBeNull();
      expect(f2).not.toBe(f1);
      expect(existe(f2 as string), 'se borró el archivo nuevo sin saber si la foto quedó').toBe(true);
      expect(enElDisco).toContain(f2);
      await comprobarComun({ subidasRetenidas: 1, claves: [f1, f2 as string] });
    }, 120_000);

    it('criterio 64 b3: sin liberar ni descartar, responde 500 ERROR_INTERNO sin borrar nada; después de descartar, foto_clave es la de F1 y su archivo existe', async () => {
      const f1 = await subirPrimeraFoto();

      const resultado = await subirConCommitRetenido({ accion: 'esperar', plazoMs: 60_000 });

      expect(
        resultado.esperoElBloqueo,
        `antes de responder, la sesión de la relectura debía verse bloqueada (${MENSAJE_SIN_ESPERA})`,
      ).toBe(true);
      expect(resultado.respondioAntes, MENSAJE_SIN_ESPERA).toBe(false);
      expect(resultado.respuesta.status, resultado.respuesta.texto).toBe(500);
      expect(resultado.respuesta.body?.['codigo']).toBe('ERROR_INTERNO');
      const enElDisco = archivos();
      expect(enElDisco, 'no se debía borrar ningún archivo: siguen el de F1 y el nuevo').toHaveLength(2);
      expect(enElDisco).toContain(f1);
      const nueva = enElDisco.find((clave) => clave !== f1) as string;

      await banco().proxy.descartar();
      expect(await claveDeFoto()).toBe(f1);
      expect(existe(f1), 'el archivo de F1 debía seguir en el disco').toBe(true);
      await comprobarComun({ subidasRetenidas: 1, claves: [f1, nueva] });
    }, 120_000);
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Caso 4: sin bloqueos pendientes después de la relectura
  // -------------------------------------------------------------------------------------------------------------------

  describe('caso 4: la subida siguiente no espera', () => {
    /** Una subida F3 sin cortes: ninguna sesión queda bloqueada mientras dura, 204 y un solo archivo, el de F3. */
    async function subirTerceraSinEsperas(claveAnterior: string, claves: readonly string[]): Promise<void> {
      await exigirFilaSinBloqueos();
      lineas.length = 0;
      const peticion = observar(subir(png(160, 160)));
      let hubo = false;
      while (!peticion.terminada()) {
        if (await hayAlgunaSesionBloqueada()) hubo = true;
        await pausa(5);
      }
      const respuesta = await peticion.resultado;

      expect(hubo, 'la subida F3 dejó una sesión bloqueada: quedó algún bloqueo de la subida retenida').toBe(false);
      expect(respuesta.status, respuesta.texto).toBe(204);
      const f3 = await claveDeFoto();
      expect(f3).not.toBe(claveAnterior);
      expect(existe(f3 as string)).toBe(true);
      expect(archivos(), 'la subida F3 arrastra restos').toEqual([f3]);
      await exigirFilaSinBloqueos();
      await comprobarComun({ subidasRetenidas: 0, claves: [...claves, f3 as string] });
    }

    it('criterio 64 (caso 4): después del caso 1, una subida F3 sin cortes responde 204 sin que ninguna sesión quede bloqueada y deja exactamente un archivo, el de F3', async () => {
      const f1 = await subirPrimeraFoto();
      const retenida = await subirConCommitRetenido({ accion: 'liberar' });
      expect(retenida.esperoElBloqueo, MENSAJE_SIN_ESPERA).toBe(true);
      expect(retenida.respuesta.status, retenida.respuesta.texto).toBe(204);
      const f2 = (await claveDeFoto()) as string;
      expect(f2).not.toBe(f1);

      await subirTerceraSinEsperas(f2, [f1, f2]);
    }, 60_000);

    it('criterio 64 (caso 4): después del caso 2, una subida F3 sin cortes responde 204 sin que ninguna sesión quede bloqueada y deja exactamente un archivo, el de F3', async () => {
      const f1 = await subirPrimeraFoto();
      const retenida = await subirConCommitRetenido({ accion: 'descartar' });
      expect(retenida.esperoElBloqueo, MENSAJE_SIN_ESPERA).toBe(true);
      expect(retenida.respuesta.status, retenida.respuesta.texto).toBe(500);
      expect(await claveDeFoto()).toBe(f1);

      await subirTerceraSinEsperas(f1, [f1]);
    }, 60_000);
  });
});
