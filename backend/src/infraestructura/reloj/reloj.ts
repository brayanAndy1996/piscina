/** Token para inyectar el reloj: `@Inject(RELOJ) private readonly reloj: Reloj`. */
export const RELOJ = Symbol('RELOJ');

/**
 * Hora actual inyectable. Todo el código del backend pide la hora a este reloj y no a `new Date()` ni a
 * `Date.now()` (lo exige una regla de ESLint), para poder probar los bordes de horario con `RelojFijo`.
 */
export interface Reloj {
  ahora(): Date;
}
