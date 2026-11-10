# Metodología de desarrollo con Claude: SDD, TDD, pruebas adversariales y roles

Este documento describe cómo queremos que se desarrolle software con Claude Code en nuestros proyectos.
Es el estándar: cada proyecto lo adapta a su dominio, su stack y sus riesgos, pero mantiene la misma
estructura, los mismos roles y las mismas reglas.

Viene de un proyecto real (un SaaS para restaurantes) donde se construyeron con este método más de diez
secciones, con más de 25 rondas de ataque adversarial sobre la ruta crítica.

> **En AquaGestión:** la adaptación de este estándar está en [`CLAUDE.md`](../CLAUDE.md) (ruta crítica,
> arquitectura y convenciones). Los roles están en `.claude/agents/` y las plantillas en `specs/_plantillas/`.
> La sección 11 explica cómo arrancar la sesión del orquestador en este repositorio.

## 1. Los cuatro principios

1. **Primero la especificación (SDD, Spec-Driven Development).** Nada se programa sin una especificación
   aprobada por el responsable del producto: qué se construye, cómo se comprueba y qué queda fuera.
2. **Primero las pruebas, donde importa (TDD).** En la ruta crítica, las pruebas se escriben antes que
   el código, a partir de la especificación, y nadie puede debilitarlas después.
3. **Alguien intenta romperlo (pruebas adversariales).** En la ruta crítica, un agente distinto, sin el
   razonamiento de quien lo construyó, ataca el resultado. Cada falla se convierte en una prueba.
4. **Cada rol en su propio contexto.** Un orquestador reparte el trabajo entre subagentes
   especializados. Cada uno usa el modelo y el nivel de razonamiento que su tarea exige, y ninguno se
   revisa a sí mismo.

TDD y pruebas adversariales **no se aplican a todo**: solo a la ruta crítica (sección 4). Lo demás lleva
las pruebas que el desarrollador considere necesarias.

## 2. Roles, modelos y razonamiento

| Rol             | Dónde corre                 | Modelo     | Razonamiento | Qué hace                                                                        | Puede editar          |
| --------------- | --------------------------- | ---------- | ------------ | ------------------------------------------------------------------------------- | --------------------- |
| Orquestador     | La sesión principal         | Opus 5.5   | alto         | Elige la historia, delega cada paso, integra, pide aprobación al responsable    | Coordinación          |
| Especificador   | Subagente `especificador`   | Opus 5.5   | alto         | Escribe `spec.md`, `plan.md` y `tasks.md`                                       | Solo `specs/`         |
| Adversarial     | Subagente `adversarial`     | Opus 5.5   | alto         | Ataca la ruta crítica y reporta fallas reproducibles                            | Nada del repositorio  |
| Backend         | Subagente `backend`         | Sonnet 5.5 | alto         | Implementa las tareas de servidor                                               | Código                |
| Frontend        | Subagente `frontend`        | Sonnet 5.5 | alto         | Implementa las tareas de interfaz                                               | Código                |
| Test writer     | Subagente `test-writer`     | Sonnet 5.5 | alto         | Escribe las pruebas protegidas (TDD) y convierte las fallas en pruebas          | Pruebas               |
| Revisor         | Subagente `revisor`         | Sonnet 5.5 | alto         | Compara el cambio con la especificación y las convenciones                      | Nada                  |
| Tester          | Subagente `tester`          | Haiku 5.5  | max          | Ejecuta pruebas, lint y tipos, y reporta                                        | Nada                  |
| Documentador    | Subagente `documentador`    | Haiku 5.5  | max          | Hace los commits y mantiene la documentación                                    | Documentación         |

**Por qué este reparto:**

- **Opus** donde el error es caro y hace falta pensar: decidir qué se construye, coordinar y encontrar
  fallas que nadie vio.
- **Sonnet** para construir y revisar: buen razonamiento a menor costo.
- **Haiku** para tareas mecánicas: ejecutar comandos, informar resultados y hacer commits.

Si el proyecto lo justifica, se pueden agregar roles; por ejemplo, un `movil` para una app nativa
(Sonnet, alto).

**Reglas de los roles:**

- Los subagentes **no lanzan otros subagentes** (`disallowedTools: Agent`): toda la coordinación pasa
  por el orquestador.
- Adversarial, revisor y tester **no editan archivos**: solo leen y ejecutan comandos.
- Quien implementa **nunca toca las pruebas protegidas**.
- El adversarial **no recibe el razonamiento de quien implementó**, para no heredar sus supuestos.
- Cada subagente trabaja con su propio contexto. El orquestador le pasa todo lo que necesita: la ruta
  de la especificación, los archivos y qué espera de vuelta.

## 3. El flujo de cada historia

```
 Responsable         Orquestador            Subagentes
     │                    │
     │   pide historia    │
     ├───────────────────►│── especificador ──► spec.md, plan.md, tasks.md
     │  resumen + dudas   │
     │◄───────────────────┤
     │     APRUEBA        │
     ├───────────────────►│
     │                    │  ¿ruta crítica?
     │                    │   ├─ sí ─► test-writer (pruebas protegidas) ─► tester (confirma ROJO)
     │                    │   │
     │                    │   └─────► backend / frontend implementan ─► tester (VERDE)
     │                    │                │
     │                    │   ¿crítica?    ▼
     │                    │   └─ sí ─► adversarial ataca ─► ¿falla? ─ sí ─► spec + prueba nueva en ROJO
     │                    │                                    │              └─► se vuelve a implementar
     │                    │                                    no
     │                    │                                    ▼
     │                    │            revisor + tester (suite, lint, tipos)
     │                    │                                    ▼
     │                    │            documentador: commit y documentación
     │  pide unir a main  │
     │◄───────────────────┤
```

1. **Especificación.** El especificador escribe `specs/NNN-nombre/` a partir de las plantillas. Enlaza
   los requerimientos que cubre (RF, HU) y deja las dudas en "Preguntas abiertas", sin inventar reglas
   de negocio.
2. **Aprobación del responsable.** El orquestador muestra un resumen corto con las preguntas abiertas y
   su propuesta para cada una. **No se escribe código sin aprobación.**
3. **Clasificación.** Se marca qué criterios son de ruta crítica.
4. **Pruebas primero (solo ruta crítica).** El test-writer escribe las pruebas desde la especificación
   y los contratos públicos, sin mirar la implementación. Cada archivo lleva una marca de protección. El
   tester confirma que fallan **por la razón esperada** (falta la funcionalidad), no por un error de
   sintaxis o de configuración. Se hace un commit "Pruebas protegidas (…) (en rojo)".
5. **Implementación.** Backend y frontend implementan las tareas hasta que todo pasa.
6. **Ataque (solo ruta crítica).** El adversarial ataca. Por cada falla reproducible:
   1. el especificador agrega el criterio nuevo a `spec.md`;
   2. el test-writer escribe la prueba protegida, que falla;
   3. se corrige;
   4. se vuelve a atacar.

   **Las rondas siguen hasta que el adversarial no encuentra fallas** (en el proyecto de origen, una
   sección necesitó nueve rondas).
7. **Revisión.** El revisor compara con la especificación y las convenciones, y confirma con `git diff`
   que nadie tocó las pruebas protegidas. El tester ejecuta toda la suite, el lint y los tipos.
8. **Cierre.** El documentador hace el commit final, marca las tareas y actualiza la documentación. El
   orquestador pide al responsable unir a la rama principal.

## 4. La ruta crítica

La ruta crítica es la lista de funciones donde un error **cuesta dinero, problemas legales, filtración
de datos o la confianza del cliente**. Cada proyecto escribe la suya en su `CLAUDE.md`, y solo ahí se
aplican TDD y pruebas adversariales.

Preguntas para armarla:

- ¿Dónde se calcula o se mueve dinero?
- ¿Dónde se separan los datos de distintos clientes, usuarios o empresas?
- ¿Qué tiene obligaciones legales o tributarias?
- ¿Dónde un permiso mal aplicado deja hacer lo que no se debe?
- ¿Qué pasa si una operación se repite (doble clic, reintento de red) o si dos personas la hacen a la
  vez?
- ¿Qué recibe datos de afuera sin control (formularios públicos, integraciones)?

Ejemplo, el proyecto de origen:

- Aislamiento entre empresas.
- Cálculo de montos e impuestos.
- Envío de comandas.
- Caja y cobro.
- Comprobantes electrónicos.
- Permisos y auditoría.
- Pedidos desde canales públicos.

**Fuera de la ruta crítica**, por ejemplo: pantallas de reportes, mantenimiento simple de catálogos y
la apariencia de páginas públicas.

Una historia puede ser **en parte** crítica. La especificación marca qué criterios lo son, y solo esos
llevan TDD y ataque.

## 5. Qué ataca el adversarial

Una guía de partida, que cada proyecto completa:

- **Aislamiento:** ver o modificar datos de otro cliente por id, por listados, por eventos o por colas.
- **Montos:** redondeos, varias líneas, descuentos, divisiones que no suman exacto, valores extremos.
- **Concurrencia:** dos usuarios a la vez, doble envío, reintentos, la misma clave de idempotencia con
  datos distintos.
- **Estados:** transiciones prohibidas, saltarse un paso, operar sobre algo cerrado o vencido.
- **Permisos:** rol insuficiente, credencial vencida o reutilizada, autorización usada para otra cosa.
- **Entradas:** vacíos, negativos, enormes, caracteres especiales, datos mal formados.
- **Fallos externos:** el proveedor no responde, responde dos veces o responde tarde.

Cada falla se reporta con título, severidad, pasos o código para reproducirla, resultado esperado según
la especificación y resultado obtenido. Si no encuentra fallas en un área, dice qué probó.

## 6. La especificación

Cada historia vive en `specs/NNN-nombre/` con tres archivos, más uno opcional:

- **`spec.md`: qué y por qué.** Objetivo, criterios de aceptación numerados (dado, cuando, entonces),
  clasificación de ruta crítica por criterio, casos límite, reglas de negocio, contrato (endpoints,
  eventos, permisos), cambios al modelo de datos, fuera de alcance, impacto en especificaciones
  anteriores, riesgos aceptados, decisiones tomadas y preguntas abiertas.
- **`plan.md`: cómo.** Módulos afectados, diseño, decisiones técnicas con la alternativa descartada,
  migraciones y riesgos.
- **`tasks.md`: tareas pequeñas y ordenadas**, cada una con su rol y los criterios que cubre, más las
  casillas de la ruta crítica (rojo, verde, ataque sin fallas).
- **`fuentes.md` (opcional):** de dónde salen las reglas: documentos, normas, conversaciones con
  expertos.

**La especificación es un documento vivo.** Cada ronda adversarial y cada decisión del responsable la
actualizan antes de tocar el código. Lo que diga el código y no diga la especificación se considera un
error.

**Las dudas de un experto** (contador, abogado, especialista del dominio) quedan como preguntas abiertas
con un valor provisional, para que no bloqueen el avance.

## 7. Git y entregas

- **La rama principal solo tiene lo aprobado.** Cada sección se trabaja en su propia rama y se une a la
  principal cuando el responsable la aprueba.
- **Las secciones grandes se parten en entregas** (por ejemplo, 6a y 6b), cada una con valor propio.
- **Commits frecuentes y descriptivos, en el idioma del equipo:**
  - `Especificación NNN aprobada: …`
  - `Pruebas protegidas (NNN): … (en rojo)`
  - `Sección X (NNN), ataque ronda N: …`
  - `Sección X (NNN): respaldo … (en curso)`: un commit de respaldo cuando el trabajo es largo y la
    sesión podría cortarse.
- **Nunca** se reescribe historia publicada ni se saltan los hooks.

## 8. Documentación que se mantiene viva

- **`CLAUDE.md`**: instrucciones del orquestador, arquitectura, convenciones y ruta crítica.
- **`README.md`**: qué está construido y cómo funciona, sección por sección.
- **Guía para levantar el sistema en local**, escrita para alguien que no es experto, en el sistema
  operativo que usa el responsable.
- **Guía de uso con ejemplos**, con los textos reales de la interfaz.

## 9. Lecciones aprendidas

- **Crea los archivos de los roles antes de abrir la sesión del orquestador.** Los subagentes definidos a
  mitad de una sesión no se pueden invocar por nombre hasta la siguiente.
- **El orquestador trabaja en una sesión propia, con el contexto limpio.** Las dudas, los tutoriales y la
  planificación van en otra conversación, que no toca la rama de trabajo.
- **Una aprobación por adelantado permite trabajar sin supervisión.** Si el responsable aprueba la
  especificación y autoriza seguir sin pedir permiso entre pasos, el orquestador puede avanzar aunque
  nadie esté mirando, y solo se detiene ante una decisión de negocio nueva.
- **Prueba en el sistema operativo del responsable.** Los agentes corren en Linux, pero la persona puede
  usar Windows. Evita comandos de shell de Unix (`cp`, `rm`, `mkdir -p`) en los scripts del proyecto y
  usa Node, Python o la herramienta multiplataforma del stack.
- **La configuración local no debe exigir editar archivos versionados.** Puertos, rutas y credenciales
  van en `.env`.
- **Haz que la integración continua replique la máquina real:** base de datos real, sin simulaciones de
  lo crítico.
- **El adversarial encuentra cosas.** No te detengas en la primera ronda limpia de una zona; ataca
  todas las áreas de la lista.

## 10. Cómo adoptarlo en un proyecto nuevo

1. Copia `.claude/` y `specs/_plantillas/` al repositorio. Si el proyecto ya tiene `.claude/settings.json`,
   combina las claves `model` y `effortLevel` en lugar de reemplazarlo.
2. Crea el `CLAUDE.md` a partir de la plantilla del kit: llena la arquitectura, las convenciones y,
   sobre todo, la ruta crítica.
3. Ajusta lo propio del stack en cada rol (por ejemplo, una skill de diseño para el frontend). No cambies
   las reglas comunes: quién no edita, las pruebas protegidas, el adversarial sin el razonamiento del
   implementador y que los subagentes no lancen subagentes.
4. Haz commit y push de todo **antes** de abrir la sesión del orquestador.
5. Abre una sesión nueva: esa sesión es el orquestador.

Los identificadores de modelo son los de Claude 5.5 (`claude-opus-5-5`, `claude-sonnet-5-5`,
`claude-haiku-5-5`). Si cambian las versiones, actualiza el campo `model` de cada rol y el de
`.claude/settings.json`. El nivel `max` solo se puede asignar a los subagentes; en la sesión principal, el
máximo es `xhigh`.

## 11. Cómo arrancar la sesión del orquestador en AquaGestión

1. Asegúrate de que `.claude/`, `specs/_plantillas/` y `CLAUDE.md` estén en `main`.
2. Abre una **sesión nueva** sobre este repositorio. Esa sesión es el orquestador.
3. Pídele la primera historia:

   ```
   Eres el orquestador. Sigue el flujo de CLAUDE.md. Empieza por la historia "<nombre>":
   pídele al especificador la especificación y tráeme el resumen para aprobarla.
   ```

4. Para que trabaje sin supervisión una vez aprobada la especificación:

   ```
   La especificación specs/NNN-… está APROBADA. Ejecuta la historia completa según tasks.md sin pedirme
   aprobación entre pasos. Haz commit y push al cerrar cada fase. Detente solo si aparece una decisión de
   negocio que no esté en la especificación o algo te bloquea. Al terminar, dame un resumen.
   ```
