// spec: 006-caja (pruebas protegidas)
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mostrar, sesionDe, simularApi, simularUrlLocal } from '../../pruebas-api';

// Criterio 57 e (crítico, ronda adversarial 4 de la 006b, observación O2; refuerza el 54 b y c y el 57 a; DT-19; RNF-05): mientras se cierra la sesión no
// se descarga. "Se está cerrando la sesión" es desde que se pulsa "Cerrar sesión" hasta que su mutación termina, con éxito o con error; incluye la
// pausa sin conexión y la espera del `DELETE` (es lo que hoy muestra "Cerrando…").
//   - Cada botón "Descargar PDF" del detalle está desactivado mientras tanto.
//   - Una descarga que se intenta igual (por ejemplo, un clic en el mismo paso que el de "Cerrar sesión", antes de volver a pintar) no se pide, o se
//     pide con su señal ya `aborted`, y no se entrega. Sin mensaje propio (54 e).
//   - La comprobación final (54 c) también descarta el contenido si en ese momento se está cerrando la sesión.
//   - Si "Cerrar sesión" falla (el `DELETE` responde un error y la web sigue en la página), "Descargar PDF" vuelve a estar habilitado y una descarga
//     nueva se entrega como en PQ12.
// La API se simula: un `fetch` que responde la sesión, el detalle de una caja con un cierre, el PDF (`application/pdf`) y `DELETE /api/sesion` (que la
// prueba puede retener o hacer fallar), con espías en `URL.createObjectURL` y en `HTMLAnchorElement.prototype.click`. Cada prueba restablece la
// conexión en `afterEach` para no afectar a las demás.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_CAJA = 'c0000000-0000-4000-8000-000000000002';
const ID_LUCIA = 'd1111111-1111-4111-8111-111111111111';
const LUCIA = { id: ID_LUCIA, nombres: 'Lucía', apellidos: 'Benites Rojas' };
const CERO = '0.00';

const CAJA = {
  id: ID_CAJA,
  fecha: '2026-11-02',
  estado: 'CERRADA',
  deOtroDia: true,
  montoInicial: '100.00',
  abiertaPor: LUCIA,
  abiertaEn: '2026-11-02T13:30:00.000Z',
  resumen: {
    ingresos: { efectivo: '42.00', yape: CERO, transferencia: CERO },
    egresos: { efectivo: CERO },
    esperado: { efectivo: '142.00', yape: CERO, transferencia: CERO },
    ultimoMovimiento: 0,
  },
  movimientos: [],
  cierres: [
    {
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
      observacion: null,
      tardio: false,
      movimientosHasta: 0,
      reapertura: null,
    },
  ],
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const pdfDeLaApi = () =>
  new Response('%PDF-1.3 cierre', { status: 200, headers: { 'Content-Type': 'application/pdf' } });

interface ApiDeLaSesion {
  /** Las peticiones del PDF: su dirección y la señal con la que se pidieron. */
  pedidosPdf: { url: string; senal: AbortSignal | null | undefined }[];
  /** Cuántas veces llegó `DELETE /api/sesion`. */
  deletes(): number;
  /** Cómo responde `DELETE /api/sesion`: enseguida, retenido hasta `soltarDelete()` o con un 500. */
  modoDelete: 'enseguida' | 'retenido' | 'error500';
  /** Responde (204) los `DELETE /api/sesion` retenidos. */
  soltarDelete(): void;
}

/** La API simulada: la sesión de un ADMIN, el detalle de una caja cerrada con un cierre, el PDF (siempre enseguida) y `DELETE /api/sesion`. */
function montarApi(): ApiDeLaSesion {
  const base = simularApi({
    'GET /api/mi-academia': () => ({
      estado: 200,
      cuerpo: { academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null } },
    }),
    [`GET /api/cajas/${ID_CAJA}`]: () => ({ estado: 200, cuerpo: { caja: CAJA } }),
    'GET /api/cajas': () => ({ estado: 200, cuerpo: { desde: '2026-10-23', hasta: '2026-11-22', cajas: [] } }),
  });
  const pedidosPdf: ApiDeLaSesion['pedidosPdf'] = [];
  const deletesRetenidos: (() => void)[] = [];
  let deletes = 0;
  const api: ApiDeLaSesion = {
    pedidosPdf,
    deletes: () => deletes,
    modoDelete: 'enseguida',
    soltarDelete: () => {
      for (const soltar of deletesRetenidos.splice(0)) soltar();
    },
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opciones?: RequestInit) => {
      const metodo = opciones?.method ?? 'GET';
      if (metodo === 'GET' && url === '/api/sesion') {
        return Promise.resolve(json(sesionDe('ADMIN', { id: ID_YO })));
      }
      if (metodo === 'DELETE' && url === '/api/sesion') {
        deletes += 1;
        if (api.modoDelete === 'error500') {
          return Promise.resolve(
            json({ codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error. Intenta de nuevo más tarde.' }, 500),
          );
        }
        if (api.modoDelete === 'retenido') {
          return new Promise<Response>((resolver) => {
            deletesRetenidos.push(() => resolver(new Response(null, { status: 204 })));
          });
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (metodo === 'GET' && /\/cierres\/[^/]+\/pdf$/.test(url)) {
        const senal = opciones?.signal;
        // Un `fetch` real con una señal ya activa se rechaza enseguida, sin pedir nada al servidor: no cuenta como una petición del PDF.
        if (senal?.aborted) return Promise.reject(new DOMException('Descarga cancelada', 'AbortError'));
        pedidosPdf.push({ url, senal });
        return Promise.resolve(pdfDeLaApi());
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
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

function exigirQueNoSeEntregoNada() {
  expect(entregas.crearUrl, 'no se llama a URL.createObjectURL').not.toHaveBeenCalled();
  expect(entregas.clicks, 'no se crea el enlace de descarga ni se hace click').toHaveLength(0);
  expect(
    screen.queryByText(/No se pudo generar el PDF/),
    'una descarga que no se hizo no muestra un error propio',
  ).not.toBeInTheDocument();
}

/** Si se llegó a pedir el PDF, su señal ya estaba `aborted` al pedirlo (un `fetch` real con una señal activa no pide nada). */
function exigirQueNingunPedidoTuvoLaSenalViva(api: ApiDeLaSesion) {
  for (const pedido of api.pedidosPdf) {
    expect(pedido.senal?.aborted, 'si se pide el PDF, su señal ya está cancelada').toBe(true);
  }
}

const botonDelCierre1 = () => screen.findByRole('button', { name: 'Descargar PDF del cierre 1' });
const botonCerrarSesion = () => screen.getByRole('button', { name: 'Cerrar sesión' });

describe('mientras se cierra la sesión no se descarga (criterio 57 e)', () => {
  it('1. el caso de la observación: sin conexión, con "Cerrando…" el botón "Descargar PDF" está desactivado y, al volver la conexión con el DELETE retenido, no se pide ni se entrega nada', async () => {
    const api = montarApi();
    api.modoDelete = 'retenido';
    mostrar(`/panel/cajas/${ID_CAJA}`);
    const usuario = userEvent.setup();
    const boton = await botonDelCierre1();
    act(() => {
      onlineManager.setOnline(false);
    });

    await usuario.click(botonCerrarSesion());

    expect(await screen.findByText('Cerrando…')).toBeInTheDocument();
    expect.soft(boton, 'mientras se cierra la sesión, "Descargar PDF" está desactivado').toBeDisabled();
    // La prueba intenta pulsarlo igual.
    fireEvent.click(boton);
    await asentar();
    expect(api.pedidosPdf, 'sin conexión no se pide nada').toHaveLength(0);

    // Vuelve la conexión: `GET /api/sesion` y el PDF responden enseguida; `DELETE /api/sesion` queda retenido (lento).
    act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(api.deletes(), 'al volver la conexión se envía DELETE /api/sesion').toBe(1));
    await asentar();
    exigirQueNingunPedidoTuvoLaSenalViva(api);
    exigirQueNoSeEntregoNada();

    api.soltarDelete();
    await asentar();
    exigirQueNingunPedidoTuvoLaSenalViva(api);
    exigirQueNoSeEntregoNada();
  });

  it('2. con conexión y el DELETE retenido: mientras se ve "Cerrando…", "Descargar PDF" está desactivado y al soltar el DELETE no se pidió ni se entregó ningún PDF', async () => {
    const api = montarApi();
    api.modoDelete = 'retenido';
    mostrar(`/panel/cajas/${ID_CAJA}`);
    const usuario = userEvent.setup();
    const boton = await botonDelCierre1();

    await usuario.click(botonCerrarSesion());

    expect(await screen.findByText('Cerrando…')).toBeInTheDocument();
    expect.soft(boton, 'mientras se cierra la sesión, "Descargar PDF" está desactivado').toBeDisabled();
    await waitFor(() => expect(api.deletes()).toBe(1));
    await asentar();
    expect.soft(boton, 'sigue desactivado mientras el DELETE no termina').toBeDisabled();

    api.soltarDelete();
    await asentar();
    expect(api.pedidosPdf, 'no se pidió ningún PDF').toHaveLength(0);
    exigirQueNoSeEntregoNada();
  });

  it('3. en el mismo paso: "Cerrar sesión" y "Descargar PDF" en un solo act, con el DELETE retenido, no piden el PDF (o lo piden con la señal cancelada) y no entregan nada', async () => {
    const api = montarApi();
    api.modoDelete = 'retenido';
    mostrar(`/panel/cajas/${ID_CAJA}`);
    const boton = await botonDelCierre1();
    const cerrar = botonCerrarSesion();

    // Sin que la página se vuelva a pintar en medio: el segundo clic llega con el botón todavía habilitado en el DOM.
    act(() => {
      fireEvent.click(cerrar);
      fireEvent.click(boton);
    });
    await asentar();
    exigirQueNingunPedidoTuvoLaSenalViva(api);

    api.soltarDelete();
    await asentar();
    exigirQueNingunPedidoTuvoLaSenalViva(api);
    exigirQueNoSeEntregoNada();
  });

  it('4. control: si "Cerrar sesión" falla (DELETE responde 500), "Descargar PDF" vuelve a estar habilitado y el PDF se entrega una vez con el nombre cierre-caja-AAAA-MM-DD-N.pdf', async () => {
    const api = montarApi();
    api.modoDelete = 'error500';
    mostrar(`/panel/cajas/${ID_CAJA}`);
    const usuario = userEvent.setup();
    await botonDelCierre1();

    await usuario.click(botonCerrarSesion());
    await waitFor(() => expect(api.deletes(), 'DELETE /api/sesion se envió y respondió 500').toBe(1));

    // Cuando "Cerrar sesión" vuelve a verse, la sesión sigue abierta.
    await screen.findByRole('button', { name: 'Cerrar sesión' });
    const boton = await botonDelCierre1();
    await waitFor(() => expect(boton, '"Descargar PDF" vuelve a estar habilitado').toBeEnabled());

    await usuario.click(boton);

    await waitFor(() => expect(entregas.clicks).toHaveLength(1));
    await asentar();
    expect(entregas.clicks, 'el PDF se entrega una vez').toEqual([{ descarga: 'cierre-caja-2026-11-02-1.pdf' }]);
    expect(entregas.crearUrl).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No se pudo generar el PDF/)).not.toBeInTheDocument();
  });
});
