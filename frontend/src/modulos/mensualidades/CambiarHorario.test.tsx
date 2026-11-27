import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error, llamadas, type Manejador, mostrar, sesionDe, simularApi, simularUrlLocal } from '../../pruebas-api';
import { carnetDePrueba, ID_ALUMNO } from '../carnet/pruebas-carnet';

// Spec 010c, criterio 42: «Cambiar horario» en la sección «Mensualidad» de `/panel/alumnos/{id}`: una fila por cada matrícula que devuelve
// `GET /api/alumnos/{id}/horario` (M y M+1), solo con `MODIFICAR_HORARIO_ALUMNO`; elige entre las `clasesDelPlan` con sus cupos (la cantidad sale del
// plan), pide el motivo, envía `POST /api/matriculas/{id}/horario` y avisa si las ocurrencias que quedan son menos que las clases restantes; los 409
// `SIN_CUPO` (marca las clases), `MATRICULA_NO_MODIFICABLE` y `SELECCION_NO_VALIDA` y el 403 tienen su texto. La API se simula: la web no calcula cupos.

const RUTA_HORARIO = `GET /api/alumnos/${ID_ALUMNO}/horario`;
const RUTA_OFERTA = `GET /api/alumnos/${ID_ALUMNO}/renovacion`;
const RUTA_ESTADO = `GET /api/mensualidades?alumnoId=${ID_ALUMNO}`;
const MATRICULA_NOV = 'd1111111-1111-4111-8111-111111111111';
const MATRICULA_DIC = 'd2222222-2222-4222-8222-222222222222';
const RUTA_CAMBIO_NOV = `POST /api/matriculas/${MATRICULA_NOV}/horario`;
const RUTA_CAMBIO_DIC = `POST /api/matriculas/${MATRICULA_DIC}/horario`;
const PLAN2 = 'b2222222-2222-4222-8222-222222222222';
const C_LUN = 'c1111111-1111-4111-8111-111111111111';
const C_MIE = 'c2222222-2222-4222-8222-222222222222';
const C_VIE = 'c3333333-3333-4333-8333-333333333333';
const C_MAR = 'c4444444-4444-4444-8444-444444444444';
const C_MIE_19 = 'c5555555-5555-4555-8555-555555555555';
const AHORA = new Date('2026-11-26T15:00:00.000Z');

const CLASES_ACTUALES = [
  { id: C_LUN, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' },
  { id: C_MIE, diaSemana: 3, horaInicio: '18:00', horaFin: '19:00' },
];

function claseDelPlan(id: string, dia: number, hora: string, cupos: number) {
  const fin = `${String(Number(hora.slice(0, 2)) + 1).padStart(2, '0')}:00`;
  return {
    id,
    nivel: 'BASICO',
    diaSemana: dia,
    horaInicio: hora,
    horaFin: fin,
    cuposRestantes: cupos,
    conPrioridad: false,
  };
}

const CLASES_DEL_PLAN = [
  claseDelPlan(C_LUN, 1, '18:00', 2),
  claseDelPlan(C_MAR, 2, '18:00', 5),
  claseDelPlan(C_MIE, 3, '18:00', 1),
  claseDelPlan(C_MIE_19, 3, '19:00', 0),
  claseDelPlan(C_VIE, 5, '18:00', 12),
];

function matricula(
  id: string,
  mes: string,
  estado: 'VIGENTE' | 'EN_VERIFICACION',
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    mes,
    estado,
    plan: {
      id: PLAN2,
      nombre: 'Plan 2 veces',
      vecesPorSemana: 2,
      diasPermitidos: [1, 2, 3, 4, 5],
      franjasPermitidas: ['18:00', '19:00'],
    },
    clases: CLASES_ACTUALES,
    clasesTotales: 8,
    clasesUsadas: 2,
    clasesDelPlan: CLASES_DEL_PLAN,
    ...extra,
  };
}

function horario(
  matriculas: unknown[] = [
    matricula(MATRICULA_NOV, '2026-11', 'VIGENTE'),
    matricula(MATRICULA_DIC, '2026-12', 'EN_VERIFICACION'),
  ],
) {
  return { alumno: { id: ID_ALUMNO, nivel: 'BASICO' }, matriculas };
}

function respuestaCambio(extra: Record<string, unknown> = {}) {
  return {
    matricula: {
      id: MATRICULA_NOV,
      mes: '2026-11',
      clases: [CLASES_ACTUALES[0], { id: C_VIE, diaSemana: 5, horaInicio: '18:00', horaFin: '19:00' }],
      clasesTotales: 8,
      clasesUsadas: 2,
      ocurrenciasRestantes: 6,
      ...extra,
    },
  };
}

function oferta() {
  return {
    alumno: {
      id: ID_ALUMNO,
      nombres: 'Lucía Fernanda',
      apellidos: 'Prado Quispe',
      nivel: 'BASICO',
      estado: 'ALUMNO_ACTIVO',
    },
    mesesPermitidos: [],
    mes: '2026-11',
    ventana: { desde: '2026-11-26', hasta: '2026-11-30' },
    mensualidadActual: { mes: '2026-11', plan: { id: PLAN2, nombre: 'Plan 2 veces' }, clases: CLASES_ACTUALES },
    planes: [],
    clases: [],
  };
}

function servidor(
  rol: 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO' = 'SECRETARIA',
  extra: Record<string, Manejador> = {},
) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }),
    'GET /api/mi-academia': () => ({
      estado: 200,
      cuerpo: { academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null } },
    }),
    [`GET /api/alumnos/${ID_ALUMNO}/carnet`]: () => ({ estado: 200, cuerpo: carnetDePrueba() }),
    [`GET /api/alumnos/${ID_ALUMNO}/asistencias?mes=2026-11`]: () => ({
      estado: 200,
      cuerpo: { mes: '2026-11', matricula: null, registros: [] },
    }),
    [RUTA_OFERTA]: () => ({ estado: 200, cuerpo: oferta() }),
    [RUTA_ESTADO]: () => ({
      estado: 200,
      cuerpo: {
        mes: '2026-11',
        hoy: '2026-11-26',
        totales: { AL_DIA: 0, POR_VENCER: 0, VENCIDO: 0, PENDIENTE_VERIFICACION: 0 },
        alumnos: [],
        hayMas: false,
      },
    }),
    [RUTA_HORARIO]: () => ({ estado: 200, cuerpo: horario() }),
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

async function abrirDialogo(mes = 'noviembre de 2026') {
  const usuario = userEvent.setup();
  const region = await seccion();
  await usuario.click(await within(region).findByRole('button', { name: `Cambiar horario de ${mes}` }));
  const dialogo = await screen.findByRole('dialog', { name: 'Cambiar horario' });
  return { usuario, dialogo };
}

const casilla = (dialogo: HTMLElement, dia: string, hora: string) =>
  within(within(dialogo).getByRole('group', { name: dia })).getByRole('checkbox', { name: new RegExp(`^${hora}`) });

describe('/panel/alumnos/{id}: «Cambiar horario» (criterio 42)', () => {
  it.each(['ADMIN', 'SECRETARIA'] as const)(
    'el rol %s ve una fila por cada matrícula de la lectura, con su plan y sus clases, y un botón en cada una',
    async (rol) => {
      mostrar_(rol);
      const region = await seccion();
      const botones = await within(region).findAllByRole('button', { name: /^Cambiar horario de / });
      expect(botones.map((boton) => boton.getAttribute('aria-label'))).toEqual([
        'Cambiar horario de noviembre de 2026',
        'Cambiar horario de diciembre de 2026',
      ]);
      const grupo = within(region).getByRole('group', { name: 'Horario de las mensualidades' });
      expect(within(grupo).getAllByText('Plan 2 veces')).toHaveLength(2);
      expect(within(grupo).getByText('Pago por verificar')).toBeInTheDocument();
      expect(within(grupo).getAllByText('Lunes 18:00 a 19:00')).toHaveLength(2);
      expect(within(grupo).getAllByText('Miércoles 18:00 a 19:00')).toHaveLength(2);
    },
  );

  it.each(['ENTRENADOR', 'ALUMNO'] as const)('el rol %s no ve la ficha ni pide el horario', async (rol) => {
    const api = servidor(rol);
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    await waitFor(() => expect(llamadas(api, 'GET /api/sesion').length).toBeGreaterThan(0));
    await new Promise((alcanzar) => setTimeout(alcanzar, 50));
    expect(screen.queryByRole('button', { name: /Cambiar horario/ })).not.toBeInTheDocument();
    expect(llamadas(api, RUTA_HORARIO)).toHaveLength(0);
  });

  it('un alumno sin matrículas que se puedan cambiar lo dice y no muestra botones', async () => {
    servidor('SECRETARIA', { [RUTA_HORARIO]: () => ({ estado: 200, cuerpo: horario([]) }) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(
      await within(region).findByText(/no tiene una mensualidad cuyo horario se pueda cambiar/),
    ).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: /^Cambiar horario de / })).not.toBeInTheDocument();
  });

  it('si la lectura del horario falla lo dice y el resto de la sección sigue', async () => {
    servidor('SECRETARIA', { [RUTA_HORARIO]: () => error('ERROR_INTERNO', 500) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(await within(region).findByText(/No pudimos cargar el horario/)).toBeInTheDocument();
    expect(within(region).getByText('Mes en curso: noviembre de 2026')).toBeInTheDocument();
  });

  it('el diálogo muestra los cupos que da la API, marca «Su horario», bloquea la clase llena y la cantidad sale del plan', async () => {
    servidor();
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { dialogo } = await abrirDialogo();
    expect(within(dialogo).getByText('Elegiste 2 de 2.')).toBeInTheDocument();
    expect(within(dialogo).getByText(/elige 2 clases, una por día/)).toBeInTheDocument();
    expect(casilla(dialogo, 'Lunes', '18:00')).toBeChecked();
    expect(within(within(dialogo).getByRole('group', { name: 'Lunes' })).getByText('2 cupos')).toBeInTheDocument();
    expect(within(within(dialogo).getByRole('group', { name: 'Miércoles' })).getByText('1 cupo')).toBeInTheDocument();
    expect(within(within(dialogo).getByRole('group', { name: 'Martes' })).getByText('5 cupos')).toBeInTheDocument();
    expect(casilla(dialogo, 'Miércoles', '19:00')).toBeDisabled();
    expect(within(within(dialogo).getByRole('group', { name: 'Miércoles' })).getByText('Llena')).toBeInTheDocument();
    // Con las dos elegidas, los otros días no se pueden marcar hasta quitar una.
    expect(casilla(dialogo, 'Martes', '18:00')).toBeDisabled();
    expect(casilla(dialogo, 'Viernes', '18:00')).toBeDisabled();
  });

  it('el botón del mes siguiente abre el diálogo de esa matrícula y envía a su id', async () => {
    const api = servidor('ADMIN', {
      [RUTA_CAMBIO_DIC]: () => ({ estado: 200, cuerpo: respuestaCambio({ id: MATRICULA_DIC, mes: '2026-12' }) }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo('diciembre de 2026');
    expect(within(dialogo).getByText(/Mensualidad de/)).toHaveTextContent('diciembre de 2026');
    await usuario.click(casilla(dialogo, 'Miércoles', '18:00'));
    await usuario.click(casilla(dialogo, 'Viernes', '18:00'));
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Cambió de turno');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cambiar horario' }));
    await screen.findByRole('dialog', { name: 'Horario cambiado' });
    expect(llamadas(api, RUTA_CAMBIO_DIC)).toEqual([{ claseIds: [C_LUN, C_VIE], motivo: 'Cambió de turno' }]);
    expect(llamadas(api, RUTA_CAMBIO_NOV)).toHaveLength(0);
  });

  it('el motivo es obligatorio y de 3 a 200 caracteres: sin él no se envía nada', async () => {
    const api = servidor();
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.click(casilla(dialogo, 'Miércoles', '18:00'));
    await usuario.click(casilla(dialogo, 'Viernes', '18:00'));
    const enviar = within(dialogo).getByRole('button', { name: 'Cambiar horario' });
    await usuario.click(enviar);
    expect(await within(dialogo).findByText(/motivo/i, { selector: 'p' })).toBeInTheDocument();
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'ab');
    await usuario.click(enviar);
    expect(await within(dialogo).findByText(/al menos 3/i)).toBeInTheDocument();
    await usuario.clear(within(dialogo).getByLabelText('Motivo'));
    await usuario.type(within(dialogo).getByLabelText('Motivo'), '   ');
    await usuario.click(enviar);
    expect(llamadas(api, RUTA_CAMBIO_NOV)).toHaveLength(0);
  });

  it('con las mismas clases que ya tiene no deja enviar', async () => {
    servidor();
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { dialogo } = await abrirDialogo();
    expect(within(dialogo).getByRole('button', { name: 'Cambiar horario' })).toBeDisabled();
    expect(within(dialogo).getByText('Elige otras clases para cambiar el horario.')).toBeInTheDocument();
  });

  it('con una clase menos elegida no deja enviar hasta completar las que pide el plan', async () => {
    servidor();
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.click(casilla(dialogo, 'Miércoles', '18:00'));
    expect(within(dialogo).getByText('Elegiste 1 de 2.')).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Cambiar horario' })).toBeDisabled();
  });

  it('envía las clases y el motivo, vuelve a pedir la lectura y la ficha y muestra el resultado sin aviso si alcanzan las ocurrencias', async () => {
    const api = servidor('SECRETARIA', { [RUTA_CAMBIO_NOV]: () => ({ estado: 200, cuerpo: respuestaCambio() }) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.click(casilla(dialogo, 'Miércoles', '18:00'));
    await usuario.click(casilla(dialogo, 'Viernes', '18:00'));
    await usuario.type(within(dialogo).getByLabelText('Motivo'), '  Trabaja los miércoles  ');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cambiar horario' }));
    const resultado = await screen.findByRole('dialog', { name: 'Horario cambiado' });
    expect(llamadas(api, RUTA_CAMBIO_NOV)).toEqual([{ claseIds: [C_LUN, C_VIE], motivo: 'Trabaja los miércoles' }]);
    expect(
      within(resultado).getByText('Se cambió el horario de la mensualidad de noviembre de 2026.'),
    ).toBeInTheDocument();
    expect(within(resultado).getByText(/Lunes 18:00 a 19:00 · Viernes 18:00 a 19:00/)).toBeInTheDocument();
    expect(within(resultado).queryByText(/se pierden al cerrar el mes/)).not.toBeInTheDocument();
    await waitFor(() => expect(llamadas(api, RUTA_HORARIO).length).toBeGreaterThan(1));
    await waitFor(() => expect(llamadas(api, RUTA_OFERTA).length).toBeGreaterThan(1));
    await waitFor(() => expect(llamadas(api, RUTA_ESTADO).length).toBeGreaterThan(1));
  });

  it('avisa cuando las ocurrencias que quedan son menos que las clases restantes del mes', async () => {
    servidor('SECRETARIA', {
      [RUTA_CAMBIO_NOV]: () => ({ estado: 200, cuerpo: respuestaCambio({ ocurrenciasRestantes: 4 }) }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.click(casilla(dialogo, 'Miércoles', '18:00'));
    await usuario.click(casilla(dialogo, 'Viernes', '18:00'));
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Cambio de turno');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cambiar horario' }));
    const resultado = await screen.findByRole('dialog', { name: 'Horario cambiado' });
    // 8 clases en total y 2 usadas: le quedan 6, y el nuevo horario solo tiene 4 ocurrencias.
    expect(
      within(resultado).getByText(/solo quedan 4 clases en noviembre de 2026, y al alumno le quedan 6 por usar/),
    ).toBeInTheDocument();
    expect(within(resultado).getByText(/Las que no alcance a usar se pierden al cerrar el mes/)).toBeInTheDocument();
  });

  it('no avisa si las ocurrencias que quedan igualan a las clases restantes', async () => {
    servidor('SECRETARIA', {
      [RUTA_CAMBIO_NOV]: () => ({ estado: 200, cuerpo: respuestaCambio({ ocurrenciasRestantes: 6 }) }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.click(casilla(dialogo, 'Miércoles', '18:00'));
    await usuario.click(casilla(dialogo, 'Viernes', '18:00'));
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Cambio de turno');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cambiar horario' }));
    const resultado = await screen.findByRole('dialog', { name: 'Horario cambiado' });
    expect(within(resultado).getByText(/Quedan 6 clases del nuevo horario/)).toBeInTheDocument();
    expect(within(resultado).queryByText(/se pierden al cerrar el mes/)).not.toBeInTheDocument();
  });

  it('un doble clic en «Cambiar horario» envía una sola vez', async () => {
    let liberar: () => void = () => undefined;
    const espera = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    const api = servidor('SECRETARIA', {
      [RUTA_CAMBIO_NOV]: async () => {
        await espera;
        return { estado: 200, cuerpo: respuestaCambio() };
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.click(casilla(dialogo, 'Miércoles', '18:00'));
    await usuario.click(casilla(dialogo, 'Viernes', '18:00'));
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Cambio de turno');
    await usuario.dblClick(within(dialogo).getByRole('button', { name: 'Cambiar horario' }));
    expect(await within(dialogo).findByRole('button', { name: 'Guardando…' })).toBeDisabled();
    liberar();
    await screen.findByRole('dialog', { name: 'Horario cambiado' });
    expect(llamadas(api, RUTA_CAMBIO_NOV)).toHaveLength(1);
  });

  it('SIN_CUPO marca las clases de detalles.claseIds, las quita de lo elegido y deja volver a elegir', async () => {
    let intento = 0;
    const api = servidor('SECRETARIA', {
      [RUTA_CAMBIO_NOV]: () => {
        intento += 1;
        return intento === 1
          ? error('SIN_CUPO', 409, { claseIds: [C_VIE] })
          : { estado: 200, cuerpo: respuestaCambio() };
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.click(casilla(dialogo, 'Miércoles', '18:00'));
    await usuario.click(casilla(dialogo, 'Viernes', '18:00'));
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Cambio de turno');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cambiar horario' }));
    expect(await within(dialogo).findByText(/se llenó mientras elegías/)).toBeInTheDocument();
    const viernes = within(dialogo).getByRole('group', { name: 'Viernes' });
    expect(within(viernes).getByText('Sin cupo')).toBeInTheDocument();
    expect(casilla(dialogo, 'Viernes', '18:00')).not.toBeChecked();
    expect(within(dialogo).getByText('Elegiste 1 de 2.')).toBeInTheDocument();
    // La lectura se vuelve a pedir para ver los cupos nuevos.
    await waitFor(() => expect(llamadas(api, RUTA_HORARIO).length).toBeGreaterThan(1));
    // Elige otra clase y el segundo intento entra.
    await usuario.click(casilla(dialogo, 'Martes', '18:00'));
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cambiar horario' }));
    await screen.findByRole('dialog', { name: 'Horario cambiado' });
    expect(llamadas(api, RUTA_CAMBIO_NOV)).toEqual([
      { claseIds: [C_LUN, C_VIE], motivo: 'Cambio de turno' },
      { claseIds: [C_LUN, C_MAR], motivo: 'Cambio de turno' },
    ]);
  });

  it('MATRICULA_NO_MODIFICABLE dice que ya no se puede cambiar, no deja reintentar y mantiene el diálogo aunque la lectura ya no la traiga', async () => {
    let cambiada = false;
    servidor('SECRETARIA', {
      [RUTA_HORARIO]: () => ({
        estado: 200,
        cuerpo: cambiada ? horario([matricula(MATRICULA_DIC, '2026-12', 'EN_VERIFICACION')]) : horario(),
      }),
      [RUTA_CAMBIO_NOV]: () => {
        cambiada = true;
        return error('MATRICULA_NO_MODIFICABLE', 409);
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.click(casilla(dialogo, 'Miércoles', '18:00'));
    await usuario.click(casilla(dialogo, 'Viernes', '18:00'));
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Cambio de turno');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cambiar horario' }));
    expect(await within(dialogo).findByText(/Esta mensualidad ya no se puede cambiar/)).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Cambiar horario' })).toBeDisabled();
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Mensualidad' })).queryByRole('button', {
          name: 'Cambiar horario de noviembre de 2026',
        }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Cambiar horario' })).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('una clase actual que ya no está en las clases del plan se ve como «Ya no disponible», se puede quitar y no vuelve a marcarse', async () => {
    const sinMiercoles = CLASES_DEL_PLAN.filter((clase) => clase.id !== C_MIE);
    const api = servidor('SECRETARIA', {
      [RUTA_HORARIO]: () => ({
        estado: 200,
        cuerpo: horario([matricula(MATRICULA_NOV, '2026-11', 'VIGENTE', { clasesDelPlan: sinMiercoles })]),
      }),
      [RUTA_CAMBIO_NOV]: () => ({ estado: 200, cuerpo: respuestaCambio() }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    const grupo = within(dialogo).getByRole('group', { name: 'Clases que ya no están disponibles' });
    const antigua = within(grupo).getByRole('checkbox', { name: /Miércoles 18:00 a 19:00/ });
    expect(within(grupo).getByText('Ya no disponible')).toBeInTheDocument();
    expect(antigua).toBeChecked();
    expect(within(dialogo).getByText('Elegiste 2 de 2.')).toBeInTheDocument();
    // Con las dos elegidas no deja marcar otra; al quitar la que ya no existe, sí.
    expect(casilla(dialogo, 'Viernes', '18:00')).toBeDisabled();
    await usuario.click(antigua);
    expect(antigua).not.toBeChecked();
    expect(antigua).toBeDisabled();
    expect(within(dialogo).getByText('Elegiste 1 de 2.')).toBeInTheDocument();
    await usuario.click(casilla(dialogo, 'Viernes', '18:00'));
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Se cerró la clase');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cambiar horario' }));
    await screen.findByRole('dialog', { name: 'Horario cambiado' });
    expect(llamadas(api, RUTA_CAMBIO_NOV)).toEqual([{ claseIds: [C_LUN, C_VIE], motivo: 'Se cerró la clase' }]);
  });

  it('si la oferta de renovación falla, el cambio de horario sigue a la vista', async () => {
    servidor('SECRETARIA', { [RUTA_OFERTA]: () => error('ERROR_INTERNO', 500) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const region = await seccion();
    expect(
      await within(region).findByRole('button', { name: 'Cambiar horario de noviembre de 2026' }),
    ).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Cambiar horario de diciembre de 2026' })).toBeInTheDocument();
  });

  it('SELECCION_NO_VALIDA y el 403 tienen su texto', async () => {
    let respuesta = error('SELECCION_NO_VALIDA', 409);
    servidor('SECRETARIA', { [RUTA_CAMBIO_NOV]: () => respuesta });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.click(casilla(dialogo, 'Miércoles', '18:00'));
    await usuario.click(casilla(dialogo, 'Viernes', '18:00'));
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Cambio de turno');
    const enviar = within(dialogo).getByRole('button', { name: 'Cambiar horario' });
    await usuario.click(enviar);
    expect(await within(dialogo).findByText(/no sirven para este plan y nivel/)).toBeInTheDocument();
    // Se puede volver a intentar.
    expect(enviar).toBeEnabled();
    respuesta = error('NO_AUTORIZADO', 403);
    await usuario.click(enviar);
    expect(
      await within(dialogo).findByText('No tienes permiso para cambiar el horario de un alumno.'),
    ).toBeInTheDocument();
    expect(enviar).toBeDisabled();
  });
});

function mostrar_(rol: 'ADMIN' | 'SECRETARIA') {
  servidor(rol);
  mostrar(`/panel/alumnos/${ID_ALUMNO}`);
}
