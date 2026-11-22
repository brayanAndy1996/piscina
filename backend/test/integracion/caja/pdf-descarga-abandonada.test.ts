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
  exigirGeneradorInyectable,
  exigirRutasDeHistorial,
  PDF_FALSO,
  type RespuestaHistorial,
  rutaPdf,
} from '../../utilidades/caja-historial';
import {
  crearAcademiaConPersonas,
  crearCajaDeHoyCerrada,
  crearCajasCerradas,
  crearPersonaConCookie,
  fotoDeEscrituras,
  type PersonaConCookie,
} from '../../utilidades/caja-pdf-academias';
import { esperarHasta, pausa } from '../../utilidades/caja-pdf-concurrencia';
import {
  comoGeneradorDePrueba,
  datosDeLlamada,
  descargaCortable,
  esErrorDeAborto,
  esperarCondicion,
  GeneradorConSenal,
} from '../../utilidades/caja-pdf-senal';
import { abrirRetenedor, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 51 (crítico, ronda adversarial 2 de la 006b; amplía los criterios 49 b y c y PQ8; DT-10; D-23): una descarga abandonada libera su lugar.
// "Cortar" es que el cliente cierra la conexión antes de que la respuesta termine de enviarse; el servidor lo detecta en la respuesta (`close` sin
// `writableFinished`).
//   a) Si corta mientras espera turno: sale de la fila y libera enseguida su lugar en la cola, su cupo de persona (49 c) y su cupo de academia (52); no
//      se llama al generador; las demás siguen en orden de llegada.
//   b) Si corta mientras se lee o se genera: durante la lectura, esa consulta termina y no se llama al generador; mientras se genera, la generación se
//      aborta: el servicio pasa al generador una `AbortSignal` (segundo parámetro) que se activa al cortar, y el lugar y los cupos se liberan cuando
//      la promesa de `generar` termina (se rechaza por el aborto o, si el generador ignora la señal, termina como sea).
//   d) Sin efectos: no se escribe ni se audita y ninguna conexión del rol de la app queda `idle in transaction`.
//   e) Se prueba desde fuera: el cliente corta con un `AbortController`; se observan las respuestas de las demás descargas y las llamadas al generador
//      (sus `datos` y su señal). "Enseguida" es, a más tardar, 1 000 ms después de cortar.
// El generador real con 20 000 movimientos está en `pdf-descarga-abandonada-real.test.ts`; las unitarias, en `cola-pdf-senal-protegido.test.ts` y
// `cierre-pdf-senal-protegido.test.ts`.

const ENSEGUIDA_MS = 1000;
/** Lo que se espera a que una descarga que debe quedar esperando su turno no haya respondido (si respondió, fue un 429). */
const ESPERA_DE_UN_TURNO_MS = 500;

describe('una descarga abandonada libera su lugar (criterio 51)', () => {
  const generador = new GeneradorConSenal();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let kA: CajaDePrueba;
  let kB: CajaDePrueba;
  /** Todas las descargas lanzadas por la prueba (también las cortadas), para esperarlas al final aunque la prueba falle. */
  let lanzadas: Promise<unknown>[];

  beforeAll(async () => {
    ctx = await crearAppHistorial(AHORA_PRUEBAS, comoGeneradorDePrueba(generador));
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    generador.restablecer();
    lanzadas = [];
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    kA = await crearCajaDeHoyCerrada(e.A.id, e.secretariaA.id, e.adminA.id, '100.00');
    kB = await crearCajaDeHoyCerrada(e.B.id, e.secretariaB.id, e.adminB.id, '50.00');
  });
  afterEach(async () => {
    // Pase lo que pase en la prueba, ninguna descarga queda colgada del generador ni ocupando un lugar de la cola del proceso.
    generador.liberar();
    await Promise.race([Promise.allSettled(lanzadas), pausa(15_000)]);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  /** Lanza una descarga que la prueba podrá cortar (queda registrada para el final de la prueba). */
  const lanzarCortable = (cajaId: string, cookie: string, numero: number | string = 1) => {
    const descarga = descargaCortable(ctx.app, rutaPdf(cajaId, numero), cookie);
    lanzadas.push(descarga.resultado);
    return descarga;
  };
  /** Lanza una descarga que no se corta (queda registrada para el final de la prueba). */
  const lanzar = (cajaId: string, cookie: string, numero: number | string = 1) => {
    const descarga = observar(ctx.http.get(rutaPdf(cajaId, numero), cookie));
    lanzadas.push(descarga.resultado);
    return descarga;
  };

  /** Comprueba que una descarga sigue esperando su turno (no respondió): si respondió, fue un 429 por un cupo que no se liberó. */
  async function exigirQueEspera(descarga: { resultado: Promise<RespuestaHistorial> }, contexto: string) {
    const respuesta = await esperarHasta(descarga.resultado, ESPERA_DE_UN_TURNO_MS);
    expect(
      respuesta === undefined,
      `${contexto}: debía esperar su turno y respondió ${respuesta?.status} ${respuesta ? codigoDe(respuesta) : ''} (los cupos o el lugar de la descarga cortada no se liberaron)`,
    ).toBe(true);
  }

  function exigir429(respuesta: RespuestaHistorial | undefined, contexto: string) {
    expect(respuesta, `${contexto}: no respondió enseguida`).toBeDefined();
    expect(respuesta?.status, `${contexto}: ${respuesta?.texto.slice(0, 200)}`).toBe(429);
    expect(codigoDe(respuesta as RespuestaHistorial)).toBe('DEMASIADAS_SOLICITUDES');
    expect(respuesta?.cacheControl).toBe('no-store');
    expect(respuesta?.headers.get('content-disposition')).toBeNull();
  }

  const idDeLlamada = (indice: number) => datosDeLlamada(generador.llamadas[indice] as { datos: unknown }).caja.id;

  describe('a) si corta mientras espera turno', () => {
    it('criterio 51 a: dos descargas de la SECRETARIA de A que esperan y se cortan liberan su lugar y sus cupos: dos nuevas de ella esperan su turno (no 429) y el generador solo recibe 4 llamadas, ninguna de las cortadas', async () => {
      const delAdminB = [lanzar(kB.id, cookies.adminB), lanzar(kB.id, cookies.adminB)];
      await conLimite(generador.esperarEnCurso(2), 'las dos descargas del ADMIN de B no llegaron al generador');
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);

      const cortables = [lanzarCortable(kA.id, cookies.secretaria), lanzarCortable(kA.id, cookies.secretaria)];
      await pausa(300);
      expect(
        cortables.map((d) => d.terminada()),
        'las dos descargas de la SECRETARIA de A esperan su turno',
      ).toEqual([false, false]);
      for (const descarga of cortables) descarga.cortar();
      await pausa(ENSEGUIDA_MS);

      // Enseguida, dos descargas nuevas de la misma SECRETARIA no reciben 429: esperan su turno.
      const nuevas = [lanzar(kA.id, cookies.secretaria), lanzar(kA.id, cookies.secretaria)];
      await exigirQueEspera(nuevas[0] as (typeof nuevas)[number], 'la primera descarga nueva de la SECRETARIA de A');
      await exigirQueEspera(nuevas[1] as (typeof nuevas)[number], 'la segunda descarga nueva de la SECRETARIA de A');
      expect(generador.llamadas, 'las cortadas no llegan al generador mientras esperan').toHaveLength(2);

      // Al soltar el generador, las dos nuevas y las dos del ADMIN de B responden 200 y el generador recibió exactamente 4 llamadas.
      const terminaron = await generador.soltarHastaQueTerminen([...delAdminB, ...nuevas].map((d) => d.resultado));
      expect(terminaron, 'las cuatro descargas vivas terminan al soltar el generador').toBe(true);
      for (const [i, descarga] of [...delAdminB, ...nuevas].entries()) {
        const r = await descarga.resultado;
        expect(r.status, `descarga ${i + 1}: ${r.texto.slice(0, 200)}`).toBe(200);
        expect(r.cuerpo.equals(PDF_FALSO)).toBe(true);
      }
      expect(generador.llamadas, 'el generador recibió exactamente 4 llamadas: ninguna de las cortadas').toHaveLength(
        4,
      );
      expect(generador.maximoEnCurso).toBeLessThanOrEqual(2);
      // Sin efectos: no se escribe ni se audita, y nadie queda idle in transaction.
      expect(await fotoDeEscrituras([e.A.id, e.B.id]), 'no se escribe ni se audita').toEqual(antes);
      expect(await conexionesInactivasEnTransaccion()).toEqual([]);
    });

    it('criterio 51 a: con la cola llena (2 en curso y 8 en espera, de tres academias), cortar tres de las que esperan libera sus lugares: tres nuevas esperan su turno, una cuarta responde 429 y, al soltar, siguen en orden de llegada y el generador nunca recibe las cortadas', async () => {
      // Tres academias, como en el criterio 52 f: A (dos ADMIN), B (dos ADMIN) y C (dos ADMIN), con tantas cajas cerradas como descargas distintas.
      const adminB2 = await crearPersonaConCookie(e.B.id, 'ADMIN', 'Segundo', 'Admin de B');
      const c = await crearAcademiaConPersonas('academia-c', 'Academia C', ['ADMIN', 'ADMIN']);
      const [adminC, adminC2] = c.personas as [PersonaConCookie, PersonaConCookie];
      const cajasA = await crearCajasCerradas(e.A.id, e.adminA.id, e.adminA.id, 5);
      const cajasB = await crearCajasCerradas(e.B.id, e.adminB.id, e.adminB.id, 5);
      const cajasC = await crearCajasCerradas(c.academia.id, adminC.usuario.id, adminC.usuario.id, 3);
      const caja = (cajas: CajaDePrueba[], i: number) => (cajas[i] as CajaDePrueba).id;
      const antes = await fotoDeEscrituras([e.A.id, e.B.id, c.academia.id]);

      // Las diez descargas, en orden de llegada (con una pausa entre una y otra para que el orden no dependa de la red):
      // a1 y b1 se generan; esperan a2, b2, a3, b3, a4, b4, c1 y c2.
      const pedidos: [string, string, string][] = [
        ['a1', caja(cajasA, 0), cookies.admin],
        ['b1', caja(cajasB, 0), cookies.adminB],
        ['a2', caja(cajasA, 1), cookies.admin],
        ['b2', caja(cajasB, 1), cookies.adminB],
        ['a3', caja(cajasA, 2), cookies.admin2],
        ['b3', caja(cajasB, 2), adminB2.cookie],
        ['a4', caja(cajasA, 3), cookies.admin2],
        ['b4', caja(cajasB, 3), adminB2.cookie],
        ['c1', caja(cajasC, 0), adminC.cookie],
        ['c2', caja(cajasC, 1), adminC.cookie],
      ];
      const vivas: Record<string, ReturnType<typeof lanzarCortable>> = {};
      for (const [nombre, cajaId, cookie] of pedidos) {
        vivas[nombre] = lanzarCortable(cajaId, cookie);
        await pausa(100);
      }
      await conLimite(generador.esperarEnCurso(2), 'las dos primeras descargas no llegaron al generador');
      await pausa(300);
      expect(generador.llamadas, 'con la cola llena, el generador sigue con dos llamadas').toHaveLength(2);

      // Cola llena: otra descarga de una persona con cupo responde 429 (comprobación previa de que la cola está llena de verdad).
      const llenaAntes = await esperarHasta(lanzar(caja(cajasC, 2), adminC2.cookie).resultado, 3000);
      exigir429(llenaAntes, 'con la cola llena antes de cortar');

      // Se cortan tres de las que esperan.
      for (const nombre of ['a3', 'b3', 'c2']) (vivas[nombre] as ReturnType<typeof lanzarCortable>).cortar();
      await pausa(ENSEGUIDA_MS);

      // Enseguida, tres descargas nuevas de personas y academias con cupo esperan su turno (no 429): n1 de A, n2 de B y n3 de C.
      const nuevas: [string, string, string][] = [
        ['n1', caja(cajasA, 4), cookies.admin2],
        ['n2', caja(cajasB, 4), adminB2.cookie],
        ['n3', caja(cajasC, 2), adminC.cookie],
      ];
      for (const [nombre, cajaId, cookie] of nuevas) {
        vivas[nombre] = lanzarCortable(cajaId, cookie);
        await pausa(100);
      }
      for (const [nombre] of nuevas) {
        await exigirQueEspera(vivas[nombre] as ReturnType<typeof lanzarCortable>, `la descarga nueva ${nombre}`);
      }
      // Y una cuarta (de una persona y una academia con cupo) responde 429: la cola volvió a llenarse con las tres nuevas.
      const cuarta = await esperarHasta(lanzar(caja(cajasC, 2), adminC2.cookie).resultado, 3000);
      exigir429(cuarta, 'la cuarta descarga nueva, con la cola llena otra vez');
      expect(generador.llamadas, 'ninguna llamada nueva al generador mientras sigue retenido').toHaveLength(2);

      // Al soltar de a una, las que siguen en la fila entran en orden de llegada: primero las que ya esperaban y después las tres nuevas.
      const esperadas = [
        caja(cajasA, 0), // a1
        caja(cajasB, 0), // b1
        caja(cajasA, 1), // a2
        caja(cajasB, 1), // b2
        caja(cajasA, 3), // a4
        caja(cajasB, 3), // b4
        caja(cajasC, 0), // c1
        caja(cajasA, 4), // n1
        caja(cajasB, 4), // n2
        caja(cajasC, 2), // n3
      ];
      for (let i = 0; i < esperadas.length; i += 1) {
        await conLimite(
          generador.esperarLlamadas(Math.min(i + 2, esperadas.length)),
          `el generador no recibió la llamada ${Math.min(i + 2, esperadas.length)} al soltar la ${i + 1}`,
        );
        generador.soltar(i);
      }
      const vivasNombres = ['a1', 'b1', 'a2', 'b2', 'a4', 'b4', 'c1', 'n1', 'n2', 'n3'];
      const terminaron = await generador.soltarHastaQueTerminen(
        vivasNombres.map((n) => (vivas[n] as ReturnType<typeof lanzarCortable>).resultado),
      );
      expect(terminaron, 'todas las que siguen en la fila terminan').toBe(true);
      for (const nombre of vivasNombres) {
        const r = await (vivas[nombre] as ReturnType<typeof lanzarCortable>).resultado;
        expect(r.status, `descarga ${nombre}: ${r.texto.slice(0, 200)}`).toBe(200);
      }
      expect(
        generador.llamadas.map((_, i) => idDeLlamada(i)),
        'el generador recibió las que siguen en la fila en orden de llegada y ninguna de las cortadas (a3, b3 y c2)',
      ).toEqual(esperadas);
      expect(generador.maximoEnCurso).toBeLessThanOrEqual(2);
      expect(await fotoDeEscrituras([e.A.id, e.B.id, c.academia.id]), 'no se escribe ni se audita').toEqual(antes);
      expect(await conexionesInactivasEnTransaccion()).toEqual([]);
    }, 60_000);
  });

  describe('b) si corta mientras se lee o se genera', () => {
    /** Prepara: el ADMIN de B genera dos descargas (la primera, cortable) y una descarga del ADMIN de A espera. */
    async function prepararGenerandoConUnaEnEspera() {
      const b1 = lanzarCortable(kB.id, cookies.adminB);
      await conLimite(generador.esperarLlamadas(1), 'la primera descarga del ADMIN de B no llegó al generador');
      const b2 = lanzar(kB.id, cookies.adminB);
      await conLimite(generador.esperarEnCurso(2), 'las dos descargas del ADMIN de B no llegaron al generador');
      const deA = lanzar(kA.id, cookies.admin);
      await pausa(300);
      expect(deA.terminada(), 'la descarga de A espera su turno').toBe(false);
      expect(generador.llamadas, 'solo las dos del ADMIN de B están en el generador').toHaveLength(2);
      return { b1, b2, deA };
    }

    /** La señal que recibió el generador en la llamada `indice`: falla con un mensaje claro si el servicio no la pasó. */
    const senalDe = (indice: number): AbortSignal => {
      const senal = generador.llamadas[indice]?.senal;
      expect(
        senal,
        `el servicio debe pasarle al generador una AbortSignal como segundo parámetro (la llamada ${indice + 1} no la recibió)`,
      ).toBeDefined();
      return senal as AbortSignal;
    };

    it('criterio 51 b: con un generador que respeta la señal, cortar una de las dos descargas del ADMIN de B activa su señal, la descarga de A entra enseguida al generador y, al soltar, la otra del ADMIN de B y la de A responden 200', async () => {
      generador.modo = 'respeta';
      const { b1, b2, deA } = await prepararGenerandoConUnaEnEspera();
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
      const senal = senalDe(0);
      expect(senal.aborted, 'antes de cortar, la señal no está activa').toBe(false);

      b1.cortar();

      expect(
        await esperarCondicion(() => senal.aborted, ENSEGUIDA_MS),
        'la señal que recibió el generador debe quedar aborted en cuanto el cliente corta',
      ).toBe(true);
      expect(
        await esperarCondicion(() => generador.llamadas.length === 3, ENSEGUIDA_MS),
        'al abortarse la generación, el lugar se libera y la descarga de A entra enseguida al generador',
      ).toBe(true);
      expect(datosDeLlamada(generador.llamadas[2] as { datos: unknown }).caja.id).toBe(kA.id);
      expect(generador.llamadas[0]?.estado, 'la llamada abortada se rechazó').toBe('rechazada');
      expect(esErrorDeAborto(generador.llamadas[0]?.error)).toBe(true);

      const terminaron = await generador.soltarHastaQueTerminen([b2.resultado, deA.resultado]);
      expect(terminaron, 'la otra del ADMIN de B y la de A terminan al soltar').toBe(true);
      for (const [nombre, descarga] of [
        ['la otra del ADMIN de B', b2],
        ['la de A', deA],
      ] as const) {
        const r = await descarga.resultado;
        expect(r.status, `${nombre}: ${r.texto.slice(0, 200)}`).toBe(200);
        expect(r.cuerpo.equals(PDF_FALSO)).toBe(true);
      }
      expect(generador.maximoEnCurso, 'nunca más de dos llamadas a la vez').toBeLessThanOrEqual(2);
      expect(await fotoDeEscrituras([e.A.id, e.B.id]), 'no se escribe ni se audita').toEqual(antes);
      expect(await conexionesInactivasEnTransaccion()).toEqual([]);
    });

    it('criterio 51 b: con un generador que ignora la señal, la descarga de A no entra mientras la cortada siga retenida (pasados 500 ms, el generador sigue con dos llamadas) y, al soltar la cortada, entra y responde 200', async () => {
      generador.modo = 'ignora';
      const { b1, b2, deA } = await prepararGenerandoConUnaEnEspera();
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);
      const senal = senalDe(0);

      b1.cortar();

      // El servicio igual le avisa al generador (aunque lo ignore): la señal queda activa.
      expect(
        await esperarCondicion(() => senal.aborted, ENSEGUIDA_MS),
        'la señal que recibió el generador debe quedar aborted en cuanto el cliente corta',
      ).toBe(true);
      await pausa(500);
      expect(
        generador.llamadas,
        'el lugar es del generador hasta que su promesa termina: sigue con dos llamadas',
      ).toHaveLength(2);
      expect(deA.terminada(), 'la descarga de A sigue esperando su turno').toBe(false);

      // Al soltar la cortada, el lugar se libera: la de A entra y responde 200.
      expect(generador.soltar(0), 'la llamada cortada sigue retenida por el generador').toBe(true);
      expect(
        await esperarCondicion(() => generador.llamadas.length === 3, ENSEGUIDA_MS),
        'al terminar la promesa de la cortada, la descarga de A entra al generador',
      ).toBe(true);
      expect(datosDeLlamada(generador.llamadas[2] as { datos: unknown }).caja.id).toBe(kA.id);
      const terminaron = await generador.soltarHastaQueTerminen([b2.resultado, deA.resultado]);
      expect(terminaron).toBe(true);
      expect((await deA.resultado).status).toBe(200);
      expect((await b2.resultado).status).toBe(200);
      expect(generador.maximoEnCurso).toBeLessThanOrEqual(2);
      expect(await fotoDeEscrituras([e.A.id, e.B.id]), 'no se escribe ni se audita').toEqual(antes);
      expect(await conexionesInactivasEnTransaccion()).toEqual([]);
    });

    it('criterio 51 b: si corta mientras se hace la lectura (paso 6 de 49 b), esa consulta termina y no se llama al generador: la que esperaba detrás entra en su lugar', async () => {
      // El generador retiene las dos descargas del ADMIN de B. Detrás esperan D (la que se cortará) y E (otra caja de A, para distinguirlas en el generador).
      const [cajaE] = await crearCajasCerradas(e.A.id, e.adminA.id, e.adminA.id, 1);
      const delAdminB = [lanzar(kB.id, cookies.adminB), lanzar(kB.id, cookies.adminB)];
      await conLimite(generador.esperarEnCurso(2), 'las dos descargas del ADMIN de B no llegaron al generador');
      const d = lanzarCortable(kA.id, cookies.admin);
      await pausa(150);
      const otra = lanzar((cajaE as CajaDePrueba).id, cookies.admin2);
      await pausa(300);
      const antes = await fotoDeEscrituras([e.A.id, e.B.id]);

      // La prueba bloquea las tablas de la caja de A (como dueño): la lectura de D, cuando le toque el turno, queda esperando.
      const retenedor = await abrirRetenedor(e.A.id);
      let liberado = false;
      try {
        await retenedor.consultar('LOCK TABLE cajas, movimientos_caja, cierres_caja IN ACCESS EXCLUSIVE MODE');
        expect(generador.soltarUno(), 'se suelta la primera descarga del ADMIN de B: D recibe el turno').toBe(0);
        const leyendo = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [d],
          'la lectura de la descarga D no llegó a esperar el bloqueo de la prueba',
        );
        expect(leyendo, 'la descarga D llegó a la lectura y espera el bloqueo').toBe(true);

        d.cortar();
        await pausa(500);
        await retenedor.liberar('ROLLBACK');
        liberado = true;
      } finally {
        if (!liberado) await retenedor.liberar('ROLLBACK').catch(() => undefined);
      }

      // La lectura de D termina sin generar: el lugar pasa a E, que entra al generador (la 3.ª llamada).
      expect(
        await esperarCondicion(() => generador.llamadas.length >= 3, 5000),
        'la descarga que esperaba detrás de D entra al generador',
      ).toBe(true);
      await pausa(300);
      expect(
        generador.llamadas.map((_, i) => idDeLlamada(i)),
        'el generador nunca recibió la descarga D (cortada durante la lectura): recibió las dos de B y la de E',
      ).toEqual([kB.id, kB.id, (cajaE as CajaDePrueba).id]);
      const terminaron = await generador.soltarHastaQueTerminen([...delAdminB, otra].map((x) => x.resultado));
      expect(terminaron).toBe(true);
      expect((await otra.resultado).status).toBe(200);
      expect(await fotoDeEscrituras([e.A.id, e.B.id]), 'no se escribe ni se audita').toEqual(antes);
      expect(await conexionesInactivasEnTransaccion()).toEqual([]);
    }, 60_000);
  });
});
