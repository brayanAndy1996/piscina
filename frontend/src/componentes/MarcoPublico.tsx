import type { ReactNode } from 'react';
import { esErrorDeApi } from '../api/cliente';
import { MENSAJE_ACADEMIA_SUSPENDIDA, useAcademiaPublica } from '../modulos/sesion/hooks';
import { mensajeGeneral } from '../lib/errores';
import { TelefonoAcademia } from './Telefono';
import { Alerta, ESTILO_BOTON } from './ui';

interface Propiedades {
  nombreCorto: string;
  /** `amplio` para el formulario de inscripción; `normal` para el seguimiento. */
  ancho?: 'normal' | 'amplio';
  children: ReactNode;
}

/**
 * El marco de las páginas públicas de una academia (`/a/{nombreCorto}/…`, sin sesión): su nombre y su teléfono arriba, leídos de
 * `GET /api/a/{nombreCorto}` sin caché entre visitas (criterio 45 de 005), y el contenido debajo. Una academia que no existe o está
 * suspendida muestra un mensaje en lugar del contenido (D-27, DR-4 de 001).
 */
export function MarcoPublico({ nombreCorto, ancho = 'normal', children }: Propiedades) {
  const academia = useAcademiaPublica(nombreCorto);
  const columna = ancho === 'amplio' ? 'max-w-3xl' : 'max-w-xl';

  if (academia.isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-sky-50 p-4">
        <p role="status" className="text-slate-600">
          Cargando…
        </p>
      </main>
    );
  }

  if (academia.isError) {
    const suspendida = esErrorDeApi(academia.error, 403, 'ACADEMIA_SUSPENDIDA');
    const inexistente = esErrorDeApi(academia.error, 404);
    return (
      <main className="flex min-h-screen items-center justify-center bg-sky-50 p-4">
        <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-sky-100 sm:p-8">
          <p className="text-sm font-medium text-sky-800">AquaGestión</p>
          {suspendida || inexistente ? (
            <p role="alert" className="mt-2 text-slate-800">
              {suspendida
                ? MENSAJE_ACADEMIA_SUSPENDIDA
                : 'No encontramos esa academia. Revisa el enlace que te dieron.'}
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <Alerta>{mensajeGeneral(academia.error)}</Alerta>
              <button type="button" onClick={() => void academia.refetch()} className={ESTILO_BOTON.secundario}>
                Reintentar
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-sky-50">
      <header className="bg-white shadow-sm ring-1 ring-sky-100">
        <div className={`mx-auto ${columna} px-4 py-3`}>
          <p className="text-sm font-medium text-sky-800">AquaGestión</p>
          <p className="break-words text-lg font-semibold text-slate-900">{academia.data.nombre}</p>
          <TelefonoAcademia telefono={academia.data.telefono} />
        </div>
      </header>
      <main className={`mx-auto ${columna} px-4 py-6`}>{children}</main>
    </div>
  );
}
