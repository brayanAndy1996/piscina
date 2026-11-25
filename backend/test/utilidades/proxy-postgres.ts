// spec: 005-inscripcion-publica (pruebas protegidas)
import net from 'node:net';

/**
 * Proxy TCP de prueba entre la API y PostgreSQL (criterio 61 de la 005b, decisión AB1-2). Escucha en `127.0.0.1` con un puerto efímero y
 * reenvía, por cada conexión, al servidor de la URL que se le pasa (la de `DATABASE_URL_APP`). Solo usa el protocolo de PostgreSQL: no
 * importa nada de la implementación y decide el corte por los mensajes, nunca por tiempos.
 *
 * Reconoce los mensajes iniciales sin tipo (`SSLRequest`, `GSSENCRequest`, `CancelRequest` y `StartupMessage`) y después los mensajes con
 * tipo del cliente (`Q`, `P`, `B`, …) y del servidor (`C`, `Z`, …). Marca una conexión cuando, dentro de su transacción actual, el cliente
 * envía un `UPDATE` de `alumnos` que menciona `foto_clave`. El primer `COMMIT` de una conexión marcada, con el proxy armado, dispara el
 * modo elegido:
 *
 * - `cortarTrasCommit`: reenvía el `COMMIT` y, cuando llega del servidor el `CommandComplete` con la etiqueta `COMMIT`, cierra las dos
 *   conexiones sin entregarlo a la API (la base ya confirmó).
 * - `cortarAntesDelCommit`: al ver el `COMMIT` del cliente, cierra las dos conexiones sin reenviarlo (PostgreSQL revierte la transacción).
 * - `caer`: corta como `cortarTrasCommit`, cierra todas las conexiones abiertas a través del proxy y rechaza las nuevas (las acepta y las
 *   cierra) hasta que la prueba llama a `restablecer()`.
 *
 * El criterio 64 (ronda 2 del ataque de la 005b, decisión AB2-1) suma un cuarto modo, sin cambiar los otros tres:
 *
 * - `retenerCommit`: actúa sobre el primer `COMMIT` de una conexión marcada. No lo reenvía: lo guarda junto con los mensajes del cliente
 *   que lo siguen hasta el `Sync` (`S`) incluido, si llegó como `Parse` (con `Q`, solo ese mensaje); cierra solo el lado de la API y deja
 *   abierta la conexión con el servidor, donde la transacción sigue abierta con sus bloqueos. Cuenta un corte. Mientras haya un `COMMIT`
 *   retenido, el cierre del lado de la API no cierra el del servidor. `pidRetenido` es el `pid` del proceso de PostgreSQL de esa conexión
 *   (el proxy lee el `BackendKeyData` que el servidor manda al iniciar). `liberar()` reenvía lo retenido y resuelve cuando llega el
 *   `CommandComplete` con la etiqueta `COMMIT`; `descartar()` cierra la conexión con el servidor sin reenviar nada (PostgreSQL revierte).
 *
 * Supone que la conexión local no va cifrada (si el servidor aceptara SSL, el proxy deja pasar los bytes sin interpretarlos y nunca corta).
 */
export type ModoDeCorte = 'cortarTrasCommit' | 'cortarAntesDelCommit' | 'caer' | 'retenerCommit';

const CODIGO_SSL = 80877103;
const CODIGO_GSSENC = 80877104;
const CODIGO_CANCELAR = 80877102;

/** Un `UPDATE` de `alumnos` que menciona `foto_clave` (con o sin esquema ni comillas). */
export const ACTUALIZA_FOTO = /\bUPDATE\s+(?:ONLY\s+)?(?:"?public"?\.)?"?alumnos"?\b[\s\S]*\bfoto_clave\b/i;
/** Un `INSERT` en `pagos` (la transacción de la subida del comprobante de la 007b), con o sin esquema ni comillas. */
export const INSERTA_PAGO = /\bINSERT\s+INTO\s+(?:"?public"?\.)?"?pagos"?\b/i;
const ES_COMMIT = /(?:^|;)\s*(?:COMMIT|END)(?:\s+(?:WORK|TRANSACTION))?\s*(?:;|$)/i;
const ES_ROLLBACK = /(?:^|;)\s*(?:ROLLBACK|ABORT)(?:\s+(?:WORK|TRANSACTION))?\s*(?:;|$)/i;
const ES_BEGIN = /^\s*(?:BEGIN|START\s+TRANSACTION)\b/i;

/** Una cadena terminada en cero que empieza en `desde`: su texto y la posición siguiente. */
function cadenaC(buffer: Buffer, desde: number): { texto: string; siguiente: number } {
  let fin = desde;
  while (fin < buffer.length && buffer[fin] !== 0) fin++;
  return { texto: buffer.subarray(desde, fin).toString('utf8'), siguiente: fin + 1 };
}

/** Una pareja de sockets: el del cliente (la API) y el del servidor (PostgreSQL), con lo que el proxy sabe de esa conexión. */
class Puente {
  private bufferCliente: Buffer = Buffer.alloc(0);
  private bufferServidor: Buffer = Buffer.alloc(0);
  private fase: 'inicio' | 'mensajes' | 'crudo' = 'inicio';
  private respuestasDeUnByte = 0;
  private readonly sentencias = new Map<string, string>();
  private marcada = false;
  private esperandoCommit: ModoDeCorte | null = null;
  /** Criterio 64: el `pid` del proceso de PostgreSQL de esta conexión (del `BackendKeyData`). */
  pidDelServidor: number | null = null;
  /** Criterio 64: los mensajes del `COMMIT` que se están reuniendo (el `COMMIT` y, si llegó como `Parse`, los que siguen hasta el `Sync`). */
  private capturado: Buffer[] | null = null;
  /** Criterio 64: el `COMMIT` retenido, completo, que `liberar()` reenvía. */
  private retenido: Buffer[] | null = null;
  private liberacion: { resolver: () => void; rechazar: (error: Error) => void } | null = null;
  private cerrada = false;
  private readonly servidorCerrado: Promise<void>;

  constructor(
    private readonly proxy: ProxyPostgres,
    readonly cliente: net.Socket,
    readonly servidor: net.Socket,
  ) {
    this.servidorCerrado = new Promise<void>((resolver) => servidor.once('close', () => resolver()));
    cliente.on('data', (datos: Buffer) => this.alRecibirDelCliente(datos));
    servidor.on('data', (datos: Buffer) => this.alRecibirDelServidor(datos));
    // Con un `COMMIT` retenido, el cierre del lado de la API no cierra el del servidor (la transacción sigue abierta con sus bloqueos).
    cliente.on('error', () => {
      if (!this.retenido) this.cerrar();
    });
    servidor.on('error', () => this.cerrar());
    cliente.on('close', () => {
      if (!this.retenido) this.cerrar();
    });
    servidor.on('close', () => this.cerrar());
  }

  /** `true` si el servidor aceptó SSL: desde ahí todo va cifrado y se reenvía sin interpretar. */
  private enModoCrudo(): boolean {
    return this.fase === 'crudo';
  }

  /** Cierra las dos conexiones (también la del servidor con un `COMMIT` retenido). */
  cerrar(): void {
    this.cerrada = true;
    this.cliente.destroy();
    this.servidor.destroy();
    this.proxy.olvidar(this);
    if (this.liberacion) {
      const { rechazar } = this.liberacion;
      this.liberacion = null;
      rechazar(
        new Error('La conexión con PostgreSQL se cerró antes de que llegara el CommandComplete del COMMIT retenido.'),
      );
    }
  }

  /** Criterio 64: reenvía al servidor lo retenido y resuelve cuando llega el `CommandComplete` `COMMIT`, ya cerrada la conexión. */
  liberar(): Promise<void> {
    const retenido = this.retenido;
    if (!retenido || this.cerrada) return Promise.reject(new Error('No hay ningún COMMIT retenido.'));
    return new Promise<void>((resolver, rechazar) => {
      this.liberacion = { resolver, rechazar };
      for (const mensaje of retenido) this.servidor.write(mensaje);
    });
  }

  /** Criterio 64: cierra la conexión con el servidor sin reenviar nada (PostgreSQL revierte) y resuelve cuando se cerró. */
  descartar(): Promise<void> {
    if (!this.retenido || this.cerrada) return Promise.reject(new Error('No hay ningún COMMIT retenido.'));
    this.cerrar();
    return this.servidorCerrado;
  }

  /** Termina de reunir el `COMMIT` retenido: cuenta el corte y cierra solo el lado de la API. */
  private retenerAhora(): void {
    this.retenido = this.capturado;
    this.capturado = null;
    this.bufferCliente = Buffer.alloc(0);
    this.proxy.registrarCorte();
    this.proxy.retener(this);
    this.cliente.destroy();
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Del cliente al servidor
  // ------------------------------------------------------------------------------------------------------------------

  private alRecibirDelCliente(datos: Buffer): void {
    if (this.fase === 'crudo') {
      this.servidor.write(datos);
      return;
    }
    this.bufferCliente = Buffer.concat([this.bufferCliente, datos]);
    for (;;) {
      if (this.enModoCrudo()) {
        if (this.bufferCliente.length > 0) this.servidor.write(this.bufferCliente);
        this.bufferCliente = Buffer.alloc(0);
        return;
      }
      const buffer = this.bufferCliente;
      if (this.fase === 'inicio') {
        if (buffer.length < 4) return;
        const largo = buffer.readInt32BE(0);
        if (largo < 4 || buffer.length < largo) return;
        const mensaje = buffer.subarray(0, largo);
        this.bufferCliente = buffer.subarray(largo);
        const codigo = largo >= 8 ? mensaje.readInt32BE(4) : 0;
        if (codigo === CODIGO_SSL || codigo === CODIGO_GSSENC) this.respuestasDeUnByte++;
        else if (codigo !== CODIGO_CANCELAR) this.fase = 'mensajes';
        this.servidor.write(mensaje);
        continue;
      }
      if (buffer.length < 5) return;
      const largo = buffer.readInt32BE(1);
      if (largo < 4 || buffer.length < 1 + largo) return;
      const tipo = String.fromCharCode(buffer[0] as number);
      const mensaje = buffer.subarray(0, 1 + largo);
      this.bufferCliente = buffer.subarray(1 + largo);
      if (!this.alMensajeDelCliente(tipo, mensaje.subarray(5), mensaje)) return;
    }
  }

  /** Procesa un mensaje con tipo del cliente. Devuelve `false` si la conexión se cerró y no hay que seguir. */
  private alMensajeDelCliente(tipo: string, cuerpo: Buffer, mensaje: Buffer): boolean {
    if (this.capturado) {
      // Criterio 64: el `COMMIT` llegó como `Parse`; se reúnen los mensajes siguientes hasta el `Sync` incluido.
      this.capturado.push(Buffer.from(mensaje));
      if (tipo !== 'S') return true;
      this.retenerAhora();
      return false;
    }
    let sql: string | undefined;
    if (tipo === 'Q') {
      sql = cadenaC(cuerpo, 0).texto;
    } else if (tipo === 'P') {
      const nombre = cadenaC(cuerpo, 0);
      sql = cadenaC(cuerpo, nombre.siguiente).texto;
      this.sentencias.set(nombre.texto, sql);
    } else if (tipo === 'B') {
      // Una sentencia ya preparada se vuelve a ejecutar sin mandar su texto: se busca por su nombre.
      const portal = cadenaC(cuerpo, 0);
      sql = this.sentencias.get(cadenaC(cuerpo, portal.siguiente).texto);
    }

    if (sql !== undefined) {
      // Una transacción nueva o un `ROLLBACK` quitan la marca; el `UPDATE` de la foto la pone.
      if (ES_BEGIN.test(sql) || ES_ROLLBACK.test(sql)) this.marcada = false;
      else if (this.proxy.marca.test(sql)) this.marcada = true;
      if (tipo !== 'B' && ES_COMMIT.test(sql)) {
        const modo = this.marcada ? this.proxy.tomarModo() : null;
        this.marcada = false;
        if (modo === 'cortarAntesDelCommit') {
          this.proxy.registrarCorte();
          this.cerrar();
          return false;
        }
        if (modo === 'retenerCommit') {
          this.capturado = [Buffer.from(mensaje)];
          if (tipo !== 'Q') return true;
          this.retenerAhora();
          return false;
        }
        if (modo) this.esperandoCommit = modo;
      }
    }
    this.servidor.write(mensaje);
    return true;
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Del servidor al cliente
  // ------------------------------------------------------------------------------------------------------------------

  private alRecibirDelServidor(datos: Buffer): void {
    if (this.fase === 'crudo') {
      this.cliente.write(datos);
      return;
    }
    this.bufferServidor = Buffer.concat([this.bufferServidor, datos]);
    for (;;) {
      if (this.enModoCrudo()) {
        if (this.bufferServidor.length > 0) this.cliente.write(this.bufferServidor);
        this.bufferServidor = Buffer.alloc(0);
        return;
      }
      const buffer = this.bufferServidor;
      if (buffer.length === 0) return;
      if (this.respuestasDeUnByte > 0) {
        // La respuesta a un SSLRequest o GSSENCRequest es un solo byte: `N` (no) o `S` (sí, y todo lo demás va cifrado).
        this.respuestasDeUnByte--;
        this.bufferServidor = buffer.subarray(1);
        if (buffer[0] !== 0x4e) this.fase = 'crudo';
        this.cliente.write(buffer.subarray(0, 1));
        continue;
      }
      if (buffer.length < 5) return;
      const largo = buffer.readInt32BE(1);
      if (largo < 4 || buffer.length < 1 + largo) return;
      const mensaje = buffer.subarray(0, 1 + largo);
      this.bufferServidor = buffer.subarray(1 + largo);
      // `BackendKeyData`: el `pid` del proceso de PostgreSQL de esta conexión (criterio 64).
      if (buffer[0] === 0x4b && largo === 12 && this.pidDelServidor === null)
        this.pidDelServidor = mensaje.readInt32BE(5);
      if (this.retenido) {
        this.alRespuestaDeLoRetenido(mensaje);
        continue;
      }
      if (this.esperandoCommit && buffer[0] === 0x43 /* C: CommandComplete */) {
        const etiqueta = cadenaC(mensaje.subarray(5), 0).texto;
        const modo = this.esperandoCommit;
        this.esperandoCommit = null;
        if (etiqueta.startsWith('COMMIT')) {
          // La base ya confirmó: se corta sin entregar la respuesta a la API.
          this.proxy.registrarCorte();
          if (modo === 'caer') this.proxy.caerTodo();
          else this.cerrar();
          return;
        }
      }
      this.cliente.write(mensaje);
    }
  }

  /** Criterio 64: lo que contesta el servidor después de `liberar()` no llega a nadie; solo se espera el `CommandComplete` `COMMIT`. */
  private alRespuestaDeLoRetenido(mensaje: Buffer): void {
    const liberacion = this.liberacion;
    if (!liberacion) return;
    if (mensaje[0] === 0x43 && cadenaC(mensaje.subarray(5), 0).texto.startsWith('COMMIT')) {
      this.liberacion = null;
      this.cerrar();
      void this.servidorCerrado.then(liberacion.resolver);
    } else if (mensaje[0] === 0x45) {
      this.liberacion = null;
      this.cerrar();
      liberacion.rechazar(new Error('El servidor respondió un error al COMMIT retenido.'));
    }
  }
}

export class ProxyPostgres {
  private readonly servidor: net.Server;
  private readonly puentes = new Set<Puente>();
  private modoArmado: ModoDeCorte | null = null;
  private caido = false;
  private totalDeCortes = 0;
  private cerrado = false;
  private puenteRetenido: Puente | null = null;
  /** El puerto en el que escucha (efímero), en `127.0.0.1`. */
  puerto = 0;

  private constructor(
    private readonly destino: { host: string; port: number },
    private readonly urlOriginal: URL,
    /** La sentencia que marca la transacción que se corta (por defecto, el `UPDATE` de `alumnos.foto_clave` de la 005b). */
    readonly marca: RegExp = ACTUALIZA_FOTO,
  ) {
    this.servidor = net.createServer((cliente) => this.alConectar(cliente));
  }

  /**
   * Levanta el proxy hacia el servidor de `urlDestino` (por ejemplo `DATABASE_URL_APP`). `opciones.marca` (007b) cambia la sentencia que
   * marca la transacción que se corta; sin ella, el comportamiento es el de la 005b (el `UPDATE` de `alumnos` con `foto_clave`).
   */
  static async iniciar(urlDestino: string, opciones: { marca?: RegExp } = {}): Promise<ProxyPostgres> {
    const url = new URL(urlDestino);
    const proxy = new ProxyPostgres({ host: url.hostname, port: Number(url.port || 5432) }, url, opciones.marca);
    await new Promise<void>((resolver, rechazar) => {
      proxy.servidor.once('error', rechazar);
      proxy.servidor.listen(0, '127.0.0.1', () => {
        proxy.servidor.off('error', rechazar);
        resolver();
      });
    });
    proxy.puerto = (proxy.servidor.address() as net.AddressInfo).port;
    return proxy;
  }

  /** La misma URL con el servidor y el puerto del proxy (solo cambia el puerto: usuario, clave y base siguen igual). */
  get url(): string {
    const url = new URL(this.urlOriginal.toString());
    url.hostname = '127.0.0.1';
    url.port = String(this.puerto);
    return url.toString();
  }

  /** Cuántas veces cortó (cada corte cuenta una vez, también el de `caer`). */
  get cortes(): number {
    return this.totalDeCortes;
  }

  /** El `pid` del proceso de PostgreSQL de la conexión con un `COMMIT` retenido (modo `retenerCommit`), o `null` si no hay ninguna. */
  get pidRetenido(): number | null {
    return this.puenteRetenido?.pidDelServidor ?? null;
  }

  /** Si el proxy está caído (rechaza las conexiones nuevas). */
  get estaCaido(): boolean {
    return this.caido;
  }

  /** Arma el proxy: actuará sobre el primer `COMMIT` de una conexión marcada. Se desarma solo al actuar. */
  armar(modo: ModoDeCorte): void {
    this.modoArmado = modo;
  }

  desarmar(): void {
    this.modoArmado = null;
  }

  /** Termina la caída del modo `caer` y desarma. No reinicia el contador de cortes. */
  restablecer(): void {
    this.caido = false;
    this.modoArmado = null;
  }

  reiniciarContador(): void {
    this.totalDeCortes = 0;
  }

  /**
   * Reenvía al servidor el `COMMIT` retenido y resuelve cuando llega su `CommandComplete` con la etiqueta `COMMIT`, ya cerrada esa conexión.
   * Rechaza si no hay nada retenido.
   */
  liberar(): Promise<void> {
    const puente = this.puenteRetenido;
    if (!puente) return Promise.reject(new Error('No hay ningún COMMIT retenido.'));
    return puente.liberar();
  }

  /** Cierra la conexión con el servidor sin reenviar el `COMMIT` (PostgreSQL revierte) y resuelve cuando se cerró. Rechaza si no hay nada retenido. */
  descartar(): Promise<void> {
    const puente = this.puenteRetenido;
    if (!puente) return Promise.reject(new Error('No hay ningún COMMIT retenido.'));
    return puente.descartar();
  }

  /** Cierra todas las conexiones abiertas, también las retenidas, y el servidor (siempre, también si la prueba falló). */
  async cerrar(): Promise<void> {
    if (this.cerrado) return;
    this.cerrado = true;
    for (const puente of [...this.puentes]) puente.cerrar();
    await new Promise<void>((resolver) => this.servidor.close(() => resolver()));
  }

  // Interno (lo usan los puentes).

  /** Toma el modo armado (y desarma) para el `COMMIT` que acaba de llegar. */
  tomarModo(): ModoDeCorte | null {
    const modo = this.modoArmado;
    this.modoArmado = null;
    return modo;
  }

  registrarCorte(): void {
    this.totalDeCortes++;
  }

  /** `caer`: cierra todas las conexiones abiertas y rechaza las nuevas hasta `restablecer()`. */
  caerTodo(): void {
    this.caido = true;
    for (const puente of [...this.puentes]) puente.cerrar();
  }

  /** `retenerCommit`: este puente tiene un `COMMIT` retenido. */
  retener(puente: Puente): void {
    this.puenteRetenido = puente;
  }

  olvidar(puente: Puente): void {
    this.puentes.delete(puente);
    if (this.puenteRetenido === puente) this.puenteRetenido = null;
  }

  private alConectar(cliente: net.Socket): void {
    if (this.caido || this.cerrado) {
      cliente.on('error', () => undefined);
      cliente.destroy();
      return;
    }
    const servidor = net.connect(this.destino);
    const puente = new Puente(this, cliente, servidor);
    this.puentes.add(puente);
  }
}

/**
 * Ejecuta `crear` con `DATABASE_URL_APP` apuntando al proxy (solo cambia el puerto) y restaura la variable en seguida, también si `crear`
 * falla. La aplicación toma la variable al crearse; las lecturas y escrituras de la prueba como dueño de las tablas no usan el proxy.
 */
export async function conUrlDeAppEnElProxy<T>(proxy: ProxyPostgres, crear: () => Promise<T>): Promise<T> {
  const original = process.env['DATABASE_URL_APP'];
  process.env['DATABASE_URL_APP'] = proxy.url;
  try {
    return await crear();
  } finally {
    if (original === undefined) delete process.env['DATABASE_URL_APP'];
    else process.env['DATABASE_URL_APP'] = original;
  }
}
