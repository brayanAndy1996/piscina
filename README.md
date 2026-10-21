# Academia de natación

Actualizado: 2026-10-21. Estado: planificación y documentación; sin aplicación, API, migraciones ni comandos ejecutables.

Producto independiente, construido desde cero, sin CORE. Web Next.js y aplicación Android React Native desarrolladas independientemente, con backend Node.js/Sequelize y PostgreSQL en nube; SQLite y cola persistente en un único celular designado para realizar toda la operación offline. Los demás celulares operan online; no registran cambios sin conexión. No requiere PC principal ni Electron.

## Repositorio y entrega

Repositorio oficial: [brayanAndy1996/piscina](https://github.com/brayanAndy1996/piscina). Web, backend y Android pertenecen a este mismo producto, con componentes independientes. Los cambios terminados y verificados se publican allí; el fundador podrá clonarlos o descargarlos manualmente en otra carpeta. No depender de rutas hermanas de este espacio de trabajo.

La descarga incluye la documentación propia y las instrucciones de desarrollo de la academia. Las referencias internas de otros productos que existen en el espacio local no se publican en este repositorio público. Al existir código, documentar instalación, configuración sin secretos, migraciones, demo opcional y ejecución desde una carpeta limpia. Descargar el repositorio no equivale a instalar una aplicación Android ni desplegar el backend.

## Documentación propia

- [Acuerdos y primera entrega](docs/01-acuerdos-entregas.md).
- [Operación offline y sincronización](docs/02-operacion-sincronizacion.md).
- [Decisión de stack](docs/decisiones/001-stack.md).
- [Documento funcional detallado](docs/03-documentacion-funcional.md). Conserva historias y módulos posteriores; la primera entrega se delimita en el documento de acuerdos.

## Método de trabajo y contexto

Leer [instrucciones de desarrollo del producto](docs/04-metodo-desarrollo.md). Los acuerdos de academia precisan nube/Android, mensualidad calendario, proporcional y pagos completos.

En el espacio interno puede existir `docs/contexto/`, generado desde documentación transversal y referencias de otros productos. No editarlo ni publicarlo en este repositorio público; está excluido de Git. La academia se documenta de forma autónoma mediante los archivos propios anteriores. La sincronización interna se ejecuta desde su espacio fuente con `herramientas/Sincronizar-Contexto.ps1` y después `-Check`.

## Próximo trabajo

Comenzar por la spec de base ejecutable: estructura de backend/web/Android, versiones compatibles y checks mínimos. Después acceso y designación del único celular offline; continuar planes/horarios, alumnos/inscripciones, cobros/cajas y asistencia/sincronización en recorridos integrados. Cerrar las decisiones técnicas pendientes del ADR, preparar el mapa de datos/contratos y crear specs pequeñas antes de cada implementación. Priorizar backend y reglas críticas con frontend mínimo. Incorporar migraciones y demo opcional reproducible con los primeros recorridos. Documentar comandos reales al existir código; todavía no hay instalación, pruebas de aplicación ni despliegue verificados.
