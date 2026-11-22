// spec: 006-caja (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codigoDe, cookiesDeCaja, crearEscenarioDeCaja, type EscenarioCaja } from '../../utilidades/caja';
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
  crearPersonaConCookie,
  fotoDeEscrituras,
  type PersonaConCookie,
} from '../../utilidades/caja-pdf-academias';
import { esperarHasta, pausa } from '../../utilidades/caja-pdf-concurrencia';
import { comoGeneradorDePrueba, GeneradorConSenal } from '../../utilidades/caja-pdf-senal';
import { conLimite, observar } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 52 (crítico, ronda adversarial 2 de la 006b; amplía los criterios 49 b y c; DT-11; D-23): una academia no ocupa toda la cola.
//   a) Cada academia tiene como mucho 4 descargas de PDF en curso o esperando turno, contando a todas sus personas. La academia es la de la sesión.
//      Es por proceso, como los demás límites del 49.
//   b) `LIMITES_PDF_CIERRE = { simultaneos: 2, enEspera: 8, porPersona: 2, porAcademia: 4 }` (lo comprueba la prueba unitaria de la cola).
//   c) Orden de comprobación en el paso de la cola del 49 b: 1. persona (2); 2. academia (4); 3. lugar en la cola global (2 en curso y 8 en espera).
//      La primera que no se cumple responde el 429 de 49 b (mismo cuerpo y mensaje, JSON, `no-store`, sin `Content-Disposition`), no llama al generador,
//      no escribe y no audita. Una descarga rechazada no suma en ningún contador. Los tres 429 son iguales: no dicen qué límite se alcanzó.
//   e) Pruebas, con el generador retenido: cinco cuentas de A; los rechazos no suman; el cupo vuelve; tres academias.

const MENSAJE_DE_429 = 'Hiciste demasiadas solicitudes. Espera un momento e intenta de nuevo.';
/** Lo que se espera una respuesta que debe llegar enseguida (un 429): si es más, la descarga quedó esperando turno. */
const RESPUESTA_ENSEGUIDA_MS = 3000;
/** Lo que se espera a que una descarga que debe quedar esperando su turno no haya respondido. */
const ESPERA_DE_UN_TURNO_MS = 500;

describe('una academia no ocupa toda la cola de PDF (criterio 52)', () => {
  const generador = new GeneradorConSenal();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let kA: { id: string };
  let kB: { id: string };
  /** Las personas de más que pide la spec: la tercera SECRETARIA de A y la tercera persona de B. */
  let secretariaA3: PersonaConCookie;
  let secretariaB2: PersonaConCookie;
  /** Las academias C y D, cada una con un ADMIN y una SECRETARIA y su caja de hoy cerrada. */
  let cAdmin: PersonaConCookie;
  let cSecretaria: PersonaConCookie;
  let kC: { id: string };
  let dAdmin: PersonaConCookie;
  let kD: { id: string };
  let academiaIds: string[];
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
    secretariaA3 = await crearPersonaConCookie(e.A.id, 'SECRETARIA', 'Tercera', 'Secretaria de A');
    secretariaB2 = await crearPersonaConCookie(e.B.id, 'SECRETARIA', 'Tercera', 'Persona de B');
    const c = await crearAcademiaConPersonas('academia-c', 'Academia C', ['ADMIN', 'SECRETARIA']);
    [cAdmin, cSecretaria] = c.personas as [PersonaConCookie, PersonaConCookie];
    kC = await crearCajaDeHoyCerrada(c.academia.id, cSecretaria.usuario.id, cAdmin.usuario.id);
    const d = await crearAcademiaConPersonas('academia-d', 'Academia D', ['ADMIN', 'SECRETARIA']);
    dAdmin = d.personas[0] as PersonaConCookie;
    kD = await crearCajaDeHoyCerrada(d.academia.id, (d.personas[1] as PersonaConCookie).usuario.id, dAdmin.usuario.id);
    academiaIds = [e.A.id, e.B.id, c.academia.id, d.academia.id];
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
  const lanzar = (cajaId: string, cookie: string) => {
    const descarga = observar(ctx.http.get(rutaPdf(cajaId, 1), cookie));
    lanzadas.push(descarga.resultado);
    return descarga;
  };
  /** Lanza `n` descargas de la misma persona. */
  const lanzarVarias = (n: number, cajaId: string, cookie: string) =>
    Array.from({ length: n }, () => lanzar(cajaId, cookie));

  /** Comprueba el 429 de la spec: JSON de siempre, con el mensaje del filtro de errores, `no-store` y sin `Content-Disposition`. */
  function exigir429(respuesta: RespuestaHistorial | undefined, contexto: string): RespuestaHistorial {
    expect(
      respuesta,
      `${contexto}: no respondió enseguida (el generador recibió ${generador.llamadas.length} llamadas): quedó esperando turno en lugar de recibir 429`,
    ).toBeDefined();
    const r = respuesta as RespuestaHistorial;
    expect(r.status, `${contexto}: ${r.texto.slice(0, 200)}`).toBe(429);
    expect(codigoDe(r)).toBe('DEMASIADAS_SOLICITUDES');
    expect(r.body?.['mensaje']).toBe(MENSAJE_DE_429);
    expect(r.headers.get('content-type') ?? '').toContain('application/json');
    expect(r.cacheControl).toBe('no-store');
    expect(r.headers.get('content-disposition')).toBeNull();
    return r;
  }
  /** Lanza una descarga que debe responder 429 enseguida (sin llamar al generador). */
  async function rechazada(cajaId: string, cookie: string, contexto: string): Promise<RespuestaHistorial> {
    const llamadasAntes = generador.llamadas.length;
    const respuesta = await esperarHasta(lanzar(cajaId, cookie).resultado, RESPUESTA_ENSEGUIDA_MS);
    const r = exigir429(respuesta, contexto);
    expect(generador.llamadas.length, `${contexto}: no llama al generador`).toBe(llamadasAntes);
    return r;
  }
  /** Comprueba que las descargas esperan su turno (no respondieron: ni 429 ni nada). */
  async function esperan(descargas: readonly { resultado: Promise<RespuestaHistorial> }[], contexto: string) {
    const respuestas = await Promise.all(descargas.map((d) => esperarHasta(d.resultado, ESPERA_DE_UN_TURNO_MS)));
    for (const [i, respuesta] of respuestas.entries()) {
      expect(
        respuesta === undefined,
        `${contexto} (descarga ${i + 1}): debía esperar su turno y respondió ${respuesta?.status} ${respuesta ? codigoDe(respuesta) : ''}`,
      ).toBe(true);
    }
  }
  /** Suelta el generador hasta que todas terminen y comprueba que respondieron 200. */
  async function terminanConUn200(descargas: readonly { resultado: Promise<RespuestaHistorial> }[], contexto: string) {
    const terminaron = await generador.soltarHastaQueTerminen(descargas.map((d) => d.resultado));
    expect(terminaron, `${contexto}: terminan al soltar el generador`).toBe(true);
    for (const [i, descarga] of descargas.entries()) {
      const r = await descarga.resultado;
      expect(r.status, `${contexto} (descarga ${i + 1}): ${r.texto.slice(0, 200)}`).toBe(200);
      expect(r.cuerpo.equals(PDF_FALSO)).toBe(true);
    }
  }

  it('criterio 52 e: cinco cuentas de A (dos ADMIN y tres SECRETARIA) lanzan una descarga cada una: las cuatro primeras se aceptan (dos en curso y dos esperando) y la quinta responde 429 enseguida; B lanza cuatro y una tercera persona de B recibe 429; al soltar, las cuatro de A y las cuatro de B responden 200 con 8 llamadas', async () => {
    const antes = await fotoDeEscrituras(academiaIds);
    const cuatroDeA = [
      lanzar(kA.id, cookies.admin),
      lanzar(kA.id, cookies.admin2),
      lanzar(kA.id, cookies.secretaria),
      lanzar(kA.id, cookies.secretaria2),
    ];
    await conLimite(generador.esperarEnCurso(2), 'las dos primeras descargas de A no llegaron al generador');
    await pausa(300);
    await esperan(cuatroDeA.slice(2), 'la 3.ª y la 4.ª de A');

    // La quinta cuenta de A responde 429 enseguida y no llama al generador, aunque la cola global tiene lugar (2 en curso y 2 esperando).
    await rechazada(kA.id, secretariaA3.cookie, 'la quinta descarga de A (de la quinta cuenta)');
    expect(generador.llamadas, 'solo hay dos llamadas en el generador').toHaveLength(2);

    // A la vez, el ADMIN y la SECRETARIA de B lanzan dos descargas cada uno: las cuatro esperan su turno, no 429.
    const cuatroDeB = [...lanzarVarias(2, kB.id, cookies.adminB), ...lanzarVarias(2, kB.id, cookies.secretariaB)];
    await pausa(300);
    await esperan(cuatroDeB, 'las cuatro de B');

    // Una quinta descarga de B, de una tercera persona de B, responde 429.
    await rechazada(kB.id, secretariaB2.cookie, 'la quinta descarga de B (de una tercera persona)');
    expect(generador.llamadas, 'la cola avanza solo cuando se suelta el generador').toHaveLength(2);

    // Al soltar el generador, las cuatro de A y las cuatro de B responden 200 y el generador recibió 8 llamadas.
    await terminanConUn200([...cuatroDeA, ...cuatroDeB], 'las ocho descargas aceptadas');
    expect(generador.llamadas, 'una llamada por cada descarga aceptada: ninguna de las dos rechazadas').toHaveLength(8);
    expect(generador.maximoEnCurso).toBeLessThanOrEqual(2);
    expect(await fotoDeEscrituras(academiaIds), 'los rechazos no escriben ni auditan').toEqual(antes);
    expect(await conexionesInactivasEnTransaccion()).toEqual([]);
  });

  it('criterio 52 e: los rechazos no suman: la quinta persona de A recibe 429 tres veces seguidas; cuando terminan dos descargas de A, ella lanza dos y las dos esperan su turno (no 429) y responden 200', async () => {
    const cuatroDeA = [...lanzarVarias(2, kA.id, cookies.admin), ...lanzarVarias(2, kA.id, cookies.admin2)];
    await conLimite(generador.esperarEnCurso(2), 'las dos primeras descargas de A no llegaron al generador');
    await pausa(300);

    for (const vez of [1, 2, 3])
      await rechazada(kA.id, secretariaA3.cookie, `el rechazo ${vez} de la quinta persona de A`);

    // Terminan las dos descargas que estaban en curso (la cola avanza y entran las otras dos): A queda con dos.
    expect(generador.soltarTodo(), 'se sueltan las dos descargas en curso').toBe(2);
    await conLimite(generador.esperarLlamadas(4), 'las otras dos descargas de A no entraron al generador');
    // Ahora ella lanza dos: A vuelve a tener cuatro (dos en curso y dos esperando). Si los rechazos hubieran sumado, estas recibirían 429.
    const dosDeElla = lanzarVarias(2, kA.id, secretariaA3.cookie);
    await pausa(300);
    await esperan(dosDeElla, 'las dos descargas de la quinta persona de A');

    await terminanConUn200([...cuatroDeA, ...dosDeElla], 'las seis descargas aceptadas');
    expect(generador.llamadas).toHaveLength(6);
    expect(await conexionesInactivasEnTransaccion()).toEqual([]);
  });

  it('criterio 52 e: el cupo vuelve: cuando terminan las cuatro de A, cuatro descargas nuevas de A se aceptan (y una quinta responde 429)', async () => {
    const primeras = [...lanzarVarias(2, kA.id, cookies.admin), ...lanzarVarias(2, kA.id, cookies.admin2)];
    await terminanConUn200(primeras, 'las cuatro primeras de A');
    expect(generador.llamadas).toHaveLength(4);
    generador.restablecer();

    // Cuatro descargas nuevas de A, de otras personas: se aceptan (esperan su turno, no 429).
    const nuevas = [...lanzarVarias(2, kA.id, cookies.secretaria), ...lanzarVarias(2, kA.id, cookies.secretaria2)];
    await conLimite(generador.esperarEnCurso(2), 'las dos primeras descargas nuevas de A no llegaron al generador');
    await pausa(300);
    await esperan(nuevas.slice(2), 'la 3.ª y la 4.ª descarga nuevas de A');
    // Ni una más: la quinta de A (de una persona sin descargas) responde 429.
    await rechazada(kA.id, secretariaA3.cookie, 'la quinta descarga nueva de A');

    await terminanConUn200(nuevas, 'las cuatro descargas nuevas de A');
    expect(generador.llamadas).toHaveLength(4);
  });

  it('criterio 52 e: tres academias: con A y B en 4 cada una, una academia C lanza dos descargas que esperan; con eso la cola está llena y una descarga de una cuarta academia D y una de otra persona de C responden 429 por la cola llena; los tres 429 son iguales', async () => {
    const antes = await fotoDeEscrituras(academiaIds);
    const deA = [...lanzarVarias(2, kA.id, cookies.admin), ...lanzarVarias(2, kA.id, cookies.secretaria)];
    await conLimite(generador.esperarEnCurso(2), 'las dos primeras descargas de A no llegaron al generador');
    const deB = [...lanzarVarias(2, kB.id, cookies.adminB), ...lanzarVarias(2, kB.id, cookies.secretariaB)];
    await pausa(300);
    await esperan([...deA.slice(2), ...deB], 'las que esperan de A y de B');

    // C lanza dos descargas: esperan (no 429). Con eso la cola está llena: 2 en curso y 8 en espera.
    const deC = lanzarVarias(2, kC.id, cAdmin.cookie);
    await pausa(300);
    await esperan(deC, 'las dos descargas de C');

    // Una descarga de una cuarta academia D, y una de otra persona de C, responden 429 por la cola llena.
    const porColaLlenaD = await rechazada(
      kD.id,
      dAdmin.cookie,
      'la descarga de la cuarta academia D, con la cola llena',
    );
    const porColaLlenaC = await rechazada(
      kC.id,
      cSecretaria.cookie,
      'la descarga de otra persona de C, con la cola llena',
    );
    // Y la tercera de la misma persona de C responde el 429 por persona: los tres 429 son iguales, no dicen qué límite se alcanzó.
    const porPersona = await rechazada(kC.id, cAdmin.cookie, 'la tercera descarga de la misma persona de C');
    expect(JSON.stringify(porColaLlenaD.body), 'el 429 por la cola llena de D es igual al de C').toBe(
      JSON.stringify(porColaLlenaC.body),
    );
    expect(JSON.stringify(porPersona.body), 'el 429 por persona es igual al de la cola llena').toBe(
      JSON.stringify(porColaLlenaD.body),
    );

    await terminanConUn200([...deA, ...deB, ...deC], 'las diez descargas aceptadas');
    expect(generador.llamadas, 'una llamada por cada descarga aceptada').toHaveLength(10);
    expect(generador.maximoEnCurso).toBeLessThanOrEqual(2);
    expect(await fotoDeEscrituras(academiaIds), 'los rechazos no escriben ni auditan').toEqual(antes);
    expect(await conexionesInactivasEnTransaccion()).toEqual([]);
  });
});
