import type { Reloj } from './reloj';

/** Reloj para pruebas: la hora se fija y se avanza a mano. Devuelve copias, para que nadie mute la hora interna. */
export class RelojFijo implements Reloj {
  private milisegundos: number;

  constructor(inicial: Date) {
    this.milisegundos = inicial.getTime();
  }

  ahora(): Date {
    return new Date(this.milisegundos);
  }

  fijar(fecha: Date): void {
    this.milisegundos = fecha.getTime();
  }

  avanzar(milisegundos: number): void {
    this.milisegundos += milisegundos;
  }
}
