import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { error, llamadas, type Manejador, mostrar, type Respuesta, sesionDe, simularApi } from '../../pruebas-api';
import { Rutas } from '../../rutas/Rutas';

// Spec 004, criterios 26, 28 y 29: la página de clases (grilla semanal y formulario con los esquemas compartidos) y las lecciones
// de la 003 (clave con la identidad de la sesión, base de llenado, campos desactivados al guardar, error de un GET en segundo plano).
// La API se simula; los criterios de la API los prueba el backend.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_MARIO = 'e1111111-1111-4111-8111-111111111111';
const ID_PAULA = 'e2222222-2222-4222-8222-222222222222';
const ID_LUIS = 'e3333333-3333-4333-8333-333333333333';
const ID_MARTA = 'e4444444-4444-4444-8444-444444444444';
const C1 = 'c1111111-1111-4111-8111-111111111111';
const C2 = 'c2222222-2222-4222-8222-222222222222';
const C3 = 'c3333333-3333-4333-8333-333333333333';
const C4 = 'c4444444-4444-4444-8444-444444444444';

function persona(id: string, extra: Record<string, unknown>) {
  return {
    id,
    dni: '20000001',
    nombres: 'Mario',
    apellidos: 'Castro Vega',
    rol: 'ENTRENADOR',
    estado: 'ACTIVO',
    debeCambiarClave: false,
    bloqueado: false,
    ultimoAcceso: null,
    ...extra,
  };
}

const USUARIOS = [
  persona(ID_YO, { dni: '10000001', nombres: 'Rosa', apellidos: 'Quispe Mamani', rol: 'ADMIN' }),
  persona(ID_MARTA, { dni: '10000002', nombres: 'Marta', apellidos: 'Soto Rojas', rol: 'SECRETARIA' }),
  persona(ID_MARIO, {}),
  persona(ID_PAULA, { dni: '20000002', nombres: 'Paula', apellidos: 'Fuentes Ibarra' }),
  persona(ID_LUIS, { dni: '20000003', nombres: 'Luis', apellidos: 'Vega Díaz', estado: 'INACTIVO' }),
];

const MARIO = { id: ID_MARIO, nombres: 'Mario', apellidos: 'Castro Vega', activo: true };
const PAULA = { id: ID_PAULA, nombres: 'Paula', apellidos: 'Fuentes Ibarra', activo: true };
const LUIS = { id: ID_LUIS, nombres: 'Luis', apellidos: 'Vega Díaz', activo: false };
const ENTRENADORES = [MARIO, PAULA, LUIS];

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
const CLASE_2 = clase({ id: C2, nivel: 'INTERMEDIO', aforo: 25, entrenador: PAULA });
const CLASE_3 = clase({
  id: C3,
  nivel: 'AVANZADO',
  diaSemana: 3,
  horaInicio: '08:00',
  horaFin: '09:00',
  aforo: 20,
  entrenador: LUIS,
});
const CLASE_4 = clase({ id: C4, diaSemana: 5, horaInicio: '19:00', horaFin: '20:00', aforo: 40, activo: false });

const MI_ACADEMIA = {
  academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null },
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

type Clase = ReturnType<typeof clase>;

/** Un servidor de clases con estado, como la API: el `POST` agrega y el `PATCH` mezcla y responde con toda la clase. */
function servidor(inicial: Clase[] = [CLASE_1, CLASE_2, CLASE_3, CLASE_4], extra: Record<string, Manejador> = {}) {
  const estado = { clases: inicial };
  const api = simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN', { id: ID_YO }) }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    'GET /api/usuarios': () => ({ estado: 200, cuerpo: { usuarios: USUARIOS } }),
    'GET /api/clases': () => ({ estado: 200, cuerpo: { clases: estado.clases } }),
    'POST /api/clases': (cuerpo) => {
      const { entrenadorId, ...datos } = cuerpo as {
        nivel: string;
        diaSemana: number;
        horaInicio: string;
        entrenadorId: string;
        aforo: number;
      };
      const nueva = clase({
        id: 'c5555555-5555-4555-8555-555555555555',
        ...datos,
        horaFin: `${String(Number(datos.horaInicio.slice(0, 2)) + 1).padStart(2, '0')}:00`,
        entrenador: ENTRENADORES.find((e) => e.id === entrenadorId) ?? MARIO,
      });
      estado.clases = [...estado.clases, nueva];
      return { estado: 201, cuerpo: { clase: nueva } };
    },
    [`PATCH /api/clases/${C1}`]: (cuerpo) => {
      const cambios = cuerpo as { entrenadorId?: string } & Record<string, unknown>;
      const actual = estado.clases.find((c) => c.id === C1) ?? CLASE_1;
      const { entrenadorId, ...resto } = cambios;
      const nueva = {
        ...actual,
        ...resto,
        ...(entrenadorId ? { entrenador: ENTRENADORES.find((e) => e.id === entrenadorId) ?? actual.entrenador } : {}),
      };
      estado.clases = estado.clases.map((c) => (c.id === C1 ? nueva : c));
      return { estado: 200, cuerpo: { clase: nueva } };
    },
    ...extra,
  });
  return { api, estado };
}

function diferido() {
  let resolver: () => void = () => undefined;
  const promesa = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

/** Corta y vuelve la conexión: la web vuelve a pedir lo que está a la vista sin desmontar el formulario. */
function reconectar() {
  act(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
}

const esperar = (ms: number) => act(() => new Promise<void>((resolver) => setTimeout(resolver, ms)));

/** Lo que responde la API a un `PATCH`: la clase con los cambios y el entrenador completo. */
function conCambios(actual: Clase, cuerpo: unknown): Clase {
  const { entrenadorId, ...resto } = cuerpo as { entrenadorId?: string } & Record<string, unknown>;
  return {
    ...actual,
    ...resto,
    ...(entrenadorId ? { entrenador: ENTRENADORES.find((e) => e.id === entrenadorId) ?? actual.entrenador } : {}),
  };
}

/** El botón de una clase en la grilla, por su etiqueta completa. */
const botonDeClase = (nombre: RegExp | string) => screen.findByRole('button', { name: nombre });

async function abrirEdicion(nombre: RegExp | string) {
  const usuario = userEvent.setup();
  await usuario.click(await botonDeClase(nombre));
  const dialogo = await screen.findByRole('dialog', { name: 'Editar clase' });
  return { usuario, dialogo };
}

const EDITAR_C1 = /Editar la clase Básico del lunes de 18:00 a 19:00/;

describe('permiso (criterio 26)', () => {
  it.each(['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const)(
    'el rol %s que abre /panel/clases ve "sin permiso" y no se piden clases ni usuarios',
    async (rol) => {
      const api = simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
      mostrar('/panel/clases');
      expect(await screen.findByText('No tienes permiso para ver esta página')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Nueva clase' })).not.toBeInTheDocument();
      expect(llamadas(api, 'GET /api/clases')).toHaveLength(0);
      expect(llamadas(api, 'GET /api/usuarios')).toHaveLength(0);
    },
  );

  it('el administrador llega desde el inicio por "Clases y horarios"', async () => {
    servidor();
    mostrar('/panel');
    await userEvent.setup().click(await screen.findByRole('link', { name: /Clases y horarios/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Clases y horarios' })).toBeInTheDocument();
  });
});

describe('grilla semanal (criterio 28)', () => {
  it('muestra los siete días por los doce bloques de 08:00 a 20:00', async () => {
    servidor();
    mostrar('/panel/clases');
    await botonDeClase(EDITAR_C1);
    const tabla = screen.getByRole('table', { name: /Clases de la semana/ });
    const dias = within(tabla)
      .getAllByRole('columnheader')
      .map((celda) => celda.textContent);
    expect(dias).toEqual(['Hora', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
    const bloques = within(tabla)
      .getAllByRole('rowheader')
      .map((celda) => celda.textContent);
    expect(bloques).toHaveLength(12);
    expect(bloques[0]).toBe('08:00 a 09:00');
    expect(bloques[11]).toBe('19:00 a 20:00');
  });

  it('pone cada clase en su día y bloque, con nivel, entrenador y aforo, y marca las inactivas', async () => {
    servidor();
    mostrar('/panel/clases');
    const lunes18 = await botonDeClase(EDITAR_C1);
    expect(lunes18).toHaveTextContent('Básico');
    expect(lunes18).toHaveTextContent('Mario Castro');
    expect(lunes18).toHaveTextContent('Aforo 30');
    expect(lunes18.closest('td')).toBe(
      within(screen.getByRole('table')).getAllByRole('row')[11]?.querySelectorAll('td')[0],
    );

    // Dos clases de distinto nivel en el mismo bloque, cada una con su entrenador (RN-10).
    const celda = lunes18.closest('td');
    expect(within(celda as HTMLElement).getAllByRole('button')).toHaveLength(2);
    expect(
      within(celda as HTMLElement).getByRole('button', { name: /Intermedio.*entrenador Paula Fuentes/ }),
    ).toBeInTheDocument();

    // Entrenador inactivo.
    const miercoles8 = await botonDeClase(/Editar la clase Avanzado del miércoles de 08:00 a 09:00/);
    expect(miercoles8).toHaveTextContent('Entrenador inactivo');
    expect(miercoles8).not.toHaveTextContent('Inactiva');

    // Clase inactiva.
    const viernes19 = await botonDeClase(/Editar la clase Básico del viernes de 19:00 a 20:00/);
    expect(viernes19).toHaveTextContent('Inactiva');
    expect(viernes19).toHaveAttribute('aria-label', expect.stringContaining('inactiva'));
    expect(viernes19).not.toHaveTextContent('Entrenador inactivo');
  });

  it('en el celular se elige el día: solo queda a la vista la columna del día elegido', async () => {
    servidor();
    mostrar('/panel/clases');
    await botonDeClase(EDITAR_C1);
    const usuario = userEvent.setup();
    const grupo = screen.getByRole('group', { name: 'Día de la semana' });
    await usuario.click(within(grupo).getByRole('button', { name: 'Lunes' }));
    expect(within(grupo).getByRole('button', { name: 'Lunes' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grupo).getByRole('button', { name: 'Martes' })).toHaveAttribute('aria-pressed', 'false');
    const encabezado = (dia: string) => screen.getByRole('columnheader', { name: dia });
    expect(encabezado('Lunes')).not.toHaveClass('hidden');
    expect(encabezado('Martes')).toHaveClass('hidden', 'md:table-cell');

    await usuario.click(within(grupo).getByRole('button', { name: 'Miércoles' }));
    expect(within(grupo).getByRole('button', { name: 'Miércoles' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grupo).getByRole('button', { name: 'Lunes' })).toHaveAttribute('aria-pressed', 'false');
    expect(encabezado('Lunes')).toHaveClass('hidden', 'md:table-cell');
    expect(encabezado('Miércoles')).not.toHaveClass('hidden');
  });

  it('sin clases, invita a crear la primera', async () => {
    servidor([]);
    mostrar('/panel/clases');
    expect(await screen.findByText(/Todavía no hay clases/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nueva clase' })).toBeInTheDocument();
  });

  it('si no se pueden cargar, lo dice y permite reintentar', async () => {
    let intento = 0;
    servidor([CLASE_1], {
      'GET /api/clases': () => (++intento === 1 ? error('ERROR', 500) : { estado: 200, cuerpo: { clases: [CLASE_1] } }),
    });
    mostrar('/panel/clases');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las clases.');
    expect(screen.queryByRole('button', { name: 'Nueva clase' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await botonDeClase(EDITAR_C1)).toBeInTheDocument();
  });

  it('no muestra la grilla de la caché hasta tener la respuesta pedida al entrar', async () => {
    servidor();
    const usuario = userEvent.setup();
    mostrar('/panel/clases');
    await botonDeClase(EDITAR_C1);
    await usuario.click(screen.getByRole('link', { name: /Volver al inicio/ }));

    const demora = diferido();
    simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN', { id: ID_YO }) }),
      'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
      'GET /api/clases': async () => {
        await demora.promesa;
        return { estado: 200, cuerpo: { clases: [CLASE_2] } };
      },
    });
    await usuario.click(await screen.findByRole('link', { name: /Clases y horarios/ }));
    expect(await screen.findByText('Cargando clases…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    demora.resolver();
    expect(await botonDeClase(/Editar la clase Intermedio/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EDITAR_C1 })).not.toBeInTheDocument();
  });
});

describe('nueva clase (criterios 17 a 20 y 28)', () => {
  async function abrirNueva() {
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Nueva clase' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva clase' });
    await waitFor(() => expect(screen.getByLabelText('Entrenador')).toBeEnabled());
    return { usuario, dialogo };
  }

  async function llenar(usuario: ReturnType<typeof userEvent.setup>, aforo = '25') {
    await usuario.selectOptions(screen.getByLabelText('Nivel'), 'INTERMEDIO');
    await usuario.selectOptions(screen.getByLabelText('Día'), 'Martes');
    await usuario.selectOptions(screen.getByLabelText('Bloque'), '19:00 a 20:00');
    await usuario.selectOptions(screen.getByLabelText('Entrenador'), 'Fuentes Ibarra, Paula');
    await usuario.type(screen.getByLabelText('Aforo (alumnos)'), aforo);
  }

  it('ofrece solo los entrenadores activos de GET /api/usuarios y explica el aforo', async () => {
    servidor();
    mostrar('/panel/clases');
    await abrirNueva();
    const opciones = within(screen.getByLabelText('Entrenador'))
      .getAllByRole('option')
      .map((opcion) => opcion.textContent);
    expect(opciones).toEqual(['Elige un entrenador', 'Castro Vega, Mario', 'Fuentes Ibarra, Paula']);
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveAccessibleDescription('De 20 a 50 alumnos.');
    const bloques = within(screen.getByLabelText('Bloque'))
      .getAllByRole('option')
      .map((opcion) => opcion.textContent);
    expect(bloques).toHaveLength(13);
    expect(bloques[1]).toBe('08:00 a 09:00');
    expect(bloques[12]).toBe('19:00 a 20:00');
    expect(within(screen.getByLabelText('Día')).getAllByRole('option')).toHaveLength(8);
    expect(screen.queryByLabelText('Clase activa')).not.toBeInTheDocument();
  });

  it('no guarda en la lista de entrenadores el DNI de nadie', async () => {
    servidor();
    mostrar('/panel/clases');
    await abrirNueva();
    expect(document.body.innerHTML).not.toContain('10000001');
    expect(document.body.innerHTML).not.toContain('20000002');
  });

  it('con selectores sin elegir y un aforo inválido, muestra los errores junto a cada campo y no envía', async () => {
    const { api } = servidor();
    mostrar('/panel/clases');
    const { usuario } = await abrirNueva();
    await usuario.type(screen.getByLabelText('Aforo (alumnos)'), '19');
    await usuario.click(screen.getByRole('button', { name: 'Crear clase' }));
    expect(await screen.findByText('Elige un nivel.')).toBeInTheDocument();
    expect(screen.getByText('Elige un día.')).toBeInTheDocument();
    expect(screen.getByText('Elige un bloque.')).toBeInTheDocument();
    expect(screen.getByText('Elige un entrenador.')).toBeInTheDocument();
    expect(screen.getByText('El aforo debe ser de 20 a 50 alumnos.')).toBeInTheDocument();
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Nivel')).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(api, 'POST /api/clases')).toHaveLength(0);
  });

  it.each([
    ['19', 'El aforo debe ser de 20 a 50 alumnos.'],
    ['51', 'El aforo debe ser de 20 a 50 alumnos.'],
    ['20.5', 'El aforo debe ser un número entero de 20 a 50.'],
    ['mucho', 'El aforo debe ser un número entero de 20 a 50.'],
  ])('el aforo %s no se envía', async (aforo, mensaje) => {
    const { api } = servidor();
    mostrar('/panel/clases');
    const { usuario } = await abrirNueva();
    await llenar(usuario, aforo);
    await usuario.click(screen.getByRole('button', { name: 'Crear clase' }));
    expect(await screen.findByText(mensaje)).toBeInTheDocument();
    expect(llamadas(api, 'POST /api/clases')).toHaveLength(0);
  });

  it.each(['20', '50'])('el aforo %s, en los extremos, se acepta', async (aforo) => {
    const { api } = servidor();
    mostrar('/panel/clases');
    const { usuario } = await abrirNueva();
    await llenar(usuario, aforo);
    await usuario.click(screen.getByRole('button', { name: 'Crear clase' }));
    await screen.findByText(/Clase creada/);
    expect(llamadas(api, 'POST /api/clases')).toEqual([
      { nivel: 'INTERMEDIO', diaSemana: 2, horaInicio: '19:00', entrenadorId: ID_PAULA, aforo: Number(aforo) },
    ]);
  });

  it('crea la clase y la muestra en su bloque, sin volver a pedir la lista', async () => {
    const { api } = servidor();
    mostrar('/panel/clases');
    const { usuario } = await abrirNueva();
    await llenar(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Crear clase' }));

    expect(await screen.findByText('Clase creada: Intermedio, martes de 19:00 a 20:00.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const nueva = await botonDeClase(/Editar la clase Intermedio del martes de 19:00 a 20:00/);
    expect(nueva).toHaveTextContent('Paula Fuentes');
    expect(nueva).toHaveTextContent('Aforo 25');
    expect(llamadas(api, 'GET /api/clases')).toHaveLength(1);
  });

  it.each([
    ['ENTRENADOR_OCUPADO', 'Entrenador', /Ese entrenador ya tiene otra clase activa a esa hora\./],
    ['ENTRENADOR_NO_VALIDO', 'Entrenador', /Elige un entrenador activo de tu academia\./],
    ['CLASE_DUPLICADA', 'Nivel', /Ya hay una clase activa de ese nivel el mismo día y a la misma hora\./],
  ])('el 409 %s se muestra junto al campo %s y no cierra el formulario', async (codigo, campo, mensaje) => {
    servidor(undefined, { 'POST /api/clases': () => error(codigo, 409) });
    mostrar('/panel/clases');
    const { usuario, dialogo } = await abrirNueva();
    await llenar(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Crear clase' }));
    const texto = await within(dialogo).findByText(mensaje);
    const control = screen.getByLabelText(campo);
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control.getAttribute('aria-describedby')).toContain(texto.id);
    // Es el único campo marcado, y el aviso general no aparece.
    expect(within(dialogo).getAllByRole('alert')).toHaveLength(1);
    // Lo elegido sigue ahí.
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('25');
    expect(screen.getByRole('dialog', { name: 'Nueva clase' })).toBeInTheDocument();
    expect(screen.queryByText(/Clase creada/)).not.toBeInTheDocument();
  });

  it('los errores 400 de la API se muestran junto a su campo', async () => {
    servidor(undefined, {
      'POST /api/clases': () =>
        error('SOLICITUD_INVALIDA', 400, {
          errores: [{ campo: 'aforo', mensaje: 'Mensaje de la API para el aforo.' }],
        }),
    });
    mostrar('/panel/clases');
    const { usuario } = await abrirNueva();
    await llenar(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Crear clase' }));
    expect(await screen.findByText('Mensaje de la API para el aforo.')).toBeInTheDocument();
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('un error sin campo se muestra dentro del formulario y no pierde lo escrito', async () => {
    servidor(undefined, { 'POST /api/clases': () => error('SIN_PERMISO', 403) });
    mostrar('/panel/clases');
    const { usuario, dialogo } = await abrirNueva();
    await llenar(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Crear clase' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Mensaje de SIN_PERMISO');
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('25');
  });

  it('si la lista de entrenadores falla, lo dice y permite reintentar', async () => {
    let intento = 0;
    servidor(undefined, {
      'GET /api/usuarios': () =>
        ++intento === 1 ? error('ERROR', 500) : { estado: 200, cuerpo: { usuarios: USUARIOS } },
    });
    mostrar('/panel/clases');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Nueva clase' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva clase' });
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No se pudo cargar la lista de entrenadores.');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Entrenador')).getByRole('option', { name: 'Castro Vega, Mario' }),
      ).toBeInTheDocument(),
    );
  });

  it('sin entrenadores activos, avisa que hay que crear uno', async () => {
    servidor(undefined, {
      'GET /api/usuarios': () => ({
        estado: 200,
        cuerpo: { usuarios: [USUARIOS[0], persona(ID_LUIS, { estado: 'INACTIVO' })] },
      }),
    });
    mostrar('/panel/clases');
    await abrirNueva();
    expect(await screen.findByText(/No hay entrenadores activos/)).toBeInTheDocument();
  });
});

describe('editar una clase (criterios 21, 25 y 28)', () => {
  it('muestra el nivel, el día y la hora sin poder cambiarlos, y llena el entrenador, el aforo y el estado', async () => {
    servidor();
    mostrar('/panel/clases');
    await abrirEdicion(EDITAR_C1);
    expect(screen.getByText('Básico · Lunes de 18:00 a 19:00')).toBeInTheDocument();
    expect(screen.getByText(/Para mover la clase, desactívala y crea otra/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nivel')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Día')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Bloque')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Entrenador')).toHaveValue(ID_MARIO);
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('30');
    expect(screen.getByLabelText('Clase activa')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('guarda solo lo que cambió y deja lo que devolvió la API', async () => {
    const { api } = servidor();
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion(EDITAR_C1);
    const aforo = screen.getByLabelText('Aforo (alumnos)');
    await usuario.clear(aforo);
    await usuario.type(aforo, '45');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Clase guardada.')).toBeInTheDocument();
    expect(llamadas(api, `PATCH /api/clases/${C1}`)).toEqual([{ aforo: 45 }]);
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('45');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(await botonDeClase(EDITAR_C1)).toHaveTextContent('Aforo 45');
  });

  it('cambiar de entrenador envía solo el entrenador', async () => {
    const { api } = servidor();
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion(EDITAR_C1);
    await usuario.selectOptions(screen.getByLabelText('Entrenador'), 'Fuentes Ibarra, Paula');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Clase guardada.');
    expect(llamadas(api, `PATCH /api/clases/${C1}`)).toEqual([{ entrenadorId: ID_PAULA }]);
    expect(await botonDeClase(/Editar la clase Básico del lunes.*entrenador Paula Fuentes/)).toBeInTheDocument();
  });

  it('desactivar una clase envía solo "activo" y la grilla la marca "Inactiva"', async () => {
    const { api } = servidor();
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion(EDITAR_C1);
    await usuario.click(screen.getByLabelText('Clase activa'));
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Clase guardada.');
    expect(llamadas(api, `PATCH /api/clases/${C1}`)).toEqual([{ activo: false }]);
    expect(await botonDeClase(EDITAR_C1)).toHaveTextContent('Inactiva');
  });

  it('con el entrenador inactivo, lo muestra marcado y permite cambiar solo el aforo (criterio 25)', async () => {
    const { api } = servidor(undefined, {
      [`PATCH /api/clases/${C3}`]: (cuerpo) => ({
        estado: 200,
        cuerpo: { clase: { ...CLASE_3, ...(cuerpo as object) } },
      }),
    });
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion(/Editar la clase Avanzado del miércoles/);
    const entrenador = screen.getByLabelText('Entrenador');
    expect(entrenador).toHaveValue(ID_LUIS);
    expect(within(entrenador).getByRole('option', { name: 'Vega Díaz, Luis (inactivo)' })).toBeInTheDocument();
    expect(within(entrenador).getByRole('option', { name: 'Castro Vega, Mario' })).toBeInTheDocument();
    expect(within(entrenador).queryByRole('option', { name: /Soto Rojas/ })).not.toBeInTheDocument();
    const aforo = screen.getByLabelText('Aforo (alumnos)');
    await usuario.clear(aforo);
    await usuario.type(aforo, '22');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Clase guardada.');
    expect(llamadas(api, `PATCH /api/clases/${C3}`)).toEqual([{ aforo: 22 }]);
  });

  it('un aforo fuera de rango no se envía', async () => {
    const { api } = servidor();
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion(EDITAR_C1);
    const aforo = screen.getByLabelText('Aforo (alumnos)');
    await usuario.clear(aforo);
    await usuario.type(aforo, '51');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('El aforo debe ser de 20 a 50 alumnos.')).toBeInTheDocument();
    expect(llamadas(api, `PATCH /api/clases/${C1}`)).toHaveLength(0);
  });

  it('reactivar una clase que choca (409 CLASE_DUPLICADA) se muestra junto al estado', async () => {
    servidor(undefined, { [`PATCH /api/clases/${C4}`]: () => error('CLASE_DUPLICADA', 409) });
    mostrar('/panel/clases');
    const { usuario, dialogo } = await abrirEdicion(/Editar la clase Básico del viernes de 19:00 a 20:00/);
    expect(screen.getByLabelText('Clase activa')).not.toBeChecked();
    await usuario.click(screen.getByLabelText('Clase activa'));
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const mensaje = await within(dialogo).findByText(
      /Ya hay una clase activa de ese nivel el mismo día y a la misma hora\./,
    );
    const casilla = screen.getByLabelText('Clase activa');
    expect(casilla).toHaveAttribute('aria-invalid', 'true');
    expect(casilla.getAttribute('aria-describedby')).toContain(mensaje.id);
    // La casilla sigue como la dejó la persona.
    expect(casilla).toBeChecked();
  });

  it('un entrenador ocupado (409) al reasignar se muestra junto al entrenador', async () => {
    servidor(undefined, { [`PATCH /api/clases/${C1}`]: () => error('ENTRENADOR_OCUPADO', 409) });
    mostrar('/panel/clases');
    const { usuario, dialogo } = await abrirEdicion(EDITAR_C1);
    await usuario.selectOptions(screen.getByLabelText('Entrenador'), 'Fuentes Ibarra, Paula');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await within(dialogo).findByText(/Ese entrenador ya tiene otra clase activa a esa hora\./);
    expect(screen.getByLabelText('Entrenador')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Entrenador')).toHaveValue(ID_PAULA);
  });

  it('una clase que ya no existe (404) se avisa dentro del formulario', async () => {
    servidor(undefined, { [`PATCH /api/clases/${C1}`]: () => error('NO_ENCONTRADO', 404) });
    mostrar('/panel/clases');
    const { usuario, dialogo } = await abrirEdicion(EDITAR_C1);
    await usuario.click(screen.getByLabelText('Clase activa'));
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Mensaje de NO_ENCONTRADO');
  });
});

describe('el formulario con la base de llenado (criterios 27 y 29)', () => {
  const AVISO =
    'Otro administrador cambió esta clase mientras editabas. Actualizamos los campos que no tocaste; revisa los tuyos antes de guardar.';

  it('sin ediciones, una clase cambiada por otro administrador recarga el formulario y Guardar sigue desactivado', async () => {
    const { api, estado } = servidor();
    mostrar('/panel/clases');
    await abrirEdicion(EDITAR_C1);
    estado.clases = [{ ...CLASE_1, aforo: 35, entrenador: PAULA }, CLASE_2, CLASE_3, CLASE_4];
    reconectar();
    await waitFor(() => expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('35'));
    expect(screen.getByLabelText('Entrenador')).toHaveValue(ID_PAULA);
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(llamadas(api, `PATCH /api/clases/${C1}`)).toHaveLength(0);
  });

  it('con ediciones, actualiza lo que no se tocó, conserva lo editado, avisa y envía solo lo editado', async () => {
    const { api, estado } = servidor();
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion(EDITAR_C1);
    const aforo = screen.getByLabelText('Aforo (alumnos)');
    await usuario.clear(aforo);
    await usuario.type(aforo, '28');

    // El otro administrador cambia el entrenador y también el aforo (que este ya estaba editando).
    estado.clases = [{ ...CLASE_1, aforo: 35, entrenador: PAULA }, CLASE_2, CLASE_3, CLASE_4];
    reconectar();
    await waitFor(() => expect(screen.getByLabelText('Entrenador')).toHaveValue(ID_PAULA));
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('28');
    expect(screen.getByText(AVISO)).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Clase guardada.');
    expect(llamadas(api, `PATCH /api/clases/${C1}`)).toEqual([{ aforo: 28 }]);
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Entrenador')).toHaveValue(ID_PAULA);
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('un GET pedido antes de la respuesta del PATCH no deshace lo guardado', async () => {
    let actual: Clase = CLASE_1;
    let patch: ReturnType<typeof diferido> | null = null;
    let get: ReturnType<typeof diferido> | null = null;
    let retenerGet = false;
    const api = simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN', { id: ID_YO }) }),
      'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
      'GET /api/usuarios': () => ({ estado: 200, cuerpo: { usuarios: USUARIOS } }),
      'GET /api/clases': async () => {
        const foto = actual;
        if (retenerGet) {
          get = diferido();
          await get.promesa;
        }
        return { estado: 200, cuerpo: { clases: [foto] } };
      },
      [`PATCH /api/clases/${C1}`]: async (cuerpo) => {
        patch = diferido();
        await patch.promesa;
        actual = conCambios(actual, cuerpo);
        return { estado: 200, cuerpo: { clase: actual } };
      },
    });
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion(EDITAR_C1);
    const aforo = screen.getByLabelText('Aforo (alumnos)');
    await usuario.clear(aforo);
    await usuario.type(aforo, '28');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(patch).not.toBeNull());

    retenerGet = true;
    reconectar();
    await waitFor(() => expect(get).not.toBeNull());
    await act(async () => {
      patch?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    expect(await screen.findByText('Clase guardada.')).toBeInTheDocument();
    await act(async () => {
      get?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('28');
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(screen.getByText('Clase guardada.')).toBeInTheDocument();

    // Lo siguiente se compara con la respuesta del PATCH.
    retenerGet = false;
    await usuario.selectOptions(screen.getByLabelText('Entrenador'), 'Fuentes Ibarra, Paula');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(llamadas(api, `PATCH /api/clases/${C1}`)).toHaveLength(2));
    expect(llamadas(api, `PATCH /api/clases/${C1}`)).toEqual([{ aforo: 28 }, { entrenadorId: ID_PAULA }]);
    (patch as ReturnType<typeof diferido> | null)?.resolver();
    await screen.findByText('Clase guardada.');
  });

  it('un error del GET en segundo plano deja el formulario con lo escrito y no lo cierra', async () => {
    let falla = false;
    const { api } = servidor(undefined, {
      'GET /api/clases': () =>
        falla ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: { clases: [CLASE_1, CLASE_2] } },
    });
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion(EDITAR_C1);
    const aforo = screen.getByLabelText('Aforo (alumnos)');
    await usuario.clear(aforo);
    await usuario.type(aforo, '33');

    falla = true;
    reconectar();
    expect(await screen.findByText(/No pudimos comprobar si las clases cambiaron/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Editar clase' })).toBeInTheDocument();
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('33');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();

    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Clase guardada.');
    expect(llamadas(api, `PATCH /api/clases/${C1}`)).toEqual([{ aforo: 33 }]);
  });

  it('mientras se guarda, los campos y los botones quedan desactivados y no se puede cerrar', async () => {
    let patch: ReturnType<typeof diferido> | null = null;
    servidor(undefined, {
      [`PATCH /api/clases/${C1}`]: async (cuerpo) => {
        patch = diferido();
        await patch.promesa;
        return { estado: 200, cuerpo: { clase: { ...CLASE_1, ...(cuerpo as object) } } };
      },
    });
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion(EDITAR_C1);
    const aforo = screen.getByLabelText('Aforo (alumnos)');
    await usuario.clear(aforo);
    await usuario.type(aforo, '28');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(patch).not.toBeNull());

    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled();
    for (const etiqueta of ['Entrenador', 'Aforo (alumnos)', 'Clase activa']) {
      expect(screen.getByLabelText(etiqueta)).toBeDisabled();
    }
    await usuario.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Editar clase' })).toBeInTheDocument();

    await act(async () => {
      patch?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    await screen.findByText('Clase guardada.');
    expect(screen.getByLabelText('Aforo (alumnos)')).toBeEnabled();
    expect(screen.getByLabelText('Aforo (alumnos)')).toHaveValue('28');
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeEnabled();
  });

  it('el formulario se desbloquea apenas responde la escritura aunque la lista de clases nunca se vuelva a pedir', async () => {
    let lecturas = 0;
    servidor(undefined, {
      'GET /api/clases': () => {
        lecturas += 1;
        return lecturas === 1
          ? { estado: 200, cuerpo: { clases: [CLASE_1] } }
          : new Promise<Respuesta>(() => undefined);
      },
      [`PATCH /api/clases/${C1}`]: (cuerpo) => ({
        estado: 200,
        cuerpo: { clase: { ...CLASE_1, ...(cuerpo as object) } },
      }),
    });
    mostrar('/panel/clases');
    const { usuario } = await abrirEdicion(EDITAR_C1);
    const aforo = screen.getByLabelText('Aforo (alumnos)');
    await usuario.clear(aforo);
    await usuario.type(aforo, '28');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Clase guardada.');
    await esperar(300);
    expect(screen.getByLabelText('Aforo (alumnos)')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Guardando…' })).not.toBeInTheDocument();
  });
});

describe('las consultas llevan la identidad de la sesión (criterios 28 de 003 y 29 de 004)', () => {
  const ID_BRUNO = '7c8d9e0f-1a2b-4b3c-8d4e-6f708192a3b4';
  const sesionDeB = {
    usuario: {
      id: ID_BRUNO,
      nombres: 'Bruno',
      apellidos: 'Salas Peña',
      rol: 'ADMIN',
      debeCambiarClave: false,
      academia: { nombreCorto: 'tiburones', nombre: 'Academia Tiburones del Sur' },
    },
  };

  it('las claves de las clases y de los entrenadores llevan la academia y la persona de la sesión', async () => {
    servidor();
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={['/panel/clases']}>
          <Rutas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await botonDeClase(EDITAR_C1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Nueva clase' }));
    await waitFor(() => expect(screen.getByLabelText('Entrenador')).toBeEnabled());
    const claves = cliente
      .getQueryCache()
      .getAll()
      .map((consulta) => consulta.queryKey);
    expect(claves).toContainEqual(['clases', 'delfines', ID_YO]);
    expect(claves).toContainEqual(['entrenadores', 'delfines', ID_YO]);
  });

  it('al cambiar la sesión a otra academia, la página nunca muestra las clases de la anterior, ni mientras carga las de la nueva', async () => {
    let enB = false;
    const demoraB = diferido();
    simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: enB ? sesionDeB : sesionDe('ADMIN', { id: ID_YO }) }),
      'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
      'GET /api/usuarios': () => ({ estado: 200, cuerpo: { usuarios: USUARIOS } }),
      'GET /api/clases': async () => {
        if (!enB) return { estado: 200, cuerpo: { clases: [CLASE_1] } };
        await demoraB.promesa;
        return { estado: 200, cuerpo: { clases: [CLASE_2] } };
      },
    });
    const usuario = userEvent.setup();
    mostrar('/panel/clases');
    await botonDeClase(EDITAR_C1);

    enB = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await screen.findByText(/Tu sesión cambió/);
    await usuario.click(await screen.findByRole('link', { name: /Clases y horarios/ }));
    expect(await screen.findByText('Cargando clases…')).toBeInTheDocument();
    await esperar(200);
    expect(screen.queryByRole('button', { name: EDITAR_C1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    demoraB.resolver();
    expect(await botonDeClase(/Editar la clase Intermedio/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EDITAR_C1 })).not.toBeInTheDocument();
  });
});
