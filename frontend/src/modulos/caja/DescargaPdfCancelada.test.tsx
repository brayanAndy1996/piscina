// spec: 006-caja (pruebas protegidas)
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mostrar, rutaActual, sesionDe, simularApi, simularUrlLocal } from '../../pruebas-api';

// Criterio 54 (crítico, ronda adversarial 2 de la 006b; amplía el criterio 44 y PQ12; DT-13; RNF-05; criterio 59 de 002): la web no entrega un PDF que ya no
// corresponde. En la PC compartida de recepción, un PDF que llega después de "Cerrar sesión" queda en las descargas del navegador, a la vista de la
// persona siguiente.
//   a) Cada descarga del detalle (`/panel/cajas/:id`) tiene su propio `AbortController`, y su señal va al `fetch` del PDF.
//   b) La web cancela la descarga (`abort()`) y no la entrega si, desde que se pulsa "Descargar PDF" (también durante `useConfirmarSesion`) hasta que se
//      entrega: la persona pulsa "Cerrar sesión" (se cancela al pulsar, antes de esperar la respuesta de `DELETE /api/sesion`, aunque esa petición falle);
//      la sesión cambia de identidad o se pierde (`GET /api/sesion` devuelve otra `claveDeIdentidad` o responde 401); la persona sale de la página del
//      detalle (se cancela al desmontar).
//   c) Justo antes de entregar el archivo, la web comprueba que esa descarga no fue cancelada y que la identidad de la sesión sigue siendo la de la página;
//      si no, descarta el contenido, aunque la respuesta ya haya llegado o el `fetch` haya ignorado la señal.
//   d) "No entregar" es: no llamar a `URL.createObjectURL`, no crear el enlace de descarga y no hacer `click`.
//   e) Una descarga cancelada no muestra "No se pudo generar el PDF…" ni otro error propio.
//   f) Sin nada de lo anterior, el PDF se entrega como en PQ12.
// La API se simula: un `fetch` retiene la respuesta del PDF (un 200 `application/pdf`) hasta que la prueba la suelta; hay espías en
// `URL.createObjectURL` y en `HTMLAnchorElement.prototype.click`.

const ID_YO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';
const ID_OTRA_PERSONA = '7c8d9e0f-1a2b-4b3c-8d4e-6f708192a3b4';
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

const SESION_DE_OTRA_PERSONA = {
  usuario: {
    id: ID_OTRA_PERSONA,
    nombres: 'Bruno',
    apellidos: 'Salas Peña',
    rol: 'ADMIN',
    debeCambiarClave: false,
    academia: { nombreCorto: 'tiburones', nombre: 'Academia Tiburones del Sur' },
  },
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const pdfDeLaApi = () =>
  new Response('%PDF-1.3 cierre', { status: 200, headers: { 'Content-Type': 'application/pdf' } });

/** Lo que cada cuadro de la prueba necesita saber de la API simulada. */
interface ApiRetenida {
  /** Las peticiones del PDF: su dirección y la señal con la que se pidieron. */
  pedidosPdf: { url: string; senal: AbortSignal | null | undefined }[];
  /** Suelta (responde 200) todas las respuestas del PDF retenidas. */
  soltarPdf(): void;
  /** `true` cuando la prueba ya respondió `DELETE /api/sesion`. */
  deleteRespondido(): boolean;
  /** Responde la petición retenida de `DELETE /api/sesion` (si no se retiene, ya respondió). */
  soltarDelete(): void;
  /** Cuántas peticiones de `GET /api/sesion` hay retenidas. */
  sesionesRetenidas(): number;
  soltarSesion(): void;
  /** Lo que `GET /api/sesion` responderá a partir de ahora. */
  responderSesion(respuesta: () => Response): void;
  /** Retiene las siguientes peticiones de `GET /api/sesion` hasta `soltarSesion()`. */
  retenerSesion(activo: boolean): void;
  /** El estado con el que responde `DELETE /api/sesion` cuando se suelta. */
  estadoDelDelete: number;
  /** Retiene `DELETE /api/sesion` hasta `soltarDelete()`. */
  retenerDelete: boolean;
}

/**
 * La API simulada: la sesión de un ADMIN, el detalle de una caja cerrada con un cierre y el PDF retenido. Con `respetaLaSenal`, el `fetch` del PDF se
 * rechaza con un `AbortError` cuando su señal se activa (como el `fetch` real); sin ella, la ignora y responde igual al soltarlo.
 */
function montarApi(respetaLaSenal: boolean): ApiRetenida {
  const base = simularApi({
    'GET /api/mi-academia': () => ({
      estado: 200,
      cuerpo: { academia: { nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', telefono: null } },
    }),
    [`GET /api/cajas/${ID_CAJA}`]: () => ({ estado: 200, cuerpo: { caja: CAJA } }),
    'GET /api/cajas': () => ({
      estado: 200,
      cuerpo: { desde: '2026-10-23', hasta: '2026-11-22', cajas: [] },
    }),
  });
  const pedidosPdf: ApiRetenida['pedidosPdf'] = [];
  const pdfRetenidos: (() => void)[] = [];
  const sesionesPendientes: (() => void)[] = [];
  const deletePendiente: (() => void)[] = [];
  let sesion = () => json(sesionDe('ADMIN', { id: ID_YO }));
  let retenerLaSesion = false;
  let deleteRespondido = false;
  const api: ApiRetenida = {
    pedidosPdf,
    soltarPdf: () => {
      for (const soltar of pdfRetenidos.splice(0)) soltar();
    },
    deleteRespondido: () => deleteRespondido,
    soltarDelete: () => {
      for (const soltar of deletePendiente.splice(0)) soltar();
    },
    sesionesRetenidas: () => sesionesPendientes.length,
    soltarSesion: () => {
      for (const soltar of sesionesPendientes.splice(0)) soltar();
    },
    responderSesion: (respuesta) => {
      sesion = respuesta;
    },
    retenerSesion: (activo) => {
      retenerLaSesion = activo;
    },
    estadoDelDelete: 204,
    retenerDelete: false,
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opciones?: RequestInit) => {
      const metodo = opciones?.method ?? 'GET';
      if (metodo === 'GET' && url === '/api/sesion') {
        if (!retenerLaSesion) return Promise.resolve(sesion());
        return new Promise<Response>((resolver) => {
          sesionesPendientes.push(() => resolver(sesion()));
        });
      }
      if (metodo === 'DELETE' && url === '/api/sesion') {
        const responder = () => {
          deleteRespondido = true;
          return api.estadoDelDelete === 204
            ? new Response(null, { status: 204 })
            : json({ codigo: 'ERROR_INTERNO', mensaje: 'x' }, api.estadoDelDelete);
        };
        if (!api.retenerDelete) return Promise.resolve(responder());
        return new Promise<Response>((resolver) => {
          deletePendiente.push(() => resolver(responder()));
        });
      }
      if (metodo === 'GET' && /\/cierres\/[^/]+\/pdf$/.test(url)) {
        const senal = opciones?.signal;
        // Un `fetch` real con una señal ya activa se rechaza enseguida, sin pedir nada al servidor: no cuenta como una petición del PDF.
        if (respetaLaSenal && senal?.aborted)
          return Promise.reject(new DOMException('Descarga cancelada', 'AbortError'));
        pedidosPdf.push({ url, senal });
        return new Promise<Response>((resolver, rechazar) => {
          pdfRetenidos.push(() => resolver(pdfDeLaApi()));
          if (respetaLaSenal && senal) {
            const alAbortar = () => rechazar(new DOMException('Descarga cancelada', 'AbortError'));
            if (senal.aborted) alAbortar();
            else senal.addEventListener('abort', alAbortar, { once: true });
          }
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
  vi.restoreAllMocks();
});

/** Abre el detalle de la caja y pulsa "Descargar PDF" del cierre 1: espera a que el `fetch` del PDF esté en camino. */
async function empezarLaDescarga(api: ApiRetenida) {
  mostrar(`/panel/cajas/${ID_CAJA}`);
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole('button', { name: 'Descargar PDF del cierre 1' }));
  await waitFor(() => expect(api.pedidosPdf, 'la web debe pedir el PDF del cierre 1').toHaveLength(1));
  return usuario;
}

/** La señal con la que la web pidió el PDF; falla con un mensaje claro si no la pasó. */
function senalDelPdf(api: ApiRetenida): AbortSignal {
  const senal = api.pedidosPdf[0]?.senal;
  expect(senal, 'cada descarga tiene su AbortController y su señal va al fetch del PDF').toBeTruthy();
  return senal as AbortSignal;
}

function exigirQueNoSeEntregoNada() {
  expect(entregas.crearUrl, 'no se llama a URL.createObjectURL').not.toHaveBeenCalled();
  expect(entregas.clicks, 'no se crea el enlace de descarga ni se hace click').toHaveLength(0);
  expect(
    screen.queryByText(/No se pudo generar el PDF/),
    'una descarga cancelada no muestra un error propio',
  ).not.toBeInTheDocument();
}

type Cancelacion = {
  nombre: string;
  /** Hace lo que cancela la descarga y espera a que la web lo haya notado (la señal queda activa), sin soltar el PDF. */
  provocar: (
    api: ApiRetenida,
    usuario: ReturnType<typeof userEvent.setup>,
    esperarAborto: () => Promise<void>,
  ) => Promise<void>;
};

const CANCELACIONES: Cancelacion[] = [
  {
    nombre: 'la persona pulsa "Cerrar sesión" (con DELETE /api/sesion retenido)',
    provocar: async (api, usuario, esperarAborto) => {
      api.retenerDelete = true;
      await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
      // Se cancela al pulsar, antes de que responda DELETE /api/sesion.
      await esperarAborto();
      expect(api.deleteRespondido(), 'la señal quedó aborted antes de que respondiera DELETE /api/sesion').toBe(false);
      api.soltarDelete();
    },
  },
  {
    nombre: 'la persona pulsa "Cerrar sesión" y DELETE /api/sesion falla (500)',
    provocar: async (api, usuario, esperarAborto) => {
      api.retenerDelete = true;
      api.estadoDelDelete = 500;
      await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
      await esperarAborto();
      expect(api.deleteRespondido(), 'la señal quedó aborted antes de que respondiera DELETE /api/sesion').toBe(false);
      api.soltarDelete();
    },
  },
  {
    nombre: 'la persona sale del detalle (con el enlace de volver al historial)',
    provocar: async (_api, usuario, esperarAborto) => {
      await usuario.click(screen.getByRole('link', { name: /Volver al historial de caja/ }));
      await waitFor(() => expect(rutaActual()).toBe('/panel/cajas'));
      await esperarAborto();
    },
  },
  {
    nombre: 'la sesión cambia de identidad (otra persona en otra academia) y la ventana recupera el foco',
    provocar: async (api, _usuario, esperarAborto) => {
      api.responderSesion(() => json(SESION_DE_OTRA_PERSONA));
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      await waitFor(() => expect(rutaActual()).toBe('/panel'));
      await esperarAborto();
    },
  },
  {
    nombre: 'la sesión se pierde (GET /api/sesion responde 401) y la ventana recupera el foco',
    provocar: async (api, _usuario, esperarAborto) => {
      api.responderSesion(() => json({ codigo: 'NO_AUTENTICADO', mensaje: 'x' }, 401));
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(await screen.findByText(/Entra por el enlace de tu academia/)).toBeInTheDocument();
      await esperarAborto();
    },
  },
];

describe('la web no entrega un PDF que ya no corresponde (criterio 54)', () => {
  describe.each(CANCELACIONES)('si $nombre mientras se prepara el PDF', (cancelacion) => {
    it('con un fetch que respeta la señal: la señal de ese fetch queda aborted y, al soltar la respuesta, no se entrega nada', async () => {
      const api = montarApi(true);
      const usuario = await empezarLaDescarga(api);
      const senal = senalDelPdf(api);
      expect(senal.aborted, 'antes de cancelar, la señal no está activa').toBe(false);
      const esperarAborto = () =>
        waitFor(() => expect(senal.aborted, 'la web debe cancelar la descarga (abort) cuando pasa esto').toBe(true));

      await cancelacion.provocar(api, usuario, esperarAborto);
      api.soltarPdf();
      await asentar();

      exigirQueNoSeEntregoNada();
    });

    it('con una simulación del PDF que ignora la señal y responde igual: la comprobación final descarta el contenido y no se entrega nada', async () => {
      const api = montarApi(false);
      const usuario = await empezarLaDescarga(api);
      // El fetch ignora la señal: esta prueba no mira si la web la activó, solo que no entrega el archivo.
      const esperarAborto = async () => {
        await asentar();
      };

      await cancelacion.provocar(api, usuario, esperarAborto);
      api.soltarPdf();
      await asentar();

      exigirQueNoSeEntregoNada();
    });
  });

  it.each([204, 500])(
    '"Cerrar sesión" mientras useConfirmarSesion todavía espera GET /api/sesion (DELETE responde %i): no se pide el PDF y no se entrega nada',
    async (estadoDelDelete) => {
      const api = montarApi(true);
      api.estadoDelDelete = estadoDelDelete;
      mostrar(`/panel/cajas/${ID_CAJA}`);
      const usuario = userEvent.setup();
      const boton = await screen.findByRole('button', { name: 'Descargar PDF del cierre 1' });
      // Desde aquí, la confirmación de la sesión queda esperando la respuesta de GET /api/sesion.
      api.retenerSesion(true);
      await usuario.click(boton);
      await waitFor(() => expect(api.sesionesRetenidas(), 'useConfirmarSesion espera GET /api/sesion').toBe(1));

      await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
      await waitFor(() => expect(api.deleteRespondido()).toBe(true));
      api.retenerSesion(false);
      api.soltarSesion();
      await asentar();

      expect(api.pedidosPdf, 'después de "Cerrar sesión" no se pide el PDF').toHaveLength(0);
      api.soltarPdf();
      await asentar();
      exigirQueNoSeEntregoNada();
    },
  );

  it('control: sin nada de eso, el PDF se entrega una vez, con el nombre cierre-caja-AAAA-MM-DD-N.pdf', async () => {
    const api = montarApi(true);
    await empezarLaDescarga(api);

    api.soltarPdf();

    await waitFor(() => expect(entregas.clicks).toHaveLength(1));
    await asentar();
    expect(entregas.clicks).toEqual([{ descarga: 'cierre-caja-2026-11-02-1.pdf' }]);
    expect(entregas.crearUrl).toHaveBeenCalledTimes(1);
    expect(api.pedidosPdf[0]?.senal?.aborted ?? false, 'una descarga que se entrega no se cancela').toBe(false);
    expect(screen.queryByText(/No se pudo generar el PDF/)).not.toBeInTheDocument();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});
