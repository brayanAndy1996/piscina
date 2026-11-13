import { type Permiso, puede } from '@aquagestion/contratos';
import { Link } from 'react-router';
import { ESTILO_BOTON } from '../../componentes/ui';
import { useUsuario } from '../sesion/contexto';
import { ETIQUETA_ROL } from '../sesion/etiquetas';

interface Opcion {
  permiso: Permiso;
  texto: string;
  descripcion: string;
  ruta: string;
}

/** Opciones del inicio. Se muestran solo las que el rol permite según `MATRIZ_PERMISOS`; la API vuelve a comprobarlo. */
const OPCIONES: readonly Opcion[] = [
  {
    permiso: 'GESTIONAR_USUARIOS',
    texto: 'Usuarios',
    descripcion: 'Crea, desactiva o reactiva al personal de la academia.',
    ruta: '/panel/usuarios',
  },
  {
    permiso: 'RESTABLECER_CLAVE',
    texto: 'Restablecer contraseña',
    descripcion: 'Busca a una persona por su DNI y devuélvele la contraseña inicial.',
    ruta: '/panel/restablecer',
  },
];

/** `/panel`: inicio con la sesión y el menú según el rol (criterio 48). */
export function PaginaPanel() {
  const usuario = useUsuario();
  const opciones = OPCIONES.filter((opcion) => puede(usuario.rol, opcion.permiso));

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-sky-100 sm:p-6">
        <h1 className="break-words text-2xl font-semibold text-slate-900">
          {usuario.nombres} {usuario.apellidos}
        </h1>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-slate-700">
          <dt className="font-medium">Rol</dt>
          <dd>{ETIQUETA_ROL[usuario.rol]}</dd>
          <dt className="font-medium">Academia</dt>
          <dd className="break-words">{usuario.academia.nombre}</dd>
        </dl>
        <div className="mt-4">
          <Link to="/cambiar-clave" className={ESTILO_BOTON.secundario}>
            Cambiar contraseña
          </Link>
        </div>
      </section>

      {opciones.length > 0 ? (
        <nav aria-label="Opciones">
          <ul className="grid gap-3 sm:grid-cols-2">
            {opciones.map((opcion) => (
              <li key={opcion.permiso}>
                <Link
                  to={opcion.ruta}
                  className="block h-full rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                >
                  <span className="block text-lg font-semibold text-sky-900">{opcion.texto}</span>
                  <span className="mt-1 block text-sm text-slate-700">{opcion.descripcion}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <p className="rounded-2xl bg-white p-5 text-slate-700 shadow-sm ring-1 ring-sky-100">
          Por ahora no hay más opciones disponibles para tu cuenta. Las irán sumando las próximas versiones.
        </p>
      )}
    </div>
  );
}
