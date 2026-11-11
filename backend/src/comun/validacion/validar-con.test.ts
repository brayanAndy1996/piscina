import { detallesValidacionSchema } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorNegocio } from '../errores';
import { detallesDeZod } from './detalles-zod';
import { ValidarCon } from './validar-con';

const esquema = z.strictObject({
  nombre: z.string().trim().min(3, 'Muy corto.'),
  datos: z.object({ edad: z.number() }),
});

describe('ValidarCon (spec 001, criterio 66)', () => {
  it('devuelve el valor transformado por el esquema', () => {
    const pipe = new ValidarCon(esquema);
    expect(pipe.transform({ nombre: '  Ana  ', datos: { edad: 5 } })).toEqual({ nombre: 'Ana', datos: { edad: 5 } });
  });

  it('lanza un ErrorNegocio 400 SOLICITUD_INVALIDA con detalles { errores: [{ campo, mensaje }] }', () => {
    const pipe = new ValidarCon(esquema);
    let error: unknown;
    try {
      pipe.transform({ nombre: 'a', datos: { edad: 'x' } });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorNegocio);
    const negocio = error as ErrorNegocio;
    expect(negocio.estado).toBe(400);
    expect(negocio.codigo).toBe('SOLICITUD_INVALIDA');
    const detalles = detallesValidacionSchema.parse(negocio.detalles);
    expect(detalles.errores).toEqual(
      expect.arrayContaining([
        { campo: 'nombre', mensaje: 'Muy corto.' },
        { campo: 'datos.edad', mensaje: expect.any(String) as string },
      ]),
    );
  });

  it('usa "" como campo cuando el cuerpo entero no es válido (por ejemplo, no es un objeto)', () => {
    const pipe = new ValidarCon(esquema);
    for (const entrada of [undefined, null, 'texto', 5, []]) {
      let detalles: unknown;
      try {
        pipe.transform(entrada);
      } catch (e) {
        detalles = (e as ErrorNegocio).detalles;
      }
      expect(detallesValidacionSchema.parse(detalles).errores[0]?.campo, JSON.stringify(entrada)).toBe('');
    }
  });

  it('usa puntos para los índices de las listas y no copia el valor recibido', () => {
    const lista = z.object({ items: z.array(z.object({ n: z.number() })) });
    const resultado = lista.safeParse({ items: [{ n: 1 }, { n: 'valor-privado' }] });
    const detalles = detallesDeZod(resultado.error!);
    expect(detalles.errores.map((e) => e.campo)).toEqual(['items.1.n']);
    expect(JSON.stringify(detalles)).not.toContain('valor-privado');
  });
});
