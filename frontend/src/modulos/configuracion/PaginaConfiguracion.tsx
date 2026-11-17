import {
  type ActualizarConfiguracion,
  actualizarConfiguracionSchema,
  type CampoConfiguracion,
  CAMPOS_CONFIGURACION,
  CAMPOS_ENTEROS_CONFIGURACION,
  CLAVES_CONFIGURACION,
  type ConfiguracionAcademia,
  CONFIGURACION_POR_DEFECTO,
  LIMITES_CONFIGURACION,
} from '@aquagestion/contratos';
import { type ReactNode, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { Alerta, CampoTexto, ESTILO_BOTON } from '../../componentes/ui';
import { erroresPorCampo, mensajeGeneral } from '../../lib/errores';
import { esErrorDeApi } from '../../api/cliente';
import { useUsuario } from '../sesion/contexto';
import { esErrorDeCambioDeSesion, useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import { useActualizarConfiguracion, useConfiguracion } from './hooks';

/** Lo que el formulario guarda de cada campo: el texto de la entrada. Se convierte al enviar. */
type Campos = Record<CampoConfiguracion, string>;

const GRUPOS: readonly { titulo: string; descripcion: string; campos: readonly CampoConfiguracion[] }[] = [
  {
    titulo: 'Asistencia y mensualidades',
    descripcion: 'Cuándo se marca una asistencia como tarde y cuándo se avisa que una mensualidad está por vencer.',
    campos: ['toleranciaTardanzaMinutos', 'diasPorVencer', 'diasPrioridadRenovacion'],
  },
  {
    titulo: 'Seguridad del inicio de sesión',
    descripcion: 'Cuántos intentos fallidos se permiten y cuánto dura el bloqueo de la cuenta.',
    campos: ['intentosInicioSesion', 'minutosBloqueo'],
  },
];

function aTextos(configuracion: ConfiguracionAcademia): Campos {
  return {
    toleranciaTardanzaMinutos: String(configuracion.toleranciaTardanzaMinutos),
    diasPorVencer: String(configuracion.diasPorVencer),
    diasPrioridadRenovacion: String(configuracion.diasPrioridadRenovacion),
    intentosInicioSesion: String(configuracion.intentosInicioSesion),
    minutosBloqueo: String(configuracion.minutosBloqueo),
    telefono: configuracion.telefono ?? '',
  };
}

/**
 * Solo los campos que cambiaron respecto de lo cargado (criterio 23). Un texto que no es un entero se deja tal cual: el esquema
 * compartido lo rechaza con su mensaje. Un teléfono vacío es `null` (quita el teléfono).
 */
function cambiosDe(textos: Campos, base: ConfiguracionAcademia): Record<string, unknown> {
  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS_ENTEROS_CONFIGURACION) {
    const texto = textos[campo].trim();
    const valor = /^-?\d+$/.test(texto) ? Number(texto) : texto;
    if (valor !== base[campo]) cambios[campo] = valor;
  }
  const telefono = textos.telefono.trim() === '' ? null : textos.telefono.trim();
  if (telefono !== base.telefono) cambios.telefono = telefono;
  return cambios;
}

function esCampo(nombre: unknown): nombre is CampoConfiguracion {
  return CAMPOS_CONFIGURACION.some((campo) => campo === nombre);
}

/** El texto de ayuda de un campo: qué hace, su rango y su valor por defecto (criterio 23). */
function ayudaDe(campo: CampoConfiguracion): string {
  if (campo === 'telefono') return `${CLAVES_CONFIGURACION.telefono.ayuda} Por defecto: sin teléfono.`;
  const definicion = CLAVES_CONFIGURACION[campo];
  const { minimo, maximo } = LIMITES_CONFIGURACION[campo];
  const unidad = definicion.unidad;
  return `${definicion.ayuda} Rango: de ${minimo} a ${maximo} ${unidad}. Por defecto: ${definicion.porDefecto} ${unidad}.`;
}

/** `/panel/configuracion`: los valores que cada academia ajusta sin tocar el código (D-07, D-11, D-22; criterios 22 y 23). */
export function PaginaConfiguracion() {
  return (
    <RequierePermiso permiso="CONFIGURAR_ACADEMIA">
      <ContenidoConfiguracion />
    </RequierePermiso>
  );
}

function ContenidoConfiguracion() {
  const consulta = useConfiguracion();
  useAlPerderSesion(consulta.error);

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Configuración</h1>
      <p className="text-slate-700">
        Ajusta los valores de tu academia. Los cambios valen desde que los guardas y no modifican lo que ya se registró.
      </p>
      {consulta.isPending ? (
        <p role="status" className="text-slate-700">
          Cargando…
        </p>
      ) : consulta.isError ? (
        <div className="space-y-3">
          {esErrorDeApi(consulta.error, 401) ? null : <Alerta>{mensajeGeneral(consulta.error)}</Alerta>}
          <button type="button" onClick={() => void consulta.refetch()} className={ESTILO_BOTON.secundario}>
            Reintentar
          </button>
        </div>
      ) : (
        <FormularioConfiguracion base={consulta.data} />
      )}
    </div>
  );
}

function FormularioConfiguracion({ base }: { base: ConfiguracionAcademia }) {
  const usuario = useUsuario();
  const actualizar = useActualizarConfiguracion();
  const [guardado, setGuardado] = useState(false);
  const { register, handleSubmit, setValue, setError, clearErrors, reset, control, formState } = useForm<Campos>({
    defaultValues: aTextos(base),
  });
  const textos = useWatch({ control });
  useAlPerderSesion(actualizar.error);

  const cambios = cambiosDe({ ...aTextos(base), ...textos }, base);
  const hayCambios = Object.keys(cambios).length > 0;

  const alEditar = (campo: CampoConfiguracion) => {
    clearErrors(campo);
    setGuardado(false);
  };

  const enviar = handleSubmit((valores) => {
    setGuardado(false);
    const pedido = actualizarConfiguracionSchema.safeParse(cambiosDe(valores, base));
    if (!pedido.success) {
      const conError = new Set<string>();
      for (const problema of pedido.error.issues) {
        const campo = problema.path[0];
        // Un solo mensaje por campo: el primero es el más claro.
        if (esCampo(campo) && !conError.has(campo)) {
          conError.add(campo);
          setError(campo, { message: problema.message });
        }
      }
      return;
    }
    const datos: ActualizarConfiguracion = pedido.data;
    actualizar.mutate(datos, {
      onSuccess: (configuracion) => {
        reset(aTextos(configuracion));
        setGuardado(true);
      },
      onError: (error) => {
        for (const { campo, mensaje } of erroresPorCampo(error)) {
          if (esCampo(campo)) setError(campo, { message: mensaje });
        }
      },
    });
  });

  const errorGeneral =
    actualizar.isError &&
    !esErrorDeApi(actualizar.error, 401) &&
    !esErrorDeCambioDeSesion(actualizar.error) &&
    erroresPorCampo(actualizar.error).length === 0;

  function campo(nombre: CampoConfiguracion): ReactNode {
    const definicion = CLAVES_CONFIGURACION[nombre];
    const etiqueta = definicion.unidad ? `${definicion.etiqueta} (${definicion.unidad})` : definicion.etiqueta;
    const porDefecto = CONFIGURACION_POR_DEFECTO[nombre];
    return (
      <div key={nombre} className="space-y-2">
        <CampoTexto
          etiqueta={etiqueta}
          ayuda={ayudaDe(nombre)}
          error={formState.errors[nombre]?.message}
          autoComplete="off"
          {...(nombre === 'telefono' ? { type: 'tel', inputMode: 'tel' as const } : { inputMode: 'numeric' as const })}
          {...register(nombre, { onChange: () => alEditar(nombre) })}
        />
        <button
          type="button"
          onClick={() => {
            setValue(nombre, porDefecto === null ? '' : String(porDefecto), { shouldDirty: true });
            alEditar(nombre);
          }}
          className={ESTILO_BOTON.secundario}
        >
          Usar el valor por defecto <span className="sr-only">de {definicion.etiqueta}</span>
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(evento) => void enviar(evento)} noValidate className="space-y-4">
      {GRUPOS.map((grupo) => (
        <fieldset
          key={grupo.titulo}
          className="space-y-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6"
        >
          <legend className="sr-only">{grupo.titulo}</legend>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{grupo.titulo}</h2>
            <p className="text-sm text-slate-700">{grupo.descripcion}</p>
          </div>
          {grupo.campos.map(campo)}
        </fieldset>
      ))}

      <fieldset className="space-y-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6">
        <legend className="sr-only">Identidad</legend>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Identidad</h2>
          <p className="text-sm text-slate-700">Cómo se presenta tu academia dentro del sistema.</p>
        </div>
        <CampoTexto
          etiqueta="Nombre de la academia"
          value={usuario.academia.nombre}
          readOnly
          ayuda="El nombre no se cambia desde aquí."
        />
        {campo('telefono')}
      </fieldset>

      {guardado ? (
        <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200">
          Configuración guardada.
        </p>
      ) : null}
      {errorGeneral ? <Alerta>{mensajeGeneral(actualizar.error)}</Alerta> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="submit"
          disabled={!hayCambios || actualizar.isPending}
          className={`${ESTILO_BOTON.primario} w-full sm:w-auto`}
        >
          {actualizar.isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
