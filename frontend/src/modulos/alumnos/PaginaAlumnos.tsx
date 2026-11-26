import { type AlumnoEncontrado, NOMBRE_NIVEL } from '@aquagestion/contratos';
import { Link } from 'react-router';
import { Insignia } from '../../componentes/ui';
import { COLOR_ESTADO_ALUMNO, ETIQUETA_ESTADO_ALUMNO } from '../carnet/etiquetas';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { BuscadorDeAlumnos } from './BuscadorDeAlumnos';

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

function ContenidoAlumnos() {
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
      <BuscadorDeAlumnos renderAlumno={(alumno) => <TarjetaAlumno alumno={alumno} />} />
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
