# Rondas adversariales: 008 · Carnet digital con QR

Registro de los ataques a la ruta crítica de esta historia (D-31). Lo leen el especificador y el adversarial; el resto
de los subagentes trabaja con `spec.md`. Como máximo 3 rondas por entrega. Las fallas críticas o altas se convierten
en criterios de `spec.md`; las medias o bajas quedan como deuda en las notas de la historia en `specs/backlog.md`.

## Entrega 008a · Ronda 1

- **Fecha:** 25/11/2026
- **Qué se atacó:** lo nuevo de la 008a, con el adversarial sin ver el razonamiento de quien lo implementó:
  - métodos y `HEAD` con variantes de ruta;
  - cabeceras (`no-store`, sin `ETag`);
  - búsqueda: comodines `%`, `_` y `\`, Unicode, inyección, DNI de 8 dígitos y rendimiento con 30 000 alumnos (de 13 a 69 ms);
  - regeneración: idempotencia, 12 peticiones simultáneas con la misma clave y 8 con claves distintas, y un cobro y una regeneración a la vez;
  - credenciales vencidas o alteradas, donde manda el rol de la base;
  - fechas de Lima con la zona horaria del servidor en Tokio, Kiritimati y Los Ángeles;
  - PDF con nombres hostiles, con los módulos del QR comparados contra el token: 0 diferencias;
  - fuga del token;
  - ciclo de estados y migración;
  - aislamiento.

| Falla | Gravedad | Qué pasó | Decisión |
| --- | --- | --- | --- |
| R1-1 | baja | Esperado: un cuerpo mal formado en una ruta del carnet responde 403 al rol cuya celda de `VER_CARNET` tiene otro alcance, como ya ocurre con un cuerpo bien formado. Obtenido: 400 o 413 para un `ALUMNO` en `POST /api/alumnos/buscar` y en `GET /api/alumnos/{id}/carnet[/pdf]` con cuerpo, y para la secretaria o el administrador en `GET /api/mi-carnet[/pdf]` con cuerpo. La causa es que `PermisosGuard` lanza el error de cuerpo guardado antes de `exigirAlcanceDelCarnet`, que está en el manejador de la ruta. No da acceso a nada. | deuda en el backlog («Deuda de la 008a», R1-1, en `specs/backlog.md`) |

- **Sin fallas en:** todo lo demás de la lista anterior. R1-1 solo cambia el código de error de un cuerpo mal formado: no da acceso a ningún dato.
- **Cierre:** el ataque de la 008a termina en 1 de 3 rondas, sin fallas críticas ni altas. No hace falta una segunda ronda. La web (criterios 19 y 20) no es de ruta crítica.

## Entrega 008b · Ronda 1

- **Fecha:** 25/11/2026
- **Qué se atacó:** la foto desde el panel y con la cámara, con el adversarial sin ver el razonamiento de quien la implementó:
  - carreras con 30 y 12 clientes mezclando foto del panel, foto pública, cancelación, comprobante, cobro, aprobación, rechazo y regeneración: 0 respuestas 500 y 0 `40P01`;
  - el orden de bloqueos en todos los caminos;
  - metadatos EXIF, GPS, XMP, ICC, IPTC, COM y PNG `tEXt`/`iTXt`, políglotos, tipos que mienten y bombas de píxeles;
  - 12 variantes de ruta y `?academiaId`;
  - permisos;
  - auditoría y registro técnico;
  - la cámara en la web.

| Falla | Gravedad | Qué pasó | Decisión |
| --- | --- | --- | --- |
| R1-1 | media | Un cuerpo troceado que nunca termina no recibe el 413 mientras el cliente sigue enviando, porque `express.raw` hace `dump` antes de `next(err)`. También pasa en la foto pública y en el comprobante, que no piden sesión; viene de la 005b. | Deuda en el backlog («Deuda de la 008b», R1-1, en `specs/backlog.md`); a resolver antes de producción (límite en el proxy o `requestTimeout`). |
| R1-2 | media | Los rechazos 401 y 403 (sin sesión, cambio de clave pendiente, academia suspendida) no cierran la conexión, y el servidor sigue recibiendo el cuerpo. | Deuda en el backlog («Deuda de la 008b», R1-2); a resolver antes de producción (límite en el proxy o `requestTimeout`). |
| R1-3 | baja | Con `Expect: 100-continue`, Node envía «100 Continue» antes del 401 o el 403. | Deuda en el backlog («Deuda de la 008b», R1-3). |
| R1-4 | baja | En la web, con StrictMode en desarrollo y los permisos resueltos en orden inverso, la cámara puede quedar encendida en `CapturaCamara.tsx`. | Deuda en el backlog («Deuda de la 008b», R1-4). |

- **Sin fallas en:** el resto de la lista anterior.
- **Cierre:** el ataque de la 008b termina en 1 de 3 rondas, sin fallas críticas ni altas. No hace falta una segunda ronda.

### Nota de la revisión (T23, 25/11/2026)

El revisor no encontró bloqueantes. Encontró un problema importante: en la extracción de la foto (`reemplazarFotoDelAlumno`), «ahora» se leía antes de los bloqueos. Se corrigió con la prueba protegida `4adeddd` (en rojo, `backend/test/integracion/carnet/foto-panel-ahora-tras-bloqueos.test.ts`) y el commit `8f9030a`: las tres rutas leen «ahora» después de los bloqueos, con `confirmar(tx)` (DT-16 de `specs/008-carnet-qr/spec.md`). Las pruebas afectadas pasan.
