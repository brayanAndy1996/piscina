// Lo único que los demás módulos pueden usar de esta carpeta. `PrismaService` es interno a propósito.
export { BaseDatos } from './base-datos';
export { ErrorAcademiaNoEncontrada, ErrorAcademiaSuspendida, ErrorRolBaseDatosInseguro } from './errores';
export { PrismaModule } from './prisma.module';
export type {
  AcademiaResuelta,
  ClienteTransaccion,
  OpcionesTransaccion,
  TransaccionAcademia,
  TransaccionPlataforma,
} from './tipos';
