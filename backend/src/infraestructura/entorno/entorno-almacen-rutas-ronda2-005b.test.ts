// spec: 005-inscripcion-publica (pruebas protegidas)
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as entorno from './entorno';
import { ErrorEntorno, validarEntorno } from './entorno';

// Criterio 66 (crítico, ronda 2 del ataque de la 005b, falla 3; amplía el 62 b): el rechazo de un `ALMACEN_DIRECTORIO` dentro de lo que sirve la web
// comparaba con `path.relative`, que no entiende varias formas que Windows sí acepta (`\\?\C:\…`, `\\.\C:\…`, rutas de red, `\??\C:\…`, segmentos que
// terminan en punto o en espacio, nombres cortos 8.3). Desde este criterio (decisión AB2-3) la resolución y el rechazo viven en una función pura
// exportada por `entorno.ts`, que se prueba aquí con `path.win32` y `path.posix` (así corre igual en la nube y en Windows):
//
//   resolverAlmacenDirectorio(valor: string | undefined, opciones: { raiz: string; ruta: path.PlatformPath }): { directorio: string } | { problema: string }
//
// Las reglas van en este orden y la primera que falla decide (un solo problema por valor):
//   a) el valor se recorta; vacío o ausente es `backend/almacenamiento`; con un carácter de control (U+0000 a U+001F), "no es una ruta válida";
//   b) solo con `path.win32`, "no es una ruta válida" si empieza con dos separadores, tiene `<`, `>`, `"`, `|`, `?` o `*`, tiene `:` fuera de la unidad
//      del principio, o tiene un segmento (distinto de `.` y `..`) que termina en punto o en espacio;
//   c) se resuelve con `ruta.resolve(raiz, valor)`; si es `frontend`, `packages` o `node_modules` de la raíz o queda debajo, "no puede estar dentro de las
//      carpetas que sirve la web"; la comparación es por segmentos y no distingue mayúsculas en ningún sistema; con `path.win32`, un segmento con forma de
//      nombre corto (`NODE_M~1`) coincide con cualquier segmento de la carpeta en esa posición;
//   d) si no hay problema, `directorio` es la ruta resuelta.
// `validarEntorno` la llama con la raíz del repositorio y el `path` del sistema y suma el problema a los demás.

const NO_ES_RUTA = 'La variable ALMACEN_DIRECTORIO no es una ruta válida.';
const DENTRO_DE_LA_WEB = 'La variable ALMACEN_DIRECTORIO no puede estar dentro de las carpetas que sirve la web.';

type Resultado = { directorio: string } | { problema: string };
type Resolver = (valor: string | undefined, opciones: { raiz: string; ruta: path.PlatformPath }) => Resultado;

/** Llama a `resolverAlmacenDirectorio` de `entorno.ts`; si todavía no existe, la prueba falla con un mensaje claro (no con un error de tipos). */
const resolver: Resolver = (valor, opciones) => {
  const funcion = (entorno as unknown as { resolverAlmacenDirectorio?: Resolver }).resolverAlmacenDirectorio;
  if (typeof funcion !== 'function') {
    throw new Error('entorno.ts debe exportar la función pura resolverAlmacenDirectorio (criterio 66).');
  }
  return funcion(valor, opciones);
};

const RAIZ_WIN = 'C:\\Users\\bryan\\piscina';
const RAIZ_POSIX = '/home/u/piscina';
const win = (valor: string | undefined) => resolver(valor, { raiz: RAIZ_WIN, ruta: path.win32 });
const posix = (valor: string | undefined) => resolver(valor, { raiz: RAIZ_POSIX, ruta: path.posix });

/** Valores de Windows que no son una ruta válida (regla b) o que traen un carácter de control (regla a). */
const NO_VALIDAS_WIN: readonly string[] = [
  '\\\\?\\C:\\Users\\bryan\\piscina\\frontend\\public\\fotos',
  '\\\\?\\D:\\almacen',
  '\\\\.\\C:\\Users\\bryan\\piscina\\frontend\\public\\fotos',
  '\\\\localhost\\C$\\Users\\bryan\\piscina\\frontend\\public\\fotos',
  '\\\\127.0.0.1\\c$\\Users\\bryan\\piscina\\node_modules\\x',
  '//localhost/C$/Users/bryan/piscina/frontend/x',
  '\\/localhost\\C$\\x',
  '\\??\\C:\\Users\\bryan\\piscina\\frontend\\x',
  'frontend.\\public',
  'frontend \\public',
  'frontend...\\public',
  'C:\\Users\\bryan\\piscina\\node_modules. \\x',
  'C:\\Users\\bryan\\piscina\\frontend\\x:datos',
  'D:frontend',
  'C:frontend\\public',
  'frontend\\pub*',
  'frontend\\a|b',
  'almacen\u0001x',
];

/** Valores de Windows que quedan dentro de las carpetas que sirve la web (regla c). */
const DENTRO_WIN: readonly string[] = [
  'NODE_M~1\\x',
  'FRONTE~1\\public',
  'C:\\Users\\BRYAN~1\\piscina\\frontend\\x',
  'C:\\Users\\bryan\\PISCIN~1\\packages\\x',
  'c:\\users\\bryan\\piscina\\FRONTEND\\x',
  'C:/Users/bryan/piscina/frontend/x',
  '\\Users\\bryan\\piscina\\frontend\\x',
  'FRONTEND\\public',
];

/** Valores de Windows que se aceptan, con la ruta resuelta que devuelve `directorio` (regla d). */
const ACEPTADAS_WIN: readonly (readonly [string, string])[] = [
  ['backend\\almacenamiento', 'C:\\Users\\bryan\\piscina\\backend\\almacenamiento'],
  ['backend/almacenamiento', 'C:\\Users\\bryan\\piscina\\backend\\almacenamiento'],
  ['almacen', 'C:\\Users\\bryan\\piscina\\almacen'],
  ['D:\\almacen', 'D:\\almacen'],
  ['C:\\datos\\almacen', 'C:\\datos\\almacen'],
  [
    'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\aqua-almacen-x',
    'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\aqua-almacen-x',
  ],
  ['backend\\ALMACE~1', 'C:\\Users\\bryan\\piscina\\backend\\ALMACE~1'],
  ['C:\\Users\\bryan\\PISCIN~1\\backend\\x', 'C:\\Users\\bryan\\PISCIN~1\\backend\\x'],
  ['backend\\almacen.v2', 'C:\\Users\\bryan\\piscina\\backend\\almacen.v2'],
  ['..\\almacen-fuera', 'C:\\Users\\bryan\\almacen-fuera'],
  ['', 'C:\\Users\\bryan\\piscina\\backend\\almacenamiento'],
];

function esProblema(resultado: Resultado): resultado is { problema: string } {
  return 'problema' in resultado;
}

describe('resolverAlmacenDirectorio con path.win32 (criterio 66)', () => {
  describe('b) formas de ruta que Windows acepta y no son una ruta válida', () => {
    it.each(conTitulos(NO_VALIDAS_WIN))('criterio 66 b: %s da "no es una ruta válida"', (_titulo, valor) => {
      const resultado = win(valor);

      expect(esProblema(resultado), `${JSON.stringify(valor)} debía rechazarse`).toBe(true);
      expect(resultado).toEqual({ problema: NO_ES_RUTA });
    });
  });

  describe('c) dentro de las carpetas que sirve la web', () => {
    it.each(conTitulos(DENTRO_WIN))(
      'criterio 66 c: %s da "dentro de las carpetas que sirve la web"',
      (_titulo, valor) => {
        const resultado = win(valor);

        expect(esProblema(resultado), `${JSON.stringify(valor)} debía rechazarse`).toBe(true);
        expect(resultado).toEqual({ problema: DENTRO_DE_LA_WEB });
      },
    );
  });

  describe('d) rutas aceptadas', () => {
    it.each(ACEPTADAS_WIN.map(([valor, directorio]) => [JSON.stringify(valor), valor, directorio] as const))(
      'criterio 66 d: %s se acepta',
      (_titulo, valor, directorio) => {
        expect(win(valor)).toEqual({ directorio });
      },
    );

    it('criterio 66 a: el valor ausente o con solo espacios es backend\\almacenamiento', () => {
      const esperado = { directorio: 'C:\\Users\\bryan\\piscina\\backend\\almacenamiento' };

      expect(win(undefined)).toEqual(esperado);
      expect(win('   ')).toEqual(esperado);
    });

    it('criterio 66 a: el valor se recorta antes de resolverlo', () => {
      expect(win('  backend\\almacenamiento  ')).toEqual({
        directorio: 'C:\\Users\\bryan\\piscina\\backend\\almacenamiento',
      });
      expect(win('  frontend\\public  ')).toEqual({ problema: DENTRO_DE_LA_WEB });
      expect(win('\t node_modules\\x \n')).toEqual({ problema: DENTRO_DE_LA_WEB });
    });
  });

  describe('orden de las reglas y forma del problema', () => {
    it('criterio 66: hay un solo problema por valor: una ruta inválida que además queda dentro de la web da solo "no es una ruta válida"', () => {
      for (const valor of NO_VALIDAS_WIN.filter((v) => /frontend|node_modules/i.test(v))) {
        const resultado = win(valor);

        expect(resultado, JSON.stringify(valor)).toEqual({ problema: NO_ES_RUTA });
        expect(Object.keys(resultado), 'un problema no trae directorio').toEqual(['problema']);
      }
    });

    it('criterio 66: cada problema nombra la variable y no muestra la ruta', () => {
      for (const valor of [...NO_VALIDAS_WIN, ...DENTRO_WIN]) {
        const resultado = win(valor);

        expect(esProblema(resultado), `${JSON.stringify(valor)} debía rechazarse`).toBe(true);
        const problema = (resultado as { problema: string }).problema;
        expect(problema).toContain('ALMACEN_DIRECTORIO');
        expect(problema).not.toContain(RAIZ_WIN);
        expect(problema).not.toContain('bryan');
        expect(problema).not.toContain('localhost');
        expect(problema).not.toContain('public');
        expect(problema).not.toContain('x:datos');
      }
    });
  });
});

describe('resolverAlmacenDirectorio con path.posix (criterio 66)', () => {
  it('criterio 66 c: la comparación no distingue mayúsculas en ningún sistema: FRONTEND/x, Node_Modules/x y /home/u/piscina/Packages/x dan el problema de la web', () => {
    for (const valor of ['FRONTEND/x', 'Node_Modules/x', '/home/u/piscina/Packages/x']) {
      expect(posix(valor), valor).toEqual({ problema: DENTRO_DE_LA_WEB });
    }
  });

  it('criterio 66 c: las carpetas de la web por su nombre y las rutas debajo siguen rechazadas, también como rutas absolutas', () => {
    for (const valor of [
      'frontend',
      'frontend/public/fotos',
      'packages/contratos',
      'node_modules',
      '/home/u/piscina/frontend/x',
      './frontend/../node_modules/x',
    ]) {
      expect(posix(valor), valor).toEqual({ problema: DENTRO_DE_LA_WEB });
    }
  });

  it('criterio 66 c/d: NODE_M~1/x (los nombres cortos no son comodín fuera de Windows), backend/almacenamiento y /tmp/aqua-almacen-x se aceptan', () => {
    expect(posix('NODE_M~1/x')).toEqual({ directorio: '/home/u/piscina/NODE_M~1/x' });
    expect(posix('backend/almacenamiento')).toEqual({ directorio: '/home/u/piscina/backend/almacenamiento' });
    expect(posix('/tmp/aqua-almacen-x')).toEqual({ directorio: '/tmp/aqua-almacen-x' });
    expect(posix('')).toEqual({ directorio: '/home/u/piscina/backend/almacenamiento' });
    expect(posix(undefined)).toEqual({ directorio: '/home/u/piscina/backend/almacenamiento' });
  });

  it('criterio 66 a: un byte nulo u otro carácter de control (U+0000 a U+001F) dentro del valor da "no es una ruta válida"', () => {
    for (const valor of ['almacen\u0000x', 'almacen\u0001x', 'a\u001fb', 'a\tb/c', '/tmp/\u0007x']) {
      expect(posix(valor), JSON.stringify(valor)).toEqual({ problema: NO_ES_RUTA });
    }
    expect(win('almacen\u0000x')).toEqual({ problema: NO_ES_RUTA });
  });

  it('criterio 66 b: las reglas de Windows solo valen con path.win32: en posix, `a:b/x`, `a*b` y un segmento que termina en punto se aceptan', () => {
    for (const [valor, directorio] of [
      ['a:b/x', '/home/u/piscina/a:b/x'],
      ['a*b', '/home/u/piscina/a*b'],
      ['frontend./x', '/home/u/piscina/frontend./x'],
      ['almacen /x', '/home/u/piscina/almacen /x'],
    ] as const) {
      expect(posix(valor), valor).toEqual({ directorio });
    }
  });

  it('criterio 66: cada problema nombra la variable y no muestra la ruta', () => {
    for (const valor of ['FRONTEND/x', 'Node_Modules/secreto-66', 'almacen\u0001x']) {
      const resultado = posix(valor);

      expect(esProblema(resultado), JSON.stringify(valor)).toBe(true);
      const problema = (resultado as { problema: string }).problema;
      expect(problema).toContain('ALMACEN_DIRECTORIO');
      expect(problema).not.toContain('secreto-66');
      expect(problema).not.toContain(RAIZ_POSIX);
    }
  });
});

// --------------------------------------------------------------------------------------------------------------------------------------------------
// validarEntorno con el path del sistema
// --------------------------------------------------------------------------------------------------------------------------------------------------

const URL_APP = 'postgresql://aquagestion_app:clave-secreta@127.0.0.1:5432/aquagestion';
const BASE = { DATABASE_URL_APP: URL_APP, JWT_SECRETO: randomBytes(32).toString('base64url') };
// La raíz del repositorio: este archivo está en backend/src/infraestructura/entorno/.
const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');

function problemasDe(almacen: string | undefined): readonly string[] {
  try {
    validarEntorno({ ...BASE, ALMACEN_DIRECTORIO: almacen });
  } catch (error) {
    if (error instanceof ErrorEntorno) return error.problemas;
    throw error;
  }
  return [];
}

describe('validarEntorno usa resolverAlmacenDirectorio con la raíz del repositorio y el path del sistema (criterio 66)', () => {
  it('criterio 66 c: la comparación no distingue mayúsculas en ningún sistema: FRONTEND/public, Node_Modules/x y Packages se rechazan', () => {
    for (const valor of ['FRONTEND/public', 'Node_Modules/x', 'Packages', path.join(RAIZ, 'Frontend', 'x')]) {
      const problemas = problemasDe(valor);

      expect(problemas, `${valor} debía rechazarse`).toEqual([DENTRO_DE_LA_WEB]);
    }
  });

  it('criterio 66 a: un carácter de control (U+0001) en el valor da "no es una ruta válida", y el byte nulo sigue dando ese problema', () => {
    expect(problemasDe('almacen\u0001x')).toEqual([NO_ES_RUTA]);
    expect(problemasDe('almacen\u0000x')).toEqual([NO_ES_RUTA]);
  });

  it('criterio 66: el valor por defecto y uno fuera del repositorio siguen aceptándose, con la ruta resuelta', () => {
    expect(problemasDe(undefined)).toEqual([]);
    const fuera = path.join(os.tmpdir(), 'aqua-almacen-criterio-66');
    expect(problemasDe(fuera)).toEqual([]);
    expect(validarEntorno({ ...BASE, ALMACEN_DIRECTORIO: fuera }).ALMACEN_DIRECTORIO).toBe(fuera);
    expect(validarEntorno({ ...BASE, ALMACEN_DIRECTORIO: undefined }).ALMACEN_DIRECTORIO).toBe(
      path.join(RAIZ, 'backend', 'almacenamiento'),
    );
  });

  it.runIf(process.platform === 'win32')(
    'criterio 66 (Windows): \\\\?\\ seguido de la ruta absoluta de frontend\\public y frontend.\\public dan "no es una ruta válida"; NODE_M~1\\x da el problema de la web',
    () => {
      const absoluta = path.join(RAIZ, 'frontend', 'public');

      expect(problemasDe(`\\\\?\\${absoluta}`)).toEqual([NO_ES_RUTA]);
      expect(problemasDe(`\\\\.\\${absoluta}`)).toEqual([NO_ES_RUTA]);
      expect(problemasDe('frontend.\\public')).toEqual([NO_ES_RUTA]);
      expect(problemasDe('NODE_M~1\\x')).toEqual([DENTRO_DE_LA_WEB]);
    },
  );

  it.runIf(process.platform === 'win32')(
    'criterio 66 (Windows): una carpeta dentro de os.tmpdir() (que en la integración continua lleva un nombre corto) no da ningún problema',
    () => {
      const dentroDelTemporal = path.join(os.tmpdir(), 'aqua-almacen-criterio-66');

      expect(problemasDe(dentroDelTemporal)).toEqual([]);
      expect(validarEntorno({ ...BASE, ALMACEN_DIRECTORIO: dentroDelTemporal }).ALMACEN_DIRECTORIO).toBe(
        dentroDelTemporal,
      );
    },
  );
});

/** Pares `[título, valor]` para `it.each`: el título muestra el valor entre comillas con sus caracteres especiales escapados. */
function conTitulos(valores: readonly string[]): (readonly [string, string])[] {
  return valores.map((valor) => [JSON.stringify(valor), valor] as const);
}
