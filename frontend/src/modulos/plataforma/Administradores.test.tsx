import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, llamadas, type Manejador, mostrar, simularApi } from '../../pruebas-api';

const ID_ACADEMIA = '0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ID_SUSPENDIDA = '1c2d3e4f-5a6b-4b7c-9d8e-0f1a2b3c4d5e';
const ID_ADMIN = '7c8d9e0f-1a2b-4b3c-8d4e-6f708192a3b4';
const SUPERADMIN = { id: '2d3e4f5a-6b7c-4c8d-8e9f-1a2b3c4d5e6f', correo: 'dueno@aquagestion.test', nombre: 'Dueño' };

function academia(id: string, nombre: string, nombreCorto: string, estado = 'ACTIVA') {
  return {
    id,
    nombre,
    nombreCorto,
    estado,
    creadaEn: '2026-11-12T03:00:00.000Z',
    suspendidaEn: estado === 'SUSPENDIDA' ? '2026-11-12T15:00:00.000Z' : null,
    motivoSuspension: estado === 'SUSPENDIDA' ? 'Falta de pago' : null,
  };
}

const ADMIN = {
  id: ID_ADMIN,
  dni: '10000001',
  nombres: 'Rosa',
  apellidos: 'Quispe Mamani',
  estado: 'ACTIVO',
  debeCambiarClave: true,
  bloqueado: false,
};

const RUTA_ADMINS = `/api/plataforma/academias/${ID_ACADEMIA}/administradores`;

function conPlataforma(extra: Record<string, Manejador> = {}) {
  return simularApi({
    'GET /api/plataforma/sesion': () => ({ estado: 200, cuerpo: { superadmin: SUPERADMIN } }),
    'GET /api/plataforma/academias': () => ({
      estado: 200,
      cuerpo: {
        academias: [
          academia(ID_ACADEMIA, 'Academia de Natación Los Delfines', 'delfines'),
          academia(ID_SUSPENDIDA, 'Club de Natación Tiburones', 'tiburones', 'SUSPENDIDA'),
        ],
      },
    }),
    ...extra,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

async function abrirAdministradores(nombre = 'Academia de Natación Los Delfines') {
  mostrar('/plataforma/academias');
  await userEvent.setup().click(await screen.findByRole('button', { name: `Administradores de ${nombre}` }));
  return within(await screen.findByRole('dialog', { name: `Administradores de ${nombre}` }));
}

describe('Administradores de una academia (criterio 50)', () => {
  it('cada academia tiene "Administradores", que muestra su lista con DNI, estado y bloqueo', async () => {
    conPlataforma({
      [`GET ${RUTA_ADMINS}`]: () => ({
        estado: 200,
        cuerpo: {
          administradores: [
            ADMIN,
            {
              ...ADMIN,
              id: '8d9e0f1a-2b3c-4c4d-9e5f-708192a3b4c5',
              dni: '10000009',
              nombres: 'Juan',
              estado: 'INACTIVO',
              bloqueado: true,
            },
          ],
        },
      }),
    });
    const dialogo = await abrirAdministradores();
    expect(screen.getAllByRole('button', { name: /^Administradores de / })).toHaveLength(2);
    const rosa = (await dialogo.findByText('Quispe Mamani, Rosa')).closest('li')!;
    expect(rosa).toHaveTextContent('10000001');
    expect(within(rosa).getByText('Activo')).toBeInTheDocument();
    const juan = dialogo.getByText('Quispe Mamani, Juan').closest('li')!;
    expect(within(juan).getByText('Inactivo')).toBeInTheDocument();
    expect(within(juan).getByText('Bloqueado')).toBeInTheDocument();
  });

  it('sin administradores invita a crear el primero', async () => {
    conPlataforma({ [`GET ${RUTA_ADMINS}`]: () => ({ estado: 200, cuerpo: { administradores: [] } }) });
    const dialogo = await abrirAdministradores();
    expect(await dialogo.findByText(/todavía no tiene administradores/)).toBeInTheDocument();
  });

  it('crea un administrador con el esquema compartido y vuelve a la lista actualizada', async () => {
    let lista: unknown[] = [];
    const api = conPlataforma({
      [`GET ${RUTA_ADMINS}`]: () => ({ estado: 200, cuerpo: { administradores: lista } }),
      [`POST ${RUTA_ADMINS}`]: () => {
        lista = [ADMIN];
        return { estado: 201, cuerpo: { administrador: ADMIN } };
      },
    });
    const dialogo = await abrirAdministradores();
    const usuario = userEvent.setup();
    await usuario.click(await dialogo.findByRole('button', { name: 'Nuevo administrador' }));
    const formulario = within(await screen.findByRole('dialog', { name: /Nuevo administrador de/ }));
    await usuario.click(formulario.getByRole('button', { name: 'Crear administrador' }));
    expect(await formulario.findByText('El DNI debe tener exactamente 8 dígitos.')).toBeInTheDocument();
    expect(llamadas(api, `POST ${RUTA_ADMINS}`)).toHaveLength(0);

    await usuario.type(formulario.getByLabelText('DNI'), '10000001');
    await usuario.type(formulario.getByLabelText('Nombres'), 'Rosa');
    await usuario.type(formulario.getByLabelText('Apellidos'), 'Quispe Mamani');
    await usuario.click(formulario.getByRole('button', { name: 'Crear administrador' }));
    expect(await screen.findByText('Quispe Mamani, Rosa')).toBeInTheDocument();
    expect(llamadas(api, `POST ${RUTA_ADMINS}`)).toEqual([
      { dni: '10000001', nombres: 'Rosa', apellidos: 'Quispe Mamani' },
    ]);
  });

  it('el 409 DNI_EN_USO se muestra junto al DNI', async () => {
    conPlataforma({
      [`GET ${RUTA_ADMINS}`]: () => ({ estado: 200, cuerpo: { administradores: [ADMIN] } }),
      [`POST ${RUTA_ADMINS}`]: () => error('DNI_EN_USO', 409),
    });
    const dialogo = await abrirAdministradores();
    const usuario = userEvent.setup();
    await usuario.click(await dialogo.findByRole('button', { name: 'Nuevo administrador' }));
    const formulario = within(await screen.findByRole('dialog', { name: /Nuevo administrador de/ }));
    await usuario.type(formulario.getByLabelText('DNI'), '10000001');
    await usuario.type(formulario.getByLabelText('Nombres'), 'Rosa');
    await usuario.type(formulario.getByLabelText('Apellidos'), 'Quispe Mamani');
    await usuario.click(formulario.getByRole('button', { name: 'Crear administrador' }));
    expect(await formulario.findByText('Ya existe una cuenta con ese DNI en esta academia.')).toBeInTheDocument();
    expect(formulario.getByLabelText('DNI')).toHaveAttribute('aria-invalid', 'true');
  });

  it('restablece la contraseña de un administrador solo tras confirmar', async () => {
    const api = conPlataforma({
      [`GET ${RUTA_ADMINS}`]: () => ({ estado: 200, cuerpo: { administradores: [ADMIN] } }),
      [`POST ${RUTA_ADMINS}/${ID_ADMIN}/restablecer-clave`]: () => ({ estado: 200, cuerpo: { administrador: ADMIN } }),
    });
    const dialogo = await abrirAdministradores();
    const usuario = userEvent.setup();
    await usuario.click(await dialogo.findByRole('button', { name: 'Restablecer contraseña de Rosa Quispe Mamani' }));
    const confirmacion = within(
      await screen.findByRole('dialog', { name: 'Restablecer contraseña de Rosa Quispe Mamani' }),
    );
    expect(confirmacion.getByText(/será su DNI \(10000001\)/)).toBeInTheDocument();
    expect(llamadas(api, `POST ${RUTA_ADMINS}/${ID_ADMIN}/restablecer-clave`)).toHaveLength(0);
    await usuario.click(confirmacion.getByRole('button', { name: 'Restablecer contraseña' }));
    expect(await screen.findByRole('status')).toHaveTextContent('La contraseña de Rosa Quispe Mamani ahora es su DNI');
    expect(llamadas(api, `POST ${RUTA_ADMINS}/${ID_ADMIN}/restablecer-clave`)).toEqual([{}]);
  });

  it('cancelar la confirmación no restablece nada y vuelve a la lista', async () => {
    const api = conPlataforma({
      [`GET ${RUTA_ADMINS}`]: () => ({ estado: 200, cuerpo: { administradores: [ADMIN] } }),
    });
    const dialogo = await abrirAdministradores();
    const usuario = userEvent.setup();
    await usuario.click(await dialogo.findByRole('button', { name: 'Restablecer contraseña de Rosa Quispe Mamani' }));
    await usuario.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('dialog', { name: /Administradores de/ })).toBeInTheDocument();
    expect(llamadas(api, `POST ${RUTA_ADMINS}/${ID_ADMIN}/restablecer-clave`)).toHaveLength(0);
  });

  it('una academia suspendida (403) lo explica y no deja crear', async () => {
    conPlataforma({
      [`GET /api/plataforma/academias/${ID_SUSPENDIDA}/administradores`]: () => error('ACADEMIA_SUSPENDIDA', 403),
    });
    const dialogo = await abrirAdministradores('Club de Natación Tiburones');
    expect(await dialogo.findByRole('alert')).toHaveTextContent('La academia está suspendida');
    await waitFor(() => expect(dialogo.getByRole('button', { name: 'Nuevo administrador' })).toBeDisabled());
  });

  it('un 401 lleva a /plataforma/ingresar', async () => {
    conPlataforma({ [`GET ${RUTA_ADMINS}`]: () => error('NO_AUTENTICADO', 401) });
    mostrar('/plataforma/academias');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Administradores de Academia de Natación Los Delfines' }));
    expect(await screen.findByLabelText('Correo')).toBeInTheDocument();
  });
});
