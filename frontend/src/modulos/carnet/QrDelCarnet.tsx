import { OPCIONES_QR } from '@aquagestion/contratos';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

interface Propiedades {
  /** El texto del QR (`AQ1:` y el token), tal como lo devuelve el carnet. Nunca se muestra ni se pone en un atributo. */
  contenido: string;
  /** Medidas de Tailwind del lado. Por defecto 224 px en el celular y 288 px desde `sm`. */
  className?: string;
}

/** El SVG como dirección `data:` (solo ASCII, así que `btoa` basta): se muestra con `<img>`, sin `dangerouslySetInnerHTML`. */
function direccionDelSvg(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * El QR del carnet (criterios 12 y 20 de 008), dibujado en el navegador con `qrcode` y las mismas opciones que el PDF (`OPCIONES_QR`, DT-5):
 * el mismo texto da el mismo QR en pantalla y en papel. Es una imagen cuadrada de al menos 224 px, con su margen blanco (la zona de silencio),
 * para que el lector del celular lo vea bien. El texto alternativo no lleva el token.
 */
export function QrDelCarnet({ contenido, className = 'w-56 sm:w-72' }: Propiedades) {
  const [dibujo, setDibujo] = useState<{ para: string; resultado: { url: string } | { error: true } } | null>(null);
  useEffect(() => {
    let vigente = true;
    QRCode.toString(contenido, { ...OPCIONES_QR, type: 'svg' }).then(
      (svg) => {
        if (vigente) setDibujo({ para: contenido, resultado: { url: direccionDelSvg(svg) } });
      },
      () => {
        if (vigente) setDibujo({ para: contenido, resultado: { error: true } });
      },
    );
    return () => {
      vigente = false;
    };
  }, [contenido]);

  // Un dibujo de un contenido anterior (después de regenerar) no se muestra mientras llega el nuevo.
  const actual = dibujo && dibujo.para === contenido ? dibujo.resultado : null;
  if (actual && 'error' in actual) {
    return (
      <p role="alert" className="text-sm text-red-700">
        No pudimos dibujar el QR. Descarga el PDF del carnet.
      </p>
    );
  }
  if (!actual) {
    return (
      <div
        role="status"
        aria-label="Preparando el QR"
        className={`${className} aspect-square animate-pulse rounded-lg bg-slate-100`}
      />
    );
  }
  return (
    <img
      src={actual.url}
      alt="Código QR del carnet"
      className={`${className} aspect-square max-w-full rounded-lg border border-slate-200 bg-white`}
    />
  );
}
