import { puede } from '@aquagestion/contratos';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { Alerta, ESTILO_BOTON } from '../../componentes/ui';
import { BotonDescargarPdf } from '../carnet/BotonDescargarPdf';
import { useCarnetDelAlumno } from '../carnet/hooks';
import { mensajeDeCarnet } from '../carnet/mensajes';
import { VistaCarnet } from '../carnet/VistaCarnet';
import { alcanceDe } from '../../lib/permisos';
import { useUsuario } from '../sesion/contexto';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { DialogoFoto } from '../foto/DialogoFoto';
import { SeccionMensualidad } from '../mensualidades/SeccionMensualidad';
import { AsistenciaDelMes } from './AsistenciaDelMes';
import { DialogoRegenerarQr } from './DialogoRegenerarQr';

/**
 * `/panel/alumnos/{id}`: el carnet de un alumno para el personal (HU-13, criterio 19 de 008), con «Descargar PDF» y, para quien puede cobrar
 * (`REGISTRAR_INSCRIPCION_Y_COBRO`), «Regenerar QR» y «Cambiar foto» o «Agregar foto» (archivo o cámara, criterio 28 de 008b), la sección «Mensualidad» con «Renovar» (010a, criterio 20) y la sección «Asistencia» del mes (009b, criterio 32). `ADMIN` y `SECRETARIA`.
 */
export function PaginaCarnetAlumno() {
  return (
    <RequierePermiso permiso="VER_CARNET" alcance="TODO">
      <ContenidoCarnetAlumno />
    </RequierePermiso>
  );
}

function ContenidoCarnetAlumno() {
  const { id = '' } = useParams();
  const usuario = useUsuario();
  const consulta = useCarnetDelAlumno(id);
  useAlPerderSesion(consulta.error);
  const [dialogo, setDialogo] = useState(false);
  const [dialogoFoto, setDialogoFoto] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  const carnet = consulta.data;
  const puedeRegenerar = puede(usuario.rol, 'REGISTRAR_INSCRIPCION_Y_COBRO');
  // La asistencia del mes es de `VER_REPORTES_ASISTENCIA` con alcance `TODO` (009b, criterio 31): el entrenador y el alumno no la ven.
  const veAsistencia = alcanceDe(usuario.rol, 'VER_REPORTES_ASISTENCIA') === 'TODO';

  return (
    <div className="space-y-4">
      <Link to="/panel/alumnos" className="inline-block text-sky-800 underline">
        ← Volver a la búsqueda
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Carnet del alumno</h1>

      {hecho ? (
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          {hecho}
        </p>
      ) : null}

      {carnet ? (
        <>
          {consulta.isError && !esErrorDeApi(consulta.error, 401) ? (
            <Alerta>No pudimos actualizar el carnet. Lo que ves puede estar desactualizado.</Alerta>
          ) : null}
          <VistaCarnet
            carnet={carnet}
            acciones={
              <>
                <BotonDescargarPdf alumnoId={carnet.alumno.id} />
                {puedeRegenerar ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setHecho(null);
                        setDialogoFoto(true);
                      }}
                      className={ESTILO_BOTON.secundario}
                    >
                      {carnet.foto ? 'Cambiar foto' : 'Agregar foto'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHecho(null);
                        setDialogo(true);
                      }}
                      className={ESTILO_BOTON.secundario}
                    >
                      Regenerar QR
                    </button>
                  </>
                ) : null}
              </>
            }
          />
          {puedeRegenerar ? <SeccionMensualidad alumnoId={carnet.alumno.id} /> : null}
          {veAsistencia ? (
            <AsistenciaDelMes
              alumnoId={carnet.alumno.id}
              nombre={`${carnet.alumno.nombres} ${carnet.alumno.apellidos}`}
              puedeRegistrar={puede(usuario.rol, 'REGISTRAR_ASISTENCIA')}
            />
          ) : null}
          {dialogoFoto ? (
            <DialogoFoto
              titulo={carnet.foto ? 'Cambiar foto' : 'Agregar foto'}
              destino={{ tipo: 'alumno', id: carnet.alumno.id }}
              nombre={`${carnet.alumno.nombres} ${carnet.alumno.apellidos}`}
              alCerrar={() => setDialogoFoto(false)}
              alGuardar={() => {
                setDialogoFoto(false);
                setHecho('Se guardó la foto del alumno.');
              }}
            />
          ) : null}
          {dialogo ? (
            <DialogoRegenerarQr
              alumnoId={carnet.alumno.id}
              nombre={`${carnet.alumno.nombres} ${carnet.alumno.apellidos}`}
              alCerrar={() => setDialogo(false)}
              alRegenerar={() => {
                setDialogo(false);
                setHecho(
                  'Se generó un QR nuevo. El anterior ya no sirve: imprime el carnet nuevo y entrégaselo al alumno.',
                );
              }}
            />
          ) : null}
        </>
      ) : consulta.isError ? (
        esErrorDeApi(consulta.error, 401) ? null : (
          <div className="space-y-3">
            <Alerta>{mensajeDeCarnet(consulta.error)}</Alerta>
            {esErrorDeApi(consulta.error, 404) ? null : (
              <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
                Volver a intentar
              </button>
            )}
          </div>
        )
      ) : (
        <p role="status" className="text-slate-700">
          Cargando el carnet…
        </p>
      )}
    </div>
  );
}
