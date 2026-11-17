import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from 'react';

/** Piezas visuales compartidas, con Tailwind simple y objetivos táctiles de al menos 44 px. */

const BASE_BOTON =
  'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

export const ESTILO_BOTON = {
  primario: `${BASE_BOTON} bg-sky-700 text-white hover:bg-sky-800 focus-visible:outline-sky-700`,
  secundario: `${BASE_BOTON} bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-sky-700`,
  peligro: `${BASE_BOTON} bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700`,
} as const;

export function Alerta({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
      {children}
    </p>
  );
}

interface PropiedadesCampo extends Omit<ComponentProps<'input'>, 'className'> {
  etiqueta: string;
  error?: string | undefined;
  ayuda?: string;
}

/** Etiqueta, entrada y mensaje de error enlazados para los lectores de pantalla. */
export function CampoTexto({ etiqueta, error, ayuda, ...entrada }: PropiedadesCampo) {
  const id = useId();
  const idError = `${id}-error`;
  const idAyuda = `${id}-ayuda`;
  const descripcion = [error ? idError : null, ayuda ? idAyuda : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {etiqueta}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={descripcion}
        className="mt-1 block min-h-11 w-full rounded-lg border-0 bg-white px-3 py-2 text-base text-slate-900 ring-1 ring-slate-300 focus:outline-2 focus:outline-sky-700 aria-invalid:ring-red-500"
        {...entrada}
      />
      {ayuda ? (
        <p id={idAyuda} className="mt-1 text-sm text-slate-600">
          {ayuda}
        </p>
      ) : null}
      {error ? (
        <p id={idError} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface PropiedadesSelect extends Omit<ComponentProps<'select'>, 'className'> {
  etiqueta: string;
  error?: string | undefined;
  children: ReactNode;
}

/** Lista desplegable con etiqueta y mensaje de error enlazados, con el mismo aspecto que `CampoTexto`. */
export function CampoSelect({ etiqueta, error, children, ...seleccion }: PropiedadesSelect) {
  const id = useId();
  const idError = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {etiqueta}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? idError : undefined}
        className="mt-1 block min-h-11 w-full rounded-lg border-0 bg-white px-3 py-2 text-base text-slate-900 ring-1 ring-slate-300 focus:outline-2 focus:outline-sky-700 aria-invalid:ring-red-500"
        {...seleccion}
      >
        {children}
      </select>
      {error ? (
        <p id={idError} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const COLOR_INSIGNIA = {
  verde: 'bg-emerald-100 text-emerald-900',
  ambar: 'bg-amber-100 text-amber-900',
  gris: 'bg-slate-100 text-slate-800',
  azul: 'bg-sky-100 text-sky-900',
} as const;

/** Etiqueta pequeña de estado ("Activo", "Bloqueado"…). El texto lleva el significado; el color solo lo refuerza. */
export function Insignia({ color, children }: { color: keyof typeof COLOR_INSIGNIA; children: ReactNode }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${COLOR_INSIGNIA[color]}`}>{children}</span>;
}

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

interface PropiedadesModal {
  titulo: string;
  alCerrar: () => void;
  children: ReactNode;
}

/**
 * Ventana de confirmación: se cierra con Escape o tocando el fondo, mantiene el foco dentro mientras está abierta y lo
 * devuelve al elemento que la abrió.
 */
export function Modal({ titulo, alCerrar, children }: PropiedadesModal) {
  const idTitulo = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cerrar = useRef(alCerrar);
  useEffect(() => {
    cerrar.current = alCerrar;
  });

  useEffect(() => {
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>(ENFOCABLES)?.focus();

    // En el documento y no en el panel: al deshabilitarse el botón que se acaba de pulsar, el foco pasa al cuerpo.
    function alPulsarTecla(evento: globalThis.KeyboardEvent) {
      if (evento.key === 'Escape') {
        cerrar.current();
        return;
      }
      if (evento.key !== 'Tab' || !panel.current) return;
      const enfocables = [...panel.current.querySelectorAll<HTMLElement>(ENFOCABLES)];
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (!primero || !ultimo) return;
      const dentro = panel.current.contains(document.activeElement);
      if (!dentro) {
        evento.preventDefault();
        (evento.shiftKey ? ultimo : primero).focus();
      } else if (evento.shiftKey && document.activeElement === primero) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primero.focus();
      }
    }
    document.addEventListener('keydown', alPulsarTecla);
    return () => {
      document.removeEventListener('keydown', alPulsarTecla);
      anterior?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-10 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) alCerrar();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-lg sm:rounded-2xl sm:p-6"
      >
        <h2 id={idTitulo} className="text-xl font-semibold text-slate-900">
          {titulo}
        </h2>
        {children}
      </div>
    </div>
  );
}
