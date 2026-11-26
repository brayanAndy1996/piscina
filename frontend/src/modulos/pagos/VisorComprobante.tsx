import type { PagoPendiente } from '@aquagestion/contratos';
import { useState } from 'react';
import { Alerta, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { formatearSoles } from '../../lib/dinero';
import { formatearFechaCalendario } from '../../lib/fechas';
import { useAlPerderSesion } from '../sesion/hooks';
import { ETIQUETA_METODO } from '../caja/montos';
import { mensajeDeImagen, rotuloDelPago } from './mensajes';
import { useImagenDelComprobante } from './hooks';

interface Propiedades {
  pago: PagoPendiente;
  alCerrar: () => void;
}

/**
 * La imagen de un comprobante (HU-09, criterio 56 de 007b), pedida con la sesión y mostrada con una dirección de objeto que se libera al
 * cerrar. Se puede ampliar a su tamaño real y desplazarse por ella, para leer el número de operación; junto a la imagen van los datos que
 * escribió la persona, para compararlos sin cerrar el visor.
 */
export function VisorComprobante({ pago, alCerrar }: Propiedades) {
  const [intento, setIntento] = useState(0);
  const [ampliada, setAmpliada] = useState(false);
  const imagen = useImagenDelComprobante(pago.id, intento);
  useAlPerderSesion(imagen.estado === 'error' ? imagen.error : null);
  const nombre = `${pago.cliente.nombres} ${pago.cliente.apellidos}`;

  return (
    <Modal titulo={`Comprobante de ${rotuloDelPago(pago)}`} alCerrar={alCerrar} ancho="amplio">
      <div className="mt-2 space-y-3">
        <p className="break-words text-slate-700">
          <strong className="text-slate-900">{nombre}</strong> · {ETIQUETA_METODO[pago.metodo]} por{' '}
          <strong className="text-slate-900">{formatearSoles(pago.monto)}</strong> · Operación{' '}
          <strong className="break-all font-mono text-slate-900">{pago.numeroOperacion}</strong> del{' '}
          {formatearFechaCalendario(pago.fechaOperacion)}
        </p>

        {imagen.estado === 'cargando' ? (
          <p role="status" className="rounded-2xl bg-slate-50 p-6 text-center text-slate-700 ring-1 ring-slate-200">
            Cargando la imagen…
          </p>
        ) : null}
        {imagen.estado === 'error' ? (
          <div className="space-y-2">
            <Alerta>{mensajeDeImagen(imagen.error)}</Alerta>
            <button type="button" onClick={() => setIntento((n) => n + 1)} className={ESTILO_BOTON.secundario}>
              Reintentar
            </button>
          </div>
        ) : null}
        {imagen.estado === 'lista' ? (
          <div
            className={`rounded-2xl bg-slate-100 ring-1 ring-slate-200 ${ampliada ? 'max-h-[65vh] overflow-auto' : ''}`}
          >
            <img
              src={imagen.url}
              alt={`Imagen del comprobante de ${nombre}`}
              className={ampliada ? 'max-w-none' : 'mx-auto max-h-[60vh] w-auto max-w-full object-contain'}
            />
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
            Cerrar
          </button>
          {imagen.estado === 'lista' ? (
            <button
              type="button"
              onClick={() => setAmpliada((valor) => !valor)}
              aria-pressed={ampliada}
              className={ESTILO_BOTON.primario}
            >
              {ampliada ? 'Reducir la imagen' : 'Ampliar la imagen'}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
