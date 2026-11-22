// spec: 006-caja (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  codigoDe,
  cookiesDeCaja,
  crearEscenarioDeCaja,
  type EscenarioCaja,
  type CajaDePrueba,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  conexionesInactivasEnTransaccion,
  crearAppHistorial,
  dispositionDelPdf,
  exigirGeneradorInyectable,
  exigirRutasDeHistorial,
  PDF_FALSO,
  type RespuestaHistorial,
  rutaPdf,
} from '../../utilidades/caja-historial';
import { crearCajaDeHoyCerrada, crearCajasCerradas, fotoDeEscrituras } from '../../utilidades/caja-pdf-academias';
import { esperarHasta, pausa } from '../../utilidades/caja-pdf-concurrencia';
import {
  abrirClienteDePipelining,
  conUsuariosBloqueada,
  descargarConHttp,
  descargasPorUnaConexionKeepAlive,
  esperarEstadoDeLaCola,
  type EspiaDeEscritura,
  espiarEscrituras,
  esperarQue,
  estadoDeLaCola,
  valoresDurante,
  vigilarAdvertencias,
  vigilarConexiones,
} from '../../utilidades/caja-pdf-corte';
import { comoGeneradorDePrueba, datosDeLlamada, GeneradorConSenal } from '../../utilidades/caja-pdf-senal';
import { conLimite, observar } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 55 (crítico, ronda adversarial 3 de la 006b, falla F1; amplía el criterio 51 a, b y d; DT-15; D-23): una descarga cortada antes de llegar al
// controlador no ocupa nada. El criterio 51 detecta el corte con el `close` de la respuesta, pero el controlador lo escucha recién al ejecutarse:
// si el cliente corta antes (middleware de la sesión, guards, resto de Nest), el evento ya pasó. Con pipelining, la segunda petición de un socket no
// tiene todavía el socket asignado a su respuesta y nunca emite `close`.
//   a) Conexión cerrada: la respuesta se cerró sin terminar de enviarse, o el socket de la petición está destruido.
//   b) Al entrar al manejador, si la conexión ya está cerrada, la descarga cuenta como cortada antes de pedir turno: no ocupa lugar ni cupos, no vuelve
//      a verificar la sesión, no lee, no llama al generador, no escribe la respuesta, no escribe en la base y no audita.
//   c) El `close` del socket también avisa: sale de la fila o se aborta; el oyente se quita al terminar la descarga.
//   d) Nunca se escribe en una conexión cerrada: ni el PDF ni un JSON de error.
//   f) Pruebas de integración con la API escuchando en un puerto. "Enseguida" es, a más tardar, 1 000 ms. El caso 4 (generador real) está en
//      `pdf-corte-antes-del-controlador-real.test.ts`.
// En todos los casos las filas de `cajas`, `movimientos_caja`, `cierres_caja` y `auditoria` no cambian y ninguna conexión del rol de la app queda
// `idle in transaction`.

const ENSEGUIDA_MS = 1000;
/** Lo que se espera a que una descarga que debe quedar esperando su turno no haya respondido (si respondió, fue un 429). */
const ESPERA_DE_UN_TURNO_MS = 500;
/** Lo que la prueba espera, como mucho, a que ocurra algo que sí debe ocurrir. */
const ESPERA_MAXIMA_MS = 10_000;
const COLA_VACIA = { enCurso: 0, enEspera: 0 };

describe('una descarga cortada antes de llegar al controlador no ocupa nada (criterio 55)', () => {
  const generador = new GeneradorConSenal();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  /** La caja de hoy de A, cerrada, abierta por la SECRETARIA S1. */
  let kA: CajaDePrueba;
  /** La caja de hoy de B, cerrada. */
  let kB: CajaDePrueba;
  let espia: EspiaDeEscritura;
  let vigiaDeConexiones: ReturnType<typeof vigilarConexiones>;
  /** Todas las descargas lanzadas por la prueba (también las cortadas), para esperarlas al final aunque la prueba falle. */
  let lanzadas: Promise<unknown>[];
  /** Lo que se cierra al final de cada prueba, también si falló. */
  let alTerminar: (() => void)[];

  beforeAll(async () => {
    ctx = await crearAppHistorial(AHORA_PRUEBAS, comoGeneradorDePrueba(generador));
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    generador.restablecer();
    lanzadas = [];
    alTerminar = [];
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    kA = await crearCajaDeHoyCerrada(e.A.id, e.secretariaA.id, e.adminA.id, '100.00');
    kB = await crearCajaDeHoyCerrada(e.B.id, e.secretariaB.id, e.adminB.id, '50.00');
    espia = espiarEscrituras();
    vigiaDeConexiones = vigilarConexiones(ctx.app);
  });
  afterEach(async () => {
    // Pase lo que pase en la prueba, ninguna descarga queda colgada del generador ni ocupando un lugar de la cola del proceso.
    for (const cerrar of alTerminar) cerrar();
    generador.liberar();
    await Promise.race([Promise.allSettled(lanzadas), pausa(15_000)]);
    vigiaDeConexiones.detener();
    espia.restaurar();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  /** Lanza una descarga normal por `fetch` (queda registrada para el final de la prueba). */
  const lanzar = (cajaId: string, cookie: string, numero: number | string = 1) => {
    const descarga = observar(ctx.http.get(rutaPdf(cajaId, numero), cookie));
    lanzadas.push(descarga.resultado);
    return descarga;
  };

  /** Comprueba que una descarga sigue esperando su turno (no respondió): si respondió, fue un 429 por un cupo que no se liberó. */
  async function exigirQueEspera(descarga: { resultado: Promise<RespuestaHistorial> }, contexto: string) {
    const respuesta = await esperarHasta(descarga.resultado, ESPERA_DE_UN_TURNO_MS);
    expect
      .soft(
        respuesta === undefined,
        `${contexto}: debía esperar su turno y respondió ${respuesta?.status} ${respuesta ? codigoDe(respuesta) : ''} (el lugar o los cupos de la descarga cortada no se liberaron)`,
      )
      .toBe(true);
  }

  const idDeLlamada = (indice: number) => datosDeLlamada(generador.llamadas[indice] as { datos: unknown }).caja.id;

  /** Sin efectos (55 f): no se escribe ni se audita, y ninguna conexión del rol de la app queda `idle in transaction`. */
  async function exigirSinEfectos(antes: Record<string, string>) {
    expect.soft(await fotoDeEscrituras([e.A.id, e.B.id]), 'no se escribe ni se audita').toEqual(antes);
    expect.soft(await conexionesInactivasEnTransaccion(), 'ninguna conexión idle in transaction').toEqual([]);
  }

  describe('caso 1: corte durante la verificación de la sesión (determinista)', () => {
    it('criterio 55 f.1: con la verificación de la sesión retenida por LOCK TABLE usuarios, cortar la descarga de S1 no llama al generador, deja la cola en {0,0}, no escribe la respuesta y dos descargas nuevas de S1 no reciben 429', async () => {
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
      const corte = 'corte-1';

      await conUsuariosBloqueada(async (bloqueo) => {
        // S1 pide el PDF de un cierre de A con node:http y la cabecera x-prueba-corte.
        const descarga = descargarConHttp(ctx.app, rutaPdf(kA.id, 1), cookies.secretaria, corte);
        lanzadas.push(descarga.resultado);

        // La prueba espera a ver en pg_stat_activity una conexión del rol de la app que espera un bloqueo: la verificación retenida.
        const esperando = await bloqueo.esperarVerificaciones(1, ESPERA_MAXIMA_MS);
        expect(
          esperando,
          'la verificación de la sesión de S1 debía quedar esperando el bloqueo de usuarios',
        ).toBeGreaterThanOrEqual(1);

        // Corta con destroy() y espera a que el servidor registre el cierre.
        descarga.cortar();
        const cerrado = await vigiaDeConexiones.esperarCierres(ESPERA_MAXIMA_MS);
        expect(cerrado, 'el servidor no registró el cierre de la conexión cortada').toBe(true);

        // Termina la transacción del bloqueo (ROLLBACK).
        await bloqueo.soltar();
      });

      // Durante los 1 000 ms siguientes, el generador no recibe ninguna llamada y `estado` sigue en {0,0}.
      const estados = await valoresDurante(ENSEGUIDA_MS, () => estadoDeLaCola(ctx.app));
      expect
        .soft(estados, 'durante los 1 000 ms siguientes la cola sigue en { enCurso: 0, enEspera: 0 }')
        .toEqual([COLA_VACIA]);
      expect.soft(generador.llamadas, 'el generador no recibe ninguna llamada de la descarga cortada').toHaveLength(0);
      expect
        .soft(espia.llamadasDe(corte), 'la descarga cortada no escribe en la respuesta (ni PDF ni JSON de error)')
        .toEqual([]);

      // Después, dos descargas nuevas de S1 no reciben 429: entran al generador, que recibe exactamente esas dos llamadas, y al soltarlo responden 200.
      const nuevas = [lanzar(kA.id, cookies.secretaria), lanzar(kA.id, cookies.secretaria)];
      await esperarQue(() => generador.llamadas.length >= 2, ESPERA_DE_UN_TURNO_MS * 4);
      await exigirQueEspera(nuevas[0] as (typeof nuevas)[number], 'la primera descarga nueva de S1');
      await exigirQueEspera(nuevas[1] as (typeof nuevas)[number], 'la segunda descarga nueva de S1');
      expect
        .soft(generador.llamadas, 'el generador recibe exactamente las dos llamadas de las descargas nuevas')
        .toHaveLength(2);
      const terminaron = await generador.soltarHastaQueTerminen(nuevas.map((d) => d.resultado));
      expect.soft(terminaron, 'las dos descargas nuevas terminan al soltar el generador').toBe(true);
      for (const [i, descarga] of nuevas.entries()) {
        const r = await descarga.resultado;
        expect.soft(r.status, `descarga nueva ${i + 1}: ${r.texto.slice(0, 200)}`).toBe(200);
      }
      expect.soft(generador.llamadas, 'el generador no recibió ninguna llamada más').toHaveLength(2);
      expect.soft(estadoDeLaCola(ctx.app), 'al terminar, la cola vuelve a {0,0}').toEqual(COLA_VACIA);
      expect
        .soft(espia.llamadasDe(corte), 'la descarga cortada nunca escribe, tampoco al soltar el generador')
        .toEqual([]);
      await exigirSinEfectos(antes);
    }, 90_000);
  });

  describe('caso 2: cortes inmediatos, 20 veces', () => {
    it('criterio 55 f.2: cortar con destroy() apenas termina de enviarse la petición, 20 veces seguidas, no llama al generador, deja la cola en {0,0}, no escribe y una descarga nueva de S1 responde 200', async () => {
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
      const cortes: string[] = [];
      for (let i = 0; i < 20; i += 1) {
        const descarga = descargarConHttp(ctx.app, rutaPdf(kA.id, 1), cookies.secretaria, `corte-2-${i}`, {
          cortarAlEnviar: true,
        });
        lanzadas.push(descarga.resultado);
        cortes.push(descarga.corte);
        await descarga.enviada;
      }
      await vigiaDeConexiones.esperarCierres(ESPERA_MAXIMA_MS);

      // 1 000 ms después del último corte, `estado` es {0,0}; el generador no recibió ninguna llamada; el espía no anotó ninguna escritura.
      const estados = await valoresDurante(ENSEGUIDA_MS, () => estadoDeLaCola(ctx.app));
      expect
        .soft(estados.at(-1), '1 000 ms después del último corte la cola está en { enCurso: 0, enEspera: 0 }')
        .toEqual(COLA_VACIA);
      expect
        .soft(generador.llamadas, 'el generador no recibe ninguna llamada de las descargas cortadas')
        .toHaveLength(0);
      expect.soft(espia.llamadasConPrefijo('corte-2-'), 'ninguna descarga cortada escribe en su respuesta').toEqual([]);

      // Una descarga nueva de S1 responde 200 al soltar el generador.
      const nueva = lanzar(kA.id, cookies.secretaria);
      const terminaron = await generador.soltarHastaQueTerminen([nueva.resultado]);
      expect.soft(terminaron, 'la descarga nueva termina al soltar el generador').toBe(true);
      const r = await nueva.resultado;
      expect.soft(r.status, `descarga nueva: ${r.texto.slice(0, 200)}`).toBe(200);
      expect.soft(estadoDeLaCola(ctx.app), 'al terminar, la cola vuelve a {0,0}').toEqual(COLA_VACIA);
      await exigirSinEfectos(antes);
    }, 90_000);
  });

  describe('caso 3: pipelining cortado', () => {
    it('criterio 55 f.3: con dos peticiones en pipelining esperando turno, cortar el socket saca las dos de la fila (también la segunda, sin socket en su respuesta), libera sus cupos y el generador solo recibe las 4 llamadas vivas', async () => {
      const [cajaX, cajaY] = (await crearCajasCerradas(e.A.id, e.secretariaA.id, e.adminA.id, 2)) as [
        CajaDePrueba,
        CajaDePrueba,
      ];
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
      const corte = 'corte-3';

      // 1. Dos descargas del ADMIN de B ocupan los dos lugares y el generador tiene sus dos llamadas.
      const delAdminB = [lanzar(kB.id, cookies.adminB), lanzar(kB.id, cookies.adminB)];
      await conLimite(generador.esperarEnCurso(2), 'las dos descargas del ADMIN de B no llegaron al generador');

      // 2. Con node:net, una conexión y, en una sola escritura, dos peticiones GET completas del PDF de un cierre de A (X) con la cookie de S1.
      const cliente = await abrirClienteDePipelining(ctx.app);
      alTerminar.push(() => cliente.cortar());
      await cliente.escribir([rutaPdf(cajaX.id, 1), rutaPdf(cajaX.id, 1)], cookies.secretaria, corte);

      // 3. Espera a que `estado` sea { enCurso: 2, enEspera: 2 }.
      const llena = await esperarEstadoDeLaCola(ctx.app, { enCurso: 2, enEspera: 2 }, ESPERA_MAXIMA_MS);
      expect(
        llena.cumplido,
        `las dos peticiones en pipelining debían esperar turno (estado: ${JSON.stringify(llena.estado)})`,
      ).toBe(true);

      // 4. Corta el socket con destroy().
      cliente.cortar();

      // Enseguida, `estado` es { enCurso: 2, enEspera: 0 }: las dos salen de la fila, también la segunda.
      const salida = await esperarEstadoDeLaCola(ctx.app, { enCurso: 2, enEspera: 0 }, ENSEGUIDA_MS);
      expect
        .soft(
          salida.cumplido,
          `${ENSEGUIDA_MS} ms después de cortar, la cola debía estar en { enCurso: 2, enEspera: 0 } y está en ${JSON.stringify(salida.estado)}`,
        )
        .toBe(true);

      // Enseguida, dos descargas nuevas de S1, de otro cierre de A (Y), no reciben 429: esperan su turno.
      const nuevas = [lanzar(cajaY.id, cookies.secretaria), lanzar(cajaY.id, cookies.secretaria)];
      await exigirQueEspera(nuevas[0] as (typeof nuevas)[number], 'la primera descarga nueva de S1 (cierre Y)');
      await exigirQueEspera(nuevas[1] as (typeof nuevas)[number], 'la segunda descarga nueva de S1 (cierre Y)');

      // Al soltar el generador, las dos del ADMIN de B y las dos nuevas de S1 responden 200.
      const vivas = [...delAdminB, ...nuevas];
      const terminaron = await generador.soltarHastaQueTerminen(vivas.map((d) => d.resultado));
      expect.soft(terminaron, 'las cuatro descargas vivas terminan al soltar el generador').toBe(true);
      for (const [i, descarga] of vivas.entries()) {
        const r = await descarga.resultado;
        expect.soft(r.status, `descarga viva ${i + 1}: ${r.texto.slice(0, 200)}`).toBe(200);
      }

      // El generador recibió exactamente 4 llamadas, y ninguna con los datos del cierre X.
      expect.soft(generador.llamadas, 'el generador recibió exactamente 4 llamadas').toHaveLength(4);
      expect
        .soft(
          generador.llamadas.map((_, i) => idDeLlamada(i)),
          'ninguna llamada al generador es del cierre X (el de las peticiones cortadas)',
        )
        .not.toContain(cajaX.id);
      expect.soft(espia.llamadasDe(corte), 'las dos descargas cortadas no escriben en su respuesta').toEqual([]);
      expect.soft(estadoDeLaCola(ctx.app), 'al terminar, la cola vuelve a {0,0}').toEqual(COLA_VACIA);
      await exigirSinEfectos(antes);
    }, 90_000);
  });

  describe('caso 5: controles, lo que no se corta sigue igual', () => {
    it('criterio 55 f.5: una descarga normal, sin cortar, responde 200 con el PDF', async () => {
      generador.liberar();
      const r = await conLimite(ctx.http.get(rutaPdf(kA.id, 1), cookies.secretaria), 'la descarga no respondió');
      expect(r.status, r.texto.slice(0, 200)).toBe(200);
      expect(r.headers.get('content-type')).toBe('application/pdf');
      expect(r.headers.get('content-disposition')).toBe(dispositionDelPdf(kA.fecha, 1));
      expect(r.cuerpo.equals(PDF_FALSO)).toBe(true);
      await esperarQue(() => estadoDeLaCola(ctx.app).enCurso === 0, ENSEGUIDA_MS);
      expect(estadoDeLaCola(ctx.app)).toEqual(COLA_VACIA);
    });

    it('criterio 55 f.5: dos descargas en pipelining por la misma conexión, sin cortar, responden 200 las dos, en orden y cada una con el PDF de su cierre', async () => {
      const [cajaX, cajaY] = (await crearCajasCerradas(e.A.id, e.secretariaA.id, e.adminA.id, 2)) as [
        CajaDePrueba,
        CajaDePrueba,
      ];
      generador.liberar();
      const cliente = await abrirClienteDePipelining(ctx.app);
      alTerminar.push(() => cliente.cortar());
      await cliente.escribir([rutaPdf(cajaX.id, 1), rutaPdf(cajaY.id, 1)], cookies.secretaria, 'control-pipelining');
      const respuestas = await cliente.esperarRespuestas(2, ESPERA_MAXIMA_MS);
      expect(respuestas, 'llegaron las dos respuestas').toHaveLength(2);
      expect(respuestas.map((r) => r.status)).toEqual([200, 200]);
      expect(
        respuestas.map((r) => r.headers['content-disposition']),
        'en orden y cada una con el PDF de su cierre',
      ).toEqual([dispositionDelPdf(cajaX.fecha, 1), dispositionDelPdf(cajaY.fecha, 1)]);
      for (const r of respuestas) expect(r.cuerpo.equals(PDF_FALSO)).toBe(true);
      // Las dos peticiones se atienden a la vez: el orden en que llegan al generador no es parte del contrato, el de las respuestas sí.
      expect(generador.llamadas.map((_, i) => idDeLlamada(i)).sort(), 'el generador recibió los dos cierres').toEqual(
        [cajaX.id, cajaY.id].sort(),
      );
      cliente.cortar();
      await esperarQue(() => estadoDeLaCola(ctx.app).enCurso === 0, ENSEGUIDA_MS);
      expect(estadoDeLaCola(ctx.app)).toEqual(COLA_VACIA);
    });

    it('criterio 55 f.5: 15 descargas seguidas por la misma conexión keep-alive responden 200 y no dejan oyentes acumulados en el socket (ningún MaxListenersExceededWarning)', async () => {
      generador.liberar();
      const advertencias = vigilarAdvertencias();
      alTerminar.push(() => advertencias.detener());
      const { respuestas, conexiones } = await descargasPorUnaConexionKeepAlive(
        ctx.app,
        Array.from({ length: 15 }, () => rutaPdf(kA.id, 1)),
        cookies.secretaria,
      );
      expect(respuestas.map((r) => r.status)).toEqual(Array.from({ length: 15 }, () => 200));
      for (const r of respuestas) expect(r.cuerpo.equals(PDF_FALSO)).toBe(true);
      expect(conexiones, 'las 15 descargas usaron una sola conexión keep-alive').toBe(1);
      // Las advertencias de `process` se emiten en el turno siguiente.
      await pausa(100);
      expect(advertencias.maximoDeOyentes(), 'cada descarga quita su oyente del socket').toEqual([]);
      await esperarQue(() => estadoDeLaCola(ctx.app).enCurso === 0, ENSEGUIDA_MS);
      expect(estadoDeLaCola(ctx.app)).toEqual(COLA_VACIA);
    });
  });
});
