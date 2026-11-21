import { codigoSolicitudSchema, dniSchema } from '@aquagestion/contratos';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { esErrorDeApi } from '../../api/cliente';
import { MarcoPublico } from '../../componentes/MarcoPublico';
import { Alerta, CampoTexto, ESTILO_BOTON } from '../../componentes/ui';
import { mensajeGeneral } from '../../lib/errores';
import { useConsultarPorCodigo } from './hooks';
import { VistaSeguimiento } from './VistaSeguimiento';

/**
 * `/a/{nombreCorto}/solicitud`: el seguimiento con el código y el DNI, para quien perdió el enlace (D-05). Valida el formato con los
 * esquemas compartidos antes de consultar; el código se pasa a mayúsculas y se recorta, como lo hace la API (criterio 30). Un código con
 * otro DNI y un código que no existe dan el mismo mensaje.
 */
export function PaginaConsultaSolicitud() {
  const { nombreCorto = '' } = useParams();
  return (
    <MarcoPublico nombreCorto={nombreCorto}>
      <Consulta nombreCorto={nombreCorto} />
    </MarcoPublico>
  );
}

function Consulta({ nombreCorto }: { nombreCorto: string }) {
  const [codigo, setCodigo] = useState('');
  const [dni, setDni] = useState('');
  const [errores, setErrores] = useState<{ codigo?: string; dni?: string }>({});
  const consulta = useConsultarPorCodigo(nombreCorto);

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (consulta.isPending) return;
    const codigoValido = codigoSolicitudSchema.safeParse(codigo);
    const dniValido = dniSchema.safeParse(dni);
    const nuevos: { codigo?: string; dni?: string } = {};
    if (!codigoValido.success) nuevos.codigo = codigoValido.error.issues[0]?.message ?? 'El código no es válido.';
    if (!dniValido.success) nuevos.dni = dniValido.error.issues[0]?.message ?? 'El DNI no es válido.';
    setErrores(nuevos);
    if (!codigoValido.success || !dniValido.success) return;
    consulta.mutate({ codigo: codigoValido.data, dni: dniValido.data });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-sky-900">Consulta tu solicitud</h1>
      <p className="text-slate-700">Escribe el código que recibiste al inscribirte y tu DNI.</p>
      <form
        onSubmit={enviar}
        noValidate
        className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6"
      >
        <CampoTexto
          etiqueta="Código de la solicitud"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="AQ-XXXXXX"
          value={codigo}
          onChange={(evento) => {
            setCodigo(evento.target.value);
            setErrores((anteriores) => ({ ...anteriores, codigo: undefined }));
          }}
          error={errores.codigo}
        />
        <CampoTexto
          etiqueta="DNI"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={dni}
          onChange={(evento) => {
            setDni(evento.target.value);
            setErrores((anteriores) => ({ ...anteriores, dni: undefined }));
          }}
          error={errores.dni}
        />
        {consulta.isError ? (
          <Alerta>
            {esErrorDeApi(consulta.error, 404, 'SOLICITUD_NO_ENCONTRADA')
              ? 'No encontramos una solicitud con ese código y ese DNI. Revísalos e inténtalo de nuevo.'
              : esErrorDeApi(consulta.error, 429)
                ? 'Hiciste demasiadas consultas. Espera un minuto e inténtalo de nuevo.'
                : mensajeGeneral(consulta.error)}
          </Alerta>
        ) : null}
        <button type="submit" disabled={consulta.isPending} className={`${ESTILO_BOTON.primario} w-full sm:w-auto`}>
          {consulta.isPending ? 'Buscando…' : 'Consultar'}
        </button>
      </form>

      {consulta.data ? <VistaSeguimiento respuesta={consulta.data} /> : null}

      <p className="text-sm text-slate-700">
        ¿Todavía no te inscribes?{' '}
        <Link to={`/a/${encodeURIComponent(nombreCorto)}/inscripcion`} className="text-sky-800 underline">
          Ir al formulario de inscripción
        </Link>
      </p>
    </div>
  );
}
