import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error, llamadas, mostrar, sesionDe, simularApi } from '../../pruebas-api';

// Spec 011, criterios 18 y 19: el panel del alumno en `/panel` (sus datos, su mensualidad, su asistencia del mes con un selector) y que sea de
// solo lectura. La API se simula; lo que lleva cada respuesta y su aislamiento los prueba el backend.

const RUTA_PANEL = 'GET /api/mi-panel';
const RUTA_NOVIEMBRE = 'GET /api/mi-panel/asistencias?mes=2026-11';
const RUTA_OCTUBRE = 'GET /api/mi-panel/asistencias?mes=2026-10';

const CLASES = [
  { diaSemana: 2, horaInicio: '18:00', horaFin: '19:00' },
  { diaSemana: 4, horaInicio: '19:00', horaFin: '20:00' },
];

function mensualidad(mes: string, extra: Record<string, unknown> = {}) {
  return {
    mes,
    plan: { nombre: 'Plan 12 clases' },
    clases: CLASES,
    clasesUsadas: 5,
    clasesTotales: 12,
    clasesRestantes: 7,
    desde: `${mes}-01`,
    hasta: mes === '2026-11' ? '2026-11-30' : mes === '2026-12' ? '2026-12-31' : `${mes}-28`,
    ...extra,
  };
}

function panelDe(
  mensualidadDelPanel: Record<string, unknown>,
  alumno: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  return {
    hoy: '2026-11-26',
    mesEnCurso: '2026-11',
    alumno: {
      nombres: 'Lucía Fernanda',
      apellidos: 'Prado Quispe',
      dni: '45678912',
      nivel: 'BASICO',
      edad: 11,
      estado: 'ALUMNO_ACTIVO',
      ...alumno,
    },
    mensualidad: mensualidadDelPanel,
    mesesDeAsistencia: ['2026-11', '2026-10'],
    ...extra,
  };
}

const AL_DIA = panelDe({ estado: 'AL_DIA', actual: mensualidad('2026-11'), siguiente: null });

const CLASE = { horaInicio: '18:00', horaFin: '19:00' };
const NOVIEMBRE = {
  mes: '2026-11',
  matricula: { clasesTotales: 12, clasesUsadas: 5, clasesRestantes: 7 },
  registros: [
    {
      tipo: 'ASISTENCIA',
      fecha: '2026-11-03',
      clase: CLASE,
      horaLlegada: '18:02',
      estadoLlegada: 'PUNTUAL',
      metodo: 'QR',
      registroPosterior: false,
      faltaCubierta: false,
    },
    {
      tipo: 'ASISTENCIA',
      fecha: '2026-11-05',
      clase: CLASE,
      horaLlegada: '18:25',
      estadoLlegada: 'TARDE',
      metodo: 'MANUAL',
      registroPosterior: false,
      faltaCubierta: false,
    },
    { tipo: 'FALTA', fecha: '2026-11-10', clase: CLASE },
    {
      tipo: 'ASISTENCIA',
      fecha: '2026-11-12',
      clase: CLASE,
      horaLlegada: '18:05',
      estadoLlegada: 'PUNTUAL',
      metodo: 'MANUAL',
      registroPosterior: true,
      faltaCubierta: true,
    },
  ],
};
const OCTUBRE = { mes: '2026-10', matricula: null, registros: [{ tipo: 'FALTA', fecha: '2026-10-27', clase: CLASE }] };

function servidor(rol: 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO', rutas: Parameters<typeof simularApi>[0] = {}) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }),
    [RUTA_PANEL]: () => ({ estado: 200, cuerpo: AL_DIA }),
    [RUTA_NOVIEMBRE]: () => ({ estado: 200, cuerpo: NOVIEMBRE }),
    [RUTA_OCTUBRE]: () => ({ estado: 200, cuerpo: OCTUBRE }),
    ...rutas,
  });
}

function mensualidadMostrada() {
  return screen.getByRole('region', { name: 'Mi mensualidad' });
}

/** El recuadro de un total de «Mi asistencia» (el `dt` y su `dd`). */
function total(nombre: string) {
  return screen.getByText(nombre, { selector: 'dt' }).parentElement;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // El reloj del navegador marca otro mes que el de la API: el panel debe usar el de la API (DT-7). Solo se finge la fecha.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-03-15T15:00:00.000Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/panel del alumno: sus datos y su mensualidad (criterio 18)', () => {
  it('muestra el nombre, el DNI, la edad y el nivel', async () => {
    servidor('ALUMNO');
    mostrar('/panel');
    const datos = await screen.findByRole('region', { name: 'Mis datos' });
    expect(datos).toHaveTextContent('Lucía Fernanda Prado Quispe');
    expect(datos).toHaveTextContent('DNI: 45678912');
    expect(datos).toHaveTextContent('11 años');
    expect(datos).toHaveTextContent('Nivel: Básico');
  });

  it('con la mensualidad al día muestra el plan, los días y horas, las clases y cuándo vence', async () => {
    servidor('ALUMNO');
    mostrar('/panel');
    await screen.findByRole('region', { name: 'Mis datos' });
    const seccion = mensualidadMostrada();
    expect(within(seccion).getByText('Al día')).toBeInTheDocument();
    expect(seccion).toHaveTextContent('Plan 12 clases');
    const horario = within(seccion).getByRole('list', { name: 'Días y horas de tus clases' });
    expect(
      within(horario)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Martes 18:00 a 19:00', 'Jueves 19:00 a 20:00']);
    expect(seccion).toHaveTextContent('Clases: 5 de 12 usadas · te quedan 7');
    expect(seccion).toHaveTextContent('Vence el 30/11/2026');
    expect(seccion).not.toHaveTextContent('acércate a recepción');
  });

  it('por vencer con diciembre pagado dice cuándo vence, el mes siguiente y que renueve en recepción', async () => {
    servidor('ALUMNO', {
      [RUTA_PANEL]: () => ({
        estado: 200,
        cuerpo: panelDe({
          estado: 'POR_VENCER',
          actual: mensualidad('2026-11'),
          siguiente: { ...mensualidad('2026-12'), estado: 'PAGADA' },
        }),
      }),
    });
    mostrar('/panel');
    await screen.findByRole('region', { name: 'Mis datos' });
    const seccion = mensualidadMostrada();
    expect(within(seccion).getByText('Por vencer')).toBeInTheDocument();
    expect(seccion).toHaveTextContent('Vence el 30/11/2026');
    expect(seccion).toHaveTextContent('Diciembre: pagada');
    expect(seccion).toHaveTextContent('Para renovar, acércate a recepción');
  });

  it('con el pago del mes siguiente en verificación lo dice', async () => {
    servidor('ALUMNO', {
      [RUTA_PANEL]: () => ({
        estado: 200,
        cuerpo: panelDe({
          estado: 'PENDIENTE_VERIFICACION',
          actual: mensualidad('2026-11'),
          siguiente: { ...mensualidad('2026-12', { clasesUsadas: 0, clasesRestantes: 12 }), estado: 'EN_VERIFICACION' },
        }),
      }),
    });
    mostrar('/panel');
    await screen.findByRole('region', { name: 'Mis datos' });
    const seccion = mensualidadMostrada();
    expect(within(seccion).getByText('Pendiente de verificación')).toBeInTheDocument();
    expect(seccion).toHaveTextContent('Diciembre: pago en verificación');
  });

  it('vencido muestra su última mensualidad, que venció, y que renueve en recepción', async () => {
    servidor('ALUMNO', {
      [RUTA_PANEL]: () => ({
        estado: 200,
        cuerpo: panelDe({ estado: 'VENCIDO', actual: mensualidad('2026-10'), siguiente: null }),
      }),
    });
    mostrar('/panel');
    await screen.findByRole('region', { name: 'Mis datos' });
    const seccion = mensualidadMostrada();
    expect(within(seccion).getByText('Vencido')).toBeInTheDocument();
    expect(seccion).toHaveTextContent('Venció el 28/10/2026');
    expect(seccion).toHaveTextContent('Para renovar, acércate a recepción');
  });

  it('inscrito para el mes siguiente dice cuándo empieza su mensualidad', async () => {
    servidor('ALUMNO', {
      [RUTA_PANEL]: () => ({
        estado: 200,
        cuerpo: panelDe({
          estado: null,
          actual: null,
          siguiente: { ...mensualidad('2026-12', { clasesUsadas: 0, clasesRestantes: 12 }), estado: 'PAGADA' },
        }),
      }),
    });
    mostrar('/panel');
    await screen.findByRole('region', { name: 'Mis datos' });
    const seccion = mensualidadMostrada();
    expect(seccion).toHaveTextContent('Tu mensualidad empieza el 01/12/2026');
    expect(seccion).toHaveTextContent('Diciembre: pagada');
    expect(seccion).not.toHaveTextContent('Vence el');
  });

  it('sin ninguna mensualidad lo dice y manda a recepción', async () => {
    servidor('ALUMNO', {
      [RUTA_PANEL]: () => ({ estado: 200, cuerpo: panelDe({ estado: null, actual: null, siguiente: null }) }),
    });
    mostrar('/panel');
    await screen.findByRole('region', { name: 'Mis datos' });
    expect(mensualidadMostrada()).toHaveTextContent('No tienes una mensualidad vigente. Acércate a recepción');
  });

  it('inactivo ve sus datos y el aviso, sin estado de mensualidad, y su historial de asistencia', async () => {
    servidor('ALUMNO', {
      [RUTA_PANEL]: () => ({
        estado: 200,
        cuerpo: panelDe({ estado: null, actual: null, siguiente: null }, { estado: 'INACTIVO' }),
      }),
    });
    mostrar('/panel');
    expect(await screen.findByRole('region', { name: 'Mis datos' })).toHaveTextContent('Lucía Fernanda');
    expect(mensualidadMostrada()).toHaveTextContent('Tu cuenta está inactiva en la academia. Acércate a recepción');
    expect(mensualidadMostrada()).not.toHaveTextContent('No tienes una mensualidad vigente');
    expect(await screen.findByRole('list', { name: 'Asistencia de noviembre de 2026' })).toBeInTheDocument();
  });

  it('la edad de un año va en singular', async () => {
    servidor('ALUMNO', { [RUTA_PANEL]: () => ({ estado: 200, cuerpo: panelDe(AL_DIA.mensualidad, { edad: 1 }) }) });
    mostrar('/panel');
    expect(await screen.findByRole('region', { name: 'Mis datos' })).toHaveTextContent('1 año');
  });
});

describe('/panel del alumno: «Mi asistencia» (criterio 18)', () => {
  it('abre en el mes en curso de la API, no en el del reloj del navegador, con los totales y cada día', async () => {
    const api = servidor('ALUMNO');
    mostrar('/panel');
    const seccion = await screen.findByRole('region', { name: 'Mi asistencia' });
    const lista = await within(seccion).findByRole('list', { name: 'Asistencia de noviembre de 2026' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(4);
    expect(filas[0]).toHaveTextContent('Martes 03/11/2026');
    expect(filas[0]).toHaveTextContent('Clase de 18:00 a 19:00');
    expect(filas[0]).toHaveTextContent('Puntual');
    expect(filas[0]).toHaveTextContent('Llegó a las 18:02');
    expect(filas[1]).toHaveTextContent('Tarde');
    expect(filas[1]).toHaveTextContent('Llegó a las 18:25');
    expect(filas[2]).toHaveTextContent('Falta');
    expect(filas[2]).not.toHaveTextContent('Llegó');
    // La familia no ve cómo se registró: ni «Manual» ni «Posterior».
    expect(seccion).not.toHaveTextContent(/Manual|Posterior/);

    expect(total('Puntual')).toHaveTextContent('2');
    expect(total('Tarde')).toHaveTextContent('1');
    expect(total('Faltas')).toHaveTextContent('1');
    expect(total('Clases restantes')).toHaveTextContent('7');
    expect(llamadas(api, RUTA_NOVIEMBRE)).toHaveLength(1);
    expect(llamadas(api, RUTA_OCTUBRE)).toHaveLength(0);
  });

  it('el selector ofrece los meses de la API y pide el mes elegido', async () => {
    const api = servidor('ALUMNO');
    mostrar('/panel');
    const selector = await screen.findByLabelText('Mes');
    expect(
      within(selector)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['noviembre de 2026', 'octubre de 2026']);
    expect(selector).toHaveValue('2026-11');
    await userEvent.setup().selectOptions(selector, 'octubre de 2026');
    expect(await screen.findByRole('list', { name: 'Asistencia de octubre de 2026' })).toHaveTextContent(
      'Martes 27/10/2026',
    );
    expect(llamadas(api, RUTA_OCTUBRE)).toHaveLength(1);
    expect(screen.getByText('No tuviste una mensualidad en octubre de 2026.')).toBeInTheDocument();
    expect(total('Clases restantes')).toHaveTextContent('—');
  });

  it('un mes sin registros lo dice', async () => {
    servidor('ALUMNO', {
      [RUTA_NOVIEMBRE]: () => ({ estado: 200, cuerpo: { mes: '2026-11', matricula: null, registros: [] } }),
    });
    mostrar('/panel');
    expect(await screen.findByText('No hay asistencias ni faltas en noviembre de 2026.')).toBeInTheDocument();
  });

  it('si la asistencia falla, el resto del panel sigue y se puede volver a intentar', async () => {
    let intentos = 0;
    servidor('ALUMNO', {
      [RUTA_NOVIEMBRE]: () => {
        intentos += 1;
        return intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: NOVIEMBRE };
      },
    });
    mostrar('/panel');
    const seccion = await screen.findByRole('region', { name: 'Mi asistencia' });
    expect(await within(seccion).findByRole('alert')).toHaveTextContent('No se pudo contactar al servidor');
    expect(screen.getByRole('region', { name: 'Mis datos' })).toHaveTextContent('Lucía Fernanda');
    await userEvent.setup().click(within(seccion).getByRole('button', { name: 'Volver a intentar' }));
    expect(await within(seccion).findByRole('list', { name: 'Asistencia de noviembre de 2026' })).toBeInTheDocument();
  });
});

describe('/panel del alumno: errores del resumen (criterio 18)', () => {
  it('con un 404 dice que no encontramos su ficha, sin reintentar y sin pedir la asistencia', async () => {
    const api = servidor('ALUMNO', { [RUTA_PANEL]: () => error('NO_ENCONTRADO', 404) });
    mostrar('/panel');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No encontramos tu ficha de alumno. Acércate a recepción.',
    );
    expect(screen.queryByRole('button', { name: 'Volver a intentar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Mi asistencia' })).not.toBeInTheDocument();
    expect(llamadas(api, RUTA_NOVIEMBRE)).toHaveLength(0);
    // «Mi carnet» sigue en el inicio.
    expect(screen.getByRole('link', { name: /Mi carnet/ })).toHaveAttribute('href', '/panel/mi-carnet');
  });

  it('con otro error ofrece «Volver a intentar»', async () => {
    let intentos = 0;
    servidor('ALUMNO', {
      [RUTA_PANEL]: () => {
        intentos += 1;
        return intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: AL_DIA };
      },
    });
    mostrar('/panel');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar al servidor');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Volver a intentar' }));
    expect(await screen.findByRole('region', { name: 'Mis datos' })).toBeInTheDocument();
  });

  it('con un 401 lleva a pedir entrar por el enlace de la academia', async () => {
    let vencida = false;
    simularApi({
      'GET /api/sesion': () => (vencida ? error('NO_AUTENTICADO', 401) : { estado: 200, cuerpo: sesionDe('ALUMNO') }),
      [RUTA_PANEL]: () => {
        vencida = true;
        return error('NO_AUTENTICADO', 401);
      },
    });
    mostrar('/panel');
    expect(await screen.findByRole('heading', { name: 'Entra por el enlace de tu academia' })).toBeInTheDocument();
  });
});

describe('/panel del alumno: solo lectura (criterio 19)', () => {
  it('no tiene campos ni botones de edición: solo el selector, «Mi carnet», «Cambiar contraseña» y «Cerrar sesión»', async () => {
    servidor('ALUMNO');
    mostrar('/panel');
    await screen.findByRole('list', { name: 'Asistencia de noviembre de 2026' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(document.querySelector('input, textarea, form')).toBeNull();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByLabelText('Mes')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cerrar sesión']);
    expect(
      screen
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
        .sort(),
    ).toEqual(['/cambiar-clave', '/panel/mi-carnet']);
    const prohibidos = /editar|subir foto|regenerar|renovar|pagar|cambiar (mi )?horario/i;
    expect(screen.queryByRole('button', { name: prohibidos })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: prohibidos })).not.toBeInTheDocument();
    expect(screen.getByText('Para corregir tus datos o cambiar tu horario, acércate a recepción.')).toBeInTheDocument();
  });
});

describe('/panel del alumno: quién lo ve', () => {
  it.each(['ADMIN', 'SECRETARIA', 'ENTRENADOR'] as const)(
    'el rol %s no ve estas secciones ni consulta el panel',
    async (rol) => {
      const api = servidor(rol);
      mostrar('/panel');
      expect(await screen.findByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Mis datos' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Mi mensualidad' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Mi asistencia' })).not.toBeInTheDocument();
      expect(llamadas(api, RUTA_PANEL)).toHaveLength(0);
      expect(llamadas(api, RUTA_NOVIEMBRE)).toHaveLength(0);
    },
  );

  it('no manda ningún id: ni en la dirección ni en el cuerpo', async () => {
    const api = servidor('ALUMNO');
    mostrar('/panel');
    await screen.findByRole('list', { name: 'Asistencia de noviembre de 2026' });
    const direcciones = api.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/api/mi-panel'));
    expect(direcciones.sort()).toEqual(['/api/mi-panel', '/api/mi-panel/asistencias?mes=2026-11']);
  });
});
