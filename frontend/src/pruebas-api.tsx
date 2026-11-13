import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';
import { Rutas } from './rutas/Rutas';

/** Utilidades de las pruebas de componentes: una API simulada por "MÉTODO /ruta" y la web montada en una ruta. */

export function error(codigo: string, estado: number, detalles?: unknown) {
  return { estado, cuerpo: { codigo, mensaje: `Mensaje de ${codigo}`, ...(detalles ? { detalles } : {}) } };
}

export type Respuesta = { estado: number; cuerpo?: unknown };
export type Manejador = (cuerpo: unknown) => Respuesta | Promise<Respuesta>;

/** Simula la API y devuelve el mock de `fetch` para revisar las llamadas. Una ruta sin manejador responde 404. */
export function simularApi(rutas: Record<string, Manejador>) {
  const simulado = vi.fn((url: string, opciones?: RequestInit) => {
    const clave = `${opciones?.method ?? 'GET'} ${url}`;
    const manejador = rutas[clave];
    if (!manejador)
      return Promise.resolve(new Response(JSON.stringify({ codigo: 'NO_ENCONTRADO', mensaje: 'x' }), { status: 404 }));
    const cuerpo: unknown = typeof opciones?.body === 'string' ? JSON.parse(opciones.body) : undefined;
    return Promise.resolve(manejador(cuerpo)).then(
      ({ estado, cuerpo: salida }) =>
        new Response(salida === undefined ? null : JSON.stringify(salida), {
          status: estado,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
  });
  vi.stubGlobal('fetch', simulado);
  return simulado;
}

/** Los cuerpos enviados a una ruta, en orden. */
export function llamadas(simulado: ReturnType<typeof simularApi>, clave: string): unknown[] {
  return simulado.mock.calls
    .filter(([url, opciones]) => `${opciones?.method ?? 'GET'} ${url}` === clave)
    .map(([, opciones]): unknown => (typeof opciones?.body === 'string' ? JSON.parse(opciones.body) : undefined));
}

function RutaActual() {
  const ubicacion = useLocation();
  return <p data-testid="ruta">{ubicacion.pathname + ubicacion.search}</p>;
}

/** Monta la web completa en `ruta`. La dirección actual queda en `data-testid="ruta"`. */
export function mostrar(ruta: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <Rutas />
        <RutaActual />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export function rutaActual(): string | null {
  return document.querySelector('[data-testid="ruta"]')?.textContent ?? null;
}

const ID_USUARIO = '3e4f5a6b-7c8d-4d9e-8f0a-2b3c4d5e6f70';

export function sesionDe(
  rol: 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO',
  extra: { debeCambiarClave?: boolean; id?: string } = {},
) {
  return {
    usuario: {
      id: extra.id ?? ID_USUARIO,
      nombres: 'Rosa',
      apellidos: 'Quispe Mamani',
      rol,
      debeCambiarClave: extra.debeCambiarClave ?? false,
      academia: { nombreCorto: 'delfines', nombre: 'Academia de Natación Los Delfines' },
    },
  };
}
