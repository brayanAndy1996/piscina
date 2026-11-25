// spec: 008-carnet-qr (pruebas protegidas)
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { urlAppPruebas, urlPropietarioPruebas } from '../../utilidades/base-datos';
import {
  type AlumnoConQr,
  type AppCarnet,
  carnetDe,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
  rutaCarnet,
} from '../../utilidades/escenario-carnet';
import {
  ACCION_FOTO_PANEL,
  prepararEscenarioFotoPanel,
  rutaFotoAlumno,
  rutaFotoSolicitud,
  sembrarCliente,
  subirFotoPanel,
} from '../../utilidades/escenario-foto-panel';
import type { SolicitudSembrada } from '../../utilidades/inscripciones';
import {
  AlmacenDeFallosDePrueba,
  archivosDelAlumno,
  existeArchivoDeClave,
  fotoClaveDe,
  leerArchivoDeClave,
  lineasJson,
  png,
} from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { conUrlDeAppEnElProxy, type ModoDeCorte, ProxyPostgres } from '../../utilidades/proxy-postgres';
import { contarAuditoria } from '../../utilidades/usuarios';

// Criterio 25 (crítico, criterios 61 y 64 de 005: «cualquier otro error sigue la confirmación incierta de los criterios 61 y 64 de 005, relectura de `foto_clave` con `FOR SHARE` y espera máxima de 5 s antes de borrar nada»): la transacción de escritura de la foto del
// panel puede fallar con el `COMMIT` ya aplicado en la base (la conexión se corta después de que PostgreSQL confirma y antes de que la respuesta llegue a la API) o con el `COMMIT` todavía en camino. El servicio no borra ningún archivo, relee `foto_clave` con el bloqueo de
// la fila del alumno y decide con lo que ve:
//   b1) quedó la clave nueva: 204 y se borra el archivo anterior;  b2) no quedó: se borra el archivo nuevo, el anterior no se toca y 500 ERROR_INTERNO;  b3) la relectura también falla: no se borra ningún archivo y 500 ERROR_INTERNO.
// En los tres casos queda un `warn` `'Confirmación de la foto incierta'` con la academia y `error: { tipo }`, sin el mensaje del error, la clave ni datos personales. Invariante: después de cualquier subida, `foto_clave` es nula o apunta a un archivo que existe en la
// carpeta de su academia. La transacción de la foto del panel lleva su auditoría (criterio 27): o se confirma con `foto_clave` o se revierte con ella; por eso, con la foto guardada hay una sola entrada `ALUMNO_FOTO_ACTUALIZADA`, y sin ella, ninguna.
// Pruebas deterministas con el proxy TCP de `proxy-postgres.ts`, que corta la conexión en un punto exacto del protocolo (la sentencia que marca la transacción es la de siempre: el `UPDATE` de `alumnos` con `foto_clave`); `retenerCommit` retiene el `COMMIT` con la transacción
// abierta en el servidor, y la espera de la relectura se comprueba con `pg_blocking_pids`.
//   Caso 1) cortarTrasCommit, en las dos rutas, con y sin foto anterior; Caso 2) cortarAntesDelCommit; Caso 3) caer; Caso 4) reintento limpio; Caso 5) COMMIT retenido: liberar (204) y descartar (500).
// Lectura estricta elegida: la espera de 5 s sin respuesta (b3 por lock_timeout) no se repite aquí: es la misma función de la foto de la 005b (DT-10) y la cubre la 005b; aquí se comprueba que las dos rutas del panel la usan con la confirmación y la auditoría suyas.

const MENSAJE_INCIERTO = 'Confirmación de la foto incierta';
const NIVEL_WARN = 40;
const LIMITE_DE_SEGURIDAD_MS = 15_000;
const MENSAJE_SIN_ESPERA = 'la relectura no esperó a la transacción original';

type Cual = 'alumno' | 'solicitud';
const CUALES: readonly Cual[] = ['alumno', 'solicitud'];
type RespuestaDeSubida = Awaited<ReturnType<typeof subirFotoPanel>>;

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

describe('la confirmación incierta de la foto del panel (criterio 25, criterios 61 y 64 de 005)', () => {
  let proxy: ProxyPostgres | undefined;
  let ctx: AppCarnet | undefined;
  let fallos: AlmacenDeFallosDePrueba | undefined;
  let vigia: pg.Client | undefined;
  let lineas: string[] = [];
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;
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
        crearAppCarnet({
          nivelRegistro: 'trace',
          destinoRegistro: destinoDeRegistro.destino,
          envolverAlmacen: (real) => {
            fallos = new AlmacenDeFallosDePrueba(real);
            return fallos;
          },
        }),
      );
      if (!fallos) throw new Error('No se pudo envolver el almacén de la prueba.');
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
    b.proxy.restablecer();
    b.proxy.reiniciarContador();
    esc = await prepararEscenarioFotoPanel(b.ctx);
    alumno = await crearAlumnoPorPago(b.ctx, esc);
    cliente = await sembrarCliente(esc);
    b.fallos.fallarGuardar = false;
    b.fallos.fallarBorrar = false;
    b.fallos.alGuardar = undefined;
    b.fallos.alBorrar = undefined;
    b.fallos.llamadas.length = 0;
    lineas.length = 0;
  });

  afterEach(async () => {
    // Nunca queda una conexión retenida abierta, tampoco si la prueba falló a medias.
    if (fallos) fallos.alGuardar = undefined;
    proxy?.desarmar();
    if (proxy && proxy.pidRetenido !== null) await proxy.descartar().catch(() => undefined);
  });

  afterAll(async () => {
    try {
      proxy?.restablecer();
      await vigia?.end().catch(() => undefined);
      await ctx?.cerrarTodo();
    } finally {
      await proxy?.cerrar();
    }
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------------------------------------------------

  const idDelAlumno = (cual: Cual) => (cual === 'alumno' ? alumno.alumnoId : cliente.alumnoId);
  const ruta = (cual: Cual) =>
    cual === 'alumno' ? rutaFotoAlumno(alumno.alumnoId) : rutaFotoSolicitud(cliente.solicitudId);
  const subir = (cual: Cual, cuerpo: Buffer = png(100, 100), plazoMs = 25_000) =>
    subirFotoPanel(banco().ctx, ruta(cual), { cookie: esc.cookies.secretaria, cuerpo, plazoMs });
  const claveDe = (cual: Cual) => fotoClaveDe(esc.e.A.id, idDelAlumno(cual));
  const archivos = (cual: Cual) =>
    archivosDelAlumno(banco().ctx.raiz, esc.e.A.id, idDelAlumno(cual)).sort((a, b) => a.localeCompare(b));
  const existe = (clave: string) => existeArchivoDeClave(banco().ctx.raiz, clave);
  const avisosInciertos = () => lineasJson(lineas).filter((linea) => linea['msg'] === MENSAJE_INCIERTO);
  const auditorias = () => contarAuditoria(esc.e.A.id, ACCION_FOTO_PANEL);

  /** Arma el proxy desde `guardar` del almacén: después de la comprobación previa y antes de la transacción de escritura. */
  const armarAlGuardar = (modo: ModoDeCorte) => {
    banco().fallos.alGuardar = () => {
      banco().proxy.armar(modo);
      return Promise.resolve();
    };
  };
  const desarmarAlGuardar = () => {
    banco().fallos.alGuardar = undefined;
    banco().proxy.desarmar();
  };

  /** El invariante, el `warn` sin secretos y ninguna línea con datos personales ni con la clave. */
  async function comprobarComun(opciones: { cual: Cual; avisos: number; claves: readonly string[] }): Promise<void> {
    const clave = await claveDe(opciones.cual);
    if (clave !== null) {
      expect(existe(clave), 'foto_clave apunta a un archivo que no existe (referencia rota)').toBe(true);
    }
    if (opciones.avisos > 0) {
      await esperarHasta(() => avisosInciertos().length >= opciones.avisos);
      const avisos = avisosInciertos();
      expect(avisos, `el registro técnico debía tener un warn '${MENSAJE_INCIERTO}' por subida incierta`).toHaveLength(
        opciones.avisos,
      );
      for (const aviso of avisos) {
        expect(aviso['level'], 'es un warn').toBe(NIVEL_WARN);
        expect(aviso['academiaId']).toBe(esc.e.A.id);
        const error = aviso['error'] as Record<string, unknown> | undefined;
        expect(error, 'el warn debe traer error: { tipo }').toBeDefined();
        expect(Object.keys(error ?? {}), 'solo el tipo del error, sin message, stack ni otras propiedades').toEqual([
          'tipo',
        ]);
        expect(typeof error?.['tipo']).toBe('string');
        const lineaDelAviso = JSON.stringify(aviso);
        for (const secreto of [alumno.dni, cliente.dni, 'Valeria', ...opciones.claves]) {
          expect(lineaDelAviso, `el warn lleva ${secreto}`).not.toContain(secreto);
        }
      }
    } else {
      expect(avisosInciertos(), 'una subida sin incertidumbre no debe registrar el warn').toHaveLength(0);
    }
    const texto = lineas.join('\n');
    for (const secreto of [alumno.dni, cliente.dni, ...opciones.claves]) {
      expect(texto, `alguna línea del registro lleva ${secreto}`).not.toContain(secreto);
    }
  }

  /** La primera foto `F1`, subida sin cortes. Devuelve su clave y deja el registro técnico vacío. */
  async function subirPrimeraFoto(cual: Cual): Promise<string> {
    const primera = await subir(cual, png(100, 100));
    expect(primera.status, primera.texto).toBe(204);
    const f1 = await claveDe(cual);
    expect(f1, 'la primera subida debía guardar la foto').not.toBeNull();
    lineas.length = 0;
    return f1 as string;
  }

  /** `true` si alguna sesión de la base espera un bloqueo que tiene la sesión `pid` (por `pg_blocking_pids`). */
  async function haySesionBloqueadaPor(pid: number): Promise<boolean> {
    const { rows } = await banco().vigia.query(
      'SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))',
      [pid],
    );
    return rows.length > 0;
  }

  interface SubidaRetenida {
    respuesta: RespuestaDeSubida;
    /** La sesión de la relectura se vio bloqueada por la transacción retenida antes de que la subida respondiera. */
    esperoElBloqueo: boolean;
    /** La subida ya había respondido cuando se llegó a ver (o no) la sesión bloqueada. */
    respondioAntes: boolean;
  }

  /**
   * Sube con el `COMMIT` de la transacción de escritura retenido por el proxy. La subida se envía sin esperarla; se espera, con `pg_blocking_pids`,
   * a que alguna sesión quede bloqueada por `pidRetenido` o a que la subida responda. Entonces se libera o se descarta lo retenido.
   */
  async function subirConCommitRetenido(opciones: {
    cual: Cual;
    accion: 'liberar' | 'descartar';
    cuerpo?: Buffer;
  }): Promise<SubidaRetenida> {
    const b = banco();
    b.fallos.alGuardar = () => {
      b.proxy.armar('retenerCommit');
      return Promise.resolve();
    };
    const peticion = observar(subir(opciones.cual, opciones.cuerpo ?? png(140, 140)));
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
    if (b.proxy.pidRetenido !== null) {
      if (opciones.accion === 'liberar') await b.proxy.liberar();
      else await b.proxy.descartar();
    }
    if (limiteAlcanzado) {
      throw new Error(
        `Límite de seguridad (${LIMITE_DE_SEGURIDAD_MS} ms): la subida ni respondió ni quedó esperando el bloqueo de la transacción retenida.`,
      );
    }
    return { respuesta: await peticion.resultado, esperoElBloqueo, respondioAntes };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Caso 1: cortarTrasCommit (la base confirmó y la API no se entera)
  // -------------------------------------------------------------------------------------------------------------------

  describe('caso 1: cortarTrasCommit (la base confirmó y la API no se entera)', () => {
    it.each(CUALES)(
      'criterio 25 b1, ruta de la %s: al reemplazar la foto responde 204; foto_clave es una clave nueva y su archivo existe; el de F1 ya no; queda un solo archivo; una sola auditoría y el warn',
      async (cual) => {
        const f1 = await subirPrimeraFoto(cual);
        const auditoriasAntes = await auditorias();
        armarAlGuardar('cortarTrasCommit');

        const respuesta = await subir(cual, png(140, 140));
        desarmarAlGuardar();

        expect(banco().proxy.cortes, 'el proxy debía cortar una vez en el COMMIT').toBe(1);
        expect(respuesta.status, respuesta.texto).toBe(204);
        expect(respuesta.texto).toBe('');
        const f2 = (await claveDe(cual)) as string;
        expect(f2, 'la foto quedó guardada: foto_clave debe ser una clave nueva').not.toBeNull();
        expect(f2).not.toBe(f1);
        expect(existe(f2), 'foto_clave apunta a un archivo borrado').toBe(true);
        expect(existe(f1), 'el archivo anterior debía borrarse').toBe(false);
        expect(archivos(cual), 'en la carpeta del alumno debe quedar solo el archivo de foto_clave').toEqual([f2]);
        expect(await auditorias(), 'la transacción confirmó con su auditoría').toBe(auditoriasAntes + 1);
        await comprobarComun({ cual, avisos: 1, claves: [f1, f2] });
      },
    );

    it('criterio 25 b1: lo mismo cuando la primera subida es la cortada: 204, foto_clave con su archivo, un solo archivo y el carnet del alumno muestra esa foto', async () => {
      armarAlGuardar('cortarTrasCommit');

      const respuesta = await subir('alumno', png(120, 120));
      desarmarAlGuardar();

      expect(banco().proxy.cortes).toBe(1);
      expect(respuesta.status, respuesta.texto).toBe(204);
      const clave = (await claveDe('alumno')) as string;
      expect(clave, 'la foto quedó guardada: foto_clave no puede ser nula').not.toBeNull();
      expect(existe(clave), 'foto_clave apunta a un archivo borrado').toBe(true);
      expect(archivos('alumno')).toEqual([clave]);
      expect(await auditorias()).toBe(1);
      const carnet = carnetDe(
        await banco().ctx.http.get(rutaCarnet(alumno.alumnoId), { cookie: esc.cookies.secretaria }),
      );
      expect(carnet.foto).toBe(
        `data:image/jpeg;base64,${leerArchivoDeClave(banco().ctx.raiz, clave).toString('base64')}`,
      );
      await comprobarComun({ cual: 'alumno', avisos: 1, claves: [clave] });
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Caso 2: cortarAntesDelCommit (la base revierte)
  // -------------------------------------------------------------------------------------------------------------------

  describe('caso 2: cortarAntesDelCommit (la base revierte)', () => {
    it.each(CUALES)(
      'criterio 25 b2, ruta de la %s: responde 500 ERROR_INTERNO; foto_clave sigue siendo la de F1 y su archivo existe; queda solo ese archivo; ninguna auditoría nueva',
      async (cual) => {
        const f1 = await subirPrimeraFoto(cual);
        const auditoriasAntes = await auditorias();
        armarAlGuardar('cortarAntesDelCommit');

        const respuesta = await subir(cual, png(140, 140));
        desarmarAlGuardar();

        expect(banco().proxy.cortes, 'el proxy debía cortar una vez antes del COMMIT').toBe(1);
        expect(respuesta.status, respuesta.texto).toBe(500);
        expect(respuesta.body?.['codigo']).toBe('ERROR_INTERNO');
        expect(await claveDe(cual)).toBe(f1);
        expect(existe(f1), 'el archivo de F1 debía seguir en el disco').toBe(true);
        expect(archivos(cual), 'el archivo nuevo debía borrarse y el anterior quedar solo').toEqual([f1]);
        expect(await auditorias(), 'la transacción se revirtió con su auditoría').toBe(auditoriasAntes);
        await comprobarComun({ cual, avisos: 1, claves: [f1] });
      },
    );

    it('criterio 25 b2: sin foto anterior, la subida cortada antes del COMMIT responde 500 y no deja ni foto_clave ni archivos', async () => {
      armarAlGuardar('cortarAntesDelCommit');

      const respuesta = await subir('alumno');
      desarmarAlGuardar();

      expect(respuesta.status, respuesta.texto).toBe(500);
      expect(await claveDe('alumno')).toBeNull();
      expect(archivos('alumno')).toEqual([]);
      expect(await auditorias()).toBe(0);
      await comprobarComun({ cual: 'alumno', avisos: 1, claves: [] });
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Caso 3: caer (la base confirmó y la API ya no puede releer)
  // -------------------------------------------------------------------------------------------------------------------

  describe('caso 3: caer (la base confirmó y la API ya no puede releer)', () => {
    it('criterio 25 b3: responde 500 ERROR_INTERNO sin borrar nada: con el proxy restablecido, foto_clave es la clave nueva y su archivo existe, y el de F1 sigue en el disco', async () => {
      const f1 = await subirPrimeraFoto('alumno');
      armarAlGuardar('caer');

      // Plazo amplio: el resultado no depende del tiempo (la relectura puede tardar hasta la espera de conexión).
      const respuesta = await subir('alumno', png(140, 140), 60_000);
      desarmarAlGuardar();
      const cortes = banco().proxy.cortes;
      banco().proxy.restablecer();

      expect(cortes, 'el proxy debía cortar una vez en el COMMIT').toBe(1);
      expect(respuesta.status, respuesta.texto).toBe(500);
      expect(respuesta.body?.['codigo']).toBe('ERROR_INTERNO');
      const f2 = (await claveDe('alumno')) as string;
      expect(f2, 'la foto quedó guardada: foto_clave debe ser una clave nueva').not.toBeNull();
      expect(f2).not.toBe(f1);
      expect(existe(f2), 'se borró el archivo nuevo sin saber si la foto quedó').toBe(true);
      expect(existe(f1), 'se borró el archivo anterior sin saber si la foto quedó').toBe(true);
      expect(archivos('alumno')).toEqual([f1, f2].sort((a, b) => a.localeCompare(b)));
      await comprobarComun({ cual: 'alumno', avisos: 1, claves: [f1, f2] });
    }, 120_000);
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Caso 4: reintento limpio
  // -------------------------------------------------------------------------------------------------------------------

  describe('caso 4: reintento limpio tras una confirmación incierta', () => {
    it('criterio 25: después del caso 1, una subida F3 sin cortes responde 204 y en la carpeta del alumno queda exactamente un archivo, el de F3, sin avisos', async () => {
      const f1 = await subirPrimeraFoto('alumno');
      armarAlGuardar('cortarTrasCommit');
      const cortada = await subir('alumno', png(140, 140));
      desarmarAlGuardar();
      expect(banco().proxy.cortes).toBe(1);
      expect(cortada.status, cortada.texto).toBe(204);
      const f2 = (await claveDe('alumno')) as string;
      expect(f2).not.toBe(f1);
      lineas.length = 0;

      const reintento = await subir('alumno', png(160, 160));

      expect(reintento.status, reintento.texto).toBe(204);
      const f3 = (await claveDe('alumno')) as string;
      expect(f3).not.toBe(f2);
      expect(existe(f3)).toBe(true);
      expect(archivos('alumno'), 'el reintento arrastra restos').toEqual([f3]);
      await comprobarComun({ cual: 'alumno', avisos: 0, claves: [f1, f2, f3] });
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Caso 5: el COMMIT llega tarde (criterio 64 de 005): la relectura espera con FOR SHARE
  // -------------------------------------------------------------------------------------------------------------------

  describe('caso 5: el COMMIT retenido (la relectura espera al bloqueo de la fila del alumno)', () => {
    it.each(CUALES)(
      'criterio 25 (64 de 005 b1), ruta de la %s: la relectura espera al COMMIT retenido; tras liberar responde 204, foto_clave es una clave nueva con su archivo, el de F1 ya no y queda un solo archivo',
      async (cual) => {
        const f1 = await subirPrimeraFoto(cual);

        const resultado = await subirConCommitRetenido({ cual, accion: 'liberar' });

        expect(resultado.esperoElBloqueo, MENSAJE_SIN_ESPERA).toBe(true);
        expect(resultado.respondioAntes, MENSAJE_SIN_ESPERA).toBe(false);
        expect(banco().proxy.cortes, 'el proxy debía retener una vez el COMMIT').toBe(1);
        expect(resultado.respuesta.status, resultado.respuesta.texto).toBe(204);
        expect(resultado.respuesta.texto).toBe('');
        const f2 = (await claveDe(cual)) as string;
        expect(f2, 'la foto quedó guardada: foto_clave no puede ser nula').not.toBeNull();
        expect(f2).not.toBe(f1);
        expect(existe(f2), 'foto_clave apunta a un archivo borrado').toBe(true);
        expect(existe(f1), 'el archivo anterior debía borrarse').toBe(false);
        expect(archivos(cual), 'en la carpeta del alumno debe quedar solo el archivo de foto_clave').toEqual([f2]);
        expect(await auditorias(), 'la transacción retenida confirmó con su auditoría').toBe(2);
        await comprobarComun({ cual, avisos: 1, claves: [f1, f2] });
      },
      60_000,
    );

    it('criterio 25 (64 de 005 b2): la relectura espera; tras descartar responde 500 ERROR_INTERNO, foto_clave sigue siendo la de F1 y su archivo existe, y queda solo ese archivo', async () => {
      const f1 = await subirPrimeraFoto('alumno');
      const auditoriasAntes = await auditorias();

      const resultado = await subirConCommitRetenido({ cual: 'alumno', accion: 'descartar' });

      expect(resultado.esperoElBloqueo, MENSAJE_SIN_ESPERA).toBe(true);
      expect(resultado.respondioAntes, MENSAJE_SIN_ESPERA).toBe(false);
      expect(banco().proxy.cortes, 'el proxy debía retener una vez el COMMIT').toBe(1);
      expect(resultado.respuesta.status, resultado.respuesta.texto).toBe(500);
      expect(resultado.respuesta.body?.['codigo']).toBe('ERROR_INTERNO');
      expect(await claveDe('alumno')).toBe(f1);
      expect(existe(f1), 'el archivo de F1 debía seguir en el disco').toBe(true);
      expect(archivos('alumno'), 'el archivo nuevo debía borrarse y el anterior quedar solo').toEqual([f1]);
      expect(await auditorias(), 'la transacción descartada no audita').toBe(auditoriasAntes);
      await comprobarComun({ cual: 'alumno', avisos: 1, claves: [f1] });
    }, 60_000);

    it('criterio 25: al terminar la relectura no queda ningún bloqueo: la subida siguiente del mismo alumno no espera y responde 204', async () => {
      await subirPrimeraFoto('alumno');
      await subirConCommitRetenido({ cual: 'alumno', accion: 'liberar' });

      const siguiente = await subir('alumno', png(170, 170), 10_000);

      expect(siguiente.status, siguiente.texto).toBe(204);
      const clave = (await claveDe('alumno')) as string;
      expect(archivos('alumno')).toEqual([clave]);
    }, 60_000);
  });
});
