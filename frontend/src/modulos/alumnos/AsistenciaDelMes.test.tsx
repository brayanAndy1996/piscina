import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error, llamadas, mostrar, sesionDe, simularApi } from '../../pruebas-api';
import { carnetDePrueba, ID_ALUMNO } from '../carnet/pruebas-carnet';

// Spec 009b, criterio 32: la sección «Asistencia» de `/panel/alumnos/{id}` (el mes en curso y el anterior, cada día con su estado y los totales) y
// el diálogo «Registrar asistencia posterior» (una clave por diálogo abierto, los rechazos con los textos de `mensajes.ts`). La API se simula.

const RUTA_CARNET = `GET /api/alumnos/${ID_ALUMNO}/carnet`;
const RUTA_NOVIEMBRE = `GET /api/alumnos/${ID_ALUMNO}/asistencias?mes=2026-11`;
const RUTA_OCTUBRE = `GET /api/alumnos/${ID_ALUMNO}/asistencias?mes=2026-10`;
const RUTA_POSTERIOR = 'POST /api/asistencias/posterior';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CLASE = { horaInicio: '18:00', horaFin: '19:00' };

const NOVIEMBRE = {
  mes: '2026-11',
  matricula: { clasesTotales: 12, clasesUsadas: 3, clasesRestantes: 9 },
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
    { tipo: 'FALTA', fecha: '2026-11-24', clase: CLASE },
  ],
};

const OCTUBRE = {
  mes: '2026-10',
  matricula: null,
  registros: [{ tipo: 'FALTA', fecha: '2026-10-27', clase: CLASE }],
};

const SIN_REGISTROS = { mes: '2026-11', matricula: null, registros: [] };

function resultadoPosterior(extra: Record<string, unknown> = {}) {
  return {
    asistencia: {
      id: 'a1b2c3d4-0000-4000-8000-0000000000a1',
      fecha: '2026-11-24',
      horaLlegada: '18:10',
      llegadaEn: '2026-11-24T23:10:00.000Z',
      estadoLlegada: 'TARDE',
      metodo: 'MANUAL',
      registroPosterior: true,
    },
    alumno: {
      id: ID_ALUMNO,
      nombres: 'Lucía Fernanda',
      apellidos: 'Prado Quispe',
      nivel: 'INTERMEDIO',
      foto: null,
    },
    clase: { id: 'a1b2c3d4-0000-4000-8000-0000000000c1', nivel: 'INTERMEDIO', diaSemana: 2, ...CLASE },
    clases: { usadas: 4, totales: 12, restantes: 8 },
    repetida: false,
    ...extra,
  };
}

function servidor(rol: 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO', rutas: Parameters<typeof simularApi>[0] = {}) {
  return simularApi({
    'GET /api/sesion': () => ({ estado: 200, cuerpo: sesionDe(rol) }),
    [RUTA_CARNET]: () => ({ estado: 200, cuerpo: carnetDePrueba() }),
    [RUTA_NOVIEMBRE]: () => ({ estado: 200, cuerpo: NOVIEMBRE }),
    [RUTA_OCTUBRE]: () => ({ estado: 200, cuerpo: OCTUBRE }),
    ...rutas,
  });
}

/** El recuadro de un total de la sección (el `dt` y su `dd`). */
function total(nombre: string) {
  return screen.getByText(nombre, { selector: 'dt' }).parentElement;
}

async function abrirDialogo() {
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole('button', { name: 'Registrar asistencia posterior' }));
  const dialogo = await screen.findByRole('dialog', { name: 'Registrar asistencia posterior' });
  return { usuario, dialogo };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Hoy es jueves 26/11/2026 a las 10:00 en Lima. Solo se finge la fecha: los temporizadores de la prueba siguen reales.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-26T15:00:00.000Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/panel/alumnos/{id}: sección «Asistencia» (criterio 32)', () => {
  it.each(['ADMIN', 'SECRETARIA'] as const)('el rol %s ve el mes en curso con cada día y sus totales', async (rol) => {
    const api = servidor(rol);
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const seccion = await screen.findByRole('region', { name: 'Asistencia' });
    const lista = await within(seccion).findByRole('list', { name: 'Asistencia de noviembre de 2026' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(5);
    expect(filas[0]).toHaveTextContent('Martes 03/11/2026');
    expect(filas[0]).toHaveTextContent('Clase de 18:00 a 19:00');
    expect(filas[0]).toHaveTextContent('Puntual');
    expect(filas[0]).toHaveTextContent('Llegó a las 18:02');
    expect(filas[0]).not.toHaveTextContent(/Manual|Posterior/);
    expect(filas[1]).toHaveTextContent('Tarde');
    expect(filas[1]).toHaveTextContent('Llegó a las 18:25 · Manual');
    expect(filas[2]).toHaveTextContent('Martes 10/11/2026');
    expect(filas[2]).toHaveTextContent('Falta');
    expect(filas[2]).not.toHaveTextContent('Llegó');
    // Una falta cubierta sale como su asistencia, con «Posterior».
    expect(filas[3]).toHaveTextContent('Puntual');
    expect(filas[3]).toHaveTextContent('Llegó a las 18:05 · Posterior');
    expect(filas[3]).not.toHaveTextContent('Falta');

    expect(total('Puntual')).toHaveTextContent('2');
    expect(total('Tarde')).toHaveTextContent('1');
    expect(total('Faltas')).toHaveTextContent('2');
    expect(total('Clases restantes')).toHaveTextContent('9');
    expect(llamadas(api, RUTA_NOVIEMBRE)).toHaveLength(1);
  });

  it('el selector pasa al mes anterior, que se consulta con su mes y no ofrece el registro posterior', async () => {
    const api = servidor('SECRETARIA');
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const usuario = userEvent.setup();
    expect(await screen.findByRole('button', { name: 'Registrar asistencia posterior' })).toBeInTheDocument();
    const selector = screen.getByLabelText('Mes');
    expect(
      within(selector)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['noviembre de 2026', 'octubre de 2026']);
    await usuario.selectOptions(selector, 'octubre de 2026');

    expect(await screen.findByRole('list', { name: 'Asistencia de octubre de 2026' })).toHaveTextContent(
      'Martes 27/10/2026',
    );
    expect(llamadas(api, RUTA_OCTUBRE)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Registrar asistencia posterior' })).not.toBeInTheDocument();
    expect(total('Clases restantes')).toHaveTextContent('—');
    expect(screen.getByText('No tuvo una mensualidad en octubre de 2026.')).toBeInTheDocument();
  });

  it('un mes sin registros lo dice', async () => {
    servidor('ADMIN', { [RUTA_NOVIEMBRE]: () => ({ estado: 200, cuerpo: SIN_REGISTROS }) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    expect(await screen.findByText('No hay asistencias ni faltas en noviembre de 2026.')).toBeInTheDocument();
  });

  it('si la consulta falla muestra el mensaje y deja volver a intentar', async () => {
    let intentos = 0;
    servidor('ADMIN', {
      [RUTA_NOVIEMBRE]: () => {
        intentos += 1;
        return intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: NOVIEMBRE };
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const seccion = await screen.findByRole('region', { name: 'Asistencia' });
    expect(await within(seccion).findByRole('alert')).toHaveTextContent('No se pudo contactar al servidor');
    expect(within(seccion).queryByRole('button', { name: 'Registrar asistencia posterior' })).not.toBeInTheDocument();
    await userEvent.setup().click(within(seccion).getByRole('button', { name: 'Volver a intentar' }));
    expect(await within(seccion).findByRole('list', { name: 'Asistencia de noviembre de 2026' })).toBeInTheDocument();
  });

  it('con un 404 lo explica y no ofrece reintentar', async () => {
    servidor('ADMIN', { [RUTA_NOVIEMBRE]: () => error('NO_ENCONTRADO', 404) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const seccion = await screen.findByRole('region', { name: 'Asistencia' });
    expect(await within(seccion).findByRole('alert')).toHaveTextContent('No encontramos a este alumno.');
    expect(within(seccion).queryByRole('button', { name: 'Volver a intentar' })).not.toBeInTheDocument();
  });

  it.each(['ENTRENADOR', 'ALUMNO'] as const)('el rol %s no ve la sección ni consulta la asistencia', async (rol) => {
    const api = servidor(rol);
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    expect(await screen.findByRole('heading', { name: 'No tienes permiso para ver esta página' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Asistencia' })).not.toBeInTheDocument();
    expect(llamadas(api, RUTA_NOVIEMBRE)).toHaveLength(0);
  });
});

describe('«Registrar asistencia posterior» (criterio 32)', () => {
  it('ofrece las faltas del mes, exige hora y motivo y no llama a la API con datos incompletos', async () => {
    const api = servidor('SECRETARIA');
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    const dias = within(dialogo).getByLabelText('Día de la clase');
    expect(
      within(dias)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Mar 10/11 · 18:00 a 19:00 (falta)', 'Mar 24/11 · 18:00 a 19:00 (falta)', 'Otro día de este mes']);
    expect(within(dialogo).getByText('Entre las 18:00 y las 19:00, dentro de su clase.')).toBeInTheDocument();
    expect(within(dialogo).queryByLabelText('Fecha de la clase')).not.toBeInTheDocument();

    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));
    expect(await within(dialogo).findAllByRole('alert')).not.toHaveLength(0);
    expect(llamadas(api, RUTA_POSTERIOR)).toHaveLength(0);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Volver' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('registra con una clave UUID, cierra el diálogo, avisa y vuelve a pedir el mes', async () => {
    let registrada = false;
    const api = servidor('SECRETARIA', {
      [RUTA_POSTERIOR]: () => {
        registrada = true;
        return { estado: 201, cuerpo: resultadoPosterior() };
      },
      [RUTA_NOVIEMBRE]: () => ({
        estado: 200,
        cuerpo: registrada
          ? { ...NOVIEMBRE, registros: NOVIEMBRE.registros.filter((r) => r.fecha !== '2026-11-24') }
          : NOVIEMBRE,
      }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.selectOptions(within(dialogo).getByLabelText('Día de la clase'), '2026-11-24');
    fireEvent.change(within(dialogo).getByLabelText('Hora de llegada'), { target: { value: '18:10' } });
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'No se leyó su QR en la puerta');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const cuerpos = llamadas(api, RUTA_POSTERIOR) as Record<string, string>[];
    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0]).toMatchObject({
      alumnoId: ID_ALUMNO,
      fecha: '2026-11-24',
      horaLlegada: '18:10',
      motivo: 'No se leyó su QR en la puerta',
    });
    expect(cuerpos[0]?.['claveIdempotencia']).toMatch(UUID);
    expect(Object.keys(cuerpos[0] ?? {}).sort()).toEqual([
      'alumnoId',
      'claveIdempotencia',
      'fecha',
      'horaLlegada',
      'motivo',
    ]);
    expect(
      await screen.findByText('Se registró la asistencia del 24/11/2026 a las 18:10 (Tarde).'),
    ).toBeInTheDocument();
    await waitFor(() => expect(llamadas(api, RUTA_NOVIEMBRE).length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(total('Faltas')).toHaveTextContent('1'));
  });

  it('para otro día escribe la fecha y la manda tal cual', async () => {
    const api = servidor('ADMIN', { [RUTA_POSTERIOR]: () => ({ estado: 201, cuerpo: resultadoPosterior() }) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    await usuario.selectOptions(within(dialogo).getByLabelText('Día de la clase'), 'Otro día de este mes');
    const fecha = within(dialogo).getByLabelText('Fecha de la clase');
    expect(fecha).toHaveAttribute('min', '2026-11-01');
    expect(fecha).toHaveAttribute('max', '2026-11-26');
    fireEvent.change(fecha, { target: { value: '2026-11-19' } });
    fireEvent.change(within(dialogo).getByLabelText('Hora de llegada'), { target: { value: '18:30' } });
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Marcó en otra puerta');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));

    await waitFor(() => expect(llamadas(api, RUTA_POSTERIOR)).toHaveLength(1));
    expect(llamadas(api, RUTA_POSTERIOR)[0]).toMatchObject({ fecha: '2026-11-19', horaLlegada: '18:30' });
  });

  it('sin faltas en el mes pide directamente la fecha', async () => {
    servidor('ADMIN', {
      [RUTA_NOVIEMBRE]: () => ({ estado: 200, cuerpo: { ...NOVIEMBRE, registros: NOVIEMBRE.registros.slice(0, 2) } }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { dialogo } = await abrirDialogo();
    expect(within(dialogo).queryByLabelText('Día de la clase')).not.toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Fecha de la clase')).toBeInTheDocument();
  });

  it.each([
    ['FECHA_NO_PERMITIDA', 'La fecha debe ser de este mes y no puede ser posterior a hoy.'],
    ['CLASE_NO_TERMINADA', 'La clase todavía no terminó: durante la clase se marca con el QR o de forma manual.'],
    ['FUERA_DE_HORARIO', 'El alumno no tiene clase ese día.'],
  ])('el rechazo %s se muestra junto al día de la clase, con su texto', async (codigo, texto) => {
    servidor('SECRETARIA', { [RUTA_POSTERIOR]: () => error(codigo, 409) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    fireEvent.change(within(dialogo).getByLabelText('Hora de llegada'), { target: { value: '18:10' } });
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Se olvidó de marcar');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(texto);
    expect(within(dialogo).getByLabelText('Día de la clase')).toHaveAccessibleDescription(texto);
  });

  it('HORA_FUERA_DE_LA_CLASE se muestra junto a la hora de llegada y deja corregirla con la misma clave', async () => {
    let intentos = 0;
    const api = servidor('SECRETARIA', {
      [RUTA_POSTERIOR]: () => {
        intentos += 1;
        return intentos === 1 ? error('HORA_FUERA_DE_LA_CLASE', 409) : { estado: 201, cuerpo: resultadoPosterior() };
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    const hora = within(dialogo).getByLabelText('Hora de llegada');
    fireEvent.change(hora, { target: { value: '20:00' } });
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Se olvidó de marcar');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'La hora de llegada debe estar dentro de la clase.',
    );
    expect(hora).toHaveAccessibleDescription(/La hora de llegada debe estar dentro de la clase\./);

    fireEvent.change(hora, { target: { value: '18:10' } });
    await waitFor(() => expect(within(dialogo).queryByRole('alert')).not.toBeInTheDocument());
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const claves = (llamadas(api, RUTA_POSTERIOR) as { claveIdempotencia: string }[]).map((c) => c.claveIdempotencia);
    expect(claves).toHaveLength(2);
    expect(claves[0]).toBe(claves[1]);
  });

  it('un rechazo general (ya tiene asistencia ese día) se dice del día y no de «hoy»', async () => {
    servidor('SECRETARIA', { [RUTA_POSTERIOR]: () => error('ASISTENCIA_YA_REGISTRADA', 409) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    fireEvent.change(within(dialogo).getByLabelText('Hora de llegada'), { target: { value: '18:10' } });
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Se olvidó de marcar');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'El alumno ya tiene su asistencia registrada ese día.',
    );
    expect(within(dialogo).getByRole('button', { name: 'Registrar asistencia' })).toBeEnabled();
  });

  it('SIN_CLASES_RESTANTES usa el texto compartido de la asistencia', async () => {
    servidor('SECRETARIA', { [RUTA_POSTERIOR]: () => error('SIN_CLASES_RESTANTES', 409) });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    fireEvent.change(within(dialogo).getByLabelText('Hora de llegada'), { target: { value: '18:10' } });
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Se olvidó de marcar');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No le quedan clases en su mensualidad.');
  });

  it('un 404 deja solo «Cerrar»; un diálogo nuevo usa una clave nueva', async () => {
    let falla = true;
    const api = servidor('ADMIN', {
      [RUTA_POSTERIOR]: () => (falla ? error('NO_ENCONTRADO', 404) : { estado: 201, cuerpo: resultadoPosterior() }),
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    let { usuario, dialogo } = await abrirDialogo();
    fireEvent.change(within(dialogo).getByLabelText('Hora de llegada'), { target: { value: '18:10' } });
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Se olvidó de marcar');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No encontramos a este alumno.');
    expect(within(dialogo).getByRole('button', { name: 'Registrar asistencia' })).toBeDisabled();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    falla = false;
    ({ usuario, dialogo } = await abrirDialogo());
    fireEvent.change(within(dialogo).getByLabelText('Hora de llegada'), { target: { value: '18:10' } });
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Se olvidó de marcar');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));
    await waitFor(() => expect(llamadas(api, RUTA_POSTERIOR)).toHaveLength(2));
    const claves = (llamadas(api, RUTA_POSTERIOR) as { claveIdempotencia: string }[]).map((c) => c.claveIdempotencia);
    expect(claves[0]).not.toBe(claves[1]);
  });

  it('un doble clic en «Registrar asistencia» manda una sola petición', async () => {
    const api = servidor('SECRETARIA', {
      [RUTA_POSTERIOR]: async () => {
        await new Promise((resolver) => setTimeout(resolver, 50));
        return { estado: 201, cuerpo: resultadoPosterior() };
      },
    });
    mostrar(`/panel/alumnos/${ID_ALUMNO}`);
    const { usuario, dialogo } = await abrirDialogo();
    fireEvent.change(within(dialogo).getByLabelText('Hora de llegada'), { target: { value: '18:10' } });
    await usuario.type(within(dialogo).getByLabelText('Motivo'), 'Se olvidó de marcar');
    await usuario.dblClick(within(dialogo).getByRole('button', { name: 'Registrar asistencia' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(llamadas(api, RUTA_POSTERIOR)).toHaveLength(1);
  });
});
