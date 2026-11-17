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
import {
  crearDestinoDeRegistro,
  obtenerAuditoria,
  uuidInexistente,
  type AuditoriaServicePrueba,
} from '../../utilidades/modulos';
import { cargarErrorTransaccionAbortada, esperarTransaccionAbortada, resultadoDe } from '../../utilidades/ronda10';
import {
  accionDe,
  claveDe,
  contarAuditoriaDeAcademia,
  contarAuditoriaDePlataforma,
  crearGuardador,
  delegadosDe,
  esperarConexionSana,
  leerAcademiasPorPrefijo,
  leerValorDeConfiguracion,
  nombreCortoDe,
  siguienteNumero,
  VALOR,
} from '../../utilidades/ronda13';
import { esperarCondicion, obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';
import { sesionDeAcademia } from '../../utilidades/sesion-academia';

// Criterio 160 (ataque ronda 13, F1 (b); amplia los criterios 149, 154 y 156; precisa la quinta vineta del 153 y P-38): una operacion
// enviada sin `await` (dentro de una funcion `async` lanzada sin esperarla, o con `.catch`) que rechaza con un error que no es de la base
// (un P2025) DESPUES de que `trabajo` termino no abortaba la transaccion en PostgreSQL, nada la marcaba y se confirmaba lo anterior sin lo
// que venia despues (la auditoria). Ahora, desde que `asentar()` empieza, el rechazo de una operacion del envoltorio marca la transaccion:
// la operacion rechaza con `ErrorTransaccionAbortada` (no con el error original), la llamada a `conAcademia`/`comoPlataforma` rechaza con
// `ErrorTransaccionAbortada`, Prisma revierte y no queda nada escrito.
//
// Los casos corren en `conAcademia(A, ...)` (filas de `configuraciones`; registro con `registrarEnAcademia`) y en `comoPlataforma`
// (academias; registro con `registrarEnPlataforma`). En cada caso `trabajo` pone `termino = true` justo antes de devolver un valor
// reconocible y la operacion que falla guarda el valor que ve de `termino` al rechazar (debe ser `true`: prueba que rechazo despues de que
// `trabajo` termino). La funcion `async` guarda su rechazo con `.catch(guardar)` en lugar de `void` (en ejecucion es lo mismo: el
// envoltorio no ve quien espera la funcion). Lo escrito se lee como duenio con una conexion nueva. Casos:
//   1  reproduccion del ataque: escritura con `await`; luego, sin `await`, `(async () => { await update(no existe); await registro; })()`;
//   2  `.catch` y `.then(ok, err)` sin `await` sobre un `update` que no existe, despues de una escritura y su registro con `await`;
//   3  control, mientras `trabajo` corre (criterio 153 sin cambios): `await update(no existe).catch(...)` resuelve y quedan las dos filas;
//   4  por la API: un controlador de prueba que llama a `comoPlataforma` con la forma 1 responde 500 `ERROR_INTERNO` y no queda la academia.
// Despues de cada caso, con `DATABASE_POOL_MAX=1`, un `conAcademia(B, ...)` en la misma conexion resuelve, lee su contexto y no ve nada.

type Contexto = 'conAcademia' | 'comoPlataforma';

const CONTEXTOS: readonly Contexto[] = ['conAcademia', 'comoPlataforma'];

/** Lo que `trabajo` puede hacer en cada contexto (las mismas operaciones, sobre `configuraciones` o sobre `academias`). */
interface Operaciones {
  /** Crea la fila nueva `prueba_r13_<n>` (o la academia `prueba-r13-<n>`). */
  escribir(n: number): Promise<unknown>;
  /** Un `update` de algo que no existe: rechaza con P2025 (no es un error de la base: no aborta la transaccion). */
  actualizarInexistente(): Promise<unknown>;
  /** Registro de auditoria `PRUEBA_R13_<n>`. */
  auditar(n: number): Promise<void>;
}

interface Escenario {
  correr<T>(trabajo: (operaciones: Operaciones) => Promise<T>): Promise<T>;
  /** Si existe la fila (o academia) `prueba_r13_<n>`, leida como duenio. */
  existe(n: number): Promise<boolean>;
  /** Registros de auditoria `PRUEBA_R13_<n>`. */
  auditorias(n: number): Promise<number>;
}

/** Lo que ve la operacion que falla cuando rechaza. */
interface Visto {
  terminoAlRechazar?: boolean;
}

const { destino, lineas } = crearDestinoDeRegistro();

let app: NestExpressApplication;
let base: BaseDatosRonda3;
let auditoria: AuditoriaServicePrueba;
let datos: DatosDeAislamiento;

function escenarioDe(contexto: Contexto): Escenario {
  if (contexto === 'conAcademia') {
    const academiaId = datos.A.id;
    return {
      correr: (trabajo) =>
        base.conAcademia(academiaId, (tx) =>
          trabajo({
            escribir: (n) =>
              delegadosDe(tx.cliente).configuracion.create({
                data: { academiaId: tx.academiaId, clave: claveDe(n), valor: { marca: 'nueva' } },
              }),
            actualizarInexistente: () =>
              delegadosDe(tx.cliente).configuracion.update({
                where: { academiaId_clave: { academiaId: tx.academiaId, clave: 'clave_que_no_existe_r13' } },
                data: { valor: { marca: 'no-existe' } },
              }),
            auditar: (n) =>
              auditoria.registrarEnAcademia(tx, {
                actorTipo: 'SISTEMA',
                actorId: null,
                accion: accionDe(n),
                entidad: 'prueba',
                entidadId: null,
              }),
          }),
        ),
      existe: async (n) => (await leerValorDeConfiguracion(academiaId, claveDe(n))) !== undefined,
      auditorias: (n) => contarAuditoriaDeAcademia(academiaId, accionDe(n)),
    };
  }
  return {
    correr: (trabajo) =>
      base.comoPlataforma((tx) =>
        trabajo({
          escribir: (n) =>
            delegadosDe(tx.cliente).academia.create({
              data: { nombre: `Academia R13 ${n}`, nombreCorto: nombreCortoDe(n) },
            }),
          actualizarInexistente: () =>
            delegadosDe(tx.cliente).academia.update({
              where: { id: uuidInexistente() },
              data: { motivoSuspension: 'no-existe' },
            }),
          auditar: (n) =>
            auditoria.registrarEnPlataforma(tx, {
              actorTipo: 'SISTEMA',
              actorId: null,
              accion: accionDe(n),
              entidad: 'prueba',
              entidadId: null,
            }),
        }),
      ),
    existe: async (n) => (await leerAcademiasPorPrefijo(nombreCortoDe(n))).length > 0,
    auditorias: (n) => contarAuditoriaDePlataforma(accionDe(n)),
  };
}

/** Controlador de prueba (opcion `controladores` de `crearAppDePruebas`): llama a `comoPlataforma` con la forma 1. */
function crearControladorDePrueba(): Type<unknown> {
  @Controller('prueba-r13')
  class ControladorPruebaR13 {
    @Get('plataforma/:n')
    @SoloSesion()
    async plataforma(@Param('n') n: string): Promise<{ valor: string }> {
      const numero = Number(n);
      const { guardar } = crearGuardador();
      const estado = { termino: false };
      const valor = await escenarioDe('comoPlataforma').correr(async (op) => {
        await op.escribir(numero);
        formaAsyncSinAwait(op, numero, {}, estado, guardar);
        estado.termino = true;
        return VALOR;
      });
      return { valor };
    }
  }
  return ControladorPruebaR13;
}

/**
 * Forma 1: `(async () => { await update(no existe); await registro; })().catch(guardar)` sin `await`. `termino` se lee en la operacion que
 * falla, al rechazar.
 */
function formaAsyncSinAwait(
  op: Operaciones,
  n: number,
  visto: Visto,
  estado: { termino: boolean },
  guardar: (error: unknown) => void,
): void {
  (async () => {
    try {
      await op.actualizarInexistente();
    } catch (error) {
      visto.terminoAlRechazar = estado.termino;
      throw error;
    }
    await op.auditar(n);
  })().catch(guardar);
}

beforeAll(async () => {
  app = await crearAppDePruebas({
    nivelRegistro: 'info',
    destinoRegistro: destino,
    variables: { DATABASE_POOL_MAX: '1' },
    controladores: [crearControladorDePrueba()],
  });
  base = await obtenerBaseDatosRonda3(app);
  auditoria = await obtenerAuditoria(app);
});
beforeEach(async () => {
  await limpiarBase();
  datos = await crearDatosDeAislamiento();
});
afterAll(async () => {
  await app?.close();
});

describe.each(CONTEXTOS)(
  'criterio 160: %s hace fallar la transaccion si una operacion rechaza despues de que trabajo termino',
  (contexto) => {
    describe('criterio 160, caso 1: reproduccion del ataque (funcion async sin await)', () => {
      it(`criterio 160 (caso 1): ${contexto}: rechaza con ErrorTransaccionAbortada, no quedan la escritura ni el registro, y la funcion recibe un ErrorTransaccionAbortada`, async () => {
        const { ErrorTransaccionAbortada } = await cargarErrorTransaccionAbortada();
        const escenario = escenarioDe(contexto);
        const n = siguienteNumero();
        const visto: Visto = {};
        const { guardados, guardar } = crearGuardador();

        const resultado = await resultadoDe(() =>
          escenario.correr(async (op) => {
            const estado = { termino: false };
            await op.escribir(n);
            formaAsyncSinAwait(op, n, visto, estado, guardar);
            estado.termino = true;
            return VALOR;
          }),
        );

        await esperarTransaccionAbortada(resultado, `${contexto}, caso 1`);
        await esperarCondicion(() => guardados.length > 0, 2000);
        expect(visto.terminoAlRechazar, 'la operacion rechazo despues de que trabajo termino (premisa)').toBe(true);
        expect(guardados, 'la funcion async recibio un rechazo').toHaveLength(1);
        expect(
          guardados[0],
          'lo que recibe la funcion es un ErrorTransaccionAbortada, nunca el error original (P2025)',
        ).toBeInstanceOf(ErrorTransaccionAbortada);
        expect(await escenario.existe(n), 'la escritura previa no queda').toBe(false);
        expect(await escenario.auditorias(n), 'no hay registro de auditoria').toBe(0);
        await esperarConexionSana(base, datos.B.id, `${contexto}, caso 1`);
      });
    });

    describe('criterio 160, caso 2: .catch y .then(ok, err) sin await', () => {
      const FORMAS = [
        {
          forma: '.catch(() => null)',
          enviar: (op: Operaciones, alRechazar: () => void): void => {
            op.actualizarInexistente().catch(() => {
              alRechazar();
              return null;
            });
          },
        },
        {
          forma: '.then(() => 1, () => null)',
          enviar: (op: Operaciones, alRechazar: () => void): void => {
            op.actualizarInexistente().then(
              () => 1,
              () => {
                alRechazar();
                return null;
              },
            );
          },
        },
      ] as const;

      for (const { forma, enviar } of FORMAS) {
        it(`criterio 160 (caso 2): ${contexto}, ${forma} despues de una escritura y su registro con await: rechaza con ErrorTransaccionAbortada y no queda nada`, async () => {
          const escenario = escenarioDe(contexto);
          const n = siguienteNumero();
          const estado = { termino: false };
          const visto: Visto = {};

          const resultado = await resultadoDe(() =>
            escenario.correr(async (op) => {
              await op.escribir(n);
              await op.auditar(n);
              enviar(op, () => {
                visto.terminoAlRechazar = estado.termino;
              });
              estado.termino = true;
              return VALOR;
            }),
          );

          await esperarTransaccionAbortada(resultado, `${contexto}, caso 2, ${forma}`);
          expect(visto.terminoAlRechazar, 'el .catch corrio despues de que trabajo termino (premisa)').toBe(true);
          expect(await escenario.existe(n), 'la escritura no queda').toBe(false);
          expect(await escenario.auditorias(n), 'el registro no queda').toBe(0);
          await esperarConexionSana(base, datos.B.id, `${contexto}, caso 2, ${forma}`);
        });
      }
    });

    describe('criterio 160, caso 3: control, mientras trabajo corre (criterio 153 sin cambios)', () => {
      it(`criterio 160 (caso 3): ${contexto}, await update(no existe).catch(...) y await ...then(ok, err) dentro de trabajo: resuelve con el valor y quedan las dos filas`, async () => {
        const escenario = escenarioDe(contexto);
        const n = siguienteNumero();

        const resultado = await resultadoDe(() =>
          escenario.correr(async (op) => {
            const atrapado = await op.actualizarInexistente().catch(() => 'atrapado-con-catch');
            const separado = await op.actualizarInexistente().then(
              () => 'ok',
              () => 'atrapado-con-then',
            );
            expect(
              [atrapado, separado],
              'los rechazos llegan con su propio error, no como ErrorTransaccionAbortada',
            ).toEqual(['atrapado-con-catch', 'atrapado-con-then']);
            await op.escribir(n);
            await op.auditar(n);
            return VALOR;
          }),
        );

        expect(resultado, 'debia resolver con el valor').toEqual({ resolvio: true, valor: VALOR });
        expect(await escenario.existe(n), 'la fila o academia nueva').toBe(true);
        expect(await escenario.auditorias(n), 'el registro de auditoria').toBe(1);
        await esperarConexionSana(base, datos.B.id, `${contexto}, caso 3`);
      });
    });
  },
);

describe('criterio 160, caso 4: por la API', () => {
  it('criterio 160 (caso 4): la ruta de un controlador que llama a comoPlataforma con la forma 1 responde 500 ERROR_INTERNO y no queda la academia', async () => {
    const escenario = escenarioDe('comoPlataforma');
    const n = siguienteNumero();

    const { cookie } = await sesionDeAcademia(datos.A);

    const respuesta = await request(app.getHttpServer()).get(`/api/prueba-r13/plataforma/${n}`).set('Cookie', cookie);

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(500);
    expect(errorApiSchema.parse(respuesta.body).codigo).toBe('ERROR_INTERNO');
    expect(JSON.stringify(respuesta.body), 'la respuesta es la generica').not.toContain('ErrorTransaccionAbortada');
    expect(await escenario.existe(n), 'la academia nueva no queda').toBe(false);
    expect(await escenario.auditorias(n), 'el registro no queda').toBe(0);
    await esperarConexionSana(base, datos.B.id, 'API, caso 4');
  });

  it('criterio 160: el registro tecnico dice que una operacion rechazo despues de que trabajo termino y la nombra, sin argumentos ni el mensaje de Prisma', async () => {
    const n = siguienteNumero();
    const { cookie } = await sesionDeAcademia(datos.A);
    const desde = lineas.length;

    await request(app.getHttpServer()).get(`/api/prueba-r13/plataforma/${n}`).set('Cookie', cookie);
    await new Promise((resolver) => setTimeout(resolver, 150));

    const nuevas = lineas
      .slice(desde)
      .map((linea) => ({ linea, nivel: (JSON.parse(linea) as { level?: number }).level ?? 0 }));
    const delRechazo = nuevas.filter(({ linea, nivel }) => nivel >= 40 && linea.includes('academia.update'));
    expect(
      delRechazo.length,
      `ningun registro de nivel warn o error nombra la operacion (academia.update); registros: ${nuevas.map((r) => r.linea).join('\n')}`,
    ).toBeGreaterThan(0);
    expect(
      delRechazo.some(({ linea }) => linea.includes('P2025')),
      'el registro lleva el codigo de Prisma (P2025)',
    ).toBe(true);
    const texto = nuevas.map((r) => r.linea).join('\n');
    expect(texto, 'sin los argumentos de la operacion').not.toContain('no-existe');
    expect(texto, 'sin el mensaje de Prisma').not.toMatch(
      /to update not found|record.*does not exist|Record to update/i,
    );
  });
});
