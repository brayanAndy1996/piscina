import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archivoDePrueba,
  error,
  llamadas,
  type Manejador,
  mostrar,
  peticiones,
  sesionDe,
  simularApi,
  simularUrlLocal,
} from '../../pruebas-api';
import { Rutas } from '../../rutas/Rutas';
import { carnetDePrueba, ID_ALUMNO } from '../carnet/pruebas-carnet';

// Spec 010a, criterio 20: la sección «Mensualidad» de `/panel/alumnos/{id}` y el diálogo «Renovar» (mes, plan y clases con sus cupos y la marca
// «Su horario», cotización, efectivo con el aviso de la caja, comprobante de Yape o transferencia, los 409 con sus textos y una clave de
// idempotencia por diálogo abierto). La API se simula; el monto siempre sale de ella.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RUTA_CARNET = `GET /api/alumnos/${ID_ALUMNO}/carnet`;
const RUTA_OFERTA = `GET /api/alumnos/${ID_ALUMNO}/renovacion`;
const RUTA_OFERTA_DIC = `GET /api/alumnos/${ID_ALUMNO}/renovacion?mes=2026-12`;
const RUTA_OFERTA_NOV = `GET /api/alumnos/${ID_ALUMNO}/renovacion?mes=2026-11`;
const RUTA_COTIZACION = `POST /api/alumnos/${ID_ALUMNO}/renovacion/cotizacion`;
const RUTA_EFECTIVO = `POST /api/alumnos/${ID_ALUMNO}/renovacion/efectivo`;
const RUTA_COMPROBANTE = `PUT /api/alumnos/${ID_ALUMNO}/renovacion/comprobante`;

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f71';
const PLAN3 = 'b1111111-1111-4111-8111-111111111111';
const PLAN2 = 'b2222222-2222-4222-8222-222222222222';
const C_LUN = 'c1111111-1111-4111-8111-111111111111';
const C_MIE = 'c2222222-2222-4222-8222-222222222222';
const C_VIE = 'c3333333-3333-4333-8333-333333333333';
const C_MAR = 'c4444444-4444-4444-8444-444444444444';
const C_MIE_19 = 'c5555555-5555-4555-8555-555555555555';
const MATRICULA = 'd1111111-1111-4111-8111-111111111111';
const PAGO = 'f1111111-1111-4111-8111-111111111111';
const ID_CAJA = 'c0000000-0000-4000-8000-000000000001';
// 26/11/2026 10:00 en Lima: la ventana de renovación (del 26 al 30) ya está abierta.
const AHORA = new Date('2026-11-26T15:00:00.000Z');

const HORARIO = { horaFin: '19:00', nivel: 'BASICO' } as const;
const CLASES_DEL_MES = [
  { id: C_LUN, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' },
  { id: C_MIE, diaSemana: 3, horaInicio: '18:00', horaFin: '19:00' },
  { id: C_VIE, diaSemana: 5, horaInicio: '18:00', horaFin: '19:00' },
];

function plan(id: string, nombre: string, veces: number, porMes: number, precio: string, dias: number[]) {
  return {
    id,
    nombre,
    vecesPorSemana: veces,
    clasesPorMes: porMes,
    duracionMinutos: 60,
    precio,
    diasPermitidos: dias,
    franjasPermitidas: ['18:00', '19:00'],
    nivelesAplicables: ['BASICO'],
  };
}

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
    mensualidadActual: { mes: '2026-11', plan: { id: PLAN3, nombre: 'Plan 3 veces' }, clases: CLASES_DEL_MES },
    planes: [
      plan(PLAN2, 'Plan 2 veces', 2, 8, '90.00', [1, 2, 3, 4, 5]),
      plan(PLAN3, 'Plan 3 veces', 3, 12, '120.00', [1, 2, 3, 4, 5]),
    ],
    clases: [
      { id: C_LUN, ...HORARIO, diaSemana: 1, horaInicio: '18:00', cuposRestantes: 1, conPrioridad: true },
      { id: C_MAR, ...HORARIO, diaSemana: 2, horaInicio: '18:00', cuposRestantes: 5, conPrioridad: false },
      { id: C_MIE, ...HORARIO, diaSemana: 3, horaInicio: '18:00', cuposRestantes: 3, conPrioridad: true },
      {
        id: C_MIE_19,
        ...HORARIO,
        diaSemana: 3,
        horaInicio: '19:00',
        horaFin: '20:00',
        cuposRestantes: 0,
        conPrioridad: false,
      },
      { id: C_VIE, ...HORARIO, diaSemana: 5, horaInicio: '18:00', cuposRestantes: 12, conPrioridad: true },
    ],
    ...extra,
  };
}

function cotizacion(extra: Record<string, unknown> = {}) {
  return {
    cotizacion: {
      mes: '2026-12',
      fechaInicio: '2026-12-01',
      fechaFin: '2026-12-31',
      clasesRestantes: 13,
      clasesTotales: 12,
      clasesPorMes: 12,
      precioPlan: '120.00',
      monto: '120.00',
      esProporcional: false,
      ...extra,
    },
  };
}

function pago(extra: Record<string, unknown> = {}) {
  return {
    id: PAGO,
    estado: 'CONFIRMADO',
    metodo: 'EFECTIVO',
    concepto: 'MENSUALIDAD',
    monto: '120.00',
    registradoEn: '2026-11-26T15:00:00.000Z',
    verificadoEn: '2026-11-26T15:00:00.000Z',
    numeroOperacion: null,
    fechaOperacion: null,
    motivoRechazo: null,
    numeroTicket: 9,
    ...extra,
  };
}

function respuestaRenovacion(
  extra: { renovacion?: Record<string, unknown>; pago?: Record<string, unknown>; repetida?: boolean } = {},
) {
  return {
    renovacion: {
      matriculaId: MATRICULA,
      mes: '2026-12',
      estado: 'VIGENTE',
      plan: { id: PLAN3, nombre: 'Plan 3 veces' },
      clases: CLASES_DEL_MES,
      fechaInicio: '2026-12-01',
      fechaFin: '2026-12-31',
      clasesTotales: 12,
      total: '120.00',
      conPrioridad: [C_LUN, C_MIE, C_VIE],
      ...extra.renovacion,
    },
    pago: pago(extra.pago),
    repetida: extra.repetida ?? false,
  };
}

function caja(extra: Record<string, unknown> = {}) {
  const cero = '0.00';
  return {
    id: ID_CAJA,
    fecha: '2026-11-26',
    estado: 'ABIERTA',
    deOtroDia: false,
    montoInicial: '100.00',
    abiertaPor: { id: ID_YO, nombres: 'Rosa', apellidos: 'Quispe Mamani' },
    abiertaEn: '2026-11-26T13:00:00.000Z',
    resumen: {
      ingresos: { efectivo: cero, yape: cero, transferencia: cero },
      egresos: { efectivo: cero },
      esperado: { efectivo: '100.00', yape: cero, transferencia: cero },
      ultimoMovimiento: 0,
    },
    movimientos: [],
    cierres: [],
    ...extra,
  };
}

const MI_ACADEMIA = {
  academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null },
};

interface Opciones {
  rol?: 'ADMIN' | 'SECRETARIA';
  oferta?: Record<string, unknown>;
  caja?: unknown;
  extra?: Record<string, Manejador>;
}

/** Un servidor con el carnet, la oferta (sin mes y con diciembre), la cotización de 120.00 y la caja de hoy abierta. */
function servidor({
  rol = 'SECRETARIA',
  oferta: ofertaActual = oferta(),
  caja: cajaActual = caja(),
  extra = {},
}: Opciones = {}) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol, { id: ID_YO }) }),
    'GET /api/mi-academia': () => ({ estado: 200, cuerpo: MI_ACADEMIA }),
    [RUTA_CARNET]: () => ({ estado: 200, cuerpo: carnetDePrueba() }),
    [`GET /api/alumnos/${ID_ALUMNO}/asistencias?mes=2026-11`]: () => ({
      estado: 200,
      cuerpo: { mes: '2026-11', matricula: null, registros: [] },
    }),
    [RUTA_OFERTA]: () => ({ estado: 200, cuerpo: ofertaActual }),
    [RUTA_OFERTA_DIC]: () => ({ estado: 200, cuerpo: ofertaActual }),
    [RUTA_COTIZACION]: () => ({ estado: 200, cuerpo: cotizacion() }),
    'GET /api/cajas/actual': () => ({ estado: 200, cuerpo: { caja: cajaActual } }),
    ...extra,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  simularUrlLocal();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

const seccion = () => screen.findByRole('region', { name: 'Mensualidad' });

async function abrirDialogo() {
  const usuario = userEvent.setup();
  await usuario.click(await within(await seccion()).findByRole('button', { name: 'Renovar' }));
  const dialogo = await screen.findByRole('dialog', { name: 'Renovar la mensualidad' });
  return { usuario, dialogo };
}

/** Espera a que el diálogo muestre la cotización y la caja ya revisada. */
async function esperarCotizacion(dialogo: HTMLElement, total = 'S/ 120.00') {
  const cotizada = await within(dialogo).findByRole('region', { name: 'Cotización' });
  await within(cotizada).findByText(total, { selector: 'span' });
}

describe('/panel/alumnos/{id}: sección «Mensualidad» (criterio 20)', () => {
  it.each(['ADMIN', 'SECRETARIA'] as const)(
    'el rol %s ve el estado, la mensualidad del mes, los meses por renovar y la ventana',
    async (rol) => {
      const api = servidor({ rol });
      mostrar(`/panel/alumnos/${ID_ALUMNO}`);
      const region = await seccion();
      expect(await within(region).findByText('Activo')).toBeInTheDocument();
      expect(within(region).getByText('Mes en curso: noviembre de 2026')).toBeInTheDocument();
      expect(within(region).getByText(/Mensualidad de noviembre de 2026/)).toBeInTheDocument();
      expect(within(region).getByText('Plan 3 veces')).toBeInTheDocument();
      const clases = within(region).getByRole('list', { name: 'Clases de la mensualidad' });
      expect(
        within(clases)
          .getAllByRole('listitem')
          .map((fila) => fila.textContent),
      ).toEqual(['Lunes 18:00 a 19:00', 'Miércoles 18:00 a 19:00', 'Viernes 18:00 a 19:00']);
      expect(within(region).getByText('Se puede renovar: diciembre de 2026.')).toBeInTheDocument();
      expect(within(region).getByText(/abierta del 26\/11\/2026 al 30\/11\/2026/)).toBeInTheDocument();
      expect(within(region).getByRole('button', { name: 'Renovar' })).toBeEnabled();
      // La oferta se pide sin mes (la API decide) y sin ningún dato de la academia en la dirección.
      expect(llamadas(api, RUTA_OFERTA)).toHaveLength(1);
    },
  );

  it('sin mensualidad en el mes en curso lo dice y deja renovar el mes permitido', async () => {
    servidor({ oferta: oferta({ mensualidadActual: null }) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(await within(region).findByText('No tiene mensualidad en noviembre de 2026.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Renovar' })).toBeEnabled();
  });

  it('antes de la ventana avisa cuándo se abre y no ofrece el mes siguiente', async () => {
    servidor({
      oferta: oferta({
        mesesPermitidos: [],
        mes: '2026-11',
        ventana: { desde: '2026-11-27', hasta: '2026-11-30' },
        planes: [],
        clases: [],
      }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(await within(region).findByText(/se abre el 27\/11\/2026/)).toBeInTheDocument();
    expect(within(region).getByText(/No hay meses por renovar/)).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Renovar' })).toBeDisabled();
  });

  it('un alumno inactivo no se renueva', async () => {
    const base = oferta();
    servidor({ oferta: oferta({ alumno: { ...base.alumno, estado: 'INACTIVO' } }) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(await within(region).findByText('El alumno está inactivo y no puede renovar.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Renovar' })).toBeDisabled();
  });

  it('si la oferta no carga, muestra el error con su reintento', async () => {
    servidor({ extra: { [RUTA_OFERTA]: () => error('ERROR_INTERNO', 500) } });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(await within(region).findByText(/No pudimos cargar la mensualidad/)).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Volver a intentar' })).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Renovar' })).not.toBeInTheDocument();
  });
});

describe('las consultas de la renovación llevan la identidad de la sesión (criterio 20)', () => {
  it('la oferta y la cotización se guardan con la academia y la persona de la sesión', async () => {
    servidor();
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={[`/panel/alumnos/${ID_ALUMNO}`]}>
          <Rutas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const usuario = userEvent.setup();
    await usuario.click(await within(await seccion()).findByRole('button', { name: 'Renovar' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Renovar la mensualidad' });
    await esperarCotizacion(dialogo);
    const claves = cliente
      .getQueryCache()
      .findAll({ queryKey: ['mensualidades'] })
      .map((consulta) => consulta.queryKey);
    expect(claves.length).toBeGreaterThanOrEqual(3);
    for (const clave of claves) expect(clave.slice(0, 3)).toEqual(['mensualidades', 'delfines', ID_YO]);
  });
});

describe('diálogo «Renovar»: mes, plan, clases y cotización (criterio 20)', () => {
  it('abre con el mes siguiente, el aviso de la ventana, el plan y las clases del alumno con «Su horario» y sus cupos', async () => {
    const api = servidor();
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { dialogo } = await abrirDialogo();
    await esperarCotizacion(dialogo);
    expect(within(dialogo).getByLabelText('Mes a renovar')).toHaveValue('2026-12');
    expect(within(dialogo).getByText(/Estás renovando diciembre de 2026, el mes siguiente/)).toBeInTheDocument();
    expect(within(dialogo).getByRole('radio', { name: /Plan 3 veces/ })).toBeChecked();
    expect(within(dialogo).getByRole('radio', { name: /Plan 2 veces/ })).not.toBeChecked();
    const lunes = within(dialogo).getByRole('group', { name: 'Lunes' });
    expect(within(lunes).getByRole('checkbox', { name: /18:00 a 19:00/ })).toBeChecked();
    expect(within(lunes).getByText('1 cupo')).toBeInTheDocument();
    expect(within(lunes).getByText('Su horario')).toBeInTheDocument();
    const martes = within(dialogo).getByRole('group', { name: 'Martes' });
    expect(within(martes).getByText('5 cupos')).toBeInTheDocument();
    expect(within(martes).queryByText('Su horario')).not.toBeInTheDocument();
    // Una clase sin cupo aparece como llena y no se puede elegir.
    const miercoles = within(dialogo).getByRole('group', { name: 'Miércoles' });
    const llena = within(miercoles).getByRole('checkbox', { name: /19:00 a 20:00/ });
    expect(llena).toBeDisabled();
    expect(within(miercoles).getByText('Llena')).toBeInTheDocument();
    expect(within(dialogo).getByText('Elegiste 3 de 3.')).toBeInTheDocument();
    // La web no calcula el monto: lo pide a la API con el mes, el plan y las clases.
    expect(llamadas(api, RUTA_COTIZACION)).toEqual([
      { mes: '2026-12', planId: PLAN3, claseIds: [C_LUN, C_MIE, C_VIE] },
    ]);
    expect(within(dialogo).getByRole('button', { name: 'Cobrar S/ 120.00' })).toBeEnabled();
  });

  it('cambiar de plan borra las clases y la cotización se vuelve a pedir con la elección nueva', async () => {
    const api = servidor({
      extra: {
        [RUTA_COTIZACION]: (cuerpo) => {
          const { planId } = cuerpo as { planId: string };
          return {
            estado: 200,
            cuerpo:
              planId === PLAN2
                ? cotizacion({ clasesTotales: 8, clasesPorMes: 8, precioPlan: '90.00', monto: '90.00' })
                : cotizacion(),
          };
        },
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await esperarCotizacion(dialogo);
    await usuario.click(within(dialogo).getByRole('radio', { name: /Plan 2 veces/ }));
    expect(within(dialogo).getByText('Elegiste 0 de 2.')).toBeInTheDocument();
    expect(within(dialogo).queryByRole('region', { name: 'Cotización' })).not.toBeInTheDocument();
    await usuario.click(within(within(dialogo).getByRole('group', { name: 'Martes' })).getByRole('checkbox'));
    await usuario.click(within(within(dialogo).getByRole('group', { name: 'Viernes' })).getByRole('checkbox'));
    await esperarCotizacion(dialogo, 'S/ 90.00');
    expect(llamadas(api, RUTA_COTIZACION).at(-1)).toEqual({ mes: '2026-12', planId: PLAN2, claseIds: [C_MAR, C_VIE] });
    expect(within(dialogo).getByRole('button', { name: 'Cobrar S/ 90.00' })).toBeInTheDocument();
  });

  it('con dos meses permitidos, elegir el mes en curso pide su oferta y muestra el monto proporcional de la API', async () => {
    const api = servidor({
      oferta: oferta({ mesesPermitidos: ['2026-11', '2026-12'] }),
      extra: {
        [RUTA_OFERTA_NOV]: () => ({
          estado: 200,
          cuerpo: oferta({ mesesPermitidos: ['2026-11', '2026-12'], mes: '2026-11', mensualidadActual: null }),
        }),
        [RUTA_COTIZACION]: (cuerpo) => {
          const { mes } = cuerpo as { mes: string };
          return {
            estado: 200,
            cuerpo:
              mes === '2026-11'
                ? cotizacion({
                    mes: '2026-11',
                    fechaInicio: '2026-11-26',
                    fechaFin: '2026-11-30',
                    clasesRestantes: 2,
                    clasesTotales: 2,
                    monto: '20.00',
                    esProporcional: true,
                  })
                : cotizacion(),
          };
        },
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await esperarCotizacion(dialogo);
    await usuario.selectOptions(within(dialogo).getByLabelText('Mes a renovar'), '2026-11');
    // El mes en curso no lleva el aviso del mes siguiente, y sin mensualidad actual no hay plan ni clases elegidos de antemano.
    await waitFor(() => expect(llamadas(api, RUTA_OFERTA_NOV)).toHaveLength(1));
    await waitFor(() => expect(within(dialogo).queryByText(/Cargando los planes/)).not.toBeInTheDocument());
    expect(within(dialogo).queryByText(/el mes siguiente/)).not.toBeInTheDocument();
    expect(within(dialogo).getByRole('radio', { name: /Plan 3 veces/ })).not.toBeChecked();
    await usuario.click(within(dialogo).getByRole('radio', { name: /Plan 3 veces/ }));
    await usuario.click(within(within(dialogo).getByRole('group', { name: 'Lunes' })).getByRole('checkbox'));
    await usuario.click(
      within(within(dialogo).getByRole('group', { name: 'Miércoles' })).getByRole('checkbox', {
        name: /18:00 a 19:00/,
      }),
    );
    await usuario.click(within(within(dialogo).getByRole('group', { name: 'Viernes' })).getByRole('checkbox'));
    await esperarCotizacion(dialogo, 'S/ 20.00');
    expect(
      within(dialogo).getByText(/Monto proporcional: 2 de 12 clases del mes \(precio del plan S\/ 120\.00\)/),
    ).toBeInTheDocument();
    expect(within(dialogo).getByText(/del 26\/11\/2026 al 30\/11\/2026/)).toBeInTheDocument();
  });

  it('si la cotización falla (409 SIN_CLASES_EN_EL_MES) lo explica y no deja cobrar', async () => {
    servidor({ extra: { [RUTA_COTIZACION]: () => error('SIN_CLASES_EN_EL_MES', 409) } });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { dialogo } = await abrirDialogo();
    expect(await within(dialogo).findByText(/Ya no quedan clases este mes/)).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Cobrar' })).toBeDisabled();
  });
});

describe('diálogo «Renovar»: efectivo (criterio 20)', () => {
  async function abrirYCobrar() {
    const resultado = await abrirDialogo();
    await esperarCotizacion(resultado.dialogo);
    const cobrar = await within(resultado.dialogo).findByRole('button', { name: 'Cobrar S/ 120.00' });
    await waitFor(() => expect(cobrar).toBeEnabled());
    return { ...resultado, cobrar };
  }

  it('cobra una sola vez con el total mostrado y la clave del diálogo, y ofrece imprimir el ticket', async () => {
    const api = servidor({
      extra: { [RUTA_EFECTIVO]: () => ({ estado: 201, cuerpo: respuestaRenovacion() }) },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, cobrar } = await abrirYCobrar();
    await usuario.dblClick(cobrar);
    const resultado = await screen.findByRole('dialog', { name: 'Renovación registrada' });
    expect(
      within(resultado).getByText(/Se cobró S\/ 120\.00 en efectivo a Lucía Fernanda Prado Quispe\. Ticket N\.º 9\./),
    ).toBeInTheDocument();
    expect(within(resultado).getByText('diciembre de 2026')).toBeInTheDocument();
    expect(
      within(resultado).getByText('Lunes 18:00 a 19:00 · Miércoles 18:00 a 19:00 · Viernes 18:00 a 19:00'),
    ).toBeInTheDocument();
    expect(within(resultado).getByRole('link', { name: 'Imprimir ticket' })).toHaveAttribute(
      'href',
      `/panel/pagos/${PAGO}/ticket`,
    );
    const cuerpos = llamadas(api, RUTA_EFECTIVO) as Record<string, unknown>[];
    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0]).toEqual({
      claveIdempotencia: expect.stringMatching(UUID) as unknown,
      mes: '2026-12',
      planId: PLAN3,
      claseIds: [C_LUN, C_MIE, C_VIE],
      montoMostrado: '120.00',
    });
  });

  it('un 200 repetido avisa que ya estaba registrada y no se cobró otra vez', async () => {
    servidor({ extra: { [RUTA_EFECTIVO]: () => ({ estado: 200, cuerpo: respuestaRenovacion({ repetida: true }) }) } });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, cobrar } = await abrirYCobrar();
    await usuario.click(cobrar);
    const resultado = await screen.findByRole('dialog', { name: 'Renovación registrada' });
    expect(
      within(resultado).getByText(/ya estaba registrada con la misma clave: no se cobró otra vez/),
    ).toBeInTheDocument();
  });

  it('sin la caja de hoy avisa «Abre la caja antes de cobrar» y no deja cobrar', async () => {
    const api = servidor({ caja: null });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { dialogo } = await abrirDialogo();
    await esperarCotizacion(dialogo);
    expect(await within(dialogo).findByText('Abre la caja antes de cobrar.')).toBeInTheDocument();
    expect(within(dialogo).getByRole('link', { name: 'Ir a la caja' })).toHaveAttribute('href', '/panel/caja');
    expect(within(dialogo).getByRole('button', { name: 'Cobrar S/ 120.00' })).toBeDisabled();
    expect(llamadas(api, RUTA_EFECTIVO)).toHaveLength(0);
  });

  it('con la caja de otro día dice de qué día es y no deja cobrar', async () => {
    servidor({ caja: caja({ fecha: '2026-11-25', deOtroDia: true }) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { dialogo } = await abrirDialogo();
    await esperarCotizacion(dialogo);
    expect(await within(dialogo).findByText(/La caja abierta es del 25\/11\/2026/)).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Cobrar S/ 120.00' })).toBeDisabled();
  });

  it('un 409 MONTO_CAMBIO muestra el total nuevo, no cobra hasta confirmar y reintenta con la misma clave', async () => {
    let intento = 0;
    const api = servidor({
      extra: {
        [RUTA_EFECTIVO]: () => {
          intento += 1;
          return intento === 1
            ? error('MONTO_CAMBIO', 409, { total: '130.00' })
            : {
                estado: 201,
                cuerpo: respuestaRenovacion({ pago: { monto: '130.00' }, renovacion: { total: '130.00' } }),
              };
        },
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo, cobrar } = await abrirYCobrar();
    await usuario.click(cobrar);
    expect(
      await within(dialogo).findByText(/El monto cambió desde que lo viste: ahora es S\/ 130\.00/),
    ).toBeInTheDocument();
    const otra = await within(dialogo).findByRole('button', { name: 'Cobrar S/ 130.00' });
    expect(llamadas(api, RUTA_EFECTIVO)).toHaveLength(1);
    await waitFor(() => expect(otra).toBeEnabled());
    await usuario.click(otra);
    await screen.findByRole('dialog', { name: 'Renovación registrada' });
    const [primero, segundo] = llamadas(api, RUTA_EFECTIVO) as { claveIdempotencia: string; montoMostrado: string }[];
    expect(primero?.montoMostrado).toBe('120.00');
    expect(segundo?.montoMostrado).toBe('130.00');
    expect(segundo?.claveIdempotencia).toBe(primero?.claveIdempotencia);
  });

  it('un 409 SIN_CUPO avisa, quita las clases llenas de la elección y vuelve a pedir la oferta', async () => {
    const api = servidor({
      extra: { [RUTA_EFECTIVO]: () => error('SIN_CUPO', 409, { claseIds: [C_LUN] }) },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo, cobrar } = await abrirYCobrar();
    const antes = llamadas(api, RUTA_OFERTA_DIC).length;
    await usuario.click(cobrar);
    expect(await within(dialogo).findByText(/Alguna de las clases elegidas se llenó/)).toBeInTheDocument();
    expect(within(dialogo).getByText('Elegiste 2 de 3.')).toBeInTheDocument();
    expect(
      within(within(dialogo).getByRole('group', { name: 'Lunes' })).getByRole('checkbox', { name: /18:00 a 19:00/ }),
    ).not.toBeChecked();
    await waitFor(() => expect(llamadas(api, RUTA_OFERTA_DIC).length).toBeGreaterThan(antes));
    expect(within(dialogo).getByRole('button', { name: 'Cobrar' })).toBeDisabled();
  });

  it.each([
    ['MENSUALIDAD_YA_REGISTRADA', /El alumno ya tiene la mensualidad de ese mes/],
    ['CLAVE_YA_USADA', /Ese cobro ya se había registrado con otros datos/],
  ])(
    'un 409 %s se muestra con su texto y no se puede volver a enviar desde el mismo diálogo',
    async (codigo, texto) => {
      const api = servidor({ extra: { [RUTA_EFECTIVO]: () => error(codigo, 409) } });
      mostrar(`/panel/alumnos/${ID_ALUMNO}`);
      const { usuario, dialogo, cobrar } = await abrirYCobrar();
      await usuario.click(cobrar);
      expect(await within(dialogo).findByText(texto)).toBeInTheDocument();
      expect(within(dialogo).getByRole('button', { name: 'Cobrar S/ 120.00' })).toBeDisabled();
      expect(within(dialogo).getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
      expect(llamadas(api, RUTA_EFECTIVO)).toHaveLength(1);
    },
  );

  it('un 409 SIN_CAJA_ABIERTA de la API se muestra con el enlace a la caja', async () => {
    servidor({ extra: { [RUTA_EFECTIVO]: () => error('SIN_CAJA_ABIERTA', 409) } });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo, cobrar } = await abrirYCobrar();
    await usuario.click(cobrar);
    const alertas = await within(dialogo).findAllByText('Abre la caja antes de cobrar.');
    expect(alertas.length).toBeGreaterThan(0);
    expect(within(dialogo).getByRole('link', { name: 'Ir a la caja' })).toBeInTheDocument();
  });

  it('un 409 MES_NO_PERMITIDO nombra los meses que sí se pueden renovar', async () => {
    servidor({ extra: { [RUTA_EFECTIVO]: () => error('MES_NO_PERMITIDO', 409, { mesesPermitidos: ['2026-11'] }) } });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo, cobrar } = await abrirYCobrar();
    await usuario.click(cobrar);
    expect(await within(dialogo).findByText(/Se puede renovar: noviembre de 2026\./)).toBeInTheDocument();
  });

  it('una clave nueva por diálogo abierto: reintentar usa la misma y reabrir genera otra', async () => {
    const respuestas = [error('ERROR_INTERNO', 500), error('ERROR_INTERNO', 500)];
    const api = servidor({
      extra: { [RUTA_EFECTIVO]: () => respuestas.shift() ?? { estado: 201, cuerpo: respuestaRenovacion() } },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const primera = await abrirYCobrar();
    await primera.usuario.click(primera.cobrar);
    await within(primera.dialogo).findByText(/No se pudo contactar al servidor/);
    await primera.usuario.click(within(primera.dialogo).getByRole('button', { name: 'Cobrar S/ 120.00' }));
    await waitFor(() => expect(llamadas(api, RUTA_EFECTIVO)).toHaveLength(2));
    await primera.usuario.click(within(primera.dialogo).getByRole('button', { name: 'Volver' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const segunda = await abrirYCobrar();
    await segunda.usuario.click(segunda.cobrar);
    await screen.findByRole('dialog', { name: 'Renovación registrada' });
    const claves = (llamadas(api, RUTA_EFECTIVO) as { claveIdempotencia: string }[]).map((c) => c.claveIdempotencia);
    expect(claves).toHaveLength(3);
    expect(claves[1]).toBe(claves[0]);
    expect(claves[2]).not.toBe(claves[0]);
  });
});

describe('diálogo «Renovar»: Yape o transferencia (criterio 20)', () => {
  async function elegirMetodo(metodo: 'YAPE' | 'TRANSFERENCIA' = 'YAPE') {
    const resultado = await abrirDialogo();
    await esperarCotizacion(resultado.dialogo);
    await resultado.usuario.selectOptions(within(resultado.dialogo).getByLabelText('Método de pago'), metodo);
    return resultado;
  }

  async function llenar(usuario: ReturnType<typeof userEvent.setup>, dialogo: HTMLElement, numero = 'YP-778899') {
    await usuario.type(within(dialogo).getByLabelText('Número de operación'), numero);
    await usuario.upload(
      within(dialogo).getByLabelText(/Imagen del comprobante/),
      archivoDePrueba('comprobante.png', 'image/png', 200),
    );
  }

  it('muestra el comprobante, el número, el monto con el total ya escrito y la fecha de hoy; sin avisar de la caja', async () => {
    servidor({ caja: null });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { dialogo } = await elegirMetodo();
    expect(within(dialogo).getByLabelText('Monto pagado (S/)')).toHaveValue('120.00');
    const fecha = within(dialogo).getByLabelText('Fecha de la operación');
    expect(fecha).toHaveValue('2026-11-26');
    // Para el mes siguiente, la fecha no puede ser anterior al inicio de la ventana.
    expect(fecha).toHaveAttribute('min', '2026-11-26');
    expect(fecha).toHaveAttribute('max', '2026-11-26');
    expect(within(dialogo).getByLabelText(/Imagen del comprobante/)).toBeInTheDocument();
    expect(within(dialogo).queryByText(/Abre la caja/)).not.toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Enviar a verificación' })).toBeEnabled();
  });

  it('exige el número y la imagen antes de enviar', async () => {
    const api = servidor();
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await elegirMetodo();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar a verificación' }));
    expect(await within(dialogo).findByText('Escribe el número de operación.')).toBeInTheDocument();
    expect(within(dialogo).getByText('Elige la imagen del comprobante.')).toBeInTheDocument();
    expect(peticiones(api, RUTA_COMPROBANTE)).toHaveLength(0);
  });

  it('envía la imagen y los datos en X-Renovacion-Datos y deja la renovación en verificación con el enlace a la bandeja', async () => {
    const api = servidor({
      extra: {
        [RUTA_COMPROBANTE]: () => ({
          estado: 201,
          cuerpo: respuestaRenovacion({
            renovacion: { estado: 'EN_VERIFICACION' },
            pago: {
              estado: 'PENDIENTE_VERIFICACION',
              metodo: 'YAPE',
              numeroOperacion: 'YP-778899',
              verificadoEn: null,
              numeroTicket: null,
            },
          }),
        }),
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await elegirMetodo();
    await llenar(usuario, dialogo);
    const enviar = within(dialogo).getByRole('button', { name: 'Enviar a verificación' });
    await usuario.dblClick(enviar);
    const resultado = await screen.findByRole('dialog', { name: 'Renovación enviada a verificación' });
    expect(
      within(resultado).getByText(/Se envió a verificación el pago de S\/ 120\.00 de Lucía Fernanda Prado Quispe\./),
    ).toBeInTheDocument();
    expect(within(resultado).getByRole('link', { name: 'Ir a pagos por verificar' })).toHaveAttribute(
      'href',
      '/panel/pagos',
    );
    expect(within(resultado).queryByRole('link', { name: 'Imprimir ticket' })).not.toBeInTheDocument();
    const enviadas = peticiones(api, RUTA_COMPROBANTE);
    expect(enviadas).toHaveLength(1);
    const cabeceras = enviadas[0]?.headers as Record<string, string>;
    expect(cabeceras['Content-Type']).toBe('image/png');
    expect(JSON.parse(cabeceras['X-Renovacion-Datos'] ?? '{}')).toEqual({
      claveIdempotencia: expect.stringMatching(UUID) as unknown,
      mes: '2026-12',
      planId: PLAN3,
      claseIds: [C_LUN, C_MIE, C_VIE],
      metodo: 'YAPE',
      numeroOperacion: 'YP-778899',
      monto: '120.00',
      fechaOperacion: '2026-11-26',
    });
    expect(enviadas[0]?.body).toBeInstanceOf(File);
  });

  it('la transferencia viaja con su método', async () => {
    const api = servidor({
      extra: {
        [RUTA_COMPROBANTE]: () => ({
          estado: 201,
          cuerpo: respuestaRenovacion({
            renovacion: { estado: 'EN_VERIFICACION' },
            pago: { estado: 'PENDIENTE_VERIFICACION', metodo: 'TRANSFERENCIA' },
          }),
        }),
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await elegirMetodo('TRANSFERENCIA');
    await llenar(usuario, dialogo, 'TR-1');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar a verificación' }));
    await screen.findByRole('dialog', { name: 'Renovación enviada a verificación' });
    const cabeceras = peticiones(api, RUTA_COMPROBANTE)[0]?.headers as Record<string, string>;
    expect(JSON.parse(cabeceras['X-Renovacion-Datos'] ?? '{}')).toMatchObject({
      metodo: 'TRANSFERENCIA',
      numeroOperacion: 'TR-1',
    });
  });

  it('un 409 NUMERO_OPERACION_YA_USADO se muestra en el campo del número', async () => {
    servidor({ extra: { [RUTA_COMPROBANTE]: () => error('NUMERO_OPERACION_YA_USADO', 409) } });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await elegirMetodo();
    await llenar(usuario, dialogo);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar a verificación' }));
    expect(await within(dialogo).findByText(/Ese número de operación ya se registró/)).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Número de operación')).toHaveAttribute('aria-invalid', 'true');
  });

  it('un 409 MONTO_DISTINTO deja el total nuevo en el monto y lo avisa', async () => {
    servidor({ extra: { [RUTA_COMPROBANTE]: () => error('MONTO_DISTINTO', 409, { total: '130.00' }) } });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await elegirMetodo();
    await llenar(usuario, dialogo);
    await usuario.clear(within(dialogo).getByLabelText('Monto pagado (S/)'));
    await usuario.type(within(dialogo).getByLabelText('Monto pagado (S/)'), '100');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar a verificación' }));
    expect(
      await within(dialogo).findByText(/El monto cambió desde que lo viste: ahora es S\/ 130\.00/),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(dialogo).getByLabelText('Monto pagado (S/)')).toHaveValue('130.00'));
  });

  it('un 409 FECHA_OPERACION_NO_VALIDA se muestra en el campo de la fecha', async () => {
    servidor({ extra: { [RUTA_COMPROBANTE]: () => error('FECHA_OPERACION_NO_VALIDA', 409) } });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await elegirMetodo();
    await llenar(usuario, dialogo);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar a verificación' }));
    expect(
      await within(dialogo).findByText(/La fecha de la operación no puede ser posterior a hoy/),
    ).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Fecha de la operación')).toHaveAttribute('aria-invalid', 'true');
  });

  it('un 400 IMAGEN_NO_VALIDA se explica y deja reintentar con otra imagen', async () => {
    servidor({ extra: { [RUTA_COMPROBANTE]: () => error('IMAGEN_NO_VALIDA', 400) } });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await elegirMetodo();
    await llenar(usuario, dialogo);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar a verificación' }));
    expect(await within(dialogo).findByText(/No pudimos usar esa imagen/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Enviar a verificación' })).toBeEnabled());
  });
});
