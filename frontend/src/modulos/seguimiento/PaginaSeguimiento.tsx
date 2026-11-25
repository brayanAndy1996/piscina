import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { MarcoPublico } from '../../componentes/MarcoPublico';
import { frasePorTelefono } from '../../componentes/Telefono';
import { Alerta, Aviso, ESTILO_BOTON } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { useSolicitudPorToken } from './hooks';
import { SeccionComprobante } from './SeccionComprobante';
import { SeccionFoto } from './SeccionFoto';
import { VistaSeguimiento } from './VistaSeguimiento';

/** El título de la pestaña nunca lleva el token (criterio 44 de 005): es el mismo para toda solicitud. */
export const TITULO_SEGUIMIENTO = 'Seguimiento de tu solicitud · AquaGestión';

/** Pone un título de pestaña mientras la página está a la vista y devuelve el anterior al salir. */
function useTituloDePagina(titulo: string) {
  useEffect(() => {
    const anterior = document.title;
    document.title = titulo;
    return () => {
      document.title = anterior;
    };
  }, [titulo]);
}

/**
 * `/a/{nombreCorto}/solicitud/{token}`: el seguimiento con el enlace secreto (HU-01, D-05, D-27). Consulta con el token en el cuerpo y
 * muestra la vista mínima. El token solo vive en la memoria de la página: no se guarda en `localStorage`, `sessionStorage` ni cookies, y
 * `index.html` declara `no-referrer` para que no salga hacia otros sitios.
 */
export function PaginaSeguimiento() {
  const { nombreCorto = '', token = '' } = useParams();
  useTituloDePagina(TITULO_SEGUIMIENTO);
  return (
    <MarcoPublico nombreCorto={nombreCorto}>
      <ContenidoSeguimiento nombreCorto={nombreCorto} token={token} />
    </MarcoPublico>
  );
}

function ContenidoSeguimiento({ nombreCorto, token }: { nombreCorto: string; token: string }) {
  const consulta = useSolicitudPorToken(nombreCorto, token);
  const consultaPorCodigo = `/a/${encodeURIComponent(nombreCorto)}/solicitud`;
  // Un aviso de la foto o del comprobante sigue a la vista aunque la vista cambie y su sección desaparezca (criterio 44 de 005, 55 de 007).
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);

  if (consulta.data === undefined) {
    if (consulta.isPending) {
      return (
        <p role="status" className="text-slate-600">
          Buscando tu solicitud…
        </p>
      );
    }
    const noExiste = esErrorDeApi(consulta.error, 404, 'SOLICITUD_NO_ENCONTRADA');
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-sky-900">Seguimiento de tu solicitud</h1>
        <Alerta>
          {noExiste
            ? 'No encontramos una solicitud con ese enlace. Revisa que esté completo o consúltala con tu código y tu DNI.'
            : esErrorDeApi(consulta.error, 429)
              ? 'Hiciste demasiadas consultas. Espera un minuto e inténtalo de nuevo.'
              : mensajeGeneral(consulta.error)}
        </Alerta>
        {noExiste ? (
          <Link to={consultaPorCodigo} className={ESTILO_BOTON.secundario}>
            Consultar con mi código y mi DNI
          </Link>
        ) : (
          <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
            Reintentar
          </button>
        )}
      </div>
    );
  }

  const respuesta = consulta.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-sky-900">Seguimiento de tu solicitud</h1>
      <VistaSeguimiento respuesta={respuesta} />
      {respuesta.solicitud.estado === 'PENDIENTE_PAGO' || respuesta.solicitud.estado === 'PAGO_RECHAZADO' ? (
        <SeccionComprobante
          // Otro estado es otro formulario: la clave de idempotencia de un envío no pasa al siguiente.
          key={respuesta.solicitud.estado}
          nombreCorto={nombreCorto}
          token={token}
          solicitud={respuesta.solicitud}
          datosDePago={respuesta.academia.datosDePago}
          telefono={respuesta.academia.telefono}
          alActualizar={() => consulta.refetch()}
          alAvisar={setAvisoFoto}
        />
      ) : null}
      {respuesta.solicitud.estado === 'PENDIENTE_PAGO' ||
      respuesta.solicitud.estado === 'EN_VERIFICACION' ||
      respuesta.solicitud.estado === 'PAGO_RECHAZADO' ? (
        <SeccionFoto
          nombreCorto={nombreCorto}
          token={token}
          fotoCargada={respuesta.solicitud.fotoCargada}
          telefono={respuesta.academia.telefono}
          alActualizar={() => consulta.refetch()}
          alAvisar={setAvisoFoto}
        />
      ) : null}
      {avisoFoto ? <Aviso>{avisoFoto}</Aviso> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void consulta.refetch()}
          disabled={consulta.isFetching}
          className={ESTILO_BOTON.secundario}
        >
          {consulta.isFetching ? 'Actualizando…' : 'Actualizar'}
        </button>
        {consulta.isError ? (
          <p role="alert" className="text-sm text-red-700">
            No se pudo actualizar.{frasePorTelefono(respuesta.academia.telefono)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
