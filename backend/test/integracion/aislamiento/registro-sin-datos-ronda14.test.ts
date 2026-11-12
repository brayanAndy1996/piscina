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
  claveDe,
  comoObjeto,
  delegadosDe,
  siguienteNumero,
  textoCompleto,
} from '../../utilidades/ronda13';
import {
  ALERGIA_R14,
  comprobarSinValores,
  DNI_R14,
  lineaDeMarcoConValor,
  PROHIBIDOS_R14,
} from '../../utilidades/ronda14';
import { intentar, obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';
import { cargarPuntoAutorizado } from '../../utilidades/ronda4';

// Criterio 163 (ataque ronda 14, F1; precision del criterio 162 y de P-42), con errores reales de la base y de Prisma, provocados en
// `conAcademia(A, ...)` sin atraparlos (la llamada rechaza con ese error, criterio 22):
//   (a) `$queryRaw` con `SELECT ${'15/03/2010\n    at DNI 44556677 alergia penicilina-r14'}::date` (SQLSTATE 22007 o 22008, segun el servidor);
//   (b) `configuracion.create` con `valor: { 'at nacimiento': '44556677', alergias: 'penicilina-r14' }` y un campo que el modelo no tiene
//       (`PrismaClientValidationError`, que muestra el `valor` con las claves sin comillas);
//   (c) `auditoria.create` con `ip: 'x\n    at 44556677'` (P2007 o 22P02).
// El ataque: el mensaje del error trae una linea que empieza con espacios y `at `; `errorParaRegistro` la tomaba como un marco de la pila
// y el valor salia en `pila`. Para cada error, primero se comprueba que el ataque se reproduce (el `stack` del error tiene una linea que
// empieza con espacios y `at ` y contiene `44556677`) y despues: `util.inspect` y `JSON.stringify` de `errorParaRegistro(error)` no
// contienen los valores y contienen el `tipo` (y el codigo de Prisma o el SQLSTATE si el error los tiene); lo mismo con un `Error` propio
// que lo lleva como `cause`; por la API, con el registro de la app capturado, la ruta responde 500 `ERROR_INTERNO` con un registro de nivel
// `error` con el `tipo` y ningun registro contiene los valores.

type Letra = 'a' | 'b' | 'c';

const VALOR_DE_A = `15/03/2010\n    at DNI ${DNI_R14} alergia ${ALERGIA_R14}`;
const IP_DE_C = `x\n    at ${DNI_R14}`;

const { destino, lineas } = crearDestinoDeRegistro();

let app: NestExpressApplication;
let base: BaseDatosRonda3;
let datos: DatosDeAislamiento;

/** (a) `$queryRaw` con una fecha invalida que viaja como parametro. */
function provocarA(academiaId: string): Promise<unknown> {
  return base.conAcademia(academiaId, (tx) => tx.cliente.$queryRaw`SELECT ${VALOR_DE_A}::date`);
}

/** (b) `configuracion.create` con un `Json` de claves `at ...` y un campo que el modelo no tiene. */
function provocarB(academiaId: string, n: number): Promise<unknown> {
  return base.conAcademia(academiaId, (tx) =>
    delegadosDe(tx.cliente).configuracion.create({
      data: {
        academiaId: tx.academiaId,
        clave: claveDe(n),
        valor: { 'at nacimiento': DNI_R14, alergias: ALERGIA_R14 },
        campoQueElModeloNoTiene: true,
      },
    }),
  );
}

/** (c) `auditoria.create` con una `ip` con un salto de linea. */
function provocarC(academiaId: string, n: number): Promise<unknown> {
  return base.conAcademia(academiaId, (tx) =>
    delegadosDe(tx.cliente).auditoria.create({
      data: {
        academiaId: tx.academiaId,
        fechaHora: new Date(),
        actorTipo: 'SISTEMA',
        accion: accionDe(n),
        entidad: 'prueba',
        ip: IP_DE_C,
      },
    }),
  );
}

const PROVOCAR: Record<Letra, (academiaId: string, n: number) => Promise<unknown>> = {
  a: (academiaId) => provocarA(academiaId),
  b: provocarB,
  c: provocarC,
};

/** Controlador de prueba (opcion `controladores` de `crearAppDePruebas`): una ruta por error. */
function crearControladorDePrueba(): Type<unknown> {
  @Controller('prueba-r14-registro')
  class ControladorPruebaR14Registro {
    @Get('a/:id')
    async a(@Param('id') id: string): Promise<unknown> {
      return provocarA(id);
    }

    @Get('b/:id/:n')
    async b(@Param('id') id: string, @Param('n') n: string): Promise<unknown> {
      return provocarB(id, Number(n));
    }

    @Get('c/:id/:n')
    async c(@Param('id') id: string, @Param('n') n: string): Promise<unknown> {
      return provocarC(id, Number(n));
    }
  }
  return ControladorPruebaR14Registro;
}

interface RegistroLeido {
  readonly texto: string;
  readonly nivel: number;
  readonly mensaje: string;
  readonly err?: Record<string, unknown>;
}

/** Hace la peticion y devuelve la respuesta con los registros nuevos que genero. */
async function pedir(ruta: string): Promise<{ estado: number; cuerpo: unknown; registros: RegistroLeido[] }> {
  const desde = lineas.length;
  const respuesta = await request(app.getHttpServer()).get(ruta);
  await new Promise((resolver) => setTimeout(resolver, 150));
  const registros = lineas.slice(desde).map((linea) => {
    const registro = JSON.parse(linea) as { level?: number; msg?: string; err?: Record<string, unknown> };
    return {
      texto: linea,
      nivel: registro.level ?? 0,
      mensaje: registro.msg ?? '',
      ...(registro.err ? { err: registro.err } : {}),
    };
  });
  return { estado: respuesta.status, cuerpo: respuesta.body as unknown, registros };
}

function comprobarRegistrosSinValores(texto: string, contexto: string): void {
  for (const prohibido of PROHIBIDOS_R14) {
    expect(texto, `${contexto}: no debe contener "${prohibido}"`).not.toContain(prohibido);
  }
}

/** Provoca el error y comprueba que el ataque se reproduce: el stack tiene una linea de "marco" con el valor. Devuelve el error. */
async function provocarYComprobarElAtaque(letra: Letra): Promise<Error & { code?: unknown }> {
  const { esErrorDeBase } = await cargarRegistroDeErrores();
  const error = await intentar(() => PROVOCAR[letra](datos.A.id, siguienteNumero()));
  expect(error, `(${letra}) la llamada debia rechazar con el error`).toBeInstanceOf(Error);
  expect(esErrorDeBase(error), `(${letra}) debia ser un error de la base`).toBe(true);
  expect(
    lineaDeMarcoConValor((error as Error).stack),
    `(${letra}) el ataque no se reproduce: el stack no tiene una linea que empiece con espacios y "at " y contenga ${DNI_R14}. Stack: ${(error as Error).stack}`,
  ).toBeDefined();
  return error as Error & { code?: unknown };
}

const CASOS: readonly { readonly letra: Letra; readonly titulo: string; readonly sqlstates?: readonly string[] }[] = [
  { letra: 'a', titulo: '$queryRaw con SELECT $1::date (22007 o 22008)', sqlstates: ['22007', '22008'] },
  { letra: 'b', titulo: 'configuracion.create con un Json de claves "at ..." (PrismaClientValidationError)' },
  { letra: 'c', titulo: 'auditoria.create con ip "x\\n    at 44556677" (P2007 o 22P02)', sqlstates: ['22P02'] },
];

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

describe.each(CASOS)('criterio 163, error ($letra): $titulo', ({ letra, sqlstates }) => {
  it(`criterio 163 (${letra}): el ataque se reproduce: el stack del error tiene una linea de "marco" con el valor`, async () => {
    const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();

    const error = await provocarYComprobarElAtaque(letra);

    if (letra === 'a') expect(['22007', '22008'], 'SQLSTATE del error (a)').toContain(codigoDeErrorDeBase(error));
    if (letra === 'b') expect(error.name).toBe('PrismaClientValidationError');
    if (letra === 'c') {
      const codigoPrisma = typeof error.code === 'string' ? error.code : undefined;
      expect(
        codigoPrisma === 'P2007' || codigoDeErrorDeBase(error) === '22P02',
        `(c) P2007 o 22P02; code=${String(error.code)} sqlstate=${String(codigoDeErrorDeBase(error))}`,
      ).toBe(true);
    }
  });

  it(`criterio 163 (${letra}): errorParaRegistro no contiene los valores, ni en util.inspect ni en JSON.stringify, y contiene el tipo y los codigos`, async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
    const error = await provocarYComprobarElAtaque(letra);

    const resultado = errorParaRegistro(error);

    const objeto = comoObjeto(resultado, `error (${letra})`);
    comprobarSinValores(resultado, `error (${letra})`);
    expect(typeof objeto['tipo'], 'el tipo').toBe('string');
    expect(textoCompleto(resultado), 'contiene el tipo').toContain(String(objeto['tipo']));
    if (/^PrismaClient/.test(error.name)) expect(objeto['tipo']).toBe(error.name);
    const codigoPrisma = typeof error.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : undefined;
    const sqlstate = codigoDeErrorDeBase(error);
    if (codigoPrisma !== undefined) expect(objeto['codigoPrisma'], 'codigo de Prisma').toBe(codigoPrisma);
    if (sqlstate !== null) expect(objeto['sqlstate'], 'SQLSTATE').toBe(sqlstate);
    if (sqlstates !== undefined && letra === 'a')
      expect(sqlstates, 'SQLSTATE del resultado').toContain(objeto['sqlstate']);
    if (letra === 'c') {
      expect(
        codigoPrisma === 'P2007' || objeto['sqlstate'] === '22P02',
        `el resultado lleva P2007 o 22P02: ${textoCompleto(resultado)}`,
      ).toBe(true);
    }
  });

  it(`criterio 163 (${letra}): un Error propio con este error como cause da un objeto con su mensaje y la causa limpia, sin los valores`, async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const original = await provocarYComprobarElAtaque(letra);
    const propio = new Error('No se pudo completar la operacion de prueba', { cause: original });

    const resultado = errorParaRegistro(propio);

    const objeto = comoObjeto(resultado, `propio (${letra})`);
    expect(objeto['mensaje']).toBe('No se pudo completar la operacion de prueba');
    const causa = comoObjeto(objeto['causa'], `causa del propio (${letra})`);
    expect(typeof causa['tipo']).toBe('string');
    comprobarSinValores(resultado, `propio (${letra})`);
  });

  it(`criterio 163 (${letra}): un Error propio dentro de otro Error propio (dos niveles de cause) tampoco deja ver los valores`, async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const original = await provocarYComprobarElAtaque(letra);
    const propio = new Error('nivel 1', { cause: new Error('nivel 2', { cause: original }) });

    const resultado = errorParaRegistro(propio);

    comoObjeto(resultado, `propio profundo (${letra})`);
    comprobarSinValores(resultado, `propio profundo (${letra})`);
  });

  it(`criterio 163 (${letra}): por la API, la ruta responde 500 ERROR_INTERNO con un registro de nivel error con el tipo y ningun registro contiene los valores`, async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
    const original = await provocarYComprobarElAtaque(letra);
    const esperado = comoObjeto(errorParaRegistro(original), `esperado (${letra})`);
    const n = siguienteNumero();
    const ruta =
      letra === 'a'
        ? `/api/prueba-r14-registro/a/${datos.A.id}`
        : `/api/prueba-r14-registro/${letra}/${datos.A.id}/${n}`;

    const { estado, cuerpo, registros } = await pedir(ruta);

    expect(estado, JSON.stringify(cuerpo)).toBe(500);
    expect(errorApiSchema.parse(cuerpo).codigo).toBe('ERROR_INTERNO');
    comprobarRegistrosSinValores(
      registros.map((registro) => registro.texto).join('\n'),
      `registros de la API (${letra})`,
    );
    comprobarRegistrosSinValores(JSON.stringify(cuerpo), `respuesta de la API (${letra})`);
    const delError = registros.filter(
      (registro) => registro.nivel === 50 && typeof registro.err?.['tipo'] === 'string',
    );
    expect(
      delError.length,
      `ningun registro de nivel error con err.tipo; registros: ${registros.map((r) => r.texto).join('\n')}`,
    ).toBeGreaterThan(0);
    expect(
      delError.some((registro) => registro.err?.['tipo'] === esperado['tipo']),
      `ningun registro de nivel error con el tipo ${String(esperado['tipo'])}; err: ${JSON.stringify(delError.map((r) => r.err))}`,
    ).toBe(true);
    const sqlstate = codigoDeErrorDeBase(original);
    if (sqlstate !== null) {
      expect(
        delError.some((registro) => registro.err?.['sqlstate'] === sqlstate),
        `el registro lleva el SQLSTATE ${sqlstate}; err: ${JSON.stringify(delError.map((r) => r.err))}`,
      ).toBe(true);
    }
  });
});
