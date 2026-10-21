export const ROLE_PERMISSIONS = {
  ADMIN: ['users.read', 'users.manage', 'roles.read', 'devices.read', 'devices.manage', 'audit.read', 'offline.use', 'academy.read', 'academy.manage', 'students.read', 'students.manage', 'enrollments.manage', 'cash.write', 'payments.write', 'attendance.write', 'cash.read.all', 'notices.manage'],
  SECRETARIA: ['devices.read', 'offline.use', 'academy.read', 'students.read', 'students.manage', 'enrollments.manage', 'cash.write', 'payments.write', 'attendance.write'],
  ENTRENADOR: ['assigned.read'],
  ALUMNO: ['portal.read'],
} as const;
export type Role = keyof typeof ROLE_PERMISSIONS;
export class AccessError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function validRole(value: unknown): asserts value is Role {
  if (typeof value !== 'string' || !Object.hasOwn(ROLE_PERMISSIONS, value)) throw new AccessError(400, 'INVALID_ROLE', 'Rol inválido.');
}
export function passwordPolicy(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new AccessError(400, 'INVALID_PASSWORD', 'La contraseña debe tener de 12 a 128 caracteres.');
}
export function text(value: unknown, field: string, max = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new AccessError(400, 'INVALID_INPUT', `Campo inválido: ${field}.`);
  return value.trim();
}
export function loginName(value: unknown): string {
  const normalized = text(value, 'usuario', 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) throw new AccessError(400, 'INVALID_LOGIN', 'Usuario o academia inválidos.');
  return normalized;
}
export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new AccessError(400, 'INVALID_ID', 'Identificador inválido.');
  return value;
}
