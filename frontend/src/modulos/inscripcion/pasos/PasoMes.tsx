import type { MesesInscripcion } from '@aquagestion/contratos';
import { Alerta, ESTILO_BOTON } from '../../../componentes/ui';
import { formatearDiaYMes, formatearMes, nombreDelMes } from '../../../lib/fechas';

interface Propiedades {
  meses: MesesInscripcion;
  /** El mes elegido (`AAAA-MM`), o vacío si todavía no eligió. */
  valor: string;
  alElegir: (mes: string) => void;
  error: string | undefined;
  /** La oferta del mes elegido: cargando, o con su error y la forma de pedirla otra vez. */
  oferta: { cargando: boolean; error: string | null; reintentar: () => void };
}

function capitalizada(texto: string): string {
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
}

/**
 * Paso «¿Desde cuándo?» (010d, criterio 17): solo aparece cuando la API ofrece dos meses. «Este mes, desde hoy» o «{Mes siguiente} completo,
 * desde el 1», con la fecha límite para elegir el mes siguiente. Las dos opciones se muestran con el mismo peso: la web no sugiere ninguna
 * (DR-5). Las fechas son las que dio la API; nada se calcula con el reloj del navegador.
 */
export function PasoMes({ meses, valor, alElegir, error, oferta }: Propiedades) {
  const [enCurso, siguiente] = meses.meses;
  if (!enCurso || !siguiente) return null;
  const opciones = [
    {
      mes: enCurso.mes,
      titulo: 'Este mes, desde hoy',
      detalle: `${capitalizada(formatearMes(enCurso.mes))}. Empiezas hoy, ${formatearDiaYMes(enCurso.fechaInicio)}, y pagas las clases que quedan del mes.`,
    },
    {
      mes: siguiente.mes,
      titulo: `${capitalizada(nombreDelMes(siguiente.mes))} completo, desde el 1`,
      detalle: `${capitalizada(formatearMes(siguiente.mes))}. Empiezas el ${formatearDiaYMes(siguiente.fechaInicio)} con el mes entero.`,
    },
  ];
  return (
    <div className="space-y-4">
      <fieldset className="min-w-0" aria-describedby={error ? 'error-mes' : undefined}>
        <legend className="text-sm font-medium text-slate-800">Elige desde cuándo empiezas</legend>
        <div className="mt-1 space-y-2">
          {opciones.map((opcion) => (
            <label
              key={opcion.mes}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg bg-white p-3 text-base text-slate-900 ring-1 ring-slate-300 has-[:checked]:ring-2 has-[:checked]:ring-sky-700"
            >
              <input
                type="radio"
                name="mes-de-inscripcion"
                value={opcion.mes}
                checked={valor === opcion.mes}
                onChange={() => alElegir(opcion.mes)}
                className="mt-1 size-5 shrink-0 accent-sky-700"
              />
              <span className="min-w-0">
                <span className="block font-medium">{opcion.titulo}</span>
                <span className="block text-sm text-slate-700">{opcion.detalle}</span>
              </span>
            </label>
          ))}
        </div>
        {error ? (
          <p id="error-mes" role="alert" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </fieldset>
      <p className="text-sm text-slate-700">
        Puedes elegir {nombreDelMes(siguiente.mes)} hasta el {formatearDiaYMes(siguiente.inscripcionHasta)}.
      </p>
      {oferta.error ? (
        <div className="space-y-2">
          <Alerta>{oferta.error}</Alerta>
          <button type="button" onClick={oferta.reintentar} className={ESTILO_BOTON.secundario}>
            Reintentar
          </button>
        </div>
      ) : oferta.cargando ? (
        <p role="status" className="text-sm text-slate-700">
          Cargando los planes y los cupos de ese mes…
        </p>
      ) : null}
    </div>
  );
}
