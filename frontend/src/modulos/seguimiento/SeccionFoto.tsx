import { FOTO_LADO_MAXIMO, FOTO_LADO_MINIMO } from '@aquagestion/contratos';
import { esErrorDeApi } from '../../api/cliente';
import { frasePorTelefono } from '../../componentes/Telefono';
import { Alerta, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { CampoFoto } from '../foto/CampoFoto';
import { useFotoElegida, useSubirFoto } from '../foto/hooks';
import { FOTO_MEGABYTES_MAXIMOS } from '../foto/validacion';

/** Lo que se le dice a la persona cuando la subida falla, con una salida humana (el teléfono de la academia). */
function mensajeDeFalloDeFoto(falla: unknown, telefono: string | null): string {
  const ayuda = frasePorTelefono(telefono);
  if (esErrorDeApi(falla, 400, 'IMAGEN_NO_VALIDA')) {
    return `No pudimos usar esa imagen. Elige una foto JPG o PNG de entre ${FOTO_LADO_MINIMO} y ${FOTO_LADO_MAXIMO} píxeles por lado.${ayuda}`;
  }
  if (esErrorDeApi(falla, 413)) {
    return `La foto pesa más de ${FOTO_MEGABYTES_MAXIMOS} MB. Elige una más liviana.${ayuda}`;
  }
  if (esErrorDeApi(falla, 429)) {
    return `Subiste demasiadas fotos desde esta conexión. Espera un rato e inténtalo de nuevo.${ayuda}`;
  }
  return `${mensajeGeneral(falla)}${ayuda}`;
}

export const MENSAJE_FOTO_NO_EDITABLE = 'Esta solicitud ya no admite cambios: la foto ya no se puede cambiar.';

interface Propiedades {
  nombreCorto: string;
  /** El token de la dirección: solo en la memoria de la página. */
  token: string;
  fotoCargada: boolean;
  telefono: string | null;
  /** Vuelve a consultar la solicitud (después de subir, o si dejó de poder cambiarse). */
  alActualizar: () => Promise<unknown>;
  /** Un aviso que debe seguir a la vista aunque esta sección desaparezca (la vista pasó a reducida). */
  alAvisar: (mensaje: string | null) => void;
}

/**
 * "Subir foto" del seguimiento (criterio 44 de 005): solo con la vista completa, con el token de la dirección. Tras el 204 vuelve a
 * consultar y muestra "Foto cargada". Ante 409 `SOLICITUD_NO_EDITABLE` avisa y vuelve a consultar (la vista pasa a reducida); ante los
 * demás errores muestra un mensaje claro y deja volver a intentar con el mismo archivo.
 */
export function SeccionFoto({ nombreCorto, token, fotoCargada, telefono, alActualizar, alAvisar }: Propiedades) {
  const elegida = useFotoElegida();
  const subir = useSubirFoto(nombreCorto, {
    alTerminar: async () => {
      alAvisar(null);
      elegida.elegir(null);
      await alActualizar();
    },
    alFallar: async (falla) => {
      if (esErrorDeApi(falla, 409, 'SOLICITUD_NO_EDITABLE')) {
        alAvisar(MENSAJE_FOTO_NO_EDITABLE);
        await alActualizar();
      }
    },
  });
  const rotulo = fotoCargada ? 'Cambiar foto' : 'Subir foto';
  const noEditable = esErrorDeApi(subir.error, 409, 'SOLICITUD_NO_EDITABLE');

  return (
    <section aria-label="Foto" className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Foto del carnet</h2>
        {fotoCargada ? (
          <Insignia color="verde">Foto cargada</Insignia>
        ) : (
          <Insignia color="ambar">Foto pendiente</Insignia>
        )}
      </div>
      <p className="text-sm text-slate-700">
        {fotoCargada
          ? 'Ya tenemos tu foto. Si quieres, puedes cambiarla por otra.'
          : `Sube una foto JPG o PNG de hasta ${FOTO_MEGABYTES_MAXIMOS} MB para tu carnet. Es opcional.`}
      </p>
      <fieldset disabled={subir.isPending} className="min-w-0 space-y-3">
        <legend className="sr-only">{rotulo}</legend>
        <CampoFoto
          foto={elegida.foto}
          aviso={elegida.aviso}
          alElegir={elegida.elegir}
          etiqueta={fotoCargada ? 'Elegir otra foto' : 'Elegir una foto'}
        />
      </fieldset>
      {subir.isError && !noEditable ? <Alerta>{mensajeDeFalloDeFoto(subir.error, telefono)}</Alerta> : null}
      <button
        type="button"
        disabled={!elegida.foto || subir.isPending}
        onClick={() => {
          if (elegida.foto) subir.mutate({ token, archivo: elegida.foto.archivo });
        }}
        className={ESTILO_BOTON.primario}
      >
        {subir.isPending ? 'Subiendo…' : subir.isError && !noEditable ? 'Reintentar la subida' : rotulo}
      </button>
    </section>
  );
}
