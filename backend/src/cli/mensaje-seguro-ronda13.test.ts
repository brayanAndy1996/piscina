// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { DNI_DE_PRUEBA } from '../../test/utilidades/ronda13';
import { Prisma } from '../../test/utilidades/ronda3';
import { mensajeSeguro } from './mensaje-seguro';

// Criterio 162 (ataque ronda 13, O1; precisa el criterio 149 y P-40), prueba unitaria de `mensajeSeguro` (backend/src/cli/mensaje-seguro.ts, que
// usan los comandos y la semilla) con un error con forma de error de Prisma: el texto contiene el codigo de Prisma (`P2002`) y no el valor que
// viaja en el mensaje de Prisma (`44556677`). Con cualquier otro error, `mensajeSeguro` sigue como hoy (lo cubre `mensaje-seguro.test.ts`).

describe('criterio 162: mensajeSeguro con un error de Prisma o de la base no copia el mensaje ni los valores', () => {
  it('criterio 162: con un error con forma de error de Prisma (P2002), el texto contiene P2002 y no el valor', () => {
    const error = Object.assign(new Error(`Unique constraint failed on the fields: (\`dni\`) = (${DNI_DE_PRUEBA})`), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      meta: { modelName: 'Auditoria', target: ['dni'] },
    });

    const texto = mensajeSeguro(error, []);

    expect(texto).toContain('P2002');
    expect(texto).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 162: con un PrismaClientKnownRequestError real (P2002), el texto contiene P2002 y no el valor', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      `Unique constraint failed on the fields: (\`dni\`) = (${DNI_DE_PRUEBA})`,
      {
        code: 'P2002',
        clientVersion: 'prueba',
        meta: { modelName: 'Auditoria', target: ['dni'] },
      },
    );

    const texto = mensajeSeguro(error, []);

    expect(texto).toContain('P2002');
    expect(texto).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 162: con un error de la base que solo trae SQLSTATE (22P02) y el valor en el mensaje, el texto contiene el SQLSTATE y no el valor', () => {
    const error = Object.assign(new Error(`invalid input syntax for type inet: "DNI ${DNI_DE_PRUEBA}"`), {
      name: 'DriverAdapterError',
      cause: { originalCode: '22P02', originalMessage: `"DNI ${DNI_DE_PRUEBA}"` },
    });

    const texto = mensajeSeguro(error, []);

    expect(texto).toContain('22P02');
    expect(texto).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 162: el texto sigue siendo de una sola linea y de a lo sumo 300 caracteres', () => {
    const error = Object.assign(new Error(`primera ${DNI_DE_PRUEBA}\nsegunda linea ${DNI_DE_PRUEBA}`), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });

    const texto = mensajeSeguro(error, []);

    expect(texto).not.toContain('\n');
    expect(texto.length).toBeLessThanOrEqual(301);
    expect(texto).not.toContain(DNI_DE_PRUEBA);
  });

  it('criterio 162 (control): con un Error comun, mensajeSeguro devuelve su primera linea como hoy', () => {
    expect(mensajeSeguro(new Error('algo fallo\nsegunda linea'), [])).toBe('algo fallo');
  });
});
