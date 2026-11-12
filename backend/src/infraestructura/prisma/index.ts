// Lo único que los demás módulos pueden usar de esta carpeta. El cliente de Prisma es privado de `BaseDatos`.
//
// Punto autorizado (spec 001, criterios 85, 112 y 114, precisión P-25): además de `BaseDatos` y los errores, exporta lo que un
// módulo necesita del cliente de Prisma sin importarlo: `Decimal` para los montos, los detectores de errores de la base y
// `sql`, `join` y `vacio` para componer fragmentos de SQL. No hay un equivalente de `Prisma.raw`.
import { Prisma } from '../../generated/prisma/client';

export { BaseDatos } from './base-datos';
export { cerrarCursores } from './cursores';
export { codigoDeErrorDeBase, esViolacionDeUnicidad } from './errores-base';
export {
  ErrorAcademiaNoEncontrada,
  ErrorAcademiaSuspendida,
  ErrorRolBaseDatosInseguro,
  ErrorTransaccionAbortada,
} from './errores';
export { comprobarTransaccionViva } from './transaccion-viva';
export {
  CausaLimpia,
  causaLimpia,
  errorParaRegistro,
  esErrorDeBase,
  type CircunstanciaDeLaCausa,
} from './registro-de-errores';
export { PrismaModule } from './prisma.module';
export { join, sql, vacio, type Fragmento, type ValorSql } from './sql-seguro';
export type {
  AcademiaResuelta,
  ClienteTransaccion,
  OpcionesTransaccion,
  TransaccionAcademia,
  TransaccionPlataforma,
} from './tipos';

/** La clase de decimales de Prisma (decimal.js), para los montos: nunca `number` con coma flotante. */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
