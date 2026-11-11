import { respuestaSaludSchema } from '@aquagestion/contratos';
import { useQuery } from '@tanstack/react-query';
import { pedirJson } from '../../api/cliente';

export type EstadoSistema = 'comprobando' | 'en-linea' | 'sin-base' | 'sin-servidor';

/** Consulta `GET /api/salud` y la traduce a uno de los cuatro estados de la página de inicio. */
export function useSalud(): EstadoSistema {
  const consulta = useQuery({
    queryKey: ['salud'],
    queryFn: async (): Promise<Exclude<EstadoSistema, 'comprobando'>> => {
      const { estado, datos } = await pedirJson('/api/salud', respuestaSaludSchema, [200, 503]);
      if (estado === 200 && datos.estado === 'ok' && datos.baseDatos === 'ok') return 'en-linea';
      if (estado === 503 && datos.baseDatos === 'error') return 'sin-base';
      return 'sin-servidor';
    },
    // Sin reintentos automáticos: el estado mostrado es el de la primera respuesta.
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (consulta.isPending) return 'comprobando';
  if (consulta.isError) return 'sin-servidor';
  return consulta.data;
}
