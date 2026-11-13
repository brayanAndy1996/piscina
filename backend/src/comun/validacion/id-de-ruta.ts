import { Injectable, NotFoundException, type PipeTransform } from '@nestjs/common';
import { PATRON_UUID } from './patron-uuid';

/**
 * Pipe para un identificador de la dirección (`/academias/:id/...`): si no es un UUID, el recurso no puede existir y
 * se responde 404 `NO_ENCONTRADO` (igual que un UUID que no existe), sin llegar a la base. Devuelve el id en
 * minúsculas.
 */
@Injectable()
export class IdDeRuta implements PipeTransform<unknown, string> {
  transform(valor: unknown): string {
    if (typeof valor !== 'string' || !PATRON_UUID.test(valor)) throw new NotFoundException();
    return valor.toLowerCase();
  }
}
