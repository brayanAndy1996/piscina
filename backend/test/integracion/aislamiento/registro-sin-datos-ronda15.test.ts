// spec: 001-academias-aislamiento (pruebas protegidas)
import { errorApiSchema } from '@aquagestion/contratos';
import {
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Param,
  ServiceUnavailableException,
  type Type,
} from '@nestjs/common';
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
  comoObjeto,
  delegadosDe,
  siguienteNumero,
  textoCompleto,
} from '../../utilidades/ronda13';
import { objetosConTipo } from '../../utilidades/ronda14';
import { comprobarConvertido, DNI_R15, ALERGIA_R15, PROHIBIDOS_R15, SINTAXIS_R15 } from '../../utilidades/ronda15';
import { intentar, obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';
import { cargarPuntoAutorizado } from '../../utilidades/ronda4';

// Criterio 165 (ataque ronda 15, F1; ampliacion del criterio 162 y precision de P-42), con el error real que provoca
// `tx.cliente.auditoria.create` con `ip: 'DNI 44556677 alergia penicilina-r15'` en `conAcademia(A, ...)` sin atraparlo (P2007 o 22P02).
// Primero se comprueba que el ataque se reproduce: el error es de la base y su `message` contiene `44556677`. Despues:
//   - `errorParaRegistro` con ese error dentro de (u1) `InternalServerErrorException(error)`, (u2) `HttpException(error, 503)` y
//     `ServiceUnavailableException(error)`, (u8) `InternalServerErrorException('No se pudo', { cause: error })` y (u10)
//     `new Error('Fallo r15', { cause: InternalServerErrorException(error) })`: no contiene `44556677`, `penicilina-r15` ni
//     `invalid input syntax` (util.inspect con showHidden, JSON.stringify, pino); el objeto de la base sale una sola vez, con el `tipo` del
//     error real y su `codigoPrisma` o su `sqlstate`, el que traiga;
//   - por la API, con el registro de la app capturado (nivel `info`) y un controlador de prueba con tres rutas que atrapan el rechazo de
//     `conAcademia` y lanzan (a1) `new InternalServerErrorException(error)` (500 `ERROR_INTERNO`), (a2) `new HttpException(error, 503)`
//     (503 `ERROR_INTERNO`) y (a3) el control `new InternalServerErrorException('No se pudo', { cause: error })` (500): ningun registro
//     contiene los valores y hay un registro de nivel `error` cuyo `err.tipo` es el de la excepcion y en cuyo `err` hay un objeto con el
//     `tipo` del error de Prisma y su `codigoPrisma` o su `sqlstate`.

const IP_DE_ATAQUE = `DNI ${DNI_R15} alergia ${ALERGIA_R15}`;

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
  @Controller('prueba-r15-registro')
  class ControladorPruebaR15Registro {
    @Get('a1/:id/:n')
    async a1(@Param('id') id: string, @Param('n') n: string): Promise<unknown> {
      try {
        return await provocar(id, Number(n));
      } catch (error) {
        throw new InternalServerErrorException(error);
      }
    }

    @Get('a2/:id/:n')
    async a2(@Param('id') id: string, @Param('n') n: string): Promise<unknown> {
      try {
        return await provocar(id, Number(n));
      } catch (error) {
        throw new HttpException(error as Error, 503);
      }
    }

    @Get('a3/:id/:n')
    async a3(@Param('id') id: string, @Param('n') n: string): Promise<unknown> {
      try {
        return await provocar(id, Number(n));
      } catch (error) {
        throw new InternalServerErrorException('No se pudo', { cause: error });
      }
    }
  }
  return ControladorPruebaR15Registro;
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
    `el ataque no se reproduce: el mensaje del error real no contiene ${DNI_R15}: ${(error as Error).message}`,
  ).toContain(DNI_R15);
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
  for (const prohibido of PROHIBIDOS_R15) {
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

describe('criterio 165, error real de auditoria.create: el ataque se reproduce', () => {
  it('criterio 165: el error real es de la base, su message contiene el valor y la excepcion de Nest lo copia a su message', async () => {
    const error = await provocarYComprobarElAtaque();

    const excepcion = new InternalServerErrorException(error);

    expect(excepcion.getResponse()).toBe(error);
    expect(excepcion.message).toContain(DNI_R15);
    await codigosEsperados(error);
  });
});

describe('criterio 165, errorParaRegistro con el error real dentro de excepciones de Nest', () => {
  const CASOS: readonly {
    readonly nombre: string;
    readonly tipo: string;
    readonly envolver: (error: Error) => Error;
    readonly sinMensaje: boolean;
  }[] = [
    {
      nombre: '(u1) InternalServerErrorException(error)',
      tipo: 'InternalServerErrorException',
      envolver: (error) => new InternalServerErrorException(error),
      sinMensaje: true,
    },
    {
      nombre: '(u2) HttpException(error, 503)',
      tipo: 'HttpException',
      envolver: (error) => new HttpException(error, 503),
      sinMensaje: true,
    },
    {
      nombre: '(u2) ServiceUnavailableException(error)',
      tipo: 'ServiceUnavailableException',
      envolver: (error) => new ServiceUnavailableException(error),
      sinMensaje: true,
    },
    {
      nombre: "(u8) InternalServerErrorException('No se pudo', { cause: error })",
      tipo: 'InternalServerErrorException',
      envolver: (error) => new InternalServerErrorException('No se pudo', { cause: error }),
      sinMensaje: false,
    },
    {
      nombre: "(u10) new Error('Fallo r15', { cause: InternalServerErrorException(error) })",
      tipo: 'Error',
      envolver: (error) => new Error('Fallo r15', { cause: new InternalServerErrorException(error) }),
      sinMensaje: false,
    },
  ];

  it.each(CASOS)(
    'criterio 165 $nombre: no contiene los valores y el objeto de la base sale una sola vez con su tipo y sus codigos',
    async ({ tipo, envolver, sinMensaje }) => {
      const { errorParaRegistro } = await cargarRegistroDeErrores();
      const error = await provocarYComprobarElAtaque();
      const codigos = await codigosEsperados(error);
      const envuelto = envolver(error);

      const resultado = errorParaRegistro(envuelto);

      const objeto = comprobarConvertido(resultado, envuelto, 'error real');
      expect(objeto['tipo']).toBe(tipo);
      expect(
        objetosDeLaBase(resultado, error, codigos),
        `un objeto con tipo ${error.name} y ${JSON.stringify(codigos)}; resultado: ${textoCompleto(resultado)}`,
      ).toHaveLength(1);
      expect(objetosConTipo(resultado, error.name), 'el objeto de la base sale una sola vez').toHaveLength(1);
      if (sinMensaje) {
        expect(objeto['mensaje'], 'la excepcion copia el mensaje de la base: no sale').toBeUndefined();
        expect(objeto['pila'], 'el stack de la excepcion lleva el mensaje de la base: no sale').toBeUndefined();
      }
      comprobarSinValores(textoCompleto(resultado), 'error real');
      comprobarSinValores(JSON.stringify(resultado), 'error real');
    },
  );

  it('criterio 165 (u8): con { cause }, el mensaje propio se conserva', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const error = await provocarYComprobarElAtaque();
    const envuelto = new InternalServerErrorException('No se pudo', { cause: error });

    const objeto = comoObjeto(errorParaRegistro(envuelto), 'u8 real');

    expect(objeto['mensaje']).toBe('No se pudo');
    expect(objeto['erroresDeLaBase'], 'la base ya esta en causa').toBeUndefined();
  });
});

describe('criterio 165, por la API: los registros no tienen los valores', () => {
  const RUTAS: readonly {
    readonly ruta: 'a1' | 'a2' | 'a3';
    readonly titulo: string;
    readonly estado: number;
    readonly tipo: string;
  }[] = [
    {
      ruta: 'a1',
      titulo: 'new InternalServerErrorException(error)',
      estado: 500,
      tipo: 'InternalServerErrorException',
    },
    { ruta: 'a2', titulo: 'new HttpException(error, 503)', estado: 503, tipo: 'HttpException' },
    {
      ruta: 'a3',
      titulo: "control: new InternalServerErrorException('No se pudo', { cause: error })",
      estado: 500,
      tipo: 'InternalServerErrorException',
    },
  ];

  it.each(RUTAS)(
    'criterio 165 ($ruta) $titulo: responde $estado ERROR_INTERNO, ningun registro contiene los valores y hay un registro de nivel error con el tipo de la excepcion y el objeto de la base',
    async ({ ruta, estado, tipo }) => {
      const error = await provocarYComprobarElAtaque();
      const codigos = await codigosEsperados(error);

      const respuesta = await pedir(`/api/prueba-r15-registro/${ruta}/${datos.A.id}/${siguienteNumero()}`);

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(estado);
      expect(errorApiSchema.parse(respuesta.cuerpo).codigo).toBe('ERROR_INTERNO');
      comprobarSinValores(
        respuesta.registros.map((registro) => registro.texto).join('\n'),
        `registros de la API (${ruta})`,
      );
      comprobarSinValores(JSON.stringify(respuesta.cuerpo), `respuesta de la API (${ruta})`);
      expect(
        respuesta.registros.map((registro) => registro.texto).join('\n'),
        `registros de la API (${ruta}): tampoco "${SINTAXIS_R15}"`,
      ).not.toContain(SINTAXIS_R15);
      const delError = respuesta.registros.filter(
        (registro) => registro.nivel === 50 && registro.err?.['tipo'] === tipo,
      );
      expect(
        delError.length,
        `ningun registro de nivel error con err.tipo ${tipo}; registros: ${respuesta.registros.map((r) => r.texto).join('\n')}`,
      ).toBeGreaterThan(0);
      expect(
        delError.some((registro) => objetosDeLaBase(registro.err, error, codigos).length > 0),
        `el registro lleva un objeto con tipo ${error.name} y ${JSON.stringify(codigos)}; err: ${JSON.stringify(delError.map((r) => r.err))}`,
      ).toBe(true);
    },
  );
});
