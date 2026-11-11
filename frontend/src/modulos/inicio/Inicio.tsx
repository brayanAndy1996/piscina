import { type EstadoSistema, useSalud } from './useSalud';

const PRESENTACION: Record<EstadoSistema, { texto: string; punto: string; colorTexto: string }> = {
  comprobando: { texto: 'Comprobando el sistema…', punto: 'bg-slate-400 animate-pulse', colorTexto: 'text-slate-600' },
  'en-linea': { texto: 'Sistema en línea', punto: 'bg-emerald-500', colorTexto: 'text-emerald-800' },
  'sin-base': { texto: 'Sin conexión con la base de datos', punto: 'bg-amber-500', colorTexto: 'text-amber-800' },
  'sin-servidor': { texto: 'No se pudo contactar al servidor', punto: 'bg-red-500', colorTexto: 'text-red-800' },
};

export function Inicio() {
  const estado = useSalud();
  const { texto, punto, colorTexto } = PRESENTACION[estado];

  return (
    <main className="flex min-h-screen items-center justify-center bg-sky-50 p-4">
      <section className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-sky-100 sm:p-8">
        <h1 className="text-3xl font-semibold text-sky-900">AquaGestión</h1>
        <p
          role="status"
          aria-live="polite"
          className={`mt-4 flex items-center justify-center gap-2 font-medium ${colorTexto}`}
        >
          <span aria-hidden="true" className={`inline-block size-3 shrink-0 rounded-full ${punto}`} />
          <span>{texto}</span>
        </p>
      </section>
    </main>
  );
}
