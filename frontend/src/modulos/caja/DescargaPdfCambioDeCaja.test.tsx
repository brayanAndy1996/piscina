// spec: 006-caja (pruebas protegidas)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sesionDe, simularApi, simularUrlLocal } from '../../pruebas-api';
import { Rutas } from '../../rutas/Rutas';

// Criterio 56 (crítico, ronda adversarial 3 de la 006b; amplía el criterio 54 b; DT-16; criterio 27 a de 003; RNF-05): la ruta `/panel/cajas/:id` no
// desmonta el detalle cuando solo cambia el id. Pasar de una caja a otra, por cualquier camino, cancela las descargas pedidas desde la anterior, no las
// entrega, y no muestra los datos de la caja nueva que estén en la caché sin pedirlos de nuevo.
//   a) Cambiar el id del detalle (enlace, `navigate` con otra dirección, "atrás" o "adelante") cancela (`abort()`) y no entrega, también durante
//      `useConfirmarSesion` (no se pide el PDF).
//   b) "Preparando el PDF…", el botón desactivado y el error de una descarga se muestran solo en su caja y su cierre.
//   c) Los avisos de la reapertura y el diálogo no pasan a otra caja.
//   d) Al entrar al detalle, también al cambiar de id sin desmontar, la página muestra "Cargando la caja…" hasta tener la respuesta de la petición hecha
//      al entrar; nunca los datos de la caché.
// La API se simula: un `fetch` retiene la respuesta del PDF (un 200 `application/pdf`) y, cuando la prueba lo pide, el `GET` de cada caja. La caja 2
// responde "Primera" la primera vez y "Segunda" las siguientes. Hay espías en `URL.createObjectURL` y en `HTMLAnchorElement.prototype.click`. La
// navegación usa el enrutador de la app en memoria.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_CAJA_1 = 'c0000000-0000-4000-8000-000000000001';
const ID_CAJA_2 = 'c0000000-0000-4000-8000-000000000002';
const ID_LUCIA = 'd1111111-1111-4111-8111-111111111111';
const LUCIA = { id: ID_LUCIA, nombres: 'Lucía', apellidos: 'Benites Rojas' };
const YO = { id: ID_YO, nombres: 'Rosa', apellidos: 'Quispe Mamani' };
const CERO = '0.00';
const MENSAJE_ERROR_PDF = 'No se pudo generar el PDF. Inténtalo de nuevo.';

function cierre(observacion: string | null, extra: Record<string, unknown> = {}) {
  return {
    numero: 1,
    cerradoPor: LUCIA,
    cerradoEn: '2026-11-02T23:05:00.000Z',
    montoInicial: '100.00',
    ingresos: { efectivo: '42.00', yape: CERO, transferencia: CERO },
    egresos: { efectivo: CERO },
    esperado: { efectivo: '142.00', yape: CERO, transferencia: CERO },
    montoDeclarado: '142.00',
    diferencia: CERO,
    resultado: 'CUADRA',
    observacion,
    tardio: false,
    movimientosHasta: 0,
    reapertura: null,
    ...extra,
  };
}

function caja(id: string, fecha: string, observacion: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    fecha,
    estado: 'CERRADA',
    deOtroDia: true,
    montoInicial: '100.00',
    abiertaPor: LUCIA,
    abiertaEn: `${fecha}T13:30:00.000Z`,
    resumen: {
      ingresos: { efectivo: '42.00', yape: CERO, transferencia: CERO },
      egresos: { efectivo: CERO },
      esperado: { efectivo: '142.00', yape: CERO, transferencia: CERO },
      ultimoMovimiento: 0,
    },
    movimientos: [],
    cierres: [cierre(observacion)],
    ...extra,
  };
}

const CAJA_1 = caja(ID_CAJA_1, '2026-11-02', 'Caja uno');
const CAJA_2_PRIMERA = caja(ID_CAJA_2, '2026-11-03', 'Primera');
const CAJA_2_SEGUNDA = caja(ID_CAJA_2, '2026-11-03', 'Segunda');
const CAJA_1_REABIERTA = caja(ID_CAJA_1, '2026-11-02', 'Caja uno', {
  estado: 'ABIERTA',
  cierres: [
    cierre('Caja uno', {
      reapertura: { reabiertaPor: YO, reabiertaEn: '2026-11-22T15:00:00.000Z', motivo: 'Faltaba registrar un gasto' },
    }),
  ],
});

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const pdfDeLaApi = () =>
  new Response('%PDF-1.3 cierre', { status: 200, headers: { 'Content-Type': 'application/pdf' } });

interface ApiDeCajas {
  /** Las peticiones del PDF: su dirección y la señal con la que se pidieron. */
  pedidosPdf: { url: string; senal: AbortSignal | null | undefined }[];
  /** Suelta (responde 200) todas las respuestas del PDF retenidas. */
  soltarPdf(): void;
  /** Cuántas veces se pidió `GET /api/cajas/{id}`. */
  pedidosDeCaja(id: string): number;
  /** Retiene las siguientes peticiones de `GET /api/cajas/{id}` hasta `soltarCajas()`. */
  retenerCajas(activo: boolean): void;
  soltarCajas(): void;
  /** Cuántas peticiones de `GET /api/sesion` hay retenidas. */
  sesionesRetenidas(): number;
  retenerSesion(activo: boolean): void;
  soltarSesion(): void;
  /** Con un estado, el PDF responde enseguida con un error de ese estado, sin retenerlo. */
  estadoDelPdf: number | null;
  /** Lo que responde `GET /api/cajas/{id}` de la caja 1 a partir de ahora. */
  cajaUno: () => unknown;
  /** Las veces que se llamó a `POST /api/cajas/{id}/reapertura`. */
  reaperturas: string[];
}

/** La API simulada: la sesión de un ADMIN, dos cajas cerradas con un cierre cada una y el PDF retenido. */
function montarApi(): ApiDeCajas {
  const base = simularApi({
    'GET /api/mi-academia': () => ({
      estado: 200,
      cuerpo: { academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null } },
    }),
    'GET /api/cajas': () => ({ estado: 200, cuerpo: { desde: '2026-10-23', hasta: '2026-11-22', cajas: [] } }),
  });
  const pedidosPdf: ApiDeCajas['pedidosPdf'] = [];
  const pdfRetenidos: (() => void)[] = [];
  const cajasPendientes: (() => void)[] = [];
  const sesionesPendientes: (() => void)[] = [];
  const pedidos: Record<string, number> = {};
  let retenerLasCajas = false;
  let retenerLaSesion = false;
  const reaperturas: string[] = [];
  const api: ApiDeCajas = {
    pedidosPdf,
    soltarPdf: () => {
      for (const soltar of pdfRetenidos.splice(0)) soltar();
    },
    pedidosDeCaja: (id) => pedidos[id] ?? 0,
    retenerCajas: (activo) => {
      retenerLasCajas = activo;
    },
    soltarCajas: () => {
      for (const soltar of cajasPendientes.splice(0)) soltar();
    },
    sesionesRetenidas: () => sesionesPendientes.length,
    retenerSesion: (activo) => {
      retenerLaSesion = activo;
    },
    soltarSesion: () => {
      for (const soltar of sesionesPendientes.splice(0)) soltar();
    },
    estadoDelPdf: null,
    cajaUno: () => CAJA_1,
    reaperturas,
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opciones?: RequestInit) => {
      const metodo = opciones?.method ?? 'GET';
      if (metodo === 'GET' && url === '/api/sesion') {
        const respuesta = () => json(sesionDe('ADMIN', { id: ID_YO }));
        if (!retenerLaSesion) return Promise.resolve(respuesta());
        return new Promise<Response>((resolver) => {
          sesionesPendientes.push(() => resolver(respuesta()));
        });
      }
      const datosDeCaja = /^\/api\/cajas\/([^/]+)$/.exec(url);
      if (metodo === 'GET' && datosDeCaja) {
        const id = datosDeCaja[1] as string;
        pedidos[id] = (pedidos[id] ?? 0) + 1;
        const cuerpo = () => {
          if (id === ID_CAJA_1) return { caja: api.cajaUno() };
          return { caja: pedidos[id] === 1 ? CAJA_2_PRIMERA : CAJA_2_SEGUNDA };
        };
        if (!retenerLasCajas) return Promise.resolve(json(cuerpo()));
        return new Promise<Response>((resolver) => {
          cajasPendientes.push(() => resolver(json(cuerpo())));
        });
      }
      if (metodo === 'POST' && url === `/api/cajas/${ID_CAJA_1}/reapertura`) {
        reaperturas.push(url);
        api.cajaUno = () => CAJA_1_REABIERTA;
        return Promise.resolve(json({ caja: CAJA_1_REABIERTA }));
      }
      if (metodo === 'GET' && /\/cierres\/[^/]+\/pdf$/.test(url)) {
        const senal = opciones?.signal;
        // Un `fetch` real con una señal ya activa se rechaza enseguida, sin pedir nada al servidor: no cuenta como una petición del PDF.
        if (senal?.aborted) return Promise.reject(new DOMException('Descarga cancelada', 'AbortError'));
        pedidosPdf.push({ url, senal });
        if (api.estadoDelPdf !== null)
          return Promise.resolve(json({ codigo: 'ERROR_INTERNO', mensaje: 'x' }, api.estadoDelPdf));
        return new Promise<Response>((resolver, rechazar) => {
          pdfRetenidos.push(() => resolver(pdfDeLaApi()));
          senal?.addEventListener('abort', () => rechazar(new DOMException('Descarga cancelada', 'AbortError')), {
            once: true,
          });
        });
      }
      return base(url, opciones);
    }),
  );
  return api;
}

/** Deja pasar unos instantes (con el entorno de React al día) para comprobar que algo NO ocurre. */
async function asentar() {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await new Promise<void>((resolver) => setTimeout(resolver, 10));
    });
  }
}

type Navegar = (destino: string | number) => void;
let navegar: Navegar = () => {
  throw new Error('la web todavía no se montó');
};

/** Guarda la función `navigate` del enrutador de la app para que las pruebas recorran el historial. */
function CapturaDelEnrutador() {
  const navigate = useNavigate();
  useEffect(() => {
    navegar = (destino) => {
      act(() => {
        if (typeof destino === 'number') void navigate(destino);
        else void navigate(destino);
      });
    };
  }, [navigate]);
  return null;
}

/** La web completa en `ruta`, con el enrutador en memoria y una sola caché de consultas durante toda la prueba. */
function montar(ruta: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <Rutas />
        <CapturaDelEnrutador />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rutaDeCaja = (id: string) => `/panel/cajas/${id}`;

interface Entregas {
  crearUrl: ReturnType<typeof simularUrlLocal>['crear'];
  clicks: { descarga: string }[];
}

let entregas: Entregas;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  const { crear } = simularUrlLocal();
  const clicks: { descarga: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ descarga: this.download });
  });
  entregas = { crearUrl: crear, clicks };
});

afterEach(() => {
  vi.restoreAllMocks();
});

function exigirQueNoSeEntregoNada() {
  expect(entregas.crearUrl, 'no se llama a URL.createObjectURL').not.toHaveBeenCalled();
  expect(entregas.clicks, 'no se crea el enlace de descarga ni se hace click').toHaveLength(0);
  expect(
    screen.queryByText(/No se pudo generar el PDF/),
    'una descarga cancelada no muestra un error propio',
  ).not.toBeInTheDocument();
}

/** El botón del cierre 1 de la caja que se está viendo. */
const botonDelCierre1 = () => screen.getByRole('button', { name: 'Descargar PDF del cierre 1' });

/** Abre la caja 2 (responde "Primera" y queda en la caché), va a la lista y después a la caja 1. Historial: caja 2, lista, caja 1. */
async function abrirLaCaja2YLlegarALaCaja1() {
  montar(rutaDeCaja(ID_CAJA_2));
  expect(await screen.findByText('Primera')).toBeInTheDocument();
  navegar('/panel/cajas');
  await waitFor(() => expect(screen.queryByText('Primera')).not.toBeInTheDocument());
  navegar(rutaDeCaja(ID_CAJA_1));
  expect(await screen.findByText('Caja uno')).toBeInTheDocument();
}

/** Pulsa "Descargar PDF" en el cierre 1 de la caja que se ve y espera a que el `fetch` del PDF esté en camino. */
async function pulsarDescargar(api: ApiDeCajas) {
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole('button', { name: 'Descargar PDF del cierre 1' }));
  await waitFor(() => expect(api.pedidosPdf, 'la web debe pedir el PDF del cierre 1').toHaveLength(1));
  return usuario;
}

function senalDelPdf(api: ApiDeCajas): AbortSignal {
  const senal = api.pedidosPdf[0]?.senal;
  expect(senal, 'cada descarga tiene su AbortController y su señal va al fetch del PDF').toBeTruthy();
  return senal as AbortSignal;
}

/**
 * Lo que pasa al volver a la caja 2 (que está en la caché) con su `GET` retenido: la descarga de la caja 1 queda cancelada sin soltar nada, la página
 * pide la caja 2 otra vez y no muestra "Primera" ni botones hasta tener la respuesta; al soltarla, ve "Segunda" con el botón habilitado; y el PDF
 * de la caja 1, al soltarlo, no se entrega.
 */
async function exigirElCambioALaCaja2(api: ApiDeCajas, senal: AbortSignal, pedidosPrevios: number) {
  await waitFor(() => expect(senal.aborted, 'cambiar de caja cancela la descarga de la anterior (abort)').toBe(true));
  await waitFor(() =>
    expect(api.pedidosDeCaja(ID_CAJA_2), 'la caja 2 se pide de nuevo al entrar').toBeGreaterThan(pedidosPrevios),
  );
  await asentar();
  expect(screen.getByText('Cargando la caja…')).toBeInTheDocument();
  expect(screen.queryByText('Primera'), 'no se muestra la caché de la caja 2 sin pedirla').not.toBeInTheDocument();
  expect(screen.queryAllByRole('button', { name: /Descargar PDF/ })).toHaveLength(0);
  expect(screen.queryByText(/Preparando el PDF/)).not.toBeInTheDocument();

  api.soltarCajas();
  expect(await screen.findByText('Segunda')).toBeInTheDocument();
  const boton = screen.getByRole('button', { name: 'Descargar PDF del cierre 1' });
  expect(boton).toHaveTextContent('Descargar PDF');
  expect(boton).not.toHaveTextContent('Preparando');
  expect(boton).toBeEnabled();

  api.soltarPdf();
  await asentar();
  exigirQueNoSeEntregoNada();
}

describe('pasar a otra caja en el detalle cancela la descarga de la anterior (criterio 56)', () => {
  it('1. el caso de la falla: "atrás" dos veces desde la caja 1 hasta la caja 2, que está en la caché', async () => {
    const api = montarApi();
    await abrirLaCaja2YLlegarALaCaja1();
    await pulsarDescargar(api);
    const senal = senalDelPdf(api);
    expect(senal.aborted, 'antes de cambiar de caja, la señal no está activa').toBe(false);
    const pedidosPrevios = api.pedidosDeCaja(ID_CAJA_2);
    api.retenerCajas(true);

    navegar(-2);

    await exigirElCambioALaCaja2(api, senal, pedidosPrevios);
  });

  it('2a. hacia "adelante": caja 1, caja 2, "atrás" a la caja 1, se pulsa y "adelante" pasa a la caja 2', async () => {
    const api = montarApi();
    montar(rutaDeCaja(ID_CAJA_1));
    expect(await screen.findByText('Caja uno')).toBeInTheDocument();
    navegar(rutaDeCaja(ID_CAJA_2));
    expect(await screen.findByText('Primera')).toBeInTheDocument();
    navegar(-1);
    expect(await screen.findByText('Caja uno')).toBeInTheDocument();
    await pulsarDescargar(api);
    const senal = senalDelPdf(api);
    const pedidosPrevios = api.pedidosDeCaja(ID_CAJA_2);
    api.retenerCajas(true);

    navegar(1);

    await exigirElCambioALaCaja2(api, senal, pedidosPrevios);
  });

  it('2b. con otra dirección: en la caja 1 se pulsa y `navigate` con la dirección de la caja 2 pasa a ella', async () => {
    const api = montarApi();
    montar(rutaDeCaja(ID_CAJA_2));
    expect(await screen.findByText('Primera')).toBeInTheDocument();
    navegar(rutaDeCaja(ID_CAJA_1));
    expect(await screen.findByText('Caja uno')).toBeInTheDocument();
    await pulsarDescargar(api);
    const senal = senalDelPdf(api);
    const pedidosPrevios = api.pedidosDeCaja(ID_CAJA_2);
    api.retenerCajas(true);

    navegar(rutaDeCaja(ID_CAJA_2));

    await exigirElCambioALaCaja2(api, senal, pedidosPrevios);
  });

  it('3. durante useConfirmarSesion: al soltar GET /api/sesion, no se pide el PDF y no se entrega nada', async () => {
    const api = montarApi();
    await abrirLaCaja2YLlegarALaCaja1();
    const usuario = userEvent.setup();
    const boton = await screen.findByRole('button', { name: 'Descargar PDF del cierre 1' });
    // Desde aquí, la confirmación de la sesión queda esperando la respuesta de GET /api/sesion.
    api.retenerSesion(true);
    await usuario.click(boton);
    await waitFor(() =>
      expect(api.sesionesRetenidas(), 'useConfirmarSesion espera GET /api/sesion').toBeGreaterThan(0),
    );
    api.retenerCajas(true);

    navegar(-2);
    await asentar();
    api.retenerSesion(false);
    api.soltarSesion();
    await asentar();

    expect(api.pedidosPdf, 'al cambiar de caja, no se pide el PDF de la caja anterior').toHaveLength(0);
    api.soltarCajas();
    api.soltarPdf();
    await asentar();
    exigirQueNoSeEntregoNada();
  });

  it('4. el error de la descarga es de su caja: no aparece en el cierre 1 de la caja 2', async () => {
    const api = montarApi();
    api.estadoDelPdf = 500;
    await abrirLaCaja2YLlegarALaCaja1();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Descargar PDF del cierre 1' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(MENSAJE_ERROR_PDF);
    api.retenerCajas(true);

    navegar(-2);
    await asentar();
    api.soltarCajas();

    expect(await screen.findByText('Segunda')).toBeInTheDocument();
    await asentar();
    expect(screen.queryByText(/No se pudo generar el PDF/), 'el error es de la caja 1').not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const boton = screen.getByRole('button', { name: 'Descargar PDF del cierre 1' });
    expect(boton).toBeEnabled();
    expect(boton).toHaveTextContent('Descargar PDF');
  });

  it('5. el aviso de la reapertura es de su caja: no aparece en la caja 2', async () => {
    const api = montarApi();
    await abrirLaCaja2YLlegarALaCaja1();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir caja' }));
    const dialogo = screen.getByRole('dialog', { name: 'Reabrir caja' });
    await usuario.type(within(dialogo).getByLabelText('Motivo de la reapertura'), 'Faltaba registrar un gasto');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir caja' }));
    expect(await screen.findByText(/Caja reabierta\./)).toBeInTheDocument();
    expect(api.reaperturas).toHaveLength(1);
    api.retenerCajas(true);

    navegar(-2);
    await asentar();
    api.soltarCajas();

    expect(await screen.findByText('Segunda')).toBeInTheDocument();
    await asentar();
    expect(screen.queryByText(/Caja reabierta/), 'el aviso de la reapertura es de la caja 1').not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('6. control: en la caja 2, sin cambiar de caja, el PDF se entrega una vez, con el nombre de esa caja', async () => {
    const api = montarApi();
    montar(rutaDeCaja(ID_CAJA_2));
    expect(await screen.findByText('Primera')).toBeInTheDocument();
    await userEvent.setup().click(botonDelCierre1());
    await waitFor(() => expect(api.pedidosPdf).toHaveLength(1));
    expect(api.pedidosPdf[0]?.url).toBe(`/api/cajas/${ID_CAJA_2}/cierres/1/pdf`);

    api.soltarPdf();

    await waitFor(() => expect(entregas.clicks).toHaveLength(1));
    await asentar();
    expect(entregas.clicks).toEqual([{ descarga: 'cierre-caja-2026-11-03-1.pdf' }]);
    expect(entregas.crearUrl).toHaveBeenCalledTimes(1);
    expect(api.pedidosPdf[0]?.senal?.aborted ?? false, 'una descarga que se entrega no se cancela').toBe(false);
    expect(screen.queryByText(/No se pudo generar el PDF/)).not.toBeInTheDocument();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});
