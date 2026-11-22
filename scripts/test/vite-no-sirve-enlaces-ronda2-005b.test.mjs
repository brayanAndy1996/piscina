// spec: 005-inscripcion-publica (pruebas protegidas)
// Criterio 65 (crítico, ronda 2 del ataque de la 005b, falla 2; amplía el 62 a), servidor de desarrollo de la web: npm crea en
// `node_modules/@aquagestion/` un enlace por cada paquete del workspace (`backend`, `contratos`, `e2e`, `frontend` y `scripts`) hacia su carpeta (en
// Windows, una unión). Vite decide si sirve un archivo comparando la ruta pedida, sin resolver enlaces, con `server.fs.allow`, y después lo lee
// siguiendo el enlace: con la lista cerrada del 62 a, `node_modules/` está permitido, así que
// `/@fs/{raíz}/node_modules/@aquagestion/backend/almacenamiento/…/foto-….jpg` entregaba la foto, y por el mismo camino `backend/src`,
// `backend/prisma/schema.prisma`, `e2e/` y `scripts/`. Desde el criterio 65, `server.fs.deny` es la lista de valores por defecto de Vite más
// `**/node_modules/@aquagestion` y `**/node_modules/@aquagestion/**` (decisión AB2-2); la web no usa esa ruta (Vite resuelve
// `@aquagestion/contratos` a `packages/contratos/…`), `resolve.preserveSymlinks` sigue en `false` y `server.fs.allow` no cambia.
//
// Como la prueba del 62 (`vite-no-sirve-almacen-ronda1-005b.test.mjs`, que no se toca), levanta un Vite real con el `frontend/vite.config.ts`
// del repositorio, `root` en `frontend/`, en un puerto efímero y cambiando solo lo necesario (`server.port: 0`, `strictPort: false`, `hmr: false`,
// `watch: null`, un `cacheDir` temporal y sin descubrir dependencias; nunca `server.fs`), y crea una imagen con nombres nuevos en el almacén por
// defecto, que borra al terminar solo su carpeta `academias/{uuid}` (la única excepción del criterio 63). Corre en Node, también en Windows.
//   - la precondición: los enlaces de los workspaces existen y apuntan a su carpeta (si no, la prueba falla: no se omite);
//   - el archivo del almacén por el enlace responde 403 y sus variantes nunca lo entregan (ni como imagen ni en base64);
//   - el resto del repositorio por el enlace responde 403;
//   - la configuración efectiva: `deny` con los dos patrones y los valores por defecto de Vite, `preserveSymlinks` en `false`, `strict` en `true`;
//   - la aplicación sigue servida: `/`, `/src/main.tsx`, los contratos, `node_modules/react` y un módulo que importa los contratos por su ruta
//     real, sin pasar por `node_modules/@aquagestion/`.
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
const MARCA = `MARCA-65-${randomUUID()}`;
const imagen = Buffer.concat([
  Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00,
  ]),
  Buffer.from(MARCA, 'latin1'),
  randomBytes(64),
  Buffer.from([0xff, 0xd9]),
]);
const imagenEnBase64 = imagen.toString('base64');
/** Un trozo del medio de la imagen en base64 (alineado a 4 caracteres), por si la respuesta parte el texto. */
const trozoEnBase64 = imagenEnBase64.slice(40, 120);

const POSIX = (ruta) => ruta.split(path.sep).join('/');
/** Una ruta absoluta del sistema como la espera `/@fs/`: con `/` y sin la barra inicial duplicada (en Windows, `/@fs/C:/…`). */
const urlFs = (absoluta) => `/@fs/${POSIX(absoluta).replace(/^\//, '')}`;
/** La ruta del almacén bajo `backend/`, relativa y con `/`. */
const relativaDelAlmacen = POSIX(path.relative(path.join(RAIZ, 'backend'), archivoDelAlmacen));
/** `L`: `/@fs/{raíz con /}/node_modules/@aquagestion`. */
const L = `${urlFs(RAIZ)}/node_modules/@aquagestion`;

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

describe('servidor de desarrollo de la web: enlaces de los workspaces (criterio 65)', () => {
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

  /** Lo que ninguna respuesta puede entregar: la imagen, por su tipo, por sus bytes o por esos bytes en base64. */
  function noEntregaLaImagen(respuesta, descripcion) {
    const texto = respuesta.cuerpo.toString('latin1');
    expect(respuesta.tipo, `${descripcion}: entregó una imagen`).not.toMatch(/image\/jpeg/i);
    expect(
      respuesta.cuerpo.includes(Buffer.from(MARCA, 'latin1')),
      `${descripcion}: el cuerpo trae los bytes de la imagen`,
    ).toBe(false);
    expect(respuesta.cuerpo.equals(imagen), `${descripcion}: el cuerpo es la imagen`).toBe(false);
    expect(texto.includes(imagenEnBase64), `${descripcion}: el cuerpo trae la imagen en base64`).toBe(false);
    expect(texto.includes(trozoEnBase64), `${descripcion}: el cuerpo trae un trozo de la imagen en base64`).toBe(false);
  }

  describe('precondición: los enlaces de los workspaces existen', () => {
    const enlaces = [
      ['backend', path.join(RAIZ, 'backend')],
      ['e2e', path.join(RAIZ, 'e2e')],
      ['scripts', path.join(RAIZ, 'scripts')],
      ['contratos', path.join(RAIZ, 'packages', 'contratos')],
      ['frontend', path.join(RAIZ, 'frontend')],
    ];
    for (const [nombre, destino] of enlaces) {
      it(`criterio 65: node_modules/@aquagestion/${nombre} es un enlace (o una unión) cuya ruta real es ${POSIX(path.relative(RAIZ, destino))}/`, () => {
        const enlace = path.join(RAIZ, 'node_modules', '@aquagestion', nombre);
        const existe = (() => {
          try {
            fs.lstatSync(enlace);
            return true;
          } catch {
            return false;
          }
        })();
        expect(
          existe,
          `la prueba espera que exista ${enlace}: ¿falta npm install? (no se omite, para no pasar sin probar nada)`,
        ).toBe(true);
        expect(fs.lstatSync(enlace).isSymbolicLink(), `${enlace} debía ser un enlace o una unión`).toBe(true);
        expect(normalizar(fs.realpathSync(enlace))).toBe(normalizar(fs.realpathSync(destino)));
      });
    }
  });

  describe('el archivo del almacén por el enlace', () => {
    it('criterio 65 a: GET {L}/backend/almacenamiento/academias/{A}/alumnos/{B}/foto-{C}.jpg responde 403, nunca 200, y no entrega la imagen', async () => {
      const respuesta = await pedir(puerto, `${L}/backend/${relativaDelAlmacen}`);

      expect(respuesta.status).toBe(403);
      noEntregaLaImagen(respuesta, 'el archivo por el enlace');
    });

    /** Variantes: pueden responder lo que Vite responda (403, 404 o la página de la aplicación), pero nunca la imagen. */
    const delArchivo = `backend/${relativaDelAlmacen}`;
    const sinArroba = `${urlFs(RAIZ)}/node_modules`;
    const variantes = [];
    for (const consulta of [
      '?import',
      '?raw',
      '?raw??',
      '?import&raw??',
      '?inline',
      '?inline&import',
      '?url',
      '?direct',
    ]) {
      variantes.push([`con ${consulta}`, `${L}/${delArchivo}${consulta}`]);
    }
    variantes.push(
      ['con la @ escrita %40', `${sinArroba}/%40aquagestion/${delArchivo}`],
      ['con la @ escrita %40 y ?raw', `${sinArroba}/%40aquagestion/${delArchivo}?raw`],
      ['con %2F entre el enlace y backend', `${L}%2F${delArchivo}`],
      [
        'con %2F después de @aquagestion y %2F entre las carpetas',
        `${sinArroba}/@aquagestion%2Fbackend%2F${relativaDelAlmacen}`,
      ],
      [
        'con %2F en todas las barras después de /@fs/',
        `/@fs/${L.slice('/@fs/'.length).replace(/\//g, '%2F')}/${delArchivo.replace(/\//g, '%2F')}`,
      ],
      [
        'con %5C en lugar de alguna barra',
        `${sinArroba}/@aquagestion%5Cbackend%5C${relativaDelAlmacen.replace(/\//g, '%5C')}`,
      ],
      [
        'con %5C en todas las barras después de /@fs/',
        `/@fs/${L.slice('/@fs/'.length).replace(/\//g, '%5C')}/${delArchivo.replace(/\//g, '%5C')}`,
      ],
      ['con NODE_MODULES', `${urlFs(RAIZ)}/NODE_MODULES/@aquagestion/${delArchivo}`],
      ['con @AquaGestion', `${sinArroba}/@AquaGestion/${delArchivo}`],
      ['con Backend', `${L}/Backend/${relativaDelAlmacen}`],
      [
        'con NODE_MODULES, @AquaGestion y Backend',
        `${urlFs(RAIZ)}/NODE_MODULES/@AquaGestion/Backend/${relativaDelAlmacen}`,
      ],
      ['con NODE_MODULES y ?raw', `${urlFs(RAIZ)}/NODE_MODULES/@aquagestion/${delArchivo}?raw`],
      ['sin /@fs/ (/node_modules/@aquagestion/backend/…)', `/node_modules/@aquagestion/${delArchivo}`],
      ['sin /@fs/ y con ?raw', `/node_modules/@aquagestion/${delArchivo}?raw`],
      [
        'por frontend/node_modules/@aquagestion/backend/…',
        `${urlFs(FRONTEND)}/node_modules/@aquagestion/${delArchivo}`,
      ],
      [
        'por frontend/node_modules/@aquagestion/backend/… con ?raw',
        `${urlFs(FRONTEND)}/node_modules/@aquagestion/${delArchivo}?raw`,
      ],
    );
    if (ES_WINDOWS) {
      variantes.push(
        [
          'con barras invertidas codificadas',
          `/@fs/${path.join(RAIZ, 'node_modules', '@aquagestion', 'backend', relativaDelAlmacen).replace(/\\/g, '%5C')}`,
        ],
        [
          'con la ruta en mayúsculas',
          `${urlFs(RAIZ).toUpperCase()}/NODE_MODULES/@AQUAGESTION/${delArchivo.toUpperCase()}`,
        ],
        ['con la unidad en minúscula', `${L.slice(0, 6).toLowerCase()}${L.slice(6)}/${delArchivo}`],
      );
    }
    for (const [descripcion, ruta] of variantes) {
      it(`criterio 65 a: la variante ${descripcion} nunca entrega la imagen (ni la imagen en base64)`, async () => {
        const respuesta = await pedir(puerto, ruta);

        noEntregaLaImagen(respuesta, descripcion);
        expect(respuesta.status === 200 && /^image\//i.test(respuesta.tipo)).toBe(false);
      });
    }

    it('criterio 65 a: GET {L}/backend/almacenamiento/academias/ no lista nada de su contenido', async () => {
      for (const ruta of [
        `${L}/backend/almacenamiento/academias/`,
        `${L}/backend/almacenamiento/academias`,
        `${L}/backend/almacenamiento/academias/${academiaId}/`,
        `${L}/backend/almacenamiento/academias/${academiaId}/alumnos/${alumnoId}/`,
      ]) {
        const respuesta = await pedir(puerto, ruta);
        const texto = respuesta.cuerpo.toString('utf8');

        expect(texto, `${ruta} lista la academia`).not.toContain(academiaId);
        expect(texto, `${ruta} lista el alumno`).not.toContain(alumnoId);
        expect(texto, `${ruta} lista el archivo`).not.toContain(nombreDelArchivo);
        noEntregaLaImagen(respuesta, ruta);
      }
    });
  });

  describe('el resto del repositorio por el enlace', () => {
    const resto = [
      ['backend/package.json', 'backend', ['package.json']],
      ['backend/prisma/schema.prisma', 'backend', ['prisma', 'schema.prisma']],
      [
        'backend/src/infraestructura/entorno/entorno.ts',
        'backend',
        ['src', 'infraestructura', 'entorno', 'entorno.ts'],
      ],
      ['e2e/package.json', 'e2e', ['package.json']],
      ['e2e/playwright.config.ts', 'e2e', ['playwright.config.ts']],
      ['scripts/package.json', 'scripts', ['package.json']],
      ['contratos/package.json', path.join('packages', 'contratos'), ['package.json']],
      ['frontend/package.json', 'frontend', ['package.json']],
    ];
    for (const [nombre, carpeta, partes] of resto) {
      it(`criterio 65 a: GET {L}/${nombre} responde 403`, async () => {
        const real = path.join(RAIZ, carpeta, ...partes);
        expect(fs.existsSync(real), `la prueba espera que exista ${nombre}`).toBe(true);

        const respuesta = await pedir(puerto, `${L}/${nombre}`);

        expect(respuesta.status).toBe(403);
      });
    }

    const entorno = 'backend/src/infraestructura/entorno/entorno.ts';
    for (const consulta of ['?import', '?raw']) {
      it(`criterio 65 a: GET {L}/${entorno}${consulta} responde 403`, async () => {
        const respuesta = await pedir(puerto, `${L}/${entorno}${consulta}`);

        expect(respuesta.status).toBe(403);
      });
    }
  });

  describe('la configuración efectiva', () => {
    it('criterio 65 a: server.fs.deny contiene los dos patrones de los enlaces y cada valor por defecto de Vite', async () => {
      const { deny } = servidor.config.server.fs;
      // Los valores por defecto de `server.fs.deny` de esta versión de Vite: los de una configuración sin archivo.
      const base = await resolveConfig({ configFile: false, root: FRONTEND, logLevel: 'silent' }, 'serve');

      expect(deny, 'falta **/node_modules/@aquagestion en server.fs.deny').toContain('**/node_modules/@aquagestion');
      expect(deny, 'falta **/node_modules/@aquagestion/** en server.fs.deny').toContain(
        '**/node_modules/@aquagestion/**',
      );
      expect(base.server.fs.deny.length).toBeGreaterThan(0);
      for (const patron of base.server.fs.deny) {
        expect(deny, `server.fs.deny perdió ${patron}`).toContain(patron);
      }
    });

    it('criterio 65 b: resolve.preserveSymlinks sigue en false, server.fs.strict en true y server.fs.allow no suma los enlaces', () => {
      const { allow, strict } = servidor.config.server.fs;

      expect(servidor.config.resolve.preserveSymlinks).toBe(false);
      expect(strict).toBe(true);
      for (const carpeta of allow.map(normalizar)) {
        expect(carpeta, `server.fs.allow sirve ${carpeta}`).not.toContain('node_modules/@aquagestion');
      }
    });
  });

  describe('la aplicación sigue servida', () => {
    it('criterio 65 b: GET / responde 200 text/html con el index.html de la web', async () => {
      const respuesta = await pedir(puerto, '/');

      expect(respuesta.status).toBe(200);
      expect(respuesta.tipo).toMatch(/^text\/html/i);
      expect(respuesta.cuerpo.toString('utf8')).toContain('<div id="raiz"></div>');
    });

    it('criterio 65 b: GET /src/main.tsx responde 200 con JavaScript', async () => {
      const respuesta = await pedir(puerto, '/src/main.tsx');

      expect(respuesta.status).toBe(200);
      expect(respuesta.tipo).toMatch(/javascript/i);
    });

    it('criterio 65 b: GET /@fs/{raíz}/packages/contratos/package.json y /@fs/{raíz}/node_modules/react/index.js responden 200', async () => {
      const contratos = await pedir(puerto, urlFs(path.join(RAIZ, 'packages', 'contratos', 'package.json')));
      const react = await pedir(puerto, urlFs(path.join(RAIZ, 'node_modules', 'react', 'index.js')));

      expect(contratos.status).toBe(200);
      expect(react.status).toBe(200);
    });

    it('criterio 65 b: un módulo de la web que importa @aquagestion/contratos responde 200 y la dirección con la que importa los contratos responde 200 con JavaScript y no pasa por node_modules/@aquagestion/', async () => {
      const modulo = await pedir(puerto, '/src/modulos/panel/PaginaPanel.tsx');

      expect(modulo.status).toBe(200);
      expect(modulo.tipo).toMatch(/javascript/i);
      const codigo = modulo.cuerpo.toString('utf8');
      expect(codigo, 'la transformación no debe nombrar node_modules/@aquagestion/').not.toContain(
        'node_modules/@aquagestion/',
      );
      // La primera dirección importada que contiene `contratos`: `from "…"` o `import("…")`.
      const direccion = /(?:from\s*|import\s*\(\s*|import\s+)["']([^"']*contratos[^"']*)["']/.exec(codigo)?.[1];
      expect(direccion, 'el módulo transformado debía importar los contratos').toBeTypeOf('string');
      expect(direccion).not.toContain('node_modules/@aquagestion/');

      const contratos = await pedir(puerto, direccion);

      expect(contratos.status, `GET ${direccion}`).toBe(200);
      expect(contratos.tipo).toMatch(/javascript/i);
      expect(contratos.cuerpo.toString('utf8')).not.toContain('node_modules/@aquagestion/');
    });
  });
});
