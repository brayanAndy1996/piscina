import { useId, useRef } from 'react';
import { ESTILO_BOTON } from '../../componentes/ui';
import type { FotoElegida } from './hooks';
import { avisoDeArchivo, FOTO_ACCEPT } from './validacion';

interface Propiedades {
  /** La foto ya aceptada (tipo y peso correctos), con su vista previa. */
  foto: FotoElegida | null;
  /** Lo que se le avisa de un archivo que no sirve. */
  aviso: string | null;
  alElegir: (archivo: File | null) => void;
  /** El texto del selector cuando todavía no hay foto. */
  etiqueta?: string;
}

/**
 * Elegir un archivo de foto (JPG o PNG) y verlo antes de subirlo (criterios 43 y 44 de 005). En el celular, el navegador ofrece la cámara.
 * El peso y el tipo se avisan aquí, sin llamar a la API; las dimensiones las comprueba solo la API.
 */
export function CampoFoto({ foto, aviso, alElegir, etiqueta = 'Elegir una foto' }: Propiedades) {
  const id = useId();
  const idAviso = `${id}-aviso`;
  const entrada = useRef<HTMLInputElement>(null);

  const quitar = () => {
    if (entrada.current) entrada.current.value = '';
    alElegir(null);
  };

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-slate-800">
          {foto ? 'Cambiar la foto' : etiqueta}
        </label>
        <input
          ref={entrada}
          id={id}
          type="file"
          accept={FOTO_ACCEPT}
          aria-invalid={aviso ? true : undefined}
          aria-describedby={aviso ? idAviso : undefined}
          onChange={(evento) => {
            const archivo = evento.target.files?.[0] ?? null;
            alElegir(archivo);
            // Un archivo que no sirve no queda en el selector: así se puede volver a elegir el mismo después de corregirlo.
            if (archivo && avisoDeArchivo(archivo)) evento.target.value = '';
          }}
          className="mt-1 block w-full min-h-11 rounded-lg bg-white px-3 py-2 text-base text-slate-900 ring-1 ring-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-sky-100 file:px-3 file:py-1.5 file:text-sky-900"
        />
      </div>
      {aviso ? (
        <p id={idAviso} role="alert" className="text-sm text-red-700">
          {aviso}
        </p>
      ) : null}
      {foto ? (
        <div className="flex flex-wrap items-center gap-3">
          <img
            src={foto.url}
            alt="Vista previa de la foto elegida"
            className="size-28 rounded-xl object-cover ring-1 ring-slate-300"
          />
          <div className="min-w-0 space-y-2">
            <p className="break-all text-sm text-slate-800">{foto.archivo.name}</p>
            <button type="button" onClick={quitar} className={ESTILO_BOTON.secundario}>
              Quitar la foto
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
