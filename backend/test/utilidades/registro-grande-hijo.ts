// spec: 001-academias-aislamiento (pruebas protegidas)
import { InternalServerErrorException } from '@nestjs/common';
import { errorParaRegistro } from '../../src/infraestructura/prisma';

/**
 * Script del proceso hijo de (t11), criterio 167 (ataque ronda 16): lo ejecuta `registro-de-errores-memoria-ronda16.test.ts` con
 * `process.execPath --max-old-space-size=256 --import tsx`. Ejecuta `errorParaRegistro` con (t1) (solo la excepcion), (t3) y (t4) y escribe
 * por la salida estandar una linea JSON por caso: `{ caso, mismo, truncado, conMensaje }`. Con el codigo de `8b503d2` el proceso termina
 * por falta de memoria; con la busqueda acotada termina con codigo 0.
 */

interface Resultado {
  caso: string;
  mismo: boolean;
  truncado: boolean;
  conMensaje: boolean;
}

function resumir(caso: string, entrada: unknown): Resultado {
  const resultado = errorParaRegistro(entrada);
  const objeto = (typeof resultado === 'object' && resultado !== null ? resultado : {}) as Record<string, unknown>;
  return {
    caso,
    mismo: resultado === entrada,
    truncado: objeto['truncado'] === true,
    conMensaje: typeof objeto['mensaje'] === 'string',
  };
}

const casos: [string, () => unknown][] = [
  [
    't1',
    () =>
      new InternalServerErrorException('No se pudo procesar el comprobante', {
        cause: Object.assign(new Error('No se pudo subir el comprobante'), {
          archivo: Buffer.alloc(5 * 1024 * 1024, 'COMPROBANTE-R16 DNI 44556677 '),
        }),
      }),
  ],
  ['t3', () => Object.assign(new Error('lista r16'), { lista: new Array<number>(2_000_000).fill(0) })],
  ['t4', () => Object.assign(new Error('texto r16'), { texto: new String('x'.repeat(5_000_000)) })],
];

errorParaRegistro(new Error('calentamiento'));
for (const [caso, construir] of casos) {
  process.stdout.write(`${JSON.stringify(resumir(caso, construir()))}\n`);
}
