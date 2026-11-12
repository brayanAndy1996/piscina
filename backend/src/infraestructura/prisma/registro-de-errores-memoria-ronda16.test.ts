// spec: 001-academias-aislamiento (pruebas protegidas)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Criterio 167 (t11) (ataque ronda 16, F1; precisa el criterio 165 y P-42), prueba de memoria: un proceso hijo con
// `--max-old-space-size=256 --import tsx` ejecuta `errorParaRegistro` con (t1) (solo la excepcion con el Buffer de 5 MB), (t3) (arreglo de
// 2 millones de elementos) y (t4) (objeto `String` de 5 millones de caracteres) y escribe por la salida estandar, por cada caso, si el
// resultado es el mismo objeto, si tiene `truncado` y si tiene `mensaje`. Con el codigo de `8b503d2` el hijo terminaba por falta de
// memoria (`Reflect.ownKeys` de millones de claves con el heap de 256 MB). Con la busqueda acotada termina con codigo 0 y escribe:
//   t1 convertido con `mensaje` (no es el mismo objeto, sin `truncado`); t3 y t4 con `truncado`.
// El script del hijo es `backend/test/utilidades/registro-grande-hijo.ts`. Funciona igual en Windows, Mac y Linux: `process.execPath` y rutas con
// `node:path`, sin comandos de Unix.

const RAIZ_BACKEND = path.resolve(__dirname, '..', '..', '..');
const SCRIPT_DEL_HIJO = path.join(RAIZ_BACKEND, 'test', 'utilidades', 'registro-grande-hijo.ts');
const LIMITE_DEL_HIJO_MS = 60_000;

interface LineaDelHijo {
  caso: string;
  mismo: boolean;
  truncado: boolean;
  conMensaje: boolean;
}

function ejecutarHijo(): {
  estado: number | null;
  senal: NodeJS.Signals | null;
  salida: string;
  errores: string;
  error?: Error;
} {
  const entorno = { ...process.env };
  delete entorno['NODE_OPTIONS'];
  const proceso = spawnSync(process.execPath, ['--max-old-space-size=256', '--import', 'tsx', SCRIPT_DEL_HIJO], {
    cwd: RAIZ_BACKEND,
    encoding: 'utf8',
    timeout: LIMITE_DEL_HIJO_MS,
    windowsHide: true,
    env: entorno,
  });
  return {
    estado: proceso.status,
    senal: proceso.signal,
    salida: proceso.stdout,
    errores: proceso.stderr,
    ...(proceso.error ? { error: proceso.error } : {}),
  };
}

describe('criterio 167 (t11): la busqueda no agota la memoria de un proceso con 256 MB', () => {
  it(
    'criterio 167 (t11): errorParaRegistro con (t1), (t3) y (t4) en un hijo con --max-old-space-size=256 termina con codigo 0 y escribe lo esperado',
    () => {
      const hijo = ejecutarHijo();

      expect(hijo.error, `no se pudo ejecutar el hijo: ${String(hijo.error)}`).toBeUndefined();
      const detalle = `estado ${String(hijo.estado)}, senal ${String(hijo.senal)}; stderr (final): ${hijo.errores.slice(-600)}`;
      expect(hijo.estado, `el hijo debia terminar con codigo 0 (${detalle})`).toBe(0);
      const lineas = hijo.salida
        .split(/\r?\n/)
        .filter((linea) => linea.trim() !== '')
        .map((linea) => JSON.parse(linea) as LineaDelHijo);
      expect(
        lineas.map((linea) => linea.caso),
        'el hijo debia escribir una linea por caso',
      ).toEqual(['t1', 't3', 't4']);
      const [t1, t3, t4] = lineas as [LineaDelHijo, LineaDelHijo, LineaDelHijo];
      expect(t1, '(t1): convertido, con mensaje y sin truncado').toEqual({
        caso: 't1',
        mismo: false,
        truncado: false,
        conMensaje: true,
      });
      expect(t3.truncado, '(t3): truncado').toBe(true);
      expect(t3.mismo, '(t3): no es el mismo objeto').toBe(false);
      expect(t4.truncado, '(t4): truncado').toBe(true);
      expect(t4.mismo, '(t4): no es el mismo objeto').toBe(false);
    },
    LIMITE_DEL_HIJO_MS + 30_000,
  );
});
