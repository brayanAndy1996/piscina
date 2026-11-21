import { describe, expect, it } from 'vitest';
import { esSubidaDeFoto, imagenNoValida, MENSAJE_IMAGEN_NO_VALIDA, tipoDeMedio } from './cuerpo-imagen';

describe('esSubidaDeFoto', () => {
  it.each([
    '/a/delfines/solicitudes/foto',
    '/a/delfines/solicitudes/foto/',
    '/a/delfines/Solicitudes/FOTO',
    '/A/Delfines/solicitudes/foto/',
  ])('PUT %s es la subida de la foto', (ruta) => {
    expect(esSubidaDeFoto('PUT', ruta)).toBe(true);
  });

  it.each(['GET', 'POST', 'PATCH', 'DELETE', 'HEAD', 'put'])(
    '%s sobre la dirección de la foto no es la subida',
    (metodo) => {
      expect(esSubidaDeFoto(metodo, '/a/delfines/solicitudes/foto')).toBe(false);
    },
  );

  it.each([
    '/a/delfines/solicitudes/consulta',
    '/a/delfines/solicitudes/foto/otra',
    '/a/delfines/solicitudes',
    '/a/solicitudes/foto',
    '/clases/foto',
    '/a/delfines/solicitudes/fo%74o',
    '/a/delfines/solicitudes//foto',
    '/sesion',
  ])('PUT %s no es la subida', (ruta) => {
    expect(esSubidaDeFoto('PUT', ruta)).toBe(false);
  });
});

describe('tipoDeMedio', () => {
  it.each([
    ['image/png', 'image/png'],
    ['IMAGE/PNG', 'image/png'],
    ['  image/jpeg  ', 'image/jpeg'],
    ['image/png; charset=binary', 'image/png'],
    ['image/png;', 'image/png'],
    ['', ''],
  ])('%j da %j', (entrada, esperado) => {
    expect(tipoDeMedio(entrada)).toBe(esperado);
  });

  it('sin Content-Type da el texto vacío', () => {
    expect(tipoDeMedio(undefined)).toBe('');
  });
});

describe('imagenNoValida', () => {
  it('es siempre el mismo 400 IMAGEN_NO_VALIDA, con el mismo mensaje y sin detalles', () => {
    const uno = imagenNoValida();
    const otro = imagenNoValida();

    expect([uno.estado, uno.codigo, uno.mensaje, uno.detalles]).toEqual([
      400,
      'IMAGEN_NO_VALIDA',
      MENSAJE_IMAGEN_NO_VALIDA,
      undefined,
    ]);
    expect(otro.mensaje).toBe(uno.mensaje);
  });
});
