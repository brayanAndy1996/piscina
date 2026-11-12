// spec: 001-academias-aislamiento (pruebas protegidas)
import { Controller, Get, Param, type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { obtenerAuditoria, type AuditoriaServicePrueba } from '../../utilidades/modulos';
import { esperarTransaccionAbortada, resultadoDe } from '../../utilidades/ronda10';
import {
  accionDe,
  claveDe,
  contarAuditoriaDeAcademia,
  contarAuditoriaDePlataforma,
  esperarConexionSana,
  leerAcademiasPorPrefijo,
  leerValorDeConfiguracion,
  nada,
  nombreCortoDe,
  siguienteNumero,
  VALOR,
  type DelegadosRonda12,
} from '../../utilidades/ronda12';
import { obtenerBaseDatosRonda3, type BaseDatosRonda3, type ClienteRonda3 } from '../../utilidades/ronda3';

// Criterio 156 (ataque ronda 12, F1; amplia los criterios 21, 26, 30 y 149): `asentar()` solo esperaba las consultas que ya estaban en la
// cola cuando `terminar()` apagaba el envoltorio. La segunda consulta de una cadena sin `await` (`x.create(...).then(() => registrar...)
// .catch(...)`, o `void (async () => { await ...; await ...; })()`, formas que el lint acepta) se llama cuando la primera se asienta, ya
// con el envoltorio apagado: se rechazaba con "La transaccion ya termino." sin enviarse ni marcar nada, y la operacion confirmaba y
// respondia exito sin esa escritura (por ejemplo, sin la auditoria). Ahora el envoltorio sigue aceptando las llamadas hasta que `asentar()`
// termina y una llamada tardia hace rechazar con `ErrorTransaccionAbortada`.
//
// Los casos corren en `conAcademia(A, ...)` (filas de `configuraciones`; el registro con `registrarEnAcademia`) y en `comoPlataforma`
// (academias; el registro con `registrarEnPlataforma`). En cada caso `trabajo` pone `termino = true` justo antes de devolver un valor
// reconocible y la continuacion guarda el valor que ve de `termino` (debe ser `true`: prueba que la llamada llego despues de que `trabajo`
// termino). Lo escrito se lee como duenio con una conexion nueva. Casos:
//   1  `.then().catch()` sin `await`: resuelve con el valor y existen la fila (o la academia) y su registro de auditoria;
//   2  `void (async () => { await escritura; await registro; })()`: el mismo resultado;
//   3  cadena que falla (la segunda escritura es un duplicado, con `.catch(() => undefined)`): rechaza con `ErrorTransaccionAbortada` y
//      no queda nada, tampoco la primera escritura; ademas, la misma cadena con `void` y funcion `async` que atrapa el error;
//   4  por la API: un controlador de prueba cuya ruta llama a `comoPlataforma` con la forma 2 responde con exito, y la academia y su
//      registro existen.
// Despues de cada caso, con `DATABASE_POOL_MAX=1`, un `conAcademia(B, ...)` en la misma conexion resuelve, lee su contexto y no ve nada.

type Contexto = 'conAcademia' | 'comoPlataforma';

const CONTEXTOS: readonly Contexto[] = ['conAcademia', 'comoPlataforma'];

/** Lo que `trabajo` puede hacer en cada contexto (las mismas operaciones, sobre `configuraciones` o sobre `academias`). */
interface Operaciones {
  /** Crea la fila nueva `prueba_r12_<n>` (o la academia `prueba-r12-<n>`). */
  escribir(n: number): Promise<unknown>;
  /** Crea un duplicado de algo que ya existe en A (una clave de `configuraciones`, una academia con el nombre corto de A): rechaza con 23505. */
  duplicar(): Promise<unknown>;
  /** Registro de auditoria `PRUEBA_R12_<n>`. */
  auditar(n: number): Promise<void>;
}

interface Escenario {
  correr<T>(trabajo: (operaciones: Operaciones) => Promise<T>): Promise<T>;
  /** Si existe la fila (o academia) `prueba_r12_<n>`, leida como duenio. */
  existe(n: number): Promise<boolean>;
  /** Registros de auditoria `PRUEBA_R12_<n>`. */
  auditorias(n: number): Promise<number>;
}

/** Lo que ve la continuacion de una cadena sin `await`. */
interface Visto {
  terminoAlContinuar?: boolean;
}

let app: NestExpressApplication;
let base: BaseDatosRonda3;
let auditoria: AuditoriaServicePrueba;
let datos: DatosDeAislamiento;

const delegadosDe = (cliente: ClienteRonda3): DelegadosRonda12 => cliente as unknown as DelegadosRonda12;

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
            duplicar: () =>
              delegadosDe(tx.cliente).configuracion.create({
                data: { academiaId: tx.academiaId, clave: 'clave_a_1', valor: { marca: 'duplicada' } },
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
              data: { nombre: `Academia R12 ${n}`, nombreCorto: nombreCortoDe(n) },
            }),
          duplicar: () =>
            delegadosDe(tx.cliente).academia.create({ data: { nombre: 'Duplicada R12', nombreCorto: 'academia-a' } }),
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

/** Forma 1: `escritura.then(() => registro).catch(...)` sin `await`; `termino` se pone justo antes de devolver. */
function cadenaThenCatch(op: Operaciones, n: number, visto: Visto, estado: { termino: boolean }): void {
  op.escribir(n)
    .then(() => {
      visto.terminoAlContinuar = estado.termino;
      return op.auditar(n);
    })
    .catch(nada);
}

/** Forma 2: `void (async () => { await escritura; await registro; })()`, sin ningun `catch`. */
function cadenaVoidAsync(op: Operaciones, n: number, visto: Visto, estado: { termino: boolean }): void {
  void (async () => {
    await op.escribir(n);
    visto.terminoAlContinuar = estado.termino;
    await op.auditar(n);
  })();
}

const FORMAS = [
  { forma: '.then().catch() sin await', cadena: cadenaThenCatch },
  { forma: 'void (async () => { await ...; await ...; })()', cadena: cadenaVoidAsync },
] as const;

/** Controlador de prueba (opcion `controladores` de `crearAppDePruebas`): llama a `comoPlataforma` con la forma 2. */
function crearControladorDePrueba(): Type<unknown> {
  @Controller('prueba-r12')
  class ControladorPruebaR12 {
    @Get('plataforma/:n')
    async plataforma(@Param('n') n: string): Promise<{ valor: string; terminoAlContinuar: boolean | undefined }> {
      const numero = Number(n);
      const visto: Visto = {};
      const valor = await base.comoPlataforma((tx) => {
        const estado = { termino: false };
        const op: Operaciones = {
          escribir: (m) =>
            delegadosDe(tx.cliente).academia.create({
              data: { nombre: `Academia R12 ${m}`, nombreCorto: nombreCortoDe(m) },
            }),
          duplicar: () => Promise.resolve(),
          auditar: (m) =>
            auditoria.registrarEnPlataforma(tx, {
              actorTipo: 'SISTEMA',
              actorId: null,
              accion: accionDe(m),
              entidad: 'prueba',
              entidadId: null,
            }),
        };
        cadenaVoidAsync(op, numero, visto, estado);
        estado.termino = true;
        return Promise.resolve(VALOR);
      });
      return { valor, terminoAlContinuar: visto.terminoAlContinuar };
    }
  }
  return ControladorPruebaR12;
}

beforeAll(async () => {
  app = await crearAppDePruebas({
    nivelRegistro: 'silent',
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

describe.each(CONTEXTOS)('criterio 156: %s acepta las consultas encadenadas hasta que asentar termina', (contexto) => {
  describe('criterio 156, casos 1 y 2: cadena sin await (.then().catch() y void con funcion async)', () => {
    for (const { forma, cadena } of FORMAS) {
      it(`criterio 156 (caso ${forma.startsWith('void') ? 2 : 1}): ${contexto}, ${forma}: resuelve con el valor y existen la escritura y su registro de auditoria`, async () => {
        const escenario = escenarioDe(contexto);
        const n = siguienteNumero();
        const visto: Visto = {};

        const resultado = await resultadoDe(() =>
          escenario.correr((op) => {
            const estado = { termino: false };
            cadena(op, n, visto, estado);
            estado.termino = true;
            return Promise.resolve(VALOR);
          }),
        );

        expect(resultado, 'debia resolver con el valor de trabajo').toEqual({ resolvio: true, valor: VALOR });
        expect(visto.terminoAlContinuar, 'la continuacion corrio despues de que trabajo termino (premisa)').toBe(true);
        expect(await escenario.existe(n), 'la fila o academia nueva').toBe(true);
        expect(await escenario.auditorias(n), 'el registro de auditoria encadenado').toBe(1);
        await esperarConexionSana(base, datos.B.id, `${contexto}, ${forma}`);
      });
    }
  });

  describe('criterio 156, caso 3: cadena que falla', () => {
    it(`criterio 156 (caso 3): ${contexto}, .then().catch(): la segunda escritura es un duplicado atrapado; rechaza con ErrorTransaccionAbortada y no queda nada, tampoco la primera escritura`, async () => {
      const escenario = escenarioDe(contexto);
      const n = siguienteNumero();
      const visto: Visto = {};

      const resultado = await resultadoDe(() =>
        escenario.correr((op) => {
          let termino = false;
          op.escribir(n)
            .then(() => {
              visto.terminoAlContinuar = termino;
              return op.duplicar();
            })
            .catch(() => undefined);
          termino = true;
          return Promise.resolve(VALOR);
        }),
      );

      await esperarTransaccionAbortada(resultado, `${contexto}, caso 3`);
      expect(visto.terminoAlContinuar, 'la continuacion corrio despues de que trabajo termino (premisa)').toBe(true);
      expect(await escenario.existe(n), 'la primera escritura no queda').toBe(false);
      expect(await escenario.auditorias(n), 'no hay registro de auditoria').toBe(0);
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 3`);
    });

    it(`criterio 156 (caso 3): ${contexto}, void con funcion async que atrapa el duplicado: rechaza con ErrorTransaccionAbortada y no queda nada`, async () => {
      const escenario = escenarioDe(contexto);
      const n = siguienteNumero();
      const visto: Visto = {};

      const resultado = await resultadoDe(() =>
        escenario.correr((op) => {
          let termino = false;
          void (async () => {
            await op.escribir(n);
            visto.terminoAlContinuar = termino;
            try {
              await op.duplicar();
            } catch {
              // Atrapado a proposito: el duplicado aborta la transaccion.
            }
          })();
          termino = true;
          return Promise.resolve(VALOR);
        }),
      );

      await esperarTransaccionAbortada(resultado, `${contexto}, caso 3, void`);
      expect(visto.terminoAlContinuar, 'la continuacion corrio despues de que trabajo termino (premisa)').toBe(true);
      expect(await escenario.existe(n), 'la primera escritura no queda').toBe(false);
      await esperarConexionSana(base, datos.B.id, `${contexto}, caso 3, void`);
    });
  });
});

describe('criterio 156, caso 4: por la API', () => {
  it('criterio 156 (caso 4): la ruta de un controlador que llama a comoPlataforma con la forma void async responde con exito, y la academia y su registro existen', async () => {
    const escenario = escenarioDe('comoPlataforma');
    const n = siguienteNumero();

    const respuesta = await request(app.getHttpServer()).get(`/api/prueba-r12/plataforma/${n}`);

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
    expect(respuesta.body).toEqual({ valor: VALOR, terminoAlContinuar: true });
    expect(await escenario.existe(n), 'la academia nueva').toBe(true);
    expect(await escenario.auditorias(n), 'el registro de auditoria encadenado').toBe(1);
    await esperarConexionSana(base, datos.B.id, 'API, caso 4');
  });
});
