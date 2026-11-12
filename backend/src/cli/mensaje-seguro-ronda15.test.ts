// spec: 001-academias-aislamiento (pruebas protegidas)
import { InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { crearBase, DNI_R15, PROHIBIDOS_R15 } from '../../test/utilidades/ronda15';
import { mensajeSeguro } from './mensaje-seguro';

// Criterios 165 y 166 (ataque ronda 15, F1 y O1; precisan los criterios 149 y 162 y P-40), prueba unitaria de `mensajeSeguro`
// (backend/src/cli/mensaje-seguro.ts, que usan los comandos y la semilla). `base` es un error falso con forma de error de Prisma
// (P2007) con el valor `44556677` en su mensaje.
//   165: con un `Error` que no es de la base y para el que `errorParaRegistro` no devuelve el mismo objeto, el texto es su `mensaje` si lo
//        tiene; si no, "error de la base (...)" con el primer error de la base; y si no hay ninguno (tope agotado), `error sin detalles
//        (<tipo>)`. Con (u1) el texto contiene `P2007` y ninguno de los tres textos; con (u4) es `Fallo de prueba r15`; con la cadena
//        de 30 de (u12) empieza con `error sin detalles`.
//   166: con un `name` inventado en un error de la base, el texto no contiene el valor del `name`.

describe('criterio 165: mensajeSeguro con un Error que lleva un error de la base en otra propiedad', () => {
  it('criterio 165 (u1): con InternalServerErrorException(base), el texto contiene P2007 y ninguno de los tres textos', () => {
    const base = crearBase();
    const excepcion = new InternalServerErrorException(base);
    expect(excepcion.getResponse(), 'precondicion: response es base').toBe(base);
    expect(excepcion.message, 'precondicion: message contiene el valor').toContain(DNI_R15);

    const texto = mensajeSeguro(excepcion, []);

    expect(texto).toContain('P2007');
    for (const prohibido of PROHIBIDOS_R15) expect(texto, `no debe contener "${prohibido}"`).not.toContain(prohibido);
    expect(texto).not.toContain('\n');
    expect(texto.length).toBeLessThanOrEqual(301);
  });

  it('criterio 165 (u4): con un Error propio con la base en una propiedad, el texto es su mensaje', () => {
    const error = Object.assign(new Error('Fallo de prueba r15'), { detalle: crearBase() });

    expect(mensajeSeguro(error, [])).toBe('Fallo de prueba r15');
  });

  it('criterio 165 (u12): con una cadena de 30 Error por cause con la base al final, el texto empieza con "error sin detalles"', () => {
    let error: Error = crearBase();
    for (let i = 0; i < 30; i += 1) error = new Error(`nivel ${i} r15`, { cause: error });

    const texto = mensajeSeguro(error, []);

    expect(texto.startsWith('error sin detalles')).toBe(true);
    for (const prohibido of PROHIBIDOS_R15) expect(texto, `no debe contener "${prohibido}"`).not.toContain(prohibido);
  });

  it('criterio 165: con un Error cuyo mensaje copia el de la base, el texto es el de la base resumido (codigo de Prisma), no el mensaje', () => {
    const base = crearBase();
    const error = Object.assign(new Error(base.message), { detalle: base });

    const texto = mensajeSeguro(error, []);

    expect(texto).toContain('P2007');
    for (const prohibido of PROHIBIDOS_R15) expect(texto, `no debe contener "${prohibido}"`).not.toContain(prohibido);
  });

  it('criterio 165 (control): con un Error sin errores de la base en su grafo, el texto es su primera linea como hoy', () => {
    const error = Object.assign(new Error('algo fallo\nsegunda linea'), { detalle: { a: 1 } });

    expect(mensajeSeguro(error, [])).toBe('algo fallo');
  });

  it('criterio 165 (control): con un error de la base, lo de hoy: tipo y codigos', () => {
    const texto = mensajeSeguro(crearBase(), []);

    expect(texto).toContain('P2007');
    expect(texto).toContain('PrismaClientKnownRequestError');
    for (const prohibido of PROHIBIDOS_R15) expect(texto, `no debe contener "${prohibido}"`).not.toContain(prohibido);
  });
});

describe('criterio 166 (o1): mensajeSeguro con un name inventado en un error de la base', () => {
  it('criterio 166 (o1): name "Dni44556677Alergia" con code P2007: el texto contiene P2007 y no el valor del name', () => {
    const error = Object.assign(new Error('x'), { name: 'Dni44556677Alergia', code: 'P2007' });

    const texto = mensajeSeguro(error, []);

    expect(texto).toContain('P2007');
    expect(texto).not.toContain(DNI_R15);
  });

  it('criterio 166 (o2): name "error" del driver pg con code 22P02: el texto contiene el SQLSTATE y el tipo ErrorDeBase', () => {
    const error = Object.assign(new Error('invalid input syntax for type inet'), { name: 'error', code: '22P02' });

    const texto = mensajeSeguro(error, []);

    expect(texto).toContain('22P02');
    expect(texto).toContain('ErrorDeBase');
    expect(texto).not.toContain('invalid input syntax');
  });
});
