import { puede, type RespuestaInscripcionCreada } from '@aquagestion/contratos';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alerta, Aviso, ESTILO_BOTON } from '../../componentes/ui';
import { formatearFechaHora, formatearMesDesde } from '../../lib/fechas';
import { formatearSoles } from '../../lib/dinero';
import { frasePorTelefono } from '../../componentes/Telefono';
import { useSesionAcademia } from '../sesion/hooks';
import { CuadroDeMonto } from './pasos/PasoResumen';

type Solicitud = RespuestaInscripcionCreada['solicitud'];

function BotonCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [estado, setEstado] = useState<'inicial' | 'copiado' | 'fallo'>('inicial');
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado('copiado');
    } catch {
      setEstado('fallo');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void copiar()} className={ESTILO_BOTON.secundario}>
        {etiqueta}
      </button>
      {estado === 'copiado' ? (
        <span role="status" className="text-sm text-emerald-800">
          Copiado
        </span>
      ) : null}
      {estado === 'fallo' ? (
        <span role="status" className="text-sm text-red-700">
          No se pudo copiar. Selecciona el texto y cópialo.
        </span>
      ) : null}
    </div>
  );
}

/**
 * Para quien inscribe desde recepción (hay una sesión de `ADMIN` o `SECRETARIA` de esta academia, spec 007a, criterio 34): un enlace a las
 * solicitudes, donde se cobra en efectivo. Un cliente sin sesión no ve nada de esto.
 */
function EnlaceDeRecepcion() {
  const { nombreCorto = '' } = useParams();
  const sesion = useSesionAcademia();
  const usuario = sesion.data?.usuario;
  if (
    !usuario ||
    usuario.academia.nombreCorto !== nombreCorto ||
    usuario.debeCambiarClave ||
    !puede(usuario.rol, 'REGISTRAR_INSCRIPCION_Y_COBRO')
  ) {
    return null;
  }
  return (
    <section aria-label="Recepción" className="space-y-2 rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
      <p className="text-slate-800">
        Inscribiste desde recepción. Para cobrar en efectivo, abre la solicitud en el panel (con la caja de hoy
        abierta).
      </p>
      <Link to="/panel/solicitudes" className={ESTILO_BOTON.primario}>
        Ir a cobrar en las solicitudes
      </Link>
    </section>
  );
}

/** Cómo va la foto que se subió con la solicitud: `null` si no se eligió ninguna. */
export type EstadoDeLaFoto = 'subiendo' | 'cargada' | 'fallo' | null;

/**
 * Al terminar (201): el código y el enlace de seguimiento, con un aviso para guardarlos y un botón para copiarlos (criterio 43, D-05). El
 * enlace lleva el token, que solo se ve aquí y en el correo: no se guarda en ninguna parte del navegador. Si la foto falla, la solicitud
 * sigue creada y el código y el enlace se ven igual: la foto se puede subir desde el seguimiento (criterio 43).
 */
export function ConfirmacionInscripcion({
  solicitud,
  telefono,
  foto = null,
}: {
  solicitud: Solicitud;
  telefono: string | null;
  foto?: EstadoDeLaFoto;
}) {
  const enlaceCompleto = `${window.location.origin}${solicitud.enlace}`;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-sky-900">Tu solicitud quedó registrada</h1>
      <Aviso>
        <strong>Guarda tu código y tu enlace.</strong> Son la única forma de seguir tu solicitud. No compartas el
        enlace: da acceso a tu información.
      </Aviso>

      {foto === 'subiendo' ? (
        <p role="status" className="text-slate-800">
          Subiendo tu foto…
        </p>
      ) : null}
      {foto === 'cargada' ? (
        <p role="status" className="text-emerald-800">
          Foto cargada.
        </p>
      ) : null}
      {foto === 'fallo' ? (
        <Alerta>
          Tu solicitud quedó creada, pero no pudimos subir la foto. Puedes subirla desde el enlace de seguimiento.
          {frasePorTelefono(telefono)}
        </Alerta>
      ) : null}

      <section aria-label="Tu código" className="space-y-2 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <p className="text-sm text-slate-700">Código de la solicitud</p>
        <p className="font-mono text-3xl font-semibold tracking-wider text-slate-900">{solicitud.codigo}</p>
        <BotonCopiar texto={solicitud.codigo} etiqueta="Copiar código" />
      </section>

      <section aria-label="Tu enlace" className="space-y-2 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <p className="text-sm text-slate-700">Enlace de seguimiento</p>
        <p className="break-all rounded-lg bg-slate-50 p-2 font-mono text-sm text-slate-900">{enlaceCompleto}</p>
        <BotonCopiar texto={enlaceCompleto} etiqueta="Copiar enlace" />
        <Link to={solicitud.enlace} className="inline-block min-h-11 py-2 text-base text-sky-800 underline">
          Ver el seguimiento de mi solicitud
        </Link>
      </section>

      <CuadroDeMonto cotizacion={solicitud.cotizacion} />

      <p className="text-slate-800">
        Tu inscripción es para:{' '}
        <strong>{formatearMesDesde(solicitud.cotizacion.mes, solicitud.cotizacion.fechaInicio)}</strong>.
      </p>

      <EnlaceDeRecepcion />

      <p className="text-slate-800">
        Tu cupo está reservado hasta el {formatearFechaHora(solicitud.reservaVenceEn)} (hora de Lima). Paga{' '}
        {formatearSoles(solicitud.cotizacion.monto)} en recepción antes de esa hora para confirmar tu inscripción; si
        no, el cupo se libera.{frasePorTelefono(telefono)}
      </p>
    </div>
  );
}
