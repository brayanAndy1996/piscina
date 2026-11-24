// spec: 006-caja (pruebas protegidas)
import type { CierreCaja, MovimientoCaja, PersonaCaja } from '@aquagestion/contratos';
import { describe, expect, it } from 'vitest';
import { tieneFormaDePdf } from '../../../../test/utilidades/pdf';
import { type DatosPdfCierre, generarPdfCierre } from './cierre-pdf';

// Criterio 51 b y c (ronda adversarial 2 de la 006b; DT-10), pruebas unitarias protegidas de `generarPdfCierre` con la señal:
//
//   function generarPdfCierre(datos: DatosPdfCierre, senal?: AbortSignal): Promise<Buffer>;
//
// - El generador real comprueba la señal al empezar y entre tramos (los del criterio 49 a). Si está activa, deja de dibujar, no termina el documento
//   y rechaza con un error cuyo `name` es `'AbortError'`.
// - Con una señal ya activa, rechaza con `AbortError`.
// - Con una señal que se activa durante un PDF de 5 000 movimientos, rechaza con `AbortError` a más tardar 1 000 ms después.
// - Sin señal, y con una que nunca se activa, da los mismos bytes que antes (PQ9 d).
//
// La firma con la señal se declara aparte para que el archivo compile con el generador de hoy (que solo recibe los datos) y falle por su comportamiento.

type GenerarConSenal = (datos: DatosPdfCierre, senal?: AbortSignal) => Promise<Buffer>;
const generar: GenerarConSenal = generarPdfCierre;

const ENSEGUIDA_MS = 1000;

const persona = (nombres: string, apellidos: string, id: string): PersonaCaja => ({ id, nombres, apellidos });
const LUCIA = persona('Lucia', 'Benites', '0b5f6b2e-2a1c-4e0e-8f55-7c0a9a1d2b33');
const ROSA = persona('Rosa', 'Alvarez', '1c6a7c3f-3b52-4d4b-9a40-0a7a3d6c9f12');
const ANA = persona('Ana María', 'Quispe Rojas', '2d7b8d4a-4c63-4e5c-8b51-1b8b4e7d0a23');

function movimiento(numero: number): MovimientoCaja {
  return {
    id: `3e8c9e5b-5d74-4f6d-9c62-${String(numero).padStart(12, '0')}`,
    numero,
    tipo: numero % 2 === 0 ? 'EGRESO' : 'INGRESO',
    concepto: numero % 2 === 0 ? 'EGRESO_MENOR' : 'MENSUALIDAD',
    metodo: 'EFECTIVO',
    monto: '1.00',
    descripcion: numero % 2 === 0 ? `Gasto ${String(numero).padStart(5, '0')}` : null,
    comprobante: numero % 2 === 0 ? `B001-${String(numero).padStart(5, '0')}` : null,
    alumno: numero % 2 === 0 ? null : ANA,
    registradoPor: ROSA,
    registradoEn: '2026-11-02T15:00:00.000Z',
  };
}

function cierre(movimientosHasta: number): CierreCaja {
  return {
    numero: 1,
    cerradoPor: LUCIA,
    cerradoEn: '2026-11-02T23:00:00.000Z',
    montoInicial: '10000.00',
    ingresos: { efectivo: '42.00', yape: '88.00', transferencia: '120.00' },
    egresos: { efectivo: '15.50' },
    esperado: { efectivo: '10026.50', yape: '88.00', transferencia: '120.00' },
    montoDeclarado: '10026.50',
    diferencia: '0.00',
    resultado: 'CUADRA',
    observacion: null,
    tardio: false,
    movimientosHasta,
    reapertura: null,
  };
}

function datos(cantidad: number): DatosPdfCierre {
  return {
    academia: 'Delfines',
    caja: {
      id: '6f1c6d3e-3b52-4d4b-9a40-0a7a3d6c9f11',
      fecha: '2026-11-02',
      montoInicial: '10000.00',
      abiertaPor: LUCIA,
      abiertaEn: '2026-11-02T14:05:00.000Z',
    },
    cierre: cierre(cantidad),
    movimientos: Array.from({ length: cantidad }, (_, i) => movimiento(i + 1)),
  };
}

/** El resultado de una promesa sin lanzar: o el valor o el error con el que se rechazó. */
async function resultadoDe<T>(promesa: Promise<T>): Promise<{ valor?: T; error?: unknown }> {
  try {
    return { valor: await promesa };
  } catch (error) {
    return { error };
  }
}

const esAborto = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';

describe('generarPdfCierre con señal (criterio 51 b y c)', () => {
  it('con una señal ya activa, rechaza con AbortError (y no lanza de forma síncrona)', async () => {
    const senal = AbortSignal.abort();

    const promesa = generar(datos(50), senal);
    const { valor, error } = await resultadoDe(promesa);

    expect(valor, 'con la señal activa no debe terminar el documento').toBeUndefined();
    expect(esAborto(error), `debe rechazar con un error de nombre AbortError (fue ${String(error)})`).toBe(true);
  });

  it('con una señal que se activa durante un PDF de 5 000 movimientos, rechaza con AbortError a más tardar 1 000 ms después', async () => {
    const controlador = new AbortController();
    let terminada = false;
    const promesa = generar(datos(5000), controlador.signal);
    void promesa.then(
      () => (terminada = true),
      () => (terminada = true),
    );

    // Cuando el generador ya está armando el PDF (cede el bucle entre tramos), la prueba activa la señal.
    await new Promise<void>((resolver) => setTimeout(resolver, 100));
    expect(terminada, 'a los 100 ms el PDF de 5 000 movimientos todavía se está armando').toBe(false);
    const activada = Date.now();
    controlador.abort();
    const { valor, error } = await resultadoDe(promesa);
    const demora = Date.now() - activada;

    expect(
      valor,
      `la generación debió abortarse, no terminar (terminó ${demora} ms después de activar la señal)`,
    ).toBeUndefined();
    expect(esAborto(error), `debe rechazar con un error de nombre AbortError (fue ${String(error)})`).toBe(true);
    expect(demora, `rechazó ${demora} ms después de activar la señal (máximo ${ENSEGUIDA_MS} ms)`).toBeLessThanOrEqual(
      ENSEGUIDA_MS,
    );
  });

  it('sin señal y con una señal que no se activa, da los mismos bytes', async () => {
    const entrada = datos(200);

    const sinSenal = await generar(entrada);
    const conSenal = await generar(entrada, new AbortController().signal);
    const otraVez = await generar(entrada);

    expect(tieneFormaDePdf(sinSenal), 'es un PDF válido').toBe(true);
    expect(conSenal.equals(sinSenal), 'con una señal que nunca se activa, los mismos bytes').toBe(true);
    expect(otraVez.equals(sinSenal), 'sin señal, siempre los mismos bytes').toBe(true);
  });

  it('una señal que se activa después de terminar no cambia el resultado ya entregado', async () => {
    const controlador = new AbortController();

    const pdf = await generar(datos(20), controlador.signal);
    controlador.abort();

    expect(tieneFormaDePdf(pdf)).toBe(true);
    expect(pdf.equals(await generar(datos(20)))).toBe(true);
  });
});
