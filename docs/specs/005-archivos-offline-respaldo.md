# 005 — Archivos privados, operación Android offline y recuperación

Estado: borrador en concreción. Riesgo alto. Fecha: 2026-10-21.

## Alcance autorizado

Foto de identificación y comprobantes JPG/PNG hasta 5 MB, acceso privado por ámbito/relación, sanitización de imagen y metadatos; sin galería de rendimiento. Cámara QR Android con permiso explícito. Respaldo PostgreSQL y restauración de prueba aislada; nunca restaurar sobre instalación existente automáticamente.

Un único dispositivo offline autorizado, mismo operador ya autenticado; cambio de usuario exige internet, sin credenciales locales nuevas ni caja compartida. SQLite cifrada en build nativo, clave aleatoria en SecureStore; snapshot/cola transaccionales, idempotencia, dependencias y reloj de spec 002. Expiración bloquea nuevas escrituras pero conserva cola y consulta. Sincronización debe subir/confirmar cola, descargar estado consistente y solo entonces renovar autorización; health y login no cuentan. Las operaciones con sobrecupo se conservan y señalan para resolver; otros conflictos se auditan completos sin aplicar, especialmente importe/método/caja/referencia de pagos rechazados. Reintentos no duplican efectos. Cierre local con conflictos no se considera cierre consolidado sin revisión administrativa de conciliación. No borrar evidencia móvil hasta confirmación durable.

## Archivos (subfuncionalidad lista para implementar)

API autenticada recibe base64 con límite de cuerpo equivalente a 5 MB, verifica PNG/JPEG y decodifica mediante sharp, limita píxeles a 20 millones, elimina metadatos y reescala. Guarda bytes saneados en PostgreSQL (incluidos en backup), sin archivos públicos/rutas suministradas por cliente. Solo personal de recepción/administración sube/verifica comprobantes; estudiante puede cargar para su propia inscripción con cuenta, solicitud nueva requiere carga asistida por secretaría hasta implementar token privado de solicitud. Foto asociada a alumno: staff/propio alumno/entrenador asignado; comprobante: staff/propio alumno. Referencias cruzadas rechazadas. Datos externos nunca se evalúan como HTML/SVG. Límite y tipo verificados antes/después de procesar. No se aceptan documentos falsamente etiquetados ni un UUID de archivo ajeno como prueba.

## Pendiente de concretar antes del código offline

Protocolo firmado de operaciones/snapshot, reconciliación de cobros y cierre con conflictos, ancla por arranque, tablas/migraciones SQLite y pruebas equivalentes de reglas. Este estado no habilita declarar offline comercial terminado.

## Respaldo implementado y verificado

Comandos explícitos backup:key/create/verify; clave propia en .env.backup, AES-256-GCM con IV aleatorio, pg_dump custom sin owner/ACL y pg_restore en BD de prueba recién creada. Nunca sobre instalación existente. Límite 512 MB; temporales privados validados/limpiados. Cifrado/integridad y restauración PostgreSQL real comprobados. Retención/automatización/destino externo dependen del hosting, no se consideran configurados. Cola local no enviada queda fuera del respaldo nube.
