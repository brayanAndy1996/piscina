import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { avisoDeArchivo } from './validacion';

export interface FotoElegida {
  archivo: File;
  /** Dirección local del archivo para la vista previa; se libera al cambiarlo o al salir. */
  url: string;
}

/**
 * La foto que la persona eligió: valida su tipo y su peso antes de aceptarla (sin llamar a la API) y crea la vista previa con una
 * dirección local, que libera al elegir otra, al quitarla y al salir (criterios 43 y 44 de 005, PB14). Un archivo que no sirve no se
 * conserva: solo queda el aviso.
 */
export function useFotoElegida() {
  const [foto, setFoto] = useState<FotoElegida | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const urlActual = useRef<string | null>(null);

  const liberar = useCallback(() => {
    if (urlActual.current) URL.revokeObjectURL(urlActual.current);
    urlActual.current = null;
  }, []);

  useEffect(() => liberar, [liberar]);

  const elegir = useCallback(
    (archivo: File | null) => {
      liberar();
      const problema = archivo ? avisoDeArchivo(archivo) : null;
      setAviso(problema);
      if (!archivo || problema) {
        setFoto(null);
        return;
      }
      const url = URL.createObjectURL(archivo);
      urlActual.current = url;
      setFoto({ archivo, url });
    },
    [liberar],
  );

  return { foto, aviso, elegir };
}

/** La subida de la foto. El token se queda en la memoria de la página: no se guarda en ningún almacenamiento del navegador. */
export function useSubirFoto(
  nombreCorto: string,
  opciones: { alTerminar?: () => Promise<unknown> | void; alFallar?: (error: unknown) => Promise<unknown> | void } = {},
) {
  const { alTerminar, alFallar } = opciones;
  return useMutation({
    mutationFn: ({ token, archivo }: { token: string; archivo: File }) => api.subirFoto(nombreCorto, token, archivo),
    // En la propia mutación y no en cada `mutate`: siguen corriendo aunque la página cambie mientras la subida espera.
    ...(alTerminar ? { onSuccess: alTerminar } : {}),
    ...(alFallar ? { onError: alFallar } : {}),
  });
}
