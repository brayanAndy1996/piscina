import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON } from '../../componentes/ui';
import { DescargaCanceladaError } from '../../lib/descargas-en-curso';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { useDescargarPdfDelCarnet } from './hooks';
import { mensajeDeDescarga } from './mensajes';

/** «Descargar PDF» del carnet (criterio 11 de 008). Con `alumnoId` nulo descarga el de la propia persona. El aviso de error va debajo del botón. */
export function BotonDescargarPdf({ alumnoId }: { alumnoId: string | null }) {
  const descarga = useDescargarPdfDelCarnet(alumnoId);
  useAlPerderSesion(descarga.error);
  const ocupado = descarga.isPending || descarga.cerrandoLaSesion;
  const mostrarError =
    descarga.isError &&
    !(descarga.error instanceof DescargaCanceladaError) &&
    !esErrorDeApi(descarga.error, 401) &&
    !esErrorDeCambioDeSesion(descarga.error);

  return (
    <>
      <button type="button" onClick={descarga.descargar} disabled={ocupado} className={ESTILO_BOTON.primario}>
        {descarga.isPending ? 'Preparando el PDF…' : 'Descargar PDF'}
      </button>
      {mostrarError ? (
        <div className="w-full">
          <Alerta>{mensajeDeDescarga(descarga.error)}</Alerta>
        </div>
      ) : null}
    </>
  );
}
