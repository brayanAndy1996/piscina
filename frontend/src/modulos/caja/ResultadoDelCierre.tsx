import type { Caja, CierreCaja } from '@aquagestion/contratos';
import { Insignia } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { formatearFechaHora } from '../../lib/fechas';
import { describirDiferencia, ETIQUETA_RESULTADO } from './montos';

const COLOR_RESULTADO = { CUADRA: 'verde', SOBRANTE: 'azul', FALTANTE: 'ambar' } as const;

/** Las insignias de un cierre: "Cierre tardío" (si lo es) y la palabra de su resultado. Se comparten con el detalle del historial. */
export function InsigniasDelCierre({ cierre }: { cierre: CierreCaja }) {
  return (
    <div className="flex flex-wrap gap-2">
      {cierre.tardio ? <Insignia color="ambar">Cierre tardío</Insignia> : null}
      <Insignia color={COLOR_RESULTADO[cierre.resultado]}>{ETIQUETA_RESULTADO[cierre.resultado]}</Insignia>
    </div>
  );
}

/** Lo que dejó un cierre: esperado por método, contado, diferencia con su palabra, observación y quién lo hizo. Se comparte con el detalle. */
export function DatosDelCierre({ cierre }: { cierre: CierreCaja }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-slate-800 sm:grid-cols-[auto_1fr] sm:gap-x-8">
      <dt className="font-medium">Efectivo esperado</dt>
      <dd className="text-right sm:text-left">{formatearSoles(cierre.esperado.efectivo)}</dd>
      <dt className="font-medium">Efectivo contado</dt>
      <dd className="text-right sm:text-left">{formatearSoles(cierre.montoDeclarado)}</dd>
      <dt className="font-medium">Diferencia</dt>
      <dd className="text-right font-semibold sm:text-left">{describirDiferencia(cierre.diferencia)}</dd>
      <dt className="font-medium">Yape esperado</dt>
      <dd className="text-right sm:text-left">{formatearSoles(cierre.esperado.yape)}</dd>
      <dt className="font-medium">Transferencia esperada</dt>
      <dd className="text-right sm:text-left">{formatearSoles(cierre.esperado.transferencia)}</dd>
      {cierre.observacion ? (
        <>
          <dt className="font-medium">Observación</dt>
          <dd className="col-span-2 break-words sm:col-span-1">{cierre.observacion}</dd>
        </>
      ) : null}
      <dt className="font-medium">Cerrada por</dt>
      <dd className="break-words text-right sm:text-left">
        {cierre.cerradoPor.nombres} {cierre.cerradoPor.apellidos}, {formatearFechaHora(cierre.cerradoEn)}
      </dd>
    </dl>
  );
}

/**
 * El resultado del cierre vigente de una caja cerrada (criterio 38 d de 006): esperado, declarado, diferencia con su palabra
 * ("Sobrante", "Faltante" o "Cuadra") y la observación. Si la caja se reabrió antes, los cierres anteriores quedan debajo con su motivo.
 */
export function ResultadoDelCierre({ caja }: { caja: Caja }) {
  const vigente = caja.cierres.at(-1);
  const anteriores = caja.cierres.slice(0, -1);
  if (!vigente) return null;
  return (
    <section
      aria-label="Resultado del cierre"
      className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-slate-900">Cierre de caja</h2>
        <InsigniasDelCierre cierre={vigente} />
      </div>
      <DatosDelCierre cierre={vigente} />
      {anteriores.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium text-slate-800">Cierres anteriores de esta caja</h3>
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {anteriores.map((cierre) => (
              <li key={cierre.numero} className="break-words">
                {textoDeCierreAnterior(cierre)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function textoDeCierreAnterior(cierre: CierreCaja): string {
  const base = `Cierre ${cierre.numero}: ${describirDiferencia(cierre.diferencia)}, contado ${formatearSoles(cierre.montoDeclarado)}.`;
  if (!cierre.reapertura) return base;
  const { reabiertaPor, reabiertaEn, motivo } = cierre.reapertura;
  return `${base} Reabierto por ${reabiertaPor.nombres} ${reabiertaPor.apellidos} el ${formatearFechaHora(reabiertaEn)}: ${motivo}`;
}
