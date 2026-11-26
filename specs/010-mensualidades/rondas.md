# Rondas adversariales: 010 · Mensualidades y renovación

Registro de los ataques a la ruta crítica de esta historia (D-31). Lo leen el especificador y el adversarial; el resto
de los subagentes trabaja con `spec.md`. Como máximo 3 rondas por entrega. Las fallas críticas o altas se convierten
en criterios de `spec.md`; las medias o bajas quedan como deuda en las notas de la historia en `specs/backlog.md`.

## Entrega 010a · Ronda 1

- **Fecha:** 26/11/2026
- **Qué se atacó:** la prioridad de renovación (D-06) con más titulares que lugares en el mes siguiente; el último cupo
  con muchas peticiones a la vez; la idempotencia simultánea; el número de operación; las fechas en America/Lima; la
  caja y los pagos; los correos; el aislamiento entre academias; la subida del comprobante.

| Falla | Gravedad | Qué pasó | Decisión |
| --- | --- | --- | --- |
| R1-1 | alta | Cuando una clase tiene en M+1 más titulares que lugares libres, ningún titular puede renovarla: todos reciben 409 `SIN_CUPO` hasta el día 1, cuando se liberan las reservas. Se esperaba que entraran los primeros titulares hasta llenar el aforo (criterio 9, DR-5, DT-4). | Criterio 44 de `spec.md`; se ajustan la definición de «Cupo libre» y DT-4 |

### R1-1 · Detalle

- **Causa.** `backend/src/modulos/mensualidades/dominio/cupo.ts` calcula `aforo − ocupación − reservas + (esTitular ?
  1 : 0)`, que es la definición «Cupo libre» de `spec.md` antes de esta ronda. Si `ocupación(M+1) + reservas > aforo`,
  el resultado es 0 o menos para todos los titulares, no solo para el último. La definición chocaba con el criterio 9
  («cada titular renueva c con 201, también el último»), con DR-5 («los últimos titulares en renovar pueden quedarse
  sin lugar»), con el caso límite «Titular que renueva en otras clases» y con DT-4 («un titular puede no encontrar
  lugar»).
- **Reproducciones (deterministas):**
  1. **Renovación tardía.** Clase de los sábados, aforo 20, 19 titulares. El 27/11 X, vencido y sin prioridad,
     renueva diciembre y toma el único lugar libre (20 − 0 − 19 = 1). Después Y, también vencido, hace la renovación
     tardía de noviembre en esa clase y pasa a ser titular: las reservas suben a 20. Los 20 titulares reciben
     `SIN_CUPO` y diciembre queda en 1 de 20.
  2. **Yape rechazado.** Aforo 20 con 20 titulares. T0 renueva diciembre por Yape en otras clases, X toma el lugar que
     T0 dejó y luego se rechaza el Yape de T0. Los otros 19 titulares reciben `SIN_CUPO`.
  3. **Aforo bajado (DR-5).** Aforo 30 con 30 titulares; el administrador lo baja a 20 antes de que nadie renueve. Los
     tres primeros titulares reciben `SIN_CUPO` y diciembre queda en 0.
- **Corrección decidida por el orquestador** (la intención de D-06, del criterio 9 y de DR-5): un titular de c toma c
  en M+1 si `aforo − ocupación(M+1) ≥ 1`, y entre titulares gana el primero que llega; quien no es titular sigue con
  `aforo − ocupación(M+1) − reservas ≥ 1`; el aforo nunca se supera. Sin sobrecupo, las dos fórmulas dan lo mismo
  para un titular.
- **Efecto en las pruebas protegidas existentes:** las del criterio 9 siguen valiendo con la regla nueva (sus casos de
  titular tienen lugar con las dos fórmulas o son de alumnos sin prioridad). La nota de cabecera de
  `renovacion-prioridad.test.ts` cita la fórmula original; es un comentario y no cambia lo que se comprueba.

- **Sin fallas en:**
  - estrés de 50 peticiones sobre una clase: noviembre en 20 de 20 y diciembre en 17 de 20, sin doble matrícula, sin
    5xx ni `40P01`;
  - idempotencia con peticiones simultáneas;
  - número de operación normalizado, con 6 variantes;
  - fechas en America/Lima con zonas horarias extremas en el proceso;
  - caja y pagos;
  - correos;
  - aislamiento entre academias;
  - subida del comprobante.
