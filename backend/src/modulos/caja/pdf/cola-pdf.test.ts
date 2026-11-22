import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ColaPdfCierre, LIMITE_PDF_POR_PERSONA, LIMITES_PDF_CIERRE } from './cola-pdf';

// Spec 006b, criterio 49 b y c (prueba no protegida): la cola de generación del PDF, sola y sin base de datos. Las pruebas protegidas de integración
// (`pdf-concurrencia.test.ts`) la prueban de punta a punta con la API; aquí se fijan sus reglas internas: orden de llegada, límites y liberación.

/** Deja correr las promesas ya resueltas para ver si un `turno` esperando ya recibió el suyo. */
const asentar = () => new Promise<void>((resolver) => setImmediate(resolver));

/** Pide un turno y dice si ya lo tiene, sin esperar a que lo tenga. */
function pedir(cola: ColaPdfCierre, usuarioId: string) {
  const resultado: { liberar?: () => void; error?: unknown } = {};
  const promesa = cola.turno(usuarioId).then(
    (liberar) => {
      resultado.liberar = liberar;
    },
    (error: unknown) => {
      resultado.error = error;
    },
  );
  return { resultado, promesa };
}

const usuario = (n: number) => `usuario-${n}`;

describe('ColaPdfCierre (criterio 49 b y c)', () => {
  it('los límites son 2 a la vez y 8 en espera, y 2 por persona', () => {
    expect(LIMITES_PDF_CIERRE).toEqual({ simultaneos: 2, enEspera: 8 });
    expect(LIMITE_PDF_POR_PERSONA).toBe(2);
  });

  it('da el turno enseguida mientras haya menos de 2 en curso y los demás esperan en orden de llegada', async () => {
    const cola = new ColaPdfCierre();
    const pedidos = Array.from({ length: 5 }, (_, i) => pedir(cola, usuario(i)));
    await asentar();

    expect(pedidos.map((p) => p.resultado.liberar !== undefined)).toEqual([true, true, false, false, false]);
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 3 });

    pedidos[0]?.resultado.liberar?.();
    await asentar();
    expect(pedidos.map((p) => p.resultado.liberar !== undefined)).toEqual([true, true, true, false, false]);
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 2 });

    pedidos[1]?.resultado.liberar?.();
    pedidos[2]?.resultado.liberar?.();
    await asentar();
    expect(pedidos.map((p) => p.resultado.liberar !== undefined)).toEqual([true, true, true, true, true]);
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 0 });
  });

  it('responde 429 cuando hay 2 en curso y 8 esperando, sin tocar la cola, y vuelve a dar turno al liberar', async () => {
    const cola = new ColaPdfCierre();
    const pedidos = Array.from({ length: 10 }, (_, i) => pedir(cola, usuario(Math.floor(i / 2))));
    await asentar();
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 8 });

    const sexta = pedir(cola, usuario(5));
    await sexta.promesa;

    expect(sexta.resultado.error).toBeInstanceOf(HttpException);
    expect((sexta.resultado.error as HttpException).getStatus()).toBe(429);
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 8 });

    // Al liberar uno, el primero de la fila toma el turno y queda un lugar en la espera.
    pedidos[0]?.resultado.liberar?.();
    await asentar();
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 7 });
    const hueco = pedir(cola, usuario(6));
    await asentar();
    expect(hueco.resultado.error).toBeUndefined();
    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 8 });
  });

  it('una persona tiene como mucho 2 en curso o esperando, aunque la cola tenga lugar, y se le devuelve al liberar', async () => {
    const cola = new ColaPdfCierre();
    const primera = pedir(cola, usuario(1));
    const segunda = pedir(cola, usuario(1));
    const tercera = pedir(cola, usuario(1));
    const deOtra = pedir(cola, usuario(2));
    await asentar();

    expect(primera.resultado.liberar).toBeTypeOf('function');
    expect(segunda.resultado.liberar).toBeTypeOf('function');
    expect((tercera.resultado.error as HttpException).getStatus()).toBe(429);
    // La de otra persona espera su turno (hay 2 en curso), pero no se rechaza.
    expect(deOtra.resultado.error).toBeUndefined();
    expect(deOtra.resultado.liberar).toBeUndefined();

    primera.resultado.liberar?.();
    segunda.resultado.liberar?.();
    await asentar();
    const nueva = pedir(cola, usuario(1));
    await asentar();
    expect(nueva.resultado.error).toBeUndefined();
    expect(nueva.resultado.liberar).toBeTypeOf('function');
  });

  it('cuenta también a quien espera: dos en espera de la misma persona le cierran la tercera', async () => {
    const cola = new ColaPdfCierre();
    pedir(cola, usuario(1));
    pedir(cola, usuario(2));
    pedir(cola, usuario(3));
    pedir(cola, usuario(3));
    const tercera = pedir(cola, usuario(3));
    await asentar();

    expect(cola.estado).toEqual({ enCurso: 2, enEspera: 2 });
    expect((tercera.resultado.error as HttpException).getStatus()).toBe(429);
  });

  it('liberar dos veces cuenta una sola', async () => {
    const cola = new ColaPdfCierre();
    const primera = pedir(cola, usuario(1));
    const segunda = pedir(cola, usuario(2));
    await asentar();

    primera.resultado.liberar?.();
    primera.resultado.liberar?.();
    primera.resultado.liberar?.();

    expect(cola.estado).toEqual({ enCurso: 1, enEspera: 0 });
    segunda.resultado.liberar?.();
    expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });
  });

  it('el 429 por persona o por cola llena no deja contadores: después de liberar todo, la cola queda vacía', async () => {
    const cola = new ColaPdfCierre();
    const pedidos = Array.from({ length: 10 }, (_, i) => pedir(cola, usuario(i)));
    await asentar();
    pedir(cola, usuario(0));
    await asentar();

    for (let ronda = 0; ronda < 12 && cola.estado.enCurso > 0; ronda += 1) {
      for (const pedido of pedidos) pedido.resultado.liberar?.();
      await asentar();
    }

    expect(cola.estado).toEqual({ enCurso: 0, enEspera: 0 });
    const nueva = pedir(cola, usuario(0));
    await asentar();
    expect(nueva.resultado.liberar).toBeTypeOf('function');
  });
});
