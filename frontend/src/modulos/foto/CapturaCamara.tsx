import { useEffect, useRef, useState } from 'react';
import { Alerta, ESTILO_BOTON } from '../../componentes/ui';
import { MENSAJE_CAMARA } from './mensajes';

interface Propiedades {
  /** Se llama con el JPEG de la foto cuando la persona pulsa «Usar esta foto». */
  alUsar: (imagen: Blob) => void;
  /** Mientras se sube la foto, los botones quedan quietos. */
  ocupado?: boolean;
}

/** Calidad del JPEG que sale del `canvas` (DT-11 de 008). */
export const CALIDAD_JPEG = 0.9;

type Fase = 'pidiendo' | 'viva' | 'capturada' | 'error';

/** La cámara solo existe en un contexto seguro (`localhost` o HTTPS): fuera de él `navigator.mediaDevices` no está. */
function dispositivosDeMedios(): MediaDevices | null {
  const dispositivos = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  return typeof dispositivos?.getUserMedia === 'function' ? dispositivos : null;
}

/**
 * Tomar la foto con la cámara del equipo (criterio 28 y DT-11 de 008b), sin librerías: `getUserMedia` da la vista en vivo, «Tomar foto» la
 * congela en un `canvas` del tamaño del video y la convierte en un JPEG de calidad 0,9. Al desmontarse (cerrar el diálogo, cambiar de opción
 * o de página) se detienen todas las pistas de la cámara, incluso si el permiso llega después de haberse ido. Sin permiso, sin cámara o
 * fuera de un contexto seguro (`localhost` o HTTPS) avisa y no pide nada más.
 */
export function CapturaCamara({ alUsar, ocupado = false }: Propiedades) {
  const [fase, setFase] = useState<Fase>(() => (dispositivosDeMedios() ? 'pidiendo' : 'error'));
  const [imagen, setImagen] = useState<Blob | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const flujo = useRef<MediaStream | null>(null);

  useEffect(() => {
    let sigue = true;
    const apagar = () => {
      for (const pista of flujo.current?.getTracks() ?? []) pista.stop();
      flujo.current = null;
    };
    const dispositivos = dispositivosDeMedios();
    if (!dispositivos) return undefined;
    dispositivos.getUserMedia({ video: true, audio: false }).then(
      (obtenido) => {
        flujo.current = obtenido;
        if (!sigue) {
          apagar();
          return;
        }
        if (video.current) {
          video.current.srcObject = obtenido;
          // jsdom no implementa `play`; en el navegador, un rechazo (por ejemplo, por ahorro de energía) no impide ver el video.
          void Promise.resolve(video.current.play?.()).catch(() => undefined);
        }
        setFase('viva');
      },
      () => {
        if (sigue) setFase('error');
      },
    );
    return () => {
      sigue = false;
      apagar();
    };
  }, []);

  const fallar = () => {
    for (const pista of flujo.current?.getTracks() ?? []) pista.stop();
    flujo.current = null;
    setFase('error');
  };

  const tomar = () => {
    const origen = video.current;
    const destino = lienzo.current;
    const ancho = origen?.videoWidth ?? 0;
    const alto = origen?.videoHeight ?? 0;
    const contexto = destino?.getContext('2d');
    if (!origen || !destino || !contexto || ancho === 0 || alto === 0) {
      fallar();
      return;
    }
    destino.width = ancho;
    destino.height = alto;
    contexto.drawImage(origen, 0, 0, ancho, alto);
    destino.toBlob(
      (blob) => {
        if (!blob) {
          fallar();
          return;
        }
        setImagen(blob);
        setFase('capturada');
      },
      'image/jpeg',
      CALIDAD_JPEG,
    );
  };

  const volverATomar = () => {
    setImagen(null);
    setFase('viva');
  };

  if (fase === 'error') return <Alerta>{MENSAJE_CAMARA}</Alerta>;

  return (
    <div className="space-y-3">
      {fase === 'pidiendo' ? (
        <p role="status" className="text-slate-700">
          Esperando el permiso para usar la cámara…
        </p>
      ) : null}
      <div className={fase === 'pidiendo' ? 'hidden' : 'overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-300'}>
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          aria-label="Vista en vivo de la cámara"
          className={`mx-auto max-h-[50vh] w-full object-contain ${fase === 'capturada' ? 'hidden' : ''}`}
        />
        <canvas
          ref={lienzo}
          role="img"
          aria-label="Foto tomada con la cámara"
          className={`mx-auto max-h-[50vh] w-full object-contain ${fase === 'capturada' ? '' : 'hidden'}`}
        />
      </div>
      {fase === 'viva' ? (
        <button type="button" onClick={tomar} className={ESTILO_BOTON.primario}>
          Tomar foto
        </button>
      ) : null}
      {fase === 'capturada' ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={volverATomar} disabled={ocupado} className={ESTILO_BOTON.secundario}>
            Volver a tomar
          </button>
          <button
            type="button"
            onClick={() => imagen && alUsar(imagen)}
            disabled={ocupado || !imagen}
            className={ESTILO_BOTON.primario}
          >
            {ocupado ? 'Guardando…' : 'Usar esta foto'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
