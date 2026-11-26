import { type AlumnoEncontrado, buscarAlumnosSchema } from '@aquagestion/contratos';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON } from '../../componentes/ui';
import { mensajeDeBusqueda } from '../carnet/mensajes';
import { erroresPorCampo } from '../../lib/errores';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { useBuscarAlumnos } from './hooks';

interface Campos {
  texto: string;
}

interface Propiedades {
  /** Cómo se dibuja cada alumno encontrado (el carnet lo lleva a su ficha; la asistencia, a «Registrar asistencia»). */
  renderAlumno: (alumno: AlumnoEncontrado) => ReactNode;
}

/**
 * El buscador de alumnos por DNI o nombre (criterio 16 de 008): el formulario, el aviso de «sin resultados» y la lista. Lo usan «Alumnos y
 * carnets» y la pantalla de asistencia. El texto va en el cuerpo de un `POST`: nunca en la dirección de la página ni en la de la API.
 */
export function BuscadorDeAlumnos({ renderAlumno }: Propiedades) {
  const { register, handleSubmit, setError, clearErrors, formState } = useForm<Campos>({
    defaultValues: { texto: '' },
  });
  const busqueda = useBuscarAlumnos();
  useAlPerderSesion(busqueda.error);
  const buscando = busqueda.isPending;
  const resultado = busqueda.data;

  const alEnviar = (campos: Campos) => {
    if (buscando) return;
    const validado = buscarAlumnosSchema.safeParse({ texto: campos.texto });
    if (!validado.success) {
      setError('texto', { message: validado.error.issues[0]?.message ?? 'Escribe el DNI o el nombre.' });
      return;
    }
    busqueda.mutate(validado.data, {
      onError: (falla) => {
        for (const { campo, mensaje } of erroresPorCampo(falla)) {
          if (campo === 'texto') setError('texto', { message: mensaje });
        }
      },
    });
  };

  const errorGeneral =
    busqueda.isError &&
    !esErrorDeApi(busqueda.error, 401) &&
    !esErrorDeCambioDeSesion(busqueda.error) &&
    erroresPorCampo(busqueda.error).length === 0;

  return (
    <div className="space-y-4">
      <form
        role="search"
        onSubmit={(evento) => void handleSubmit(alEnviar)(evento)}
        noValidate
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <div className="sm:flex-1">
          <CampoTexto
            etiqueta="Buscar por DNI o nombre"
            autoComplete="off"
            ayuda="Escribe al menos 3 letras o los 8 dígitos del DNI."
            error={formState.errors.texto?.message}
            {...register('texto', { onChange: () => clearErrors('texto') })}
          />
        </div>
        <button type="submit" disabled={buscando} className={`${ESTILO_BOTON.primario} sm:mt-6`}>
          {buscando ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {errorGeneral ? <Alerta>{mensajeDeBusqueda(busqueda.error)}</Alerta> : null}

      {resultado ? (
        resultado.alumnos.length === 0 ? (
          <p role="status" className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
            No encontramos alumnos con ese DNI o nombre.
          </p>
        ) : (
          <div className="space-y-3">
            <ul aria-label="Alumnos encontrados" className="space-y-3">
              {resultado.alumnos.map((alumno) => (
                <li key={alumno.id}>{renderAlumno(alumno)}</li>
              ))}
            </ul>
            {resultado.hayMas ? (
              <p role="status" className="rounded-2xl bg-sky-50 p-3 text-sky-900 ring-1 ring-sky-100">
                Hay más resultados; escribe más letras.
              </p>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
