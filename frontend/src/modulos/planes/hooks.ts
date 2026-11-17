import type { Plan } from '@aquagestion/contratos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUsuario } from '../sesion/contexto';
import { useConfirmarSesion } from '../sesion/hooks';
import * as api from './api';

/** La clave lleva la identidad de la sesión: la lista de otra academia o de otra persona nunca se reutiliza (criterios 28 de 003 y 29 de 004). */
export function useClavePlanes() {
  const usuario = useUsuario();
  return ['planes', usuario.academia.nombreCorto, usuario.id] as const;
}

const ORDEN_NOMBRES = new Intl.Collator('es');

/** El mismo orden que la API: por nombre en español y, a igual nombre, por id (criterio 15). */
export function ordenarPlanes(planes: readonly Plan[]): Plan[] {
  return [...planes].sort(
    (a, b) => ORDEN_NOMBRES.compare(a.nombre, b.nombre) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Los planes de la academia. Siempre se vuelve a pedir al entrar a la página (criterio 27 de 003); no se reintenta ni se pide al enfocar. */
export function usePlanes() {
  const clave = useClavePlanes();
  return useQuery({
    queryKey: clave,
    queryFn: api.listarPlanes,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/**
 * Crea o edita un plan. Antes confirma que la sesión sigue siendo la de la página (criterio 59 b de 002). `alGuardar` recibe la
 * respuesta antes de que se actualice la caché: así el formulario fija su base de llenado primero (criterio 27 e de 003). No espera
 * ninguna otra consulta: el formulario se desbloquea apenas responde la escritura (criterio 31 de 003).
 */
export function useGuardarPlan<Entrada>(
  escribir: (entrada: Entrada) => Promise<Plan>,
  alGuardar?: (plan: Plan) => void,
) {
  const cliente = useQueryClient();
  const clave = useClavePlanes();
  const confirmarSesion = useConfirmarSesion();
  return useMutation({
    // Una lista pedida antes de guardar trae valores viejos: no debe llegar a la caché (criterio 29 de 003).
    onMutate: () => cliente.cancelQueries({ queryKey: clave }),
    mutationFn: async (entrada: Entrada) => {
      await confirmarSesion();
      return escribir(entrada);
    },
    onSuccess: async (plan) => {
      // También la que empezó mientras la escritura estaba en curso.
      await cliente.cancelQueries({ queryKey: clave });
      alGuardar?.(plan);
      cliente.setQueryData<Plan[]>(clave, (lista) =>
        lista ? ordenarPlanes([...lista.filter((otro) => otro.id !== plan.id), plan]) : lista,
      );
    },
  });
}

export function useCrearPlan(alGuardar?: (plan: Plan) => void) {
  return useGuardarPlan(api.crearPlan, alGuardar);
}

export function useActualizarPlan(alGuardar?: (plan: Plan) => void) {
  return useGuardarPlan(api.actualizarPlan, alGuardar);
}
