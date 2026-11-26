import { type AlumnoEncontrado, NOMBRE_NIVEL, registrarAsistenciaQrSchema } from '@aquagestion/contratos';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alerta, Aviso, ESTILO_BOTON } from '../../componentes/ui';
import { nuevaClaveUuid } from '../../lib/uuid';
import { BuscadorDeAlumnos } from '../alumnos/BuscadorDeAlumnos';
import { useAlPerderSesion } from '../sesion/hooks';
import { RequierePermiso } from '../sesion/RequierePermiso';
import type { IntentoDeMarcado } from './api';
import { CampoLectora, type ControlDeLectora } from './CampoLectora';
import { useMarcarAsistencia, type RespuestaDeMarcado } from './hooks';
import { LectorCamara } from './LectorCamara';
import { esMarcadoReintentable, mensajeDeMarcado } from './mensajes';
import { ResultadoAsistencia } from './ResultadoAsistencia';

/** El mismo contenido leído otra vez dentro de esta ventana se ignora: la cámara decodifica el mismo QR varias veces seguidas (DT-12). */
export const VENTANA_ANTIRREBOTE_MS = 5000;

const MENSAJE_QR_INVALIDO = 'El QR no corresponde a ningún alumno de esta academia.';

type Modo = 'ESCANEAR' | 'BUSCAR';
type OrigenDeLectura = 'LECTORA' | 'CAMARA';
interface Falla {
  mensaje: string;
  reintentable: boolean;
}

/**
 * `/panel/asistencia`: recepción marca la asistencia leyendo el QR del carnet (lectora USB o cámara) o buscando al alumno (HU-14, HU-15,
 * criterio 19 de 009a). Solo con `REGISTRAR_ASISTENCIA`. La API decide si puede ingresar; aquí solo se muestra el color y los textos.
 */
export function PaginaAsistencia() {
  return (
    <RequierePermiso permiso="REGISTRAR_ASISTENCIA">
      <ContenidoAsistencia />
    </RequierePermiso>
  );
}

function ContenidoAsistencia() {
  const [modo, setModo] = useState<Modo>('ESCANEAR');
  const [camaraEncendida, setCamaraEncendida] = useState(false);
  const [respuesta, setRespuesta] = useState<RespuestaDeMarcado | null>(null);
  const [falla, setFalla] = useState<Falla | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const marcar = useMarcarAsistencia();
  useAlPerderSesion(marcar.error);

  const lectora = useRef<ControlDeLectora>(null);
  const zonaDelResultado = useRef<HTMLDivElement>(null);
  // La última lectura aceptada, para el antirrebote; y el último intento enviado, para reintentarlo con la misma clave.
  const ultimaLectura = useRef<{ contenido: string; en: number } | null>(null);
  const ultimoIntento = useRef<IntentoDeMarcado | null>(null);
  const enCurso = useRef(false);

  const enviar = (intento: IntentoDeMarcado) => {
    enCurso.current = true;
    ultimoIntento.current = intento;
    setAviso(null);
    marcar.mutate(intento, {
      onSuccess: (salida) => {
        setFalla(null);
        setRespuesta(salida);
      },
      onError: (error) => {
        setRespuesta(null);
        setFalla({ mensaje: mensajeDeMarcado(error), reintentable: esMarcadoReintentable(error) });
      },
      onSettled: () => {
        enCurso.current = false;
      },
    });
  };

  /** Devuelve `false` solo si no se pudo atender porque hay otra lectura en curso. */
  const leerQr = (contenido: string, origen: OrigenDeLectura): boolean => {
    const ahora = Date.now();
    const previa = ultimaLectura.current;
    if (previa && previa.contenido === contenido && ahora - previa.en < VENTANA_ANTIRREBOTE_MS) {
      if (origen === 'LECTORA') setAviso('Ese QR se acaba de leer. Espera unos segundos para leerlo otra vez.');
      return true;
    }
    if (enCurso.current) return false;
    const intento = registrarAsistenciaQrSchema.safeParse({ contenido, claveIdempotencia: nuevaClaveUuid() });
    ultimaLectura.current = { contenido, en: ahora };
    if (!intento.success) {
      setRespuesta(null);
      setFalla({ mensaje: MENSAJE_QR_INVALIDO, reintentable: false });
      return true;
    }
    enviar({ via: 'QR', contenido: intento.data.contenido, claveIdempotencia: intento.data.claveIdempotencia });
    return true;
  };

  const registrarManual = (alumno: AlumnoEncontrado) => {
    if (enCurso.current) return;
    enviar({ via: 'MANUAL', alumnoId: alumno.id, claveIdempotencia: nuevaClaveUuid() });
  };

  const reintentar = () => {
    if (enCurso.current || !ultimoIntento.current) return;
    enviar(ultimoIntento.current);
  };

  const cambiarModo = (nuevo: Modo) => {
    setModo(nuevo);
    setCamaraEncendida(false);
  };

  // La lectora vuelve a tener el foco al entrar al modo y después de cada lectura, salvo que la persona esté en otro control.
  const pendiente = marcar.isPending;
  useEffect(() => {
    if (modo !== 'ESCANEAR' || pendiente) return;
    const activo = document.activeElement;
    if (!activo || activo === document.body) lectora.current?.enfocar();
  }, [modo, pendiente, respuesta, falla]);

  useEffect(() => {
    if (respuesta || falla) zonaDelResultado.current?.scrollIntoView?.({ block: 'nearest' });
  }, [respuesta, falla]);

  // El resultado va debajo de la lectora y la cámara (el campo no se mueve en cada lectura) y encima de la búsqueda (sin tener que bajar).
  const zonaResultado = (
    <div ref={zonaDelResultado} aria-live="polite" className="space-y-3">
      {pendiente ? (
        <p role="status" className="rounded-lg bg-sky-50 px-3 py-2 text-sky-900 ring-1 ring-sky-100">
          Registrando asistencia…
        </p>
      ) : null}
      {aviso ? <Aviso>{aviso}</Aviso> : null}
      {falla ? (
        <div className="space-y-2">
          <Alerta>{falla.mensaje}</Alerta>
          {falla.reintentable ? (
            <button type="button" onClick={reintentar} disabled={pendiente} className={ESTILO_BOTON.secundario}>
              Reintentar
            </button>
          ) : null}
        </div>
      ) : null}
      {respuesta ? <ResultadoAsistencia respuesta={respuesta} /> : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <Link to="/panel" className="inline-block text-sky-800 underline">
        ← Volver al inicio
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Asistencia</h1>
      <p className="text-slate-700">
        Escanea el QR del carnet o busca al alumno por su DNI o nombre. Cada asistencia descuenta una clase de su
        mensualidad.
      </p>

      <div role="group" aria-label="Cómo marcar" className="flex gap-2">
        <button
          type="button"
          aria-pressed={modo === 'ESCANEAR'}
          onClick={() => cambiarModo('ESCANEAR')}
          className={modo === 'ESCANEAR' ? ESTILO_BOTON.primario : ESTILO_BOTON.secundario}
        >
          Escanear
        </button>
        <button
          type="button"
          aria-pressed={modo === 'BUSCAR'}
          onClick={() => cambiarModo('BUSCAR')}
          className={modo === 'BUSCAR' ? ESTILO_BOTON.primario : ESTILO_BOTON.secundario}
        >
          Buscar alumno
        </button>
      </div>

      {modo === 'ESCANEAR' ? (
        <>
          <section aria-label="Escanear el QR" className="space-y-4">
            <CampoLectora control={lectora} alLeer={(contenido) => leerQr(contenido, 'LECTORA')} />
            <div className="space-y-3">
              <button
                type="button"
                aria-pressed={camaraEncendida}
                onClick={() => setCamaraEncendida((encendida) => !encendida)}
                className={ESTILO_BOTON.secundario}
              >
                {camaraEncendida ? 'Apagar la cámara' : 'Usar la cámara'}
              </button>
              {camaraEncendida ? <LectorCamara alLeer={(contenido) => void leerQr(contenido, 'CAMARA')} /> : null}
            </div>
          </section>
          {zonaResultado}
        </>
      ) : (
        <>
          {zonaResultado}
          <section aria-label="Buscar alumno" className="space-y-4">
            <BuscadorDeAlumnos
              renderAlumno={(alumno) => (
                <TarjetaParaMarcar alumno={alumno} deshabilitado={pendiente} alMarcar={() => registrarManual(alumno)} />
              )}
            />
          </section>
        </>
      )}
    </div>
  );
}

function TarjetaParaMarcar({
  alumno,
  deshabilitado,
  alMarcar,
}: {
  alumno: AlumnoEncontrado;
  deshabilitado: boolean;
  alMarcar: () => void;
}) {
  const nombre = `${alumno.apellidos}, ${alumno.nombres}`;
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0">
        <span className="block break-words text-lg font-semibold text-sky-900">{nombre}</span>
        <span className="block text-slate-700">
          DNI <span className="font-mono">{alumno.dni}</span> · Nivel {NOMBRE_NIVEL[alumno.nivel]}
        </span>
      </span>
      <button
        type="button"
        disabled={deshabilitado}
        onClick={alMarcar}
        aria-label={`Registrar asistencia de ${alumno.nombres} ${alumno.apellidos}`}
        className={ESTILO_BOTON.primario}
      >
        Registrar asistencia
      </button>
    </div>
  );
}
