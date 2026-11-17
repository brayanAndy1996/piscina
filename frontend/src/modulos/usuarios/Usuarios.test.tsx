import { type BoundFunctions, type queries, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, llamadas, type Manejador, mostrar, rutaActual, sesionDe, simularApi } from '../../pruebas-api';

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_MARTA = '4f5a6b7c-8d9e-4e0f-9a1b-3c4d5e6f7081';
const ID_LUIS = '5a6b7c8d-9e0f-4f1a-8b2c-4d5e6f708192';
const ID_ALUMNO = '6b7c8d9e-0f1a-4a2b-9c3d-5e6f708192a3';

function resumen(extra: Record<string, unknown>) {
  return {
    id: ID_MARTA,
    dni: '20000001',
    nombres: 'Marta',
    apellidos: 'Soto Rojas',
    rol: 'SECRETARIA',
    estado: 'ACTIVO',
    debeCambiarClave: false,
    bloqueado: false,
    // 03:30 UTC del 13/11 es el 12/11 a las 22:30 en Lima: la fecha y la hora deben ser las de Lima.
    ultimoAcceso: '2026-11-13T03:30:00.000Z',
    ...extra,
  };
}

const YO = resumen({ id: ID_YO, dni: '10000001', nombres: 'Rosa', apellidos: 'Quispe Mamani', rol: 'ADMIN' });
const MARTA = resumen({});
const LUIS = resumen({
  id: ID_LUIS,
  dni: '20000002',
  nombres: 'Luis',
  apellidos: 'Vega Díaz',
  rol: 'ENTRENADOR',
  estado: 'INACTIVO',
  bloqueado: true,
  debeCambiarClave: true,
  ultimoAcceso: null,
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function comoAdmin(extra: Record<string, Manejador> = {}) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN', { id: ID_YO }) }),
    'GET /api/usuarios': () => ({ estado: 200, cuerpo: { usuarios: [YO, MARTA, LUIS] } }),
    ...extra,
  });
}

describe('/panel/usuarios (criterio 49)', () => {
  it('lista el personal con nombre, DNI, rol, estado, bloqueado y último acceso en America/Lima', async () => {
    comoAdmin();
    mostrar('/panel/usuarios');
    const marta = (await screen.findByText('Soto Rojas, Marta')).closest('li')!;
    expect(marta).toHaveTextContent('20000001');
    expect(marta).toHaveTextContent('Secretaria');
    expect(within(marta).getByText('Activo')).toBeInTheDocument();
    expect(marta).toHaveTextContent('Último acceso: 12/11/2026 22:30');

    const luis = screen.getByText('Vega Díaz, Luis').closest('li')!;
    expect(luis).toHaveTextContent('Entrenador');
    expect(within(luis).getByText('Inactivo')).toBeInTheDocument();
    expect(within(luis).getByText('Bloqueado')).toBeInTheDocument();
    expect(luis).toHaveTextContent('Aún no ha ingresado');
  });

  it('en la propia cuenta no ofrece desactivar ni restablecer', async () => {
    comoAdmin();
    mostrar('/panel/usuarios');
    const yo = (await screen.findByText('Quispe Mamani, Rosa')).closest('li')!;
    expect(within(yo).getByText('Tú')).toBeInTheDocument();
    expect(within(yo).queryByRole('button')).not.toBeInTheDocument();
  });

  it('una secretaria no ve la página (y no se pide la lista)', async () => {
    const api = simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('SECRETARIA') }) });
    mostrar('/panel/usuarios');
    expect(await screen.findByRole('heading', { name: 'No tienes permiso para ver esta página' })).toBeInTheDocument();
    expect(api.mock.calls.some(([url]) => url === '/api/usuarios')).toBe(false);
  });

  it('muestra "Cargando usuarios…" y el error con "Reintentar"', async () => {
    comoAdmin({ 'GET /api/usuarios': () => error('ERROR_INTERNO', 500) });
    mostrar('/panel/usuarios');
    expect(await screen.findByText(/No se pudieron cargar los usuarios/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('un 401 al pedir la lista lleva a pedir entrar por el enlace de la academia', async () => {
    let vencida = false;
    simularApi({
      'GET /api/sesion': () => (vencida ? error('NO_AUTENTICADO', 401) : { estado: 200, cuerpo: sesionDe('ADMIN') }),
      'GET /api/usuarios': () => {
        vencida = true;
        return error('NO_AUTENTICADO', 401);
      },
    });
    mostrar('/panel/usuarios');
    expect(await screen.findByRole('heading', { name: 'Entra por el enlace de tu academia' })).toBeInTheDocument();
  });

  describe('crear', () => {
    async function abrirFormulario() {
      mostrar('/panel/usuarios');
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Nuevo usuario' }));
      return within(await screen.findByRole('dialog', { name: 'Nuevo usuario' }));
    }

    async function llenar(dialogo: BoundFunctions<typeof queries>, dni: string) {
      const usuario = userEvent.setup();
      await usuario.type(dialogo.getByLabelText('DNI'), dni);
      await usuario.type(dialogo.getByLabelText('Nombres'), 'Pedro');
      await usuario.type(dialogo.getByLabelText('Apellidos'), 'Rivas Lara');
      await usuario.selectOptions(dialogo.getByLabelText('Rol'), 'ENTRENADOR');
      await usuario.click(dialogo.getByRole('button', { name: 'Crear usuario' }));
    }

    it('valida con el esquema compartido antes de enviar', async () => {
      const api = comoAdmin();
      const dialogo = await abrirFormulario();
      await userEvent.setup().click(dialogo.getByRole('button', { name: 'Crear usuario' }));
      expect(await dialogo.findByText('El DNI debe tener exactamente 8 dígitos.')).toBeInTheDocument();
      expect(llamadas(api, 'POST /api/usuarios')).toHaveLength(0);
    });

    it('envía los datos, explica la contraseña inicial y vuelve a pedir la lista', async () => {
      let usuarios = [YO, MARTA, LUIS];
      const api = comoAdmin({
        'GET /api/usuarios': () => ({ estado: 200, cuerpo: { usuarios } }),
        'POST /api/usuarios': () => {
          usuarios = [
            ...usuarios,
            resumen({ id: ID_ALUMNO, dni: '30000003', nombres: 'Pedro', apellidos: 'Rivas Lara' }),
          ];
          return { estado: 201, cuerpo: { usuario: usuarios[3] } };
        },
      });
      const dialogo = await abrirFormulario();
      expect(dialogo.getByText(/contraseña inicial será su DNI/)).toBeInTheDocument();
      await llenar(dialogo, ' 30000003 ');
      expect(await screen.findByText('Rivas Lara, Pedro')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(llamadas(api, 'POST /api/usuarios')).toEqual([
        { dni: '30000003', nombres: 'Pedro', apellidos: 'Rivas Lara', rol: 'ENTRENADOR' },
      ]);
    });

    it('el 409 DNI_EN_USO se muestra junto al DNI', async () => {
      comoAdmin({ 'POST /api/usuarios': () => error('DNI_EN_USO', 409) });
      const dialogo = await abrirFormulario();
      await llenar(dialogo, '20000001');
      expect(await dialogo.findByText('Ya existe una cuenta con ese DNI en esta academia.')).toBeInTheDocument();
      expect(dialogo.getByLabelText('DNI')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('desactivar, reactivar y restablecer con confirmación', () => {
    it('desactivar pide confirmación y no llama a la API si se cancela', async () => {
      const api = comoAdmin();
      mostrar('/panel/usuarios');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Desactivar a Marta Soto Rojas' }));
      const dialogo = within(screen.getByRole('dialog', { name: 'Desactivar Marta Soto Rojas' }));
      expect(dialogo.getByText(/perderá el acceso de inmediato/)).toBeInTheDocument();
      await usuario.click(dialogo.getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(llamadas(api, `POST /api/usuarios/${ID_MARTA}/desactivar`)).toHaveLength(0);
    });

    it('desactivar confirmado envía el POST y vuelve a pedir la lista', async () => {
      let marta = MARTA;
      const api = comoAdmin({
        'GET /api/usuarios': () => ({ estado: 200, cuerpo: { usuarios: [YO, marta, LUIS] } }),
        [`POST /api/usuarios/${ID_MARTA}/desactivar`]: () => {
          marta = { ...MARTA, estado: 'INACTIVO' };
          return { estado: 200, cuerpo: { usuario: marta } };
        },
      });
      mostrar('/panel/usuarios');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Desactivar a Marta Soto Rojas' }));
      await usuario.click(screen.getByRole('button', { name: 'Desactivar cuenta' }));
      expect(await screen.findByRole('button', { name: 'Reactivar a Marta Soto Rojas' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(llamadas(api, `POST /api/usuarios/${ID_MARTA}/desactivar`)).toEqual([{}]);
    });

    it('reactivar confirmado envía el POST', async () => {
      const api = comoAdmin({
        [`POST /api/usuarios/${ID_LUIS}/reactivar`]: () => ({
          estado: 200,
          cuerpo: { usuario: { ...LUIS, estado: 'ACTIVO' } },
        }),
      });
      mostrar('/panel/usuarios');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Reactivar a Luis Vega Díaz' }));
      const dialogo = within(screen.getByRole('dialog', { name: 'Reactivar Luis Vega Díaz' }));
      expect(dialogo.getByText(/Reactivar no cambia la contraseña/)).toBeInTheDocument();
      await usuario.click(dialogo.getByRole('button', { name: 'Reactivar cuenta' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(llamadas(api, `POST /api/usuarios/${ID_LUIS}/reactivar`)).toEqual([{}]);
    });

    it('restablecer explica que la nueva contraseña es el DNI y envía el POST al confirmar', async () => {
      const api = comoAdmin({
        [`POST /api/usuarios/${ID_MARTA}/restablecer-clave`]: () => ({ estado: 200, cuerpo: { usuario: MARTA } }),
      });
      mostrar('/panel/usuarios');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Restablecer contraseña de Marta Soto Rojas' }));
      const dialogo = within(screen.getByRole('dialog', { name: 'Restablecer contraseña de Marta Soto Rojas' }));
      expect(dialogo.getByText(/será su DNI \(20000001\)/)).toBeInTheDocument();
      await usuario.click(dialogo.getByRole('button', { name: 'Restablecer contraseña' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(llamadas(api, `POST /api/usuarios/${ID_MARTA}/restablecer-clave`)).toEqual([{}]);
    });

    it('un 409 USUARIO_YA_INACTIVO se explica dentro de la confirmación', async () => {
      comoAdmin({ [`POST /api/usuarios/${ID_MARTA}/desactivar`]: () => error('USUARIO_YA_INACTIVO', 409) });
      mostrar('/panel/usuarios');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Desactivar a Marta Soto Rojas' }));
      await usuario.click(screen.getByRole('button', { name: 'Desactivar cuenta' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('La cuenta ya estaba desactivada.');
    });
  });
});

describe('/panel/restablecer (criterios 49 y 43)', () => {
  const ALUMNO = resumen({
    id: ID_ALUMNO,
    dni: '40000004',
    nombres: 'Ana',
    apellidos: 'Pérez Ruiz',
    rol: 'ALUMNO',
    ultimoAcceso: null,
  });

  function comoSecretaria(extra: Record<string, Manejador> = {}) {
    return simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('SECRETARIA', { id: ID_YO }) }),
      ...extra,
    });
  }

  async function buscar(dni: string) {
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('DNI de la persona'), dni);
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));
  }

  it('busca con POST y el DNI en el cuerpo: nunca en la dirección de la API ni en la de la página', async () => {
    const api = comoSecretaria({
      'POST /api/usuarios/buscar-por-dni': () => ({ estado: 200, cuerpo: { usuario: ALUMNO } }),
    });
    mostrar('/panel/restablecer');
    await buscar(' 40000004 ');
    const encontrado = within(await screen.findByRole('region', { name: 'Persona encontrada' }));
    expect(encontrado.getByRole('heading', { name: 'Pérez Ruiz, Ana' })).toBeInTheDocument();
    expect(encontrado.getByText('Alumno', { exact: false })).toBeInTheDocument();

    expect(llamadas(api, 'POST /api/usuarios/buscar-por-dni')).toEqual([{ dni: ' 40000004 ' }]);
    for (const [url] of api.mock.calls) expect(String(url)).not.toMatch(/\d{8}/);
    expect(rutaActual()).toBe('/panel/restablecer');
    expect(rutaActual()).not.toContain('dni');
    expect(localStorage).toHaveLength(0);
  });

  it('pide confirmación explicando que la contraseña será el DNI y avisa al terminar', async () => {
    const api = comoSecretaria({
      'POST /api/usuarios/buscar-por-dni': () => ({ estado: 200, cuerpo: { usuario: ALUMNO } }),
      [`POST /api/usuarios/${ID_ALUMNO}/restablecer-clave`]: () => ({ estado: 200, cuerpo: { usuario: ALUMNO } }),
    });
    mostrar('/panel/restablecer');
    await buscar('40000004');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Restablecer contraseña' }));
    const dialogo = within(screen.getByRole('dialog', { name: 'Restablecer contraseña de Ana Pérez Ruiz' }));
    expect(dialogo.getByText(/será su DNI \(40000004\)/)).toBeInTheDocument();
    expect(llamadas(api, `POST /api/usuarios/${ID_ALUMNO}/restablecer-clave`)).toHaveLength(0);
    await usuario.click(dialogo.getByRole('button', { name: 'Restablecer contraseña' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'La contraseña de Ana Pérez Ruiz ahora es su DNI y tendrá que cambiarla al entrar.',
    );
    expect(llamadas(api, `POST /api/usuarios/${ID_ALUMNO}/restablecer-clave`)).toEqual([{}]);
    expect(screen.queryByRole('region', { name: 'Persona encontrada' })).not.toBeInTheDocument();
  });

  it('si no se encuentra (404: no existe, es de otra academia o fuera de alcance) lo dice sin revelar más', async () => {
    comoSecretaria({ 'POST /api/usuarios/buscar-por-dni': () => error('NO_ENCONTRADO', 404) });
    mostrar('/panel/restablecer');
    await buscar('12345678');
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos una cuenta con ese DNI');
    expect(screen.getByRole('alert')).toHaveTextContent('solo restablece contraseñas de alumnos');
  });

  it('en la propia cuenta no ofrece restablecer', async () => {
    comoSecretaria({
      'POST /api/usuarios/buscar-por-dni': () => ({
        estado: 200,
        cuerpo: { usuario: { ...ALUMNO, id: ID_YO, rol: 'SECRETARIA' } },
      }),
    });
    mostrar('/panel/restablecer');
    await buscar('40000004');
    expect(await screen.findByText(/Esta es tu propia cuenta/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restablecer contraseña' })).not.toBeInTheDocument();
  });

  it('exige escribir el DNI y el administrador también entra', async () => {
    const api = simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }) });
    mostrar('/panel/restablecer');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Escribe el DNI.')).toBeInTheDocument();
    expect(llamadas(api, 'POST /api/usuarios/buscar-por-dni')).toHaveLength(0);
  });

  it('el entrenador no ve la página', async () => {
    simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ENTRENADOR') }) });
    mostrar('/panel/restablecer');
    expect(await screen.findByRole('heading', { name: 'No tienes permiso para ver esta página' })).toBeInTheDocument();
    expect(screen.queryByLabelText('DNI de la persona')).not.toBeInTheDocument();
  });
});
