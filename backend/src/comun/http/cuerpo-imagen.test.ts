import { describe, expect, it } from 'vitest';
import {
  esSubidaDeComprobante,
  esSubidaDeFoto,
  esSubidaDeFotoDelPanel,
  esSubidaDeImagen,
  imagenNoValida,
  MENSAJE_IMAGEN_NO_VALIDA,
  tipoDeMedio,
} from './cuerpo-imagen';

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

describe('esSubidaDeComprobante y esSubidaDeImagen (007b)', () => {
  it.each([
    '/a/delfines/solicitudes/comprobante',
    '/a/delfines/solicitudes/comprobante/',
    '/a/delfines/Solicitudes/COMPROBANTE',
    '/A/Delfines/solicitudes/comprobante/',
  ])('PUT %s es la subida del comprobante y una subida de imagen, no la de la foto', (ruta) => {
    expect(esSubidaDeComprobante('PUT', ruta)).toBe(true);
    expect(esSubidaDeImagen('PUT', ruta)).toBe(true);
    expect(esSubidaDeFoto('PUT', ruta)).toBe(false);
  });

  it.each(['GET', 'POST', 'PATCH', 'DELETE', 'HEAD', 'put'])(
    '%s sobre la dirección del comprobante no es la subida',
    (metodo) => {
      expect(esSubidaDeComprobante(metodo, '/a/delfines/solicitudes/comprobante')).toBe(false);
      expect(esSubidaDeImagen(metodo, '/a/delfines/solicitudes/comprobante')).toBe(false);
    },
  );

  it.each([
    '/a/delfines/solicitudes/comprobante/otra',
    '/a/solicitudes/comprobante',
    '/a/delfines/solicitudes//comprobante',
    '/a/delfines/solicitudes/comprobantes',
    '/pagos/comprobante',
  ])('PUT %s no es la subida', (ruta) => {
    expect(esSubidaDeComprobante('PUT', ruta)).toBe(false);
    expect(esSubidaDeImagen('PUT', ruta)).toBe(false);
  });

  it('la foto sigue siendo una subida de imagen', () => {
    expect(esSubidaDeImagen('PUT', '/a/delfines/solicitudes/foto')).toBe(true);
  });
});

describe('esSubidaDeFotoDelPanel (008b)', () => {
  it.each([
    '/alumnos/8d1f0c2e-5a3b-4c6d-9e7f-0a1b2c3d4e5f/foto',
    '/alumnos/8d1f0c2e-5a3b-4c6d-9e7f-0a1b2c3d4e5f/foto/',
    '/Alumnos/ABC/FOTO',
    '/alumnos/no-es-uuid/foto',
    '/solicitudes/8d1f0c2e-5a3b-4c6d-9e7f-0a1b2c3d4e5f/foto',
    '/solicitudes/8d1f0c2e-5a3b-4c6d-9e7f-0a1b2c3d4e5f/foto/',
    '/Solicitudes/ABC/FOTO',
  ])('PUT %s es la foto del panel y una subida de imagen, no la pública', (ruta) => {
    expect(esSubidaDeFotoDelPanel('PUT', ruta)).toBe(true);
    expect(esSubidaDeImagen('PUT', ruta)).toBe(true);
    expect(esSubidaDeFoto('PUT', ruta)).toBe(false);
  });

  it.each(['GET', 'POST', 'PATCH', 'DELETE', 'HEAD', 'put'])('%s sobre la foto del panel no es la subida', (metodo) => {
    expect(esSubidaDeFotoDelPanel(metodo, '/alumnos/abc/foto')).toBe(false);
    expect(esSubidaDeImagen(metodo, '/alumnos/abc/foto')).toBe(false);
    expect(esSubidaDeImagen(metodo, '/solicitudes/abc/foto')).toBe(false);
  });

  it.each([
    '/alumnos/foto',
    '/alumnos//foto',
    '/alumnos/abc/foto/otra',
    '/alumnos/abc/carnet',
    '/alumnos/abc/carnet/qr',
    '/alumnos/abc/fotos',
    '/alumnos/a/b/foto',
    '/solicitudes/foto',
    '/solicitudes/abc/cancelar',
    '/solicitudes/abc/comprobante',
    '/mi-carnet/foto',
    '/a/delfines/alumnos/abc/foto',
  ])('PUT %s no es la foto del panel', (ruta) => {
    expect(esSubidaDeFotoDelPanel('PUT', ruta)).toBe(false);
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
