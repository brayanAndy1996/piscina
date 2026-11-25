import { useRef, useState } from 'react';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import type { DestinoDeFoto } from './api';
import { CampoFoto } from './CampoFoto';
import { CapturaCamara } from './CapturaCamara';
import { useFotoElegida, useSubirFotoDelPanel } from './hooks';
import { esFotoSinSalida, mensajeDeFotoDelPanel } from './mensajes';

interface Propiedades {
  /** El título del diálogo («Cambiar foto» o «Agregar foto»). */
  titulo: string;
  /** Para quién es la foto, con su nombre para decirlo en el diálogo. */
  destino: DestinoDeFoto;
  nombre: string;
  alCerrar: () => void;
  /** Se llama cuando la API responde 204 y el carnet o la lista ya se están refrescando. */
  alGuardar: () => void;
}

type Opcion = 'archivo' | 'camara';

const OPCIONES: readonly { valor: Opcion; texto: string }[] = [
  { valor: 'archivo', texto: 'Elegir un archivo' },
  { valor: 'camara', texto: 'Usar la cámara' },
];

/**
 * Poner o cambiar la foto de un alumno desde el panel (criterio 28 de 008b; D-20, D-24). Ofrece dos caminos: elegir un archivo (`CampoFoto`,
 * con sus avisos de tipo y peso) o tomarla con la cámara (`CapturaCamara`). Con el 204 avisa a la página; los errores de la API se dicen en
 * español. Cambiar de opción o cerrar el diálogo apaga la cámara.
 */
export function DialogoFoto({ titulo, destino, nombre, alCerrar, alGuardar }: Propiedades) {
  const [opcion, setOpcion] = useState<Opcion>('archivo');
  const { foto, aviso, elegir } = useFotoElegida();
  const subir = useSubirFotoDelPanel();
  useAlPerderSesion(subir.error);
  const enCurso = useRef(false);
  const pendiente = subir.isPending;
  const sinSalida = subir.isError && esFotoSinSalida(subir.error);

  const cerrar = () => {
    if (!pendiente) alCerrar();
  };

  const guardar = (imagen: Blob) => {
    // Dos envíos en el mismo paso, antes de que los botones se pinten desactivados: el segundo no envía nada.
    if (enCurso.current || pendiente) return;
    enCurso.current = true;
    subir.mutate(
      { destino, imagen },
      {
        onSuccess: alGuardar,
        onSettled: () => {
          enCurso.current = false;
        },
      },
    );
  };

  const errorGeneral = subir.isError && !esErrorDeApi(subir.error, 401) && !esErrorDeCambioDeSesion(subir.error);

  return (
    <Modal titulo={titulo} alCerrar={cerrar}>
      <div className="mt-2 space-y-4">
        <p className="text-slate-700">
          Alumno: <strong className="break-words text-slate-900">{nombre}</strong>
        </p>

        <div role="group" aria-label="Cómo poner la foto" className="flex flex-wrap gap-2">
          {OPCIONES.map(({ valor, texto }) => (
            <button
              key={valor}
              type="button"
              aria-pressed={opcion === valor}
              disabled={pendiente}
              onClick={() => setOpcion(valor)}
              className={`min-h-11 rounded-lg px-4 py-2 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${
                opcion === valor ? 'bg-sky-700 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-300'
              }`}
            >
              {texto}
            </button>
          ))}
        </div>

        {opcion === 'archivo' ? (
          <fieldset disabled={pendiente || sinSalida} className="min-w-0 space-y-4">
            <legend className="sr-only">Elegir un archivo</legend>
            <CampoFoto foto={foto} aviso={aviso} alElegir={elegir} />
            <button
              type="button"
              disabled={!foto || pendiente || sinSalida}
              onClick={() => foto && guardar(foto.archivo)}
              className={ESTILO_BOTON.primario}
            >
              {pendiente ? 'Guardando…' : 'Guardar foto'}
            </button>
          </fieldset>
        ) : (
          <CapturaCamara alUsar={guardar} ocupado={pendiente || sinSalida} />
        )}

        {errorGeneral ? <Alerta>{mensajeDeFotoDelPanel(subir.error)}</Alerta> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={cerrar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
            {sinSalida ? 'Cerrar' : 'Volver'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
