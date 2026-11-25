import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON } from '../../componentes/ui';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { BotonDescargarPdf } from './BotonDescargarPdf';
import { useMiCarnet } from './hooks';
import { mensajeDeCarnet } from './mensajes';
import { VistaCarnet } from './VistaCarnet';

/**
 * `/panel/mi-carnet`: el carnet del propio alumno (HU-13, criterio 20 de 008). Solo `ALUMNO` (`VER_CARNET` con alcance `PROPIO`) y de solo
 * lectura (D-14): el QR grande, legible en el celular, y «Descargar PDF». No pide ningún id: la API usa la sesión.
 */
export function PaginaMiCarnet() {
  return (
    <RequierePermiso permiso="VER_CARNET" alcance="PROPIO">
      <ContenidoMiCarnet />
    </RequierePermiso>
  );
}

function ContenidoMiCarnet() {
  const consulta = useMiCarnet();
  useAlPerderSesion(consulta.error);
  const carnet = consulta.data;

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Mi carnet</h1>

      {carnet ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
            <Alerta>No pudimos actualizar tu carnet. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}
          <VistaCarnet carnet={carnet} acciones={<BotonDescargarPdf alumnoId={null} />} />
        </>
      ) : consulta.isError ? (
        esErrorDeApi(consulta.error, 401) ? null : (
          <div className="space-y-3">
            <Alerta>{mensajeDeCarnet(consulta.error)}</Alerta>
            <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
              Volver a intentar
            </button>
          </div>
        )
      ) : (
        <p role="status" className="text-slate-700">
          Cargando tu carnet…
        </p>
      )}
    </div>
  );
}
