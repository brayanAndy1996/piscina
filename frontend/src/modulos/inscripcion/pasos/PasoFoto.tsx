import { CampoFoto } from '../../foto/CampoFoto';
import type { FotoElegida } from '../../foto/hooks';
import { FOTO_MEGABYTES_MAXIMOS } from '../../foto/validacion';

interface Propiedades {
  foto: FotoElegida | null;
  aviso: string | null;
  alElegir: (archivo: File | null) => void;
}

/**
 * Paso de la foto, opcional (HU-01, D-20, D-24; criterio 43 de 005): se puede seguir sin foto. La foto no viaja con el formulario: se sube
 * aparte, después de que la solicitud queda creada (criterio 34).
 */
export function PasoFoto({ foto, aviso, alElegir }: Propiedades) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        La foto es para el carnet del alumno. Es opcional: puedes seguir sin ella y subirla después desde el enlace de
        seguimiento de tu solicitud.
      </p>
      <p className="text-sm text-slate-700">
        Archivo JPG o PNG de hasta {FOTO_MEGABYTES_MAXIMOS} MB. En el celular puedes tomarla con la cámara.
      </p>
      <CampoFoto foto={foto} aviso={aviso} alElegir={alElegir} />
    </div>
  );
}
