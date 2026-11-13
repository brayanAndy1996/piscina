/**
 * Límite del inicio de sesión de la plataforma: 10 peticiones por IP cada 60 segundos (DR-3, P-5). Lo aplica un
 * middleware de Express que corre antes del lector del cuerpo (criterio 75), con el almacenamiento de
 * `@nestjs/throttler`.
 */
export const LIMITE_INICIO_SESION = { name: 'sesion', ttl: 60_000, limit: 10 };
