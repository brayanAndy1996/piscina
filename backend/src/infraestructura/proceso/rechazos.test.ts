// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 157 (ataque ronda 12, F1, forma `void`; P-40), prueba unitaria de `crearManejadorDeRechazos(registro)`
// (backend/src/infraestructura/proceso/rechazos.ts), con un registro falso y `process.exit` espiado:
//   - con un `Error`, llama una vez a `registro.error` con `{ err: <el mismo error> }` y un texto;
//   - con algo que no es un `Error` (una cadena 'dato-secreto-r12', un objeto `{ dni: '12345678' }`, ...), el registro tiene solo el tipo
//     (`typeof`) y no contiene ese texto ni ese valor;
//   - en ningun caso llama a `process.exit`, lanza, cambia `process.exitCode` ni registra manejadores en `process` (no se registra
//     `uncaughtException`).

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

describe('criterio 157: crearManejadorDeRechazos (P-40)', () => {
  let llamadas: [object, string][];
  let registro: RegistroFalso;
  let salir: MockInstance;
  let alRegistrar: MockInstance;
  let codigoDeSalidaAntes: typeof process.exitCode;
  let manejadoresAntes: Record<'uncaughtException' | 'unhandledRejection', number>;

  beforeEach(() => {
    llamadas = [];
    registro = {
      error: (datos, mensaje) => {
        llamadas.push([datos, mensaje]);
      },
    };
    salir = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    alRegistrar = vi.spyOn(process, 'on');
    codigoDeSalidaAntes = process.exitCode;
    manejadoresAntes = {
      uncaughtException: process.listenerCount('uncaughtException'),
      unhandledRejection: process.listenerCount('unhandledRejection'),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Lo que no debe pasar con ninguna entrada: terminar el proceso, cambiar su codigo de salida o registrar manejadores. */
  function comprobarQueElProcesoSigue(): void {
    expect(salir, 'no llama a process.exit').not.toHaveBeenCalled();
    expect(process.exitCode, 'no cambia process.exitCode').toBe(codigoDeSalidaAntes);
    expect(alRegistrar, 'no registra manejadores en process').not.toHaveBeenCalled();
    expect(process.listenerCount('uncaughtException'), 'no registra uncaughtException').toBe(
      manejadoresAntes.uncaughtException,
    );
    expect(process.listenerCount('unhandledRejection')).toBe(manejadoresAntes.unhandledRejection);
  }

  it('criterio 157: con un Error, llama una vez a registro.error con { err: <el mismo error> } y un texto', async () => {
    const crear = await cargarCrearManejador();
    const error = new Error('fallo de prueba r12');

    const manejador = crear(registro);
    expect(() => manejador(error)).not.toThrow();

    expect(llamadas).toHaveLength(1);
    const [datos, mensaje] = llamadas[0] as [Record<string, unknown>, string];
    expect(datos['err'], 'el mismo error, no una copia').toBe(error);
    expect(Object.keys(datos), 'solo { err }').toEqual(['err']);
    expect(typeof mensaje).toBe('string');
    expect(mensaje.length, 'un mensaje fijo no vacio').toBeGreaterThan(0);
    comprobarQueElProcesoSigue();
  });

  it('criterio 157: un subtipo de Error (TypeError) tambien se registra como { err }', async () => {
    const crear = await cargarCrearManejador();
    const error = new TypeError('tipo incorrecto r12');

    crear(registro)(error);

    expect(llamadas).toHaveLength(1);
    expect((llamadas[0] as [Record<string, unknown>, string])[0]['err']).toBe(error);
    comprobarQueElProcesoSigue();
  });

  it("criterio 157: con la cadena 'dato-secreto-r12', el registro tiene el tipo y no contiene el texto", async () => {
    const crear = await cargarCrearManejador();

    expect(() => crear(registro)('dato-secreto-r12')).not.toThrow();

    expect(llamadas).toHaveLength(1);
    const [datos, mensaje] = llamadas[0] as [Record<string, unknown>, string];
    expect(datos).toMatchObject({ tipo: 'string' });
    expect(datos, 'no es un { err }').not.toHaveProperty('err');
    expect(JSON.stringify([datos, mensaje]), 'el registro no contiene el valor rechazado').not.toContain(
      'dato-secreto-r12',
    );
    comprobarQueElProcesoSigue();
  });

  it("criterio 157: con el objeto { dni: '12345678' }, el registro tiene el tipo y no contiene ese valor ni sus claves", async () => {
    const crear = await cargarCrearManejador();

    expect(() => crear(registro)({ dni: '12345678' })).not.toThrow();

    expect(llamadas).toHaveLength(1);
    const [datos, mensaje] = llamadas[0] as [Record<string, unknown>, string];
    expect(datos).toMatchObject({ tipo: 'object' });
    expect(datos, 'no es un { err }').not.toHaveProperty('err');
    const texto = JSON.stringify([datos, mensaje]);
    expect(texto, 'el registro no contiene el valor rechazado').not.toContain('12345678');
    expect(texto, 'el registro no contiene las claves del objeto rechazado').not.toContain('dni');
    comprobarQueElProcesoSigue();
  });

  it.each([
    ['undefined', undefined, 'undefined'],
    ['null', null, 'object'],
    ['un numero', 42, 'number'],
    ['un booleano', false, 'boolean'],
    ['un bigint', 10n, 'bigint'],
    ['un simbolo', Symbol('secreto-r12'), 'symbol'],
    ['una funcion', () => undefined, 'function'],
    ['un arreglo', ['secreto-r12'], 'object'],
  ])('criterio 157: con %s (no es un Error), registra solo su tipo y no lanza', async (_nombre, motivo, tipo) => {
    const crear = await cargarCrearManejador();

    expect(() => crear(registro)(motivo)).not.toThrow();

    expect(llamadas).toHaveLength(1);
    const [datos, mensaje] = llamadas[0] as [Record<string, unknown>, string];
    expect(datos).toMatchObject({ tipo });
    expect(datos).not.toHaveProperty('err');
    expect(JSON.stringify([datos, mensaje])).not.toContain('secreto-r12');
    comprobarQueElProcesoSigue();
  });

  it('criterio 157: un mismo manejador registra cada rechazo que recibe, uno por uno, sin terminar el proceso', async () => {
    const crear = await cargarCrearManejador();
    const manejador = crear(registro);

    manejador(new Error('uno'));
    manejador('dos');
    manejador(new Error('tres'));

    expect(llamadas.map(([datos]) => Object.keys(datos))).toEqual([['err'], ['tipo'], ['err']]);
    comprobarQueElProcesoSigue();
  });
});
