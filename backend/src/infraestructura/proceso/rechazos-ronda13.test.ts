// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { ALERGIA_DE_PRUEBA, DNI_DE_PRUEBA, textoCompleto } from '../../../test/utilidades/ronda13';
import { cargarFuncionalidad, Prisma } from '../../../test/utilidades/ronda3';

// Criterio 162 (ataque ronda 13, O1; precision de P-40), prueba unitaria de `crearManejadorDeRechazos(registro)`
// (backend/src/infraestructura/proceso/rechazos.ts) con un registro falso y un `PrismaClientValidationError` (el error (a) del criterio):
// `registro.error` se llama con `{ err: X }` y `util.inspect(X, { depth: null })` no contiene los valores del mensaje de Prisma (que muestra
// el `data` completo de la consulta). Con un `Error` que no es de la base, `X` sigue siendo el mismo error (criterio 157 sin cambios).

interface RegistroFalso {
  error(datos: object, mensaje: string): void;
}
type CrearManejador = (registro: RegistroFalso) => (motivo: unknown) => void;

async function cargarCrearManejador(): Promise<CrearManejador> {
  const modulo = await cargarFuncionalidad<{ crearManejadorDeRechazos: CrearManejador }>(
    'infraestructura/proceso/rechazos.ts',
    ['crearManejadorDeRechazos'],
  );
  return modulo.crearManejadorDeRechazos;
}

/** Un `PrismaClientValidationError` como el que Prisma lanza con un campo que el modelo no tiene: su mensaje muestra el `data` completo. */
function errorDeValidacion(): Error {
  return new Prisma.PrismaClientValidationError(
    [
      'Invalid `prisma.configuracion.create()` invocation:',
      '',
      '{',
      '  data: {',
      '    clave: "prueba_r13_1",',
      '    valor: {},',
      `    dni: "${DNI_DE_PRUEBA}",`,
      `    alergias: "${ALERGIA_DE_PRUEBA}"`,
      '    ~~~~~~~~',
      '  }',
      '}',
      '',
      'Unknown argument `dni`. Available options are marked with ?.',
    ].join('\n'),
    { clientVersion: 'prueba' },
  );
}

function registrar(motivo: unknown, crear: CrearManejador): { datos: Record<string, unknown>; mensaje: string }[] {
  const llamadas: { datos: Record<string, unknown>; mensaje: string }[] = [];
  const registro: RegistroFalso = {
    error: (datos, mensaje) => {
      llamadas.push({ datos: datos as Record<string, unknown>, mensaje });
    },
  };
  crear(registro)(motivo);
  return llamadas;
}

describe('criterio 162: crearManejadorDeRechazos registra un error de Prisma sin sus valores (P-40)', () => {
  it('criterio 162: con un PrismaClientValidationError, registro.error se llama una vez con { err: X } y X no contiene los valores', async () => {
    const crear = await cargarCrearManejador();

    const llamadas = registrar(errorDeValidacion(), crear);

    expect(llamadas).toHaveLength(1);
    const [{ datos, mensaje }] = llamadas as [{ datos: Record<string, unknown>; mensaje: string }];
    expect(Object.keys(datos), 'solo { err }').toEqual(['err']);
    const texto = textoCompleto(datos['err']);
    expect(texto).not.toContain(DNI_DE_PRUEBA);
    expect(texto).not.toContain(ALERGIA_DE_PRUEBA);
    expect(texto).not.toContain('alergias');
    expect(JSON.stringify([datos, mensaje])).not.toContain(DNI_DE_PRUEBA);
    expect(textoCompleto(datos['err']), 'lleva el tipo del error').toContain('PrismaClientValidationError');
  });

  it('criterio 162: un error de la base con SQLSTATE y el valor en el mensaje tampoco llega al registro con el valor', async () => {
    const crear = await cargarCrearManejador();
    const error = Object.assign(new Error(`invalid input syntax for type inet: "DNI ${DNI_DE_PRUEBA}"`), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2007',
      meta: { driverAdapterError: { cause: { originalCode: '22P02', originalMessage: `"DNI ${DNI_DE_PRUEBA}"` } } },
    });

    const llamadas = registrar(error, crear);

    expect(llamadas).toHaveLength(1);
    const texto = textoCompleto(llamadas[0]?.datos['err']);
    expect(texto).not.toContain(DNI_DE_PRUEBA);
    expect(texto, 'lleva el codigo de Prisma').toContain('P2007');
    expect(texto, 'lleva el SQLSTATE').toContain('22P02');
  });

  it('criterio 162 (control, 157 sin cambios): con un Error que no es de la base, registro.error recibe { err: <el mismo error> }', async () => {
    const crear = await cargarCrearManejador();
    const error = new Error('fallo comun de prueba r13');

    const llamadas = registrar(error, crear);

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.datos['err'], 'el mismo error, no una copia').toBe(error);
  });

  it('criterio 162 (control, 157 sin cambios): con un valor que no es un Error, registro.error recibe solo { tipo }', async () => {
    const crear = await cargarCrearManejador();

    const llamadas = registrar({ dni: DNI_DE_PRUEBA }, crear);

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.datos).toEqual({ tipo: 'object' });
  });
});
