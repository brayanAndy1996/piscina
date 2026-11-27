import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error, mostrar, rutaActual, sesionDe, simularApi } from '../../pruebas-api';
import { Rutas } from '../../rutas/Rutas';
import { carnetDePrueba, ID_ALUMNO } from '../carnet/pruebas-carnet';

// Spec 010b, criterios 31 y 32: `/panel/mensualidades` (estados, filtros, totales aparte, aviso de `hayMas`, enlace a cada alumno, solo con
// `REGISTRAR_INSCRIPCION_Y_COBRO`, claves con la identidad de la sesión) y el estado de la mensualidad en la ficha del alumno con «No usó N
// clases». La API se simula: la web no calcula estados, solo los muestra.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f71';
const PLAN3 = 'b1111111-1111-4111-8111-111111111111';
const PLAN2 = 'b2222222-2222-4222-8222-222222222222';
const C_LUN = 'c1111111-1111-4111-8111-111111111111';
const C_MIE = 'c2222222-2222-4222-8222-222222222222';
const A1 = 'a1111111-1111-4111-8111-111111111111';
const A2 = 'a2222222-2222-4222-8222-222222222222';
const A3 = 'a3333333-3333-4333-8333-333333333333';
// 27/11/2026 10:00 en Lima: noviembre es el mes en curso.
const AHORA = new Date('2026-11-27T15:00:00.000Z');

const RUTA_LISTADO = 'GET /api/mensualidades?mes=2026-11';
const RUTA_OFERTA = `GET /api/alumnos/${ID_ALUMNO}/renovacion`;
const RUTA_ESTADO = `GET /api/mensualidades?nivel=BASICO&planId=${PLAN3}`;
const RUTA_ASISTENCIA_OCT = `GET /api/alumnos/${ID_ALUMNO}/asistencias?mes=2026-10`;

const CLASES_BASICO = [
  { id: C_LUN, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' },
  { id: C_MIE, diaSemana: 3, horaInicio: '18:00', horaFin: '19:00' },
];

function fila(
  alumnoId: string,
  apellidos: string,
  estado: string,
  extra: Record<string, unknown> = {},
  mensualidad: Record<string, unknown> = {},
) {
  return {
    alumnoId,
    nombres: 'Lucía',
    apellidos,
    nivel: 'BASICO',
    estado,
    mensualidad: {
      mes: '2026-11',
      plan: { id: PLAN3, nombre: 'Plan 3 veces' },
      clases: CLASES_BASICO,
      clasesUsadas: 4,
      clasesTotales: 12,
      ...mensualidad,
    },
    siguiente: null,
    ...extra,
  };
}

const FILAS = [
  fila(A1, 'Prado Quispe', 'AL_DIA'),
  fila(
    A2,
    'Rojas Díaz',
    'VENCIDO',
    {},
    { mes: '2026-10', plan: { id: PLAN2, nombre: 'Plan 2 veces' }, clases: [CLASES_BASICO[0]], clasesTotales: 8 },
  ),
  fila(A3, 'Soto Vega', 'POR_VENCER', {
    nivel: 'INTERMEDIO',
    siguiente: { mes: '2026-12', estado: 'EN_VERIFICACION' },
  }),
];

function listado(extra: Record<string, unknown> = {}) {
  return {
    mes: '2026-11',
    hoy: '2026-11-27',
    totales: { AL_DIA: 1, POR_VENCER: 1, VENCIDO: 1, PENDIENTE_VERIFICACION: 0 },
    alumnos: FILAS,
    hayMas: false,
    ...extra,
  };
}

function servidor(
  rol: 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO' = 'SECRETARIA',
  rutas: Parameters<typeof simularApi>[0] = {},
) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol, { id: ID_YO }) }),
    'GET /api/mi-academia': () => ({
      estado: 200,
      cuerpo: { academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null } },
    }),
    [RUTA_LISTADO]: () => ({ estado: 200, cuerpo: listado() }),
    ...rutas,
  });
}

function pedidas(api: ReturnType<typeof simularApi>): string[] {
  return api.mock.calls.map(([url, opciones]) => `${opciones?.method ?? 'GET'} ${url}`);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/panel/mensualidades: listado (criterio 32)', () => {
  it.each(['ADMIN', 'SECRETARIA'] as const)(
    'el rol %s ve cada alumno con su estado, su plan, sus clases y el enlace a su ficha',
    async (rol) => {
      const api = servidor(rol);
      mostrar('/panel/mensualidades');
      expect(await screen.findByRole('heading', { level: 1, name: 'Mensualidades' })).toBeInTheDocument();
      const lista = await screen.findByRole('list', { name: 'Alumnos' });
      const filas = within(lista).getAllByRole('listitem');
      expect(filas).toHaveLength(3);

      const primera = within(filas[0] as HTMLElement);
      expect(primera.getByText('Prado Quispe, Lucía')).toBeInTheDocument();
      expect(primera.getByText('Al día')).toBeInTheDocument();
      expect(primera.getByText(/Plan 3 veces/)).toBeInTheDocument();
      expect(primera.getByText(/Mensualidad de noviembre de 2026 · Usó 4 de 12 clases/)).toBeInTheDocument();
      expect(primera.getByText('Lunes 18:00 a 19:00 · Miércoles 18:00 a 19:00')).toBeInTheDocument();
      expect(primera.getByRole('link')).toHaveAttribute('href', `/panel/alumnos/${A1}`);

      // El vencido muestra la mensualidad del mes anterior, tal como la da la API.
      const segunda = within(filas[1] as HTMLElement);
      expect(segunda.getByText('Vencido')).toBeInTheDocument();
      expect(segunda.getByText(/Mensualidad de octubre de 2026 · Usó 4 de 8 clases/)).toBeInTheDocument();

      const tercera = within(filas[2] as HTMLElement);
      expect(tercera.getByText('Por vencer')).toBeInTheDocument();
      expect(tercera.getByText(/Nivel Intermedio/)).toBeInTheDocument();
      expect(tercera.getByText('Mes siguiente, diciembre de 2026: pago por verificar')).toBeInTheDocument();

      // Sin DNI ni datos de la academia en la dirección: solo el mes.
      expect(pedidas(api).filter((p) => p.startsWith('GET /api/mensualidades'))).toEqual([RUTA_LISTADO]);
      expect(screen.getByRole('status')).toHaveTextContent('Mensualidades de noviembre de 2026. Hoy es 27/11/2026.');
    },
  );

  it('muestra los totales por estado que da la API, también el de pendientes de verificación', async () => {
    servidor('ADMIN', {
      [RUTA_LISTADO]: () => ({
        estado: 200,
        cuerpo: listado({ totales: { AL_DIA: 7, POR_VENCER: 3, VENCIDO: 2, PENDIENTE_VERIFICACION: 5 } }),
      }),
    });
    mostrar('/panel/mensualidades');
    // Los totales son una lista de definiciones: cada estado con su cantidad.
    const grupo = await screen.findByLabelText('Totales por estado');
    const texto = grupo.textContent ?? '';
    expect(texto).toContain('Al día7');
    expect(texto).toContain('Por vencer3');
    expect(texto).toContain('Vencido2');
    expect(texto).toContain('Pendiente de verificación5');
  });

  it.each(['ENTRENADOR', 'ALUMNO'] as const)('el rol %s no tiene esta página y no pide el listado', async (rol) => {
    const api = servidor(rol);
    mostrar('/panel/mensualidades');
    expect(await screen.findByRole('heading', { name: 'No tienes permiso para ver esta página' })).toBeInTheDocument();
    expect(pedidas(api).filter((p) => p.startsWith('GET /api/mensualidades'))).toEqual([]);
  });

  it('avisa cuando hay más filas de las que se muestran (hayMas)', async () => {
    servidor('SECRETARIA', { [RUTA_LISTADO]: () => ({ estado: 200, cuerpo: listado({ hayMas: true }) }) });
    mostrar('/panel/mensualidades');
    expect(await screen.findByText(/Hay más de 500 alumnos con estos filtros/)).toBeInTheDocument();
  });

  it('sin hayMas no muestra el aviso', async () => {
    servidor();
    mostrar('/panel/mensualidades');
    await screen.findByRole('list', { name: 'Alumnos' });
    expect(screen.queryByText(/Hay más de 500 alumnos/)).not.toBeInTheDocument();
  });

  it('sin alumnos lo dice', async () => {
    servidor('SECRETARIA', {
      [RUTA_LISTADO]: () => ({
        estado: 200,
        cuerpo: listado({
          alumnos: [],
          totales: { AL_DIA: 0, POR_VENCER: 0, VENCIDO: 0, PENDIENTE_VERIFICACION: 0 },
        }),
      }),
    });
    mostrar('/panel/mensualidades');
    expect(await screen.findByText('No hay mensualidades en este mes.')).toBeInTheDocument();
  });

  it('filtra por estado, plan, nivel y horario con los parámetros de la API y quita los filtros', async () => {
    const api = servidor('SECRETARIA', {
      'GET /api/mensualidades?mes=2026-11&estado=VENCIDO': () => ({
        estado: 200,
        cuerpo: listado({
          alumnos: [FILAS[1]],
          totales: { AL_DIA: 1, POR_VENCER: 1, VENCIDO: 1, PENDIENTE_VERIFICACION: 0 },
        }),
      }),
      [`GET /api/mensualidades?mes=2026-11&estado=VENCIDO&planId=${PLAN2}`]: () => ({
        estado: 200,
        cuerpo: listado({ alumnos: [FILAS[1]] }),
      }),
      [`GET /api/mensualidades?mes=2026-11&estado=VENCIDO&planId=${PLAN2}&nivel=BASICO`]: () => ({
        estado: 200,
        cuerpo: listado({ alumnos: [FILAS[1]] }),
      }),
      [`GET /api/mensualidades?mes=2026-11&estado=VENCIDO&planId=${PLAN2}&nivel=BASICO&claseId=${C_LUN}`]: () => ({
        estado: 200,
        cuerpo: listado({ alumnos: [FILAS[1]] }),
      }),
    });
    const usuario = userEvent.setup();
    mostrar('/panel/mensualidades');
    await screen.findByRole('list', { name: 'Alumnos' });

    await usuario.selectOptions(screen.getByLabelText('Estado'), 'VENCIDO');
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Alumnos' })).getAllByRole('listitem')).toHaveLength(1),
    );
    // Los totales de la respuesta siguen siendo los de todos los estados (la API los cuenta sin el filtro de estado).
    expect(screen.getByLabelText('Totales por estado').textContent).toContain('Al día1');

    // Las opciones de plan y de horario salen del listado del mes sin filtros.
    const planes = within(screen.getByLabelText('Plan'));
    expect(planes.getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos', 'Plan 2 veces', 'Plan 3 veces']);
    await usuario.selectOptions(screen.getByLabelText('Plan'), 'Plan 2 veces');
    await usuario.selectOptions(screen.getByLabelText('Nivel'), 'Básico');
    const horarios = within(screen.getByLabelText('Horario'));
    expect(horarios.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Todos',
      'Lunes 18:00 a 19:00',
      'Miércoles 18:00 a 19:00',
    ]);
    await usuario.selectOptions(screen.getByLabelText('Horario'), 'Lunes 18:00 a 19:00');

    await waitFor(() =>
      expect(pedidas(api)).toContain(
        `GET /api/mensualidades?mes=2026-11&estado=VENCIDO&planId=${PLAN2}&nivel=BASICO&claseId=${C_LUN}`,
      ),
    );

    await usuario.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Alumnos' })).getAllByRole('listitem')).toHaveLength(3),
    );
    expect(screen.getByLabelText('Estado')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Quitar filtros' })).not.toBeInTheDocument();
  });

  it('al elegir otro mes pide ese mes y limpia el plan y el horario', async () => {
    const api = servidor('ADMIN', {
      'GET /api/mensualidades?mes=2026-10': () => ({
        estado: 200,
        cuerpo: listado({ mes: '2026-10', hoy: '2026-11-27', alumnos: [FILAS[0]] }),
      }),
    });
    const usuario = userEvent.setup();
    mostrar('/panel/mensualidades');
    await screen.findByRole('list', { name: 'Alumnos' });
    const meses = within(screen.getByLabelText('Mes')).getAllByRole('option');
    expect(meses).toHaveLength(12);
    expect(meses[0]).toHaveTextContent('noviembre de 2026');
    expect(meses[1]).toHaveTextContent('octubre de 2026');
    expect(meses[11]).toHaveTextContent('diciembre de 2025');

    await usuario.selectOptions(screen.getByLabelText('Plan'), 'Plan 3 veces');
    await usuario.selectOptions(screen.getByLabelText('Mes'), 'octubre de 2026');
    await waitFor(() => expect(pedidas(api)).toContain('GET /api/mensualidades?mes=2026-10'));
    expect(screen.getByLabelText('Plan')).toHaveValue('');
    expect(await screen.findByText(/Mensualidades de octubre de 2026/)).toBeInTheDocument();
  });

  it('si el listado falla lo dice y deja volver a intentar', async () => {
    let intentos = 0;
    servidor('SECRETARIA', {
      [RUTA_LISTADO]: () => {
        intentos += 1;
        return intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: listado() };
      },
    });
    const usuario = userEvent.setup();
    mostrar('/panel/mensualidades');
    expect(await screen.findByText(/No se pudo cargar el listado/)).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Volver a intentar' }));
    expect(await screen.findByRole('list', { name: 'Alumnos' })).toBeInTheDocument();
  });

  it('las claves de las consultas llevan la academia y el usuario de la sesión', async () => {
    servidor();
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={['/panel/mensualidades']}>
          <Rutas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('list', { name: 'Alumnos' });
    const claves = cliente
      .getQueryCache()
      .findAll({ queryKey: ['mensualidades'] })
      .map((consulta) => consulta.queryKey);
    expect(claves.length).toBeGreaterThan(0);
    for (const clave of claves) expect(clave.slice(0, 3)).toEqual(['mensualidades', 'delfines', ID_YO]);
  });

  it('cada fila lleva a la ficha del alumno', async () => {
    servidor('SECRETARIA', {
      [`GET /api/alumnos/${A1}/carnet`]: () => ({ estado: 200, cuerpo: carnetDePrueba() }),
    });
    const usuario = userEvent.setup();
    mostrar('/panel/mensualidades');
    await usuario.click(await screen.findByRole('link', { name: /Prado Quispe, Lucía/ }));
    expect(rutaActual()).toBe(`/panel/alumnos/${A1}`);
  });
});

describe('inicio del panel: opción «Mensualidades»', () => {
  it.each(['ADMIN', 'SECRETARIA'] as const)('el rol %s la ve y lleva a /panel/mensualidades', async (rol) => {
    servidor(rol);
    mostrar('/panel');
    const enlace = await screen.findByRole('link', { name: /^Mensualidades/ });
    expect(enlace).toHaveAttribute('href', '/panel/mensualidades');
  });

  it.each(['ENTRENADOR', 'ALUMNO'] as const)('el rol %s no la ve', async (rol) => {
    servidor(rol);
    mostrar('/panel');
    await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' });
    expect(screen.queryByRole('link', { name: /^Mensualidades/ })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// La ficha del alumno: el estado de la mensualidad (criterio 31)
// ---------------------------------------------------------------------------------------------------------------------------------

function oferta(extra: Record<string, unknown> = {}) {
  return {
    alumno: {
      id: ID_ALUMNO,
      nombres: 'Lucía Fernanda',
      apellidos: 'Prado Quispe',
      nivel: 'BASICO',
      estado: 'ALUMNO_ACTIVO',
    },
    mesesPermitidos: ['2026-12'],
    mes: '2026-12',
    ventana: { desde: '2026-11-26', hasta: '2026-11-30' },
    mensualidadActual: { mes: '2026-11', plan: { id: PLAN3, nombre: 'Plan 3 veces' }, clases: CLASES_BASICO },
    planes: [],
    clases: [],
    ...extra,
  };
}

function servidorDeFicha(rutas: Parameters<typeof simularApi>[0] = {}, ofertaActual = oferta()) {
  return servidor('SECRETARIA', {
    [`GET /api/alumnos/${ID_ALUMNO}/carnet`]: () => ({ estado: 200, cuerpo: carnetDePrueba() }),
    [RUTA_OFERTA]: () => ({ estado: 200, cuerpo: ofertaActual }),
    [RUTA_ESTADO]: () => ({
      estado: 200,
      cuerpo: listado({ alumnos: [fila(ID_ALUMNO, 'Prado Quispe', 'POR_VENCER', { siguiente: null })] }),
    }),
    [RUTA_ASISTENCIA_OCT]: () => ({ estado: 200, cuerpo: { mes: '2026-10', matricula: null, registros: [] } }),
    ...rutas,
  });
}

const seccion = () => screen.findByRole('region', { name: 'Mensualidad' });

describe('/panel/alumnos/{id}: estado de la mensualidad (criterio 31)', () => {
  it('muestra el estado que da la API, la mensualidad del mes y cuántas clases usó', async () => {
    const api = servidorDeFicha();
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(await within(region).findByText('Por vencer')).toBeInTheDocument();
    expect(within(region).getByText('Estado de la mensualidad')).toBeInTheDocument();
    expect(within(region).getByText(/Mensualidad de noviembre de 2026 · Usó 4 de 12 clases\./)).toBeInTheDocument();
    // El listado se acota con el nivel y el plan del alumno; la web no calcula el estado.
    expect(pedidas(api)).toContain(RUTA_ESTADO);
  });

  it.each([
    ['AL_DIA', 'Al día'],
    ['VENCIDO', 'Vencido'],
    ['PENDIENTE_VERIFICACION', 'Pendiente de verificación'],
  ])('el estado %s se muestra como «%s»', async (estado, texto) => {
    servidorDeFicha({
      [RUTA_ESTADO]: () => ({
        estado: 200,
        cuerpo: listado({ alumnos: [fila(ID_ALUMNO, 'Prado Quispe', estado)] }),
      }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    const bloque = (await within(region).findByText('Estado de la mensualidad')).parentElement as HTMLElement;
    expect(await within(bloque).findByText(texto)).toBeInTheDocument();
  });

  it('un vencido muestra su última mensualidad y el mes siguiente por verificar', async () => {
    servidorDeFicha(
      {
        ['GET /api/mensualidades?nivel=BASICO']: () => ({
          estado: 200,
          cuerpo: listado({
            alumnos: [
              fila(
                ID_ALUMNO,
                'Prado Quispe',
                'VENCIDO',
                { siguiente: { mes: '2026-12', estado: 'EN_VERIFICACION' } },
                { mes: '2026-10', clasesUsadas: 12 },
              ),
            ],
          }),
        }),
      },
      oferta({ mensualidadActual: null }),
    );
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(await within(region).findByText(/Su última mensualidad fue la de octubre de 2026/)).toBeInTheDocument();
    expect(within(region).getByText(/Mes siguiente, diciembre de 2026: con el pago por verificar/)).toBeInTheDocument();
  });

  it('con clases sin usar del último mes cerrado dice «No usó N clases»', async () => {
    servidorDeFicha({
      [RUTA_ASISTENCIA_OCT]: () => ({
        estado: 200,
        cuerpo: {
          mes: '2026-10',
          matricula: { clasesTotales: 12, clasesUsadas: 9, clasesRestantes: 3 },
          registros: [],
        },
      }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(await within(region).findByText(/No usó 3 clases en octubre de 2026/)).toBeInTheDocument();
  });

  it('con una sola clase sin usar lo dice en singular', async () => {
    servidorDeFicha({
      [RUTA_ASISTENCIA_OCT]: () => ({
        estado: 200,
        cuerpo: {
          mes: '2026-10',
          matricula: { clasesTotales: 12, clasesUsadas: 11, clasesRestantes: 1 },
          registros: [],
        },
      }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    expect(await within(await seccion()).findByText(/No usó 1 clase en octubre de 2026/)).toBeInTheDocument();
  });

  it('si usó todas sus clases, o no tuvo mensualidad, no dice «No usó»', async () => {
    servidorDeFicha({
      [RUTA_ASISTENCIA_OCT]: () => ({
        estado: 200,
        cuerpo: {
          mes: '2026-10',
          matricula: { clasesTotales: 12, clasesUsadas: 12, clasesRestantes: 0 },
          registros: [],
        },
      }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    await within(region).findByText('Por vencer');
    expect(within(region).queryByText(/No usó/)).not.toBeInTheDocument();
  });

  it('sin fila en el listado dice que no tiene mensualidad reciente', async () => {
    servidorDeFicha({ [RUTA_ESTADO]: () => ({ estado: 200, cuerpo: listado({ alumnos: [] }) }) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    expect(
      await within(await seccion()).findByText(
        /Sin mensualidad pagada ni por verificar en noviembre de 2026 ni en octubre de 2026/,
      ),
    ).toBeInTheDocument();
  });

  it('con hayMas y sin su fila no inventa un estado', async () => {
    servidorDeFicha({ [RUTA_ESTADO]: () => ({ estado: 200, cuerpo: listado({ alumnos: [], hayMas: true }) }) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    expect(
      await within(await seccion()).findByText(/No pudimos determinar el estado de la mensualidad/),
    ).toBeInTheDocument();
  });

  it('un alumno inactivo no pide el listado', async () => {
    const api = servidorDeFicha(
      {},
      oferta({ alumno: { ...oferta().alumno, estado: 'INACTIVO' }, mesesPermitidos: [] }),
    );
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    expect(
      await within(await seccion()).findByText(/El alumno está inactivo: no tiene estado de mensualidad/),
    ).toBeInTheDocument();
    expect(pedidas(api).filter((p) => p.startsWith('GET /api/mensualidades'))).toEqual([]);
  });

  it('si el estado no se puede consultar lo dice y el resto de la sección sigue', async () => {
    servidorDeFicha({ [RUTA_ESTADO]: () => error('ERROR_INTERNO', 500) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(await within(region).findByText('No pudimos consultar el estado de la mensualidad.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Renovar' })).toBeEnabled();
  });
});
