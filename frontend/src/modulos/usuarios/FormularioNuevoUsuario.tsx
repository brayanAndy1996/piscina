import { type CrearUsuario, crearUsuarioSchema } from '@aquagestion/contratos';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoSelect, CampoTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';
import { erroresPorCampo, mensajeGeneral } from '../../lib/errores';
import { ETIQUETA_ROL } from '../sesion/etiquetas';
import { useAlPerderSesion } from '../sesion/hooks';
import { useCrearUsuario } from './hooks';
import { MENSAJE_DNI_EN_USO } from './mensajes';

type Campos = z.input<typeof crearUsuarioSchema>;

const CAMPOS = ['dni', 'nombres', 'apellidos', 'rol'] as const;

/** "Nuevo usuario": personal de la academia. La contraseña inicial es el DNI y se debe cambiar al entrar (RN-02). */
export function FormularioNuevoUsuario({ alCerrar }: { alCerrar: () => void }) {
  const crear = useCrearUsuario();
  const { register, handleSubmit, setError, formState } = useForm<Campos, unknown, CrearUsuario>({
    resolver: zodResolver(crearUsuarioSchema),
    defaultValues: { dni: '', nombres: '', apellidos: '', rol: 'SECRETARIA' },
  });
  useAlPerderSesion(crear.error);

  const enviar = handleSubmit((datos) => {
    crear.mutate(datos, {
      onSuccess: alCerrar,
      onError: (error) => {
        if (esErrorDeApi(error, 409, 'DNI_EN_USO')) {
          setError('dni', { message: MENSAJE_DNI_EN_USO });
          return;
        }
        for (const { campo, mensaje } of erroresPorCampo(error)) {
          const conocido = CAMPOS.find((nombre) => nombre === campo);
          if (conocido) setError(conocido, { message: mensaje });
        }
      },
    });
  });

  const errorGeneral =
    crear.isError &&
    !esErrorDeApi(crear.error, 401) &&
    !esErrorDeApi(crear.error, 409, 'DNI_EN_USO') &&
    erroresPorCampo(crear.error).length === 0;

  return (
    <Modal titulo="Nuevo usuario" alCerrar={alCerrar}>
      <p className="mt-2 text-slate-700">
        Su contraseña inicial será su DNI y tendrá que cambiarla al entrar por primera vez.
      </p>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-4 space-y-4">
        <CampoTexto
          etiqueta="DNI"
          inputMode="numeric"
          autoComplete="off"
          error={formState.errors.dni?.message}
          {...register('dni')}
        />
        <CampoTexto
          etiqueta="Nombres"
          autoComplete="off"
          error={formState.errors.nombres?.message}
          {...register('nombres')}
        />
        <CampoTexto
          etiqueta="Apellidos"
          autoComplete="off"
          error={formState.errors.apellidos?.message}
          {...register('apellidos')}
        />
        <CampoSelect etiqueta="Rol" error={formState.errors.rol?.message} {...register('rol')}>
          <option value="ADMIN">{ETIQUETA_ROL.ADMIN}</option>
          <option value="SECRETARIA">{ETIQUETA_ROL.SECRETARIA}</option>
          <option value="ENTRENADOR">{ETIQUETA_ROL.ENTRENADOR}</option>
        </CampoSelect>
        {errorGeneral ? <Alerta>{mensajeGeneral(crear.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
            Cancelar
          </button>
          <button type="submit" disabled={crear.isPending} className={ESTILO_BOTON.primario}>
            {crear.isPending ? 'Creando…' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
