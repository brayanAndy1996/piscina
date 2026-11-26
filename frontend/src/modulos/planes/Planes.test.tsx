import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  error,
  llamadas,
  type Manejador,
  mostrar,
  type Respuesta,
  rutaActual,
  sesionDe,
  simularApi,
} from '../../pruebas-api';

// Spec 004, criterios 26, 27 y 29: el menú y el permiso, la página de planes, el formulario con los esquemas compartidos y las
// lecciones de la 003 (clave con la identidad de la sesión, base de llenado, campos desactivados al guardar, error de un GET en
// segundo plano). La API se simula; los criterios de la API los prueba el backend.

const ID_A = 'a1111111-1111-4111-8111-111111111111';
const ID_B = 'a2222222-2222-4222-8222-222222222222';
const ID_C = 'a3333333-3333-4333-8333-333333333333';
const ID_D = 'a4444444-4444-4444-8444-444444444444';

const TODAS = [
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
];

function plan(extra: Record<string, unknown> = {}) {
  return {
    id: ID_A,
    nombre: '3 veces por semana',
    vecesPorSemana: 3,
    clasesPorMes: 12,
    duracionMinutos: 60,
    precio: '120.00',
    diasPermitidos: [1, 3, 5],
    franjasPermitidas: TODAS,
    nivelesAplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
    vigenciaInicio: null as string | null,
    vigenciaFin: null as string | null,
    activo: true,
    estado: 'VIGENTE',
    ...extra,
  };
}

const PLAN_A = plan();
const PLAN_B = plan({
  id: ID_B,
  nombre: 'Plan verano',
  vecesPorSemana: 2,
  clasesPorMes: 8,
  precio: '1250.50',
  diasPermitidos: [2, 4],
  franjasPermitidas: ['17:00', '18:00'],
  nivelesAplicables: ['BASICO'],
  vigenciaInicio: '2027-01-01',
  vigenciaFin: '2027-03-31',
  estado: 'PROGRAMADO',
});
const PLAN_C = plan({
  id: ID_C,
  nombre: 'Plan antiguo',
  vecesPorSemana: 1,
  clasesPorMes: 4,
  precio: '60.00',
  diasPermitidos: [6],
  franjasPermitidas: ['09:00'],
  nivelesAplicables: ['AVANZADO'],
  vigenciaFin: '2026-06-30',
  estado: 'VENCIDO',
});
const PLAN_D = plan({ id: ID_D, nombre: 'Plan pausado', activo: false, estado: 'INACTIVO' });

const MI_ACADEMIA = {
  academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null },
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

type Plan = ReturnType<typeof plan>;

/** Un servidor de planes con estado, como la API: el `POST` agrega y el `PATCH` mezcla y responde con todo el plan. */
function servidor(inicial: Plan[] = [PLAN_A, PLAN_B, PLAN_C, PLAN_D], extra: Record<string, Manejador> = {}) {
  const estado = { planes: inicial };
  const api = simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    'GET /api/planes': () => ({ estado: 200, cuerpo: { planes: estado.planes } }),
    'POST /api/planes': (cuerpo) => {
      const nuevo = plan({
        id: 'a5555555-5555-4555-8555-555555555555',
        duracionMinutos: 60,
        vigenciaInicio: null,
        vigenciaFin: null,
        ...(cuerpo as object),
        precio: normalizar((cuerpo as { precio: string }).precio),
      });
      estado.planes = [...estado.planes, nuevo];
      return { estado: 201, cuerpo: { plan: nuevo } };
    },
    [`PATCH /api/planes/${ID_A}`]: (cuerpo) => {
      const cambios = cuerpo as Record<string, unknown>;
      const nuevo = {
        ...PLAN_A,
        ...estado.planes.find((p) => p.id === ID_A),
        ...cambios,
        ...(typeof cambios['precio'] === 'string' ? { precio: normalizar(cambios['precio']) } : {}),
      };
      estado.planes = estado.planes.map((p) => (p.id === ID_A ? nuevo : p));
      return { estado: 200, cuerpo: { plan: nuevo } };
    },
    ...extra,
  });
  return { api, estado };
}

/** El texto del precio con dos decimales, como lo devuelve la API (solo para la API simulada de la prueba). */
function normalizar(texto: string): string {
  const [entera = '0', decimales = ''] = texto.split('.');
  return `${entera}.${decimales.padEnd(2, '0')}`;
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

async function abrirEdicion(nombre: string) {
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole('button', { name: `Editar el plan ${nombre}` }));
  const dialogo = await screen.findByRole('dialog', { name: 'Editar plan' });
  return { usuario, dialogo };
}

describe('menú y permiso (criterio 26)', () => {
  it('el administrador ve "Planes" y "Clases y horarios" en el inicio y llega a /panel/planes', async () => {
    servidor();
    mostrar('/panel');
    const planes = await screen.findByRole('link', { name: /Planes/ });
    expect(planes).toHaveAttribute('href', '/panel/planes');
    expect(screen.getByRole('link', { name: /Clases y horarios/ })).toHaveAttribute('href', '/panel/clases');
    await userEvent.setup().click(planes);
    expect(await screen.findByRole('heading', { level: 1, name: 'Planes' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/panel/planes');
  });

  it('las opciones del menú tienen su propia clave: ninguna desaparece ni se duplica', async () => {
    servidor();
    mostrar('/panel');
    await screen.findByRole('link', { name: /Planes/ });
    const enlaces = within(screen.getByRole('navigation', { name: 'Opciones' })).getAllByRole('link');
    expect(enlaces.map((enlace) => enlace.getAttribute('href'))).toEqual([
      '/panel/solicitudes',
      '/panel/pagos',
      '/panel/alumnos',
      '/panel/asistencia',
      '/a/delfines/inscripcion',
      '/panel/caja',
      '/panel/cajas',
      '/panel/usuarios',
      '/panel/restablecer',
      '/panel/configuracion',
      '/panel/planes',
      '/panel/clases',
    ]);
  });

  it.each(['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const)('el rol %s no ve las opciones en el menú', async (rol) => {
    simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
    mostrar('/panel');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Planes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Clases y horarios/ })).not.toBeInTheDocument();
  });

  it.each(['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const)(
    'el rol %s que abre /panel/planes ve "sin permiso" y no se piden los planes',
    async (rol) => {
      const api = simularApi({ 'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }) });
      mostrar('/panel/planes');
      expect(await screen.findByText('No tienes permiso para ver esta página')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Nuevo plan' })).not.toBeInTheDocument();
      expect(llamadas(api, 'GET /api/planes')).toHaveLength(0);
    },
  );
});

describe('lista de planes (criterio 27)', () => {
  it('muestra cada plan con su precio en soles, veces por semana, clases por mes y estado', async () => {
    servidor();
    mostrar('/panel/planes');
    const tarjetas = await screen.findAllByRole('listitem');
    expect(tarjetas).toHaveLength(4);

    const a = within(tarjetas[0] as HTMLElement);
    expect(a.getByRole('heading', { level: 2, name: '3 veces por semana' })).toBeInTheDocument();
    expect(a.getByText('Vigente')).toBeInTheDocument();
    expect(a.getByText('S/ 120.00')).toBeInTheDocument();
    expect(a.getByText(/3 veces por semana · 12 clases al mes · 60 min/)).toBeInTheDocument();
    expect(a.getByText('Días: Lunes, Miércoles, Viernes')).toBeInTheDocument();
    expect(a.getByText('Franjas: Todas las franjas (08:00 a 20:00)')).toBeInTheDocument();
    expect(a.getByText('Niveles: Básico, Intermedio, Avanzado')).toBeInTheDocument();
    expect(a.getByText('Sin fechas de vigencia')).toBeInTheDocument();

    const nombres = tarjetas.map((t) => within(t).getByRole('heading', { level: 2 }).textContent);
    expect(nombres).toEqual(['3 veces por semana', 'Plan verano', 'Plan antiguo', 'Plan pausado']);

    const verano = within(tarjetas[1] as HTMLElement);
    expect(verano.getByText('Programado')).toBeInTheDocument();
    expect(verano.getByText('S/ 1,250.50')).toBeInTheDocument();
    expect(verano.getByText('Franjas: 17:00 a 18:00, 18:00 a 19:00')).toBeInTheDocument();
    expect(verano.getByText('Del 01/01/2027 al 31/03/2027')).toBeInTheDocument();

    const antiguo = within(tarjetas[2] as HTMLElement);
    expect(antiguo.getByText('Vencido')).toBeInTheDocument();
    expect(antiguo.getByText('1 vez por semana · 4 clases al mes · 60 min')).toBeInTheDocument();
    expect(antiguo.getByText('Hasta el 30/06/2026')).toBeInTheDocument();

    expect(within(tarjetas[3] as HTMLElement).getByText('Inactivo')).toBeInTheDocument();
  });

  it('explica que el precio ya incluye IGV y que un cambio vale para inscripciones y renovaciones nuevas', async () => {
    servidor();
    mostrar('/panel/planes');
    await screen.findByRole('heading', { level: 1, name: 'Planes' });
    expect(
      screen.getByText(
        /Los precios ya incluyen IGV\. Un cambio de precio vale solo para las inscripciones y renovaciones nuevas/,
      ),
    ).toBeInTheDocument();
  });

  it('sin planes, invita a crear el primero', async () => {
    servidor([]);
    mostrar('/panel/planes');
    expect(await screen.findByText(/Todavía no hay planes/)).toBeInTheDocument();
  });

  it('si no se pueden cargar, lo dice y permite reintentar', async () => {
    let intento = 0;
    servidor([PLAN_A], {
      'GET /api/planes': () => (++intento === 1 ? error('ERROR', 500) : { estado: 200, cuerpo: { planes: [PLAN_A] } }),
    });
    mostrar('/panel/planes');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los planes.');
    expect(screen.queryByRole('button', { name: 'Nuevo plan' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { level: 2, name: '3 veces por semana' })).toBeInTheDocument();
  });

  it('no muestra la lista de la caché hasta tener la respuesta pedida al entrar', async () => {
    servidor();
    const usuario = userEvent.setup();
    mostrar('/panel/planes');
    await screen.findByRole('heading', { level: 2, name: 'Plan verano' });
    await usuario.click(screen.getByRole('link', { name: /Volver al inicio/ }));

    const demora = diferido();
    simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }),
      'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
      'GET /api/planes': async () => {
        await demora.promesa;
        return { estado: 200, cuerpo: { planes: [PLAN_B] } };
      },
    });
    await usuario.click(await screen.findByRole('link', { name: /Planes/ }));
    expect(await screen.findByText('Cargando planes…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: '3 veces por semana' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo plan' })).not.toBeInTheDocument();
    demora.resolver();
    expect(await screen.findByRole('heading', { level: 2, name: 'Plan verano' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: '3 veces por semana' })).not.toBeInTheDocument();
  });
});

describe('nuevo plan (criterios 10 y 27)', () => {
  async function abrirNuevo() {
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Nuevo plan' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo plan' });
    return { usuario, dialogo };
  }

  async function llenarValido(usuario: ReturnType<typeof userEvent.setup>) {
    await usuario.type(screen.getByLabelText('Nombre del plan'), '  Plan de prueba ');
    await usuario.type(screen.getByLabelText('Veces por semana'), '2');
    await usuario.type(screen.getByLabelText('Clases por mes'), '8');
    await usuario.type(screen.getByLabelText('Precio (S/)'), '90.5');
    await usuario.click(screen.getByLabelText('Jueves'));
    await usuario.click(screen.getByLabelText('Martes'));
    await usuario.click(screen.getByRole('button', { name: /Marcar todo en Franjas permitidas/ }));
    await usuario.click(screen.getByLabelText('Intermedio'));
    await usuario.click(screen.getByLabelText('Básico'));
  }

  it('empieza vacío, con la duración en 60, la ayuda del precio con IGV y sin la casilla "activo"', async () => {
    servidor();
    mostrar('/panel/planes');
    await abrirNuevo();
    expect(screen.getByLabelText('Nombre del plan')).toHaveValue('');
    expect(screen.getByLabelText('Duración (minutos)')).toHaveValue('60');
    expect(screen.getByLabelText('Precio (S/)')).toHaveAccessibleDescription(/con IGV incluido/);
    expect(screen.queryByLabelText('Plan activo')).not.toBeInTheDocument();
    for (const dia of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) {
      expect(screen.getByLabelText(dia)).not.toBeChecked();
    }
    expect(screen.getByLabelText('08:00 a 09:00')).toBeInTheDocument();
    expect(screen.getByLabelText('19:00 a 20:00')).toBeInTheDocument();
  });

  it('valida con los esquemas compartidos y muestra el error junto a cada campo sin enviar nada', async () => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirNuevo();
    await usuario.click(screen.getByRole('button', { name: 'Crear plan' }));

    expect(await screen.findByText('Elige al menos un día.')).toBeInTheDocument();
    expect(screen.getByText('Elige al menos una franja.')).toBeInTheDocument();
    expect(screen.getByText('Elige al menos un nivel.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre del plan')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Veces por semana')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Clases por mes')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Precio (S/)')).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(api, 'POST /api/planes')).toHaveLength(0);
  });

  it.each([
    ['0', 'El monto debe ser mayor que 0.'],
    ['120.505', /El monto debe tener hasta dos decimales/],
    ['120,50', /El monto debe tener hasta dos decimales/],
    ['1e2', /El monto debe tener hasta dos decimales/],
    ['100000', /El monto debe tener hasta dos decimales/],
  ])('el precio %s no se envía', async (texto, mensaje) => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirNuevo();
    await llenarValido(usuario);
    const precio = screen.getByLabelText('Precio (S/)');
    await usuario.clear(precio);
    await usuario.type(precio, texto);
    await usuario.click(screen.getByRole('button', { name: 'Crear plan' }));
    expect(await screen.findByText(mensaje)).toBeInTheDocument();
    expect(precio).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(api, 'POST /api/planes')).toHaveLength(0);
  });

  it('elegir menos días que veces por semana se rechaza junto a los días', async () => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirNuevo();
    await llenarValido(usuario);
    await usuario.click(screen.getByLabelText('Jueves'));
    await usuario.click(screen.getByRole('button', { name: 'Crear plan' }));
    expect(
      await screen.findByText('Elige al menos tantos días como veces por semana tiene el plan.'),
    ).toBeInTheDocument();
    expect(llamadas(api, 'POST /api/planes')).toHaveLength(0);
  });

  it('una fecha de fin anterior a la de inicio se rechaza junto a la fecha de fin', async () => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirNuevo();
    await llenarValido(usuario);
    fireEvent.change(screen.getByLabelText('Vigente desde (opcional)'), { target: { value: '2027-02-01' } });
    fireEvent.change(screen.getByLabelText('Vigente hasta (opcional)'), { target: { value: '2027-01-31' } });
    await usuario.click(screen.getByRole('button', { name: 'Crear plan' }));
    expect(await screen.findByText('La fecha de fin no puede ser anterior a la de inicio.')).toBeInTheDocument();
    expect(screen.getByLabelText('Vigente hasta (opcional)')).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(api, 'POST /api/planes')).toHaveLength(0);
  });

  it('crea el plan con el precio como texto, los días ordenados y sin fechas, y lo muestra en la lista', async () => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirNuevo();
    await llenarValido(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Crear plan' }));

    expect(await screen.findByText('Plan «Plan de prueba» creado.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const [cuerpo] = llamadas(api, 'POST /api/planes') as Record<string, unknown>[];
    expect(cuerpo).toEqual({
      nombre: 'Plan de prueba',
      vecesPorSemana: 2,
      clasesPorMes: 8,
      duracionMinutos: 60,
      precio: '90.5',
      diasPermitidos: [2, 4],
      franjasPermitidas: TODAS,
      nivelesAplicables: ['BASICO', 'INTERMEDIO'],
    });
    expect(typeof cuerpo?.['precio']).toBe('string');
    expect(await screen.findByRole('heading', { level: 2, name: 'Plan de prueba' })).toBeInTheDocument();
    expect(screen.getByText('S/ 90.50')).toBeInTheDocument();
    // Un plan nuevo en la lista queda en su lugar por nombre, sin volver a pedir la lista.
    expect(llamadas(api, 'GET /api/planes')).toHaveLength(1);
  });

  it('con las fechas de vigencia, las envía', async () => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirNuevo();
    await llenarValido(usuario);
    fireEvent.change(screen.getByLabelText('Vigente desde (opcional)'), { target: { value: '2027-01-01' } });
    fireEvent.change(screen.getByLabelText('Vigente hasta (opcional)'), { target: { value: '2027-03-31' } });
    await usuario.click(screen.getByRole('button', { name: 'Crear plan' }));
    await screen.findByText('Plan «Plan de prueba» creado.');
    expect(llamadas(api, 'POST /api/planes')[0]).toMatchObject({
      vigenciaInicio: '2027-01-01',
      vigenciaFin: '2027-03-31',
    });
  });

  it('un nombre repetido (409) se muestra junto al nombre y no cierra el formulario', async () => {
    servidor([PLAN_A], { 'POST /api/planes': () => error('NOMBRE_PLAN_EN_USO', 409) });
    mostrar('/panel/planes');
    const { usuario } = await abrirNuevo();
    await llenarValido(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Crear plan' }));
    const mensaje = await screen.findByText(/Ya hay un plan con ese nombre en tu academia/);
    const nombre = screen.getByLabelText('Nombre del plan');
    expect(nombre).toHaveAttribute('aria-invalid', 'true');
    expect(nombre.getAttribute('aria-describedby')).toContain(mensaje.id);
    expect(screen.getByRole('dialog', { name: 'Nuevo plan' })).toBeInTheDocument();
    // Lo escrito sigue ahí y los demás campos no se marcan.
    expect(nombre).toHaveValue('  Plan de prueba ');
    expect(screen.getByLabelText('Precio (S/)')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Plan «Plan de prueba» creado.')).not.toBeInTheDocument();
  });

  it('los errores 400 de la API se muestran junto a su campo, también el de una posición de la lista', async () => {
    servidor([PLAN_A], {
      'POST /api/planes': () =>
        error('SOLICITUD_INVALIDA', 400, {
          errores: [
            { campo: 'precio', mensaje: 'Mensaje de la API para el precio.' },
            { campo: 'diasPermitidos.1', mensaje: 'Mensaje de la API para los días.' },
          ],
        }),
    });
    mostrar('/panel/planes');
    const { usuario } = await abrirNuevo();
    await llenarValido(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Crear plan' }));
    expect(await screen.findByText('Mensaje de la API para el precio.')).toBeInTheDocument();
    expect(screen.getByText('Mensaje de la API para los días.')).toBeInTheDocument();
    expect(screen.getByLabelText('Precio (S/)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('un error sin campo se muestra dentro del formulario y no pierde lo escrito', async () => {
    servidor([PLAN_A], { 'POST /api/planes': () => error('SIN_PERMISO', 403) });
    mostrar('/panel/planes');
    const { usuario, dialogo } = await abrirNuevo();
    await llenarValido(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Crear plan' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Mensaje de SIN_PERMISO');
    expect(screen.getByLabelText('Precio (S/)')).toHaveValue('90.5');
  });

  it('"Cancelar" cierra sin enviar nada', async () => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirNuevo();
    await usuario.type(screen.getByLabelText('Nombre del plan'), 'Algo');
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(llamadas(api, 'POST /api/planes')).toHaveLength(0);
  });
});

describe('editar un plan (criterios 12, 13 y 27)', () => {
  it('se llena con el plan: el precio con dos decimales, los días y las franjas marcados, y la casilla "activo"', async () => {
    servidor();
    mostrar('/panel/planes');
    await abrirEdicion('Plan verano');
    expect(screen.getByLabelText('Nombre del plan')).toHaveValue('Plan verano');
    expect(screen.getByLabelText('Veces por semana')).toHaveValue('2');
    expect(screen.getByLabelText('Clases por mes')).toHaveValue('8');
    expect(screen.getByLabelText('Precio (S/)')).toHaveValue('1250.50');
    expect(screen.getByLabelText('Martes')).toBeChecked();
    expect(screen.getByLabelText('Jueves')).toBeChecked();
    expect(screen.getByLabelText('Lunes')).not.toBeChecked();
    expect(screen.getByLabelText('17:00 a 18:00')).toBeChecked();
    expect(screen.getByLabelText('19:00 a 20:00')).not.toBeChecked();
    expect(screen.getByLabelText('Básico')).toBeChecked();
    expect(screen.getByLabelText('Avanzado')).not.toBeChecked();
    expect(screen.getByLabelText('Vigente desde (opcional)')).toHaveValue('2027-01-01');
    expect(screen.getByLabelText('Vigente hasta (opcional)')).toHaveValue('2027-03-31');
    expect(screen.getByLabelText('Plan activo')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('guarda solo lo que cambió y deja lo que devolvió la API', async () => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    const precio = screen.getByLabelText('Precio (S/)');
    await usuario.clear(precio);
    await usuario.type(precio, '130.5');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Plan guardado.')).toBeInTheDocument();
    const [cuerpo] = llamadas(api, `PATCH /api/planes/${ID_A}`);
    expect(cuerpo).toEqual({ precio: '130.5' });
    expect(typeof (cuerpo as Record<string, unknown>)['precio']).toBe('string');
    expect(screen.getByLabelText('Precio (S/)')).toHaveValue('130.50');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    // La lista de detrás ya muestra el precio nuevo.
    expect(within(screen.getAllByRole('listitem')[0] as HTMLElement).getByText('S/ 130.50')).toBeInTheDocument();
  });

  it('escribir "120" donde estaba "120.00" no es un cambio', async () => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    const precio = screen.getByLabelText('Precio (S/)');
    await usuario.clear(precio);
    await usuario.type(precio, '120');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(llamadas(api, `PATCH /api/planes/${ID_A}`)).toHaveLength(0);
  });

  it('desactivar y reactivar un plan envía solo "activo"', async () => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    await usuario.click(screen.getByLabelText('Plan activo'));
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Plan guardado.');
    expect(llamadas(api, `PATCH /api/planes/${ID_A}`)).toEqual([{ activo: false }]);
    await usuario.click(screen.getByLabelText('Plan activo'));
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(llamadas(api, `PATCH /api/planes/${ID_A}`)).toHaveLength(2));
    expect(llamadas(api, `PATCH /api/planes/${ID_A}`)[1]).toEqual({ activo: true });
  });

  it('quitar una fecha de vigencia envía null', async () => {
    const { api } = servidor([{ ...PLAN_A, vigenciaInicio: '2027-01-01', vigenciaFin: '2027-03-31' }]);
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    fireEvent.change(screen.getByLabelText('Vigente hasta (opcional)'), { target: { value: '' } });
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Plan guardado.');
    expect(llamadas(api, `PATCH /api/planes/${ID_A}`)).toEqual([{ vigenciaFin: null }]);
  });

  it('subir las veces por semana sin sumar días se rechaza con lo guardado, junto a los días', async () => {
    const { api } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    const veces = screen.getByLabelText('Veces por semana');
    await usuario.clear(veces);
    await usuario.type(veces, '4');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await screen.findByText('Elige al menos tantos días como veces por semana tiene el plan.'),
    ).toBeInTheDocument();
    expect(llamadas(api, `PATCH /api/planes/${ID_A}`)).toHaveLength(0);
  });

  it('un nombre repetido (409) al renombrar se muestra junto al nombre', async () => {
    servidor(undefined, { [`PATCH /api/planes/${ID_A}`]: () => error('NOMBRE_PLAN_EN_USO', 409) });
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    const nombre = screen.getByLabelText('Nombre del plan');
    await usuario.clear(nombre);
    await usuario.type(nombre, 'Plan verano');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText(/Ya hay un plan con ese nombre en tu academia/)).toBeInTheDocument();
    expect(nombre).toHaveAttribute('aria-invalid', 'true');
    expect(nombre).toHaveValue('Plan verano');
  });

  it('un plan que ya no existe (404) se avisa dentro del formulario', async () => {
    servidor(undefined, { [`PATCH /api/planes/${ID_A}`]: () => error('NO_ENCONTRADO', 404) });
    mostrar('/panel/planes');
    const { usuario, dialogo } = await abrirEdicion('3 veces por semana');
    await usuario.click(screen.getByLabelText('Plan activo'));
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Mensaje de NO_ENCONTRADO');
  });
});

describe('el formulario con la base de llenado (criterios 27 y 29)', () => {
  const AVISO =
    'Otro administrador cambió este plan mientras editabas. Actualizamos los campos que no tocaste; revisa los tuyos antes de guardar.';

  it('sin ediciones, un plan cambiado por otro administrador recarga el formulario y Guardar sigue desactivado', async () => {
    const { api, estado } = servidor();
    mostrar('/panel/planes');
    await abrirEdicion('3 veces por semana');
    estado.planes = [{ ...PLAN_A, precio: '99.00', clasesPorMes: 10 }, PLAN_B, PLAN_C, PLAN_D];
    reconectar();
    await waitFor(() => expect(screen.getByLabelText('Precio (S/)')).toHaveValue('99.00'));
    expect(screen.getByLabelText('Clases por mes')).toHaveValue('10');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(llamadas(api, `PATCH /api/planes/${ID_A}`)).toHaveLength(0);
  });

  it('con ediciones, actualiza lo que no se tocó, conserva lo editado, avisa y envía solo lo editado', async () => {
    const { api, estado } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    const veces = screen.getByLabelText('Clases por mes');
    await usuario.clear(veces);
    await usuario.type(veces, '16');
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();

    // El otro administrador cambia el precio y también las clases por mes (que este ya estaba editando).
    estado.planes = [
      { ...PLAN_A, precio: '99.00', clasesPorMes: 10, diasPermitidos: [1, 2, 3] },
      PLAN_B,
      PLAN_C,
      PLAN_D,
    ];
    reconectar();
    await waitFor(() => expect(screen.getByLabelText('Precio (S/)')).toHaveValue('99.00'));
    expect(screen.getByLabelText('Clases por mes')).toHaveValue('16');
    expect(screen.getByLabelText('Martes')).toBeChecked();
    expect(screen.getByLabelText('Viernes')).not.toBeChecked();
    expect(screen.getByText(AVISO)).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Plan guardado.');
    expect(llamadas(api, `PATCH /api/planes/${ID_A}`)).toEqual([{ clasesPorMes: 16 }]);
    // La respuesta del PATCH es la nueva base: el aviso se va y Guardar vuelve a quedar desactivado.
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('si el administrador deshace sus ediciones, el aviso se va', async () => {
    const { estado } = servidor();
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    const clases = screen.getByLabelText('Clases por mes');
    await usuario.clear(clases);
    await usuario.type(clases, '16');
    estado.planes = [{ ...PLAN_A, precio: '99.00' }, PLAN_B, PLAN_C, PLAN_D];
    reconectar();
    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    await usuario.clear(clases);
    await usuario.type(clases, '12');
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('un GET pedido antes de la respuesta del PATCH no deshace lo guardado', async () => {
    let actual: Plan = PLAN_A;
    let patch: ReturnType<typeof diferido> | null = null;
    let get: ReturnType<typeof diferido> | null = null;
    let retenerGet = false;
    const api = simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe('ADMIN') }),
      'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
      'GET /api/planes': async () => {
        const foto = actual;
        if (retenerGet) {
          get = diferido();
          await get.promesa;
        }
        return { estado: 200, cuerpo: { planes: [foto] } };
      },
      [`PATCH /api/planes/${ID_A}`]: async (cuerpo) => {
        patch = diferido();
        await patch.promesa;
        actual = { ...actual, ...(cuerpo as object) };
        return { estado: 200, cuerpo: { plan: actual } };
      },
    });
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    const clases = screen.getByLabelText('Clases por mes');
    await usuario.clear(clases);
    await usuario.type(clases, '16');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(patch).not.toBeNull());

    // Una reconexión pide la lista mientras el PATCH está en curso; ese GET leyó los valores de antes de guardar.
    retenerGet = true;
    reconectar();
    await waitFor(() => expect(get).not.toBeNull());
    await act(async () => {
      patch?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    expect(await screen.findByText('Plan guardado.')).toBeInTheDocument();
    await act(async () => {
      get?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    expect(screen.getByLabelText('Clases por mes')).toHaveValue('16');
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(screen.getByText('Plan guardado.')).toBeInTheDocument();

    // Lo siguiente se compara con la respuesta del PATCH: solo viaja el campo editado.
    retenerGet = false;
    const precio = screen.getByLabelText('Precio (S/)');
    await usuario.clear(precio);
    await usuario.type(precio, '99');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(llamadas(api, `PATCH /api/planes/${ID_A}`)).toHaveLength(2));
    expect(llamadas(api, `PATCH /api/planes/${ID_A}`)).toEqual([{ clasesPorMes: 16 }, { precio: '99' }]);
    (patch as ReturnType<typeof diferido> | null)?.resolver();
    await screen.findByText('Plan guardado.');
  });

  it('un error del GET en segundo plano deja el formulario con lo escrito y no lo cierra', async () => {
    let falla = false;
    const { api } = servidor(undefined, {
      'GET /api/planes': () =>
        falla ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: { planes: [PLAN_A, PLAN_B] } },
    });
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    const precio = screen.getByLabelText('Precio (S/)');
    await usuario.clear(precio);
    await usuario.type(precio, '140');

    falla = true;
    reconectar();
    expect(await screen.findByText(/No pudimos comprobar si los planes cambiaron/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Editar plan' })).toBeInTheDocument();
    expect(screen.getByLabelText('Precio (S/)')).toHaveValue('140');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();

    // Y lo escrito se guarda tal cual.
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Plan guardado.');
    expect(llamadas(api, `PATCH /api/planes/${ID_A}`)).toEqual([{ precio: '140' }]);
  });

  it('mientras se guarda, los campos y los botones quedan desactivados y no se puede cerrar', async () => {
    let patch: ReturnType<typeof diferido> | null = null;
    servidor(undefined, {
      [`PATCH /api/planes/${ID_A}`]: async (cuerpo) => {
        patch = diferido();
        await patch.promesa;
        return { estado: 200, cuerpo: { plan: { ...PLAN_A, ...(cuerpo as object) } } };
      },
    });
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    await usuario.type(screen.getByLabelText('Nombre del plan'), ' extra');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(patch).not.toBeNull());

    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled();
    for (const etiqueta of ['Nombre del plan', 'Precio (S/)', 'Lunes', '08:00 a 09:00', 'Básico', 'Plan activo']) {
      expect(screen.getByLabelText(etiqueta)).toBeDisabled();
    }
    expect(
      screen.getByRole('button', { name: /Marcar todo en Franjas permitidas|Quitar todo en Franjas permitidas/ }),
    ).toBeDisabled();
    // Escape no cierra el formulario mientras se guarda.
    await usuario.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Editar plan' })).toBeInTheDocument();

    await act(async () => {
      patch?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    await screen.findByText('Plan guardado.');
    expect(screen.getByLabelText('Nombre del plan')).toBeEnabled();
    expect(screen.getByLabelText('Nombre del plan')).toHaveValue('3 veces por semana extra');
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeEnabled();
  });

  it('si el PATCH falla, todo vuelve a activarse con lo escrito y el error junto a su campo', async () => {
    let patch: ReturnType<typeof diferido> | null = null;
    servidor(undefined, {
      [`PATCH /api/planes/${ID_A}`]: async () => {
        patch = diferido();
        await patch.promesa;
        return error('SOLICITUD_INVALIDA', 400, {
          errores: [{ campo: 'precio', mensaje: 'Mensaje de la API para el precio.' }],
        });
      },
    });
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    const precio = screen.getByLabelText('Precio (S/)');
    await usuario.clear(precio);
    await usuario.type(precio, '130');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(patch).not.toBeNull());
    expect(screen.getByLabelText('Precio (S/)')).toBeDisabled();
    await act(async () => {
      patch?.resolver();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    expect(await screen.findByText('Mensaje de la API para el precio.')).toBeInTheDocument();
    expect(screen.getByLabelText('Precio (S/)')).toBeEnabled();
    expect(screen.getByLabelText('Precio (S/)')).toHaveValue('130');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

  it('el formulario se desbloquea apenas responde el PATCH aunque la lista nunca se vuelva a pedir', async () => {
    let lecturas = 0;
    servidor(undefined, {
      'GET /api/planes': () => {
        lecturas += 1;
        return lecturas === 1 ? { estado: 200, cuerpo: { planes: [PLAN_A] } } : new Promise<Respuesta>(() => undefined);
      },
      [`PATCH /api/planes/${ID_A}`]: (cuerpo) => ({
        estado: 200,
        cuerpo: { plan: { ...PLAN_A, ...(cuerpo as object) } },
      }),
    });
    mostrar('/panel/planes');
    const { usuario } = await abrirEdicion('3 veces por semana');
    await usuario.type(screen.getByLabelText('Nombre del plan'), ' extra');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Plan guardado.');
    await esperar(300);
    expect(screen.getByLabelText('Nombre del plan')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Guardando…' })).not.toBeInTheDocument();
  });
});

describe('las consultas llevan la identidad de la sesión (criterios 28 de 003 y 29 de 004)', () => {
  const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
  const ID_BRUNO = '7c8d9e0f-1a2b-4b3c-8d4e-6f708192a3b4';
  const PLAN_DE_B = plan({ id: ID_D, nombre: 'Plan exclusivo de Tiburones' });
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

  it('al cambiar la sesión a otra academia, la página nunca muestra los planes de la anterior, ni mientras carga los de la nueva', async () => {
    let enB = false;
    const demoraB = diferido();
    simularApi({
      'GET /api/sesion': () => ({ estado: 200, cuerpo: enB ? sesionDeB : sesionDe('ADMIN', { id: ID_YO }) }),
      'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
      'GET /api/planes': async () => {
        if (!enB) return { estado: 200, cuerpo: { planes: [PLAN_A] } };
        await demoraB.promesa;
        return { estado: 200, cuerpo: { planes: [PLAN_DE_B] } };
      },
    });
    const usuario = userEvent.setup();
    mostrar('/panel/planes');
    await screen.findByRole('heading', { level: 2, name: '3 veces por semana' });

    // Se entró en otra academia en otra pestaña y esta recupera el foco: vuelve al inicio con la identidad nueva.
    enB = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(rutaActual()).toBe('/panel'));
    await usuario.click(await screen.findByRole('link', { name: /Planes/ }));
    expect(await screen.findByText('Cargando planes…')).toBeInTheDocument();
    await esperar(200);
    expect(screen.queryByText('3 veces por semana')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo plan' })).not.toBeInTheDocument();

    demoraB.resolver();
    expect(await screen.findByRole('heading', { level: 2, name: 'Plan exclusivo de Tiburones' })).toBeInTheDocument();
    expect(screen.queryByText('3 veces por semana')).not.toBeInTheDocument();
  });
});
