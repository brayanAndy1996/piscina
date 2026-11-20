/**
 * Límite del inicio de sesión de la plataforma: 10 peticiones por IP cada 60 segundos (DR-3, P-5). Lo aplica un
 * middleware de Express que corre antes del lector del cuerpo (criterio 75), con el almacenamiento de
 * `@nestjs/throttler`.
 */
export const LIMITE_INICIO_SESION = { name: 'sesion', ttl: 60_000, limit: 10 };

/**
 * Límites por IP de las rutas públicas de `/api/a` (spec 005, criterio 33; DT-7 de 005). Cada regla tiene su contador (`nombre`), que
 * suma todas las academias y cuenta cada petición, sea cual sea su resultado, antes de leer el cuerpo y de buscar la academia. Los
 * patrones son sobre la ruta relativa a `/api/a` (`/delfines/inscripcion`) y no distinguen mayúsculas ni barra final, como el
 * enrutador de Express. El del ingreso (`LIMITE_INICIO_SESION`) no cambia. El límite de la foto (10 por hora) llega con su ruta en la
 * 005b.
 */
export interface LimitePublico {
  readonly nombre: string;
  readonly metodo: 'GET' | 'POST';
  readonly patron: RegExp;
  /** Ventana en milisegundos. */
  readonly ttl: number;
  readonly limite: number;
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

export const LIMITES_PUBLICOS: readonly LimitePublico[] = Object.freeze([
  // `GET /api/a/{nombreCorto}` y `GET /api/a/{nombreCorto}/inscripcion` comparten el mismo contador.
  { nombre: 'lectura', metodo: 'GET', patron: /^\/[^/]+\/?$/i, ttl: MINUTO, limite: 60 },
  { nombre: 'lectura', metodo: 'GET', patron: /^\/[^/]+\/inscripcion\/?$/i, ttl: MINUTO, limite: 60 },
  { nombre: 'cotizacion', metodo: 'POST', patron: /^\/[^/]+\/inscripcion\/cotizacion\/?$/i, ttl: MINUTO, limite: 30 },
  { nombre: 'envio', metodo: 'POST', patron: /^\/[^/]+\/inscripcion\/?$/i, ttl: HORA, limite: 10 },
  { nombre: 'consulta', metodo: 'POST', patron: /^\/[^/]+\/solicitudes\/consulta\/?$/i, ttl: MINUTO, limite: 10 },
]);
