# 008 · Tareas

Cada tarea indica su rol y los criterios de aceptación que cubre. Las de la 008b llevan **[008b]** y empiezan con la
008a unida a `main`. Mientras se trabaja se ejecutan solo las pruebas de lo tocado; la suite completa, una vez por
entrega, en la revisión (D-31).

## 008a · Carnet y QR

- [x] T0 · orquestador · Aprobación de Bryan (P1 a P5, que son DR-1 a DR-5, 25/11/2026) y aceptación de DT-1 a DT-13;
      spec ajustado con lo decidido.
- [ ] T1 · test-writer · Pruebas protegidas en rojo de los criterios críticos de la 008a, desde el spec y los contratos
      públicos (`carnet.ts`, rutas, columnas): modelo e invariantes como app y como dueño (1); token al confirmar en
      efectivo y en la aprobación, reversión y reintentos (2); forma, azar y funciones del contenido (3); permisos,
      alcance y 404 de todas las rutas (4 a 6); claves exactas del JSON con un menor (7); foto y foto de otra academia
      (9); cabeceras, permisos y aislamiento del PDF (11); el mismo contenido en el generador y en el JSON (12);
      regeneración, idempotencia y errores, con espera comprobada en `pg_locks` para las dos claves iguales (13 a 15);
      búsqueda y aislamiento (16); el token fuera de auditoría, registro y direcciones, y la RLS por token (17).
      Commit «Pruebas protegidas (008): 008a, … (en rojo)». (criterios 1 a 7, 9, 11 a 17)
- [ ] T2 · tester · Confirmar que las pruebas de T1 fallan por la razón esperada (rutas, columnas o esquemas que faltan).
- [ ] T3 · backend · Contratos: `packages/contratos/src/carnet.ts` (`PREFIJO_QR`, `PATRON_TOKEN_QR`, `contenidoQr`,
      `tokenDelContenidoQr`, `OPCIONES_QR`, `carnetSchema`, `regenerarQrSchema`, `buscarAlumnosSchema`,
      `resultadoBusquedaAlumnosSchema`, `resumenDeHorario`) y su reexportación. (criterios 3, 7, 13, 16)
- [ ] T4 · backend · Migración `<marca>_carnet_qr` con el relleno por academia, `schema.prisma`, `PRIVILEGIOS_APP` y
      `scripts/lib/rol-app.mjs`. (criterio 1)
- [ ] T5 · backend · `nuevoTokenQr` y el paso 5 de `confirmarPagoEnTransaccion`; ejecutar también las pruebas protegidas
      de la 007 (`backend/test/integracion/pagos/`). (criterios 2 y 3)
- [ ] T6 · backend · Módulo `alumnos/`: alcance de `VER_CARNET`, `CarnetService.leer` (matrícula del carnet, foto fuera
      de la transacción), `GET /api/alumnos/{id}/carnet` y `GET /api/mi-carnet`. (criterios 4 a 10)
- [ ] T7 · backend · Dependencia `qrcode` (y `@types/qrcode`) en `backend/package.json` y en
      `DEPENDENCIAS_BACKEND_PERMITIDAS`; `generarPdfCarnet` con `GENERADOR_PDF_CARNET` y las dos rutas del PDF; prueba
      unitaria del generador. (criterios 11 y 12)
- [ ] T8 · backend · Regeneración (`POST /api/alumnos/{id}/carnet/qr`) con idempotencia y auditoría. (criterios 13 a 15)
- [ ] T9 · backend · Búsqueda (`POST /api/alumnos/buscar`). (criterio 16)
- [ ] T10 · backend · `PREFIJOS_SIN_HEAD` con `/alumnos` y `/mi-carnet`, y su prueba. (criterio 18)
- [ ] T11 · frontend · `qrcode` en la web; `VistaCarnet`, `QrDelCarnet`, `PaginaMiCarnet` y la descarga del PDF;
      opciones del inicio por alcance. (criterios 19 y 20)
- [ ] T12 · frontend · `/panel/alumnos` (búsqueda), `/panel/alumnos/{id}` (carnet, PDF) y `DialogoRegenerarQr`, con
      pruebas de componentes. (criterio 19)
- [ ] T13 · adversarial · Ataque de la 008a (hasta 3 rondas, D-31): token adivinable o reutilizado tras regenerar,
      carnet o PDF de otra academia o de otro alumno, alcance de `VER_CARNET`, búsqueda con comodines, CLIENTE con QR,
      19:00 de Lima y fin de mes en la vigencia. Las fallas críticas o altas vuelven al especificador (`rondas.md`).
- [ ] T14 · revisor y tester (a la vez) · Revisión contra el spec y las convenciones; suite completa, lint y tipos.
      Antes, el orquestador revisa con `git diff` que la implementación no tocó las pruebas protegidas. (todos los de la
      008a; el 21 lo verifica el revisor)
- [ ] T15 · documentador · `docs/arquitectura.md` («Lo que construye la historia 008a»), guía de Windows, nota de la 008
      en `specs/backlog.md`, tareas marcadas y último commit. (criterio 21)

## 008b · Foto desde el panel y cámara

- [ ] T16 · test-writer · **[008b]** Pruebas protegidas en rojo: las dos rutas con sus 204, 404 y 409 (22 y 23); el
      orden de las comprobaciones, con 401 y 403 sin leer el cuerpo y las rutas fuera de `LIMITES_PUBLICOS` (24); la
      foto guardada sin metadatos, la clave, la transacción, el borrado después de confirmar, los rechazos y la
      confirmación incierta con un almacén de prueba (25); las cuatro carreras deterministas con `pg_locks` (26).
      Commit «Pruebas protegidas (008): 008b, … (en rojo)». (criterios 22 a 26)
- [ ] T17 · tester · **[008b]** Confirmar que las pruebas de T16 fallan por la razón esperada.
- [ ] T18 · backend · **[008b]** Extraer `reemplazarFotoDelAlumno` de `FotoService` sin cambiar lo observable; ejecutar
      las pruebas protegidas de la 005b (foto) antes del commit. (criterio 25)
- [ ] T19 · backend · **[008b]** Lector binario en las rutas del panel (después de la sesión y del permiso) y
      `esSubidaDeImagen`; prueba de que el lector JSON no las toca. (criterio 24)
- [ ] T20 · backend · **[008b]** `PUT /api/alumnos/{id}/foto` y `PUT /api/solicitudes/{id}/foto`, con sus comprobaciones
      previas, la transacción de escritura y la auditoría `ALUMNO_FOTO_ACTUALIZADA`. (criterios 22, 23, 25 a 27)
- [ ] T21 · frontend · **[008b]** `CapturaCamara` y `DialogoFoto` (archivo o cámara), en el carnet del panel y en las
      tarjetas de solicitudes, con pruebas de componentes con la cámara simulada (permiso negado, sin cámara, apagado al
      cerrar). (criterio 28)
- [ ] T22 · adversarial · **[008b]** Ataque: foto a un alumno o una solicitud de otra academia, entrenador o alumno que
      suben, cuerpo enorme sin permiso, metadatos que sobreviven, archivo referenciado que no existe, carreras con la
      subida pública, la cancelación y la confirmación del pago.
- [ ] T23 · revisor y tester (a la vez) · **[008b]** Revisión y suite completa, lint y tipos.
- [ ] T24 · documentador · **[008b]** `docs/arquitectura.md` («Lo que construye la historia 008b» y la nota «Foto desde
      recepción» de la 005b), guía de Windows (la cámara con `localhost` o HTTPS), backlog y último commit. (criterio 29)

## Solo ruta crítica

- [ ] 008a: pruebas escritas por test-writer y confirmadas en rojo
- [ ] 008a: pruebas en verde tras la implementación
- [ ] 008a: ataque adversarial sin fallas críticas ni altas abiertas
- [ ] 008b: pruebas escritas por test-writer y confirmadas en rojo
- [ ] 008b: pruebas en verde tras la implementación
- [ ] 008b: ataque adversarial sin fallas críticas ni altas abiertas
