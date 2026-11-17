// spec: 001-academias-aislamiento (pruebas protegidas)
import { errorApiSchema } from '@aquagestion/contratos';
import { Controller, Get, Param, type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SoloSesion } from '../../../src/modulos/autenticacion';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import { esperarTransaccionAbortada, resultadoDe } from '../../utilidades/ronda10';
import {
  accionDe,
  ALERGIA_DE_PRUEBA,
  cargarRegistroDeErrores,
  claveDe,
  comoObjeto,
  delegadosDe,
  DNI_DE_PRUEBA,
  esperarConexionSana,
  propiasComoJson,
  siguienteNumero,
  textoCompleto,
  VALOR,
} from '../../utilidades/ronda13';
import { intentar, obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';
import { cargarPuntoAutorizado } from '../../utilidades/ronda4';
import { sesionDeAcademia } from '../../utilidades/sesion-academia';

// Criterios 161 y 162 (ataque ronda 13, F2 y O1; P-36 y P-42), con errores reales de Prisma y de la base:
//
// 161  La causa de `ErrorTransaccionAbortada` nunca lleva el mensaje de Prisma ni los valores. Cuando `trabajo` atrapa un error de la base y
//      sigue, `conAcademia`/`comoPlataforma` rechazan con `ErrorTransaccionAbortada`; antes su `cause` era el error de Prisma con el valor
//      rechazado (`invalid input syntax for type inet: "DNI 44556677"`) y el registro del 500 (`{ err }` con pino, que serializa la `cause`) lo
//      mostraba. Ahora la causa es una `CausaLimpia`. Casos: (1) la escritura de `ip: 'DNI 44556677'` en `auditoria` (o `auditoria_plataforma`)
//      atrapada con `try`/`catch`; (2) `$executeRaw` con `SELECT ${'DNI 44556677'}::inet` atrapado; (3) por la API, con el registro de la app
//      capturado.
// 162  El registro tecnico de un error de Prisma o de la base no lleva mensajes, valores ni datos: `errorParaRegistro(error)` de un error real
//      (a) `PrismaClientValidationError` (un campo que el modelo no tiene), (b) la escritura de `ip: 'DNI 44556677'` por el delegado y (c)
//      `$executeRaw` con `::inet`, provocados en `conAcademia(A, ...)` sin atraparlos; y las rutas de un controlador de prueba, que responden 500
//      `ERROR_INTERNO` con un registro de nivel `error` con el `tipo` y el codigo, sin ningun valor.

type Contexto = 'conAcademia' | 'comoPlataforma';
type Escritura = 'delegado' | 'cruda';

const CONTEXTOS: readonly Contexto[] = ['conAcademia', 'comoPlataforma'];

/** Fragmentos que nunca deben quedar en una causa ni en un registro. */
const PROHIBIDOS = [DNI_DE_PRUEBA, ALERGIA_DE_PRUEBA, 'alergias', 'invalid input syntax'] as const;

const { destino, lineas } = crearDestinoDeRegistro();

let app: NestExpressApplication;
let base: BaseDatosRonda3;
let datos: DatosDeAislamiento;

/** La escritura de `ip: 'DNI 44556677'` por el delegado de auditoria (Prisma la reporta con P2007 o con el SQLSTATE 22P02). */
function escribirIpInvalida(
  contexto: Contexto,
  tx: { academiaId?: string; cliente: unknown },
  n: number,
): Promise<unknown> {
  const cliente = tx.cliente as Parameters<typeof delegadosDe>[0];
  const comunes = {
    fechaHora: new Date(),
    actorTipo: 'SISTEMA',
    accion: accionDe(n),
    entidad: 'prueba',
    ip: `DNI ${DNI_DE_PRUEBA}`,
  };
  return contexto === 'conAcademia'
    ? delegadosDe(cliente).auditoria.create({ data: { ...comunes, academiaId: tx.academiaId } })
    : delegadosDe(cliente).auditoriaPlataforma.create({ data: comunes });
}

/** Una consulta cruda que falla con 22P02 y lleva el valor en su mensaje. */
function consultaCrudaInvalida(cliente: {
  $executeRaw: (p: TemplateStringsArray, ...v: unknown[]) => Promise<number>;
}): Promise<number> {
  return cliente.$executeRaw`SELECT ${`DNI ${DNI_DE_PRUEBA}`}::inet`;
}

/** Corre `trabajo` que provoca el error de `escritura`, lo atrapa y devuelve `VALOR` (la transaccion queda abortada). */
function correrAtrapando(contexto: Contexto, escritura: Escritura, n: number): Promise<string> {
  const provocar = async (tx: { academiaId?: string; cliente: unknown }): Promise<void> => {
    try {
      if (escritura === 'delegado') await escribirIpInvalida(contexto, tx, n);
      else await consultaCrudaInvalida(tx.cliente as Parameters<typeof consultaCrudaInvalida>[0]);
    } catch {
      // Atrapado a proposito: la transaccion queda abortada y trabajo sigue.
    }
  };
  return contexto === 'conAcademia'
    ? base.conAcademia(datos.A.id, async (tx) => {
        await provocar(tx);
        return VALOR;
      })
    : base.comoPlataforma(async (tx) => {
        await provocar(tx);
        return VALOR;
      });
}

/** (a) un `PrismaClientValidationError`: el modelo no tiene los campos `dni` ni `alergias`. */
function provocarValidacion(academiaId: string, n: number): Promise<unknown> {
  return base.conAcademia(academiaId, (tx) =>
    delegadosDe(tx.cliente).configuracion.create({
      data: {
        academiaId: tx.academiaId,
        clave: claveDe(n),
        valor: {},
        dni: DNI_DE_PRUEBA,
        alergias: ALERGIA_DE_PRUEBA,
      },
    }),
  );
}

/** (b) la escritura de `ip: 'DNI 44556677'` en `auditoria` por el delegado, sin atrapar. */
function provocarEscrituraDeIp(academiaId: string, n: number): Promise<unknown> {
  return base.conAcademia(academiaId, (tx) => escribirIpInvalida('conAcademia', tx, n));
}

/** (c) `$executeRaw` con `::inet`, sin atrapar (22P02). */
function provocarConsultaCruda(academiaId: string): Promise<unknown> {
  return base.conAcademia(academiaId, (tx) => consultaCrudaInvalida(tx.cliente));
}

/** Controlador de prueba (opcion `controladores` de `crearAppDePruebas`): una ruta por caso. */
function crearControladorDePrueba(): Type<unknown> {
  @Controller('prueba-r13-registro')
  class ControladorPruebaR13Registro {
    @Get('abortada/:n')
    @SoloSesion()
    async abortada(@Param('n') n: string): Promise<{ valor: string }> {
      return { valor: await correrAtrapando('comoPlataforma', 'delegado', Number(n)) };
    }

    @Get('a/:id/:n')
    @SoloSesion()
    async a(@Param('id') id: string, @Param('n') n: string): Promise<unknown> {
      return provocarValidacion(id, Number(n));
    }

    @Get('b/:id/:n')
    @SoloSesion()
    async b(@Param('id') id: string, @Param('n') n: string): Promise<unknown> {
      return provocarEscrituraDeIp(id, Number(n));
    }

    @Get('c/:id')
    @SoloSesion()
    async c(@Param('id') id: string): Promise<unknown> {
      return provocarConsultaCruda(id);
    }
  }
  return ControladorPruebaR13Registro;
}

interface RegistroLeido {
  readonly texto: string;
  readonly nivel: number;
  readonly mensaje: string;
  readonly err?: Record<string, unknown>;
}

/** Hace la peticion y devuelve la respuesta con los registros nuevos que genero. */
async function pedir(ruta: string): Promise<{ estado: number; cuerpo: unknown; registros: RegistroLeido[] }> {
  const { cookie } = await sesionDeAcademia(datos.A); // spec 002, criterio 18: toda ruta de `/api` de prueba exige sesion
  const desde = lineas.length;
  const respuesta = await request(app.getHttpServer()).get(ruta).set('Cookie', cookie);
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

function comprobarSinProhibidos(texto: string, contexto: string): void {
  for (const prohibido of PROHIBIDOS)
    expect(texto, `${contexto}: no debe contener "${prohibido}"`).not.toContain(prohibido);
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

describe.each(CONTEXTOS)(
  'criterio 161: %s, la causa de ErrorTransaccionAbortada no lleva el mensaje de Prisma',
  (contexto) => {
    const CASOS: readonly { readonly escritura: Escritura; readonly titulo: string }[] = [
      {
        escritura: 'delegado',
        titulo: 'caso 1, la escritura de ip: "DNI 44556677" por el delegado, atrapada con try/catch',
      },
      { escritura: 'cruda', titulo: 'caso 2, $executeRaw con SELECT $1::inet atrapado con try/catch' },
    ];

    for (const { escritura, titulo } of CASOS) {
      it(`criterio 161 (${titulo}): rechaza con ErrorTransaccionAbortada cuyo texto completo no contiene el valor, y codigoDeErrorDeBase(cause) es 22P02 o 25P02`, async () => {
        const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
        const n = siguienteNumero();

        const resultado = await resultadoDe(() => correrAtrapando(contexto, escritura, n));

        await esperarTransaccionAbortada(resultado, `${contexto}, ${titulo}`);
        const error = resultado.error as Error;
        comprobarSinProhibidos(textoCompleto(error), `${contexto}, ${titulo}, inspect`);
        comprobarSinProhibidos(propiasComoJson(error), `${contexto}, ${titulo}, propiedades del error`);
        comprobarSinProhibidos(propiasComoJson(error.cause), `${contexto}, ${titulo}, propiedades de la causa`);
        expect(['22P02', '25P02'], `${contexto}, ${titulo}: SQLSTATE de la causa`).toContain(
          codigoDeErrorDeBase(error.cause),
        );
      });

      it(`criterio 161 (${titulo}): la causa es una CausaLimpia, sin cause ni meta`, async () => {
        const { CausaLimpia } = await cargarRegistroDeErrores();
        const n = siguienteNumero();

        const resultado = await resultadoDe(() => correrAtrapando(contexto, escritura, n));

        expect(resultado.resolvio, `${contexto}, ${titulo}`).toBe(false);
        const causa = (resultado.error as Error).cause;
        expect(causa, `${contexto}, ${titulo}`).toBeInstanceOf(CausaLimpia);
        expect((causa as Error).cause).toBeUndefined();
        expect((causa as { meta?: unknown }).meta).toBeUndefined();
      });

      it(`criterio 161 (${titulo}): no queda nada escrito y la conexion queda sana (DATABASE_POOL_MAX=1)`, async () => {
        const n = siguienteNumero();

        await resultadoDe(() => correrAtrapando(contexto, escritura, n));

        await esperarConexionSana(base, datos.B.id, `${contexto}, ${titulo}`);
      });
    }
  },
);

describe('criterio 161, caso 3: por la API, con el registro de la app capturado', () => {
  it('criterio 161 (caso 3): la ruta responde 500 ERROR_INTERNO, ningun registro contiene el valor ni "invalid input syntax" y alguno de nivel warn o error dice que la transaccion quedo abortada', async () => {
    const n = siguienteNumero();

    const { estado, cuerpo, registros } = await pedir(`/api/prueba-r13-registro/abortada/${n}`);

    expect(estado, JSON.stringify(cuerpo)).toBe(500);
    expect(errorApiSchema.parse(cuerpo).codigo).toBe('ERROR_INTERNO');
    comprobarSinProhibidos(registros.map((registro) => registro.texto).join('\n'), 'registros de la API');
    comprobarSinProhibidos(JSON.stringify(cuerpo), 'respuesta de la API');
    expect(
      registros.some((registro) => registro.nivel >= 40 && /abortad/i.test(registro.mensaje)),
      `ningun registro de nivel warn o error dice que la transaccion quedo abortada; mensajes: ${JSON.stringify(registros.map((r) => r.mensaje))}`,
    ).toBe(true);
    await esperarConexionSana(base, datos.B.id, 'API, caso 3');
  });
});

describe('criterio 162: errorParaRegistro con errores reales de Prisma y de la base', () => {
  /** Los errores (a), (b) y (c), provocados en `conAcademia(A, ...)` sin atraparlos. */
  const ERRORES: readonly {
    readonly letra: string;
    readonly titulo: string;
    readonly provocar: (n: number) => Promise<unknown>;
    readonly llevaCodigo: boolean;
  }[] = [
    {
      letra: 'a',
      titulo: 'PrismaClientValidationError (un campo que el modelo no tiene)',
      provocar: (n) => provocarValidacion(datos.A.id, n),
      llevaCodigo: false,
    },
    {
      letra: 'b',
      titulo: 'la escritura de ip: "DNI 44556677" en auditoria por el delegado (P2007 o 22P02)',
      provocar: (n) => provocarEscrituraDeIp(datos.A.id, n),
      llevaCodigo: true,
    },
    {
      letra: 'c',
      titulo: '$executeRaw con SELECT $1::inet (22P02)',
      provocar: () => provocarConsultaCruda(datos.A.id),
      llevaCodigo: true,
    },
  ];

  for (const { letra, titulo, provocar, llevaCodigo } of ERRORES) {
    describe(`error (${letra}): ${titulo}`, () => {
      it(`criterio 162 (${letra}): la llamada rechaza con el error de Prisma y esErrorDeBase es verdadero`, async () => {
        const { esErrorDeBase } = await cargarRegistroDeErrores();

        const error = await intentar(() => provocar(siguienteNumero()));

        expect(error, 'la llamada debia rechazar con el error').toBeInstanceOf(Error);
        expect(esErrorDeBase(error)).toBe(true);
      });

      it(`criterio 162 (${letra}): errorParaRegistro no contiene el valor, los datos ni el mensaje de Prisma, y contiene el tipo y el codigo`, async () => {
        const { errorParaRegistro } = await cargarRegistroDeErrores();
        const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
        const error = (await intentar(() => provocar(siguienteNumero()))) as Error & { code?: unknown };

        const resultado = errorParaRegistro(error);

        const objeto = comoObjeto(resultado, `error (${letra})`);
        comprobarSinProhibidos(textoCompleto(resultado), `error (${letra}), inspect`);
        comprobarSinProhibidos(JSON.stringify(resultado), `error (${letra}), JSON`);
        expect(typeof objeto['tipo'], 'el tipo').toBe('string');
        expect(textoCompleto(resultado), 'contiene el tipo').toContain(String(objeto['tipo']));
        if (/^PrismaClient/.test(error.name)) expect(objeto['tipo']).toBe(error.name);
        const codigoPrisma = typeof error.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : undefined;
        const sqlstate = codigoDeErrorDeBase(error);
        if (codigoPrisma !== undefined) expect(objeto['codigoPrisma'], 'codigo de Prisma').toBe(codigoPrisma);
        if (sqlstate !== null) expect(objeto['sqlstate'], 'SQLSTATE').toBe(sqlstate);
        if (llevaCodigo) {
          expect(
            codigoPrisma !== undefined || sqlstate !== null,
            'el error trae un codigo de Prisma o un SQLSTATE',
          ).toBe(true);
        }
      });

      it(`criterio 162 (${letra}): un Error propio con este error como cause da un objeto con su mensaje y la causa limpia`, async () => {
        const { errorParaRegistro } = await cargarRegistroDeErrores();
        const original = await intentar(() => provocar(siguienteNumero()));
        const propio = new Error('No se pudo completar la operacion de prueba', { cause: original });

        const resultado = errorParaRegistro(propio);

        const objeto = comoObjeto(resultado, `propio (${letra})`);
        expect(objeto['mensaje']).toBe('No se pudo completar la operacion de prueba');
        expect(typeof comoObjeto(objeto['causa'], `causa del propio (${letra})`)['tipo']).toBe('string');
        comprobarSinProhibidos(textoCompleto(resultado), `propio (${letra}), inspect`);
        comprobarSinProhibidos(JSON.stringify(resultado), `propio (${letra}), JSON`);
      });

      it(`criterio 162 (${letra}): por la API, la ruta responde 500 ERROR_INTERNO con un registro de nivel error con el tipo y sin ningun valor`, async () => {
        const n = siguienteNumero();
        const ruta =
          letra === 'c'
            ? `/api/prueba-r13-registro/c/${datos.A.id}`
            : `/api/prueba-r13-registro/${letra}/${datos.A.id}/${n}`;

        const { estado, cuerpo, registros } = await pedir(ruta);

        expect(estado, JSON.stringify(cuerpo)).toBe(500);
        expect(errorApiSchema.parse(cuerpo).codigo).toBe('ERROR_INTERNO');
        comprobarSinProhibidos(
          registros.map((registro) => registro.texto).join('\n'),
          `registros de la API (${letra})`,
        );
        const delError = registros.filter(
          (registro) => registro.nivel === 50 && typeof registro.err?.['tipo'] === 'string',
        );
        expect(
          delError.length,
          `ningun registro de nivel error con err.tipo; registros: ${registros.map((r) => r.texto).join('\n')}`,
        ).toBeGreaterThan(0);
        if (llevaCodigo) {
          expect(
            delError.some(
              (registro) => registro.err?.['codigoPrisma'] !== undefined || registro.err?.['sqlstate'] !== undefined,
            ),
            `el registro lleva el codigo de Prisma o el SQLSTATE; err: ${JSON.stringify(delError.map((r) => r.err))}`,
          ).toBe(true);
        }
      });
    });
  }

  it('criterio 162 (control): errorParaRegistro devuelve el mismo Error comun, con su mensaje, como hoy', async () => {
    const { errorParaRegistro } = await cargarRegistroDeErrores();
    const comun = new Error('fallo comun de prueba r13');

    expect(errorParaRegistro(comun)).toBe(comun);
  });
});
