import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { ESTILO_BOTON } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { LayoutPanel } from '../panel/LayoutPanel';
import { ContextoUsuario } from './contexto';
import { CLAVE_SESION, claveDeIdentidad, useSesionAcademia, useVolverAPedirLaSesionAlRecuperarElFoco } from './hooks';
import { MensajeDePagina } from './MensajeDePagina';

export const RUTA_CAMBIAR_CLAVE = '/cambiar-clave';
const RUTA_INICIO = '/panel';

function Cargando() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sky-50 p-4">
      <p role="status" className="text-slate-700">
        Cargando…
      </p>
    </main>
  );
}

/**
 * Envuelve las páginas que piden sesión: consulta `GET /api/sesion` y decide qué mostrar (401: pide entrar por el enlace de la
 * academia; 403 `ACADEMIA_SUSPENDIDA`: academia no disponible). Con el cambio de contraseña obligatorio no deja ir a otra página
 * que no sea `/cambiar-clave`. Solo muestra; quien decide qué se puede hacer es siempre la API.
 *
 * La cookie de sesión es una por navegador (criterio 59): al recuperar el foco vuelve a pedir la sesión y, si en otra pestaña se
 * entró con otra persona u otra academia, descarta lo pedido con la identidad anterior, lleva a `/panel` y avisa.
 */
export function RutaConSesion() {
  const sesion = useSesionAcademia();
  const ubicacion = useLocation();
  const cliente = useQueryClient();
  useVolverAPedirLaSesionAlRecuperarElFoco();

  // La identidad con la que se abrió la página. Si la sesión trae otra, hay un cambio por atender.
  const [identidadMostrada, setIdentidadMostrada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const usuarioNuevo = sesion.data?.usuario;
  const claveNueva = usuarioNuevo ? claveDeIdentidad(usuarioNuevo) : null;
  const identidadCambio = claveNueva !== null && identidadMostrada !== null && claveNueva !== identidadMostrada;
  const enInicio = ubicacion.pathname === RUTA_INICIO;

  // Se ajusta durante el dibujo (no en un efecto) para no mostrar ni un cuadro con la identidad equivocada.
  if (claveNueva !== null && identidadMostrada === null) {
    setIdentidadMostrada(claveNueva);
  } else if (usuarioNuevo && identidadCambio && enInicio) {
    // Con la página de la identidad anterior ya fuera de pantalla y en `/panel`, la identidad nueva pasa a ser la mostrada.
    setIdentidadMostrada(claveNueva);
    setAviso(
      `Tu sesión cambió: ahora estás como ${usuarioNuevo.nombres} ${usuarioNuevo.apellidos} en ${usuarioNuevo.academia.nombre}.`,
    );
  }

  // Al pasar a otra identidad se descarta lo pedido con la anterior (menos la sesión, que ya es la nueva).
  const anterior = useRef<string | null>(null);
  useEffect(() => {
    if (anterior.current !== null && anterior.current !== identidadMostrada) {
      cliente.removeQueries({ predicate: (consulta) => consulta.queryKey[0] !== CLAVE_SESION[0] });
    }
    anterior.current = identidadMostrada;
  }, [identidadMostrada, cliente]);

  if (sesion.isPending) return <Cargando />;

  // Un fallo al volver a pedir la sesión (sin red, por ejemplo) no tira la página abierta; 401 y academia suspendida, sí.
  const perdida =
    sesion.isError &&
    (!usuarioNuevo || esErrorDeApi(sesion.error, 401) || esErrorDeApi(sesion.error, 403, 'ACADEMIA_SUSPENDIDA'));

  if (perdida) {
    if (esErrorDeApi(sesion.error, 401)) {
      return (
        <MensajeDePagina titulo="Entra por el enlace de tu academia">
          <p>
            Tu sesión no está abierta o venció. Abre el enlace de ingreso que te dio tu academia (termina en
            «/ingresar») para entrar con tu DNI.
          </p>
        </MensajeDePagina>
      );
    }
    if (esErrorDeApi(sesion.error, 403, 'ACADEMIA_SUSPENDIDA')) {
      return (
        <MensajeDePagina titulo="Academia no disponible por el momento">
          <p>Intenta de nuevo más tarde o consulta en recepción.</p>
        </MensajeDePagina>
      );
    }
    return (
      <MensajeDePagina titulo="No pudimos abrir tu sesión">
        <p>{mensajeGeneral(sesion.error)}</p>
        <button type="button" onClick={() => void sesion.refetch()} className={`${ESTILO_BOTON.secundario} mt-4`}>
          Reintentar
        </button>
      </MensajeDePagina>
    );
  }

  if (!usuarioNuevo) return <Cargando />;
  if (identidadCambio) return enInicio ? <Cargando /> : <Navigate to={RUTA_INICIO} replace />;

  const usuario = usuarioNuevo;
  if (usuario.debeCambiarClave && ubicacion.pathname !== RUTA_CAMBIAR_CLAVE) {
    return <Navigate to={RUTA_CAMBIAR_CLAVE} replace />;
  }

  return (
    <ContextoUsuario value={usuario}>
      <LayoutPanel aviso={aviso} alCerrarAviso={() => setAviso(null)}>
        <Outlet />
      </LayoutPanel>
    </ContextoUsuario>
  );
}
