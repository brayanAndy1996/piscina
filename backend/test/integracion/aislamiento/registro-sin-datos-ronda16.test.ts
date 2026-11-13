// spec: 001-academias-aislamiento (pruebas protegidas)
import { errorApiSchema } from '@aquagestion/contratos';
import { Controller, Get, Param, type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import {
  accionDe,
  cargarRegistroDeErrores,
  delegadosDe,
  siguienteNumero,
  textoCompleto,
} from '../../utilidades/ronda13';
import { objetosConTipo } from '../../utilidades/ronda14';
import {
  ALERGIA_R16,
  DNI_R16,
  ErrorDeServicio,
  PROHIBIDOS_R16,
  SINTAXIS_R16,
  comprobarConvertidoR16,
  comprobarNoEsElMismo,
  comprobarSinValoresR16,
  crearEspia,
} from '../../utilidades/ronda16';
import { intentar, obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';
import { cargarPuntoAutorizado } from '../../utilidades/ronda4';

// Criterio 168 (ataque ronda 16, O1; amplia el criterio 165 y precisa P-42), con el error real que provoca `tx.cliente.auditoria.create` con
// `ip: 'DNI 44556677 alergia penicilina-r16'` en `conAcademia(A, ...)` sin atraparlo (P2007 o 22P02). Primero se comprueba que el ataque se
// reproduce: el error es de la base y su `message` contiene `44556677`. Despues:
//   - `errorParaRegistro` con ese error dentro de (g1) `new ErrorDeServicio('No se pudo guardar', error)` (getter heredado `cause`) y de
//     (g3) `Object.assign(new Error('No se pudo guardar'), { cause: () => error })`: (g1) no es el mismo objeto, conserva el mensaje y lleva
//     el objeto de la base una sola vez en `causa`, con el `tipo` del error real y su `codigoPrisma` o su `sqlstate`; (g3) es exactamente
//     `{ tipo: 'Error', truncado: true }` y la funcion no se llama; ninguno contiene `44556677`, `penicilina-r16` ni `invalid input syntax`
//     (util.inspect con showHidden, JSON.stringify, pino);
//   - por la API, con el registro de la app capturado (nivel `info`: es el registrador de nestjs-pino y pino-http) y un controlador de
//     prueba con dos rutas que atrapan el rechazo de `conAcademia` y lanzan (a4) `new ErrorDeServicio('No se pudo guardar', error)` y (a5)
//     `Object.assign(new Error('No se pudo guardar'), { cause: () => error })`: las dos responden 500 `ERROR_INTERNO`; ningun registro
//     contiene los valores; hay un registro de nivel `error` cuyo `err`, en (a4), lleva un objeto con el `tipo` del error de Prisma y su
//     `codigoPrisma` o su `sqlstate` y, en (a5), tiene `truncado: true`.

const IP_DE_ATAQUE = `DNI ${DNI_R16} alergia ${ALERGIA_R16}`;

const { destino, lineas } = crearDestinoDeRegistro();

let app: NestExpressApplication;
let base: BaseDatosRonda3;
let datos: DatosDeAislamiento;

/** `auditoria.create` con una `ip` que no es una direccion: el rechazo es el error de la base con el valor en el mensaje. */
function provocar(academiaId: string, n: number): Promise<unknown> {
  return base.conAcademia(academiaId, (tx) =>
    delegadosDe(tx.cliente).auditoria.create({
      data: {
        academiaId: tx.academiaId,
        fechaHora: new Date(),
        actorTipo: 'SISTEMA',
        accion: accionDe(n),
        entidad: 'prueba',
        ip: IP_DE_ATAQUE,
      },
    }),
  );
}

/** Controlador de prueba (opcion `controladores` de `crearAppDePruebas`): una ruta por forma de atrapar y lanzar. */
function crearControladorDePrueba(): Type<unknown> {
  @Controller('prueba-r16-registro')
  class ControladorPruebaR16Registro {
    @Get('a4/:id/:n')
    async a4(@Param('id') id: string, @Param('n') n: string): Promise<unknown> {
      try {
        return await provocar(id, Number(n));
      } catch (error) {
        throw new ErrorDeServicio('No se pudo guardar', error);
      }
    }

    @Get('a5/:id/:n')
    async a5(@Param('id') id: string, @Param('n') n: string): Promise<unknown> {
      try {
        return await provocar(id, Number(n));
      } catch (error) {
        throw Object.assign(new Error('No se pudo guardar'), { cause: () => error });
      }
    }
  }
  return ControladorPruebaR16Registro;
}

interface RegistroLeido {
  readonly texto: string;
  readonly nivel: number;
  readonly err?: Record<string, unknown>;
}

/** Hace la peticion y devuelve la respuesta con los registros nuevos que genero. */
async function pedir(ruta: string): Promise<{ estado: number; cuerpo: unknown; registros: RegistroLeido[] }> {
  const desde = lineas.length;
  const respuesta = await request(app.getHttpServer()).get(ruta);
  await new Promise((resolver) => setTimeout(resolver, 150));
  const registros = lineas.slice(desde).map((linea) => {
    const registro = JSON.parse(linea) as { level?: number; err?: Record<string, unknown> };
    return { texto: linea, nivel: registro.level ?? 0, ...(registro.err ? { err: registro.err } : {}) };
  });
  return { estado: respuesta.status, cuerpo: respuesta.body as unknown, registros };
}

/** Provoca el error real y comprueba que el ataque se reproduce. */
async function provocarYComprobarElAtaque(): Promise<Error & { code?: unknown }> {
  const { esErrorDeBase } = await cargarRegistroDeErrores();
  const error = await intentar(() => provocar(datos.A.id, siguienteNumero()));
  expect(error, 'la llamada debia rechazar con el error').toBeInstanceOf(Error);
  expect(esErrorDeBase(error), 'debia ser un error de la base').toBe(true);
  expect(
    (error as Error).message,
    `el ataque no se reproduce: el mensaje del error real no contiene ${DNI_R16}: ${(error as Error).message}`,
  ).toContain(DNI_R16);
  return error as Error & { code?: unknown };
}

/** Los codigos que debe traer el objeto de la base del error real: su codigo de Prisma y/o su SQLSTATE. */
async function codigosEsperados(
  error: Error & { code?: unknown },
): Promise<{ codigoPrisma?: string; sqlstate?: string }> {
  const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
  const codigoPrisma = typeof error.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : undefined;
  const sqlstate = codigoDeErrorDeBase(error);
  expect(codigoPrisma !== undefined || sqlstate !== null, 'el error real trae un codigo de Prisma o un SQLSTATE').toBe(
    true,
  );
  return {
    ...(codigoPrisma === undefined ? {} : { codigoPrisma }),
    ...(sqlstate === null ? {} : { sqlstate }),
  };
}

/** El objeto de la base dentro de `valor`: el `tipo` del error real y sus codigos. */
function objetosDeLaBase(
  valor: unknown,
  error: Error,
  codigos: { codigoPrisma?: string; sqlstate?: string },
): Record<string, unknown>[] {
  return objetosConTipo(valor, error.name).filter(
    (objeto) =>
      (codigos.codigoPrisma === undefined || objeto['codigoPrisma'] === codigos.codigoPrisma) &&
      (codigos.sqlstate === undefined || objeto['sqlstate'] === codigos.sqlstate),
  );
}

function comprobarSinValores(texto: string, contexto: string): void {
  for (const prohibido of PROHIBIDOS_R16) {
    expect(texto, `${contexto}: no debe contener "${prohibido}"`).not.toContain(prohibido);
  }
}

beforeAll(async () => {
  app = await crearAppDePruebas({
    nivelRegistro: 'info',
    destinoRegistro: destino,
    variables: { DATABASE_POOL_MAX: '1' },
    controladores: [crearControladorDePrueba()],
  });
  base = await obtenerBaseDatosRonda3(app);
});
beforeEach(async () => {
  await limpiarBase();
  datos = await crearDatosDeAislamiento();
});
afterAll(async () => {
  await app?.close();
});

describe('criterio 168, error real de auditoria.create: el ataque se reproduce', () => {
  it('criterio 168: el error real es de la base y su message contiene el valor', async () => {
    const error = await provocarYComprobarElAtaque();

    expect(error.message).toContain(DNI_R16);
    expect(error.message).toContain(SINTAXIS_R16);
    await codigosEsperados(error);
  });
});

describe('criterio 168, errorParaRegistro con el error real dentro de un getter heredado y de una cause funcion', () => {
  it('criterio 168 (g1): ErrorDeServicio con el getter heredado cause: conserva el mensaje y el objeto de la base sale una sola vez, en causa, con su tipo y sus codigos', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const error = await provocarYComprobarElAtaque();
    const codigos = await codigosEsperados(error);
    const envuelto = new ErrorDeServicio('No se pudo guardar', error);
    expect(Reflect.ownKeys(envuelto), 'precondicion: cause no es una clave propia').not.toContain('cause');
    expect(envuelto.cause === error, 'precondicion: envuelto.cause es el error real').toBe(true);

    const resultado = errorParaRegistro(envuelto);

    const objeto = comprobarConvertidoR16(resultado, envuelto, 'g1 real');
    expect(objeto['tipo']).toBe('ErrorDeServicio');
    expect(objeto['mensaje']).toBe('No se pudo guardar');
    expect(
      objetosDeLaBase(resultado, error, codigos),
      `un objeto con tipo ${error.name} y ${JSON.stringify(codigos)}; resultado: ${textoCompleto(resultado)}`,
    ).toHaveLength(1);
    expect(objetosConTipo(resultado, error.name), 'el objeto de la base sale una sola vez').toHaveLength(1);
    expect(objetosDeLaBase(objeto['causa'], error, codigos), 'va en causa').toHaveLength(1);
  });

  it('criterio 168 (g3): Error con cause funcion que devuelve el error real: exactamente { tipo: "Error", truncado: true } y la funcion no se llama', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const error = await provocarYComprobarElAtaque();
    const espia = crearEspia(() => error);
    const envuelto = Object.assign(new Error('No se pudo guardar'), { cause: espia.funcion });

    const resultado = errorParaRegistro(envuelto);

    const objeto = comprobarNoEsElMismo(resultado, envuelto, 'g3 real');
    expect(Object.keys(objeto).sort()).toEqual(['tipo', 'truncado']);
    expect(objeto['tipo']).toBe('Error');
    expect(objeto['truncado']).toBe(true);
    comprobarSinValoresR16(resultado, 'g3 real');
    comprobarSinValores(textoCompleto(resultado), 'g3 real');
    expect(espia.llamadas(), 'la funcion cause no debe llamarse').toBe(0);
  });
});

describe('criterio 168, por la API: los registros no tienen los valores', () => {
  const RUTAS: readonly {
    readonly ruta: 'a4' | 'a5';
    readonly titulo: string;
    readonly comprobar: (
      err: Record<string, unknown> | undefined,
      error: Error,
      codigos: { codigoPrisma?: string; sqlstate?: string },
    ) => boolean;
  }[] = [
    {
      ruta: 'a4',
      titulo: "new ErrorDeServicio('No se pudo guardar', error) (getter heredado cause)",
      comprobar: (err, error, codigos) => objetosDeLaBase(err, error, codigos).length > 0,
    },
    {
      ruta: 'a5',
      titulo: "Object.assign(new Error('No se pudo guardar'), { cause: () => error }) (cause funcion)",
      comprobar: (err) => err?.['truncado'] === true,
    },
  ];

  it.each(RUTAS)(
    'criterio 168 ($ruta) $titulo: responde 500 ERROR_INTERNO, ningun registro contiene los valores y hay un registro de nivel error con lo esperado en err',
    async ({ ruta, comprobar }) => {
      const error = await provocarYComprobarElAtaque();
      const codigos = await codigosEsperados(error);

      const respuesta = await pedir(`/api/prueba-r16-registro/${ruta}/${datos.A.id}/${siguienteNumero()}`);

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(500);
      expect(errorApiSchema.parse(respuesta.cuerpo).codigo).toBe('ERROR_INTERNO');
      const todo = respuesta.registros.map((registro) => registro.texto).join('\n');
      comprobarSinValores(todo, `registros de la API (${ruta})`);
      comprobarSinValores(JSON.stringify(respuesta.cuerpo), `respuesta de la API (${ruta})`);
      const delError = respuesta.registros.filter((registro) => registro.nivel === 50 && registro.err !== undefined);
      expect(delError.length, `ningun registro de nivel error con err; registros: ${todo}`).toBeGreaterThan(0);
      expect(
        delError.some((registro) => comprobar(registro.err, error, codigos)),
        `el registro de ${ruta} no lleva lo esperado en err (${error.name}, ${JSON.stringify(codigos)}); err: ${JSON.stringify(delError.map((r) => r.err))}`,
      ).toBe(true);
    },
  );
});
