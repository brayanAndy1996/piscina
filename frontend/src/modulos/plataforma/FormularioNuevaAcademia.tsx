import { type CrearAcademia, crearAcademiaSchema } from '@aquagestion/contratos';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { esErrorDeApi } from '../../api/cliente';
import { useCrearAcademia, useRedirigirSiNoAutenticado } from './hooks';
import { erroresPorCampo, mensajeGeneral } from '../../lib/errores';
import { Alerta, CampoTexto, ESTILO_BOTON, Modal } from '../../componentes/ui';

type CamposAcademia = z.input<typeof crearAcademiaSchema>;

interface Propiedades {
  alCerrar: () => void;
}

/** Formulario de "Nueva academia": solo el nombre y el nombre corto (DR-6), validados con el esquema compartido. */
export function FormularioNuevaAcademia({ alCerrar }: Propiedades) {
  const crear = useCrearAcademia();
  const { register, handleSubmit, setError, formState } = useForm<CamposAcademia, unknown, CrearAcademia>({
    resolver: zodResolver(crearAcademiaSchema),
    defaultValues: { nombre: '', nombreCorto: '' },
  });
  useRedirigirSiNoAutenticado(crear.error);

  const enviar = handleSubmit((datos) => {
    crear.mutate(datos, {
      onSuccess: alCerrar,
      onError: (error) => {
        if (esErrorDeApi(error, 409, 'NOMBRE_CORTO_EN_USO')) {
          setError('nombreCorto', { message: 'Ese nombre corto ya lo usa otra academia. Elige otro.' });
          return;
        }
        for (const { campo, mensaje } of erroresPorCampo(error)) {
          if (campo === 'nombre' || campo === 'nombreCorto') setError(campo, { message: mensaje });
        }
      },
    });
  });

  const errorGeneral =
    crear.isError &&
    !esErrorDeApi(crear.error, 401) &&
    !esErrorDeApi(crear.error, 409, 'NOMBRE_CORTO_EN_USO') &&
    erroresPorCampo(crear.error).length === 0;

  return (
    <Modal titulo="Nueva academia" alCerrar={alCerrar}>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-4 space-y-4">
        <CampoTexto
          etiqueta="Nombre"
          autoComplete="off"
          error={formState.errors.nombre?.message}
          {...register('nombre')}
        />
        <CampoTexto
          etiqueta="Nombre corto"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          ayuda="Va en la dirección de sus páginas. Solo letras minúsculas sin tildes, números y guiones."
          error={formState.errors.nombreCorto?.message}
          {...register('nombreCorto')}
        />
        {errorGeneral ? <Alerta>{mensajeGeneral(crear.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
            Cancelar
          </button>
          <button type="submit" disabled={crear.isPending} className={ESTILO_BOTON.primario}>
            {crear.isPending ? 'Creando…' : 'Crear academia'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
