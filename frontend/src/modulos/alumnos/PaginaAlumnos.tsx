import { type AlumnoEncontrado, buscarAlumnosSchema, NOMBRE_NIVEL } from '@aquagestion/contratos';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { COLOR_ESTADO_ALUMNO, ETIQUETA_ESTADO_ALUMNO } from '../carnet/etiquetas';
import { mensajeDeBusqueda } from '../carnet/mensajes';
import { erroresPorCampo } from '../../lib/errores';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { useBuscarAlumnos } from './hooks';

/**
 * `/panel/alumnos`: busca a un alumno por DNI o por nombre para ver su carnet (HU-13, criterio 19 de 008). `ADMIN` y `SECRETARIA`
 * (`VER_CARNET` con alcance `TODO`). El texto va en el cuerpo de un `POST`: nunca en la dirección de la página ni en la de la API.
 */
export function PaginaAlumnos() {
  return (
    <RequierePermiso permiso="VER_CARNET" alcance="TODO">
      <ContenidoAlumnos />
    </RequierePermiso>
  );
}

interface Campos {
  texto: string;
}

function ContenidoAlumnos() {
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
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Alumnos y carnets</h1>
      <p className="text-slate-700">
        Busca a un alumno por su DNI completo (8 dígitos) o por parte de su nombre o apellido, para ver su carnet,
        descargarlo en PDF o regenerar su QR.
      </p>

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
                <li key={alumno.id}>
                  <TarjetaAlumno alumno={alumno} />
                </li>
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

function TarjetaAlumno({ alumno }: { alumno: AlumnoEncontrado }) {
  return (
    <Link
      to={`/panel/alumnos/${encodeURIComponent(alumno.id)}`}
      className="flex flex-col gap-1 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <span className="min-w-0">
        <span className="block break-words text-lg font-semibold text-sky-900">
          {alumno.apellidos}, {alumno.nombres}
        </span>
        <span className="block text-slate-700">
          DNI <span className="font-mono">{alumno.dni}</span> · Nivel {NOMBRE_NIVEL[alumno.nivel]}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Insignia color={COLOR_ESTADO_ALUMNO[alumno.estado]}>{ETIQUETA_ESTADO_ALUMNO[alumno.estado]}</Insignia>
        <Insignia color={alumno.tieneFoto ? 'azul' : 'gris'}>
          {alumno.tieneFoto ? 'Con foto' : 'Foto pendiente'}
        </Insignia>
      </span>
    </Link>
  );
}
