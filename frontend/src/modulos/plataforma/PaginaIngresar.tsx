import { type IniciarSesionPlataforma, iniciarSesionPlataformaSchema } from '@aquagestion/contratos';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { z } from 'zod';
import { RUTA_ACADEMIAS, useIniciarSesion } from './hooks';
import { mensajeDeIngreso } from './mensajes';
import { Alerta, CampoTexto, ESTILO_BOTON } from '../../componentes/ui';

type CamposIngreso = z.input<typeof iniciarSesionPlataformaSchema>;

/** `/plataforma/ingresar`: ingreso del superadmin con correo y contraseña (D-29). La sesión vive solo en la cookie. */
export function PaginaIngresar() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const ingresar = useIniciarSesion();
  const { register, handleSubmit, formState } = useForm<CamposIngreso, unknown, IniciarSesionPlataforma>({
    resolver: zodResolver(iniciarSesionPlataformaSchema),
    defaultValues: { correo: '', clave: '' },
  });

  // Pantalla de ingreso: nada de una sesión anterior debe quedar en la memoria de la página.
  useEffect(() => {
    cliente.clear();
  }, [cliente]);

  const enviar = handleSubmit((datos) => {
    ingresar.mutate(datos, { onSuccess: () => void navegar(RUTA_ACADEMIAS, { replace: true }) });
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-sky-50 p-4">
      <section className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-sky-100 sm:p-8">
        <h1 className="text-2xl font-semibold text-sky-900">AquaGestión</h1>
        <p className="mt-1 text-slate-600">Ingreso a la plataforma</p>
        <form onSubmit={(evento) => void enviar(evento)} noValidate className="mt-6 space-y-4">
          <CampoTexto
            etiqueta="Correo"
            type="email"
            autoComplete="username"
            inputMode="email"
            error={formState.errors.correo?.message}
            {...register('correo')}
          />
          <CampoTexto
            etiqueta="Contraseña"
            type="password"
            autoComplete="current-password"
            error={formState.errors.clave?.message}
            {...register('clave')}
          />
          {ingresar.isError ? <Alerta>{mensajeDeIngreso(ingresar.error)}</Alerta> : null}
          <button type="submit" disabled={ingresar.isPending} className={`${ESTILO_BOTON.primario} w-full`}>
            {ingresar.isPending ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  );
}
