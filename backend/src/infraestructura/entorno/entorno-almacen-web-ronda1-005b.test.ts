// spec: 005-inscripcion-publica (pruebas protegidas)
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ErrorEntorno, validarEntorno } from './entorno';

// Criterio 62 b (crítico, ronda 1 del ataque de la 005b, falla 2): el almacén de archivos nunca queda dentro de lo que sirve la web. Al arrancar, la API
// rechaza un `ALMACEN_DIRECTORIO` que, ya resuelto (relativo a la raíz del repositorio), sea `frontend/`, `packages/` o `node_modules/` de la raíz, o
// quede dentro de alguna de esas carpetas (también `frontend/public/…`, que Vite sirve en `/` y copia al compilar). `validarEntorno` suma el problema
// 'La variable ALMACEN_DIRECTORIO no puede estar dentro de las carpetas que sirve la web.', que nombra la variable y no muestra la ruta. En Windows la
// comparación no distingue mayúsculas. El valor por defecto (`backend/almacenamiento`), uno en `backend/`, uno en la raíz (por ejemplo `almacen`) y uno
// fuera del repositorio siguen aceptándose.

const URL_APP = 'postgresql://aquagestion_app:clave-secreta@127.0.0.1:5432/aquagestion';
const JWT = randomBytes(32).toString('base64url');
const BASE = { DATABASE_URL_APP: URL_APP, JWT_SECRETO: JWT };
// La raíz del repositorio: este archivo está en backend/src/infraestructura/entorno/.
const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');
const PROBLEMA = 'La variable ALMACEN_DIRECTORIO no puede estar dentro de las carpetas que sirve la web.';

function problemasDe(almacen: string | undefined): readonly string[] {
  try {
    validarEntorno({ ...BASE, ALMACEN_DIRECTORIO: almacen });
  } catch (error) {
    if (error instanceof ErrorEntorno) return error.problemas;
    throw error;
  }
  return [];
}

/** Rutas bajo la raíz que la web sirve (o copia al compilar), con su texto relativo y su ruta absoluta. */
const DENTRO_DE_LA_WEB = [
  'frontend',
  'frontend/',
  'frontend/public/fotos',
  'frontend/src/almacen',
  'packages',
  'packages/contratos',
  'packages/contratos/x',
  'node_modules',
  'node_modules/x',
  './frontend/fotos',
  'backend/../frontend/public',
];

/** Rutas que siguen aceptándose: el valor por defecto, `backend/`, la raíz y carpetas con nombres parecidos. */
const FUERA_DE_LA_WEB = [
  'backend/almacenamiento',
  'backend/otro',
  'backend/frontend',
  'almacen',
  'datos/fotos',
  'frontend-fotos',
  'packagesx',
  'node_modules-x',
  './frontend/../backend/almacen-web',
];

describe('validarEntorno: ALMACEN_DIRECTORIO fuera de lo que sirve la web (criterio 62 b)', () => {
  it('criterio 62 b: rechaza una ruta relativa que es frontend/, packages/ o node_modules/ de la raíz o queda dentro, nombrando la variable', () => {
    for (const ruta of DENTRO_DE_LA_WEB) {
      const problemas = problemasDe(ruta);
      expect(problemas, `${ruta} debía rechazarse`).toContain(PROBLEMA);
      expect(problemas, `${ruta}: solo debía haber ese problema`).toHaveLength(1);
    }
  });

  it('criterio 62 b: rechaza las mismas rutas como rutas absolutas', () => {
    for (const ruta of DENTRO_DE_LA_WEB) {
      const absoluta = path.resolve(RAIZ, ruta);
      const problemas = problemasDe(absoluta);
      expect(problemas, `${absoluta} debía rechazarse`).toContain(PROBLEMA);
    }
  });

  it('criterio 62 b: el problema nombra la variable y no muestra la ruta', () => {
    const secreta = 'frontend/public/fotos-de-menores-secreto-005b';
    const problemas = problemasDe(secreta);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toBe(PROBLEMA);
    expect(problemas[0]).toContain('ALMACEN_DIRECTORIO');
    for (const problema of problemas) {
      expect(problema).not.toContain('secreto-005b');
      expect(problema).not.toContain('public');
      expect(problema).not.toContain(RAIZ);
    }
  });

  it('criterio 62 b: un valor con espacios alrededor se resuelve igual y también se rechaza', () => {
    expect(problemasDe('  frontend/public  ')).toContain(PROBLEMA);
  });

  it('criterio 62 b: sigue aceptando el valor por defecto, uno en backend/, uno en la raíz y uno fuera del repositorio', () => {
    expect(problemasDe(undefined)).toEqual([]);
    expect(problemasDe('   ')).toEqual([]);
    for (const ruta of FUERA_DE_LA_WEB) {
      expect(problemasDe(ruta), `${ruta} debía aceptarse`).toEqual([]);
    }
    expect(validarEntorno({ ...BASE, ALMACEN_DIRECTORIO: 'backend/almacenamiento' }).ALMACEN_DIRECTORIO).toBe(
      path.join(RAIZ, 'backend', 'almacenamiento'),
    );
    expect(validarEntorno({ ...BASE, ALMACEN_DIRECTORIO: 'almacen' }).ALMACEN_DIRECTORIO).toBe(
      path.join(RAIZ, 'almacen'),
    );
    const fuera = path.join(os.tmpdir(), 'aqua-almacen-fuera-del-repositorio');
    expect(problemasDe(fuera), 'un directorio temporal fuera del repositorio debía aceptarse').toEqual([]);
    expect(validarEntorno({ ...BASE, ALMACEN_DIRECTORIO: fuera }).ALMACEN_DIRECTORIO).toBe(fuera);
  });

  it('criterio 62 b: el rechazo se suma a los demás problemas del entorno', () => {
    let problemas: readonly string[] = [];
    try {
      validarEntorno({ JWT_SECRETO: JWT, ALMACEN_DIRECTORIO: 'frontend' });
    } catch (error) {
      if (!(error instanceof ErrorEntorno)) throw error;
      problemas = error.problemas;
    }

    expect(problemas).toContain(PROBLEMA);
    expect(problemas.some((problema) => problema.includes('DATABASE_URL_APP'))).toBe(true);
  });

  it.runIf(process.platform === 'win32')(
    'criterio 62 b (Windows): la comparación no distingue mayúsculas ni la unidad en minúscula',
    () => {
      const absoluta = path.join(RAIZ, 'frontend', 'public');
      expect(problemasDe('FRONTEND/Public')).toContain(PROBLEMA);
      expect(problemasDe('Node_Modules/X')).toContain(PROBLEMA);
      expect(problemasDe(absoluta.toUpperCase())).toContain(PROBLEMA);
      expect(problemasDe(absoluta.charAt(0).toLowerCase() + absoluta.slice(1))).toContain(PROBLEMA);
      expect(problemasDe(absoluta.replace(/\\/g, '/'))).toContain(PROBLEMA);
    },
  );
});
