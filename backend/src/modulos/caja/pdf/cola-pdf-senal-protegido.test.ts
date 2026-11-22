// spec: 006-caja (pruebas protegidas)
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ColaPdfCierre, LIMITES_PDF_CIERRE } from './cola-pdf';

// Criterios 51 c y 52 (ronda adversarial 2 de la 006b; DT-10 y DT-11), pruebas unitarias protegidas de `ColaPdfCierre` con la firma pública de 51 c:
//
//   class ColaPdfCierre {
//     turno(solicitante: { usuarioId: string; academiaId: string }, senal?: AbortSignal): Promise<LiberarTurno>;
//     get estado(): { enCurso: number; enEspera: number };
//   }
//
// - `turno` rechaza con un error cuyo `name` es `'AbortError'` si la señal ya está activa al llamarla (sin contar nada) o si se activa mientras espera
//   (sale de la fila y descuenta persona y academia). Si la señal se activa después de otorgado el turno, no hace nada: el lugar es de quien llama y
//   lo libera con `LiberarTurno`. Si el turno se otorga y la señal se activa en la misma vuelta del bucle, gana lo que ocurrió primero, y nunca se
//   pierde ni se duplica un lugar ni un cupo.
// - `LIMITES_PDF_CIERRE = { simultaneos: 2, enEspera: 8, porPersona: 2, porAcademia: 4 }`; el orden de comprobación es persona, academia y cola.
// - Al terminar cada caso, `estado` es `{ enCurso: 0, enEspera: 0 }` y una ronda nueva admite otra vez 2 en curso, 8 en espera, 2 por persona y 4 por
//   academia, ni uno más ni uno menos.
//
// La firma se declara aparte para que el archivo compile con la cola de hoy (que todavía recibe solo el id de la persona) y falle por su comportamiento.

type LiberarTurno = () => void;

interface ColaConSenal {
  turno(solicitante: { usuarioId: string; academiaId: string }, senal?: AbortSignal): Promise<LiberarTurno>;
  readonly estado: { enCurso: number; enEspera: number };
}

const nuevaCola = () => new ColaPdfCierre() as unknown as ColaConSenal;

/** Deja correr las promesas ya resueltas para ver si un `turno` esperando ya recibió el suyo. */
const asentar = () => new Promise<void>((resolver) => setImmediate(resolver));

interface Pedido {
  usuarioId: string;
  academiaId: string;
  liberar?: LiberarTurno;
  error?: unknown;
  liberado: boolean;
  promesa: Promise<void>;
}

/** Pide un turno y anota si lo recibió (`liberar`) o con qué error terminó, sin esperar a que lo tenga. */
function pedir(cola: ColaConSenal, usuarioId: string, academiaId = 'academia-a', senal?: AbortSignal): Pedido {
  const pedido: Pedido = { usuarioId, academiaId, liberado: false, promesa: Promise.resolve() };
  pedido.promesa = cola.turno({ usuarioId, academiaId }, senal).then(
    (liberar) => {
      pedido.liberar = liberar;
    },
    (error: unknown) => {
      pedido.error = error;
    },
  );
  return pedido;
}

const tieneTurno = (pedido: Pedido) => pedido.liberar !== undefined;
const esperando = (pedido: Pedido) => pedido.liberar === undefined && pedido.error === undefined;
const es429 = (error: unknown) => error instanceof HttpException && error.getStatus() === 429;
const esAborto = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';

/** Libera el turno de un pedido que lo tiene (una sola vez). */
function liberar(pedido: Pedido) {
  if (pedido.liberar && !pedido.liberado) {
    pedido.liberado = true;
    pedido.liberar();
  }
}

/** Libera todo lo que tenga turno, una y otra vez, hasta que la cola quede vacía (los que esperaban van recibiendo el suyo). */
async function liberarTodo(cola: ColaConSenal, pedidos: readonly Pedido[]) {
  for (let vuelta = 0; vuelta < 30 && (cola.estado.enCurso > 0 || cola.estado.enEspera > 0); vuelta += 1) {
    for (const pedido of pedidos) liberar(pedido);
    await asentar();
  }
}

/**
 * Una ronda nueva admite otra vez los límites completos, ni uno más ni uno menos, y la cola termina vacía:
 * - por persona: 2 sí, la 3.ª, 429;
 * - por academia: 4 de 2 personas sí, la 5.ª de una tercera persona, 429;
 * - la cola: 10 de tres academias (2 en curso y 8 en espera) sí, la 11.ª de una persona y una academia con cupo, 429.
 */
async function afirmarRondaCompleta(cola: ColaConSenal) {
  expect(cola.estado, 'antes de la ronda nueva, la cola está vacía').toEqual({ enCurso: 0, enEspera: 0 });

  // Por persona.
  const dePersona = [pedir(cola, 'r-p1', 'r-a'), pedir(cola, 'r-p1', 'r-a'), pedir(cola, 'r-p1', 'r-a')];
  await asentar();
  expect(
    dePersona.map((p) => !p.error),
    'por persona: 2 sí',
  ).toEqual([true, true, false]);
  expect(es429(dePersona[2]?.error), 'por persona: la 3.ª, 429').toBe(true);
  await liberarTodo(cola, dePersona);
  expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });

  // Por academia.
  const deAcademia = [
    pedir(cola, 'r-p1', 'r-a'),
    pedir(cola, 'r-p1', 'r-a'),
    pedir(cola, 'r-p2', 'r-a'),
    pedir(cola, 'r-p2', 'r-a'),
    pedir(cola, 'r-p3', 'r-a'),
  ];
  await asentar();
  expect(
    deAcademia.map((p) => !p.error),
    'por academia: 4 sí',
  ).toEqual([true, true, true, true, false]);
  expect(es429(deAcademia[4]?.error), 'por academia: la 5.ª, 429').toBe(true);
  expect(cola.estado).toEqual({ enCurso: 2, enEspera: 2 });
  await liberarTodo(cola, deAcademia);
  expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });

  // La cola global.
  const diez = [
    pedir(cola, 'r-p1', 'r-a'),
    pedir(cola, 'r-p1', 'r-a'),
    pedir(cola, 'r-p2', 'r-a'),
    pedir(cola, 'r-p2', 'r-a'),
    pedir(cola, 'r-p3', 'r-b'),
    pedir(cola, 'r-p3', 'r-b'),
    pedir(cola, 'r-p4', 'r-b'),
    pedir(cola, 'r-p4', 'r-b'),
    pedir(cola, 'r-p5', 'r-c'),
    pedir(cola, 'r-p5', 'r-c'),
  ];
  const undecima = pedir(cola, 'r-p6', 'r-c');
  await asentar();
  expect(
    diez.every((p) => p.error === undefined),
    'la cola: 10 sí',
  ).toBe(true);
  expect(cola.estado, 'la cola: 2 en curso y 8 en espera').toEqual({ enCurso: 2, enEspera: 8 });
  expect(es429(undecima.error), 'la cola: la 11.ª, 429').toBe(true);
  await liberarTodo(cola, diez);
  expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });
}

describe('LIMITES_PDF_CIERRE (criterio 52 b)', () => {
  it('es { simultaneos: 2, enEspera: 8, porPersona: 2, porAcademia: 4 }', () => {
    expect(LIMITES_PDF_CIERRE).toEqual({ simultaneos: 2, enEspera: 8, porPersona: 2, porAcademia: 4 });
  });
});

describe('ColaPdfCierre.turno con señal (criterio 51 c)', () => {
  it('una señal ya activa rechaza con AbortError sin ocupar ni contar nada', async () => {
    const cola = nuevaCola();
    const senal = AbortSignal.abort();

    const pedido = pedir(cola, 'u1', 'academia-a', senal);
    await asentar();

    expect(
      esAborto(pedido.error),
      `debe rechazar con un error de nombre AbortError (fue ${String(pedido.error)})`,
    ).toBe(true);
    expect(pedido.liberar).toBeUndefined();
    expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });
    await afirmarRondaCompleta(cola);
  });

  it('una señal ya activa no cuenta aunque la cola esté llena: sigue siendo un AbortError, no un 429', async () => {
    const cola = nuevaCola();
    const diez = Array.from({ length: 10 }, (_, i) =>
      pedir(cola, `u${Math.floor(i / 2)}`, `academia-${Math.floor(i / 4)}`),
    );
    await asentar();
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 8 });

    const pedido = pedir(cola, 'otro', 'academia-z', AbortSignal.abort());
    await asentar();

    expect(esAborto(pedido.error)).toBe(true);
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 8 });
    await liberarTodo(cola, diez);
    await afirmarRondaCompleta(cola);
  });

  it('una señal que se activa en la fila saca al pedido, rechaza con AbortError y deja pasar a la siguiente en orden de llegada', async () => {
    const cola = nuevaCola();
    const controlador = new AbortController();
    const enCurso = [pedir(cola, 'u1'), pedir(cola, 'u2')];
    const w1 = pedir(cola, 'u3', 'academia-a', controlador.signal);
    const w2 = pedir(cola, 'u4');
    const w3 = pedir(cola, 'u5');
    await asentar();
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 3 });

    controlador.abort();
    await asentar();

    expect(esAborto(w1.error), 'el pedido de la señal activada rechaza con AbortError').toBe(true);
    expect(cola.estado, 'sale de la fila').toEqual({ enCurso: 2, enEspera: 2 });
    // Al liberar un lugar, pasa la siguiente (w2), no la que se retiró, y después w3: en orden de llegada.
    liberar(enCurso[0] as Pedido);
    await asentar();
    expect([tieneTurno(w2), esperando(w3)], 'pasa w2 y w3 sigue esperando').toEqual([true, true]);
    liberar(enCurso[1] as Pedido);
    await asentar();
    expect(tieneTurno(w3)).toBe(true);
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 0 });

    await liberarTodo(cola, [...enCurso, w1, w2, w3]);
    expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });
    await afirmarRondaCompleta(cola);
  });

  it('una señal que se activa en la fila descuenta el cupo de la persona: ella vuelve a poder pedir dos', async () => {
    const cola = nuevaCola();
    const controlador = new AbortController();
    const enCurso = [pedir(cola, 'u1', 'academia-1'), pedir(cola, 'u2', 'academia-2')];
    const w1 = pedir(cola, 'u3', 'academia-3', controlador.signal);
    const w1b = pedir(cola, 'u3', 'academia-3');
    await asentar();
    const tercera = pedir(cola, 'u3', 'academia-3');
    await asentar();
    expect(es429(tercera.error), 'con dos en la fila, la tercera de la persona recibe 429').toBe(true);

    controlador.abort();
    await asentar();
    const nueva = pedir(cola, 'u3', 'academia-3');
    await asentar();

    expect(esAborto(w1.error)).toBe(true);
    expect(nueva.error, 'la persona recupera el cupo del pedido que salió de la fila').toBeUndefined();
    expect(esperando(nueva)).toBe(true);
    const otraMas = pedir(cola, 'u3', 'academia-3');
    await asentar();
    expect(es429(otraMas.error), 'y sigue con el máximo de dos').toBe(true);

    await liberarTodo(cola, [...enCurso, w1, w1b, nueva]);
    await afirmarRondaCompleta(cola);
  });

  it('una señal que se activa en la fila descuenta el cupo de la academia: otra persona de la academia puede pedir en su lugar y una más recibe 429', async () => {
    const cola = nuevaCola();
    const controlador = new AbortController();
    const delaAcademia = [
      pedir(cola, 'u1'),
      pedir(cola, 'u2'),
      pedir(cola, 'u3', 'academia-a', controlador.signal),
      pedir(cola, 'u4'),
    ];
    await asentar();
    const quinta = pedir(cola, 'u5');
    await asentar();
    expect(es429(quinta.error), 'con 4 de la academia, la quinta recibe 429').toBe(true);

    controlador.abort();
    await asentar();
    const enSuLugar = pedir(cola, 'u5');
    await asentar();
    const otraMas = pedir(cola, 'u6');
    await asentar();

    expect(esAborto(delaAcademia[2]?.error)).toBe(true);
    expect(enSuLugar.error, 'la academia recupera el cupo del pedido que salió de la fila').toBeUndefined();
    expect(es429(otraMas.error), 'pero no más de 4').toBe(true);

    await liberarTodo(cola, [...delaAcademia, enSuLugar]);
    await afirmarRondaCompleta(cola);
  });

  it('una señal que se activa después del turno no cambia nada hasta que se llama a LiberarTurno', async () => {
    const cola = nuevaCola();
    const controlador = new AbortController();
    const pedido = pedir(cola, 'u1', 'academia-a', controlador.signal);
    const otro = pedir(cola, 'u2');
    const enEspera = pedir(cola, 'u3');
    await asentar();
    expect(tieneTurno(pedido)).toBe(true);
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 1 });

    controlador.abort();
    await asentar();

    expect(pedido.error, 'la promesa ya estaba resuelta: no se rechaza').toBeUndefined();
    expect(cola.estado, 'el lugar sigue siendo de quien llama').toEqual({ enCurso: 2, enEspera: 1 });
    expect(esperando(enEspera)).toBe(true);

    liberar(pedido);
    await asentar();
    expect(tieneTurno(enEspera), 'al liberar, pasa la siguiente').toBe(true);
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 0 });
    await liberarTodo(cola, [pedido, otro, enEspera]);
    expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });
    await afirmarRondaCompleta(cola);
  });

  describe('la carrera entre otorgar el turno y activar la señal en la misma vuelta del bucle', () => {
    it('si el turno se otorga primero (se libera un lugar y enseguida se activa la señal), gana el turno: el lugar es de quien llama y se libera con LiberarTurno', async () => {
      const cola = nuevaCola();
      const controlador = new AbortController();
      const enCurso = [pedir(cola, 'u1'), pedir(cola, 'u2')];
      const espera = pedir(cola, 'u3', 'academia-a', controlador.signal);
      await asentar();
      expect(esperando(espera)).toBe(true);

      // Sin ceder el bucle: primero se otorga el turno y después se activa la señal.
      liberar(enCurso[0] as Pedido);
      controlador.abort();
      await asentar();

      expect(espera.error, 'ganó el turno: no se rechaza').toBeUndefined();
      expect(tieneTurno(espera)).toBe(true);
      expect(cola.estado, 'ni se pierde ni se duplica un lugar').toEqual({ enCurso: 2, enEspera: 0 });

      liberar(espera);
      liberar(enCurso[1] as Pedido);
      await asentar();
      expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });
      await afirmarRondaCompleta(cola);
    });

    it('si la señal se activa primero (se activa y enseguida se libera un lugar), gana el aborto: rechaza con AbortError y el lugar pasa a la siguiente o queda libre', async () => {
      const cola = nuevaCola();
      const controlador = new AbortController();
      const enCurso = [pedir(cola, 'u1'), pedir(cola, 'u2')];
      const espera = pedir(cola, 'u3', 'academia-a', controlador.signal);
      const siguiente = pedir(cola, 'u4');
      await asentar();

      // Sin ceder el bucle: primero se activa la señal y después se libera el lugar.
      controlador.abort();
      liberar(enCurso[0] as Pedido);
      await asentar();

      expect(esAborto(espera.error), 'ganó el aborto').toBe(true);
      expect(espera.liberar).toBeUndefined();
      expect(tieneTurno(siguiente), 'el lugar liberado pasa a la siguiente, no a la abortada').toBe(true);
      expect(cola.estado, 'ni se pierde ni se duplica un lugar').toEqual({ enCurso: 2, enEspera: 0 });

      liberar(siguiente);
      liberar(enCurso[1] as Pedido);
      await asentar();
      expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });
      await afirmarRondaCompleta(cola);
    });

    it('si la señal se activa primero y no hay nadie más en la fila, el lugar liberado queda libre (no se pierde)', async () => {
      const cola = nuevaCola();
      const controlador = new AbortController();
      const enCurso = [pedir(cola, 'u1'), pedir(cola, 'u2')];
      const espera = pedir(cola, 'u3', 'academia-a', controlador.signal);
      await asentar();

      controlador.abort();
      liberar(enCurso[0] as Pedido);
      await asentar();

      expect(esAborto(espera.error)).toBe(true);
      expect(cola.estado).toEqual({ enCurso: 1, enEspera: 0 });
      liberar(enCurso[1] as Pedido);
      await asentar();
      expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });
      await afirmarRondaCompleta(cola);
    });
  });
});

describe('ColaPdfCierre: límite por academia y orden de comprobación (criterio 52)', () => {
  it('una academia tiene como mucho 4 en curso o esperando, aunque la cola tenga lugar: la quinta, de otra persona, recibe 429 sin tocar la cola', async () => {
    const cola = nuevaCola();
    const cuatro = [pedir(cola, 'u1'), pedir(cola, 'u1'), pedir(cola, 'u2'), pedir(cola, 'u2')];
    await asentar();
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 2 });

    const quinta = pedir(cola, 'u3');
    await asentar();

    expect(es429(quinta.error), `la quinta de la academia debe recibir 429 (fue ${String(quinta.error)})`).toBe(true);
    expect(cola.estado, 'una descarga rechazada no suma').toEqual({ enCurso: 2, enEspera: 2 });
    await liberarTodo(cola, cuatro);
    await afirmarRondaCompleta(cola);
  });

  it('el límite es por la academia de quien pide, no por la persona: dos academias de cuatro cada una caben en la cola, y una persona de otra academia sigue entrando', async () => {
    const cola = nuevaCola();
    const deA = [pedir(cola, 'a1', 'A'), pedir(cola, 'a1', 'A'), pedir(cola, 'a2', 'A'), pedir(cola, 'a2', 'A')];
    const deB = [pedir(cola, 'b1', 'B'), pedir(cola, 'b1', 'B'), pedir(cola, 'b2', 'B'), pedir(cola, 'b2', 'B')];
    const deC = pedir(cola, 'c1', 'C');
    await asentar();

    expect(
      [...deA, ...deB, deC].every((p) => p.error === undefined),
      'las nueve entran',
    ).toBe(true);
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 7 });
    const quintaDeA = pedir(cola, 'a3', 'A');
    await asentar();
    expect(es429(quintaDeA.error)).toBe(true);
    const otraDeC = pedir(cola, 'c2', 'C');
    await asentar();
    expect(otraDeC.error, 'la academia C todavía tiene cupo y la cola tiene un lugar').toBeUndefined();

    await liberarTodo(cola, [...deA, ...deB, deC, otraDeC]);
    await afirmarRondaCompleta(cola);
  });

  it('los rechazos no suman en ningún contador: tres rechazos seguidos y, al liberarse dos lugares, la persona rechazada pide dos y entran', async () => {
    const cola = nuevaCola();
    const cuatro = [pedir(cola, 'u1'), pedir(cola, 'u1'), pedir(cola, 'u2'), pedir(cola, 'u2')];
    await asentar();
    for (let vez = 0; vez < 3; vez += 1) {
      const rechazada = pedir(cola, 'u3');
      await asentar();
      expect(es429(rechazada.error), `rechazo ${vez + 1}`).toBe(true);
    }

    liberar(cuatro[0] as Pedido);
    liberar(cuatro[1] as Pedido);
    await asentar();
    const dos = [pedir(cola, 'u3'), pedir(cola, 'u3')];
    await asentar();

    expect(
      dos.map((p) => p.error),
      'ya no cuentan los rechazos: las dos entran',
    ).toEqual([undefined, undefined]);
    await liberarTodo(cola, [...cuatro, ...dos]);
    await afirmarRondaCompleta(cola);
  });

  it('el orden es persona, academia y cola: las tres respuestas son un 429 de la misma forma (no dicen qué límite se alcanzó)', async () => {
    const cola = nuevaCola();
    // Persona: u1 ya tiene 2.
    const primeras = [pedir(cola, 'u1', 'A'), pedir(cola, 'u1', 'A')];
    const porPersona = pedir(cola, 'u1', 'B');
    await asentar();
    // Academia: A llega a 4 con otra persona y la quinta, de una tercera, es rechazada aunque la cola tenga lugar.
    const masDeA = [pedir(cola, 'u2', 'A'), pedir(cola, 'u2', 'A')];
    const porAcademia = pedir(cola, 'u3', 'A');
    await asentar();
    // Cola: B, C y D llenan lo que queda (4 de B, 2 de C) y una persona y una academia con cupo es rechazada.
    const resto = [
      pedir(cola, 'b1', 'B'),
      pedir(cola, 'b1', 'B'),
      pedir(cola, 'b2', 'B'),
      pedir(cola, 'b2', 'B'),
      pedir(cola, 'c1', 'C'),
      pedir(cola, 'c1', 'C'),
    ];
    const porCola = pedir(cola, 'd1', 'D');
    await asentar();
    await asentar();

    for (const [nombre, rechazo] of [
      ['persona', porPersona.error],
      ['academia', porAcademia.error],
      ['cola', porCola.error],
    ] as const) {
      expect(es429(rechazo), `el rechazo por ${nombre} es un 429`).toBe(true);
    }
    const mensajes = [porPersona.error, porAcademia.error, porCola.error].map((error) =>
      JSON.stringify((error as HttpException).getResponse()),
    );
    expect(new Set(mensajes).size, 'las tres respuestas son iguales').toBe(1);

    await liberarTodo(cola, [...primeras, ...masDeA, ...resto]);
    await afirmarRondaCompleta(cola);
  });

  it('una persona de una academia con cupo no entra a una cola llena: el 429 por la cola llena sigue funcionando', async () => {
    const cola = nuevaCola();
    const diez = [
      pedir(cola, 'a1', 'A'),
      pedir(cola, 'a1', 'A'),
      pedir(cola, 'a2', 'A'),
      pedir(cola, 'a2', 'A'),
      pedir(cola, 'b1', 'B'),
      pedir(cola, 'b1', 'B'),
      pedir(cola, 'b2', 'B'),
      pedir(cola, 'b2', 'B'),
      pedir(cola, 'c1', 'C'),
      pedir(cola, 'c1', 'C'),
    ];
    await asentar();
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 8 });

    const deD = pedir(cola, 'd1', 'D');
    const otraDeC = pedir(cola, 'c2', 'C');
    await asentar();

    expect(es429(deD.error)).toBe(true);
    expect(es429(otraDeC.error)).toBe(true);
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 8 });
    await liberarTodo(cola, diez);
    await afirmarRondaCompleta(cola);
  });
});
