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
 * Supone que la conexión local no va cifrada (si el servidor aceptara SSL, el proxy deja pasar los bytes sin interpretarlos y nunca corta).
 */
export type ModoDeCorte = 'cortarTrasCommit' | 'cortarAntesDelCommit' | 'caer';

const CODIGO_SSL = 80877103;
const CODIGO_GSSENC = 80877104;
const CODIGO_CANCELAR = 80877102;

/** Un `UPDATE` de `alumnos` que menciona `foto_clave` (con o sin esquema ni comillas). */
const ACTUALIZA_FOTO = /\bUPDATE\s+(?:ONLY\s+)?(?:"?public"?\.)?"?alumnos"?\b[\s\S]*\bfoto_clave\b/i;
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

  constructor(
    private readonly proxy: ProxyPostgres,
    readonly cliente: net.Socket,
    readonly servidor: net.Socket,
  ) {
    cliente.on('data', (datos: Buffer) => this.alRecibirDelCliente(datos));
    servidor.on('data', (datos: Buffer) => this.alRecibirDelServidor(datos));
    cliente.on('error', () => this.cerrar());
    servidor.on('error', () => this.cerrar());
    cliente.on('close', () => this.cerrar());
    servidor.on('close', () => this.cerrar());
  }

  /** `true` si el servidor aceptó SSL: desde ahí todo va cifrado y se reenvía sin interpretar. */
  private enModoCrudo(): boolean {
    return this.fase === 'crudo';
  }

  cerrar(): void {
    this.cliente.destroy();
    this.servidor.destroy();
    this.proxy.olvidar(this);
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
      else if (ACTUALIZA_FOTO.test(sql)) this.marcada = true;
      if (tipo !== 'B' && ES_COMMIT.test(sql)) {
        const modo = this.marcada ? this.proxy.tomarModo() : null;
        this.marcada = false;
        if (modo === 'cortarAntesDelCommit') {
          this.proxy.registrarCorte();
          this.cerrar();
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
}

export class ProxyPostgres {
  private readonly servidor: net.Server;
  private readonly puentes = new Set<Puente>();
  private modoArmado: ModoDeCorte | null = null;
  private caido = false;
  private totalDeCortes = 0;
  private cerrado = false;
  /** El puerto en el que escucha (efímero), en `127.0.0.1`. */
  puerto = 0;

  private constructor(
    private readonly destino: { host: string; port: number },
    private readonly urlOriginal: URL,
  ) {
    this.servidor = net.createServer((cliente) => this.alConectar(cliente));
  }

  /** Levanta el proxy hacia el servidor de `urlDestino` (por ejemplo `DATABASE_URL_APP`). */
  static async iniciar(urlDestino: string): Promise<ProxyPostgres> {
    const url = new URL(urlDestino);
    const proxy = new ProxyPostgres({ host: url.hostname, port: Number(url.port || 5432) }, url);
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

  /** Cierra todas las conexiones abiertas y el servidor (siempre, también si la prueba falló). */
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

  olvidar(puente: Puente): void {
    this.puentes.delete(puente);
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
