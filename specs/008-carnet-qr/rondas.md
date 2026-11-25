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
