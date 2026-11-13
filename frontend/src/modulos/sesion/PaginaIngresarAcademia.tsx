import { type IniciarSesionAcademia, iniciarSesionAcademiaSchema } from '@aquagestion/contratos';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { MENSAJE_ACADEMIA_SUSPENDIDA, RUTA_CAMBIAR_CLAVE, useAcademiaPublica, useIniciarSesionAcademia } from './hooks';
import { mensajeDeIngresoAcademia } from './mensajes';

type CamposIngreso = z.input<typeof iniciarSesionAcademiaSchema>;

function Tarjeta({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sky-50 p-4">
      <section className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-sky-100 sm:p-8">
        {children}
      </section>
    </main>
  );
}

/**
 * `/a/{nombreCorto}/ingresar`: ingreso con DNI y contraseña a la academia de la dirección (D-27, D-28). La contraseña inicial es
 * el DNI y se debe cambiar en el primer ingreso (RN-02). La sesión vive solo en la cookie httpOnly: nada va a `localStorage`.
 */
export function PaginaIngresarAcademia() {
  const { nombreCorto = '' } = useParams();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const academia = useAcademiaPublica(nombreCorto);
  const ingresar = useIniciarSesionAcademia(nombreCorto);
  const { register, handleSubmit, formState } = useForm<CamposIngreso, unknown, IniciarSesionAcademia>({
    resolver: zodResolver(iniciarSesionAcademiaSchema),
    defaultValues: { usuario: '', clave: '' },
  });

  // Pantalla de ingreso: nada de una sesión anterior debe quedar en la memoria de la página.
  useEffect(() => {
    cliente.removeQueries({ predicate: (consulta) => consulta.queryKey[0] !== 'academia-publica' });
  }, [cliente]);

  const enviar = handleSubmit((datos) => {
    ingresar.mutate(datos, {
      onSuccess: ({ usuario }) =>
        void navegar(usuario.debeCambiarClave ? RUTA_CAMBIAR_CLAVE : '/panel', { replace: true }),
    });
  });

  if (academia.isPending) {
    return (
      <Tarjeta>
        <p role="status" className="text-slate-600">
          Cargando…
        </p>
      </Tarjeta>
    );
  }

  if (academia.isError) {
    const suspendida = esErrorDeApi(academia.error, 403, 'ACADEMIA_SUSPENDIDA');
    const inexistente = esErrorDeApi(academia.error, 404);
    return (
      <Tarjeta>
        <h1 className="text-2xl font-semibold text-sky-900">AquaGestión</h1>
        {suspendida || inexistente ? (
          <p role="alert" className="mt-4 text-slate-800">
            {suspendida ? MENSAJE_ACADEMIA_SUSPENDIDA : 'No encontramos esa academia. Revisa el enlace que te dieron.'}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <Alerta>{mensajeGeneral(academia.error)}</Alerta>
            <button type="button" onClick={() => void academia.refetch()} className={ESTILO_BOTON.secundario}>
              Reintentar
            </button>
          </div>
        )}
      </Tarjeta>
    );
  }

  return (
    <Tarjeta>
      <h1 className="text-2xl font-semibold text-sky-900">{academia.data.nombre}</h1>
      <p className="mt-1 text-slate-600">Ingresa con tu DNI</p>
      <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-6 space-y-4">
        <CampoTexto
          etiqueta="DNI"
          type="text"
          inputMode="numeric"
          autoComplete="username"
          error={formState.errors.usuario?.message}
          {...register('usuario')}
        />
        <CampoTexto
          etiqueta="Contraseña"
          type="password"
          autoComplete="current-password"
          error={formState.errors.clave?.message}
          {...register('clave')}
        />
        {ingresar.isError ? <Alerta>{mensajeDeIngresoAcademia(ingresar.error)}</Alerta> : null}
        <button type="submit" disabled={ingresar.isPending} className={`${ESTILO_BOTON.primario} w-full`}>
          {ingresar.isPending ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-700">¿Olvidaste tu contraseña? Pide en recepción que la restablezcan.</p>
      <p className="mt-2 text-sm text-slate-700">La primera vez, tu contraseña es tu DNI y se te pedirá cambiarla.</p>
    </Tarjeta>
  );
}
