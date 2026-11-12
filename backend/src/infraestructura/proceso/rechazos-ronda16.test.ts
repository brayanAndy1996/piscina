// spec: 001-academias-aislamiento (pruebas protegidas)
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { comoObjeto } from '../../../test/utilidades/ronda13';
import {
  PROHIBIDOS_R16,
  comprobarConvertidoR16,
  comprobarNoEsElMismo,
  comprobarSinValoresR16,
  crearBase16,
  crearG1,
  crearG3ConPrecondicion,
  esLaFormaLimpiaDeBase16,
} from '../../../test/utilidades/ronda16';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 168 (ataque ronda 16, O1; amplia el criterio 165 y precisa P-42 y P-40), prueba unitaria de
// `crearManejadorDeRechazos(registro)` (backend/src/infraestructura/proceso/rechazos.ts) con (g1) `ErrorDeServicio` con un getter heredado
// `cause` que devuelve `base16` y (g3) `Object.assign(new Error('No se pudo guardar'), { cause: espia })`, con `espia` una funcion que
// devuelve `base16`. `registro.error` recibe `{ err: X }` y `X` cumple lo mismo que el resultado de `errorParaRegistro`: no es el mismo
// error, no contiene los valores (util.inspect con showHidden, JSON.stringify ni pino) y, en (g3), la funcion no se llama nunca.

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

describe('criterio 168: crearManejadorDeRechazos no registra el valor de una cause leida por su nombre (P-40)', () => {
  it('criterio 168 (g1): registro.error recibe { err: X } con X convertido: tipo ErrorDeServicio y la causa con la forma limpia de base16', async () => {
    const crear = await cargarCrearManejador();
    const motivo = crearG1(crearBase16());

    const llamadas = registrar(motivo, crear);

    expect(llamadas).toHaveLength(1);
    const [{ datos, mensaje }] = llamadas as [{ datos: Record<string, unknown>; mensaje: string }];
    expect(Object.keys(datos), 'solo { err }').toEqual(['err']);
    const err = comprobarConvertidoR16(datos['err'], motivo, 'manejador g1', { bases: 1 });
    expect(err['tipo']).toBe('ErrorDeServicio');
    expect(err['mensaje']).toBe('No se pudo guardar');
    esLaFormaLimpiaDeBase16(err['causa'], 'manejador g1 causa');
    for (const prohibido of PROHIBIDOS_R16) expect(JSON.stringify([datos, mensaje])).not.toContain(prohibido);
  });

  it('criterio 168 (g3): registro.error recibe { err: { tipo: "Error", truncado: true } } y la funcion cause no se llama', async () => {
    const crear = await cargarCrearManejador();
    const { error: motivo, llamadas: llamadasDeLaFuncion } = crearG3ConPrecondicion(crearBase16());

    const llamadas = registrar(motivo, crear);

    expect(llamadas).toHaveLength(1);
    const [{ datos }] = llamadas as [{ datos: Record<string, unknown>; mensaje: string }];
    expect(Object.keys(datos), 'solo { err }').toEqual(['err']);
    const err = comprobarNoEsElMismo(datos['err'], motivo, 'manejador g3');
    expect(Object.keys(err).sort()).toEqual(['tipo', 'truncado']);
    expect(err['truncado']).toBe(true);
    comprobarSinValoresR16(err, 'manejador g3');
    expect(llamadasDeLaFuncion(), 'la funcion cause no debe llamarse').toBe(0);
  });

  it('criterio 168 (g1): con un pino real con destino en memoria, lo que se escribe no contiene los valores y contiene el tipo y el codigo de Prisma', async () => {
    const crear = await cargarCrearManejador();
    const salida: string[] = [];
    const log = pino(
      { level: 'error' },
      {
        write: (linea: string) => {
          salida.push(linea);
        },
      },
    );

    crear({ error: (datos, mensaje) => log.error(datos, mensaje) })(crearG1(crearBase16()));

    const texto = salida.join('');
    expect(texto).not.toBe('');
    for (const prohibido of PROHIBIDOS_R16) expect(texto, `no debe contener "${prohibido}"`).not.toContain(prohibido);
    expect(texto).toContain('ErrorDeServicio');
    expect(texto).toContain('P2007');
  });

  it('criterio 168 (g3): con un pino real con destino en memoria, no se escriben los valores y la funcion no se llama', async () => {
    const crear = await cargarCrearManejador();
    const { error, llamadas } = crearG3ConPrecondicion(crearBase16());
    const salida: string[] = [];
    const log = pino(
      { level: 'error' },
      {
        write: (linea: string) => {
          salida.push(linea);
        },
      },
    );

    crear({ error: (datos, mensaje) => log.error(datos, mensaje) })(error);

    const texto = salida.join('');
    expect(texto).not.toBe('');
    for (const prohibido of PROHIBIDOS_R16) expect(texto, `no debe contener "${prohibido}"`).not.toContain(prohibido);
    const linea = comoObjeto((JSON.parse(texto) as { err?: unknown }).err, 'g3 err');
    expect(linea['truncado']).toBe(true);
    expect(llamadas(), 'la funcion cause no debe llamarse').toBe(0);
  });

  it('criterio 168 (control, 157 sin cambios): con un Error comun, registro.error recibe { err: <el mismo error> }', async () => {
    const crear = await cargarCrearManejador();
    const error = Object.assign(new Error('fallo comun de prueba r16'), { detalle: { a: 1 } });

    const llamadas = registrar(error, crear);

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.datos['err'], 'el mismo error, no una copia').toBe(error);
  });
});
