// Lo único que los demás módulos pueden usar de esta carpeta. El cliente de Prisma es privado de `BaseDatos`.
export { BaseDatos } from './base-datos';
export { cerrarCursores } from './cursores';
export { ErrorAcademiaNoEncontrada, ErrorAcademiaSuspendida, ErrorRolBaseDatosInseguro } from './errores';
export { PrismaModule } from './prisma.module';
export type {
  AcademiaResuelta,
  ClienteTransaccion,
  OpcionesTransaccion,
  TransaccionAcademia,
  TransaccionPlataforma,
} from './tipos';
