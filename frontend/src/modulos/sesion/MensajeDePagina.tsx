import type { ReactNode } from 'react';

/** Una tarjeta centrada con un título y un texto, para los avisos que ocupan toda la página. */
export function MensajeDePagina({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sky-50 p-4">
      <section className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-sky-100 sm:p-8">
        <h1 className="text-2xl font-semibold text-slate-900">{titulo}</h1>
        <div className="mt-2 text-slate-700">{children}</div>
      </section>
    </main>
  );
}
