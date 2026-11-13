import { describe, expect, it } from 'vitest';
import {
  administradorResumenSchema,
  buscarUsuarioPorDniSchema,
  crearAdministradorSchema,
  crearUsuarioSchema,
  cuerpoVacioSchema,
  usuarioResumenSchema,
} from './index';

const ID = '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f';
const valido = { dni: '55551001', nombres: 'Carla', apellidos: 'Mendoza', rol: 'SECRETARIA' };

describe('crearUsuarioSchema (criterio 44)', () => {
  it.each(['ADMIN', 'SECRETARIA', 'ENTRENADOR'])('acepta el rol %s', (rol) => {
    expect(crearUsuarioSchema.parse({ ...valido, rol }).rol).toBe(rol);
  });

  it('recorta el DNI, los nombres y los apellidos y conserva los ceros a la izquierda', () => {
    expect(
      crearUsuarioSchema.parse({ dni: ' 01234567 ', nombres: '  Carla  ', apellidos: ' Mendoza Ríos ', rol: 'ADMIN' }),
    ).toEqual({ dni: '01234567', nombres: 'Carla', apellidos: 'Mendoza Ríos', rol: 'ADMIN' });
  });

  it('acepta nombres de 2 y de 100 caracteres', () => {
    expect(crearUsuarioSchema.safeParse({ ...valido, nombres: 'Li', apellidos: 'Wu' }).success).toBe(true);
    expect(crearUsuarioSchema.safeParse({ ...valido, nombres: 'C'.repeat(100) }).success).toBe(true);
  });

  it.each([
    ['rol ALUMNO', { ...valido, rol: 'ALUMNO' }],
    ['rol que no existe', { ...valido, rol: 'SUPERADMIN' }],
    ['sin rol', { dni: valido.dni, nombres: valido.nombres, apellidos: valido.apellidos }],
    ['DNI de 7 dígitos', { ...valido, dni: '5555100' }],
    ['DNI con letras', { ...valido, dni: '5555100a' }],
    ['DNI que es un número', { ...valido, dni: 55551001 }],
    ['nombres de un carácter', { ...valido, nombres: 'C' }],
    ['nombres de 101 caracteres', { ...valido, nombres: 'C'.repeat(101) }],
    ['apellidos vacíos', { ...valido, apellidos: '' }],
    ['apellidos solo con espacios', { ...valido, apellidos: '    ' }],
    ['nombres con un control', { ...valido, nombres: 'Car\u0000la' }],
    ['apellidos con un salto de línea', { ...valido, apellidos: 'Men\ndoza' }],
    ['nombres que se ven en blanco', { ...valido, nombres: 'ㅤㅤ' }],
    ['campo de más (estado)', { ...valido, estado: 'ACTIVO' }],
    ['campo de más (clave)', { ...valido, clave: 'Mi-Clave-2026' }],
    ['campo de más (academiaId)', { ...valido, academiaId: ID }],
    ['cuerpo ausente', undefined],
  ])('rechaza %s', (_nombre, entrada) => {
    expect(crearUsuarioSchema.safeParse(entrada).success).toBe(false);
  });
});

describe('crearAdministradorSchema (criterio 44)', () => {
  it('acepta dni, nombres y apellidos', () => {
    expect(crearAdministradorSchema.parse({ dni: '55555001', nombres: 'Pilar', apellidos: 'Quispe' })).toEqual({
      dni: '55555001',
      nombres: 'Pilar',
      apellidos: 'Quispe',
    });
  });

  it.each([
    ['un rol de más', { dni: '55555001', nombres: 'Pilar', apellidos: 'Quispe', rol: 'ADMIN' }],
    ['una academia de más', { dni: '55555001', nombres: 'Pilar', apellidos: 'Quispe', academiaId: ID }],
    ['un DNI inválido', { dni: '5555500', nombres: 'Pilar', apellidos: 'Quispe' }],
    ['sin DNI', { nombres: 'Pilar', apellidos: 'Quispe' }],
  ])('rechaza %s', (_nombre, entrada) => {
    expect(crearAdministradorSchema.safeParse(entrada).success).toBe(false);
  });
});

describe('buscarUsuarioPorDniSchema (criterio 34, PO-3)', () => {
  it('acepta cualquier texto de hasta 64 caracteres, aunque no tenga el formato de un DNI, sin recortarlo', () => {
    for (const dni of ['12345678', '  12345678 ', '1234567', 'abcdefgh', '', '1'.repeat(64)]) {
      expect(buscarUsuarioPorDniSchema.parse({ dni })).toEqual({ dni });
    }
  });

  it.each([
    ['un DNI de más de 64 caracteres', { dni: '1'.repeat(65) }],
    ['un DNI que es un número', { dni: 12345678 }],
    ['un DNI nulo', { dni: null }],
    ['un DNI dentro de una lista', { dni: ['12345678'] }],
    ['sin DNI', {}],
    ['un campo de más', { dni: '12345678', rol: 'ADMIN' }],
    ['una academia de más', { dni: '12345678', academiaId: ID }],
    ['cuerpo ausente', undefined],
  ])('rechaza %s', (_nombre, entrada) => {
    expect(buscarUsuarioPorDniSchema.safeParse(entrada).success).toBe(false);
  });
});

describe('cuerpoVacioSchema', () => {
  it('acepta {} y la ausencia de cuerpo, y rechaza cualquier campo o un valor que no sea un objeto', () => {
    expect(cuerpoVacioSchema.safeParse({}).success).toBe(true);
    expect(cuerpoVacioSchema.safeParse(undefined).success).toBe(true);
    expect(cuerpoVacioSchema.safeParse({ academiaId: ID }).success).toBe(false);
    expect(cuerpoVacioSchema.safeParse(null).success).toBe(false);
    expect(cuerpoVacioSchema.safeParse([]).success).toBe(false);
  });
});

describe('usuarioResumenSchema y administradorResumenSchema (criterio 44)', () => {
  const resumen = {
    id: ID,
    dni: '55551001',
    nombres: 'Carla',
    apellidos: 'Mendoza',
    rol: 'SECRETARIA',
    estado: 'ACTIVO',
    debeCambiarClave: true,
    bloqueado: false,
    ultimoAcceso: '2026-11-10T14:30:00.000Z',
  };

  it('acepta un resumen con y sin último acceso', () => {
    expect(usuarioResumenSchema.parse(resumen)).toEqual(resumen);
    expect(usuarioResumenSchema.parse({ ...resumen, ultimoAcceso: null }).ultimoAcceso).toBeNull();
  });

  it.each([
    ['el hash', { ...resumen, claveHash: '$argon2id$x' }],
    ['la versión de token', { ...resumen, versionToken: 1 }],
    ['los intentos fallidos', { ...resumen, intentosFallidos: 3 }],
  ])('rechaza un resumen que trae %s (esquema estricto)', (_nombre, entrada) => {
    expect(usuarioResumenSchema.safeParse(entrada).success).toBe(false);
  });

  it('el resumen de un administrador no tiene rol ni último acceso', () => {
    const admin = {
      id: resumen.id,
      dni: resumen.dni,
      nombres: resumen.nombres,
      apellidos: resumen.apellidos,
      estado: resumen.estado,
      debeCambiarClave: resumen.debeCambiarClave,
      bloqueado: resumen.bloqueado,
    };

    expect(administradorResumenSchema.parse(admin)).toEqual(admin);
    expect(administradorResumenSchema.safeParse(resumen).success).toBe(false);
    expect(administradorResumenSchema.safeParse({ ...admin, rol: 'ADMIN' }).success).toBe(false);
  });
});
