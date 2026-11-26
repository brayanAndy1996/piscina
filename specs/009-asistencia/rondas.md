# Rondas adversariales: 009 · Asistencia y faltas

Registro de los ataques a la ruta crítica de esta historia (D-31). Lo leen el especificador y el adversarial; el resto
de los subagentes trabaja con `spec.md`. Como máximo 3 rondas por entrega. Las fallas críticas o altas se convierten
en criterios de `spec.md`; las medias o bajas quedan como deuda en las notas de la historia en `specs/backlog.md`.

## Entrega 009a · Ronda 1

- **Fecha:** 26/11/2026
- **Qué se atacó:** lo nuevo de la 009a (el marcado por QR y manual), con el adversarial sin ver el razonamiento de quien
  lo implementó:
  - la ventana y las fechas de Lima con el servidor en UTC, en Kiritimati (UTC+14) y en UTC−12: el borde de las 19:00
    del 29/11, el fin de año y el borde de `creado_en` (DT-14);
  - 30 marcados simultáneos sobre la última clase: una sola asistencia;
  - estrés con cobros y regeneraciones de QR a la vez: ninguna respuesta 5xx ni `40P01`;
  - más de 20 variantes de QR inválido o regenerado: todas responden 404 igual;
  - métodos HTTP y tipos de contenido;
  - orden de bloqueos, permisos, aislamiento y fugas en la respuesta.

| Falla | Gravedad | Qué pasó | Decisión |
| --- | --- | --- | --- |
| R1-1 | media | Si la clave la usó un registro posterior del mismo alumno, el marcado responde 200 en lugar de 409 `CLAVE_YA_USADA` (criterio 13). | Deuda en el backlog («Para la 009b», R1-1, en `specs/backlog.md`): se corrige en la 009b con su prueba protegida. |
| R1-2 | media | El `INSERT` espera `FOR KEY SHARE` sobre la clase después de leer «ahora». Si la espera cruza el fin de la clase, se registra con la hora de antes (criterio 14 y DT-16). | Deuda en el backlog («Para la 009b», R1-2): se corrige en la 009b con su prueba protegida. |
| R1-3 | baja | El 200 repetido recalcula las clases en lugar de repetir el cuerpo del 201. | Deuda en el backlog («Deuda de la 009a», R1-3). |

- **Sin fallas en:** el resto de lo que se atacó.
- **Cierre:** el ataque de la 009a termina en 1 de 3 rondas, sin fallas críticas ni altas. No hace falta una segunda
  ronda. R1-1 y R1-2 afectan a los criterios 13 y 14, que son críticos: se corrigen en la 009b, como decidió el
  orquestador el 26/11/2026.
- **Paso a la 009b (26/11/2026):** Bryan decidió corregir R1-1 y R1-2 en la 009b, cada una con su prueba protegida.
  Pasan a ser criterios _(críticos)_ de la 009b en `spec.md`:
  - **R1-1 → criterio 36.** El 200 repetido exige el mismo alumno y el mismo tipo de registro (marcado o posterior);
    en los dos sentidos responde 409 `CLAVE_YA_USADA`. Se ajusta la referencia del criterio 13.
  - **R1-2 → criterio 37.** El marcado (y el posterior) toma las clases de la matrícula con `FOR KEY SHARE` antes de
    leer «ahora», en el orden actor → alumno → matrícula → clase; una espera que cruza el fin responde 409
    `FUERA_DE_HORARIO` sin escribir. Se ajustan el criterio 14 (ya no dice «no bloquea `clases`»), el 28 (orden de
    bloqueos del posterior), la DT-16 y `plan.md`; se propone la DT-22.
