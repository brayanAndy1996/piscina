import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, llamadas, mostrar, type Respuesta, rutaActual, sesionDe, simularApi } from '../../pruebas-api';

// Criterio 59 (ataque ronda 2, observación 1, decisión AR2-2): la web reacciona a un cambio de sesión en otra pestaña. La cookie
// `aq_sesion` es una por navegador: si en otra pestaña se entra con otro usuario u otra academia, esta pestaña seguía mostrando la
// identidad anterior. Con la API simulada: la sesión de A cargada, `GET /api/sesion` pasa a devolver un usuario de B.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_MARTA = '4f5a6b7c-8d9e-4e0f-9a1b-3c4d5e6f7081';
const ID_LUIS = '5a6b7c8d-9e0f-4f1a-8b2c-4d5e6f708192';
const ID_BRUNO = '7c8d9e0f-1a2b-4b3c-8d4e-6f708192a3b4';

const ACADEMIA_A = 'Academia de Natación Los Delfines';
const ACADEMIA_B = 'Academia Tiburones del Sur';

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
    ultimoAcceso: null,
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
});

/** La sesión de otra identidad: otro usuario y otra academia. */
function sesionDeB(extra: { debeCambiarClave?: boolean } = {}) {
  return {
    usuario: {
      id: ID_BRUNO,
      nombres: 'Bruno',
      apellidos: 'Salas Peña',
      rol: 'ADMIN',
      debeCambiarClave: extra.debeCambiarClave ?? false,
      academia: { nombreCorto: 'tiburones', nombre: ACADEMIA_B },
    },
  };
}

/** Lo que `GET /api/sesion` devolverá en este momento; cada prueba lo cambia para simular la otra pestaña. */
let laSesion: () => Respuesta;
let usuariosEnCurso: boolean;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  laSesion = () => ({ estado: 200, cuerpo: sesionDe('ADMIN', { id: ID_YO }) });
  usuariosEnCurso = false;
});

function comoAdmin(extra: Parameters<typeof simularApi>[0] = {}) {
  return simularApi({
    'GET /api/sesion': () => laSesion(),
    'GET /api/usuarios': () =>
      usuariosEnCurso
        ? new Promise<Respuesta>(() => undefined) // la lista de la identidad nueva todavía no llega
        : { estado: 200, cuerpo: { usuarios: [YO, MARTA, LUIS] } },
    ...extra,
  });
}

const cambiarALaSesionDeB = () => {
  laSesion = () => ({ estado: 200, cuerpo: sesionDeB() });
};

function peticionesDeSesion(api: ReturnType<typeof simularApi>) {
  return llamadas(api, 'GET /api/sesion').length;
}

/**
 * Que haya un aviso que diga quién es ahora la persona y en qué academia, sin exigir su redacción: un elemento que mencione a
 * "Bruno" y a la academia nueva y que no sea la cabecera ni el título de la página (ni contenga alguno de los dos).
 */
async function esperarAvisoDeCambio() {
  await waitFor(() => {
    const candidatos = Array.from(document.body.querySelectorAll('*')).filter((el) => {
      const texto = el.textContent ?? '';
      return (
        texto.includes('Bruno') &&
        texto.includes(ACADEMIA_B) &&
        !el.querySelector('header, [role="banner"], h1') &&
        !el.closest('header, [role="banner"], h1')
      );
    });
    expect(candidatos.length, 'un aviso que mencione a Bruno y a la academia nueva').toBeGreaterThan(0);
  });
}

async function esperarIdentidadDeB() {
  await waitFor(() => expect(within(screen.getByRole('banner')).getByText(ACADEMIA_B)).toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 1, name: 'Bruno Salas Peña' })).toBeInTheDocument();
  expect(screen.queryByText(ACADEMIA_A)).not.toBeInTheDocument();
  expect(rutaActual()).toBe('/panel');
  await esperarAvisoDeCambio();
}

describe('criterio 59 a): al recuperar el foco la web vuelve a pedir la sesión', () => {
  const eventos: [string, () => void][] = [
    ['focus', () => window.dispatchEvent(new Event('focus'))],
    ['visibilitychange a visible', () => document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))],
  ];

  it.each(eventos)(
    'con el evento %s, la cabecera pasa a mostrar la identidad de B, la lista de A ya no está y se va a /panel con el aviso',
    async (_nombre, disparar) => {
      const api = comoAdmin();
      mostrar('/panel/usuarios');
      expect(await screen.findByText('Soto Rojas, Marta')).toBeInTheDocument();
      expect(within(screen.getByRole('banner')).getByText(ACADEMIA_A)).toBeInTheDocument();
      const antes = peticionesDeSesion(api);

      cambiarALaSesionDeB();
      act(disparar);

      await esperarIdentidadDeB();
      expect(peticionesDeSesion(api)).toBeGreaterThan(antes);
      expect(screen.queryByText('Soto Rojas, Marta')).not.toBeInTheDocument();
    },
  );

  it('con la misma sesión, recuperar el foco no cambia la pantalla ni muestra ningún aviso', async () => {
    const api = comoAdmin();
    mostrar('/panel/usuarios');
    expect(await screen.findByText('Soto Rojas, Marta')).toBeInTheDocument();
    const antes = peticionesDeSesion(api);

    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });

    await waitFor(() => expect(peticionesDeSesion(api)).toBeGreaterThan(antes));
    expect(screen.getByText('Soto Rojas, Marta')).toBeInTheDocument();
    expect(rutaActual()).toBe('/panel/usuarios');
    expect(screen.queryByText(/sesión cambió/i)).not.toBeInTheDocument();
  });

  it('criterio 59 c): la caché con la identidad anterior se descarta: al volver a Usuarios no se muestra la lista de A mientras llega la de B', async () => {
    comoAdmin();
    mostrar('/panel/usuarios');
    expect(await screen.findByText('Soto Rojas, Marta')).toBeInTheDocument();

    cambiarALaSesionDeB();
    usuariosEnCurso = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await esperarIdentidadDeB();
    await userEvent.setup().click(await screen.findByRole('link', { name: /Usuarios/ }));

    // Ya en Usuarios (la lista de B sigue sin llegar), la lista de A no debe verse.
    await waitFor(() => expect(rutaActual()).toBe('/panel/usuarios'));
    expect(screen.queryByText('Soto Rojas, Marta')).not.toBeInTheDocument();
    expect(screen.queryByText('Vega Díaz, Luis')).not.toBeInTheDocument();
  });

  it('criterio 59 d): si al recuperar el foco ya no hay sesión, hace lo del criterio 47 (pide entrar por el enlace de la academia)', async () => {
    comoAdmin();
    mostrar('/panel/usuarios');
    expect(await screen.findByText('Soto Rojas, Marta')).toBeInTheDocument();

    laSesion = () => error('NO_AUTENTICADO', 401);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(await screen.findByRole('heading', { name: 'Entra por el enlace de tu academia' })).toBeInTheDocument();
  });
});

describe('criterio 59 b) y c): antes de enviar una acción que escribe, la web vuelve a pedir la sesión', () => {
  async function abrirNuevoUsuario() {
    mostrar('/panel/usuarios');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Nuevo usuario' }));
    return within(await screen.findByRole('dialog', { name: 'Nuevo usuario' }));
  }

  async function llenar(dialogo: Awaited<ReturnType<typeof abrirNuevoUsuario>>) {
    const usuario = userEvent.setup();
    await usuario.type(dialogo.getByLabelText('DNI'), '30000003');
    await usuario.type(dialogo.getByLabelText('Nombres'), 'Pedro');
    await usuario.type(dialogo.getByLabelText('Apellidos'), 'Rivas Lara');
    await usuario.selectOptions(dialogo.getByLabelText('Rol'), 'ENTRENADOR');
  }

  it('con la misma sesión, "Crear usuario" sí envía POST /api/usuarios (y vuelve a pedir la sesión antes)', async () => {
    const api = comoAdmin({
      'POST /api/usuarios': () => ({
        estado: 201,
        cuerpo: { usuario: resumen({ id: ID_BRUNO, dni: '30000003', nombres: 'Pedro', apellidos: 'Rivas Lara' }) },
      }),
    });
    const dialogo = await abrirNuevoUsuario();
    await llenar(dialogo);
    const antes = peticionesDeSesion(api);

    await userEvent.setup().click(dialogo.getByRole('button', { name: 'Crear usuario' }));

    await waitFor(() => expect(llamadas(api, 'POST /api/usuarios')).toHaveLength(1));
    expect(llamadas(api, 'POST /api/usuarios')).toEqual([
      { dni: '30000003', nombres: 'Pedro', apellidos: 'Rivas Lara', rol: 'ENTRENADOR' },
    ]);
    expect(peticionesDeSesion(api), 'debe volver a pedir GET /api/sesion antes de enviar').toBeGreaterThan(antes);
    expect(rutaActual()).toBe('/panel/usuarios');
    expect(screen.queryByText(/sesión cambió/i)).not.toBeInTheDocument();
  });

  it('con la sesión cambiada a B, "Crear usuario" no envía POST /api/usuarios y lleva a /panel con la identidad nueva y el aviso', async () => {
    const api = comoAdmin({ 'POST /api/usuarios': () => ({ estado: 201, cuerpo: { usuario: MARTA } }) });
    const dialogo = await abrirNuevoUsuario();
    await llenar(dialogo);

    cambiarALaSesionDeB();
    await userEvent.setup().click(dialogo.getByRole('button', { name: 'Crear usuario' }));

    await esperarIdentidadDeB();
    expect(llamadas(api, 'POST /api/usuarios')).toHaveLength(0);
    expect(screen.queryByText('Soto Rojas, Marta')).not.toBeInTheDocument();
  });

  it('con otro usuario de la misma academia (cambia usuario.id), tampoco envía la acción', async () => {
    const api = comoAdmin({ 'POST /api/usuarios': () => ({ estado: 201, cuerpo: { usuario: MARTA } }) });
    const dialogo = await abrirNuevoUsuario();
    await llenar(dialogo);

    laSesion = () => ({ estado: 200, cuerpo: sesionDe('ADMIN', { id: ID_BRUNO }) });
    await userEvent.setup().click(dialogo.getByRole('button', { name: 'Crear usuario' }));

    await waitFor(() => expect(rutaActual()).toBe('/panel'));
    expect(llamadas(api, 'POST /api/usuarios')).toHaveLength(0);
    expect(await screen.findByText(/sesión cambió/i)).toBeInTheDocument();
  });

  const acciones: {
    nombre: string;
    boton: string;
    dialogo: string;
    confirmar: string;
    ruta: string;
  }[] = [
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
    'con la sesión cambiada, confirmar "$nombre" no envía $ruta',
    async ({ boton, dialogo, confirmar, ruta }) => {
      const api = comoAdmin({
        [ruta]: () => ({ estado: 200, cuerpo: { usuario: MARTA } }),
      });
      mostrar('/panel/usuarios');
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: boton }));
      const confirmacion = within(screen.getByRole('dialog', { name: dialogo }));

      cambiarALaSesionDeB();
      await usuario.click(confirmacion.getByRole('button', { name: confirmar }));

      await esperarIdentidadDeB();
      expect(llamadas(api, ruta)).toHaveLength(0);
    },
  );

  it('con la sesión cambiada, "Buscar" por DNI no envía POST /api/usuarios/buscar-por-dni', async () => {
    const api = comoAdmin({
      'POST /api/usuarios/buscar-por-dni': () => ({ estado: 200, cuerpo: { usuario: MARTA } }),
    });
    mostrar('/panel/restablecer');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('DNI de la persona'), '20000001');

    cambiarALaSesionDeB();
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));

    await esperarIdentidadDeB();
    expect(llamadas(api, 'POST /api/usuarios/buscar-por-dni')).toHaveLength(0);
  });

  it('con la sesión cambiada, "Guardar contraseña nueva" no envía POST /api/sesion/clave', async () => {
    const api = comoAdmin({ 'POST /api/sesion/clave': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }) });
    mostrar('/cambiar-clave');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Contraseña actual'), 'la-clave-actual-1');
    await usuario.type(screen.getByLabelText('Contraseña nueva'), 'una-clave-nueva-larga-2');
    await usuario.type(screen.getByLabelText('Confirma la contraseña nueva'), 'una-clave-nueva-larga-2');

    cambiarALaSesionDeB();
    await usuario.click(screen.getByRole('button', { name: 'Guardar contraseña nueva' }));

    await esperarIdentidadDeB();
    expect(llamadas(api, 'POST /api/sesion/clave')).toHaveLength(0);
  });

  describe('criterio 59 d): si la sesión nueva no es utilizable, hace lo de los criterios 47 y 48 sin enviar la acción', () => {
    const casos: [string, () => Respuesta, () => Promise<void> | void][] = [
      [
        'ya no hay sesión (401): pide entrar por el enlace de la academia',
        () => error('NO_AUTENTICADO', 401),
        async () => {
          expect(
            await screen.findByRole('heading', { name: 'Entra por el enlace de tu academia' }),
          ).toBeInTheDocument();
        },
      ],
      [
        'la academia está suspendida (403): muestra "Academia no disponible"',
        () => error('ACADEMIA_SUSPENDIDA', 403),
        async () => {
          expect(
            await screen.findByRole('heading', { name: 'Academia no disponible por el momento' }),
          ).toBeInTheDocument();
        },
      ],
      [
        'la sesión nueva tiene el cambio de contraseña obligatorio: lleva a /cambiar-clave',
        () => ({ estado: 200, cuerpo: sesionDeB({ debeCambiarClave: true }) }),
        async () => {
          expect(await screen.findByRole('heading', { name: 'Cambiar contraseña' })).toBeInTheDocument();
          await waitFor(() => expect(rutaActual()).toBe('/cambiar-clave'));
        },
      ],
    ];

    it.each(casos)('%s', async (_nombre, sesionNueva, verificar) => {
      const api = comoAdmin({ 'POST /api/usuarios': () => ({ estado: 201, cuerpo: { usuario: MARTA } }) });
      const dialogo = await abrirNuevoUsuario();
      await llenar(dialogo);

      laSesion = sesionNueva;
      await userEvent.setup().click(dialogo.getByRole('button', { name: 'Crear usuario' }));

      await verificar();
      expect(llamadas(api, 'POST /api/usuarios')).toHaveLength(0);
    });
  });
});

describe('criterio 59 e): "Cerrar sesión" no hace la comprobación: siempre cierra', () => {
  it('con la sesión cambiada, "Cerrar sesión" envía DELETE /api/sesion sin pedir antes GET /api/sesion', async () => {
    const api = comoAdmin({ 'DELETE /api/sesion': () => ({ estado: 204 }) });
    mostrar('/panel');
    const cerrar = await screen.findByRole('button', { name: 'Cerrar sesión' });
    cambiarALaSesionDeB();
    const antes = api.mock.calls.length;

    await userEvent.setup().click(cerrar);

    await waitFor(() => expect(llamadas(api, 'DELETE /api/sesion')).toHaveLength(1));
    const llamadasDespues = api.mock.calls.slice(antes).map(([url, opciones]) => `${opciones?.method ?? 'GET'} ${url}`);
    const posicionDelCierre = llamadasDespues.indexOf('DELETE /api/sesion');
    expect(llamadasDespues.slice(0, posicionDelCierre), 'nada antes del cierre').not.toContain('GET /api/sesion');
    await waitFor(() => expect(rutaActual()).toBe('/a/delfines/ingresar'));
    expect(screen.queryByText(/sesión cambió/i)).not.toBeInTheDocument();
  });
});
