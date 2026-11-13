import { Inject, Injectable } from '@nestjs/common';
import { ENTORNO, type Entorno } from '../entorno';
import { RELOJ, type Reloj } from '../reloj';
import { type ClaimsSesion, firmarToken, verificarToken } from './tokens';

/** Firma y verifica tokens de sesión con `JWT_SECRETO` y la hora del reloj inyectable. */
@Injectable()
export class ServicioTokens {
  constructor(
    @Inject(ENTORNO) private readonly entorno: Entorno,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  firmar(datos: Pick<ClaimsSesion, 'sub' | 'tipo' | 'ver'>, duracionSegundos: number): string {
    return firmarToken(datos, this.entorno.JWT_SECRETO, this.reloj.ahora(), duracionSegundos);
  }

  verificar(token: string): ClaimsSesion | null {
    return verificarToken(token, this.entorno.JWT_SECRETO, this.reloj.ahora());
  }
}
