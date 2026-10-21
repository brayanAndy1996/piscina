# Instrucciones de academia_natacion

Leer README, `docs/04-metodo-desarrollo.md` y documentos propios. El repositorio público debe poder utilizarse sin referencias del panel ni del CORE histórico. En el espacio interno, si existe documentación global/snapshots, sigue siendo referencia local; no publicarla ni editar sus copias.

Las decisiones específicas vigentes están en `docs/01-acuerdos-entregas.md`, `docs/02-operacion-sincronizacion.md` y `docs/decisiones/001-stack.md`. No reintroducir PC principal, Electron, CORE, pagos parciales, IGV añadido al precio, mensajería externa ni SUNAT en una fase intermedia.

Producto Android React Native y web Next.js con backend Node.js/Sequelize. Solo un celular designado concentra toda la operación offline, hasta 24 horas desde su última sincronización exitosa; los demás requieren conexión para registrar operaciones. No reintroducir varios dispositivos operando offline ni regularización por separación entre celular de inscripción y de asistencia durante el corte. Escribir specs antes del código, TDD para dinero/acceso/sincronización y revisión adversarial según riesgo. Mantener la política de roles/modelos de la metodología; no afirmar cambios de modelo no realizados. Priorizar backend y UI mínima.

No editar snapshots. Al cambiar fuentes incluidas como referencia, sincronizar desde el espacio raíz y ejecutar `-Check`. No copiar implementación de otros productos ni crear paquetes CORE. No declarar funcionalidad implementada por documentarla.

Repositorio oficial autorizado: `https://github.com/brayanAndy1996/piscina`. Publicar allí los cambios de este producto terminados y verificados, excluyendo referencias internas de `docs/contexto/`, sin secretos, bases locales, dependencias instaladas ni artefactos temporales. Conservar cambios ajenos; no usar force push. El proyecto debe poder descargarse y leerse sin carpetas hermanas. No publicar en este repositorio cambios fuente propios del panel u otros productos.
