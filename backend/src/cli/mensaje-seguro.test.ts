import { describe, expect, it } from 'vitest';
import { mensajeSeguro } from './mensaje-seguro';

describe('mensajeSeguro', () => {
  it('reemplaza los secretos y la contraseña de la URL, y deja solo la primera línea', () => {
    const url = 'postgresql://dueno:otra-clave-secreta@127.0.0.1:5432/base';
    const error = new Error(`No se pudo conectar a ${url} con Clave-Segura-2026\nsegunda línea con otra-clave-secreta`);

    const texto = mensajeSeguro(error, [url, 'Clave-Segura-2026', undefined]);

    expect(texto).toBe('No se pudo conectar a *** con ***');
    expect(texto).not.toContain('otra-clave-secreta');
  });

  it('reemplaza la contraseña de la URL aunque aparezca sola', () => {
    const texto = mensajeSeguro(new Error('autenticación fallida para otra-clave-secreta'), [
      'postgresql://dueno:otra-clave-secreta@127.0.0.1:5432/base',
    ]);

    expect(texto).toBe('autenticación fallida para ***');
  });

  it('acepta valores que no son errores y recorta los mensajes largos', () => {
    expect(mensajeSeguro('texto plano', [])).toBe('texto plano');
    expect(mensajeSeguro(new Error('x'.repeat(500)), [])).toHaveLength(301);
    expect(mensajeSeguro(new Error(''), [])).toBe('error desconocido');
  });
});
