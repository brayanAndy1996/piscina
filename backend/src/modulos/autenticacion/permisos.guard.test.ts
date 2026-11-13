import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_USUARIO, type RolUsuario } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import { ErrorNegocio } from '../../comun/errores';
import { guardarErrorDeCuerpo, permitirErrorDeCuerpoDiferido } from '../../comun/http/error-de-cuerpo-diferido';
import { Permiso, SoloSesion } from './permiso.decorator';
import { PermisosGuard } from './permisos.guard';
import type { SesionVerificada, SolicitudDeAcademia } from './tipos';

// Criterios 27 y 28 (sin base de datos): la tabla de decisiones del guard de permisos.

class SinDeclarar {
  metodo() {
    return undefined;
  }
}
class ConPermiso {
  @Permiso('GESTIONAR_USUARIOS')
  metodo() {
    return undefined;
  }
}
class ConSoloSesion {
  @SoloSesion()
  metodo() {
    return undefined;
  }
}
@SoloSesion()
class SoloSesionPorClase {
  metodo() {
    return undefined;
  }
  @Permiso('GESTIONAR_USUARIOS')
  conPermisoPropio() {
    return undefined;
  }
}
@Permiso('GESTIONAR_USUARIOS')
class PermisoPorClase {
  metodo() {
    return undefined;
  }
  @SoloSesion()
  conSoloSesionPropio() {
    return undefined;
  }
}

function sesionDe(rol: RolUsuario): SesionVerificada {
  return {
    usuario: {
      id: '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f',
      academiaId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      rol,
      nombres: 'Rosa',
      apellidos: 'Alvarez',
      debeCambiarClave: false,
    },
    versionToken: 0,
    academia: { nombreCorto: 'delfines', nombre: 'Los Delfines' },
  };
}

function contexto(clase: new () => object, metodo: string, solicitud: Partial<SolicitudDeAcademia>): ExecutionContext {
  const prototipo = clase.prototype as Record<string, () => unknown>;
  return {
    getHandler: () => prototipo[metodo],
    getClass: () => clase,
    switchToHttp: () => ({ getRequest: () => solicitud }),
  } as unknown as ExecutionContext;
}

function solicitudDe(rol: RolUsuario | null): SolicitudDeAcademia {
  const solicitud = {} as SolicitudDeAcademia;
  if (rol) solicitud.sesionAcademia = sesionDe(rol);
  return solicitud;
}

const guard = new PermisosGuard(new Reflector());

function codigoDe(accion: () => unknown): string | null {
  try {
    accion();
    return null;
  } catch (error) {
    return error instanceof ErrorNegocio ? `${error.estado} ${error.codigo}` : 'otro error';
  }
}

describe('PermisosGuard', () => {
  it.each(ROLES_USUARIO)(
    'una ruta de academia sin declarar responde 403 SIN_PERMISO a un %s (falla cerrada)',
    (rol) => {
      expect(codigoDe(() => guard.canActivate(contexto(SinDeclarar, 'metodo', solicitudDe(rol))))).toBe(
        '403 SIN_PERMISO',
      );
    },
  );

  it('una ruta sin declarar y sin sesión de academia es de otro prefijo (salud, /a, plataforma, DELETE /sesion): pasa', () => {
    expect(guard.canActivate(contexto(SinDeclarar, 'metodo', solicitudDe(null)))).toBe(true);
  });

  it.each(ROLES_USUARIO)('@SoloSesion deja pasar a un %s', (rol) => {
    expect(guard.canActivate(contexto(ConSoloSesion, 'metodo', solicitudDe(rol)))).toBe(true);
  });

  it.each([
    ['ADMIN', true],
    ['SECRETARIA', false],
    ['ENTRENADOR', false],
    ['ALUMNO', false],
  ] as const)('@Permiso("GESTIONAR_USUARIOS") con un %s pasa: %s', (rol, pasa) => {
    const resultado = codigoDe(() => guard.canActivate(contexto(ConPermiso, 'metodo', solicitudDe(rol))));

    expect(resultado).toBe(pasa ? null : '403 SIN_PERMISO');
  });

  it('una ruta declarada que llega sin sesión de academia responde 401 (nunca se abre por omisión)', () => {
    for (const clase of [ConPermiso, ConSoloSesion]) {
      expect(codigoDe(() => guard.canActivate(contexto(clase, 'metodo', solicitudDe(null))))).toBe(
        '401 NO_AUTENTICADO',
      );
    }
  });

  it('lo declarado en el manejador manda sobre lo de la clase, y la clase vale para los manejadores sin declaración propia', () => {
    const alumno = solicitudDe('ALUMNO');
    expect(guard.canActivate(contexto(SoloSesionPorClase, 'metodo', alumno))).toBe(true);
    expect(codigoDe(() => guard.canActivate(contexto(SoloSesionPorClase, 'conPermisoPropio', alumno)))).toBe(
      '403 SIN_PERMISO',
    );
    expect(codigoDe(() => guard.canActivate(contexto(PermisoPorClase, 'metodo', alumno)))).toBe('403 SIN_PERMISO');
    expect(guard.canActivate(contexto(PermisoPorClase, 'conSoloSesionPropio', alumno))).toBe(true);
  });

  it('el permiso se comprueba antes que el error del cuerpo: sin permiso, 403; con permiso, se lanza el error guardado', () => {
    const sinPermiso = solicitudDe('SECRETARIA');
    permitirErrorDeCuerpoDiferido(sinPermiso);
    guardarErrorDeCuerpo(sinPermiso, new SyntaxError('JSON roto'));
    const conPermiso = solicitudDe('ADMIN');
    permitirErrorDeCuerpoDiferido(conPermiso);
    guardarErrorDeCuerpo(conPermiso, new SyntaxError('JSON roto'));

    expect(codigoDe(() => guard.canActivate(contexto(ConPermiso, 'metodo', sinPermiso)))).toBe('403 SIN_PERMISO');
    expect(codigoDe(() => guard.canActivate(contexto(ConPermiso, 'metodo', conPermiso)))).toBe('otro error');
  });
});
