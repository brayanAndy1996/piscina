import { useId, useState } from 'react';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoSelect, ESTILO_BOTON } from '../../componentes/ui';
import { formatearMes } from '../../lib/fechas';
import { ListaDeAsistencia } from '../asistencia/ListaDeAsistencia';
import { useAlPerderSesion } from '../sesion/hooks';
import { mensajeDelPanel } from './etiquetas';
import { useMiAsistencia } from './hooks';

interface Propiedades {
  /** El mes en curso de Lima, que da la API: el panel no usa el reloj del navegador (DT-7). */
  mesEnCurso: string;
  /** Los meses que se pueden consultar, del más nuevo al más viejo (DR-2). */
  mesesDeAsistencia: readonly string[];
}

/**
 * «Mi asistencia» (spec 011, criterio 18): un selector de mes con los de la API (por defecto el mes en curso), los totales del mes y cada día
 * con «Puntual», «Tarde» o «Falta» y la hora de llegada. Solo lectura.
 */
export function MiAsistencia({ mesEnCurso, mesesDeAsistencia }: Propiedades) {
  const idTitulo = useId();
  const [elegido, setElegido] = useState(mesEnCurso);
  // Si la lista cambia y ya no trae el mes elegido, vuelve al mes en curso.
  const mes = mesesDeAsistencia.includes(elegido) ? elegido : mesEnCurso;
  const consulta = useMiAsistencia(mes);
  useAlPerderSesion(consulta.error);
  const datos = consulta.data;

  return (
    <section
      aria-labelledby={idTitulo}
      className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 id={idTitulo} className="text-xl font-semibold text-slate-900">
          Mi asistencia
        </h2>
        <div className="sm:w-56">
          <CampoSelect etiqueta="Mes" value={mes} onChange={(evento) => setElegido(evento.target.value)}>
            {mesesDeAsistencia.map((m) => (
              <option key={m} value={m}>
                {formatearMes(m)}
              </option>
            ))}
          </CampoSelect>
        </div>
      </div>

      {datos ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
            <Alerta>No pudimos actualizar tu asistencia. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}
          <ListaDeAsistencia
            datos={datos}
            mes={mes}
            mostrarOrigen={false}
            sinMensualidad={`No tuviste una mensualidad en ${formatearMes(mes)}.`}
          />
        </>
      ) : consulta.isError ? (
        esErrorDeApi(consulta.error, 401) ? null : (
          <div className="space-y-3">
            <Alerta>{mensajeDelPanel(consulta.error)}</Alerta>
            {esErrorDeApi(consulta.error, 404) ? null : (
              <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
                Volver a intentar
              </button>
            )}
          </div>
        )
      ) : (
        <p role="status" className="text-slate-700">
          Cargando tu asistencia…
        </p>
      )}
    </section>
  );
}
