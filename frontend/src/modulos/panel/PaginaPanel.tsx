import { type Alcance, type Permiso, puede } from '@aquagestion/contratos';
import { Link } from 'react-router';
import { ESTILO_BOTON } from '../../componentes/ui';
import { alcanceDe } from '../../lib/permisos';
import { useUsuario } from '../sesion/contexto';
import { ETIQUETA_ROL } from '../sesion/etiquetas';
import { RUTA_CAMBIAR_CLAVE } from '../sesion/hooks';

interface Opcion {
  permiso: Permiso;
  /** Si se indica, la opción solo es para el rol cuya celda de la matriz tiene este alcance (por ejemplo, «Mi carnet» es del `PROPIO`). */
  alcance?: Alcance;
  texto: string;
  descripcion: string;
  /** Una dirección que se abre en otra pestaña (el formulario público), en vez de una página del panel. */
  externa?: boolean;
  ruta: (nombreCorto: string) => string;
}

const ESTILO_TARJETA =
  'block h-full rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700';

/** Opciones del inicio. Se muestran solo las que el rol permite según `MATRIZ_PERMISOS`; la API vuelve a comprobarlo. */
const OPCIONES: readonly Opcion[] = [
  {
    permiso: 'REGISTRAR_INSCRIPCION_Y_COBRO',
    texto: 'Solicitudes de inscripción',
    descripcion:
      'Cobra en efectivo a quien paga en recepción, ajusta el monto, imprime el ticket y cancela las solicitudes que ya no van a seguir.',
    ruta: () => '/panel/solicitudes',
  },
  {
    permiso: 'VERIFICAR_PAGOS',
    texto: 'Pagos por verificar',
    descripcion:
      'Revisa los comprobantes de Yape y transferencia que enviaron los clientes: apruébalos para confirmar la inscripción o recházalos con un motivo.',
    ruta: () => '/panel/pagos',
  },
  {
    permiso: 'VER_CARNET',
    alcance: 'TODO',
    texto: 'Alumnos y carnets',
    descripcion: 'Busca a un alumno por DNI o nombre, mira su carnet, descárgalo en PDF o regenera su QR.',
    ruta: () => '/panel/alumnos',
  },
  {
    permiso: 'VER_CARNET',
    alcance: 'PROPIO',
    texto: 'Mi carnet',
    descripcion: 'Muestra tu carnet con el QR para entrar a la piscina y descárgalo en PDF.',
    ruta: () => '/panel/mi-carnet',
  },
  {
    permiso: 'REGISTRAR_INSCRIPCION_Y_COBRO',
    texto: 'Nueva inscripción',
    descripcion:
      'Abre el formulario para inscribir a un cliente en recepción (sin los límites por conexión). Se abre en otra pestaña.',
    externa: true,
    ruta: (nombreCorto) => `/a/${encodeURIComponent(nombreCorto)}/inscripcion`,
  },
  {
    permiso: 'ABRIR_CERRAR_CAJA',
    texto: 'Caja',
    descripcion: 'Abre la caja del día, registra los egresos y ciérrala al final contando el efectivo.',
    ruta: () => '/panel/caja',
  },
  {
    permiso: 'VER_REPORTES_FINANCIEROS',
    texto: 'Historial de caja',
    descripcion: 'Consulta las cajas de días anteriores, sus cierres y descarga el PDF de cada cierre.',
    ruta: () => '/panel/cajas',
  },
  {
    permiso: 'GESTIONAR_USUARIOS',
    texto: 'Usuarios',
    descripcion: 'Crea, desactiva o reactiva al personal de la academia.',
    ruta: () => '/panel/usuarios',
  },
  {
    permiso: 'RESTABLECER_CLAVE',
    texto: 'Restablecer contraseña',
    descripcion: 'Busca a una persona por su DNI y devuélvele la contraseña inicial.',
    ruta: () => '/panel/restablecer',
  },
  {
    permiso: 'CONFIGURAR_ACADEMIA',
    texto: 'Configuración',
    descripcion:
      'Ajusta la tolerancia de tardanza, los días por vencer, el bloqueo del inicio de sesión, el teléfono y los datos de pago (Yape y transferencia).',
    ruta: () => '/panel/configuracion',
  },
  {
    permiso: 'CONFIGURAR_PLANES_HORARIOS_AFORO',
    texto: 'Planes',
    descripcion: 'Define los planes que vende la academia: precio, clases por mes, días, franjas y niveles.',
    ruta: () => '/panel/planes',
  },
  {
    permiso: 'CONFIGURAR_PLANES_HORARIOS_AFORO',
    texto: 'Clases y horarios',
    descripcion: 'Arma la semana: el nivel, el día, la hora, el entrenador y el aforo de cada clase.',
    ruta: () => '/panel/clases',
  },
];

/** `/panel`: inicio con la sesión y el menú según el rol (criterio 48). */
export function PaginaPanel() {
  const usuario = useUsuario();
  const opciones = OPCIONES.filter(
    (opcion) =>
      puede(usuario.rol, opcion.permiso) &&
      (opcion.alcance === undefined || alcanceDe(usuario.rol, opcion.permiso) === opcion.alcance),
  );

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
          <Link to={RUTA_CAMBIAR_CLAVE} className={ESTILO_BOTON.secundario}>
            Cambiar contraseña
          </Link>
        </div>
      </section>

      {opciones.length > 0 ? (
        <nav aria-label="Opciones">
          <ul className="grid gap-3 sm:grid-cols-2">
            {opciones.map((opcion) => (
              <li key={opcion.texto}>
                {opcion.externa ? (
                  <a
                    href={opcion.ruta(usuario.academia.nombreCorto)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={ESTILO_TARJETA}
                  >
                    <span className="block text-lg font-semibold text-sky-900">{opcion.texto}</span>
                    <span className="mt-1 block text-sm text-slate-700">{opcion.descripcion}</span>
                  </a>
                ) : (
                  <Link to={opcion.ruta(usuario.academia.nombreCorto)} className={ESTILO_TARJETA}>
                    <span className="block text-lg font-semibold text-sky-900">{opcion.texto}</span>
                    <span className="mt-1 block text-sm text-slate-700">{opcion.descripcion}</span>
                  </Link>
                )}
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
