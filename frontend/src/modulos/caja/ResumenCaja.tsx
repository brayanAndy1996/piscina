import type { Caja } from '@aquagestion/contratos';
import { Insignia } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { formatearFechaCalendario, formatearHora } from '../../lib/fechas';

const TITULO_ESPERADO = { yape: 'Yape esperado', transferencia: 'Transferencia esperada' } as const;

/**
 * Los datos de la caja y su resumen por método (HU-26, HU-27; criterio 38 b de 006): quién la abrió y cuándo, el monto inicial y, por
 * método, lo que entró y lo que se espera. Yape y transferencia se registran, pero no suman al efectivo del cajón (D-04, sección 4.3).
 */
export function ResumenCaja({ caja }: { caja: Caja }) {
  const { resumen } = caja;
  return (
    <section
      aria-label="Resumen de la caja"
      className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-slate-900">Caja del {formatearFechaCalendario(caja.fecha)}</p>
          <p className="break-words text-sm text-slate-700">
            Abierta por {caja.abiertaPor.nombres} {caja.abiertaPor.apellidos} a las {formatearHora(caja.abiertaEn)}
          </p>
        </div>
        <Insignia color={caja.estado === 'ABIERTA' ? 'verde' : 'gris'}>
          {caja.estado === 'ABIERTA' ? 'Abierta' : 'Cerrada'}
        </Insignia>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        <li className="rounded-xl bg-sky-50 p-3 ring-1 ring-sky-100">
          <h3 className="text-sm font-medium text-slate-800">Efectivo esperado</h3>
          <p className="text-2xl font-semibold text-slate-900">{formatearSoles(resumen.esperado.efectivo)}</p>
          <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 text-sm text-slate-700">
            <dt>Monto inicial</dt>
            <dd>{formatearSoles(caja.montoInicial)}</dd>
            <dt>Ingresos</dt>
            <dd>{formatearSoles(resumen.ingresos.efectivo)}</dd>
            <dt>Egresos</dt>
            <dd>{formatearSoles(resumen.egresos.efectivo)}</dd>
          </dl>
        </li>
        {(['yape', 'transferencia'] as const).map((metodo) => (
          <li key={metodo} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <h3 className="text-sm font-medium text-slate-800">{TITULO_ESPERADO[metodo]}</h3>
            <p className="text-2xl font-semibold text-slate-900">{formatearSoles(resumen.esperado[metodo])}</p>
            <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 text-sm text-slate-700">
              <dt>Ingresos</dt>
              <dd>{formatearSoles(resumen.ingresos[metodo])}</dd>
            </dl>
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-700">
        Yape y transferencia se registran en la caja, pero no suman al efectivo que debe haber en el cajón.
      </p>
    </section>
  );
}
