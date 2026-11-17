import { type Clase, NIVELES } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUsuario } from '../sesion/contexto';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from './api';

/** Las claves llevan la identidad de la sesión: lo de otra academia o de otra persona nunca se reutiliza (criterios 28 de 003 y 29 de 004). */
export function useClavesClases() {
  const usuario = useUsuario();
  return {
    clases: ['clases', usuario.academia.nombreCorto, usuario.id] as const,
    entrenadores: ['entrenadores', usuario.academia.nombreCorto, usuario.id] as const,
  };
}

const POSICION_NIVEL = new Map<string, number>(NIVELES.map((nivel, posicion) => [nivel, posicion]));

/** El mismo orden que la API: día, hora de inicio, nivel (Básico, Intermedio, Avanzado) y, a igualdad, id (criterio 24). */
export function ordenarClases(clases: readonly Clase[]): Clase[] {
  return [...clases].sort(
    (a, b) =>
      a.diaSemana - b.diaSemana ||
      (a.horaInicio < b.horaInicio ? -1 : a.horaInicio > b.horaInicio ? 1 : 0) ||
      (POSICION_NIVEL.get(a.nivel) ?? 99) - (POSICION_NIVEL.get(b.nivel) ?? 99) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Las clases de la academia. Siempre se vuelve a pedir al entrar a la página; no se reintenta ni se pide al enfocar. */
export function useClases() {
  const claves = useClavesClases();
  return useQuery({
    queryKey: claves.clases,
    queryFn: api.listarClases,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/** Los entrenadores para elegir en el formulario (DT-4 de 004). */
export function useEntrenadores() {
  const claves = useClavesClases();
  return useQuery({
    queryKey: claves.entrenadores,
    queryFn: api.listarEntrenadores,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Crea o edita una clase. Antes confirma que la sesión sigue siendo la de la página (criterio 59 b de 002). `alGuardar` recibe la
 * respuesta antes de que se actualice la caché y no se espera ninguna otra consulta (criterios 27 y 31 de 003).
 */
function useGuardarClase<Entrada>(escribir: (entrada: Entrada) => Promise<Clase>, alGuardar?: (clase: Clase) => void) {
  const cliente = useQueryClient();
  const claves = useClavesClases();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    onMutate: () => cliente.cancelQueries({ queryKey: claves.clases }),
    mutationFn: async (entrada: Entrada) => {
      await confirmarSesion();
      return escribir(entrada);
    },
    onSuccess: async (clase) => {
      await cliente.cancelQueries({ queryKey: claves.clases });
      alGuardar?.(clase);
      cliente.setQueryData<Clase[]>(claves.clases, (lista) =>
        lista ? ordenarClases([...lista.filter((otra) => otra.id !== clase.id), clase]) : lista,
      );
    },
  });
}

export function useCrearClase(alGuardar?: (clase: Clase) => void) {
  return useGuardarClase(api.crearClase, alGuardar);
}

export function useActualizarClase(alGuardar?: (clase: Clase) => void) {
  return useGuardarClase(api.actualizarClase, alGuardar);
}
