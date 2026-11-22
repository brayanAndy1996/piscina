// spec: 006-caja (pruebas protegidas)
import { onlineManager } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mostrar, rutaActual, sesionDe, simularApi, simularUrlLocal } from '../../pruebas-api';

// Criterio 57 (crítico, ronda adversarial 3 de la 006b; amplía el criterio 54 b; DT-17; RNF-05): "Cerrar sesión" cancela las descargas en curso al
// pulsar, en el mismo paso, aunque la mutación quede en pausa por falta de conexión (`onlineManager` sin conexión, `networkMode: 'online'`) y su
// `mutationFn` no corra. Una descarga cuenta como "en curso" desde que se pulsa "Descargar PDF", también si su mutación está en pausa y todavía no
// pidió nada: "Cerrar sesión" o salir del detalle la cancelan igual.
//   a) Al pulsar: `abort()` enseguida, sin entrega y sin mensaje propio (54 b, d y e).
//   b) También una descarga en pausa: al volver la conexión no pide el PDF y no lo entrega.
//   c) Lo demás de "Cerrar sesión" no cambia: sin conexión la mutación queda en pausa ("Cerrando…") y envía `DELETE /api/sesion` al volver la conexión.
// La API se simula: un `fetch` retiene la respuesta del PDF (un 200 `application/pdf`) hasta que la prueba la suelta, y hay espías en
// `URL.createObjectURL` y en `HTMLAnchorElement.prototype.click`. Cada prueba restablece la conexión en `afterEach` para no afectar a las demás.

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

interface ApiRetenida {
  /** Las peticiones del PDF: su dirección y la señal con la que se pidieron. */
  pedidosPdf: { url: string; senal: AbortSignal | null | undefined }[];
  /** Suelta (responde 200) todas las respuestas del PDF retenidas. */
  soltarPdf(): void;
  /** Cuántas veces llegó `DELETE /api/sesion`. */
  deletes(): number;
  /** Cuántas peticiones de `GET /api/sesion` hay retenidas. */
  sesionesRetenidas(): number;
  retenerSesion(activo: boolean): void;
  soltarSesion(): void;
  /** Con `true`, el PDF responde enseguida en lugar de quedar retenido. */
  pdfEnseguida: boolean;
}

/** La API simulada: la sesión de un ADMIN, el detalle de una caja cerrada con un cierre y el PDF retenido (con un `fetch` que respeta la señal). */
function montarApi(): ApiRetenida {
  const base = simularApi({
    'GET /api/mi-academia': () => ({
      estado: 200,
      cuerpo: { academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null } },
    }),
    [`GET /api/cajas/${ID_CAJA}`]: () => ({ estado: 200, cuerpo: { caja: CAJA } }),
    'GET /api/cajas': () => ({ estado: 200, cuerpo: { desde: '2026-10-23', hasta: '2026-11-22', cajas: [] } }),
  });
  const pedidosPdf: ApiRetenida['pedidosPdf'] = [];
  const pdfRetenidos: (() => void)[] = [];
  const sesionesPendientes: (() => void)[] = [];
  let retenerLaSesion = false;
  let deletes = 0;
  const api: ApiRetenida = {
    pedidosPdf,
    soltarPdf: () => {
      for (const soltar of pdfRetenidos.splice(0)) soltar();
    },
    deletes: () => deletes,
    sesionesRetenidas: () => sesionesPendientes.length,
    retenerSesion: (activo) => {
      retenerLaSesion = activo;
    },
    soltarSesion: () => {
      for (const soltar of sesionesPendientes.splice(0)) soltar();
    },
    pdfEnseguida: false,
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
      if (metodo === 'DELETE' && url === '/api/sesion') {
        deletes += 1;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (metodo === 'GET' && /\/cierres\/[^/]+\/pdf$/.test(url)) {
        const senal = opciones?.signal;
        // Un `fetch` real con una señal ya activa se rechaza enseguida, sin pedir nada al servidor: no cuenta como una petición del PDF.
        if (senal?.aborted) return Promise.reject(new DOMException('Descarga cancelada', 'AbortError'));
        pedidosPdf.push({ url, senal });
        if (api.pdfEnseguida) return Promise.resolve(pdfDeLaApi());
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
    'una descarga cancelada no muestra un error propio',
  ).not.toBeInTheDocument();
}

const botonDelCierre1 = () => screen.findByRole('button', { name: 'Descargar PDF del cierre 1' });

describe('"Cerrar sesión" cancela al pulsar, también sin conexión (criterio 57)', () => {
  it('1. el caso de la falla: con el PDF ya pedido y sin conexión, "Cerrar sesión" cancela enseguida y no se entrega nada', async () => {
    const api = montarApi();
    mostrar(`/panel/cajas/${ID_CAJA}`);
    const usuario = userEvent.setup();
    await usuario.click(await botonDelCierre1());
    await waitFor(() => expect(api.pedidosPdf, 'la web debe pedir el PDF del cierre 1').toHaveLength(1));
    const senal = api.pedidosPdf[0]?.senal;
    expect(senal, 'la señal de la descarga va al fetch del PDF').toBeTruthy();
    expect((senal as AbortSignal).aborted, 'antes de cerrar sesión, la señal no está activa').toBe(false);

    act(() => {
      onlineManager.setOnline(false);
    });
    await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    await waitFor(() =>
      expect((senal as AbortSignal).aborted, 'se cancela al pulsar, sin esperar ninguna respuesta').toBe(true),
    );
    expect(api.deletes(), 'sin conexión, DELETE /api/sesion todavía no se envía').toBe(0);
    api.soltarPdf();
    await asentar();
    exigirQueNoSeEntregoNada();
  });

  it('2. durante useConfirmarSesion: sin conexión, "Cerrar sesión" cancela y, al soltar GET /api/sesion, no se pide el PDF ni se entrega nada', async () => {
    const api = montarApi();
    mostrar(`/panel/cajas/${ID_CAJA}`);
    const usuario = userEvent.setup();
    const boton = await botonDelCierre1();
    // Desde aquí, la confirmación de la sesión queda esperando la respuesta de GET /api/sesion.
    api.retenerSesion(true);
    await usuario.click(boton);
    await waitFor(() =>
      expect(api.sesionesRetenidas(), 'useConfirmarSesion espera GET /api/sesion').toBeGreaterThan(0),
    );

    act(() => {
      onlineManager.setOnline(false);
    });
    await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await asentar();
    api.retenerSesion(false);
    api.soltarSesion();
    await asentar();

    expect(api.pedidosPdf, 'después de "Cerrar sesión" no se pide el PDF').toHaveLength(0);
    api.soltarPdf();
    await asentar();
    exigirQueNoSeEntregoNada();
  });

  describe('3. la descarga en pausa por falta de conexión', () => {
    async function pulsarDescargarSinConexion(api: ApiRetenida) {
      api.pdfEnseguida = true;
      mostrar(`/panel/cajas/${ID_CAJA}`);
      const usuario = userEvent.setup();
      const boton = await botonDelCierre1();
      act(() => {
        onlineManager.setOnline(false);
      });
      await usuario.click(boton);
      await asentar();
      expect(api.pedidosPdf, 'sin conexión, la mutación queda en pausa y no hay ningún fetch del PDF').toHaveLength(0);
      return usuario;
    }

    /** Vuelve la conexión: el PDF y `DELETE /api/sesion` responden enseguida. Después, nada se entrega y, si se pidió el PDF, su señal ya estaba activa. */
    async function volverLaConexionYExigirQueNoSeEntregoNada(api: ApiRetenida) {
      act(() => {
        onlineManager.setOnline(true);
      });
      await asentar();
      for (const pedido of api.pedidosPdf)
        expect(pedido.senal?.aborted, 'si se pide el PDF, su señal ya está cancelada').toBe(true);
      exigirQueNoSeEntregoNada();
    }

    it('"Cerrar sesión" la cancela: al volver la conexión no se pide el PDF, o se pide con la señal cancelada, y no se entrega nada', async () => {
      const api = montarApi();
      const usuario = await pulsarDescargarSinConexion(api);

      await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
      await volverLaConexionYExigirQueNoSeEntregoNada(api);
    });

    it('salir del detalle (volver a la lista) la cancela: al volver la conexión no se pide el PDF, o se pide con la señal cancelada, y no se entrega nada', async () => {
      const api = montarApi();
      const usuario = await pulsarDescargarSinConexion(api);

      await usuario.click(screen.getByRole('link', { name: /Volver al historial de caja/ }));
      await waitFor(() => expect(rutaActual()).toBe('/panel/cajas'));
      await volverLaConexionYExigirQueNoSeEntregoNada(api);
    });
  });

  it('4. control: sin conexión y sin descargas en curso, "Cerrar sesión" muestra "Cerrando…" y envía DELETE /api/sesion al volver la conexión', async () => {
    const api = montarApi();
    mostrar(`/panel/cajas/${ID_CAJA}`);
    const usuario = userEvent.setup();
    await botonDelCierre1();
    act(() => {
      onlineManager.setOnline(false);
    });

    await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByText('Cerrando…')).toBeInTheDocument();
    await asentar();
    expect(api.deletes(), 'sin conexión, la mutación queda en pausa').toBe(0);
    act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(api.deletes(), 'al volver la conexión se envía DELETE /api/sesion').toBe(1));
  });
});
