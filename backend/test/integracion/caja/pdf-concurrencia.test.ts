// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  enLima,
  type EscenarioCaja,
  HOY,
  instantaneaDeCaja,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  archivosDelAlmacen,
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
  type PersonaConCookie,
} from '../../utilidades/caja-pdf-academias';
import { esperarHasta, GeneradorMultiple, pausa } from '../../utilidades/caja-pdf-concurrencia';
import { conLimite, observar } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 49 b y c (crítico, ronda adversarial 1 de la 006b; amplía el criterio 43; DT-7 y DT-8; D-23): cuántos PDF se generan a la vez y cuántos
// esperan, y cuántos puede tener una persona.
//   b) En cada proceso de la API, contando todas las academias, como mucho 2 PDF se generan a la vez (llamadas en curso a
//      `GENERADOR_PDF_CIERRE.generar`, también con el generador de las pruebas) y como mucho 8 descargas más esperan su turno, en orden de llegada
//      (`LIMITES_PDF_CIERRE = { simultaneos: 2, enEspera: 8 }`). Una descarga que llega con 2 en curso y 8 esperando responde enseguida 429
//      DEMASIADAS_SOLICITUDES (el cuerpo y el mensaje del filtro de errores, JSON, `Cache-Control: no-store`, sin `Content-Disposition`), sin llamar al
//      generador, sin escribir y sin auditar. Orden de las comprobaciones: 1. sesión, academia activa, cambio obligatorio y permiso; 2. forma del id y
//      del `numero` (el 404 de PQ1 y PQ6, sin tocar la base ni la cola); 3. límite por persona; 4. lugar en la cola (429 si está llena); 5. espera del
//      turno; 6. lectura en su transacción corta (404 si la caja o el cierre no existen o están fuera del alcance); 7. generación y respuesta. Una
//      descarga que espera no tiene ninguna transacción abierta. Toda descarga libera su lugar al terminar, con 200, 404 o 500.
//   c) Una persona (`sesion.usuario.id`, no la academia ni la IP) tiene como mucho 2 descargas en curso o esperando turno: la tercera simultánea
//      responde el 429 de b, aunque la cola tenga lugar, y no llama al generador. Un doble clic (dos descargas) sigue funcionando.
// Ronda adversarial 2 de la 006b (criterio 52 f): cambia el reparto de las diez descargas de b, sin cambiar su intención ni debilitar ninguna comprobación.
// Antes eran de cinco personas de A y de B, dos cada una; con el límite de 4 por academia (criterio 52), la quinta descarga de A ya respondería 429.
// Ahora son de tres academias, como mucho 4 por academia: dos personas de A, dos de B y una de C, dos descargas cada una. La 11.ª es de una sexta
// persona de una academia con cupo (otra de C), así que su 429 es por la cola llena.

const MENSAJE_DE_429 = 'Hiciste demasiadas solicitudes. Espera un momento e intenta de nuevo.';

describe('cuántos PDF se generan a la vez y cuántos puede pedir una persona (criterio 49 b y c)', () => {
  const generador = new GeneradorMultiple();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  /** KA: la caja de hoy de A, cerrada (cierre 1): la ven el ADMIN y las dos SECRETARIAS (DR-13). KB: la de B. */
  let kA: { id: string };
  let kB: { id: string };
  /** C (criterio 52 f): una academia más, con dos personas con `VER_REPORTES_FINANCIEROS` y su caja de hoy cerrada. */
  let kC: { id: string };
  let cAdmin: PersonaConCookie;
  let cSecretaria: PersonaConCookie;
  /** Todas las descargas lanzadas por la prueba, para esperarlas (o soltarlas) al final aunque la prueba falle. */
  let lanzadas: Promise<unknown>[];

  beforeAll(async () => {
    ctx = await crearAppHistorial(AHORA_PRUEBAS, generador as unknown as Parameters<typeof crearAppHistorial>[1]);
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    generador.restablecer();
    lanzadas = [];
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    const alumno = await crearAlumnoDeCaja(e.A.id);
    kA = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    await crearIngresoDePrueba(e.A.id, kA.id, e.secretariaA.id, alumno.id, {
      monto: '42.00',
      registrado_en: enLima(HOY, '09:30'),
    });
    await cerrarCajaDePrueba(e.A.id, kA.id, e.adminA.id, { cerradoEn: enLima(HOY, '09:50:00') });
    kB = await crearCajaDePrueba(e.B.id, e.secretariaB.id, { monto_inicial: '50.00' });
    await cerrarCajaDePrueba(e.B.id, kB.id, e.adminB.id, { cerradoEn: enLima(HOY, '09:50:00') });
    const c = await crearAcademiaConPersonas('academia-c', 'Academia C', ['ADMIN', 'SECRETARIA']);
    [cAdmin, cSecretaria] = c.personas as [PersonaConCookie, PersonaConCookie];
    kC = await crearCajaDeHoyCerrada(c.academia.id, cSecretaria.usuario.id, cAdmin.usuario.id);
  });
  afterEach(async () => {
    // Pase lo que pase en la prueba, ninguna descarga queda colgada del generador ni ocupando un lugar de la cola del proceso.
    generador.liberar();
    await Promise.race([Promise.allSettled(lanzadas), pausa(15_000)]);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  /** Lanza una descarga sin esperarla (queda registrada para el final de la prueba). */
  const lanzar = (cajaId: string, numero: number | string, cookie: string) => {
    const descarga = observar(ctx.http.get(rutaPdf(cajaId, numero), cookie));
    lanzadas.push(descarga.resultado);
    return descarga;
  };
  /** `GET` de una ruta con la cookie dada (sin registrar la descarga: se espera con `esperarHasta`). */
  const ctxHttp = (cookie: string, ruta: string) => ctx.http.get(ruta, cookie);
  const estado = async () => ({
    cajasA: await instantaneaDeCaja(e.A.id),
    cajasB: await instantaneaDeCaja(e.B.id),
    auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
  });

  /**
   * La respuesta de una descarga que debe terminar enseguida (un 429, un 404…), o `undefined` si en `ms` todavía no terminó (por ejemplo, porque
   * llegó al generador retenido). Así una prueba en rojo falla con su mensaje en lugar de colgarse.
   */
  const respuestaEnseguida = (descarga: { resultado: Promise<RespuestaHistorial> }, ms = 5000) =>
    esperarHasta(descarga.resultado, ms);

  /** Comprueba el 429 de la spec: JSON de siempre, con el mensaje del filtro de errores, `no-store` y sin `Content-Disposition`. */
  function esperar429(
    respuesta: RespuestaHistorial | undefined,
    contexto: string,
  ): asserts respuesta is RespuestaHistorial {
    expect(
      respuesta,
      `${contexto}: no respondió enseguida (el generador recibió ${generador.llamadas.length} llamadas, hasta ${generador.maximoEnCurso} a la vez)`,
    ).toBeDefined();
    const r = respuesta as RespuestaHistorial;
    expect(r.status, `${contexto}: ${r.texto.slice(0, 200)}`).toBe(429);
    expect(codigoDe(r)).toBe('DEMASIADAS_SOLICITUDES');
    expect(r.body?.['mensaje']).toBe(MENSAJE_DE_429);
    expect(r.headers.get('content-type') ?? '').toContain('application/json');
    expect(r.cacheControl).toBe('no-store');
    expect(r.headers.get('content-disposition')).toBeNull();
  }

  describe('b) pocas generaciones a la vez y una espera acotada', () => {
    /**
     * Las diez descargas de la spec (criterio 52 f): de tres academias, como mucho 4 por academia, dos descargas cada persona: el ADMIN y el otro ADMIN
     * de A, el ADMIN y la SECRETARIA de B, y el ADMIN de C.
     */
    const lanzarLasDiez = () =>
      (
        [
          [kA.id, cookies.admin],
          [kA.id, cookies.admin2],
          [kB.id, cookies.adminB],
          [kB.id, cookies.secretariaB],
          [kC.id, cAdmin.cookie],
        ] as const
      ).flatMap(([cajaId, cookie]) => [lanzar(cajaId, 1, cookie), lanzar(cajaId, 1, cookie)]);

    it('PQ9 c y criterio 49 b: diez descargas de cinco personas de tres academias (A, B y C, como mucho 4 por academia) con el generador retenido: nunca hay más de dos llamadas a la vez, la 11.ª responde 429, nadie queda idle in transaction y al soltar las diez responden 200 con diez llamadas', async () => {
      const diez = lanzarLasDiez();
      await conLimite(generador.esperarEnCurso(2), 'el generador del PDF nunca tuvo dos llamadas en curso');
      // Pasa el tiempo suficiente para que las otras ocho lleguen a la cola (o, si no hay cola, al generador).
      await pausa(500);

      expect(generador.llamadas.length, 'con dos en curso, el generador sigue con dos llamadas').toBe(2);
      expect(generador.enCurso).toBe(2);
      expect(generador.maximoEnCurso, 'nunca más de dos llamadas a la vez').toBeLessThanOrEqual(2);
      expect(
        await conexionesInactivasEnTransaccion(),
        'una descarga que espera su turno no tiene ninguna transacción abierta',
      ).toEqual([]);
      expect(
        diez.filter((d) => d.terminada()),
        'las diez esperan: ninguna respondió',
      ).toHaveLength(0);

      // La 11.ª descarga, de una sexta persona de una academia con cupo (la SECRETARIA de C), responde 429 enseguida por la cola llena, sin llamar al
      // generador ni escribir.
      const antes = await estado();
      const archivosAntes = archivosDelAlmacen();
      const llamadasAntes = generador.llamadas.length;
      const undecima = lanzar(kC.id, 1, cSecretaria.cookie);
      const respuesta = await respuestaEnseguida(undecima);

      esperar429(respuesta, 'la 11.ª descarga');
      expect(generador.llamadas.length, 'la 11.ª no llama al generador').toBe(llamadasAntes);
      expect(await estado(), 'la 11.ª no escribe ni audita').toEqual(antes);
      expect(archivosDelAlmacen()).toEqual(archivosAntes);
      expect(generador.maximoEnCurso).toBeLessThanOrEqual(2);
      expect(await conexionesInactivasEnTransaccion()).toEqual([]);

      // Al soltar el generador, las diez responden 200 y el generador recibió diez llamadas (la cola avanza de a dos).
      const terminaron = await generador.soltarHastaQueTerminen(diez.map((d) => d.resultado));
      expect(terminaron, 'las diez descargas terminan al soltar el generador').toBe(true);
      const respuestas = await Promise.all(diez.map((d) => d.resultado));
      for (const [i, r] of respuestas.entries()) {
        expect(r.status, `descarga ${i + 1}: ${r.texto.slice(0, 200)}`).toBe(200);
        expect(r.cuerpo.equals(PDF_FALSO)).toBe(true);
      }
      expect(generador.llamadas, 'una llamada al generador por descarga').toHaveLength(10);
      expect(generador.maximoEnCurso, 'nunca más de dos llamadas a la vez en toda la prueba').toBeLessThanOrEqual(2);
      expect(await conexionesInactivasEnTransaccion()).toEqual([]);
    });

    it('criterio 49 b: con la cola llena, un numero 0 (inválido) o un id que no es UUID responden el 404 de PQ6, no 429, sin tocar la cola; uno de forma válida que no existe responde 429 (no revela nada)', async () => {
      const diez = lanzarLasDiez();
      await conLimite(generador.esperarEnCurso(2), 'el generador del PDF nunca tuvo dos llamadas en curso');
      await pausa(500);

      // Las pide la sexta persona (la SECRETARIA de C, de una academia con cupo): el 429 es por la cola llena.
      const inexistente = await esperarHasta(ctxHttp(cSecretaria.cookie, rutaPdf(randomUUID(), 1)), 5000);
      const cero = await esperarHasta(ctxHttp(cSecretaria.cookie, rutaPdf(kC.id, 0)), 5000);
      const noEsUuid = await esperarHasta(ctxHttp(cSecretaria.cookie, rutaPdf('no-es-un-uuid', 1)), 5000);
      const numeroValidoQueNoExiste = lanzar(kC.id, 2, cSecretaria.cookie);
      const sinSesion = await esperarHasta(ctx.http.get(rutaPdf(kB.id, 1)), 5000);
      const sinPermiso = await esperarHasta(ctxHttp(cookies.entrenador, rutaPdf(kB.id, 1)), 5000);

      for (const [nombre, respuesta] of [
        ['numero 0', cero],
        ['id que no es UUID', noEsUuid],
      ] as const) {
        expect(respuesta, `${nombre}: no respondió enseguida`).toBeDefined();
        expect(respuesta?.status, `${nombre} con la cola llena: ${respuesta?.texto}`).toBe(404);
        expect(codigoDe(respuesta as RespuestaHistorial)).toBe('NO_ENCONTRADO');
        expect(respuesta?.headers.get('content-disposition')).toBeNull();
      }
      expect(sinSesion?.status, 'sin sesión con la cola llena: 401, no 429').toBe(401);
      expect(sinPermiso?.status, 'sin permiso con la cola llena: 403, no 429').toBe(403);
      expect(codigoDe(sinPermiso as RespuestaHistorial)).toBe('SIN_PERMISO');
      // Un id de forma válida que no existe (y un numero válido que no existe en una caja que sí) con la cola llena: 429, no 404.
      esperar429(inexistente, 'un id de forma válida que no existe, con la cola llena');
      esperar429(
        await respuestaEnseguida(numeroValidoQueNoExiste),
        'un numero válido que no existe, con la cola llena',
      );

      expect(generador.llamadas.length, 'ninguna de estas descargas llegó al generador').toBe(2);
      expect(await generador.soltarHastaQueTerminen(diez.map((d) => d.resultado))).toBe(true);
      expect(generador.llamadas).toHaveLength(10);
    });

    it.each(['rechaza', 'lanza'] as const)(
      'criterio 49 b: toda descarga libera su lugar: después de 12 descargas que terminan en 500 (generador que %s) y 12 que terminan en 404 (numero válido que no existe), una descarga válida responde 200',
      async (modo) => {
        generador.modo = modo;
        for (let i = 1; i <= 12; i += 1) {
          const falla = await ctx.http.get(rutaPdf(kA.id, 1), cookies.admin);
          expect(falla.status, `descarga ${i} con el generador que ${modo}: ${falla.texto.slice(0, 200)}`).toBe(500);
          expect(codigoDe(falla)).toBe('ERROR_INTERNO');
        }
        for (let i = 1; i <= 12; i += 1) {
          const noExiste = await ctx.http.get(rutaPdf(kA.id, 2), cookies.admin);
          expect(noExiste.status, `descarga ${i} de un numero que no existe: ${noExiste.texto.slice(0, 200)}`).toBe(
            404,
          );
          expect(codigoDe(noExiste)).toBe('NO_ENCONTRADO');
        }

        generador.modo = 'falso';
        const valida = await ctx.http.get(rutaPdf(kA.id, 1), cookies.admin);

        expect(valida.status, valida.texto.slice(0, 200)).toBe(200);
        expect(valida.cuerpo.equals(PDF_FALSO)).toBe(true);
        expect(generador.enCurso, 'ninguna llamada queda en curso').toBe(0);
      },
    );

    it('criterio 49 b: las descargas que terminan en 500 mientras otras esperan también liberan su lugar: con la cola llena de descargas que fallan, al terminar la cola queda vacía y una descarga nueva responde 200', async () => {
      generador.modo = 'retiene';
      const diez = lanzarLasDiez();
      await conLimite(generador.esperarEnCurso(2), 'el generador del PDF nunca tuvo dos llamadas en curso');
      await pausa(500);
      // Desde ahora el generador rechaza lo que llegue: las ocho que esperan terminan en 500 al tocarles el turno.
      generador.modo = 'rechaza';
      generador.soltarTodo();

      const terminaron = await generador.soltarHastaQueTerminen(diez.map((d) => d.resultado));
      const respuestas = await Promise.all(diez.map((d) => d.resultado));

      expect(terminaron).toBe(true);
      expect(respuestas.filter((r) => r.status === 200).length, 'las dos que ya estaban en curso responden 200').toBe(
        2,
      );
      expect(respuestas.filter((r) => r.status === 500).length, 'las ocho que esperaban responden 500').toBe(8);
      expect(generador.maximoEnCurso).toBeLessThanOrEqual(2);
      generador.modo = 'falso';
      const nueva = await ctx.http.get(rutaPdf(kA.id, 1), cookies.admin);
      expect(nueva.status, nueva.texto.slice(0, 200)).toBe(200);
    });
  });

  describe('c) como mucho dos por persona', () => {
    it('criterio 49 c: el ADMIN de A lanza dos descargas y la tercera responde 429 aunque la cola tenga lugar, sin llamar al generador; la SECRETARIA de A y el ADMIN de B siguen y responden 200; al terminar las dos del ADMIN, una nueva suya responde 200', async () => {
      const primera = lanzar(kA.id, 1, cookies.admin);
      const segunda = lanzar(kA.id, 1, cookies.admin);
      await conLimite(generador.esperarEnCurso(2), 'las dos descargas del ADMIN no llegaron al generador');

      const antes = await estado();
      const tercera = lanzar(kA.id, 1, cookies.admin);
      const respuestaTercera = await respuestaEnseguida(tercera);

      esperar429(respuestaTercera, 'la tercera descarga simultánea del ADMIN de A');
      expect(generador.llamadas.length, 'la tercera no llama al generador').toBe(2);
      expect(await estado(), 'la tercera no escribe ni audita').toEqual(antes);

      // A la vez, otras dos personas (otra del mismo A y una de B) descargan: hay lugar en la cola, así que esperan su turno.
      const secretaria = lanzar(kA.id, 1, cookies.secretaria);
      const adminB = lanzar(kB.id, 1, cookies.adminB);
      await pausa(300);
      expect(secretaria.terminada(), 'la SECRETARIA de A espera su turno, no recibe 429').toBe(false);
      expect(adminB.terminada(), 'el ADMIN de B espera su turno, no recibe 429').toBe(false);

      // Terminan las dos del ADMIN de A (la cola avanza y entran las otras dos); una nueva descarga suya espera su turno en lugar de recibir 429.
      generador.soltarTodo();
      const delAdmin = await conLimite(
        Promise.all([primera.resultado, segunda.resultado]),
        'las dos del ADMIN no terminaron',
      );
      expect(delAdmin.map((r) => r.status)).toEqual([200, 200]);
      const nueva = lanzar(kA.id, 1, cookies.admin);
      await pausa(300);
      expect(nueva.terminada(), 'la nueva descarga del ADMIN espera su turno: ya no tiene dos en curso').toBe(false);

      const terminaron = await generador.soltarHastaQueTerminen([
        secretaria.resultado,
        adminB.resultado,
        nueva.resultado,
      ]);
      expect(terminaron).toBe(true);
      for (const [nombre, descarga] of [
        ['la SECRETARIA de A', secretaria],
        ['el ADMIN de B', adminB],
        ['la nueva del ADMIN de A', nueva],
      ] as const) {
        const r = await descarga.resultado;
        expect(r.status, `${nombre}: ${r.texto.slice(0, 200)}`).toBe(200);
      }
      expect(generador.maximoEnCurso).toBeLessThanOrEqual(2);
    });

    it('criterio 49 c: la tercera descarga de una persona recibe 429 aunque las otras estén esperando, y las dos primeras siguen funcionando; es por persona y no por academia: otro ADMIN de la misma academia no se ve afectado', async () => {
      const a1 = lanzar(kA.id, 1, cookies.admin);
      const a2 = lanzar(kA.id, 1, cookies.admin);
      await conLimite(generador.esperarEnCurso(2), 'las dos descargas del ADMIN no llegaron al generador');
      const otroAdmin = lanzar(kA.id, 1, cookies.admin2);
      const otroAdmin2 = lanzar(kA.id, 1, cookies.admin2);
      await pausa(300);

      const tercera = await respuestaEnseguida(lanzar(kA.id, 1, cookies.admin));
      const terceraDelOtro = await respuestaEnseguida(lanzar(kA.id, 1, cookies.admin2));

      esperar429(tercera, 'la tercera del ADMIN');
      esperar429(terceraDelOtro, 'la tercera del otro ADMIN de A');
      expect(otroAdmin.terminada() || otroAdmin2.terminada(), 'las dos del otro ADMIN esperan su turno').toBe(false);
      expect(await generador.soltarHastaQueTerminen([a1, a2, otroAdmin, otroAdmin2].map((d) => d.resultado))).toBe(
        true,
      );
      for (const d of [a1, a2, otroAdmin, otroAdmin2]) expect((await d.resultado).status).toBe(200);
      expect(generador.llamadas, 'solo las cuatro descargas válidas llegaron al generador').toHaveLength(4);
    });
  });
});
