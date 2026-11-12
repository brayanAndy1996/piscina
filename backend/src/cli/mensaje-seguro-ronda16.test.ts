// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import {
  DNI_R16,
  LIMITE_MS,
  PROHIBIDOS_R16,
  TIEMPO_DE_PRUEBA_MS,
  calentar,
  comprobarTiempo,
  crearBase16,
  crearErrorT3,
  crearG1,
  crearG3ConPrecondicion,
  crearInteriorT1,
  medir,
} from '../../test/utilidades/ronda16';
import { errorParaRegistro } from '../infraestructura/prisma';
import { mensajeSeguro } from './mensaje-seguro';

// Criterios 167 y 168 (ataque ronda 16, F1 y O1; precisan los criterios 149, 162 y 165), prueba unitaria de `mensajeSeguro`
// (backend/src/cli/mensaje-seguro.ts, que usan los comandos y la semilla).
//   167 (t10): con el `Error` interior de (t1) (el que lleva el Buffer de 5 MB), el texto es `No se pudo subir el comprobante`; con el de
//        (t3) (arreglo de 2 millones), empieza con `error sin detalles`; las dos en menos de 200 ms, medidas tras una llamada de calentamiento.
//   168: con (g1) (getter heredado `cause` con `base16`), el texto es `No se pudo guardar`; con (g3) (`cause` funcion), empieza con
//        `error sin detalles` y la funcion no se llama; ninguno contiene `44556677`, `penicilina-r16` ni `invalid input syntax`.

function sinProhibidos(texto: string, contexto: string): void {
  for (const prohibido of PROHIBIDOS_R16) {
    expect(texto, `${contexto}: no debe contener "${prohibido}"`).not.toContain(prohibido);
  }
}

describe('criterio 167 (t10): mensajeSeguro con valores grandes', () => {
  it(
    'criterio 167 (t10): con el Error interior de (t1), el texto es "No se pudo subir el comprobante", en menos de 200 ms',
    () => {
      mensajeSeguro(new Error('calentamiento'), []);
      calentar(errorParaRegistro);
      const error = crearInteriorT1();

      const { valor, ms } = medir(() => mensajeSeguro(error, []));

      comprobarTiempo(ms, 't10 (t1)', LIMITE_MS);
      expect(valor).toBe('No se pudo subir el comprobante');
      sinProhibidos(valor, 't10 (t1)');
    },
    TIEMPO_DE_PRUEBA_MS,
  );

  it(
    'criterio 167 (t10): con el Error de (t3), el texto empieza con "error sin detalles", en menos de 200 ms',
    () => {
      mensajeSeguro(new Error('calentamiento'), []);
      const error = crearErrorT3();

      const { valor, ms } = medir(() => mensajeSeguro(error, []));

      comprobarTiempo(ms, 't10 (t3)', LIMITE_MS);
      expect(valor.startsWith('error sin detalles'), `el texto era: ${valor}`).toBe(true);
      sinProhibidos(valor, 't10 (t3)');
    },
    TIEMPO_DE_PRUEBA_MS,
  );
});

describe('criterio 168: mensajeSeguro con cause leida por su nombre', () => {
  it('criterio 168 (g1): con el getter heredado cause que devuelve base16, el texto es "No se pudo guardar"', () => {
    const error = crearG1(crearBase16());
    expect(error.message, 'precondicion: el mensaje propio no lleva el valor').not.toContain(DNI_R16);

    const texto = mensajeSeguro(error, []);

    expect(texto).toBe('No se pudo guardar');
    sinProhibidos(texto, 'g1');
  });

  it('criterio 168 (g3): con una cause funcion, el texto empieza con "error sin detalles" y la funcion no se llama', () => {
    const { error, llamadas } = crearG3ConPrecondicion(crearBase16());

    const texto = mensajeSeguro(error, []);

    expect(texto.startsWith('error sin detalles'), `el texto era: ${texto}`).toBe(true);
    sinProhibidos(texto, 'g3');
    expect(llamadas(), 'la funcion cause no debe llamarse').toBe(0);
  });
});
