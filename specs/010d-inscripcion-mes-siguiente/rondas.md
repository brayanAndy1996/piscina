# Rondas adversariales: 010d · Inscripción pública al mes siguiente

Registro de los ataques a la ruta crítica de esta entrega (D-31). Lo leen el especificador y el adversarial; el resto de
los subagentes trabaja con `spec.md`. Como máximo 3 rondas. Las fallas críticas o altas se convierten en criterios de
`spec.md`; las medias o bajas quedan como deuda en las notas de la historia 010 en `specs/backlog.md`.

## Entrega 010d · Ronda 1

- **Fecha:** 28/11/2026
- **Qué se atacó:** lo nuevo de la 010d en la ruta crítica (criterios 1 a 15): los meses y el formulario con `?mes=`, la
  cotización y el envío para M+1 con sus bordes en America/Lima, el último lugar con envíos simultáneos, las reservas de
  prioridad, el pago, el rechazo y el nuevo comprobante, el cierre de mes, el aislamiento entre academias y los límites
  públicos.
- **Resultado:** ninguna falla, de ninguna severidad (crítica, alta, media o baja). No hubo criterios nuevos ni deuda de
  la ronda.
- **Sin fallas en:**
  - bordes de la ventana con el proceso en UTC, Asia/Tokyo, Pacific/Kiritimati y Pacific/Pago_Pago;
  - último lugar de M+1 entre un nuevo comprobante tras un rechazo, el envío público, la renovación de un titular y el
    efectivo;
  - reservas de prioridad y aforo rebajado;
  - reservas que cruzan el día 1 y el fin de año;
  - `estadoVisible` y `estadoVisibleSql`;
  - cierre de mes;
  - relación con la 010a y la 010c;
  - entradas mal formadas y aislamiento entre academias;
  - montos con `Decimal`.

## Cierre de la 010d

- **Fecha:** 28/11/2026. El ataque se cerró en 1 de 3 rondas, sin fallas de ninguna severidad, así que no hubo rondas
  adicionales ni criterios nuevos.
- **Revisión.** El revisor no encontró fallas importantes. Seis menores se corrigieron en la limpieza de la revisión: en
  `dfe93bc` (backend), `vencimientoDeReserva` delega en `vencimientoDeReservaDelMes`, y el servicio de inscripciones usa
  `mesEnCurso`, un helper para la fecha de vigencia del plan y `exigirMesDeInscripcion`; en `b081d2f` (web), `MES_CAMBIO`
  invalida también la consulta de la oferta (con prueba), hay un solo `capitalizar` exportado desde `lib/fechas.ts` y la
  cotización simulada del bloque de dos meses empieza el 27/11, como `hoy`.
- **Ajustes a pruebas protegidas.** `75e131a`, después de la implementación del backend (`700a840`), corrigió tres pruebas
  protegidas (límite por conexión, caja del día y registro técnico) en cuatro archivos, y una carrera de la prueba del
  cambio de horario. El registro técnico pasó a `mes-siguiente-registro-tecnico.test.ts` con las mismas aserciones.
- **Suite completa:** 19 223 pasan, 0 fallan y 95 se saltan (las que dependen de privilegios de la base o de la
  plataforma; la integración continua las corre). E2E, 6 de 6.
- **Lint, tipos y build:** en verde.
- **Commits.** Pruebas en rojo `ecf26b8`; marca de la historia 010 (DT-15) `be99194`; pruebas corregidas `75e131a`;
  contratos `c82838a`; backend `700a840`; web `c8c76db`; limpieza de la revisión `dfe93bc` y `b081d2f`.
