// spec: 005-inscripcion-publica (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AlmacenArchivosPrueba,
  archivosBajo,
  borrarDirectorio,
  cargarAlmacen,
  directorioTemporal,
} from '../../utilidades/inscripciones-005b';

// Criterio 36 (crítico, D-21, D-23; PB7), `AlmacenArchivosDisco` sobre un directorio temporal. La interfaz `AlmacenArchivos` (`guardar`,
// `leer`, `borrar`) recibe siempre la academia y una clave que genera el servidor (`academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`),
// nunca un nombre del cliente. La implementación de disco escribe bajo `raiz` y rechaza toda clave que no cumpla el formato o que, resuelta,
// quede fuera de `{raiz}/academias/{academiaId}` (`..`, rutas absolutas, separadores de Windows, bytes nulos, enlaces simbólicos). Leer o borrar
// con la academia A una clave de B falla sin tocar el archivo.
//   - Clave válida: como mucho 255 caracteres ASCII; `academias/{academiaId}/` seguido de uno o más segmentos separados por `/`; `{academiaId}` es
//     el mismo UUID, en minúsculas, que el `academiaId` recibido; cada segmento cumple `^[a-z0-9][a-z0-9_-]*(\.[a-z0-9]+)?$`.
//   - Rechazo: una clave que no cumple, un `academiaId` que no es UUID o una clave de otra academia: `guardar`, `leer` y `borrar` devuelven una
//     promesa rechazada (con un `Error`) sin crear, leer, cambiar ni borrar ningún archivo. También si la ruta resuelta queda fuera de
//     `{raiz}/academias/{academiaId}` o si esa carpeta, alguna debajo de ella o el propio archivo es un enlace simbólico.
//   - Comportamiento: `guardar` crea las carpetas que falten y escribe primero un archivo temporal en la misma carpeta y después lo renombra;
//     `leer` de una clave válida que no existe rechaza; `borrar` de una clave válida que no existe resuelve (idempotente).
// Si el sistema no deja crear un enlace simbólico (Windows sin permisos, EPERM), esa prueba se omite con un aviso.

describe('AlmacenArchivosDisco (criterio 36)', () => {
  let base: string;
  let raiz: string;
  let almacen: AlmacenArchivosPrueba;
  const A = randomUUID();
  const B = randomUUID();
  const alumnoA = randomUUID();
  const alumnoB = randomUUID();
  const claveDe = (academiaId: string, alumnoId: string, uuid = randomUUID()) =>
    `academias/${academiaId}/alumnos/${alumnoId}/foto-${uuid}.jpg`;
  const bytes = (texto: string) => Buffer.from(texto, 'utf8');

  beforeEach(async () => {
    base = directorioTemporal();
    raiz = path.join(base, 'raiz');
    fs.mkdirSync(raiz);
    const modulo = await cargarAlmacen();
    almacen = new modulo.AlmacenArchivosDisco(raiz);
  });
  afterEach(() => {
    borrarDirectorio(base);
  });

  /** Una promesa rechazada con un `Error`: la operación no lanza de forma síncrona. */
  async function rechaza(operacion: () => Promise<unknown>, descripcion: string): Promise<void> {
    let promesa: Promise<unknown> | undefined;
    expect(() => {
      promesa = operacion();
    }, `${descripcion}: lanzó de forma síncrona`).not.toThrow();
    const motivo = await (promesa as Promise<unknown>).then(
      () => undefined,
      (error: unknown) => error ?? new Error('rechazó sin valor'),
    );
    expect(motivo, `${descripcion}: debía rechazar`).toBeInstanceOf(Error);
  }

  describe('comportamiento con una clave válida', () => {
    it('criterio 36: guardar crea las carpetas que faltan y escribe el archivo; leer devuelve los mismos bytes; no quedan archivos temporales', async () => {
      const clave = claveDe(A, alumnoA);
      const contenido = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]);

      await almacen.guardar(A, clave, contenido, 'image/jpeg');

      expect(archivosBajo(raiz)).toEqual([clave]);
      expect(fs.readFileSync(path.join(raiz, ...clave.split('/'))).equals(contenido)).toBe(true);
      const leido = await almacen.leer(A, clave);
      expect(Buffer.isBuffer(leido)).toBe(true);
      expect(leido.equals(contenido)).toBe(true);
    });

    it('criterio 36: guardar dos veces la misma clave deja el contenido de la última y un solo archivo', async () => {
      const clave = claveDe(A, alumnoA);
      await almacen.guardar(A, clave, bytes('primero'), 'image/png');

      await almacen.guardar(A, clave, bytes('segundo'), 'image/png');

      expect((await almacen.leer(A, clave)).toString()).toBe('segundo');
      expect(archivosBajo(raiz)).toEqual([clave]);
    });

    it('criterio 36: dos guardados simultáneos de la misma clave dejan un archivo completo (el de uno de los dos), nunca uno a medias', async () => {
      const clave = claveDe(A, alumnoA);
      const uno = Buffer.alloc(2 * 1024 * 1024, 1);
      const otro = Buffer.alloc(3 * 1024 * 1024, 2);

      await Promise.all([almacen.guardar(A, clave, uno, 'image/jpeg'), almacen.guardar(A, clave, otro, 'image/jpeg')]);

      const leido = await almacen.leer(A, clave);
      expect(leido.equals(uno) || leido.equals(otro), 'el archivo no es ninguno de los dos').toBe(true);
      expect(archivosBajo(raiz)).toEqual([clave]);
    });

    it('criterio 36: leer una clave válida que no existe rechaza, y no crea nada', async () => {
      await rechaza(() => almacen.leer(A, claveDe(A, alumnoA)), 'leer una clave que no existe');

      expect(archivosBajo(raiz)).toEqual([]);
    });

    it('criterio 36: borrar elimina el archivo; borrar una clave válida que no existe resuelve sin error (idempotente), también dos veces', async () => {
      const clave = claveDe(A, alumnoA);
      await almacen.guardar(A, clave, bytes('x'), 'image/jpeg');

      await almacen.borrar(A, clave);
      await almacen.borrar(A, clave);
      await almacen.borrar(A, claveDe(A, alumnoB));

      expect(archivosBajo(raiz)).toEqual([]);
    });

    it('criterio 36: borrar un archivo no toca los demás de la misma carpeta ni los de otro alumno', async () => {
      const uno = claveDe(A, alumnoA);
      const dos = claveDe(A, alumnoA);
      const deOtro = claveDe(A, alumnoB);
      for (const clave of [uno, dos, deOtro]) await almacen.guardar(A, clave, bytes(clave), 'image/jpeg');

      await almacen.borrar(A, uno);

      expect(archivosBajo(raiz)).toEqual([dos, deOtro].sort());
    });

    it('criterio 36: una clave de exactamente 255 caracteres es válida; una de 256, no', async () => {
      const prefijo = `academias/${A}/`;
      const segmento = (largo: number) => `${'a'.repeat(largo - 4)}.jpg`;
      const de255 = `${prefijo}${segmento(255 - prefijo.length)}`;
      const de256 = `${prefijo}${segmento(256 - prefijo.length)}`;
      expect([de255.length, de256.length]).toEqual([255, 256]);

      await almacen.guardar(A, de255, bytes('x'), 'image/jpeg');
      await rechaza(() => almacen.guardar(A, de256, bytes('x'), 'image/jpeg'), 'clave de 256 caracteres');

      expect(archivosBajo(raiz)).toEqual([de255]);
    });

    it('criterio 36: una clave con varios segmentos es válida (letras minúsculas, dígitos, guiones y guiones bajos, con una extensión)', async () => {
      const clave = `academias/${A}/alumnos/${alumnoA}/fotos_2026-11/foto-1.v2.jpg`;
      // Dos puntos en el último segmento no cumplen `\.[a-z0-9]+` una sola vez: esa clave se rechaza.
      await rechaza(() => almacen.guardar(A, clave, bytes('x'), 'image/jpeg'), 'dos puntos en un segmento');

      const valida = `academias/${A}/alumnos/${alumnoA}/fotos_2026-11/foto-1.jpg`;
      await almacen.guardar(A, valida, bytes('x'), 'image/jpeg');

      expect(archivosBajo(raiz)).toEqual([valida]);
    });
  });

  describe('claves que se rechazan con las tres operaciones', () => {
    const LARGA = `academias/${A}/${'a'.repeat(260)}.jpg`;
    const CLAVES: [string, string][] = [
      ['un segmento .. (sube de nivel)', `academias/${A}/alumnos/../../${B}/alumnos/x/foto.jpg`],
      ['un segmento .. al principio de la carpeta de la academia', `academias/${A}/../${B}/foto.jpg`],
      ['un segmento .', `academias/${A}/./foto.jpg`],
      ['una ruta absoluta de POSIX', '/etc/passwd'],
      ['una ruta absoluta que repite el formato', `/academias/${A}/alumnos/x/foto.jpg`],
      ['una ruta absoluta de Windows', 'C:\\Windows\\foto.jpg'],
      ['separadores de Windows', `academias\\${A}\\alumnos\\x\\foto.jpg`],
      ['una barra invertida dentro de un segmento', `academias/${A}/alumnos\\x.jpg`],
      ['un byte nulo', `academias/${A}/alumnos/x\u0000.jpg`],
      ['un segmento vacío (//)', `academias/${A}/alumnos//foto.jpg`],
      ['la barra final', `academias/${A}/alumnos/`],
      ['sin ningún segmento después de la academia', `academias/${A}`],
      ['solo la carpeta de la academia con barra', `academias/${A}/`],
      ['un nombre con mayúsculas', `academias/${A}/alumnos/Foto.jpg`],
      ['la carpeta de segundo nivel con mayúsculas', `academias/${A}/Alumnos/foto.jpg`],
      ['el UUID de la academia en mayúsculas', `academias/${A.toUpperCase()}/alumnos/foto.jpg`],
      ['un espacio', `academias/${A}/alumnos/mi foto.jpg`],
      ['un porcentaje (codificación de URL)', `academias/${A}/alumnos/%2e%2e/foto.jpg`],
      ['dos puntos', `academias/${A}/alumnos/c:foto.jpg`],
      ['un segmento que empieza con punto', `academias/${A}/.oculto`],
      ['un segmento que empieza con guion', `academias/${A}/-foto.jpg`],
      ['un carácter no ASCII', `academias/${A}/alumnos/fotó.jpg`],
      ['otra carpeta base', `otra/${A}/alumnos/foto.jpg`],
      ['sin la carpeta base', `${A}/alumnos/foto.jpg`],
      ['un texto vacío', ''],
      ['más de 255 caracteres', LARGA],
      ['la clave de otra academia (B) con el UUID de B', `academias/${B}/alumnos/${alumnoB}/foto-${randomUUID()}.jpg`],
    ];

    it.each(CLAVES)(
      'criterio 36: %s: guardar, leer y borrar devuelven una promesa rechazada sin crear ni tocar nada',
      async (nombre, clave) => {
        const antesDeBase = archivosBajo(base);

        await rechaza(() => almacen.guardar(A, clave, bytes('contenido'), 'image/jpeg'), `guardar (${nombre})`);
        await rechaza(() => almacen.leer(A, clave), `leer (${nombre})`);
        await rechaza(() => almacen.borrar(A, clave), `borrar (${nombre})`);

        expect(archivosBajo(base), 'apareció o desapareció un archivo').toEqual(antesDeBase);
      },
    );

    it.each([
      ['un texto que no es un UUID', 'academia-a'],
      ['una ruta', '../fuera'],
      ['vacío', ''],
      ['un UUID en mayúsculas', A.toUpperCase()],
    ])(
      'criterio 36: un academiaId que no es un UUID en minúsculas (%s) rechaza las tres operaciones',
      async (_nombre, academiaId) => {
        const clave = `academias/${academiaId}/alumnos/x/foto.jpg`;

        await rechaza(() => almacen.guardar(academiaId, clave, bytes('x'), 'image/jpeg'), 'guardar');
        await rechaza(() => almacen.leer(academiaId, clave), 'leer');
        await rechaza(() => almacen.borrar(academiaId, clave), 'borrar');

        expect(archivosBajo(base)).toEqual([]);
      },
    );

    it('criterio 36: una clave que escapa de la carpeta con .. no escribe fuera de la raíz (ni en la carpeta que la contiene)', async () => {
      await rechaza(
        () => almacen.guardar(A, `academias/${A}/../../../escape.jpg`, bytes('escape'), 'image/jpeg'),
        'guardar con ..',
      );

      expect(archivosBajo(base)).toEqual([]);
      expect(fs.existsSync(path.join(base, 'escape.jpg'))).toBe(false);
    });
  });

  describe('aislamiento entre academias', () => {
    it('criterio 36: leer y borrar con la academia A una clave de B falla y el archivo de B sigue igual; guardar sobre una clave de B tampoco lo cambia', async () => {
      const claveB = claveDe(B, alumnoB);
      await almacen.guardar(B, claveB, bytes('foto de B'), 'image/jpeg');
      const antes = fs.statSync(path.join(raiz, ...claveB.split('/')));

      await rechaza(() => almacen.leer(A, claveB), 'leer una clave de B con A');
      await rechaza(() => almacen.borrar(A, claveB), 'borrar una clave de B con A');
      await rechaza(() => almacen.guardar(A, claveB, bytes('pisada'), 'image/jpeg'), 'guardar una clave de B con A');

      expect(archivosBajo(raiz)).toEqual([claveB]);
      expect(fs.readFileSync(path.join(raiz, ...claveB.split('/'))).toString()).toBe('foto de B');
      expect(fs.statSync(path.join(raiz, ...claveB.split('/'))).mtimeMs).toBe(antes.mtimeMs);
      expect((await almacen.leer(B, claveB)).toString()).toBe('foto de B');
    });

    it('criterio 36: las fotos de dos academias conviven: borrar la de A no toca la de B', async () => {
      const claveA = claveDe(A, alumnoA);
      const claveB = claveDe(B, alumnoB);
      await almacen.guardar(A, claveA, bytes('A'), 'image/jpeg');
      await almacen.guardar(B, claveB, bytes('B'), 'image/jpeg');

      await almacen.borrar(A, claveA);

      expect(archivosBajo(raiz)).toEqual([claveB]);
    });
  });

  describe('enlaces simbólicos', () => {
    /** Crea un enlace; si el sistema no deja (Windows sin permisos), omite la prueba con un aviso. */
    function enlazar(destino: string, enlace: string, omitir: (aviso: string) => void): boolean {
      fs.mkdirSync(path.dirname(enlace), { recursive: true });
      try {
        fs.symlinkSync(destino, enlace, 'dir');
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          omitir('No se puede crear un enlace simbólico en este sistema (EPERM): prueba omitida.');
          return false;
        }
        throw error;
      }
    }

    it('criterio 36: un enlace simbólico {raiz}/academias/{A}/alumnos que apunta a la carpeta de B: guardar y leer con A rechazan y no tocan lo de B', async (contexto) => {
      const claveB = claveDe(B, alumnoB);
      await almacen.guardar(B, claveB, bytes('foto de B'), 'image/jpeg');
      const carpetaDeB = path.join(raiz, 'academias', B, 'alumnos');
      if (!enlazar(carpetaDeB, path.join(raiz, 'academias', A, 'alumnos'), (aviso) => contexto.skip(aviso))) return;
      const antes = archivosBajo(raiz);

      // Con el enlace, `academias/A/alumnos/{alumnoB}/foto…` llegaría a la carpeta de B.
      const mediante = `academias/${A}/alumnos/${alumnoB}/${path.posix.basename(claveB)}`;
      await rechaza(() => almacen.leer(A, mediante), 'leer a través del enlace');
      await rechaza(
        () => almacen.guardar(A, claveDe(A, alumnoB), bytes('pisada'), 'image/jpeg'),
        'guardar a través del enlace',
      );
      await rechaza(() => almacen.guardar(A, mediante, bytes('pisada'), 'image/jpeg'), 'guardar sobre lo de B');
      await rechaza(() => almacen.borrar(A, mediante), 'borrar a través del enlace');

      expect(archivosBajo(raiz)).toEqual(antes);
      expect(fs.readFileSync(path.join(raiz, ...claveB.split('/'))).toString()).toBe('foto de B');
    });

    it('criterio 36: si la carpeta de la academia {raiz}/academias/{A} es un enlace simbólico, las tres operaciones rechazan', async (contexto) => {
      const claveB = claveDe(B, alumnoB);
      await almacen.guardar(B, claveB, bytes('foto de B'), 'image/jpeg');
      const claveA = claveDe(A, alumnoB);
      if (!enlazar(path.join(raiz, 'academias', B), path.join(raiz, 'academias', A), (aviso) => contexto.skip(aviso)))
        return;

      await rechaza(() => almacen.guardar(A, claveA, bytes('pisada'), 'image/jpeg'), 'guardar');
      await rechaza(() => almacen.leer(A, claveA), 'leer');
      await rechaza(() => almacen.borrar(A, claveA), 'borrar');

      expect(archivosBajo(path.join(raiz, 'academias', B))).toEqual([
        `alumnos/${alumnoB}/${path.posix.basename(claveB)}`,
      ]);
    });

    it('criterio 36: si el propio archivo es un enlace simbólico a un archivo de fuera, leer y borrar rechazan y el archivo de fuera sigue', async (contexto) => {
      const fuera = path.join(base, 'secreto.txt');
      fs.writeFileSync(fuera, 'secreto');
      const clave = claveDe(A, alumnoA);
      const ruta = path.join(raiz, ...clave.split('/'));
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      try {
        fs.symlinkSync(fuera, ruta, 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          contexto.skip('No se puede crear un enlace simbólico en este sistema (EPERM): prueba omitida.');
          return;
        }
        throw error;
      }

      await rechaza(() => almacen.leer(A, clave), 'leer un enlace');
      await rechaza(() => almacen.borrar(A, clave), 'borrar un enlace');
      await rechaza(() => almacen.guardar(A, clave, bytes('pisada'), 'image/jpeg'), 'guardar sobre un enlace');

      expect(fs.readFileSync(fuera).toString()).toBe('secreto');
    });
  });
});
