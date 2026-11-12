// spec: 001-academias-aislamiento (pruebas protegidas)
import { HttpException, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ErrorNegocio } from '../../comun/errores/error-negocio';
import {
  cargarClaseAbortada,
  cargarRegistroDeErrores,
  comoObjeto,
  propiasComoJson,
  textoCompleto,
} from '../../../test/utilidades/ronda13';
import { MARCO_F, MARCO_G } from '../../../test/utilidades/ronda14';
import {
  comprobarConvertido,
  comprobarSinValoresR15,
  crearBase,
  DNI_R15,
  MENSAJE_BASE_R15,
  NOMBRE_DE_PRISMA_R15,
  soloMarcos,
} from '../../../test/utilidades/ronda15';
import { Prisma } from '../../../test/utilidades/ronda3';

// Criterios 165 y 166 (ataque ronda 15, F1 y O1; ampliacion del criterio 162, precision del 163 y de P-42), pruebas unitarias de
// `errorParaRegistro` y `causaLimpia` (backend/src/infraestructura/prisma/index.ts) con las excepciones reales de `@nestjs/common` y un
// error falso con forma de error de Prisma (`base`: name `PrismaClientKnownRequestError`, code `P2007`, mensaje
// `invalid input syntax for type inet: "DNI 44556677 alergia penicilina-r15"`, stack con ese encabezado exacto y dos marcos).
//
// 165: el patron `throw new InternalServerErrorException(error)` deja el error de Prisma entero en `response` y Nest copia su mensaje a
// `message`; `errorParaRegistro` lo devolvia tal cual y pino serializaba `message`, `stack` y `response`. Ahora busca errores de la base en
// todo el grafo del error (propiedades propias enumerables o no, con `Symbol`, y enumerables heredadas) y, si encuentra alguno, devuelve un
// objeto plano nuevo con solo `tipo`, `mensaje`, `pila`, `causa`, `errores`, `erroresDeLaBase` y `truncado`. En cada caso (salvo los
// controles): el resultado no es el mismo objeto, no lanza, `util.inspect` con `showHidden`, `JSON.stringify` y pino no contienen
// `44556677`, `penicilina-r15` ni `invalid input syntax`, y la forma limpia de `base` aparece exactamente una vez.
//   (u1) la excepcion de Nest con `base` como respuesta; (u2) `HttpException(base, 503)` y `ServiceUnavailableException(base)`;
//   (u3) anidado en objetos; (u4) propiedad propia cualquiera; (u5) no enumerable y con `Symbol`; (u6) heredada; (u7) ciclo;
//   (u8) control con `{ cause }`; (u9) el mismo en dos lugares; (u10) intermedio; (u11) copia parcial del mensaje; (u12) topes;
//   (u13) mensaje no verificable; (u14) controles, el mismo objeto.
// 166: el `tipo` de un error de la base sale de una lista cerrada (o1) a (o5).

async function convertir(entrada: unknown): Promise<unknown> {
  const { errorParaRegistro } = await cargarRegistroDeErrores();
  expect(() => errorParaRegistro(entrada), 'errorParaRegistro no debe lanzar').not.toThrow();
  return errorParaRegistro(entrada);
}

const DOS_MARCOS = `${MARCO_F}\n${MARCO_G}`;

/** Comprobaciones de que `limpia` es la forma limpia de `base` (criterios 162, 163 y 166). */
function esLaFormaLimpiaDeBase(limpia: unknown, contexto: string): void {
  const objeto = comoObjeto(limpia, contexto);
  expect(objeto['tipo'], `${contexto}: tipo`).toBe(NOMBRE_DE_PRISMA_R15);
  expect(objeto['codigoPrisma'], `${contexto}: codigoPrisma`).toBe('P2007');
  expect(objeto['pila'], `${contexto}: pila`).toBe(DOS_MARCOS);
}

/** (u1) con su comprobacion previa: `response` es `base` y `message` contiene el valor. */
function crearU1(): InternalServerErrorException {
  const base = crearBase();
  const excepcion = new InternalServerErrorException(base);
  expect(excepcion.getResponse(), 'precondicion: response es base').toBe(base);
  expect(excepcion.message, 'precondicion: message contiene el valor').toContain(DNI_R15);
  return excepcion;
}

function sinEnumerar(error: Error, clave: string | symbol, valor: unknown): void {
  Object.defineProperty(error, clave, { value: valor, enumerable: false, writable: true, configurable: true });
}

describe('criterio 165 (u1): la excepcion de Nest con el error de la base como respuesta (reproduccion)', () => {
  it('criterio 165 (u1): InternalServerErrorException(base): tipo de la excepcion, sin mensaje ni pila, base en erroresDeLaBase', async () => {
    const excepcion = crearU1();

    const resultado = comprobarConvertido(await convertir(excepcion), excepcion, 'u1', 1);

    expect(resultado['tipo']).toBe('InternalServerErrorException');
    expect(resultado['mensaje'], 'el message de Nest copia el de la base: no sale').toBeUndefined();
    expect(resultado['pila'], 'el stack de Nest lleva el mensaje de la base en el encabezado: no sale').toBeUndefined();
    expect(resultado['causa']).toBeUndefined();
    expect(resultado['errores']).toBeUndefined();
    const encontrados = resultado['erroresDeLaBase'] as unknown[];
    expect(encontrados).toHaveLength(1);
    esLaFormaLimpiaDeBase(encontrados[0], 'u1 erroresDeLaBase[0]');
  });
});

describe('criterio 165 (u2): HttpException(base, 503) y las demas excepciones de 5xx', () => {
  it.each([
    ['HttpException(base, 503)', 'HttpException', (base: Error) => new HttpException(base, 503)],
    [
      'ServiceUnavailableException(base)',
      'ServiceUnavailableException',
      (base: Error) => new ServiceUnavailableException(base),
    ],
  ])('criterio 165 (u2): %s: tipo %s, sin mensaje ni pila, base en erroresDeLaBase', async (_nombre, tipo, crear) => {
    const base = crearBase();
    const excepcion = crear(base);
    expect(excepcion.getResponse(), 'precondicion: response es base').toBe(base);
    expect(excepcion.message, 'precondicion: message contiene el valor').toContain(DNI_R15);

    const resultado = comprobarConvertido(await convertir(excepcion), excepcion, 'u2', 1);

    expect(resultado['tipo']).toBe(tipo);
    expect(resultado['mensaje']).toBeUndefined();
    expect(resultado['pila']).toBeUndefined();
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });
});

describe('criterio 165 (u3): el error de la base anidado en objetos', () => {
  it('criterio 165 (u3): InternalServerErrorException({ detalle: { error: base } }): la base sale una sola vez, en erroresDeLaBase', async () => {
    const excepcion = new InternalServerErrorException({ detalle: { error: crearBase() } });

    const resultado = comprobarConvertido(await convertir(excepcion), excepcion, 'u3', 1);

    expect(resultado['tipo']).toBe('InternalServerErrorException');
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });

  it('criterio 165 (u3): dentro de un arreglo de un objeto de otro objeto, a varios niveles', async () => {
    const excepcion = new InternalServerErrorException({ a: { b: [{ c: { d: crearBase() } }] } });

    const resultado = comprobarConvertido(await convertir(excepcion), excepcion, 'u3 hondo', 1);

    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });
});

describe('criterio 165 (u4): una propiedad propia cualquiera', () => {
  it('criterio 165 (u4): Object.assign(new Error(...), { detalle: base }): conserva su mensaje, la pila son solo marcos y la base sale una vez', async () => {
    const error = Object.assign(new Error('Fallo de prueba r15'), { detalle: crearBase() });

    const resultado = comprobarConvertido(await convertir(error), error, 'u4', 1);

    expect(resultado['tipo']).toBe('Error');
    expect(resultado['mensaje']).toBe('Fallo de prueba r15');
    soloMarcos(resultado['pila'], 'u4');
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
    esLaFormaLimpiaDeBase((resultado['erroresDeLaBase'] as unknown[])[0], 'u4 erroresDeLaBase[0]');
  });
});

describe('criterio 165 (u5): propiedad no enumerable y propiedad con clave Symbol', () => {
  it('criterio 165 (u5): base en una propiedad definida con enumerable: false', async () => {
    const error = new Error('Fallo r15');
    sinEnumerar(error, 'escondida', crearBase());

    const resultado = comprobarConvertido(await convertir(error), error, 'u5 no enumerable', 1);

    expect(resultado['mensaje']).toBe('Fallo r15');
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });

  it('criterio 165 (u5): base en una propiedad con clave Symbol', async () => {
    const error = new Error('Fallo r15');
    (error as unknown as Record<symbol, unknown>)[Symbol('r15')] = crearBase();

    const resultado = comprobarConvertido(await convertir(error), error, 'u5 symbol', 1);

    expect(resultado['mensaje']).toBe('Fallo r15');
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });

  it('criterio 165 (u5): Symbol no enumerable', async () => {
    const error = new Error('Fallo r15');
    sinEnumerar(error, Symbol('r15 oculto'), crearBase());

    const resultado = comprobarConvertido(await convertir(error), error, 'u5 symbol no enumerable', 1);

    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });

  it('criterio 165 (u5): el mismo error de la base en una propiedad no enumerable y en otra con Symbol sale una sola vez', async () => {
    const base = crearBase();
    const error = new Error('Fallo r15');
    sinEnumerar(error, 'escondida', base);
    sinEnumerar(error, Symbol('r15'), base);

    const resultado = comprobarConvertido(await convertir(error), error, 'u5 repetido', 1);

    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });
});

describe('criterio 165 (u6): propiedad enumerable heredada del prototipo', () => {
  it('criterio 165 (u6): class ConExtra extends Error con ConExtra.prototype.extra = base', async () => {
    class ConExtra extends Error {}
    (ConExtra.prototype as unknown as Record<string, unknown>)['extra'] = crearBase();
    const error = new ConExtra('Fallo r15');

    const resultado = comprobarConvertido(await convertir(error), error, 'u6', 1);

    expect(resultado['tipo'], 'su name (Error) no es el de su constructor (ConExtra)').toBe('Error');
    expect(resultado['mensaje']).toBe('Fallo r15');
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });
});

describe('criterio 165 (u7): ciclo en el grafo', () => {
  it('criterio 165 (u7): e.detalle = { vuelta: e, error: base }: no lanza, no se queda en el ciclo y la base sale una vez', async () => {
    const error = new Error('Fallo r15');
    (error as unknown as Record<string, unknown>)['detalle'] = { vuelta: error, error: crearBase() };

    const resultado = comprobarConvertido(await convertir(error), error, 'u7', 1);

    expect(resultado['mensaje']).toBe('Fallo r15');
    expect(resultado['truncado'], 'un ciclo no es un tope agotado').toBeUndefined();
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });

  it('criterio 165 (u7): un ciclo en la cadena de cause (a -> b -> a) con la base en otra propiedad: la vuelta se marca como truncado', async () => {
    const a = new Error('a r15');
    const b = new Error('b r15', { cause: a });
    (a as unknown as Record<string, unknown>)['cause'] = b;
    (a as unknown as Record<string, unknown>)['detalle'] = crearBase();

    const resultado = comprobarConvertido(await convertir(a), a, 'u7 cadena', 1);

    expect(resultado['mensaje']).toBe('a r15');
    const causa = comoObjeto(resultado['causa'], 'u7 causa');
    expect(causa['tipo']).toBe('Error');
    expect(causa['mensaje']).toBe('b r15');
    expect(comoObjeto(causa['causa'], 'u7 causa de la causa')).toEqual({ tipo: 'truncado' });
  });
});

describe('criterio 165 (u8): control con { cause } (el patron correcto)', () => {
  it('criterio 165 (u8): InternalServerErrorException("No se pudo", { cause: base }): conserva el mensaje, la base va en causa y no hay erroresDeLaBase', async () => {
    const excepcion = new InternalServerErrorException('No se pudo', { cause: crearBase() });

    const resultado = comprobarConvertido(await convertir(excepcion), excepcion, 'u8', 1);

    expect(resultado['tipo']).toBe('InternalServerErrorException');
    expect(resultado['mensaje']).toBe('No se pudo');
    esLaFormaLimpiaDeBase(resultado['causa'], 'u8 causa');
    expect(resultado['erroresDeLaBase'], 'la base ya esta en causa (aunque options tambien la lleva)').toBeUndefined();
  });
});

describe('criterio 165 (u9): el mismo error de la base en dos lugares', () => {
  it('criterio 165 (u9): InternalServerErrorException(base, { cause: base }): una sola vez, en causa, y sin mensaje', async () => {
    const base = crearBase();
    const excepcion = new InternalServerErrorException(base, { cause: base });
    expect(excepcion.message, 'precondicion: message contiene el valor').toContain(DNI_R15);

    const resultado = comprobarConvertido(await convertir(excepcion), excepcion, 'u9', 1);

    expect(resultado['mensaje']).toBeUndefined();
    esLaFormaLimpiaDeBase(resultado['causa'], 'u9 causa');
    expect(resultado['erroresDeLaBase']).toBeUndefined();
  });

  it('criterio 165 (u9): la misma base en la causa y en una propiedad propia: una sola vez, en causa', async () => {
    const base = crearBase();
    const error = Object.assign(new Error('Fallo r15', { cause: base }), { detalle: base });

    const resultado = comprobarConvertido(await convertir(error), error, 'u9 propia', 1);

    expect(resultado['mensaje']).toBe('Fallo r15');
    esLaFormaLimpiaDeBase(resultado['causa'], 'u9 propia causa');
    expect(resultado['erroresDeLaBase']).toBeUndefined();
  });
});

describe('criterio 165 (u10): la excepcion de Nest en medio de la cadena', () => {
  it('criterio 165 (u10): new Error("Fallo r15", { cause: InternalServerErrorException(base) }): mensaje propio y causa sin mensaje ni pila', async () => {
    const error = new Error('Fallo r15', { cause: crearU1() });

    const resultado = comprobarConvertido(await convertir(error), error, 'u10', 1);

    expect(resultado['tipo']).toBe('Error');
    expect(resultado['mensaje']).toBe('Fallo r15');
    const causa = comoObjeto(resultado['causa'], 'u10 causa');
    expect(causa['tipo']).toBe('InternalServerErrorException');
    expect(causa['mensaje'], 'la excepcion copia el mensaje de la base: no sale').toBeUndefined();
    expect(causa['pila'], 'la pila de la excepcion lleva el mensaje de la base: no sale').toBeUndefined();
  });
});

describe('criterio 165 (u11): un mensaje o una pila que copian el de la base por otro camino', () => {
  it('criterio 165 (u11): un Error cuyo mensaje esta contenido en el de la base, con base como cause: sin mensaje', async () => {
    const error = new Error('invalid input syntax for type inet', { cause: crearBase() });

    const resultado = comprobarConvertido(await convertir(error), error, 'u11 contenido', 1);

    expect(resultado['mensaje']).toBeUndefined();
    esLaFormaLimpiaDeBase(resultado['causa'], 'u11 causa');
  });

  it('criterio 165 (u11): un Error cuyo mensaje es el de la base, con base en otra propiedad: sin mensaje', async () => {
    const error = Object.assign(new Error(MENSAJE_BASE_R15), { detalle: crearBase() });

    const resultado = comprobarConvertido(await convertir(error), error, 'u11 igual', 1);

    expect(resultado['mensaje']).toBeUndefined();
    expect(resultado['pila'], 'su stack lleva el mensaje de la base: no sale').toBeUndefined();
  });

  it('criterio 165 (u11): un Error cuyo mensaje contiene el de la base y algo mas, con base en otra propiedad: sin mensaje', async () => {
    const error = Object.assign(new Error(`falla de prueba: ${MENSAJE_BASE_R15} (fin)`), { detalle: crearBase() });

    const resultado = comprobarConvertido(await convertir(error), error, 'u11 contiene', 1);

    expect(resultado['mensaje']).toBeUndefined();
    expect(resultado['pila']).toBeUndefined();
  });

  it('criterio 165 (u11): un Error sin relacion con el mensaje de la base conserva su mensaje', async () => {
    const error = Object.assign(new Error('Fallo r15 sin relacion'), { detalle: crearBase() });

    const resultado = comprobarConvertido(await convertir(error), error, 'u11 sin relacion', 1);

    expect(resultado['mensaje']).toBe('Fallo r15 sin relacion');
  });
});

describe('criterio 165 (u12): topes con falla cerrada', () => {
  function comprobarTruncado(resultado: unknown, entrada: unknown, contexto: string): Record<string, unknown> {
    const objeto = comprobarConvertido(resultado, entrada, contexto);
    expect(objeto['truncado'], `${contexto}: truncado`).toBe(true);
    expect(objeto['tipo'], `${contexto}: tipo`).toBe('Error');
    for (const clave of ['mensaje', 'pila', 'causa', 'errores']) {
      expect(objeto[clave], `${contexto}: sin ${clave}`).toBeUndefined();
    }
    return objeto;
  }

  it('criterio 165 (u12): una cadena de 30 Error por cause con la base al final: truncado, sin mensaje ni pila', async () => {
    let error: Error = crearBase();
    for (let i = 0; i < 30; i += 1) error = new Error(`nivel ${i} r15`, { cause: error });

    comprobarTruncado(await convertir(error), error, 'u12 cadena de 30');
  });

  it('criterio 165 (u12): una lista de 1000 objetos (mas de 100 claves en un objeto)', async () => {
    const error = Object.assign(new Error('grande r15'), { lista: Array.from({ length: 1000 }, () => ({})) });

    comprobarTruncado(await convertir(error), error, 'u12 mil claves');
  });

  it('criterio 165 (u12): una lista de 1000 objetos y ademas una base: truncado y la base encontrada, en su forma limpia', async () => {
    const error = Object.assign(new Error('grande r15'), {
      base: crearBase(),
      lista: Array.from({ length: 1000 }, () => ({})),
    });

    const resultado = comprobarTruncado(await convertir(error), error, 'u12 mil claves con base');

    // La base esta en una clave anterior a la lista: la busqueda ya la encontro cuando se agota el tope.
    const encontradas = resultado['erroresDeLaBase'] as unknown[];
    expect(encontradas).toHaveLength(1);
    esLaFormaLimpiaDeBase(encontradas[0], 'u12 erroresDeLaBase');
  });

  it('criterio 165 (u12): un arbol de mas de 200 objetos con menos de 100 claves cada uno', async () => {
    const hoja = (): object => ({});
    const rama = (): object => ({ hijos: Array.from({ length: 30 }, hoja) });
    const error = Object.assign(new Error('arbol r15'), { arbol: { hijos: Array.from({ length: 30 }, rama) } });

    comprobarTruncado(await convertir(error), error, 'u12 arbol de 200');
  });

  it('criterio 165 (u12): una propiedad cuyo getter devuelve cada vez un objeto nuevo con otro getter igual', async () => {
    const error = new Error('infinito r15');
    const nuevo = (): object => {
      const objeto = {};
      Object.defineProperty(objeto, 'siguiente', { get: nuevo, enumerable: false, configurable: true });
      return objeto;
    };
    Object.defineProperty(error, 'infinito', { get: nuevo, enumerable: false, configurable: true });

    comprobarTruncado(await convertir(error), error, 'u12 getter infinito');
  });

  it('criterio 165 (u12): un Proxy cuyo ownKeys lanza como valor de una propiedad', async () => {
    const error = new Error('proxy r15');
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(`ownKeys DNI ${DNI_R15}`);
        },
      },
    );
    sinEnumerar(error, 'proxy', proxy);

    comprobarTruncado(await convertir(error), error, 'u12 proxy');
  });

  it('criterio 165 (u12): una cadena corta (3 niveles) con la base al final no se trunca y conserva los mensajes', async () => {
    const error = new Error('uno r15', {
      cause: new Error('dos r15', { cause: new Error('tres r15', { cause: crearBase() }) }),
    });

    const resultado = comprobarConvertido(await convertir(error), error, 'u12 corta', 1);

    expect(resultado['truncado']).toBeUndefined();
    expect(resultado['mensaje']).toBe('uno r15');
    const dos = comoObjeto(resultado['causa'], 'u12 dos');
    expect(dos['mensaje']).toBe('dos r15');
    const tres = comoObjeto(dos['causa'], 'u12 tres');
    expect(tres['mensaje']).toBe('tres r15');
    esLaFormaLimpiaDeBase(tres['causa'], 'u12 base');
  });
});

describe('criterio 165 (u13): mensaje de la base que no se puede verificar', () => {
  it('criterio 165 (u13): la base con un getter de message que lanza: el Error que la lleva no tiene mensaje ni pila', async () => {
    const base = crearBase();
    Object.defineProperty(base, 'message', {
      get() {
        throw new Error(`message DNI ${DNI_R15} penicilina-r15`);
      },
      configurable: true,
    });
    const error = Object.assign(new Error('Fallo r15'), { detalle: base });

    const resultado = comprobarConvertido(await convertir(error), error, 'u13 getter', 1);

    expect(resultado['mensaje']).toBeUndefined();
    expect(resultado['pila']).toBeUndefined();
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });

  it('criterio 165 (u13): la base con un message que no es una cadena: el Error que la lleva no tiene mensaje ni pila', async () => {
    const base = crearBase();
    Object.defineProperty(base, 'message', { value: 42, configurable: true });
    const error = Object.assign(new Error('Fallo r15'), { detalle: base });

    const resultado = comprobarConvertido(await convertir(error), error, 'u13 numero', 1);

    expect(resultado['mensaje']).toBeUndefined();
    expect(resultado['pila']).toBeUndefined();
  });

  it('criterio 165 (u13): la base con un message vacio (como la causa del adaptador) no cuenta: el Error que la lleva conserva su mensaje', async () => {
    const base = crearBase();
    Object.defineProperty(base, 'message', { value: '', configurable: true });
    const error = Object.assign(new Error('Fallo r15'), { detalle: base });

    const resultado = comprobarConvertido(await convertir(error), error, 'u13 vacio', 1);

    expect(resultado['mensaje']).toBe('Fallo r15');
  });
});

describe('criterio 165 (u14): controles, el mismo objeto (sin errores de la base en su grafo)', () => {
  it('criterio 165 (u14): un Error comun, uno con cause comun, uno con un objeto plano y un ciclo sin base: el mismo error', async () => {
    const comun = new Error('boom');
    const conCausa = new Error('x', { cause: new Error('y') });
    const conObjeto = Object.assign(new Error('x'), { detalle: { a: 1, b: [1, 2] } });
    const conCiclo = new Error('ciclo r15');
    (conCiclo as unknown as Record<string, unknown>)['detalle'] = { vuelta: conCiclo };

    for (const error of [comun, conCausa, conObjeto, conCiclo]) expect(await convertir(error)).toBe(error);
  });

  it('criterio 165 (u14): HttpException de 5xx con un texto, un ErrorNegocio con detalles, una CausaLimpia y un ErrorTransaccionAbortada con base como causa', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();
    const { ErrorTransaccionAbortada } = await cargarClaseAbortada();
    const http = new HttpException('detalle interno', 503);
    const negocio = new ErrorNegocio(500, 'ERROR_DE_PRUEBA', 'Mensaje de prueba', { url: 'secreta' });
    const limpia = causaLimpia(crearBase(), 'configuracion.update', 'rechazo-tras-trabajo');
    const abortada = new ErrorTransaccionAbortada({ cause: crearBase() });

    for (const error of [http, negocio, limpia, abortada]) expect(await convertir(error)).toBe(error);
  });

  it('criterio 165 (u14): una CausaLimpia dentro del grafo no cuenta como error de la base: el mismo error', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();
    const error = Object.assign(new Error('x'), { detalle: causaLimpia(crearBase(), 'auditoria.create') });

    expect(await convertir(error)).toBe(error);
  });

  it('criterio 165 (u14): lo que no es un Error sigue dando { tipo: typeof valor }, nunca su contenido', async () => {
    expect(await convertir({ dni: DNI_R15 })).toEqual({ tipo: 'object' });
    expect(await convertir(`DNI ${DNI_R15}`)).toEqual({ tipo: 'string' });
    expect(await convertir(null)).toEqual({ tipo: 'object' });
    expect(await convertir(undefined)).toEqual({ tipo: 'undefined' });
  });
});

describe('criterio 165: la forma del resultado', () => {
  it('criterio 165: un error de la base solo (no un Error que lo lleva) sigue dando su forma limpia con tipo, codigoPrisma y pila', async () => {
    const resultado = comoObjeto(await convertir(crearBase()), 'base sola');

    esLaFormaLimpiaDeBase(resultado, 'base sola');
    comprobarSinValoresR15(resultado, 'base sola');
    for (const clave of Object.keys(resultado)) {
      expect(
        ['tipo', 'codigoPrisma', 'sqlstate', 'codigoDeSistema', 'modelo', 'pila'],
        `clave inesperada: ${clave}`,
      ).toContain(clave);
    }
  });

  it('criterio 165: el name asignado a mano (con datos) no sale como tipo: sale Error', async () => {
    const error = Object.assign(new Error('Fallo r15'), { name: 'Dni44556677Alergia', detalle: crearBase() });

    const resultado = comprobarConvertido(await convertir(error), error, 'tipo a mano', 1);

    expect(resultado['tipo']).toBe('Error');
    expect(resultado['mensaje']).toBe('Fallo r15');
  });

  it('criterio 165: un name igual al de su constructor y con forma de identificador sale como tipo', async () => {
    class FalloPropio extends Error {
      constructor(mensaje: string) {
        super(mensaje);
        this.name = 'FalloPropio';
      }
    }
    const error = Object.assign(new FalloPropio('Fallo r15'), { detalle: crearBase() });

    const resultado = comprobarConvertido(await convertir(error), error, 'tipo de la clase', 1);

    expect(resultado['tipo']).toBe('FalloPropio');
  });

  it('criterio 165: un name igual al de su constructor pero sin la forma de identificador (guion bajo) sale como Error', async () => {
    const Clase = Object.defineProperty(class extends Error {}, 'name', { value: 'Falla_R15' });
    const error = Object.assign(new Clase('Fallo r15'), { name: 'Falla_R15', detalle: crearBase() });

    const resultado = comprobarConvertido(await convertir(error), error, 'tipo con guion bajo', 1);

    expect(resultado['tipo']).toBe('Error');
  });

  it('criterio 165: un getter de constructor que lanza no hace lanzar a errorParaRegistro y el tipo es Error', async () => {
    const error = Object.assign(new Error('Fallo r15'), { detalle: crearBase() });
    Object.defineProperty(error, 'constructor', {
      get() {
        throw new Error(`constructor DNI ${DNI_R15}`);
      },
      configurable: true,
    });

    const resultado = comprobarConvertido(await convertir(error), error, 'constructor que lanza', 1);

    expect(resultado['tipo']).toBe('Error');
  });

  it('criterio 165: un message que no es una cadena no sale como mensaje', async () => {
    const error = Object.assign(new Error('Fallo r15'), { detalle: crearBase() });
    Object.defineProperty(error, 'message', { value: { dni: DNI_R15 }, configurable: true });

    const resultado = comprobarConvertido(await convertir(error), error, 'message objeto', 1);

    expect(resultado['mensaje']).toBeUndefined();
  });

  it('criterio 165: un AggregateError con la base en errors: errores convertidos, la base en su lugar y una sola vez', async () => {
    const agregado = new AggregateError([crearBase(), new Error('otro r15')], 'varios r15');

    const resultado = comprobarConvertido(await convertir(agregado), agregado, 'aggregate', 1);

    expect(resultado['tipo']).toBe('AggregateError');
    expect(resultado['mensaje']).toBe('varios r15');
    const errores = resultado['errores'] as unknown[];
    expect(errores).toHaveLength(2);
    esLaFormaLimpiaDeBase(errores[0], 'aggregate errores[0]');
    const otro = comoObjeto(errores[1], 'aggregate errores[1]');
    expect(otro['tipo']).toBe('Error');
    expect(otro['mensaje']).toBe('otro r15');
    expect(resultado['erroresDeLaBase']).toBeUndefined();
  });

  it('criterio 165: errors con mas de 10 elementos: solo 10 en errores y la base de mas alla sale en erroresDeLaBase', async () => {
    const otros = Array.from({ length: 11 }, (_, i) => new Error(`otro ${i} r15`));
    const agregado = new AggregateError([...otros, crearBase()], 'varios r15');

    const resultado = comprobarConvertido(await convertir(agregado), agregado, 'aggregate de 12', 1);

    expect(resultado['errores']).toHaveLength(10);
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });

  it('criterio 165: un cause que es un objeto plano con datos sale como { tipo: "object" }, nunca su contenido', async () => {
    const error = Object.assign(new Error('Fallo r15', { cause: { dni: DNI_R15, nota: 'penicilina-r15' } }), {
      detalle: crearBase(),
    });

    const resultado = comprobarConvertido(await convertir(error), error, 'cause objeto', 1);

    expect(resultado['causa']).toEqual({ tipo: 'object' });
  });

  it('criterio 165: una CausaLimpia como cause sale tal cual', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();
    const limpia = causaLimpia(crearBase(), 'auditoria.create', 'sin-resultado');
    const error = Object.assign(new Error('Fallo r15', { cause: limpia }), { detalle: crearBase() });

    const resultado = comoObjeto(await convertir(error), 'cause limpia');

    expect(resultado['causa']).toBe(limpia);
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
    esLaFormaLimpiaDeBase((resultado['erroresDeLaBase'] as unknown[])[0], 'cause limpia erroresDeLaBase[0]');
    comprobarSinValoresR15(resultado, 'cause limpia');
  });

  it('criterio 165: dos errores de la base distintos: el de cause en causa y el de la propiedad en erroresDeLaBase', async () => {
    const error = Object.assign(new Error('Fallo r15', { cause: crearBase() }), { detalle: crearBase() });

    const resultado = comprobarConvertido(await convertir(error), error, 'dos bases', 2);

    esLaFormaLimpiaDeBase(resultado['causa'], 'dos bases causa');
    expect(resultado['erroresDeLaBase']).toHaveLength(1);
  });

  it('criterio 165: mas de 10 errores de la base distintos: erroresDeLaBase tiene 10 y truncado es true', async () => {
    const propiedades = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`base${i}`, crearBase()]));
    const error = Object.assign(new Error('Fallo r15'), propiedades);

    const resultado = comprobarConvertido(await convertir(error), error, 'doce bases', 10);

    expect(resultado['erroresDeLaBase']).toHaveLength(10);
    expect(resultado['truncado']).toBe(true);
  });
});

describe('criterio 166 (o1): el tipo de un error de la base sale de una lista cerrada (name inventado con datos)', () => {
  const crearO1 = (): Error & { code: string } =>
    Object.assign(new Error('x'), { name: 'Dni44556677Alergia', code: 'P2007' });

  it('criterio 166 (o1): errorParaRegistro da tipo ErrorDeBase y conserva el codigo de Prisma', async () => {
    const resultado = comoObjeto(await convertir(crearO1()), 'o1 errorParaRegistro');

    expect(resultado['tipo']).toBe('ErrorDeBase');
    expect(resultado['codigoPrisma']).toBe('P2007');
    expect(textoCompleto(resultado)).not.toContain(DNI_R15);
    expect(JSON.stringify(resultado)).not.toContain(DNI_R15);
  });

  it('criterio 166 (o1): causaLimpia da tipo ErrorDeBase y ni inspect ni las propiedades propias ni el texto contienen el valor', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();

    const causa = causaLimpia(crearO1());

    expect((causa as { tipo?: string }).tipo).toBe('ErrorDeBase');
    expect(causa.message).toContain('ErrorDeBase');
    expect(causa.message).not.toContain(DNI_R15);
    expect(textoCompleto(causa)).not.toContain(DNI_R15);
    expect(propiasComoJson(causa)).not.toContain(DNI_R15);
  });

  it('criterio 166 (o1): new ErrorTransaccionAbortada({ cause }) guarda una causa de tipo ErrorDeBase y nada contiene el valor', async () => {
    const { ErrorTransaccionAbortada } = await cargarClaseAbortada();

    const abortada = new ErrorTransaccionAbortada({ cause: crearO1() });

    expect((abortada.cause as { tipo?: string }).tipo).toBe('ErrorDeBase');
    expect(textoCompleto(abortada)).not.toContain(DNI_R15);
    expect(propiasComoJson(abortada)).not.toContain(DNI_R15);
    expect(propiasComoJson(abortada.cause)).not.toContain(DNI_R15);
  });

  it('criterio 166 (o1): un name con espacios alrededor o en mayusculas distintas no esta en la lista (comparacion exacta)', async () => {
    for (const name of [
      ' PrismaClientKnownRequestError',
      'PrismaClientKnownRequestError ',
      'prismaclientknownrequesterror',
    ]) {
      const error = Object.assign(new Error('x'), { name, code: 'P2002' });

      const resultado = comoObjeto(await convertir(error), `o1 name "${name}"`);

      expect(resultado['tipo'], `name "${name}"`).toBe('ErrorDeBase');
      expect(resultado['codigoPrisma']).toBe('P2002');
    }
  });
});

describe('criterio 166 (o2): el name "error" del driver pg con un SQLSTATE', () => {
  const crearO2 = (): Error & { code: string } => Object.assign(new Error('x'), { name: 'error', code: '22P02' });

  it('criterio 166 (o2): errorParaRegistro da tipo ErrorDeBase y sqlstate 22P02', async () => {
    const resultado = comoObjeto(await convertir(crearO2()), 'o2');

    expect(resultado['tipo']).toBe('ErrorDeBase');
    expect(resultado['sqlstate']).toBe('22P02');
  });

  it('criterio 166 (o2): causaLimpia da tipo ErrorDeBase y conserva el SQLSTATE en code', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();

    const causa = causaLimpia(crearO2());

    expect((causa as { tipo?: string }).tipo).toBe('ErrorDeBase');
    expect(causa.code).toBe('22P02');
  });
});

describe('criterio 166 (o3): nombres que parecen de Prisma pero no estan en la lista, y objetos planos', () => {
  it.each(['PrismaClientOtraCosa', 'prismaclientknownrequesterror'])(
    'criterio 166 (o3): name "%s" con code P2002: tipo ErrorDeBase en errorParaRegistro y en causaLimpia',
    async (name) => {
      const { causaLimpia } = await cargarRegistroDeErrores();
      const error = Object.assign(new Error('x'), { name, code: 'P2002' });

      const resultado = comoObjeto(await convertir(error), 'o3');
      const causa = causaLimpia(error);

      expect(resultado['tipo']).toBe('ErrorDeBase');
      expect(resultado['codigoPrisma']).toBe('P2002');
      expect((causa as { tipo?: string }).tipo).toBe('ErrorDeBase');
    },
  );

  it('criterio 166 (o3): un objeto plano { code: "22P02" } en causaLimpia da ErrorDeBase', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();

    const causa = causaLimpia({ code: '22P02' });

    expect((causa as { tipo?: string }).tipo).toBe('ErrorDeBase');
    expect(causa.code).toBe('22P02');
  });

  it('criterio 166 (o3): un objeto plano { code: "22P02" } como cause de un Error propio: el Error es de la base (su SQLSTATE viene de la causa) y sale como ErrorDeBase', async () => {
    const propio = new Error('propio r15', { cause: { code: '22P02' } });

    const resultado = comoObjeto(await convertir(propio), 'o3 cause plano');

    expect(resultado['tipo']).toBe('ErrorDeBase');
    expect(resultado['sqlstate']).toBe('22P02');
  });

  it('criterio 166 (o3): errorParaRegistro con el objeto plano solo sigue dando { tipo: "object" }', async () => {
    expect(await convertir({ code: '22P02' })).toEqual({ tipo: 'object' });
  });
});

describe('criterio 166 (o4): los nombres de la lista se conservan', () => {
  const REALES: readonly [string, () => Error][] = [
    [
      'PrismaClientKnownRequestError',
      () => new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 'prueba' }),
    ],
    [
      'PrismaClientUnknownRequestError',
      () => new Prisma.PrismaClientUnknownRequestError('x', { clientVersion: 'prueba' }),
    ],
    ['PrismaClientValidationError', () => new Prisma.PrismaClientValidationError('x', { clientVersion: 'prueba' })],
    ['PrismaClientInitializationError', () => new Prisma.PrismaClientInitializationError('x', 'prueba')],
    ['PrismaClientRustPanicError', () => new Prisma.PrismaClientRustPanicError('x', 'prueba')],
    ['DriverAdapterError', () => Object.assign(new Error('x'), { name: 'DriverAdapterError' })],
    ['DatabaseError', () => Object.assign(new Error('x'), { name: 'DatabaseError', code: '22P02' })],
  ];

  it.each(REALES)(
    'criterio 166 (o4): %s conserva su nombre como tipo en errorParaRegistro y en causaLimpia',
    async (nombre, crear) => {
      const { causaLimpia } = await cargarRegistroDeErrores();

      const resultado = comoObjeto(await convertir(crear()), `o4 ${nombre}`);
      const causa = causaLimpia(crear());

      expect(resultado['tipo']).toBe(nombre);
      expect((causa as { tipo?: string }).tipo).toBe(nombre);
    },
  );
});

describe('criterio 166 (o5): causaLimpia con algo que no es un error de la base', () => {
  it('criterio 166 (o5): causaLimpia(new TypeError("x DNI 44556677")) da tipo TypeError sin el valor', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();

    const causa = causaLimpia(new TypeError(`x DNI ${DNI_R15}`));

    expect((causa as { tipo?: string }).tipo).toBe('TypeError');
    expect(causa.message).not.toContain(DNI_R15);
    expect(textoCompleto(causa)).not.toContain(DNI_R15);
    expect(propiasComoJson(causa)).not.toContain(DNI_R15);
  });

  it('criterio 166 (o5): un Error comun con un name inventado y sin codigo (no es de la base) da tipo Error y su texto no contiene el valor', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();

    const causa = causaLimpia(Object.assign(new Error('x'), { name: 'Dni44556677' }));

    expect((causa as { tipo?: string }).tipo).toBe('Error');
    expect(causa.message).not.toContain(DNI_R15);
    expect(textoCompleto(causa)).not.toContain(DNI_R15);
    expect(propiasComoJson(causa)).not.toContain(DNI_R15);
  });

  it('criterio 166 (o5): sin causa (undefined o null) causaLimpia no lanza y no lleva datos', async () => {
    const { causaLimpia } = await cargarRegistroDeErrores();

    for (const vacio of [undefined, null]) {
      const causa = causaLimpia(vacio);

      expect(typeof (causa as { tipo?: unknown }).tipo).toBe('string');
      expect(causa.cause).toBeUndefined();
    }
  });
});
