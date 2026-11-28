// Contrato público del módulo de asistencia (spec 009): el marcado por QR y manual y el registro posterior, las faltas y su tarea programada, y la consulta del mes (`ConsultaDeAsistenciaService`: `delMes` para el personal y, desde la 011, `delMesDelUsuario` para el alumno de la sesión).
export { AsistenciaModule } from './asistencia.module';
export { ConsultaDeAsistenciaService } from './consulta.service';
export { FaltasService } from './faltas.service';
export { MarcadoService } from './marcado.service';
export { TareasAsistenciaModule } from './tareas-asistencia.module';
