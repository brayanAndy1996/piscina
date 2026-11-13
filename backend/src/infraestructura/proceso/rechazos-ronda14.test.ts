// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { textoCompleto } from '../../../test/utilidades/ronda13';
import { comprobarSinValores, DNI_R14, encabezadoDe, lineaDeMarcoConValor } from '../../../test/utilidades/ronda14';
import { cargarFuncionalidad, Prisma } from '../../../test/utilidades/ronda3';

// Criterio 163 (ataque ronda 14, F1; precision de P-42 y de P-40), prueba unitaria de `crearManejadorDeRechazos(registro)`
// (backend/src/infraestructura/proceso/rechazos.ts) con un registro falso y el error (c) del criterio: la escritura de `auditoria` con
// `ip: 'x\n    at 44556677'` (P2007), cuyo mensaje trae una linea que empieza con espacios y `at ` y cuyo `stack` empieza con el encabezado
// exacto `nombre: mensaje`. `registro.error` se llama con `{ err: X }` y `util.inspect(X, { depth: null })` no contiene `44556677`. Con el
// codigo de `623c15b`, la linea del mensaje salia en `X.pila`.

interface RegistroFalso {
  error(datos: object, mensaje: string): void;
}
type CrearManejador = (registro: RegistroFalso) => (motivo: unknown) => void;

async function cargarCrearManejador(): Promise<CrearManejador> {
  const modulo = await cargarFuncionalidad<{ crearManejadorDeRechazos: CrearManejador }>(
    'infraestructura/proceso/rechazos.ts',
    ['crearManejadorDeRechazos'],
  );
  return modulo.crearManejadorDeRechazos;
}

/** El error (c): un `PrismaClientKnownRequestError` P2007 de `auditoria.create` con una `ip` con un salto de linea. */
function errorC(): Error {
  const error = new Prisma.PrismaClientKnownRequestError(
    [
      '',
      'Invalid `prisma.auditoria.create()` invocation:',
      '',
      '',
      'Inconsistent column data: invalid input syntax for type inet:',
      `"x\n    at ${DNI_R14}"`,
    ].join('\n'),
    { code: 'P2007', clientVersion: 'prueba', meta: { modelName: 'Auditoria' } },
  );
  error.stack = [
    encabezadoDe(error.name, error.message),
    '    at manejar (/repo/backend/src/falso.ts:10:5)',
    '    at otro (/repo/backend/src/otro.ts:20:7)',
  ].join('\n');
  return error;
}

function registrar(motivo: unknown, crear: CrearManejador): { datos: Record<string, unknown>; mensaje: string }[] {
  const llamadas: { datos: Record<string, unknown>; mensaje: string }[] = [];
  const registro: RegistroFalso = {
    error: (datos, mensaje) => {
      llamadas.push({ datos: datos as Record<string, unknown>, mensaje });
    },
  };
  crear(registro)(motivo);
  return llamadas;
}

describe('criterio 163: crearManejadorDeRechazos no registra la linea del mensaje que parece un marco (P-40)', () => {
  it('criterio 163: precondicion: el stack del error (c) tiene una linea que empieza con espacios y "at " y contiene el valor', () => {
    const error = errorC();

    expect(lineaDeMarcoConValor(error.stack)).toBeDefined();
  });

  it('criterio 163: con el error (c), registro.error se llama una vez con { err: X } y util.inspect de X no contiene el valor', async () => {
    const crear = await cargarCrearManejador();

    const llamadas = registrar(errorC(), crear);

    expect(llamadas).toHaveLength(1);
    const [{ datos, mensaje }] = llamadas as [{ datos: Record<string, unknown>; mensaje: string }];
    expect(Object.keys(datos), 'solo { err }').toEqual(['err']);
    expect(textoCompleto(datos['err'])).not.toContain(DNI_R14);
    comprobarSinValores(datos['err'], 'err');
    expect(JSON.stringify([datos, mensaje])).not.toContain(DNI_R14);
  });

  it('criterio 163: con el error (c), X lleva el tipo y el codigo de Prisma', async () => {
    const crear = await cargarCrearManejador();

    const llamadas = registrar(errorC(), crear);

    expect(llamadas).toHaveLength(1);
    const texto = textoCompleto(llamadas[0]?.datos['err']);
    expect(texto).toContain('PrismaClientKnownRequestError');
    expect(texto).toContain('P2007');
  });

  it('criterio 163: con el error (c) como cause de un Error propio, tampoco llega el valor al registro', async () => {
    const crear = await cargarCrearManejador();
    const propio = new Error('No se pudo registrar la auditoria', { cause: errorC() });

    const llamadas = registrar(propio, crear);

    expect(llamadas).toHaveLength(1);
    expect(textoCompleto(llamadas[0]?.datos['err'])).not.toContain(DNI_R14);
    expect(JSON.stringify(llamadas[0]?.datos['err'])).not.toContain(DNI_R14);
  });

  it('criterio 163 (control, 157 sin cambios): con un Error que no es de la base, registro.error recibe { err: <el mismo error> }', async () => {
    const crear = await cargarCrearManejador();
    const error = new Error('fallo comun de prueba r14');

    const llamadas = registrar(error, crear);

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.datos['err'], 'el mismo error, no una copia').toBe(error);
  });
});
