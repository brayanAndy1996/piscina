import {
  CABECERA_TOKEN_SOLICITUD,
  FOTO_TAMANO_MAXIMO,
  textosConsentimiento,
  VERSION_CONSENTIMIENTOS,
} from '@aquagestion/contratos';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archivoDePrueba,
  error,
  llamadas,
  type Manejador,
  mostrar,
  peticiones,
  simularApi,
  simularUrlLocal,
} from '../../pruebas-api';

// Spec 005, criterio 43 (005a): el formulario público de inscripción por pasos, con los esquemas compartidos, la cotización, la clave de
// idempotencia, el envío y el manejo de cada 409. La API se simula; los criterios de la API los prueba el backend.

const NOMBRE = 'Academia de Natación Los Delfines';
const TELEFONO = '987654321';
const P2 = 'a1111111-1111-4111-8111-111111111111';
const P3 = 'a2222222-2222-4222-8222-222222222222';
const C_LUN_17 = 'c1111111-1111-4111-8111-111111111111';
const C_LUN_18 = 'c2222222-2222-4222-8222-222222222222';
const C_MIE_18 = 'c3333333-3333-4333-8333-333333333333';
const C_VIE_18 = 'c4444444-4444-4444-8444-444444444444';
const C_INTERMEDIO_LUN_18 = 'c5555555-5555-4555-8555-555555555555';
const C_LUN_19 = 'c6666666-6666-4666-8666-666666666666';
const C_MAR_17 = 'c7777777-7777-4777-8777-777777777777';
const TOKEN = 'dUg8U3s15Gr1QAQy0Rjl0cG5bd86JkGqUa__duZr1Ew';

function clase(id: string, nivel: string, diaSemana: number, horaInicio: string, cuposRestantes = 12) {
  const fin = `${String(Number(horaInicio.slice(0, 2)) + 1).padStart(2, '0')}:00`;
  return { id, nivel, diaSemana, horaInicio, horaFin: fin, cuposRestantes };
}

const PLAN_2 = {
  id: P2,
  nombre: 'Plan 2 veces',
  vecesPorSemana: 2,
  clasesPorMes: 8,
  duracionMinutos: 60,
  precio: '90.00',
  diasPermitidos: [1, 3, 5],
  franjasPermitidas: ['17:00', '18:00'],
  nivelesAplicables: ['BASICO', 'INTERMEDIO'],
};
const PLAN_3 = {
  ...PLAN_2,
  id: P3,
  nombre: 'Plan 3 veces',
  vecesPorSemana: 3,
  clasesPorMes: 12,
  precio: '210.00',
  franjasPermitidas: ['18:00'],
  nivelesAplicables: ['BASICO'],
};

const CLASES = [
  clase(C_LUN_17, 'BASICO', 1, '17:00', 5),
  clase(C_LUN_18, 'BASICO', 1, '18:00', 1),
  clase(C_MIE_18, 'BASICO', 3, '18:00'),
  clase(C_VIE_18, 'BASICO', 5, '18:00'),
  clase(C_INTERMEDIO_LUN_18, 'INTERMEDIO', 1, '18:00'),
  // Fuera de la franja y fuera de los días de los planes: no se ofrecen.
  clase(C_LUN_19, 'BASICO', 1, '19:00'),
  clase(C_MAR_17, 'BASICO', 2, '17:00'),
];

function oferta(extra: Record<string, unknown> = {}) {
  return {
    academia: { nombre: NOMBRE, telefono: TELEFONO },
    mes: '2026-11',
    hoy: '2026-11-20',
    planes: [PLAN_2, PLAN_3],
    clases: CLASES,
    consentimientos: {
      version: VERSION_CONSENTIMIENTOS,
      textos: textosConsentimiento(NOMBRE, { menor: false }),
      textosMenor: textosConsentimiento(NOMBRE, { menor: true }),
    },
    ...extra,
  };
}

const COTIZACION = {
  mes: '2026-11',
  fechaInicio: '2026-11-20',
  fechaFin: '2026-11-30',
  clasesRestantes: 3,
  clasesTotales: 3,
  clasesPorMes: 8,
  precioPlan: '90.00',
  monto: '34.00',
  esProporcional: true,
};

const COTIZACION_DICIEMBRE = {
  mes: '2026-12',
  fechaInicio: '2026-12-01',
  fechaFin: '2026-12-31',
  clasesRestantes: 8,
  clasesTotales: 8,
  clasesPorMes: 8,
  precioPlan: '90.00',
  monto: '90.00',
  esProporcional: false,
};

const CREADA = {
  solicitud: {
    codigo: 'AQ-7F3K9X',
    token: TOKEN,
    enlace: `/a/delfines/solicitud/${TOKEN}`,
    estado: 'PENDIENTE_PAGO',
    reservaVenceEn: '2026-11-21T20:30:00.000Z',
    cotizacion: COTIZACION,
  },
};

const CREADA_DICIEMBRE = {
  solicitud: { ...CREADA.solicitud, reservaVenceEn: '2026-11-28T15:00:00.000Z', cotizacion: COTIZACION_DICIEMBRE },
};

const GET_ACADEMIA = 'GET /api/a/delfines';
const GET_MESES = 'GET /api/a/delfines/inscripcion/meses';
const GET_OFERTA = 'GET /api/a/delfines/inscripcion?mes=2026-11';
const GET_OFERTA_DICIEMBRE = 'GET /api/a/delfines/inscripcion?mes=2026-12';
const POST_COTIZACION = 'POST /api/a/delfines/inscripcion/cotizacion';
const POST_ENVIO = 'POST /api/a/delfines/inscripcion';
const PUT_FOTO = 'PUT /api/a/delfines/solicitudes/foto';

/** Los meses de inscripción: con la ventana cerrada, solo el mes en curso; el 26/11 de 2026 con 5 días, también diciembre. */
function meses(extra: Record<string, unknown> = {}) {
  return {
    hoy: '2026-11-20',
    meses: [{ mes: '2026-11', fechaInicio: '2026-11-20', inscripcionHasta: '2026-11-30' }],
    aperturaMesSiguiente: '2026-11-26',
    ...extra,
  };
}

function servidor(extra: Record<string, Manejador> = {}) {
  return simularApi({
    [GET_MESES]: () => ({ estado: 200, cuerpo: meses() }),
    [GET_ACADEMIA]: () => ({
      estado: 200,
      cuerpo: { nombreCorto: 'delfines', nombre: NOMBRE, telefono: TELEFONO },
    }),
    [GET_OFERTA]: () => ({ estado: 200, cuerpo: oferta() }),
    [POST_COTIZACION]: () => ({ estado: 200, cuerpo: { cotizacion: COTIZACION } }),
    [POST_ENVIO]: () => ({ estado: 201, cuerpo: CREADA }),
    [PUT_FOTO]: () => ({ estado: 204 }),
    ...extra,
  });
}

let urls: ReturnType<typeof simularUrlLocal>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  urls = simularUrlLocal();
});

// --- Ayudas para recorrer los pasos -------------------------------------------------------------------------------------------------

function escribir(etiqueta: string, valor: string) {
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });
}

async function abrir() {
  const user = userEvent.setup();
  mostrar('/a/delfines/inscripcion');
  await screen.findByRole('heading', { name: 'Datos personales' });
  return user;
}

async function siguiente(user: ReturnType<typeof userEvent.setup>, titulo: string) {
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByRole('heading', { name: titulo });
}

async function llenarDatos(user: ReturnType<typeof userEvent.setup>, fecha: string, titulo: string) {
  escribir('Nombres', 'Lucía Fernanda');
  escribir('Apellidos', 'Prado Quispe');
  escribir('DNI', '45678912');
  escribir('Fecha de nacimiento', fecha);
  escribir('Celular', '987 654 321');
  await siguiente(user, titulo);
}

async function llenarFicha(user: ReturnType<typeof userEvent.setup>, titulo: string) {
  await user.selectOptions(screen.getByLabelText('Tipo de sangre'), 'O_POSITIVO');
  escribir('Nombre del contacto', 'Marta Prado');
  escribir('Celular del contacto', '955443322');
  await siguiente(user, titulo);
}

async function llenarApoderado(user: ReturnType<typeof userEvent.setup>) {
  escribir('Nombres del apoderado', 'Marta');
  escribir('Apellidos del apoderado', 'Quispe Rojas');
  escribir('DNI del apoderado', '41234567');
  escribir('Celular del apoderado', '955443322');
  await user.selectOptions(screen.getByLabelText('Parentesco'), 'MADRE');
  await siguiente(user, 'Plan y horario');
}

async function elegirClase(user: ReturnType<typeof userEvent.setup>, dia: string, horario: RegExp) {
  await user.click(within(screen.getByRole('group', { name: dia })).getByLabelText(horario));
}

/** Plan de 2 veces, nivel Básico, lunes 17:00 y miércoles 18:00. */
async function elegirPlanDeDos(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('Nivel'), 'BASICO');
  await user.click(screen.getByLabelText(/Plan 2 veces/));
  await elegirClase(user, 'Lunes', /17:00 a 18:00/);
  await elegirClase(user, 'Miércoles', /18:00 a 19:00/);
}

/** Del paso del plan al resumen, pasando por el paso de la foto (opcional) sin elegir ninguna. */
async function pasarPorLaFotoAlResumen(user: ReturnType<typeof userEvent.setup>) {
  await siguiente(user, 'Foto (opcional)');
  await siguiente(user, 'Resumen y confirmación');
}

/** Recorre el formulario de una persona mayor de edad hasta el resumen. */
async function llegarAlResumen(user: ReturnType<typeof userEvent.setup>) {
  await llenarDatos(user, '2000-05-10', 'Ficha médica');
  await llenarFicha(user, 'Plan y horario');
  await elegirPlanDeDos(user);
  await pasarPorLaFotoAlResumen(user);
}

async function aceptarYEnviar(user: ReturnType<typeof userEvent.setup>, boton = 'Enviar inscripción') {
  await user.click(screen.getByLabelText(/Acepto el tratamiento de datos personales/));
  await user.click(screen.getByLabelText(/Acepto el deslinde de responsabilidad/));
  await user.click(screen.getByRole('button', { name: boton }));
}

function cuerpoDeEnvio(api: ReturnType<typeof simularApi>, posicion = 0) {
  return llamadas(api, POST_ENVIO)[posicion] as Record<string, unknown>;
}

function diferido() {
  let resolver: () => void = () => undefined;
  const promesa = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

// ---------------------------------------------------------------------------------------------------------------------------------

describe('Formulario de inscripción: pasos y validación (criterio 43)', () => {
  it('muestra el nombre y el teléfono de la academia y empieza por los datos personales', async () => {
    servidor();
    await abrir();
    expect(screen.getByText(NOMBRE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: TELEFONO })).toHaveAttribute('href', `tel:${TELEFONO}`);
    expect(screen.getByText('Paso 1 de 5')).toBeInTheDocument();
  });

  it('valida cada paso con los esquemas compartidos y no avanza con datos inválidos', async () => {
    servidor();
    const user = await abrir();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getAllByText('Este dato es obligatorio.')).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'Datos personales' })).toBeInTheDocument();

    escribir('Nombres', 'Lucía');
    escribir('Apellidos', 'Prado');
    escribir('DNI', '1234');
    escribir('Fecha de nacimiento', '2000-05-10');
    escribir('Celular', '812345678');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('El DNI debe tener exactamente 8 dígitos.')).toBeInTheDocument();
    expect(screen.getByText('El celular debe tener 9 dígitos y empezar con 9.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Datos personales' })).toBeInTheDocument();
  });

  it('una fecha de nacimiento futura se rechaza con la fecha de hoy que dio la API', async () => {
    servidor();
    const user = await abrir();
    escribir('Nombres', 'Lucía');
    escribir('Apellidos', 'Prado');
    escribir('DNI', '45678912');
    escribir('Fecha de nacimiento', '2026-11-21');
    escribir('Celular', '987654321');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('La fecha de nacimiento no puede ser futura.')).toBeInTheDocument();
  });

  it('el paso del apoderado aparece solo si tiene menos de 18 años en la fecha de la API (el día del cumpleaños 18 ya es mayor)', async () => {
    servidor();
    const user = await abrir();
    // Cumple 18 hoy (2026-11-20 según la API): ya es mayor, no hay paso de apoderado.
    await llenarDatos(user, '2008-11-20', 'Ficha médica');
    expect(screen.getByText('Paso 2 de 5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    // Cumple 18 mañana: todavía es menor, aparece el paso del apoderado.
    escribir('Fecha de nacimiento', '2008-11-21');
    await siguiente(user, 'Ficha médica');
    expect(screen.getByText('Paso 2 de 6')).toBeInTheDocument();
    await llenarFicha(user, 'Apoderado');
    expect(screen.getByText(/menor de 18 años/)).toBeInTheDocument();
  });

  it('exige los datos del apoderado de un menor y que su DNI no sea el de la persona que se inscribe', async () => {
    servidor();
    const user = await abrir();
    await llenarDatos(user, '2014-05-10', 'Ficha médica');
    await llenarFicha(user, 'Apoderado');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getAllByText('Este dato es obligatorio.').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('Elige una opción.')).toBeInTheDocument();

    escribir('Nombres del apoderado', 'Marta');
    escribir('Apellidos del apoderado', 'Quispe Rojas');
    escribir('DNI del apoderado', '45678912');
    escribir('Celular del apoderado', '955443322');
    await user.selectOptions(screen.getByLabelText('Parentesco'), 'MADRE');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(
      screen.getByText('El DNI del apoderado no puede ser igual al de la persona que se inscribe.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Apoderado' })).toBeInTheDocument();
  });

  it('ofrece solo los planes del nivel y solo las clases del nivel con cupo, en los días y franjas del plan, con sus cupos', async () => {
    servidor();
    const user = await abrir();
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');

    // Sin nivel no hay planes. Con Avanzado no aplica ninguno.
    expect(screen.queryByLabelText(/Plan 2 veces/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Nivel'), 'AVANZADO');
    expect(screen.getByText(/Por ahora no hay planes para este nivel/)).toBeInTheDocument();

    // Intermedio: solo el plan de 2 veces.
    await user.selectOptions(screen.getByLabelText('Nivel'), 'INTERMEDIO');
    expect(screen.getByLabelText(/Plan 2 veces/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Plan 3 veces/)).not.toBeInTheDocument();

    // Básico: los dos planes. Con el de 2 veces, las clases del nivel en los días y franjas del plan.
    await user.selectOptions(screen.getByLabelText('Nivel'), 'BASICO');
    expect(screen.getByLabelText(/Plan 3 veces/)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Plan 2 veces/));
    const lunes = within(screen.getByRole('group', { name: 'Lunes' }));
    expect(lunes.getByLabelText(/17:00 a 18:00/)).toHaveAccessibleName(/5 cupos/);
    expect(lunes.getByLabelText(/18:00 a 19:00/)).toHaveAccessibleName(/1 cupo\b/);
    // La de las 19:00 (fuera de franja), la del martes (fuera de días) y la de otro nivel no se ofrecen.
    expect(lunes.queryByLabelText(/19:00 a 20:00/)).not.toBeInTheDocument();
    expect(lunes.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('group', { name: 'Martes' })).not.toBeInTheDocument();
  });

  it('elige una clase por día y tantas como las veces por semana del plan, mostrando cuántas lleva', async () => {
    servidor();
    const user = await abrir();
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await user.selectOptions(screen.getByLabelText('Nivel'), 'BASICO');
    await user.click(screen.getByLabelText(/Plan 2 veces/));
    expect(screen.getByText('Elegiste 0 de 2.')).toBeInTheDocument();

    const lunes = within(screen.getByRole('group', { name: 'Lunes' }));
    await user.click(lunes.getByLabelText(/17:00 a 18:00/));
    await user.click(lunes.getByLabelText(/18:00 a 19:00/));
    // Otra del mismo día reemplaza a la anterior.
    expect(lunes.getByLabelText(/17:00 a 18:00/)).not.toBeChecked();
    expect(lunes.getByLabelText(/18:00 a 19:00/)).toBeChecked();
    expect(screen.getByText('Elegiste 1 de 2.')).toBeInTheDocument();

    await elegirClase(user, 'Miércoles', /18:00 a 19:00/);
    expect(screen.getByText('Elegiste 2 de 2.')).toBeInTheDocument();
    // Con las dos elegidas, el viernes ya no se puede marcar hasta quitar una.
    expect(within(screen.getByRole('group', { name: 'Viernes' })).getByLabelText(/18:00 a 19:00/)).toBeDisabled();
    await elegirClase(user, 'Miércoles', /18:00 a 19:00/);
    expect(within(screen.getByRole('group', { name: 'Viernes' })).getByLabelText(/18:00 a 19:00/)).toBeEnabled();
  });

  it('pide el nivel, el plan y todas las clases antes de seguir', async () => {
    servidor();
    const user = await abrir();
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Elige tu nivel.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Nivel'), 'BASICO');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Elige un plan.')).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Plan 2 veces/));
    await elegirClase(user, 'Lunes', /17:00 a 18:00/);
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Elige 2 clases, una por día.')).toBeInTheDocument();
  });

  it('cambiar el nivel o el plan limpia lo elegido', async () => {
    servidor();
    const user = await abrir();
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await user.selectOptions(screen.getByLabelText('Nivel'), 'BASICO');
    await user.click(screen.getByLabelText(/Plan 2 veces/));
    await elegirClase(user, 'Lunes', /17:00 a 18:00/);
    await user.click(screen.getByLabelText(/Plan 3 veces/));
    expect(screen.getByText('Elegiste 0 de 3.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Nivel'), 'INTERMEDIO');
    expect(screen.queryByText(/Elegiste/)).not.toBeInTheDocument();
  });
});

describe('Formulario de inscripción: cotización y envío (criterio 43)', () => {
  it('pide la cotización con el plan, el nivel y las clases, y muestra el monto en soles, el proporcional, el IGV y los consentimientos', async () => {
    const api = servidor();
    const user = await abrir();
    await llegarAlResumen(user);

    expect(llamadas(api, POST_COTIZACION)).toEqual([
      { planId: P2, nivel: 'BASICO', claseIds: [C_LUN_17, C_MIE_18], mes: '2026-11' },
    ]);
    const monto = screen.getByRole('region', { name: 'Monto a pagar' });
    expect(within(monto).getByText('S/ 34.00')).toBeInTheDocument();
    expect(within(monto).getByText(/Proporcional: 3 de 8 clases/)).toBeInTheDocument();
    expect(within(monto).getByText('El precio ya incluye IGV.')).toBeInTheDocument();
    expect(screen.getByText('Lucía Fernanda Prado Quispe')).toBeInTheDocument();
    expect(screen.getByText(textosConsentimiento(NOMBRE, { menor: false }).DATOS_PERSONALES)).toBeInTheDocument();
    expect(screen.getByText(textosConsentimiento(NOMBRE, { menor: false }).DESLINDE)).toBeInTheDocument();
    expect(screen.getByLabelText('Autorizo el uso de imagen (opcional)')).not.toBeChecked();
  });

  it('un mes completo no se muestra como proporcional', async () => {
    servidor({
      [POST_COTIZACION]: () => ({
        estado: 200,
        cuerpo: {
          cotizacion: { ...COTIZACION, clasesRestantes: 8, clasesTotales: 8, monto: '90.00', esProporcional: false },
        },
      }),
    });
    const user = await abrir();
    await llegarAlResumen(user);
    const monto = screen.getByRole('region', { name: 'Monto a pagar' });
    expect(within(monto).getByText('S/ 90.00')).toBeInTheDocument();
    expect(within(monto).queryByText(/Proporcional/)).not.toBeInTheDocument();
  });

  it('exige aceptar los dos consentimientos obligatorios; el de imagen es opcional', async () => {
    const api = servidor();
    const user = await abrir();
    await llegarAlResumen(user);
    await user.click(screen.getByRole('button', { name: 'Enviar inscripción' }));
    expect(screen.getByText('Debes aceptar el tratamiento de datos personales.')).toBeInTheDocument();
    expect(screen.getByText('Debes aceptar el deslinde de responsabilidad.')).toBeInTheDocument();
    expect(llamadas(api, POST_ENVIO)).toHaveLength(0);
  });

  it('envía el formulario con la clave de idempotencia, el mes y el monto de la cotización y la versión de los textos, y muestra el código y el enlace', async () => {
    const api = servidor();
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);

    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
    const cuerpo = cuerpoDeEnvio(api);
    expect(cuerpo['claveIdempotencia']).toMatch(/^[0-9a-f-]{36}$/);
    expect(cuerpo['alumno']).toEqual({
      nombres: 'Lucía Fernanda',
      apellidos: 'Prado Quispe',
      dni: '45678912',
      fechaNacimiento: '2000-05-10',
      telefono: '987654321',
      nivel: 'BASICO',
    });
    expect(cuerpo['fichaMedica']).toEqual({
      tipoSangre: 'O_POSITIVO',
      contactoEmergencia: { nombre: 'Marta Prado', telefono: '955443322' },
    });
    expect(cuerpo['apoderado']).toBeUndefined();
    expect(cuerpo['inscripcion']).toEqual({
      planId: P2,
      claseIds: [C_LUN_17, C_MIE_18],
      mes: '2026-11',
      montoMostrado: '34.00',
    });
    expect(cuerpo['consentimientos']).toEqual({
      version: VERSION_CONSENTIMIENTOS,
      datosPersonales: true,
      deslinde: true,
      imagen: false,
    });

    expect(screen.getByText('AQ-7F3K9X')).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/a/delfines/solicitud/${TOKEN}`)).toBeInTheDocument();
    expect(screen.getByText(/Guarda tu código y tu enlace/)).toBeInTheDocument();
    // El cupo vence el 21/11 a las 15:30 en Lima (20:30 UTC).
    expect(screen.getByText(/21\/11\/2026 15:30/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver el seguimiento de mi solicitud' })).toHaveAttribute(
      'href',
      `/a/delfines/solicitud/${TOKEN}`,
    );
    // El token no se guarda en el navegador.
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    expect(document.cookie).not.toContain(TOKEN);
  });

  it('copia el código y el enlace', async () => {
    servidor();
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);
    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });

    await user.click(screen.getByRole('button', { name: 'Copiar código' }));
    expect(await navigator.clipboard.readText()).toBe('AQ-7F3K9X');
    await user.click(screen.getByRole('button', { name: 'Copiar enlace' }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/a/delfines/solicitud/${TOKEN}`);
    expect(screen.getAllByText('Copiado').length).toBeGreaterThan(0);
  });

  it('un menor envía los datos del apoderado y ve los textos que acepta el apoderado', async () => {
    const api = servidor();
    const user = await abrir();
    await llenarDatos(user, '2014-05-10', 'Ficha médica');
    await llenarFicha(user, 'Apoderado');
    await llenarApoderado(user);
    await elegirPlanDeDos(user);
    await pasarPorLaFotoAlResumen(user);
    expect(screen.getByText(textosConsentimiento(NOMBRE, { menor: true }).DATOS_PERSONALES)).toBeInTheDocument();
    await user.click(
      screen.getByLabelText(/Acepto, como padre, madre o apoderado, el tratamiento de datos personales/),
    );
    await user.click(screen.getByLabelText(/Acepto, como padre, madre o apoderado, el deslinde de responsabilidad/));
    await user.click(screen.getByRole('button', { name: 'Enviar inscripción' }));
    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
    expect(cuerpoDeEnvio(api)['apoderado']).toEqual({
      nombres: 'Marta',
      apellidos: 'Quispe Rojas',
      dni: '41234567',
      telefono: '955443322',
      parentesco: 'MADRE',
    });
  });

  it('desactiva el envío mientras espera y un segundo clic no envía otra vez', async () => {
    const espera = diferido();
    const api = servidor({
      [POST_ENVIO]: async () => {
        await espera.promesa;
        return { estado: 201, cuerpo: CREADA };
      },
    });
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);
    const boton = await screen.findByRole('button', { name: 'Enviando…' });
    expect(boton).toBeDisabled();
    fireEvent.submit(boton.closest('form') as HTMLFormElement);
    await user.click(boton);
    expect(llamadas(api, POST_ENVIO)).toHaveLength(1);
    espera.resolver();
    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
    expect(llamadas(api, POST_ENVIO)).toHaveLength(1);
  });

  it('un 400 del servidor marca el campo y lleva al paso que corresponde', async () => {
    servidor({
      [POST_ENVIO]: () =>
        error('SOLICITUD_INVALIDA', 400, { errores: [{ campo: 'alumno.dni', mensaje: 'El DNI no es válido.' }] }),
    });
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);
    await screen.findByRole('heading', { name: 'Datos personales' });
    expect(screen.getByText('El DNI no es válido.')).toBeInTheDocument();
    expect(screen.getByText('Revisa los datos marcados en rojo.')).toBeInTheDocument();
  });
});

describe('Formulario de inscripción: respuestas de la API que piden otra decisión (criterio 43)', () => {
  it('SIN_CUPO: marca las clases llenas, vuelve a pedir la oferta y pide otra opción', async () => {
    let ofertas = 0;
    const api = servidor({
      [GET_OFERTA]: () => {
        ofertas += 1;
        // Al volver a pedirla, la clase del lunes 17:00 ya no tiene cupo.
        return {
          estado: 200,
          cuerpo: oferta(ofertas > 1 ? { clases: CLASES.filter((c) => c.id !== C_LUN_17) } : {}),
        };
      },
      [POST_ENVIO]: () => error('SIN_CUPO', 409, { clasesSinCupo: [C_LUN_17] }),
    });
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);

    await screen.findByRole('heading', { name: 'Plan y horario' });
    expect(screen.getByText('Se llenó: Lunes 17:00 a 18:00. Elige otra opción.')).toBeInTheDocument();
    await waitFor(() => expect(llamadas(api, GET_OFERTA)).toHaveLength(2));
    const lunes = within(screen.getByRole('group', { name: 'Lunes' }));
    expect(lunes.getByLabelText(/17:00 a 18:00/)).toBeDisabled();
    expect(lunes.getByLabelText(/17:00 a 18:00/)).toHaveAccessibleName(/Llena/);
    // Sigue elegida la del miércoles; la llena se quitó de la selección.
    expect(screen.getByText('Elegiste 1 de 2.')).toBeInTheDocument();
    await elegirClase(user, 'Lunes', /18:00 a 19:00/);
    await pasarPorLaFotoAlResumen(user);
    expect(llamadas(api, POST_COTIZACION)).toHaveLength(2);
    expect(llamadas(api, POST_COTIZACION)[1]).toEqual({
      planId: P2,
      nivel: 'BASICO',
      claseIds: [C_MIE_18, C_LUN_18],
      mes: '2026-11',
    });
  });

  it('MONTO_CAMBIO: muestra el monto nuevo y pide confirmar antes de enviar otra vez, con la misma clave', async () => {
    let envios = 0;
    const api = servidor({
      [POST_ENVIO]: () => {
        envios += 1;
        return envios === 1
          ? error('MONTO_CAMBIO', 409, { cotizacion: { ...COTIZACION, monto: '36.00', precioPlan: '96.00' } })
          : { estado: 201, cuerpo: CREADA };
      },
    });
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);

    const aviso = await screen.findByRole('status');
    expect(aviso).toHaveTextContent('Antes: S/ 34.00. Ahora: S/ 36.00.');
    expect(within(screen.getByRole('region', { name: 'Monto a pagar' })).getByText('S/ 36.00')).toBeInTheDocument();
    // No se envió solo: hay que confirmar.
    expect(llamadas(api, POST_ENVIO)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Confirmar el nuevo monto y enviar' }));
    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
    expect(cuerpoDeEnvio(api, 1)['inscripcion']).toMatchObject({ montoMostrado: '36.00' });
    expect(cuerpoDeEnvio(api, 1)['claveIdempotencia']).toBe(cuerpoDeEnvio(api, 0)['claveIdempotencia']);
  });

  it('MES_CAMBIO con un solo mes: pide los meses y la oferta otra vez y pide elegir el plan y las clases de nuevo', async () => {
    let pedidosDeMeses = 0;
    let envios = 0;
    const api = servidor({
      [GET_MESES]: () => {
        pedidosDeMeses += 1;
        return {
          estado: 200,
          cuerpo:
            pedidosDeMeses === 1
              ? meses()
              : meses({
                  hoy: '2026-12-01',
                  meses: [{ mes: '2026-12', fechaInicio: '2026-12-01', inscripcionHasta: '2026-12-31' }],
                  aperturaMesSiguiente: '2026-12-27',
                }),
        };
      },
      [GET_OFERTA_DICIEMBRE]: () => ({ estado: 200, cuerpo: oferta({ mes: '2026-12', hoy: '2026-12-01' }) }),
      [POST_COTIZACION]: (cuerpo) => ({
        estado: 200,
        cuerpo: { cotizacion: (cuerpo as { mes?: string }).mes === '2026-12' ? COTIZACION_DICIEMBRE : COTIZACION },
      }),
      [POST_ENVIO]: () => {
        envios += 1;
        return envios === 1 ? error('MES_CAMBIO', 409, { mes: '2026-12' }) : { estado: 201, cuerpo: CREADA_DICIEMBRE };
      },
    });
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);

    // Sin mes que elegir (un solo mes), vuelve al plan con la oferta de diciembre y nada elegido.
    await screen.findByRole('heading', { name: 'Plan y horario' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cambió el mes desde que empezaste la inscripción. Elige otra vez el plan y las clases.',
    );
    expect(llamadas(api, GET_MESES)).toHaveLength(2);
    await waitFor(() => expect(llamadas(api, GET_OFERTA_DICIEMBRE)).toHaveLength(1));
    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    expect(llamadas(api, POST_ENVIO)).toHaveLength(1);

    await user.click(await screen.findByLabelText(/Plan 2 veces/));
    await elegirClase(user, 'Lunes', /17:00 a 18:00/);
    await elegirClase(user, 'Miércoles', /18:00 a 19:00/);
    await pasarPorLaFotoAlResumen(user);
    expect(llamadas(api, POST_COTIZACION)[1]).toMatchObject({ mes: '2026-12' });
    expect(screen.getByText('Diciembre de 2026, desde el 1/12')).toBeInTheDocument();
    // Los consentimientos que ya aceptó siguen aceptados: solo falta enviar.
    await user.click(screen.getByRole('button', { name: 'Enviar inscripción' }));
    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
    expect(cuerpoDeEnvio(api, 1)['inscripcion']).toMatchObject({ mes: '2026-12', montoMostrado: '90.00' });
  });

  it('TEXTOS_ACTUALIZADOS: muestra los textos nuevos, pide aceptarlos otra vez y envía con la versión nueva', async () => {
    let envios = 0;
    const nuevos = { ...textosConsentimiento(NOMBRE, { menor: false }), DESLINDE: 'Texto nuevo del deslinde.' };
    const api = servidor({
      [POST_ENVIO]: () => {
        envios += 1;
        return envios === 1
          ? error('TEXTOS_ACTUALIZADOS', 409, { version: '2026-12-v2', textos: nuevos })
          : { estado: 201, cuerpo: CREADA };
      },
    });
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);

    expect(await screen.findByText('Texto nuevo del deslinde.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Mensaje de TEXTOS_ACTUALIZADOS');
    expect(screen.getByLabelText(/Acepto el tratamiento de datos personales/)).not.toBeChecked();
    expect(screen.getByLabelText(/Acepto el deslinde de responsabilidad/)).not.toBeChecked();
    await aceptarYEnviar(user);
    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
    expect(cuerpoDeEnvio(api, 1)['consentimientos']).toMatchObject({ version: '2026-12-v2' });
  });

  it('DNI_YA_REGISTRADO: un mensaje claro con el teléfono de la academia y la consulta con código y DNI', async () => {
    servidor({ [POST_ENVIO]: () => error('DNI_YA_REGISTRADO', 409) });
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Mensaje de DNI_YA_REGISTRADO');
    expect(alerta).toHaveTextContent(`llama a la academia al ${TELEFONO}`);
    expect(screen.getByRole('link', { name: /Consultar mi solicitud/ })).toHaveAttribute(
      'href',
      '/a/delfines/solicitud',
    );
    // El formulario sigue con lo escrito: se puede corregir el DNI.
    expect(screen.getByRole('button', { name: 'Enviar inscripción' })).toBeEnabled();
  });

  it('SOLICITUD_YA_REGISTRADA: dice el código para seguirla con el DNI', async () => {
    servidor({ [POST_ENVIO]: () => error('SOLICITUD_YA_REGISTRADA', 409, { codigo: 'AQ-7F3K9X' }) });
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Tu solicitud ya se registró. Tu código es AQ-7F3K9X.');
    expect(screen.getByRole('link', { name: /Consultar mi solicitud/ })).toBeInTheDocument();
  });

  it('LIMITE_DE_RESERVAS_PENDIENTES y 429: un mensaje claro con el teléfono de la academia', async () => {
    let respuesta = error('LIMITE_DE_RESERVAS_PENDIENTES', 409);
    servidor({ [POST_ENVIO]: () => respuesta });
    const user = await abrir();
    await llegarAlResumen(user);
    await aceptarYEnviar(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(`llama a la academia al ${TELEFONO}`);

    respuesta = error('DEMASIADAS_SOLICITUDES', 429);
    await user.click(screen.getByRole('button', { name: 'Enviar inscripción' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Hiciste demasiados envíos'));
    expect(screen.getByRole('alert')).toHaveTextContent(`llama a la academia al ${TELEFONO}`);
  });

  it('SELECCION_NO_VALIDA en la cotización: vuelve al paso de las clases con el mensaje', async () => {
    const api = servidor({ [POST_COTIZACION]: () => error('SELECCION_NO_VALIDA', 409) });
    const user = await abrir();
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await elegirPlanDeDos(user);
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mensaje de SELECCION_NO_VALIDA');
    expect(screen.getByRole('heading', { name: 'Plan y horario' })).toBeInTheDocument();
    await waitFor(() => expect(llamadas(api, GET_OFERTA)).toHaveLength(2));
  });

  it('SIN_CLASES_EN_EL_MES: avisa desde qué fecha se abre el mes siguiente y no pasa al resumen (DR-4)', async () => {
    servidor({ [POST_COTIZACION]: () => error('SIN_CLASES_EN_EL_MES', 409) });
    const user = await abrir();
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await elegirPlanDeDos(user);
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Ya no quedan clases este mes con las clases elegidas.');
    expect(alerta).toHaveTextContent('Las inscripciones para diciembre se abren el 26/11.');
    expect(alerta).not.toHaveTextContent('Vuelve el primer día');
    expect(screen.queryByRole('heading', { name: 'Resumen y confirmación' })).not.toBeInTheDocument();
  });

  it('SIN_CLASES_EN_EL_MES sin mes siguiente a la vista ni fecha de apertura: muestra el mensaje de la API', async () => {
    servidor({
      [GET_MESES]: () => ({ estado: 200, cuerpo: meses({ aperturaMesSiguiente: null }) }),
      [POST_COTIZACION]: () => error('SIN_CLASES_EN_EL_MES', 409),
    });
    const user = await abrir();
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await elegirPlanDeDos(user);
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mensaje de SIN_CLASES_EN_EL_MES');
  });
});

describe('Formulario de inscripción: academia y errores de carga', () => {
  it('una academia que no existe muestra un mensaje en lugar del formulario', async () => {
    simularApi({ [GET_ACADEMIA]: () => error('ACADEMIA_NO_ENCONTRADA', 404) });
    mostrar('/a/delfines/inscripcion');
    expect(await screen.findByText(/No encontramos esa academia/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Datos personales' })).not.toBeInTheDocument();
  });

  it('una academia suspendida muestra que no está disponible', async () => {
    simularApi({ [GET_ACADEMIA]: () => error('ACADEMIA_SUSPENDIDA', 403) });
    mostrar('/a/delfines/inscripcion');
    expect(await screen.findByText('Academia no disponible por el momento.')).toBeInTheDocument();
  });

  it('si la oferta no carga, ofrece reintentar', async () => {
    let intentos = 0;
    servidor({
      [GET_OFERTA]: () => {
        intentos += 1;
        return intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: oferta() };
      },
    });
    const user = userEvent.setup();
    mostrar('/a/delfines/inscripcion');
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Datos personales' })).toBeInTheDocument();
  });
});

describe('Formulario de inscripción: paso de la foto (criterio 43, 005b)', () => {
  /** Como `abrir`, pero el selector de archivos no filtra por `accept`: así se prueba el aviso con un tipo que el navegador no ofrecería. */
  async function abrirEnLaFoto() {
    const user = userEvent.setup({ applyAccept: false });
    mostrar('/a/delfines/inscripcion');
    await screen.findByRole('heading', { name: 'Datos personales' });
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await elegirPlanDeDos(user);
    await siguiente(user, 'Foto (opcional)');
    return user;
  }

  const entradaDeFoto = () => screen.getByLabelText(/Elegir (una|otra) foto|Cambiar la foto/);

  it('va entre el plan y el resumen, es opcional y se puede seguir sin foto', async () => {
    const api = servidor();
    const user = await abrirEnLaFoto();
    expect(screen.getByText('Paso 4 de 5')).toBeInTheDocument();
    expect(screen.getByText(/Es opcional/)).toBeInTheDocument();
    expect(entradaDeFoto()).toHaveAttribute('accept', 'image/jpeg,image/png');
    await siguiente(user, 'Resumen y confirmación');
    await aceptarYEnviar(user);
    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
    // Sin foto elegida, no se llama a la API de la foto.
    expect(peticiones(api, PUT_FOTO)).toHaveLength(0);
    expect(screen.queryByText(/Subiendo tu foto/)).not.toBeInTheDocument();
  });

  it('avisa, sin llamar a la API, si el archivo no es JPG ni PNG', async () => {
    const api = servidor();
    const user = await abrirEnLaFoto();
    await user.upload(entradaDeFoto(), archivoDePrueba('foto.gif', 'image/gif'));
    expect(screen.getByRole('alert')).toHaveTextContent('La foto debe ser un archivo JPG o PNG.');
    expect(screen.queryByAltText('Vista previa de la foto elegida')).not.toBeInTheDocument();
    expect(urls.crear).not.toHaveBeenCalled();
    expect(peticiones(api, PUT_FOTO)).toHaveLength(0);
    // Se sigue sin foto.
    await siguiente(user, 'Resumen y confirmación');
  });

  it('avisa, sin llamar a la API, si pasa de 5 MB: 5 242 880 bytes pasan y 5 242 881 no', async () => {
    const api = servidor();
    const user = await abrirEnLaFoto();
    await user.upload(entradaDeFoto(), archivoDePrueba('grande.png', 'image/png', FOTO_TAMANO_MAXIMO + 1));
    expect(screen.getByRole('alert')).toHaveTextContent('La foto pesa más de 5 MB.');
    expect(screen.queryByAltText('Vista previa de la foto elegida')).not.toBeInTheDocument();

    await user.upload(entradaDeFoto(), archivoDePrueba('justa.png', 'image/png', FOTO_TAMANO_MAXIMO));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByAltText('Vista previa de la foto elegida')).toBeInTheDocument();
    expect(peticiones(api, PUT_FOTO)).toHaveLength(0);
  });

  it('muestra una vista previa con una dirección local y la libera al cambiar de foto, al quitarla y al salir', async () => {
    servidor();
    const user = await abrirEnLaFoto();
    await user.upload(entradaDeFoto(), archivoDePrueba('uno.jpg', 'image/jpeg'));
    expect(screen.getByAltText('Vista previa de la foto elegida')).toHaveAttribute('src', 'blob:prueba-1');
    expect(screen.getByText('uno.jpg')).toBeInTheDocument();

    await user.upload(entradaDeFoto(), archivoDePrueba('dos.png', 'image/png'));
    expect(urls.liberar).toHaveBeenCalledWith('blob:prueba-1');
    expect(screen.getByAltText('Vista previa de la foto elegida')).toHaveAttribute('src', 'blob:prueba-2');

    await user.click(screen.getByRole('button', { name: 'Quitar la foto' }));
    expect(urls.liberar).toHaveBeenCalledWith('blob:prueba-2');
    expect(screen.queryByAltText('Vista previa de la foto elegida')).not.toBeInTheDocument();

    await user.upload(entradaDeFoto(), archivoDePrueba('tres.png', 'image/png'));
    expect(urls.liberar).not.toHaveBeenCalledWith('blob:prueba-3');
    cleanup();
    expect(urls.liberar).toHaveBeenCalledWith('blob:prueba-3');
  });

  it('la foto elegida se conserva al volver desde el resumen', async () => {
    const api = servidor();
    const user = await abrirEnLaFoto();
    await user.upload(entradaDeFoto(), archivoDePrueba('uno.jpg', 'image/jpeg'));
    await siguiente(user, 'Resumen y confirmación');
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    await screen.findByRole('heading', { name: 'Foto (opcional)' });
    expect(screen.getByAltText('Vista previa de la foto elegida')).toBeInTheDocument();
    expect(peticiones(api, PUT_FOTO)).toHaveLength(0);
  });

  it('después del 201 sube la foto una sola vez, con su tipo y el token en X-Token-Solicitud, y muestra el código y el enlace', async () => {
    const api = servidor();
    const user = await abrirEnLaFoto();
    const foto = archivoDePrueba('uno.png', 'image/png', 2048);
    await user.upload(entradaDeFoto(), foto);
    await siguiente(user, 'Resumen y confirmación');
    await aceptarYEnviar(user);

    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
    await screen.findByText('Foto cargada.');
    const subidas = peticiones(api, PUT_FOTO);
    expect(subidas).toHaveLength(1);
    const subida = subidas[0] as RequestInit;
    expect(subida.body).toBe(foto);
    expect(subida.headers).toMatchObject({ 'Content-Type': 'image/png', [CABECERA_TOKEN_SOLICITUD]: TOKEN });
    // El token solo va en la cabecera: no en la dirección, y no se guarda en el navegador.
    for (const [url] of api.mock.calls) expect(String(url)).not.toContain(TOKEN);
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    expect(document.cookie).not.toContain(TOKEN);
    // El envío del formulario no lleva la foto.
    expect(JSON.stringify(cuerpoDeEnvio(api))).not.toContain('uno.png');
    expect(screen.getByText('AQ-7F3K9X')).toBeInTheDocument();
  });

  it('un JPG se sube con image/jpeg', async () => {
    const api = servidor();
    const user = await abrirEnLaFoto();
    await user.upload(entradaDeFoto(), archivoDePrueba('uno.jpg', 'image/jpeg'));
    await siguiente(user, 'Resumen y confirmación');
    await aceptarYEnviar(user);
    await screen.findByText('Foto cargada.');
    expect((peticiones(api, PUT_FOTO)[0] as RequestInit).headers).toMatchObject({ 'Content-Type': 'image/jpeg' });
  });

  it.each([
    ['400 IMAGEN_NO_VALIDA', () => error('IMAGEN_NO_VALIDA', 400)],
    ['413 CARGA_EXCESIVA', () => error('CARGA_EXCESIVA', 413)],
    ['429 DEMASIADAS_SOLICITUDES', () => error('DEMASIADAS_SOLICITUDES', 429)],
    ['500', () => error('ERROR_INTERNO', 500)],
  ])(
    'si la foto falla (%s), la solicitud quedó creada: muestra el código y el enlace y avisa que la foto se sube desde el seguimiento',
    async (_nombre, respuesta) => {
      const api = servidor({ [PUT_FOTO]: respuesta });
      const user = await abrirEnLaFoto();
      await user.upload(entradaDeFoto(), archivoDePrueba('uno.png', 'image/png'));
      await siguiente(user, 'Resumen y confirmación');
      await aceptarYEnviar(user);

      await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Tu solicitud quedó creada, pero no pudimos subir la foto.');
      expect(alerta).toHaveTextContent('desde el enlace de seguimiento');
      expect(alerta).toHaveTextContent(`llama a la academia al ${TELEFONO}`);
      expect(screen.getByText('AQ-7F3K9X')).toBeInTheDocument();
      expect(screen.getByText(`${window.location.origin}/a/delfines/solicitud/${TOKEN}`)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Ver el seguimiento de mi solicitud' })).toBeInTheDocument();
      // Un solo intento: no hay reintentos automáticos de la subida.
      expect(peticiones(api, PUT_FOTO)).toHaveLength(1);
    },
  );

  it('si la red falla al subir la foto, también muestra el código y el enlace', async () => {
    servidor();
    const original = globalThis.fetch;
    const user = await abrirEnLaFoto();
    await user.upload(entradaDeFoto(), archivoDePrueba('uno.png', 'image/png'));
    await siguiente(user, 'Resumen y confirmación');
    const conRedCaida = (url: string, opciones?: RequestInit) =>
      opciones?.method === 'PUT' ? Promise.reject(new TypeError('red')) : original(url, opciones);
    vi.stubGlobal('fetch', vi.fn(conRedCaida));
    await aceptarYEnviar(user);
    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
    expect(await screen.findByRole('alert')).toHaveTextContent('no pudimos subir la foto');
    expect(screen.getByText('AQ-7F3K9X')).toBeInTheDocument();
  });

  it('mientras sube, lo dice sin ocultar el código', async () => {
    const espera = diferido();
    servidor({
      [PUT_FOTO]: async () => {
        await espera.promesa;
        return { estado: 204 };
      },
    });
    const user = await abrirEnLaFoto();
    await user.upload(entradaDeFoto(), archivoDePrueba('uno.png', 'image/png'));
    await siguiente(user, 'Resumen y confirmación');
    await aceptarYEnviar(user);
    expect(await screen.findByText('Subiendo tu foto…')).toBeInTheDocument();
    expect(screen.getByText('AQ-7F3K9X')).toBeInTheDocument();
    espera.resolver();
    expect(await screen.findByText('Foto cargada.')).toBeInTheDocument();
  });
});

// --- Spec 010d, criterio 17: la inscripción al mes siguiente -----------------------------------------------------------------------

describe('Formulario de inscripción: ¿Desde cuándo? con la ventana abierta (010d, criterio 17)', () => {
  const MESES_DOS = {
    hoy: '2026-11-27',
    meses: [
      { mes: '2026-11', fechaInicio: '2026-11-27', inscripcionHasta: '2026-11-30' },
      { mes: '2026-12', fechaInicio: '2026-12-01', inscripcionHasta: '2026-11-30' },
    ],
    aperturaMesSiguiente: null,
  };
  // Los cupos de diciembre son otros (los lugares apartados de quienes ya renovaron no se ofrecen).
  const CLASES_DICIEMBRE = [
    clase(C_LUN_17, 'BASICO', 1, '17:00', 3),
    clase(C_LUN_18, 'BASICO', 1, '18:00', 1),
    clase(C_MIE_18, 'BASICO', 3, '18:00', 2),
    clase(C_VIE_18, 'BASICO', 5, '18:00', 4),
  ];

  function servidorConDosMeses(extra: Record<string, Manejador> = {}) {
    return servidor({
      [GET_MESES]: () => ({ estado: 200, cuerpo: MESES_DOS }),
      [GET_OFERTA]: () => ({ estado: 200, cuerpo: oferta({ hoy: '2026-11-27' }) }),
      [GET_OFERTA_DICIEMBRE]: () => ({
        estado: 200,
        cuerpo: oferta({ mes: '2026-12', hoy: '2026-11-27', clases: CLASES_DICIEMBRE }),
      }),
      [POST_COTIZACION]: (cuerpo) => ({
        estado: 200,
        cuerpo: { cotizacion: (cuerpo as { mes?: string }).mes === '2026-12' ? COTIZACION_DICIEMBRE : COTIZACION },
      }),
      [POST_ENVIO]: (cuerpo) => ({
        estado: 201,
        cuerpo: (cuerpo as { inscripcion: { mes: string } }).inscripcion.mes === '2026-12' ? CREADA_DICIEMBRE : CREADA,
      }),
      ...extra,
    });
  }

  async function abrirEnElMes() {
    const user = userEvent.setup();
    mostrar('/a/delfines/inscripcion');
    await screen.findByRole('heading', { name: '¿Desde cuándo?' });
    return user;
  }

  async function elegirMes(user: ReturnType<typeof userEvent.setup>, opcion: RegExp) {
    await user.click(screen.getByLabelText(opcion));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled());
    await siguiente(user, 'Datos personales');
  }

  it('el primer paso pregunta ¿Desde cuándo? con las dos opciones y la fecha límite, sin sugerir ninguna (DR-5)', async () => {
    servidorConDosMeses();
    await abrirEnElMes();
    expect(screen.getByText('Paso 1 de 6')).toBeInTheDocument();
    expect(screen.getByLabelText(/Este mes, desde hoy/)).not.toBeChecked();
    expect(screen.getByLabelText(/Diciembre completo, desde el 1/)).not.toBeChecked();
    expect(screen.getByText('Puedes elegir diciembre hasta el 30/11.')).toBeInTheDocument();
    expect(screen.queryByText(/recomend|último día|aprovech|prioridad/i)).not.toBeInTheDocument();
    // La lista de pasos de la pantalla ancha incluye el del mes.
    expect(screen.getByText('1. ¿Desde cuándo?')).toBeInTheDocument();
  });

  it('no avanza sin elegir el mes', async () => {
    servidorConDosMeses();
    const user = await abrirEnElMes();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Elige desde cuándo quieres empezar.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '¿Desde cuándo?' })).toBeInTheDocument();
  });

  it('con diciembre elegido, la oferta, los cupos, la cotización y el envío son de diciembre, y el resumen y la confirmación dicen el mes', async () => {
    const api = servidorConDosMeses();
    const user = await abrirEnElMes();
    await elegirMes(user, /Diciembre completo, desde el 1/);
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    expect(llamadas(api, GET_OFERTA_DICIEMBRE)).toHaveLength(1);
    expect(screen.getByText('Los planes y los cupos son de diciembre de 2026.')).toBeInTheDocument();
    await elegirPlanDeDos(user);
    // Los cupos son los de diciembre.
    expect(within(screen.getByRole('group', { name: 'Lunes' })).getByLabelText(/17:00 a 18:00/)).toHaveAccessibleName(
      /3 cupos/,
    );
    await pasarPorLaFotoAlResumen(user);

    expect(llamadas(api, POST_COTIZACION)).toEqual([
      { planId: P2, nivel: 'BASICO', claseIds: [C_LUN_17, C_MIE_18], mes: '2026-12' },
    ]);
    const resumen = screen.getByRole('region', { name: 'Lo que elegiste' });
    expect(within(resumen).getByText('Diciembre de 2026, desde el 1/12')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Monto a pagar' })).getByText('Monto a pagar por diciembre de 2026'),
    ).toBeInTheDocument();

    await aceptarYEnviar(user);
    await screen.findByRole('heading', { name: 'Tu solicitud quedó registrada' });
    expect(cuerpoDeEnvio(api)['inscripcion']).toMatchObject({ mes: '2026-12', montoMostrado: '90.00' });
    expect(screen.getByText('Diciembre de 2026, desde el 1/12')).toBeInTheDocument();
    expect(llamadas(api, GET_OFERTA)).toHaveLength(0);
  });

  it('con este mes elegido, pide la oferta de este mes y lo dice en el resumen con la fecha de hoy', async () => {
    const api = servidorConDosMeses();
    const user = await abrirEnElMes();
    await elegirMes(user, /Este mes, desde hoy/);
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await elegirPlanDeDos(user);
    await pasarPorLaFotoAlResumen(user);
    expect(llamadas(api, GET_OFERTA)).toHaveLength(1);
    expect(llamadas(api, POST_COTIZACION)[0]).toMatchObject({ mes: '2026-11' });
    const resumen = screen.getByRole('region', { name: 'Lo que elegiste' });
    expect(within(resumen).getByText('Noviembre de 2026, desde el 20/11')).toBeInTheDocument();
  });

  it('cambiar de mes descarta el plan, las clases y la cotización y pide la oferta del otro mes', async () => {
    const api = servidorConDosMeses();
    const user = await abrirEnElMes();
    await elegirMes(user, /Este mes, desde hoy/);
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await elegirPlanDeDos(user);
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    await screen.findByRole('heading', { name: '¿Desde cuándo?' });
    expect(screen.getByLabelText(/Este mes, desde hoy/)).toBeChecked();
    await user.click(screen.getByLabelText(/Diciembre completo, desde el 1/));
    await waitFor(() => expect(llamadas(api, GET_OFERTA_DICIEMBRE)).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled());
    await siguiente(user, 'Datos personales');
    // Lo escrito en los datos sigue ahí; el plan y las clases no.
    expect(screen.getByLabelText('Nombres')).toHaveValue('Lucía Fernanda');
    await siguiente(user, 'Ficha médica');
    await siguiente(user, 'Plan y horario');
    expect(screen.getByLabelText(/Plan 2 veces/)).not.toBeChecked();
    expect(screen.queryByText(/Elegiste/)).not.toBeInTheDocument();
  });

  it('si la oferta del mes elegido no carga, ofrece reintentar sin avanzar', async () => {
    let intentos = 0;
    servidorConDosMeses({
      [GET_OFERTA_DICIEMBRE]: () => {
        intentos += 1;
        return intentos === 1
          ? error('ERROR_INTERNO', 500)
          : { estado: 200, cuerpo: oferta({ mes: '2026-12', hoy: '2026-11-27', clases: CLASES_DICIEMBRE }) };
      },
    });
    const user = await abrirEnElMes();
    await user.click(screen.getByLabelText(/Diciembre completo, desde el 1/));
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled());
    await siguiente(user, 'Datos personales');
  });

  it('MES_CAMBIO con dos meses: pide los meses y la oferta otra vez y vuelve al paso del mes sin nada elegido', async () => {
    let pedidosDeMeses = 0;
    let envios = 0;
    const api = servidorConDosMeses({
      [GET_MESES]: () => {
        pedidosDeMeses += 1;
        return { estado: 200, cuerpo: MESES_DOS };
      },
      [POST_ENVIO]: () => {
        envios += 1;
        return envios === 1 ? error('MES_CAMBIO', 409, { mes: '2026-11' }) : { estado: 201, cuerpo: CREADA };
      },
    });
    const user = await abrirEnElMes();
    await elegirMes(user, /Diciembre completo, desde el 1/);
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await elegirPlanDeDos(user);
    await pasarPorLaFotoAlResumen(user);
    await aceptarYEnviar(user);

    await screen.findByRole('heading', { name: '¿Desde cuándo?' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cambió el mes desde que empezaste la inscripción. Elige otra vez desde cuándo quieres empezar.',
    );
    expect(pedidosDeMeses).toBe(2);
    expect(screen.getByLabelText(/Este mes, desde hoy/)).not.toBeChecked();
    expect(screen.getByLabelText(/Diciembre completo, desde el 1/)).not.toBeChecked();
    expect(llamadas(api, POST_ENVIO)).toHaveLength(1);

    // Elige otra vez y la oferta se pide de nuevo.
    await elegirMes(user, /Diciembre completo, desde el 1/);
    await waitFor(() => expect(llamadas(api, GET_OFERTA_DICIEMBRE)).toHaveLength(2));
  });

  it('SIN_CLASES_EN_EL_MES con la ventana abierta: dice que se puede elegir el mes siguiente completo', async () => {
    servidorConDosMeses({ [POST_COTIZACION]: () => error('SIN_CLASES_EN_EL_MES', 409) });
    const user = await abrirEnElMes();
    await elegirMes(user, /Este mes, desde hoy/);
    await llenarDatos(user, '2000-05-10', 'Ficha médica');
    await llenarFicha(user, 'Plan y horario');
    await elegirPlanDeDos(user);
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya no quedan clases este mes con las clases elegidas. Puedes volver al primer paso y elegir diciembre completo.',
    );
  });

  it('con un solo mes no hay paso del mes y el formulario es el de siempre', async () => {
    servidor();
    await abrir();
    expect(screen.getByText('Paso 1 de 5')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '¿Desde cuándo?' })).not.toBeInTheDocument();
  });

  it('si no cargan los meses, ofrece reintentar', async () => {
    let intentos = 0;
    servidor({
      [GET_MESES]: () => {
        intentos += 1;
        return intentos === 1 ? error('ERROR_INTERNO', 500) : { estado: 200, cuerpo: meses() };
      },
    });
    const user = userEvent.setup();
    mostrar('/a/delfines/inscripcion');
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Datos personales' })).toBeInTheDocument();
  });
});
