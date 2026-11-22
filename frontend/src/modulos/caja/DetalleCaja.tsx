import { puede } from '@aquagestion/contratos';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, Aviso, ESTILO_BOTON } from '../../componentes/ui';
import { useRecienPedida } from '../../lib/base-de-llenado';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario } from '../../lib/fechas';
import { useUsuario } from '../sesion/contexto';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { CierresDeLaCaja } from './CierresDeLaCaja';
import { DialogoReapertura } from './DialogoReapertura';
import { useDetalleCaja, useHoyEnLima } from './hooks';
import { ListaMovimientos } from './ListaMovimientos';
import { mensajeDeCaja } from './mensajes';
import { ResumenCaja } from './ResumenCaja';

/** `/panel/cajas/:id`: una caja del historial, de solo lectura (HU-27, criterio 41). Quien tiene `VER_REPORTES_FINANCIEROS`. */
export function DetalleCaja() {
  return (
    <RequierePermiso permiso="VER_REPORTES_FINANCIEROS">
      <ContenidoDelDetalle />
    </RequierePermiso>
  );
}

function VolverAlHistorial() {
  return (
    <Link to="/panel/cajas" className="inline-block text-sky-800 underline">
      ← Volver al historial de caja
    </Link>
  );
}

function ContenidoDelDetalle() {
  const { id = '' } = useParams();
  const usuario = useUsuario();
  const consulta = useDetalleCaja(id);
  useAlPerderSesion(consulta.error);
  const verCaja = useRecienPedida(consulta);
  const [reabriendo, setReabriendo] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  const [problema, setProblema] = useState<string | null>(null);
  const hoy = useHoyEnLima();
  const caja = consulta.data;
  // "De otro día" se decide con el "hoy" de Lima de esta página, no solo con lo que la API dijo al responder.
  const deOtroDia = caja !== undefined && (caja.deOtroDia || caja.fecha !== hoy);

  const alReabrir = () => {
    setProblema(null);
    setHecho(
      deOtroDia
        ? 'Caja reabierta. Es la caja de un día anterior: solo se puede volver a contar el efectivo y cerrarla.'
        : 'Caja reabierta. Ya admite egresos y cobros.',
    );
    setReabriendo(false);
  };
  /** Un error que dejó la caja distinta de como se veía: la consulta ya se vuelve a pedir; aquí solo se explica y se cierra el diálogo. */
  const alFallar = (error: unknown) => {
    setHecho(null);
    setProblema(mensajeDeCaja(error));
    setReabriendo(false);
  };

  if (consulta.isError && !verCaja) {
    return (
      <div className="space-y-4">
        <VolverAlHistorial />
        <h1 className="text-2xl font-semibold text-slate-900">Detalle de la caja</h1>
        {esErrorDeApi(consulta.error, 404) ? (
          <Alerta>No se encontró la caja. Puede que no exista o que no tengas acceso a ella.</Alerta>
        ) : (
          <div className="space-y-3">
            {esErrorDeApi(consulta.error, 401) ? null : (
              <Alerta>No se pudo cargar la caja. {mensajeGeneral(consulta.error)}</Alerta>
            )}
            <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
              Reintentar
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <VolverAlHistorial />
      <h1 className="text-2xl font-semibold text-slate-900">Detalle de la caja</h1>

      {hecho ? (
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          {hecho}
        </p>
      ) : null}
      {problema ? <Alerta>{problema}</Alerta> : null}

      {verCaja && caja !== undefined ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
            <Alerta>No pudimos actualizar la caja. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}

          {caja.estado === 'ABIERTA' ? (
            <div className="space-y-3">
              {deOtroDia ? (
                <Aviso>
                  La caja del {formatearFechaCalendario(caja.fecha)} sigue abierta. No admite egresos ni cobros: solo se
                  puede cerrar.
                </Aviso>
              ) : null}
              {puede(usuario.rol, 'ABRIR_CERRAR_CAJA') ? (
                <Link to="/panel/caja" className={ESTILO_BOTON.primario}>
                  Ir a la caja del día
                </Link>
              ) : null}
            </div>
          ) : puede(usuario.rol, 'REABRIR_CAJA') ? (
            <div>
              <button type="button" onClick={() => setReabriendo(true)} className={ESTILO_BOTON.secundario}>
                Reabrir caja
              </button>
            </div>
          ) : null}

          <ResumenCaja caja={caja} />
          <CierresDeLaCaja caja={caja} />
          <h2 className="text-xl font-semibold text-slate-900">Movimientos</h2>
          <ListaMovimientos movimientos={caja.movimientos} />

          {reabriendo && caja.estado === 'CERRADA' && puede(usuario.rol, 'REABRIR_CAJA') ? (
            <DialogoReapertura
              caja={caja}
              deOtroDia={deOtroDia}
              alCerrar={() => setReabriendo(false)}
              alReabrir={alReabrir}
              alFallar={alFallar}
            />
          ) : null}
        </>
      ) : (
        <p role="status" className="text-slate-700">
          Cargando la caja…
        </p>
      )}
    </div>
  );
}
