import {
  type AcademiaResumen,
  type AdministradorResumen,
  type CrearAdministrador,
  crearAdministradorSchema,
} from '@aquagestion/contratos';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON, Insignia, Modal } from '../../componentes/ui';
import { erroresPorCampo } from '../../lib/errores';
import { MENSAJE_DNI_EN_USO } from '../usuarios/mensajes';
import {
  useAdministradores,
  useCrearAdministrador,
  useRedirigirSiNoAutenticado,
  useRestablecerClaveAdministrador,
} from './hooks';
import { mensajeDeAdministradores } from './mensajes';

interface Propiedades {
  academia: AcademiaResumen;
  alCerrar: () => void;
}

type Vista = { tipo: 'lista' } | { tipo: 'crear' } | { tipo: 'restablecer'; administrador: AdministradorResumen };

/**
 * "Administradores" de una academia (DR-1, DR-5 y D-29): lista, crea y restablece la contraseña de sus administradores. Es lo
 * único de la academia que ve el Superadmin. Una sola ventana cambia de vista para que el foco y Escape sigan siendo simples.
 */
export function DialogoAdministradores({ academia, alCerrar }: Propiedades) {
  const [vista, setVista] = useState<Vista>({ tipo: 'lista' });
  const [aviso, setAviso] = useState<string | null>(null);
  const alVolver = () => setVista({ tipo: 'lista' });

  if (vista.tipo === 'crear') return <FormularioNuevoAdministrador academia={academia} alCerrar={alVolver} />;
  if (vista.tipo === 'restablecer') {
    return (
      <ConfirmarRestablecer
        academia={academia}
        administrador={vista.administrador}
        alCerrar={alVolver}
        alExito={(nombre) =>
          setAviso(`Listo. La contraseña de ${nombre} ahora es su DNI y tendrá que cambiarla al entrar.`)
        }
      />
    );
  }
  return (
    <ListaAdministradores
      academia={academia}
      aviso={aviso}
      alCerrar={alCerrar}
      alCrear={() => {
        setAviso(null);
        setVista({ tipo: 'crear' });
      }}
      alRestablecer={(administrador) => setVista({ tipo: 'restablecer', administrador })}
    />
  );
}

interface PropiedadesLista {
  academia: AcademiaResumen;
  aviso: string | null;
  alCerrar: () => void;
  alCrear: () => void;
  alRestablecer: (administrador: AdministradorResumen) => void;
}

function ListaAdministradores({ academia, aviso, alCerrar, alCrear, alRestablecer }: PropiedadesLista) {
  const consulta = useAdministradores(academia.id);
  useRedirigirSiNoAutenticado(consulta.error);

  return (
    <Modal titulo={`Administradores de ${academia.nombre}`} alCerrar={alCerrar}>
      <div className="mt-3 space-y-3">
        {aviso ? (
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900 ring-1 ring-emerald-200">
            {aviso}
          </p>
        ) : null}
        {consulta.isPending ? (
          <p role="status" className="text-slate-600">
            Cargando administradores…
          </p>
        ) : null}
        {consulta.isError ? (
          <>
            <Alerta>{mensajeDeAdministradores(consulta.error)}</Alerta>
            {esErrorDeApi(consulta.error, 403, 'ACADEMIA_SUSPENDIDA') ? null : (
              <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
                Reintentar
              </button>
            )}
          </>
        ) : null}
        {consulta.isSuccess && consulta.data.length === 0 ? (
          <p className="text-slate-700">
            Esta academia todavía no tiene administradores. Crea el primero con «Nuevo administrador».
          </p>
        ) : null}
        {consulta.isSuccess && consulta.data.length > 0 ? (
          <ul className="space-y-3">
            {consulta.data.map((admin) => (
              <li key={admin.id} className="rounded-xl p-3 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 break-words font-semibold text-slate-900">
                    {admin.apellidos}, {admin.nombres}
                  </p>
                  <Insignia color={admin.estado === 'INACTIVO' ? 'gris' : 'verde'}>
                    {admin.estado === 'INACTIVO' ? 'Inactivo' : 'Activo'}
                  </Insignia>
                  {admin.bloqueado ? <Insignia color="ambar">Bloqueado</Insignia> : null}
                </div>
                <p className="mt-1 text-sm text-slate-700">
                  DNI <span className="font-mono">{admin.dni}</span>
                </p>
                <button
                  type="button"
                  onClick={() => alRestablecer(admin)}
                  aria-label={`Restablecer contraseña de ${admin.nombres} ${admin.apellidos}`}
                  className={`${ESTILO_BOTON.secundario} mt-2`}
                >
                  Restablecer contraseña
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
          Cerrar
        </button>
        <button
          type="button"
          onClick={alCrear}
          disabled={esErrorDeApi(consulta.error, 403, 'ACADEMIA_SUSPENDIDA')}
          className={ESTILO_BOTON.primario}
        >
          Nuevo administrador
        </button>
      </div>
    </Modal>
  );
}

type Campos = z.input<typeof crearAdministradorSchema>;

function FormularioNuevoAdministrador({ academia, alCerrar }: Propiedades) {
  const crear = useCrearAdministrador(academia.id);
  const { register, handleSubmit, setError, formState } = useForm<Campos, unknown, CrearAdministrador>({
    resolver: zodResolver(crearAdministradorSchema),
    defaultValues: { dni: '', nombres: '', apellidos: '' },
  });
  useRedirigirSiNoAutenticado(crear.error);

  const enviar = handleSubmit((datos) => {
    crear.mutate(datos, {
      onSuccess: alCerrar,
      onError: (error) => {
        if (esErrorDeApi(error, 409, 'DNI_EN_USO')) {
          setError('dni', { message: MENSAJE_DNI_EN_USO });
          return;
        }
        for (const { campo, mensaje } of erroresPorCampo(error)) {
          if (campo === 'dni' || campo === 'nombres' || campo === 'apellidos') setError(campo, { message: mensaje });
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
    <Modal titulo={`Nuevo administrador de ${academia.nombre}`} alCerrar={alCerrar}>
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
        {errorGeneral ? <Alerta>{mensajeDeAdministradores(crear.error)}</Alerta> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
            Cancelar
          </button>
          <button type="submit" disabled={crear.isPending} className={ESTILO_BOTON.primario}>
            {crear.isPending ? 'Creando…' : 'Crear administrador'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmarRestablecer({
  academia,
  administrador,
  alCerrar,
  alExito,
}: Propiedades & { administrador: AdministradorResumen; alExito: (nombre: string) => void }) {
  const restablecer = useRestablecerClaveAdministrador(academia.id);
  useRedirigirSiNoAutenticado(restablecer.error);
  const nombre = `${administrador.nombres} ${administrador.apellidos}`;

  return (
    <Modal titulo={`Restablecer contraseña de ${nombre}`} alCerrar={alCerrar}>
      <div className="mt-2 space-y-2 text-slate-700">
        <p>
          La nueva contraseña de {nombre} será su DNI ({administrador.dni}). Al entrar, el sistema le pedirá elegir
          otra.
        </p>
        <p>Si la cuenta estaba bloqueada, se desbloquea. Su sesión actual se cierra.</p>
      </div>
      {restablecer.isError ? (
        <div className="mt-4">
          <Alerta>{mensajeDeAdministradores(restablecer.error)}</Alerta>
        </div>
      ) : null}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={alCerrar} className={ESTILO_BOTON.secundario}>
          Cancelar
        </button>
        <button
          type="button"
          onClick={() =>
            restablecer.mutate(administrador.id, {
              onSuccess: () => {
                alExito(nombre);
                alCerrar();
              },
            })
          }
          disabled={restablecer.isPending}
          className={ESTILO_BOTON.primario}
        >
          {restablecer.isPending ? 'Restableciendo…' : 'Restablecer contraseña'}
        </button>
      </div>
    </Modal>
  );
}
