import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, llamadas, mostrar, rutaActual, sesionDe, simularApi } from '../../pruebas-api';

const ACADEMIA = { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines' };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('/a/{nombreCorto}/ingresar (criterio 46)', () => {
  async function ingresar(dni = ' 10000004 ', clave = 'una-clave-larga-1') {
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('DNI'), dni);
    await usuario.type(screen.getByLabelText('Contraseña'), clave);
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
  }

  const conAcademia = { 'GET /api/a/delfines': () => ({ estado: 200, cuerpo: ACADEMIA }) };

  it('muestra el nombre de la academia, el formulario y la ayuda para quien olvidó su contraseña', async () => {
    simularApi(conAcademia);
    mostrar('/a/delfines/ingresar');
    expect(await screen.findByRole('heading', { level: 1, name: ACADEMIA.nombre })).toBeInTheDocument();
    expect(screen.getByLabelText('DNI')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password');
    expect(screen.getByText('¿Olvidaste tu contraseña? Pide en recepción que la restablezcan.')).toBeInTheDocument();
  });

  it('valida el DNI y la contraseña con el esquema compartido antes de enviar', async () => {
    const api = simularApi(conAcademia);
    mostrar('/a/delfines/ingresar');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText('El DNI debe tener exactamente 8 dígitos.')).toBeInTheDocument();
    expect(screen.getByText('La contraseña es obligatoria.')).toBeInTheDocument();
    expect(llamadas(api, 'POST /api/a/delfines/sesion')).toHaveLength(0);
  });

  it('con éxito envía el DNI recortado y, si debe cambiar la contraseña, lleva a /cambiar-clave', async () => {
    const api = simularApi({
      ...conAcademia,
      'POST /api/a/delfines/sesion': () => ({ estado: 200, cuerpo: sesionDe('ALUMNO', { debeCambiarClave: true }) }),
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ALUMNO', { debeCambiarClave: true }) }),
    });
    mostrar('/a/delfines/ingresar');
    await ingresar();
    expect(await screen.findByRole('heading', { name: 'Cambiar contraseña' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/cambiar-clave');
    expect(llamadas(api, 'POST /api/a/delfines/sesion')).toEqual([{ usuario: '10000004', clave: 'una-clave-larga-1' }]);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it('con éxito y sin cambio pendiente lleva a /panel', async () => {
    simularApi({
      ...conAcademia,
      'POST /api/a/delfines/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }),
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }),
    });
    mostrar('/a/delfines/ingresar');
    await ingresar();
    expect(await screen.findByRole('heading', { name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/panel');
    expect(localStorage).toHaveLength(0);
  });

  it.each([
    [401, 'CREDENCIALES_INVALIDAS', 'DNI o contraseña incorrectos.'],
    [423, 'CUENTA_BLOQUEADA', 'La cuenta está bloqueada por varios intentos fallidos.'],
    [429, 'DEMASIADAS_SOLICITUDES', 'Hiciste demasiados intentos. Espera un minuto.'],
    [403, 'USUARIO_INACTIVO', 'Tu cuenta está desactivada. Consulta en recepción.'],
    [403, 'ACADEMIA_SUSPENDIDA', 'Academia no disponible por el momento.'],
    [404, 'ACADEMIA_NO_ENCONTRADA', 'No encontramos esa academia.'],
  ])('con %i %s muestra el mensaje y se queda en el ingreso', async (estado, codigo, mensaje) => {
    simularApi({ ...conAcademia, 'POST /api/a/delfines/sesion': () => error(codigo, estado) });
    mostrar('/a/delfines/ingresar');
    await ingresar();
    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje);
    expect(rutaActual()).toBe('/a/delfines/ingresar');
    expect(localStorage).toHaveLength(0);
  });

  it('mientras envía deshabilita el botón (un doble clic no envía dos veces)', async () => {
    const api = simularApi({ ...conAcademia, 'POST /api/a/delfines/sesion': () => new Promise(() => undefined) });
    mostrar('/a/delfines/ingresar');
    await ingresar();
    expect(await screen.findByRole('button', { name: 'Ingresando…' })).toBeDisabled();
    expect(llamadas(api, 'POST /api/a/delfines/sesion')).toHaveLength(1);
  });

  it('una academia suspendida muestra "Academia no disponible por el momento" y no el formulario', async () => {
    simularApi({ 'GET /api/a/delfines': () => error('ACADEMIA_SUSPENDIDA', 403) });
    mostrar('/a/delfines/ingresar');
    expect(await screen.findByRole('alert')).toHaveTextContent('Academia no disponible por el momento.');
    expect(screen.queryByLabelText('DNI')).not.toBeInTheDocument();
  });

  it('una academia inexistente lo dice y no muestra el formulario', async () => {
    simularApi({ 'GET /api/a/xyz': () => error('ACADEMIA_NO_ENCONTRADA', 404) });
    mostrar('/a/xyz/ingresar');
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos esa academia.');
    expect(screen.queryByLabelText('DNI')).not.toBeInTheDocument();
  });

  it('ante un error de red muestra que no se pudo contactar al servidor', async () => {
    simularApi({
      ...conAcademia,
      'POST /api/a/delfines/sesion': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    mostrar('/a/delfines/ingresar');
    await ingresar();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar al servidor');
  });
});

describe('/cambiar-clave (criterio 47)', () => {
  const obligatorio = {
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('SECRETARIA', { debeCambiarClave: true }) }),
  };

  async function llenar(actual: string, nueva: string, confirmacion: string) {
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Contraseña actual'), actual);
    await usuario.type(screen.getByLabelText('Contraseña nueva'), nueva);
    await usuario.type(screen.getByLabelText('Confirma la contraseña nueva'), confirmacion);
    await usuario.click(screen.getByRole('button', { name: 'Guardar contraseña nueva' }));
  }

  it('en el cambio obligatorio no deja ir a otra página: cualquier ruta con sesión lleva a /cambiar-clave', async () => {
    simularApi(obligatorio);
    mostrar('/panel/usuarios');
    expect(await screen.findByRole('heading', { name: 'Cambiar contraseña' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/cambiar-clave');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('valida con el esquema compartido y no envía nada si hay errores', async () => {
    const api = simularApi(obligatorio);
    mostrar('/cambiar-clave');
    await llenar('10000002', 'corta', 'otra');
    expect(await screen.findByText('La contraseña nueva debe tener al menos 8 caracteres.')).toBeInTheDocument();
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument();
    expect(llamadas(api, 'POST /api/sesion/clave')).toHaveLength(0);
  });

  it('no deja que la nueva sea igual a la actual', async () => {
    const api = simularApi(obligatorio);
    mostrar('/cambiar-clave');
    await llenar('10000002', '10000002', '10000002');
    expect(await screen.findByText('La contraseña nueva debe ser distinta de la actual.')).toBeInTheDocument();
    expect(llamadas(api, 'POST /api/sesion/clave')).toHaveLength(0);
  });

  it('con éxito envía solo la actual y la nueva y lleva a /panel', async () => {
    let cambiada = false;
    const api = simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('SECRETARIA', { debeCambiarClave: !cambiada }) }),
      'POST /api/sesion/clave': () => {
        cambiada = true;
        return { estado: 200, cuerpo: sesionDe('SECRETARIA') };
      },
    });
    mostrar('/cambiar-clave');
    await llenar('10000002', 'Una clave nueva 1', 'Una clave nueva 1');
    expect(await screen.findByRole('heading', { name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/panel');
    expect(llamadas(api, 'POST /api/sesion/clave')).toEqual([
      { claveActual: '10000002', claveNueva: 'Una clave nueva 1' },
    ]);
    expect(localStorage).toHaveLength(0);
  });

  it('CLAVE_ACTUAL_INCORRECTA se muestra junto a la contraseña actual', async () => {
    simularApi({ ...obligatorio, 'POST /api/sesion/clave': () => error('CLAVE_ACTUAL_INCORRECTA', 400) });
    mostrar('/cambiar-clave');
    await llenar('equivocada', 'Una clave nueva 1', 'Una clave nueva 1');
    expect(await screen.findByText('La contraseña actual no es correcta.')).toBeInTheDocument();
    expect(rutaActual()).toBe('/cambiar-clave');
  });

  it('un error de la API sobre la contraseña nueva (igual al DNI) se muestra junto a ese campo', async () => {
    simularApi({
      ...obligatorio,
      'POST /api/sesion/clave': () =>
        error('SOLICITUD_INVALIDA', 400, {
          errores: [{ campo: 'claveNueva', mensaje: 'La contraseña nueva no puede ser tu DNI.' }],
        }),
    });
    mostrar('/cambiar-clave');
    await llenar('10000002', '10000002x', '10000002x');
    expect(await screen.findByText('La contraseña nueva no puede ser tu DNI.')).toBeInTheDocument();
  });

  it('con la cuenta bloqueada (423) lo dice', async () => {
    simularApi({ ...obligatorio, 'POST /api/sesion/clave': () => error('CUENTA_BLOQUEADA', 423) });
    mostrar('/cambiar-clave');
    await llenar('equivocada', 'Una clave nueva 1', 'Una clave nueva 1');
    expect(await screen.findByRole('alert')).toHaveTextContent('La cuenta está bloqueada');
  });

  it('el cambio voluntario (también del alumno) ofrece volver al panel', async () => {
    simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ALUMNO') }) });
    mostrar('/cambiar-clave');
    const cancelar = await screen.findByRole('link', { name: 'Cancelar' });
    expect(cancelar).toHaveAttribute('href', '/panel');
  });
});

describe('/panel (criterio 48)', () => {
  function conSesion(rol: Parameters<typeof sesionDe>[0]) {
    return simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }),
      'DELETE /api/sesion': () => ({ estado: 204 }),
    });
  }

  it('muestra el nombre, el rol y la academia, "Cambiar contraseña" y "Cerrar sesión"', async () => {
    conSesion('ADMIN');
    mostrar('/panel');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    const datos = screen.getByText('Rol').closest('dl')!;
    expect(within(datos).getByText('Administrador')).toBeInTheDocument();
    expect(within(datos).getByText(ACADEMIA.nombre)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cambiar contraseña' })).toHaveAttribute('href', '/cambiar-clave');
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('el administrador ve "Usuarios" y "Restablecer contraseña"', async () => {
    conSesion('ADMIN');
    mostrar('/panel');
    expect(await screen.findByRole('link', { name: /Usuarios/ })).toHaveAttribute('href', '/panel/usuarios');
    expect(screen.getByRole('link', { name: /Restablecer contraseña/ })).toHaveAttribute('href', '/panel/restablecer');
  });

  it('la secretaria ve solo "Restablecer contraseña"', async () => {
    conSesion('SECRETARIA');
    mostrar('/panel');
    expect(await screen.findByRole('link', { name: /Restablecer contraseña/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Usuarios/ })).not.toBeInTheDocument();
  });

  it.each(['ENTRENADOR', 'ALUMNO'] as const)('el rol %s no ve opciones de gestión', async (rol) => {
    conSesion(rol);
    mostrar('/panel');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Usuarios/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Restablecer contraseña/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cambiar contraseña' })).toBeInTheDocument();
  });

  it('sin sesión (401) pide entrar por el enlace de la academia', async () => {
    simularApi({ 'GET /api/sesion': () => error('NO_AUTENTICADO', 401) });
    mostrar('/panel');
    expect(await screen.findByRole('heading', { name: 'Entra por el enlace de tu academia' })).toBeInTheDocument();
    expect(screen.queryByLabelText('DNI')).not.toBeInTheDocument();
  });

  it('con 403 ACADEMIA_SUSPENDIDA muestra "Academia no disponible por el momento"', async () => {
    simularApi({ 'GET /api/sesion': () => error('ACADEMIA_SUSPENDIDA', 403) });
    mostrar('/panel');
    expect(await screen.findByRole('heading', { name: 'Academia no disponible por el momento' })).toBeInTheDocument();
  });

  it('"Cerrar sesión" llama a DELETE /api/sesion y lleva al ingreso de la misma academia', async () => {
    const api = conSesion('ADMIN');
    mostrar('/panel');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(rutaActual()).toBe('/a/delfines/ingresar'));
    expect(llamadas(api, 'DELETE /api/sesion')).toHaveLength(1);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });
});
