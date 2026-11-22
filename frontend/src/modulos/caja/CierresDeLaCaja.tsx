import type { Caja, CierreCaja } from '@aquagestion/contratos';
import { Alerta, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { formatearFechaHora } from '../../lib/fechas';
import { useAlPerderSesion } from '../sesion/hooks';
import { useDescargarPdfDelCierre } from './hooks';
import { mensajeDeDescargaDelPdf } from './mensajes';
import { DatosDelCierre, InsigniasDelCierre } from './ResultadoDelCierre';

/**
 * Todos los cierres de una caja, del 1 en adelante, de solo lectura (criterio 41, PQ12): lo que dejó cada uno, su reapertura si la tuvo
 * (quién, cuándo y el motivo) y el botón "Descargar PDF". El último cierre de una caja cerrada es el vigente; los demás se reabrieron.
 */
export function CierresDeLaCaja({ caja }: { caja: Caja }) {
  const descarga = useDescargarPdfDelCierre();
  useAlPerderSesion(descarga.error);
  const descargando = descarga.isPending ? descarga.variables?.numero : undefined;
  const mensaje = descarga.isError ? mensajeDeDescargaDelPdf(descarga.error) : null;
  const numeroConError = descarga.variables?.numero;

  return (
    <section aria-label="Cierres de la caja" className="space-y-3">
      <h2 className="text-xl font-semibold text-slate-900">Cierres</h2>
      {caja.cierres.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
          Esta caja todavía no se cerró.
        </p>
      ) : (
        <ul className="space-y-3">
          {caja.cierres.map((cierre) => (
            <li key={cierre.numero}>
              <article
                aria-label={`Cierre ${cierre.numero}`}
                className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-slate-900">Cierre {cierre.numero}</h3>
                  <div className="flex flex-wrap gap-2">
                    {cierre.reapertura ? <Insignia color="gris">Reabierto</Insignia> : null}
                    <InsigniasDelCierre cierre={cierre} />
                  </div>
                </div>
                <DatosDelCierre cierre={cierre} />
                {cierre.reapertura ? <Reapertura reapertura={cierre.reapertura} /> : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    disabled={descarga.isPending}
                    aria-label={`Descargar PDF del cierre ${cierre.numero}`}
                    onClick={() => descarga.mutate({ cajaId: caja.id, fecha: caja.fecha, numero: cierre.numero })}
                    className={ESTILO_BOTON.secundario}
                  >
                    {descargando === cierre.numero ? 'Preparando el PDF…' : 'Descargar PDF'}
                  </button>
                </div>
                {mensaje && numeroConError === cierre.numero ? <Alerta>{mensaje}</Alerta> : null}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Reapertura({ reapertura }: { reapertura: NonNullable<CierreCaja['reapertura']> }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-800 ring-1 ring-slate-200">
      <p className="break-words">
        Reabierto por {reapertura.reabiertaPor.nombres} {reapertura.reabiertaPor.apellidos} el{' '}
        {formatearFechaHora(reapertura.reabiertaEn)}.
      </p>
      <p className="break-words">Motivo: {reapertura.motivo}</p>
    </div>
  );
}
