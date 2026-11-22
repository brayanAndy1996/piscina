import type { ConceptoMovimiento, MovimientoCaja } from '@aquagestion/contratos';
import { Insignia } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { formatearHora } from '../../lib/fechas';
import { ETIQUETA_METODO } from './montos';

const ETIQUETA_CONCEPTO: Readonly<Record<ConceptoMovimiento, string>> = {
  INSCRIPCION: 'Inscripción',
  MENSUALIDAD: 'Mensualidad',
  CLASE_PARTICULAR: 'Clase particular',
  EGRESO_MENOR: 'Egreso',
};

/** Lo que se lee de un movimiento: el concepto y, si lo hay, la descripción del egreso o el nombre del alumno. */
function titulo(movimiento: MovimientoCaja): string {
  const concepto = ETIQUETA_CONCEPTO[movimiento.concepto];
  if (movimiento.descripcion) return `${concepto}: ${movimiento.descripcion}`;
  if (movimiento.alumno) return `${concepto}: ${movimiento.alumno.nombres} ${movimiento.alumno.apellidos}`;
  return concepto;
}

/**
 * Los movimientos de la caja en el orden en que entraron (hora, concepto o descripción, método, alumno y monto; criterio 38 b de 006).
 * Sirve igual en la PC y en el celular: cada movimiento es una fila que se reparte en dos líneas.
 */
export function ListaMovimientos({ movimientos }: { movimientos: readonly MovimientoCaja[] }) {
  if (movimientos.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
        Todavía no hay movimientos en esta caja.
      </p>
    );
  }
  return (
    <ul
      aria-label="Movimientos"
      className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-sky-100"
    >
      {movimientos.map((movimiento) => {
        const esEgreso = movimiento.tipo === 'EGRESO';
        return (
          <li key={movimiento.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 sm:px-5">
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
              <p className="break-words font-medium text-slate-900">{titulo(movimiento)}</p>
              <p className="break-words text-sm text-slate-700">
                {formatearHora(movimiento.registradoEn)} · N.º {movimiento.numero}
                {movimiento.comprobante ? ` · Comprobante: ${movimiento.comprobante}` : ''} · Registró{' '}
                {movimiento.registradoPor.nombres} {movimiento.registradoPor.apellidos}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Insignia color="gris">{ETIQUETA_METODO[movimiento.metodo]}</Insignia>
              <p className={`text-right font-semibold ${esEgreso ? 'text-red-800' : 'text-slate-900'}`}>
                <span className="sr-only">{esEgreso ? 'Egreso de ' : 'Ingreso de '}</span>
                <span aria-hidden="true">{esEgreso ? '−' : '+'} </span>
                {formatearSoles(movimiento.monto)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
