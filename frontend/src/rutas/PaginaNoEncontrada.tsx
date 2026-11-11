import { Link } from 'react-router';

export function PaginaNoEncontrada() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sky-50 p-4">
      <section className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-sky-100 sm:p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Página no encontrada</h1>
        <p className="mt-2 text-slate-600">La dirección que abriste no existe.</p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-lg bg-sky-700 px-4 py-2 font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
        >
          Volver al inicio
        </Link>
      </section>
    </main>
  );
}
