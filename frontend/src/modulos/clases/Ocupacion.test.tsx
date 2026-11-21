import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, llamadas, type Manejador, mostrar, sesionDe, simularApi } from '../../pruebas-api';
import { Rutas } from '../../rutas/Rutas';

// Spec 005b, criterio 46 (PB14): "inscritos / aforo" en la grilla con GET /api/clases/ocupacion y los diálogos de DR-5 en el formulario
// de clases (AFORO_MENOR_QUE_INSCRITOS con confirmación, CLASE_CON_INSCRITOS con una explicación). La API se simula; los criterios 40 a 42
// los prueba el backend.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_MARIO = 'e1111111-1111-4111-8111-111111111111';
const C1 = 'c1111111-1111-4111-8111-111111111111';
const C2 = 'c2222222-2222-4222-8222-222222222222';
const MARIO = { id: ID_MARIO, nombres: 'Mario', apellidos: 'Castro Vega', activo: true };

function clase(extra: Record<string, unknown>) {
  return {
    id: C1,
    nivel: 'BASICO',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    aforo: 30,
    activo: true,
    entrenador: MARIO,
    ...extra,
  };
}

const CLASE_1 = clase({});
const CLASE_2 = clase({ id: C2, nivel: 'INTERMEDIO', aforo: 25 });
const OCUPACION = {
  mes: '2026-11',
  ocupacion: [
    { claseId: C1, inscritos: 28, cuposRestantes: 2 },
    { claseId: C2, inscritos: 0, cuposRestantes: 25 },
  ],
};

const USUARIOS = [
  {
    id: ID_MARIO,
    dni: '20000001',
    nombres: 'Mario',
    apellidos: 'Castro Vega',
    rol: 'ENTRENADOR',
    estado: 'ACTIVO',
    debeCambiarClave: false,
    bloqueado: false,
    ultimoAcceso: null,
  },
];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const PATCH_C1 = `PATCH /api/clases/${C1}`;

function servidor(
  extra: Record<string, Manejador> = {},
  ocupacion: () => ReturnType<Manejador> = () => ({ estado: 200, cuerpo: OCUPACION }),
) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN', { id: ID_YO }) }),
    'GET /api/mi-academia': () => ({
      estado: 200,
      cuerpo: { academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null } },
    }),
    'GET /api/usuarios': () => ({ estado: 200, cuerpo: { usuarios: USUARIOS } }),
    'GET /api/clases': () => ({ estado: 200, cuerpo: { clases: [CLASE_1, CLASE_2] } }),
    'GET /api/clases/ocupacion': ocupacion,
    ...extra,
  });
}

const EDITAR_C1 = /Editar la clase Básico del lunes de 18:00 a 19:00/;

async function abrirEdicion() {
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole('button', { name: EDITAR_C1 }));
  const dialogo = await screen.findByRole('dialog', { name: 'Editar clase' });
  return { usuario, dialogo };
}

describe('grilla: inscritos / aforo (criterio 46)', () => {
  it('muestra "inscritos / aforo" en cada clase con lo que responde GET /api/clases/ocupacion', async () => {
    const api = servidor();
    mostrar('/panel/clases');
    const primera = await screen.findByRole('button', { name: EDITAR_C1 });
    await waitFor(() => expect(primera).toHaveTextContent('Inscritos 28 / 30'));
    expect(primera).toHaveAttribute('aria-label', expect.stringContaining('28 inscritos'));
    expect(screen.getByRole('button', { name: /Editar la clase Intermedio/ })).toHaveTextContent('Inscritos 0 / 25');
    expect(llamadas(api, 'GET /api/clases/ocupacion')).toHaveLength(1);
  });

  it('las claves de las consultas llevan la academia y la identidad de la sesión', async () => {
    servidor();
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={['/panel/clases']}>
          <Rutas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Inscritos 28 / 30');
    expect(
      cliente
        .getQueryCache()
        .findAll({ queryKey: ['ocupacion'] })
        .map((q) => q.queryKey),
    ).toEqual([['ocupacion', 'delfines', ID_YO]]);
  });

  it('si la ocupación no llega, la grilla sigue con el aforo y lo avisa sin bloquear nada', async () => {
    servidor({}, () => error('ERROR_INTERNO', 500));
    mostrar('/panel/clases');
    const primera = await screen.findByRole('button', { name: EDITAR_C1 });
    expect(primera).toHaveTextContent('Aforo 30');
    expect(await screen.findByText(/No pudimos cargar los inscritos de cada clase/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('tras guardar un cambio, vuelve a pedir la ocupación', async () => {
    const api = servidor({ [PATCH_C1]: () => ({ estado: 200, cuerpo: { clase: { ...CLASE_1, aforo: 35 } } }) });
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion();
    const aforo = screen.getByLabelText('Aforo (alumnos)');
    await usuario.clear(aforo);
    await usuario.type(aforo, '35');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Clase guardada.');
    await waitFor(() => expect(llamadas(api, 'GET /api/clases/ocupacion')).toHaveLength(2));
  });
});

describe('formulario de clases: AFORO_MENOR_QUE_INSCRITOS (criterio 46, DR-5)', () => {
  async function bajarElAforo(usuario: ReturnType<typeof userEvent.setup>, valor = '20') {
    const aforo = screen.getByLabelText('Aforo (alumnos)');
    await usuario.clear(aforo);
    await usuario.type(aforo, valor);
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  }

  it('abre un diálogo con los inscritos; "Confirmar" reenvía el mismo cuerpo con confirmarAforoMenor', async () => {
    let intento = 0;
    const api = servidor({
      [PATCH_C1]: () =>
        ++intento === 1
          ? error('AFORO_MENOR_QUE_INSCRITOS', 409, { inscritos: 28 })
          : { estado: 200, cuerpo: { clase: { ...CLASE_1, aforo: 20 } } },
    });
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion();
    await bajarElAforo(usuario);

    const dialogo = await screen.findByRole('dialog', { name: 'El aforo es menor que los inscritos' });
    expect(dialogo).toHaveTextContent('La clase tiene 28 inscritos y quieres bajar su aforo a 20.');
    expect(dialogo).toHaveTextContent('Nadie pierde su lugar');
    expect(llamadas(api, PATCH_C1)).toEqual([{ aforo: 20 }]);

    await usuario.click(within(dialogo).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Clase guardada.')).toBeInTheDocument();
    expect(llamadas(api, PATCH_C1)).toEqual([{ aforo: 20 }, { aforo: 20, confirmarAforoMenor: true }]);
    expect(screen.queryByRole('dialog', { name: 'El aforo es menor que los inscritos' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('20');
  });

  it('"Volver" cierra el diálogo sin enviar y deja el formulario con lo escrito', async () => {
    const api = servidor({ [PATCH_C1]: () => error('AFORO_MENOR_QUE_INSCRITOS', 409, { inscritos: 1 }) });
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion();
    await bajarElAforo(usuario, '22');
    const dialogo = await screen.findByRole('dialog', { name: 'El aforo es menor que los inscritos' });
    expect(dialogo).toHaveTextContent('La clase tiene 1 inscrito y');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Volver' }));

    expect(screen.queryByRole('dialog', { name: 'El aforo es menor que los inscritos' })).not.toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: 'Editar clase' })).toBeInTheDocument();
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('22');
    expect(llamadas(api, PATCH_C1)).toEqual([{ aforo: 22 }]);
  });

  it('desactiva "Confirmar" mientras espera y no reenvía con un segundo clic', async () => {
    let resolver: () => void = () => undefined;
    const espera = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    let intento = 0;
    const api = servidor({
      [PATCH_C1]: async () => {
        if (++intento === 1) return error('AFORO_MENOR_QUE_INSCRITOS', 409, { inscritos: 28 });
        await espera;
        return { estado: 200, cuerpo: { clase: { ...CLASE_1, aforo: 20 } } };
      },
    });
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion();
    await bajarElAforo(usuario);
    const dialogo = await screen.findByRole('dialog', { name: 'El aforo es menor que los inscritos' });
    await usuario.click(within(dialogo).getByRole('button', { name: 'Confirmar' }));
    const boton = await within(dialogo).findByRole('button', { name: 'Guardando…' });
    expect(boton).toBeDisabled();
    await usuario.click(boton);
    resolver();
    await screen.findByText('Clase guardada.');
    expect(llamadas(api, PATCH_C1)).toHaveLength(2);
  });

  it('si la confirmación falla por otra razón, lo dice en el diálogo y se puede volver', async () => {
    let intento = 0;
    servidor({
      [PATCH_C1]: () =>
        ++intento === 1 ? error('AFORO_MENOR_QUE_INSCRITOS', 409, { inscritos: 28 }) : error('ERROR_INTERNO', 500),
    });
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion();
    await bajarElAforo(usuario);
    const dialogo = await screen.findByRole('dialog', { name: 'El aforo es menor que los inscritos' });
    await usuario.click(within(dialogo).getByRole('button', { name: 'Confirmar' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No se pudo contactar al servidor');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Volver' }));
    expect(await screen.findByRole('dialog', { name: 'Editar clase' })).toBeInTheDocument();
  });
});

describe('formulario de clases: CLASE_CON_INSCRITOS (criterio 46, DR-5)', () => {
  it('explica que hay que mover a los inscritos o cancelar sus solicitudes, junto al campo del estado', async () => {
    const api = servidor({ [PATCH_C1]: () => error('CLASE_CON_INSCRITOS', 409, { inscritos: 7 }) });
    mostrar('/panel/clases');
    const { usuario, dialogo } = await abrirEdicion();
    await usuario.click(within(dialogo).getByLabelText('Clase activa'));
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));

    const mensaje = await within(dialogo).findByText(/La clase tiene 7 inscritos/);
    expect(mensaje).toHaveTextContent('Primero hay que moverlos a otra clase o cancelar sus solicitudes.');
    expect(within(dialogo).getByLabelText('Clase activa')).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(api, PATCH_C1)).toEqual([{ activo: false }]);
    // No es un diálogo de confirmación: el formulario sigue ahí.
    expect(screen.queryByRole('dialog', { name: 'El aforo es menor que los inscritos' })).not.toBeInTheDocument();
  });
});
