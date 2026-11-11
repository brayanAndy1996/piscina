import { Injectable } from '@nestjs/common';
import type { Reloj } from './reloj';

/** Reloj de producción: la hora del sistema. */
@Injectable()
export class RelojSistema implements Reloj {
  ahora(): Date {
    return new Date();
  }
}
