# Verificación de acceso v0.2.0

Fecha: 2026-10-21. Alcance: spec 002; usuarios, permisos, sesiones, auditoría y autorización de un único Android offline. No constituye entrega de negocio ni despliegue cloud.

## Evidencia local

- Node 24.22.0 / npm 11.3.0; PostgreSQL real 17.5 temporal en loopback, sin usar instalaciones operativas.
- `npm run check`: lint, tipos API/web/móvil/scripts, 13 pruebas aprobadas sin omitidas, compilación API/Next y bundle Android Hermes (676 módulos).
- `npm run test:postgres`: 11 pruebas aprobadas sin omitidas, con esquemas/bases aleatorios propios. Migración repetida, bootstrap, hash/sesiones, permisos, tenant ajeno, contraseña temporal, bloqueo/expiración/revocación, protección concurrente del último administrador, conflictos auditados, firma/posesión/replay, expiración y exclusividad del equipo, demo protegida e idempotente.
- `npm run smoke`: API compilada + BD + web de producción y caída visible de API.
- `npm run smoke:access`: navegador Microsoft Edge headless real: login, alta de usuario y logout; BFF con cookie HttpOnly/Secure, token fuera de JS/localStorage y rechazo de origen CSRF. Recuperación por CLI probada, con revocación de sesión previa y auditoría.
- TDD observado: pruebas de hash/reemplazo y de evaluación offline fallaron inicialmente con implementaciones vacías/permisivas; luego pasaron con las reglas. Casos offline cubren firma alterada, ámbito ajeno, versión, permiso, límite exacto, ancla ajena, reinicio y alteración de reloj.
- Autolinking Expo detectó piscina-clock. Pruebas SQLite reales de diagnóstico se conservan.

Las pruebas usan `API_TEST_DATABASE_URL` explícita local con sufijo `_test`, sin fallback a conexión operativa. Fixtures se eliminan al terminar. No hay datos reales, claves privadas ni tokens en el repositorio.

## Revisión adversarial

Revisados aislamiento por sesión y FK compuestas; autorización duplicada tras adquirir bloqueo; dos administradores desactivándose; versión obsoleta; sustitución concurrente frente a emisión; prueba de posesión ligada a usuario/tenant/clave/propósito; auditoría sin secretos; clave pública fijada en móvil; origen web productivo explícito; restauración offline con reloj monotónico incluyendo suspensión. Las decisiones rechazadas quedan auditadas. La cola comercial aún no existe.

## Android nativo y límites

El workflow incluye compilación Kotlin del proyecto generado por Expo, separada del bundle JavaScript. Su resultado remoto se registra después de publicar. Este equipo no tiene SDK Android ni teléfono conectado: no se afirma instalación ni prueba física. SecureStore, suspensión, cierre/reapertura, reinicio y comportamiento de reloj deben verificarse en un build nativo sobre hardware antes del piloto; Expo Go no contiene el módulo propio.

La autorización firmada no permite revocación instantánea de un celular desconectado: vence en un máximo de 24 horas y la sustitución espera ese vencimiento. No hay cola durable, sincronización de alumnos/cobros, cámara ni datos operativos. RLS, cuenta de BD sin privilegios de migración, gestión productiva de claves, rate limit compartido entre réplicas, hosting y respaldo quedan como preparación del despliegue.
