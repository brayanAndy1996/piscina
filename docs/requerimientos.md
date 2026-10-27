# Documentación del Sistema de Gestión – Academia de Natación

> Texto extraído automáticamente de `Documentacion_Sistema_Academia_Natacion.pdf` (v1.4, 14/10/2026).
> Las tablas y diagramas pierden su formato al extraerse: ante cualquier duda, el PDF es la fuente de verdad.

<!-- Página 2 -->

## 1. Descripción de la empresa

La empresa es una academia de natación que funciona en una piscina semiolímpica (25 m). Ofrece clases  
grupales por niveles y clases particulares a niños, jóvenes y adultos.  

### 1.1 Servicios

Servicio Descripción  
Clases grupales por plan mensualPor ejemplo, el plan de 3 veces por semana: 12 clases al mes de 1 hora cada una.  
Niveles Básico, Intermedio y Avanzado.  
Clases particulares Las autoriza el administrador y las cobra la secretaria.  
Seguimiento del alumno El entrenador registra el rendimiento y sube fotos y videos cada mes.  

### 1.2 Operación

Horario de atención: de 08:00 a 20:00, en bloques de 1 hora (12 bloques al día).  
Clases en paralelo: en un mismo bloque pueden darse a la vez clases de nivel básico, intermedio y  
avanzado, cada una con su propio entrenador.  
Aforo por clase: configurable entre 20 y 50 alumnos.  
Medios de pago: efectivo, Yape y transferencia bancaria.  

### 1.3 Objetivo del sistema

Digitalizar y centralizar estos procesos:  
inscripción  
cobro y control de caja  
asistencia por QR  
control de mensualidades  
seguimiento del rendimiento de los alumnos  
reportes financieros y operativos  
El objetivo es reducir errores, evitar fraudes en los pagos y dar visibilidad a la administración.  

<!-- Página 3 -->

## 2. Actores y roles

Rol Descripción Funciones principales  
Administrador Dueño o gerente de la academiaConfigura planes, horarios, aforos y entrenadores. Crea  
códigos de descuento. Autoriza clases particulares. Ve  
todos los reportes.  
Caja / Secretaria Personal de recepción Inscribe alumnos, cobra, verifica pagos por Yape o  
transferencia, registra asistencia manual, abre y cierra caja,  
y modifica horarios de alumnos.  
Entrenador Profesor de natación Ve sus horarios y la ficha de sus alumnos, registra su  
rendimiento, sube fotos y videos mensuales y consulta el  
historial de pagos que ha recibido.  
Alumno Persona inscrita con pago  
verificado  
Ingresa con su DNI, ve su carnet digital con QR, su horario,  
las clases que le quedan, su rendimiento y su multimedia.  
Cambia su contraseña.  
Cliente (posible  
alumno)  
Interesado que aún no completa la  
inscripción o cuyo pago no está  
verificado  
Llena el formulario de inscripción, elige plan, días y horario,  
y paga.  
Padre / Apoderado  
(actor secundario)  
Responsable de un alumno menor  
de edad  
Sus datos se registran en el formulario. Ingresa con la  
misma cuenta del alumno.  

### 2.1 Matriz de permisos (resumen)

Funcionalidad AdminSecretaria Entrenador Alumno Cliente  
Configurar planes, horarios y aforo✅ ❌ ❌ ❌ ❌  
Crear códigos de descuento ✅ ❌ ❌ ❌ ❌  
Autorizar clases particulares ✅ ❌ ❌ ❌ ❌  
Cobrar clase particular autorizada✅ ✅ ❌ ❌ ❌  
Registrar inscripción y cobro ✅ ✅ ❌ ❌ ✅  
(autoinscripción)  
Verificar pagos (Yape o transferencia)✅ ✅ ❌ ❌ ❌  
Abrir y cerrar caja ✅ ✅ ❌ ❌ ❌  
Registrar asistencia (QR o manual)✅ ✅ ❌ ❌ ❌  
Modificar el horario de un alumno a  
mitad de mes  
✅ ✅ ❌ ❌ ❌  
Ver la ficha de sus alumnos ✅ ✅ ✅  (solo los  
suyos)  
❌ ❌  
Editar el rendimiento del alumno❌ ❌ ✅ ❌ ❌  
Subir fotos y videos ✅ ❌ ✅ ❌ ❌  
Ver reportes financieros ✅ Parcial (su  
caja)  
❌ ❌ ❌  

<!-- Página 4 -->
Funcionalidad AdminSecretaria Entrenador Alumno Cliente  
Ver reportes de asistencia ✅ ✅ Sus clases Propia ❌  
Ver carnet digital y QR ✅ ✅ ❌ ✅ ❌  
Autorizar asistencia en otro horario✅ ✅ ❌ ❌ ❌  
Registrar pagos a entrenadores ✅ ❌ ❌ ❌ ❌  
Ver sus pagos recibidos ❌ ❌ ✅ ❌ ❌  
Registrar días de cierre y fechas de  
recuperación  
✅ ❌ ❌ ❌ ❌  
Emitir certificados ✅ ❌ ❌ ❌ ❌  
Ver fotos y videos del alumno ✅ ❌ ✅  (los que  
sube)  
✅  (solo los  
suyos)  
❌  

<!-- Página 5 -->

## 3. Flujo de negocio actual

Supuesto: el cliente no describió en detalle cómo opera hoy. Lo siguiente es el escenario típico de una  
academia sin sistema y debe validarse con el cliente.  

### 3.1 Descripción

1. El interesado se acerca a recepción y pide información.  
2. La secretaria anota los datos en un cuaderno, una ficha física o un Excel.  
3. El cliente paga en efectivo o por Yape y muestra la captura en su celular.  
4. La secretaria anota el pago a mano. No se valida si el Yape llegó realmente.  
5. La asistencia se controla con una lista en papel o de memoria.  
6. Las clases restantes del mes se calculan a mano.  
7. El cierre de caja se hace contando efectivo, sin cuadrar contra un registro digital.  
8. Los entrenadores no tienen un registro formal del progreso de cada alumno.  

<!-- Página 6 -->

### 3.2 Diagrama del flujo actual (supuesto)

Efectivo  
Yape  
Cliente llega a recepción  
Secretaria anota datos en papel o Excel  
Medio de pago  
Recibe efectivo  
Cliente muestra captura  
Se acepta sin validar  
Anotación manual del pago  
Alumno asiste a clases  
Lista de asistencia en papel  
Conteo manual de clases restantes  
Cierre de caja manual  

<!-- Página 7 -->

### 3.3 Problemas detectados

# Problema Impacto  
P1 Las capturas de Yape no se verifican Riesgo de fraude por capturas falsas o reutilizadas  
P2 Los datos médicos y alergias están en papelRiesgo de seguridad para el alumno ante una emergencia  
P3 La asistencia es manual Errores, suplantación y discusiones por clases restantes  
P4 No hay control de aforo Clases sobrepobladas  
P5 La caja no está cuadrada Faltantes no detectados  
P6 No hay reportes Decisiones sin datos  
P7 No hay seguimiento del rendimiento Menor valor percibido por padres y alumnos  
P8 Los descuentos no están controlados Pérdida de ingresos  

<!-- Página 8 -->

## 4. Procesos de negocio propuestos


### 4.1 Proceso de inscripción y pago


<!-- Página 9 -->
No  
Sí  
Efectivo  
Yape o Transferencia  
RechazadoAprobado  
Cliente llena formulario de inscripción  
Elige plan, nivel, días y horario  
¿Hay cupo en el aforo?  
Aplica código de descuento opcional  
Método de pago  
Secretaria cobra y registra en caja  
Pago CONFIRMADO  
Cliente sube foto del comprobante  
Pago PENDIENTE DE VERIFICACIÓN  
Secretaria verifica el abono real  
Pago RECHAZADO: se notifica al cliente  
Cliente pasa a ALUMNO  
Se genera usuario: DNI / contraseña: DNI  
Se genera carnet digital con QR  
Detalles clave:  
Mientras el pago está pendiente, el cupo queda reservado hasta que la secretaria lo verifique. Si  
lo rechaza, el cupo se libera.  

<!-- Página 10 -->
El carnet digital y el QR solo se generan cuando el pago está confirmado.  

### 4.2 Proceso de asistencia por QR

Carnet físico o digitalCelular con sesión Nada  
Mensualidad vencida o sin clasesDía u horario no corresponde  
Secretaria autoriza y hay cupo  
Ya marcó hoy  
OK  
Alumno llega a la piscina  
¿Qué presenta?  
Secretaria escanea el QRSecretaria busca por DNI o nombre: asistencia MANUAL  
Validaciones  
❌  Alerta roja: no puede ingresar⚠  Alerta amarilla: la secretaria puede autorizar  
✅  Check verde  
⚠  Asistencia duplicada  
Muestra foto, nombre, nivel, horario y clases restantes: por ejemplo 7 de 12  
Se descuenta 1 clase  

### 4.3 Proceso de caja diaria

Sí  
NoApertura de caja con monto inicialRegistro de ingresos: inscripciones, mensualidades y particularesRegistro de egresos opcionalCierre de cajaEl sistema calcula el esperado: inicial + ingresos en efectivo − egresosSecretaria declara el efectivo contado¿Cuadra?Cierre OK  
Se registra la diferencia con observación  
Los pagos por Yape o transferencia se registran en caja, pero no se suman al efectivo físico  
esperado. Se reportan por separado según el método de pago.  

### 4.4 Proceso de clase particular

1. El administrador crea la clase particular: alumno o cliente, entrenador, fecha, hora y precio.  
2. El administrador la autoriza, y queda disponible para cobro.  
3. La secretaria cobra (efectivo o Yape, con el mismo flujo de verificación).  

<!-- Página 11 -->
4. Se registra la asistencia de esa sesión.  

### 4.5 Proceso de renovación de mensualidad

1. Al acercarse el fin de mes, el sistema marca a los alumnos por vencer.  
2. El alumno renueva: paga el siguiente mes y puede elegir de nuevo días y horario para el nuevo  
periodo.  
3. Si no renueva, al iniciar el mes queda vencido y el QR muestra una alerta roja.  

### 4.6 Proceso de seguimiento del rendimiento

1. El entrenador entra a su panel y ve sus clases y alumnos.  
2. Abre la ficha del alumno: datos generales, datos médicos y alergias (solo lectura).  
3. Registra la evaluación de rendimiento del mes.  
4. Sube las fotos y videos del mes.  
5. El alumno ve su evolución desde su perfil.  

<!-- Página 12 -->

### 4.7 Proceso de aviso de inasistencia por WhatsApp

Sí  
No  
Sí  
No  
No Sí  
Termina la clase + 15 min de tolerancia  
El sistema lista a los alumnos inscritos en esa clase  
¿Registró asistencia?  
Nada que hacer  
¿Es día de cierre, asistió en otro horario o tiene recuperación?  
Se registra la FALTA  
¿Aviso por WhatsApp activo para el alumno?  
Envía un WhatsApp con plantilla aprobada al apoderado o al alumno adulto  
Guarda el estado: enviado, entregado o fallido  

<!-- Página 13 -->

## 5. Reglas de negocio

CódigoRegla  
- RN-01 Una persona es Cliente hasta que su primer pago queda confirmado. A partir de ahí es Alumno.  
- RN-02 El usuario del alumno es su DNI y la contraseña inicial también es su DNI. El sistema obliga a cambiarla en el  
primer ingreso (recomendación de seguridad).  
- RN-03 El DNI es único en el sistema.  
- RN-04 Los pagos en efectivo se confirman al instante. Los pagos por Yape o transferencia requieren foto del  
comprobante y verificación humana de la secretaria.  
- RN-05 El carnet digital con QR se genera solo con el pago confirmado.  
- RN-06 El QR lo genera el sistema, es único por alumno y es el mismo que se lee en la asistencia. Contiene un  
identificador seguro, no datos personales.  
- RN-07 Los planes son variados y los define el administrador: nombre, veces por semana, clases por mes, duración de  
la clase, precio, días y horarios permitidos, niveles a los que aplica y vigencia. Ejemplo de referencia: 3 veces por  
semana, 12 clases al mes, 1 hora por clase.  
- RN-08 Al inscribirse, el alumno elige días y horario. Una vez elegidos, no puede modificarlos hasta fin de mes. Solo  
la secretaria o el administrador puede cambiarlos.  
- RN-09 Horario de clases: de 08:00 a 20:00, en bloques de 1 hora.  
- RN-10 En un mismo bloque pueden darse a la vez clases de nivel Básico, Intermedio y Avanzado, cada una con un  
entrenador asignado.  
- RN-11 El aforo de cada clase es editable entre 20 y 50 alumnos. No se permiten inscripciones por encima del aforo.  
- RN-12 Los códigos de descuento solo los crea el administrador. Pueden ser porcentaje o monto fijo, con vigencia y  
límite de usos.  
- RN-13 Las clases particulares solo pueden cobrarse si el administrador las generó y autorizó antes.  
- RN-14 Cada asistencia registrada descuenta una clase del plan del mes.  
- RN-15 No se puede registrar asistencia si la mensualidad está vencida o no quedan clases.  
- RN-16 Solo se permite una asistencia por alumno por día (salvo clases particulares).  
- RN-17 La caja debe abrirse antes de registrar cobros y cerrarse al final del día. Una caja cerrada no admite  
movimientos.  
- RN-18 El entrenador solo ve y edita el rendimiento de sus propios alumnos.  
- RN-19 Las fotos y videos se organizan por mes y por alumno. Solo los ve la cuenta del alumno, además del  
administrador y el entrenador que los subió. No hay galerías por clase ni públicas.  
- RN-20 Si el alumno es menor de edad, los datos del padre o apoderado son obligatorios.  
- RN-21 Los datos médicos y las alergias son visibles para la secretaria, el administrador y el entrenador del alumno, y  
deben destacarse en la ficha.  
- RN-22 Toda operación de caja, verificación de pago o cambio de horario queda registrada en auditoría: quién, cuándo  
y qué.  
- RN-23 Clases no usadas a fin de mes: por defecto no son recuperables y se pierden al cerrar el mes. El  
administrador puede marcarlas como recuperables para un alumno concreto, indicando la cantidad de clases, la  
fecha límite para usarlas y el motivo.  

<!-- Página 14 -->
CódigoRegla  
- RN-24 Recuperación de clases perdidas: por defecto no se recuperan. El administrador puede autorizar una  
recuperación. La secretaria la agenda en otra clase del mismo nivel que tenga cupo, y la asistencia descuenta  
de las clases recuperables y no del plan del mes.  
- RN-25 Inscripción a mitad de mes: se cobra en proporción a las clases que quedan en el mes según el plan y los  
días elegidos. La fórmula es precio_plan ÷ clases_por_mes × clases_restantes, redondeado hacia  
arriba al sol entero (por ejemplo, S/ 87.50 se cobra como S/ 88.00). El administrador puede ajustar ese monto  
con un motivo que queda en auditoría.  
- RN-26 Todo cobro confirmado genera un comprobante electrónico SUNAT: boleta por defecto, o factura si el cliente  
da un RUC. El comprobante se emite solo cuando el pago está confirmado; en Yape o transferencia, eso ocurre  
tras la verificación humana.  
- RN-27 No se cobra matrícula (inscripción única). El cliente solo paga la mensualidad, que puede ser proporcional  
según la RN-25.  
- RN-28 Un pago por Yape o transferencia pendiente de verificación reserva el cupo sin límite de tiempo, hasta que la  
secretaria lo apruebe o lo rechace. Al rechazarse, el cupo se libera.  
- RN-29 Los padres o apoderados usan la misma cuenta del alumno; no hay cuentas separadas para padres.  
- RN-30 Un alumno puede asistir a un horario distinto al suyo solo si la secretaria lo autoriza y hay cupo en esa clase.  
La clase se descuenta de su plan del mes.  
- RN-31 El pago a los entrenadores es en efectivo y fuera del sistema. El administrador registra cada pago realizado  
(fecha, periodo, monto y concepto) y el entrenador lo ve en su cuenta como cancelado. El sistema no calcula  
sueldos.  
- RN-32 Los certificados son opcionales: el administrador decide si emite uno, a quién y con qué motivo (por ejemplo,  
nivel aprobado).  
- RN-33 Cuando la piscina cierra (feriado, mantenimiento u otro motivo), las clases afectadas se recuperan. El  
administrador registra el cierre y define las fechas de recuperación, y las clases afectadas no se descuentan del  
plan.  
- RN-34 Cuando un alumno falta a una clase que le correspondía, el sistema envía automáticamente un mensaje de  
WhatsApp al celular registrado del padre o apoderado. Si el alumno es mayor de edad y no tiene apoderado,  
el mensaje va al celular del alumno. No se usa SMS: el único canal es WhatsApp.  
- RN-35 Cada pago a un entrenador tiene un origen que decide el administrador: desde caja, que genera un egreso en  
la caja abierta del día, o externo, que sale del bolsillo del administrador y no afecta la caja.  
- RN-36 Los precios no incluyen IGV. Al cobrar, el sistema suma el IGV (18 %) al precio del plan: un plan de S/ 100 se  
cobra S/ 118. El comprobante muestra por separado el valor de venta, el IGV y el total. El tratamiento tributario  
es configurable (afecto, exonerado o inafecto) por si cambia el régimen.  

<!-- Página 15 -->

## 6. Historias de usuario

Formato: Como [rol], quiero [acción], para [beneficio]. Prioridad (MoSCoW): M = Must (debe tener), S =  
Should (debería tener), C = Could (podría tener).  

### Épica 1: Inscripción y alumnos


#### HU-01: Formulario de inscripción  
Como cliente, quiero llenar un formulario de inscripción con mis datos, para registrarme en la academia.  
Prioridad: M Criterios de aceptación:  
El formulario pide los siguientes datos:  
nombre completo  
DNI  
fecha de nacimiento (de la que se calcula la edad)  
teléfono  
correo  
dirección  
grado de colegio  
nivel de natación (básico, intermedio o avanzado)  
plan  
Datos médicos:  
tipo de sangre  
enfermedades o condiciones  
alergias  
medicamentos  
seguro  
contacto de emergencia  
Si la persona es menor de edad, se exigen los datos de padre, madre o apoderado: nombre, DNI,  
teléfono y parentesco.  
Se valida que el DNI tenga 8 dígitos y no esté ya registrado.  
Se debe aceptar el tratamiento de datos personales y el deslinde de responsabilidad.  

#### HU-02: Elección de días y horario  
Como cliente, quiero elegir los días y el horario de mis clases según mi nivel, para asistir cuando me  
convenga. Prioridad: M Criterios de aceptación:  
Solo se muestran las clases del nivel del cliente que tienen cupo disponible.  
El número de días elegidos coincide con la frecuencia del plan (por ejemplo, 3 días para el plan de 3  
veces por semana).  
Se muestran los cupos restantes de cada clase.  
Si una clase se llena mientras el cliente está eligiendo, el sistema avisa y pide otra opción.  

<!-- Página 16 -->

#### HU-03: Bloqueo de cambio de horario  
Como administrador, quiero que el alumno no pueda cambiar sus días ni su horario hasta fin de mes, para  
mantener la organización de las clases. Prioridad: M Criterios de aceptación:  
El alumno no ve la opción de editar su horario en su perfil.  
La secretaria y el administrador sí pueden cambiarlo, indicando un motivo que queda en auditoría.  
El cambio respeta el aforo de la clase destino.  

#### HU-04: Conversión de cliente a alumno  
Como secretaria, quiero que el cliente pase a ser alumno al confirmarse su pago, para que pueda usar el  
sistema y asistir a clases. Prioridad: M Criterios de aceptación:  
Al confirmarse el pago, el estado cambia a «Alumno activo».  
Se crea automáticamente el usuario (DNI) y la contraseña (DNI).  
Se genera el carnet digital con QR.  

#### HU-05: Acceso del alumno y cambio de contraseña  
Como alumno, quiero ingresar con mi DNI y cambiar mi contraseña, para proteger mi cuenta. Prioridad:  
M Criterios de aceptación:  
El primer inicio de sesión usa DNI como usuario y DNI como contraseña.  
En el primer ingreso se pide cambiar la contraseña.  
El alumno puede cambiar su contraseña cuando quiera desde su perfil.  
Existe una opción de «Olvidé mi contraseña»: la secretaria puede restablecerla al DNI.  

#### HU-06: Perfil del alumno  
Como alumno, quiero ver en mi perfil mis datos, plan, horario, clases restantes y vencimiento, para saber el  
estado de mi mensualidad. Prioridad: M Criterios de aceptación:  
Se muestran: nombre completo, DNI, nivel, edad, plan, días y horario, clases usadas y restantes (por  
ejemplo, 5 de 12) y fecha de vencimiento.  

### Épica 2: Pagos y verificación


#### HU-07: Pago en efectivo  
Como secretaria, quiero registrar un pago en efectivo, para confirmar la inscripción o mensualidad al  
instante. Prioridad: M Criterios de aceptación:  
Solo se puede cobrar con la caja abierta.  
El pago se registra en la caja del día y se genera un comprobante interno (o ticket) imprimible.  

#### HU-08: Pago por Yape o transferencia con foto  
Como cliente, quiero subir la foto de mi comprobante de Yape o transferencia, para que la academia valide  
mi pago. Prioridad: M Criterios de aceptación:  
Se acepta una imagen (JPG o PNG, máximo 5 MB) desde la cámara o la galería.  

<!-- Página 17 -->
Se registran el número de operación, el monto y la fecha del comprobante.  
El pago queda en estado «Pendiente de verificación».  
El sistema avisa si el número de operación ya fue usado antes (prevención de duplicados).  

#### HU-09: Verificación de pagos  
Como secretaria, quiero ver la bandeja de pagos pendientes y aprobarlos o rechazarlos, para confirmar  
solo los pagos reales. Prioridad: M Criterios de aceptación:  
La bandeja lista los pagos pendientes con la foto ampliable, el monto, el número de operación, el  
cliente y la fecha.  
Las acciones son Aprobar o Rechazar (el rechazo exige un motivo).  
Al aprobar, se genera el carnet. Al rechazar, se notifica al cliente.  
Queda registrado quién verificó y cuándo.  

#### HU-10: Códigos de descuento  
Como administrador, quiero crear códigos de descuento, para dar promociones controladas. Prioridad: M  
Criterios de aceptación:  
Cada código tiene:  
tipo (porcentaje o monto fijo)  
valor  
fecha de inicio y fin  
usos máximos  
planes a los que aplica  
estado activo o inactivo  
Solo el administrador puede crear, editar o desactivar códigos.  
El sistema valida el código al momento del pago y muestra el precio final.  
El reporte indica cuántas veces se usó cada código y el monto descontado.  

#### HU-11: Control de mensualidades  
Como secretaria, quiero ver el estado de mensualidad de cada alumno, para saber quién está al día, por  
vencer o vencido. Prioridad: M Criterios de aceptación:  
Los estados posibles son: Al día, Por vencer (últimos 5 días, configurable), Vencido y Pendiente de  
verificación.  
Se puede filtrar por estado, plan, nivel, horario y mes.  

#### HU-34: Cobro proporcional por inscripción a mitad de mes  
Como secretaria, quiero que el sistema calcule automáticamente el monto proporcional cuando alguien se  
inscribe a mitad de mes, para cobrar solo las clases que podrá recibir. Prioridad: M Criterios de  
aceptación:  
El sistema cuenta las clases restantes del mes según los días elegidos, desde la fecha de inicio hasta  
fin de mes, con un tope igual a las clases del plan.  
Calcula el monto: precio_plan ÷ clases_por_mes × clases_restantes, redondeado hacia arriba al  
sol entero.  
La matrícula del mes se crea con clases_totales igual a las clases restantes (por ejemplo, 5 de 12).  

<!-- Página 18 -->
El administrador puede modificar el monto o las clases, con un motivo obligatorio que queda en  
auditoría.  
El código de descuento, si lo hay, se aplica sobre el monto proporcional.  

#### HU-12: Renovación de mensualidad  
Como alumno, quiero renovar mi mensualidad y elegir mi horario para el siguiente mes, para continuar  
mis clases. Prioridad: M Criterios de aceptación:  
La renovación sigue el mismo flujo de pago (efectivo o verificación).  
El alumno tiene prioridad para conservar su mismo horario si renueva antes del fin de mes (por  
confirmar).  

### Épica 3: Carnet digital y asistencia


#### HU-13: Carnet digital con QR  
Como alumno, quiero tener un carnet digital con mi QR, para registrar mi asistencia. Prioridad: M  
Criterios de aceptación:  
El carnet muestra: foto, nombre, DNI, nivel, plan, horario, vigencia y QR.  
Se puede ver en el celular y descargar o imprimir como PDF para el carnet físico.  
El QR del carnet físico y el del celular es el mismo.  

#### HU-14: Registro de asistencia por QR  
Como secretaria, quiero escanear el QR del alumno, para registrar su asistencia de forma rápida.  
Prioridad: M Criterios de aceptación:  
El escaneo se hace con la cámara de la PC, una tablet o una lectora QR.  
Si todo está correcto, se muestra un check verde junto con:  
la foto y el nombre del alumno  
el nivel y la clase  
las clases restantes del mes (por ejemplo, «Le quedan 7 de 12»)  
Si hay problemas, se muestra una alerta roja (vencido o sin clases) o amarilla (fuera de su horario o  
asistencia duplicada).  
La asistencia queda registrada con fecha, hora, método (QR o manual) y usuario.  

#### HU-15: Asistencia manual  
Como secretaria, quiero registrar la asistencia manualmente buscando por DNI o nombre, para atender al  
alumno que no trae carnet ni celular. Prioridad: M Criterios de aceptación:  
Se aplican las mismas validaciones y la misma pantalla de resultado que con el QR.  
Queda marcada como «Manual» en los reportes.  

#### HU-38: Autorizar asistencia en otro horario  
Como secretaria, quiero autorizar que un alumno asista a una clase distinta de la suya, para dar flexibilidad  
cuando lo necesite. Prioridad: S Criterios de aceptación:  
Al escanear el QR fuera del horario del alumno aparece la alerta amarilla con el botón «Autorizar».  

<!-- Página 19 -->
Solo se puede autorizar si hay cupo en la clase. Se recomienda que sea del mismo nivel, y el sistema  
avisa si es de otro.  
La asistencia queda marcada como «Autorizada fuera de horario», con el usuario que la autorizó, y se  
descuenta del plan.  

#### HU-16: Asistencia de entrenadores  
Como administrador, quiero registrar la asistencia de los entrenadores, para controlar su puntualidad y  
calcular sus pagos. Prioridad: S Criterios de aceptación:  
El entrenador marca su asistencia con su propio QR o la registra la secretaria.  
Se registran la hora de llegada y si fue tardanza respecto a su clase.  

#### HU-35: Habilitar clases no usadas como recuperables  
Como administrador, quiero decidir si las clases no usadas de un alumno al final del mes pasan a ser  
recuperables, para manejar casos excepcionales como enfermedad o viaje. Prioridad: M Criterios de  
aceptación:  
Por defecto, al cerrar el mes las clases no usadas se pierden.  
El administrador elige al alumno, indica cuántas clases habilita (como máximo, las no usadas), la  
fecha límite y el motivo.  
Las clases recuperables se ven en el perfil del alumno y en la pantalla del escaneo QR, por ejemplo:  
«Recuperables: 2, vencen el 15/11».  
Las clases recuperables que vencen sin usarse se pierden automáticamente.  

#### HU-36: Agendar una clase de recuperación  
Como secretaria, quiero agendar una clase de recuperación autorizada en un horario con cupo, para que  
el alumno pueda recuperarla. Prioridad: M Criterios de aceptación:  
Solo se pueden agendar recuperaciones que el administrador haya autorizado.  
Solo se ofrecen clases del mismo nivel del alumno que tengan cupo disponible.  
La recuperación cuenta para el aforo de esa clase.  
Al escanear el QR en esa clase, se muestra el check verde con la etiqueta «Recuperación», y se  
descuenta de las clases recuperables, no del plan.  

### Épica 4: Horarios y clases


#### HU-17: Configuración de clases  
Como administrador, quiero crear clases indicando nivel, día, hora, entrenador y aforo, para organizar la  
academia. Prioridad: M Criterios de aceptación:  
Las clases van en bloques de 1 hora entre 08:00 y 20:00.  
Pueden coexistir clases de distinto nivel en el mismo bloque.  
El aforo es editable entre 20 y 50.  
Un entrenador no puede tener dos clases en el mismo bloque.  
Si se reduce el aforo por debajo del número de inscritos, el sistema advierte.  

<!-- Página 20 -->

#### HU-18: Horario del entrenador  
Como entrenador, quiero ver mi horario semanal de clases, para saber cuándo y qué nivel debo enseñar.  
Prioridad: M Criterios de aceptación:  
Tiene vista semanal y diaria, con el nivel y el número de alumnos inscritos en cada clase.  
Al hacer clic en una clase se ve la lista de alumnos.  

#### HU-19: Planes  
Como administrador, quiero crear y editar planes variados, para ofrecer distintas opciones. Prioridad: M  
Criterios de aceptación:  
Cada plan define:  
nombre  
veces por semana  
clases por mes  
duración de la clase  
precio  
días permitidos  
franjas horarias permitidas  
niveles a los que aplica  
vigencia  
estado activo o inactivo  
Los cambios de precio aplican solo a matrículas nuevas o renovaciones, no a las que ya están  
vigentes.  
El aforo se configura en cada clase (HU-17).  

#### HU-41: Días de cierre y recuperación  
Como administrador, quiero registrar los días en que la piscina cierra y definir las fechas de recuperación,  
para que los alumnos no pierdan sus clases. Prioridad: M Criterios de aceptación:  
Para cada cierre se registran la fecha, todo el día o ciertas franjas horarias, y el motivo (feriado,  
mantenimiento u otro).  
El sistema lista las clases y alumnos afectados.  
El administrador asigna la fecha y hora de recuperación de cada clase afectada.  
Los alumnos ven la recuperación en su horario, y el entrenador también la ve en el suyo.  
La clase cerrada no se descuenta del plan, y la asistencia a la recuperación sí cuenta.  

#### HU-40: Certificados  
Como administrador, quiero emitir certificados a los alumnos que yo decida, para reconocer su avance.  
Prioridad: C Criterios de aceptación:  
El administrador elige al alumno, el motivo (por ejemplo, nivel aprobado) y la fecha.  
Se genera un PDF con plantilla, código de verificación y firma.  
El certificado se ve y se descarga desde la cuenta del alumno.  

<!-- Página 21 -->

### Épica 5: Entrenadores y rendimiento


#### HU-20: Ficha del alumno para el entrenador  
Como entrenador, quiero ver la ficha de mis alumnos, para conocer sus datos y condiciones médicas.  
Prioridad: M Criterios de aceptación:  
Los datos generales, médicos y de alergias se ven destacados y en solo lectura.  
Se ve el historial de asistencia del alumno.  

#### HU-21: Registro de rendimiento  
Como entrenador, quiero registrar y editar el rendimiento de mis alumnos, para dar seguimiento a su  
progreso. Prioridad: M Criterios de aceptación:  
La evaluación es mensual e incluye:  
técnica por estilo (crol, espalda, pecho, mariposa)  
resistencia  
respiración  
tiempos (por ejemplo, 25 m o 50 m)  
observaciones  
El entrenador puede recomendar un cambio de nivel, que el administrador o la secretaria aprueban.  
Se guarda el historial para ver la evolución.  

#### HU-22: Fotos y videos mensuales  
Como entrenador, quiero subir fotos y videos de cada uno de mis alumnos cada mes, para mostrar su  
progreso. Prioridad: S Criterios de aceptación:  
El material se organiza por alumno y por mes.  
Se fijan límites de tamaño (por ejemplo, video de 200 MB como máximo) y formatos (JPG, PNG,  
MP4).  
Solo la cuenta del alumno ve su galería (además del administrador y el entrenador que la subió).  
No es pública ni se comparte con la clase.  
Se requiere consentimiento de imagen del padre o apoderado en el caso de menores.  

#### HU-39: Pagos a entrenadores  
Como entrenador, quiero ver en mi cuenta los pagos que me hicieron, para confirmar que estoy al día.  
Prioridad: S Criterios de aceptación:  
El administrador registra cada pago: entrenador, periodo, monto, fecha y concepto (efectivo).  
Al registrarlo, el administrador elige el origen:  
Desde caja: se crea automáticamente un egreso en la caja abierta del día, y el pago aparece  
en su cierre. Requiere que la caja esté abierta.  
Externo: no afecta la caja.  
El entrenador ve su historial con el estado «Cancelado» y, opcionalmente, un recibo en PDF.  
El sistema no calcula sueldos ni horas; solo guarda el registro.  

<!-- Página 22 -->

### Épica 6: Clases particulares


#### HU-23: Generar y autorizar una clase particular  
Como administrador, quiero generar y autorizar clases particulares, para que la secretaria pueda cobrarlas.  
Prioridad: M Criterios de aceptación:  
Se definen el alumno o cliente, el entrenador, la fecha y hora, la duración y el precio.  
Los estados son: Creada, Autorizada, Pagada, Realizada y Cancelada.  

#### HU-24: Cobrar una clase particular  
Como secretaria, quiero cobrar las clases particulares autorizadas, para registrar el ingreso. Prioridad: M  
Criterios de aceptación:  
Solo aparecen las clases particulares en estado «Autorizada».  
Se usa el mismo flujo de pago (efectivo o verificación).  

### Épica 7: Caja


#### HU-25: Apertura de caja  
Como secretaria, quiero abrir la caja del día con un monto inicial, para comenzar a registrar cobros.  
Prioridad: M  

#### HU-26: Registro de movimientos  
Como secretaria, quiero que cada cobro se registre automáticamente en la caja, y poder registrar egresos  
menores, para tener el flujo diario. Prioridad: M Criterios de aceptación:  
Cada ingreso guarda su concepto (inscripción, mensualidad o particular), método de pago, monto,  
alumno y usuario.  
Los egresos guardan concepto, monto y comprobante opcional.  

#### HU-27: Cierre de caja  
Como secretaria, quiero cerrar la caja declarando el efectivo contado, para cuadrar el día. Prioridad: M  
Criterios de aceptación:  
El sistema muestra el esperado por método de pago (efectivo, Yape y transferencia).  
Se registra la diferencia (sobrante o faltante) con su observación.  
Se genera un PDF del cierre.  
El administrador puede ver y reabrir un cierre, lo que queda en auditoría.  

#### HU-37: Comprobante electrónico SUNAT  
Como secretaria, quiero que el sistema emita una boleta o factura electrónica al confirmarse cada pago,  
para cumplir con SUNAT. Prioridad: M Criterios de aceptación:  
Por defecto se emite una boleta con el DNI del alumno o de su apoderado. Se emite factura si se  
ingresa un RUC, y el sistema valida el RUC y obtiene la razón social.  

<!-- Página 23 -->
La emisión se programa directamente contra SUNAT (SEE – Del Contribuyente), sin proveedor  
intermediario. El detalle está en la sección 8.5.  
Se guardan la serie, el número, el PDF, el XML y el CDR (constancia de recepción de SUNAT), y se  
puede reimprimir o enviar por correo.  
El sistema permite emitir notas de crédito para anulaciones o devoluciones. Solo el administrador  
puede hacerlo.  
Si SUNAT no responde, el comprobante queda en cola y se reintenta enviarlo automáticamente.  

#### HU-28: Registro de ingresos diarios  
Como administrador, quiero ver los ingresos de cada día, para controlar las finanzas. Prioridad: M  

### Épica 8: Reportes


#### HU-29: Reportes de ingresos y finanzas  
Como administrador, quiero reportes de ingresos filtrables y exportables, para analizar el negocio.  
Prioridad: M Criterios de aceptación:  
Se puede filtrar por rango de fechas, método de pago, concepto, plan, secretaria y código de  
descuento.  
Se exporta a Excel y PDF.  

#### HU-30: Reportes de asistencia  
Como administrador, quiero reportes de asistencia general, por alumno y por profesor, para controlar la  
operación. Prioridad: M  

#### HU-31: Reporte de mensualidades  
Como administrador, quiero un reporte de mensualidades con filtros (estado, plan, nivel, horario y mes),  
para hacer seguimiento a la cobranza. Prioridad: M  

#### HU-32: Dashboard  
Como administrador, quiero un panel con indicadores clave, para ver el estado de la academia de un  
vistazo. Prioridad: S Criterios de aceptación:  
Muestra:  
ingresos del día y del mes  
alumnos activos  
pagos pendientes de verificar  
ocupación por clase  
alumnos por vencer  

### Épica 9: Notificaciones


#### HU-42: WhatsApp al padre por inasistencia  
Como padre o apoderado, quiero recibir un mensaje de WhatsApp cuando mi hijo falta a su clase, para  
enterarme a tiempo. Prioridad: M Criterios de aceptación:  

<!-- Página 24 -->
Al terminar cada clase, más una tolerancia configurable (por defecto 15 minutos), el sistema revisa a  
los alumnos que tenían esa clase y no registraron asistencia.  
No se considera falta en estos casos:  
día de cierre de la piscina  
el alumno ya asistió ese día en otro horario autorizado  
el alumno tiene una recuperación agendada en esa misma hora  
Se envía un mensaje de WhatsApp por falta al celular del apoderado (o del alumno adulto),  
usando una plantilla aprobada por Meta de categoría «utilidad». Ejemplo: «Academia [Nombre]:  
[Alumno] no asistió hoy a su clase de las 16:00. Consultas: [teléfono]».  
El texto del mensaje lo configura el administrador. No incluye datos sensibles.  
Se guarda un registro de cada mensaje (fecha, número, estado enviado, entregado, leído o fallido) y  
se reintenta si falla.  
Si el número no tiene WhatsApp, el envío queda como fallido y se avisa a la secretaria. No se envía  
SMS como alternativa.  
El administrador puede activar o desactivar los avisos en todo el sistema o para un alumno en  
particular.  
Si la secretaria registra una asistencia manual tardía antes del envío, el mensaje no sale.  
En el formulario de inscripción, el apoderado acepta recibir avisos por WhatsApp. Meta exige este  
consentimiento.  

#### HU-33: Notificaciones  
Como alumno, quiero recibir avisos de pago verificado o rechazado, de vencimiento próximo y de clases  
restantes, para estar informado. Prioridad: C Criterios de aceptación:  
Los avisos llegan por WhatsApp, usando la misma integración de la HU-42.  

<!-- Página 25 -->

## 7. Requerimientos no funcionales

CódigoCategoría Requerimiento  
- RNF-01Usabilidad Interfaz web responsive: PC para recepción y celular para alumnos y entrenadores.  
- RNF-02Rendimiento La lectura del QR y la respuesta con el check verde toman menos de 2 segundos.  
- RNF-03Seguridad Contraseñas cifradas (bcrypt o argon2), HTTPS obligatorio y control de acceso por roles.  
- RNF-04Seguridad Cambio obligatorio de contraseña en el primer ingreso, ya que usar el DNI como contraseña  
es débil.  
- RNF-05Privacidad Cumplimiento de la Ley N.° 29733, Ley de Protección de Datos Personales del Perú. Los  
datos de salud y de menores son datos sensibles: requieren consentimiento expreso y  
acceso restringido.  
- RNF-06Auditoría Bitácora de acciones críticas: pagos, verificaciones, caja, cambios de horario y descuentos.  
- RNF-07DisponibilidadDisponibilidad del 99 % en el horario de operación (08:00 a 20:00).  
- RNF-08Respaldo Copias de seguridad diarias automáticas de la base de datos y de los archivos.  
- RNF-09AlmacenamientoAlmacenamiento de imágenes y videos en la nube con límites por archivo.  
- RNF-10CompatibilidadFunciona en Chrome, Edge, Safari y Firefox en sus versiones recientes.  
- RNF-11Exportación Reportes exportables a Excel (.xlsx) y PDF.  
- RNF-12Idioma y zona Español, zona horaria America/Lima y moneda Soles (S/).  

<!-- Página 26 -->

## 8. Propuesta del sistema


### 8.1 Nombre tentativo

AquaGestión, Sistema de Gestión para Academias de Natación (nombre sugerido y editable).  

### 8.2 Módulos

Administración  
Académico  
Recepción  
Público  
Planes y DescuentosReportes y DashboardUsuarios, Roles y Auditoría  
Alumnos  
Horarios, Clases y Aforo Entrenadores y Rendimiento  
MultimediaClases particulares  
Caja y Pagos  
Verificación de pagos  
Asistencia QR  
Inscripción en línea  
# Módulo Funciones  
1 Inscripción Formulario completo, elección de plan, nivel, días y horario, y código de descuento.  
2 Caja y Pagos Apertura y cierre, cobros, egresos y métodos de pago.  
3 Verificación de pagos Bandeja de Yape y transferencias con aprobación o rechazo.  
4 Asistencia QR Escáner, asistencia manual, check verde y clases restantes.  
5 Alumnos Ficha, estado de mensualidad, carnet digital y contraseña.  
6 Horarios y Clases Bloques de 08:00 a 20:00, niveles, aforo de 20 a 50 y asignación de entrenador.  
7 Entrenadores Horario, lista de alumnos y evaluación de rendimiento.  
8 Multimedia Fotos y videos por mes.  
9 Clases particulares Generar, autorizar, cobrar y registrar.  
10 Planes y Descuentos Configuración de planes y códigos de descuento.  
11 Reportes Finanzas, asistencia, mensualidades y dashboard.  

<!-- Página 27 -->
# Módulo Funciones  
12 Seguridad Usuarios, roles, auditoría y respaldo.  

### 8.3 Arquitectura propuesta

API REST + JWT  
WhatsApp Cloud API  
XML UBL 2.1 firmado vía web service  
Navegador PC de recepción con escáner QRFrontend web responsiveCelular del alumno o entrenadorBackend API  
Base de datos PostgreSQL  
Almacenamiento de archivos: fotos, videos y comprobantes  
Generador de PDF y Excel  
WhatsApp Business de MetaWhatsApp del padre o apoderado  
SUNAT  

### 8.4 Stack tecnológico sugerido

Capa Opción recomendada Alternativa  
Frontend React + Vite (o Next.js) con Tailwind CSS Vue 3  
Backend Laravel (PHP), elegido porque la librería Greenter resuelve  
la facturación con SUNAT  
Node.js (NestJS)  
Base de datos PostgreSQL MySQL  
Archivos AWS S3, Cloudflare R2 o almacenamiento local en el VPSGoogle Cloud Storage  
Lectura de QR Librería html5-qrcode (cámara web) o lectora QR USB—  
Generación de QRqrcode (Node) —  
Reportes ExcelJS y PDFKit (o Puppeteer) —  
Autenticación JWT con roles (RBAC) —  
Hosting VPS (DigitalOcean o Hetzner) o Railway/Render AWS  
Facturación  
electrónica  
Emisión propia a SUNAT con Greenter (librería libre en  
PHP)  
Un OSE o PSE (Nubefact), si SUNAT lo  
exige  
Mensajería WhatsApp Business Platform (Cloud API de Meta),  
conectada directamente sin intermediario  
Un proveedor intermediario de la  
misma API (Twilio, 360dialog)  
Tareas  
programadas  
Laravel Scheduler + Queues, para detectar faltas, enviar  
avisos por WhatsApp y reintentar comprobantes  
Cron  
Nota sobre Yape: Yape no ofrece una API pública para que comercios pequeños verifiquen pagos  
automáticamente. Por eso la verificación humana es la solución adecuada. La secretaria compara el  
comprobante con la notificación real de Yape en el celular de la academia. Para dar más seguridad, el  
sistema guarda el número de operación y bloquea duplicados.  

<!-- Página 28 -->

### 8.5 Decisión sobre la facturación electrónica

Decisión: programar la emisión directamente a SUNAT (sistema SEE – Del Contribuyente), usando la  
librería libre Greenter para PHP. Así no hay que pagar a un proveedor por cada comprobante.  
Aspecto Detalle  
Qué hace el  
sistema  
Genera el XML en formato UBL 2.1, lo firma con el certificado digital, lo envía al web service de SUNAT  
y guarda la respuesta (CDR). También genera el PDF con código QR para entregar al cliente.  
Boletas Se emiten al confirmar cada pago y se informan a SUNAT de forma individual o mediante el resumen  
diario.  
Facturas Se envían una por una, al confirmar el pago.  
Anulaciones Para facturas, mediante nota de crédito o comunicación de baja; para boletas, mediante resumen  
diario o nota de crédito.  
Requisitos de la  
academia  
RUC activo, clave SOL con un usuario secundario para el sistema, certificado digital tributario (costo  
anual aproximado de S/ 100 a S/ 300) y alta como emisor electrónico en SEE – Del Contribuyente.  
Entorno de  
pruebas  
Greenter trabaja con el entorno beta de SUNAT para probar antes de pasar a producción.  
Plan alternativoLa emisión queda detrás de una interfaz EmisorComprobantes. Si SUNAT obligara a usar un OSE,  
solo se cambia el adaptador.  
⚠  Validar con el contador antes del desarrollo: el régimen tributario, si aplica IGV (Q19), y que la  
academia no esté designada como obligada a usar OSE.  

### 8.5.1 Integración con WhatsApp

Aspecto Detalle  
Canal Solo WhatsApp, a través de la API oficial de Meta (WhatsApp Business Platform, Cloud API). No se usa  
SMS.  
Requisitos Cuenta de Meta Business de la academia (de preferencia verificada) y un número de celular exclusivo  
para el sistema. Ese número no puede estar en uso en la app de WhatsApp de un celular.  
Plantillas Los mensajes que inicia la academia deben usar plantillas aprobadas por Meta, por ejemplo  
«aviso_inasistencia» con las variables alumno, hora y teléfono. La aprobación suele tardar desde minutos  
hasta 1 o 2 días.  
Costo Meta cobra por mensaje según la categoría. Los avisos de inasistencia son de categoría «utilidad», que  
es de las más baratas. Verificar la tarifa vigente para Perú.  
Estados Por medio de un webhook, el sistema recibe si el mensaje fue enviado, entregado, leído o fallido.  
No  
recomendado  
Usar librerías no oficiales que simulan WhatsApp Web, porque Meta puede bloquear el número.  

### 8.6 Diseño del QR

El QR contiene un token único y aleatorio (por ejemplo, un UUID) asociado al alumno, no su DNI en  
texto plano.  
Si el alumno pierde el carnet, la secretaria puede regenerar el QR, y el anterior queda inválido.  

<!-- Página 29 -->
Mejora opcional: un QR dinámico en el celular que se renueva cada cierto tiempo para evitar  
capturas compartidas. El carnet físico conserva un QR fijo.  

### 8.7 Pantallas principales

Rol Pantallas  
Público /  
Cliente  
Formulario de inscripción, selección de horario, pago y subida de comprobante, estado de la solicitud.  
Secretaria Dashboard de recepción, escáner de asistencia, bandeja de verificación, cobros, caja (apertura,  
movimientos y cierre), buscador de alumnos, cambio de horario.  
Entrenador Mi horario, mis clases, ficha del alumno, evaluación de rendimiento, subida de multimedia.  
Alumno Carnet digital y QR, mi plan y clases restantes, mi horario, mi rendimiento, galería, cambio de contraseña.  
AdministradorDashboard, planes, clases y aforo, entrenadores, descuentos, clases particulares, reportes, usuarios y  
auditoría.  

### 8.8 Estados principales

Pago: PENDIENTE_VERIFICACION → CONFIRMADO | RECHAZADO. En efectivo el pago nace directamente como  
CONFIRMADO.  
Persona: CLIENTE → ALUMNO_ACTIVO → ALUMNO_VENCIDO → (renueva) → ALUMNO_ACTIVO. Además existe el  
estado INACTIVO.  
Matrícula mensual: RESERVADA → VIGENTE → FINALIZADA. También puede pasar a CANCELADA.  
Caja: ABIERTA → CERRADA. El administrador puede reabrirla.  
Clase particular: CREADA → AUTORIZADA → PAGADA → REALIZADA. También puede pasar a CANCELADA.  

<!-- Página 30 -->

## 9. Modelo de datos (preliminar)

USUARIO  
ALUMNOENTRENADOR  
APODERADOFICHA_MEDICAMATRICULA  
PLAN  
MATRICULA_CLASE  
CLASE  
PAGO  
DESCUENTO  
CAJA  
MOVIMIENTO_CAJA  
ASISTENCIA  
ASISTENCIA_ENTRENADOR EVALUACION MULTIMEDIA  
CLASE_PARTICULAR  
es  
es  
tiene  
tiene  
tiene  
define  
incluye  
recibe  
dicta  
se paga con  
aplica  
se registra en  
tiene  
registra  
en  
registra  
recibe  
realiza  
aparece en  
para  
dicta  
se paga con  

### 9.1 Entidades y atributos principales

Entidad Atributos clave  
USUARIO id, username (DNI), password_hash, rol, debe_cambiar_password, estado  
ALUMNO id, usuario_id, dni, nombres, apellidos, fecha_nacimiento, sexo, teléfono, email, dirección,  
colegio, grado_colegio, nivel_natacion, foto, qr_token, estado  
APODERADO id, alumno_id, nombres, dni, parentesco, teléfono, email  
FICHA_MEDICA alumno_id, tipo_sangre, alergias, enfermedades, medicamentos, seguro,  
contacto_emergencia, observaciones  
PLAN id, nombre, veces_por_semana, clases_por_mes, duracion_min, precio, dias_permitidos,  
franjas_permitidas, niveles_aplicables, vigencia_inicio, vigencia_fin, activo  
DIA_CIERRE id, fecha, todo_el_dia, hora_inicio, hora_fin, motivo, registrado_por  
RECUPERACION_CIERRE id, dia_cierre_id, clase_id, fecha_recuperacion, hora_recuperacion, definido_por  
PAGO_ENTRENADOR id, entrenador_id, periodo, monto, fecha_pago, concepto, metodo (EFECTIVO), origen  
(CAJA/EXTERNO), movimiento_caja_id, registrado_por, estado (CANCELADO)  
INASISTENCIA id, alumno_id, clase_id, fecha, matricula_id, notificada  
NOTIFICACION_WHATSAPP id, inasistencia_id, alumno_id, telefono_destino, plantilla, variables, wa_message_id, estado  
(PENDIENTE/ENVIADO/ENTREGADO/LEIDO/FALLIDO), motivo_fallo, intentos, fecha_envio  
CERTIFICADO id, alumno_id, motivo, fecha, codigo_verificacion, pdf_url, emitido_por  
CLASE id, nivel, dia_semana, hora_inicio, hora_fin, entrenador_id, aforo (20–50), activo  
MATRICULA id, alumno_id, plan_id, mes, año, fecha_inicio, fecha_fin, clases_totales, clases_usadas,  
es_proporcional, monto_calculado, monto_ajustado, motivo_ajuste, estado  

<!-- Página 31 -->
Entidad Atributos clave  
CLASE_RECUPERABLE id, alumno_id, matricula_origen_id, cantidad, usadas, fecha_limite, motivo, autorizado_por,  
estado  
RECUPERACION_AGENDADA id, clase_recuperable_id, clase_id, fecha, agendado_por, asistencia_id, estado  
COMPROBANTE id, pago_id, tipo (BOLETA/FACTURA/NOTA_CREDITO), serie, numero, doc_cliente  
(DNI/RUC), razon_social, monto, igv, pdf_url, xml_url, cdr_url, estado_sunat, intentos,  
fecha_emision  
MATRICULA_CLASE matricula_id, clase_id  
PAGO id, matricula_id / clase_particular_id, monto_bruto, descuento_id, monto_descuento,  
monto_neto, metodo (EFECTIVO/YAPE/TRANSFERENCIA), nro_operacion,  
foto_comprobante, estado, verificado_por, fecha_verificacion, motivo_rechazo, caja_id  
DESCUENTO id, codigo, tipo (%/monto), valor, fecha_inicio, fecha_fin, usos_max, usos_actuales,  
planes_aplicables, creado_por, activo  
CAJA id, fecha, usuario_apertura, monto_inicial, hora_apertura, usuario_cierre, monto_declarado,  
monto_esperado, diferencia, observacion, estado  
MOVIMIENTO_CAJA id, caja_id, tipo (INGRESO/EGRESO), concepto, metodo, monto, referencia_pago_id,  
usuario, fecha_hora  
ASISTENCIA id, alumno_id, clase_id, matricula_id, fecha_hora, metodo (QR/MANUAL), registrado_por  
ASISTENCIA_ENTRENADORid, entrenador_id, clase_id, fecha_hora, tardanza  
ENTRENADOR id, usuario_id, dni, nombres, teléfono, especialidad, qr_token  
EVALUACION id, alumno_id, entrenador_id, mes, año, tecnica_crol, tecnica_espalda, tecnica_pecho,  
tecnica_mariposa, resistencia, respiracion, tiempo_25m, tiempo_50m, nivel_recomendado,  
observaciones  
MULTIMEDIA id, tipo (FOTO/VIDEO), url, mes, año, alumno_id, subido_por, fecha  
CLASE_PARTICULAR id, alumno_id, entrenador_id, fecha, hora, duracion, precio, estado, creado_por,  
autorizado_por  
AUDITORIA id, usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues, fecha_hora, ip  

<!-- Página 32 -->

## 10. Reportes

Todos los reportes son exportables a Excel y PDF y tienen filtros por rango de fechas.  
# Reporte Filtros Contenido  
R1 Ingresos y finanzas Fechas, método de pago,  
concepto, plan, secretaria, código  
de descuento  
Totales por día, semana y mes, desglose por  
método y concepto, descuentos otorgados  
R2 Ingresos diarios Fecha Lista de cobros del día con totales por método  
R3 Cierres de caja Fechas, secretaria Apertura, ingresos, egresos, esperado, declarado y  
diferencia  
R4 Asistencia general Fechas, clase, nivel, horario,  
entrenador  
Asistentes por clase y porcentaje de ocupación  
R5 Asistencia por alumnoAlumno, mes Fechas asistidas, clases usadas y restantes, método  
(QR o manual)  
R6 Asistencia de  
profesores  
Entrenador, fechas Clases dictadas, tardanzas y faltas  
R7 Mensualidades Estado, plan, nivel, horario, mesAlumnos al día, por vencer, vencidos y pendientes  
de verificación  
R8 Pagos pendientes y  
rechazados  
Fechas, estado Lista de pagos por Yape o transferencia y su estado  
R9 Uso de descuentos Código, fechas Usos y monto descontado  
R10 Clases particulares Fechas, entrenador, estado Clases generadas, cobradas y realizadas  
R11 Ocupación de aforo Clase, nivel, horario Inscritos frente al aforo  
R12 Comprobantes  
electrónicos  
Fechas, tipo, estado SUNAT Boletas, facturas y notas de crédito emitidas,  
aceptadas o rechazadas  
R13 Excepciones del  
administrador  
Fechas, tipo Clases recuperables otorgadas, recuperaciones,  
asistencias fuera de horario y ajustes de montos  
proporcionales  
R14 Pagos a entrenadores Entrenador, periodo Pagos registrados como cancelados  
R15 Cierres y  
recuperaciones  
Fechas Días de cierre, clases afectadas y fechas de  
recuperación  
R16 Inasistencias y avisos  
por WhatsApp  
Fechas, alumno, clase, estado del  
mensaje  
Faltas registradas y mensajes enviados, entregados,  
leídos y fallidos  

<!-- Página 33 -->

## 11. Supuestos, riesgos y preguntas abiertas


### 11.1 Supuestos

1. El sistema será web, sin una app nativa. El alumno usa el navegador del celular, que puede instalarse  
como PWA.  
2. La lectura del QR la hace la secretaria en recepción, con una cámara o lectora conectada a la PC.  
3. Un alumno pertenece a un solo nivel a la vez.  
4. La mensualidad corresponde al mes calendario.  
5. La academia tiene RUC y clave SOL, y puede comprar un certificado digital tributario para emitir  
comprobantes directamente a SUNAT, sin proveedor intermediario.  
6. Los padres usan la misma cuenta del alumno (usuario: DNI del alumno). Si un padre tiene varios  
hijos, cada hijo tiene su propia cuenta.  
7. El pago a los entrenadores se hace en efectivo y fuera del sistema. El sistema solo registra el pago  
para que el entrenador lo consulte, y no calcula montos.  

### 11.2 Preguntas respondidas

# Pregunta Respuesta del cliente Dónde se  
refleja  
Q1 ¿Qué pasa con las clases no  
usadas a fin de mes?  
Normalmente no son recuperables, pero el administrador  
puede decidir hacerlas recuperables.  
- RN-23 y HU-35  
Q2 ¿Se puede recuperar una clase  
perdida?  
Normalmente no, pero el administrador puede decidir  
recuperarla.  
- RN-24 y HU-36  
Q3 ¿Cómo se cobra una inscripción  
a mitad de mes?  
En proporción a las clases que faltan según el plan, aunque  
el administrador puede decidir otro monto.  
- RN-25 y HU-34  
Q5 ¿Se requiere boleta o factura  
electrónica (SUNAT)?  
Sí. RN-26 y HU-37  
Q7 ¿Se cobra matrícula además de  
la mensualidad?  
No. RN-27  
Q4 ¿Qué planes existen? Son variados. El administrador decide los días, el precio, el  
aforo y demás condiciones.  
- RN-07 y HU-19  
Q6 ¿Cuánto tiempo se reserva el  
cupo de un pago por Yape?  
Lo decide la secretaria. El cupo se mantiene hasta que ella  
verifique el pago.  
- RN-28  
Q15 ¿Qué OSE o PSE usarán para  
facturar?  
Lo decide el equipo de desarrollo. Si es posible, se programa  
la emisión sin proveedor.  
- RN-26, HU-37 y  
sección 8.5  
Q16 ¿Se redondea el cobro  
proporcional?  
Sí. RN-25  
Q8 ¿Los padres tienen acceso?Sí, con la misma cuenta del alumno. RN-29  
Q9 ¿El alumno puede asistir en otro  
horario?  
Sí, si la secretaria lo autoriza. RN-30 y HU-38  
Q10 ¿Cómo se paga a los  
entrenadores?  
En efectivo y fuera del sistema. En su cuenta, el entrenador  
puede ver que su pago fue cancelado y su historial de pagos.  
- RN-31 y HU-39  

<!-- Página 34 -->
# Pregunta Respuesta del cliente Dónde se  
refleja  
Q11 ¿Quién ve las fotos y videos?Solo la cuenta del alumno. RN-19 y HU-22  
Q12 ¿Habrá certificados? Lo decide el administrador. RN-32 y HU-40  
Q13 ¿Qué pasa con los feriados y  
cierres?  
Las clases se recuperan y el administrador decide las fechas.RN-33 y HU-41  
Q14 ¿Se exige certificado médico?No. —  
Q17 ¿Hacia dónde se redondea el  
cobro proporcional?  
Hacia arriba. RN-25 y HU-34  
Q18 ¿El pago al entrenador sale de la  
caja?  
Lo decide el administrador: puede salir de la caja o de su  
propio bolsillo.  
- RN-35 y HU-39  
Q19 ¿Los precios incluyen IGV? No. RN-36  
Q20 ¿Por qué canal se avisa la  
inasistencia?  
Solo por WhatsApp. RN-34, HU-42 y  
sección 8.5.1  
Q21 ¿Se suma el IGV al precio? El precio no incluye IGV, así que se suma el 18 % al cobrar.RN-36  

### 11.3 Preguntas abiertas para el cliente

# Pregunta  
— No quedan preguntas abiertas del cliente. Solo falta la validación tributaria con el contador (ver sección 8.5).  

### 11.4 Riesgos

Riesgo Mitigación  
Capturas de Yape falsas o reutilizadas Verificación humana y bloqueo de números de operación duplicados  
Contraseña igual al DNI (fácil de adivinar)Cambio obligatorio en el primer ingreso y bloqueo tras varios intentos  
fallidos  
Suplantación con el QR de otro alumnoMostrar la foto del alumno al escanear y, opcionalmente, usar un QR  
dinámico  
Exposición de datos médicos y de menoresControl por roles, cifrado y consentimiento (Ley 29733)  
Costo de almacenamiento de videos Límites de tamaño, compresión y política de retención (por ejemplo, 12  
meses)  
Caída del servicio de SUNAT al emitir un  
comprobante  
Cola de envío con reintentos automáticos y alerta al administrador  
SUNAT designa a la academia como obligada  
a usar OSE  
La emisión se programa detrás de una interfaz (EmisorComprobantes),  
de modo que pasar a un OSE solo requiere cambiar el adaptador  
Vencimiento del certificado digital Alerta al administrador 30 días antes de que venza  
Cupos bloqueados por pagos pendientes que  
nunca se verifican  
Bandeja de pendientes ordenada por antigüedad, con alerta para los que  
llevan más de 48 h y opción de rechazar para liberar el cupo  
Cuenta compartida entre padres y alumno  
(una sola contraseña)  
Recomendar una contraseña que conozca toda la familia y permitir que la  
secretaria la restablezca  

<!-- Página 35 -->
Riesgo Mitigación  
Uso abusivo de las excepciones del  
administrador (recuperaciones o ajustes de  
monto)  
Motivo obligatorio, auditoría y reporte de excepciones  
Costo de los mensajes de WhatsApp (se paga  
por mensaje)  
Activar o desactivar por alumno, enviar un solo mensaje por falta y llevar  
el conteo mensual en R16  
Apoderado sin WhatsApp o con el número  
mal registrado  
Validar el formato peruano (9 dígitos, empieza con 9) y mostrar los envíos  
fallidos a la secretaria para corregir el número  
Meta rechaza la plantilla o bloquea el númeroUsar solo la API oficial, plantillas de categoría utilidad con texto neutral y  
pedir consentimiento en la inscripción  
Mensaje enviado por error (asistencia  
registrada tarde)  
Tolerancia antes del envío y registro auditado de cada envío  
Falla de internet en recepción Asistencia manual de respaldo y conexión de datos móviles alternativa  

<!-- Página 36 -->

## 12. Plan de implementación por fases

Fase Alcance Módulos  
Fase 1:  
MVP  
Operación  
básica  
Usuarios y roles, planes, clases y aforo, inscripción, pagos (efectivo, Yape y transferencia con  
verificación), carnet QR, asistencia por QR y manual, caja con apertura y cierre, control de  
mensualidades, cobro proporcional, facturación electrónica SUNAT, aviso de  
inasistencia por WhatsApp  
Fase 2 Gestión  
académica  
Panel del entrenador, rendimiento, multimedia, clases particulares, códigos de descuento,  
clases recuperables y agenda de recuperación, días de cierre, pagos a entrenadores,  
asistencia fuera de horario  
Fase 3 Inteligencia  
del negocio  
Reportes completos exportables, dashboard, asistencia de profesores, auditoría avanzada  
Fase 4  
(opcional)  
Extras Otros avisos por WhatsApp (pago verificado, vencimiento próximo), PWA instalable, QR  
dinámico, certificados  

<!-- Página 37 -->

## 13. Glosario

Término Definición  
Aforo Capacidad máxima de alumnos en una clase (de 20 a 50).  
Alumno Persona inscrita con al menos un pago confirmado.  
Carnet digital Credencial del alumno con su QR, visible en el celular o imprimible.  
Cliente Persona interesada o en proceso de inscripción sin pago confirmado.  
Matrícula Registro del alumno en un plan para un mes determinado.  
Plan Paquete de clases (por ejemplo, 3 veces por semana, 12 clases al mes).  
Piscina semiolímpicaPiscina de 25 m de largo.  
QR Código de respuesta rápida que identifica al alumno para la asistencia.  
Verificación de pago Revisión humana que confirma que un pago por Yape o transferencia llegó realmente.  
Yape Billetera digital peruana para pagos inmediatos.  
MoSCoW Técnica de priorización: Must, Should, Could y Won't.  

