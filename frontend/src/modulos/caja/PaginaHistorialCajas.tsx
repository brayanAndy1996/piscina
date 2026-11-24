import {
  type CajaHistorial,
  type FiltroHistorialCajas,
  filtroHistorialCajasSchema,
  rangoDelHistorial,
} from '@aquagestion/contratos';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, CampoTexto, ESTILO_BOTON, Insignia } from '../../componentes/ui';
import { useRecienPedida } from '../../lib/base-de-llenado';
import { formatearSoles } from '../../lib/dinero';
import { erroresPorCampo, mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario } from '../../lib/fechas';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { mensajesPorCampo } from './campos';
import { useHistorialCajas, useHoyEnLima } from './hooks';
import { describirDiferencia } from './montos';

/** `/panel/cajas`: el historial de cajas, con el filtro de fechas (HU-27, criterio 40). Quien tiene `VER_REPORTES_FINANCIEROS`. */
export function PaginaHistorialCajas() {
  return (
    <RequierePermiso permiso="VER_REPORTES_FINANCIEROS">
      <ContenidoDelHistorial />
    </RequierePermiso>
  );
}

interface CamposDelFiltro {
  desde: string;
  hasta: string;
}

/** Solo viajan las fechas que la persona escribió: un campo vacío deja que la API use su valor por defecto (PQ3). */
function filtroDeCampos({ desde, hasta }: CamposDelFiltro): FiltroHistorialCajas {
  const filtro: FiltroHistorialCajas = {};
  if (desde) filtro.desde = desde;
  if (hasta) filtro.hasta = hasta;
  return filtro;
}

function ContenidoDelHistorial() {
  const [filtro, setFiltro] = useState<FiltroHistorialCajas>({});
  const consulta = useHistorialCajas(filtro);
  useAlPerderSesion(consulta.error);
  const verLista = useRecienPedida(consulta);
  const hoy = useHoyEnLima();
  const form = useForm<CamposDelFiltro>({ defaultValues: { desde: '', hasta: '' } });
  const { register, handleSubmit, setError, clearErrors, formState } = form;

  const filtrar = handleSubmit((campos) => {
    const pedido = filtroDeCampos(campos);
    // Primero lo que se escribió (formato y, con las dos fechas, el rango) y después el rango que la API va a aplicar con sus valores por
    // defecto (una sola fecha puede quedar posterior a hoy o a más de 366 días): si algo no vale, se dice junto al campo y no se llama a la API.
    const escrito = filtroHistorialCajasSchema.safeParse(pedido);
    const aplicado = filtroHistorialCajasSchema.safeParse(rangoDelHistorial(pedido, hoy));
    const problema = !escrito.success ? escrito.error : !aplicado.success ? aplicado.error : null;
    if (problema) {
      const mensajes = mensajesPorCampo(problema);
      if (mensajes['desde']) setError('desde', { message: mensajes['desde'] });
      if (mensajes['hasta']) setError('hasta', { message: mensajes['hasta'] });
      return;
    }
    // Con el mismo filtro la clave de la consulta no cambia y no se volvería a pedir: "Filtrar" pide de nuevo.
    if (filtro.desde === pedido.desde && filtro.hasta === pedido.hasta) void consulta.refetch();
    else setFiltro(pedido);
  });

  const respuesta = consulta.data;
  // Una validación del servidor que la web no vio (el reloj de la PC se atrasó, por ejemplo) se muestra junto a su campo.
  const erroresDelServidor = erroresPorCampo(consulta.error).filter(
    ({ campo }) => campo === 'desde' || campo === 'hasta',
  );

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Historial de caja</h1>

      <form
        onSubmit={(evento) => void filtrar(evento)}
        noValidate
        aria-label="Filtro de fechas"
        className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-5"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoTexto
            etiqueta="Desde"
            type="date"
            error={formState.errors.desde?.message ?? erroresDelServidor.find((e) => e.campo === 'desde')?.mensaje}
            {...register('desde', { onChange: () => clearErrors('desde') })}
          />
          <CampoTexto
            etiqueta="Hasta"
            type="date"
            error={formState.errors.hasta?.message ?? erroresDelServidor.find((e) => e.campo === 'hasta')?.mensaje}
            {...register('hasta', { onChange: () => clearErrors('hasta') })}
          />
        </div>
        <p className="text-sm text-slate-700">
          Si dejas las fechas vacías, se muestran los últimos 31 días. Puedes pedir hasta 366 días.
        </p>
        <div className="flex justify-end">
          <button type="submit" className={ESTILO_BOTON.primario}>
            Filtrar
          </button>
        </div>
      </form>

      {verLista && respuesta !== undefined ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) && erroresDelServidor.length === 0 ? (
            <Alerta>No pudimos actualizar el historial. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}
          <p role="status" className="text-slate-800">
            Mostrando las cajas del {formatearFechaCalendario(respuesta.desde)} al{' '}
            {formatearFechaCalendario(respuesta.hasta)}.
          </p>
          {respuesta.cajas.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-center text-slate-700 ring-1 ring-sky-100">
              No hay cajas en estas fechas
            </p>
          ) : (
            <ul aria-label="Cajas" className="space-y-3">
              {respuesta.cajas.map((caja) => (
                <FilaDeCaja key={caja.id} caja={caja} hoy={hoy} />
              ))}
            </ul>
          )}
        </>
      ) : consulta.isError ? (
        <div className="space-y-3">
          {esErrorDeApi(consulta.error, 401) || erroresDelServidor.length > 0 ? null : (
            <Alerta>No se pudo cargar el historial. {mensajeGeneral(consulta.error)}</Alerta>
          )}
          <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
            Reintentar
          </button>
        </div>
      ) : (
        <p role="status" className="text-slate-700">
          Cargando el historial…
        </p>
      )}
    </div>
  );
}

function etiquetaDelEstado(caja: CajaHistorial, hoy: string): { texto: string; color: 'verde' | 'ambar' | 'gris' } {
  if (caja.estado === 'CERRADA') return { texto: 'Cerrada', color: 'gris' };
  return caja.deOtroDia || caja.fecha !== hoy
    ? { texto: 'Abierta de otro día', color: 'ambar' }
    : { texto: 'Abierta', color: 'verde' };
}

function Dato({ titulo, children }: { titulo: string; children: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-slate-700">{titulo}</dt>
      <dd className="break-words font-medium text-slate-900">{children}</dd>
    </div>
  );
}

/** Una caja de la lista: el enlace del título cubre toda la tarjeta, así el nombre accesible del enlace es corto. */
function FilaDeCaja({ caja, hoy }: { caja: CajaHistorial; hoy: string }) {
  const estado = etiquetaDelEstado(caja, hoy);
  const cierre = caja.ultimoCierre;
  return (
    <li className="relative rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 hover:bg-sky-50 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">
            <Link
              to={`/panel/cajas/${encodeURIComponent(caja.id)}`}
              className="text-sky-900 after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
            >
              Caja del {formatearFechaCalendario(caja.fecha)}
            </Link>
          </h2>
          <p className="break-words text-sm text-slate-700">
            Abierta por {caja.abiertaPor.nombres} {caja.abiertaPor.apellidos}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Insignia color={estado.color}>{estado.texto}</Insignia>
          {cierre?.tardio ? <Insignia color="ambar">Tardío</Insignia> : null}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Dato titulo="Monto inicial">{formatearSoles(caja.montoInicial)}</Dato>
        <Dato titulo="Ingresos en efectivo">{formatearSoles(caja.totalIngresos.efectivo)}</Dato>
        <Dato titulo="Ingresos por Yape">{formatearSoles(caja.totalIngresos.yape)}</Dato>
        <Dato titulo="Ingresos por transferencia">{formatearSoles(caja.totalIngresos.transferencia)}</Dato>
        <Dato titulo="Egresos">{formatearSoles(caja.totalEgresos.efectivo)}</Dato>
        {cierre ? (
          <>
            <Dato titulo="Efectivo contado">{formatearSoles(cierre.montoDeclarado)}</Dato>
            <Dato titulo="Diferencia">{describirDiferencia(cierre.diferencia)}</Dato>
          </>
        ) : (
          <Dato titulo="Cierre">Sin cerrar</Dato>
        )}
      </dl>
    </li>
  );
}
