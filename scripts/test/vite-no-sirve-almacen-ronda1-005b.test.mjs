// spec: 005-inscripcion-publica (pruebas protegidas)
// Criterio 62 (crítico, ronda 1 del ataque de la 005b, falla 2; precisa el 36), servidor de desarrollo de la web: con la configuración por
// defecto, Vite deja leer por `/@fs/` todo el repositorio (la raíz del workspace), también el almacén de fotos de menores en
// `backend/almacenamiento/`. Desde el criterio 62, `server.fs.allow` es una lista cerrada (`frontend/`, `packages/contratos/` y el
// `node_modules/` de la raíz) y nada más del repositorio se sirve por `/@fs/`.
//
// Se levanta un Vite real con el `frontend/vite.config.ts` del repositorio, `root` en `frontend/`, en un puerto efímero y cambiando solo lo
// necesario para la prueba (`server.port: 0`, `strictPort: false`, `hmr: false`, `watch: null`, un `cacheDir` temporal y sin descubrir
// dependencias; nunca `server.fs`). Se cierra siempre, también si una prueba falla. La prueba crea una imagen con nombres nuevos en el
// almacén por defecto (`backend/almacenamiento/academias/{uuid}/alumnos/{uuid}/foto-{uuid}.jpg`) y borra al terminar solo su carpeta
// `academias/{uuid}` (la única excepción del criterio 63). Corre en Node, sin navegador ni jsdom, también en Windows.
//   a) la lista cerrada: el archivo del almacén por `/@fs/` responde 403 y no entrega sus bytes; las variantes de ruta no lo entregan; la
//      carpeta de la academia no lista nada; el resto del repositorio (`backend/`, `docs/`, `.env.example`, `.env`) responde 403;
//      `server.fs.strict` sigue en `true` y `server.fs.deny` conserva sus valores por defecto;
//   b) la aplicación sigue servida: `/`, `/src/main.tsx`, `packages/contratos/` y una dependencia de `node_modules/` responden 200.
// (El rechazo de un `ALMACEN_DIRECTORIO` dentro de lo que sirve la web, criterio 62 b, se prueba en `backend/src/infraestructura/entorno/`.)
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, resolveConfig } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(RAIZ, 'frontend');
const ES_WINDOWS = process.platform === 'win32';

const academiaId = randomUUID();
const alumnoId = randomUUID();
const nombreDelArchivo = `foto-${randomUUID()}.jpg`;
const carpetaDeLaAcademia = path.join(RAIZ, 'backend', 'almacenamiento', 'academias', academiaId);
const carpetaDelAlumno = path.join(carpetaDeLaAcademia, 'alumnos', alumnoId);
const archivoDelAlmacen = path.join(carpetaDelAlumno, nombreDelArchivo);
/** Un texto único dentro de la imagen: si aparece en una respuesta, el servidor entregó el archivo. */
const MARCA = `MARCA-62-${randomUUID()}`;
const imagen = Buffer.concat([
  Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00,
  ]),
  Buffer.from(MARCA, 'latin1'),
  randomBytes(64),
  Buffer.from([0xff, 0xd9]),
]);

/** Una ruta absoluta del sistema como la espera `/@fs/`: con `/` y sin la barra inicial duplicada (en Windows, `/@fs/C:/…`). */
const urlFs = (absoluta) => `/@fs/${absoluta.split(path.sep).join('/').replace(/^\//, '')}`;
/** La ruta del almacén bajo la raíz, relativa y con `/`. */
const relativaDelAlmacen = path.relative(RAIZ, archivoDelAlmacen).split(path.sep).join('/');

/** GET con la ruta tal cual (sin que el cliente quite `..` ni decodifique nada, a diferencia de `fetch`). */
function pedir(puerto, ruta) {
  return new Promise((resolver, rechazar) => {
    const peticion = http.request(
      { host: '127.0.0.1', port: puerto, path: ruta, method: 'GET', agent: false },
      (respuesta) => {
        const trozos = [];
        respuesta.on('data', (trozo) => trozos.push(trozo));
        respuesta.on('error', rechazar);
        respuesta.on('end', () =>
          resolver({
            status: respuesta.statusCode ?? 0,
            tipo: String(respuesta.headers['content-type'] ?? ''),
            cuerpo: Buffer.concat(trozos),
          }),
        );
      },
    );
    peticion.setTimeout(20_000, () => peticion.destroy(new Error(`Vite no respondió a GET ${ruta}`)));
    peticion.on('error', rechazar);
    peticion.end();
  });
}

const normalizar = (ruta) => {
  const normal = path.resolve(ruta).split(path.sep).join('/').replace(/\/+$/, '');
  return ES_WINDOWS ? normal.toLowerCase() : normal;
};

describe('servidor de desarrollo de la web (criterio 62 a y b)', () => {
  let servidor;
  let puerto = 0;
  let cacheDir;

  async function limpiar() {
    try {
      await servidor?.close();
    } finally {
      servidor = undefined;
      fs.rmSync(carpetaDeLaAcademia, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      if (cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  beforeAll(async () => {
    try {
      fs.mkdirSync(carpetaDelAlumno, { recursive: true });
      fs.writeFileSync(archivoDelAlmacen, imagen);
      cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-vite-cache-'));
      servidor = await createServer({
        configFile: path.join(FRONTEND, 'vite.config.ts'),
        root: FRONTEND,
        cacheDir,
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { port: 0, strictPort: false, hmr: false, watch: null },
        logLevel: 'silent',
      });
      await servidor.listen();
      puerto = servidor.httpServer.address().port;
    } catch (error) {
      await limpiar();
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    await limpiar();
  }, 60_000);

  /** Lo que ninguna respuesta puede entregar: la imagen, por su tipo o por sus bytes. */
  function noEntregaLaImagen(respuesta, descripcion) {
    expect(respuesta.tipo, `${descripcion}: entregó una imagen`).not.toMatch(/image\/jpeg/i);
    expect(
      respuesta.cuerpo.includes(Buffer.from(MARCA, 'latin1')),
      `${descripcion}: el cuerpo trae los bytes de la imagen`,
    ).toBe(false);
    expect(respuesta.cuerpo.equals(imagen), `${descripcion}: el cuerpo es la imagen`).toBe(false);
  }

  describe('a) lista cerrada', () => {
    it('criterio 62 a: GET /@fs/{ruta del archivo del almacén} responde 403, nunca 200, y no entrega los bytes de la imagen', async () => {
      const respuesta = await pedir(puerto, urlFs(archivoDelAlmacen));

      expect(respuesta.status).toBe(403);
      noEntregaLaImagen(respuesta, '/@fs/ del archivo');
    });

    const consultas = ['?raw', '?import&raw', '?url', '?inline', '?t=1'];
    for (const consulta of consultas) {
      it(`criterio 62 a: el archivo del almacén con ${consulta} no responde 200 ni entrega la imagen`, async () => {
        const respuesta = await pedir(puerto, `${urlFs(archivoDelAlmacen)}${consulta}`);

        expect(respuesta.status, `/@fs/ con ${consulta}`).not.toBe(200);
        noEntregaLaImagen(respuesta, `/@fs/ con ${consulta}`);
      });
    }

    /** Variantes que no caen en `/@fs/`: pueden responder lo que Vite responda, pero nunca la imagen. */
    const variantes = [
      ['/../backend/almacenamiento/…', `/../${relativaDelAlmacen}`],
      ['/%2e%2e/backend/almacenamiento/…', `/%2e%2e/${relativaDelAlmacen}`],
      ['/%2E%2E/backend/almacenamiento/…', `/%2E%2E/${relativaDelAlmacen}`],
      ['/backend/almacenamiento/…', `/${relativaDelAlmacen}`],
      ['/@fs/{raíz}/frontend/../backend/almacenamiento/…', `${urlFs(FRONTEND)}/../${relativaDelAlmacen}`],
      ['/@fs/ con %2F en lugar de /', `/@fs/${urlFs(archivoDelAlmacen).slice('/@fs/'.length).replace(/\//g, '%2F')}`],
      ['/@fs/ con %5C en lugar de /', `/@fs/${urlFs(archivoDelAlmacen).slice('/@fs/'.length).replace(/\//g, '%5C')}`],
      ['/@fs/ con %2e%2e', `${urlFs(FRONTEND)}/%2e%2e/${relativaDelAlmacen}`],
      ['/@fs// con una barra de más', `/@fs//${urlFs(archivoDelAlmacen).slice('/@fs/'.length)}`],
    ];
    if (ES_WINDOWS) {
      const absoluta = archivoDelAlmacen;
      variantes.push(
        ['/@fs/ con la unidad en minúscula', urlFs(absoluta.charAt(0).toLowerCase() + absoluta.slice(1))],
        ['/@fs/ con la unidad en mayúscula', urlFs(absoluta.charAt(0).toUpperCase() + absoluta.slice(1))],
        ['/@fs/ con la ruta en mayúsculas', urlFs(absoluta.toUpperCase())],
        ['/@fs/ con barras invertidas', `/@fs/${absoluta.replace(/\\/g, '%5C')}`],
      );
    }
    for (const [descripcion, ruta] of variantes) {
      it(`criterio 62 a: la variante ${descripcion} nunca entrega la imagen`, async () => {
        const respuesta = await pedir(puerto, ruta);

        noEntregaLaImagen(respuesta, descripcion);
        expect(respuesta.status === 200 && /^image\//i.test(respuesta.tipo)).toBe(false);
      });
    }

    it('criterio 62 a: GET /@fs/{carpeta de la academia}/ no lista nada de su contenido', async () => {
      for (const ruta of [
        `${urlFs(carpetaDeLaAcademia)}/`,
        urlFs(carpetaDeLaAcademia),
        `${urlFs(carpetaDelAlumno)}/`,
      ]) {
        const respuesta = await pedir(puerto, ruta);
        const texto = respuesta.cuerpo.toString('utf8');

        expect(texto, `${ruta} lista el alumno`).not.toContain(alumnoId);
        expect(texto, `${ruta} lista el archivo`).not.toContain(nombreDelArchivo);
      }
    });

    const resto = [
      ['backend/package.json', path.join(RAIZ, 'backend', 'package.json')],
      ['docs/decisiones.md', path.join(RAIZ, 'docs', 'decisiones.md')],
      ['.env.example', path.join(RAIZ, '.env.example')],
      ['package.json de la raíz', path.join(RAIZ, 'package.json')],
      ['specs/backlog.md', path.join(RAIZ, 'specs', 'backlog.md')],
      ['scripts/package.json', path.join(RAIZ, 'scripts', 'package.json')],
      ['e2e/package.json', path.join(RAIZ, 'e2e', 'package.json')],
    ];
    if (fs.existsSync(path.join(RAIZ, '.env'))) resto.push(['.env', path.join(RAIZ, '.env')]);
    for (const [nombre, absoluta] of resto) {
      it(`criterio 62 a: GET /@fs/{raíz}/${nombre} responde 403`, async () => {
        expect(fs.existsSync(absoluta), `la prueba espera que exista ${nombre}`).toBe(true);

        const respuesta = await pedir(puerto, urlFs(absoluta));

        expect(respuesta.status).toBe(403);
      });
    }

    it('criterio 62 a: server.fs.allow es la lista cerrada (frontend/, packages/contratos/ y node_modules/ de la raíz), strict sigue en true y deny conserva los valores por defecto de Vite', async () => {
      const { allow, strict, deny } = servidor.config.server.fs;
      const permitidas = [FRONTEND, path.join(RAIZ, 'packages', 'contratos'), path.join(RAIZ, 'node_modules')].map(
        normalizar,
      );
      const efectivas = allow.map(normalizar);
      // Los valores por defecto de `server.fs.deny` de esta versión de Vite: los de una configuración sin archivo.
      const base = await resolveConfig({ configFile: false, root: FRONTEND, logLevel: 'silent' }, 'serve');

      for (const carpeta of permitidas) expect(efectivas, `falta ${carpeta} en server.fs.allow`).toContain(carpeta);
      for (const carpeta of efectivas) {
        const dentro = permitidas.some((permitida) => carpeta === permitida || carpeta.startsWith(`${permitida}/`));
        expect(dentro, `server.fs.allow sirve ${carpeta}, que no está en la lista cerrada`).toBe(true);
      }
      expect(strict).toBe(true);
      expect(base.server.fs.deny.length).toBeGreaterThan(0);
      for (const patron of base.server.fs.deny) {
        expect(deny, `server.fs.deny perdió ${patron}`).toContain(patron);
      }
    });
  });

  describe('b) la aplicación sigue servida', () => {
    it('criterio 62 a: GET / responde 200 text/html con el index.html de la web', async () => {
      const respuesta = await pedir(puerto, '/');

      expect(respuesta.status).toBe(200);
      expect(respuesta.tipo).toMatch(/^text\/html/i);
      expect(respuesta.cuerpo.toString('utf8')).toContain('<div id="raiz"></div>');
    });

    it('criterio 62 a: GET /src/main.tsx responde 200 con JavaScript', async () => {
      const respuesta = await pedir(puerto, '/src/main.tsx');

      expect(respuesta.status).toBe(200);
      expect(respuesta.tipo).toMatch(/javascript/i);
    });

    it('criterio 62 a: GET /@fs/{raíz}/packages/contratos/package.json responde 200', async () => {
      const respuesta = await pedir(puerto, urlFs(path.join(RAIZ, 'packages', 'contratos', 'package.json')));

      expect(respuesta.status).toBe(200);
    });

    it('criterio 62 a: GET /@fs/{raíz}/node_modules/react/index.js responde 200', async () => {
      const respuesta = await pedir(puerto, urlFs(path.join(RAIZ, 'node_modules', 'react', 'index.js')));

      expect(respuesta.status).toBe(200);
    });
  });
});
