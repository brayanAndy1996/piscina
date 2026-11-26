import { useEffect, useId, useRef, useState } from 'react';
import { Alerta } from '../../componentes/ui';

/** Lo que dice la pantalla cuando la cámara no se puede usar; siempre queda el campo de la lectora (criterio 19). */
export const MENSAJE_SIN_CAMARA_SEGURA =
  'La cámara solo funciona desde localhost o con HTTPS. Usa la lectora o busca al alumno.';
const MENSAJE_PERMISO = 'No se pudo usar la cámara: falta el permiso. Actívalo en el navegador o usa la lectora.';
const MENSAJE_NO_HAY = 'No se encontró una cámara en este equipo. Usa la lectora o busca al alumno.';
const MENSAJE_FALLO = 'No se pudo encender la cámara. Usa la lectora o busca al alumno.';

function hayCamara(): boolean {
  return window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function mensajeDeFalloDeCamara(falla: unknown): string {
  const nombre = falla instanceof Error ? falla.name : typeof falla === 'string' ? falla : '';
  const texto = typeof falla === 'string' ? falla : falla instanceof Error ? falla.message : '';
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError' || /permission|denied/i.test(texto))
    return MENSAJE_PERMISO;
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError' || /not found|no camera/i.test(texto))
    return MENSAJE_NO_HAY;
  return MENSAJE_FALLO;
}

interface Propiedades {
  /** Cada vez que la cámara decodifica un QR. Puede llegar varias veces seguidas con el mismo contenido: quien la usa decide qué ignorar. */
  alLeer: (contenido: string) => void;
  /** La cámara no pudo encenderse (sin permiso, sin cámara, fuera de HTTPS). */
  alFallar?: (mensaje: string) => void;
}

/**
 * La cámara con `html5-qrcode` (criterio 19, DT-12). La biblioteca se carga recién al encender la cámara (import dinámico) para que no pese en
 * las demás pantallas. La cámara se apaga cuando el componente se desmonta: al salir de la página, al cambiar de modo o al pulsar «Apagar la
 * cámara», porque quien lo usa deja de dibujarlo. Si el desmontaje llega antes de que termine de encenderse, se apaga apenas enciende.
 */
export function LectorCamara({ alLeer, alFallar }: Propiedades) {
  const idBase = useId();
  const idDelVisor = `visor-${idBase.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [aviso, setAviso] = useState<string | null>(hayCamara() ? null : MENSAJE_SIN_CAMARA_SEGURA);
  const [encendida, setEncendida] = useState(false);
  // Las funciones de quien llama cambian en cada dibujo: se leen desde una referencia para no reiniciar la cámara.
  const alLeerRef = useRef(alLeer);
  const alFallarRef = useRef(alFallar);
  useEffect(() => {
    alLeerRef.current = alLeer;
    alFallarRef.current = alFallar;
  });

  useEffect(() => {
    if (!hayCamara()) {
      alFallarRef.current?.(MENSAJE_SIN_CAMARA_SEGURA);
      return;
    }
    let cancelado = false;
    let apagar: (() => Promise<void>) | null = null;

    const encender = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (cancelado) return;
        const lector = new Html5Qrcode(idDelVisor, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          verbose: false,
        });
        apagar = async () => {
          try {
            await lector.stop();
          } catch {
            // Ya estaba apagada o nunca llegó a encender: no hay nada más que soltar.
          }
          try {
            lector.clear();
          } catch {
            // El visor ya no está en la página.
          }
        };
        await lector.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (contenido) => {
            if (!cancelado) alLeerRef.current(contenido);
          },
          () => undefined,
        );
        if (cancelado) {
          await apagar();
          return;
        }
        setEncendida(true);
      } catch (falla) {
        if (cancelado) return;
        const mensaje = mensajeDeFalloDeCamara(falla);
        setAviso(mensaje);
        alFallarRef.current?.(mensaje);
      }
    };
    void encender();

    return () => {
      cancelado = true;
      if (apagar) void apagar();
    };
  }, [idDelVisor]);

  return (
    <div className="space-y-2">
      {aviso ? <Alerta>{aviso}</Alerta> : null}
      <div
        id={idDelVisor}
        role="region"
        aria-label="Cámara para leer el QR"
        className={aviso ? 'hidden' : 'mx-auto w-full max-w-sm overflow-hidden rounded-lg bg-slate-900'}
      />
      {!aviso && !encendida ? (
        <p role="status" className="text-sm text-slate-700">
          Encendiendo la cámara…
        </p>
      ) : null}
    </div>
  );
}
