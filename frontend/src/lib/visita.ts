import { useState } from 'react';
import { nuevaClaveUuid } from './uuid';

/**
 * Un identificador distinto en cada visita a una página (cada vez que se monta). Va en la clave de las consultas públicas para que la
 * respuesta de una visita anterior nunca se muestre en la siguiente: cupos, precios, teléfono y estado de una solicitud se piden de nuevo
 * al entrar (criterio 45 de 005, DR-4 de 003), sin esperar a que TanStack Query descarte la caché.
 */
export function useIdDeVisita(): string {
  const [id] = useState(nuevaClaveUuid);
  return id;
}
