import { puede } from '@aquagestion/contratos';
import { useState } from 'react';
import { Link } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, Aviso, ESTILO_BOTON } from '../../componentes/ui';
import { useRecienPedida } from '../../lib/base-de-llenado';
import { formatearSoles } from '../../lib/dinero';
import { mensajeGeneral } from '../../lib/errores';
import { formatearFechaCalendario } from '../../lib/fechas';
import { useUsuario } from '../sesion/contexto';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { DialogoCierre } from './DialogoCierre';
import { DialogoEgreso } from './DialogoEgreso';
import { DialogoReapertura } from './DialogoReapertura';
import { FormularioApertura } from './FormularioApertura';
import { useCajaActual, useHoyEnLima } from './hooks';
import { ListaMovimientos } from './ListaMovimientos';
import { mensajeDeCaja } from './mensajes';
import { ResultadoDelCierre } from './ResultadoDelCierre';
import { ResumenCaja } from './ResumenCaja';

type Dialogo = 'egreso' | 'cierre' | 'reapertura';

/** `/panel/caja`: la caja del día de la academia (HU-25 a HU-27). `ADMIN` y `SECRETARIA` (sección 2.1). */
export function PaginaCaja() {
  return (
    <RequierePermiso permiso="ABRIR_CERRAR_CAJA">
      <ContenidoCaja />
    </RequierePermiso>
  );
}

function ContenidoCaja() {
  const usuario = useUsuario();
  const consulta = useCajaActual();
  useAlPerderSesion(consulta.error);
  const verCaja = useRecienPedida(consulta);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [problema, setProblema] = useState<string | null>(null);
  const caja = consulta.data;
  const puedeReabrir = puede(usuario.rol, 'REABRIR_CAJA');
  // "Hoy" es el de Lima: una página que sigue abierta pasada la medianoche no llama "de hoy" a la caja de ayer.
  const hoy = useHoyEnLima();
  const deOtroDia = caja !== undefined && caja !== null && (caja.deOtroDia || caja.fecha < hoy);
  const cerradaDeOtroDia = caja !== undefined && caja !== null && caja.estado === 'CERRADA' && deOtroDia;

  const abrirDialogo = (cual: Dialogo) => {
    setHecho(null);
    setProblema(null);
    setDialogo(cual);
  };
  const terminar = (mensaje: string) => {
    setProblema(null);
    setHecho(mensaje);
    setDialogo(null);
  };
  /** Un error que dejó la caja distinta de como se veía: la consulta ya se vuelve a pedir; aquí solo se explica y se cierra el diálogo. */
  const alFallar = (error: unknown) => {
    setHecho(null);
    setProblema(mensajeDeCaja(error));
    setDialogo(null);
  };
  const recargar = async () => (await consulta.refetch()).data;

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Caja del día</h1>

      {hecho ? (
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          {hecho}
        </p>
      ) : null}
      {problema ? <Alerta>{problema}</Alerta> : null}

      {verCaja && caja !== undefined ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
            <Alerta>No pudimos actualizar la caja. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}

          {caja === null || cerradaDeOtroDia ? (
            <>
              {caja ? (
                <Aviso>
                  La caja del {formatearFechaCalendario(caja.fecha)} ya está cerrada. Todavía no hay una caja de hoy:
                  ábrela para empezar el día.
                </Aviso>
              ) : null}
              <FormularioApertura
                alAbrir={(abierta) => terminar(`Caja abierta con ${formatearSoles(abierta.montoInicial)}.`)}
                alFallar={alFallar}
              />
              {caja ? <ResultadoDelCierre caja={caja} /> : null}
              {caja ? <ResumenCaja caja={caja} /> : null}
            </>
          ) : (
            <>
              {caja.estado === 'ABIERTA' && deOtroDia ? (
                <Aviso>
                  La caja del {formatearFechaCalendario(caja.fecha)} sigue abierta. Ciérrala antes de abrir la de hoy.
                  Mientras tanto no admite egresos ni cobros.
                </Aviso>
              ) : null}

              {caja.estado === 'ABIERTA' ? (
                <div className="flex flex-wrap gap-2">
                  {!deOtroDia ? (
                    <button type="button" onClick={() => abrirDialogo('egreso')} className={ESTILO_BOTON.secundario}>
                      Registrar egreso
                    </button>
                  ) : null}
                  <button type="button" onClick={() => abrirDialogo('cierre')} className={ESTILO_BOTON.primario}>
                    Cerrar caja
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {puedeReabrir ? (
                    <button
                      type="button"
                      onClick={() => abrirDialogo('reapertura')}
                      className={ESTILO_BOTON.secundario}
                    >
                      Reabrir caja
                    </button>
                  ) : (
                    <p className="text-slate-700">
                      La caja de hoy ya está cerrada. Si hace falta seguir cobrando, pide al administrador que la
                      reabra.
                    </p>
                  )}
                </div>
              )}

              {caja.estado === 'CERRADA' ? <ResultadoDelCierre caja={caja} /> : null}
              <ResumenCaja caja={caja} />
              <h2 className="text-xl font-semibold text-slate-900">Movimientos</h2>
              <ListaMovimientos movimientos={caja.movimientos} />
            </>
          )}

          {caja && dialogo === 'egreso' && caja.estado === 'ABIERTA' && !deOtroDia ? (
            <DialogoEgreso
              caja={caja}
              alCerrar={() => setDialogo(null)}
              alRegistrar={(monto) => terminar(`Egreso registrado: ${formatearSoles(monto)}.`)}
              alFallar={alFallar}
            />
          ) : null}
          {caja && dialogo === 'cierre' && caja.estado === 'ABIERTA' ? (
            <DialogoCierre
              caja={caja}
              recargar={async () => (await recargar()) ?? null}
              alCerrar={() => setDialogo(null)}
              alCerrarLaCaja={() => terminar('Caja cerrada. Este es el resultado del cierre.')}
              alFallar={alFallar}
            />
          ) : null}
          {caja && dialogo === 'reapertura' && caja.estado === 'CERRADA' && !cerradaDeOtroDia && puedeReabrir ? (
            <DialogoReapertura
              caja={caja}
              alCerrar={() => setDialogo(null)}
              alReabrir={() => terminar('Caja reabierta. Ya admite egresos y cobros.')}
              alFallar={alFallar}
            />
          ) : null}
        </>
      ) : consulta.isError ? (
        <div className="space-y-3">
          {esErrorDeApi(consulta.error, 401) ? null : (
            <Alerta>No se pudo cargar la caja. {mensajeGeneral(consulta.error)}</Alerta>
          )}
          <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
            Reintentar
          </button>
        </div>
      ) : (
        <p role="status" className="text-slate-700">
          Cargando la caja…
        </p>
      )}
    </div>
  );
}
