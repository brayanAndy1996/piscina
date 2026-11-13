import type { UsuarioResumen } from '@aquagestion/contratos';
import { Alerta, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { useAlPerderSesion } from '../sesion/hooks';
import { useDesactivarUsuario, useReactivarUsuario, useRestablecerClaveUsuario } from './hooks';
import { mensajeDeAccionUsuario } from './mensajes';

export type AccionUsuario = 'desactivar' | 'reactivar' | 'restablecer';

interface Propiedades {
  accion: AccionUsuario;
  usuario: UsuarioResumen;
  alCerrar: () => void;
  /** Se llama con la cuenta actualizada cuando la API confirma la acción. */
  alExito?: (usuario: UsuarioResumen) => void;
}

export function nombreCompleto(usuario: Pick<UsuarioResumen, 'nombres' | 'apellidos'>): string {
  return `${usuario.nombres} ${usuario.apellidos}`;
}

const TEXTOS: Record<AccionUsuario, { titulo: string; boton: string; enCurso: string }> = {
  desactivar: { titulo: 'Desactivar', boton: 'Desactivar cuenta', enCurso: 'Desactivando…' },
  reactivar: { titulo: 'Reactivar', boton: 'Reactivar cuenta', enCurso: 'Reactivando…' },
  restablecer: { titulo: 'Restablecer contraseña de', boton: 'Restablecer contraseña', enCurso: 'Restableciendo…' },
};

/** Confirmación de desactivar, reactivar o restablecer la contraseña de una cuenta (criterios 31, 32 y 35). */
export function DialogoAccionUsuario({ accion, usuario, alCerrar, alExito }: Propiedades) {
  const desactivar = useDesactivarUsuario();
  const reactivar = useReactivarUsuario();
  const restablecer = useRestablecerClaveUsuario();
  const mutacion = { desactivar, reactivar, restablecer }[accion];
  useAlPerderSesion(mutacion.error);
  const textos = TEXTOS[accion];
  const nombre = nombreCompleto(usuario);

  function confirmar() {
    mutacion.mutate(usuario.id, {
      onSuccess: (actualizado) => {
        alExito?.(actualizado);
        alCerrar();
      },
    });
  }

  return (
    <Modal titulo={`${textos.titulo} ${nombre}`} alCerrar={alCerrar}>
      <div className="mt-2 space-y-2 text-slate-700">
        {accion === 'desactivar' ? (
          <p>
            {nombre} perderá el acceso de inmediato y su sesión se cerrará. No se borra la cuenta: podrás reactivarla
            después.
          </p>
        ) : null}
        {accion === 'reactivar' ? (
          <p>{nombre} volverá a poder entrar con su contraseña actual. Reactivar no cambia la contraseña.</p>
        ) : null}
        {accion === 'restablecer' ? (
          <>
            <p>
              La nueva contraseña de {nombre} será su DNI ({usuario.dni}). Al entrar, el sistema le pedirá elegir otra.
            </p>
            <p>Si la cuenta estaba bloqueada por intentos fallidos, se desbloquea. Su sesión actual se cierra.</p>
          </>
        ) : null}
      </div>
      {mutacion.isError ? (
        <div className="mt-4">
          <Alerta>{mensajeDeAccionUsuario(mutacion.error)}</Alerta>
        </div>
      ) : null}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirmar}
          disabled={mutacion.isPending}
          className={accion === 'desactivar' ? ESTILO_BOTON.peligro : ESTILO_BOTON.primario}
        >
          {mutacion.isPending ? textos.enCurso : textos.boton}
        </button>
      </div>
    </Modal>
  );
}
