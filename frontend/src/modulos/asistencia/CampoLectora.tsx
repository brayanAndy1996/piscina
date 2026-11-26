import { type Ref, useImperativeHandle, useRef, useState } from 'react';
import { CampoTexto } from '../../componentes/ui';

export interface ControlDeLectora {
  enfocar: () => void;
}

interface Propiedades {
  /** Recibe lo que escribió la lectora al terminar con Enter. Devuelve `false` si no pudo atenderlo (hay otra lectura en curso): el texto se queda. */
  alLeer: (contenido: string) => boolean;
  control?: Ref<ControlDeLectora>;
}

/**
 * La lectora USB (DT-12): para el navegador es un teclado que escribe el contenido del QR y termina con Enter. El campo recibe ese texto tal
 * cual, sin recortarlo ni cambiarlo (el QR lleva un token exacto), lo manda con Enter y se vacía para la lectura siguiente.
 */
export function CampoLectora({ alLeer, control }: Propiedades) {
  const entrada = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState('');
  useImperativeHandle(control, () => ({ enfocar: () => entrada.current?.focus() }), []);

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        if (texto.trim() === '') return;
        if (alLeer(texto)) setTexto('');
      }}
      noValidate
    >
      <CampoTexto
        ref={entrada}
        etiqueta="Lectora de QR"
        ayuda="Acerca el QR del carnet a la lectora. Si no escribe, haz clic en este campo."
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
      />
    </form>
  );
}
