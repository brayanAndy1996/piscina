// spec: 001-academias-aislamiento (pruebas protegidas)
import { InternalServerErrorException } from '@nestjs/common';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { comoObjeto } from '../../../test/utilidades/ronda13';
import { comprobarConvertido, crearBase, DNI_R15, PROHIBIDOS_R15 } from '../../../test/utilidades/ronda15';
import { cargarFuncionalidad } from '../../../test/utilidades/ronda3';

// Criterio 165 (ataque ronda 15, F1; precision de P-42 y de P-40), prueba unitaria de `crearManejadorDeRechazos(registro)`
// (backend/src/infraestructura/proceso/rechazos.ts) con (u1) `new InternalServerErrorException(base)` y (u4)
// `Object.assign(new Error('Fallo de prueba r15'), { detalle: base })`, donde `base` es un error falso con forma de error de Prisma con el
// valor `44556677` en su mensaje. `registro.error` recibe `{ err: X }` y `X` cumple lo mismo que el resultado de `errorParaRegistro`: no es
// el mismo error, y ni `util.inspect` con `showHidden`, ni `JSON.stringify`, ni pino contienen los valores. Con el codigo de `6a74044`, el
// registro de (u1) llevaba el valor en `message`, `stack` y `response`.

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

/** (u1) con su comprobacion previa: `response` es `base` y `message` contiene el valor. */
function crearU1(): InternalServerErrorException {
  const base = crearBase();
  const excepcion = new InternalServerErrorException(base);
  expect(excepcion.getResponse(), 'precondicion: response es base').toBe(base);
  expect(excepcion.message, 'precondicion: message contiene el valor').toContain(DNI_R15);
  return excepcion;
}

const crearU4 = (): Error => Object.assign(new Error('Fallo de prueba r15'), { detalle: crearBase() });

describe('criterio 165: crearManejadorDeRechazos no registra el error de la base escondido en otro error (P-40)', () => {
  it.each([
    ['(u1) InternalServerErrorException(base)', crearU1],
    ['(u4) Error con la base en una propiedad propia', crearU4],
  ])(
    'criterio 165 %s: registro.error recibe { err: X } con X sin los valores y con la base una sola vez',
    async (_nombre, crearMotivo) => {
      const crear = await cargarCrearManejador();
      const motivo = crearMotivo();

      const llamadas = registrar(motivo, crear);

      expect(llamadas).toHaveLength(1);
      const [{ datos, mensaje }] = llamadas as [{ datos: Record<string, unknown>; mensaje: string }];
      expect(Object.keys(datos), 'solo { err }').toEqual(['err']);
      comprobarConvertido(datos['err'], motivo, 'manejador', 1);
      for (const prohibido of PROHIBIDOS_R15) expect(JSON.stringify([datos, mensaje])).not.toContain(prohibido);
    },
  );

  it('criterio 165 (u1): con un pino real con destino en memoria, lo que se escribe no contiene los valores y contiene el tipo de la excepcion y el codigo de Prisma', async () => {
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

    crear({ error: (datos, mensaje) => log.error(datos, mensaje) })(crearU1());

    const texto = salida.join('');
    expect(texto).not.toBe('');
    for (const prohibido of PROHIBIDOS_R15) expect(texto, `no debe contener "${prohibido}"`).not.toContain(prohibido);
    expect(texto).toContain('InternalServerErrorException');
    expect(texto).toContain('P2007');
  });

  it('criterio 165 (u4): el mensaje propio del Error se conserva en el registro', async () => {
    const crear = await cargarCrearManejador();

    const llamadas = registrar(crearU4(), crear);

    expect(llamadas).toHaveLength(1);
    const err = comoObjeto(llamadas[0]?.datos['err'], 'u4 err');
    expect(err['mensaje']).toBe('Fallo de prueba r15');
  });

  it('criterio 165 (control, 157 sin cambios): con un Error que no lleva errores de la base, registro.error recibe { err: <el mismo error> }', async () => {
    const crear = await cargarCrearManejador();
    const error = Object.assign(new Error('fallo comun de prueba r15'), { detalle: { a: 1 } });

    const llamadas = registrar(error, crear);

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.datos['err'], 'el mismo error, no una copia').toBe(error);
  });
});
