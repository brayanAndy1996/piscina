import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { llamadas, mostrar, type Respuesta, rutaActual, sesionDe, simularApi } from '../../pruebas-api';

// Criterio 61 (ataque ronda 3, F2, decisión AR3-2): con la misma identidad (mismo `usuario.id` y misma academia) pero con
// `debeCambiarClave: true` en la comprobación previa, la web no envía la acción y lleva a `/cambiar-clave`, sin el aviso de "Tu sesión
// cambió". La única excepción es cambiar la propia contraseña desde `/cambiar-clave`. Con la API simulada.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_MARTA = '4f5a6b7c-8d9e-4e0f-9a1b-3c4d5e6f7081';
const ID_LUIS = '5a6b7c8d-9e0f-4f1a-8b2c-4d5e6f708192';

const resumen = (extra: Record<string, unknown>) => ({
  id: ID_MARTA,
  dni: '20000001',
  nombres: 'Marta',
  apellidos: 'Soto Rojas',
  rol: 'SECRETARIA',
  estado: 'ACTIVO',
  debeCambiarClave: false,
  bloqueado: false,
  ultimoAcceso: null,
  ...extra,
});
const MARTA = resumen({});
const LUIS = resumen({
  id: ID_LUIS,
  dni: '20000002',
  nombres: 'Luis',
  apellidos: 'Vega Díaz',
  rol: 'ENTRENADOR',
  estado: 'INACTIVO',
});

/** Lo que `GET /api/sesion` devolverá en este momento; cada prueba lo cambia para simular el restablecimiento y el reingreso. */
let laSesion: () => Respuesta;
const conCambioPendiente = () => {
  laSesion = () => ({ estado: 200, cuerpo: sesionDe('ADMIN', { id: ID_YO, debeCambiarClave: true }) });
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  laSesion = () => ({ estado: 200, cuerpo: sesionDe('ADMIN', { id: ID_YO }) });
});

function comoAdmin(extra: Parameters<typeof simularApi>[0] = {}) {
  return simularApi({
    'GET /api/sesion': () => laSesion(),
    'GET /api/usuarios': () => ({ estado: 200, cuerpo: { usuarios: [MARTA, LUIS] } }),
    ...extra,
  });
}

async function esperarCambiarClaveSinAviso() {
  await waitFor(() => expect(rutaActual()).toBe('/cambiar-clave'));
  expect(await screen.findByRole('heading', { name: 'Cambiar contraseña' })).toBeInTheDocument();
  expect(screen.queryByText(/sesión cambió/i)).not.toBeInTheDocument();
}

describe('criterio 61 a): con la misma identidad y el cambio obligatorio pendiente, la web no envía la acción', () => {
  it('"Crear usuario" no envía POST /api/usuarios y lleva a /cambiar-clave sin el aviso de sesión cambiada', async () => {
    const api = comoAdmin({ 'POST /api/usuarios': () => ({ estado: 201, cuerpo: { usuario: MARTA } }) });
    mostrar('/panel/usuarios');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Nuevo usuario' }));
    const dialogo = within(await screen.findByRole('dialog', { name: 'Nuevo usuario' }));
    await usuario.type(dialogo.getByLabelText('DNI'), '30000003');
    await usuario.type(dialogo.getByLabelText('Nombres'), 'Pedro');
    await usuario.type(dialogo.getByLabelText('Apellidos'), 'Rivas Lara');
    await usuario.selectOptions(dialogo.getByLabelText('Rol'), 'ENTRENADOR');

    conCambioPendiente();
    await usuario.click(dialogo.getByRole('button', { name: 'Crear usuario' }));

    await esperarCambiarClaveSinAviso();
    expect(llamadas(api, 'POST /api/usuarios')).toHaveLength(0);
  });

  const acciones = [
    {
      nombre: 'desactivar',
      boton: 'Desactivar a Marta Soto Rojas',
      dialogo: 'Desactivar Marta Soto Rojas',
      confirmar: 'Desactivar cuenta',
      ruta: `POST /api/usuarios/${ID_MARTA}/desactivar`,
    },
    {
      nombre: 'reactivar',
      boton: 'Reactivar a Luis Vega Díaz',
      dialogo: 'Reactivar Luis Vega Díaz',
      confirmar: 'Reactivar cuenta',
      ruta: `POST /api/usuarios/${ID_LUIS}/reactivar`,
    },
    {
      nombre: 'restablecer',
      boton: 'Restablecer contraseña de Marta Soto Rojas',
      dialogo: 'Restablecer contraseña de Marta Soto Rojas',
      confirmar: 'Restablecer contraseña',
      ruta: `POST /api/usuarios/${ID_MARTA}/restablecer-clave`,
    },
  ];

  it.each(acciones)(
    'confirmar "$nombre" no envía $ruta y lleva a /cambiar-clave sin el aviso',
    async ({ boton, dialogo, confirmar, ruta }) => {
      const api = comoAdmin({ [ruta]: () => ({ estado: 200, cuerpo: { usuario: MARTA } }) });
      mostrar('/panel/usuarios');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: boton }));
      const confirmacion = within(screen.getByRole('dialog', { name: dialogo }));

      conCambioPendiente();
      await usuario.click(confirmacion.getByRole('button', { name: confirmar }));

      await esperarCambiarClaveSinAviso();
      expect(llamadas(api, ruta)).toHaveLength(0);
    },
  );

  it('"Buscar" por DNI no envía POST /api/usuarios/buscar-por-dni y lleva a /cambiar-clave sin el aviso', async () => {
    const api = comoAdmin({
      'POST /api/usuarios/buscar-por-dni': () => ({ estado: 200, cuerpo: { usuario: MARTA } }),
    });
    mostrar('/panel/restablecer');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('DNI de la persona'), '20000001');

    conCambioPendiente();
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));

    await esperarCambiarClaveSinAviso();
    expect(llamadas(api, 'POST /api/usuarios/buscar-por-dni')).toHaveLength(0);
  });
});

describe('criterio 61 b): la única excepción es cambiar la propia contraseña desde /cambiar-clave', () => {
  it('con la misma identidad y el cambio pendiente, "Guardar contraseña nueva" sí envía POST /api/sesion/clave', async () => {
    conCambioPendiente();
    const api = comoAdmin({
      'POST /api/sesion/clave': () => ({ estado: 200, cuerpo: sesionDe('ADMIN', { id: ID_YO }) }),
    });
    mostrar('/cambiar-clave');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Contraseña actual'), 'la-clave-actual-1');
    await usuario.type(screen.getByLabelText('Contraseña nueva'), 'una-clave-nueva-larga-2');
    await usuario.type(screen.getByLabelText('Confirma la contraseña nueva'), 'una-clave-nueva-larga-2');

    await usuario.click(screen.getByRole('button', { name: 'Guardar contraseña nueva' }));

    await waitFor(() => expect(llamadas(api, 'POST /api/sesion/clave')).toHaveLength(1));
    expect(llamadas(api, 'POST /api/sesion/clave')[0]).toMatchObject({
      claveActual: 'la-clave-actual-1',
      claveNueva: 'una-clave-nueva-larga-2',
    });
    expect(screen.queryByText(/sesión cambió/i)).not.toBeInTheDocument();
  });
});
