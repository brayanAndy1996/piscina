// spec: 009-asistencia (pruebas protegidas)
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { crearEntornoDePruebas } from '../../utilidades/aplicacion';
import { ErrorEntorno, validarEntorno } from '../../../src/infraestructura/entorno';

// Criterio 23 (crítico, D-10, D-25), parte del entorno: la variable `TAREAS_PROGRAMADAS` decide si se programan las tareas (`activas` por defecto, `inactivas` en las pruebas); `validarEntorno` rechaza cualquier otro valor con un `ErrorEntorno`
// que nombra la variable y nunca su valor. El entorno de pruebas (`crearEntornoDePruebas`) la fija en `inactivas`, para que ninguna aplicación de pruebas programe la tarea de faltas.
// Lecturas estrictas elegidas: el valor se lee en el campo `TAREAS_PROGRAMADAS` del entorno validado, con el texto exacto `activas` o `inactivas`; solo se prueban como inválidos valores que no se parecen a ninguno de los dos (no se decide aquí
// qué pasa con mayúsculas ni con espacios).

const BASE = {
  DATABASE_URL_APP: 'postgresql://aquagestion_app:clave-app-secreta@127.0.0.1:5432/aquagestion',
  JWT_SECRETO: randomBytes(32).toString('base64url'),
};

function problemas(env: Record<string, string | undefined>): readonly string[] {
  try {
    validarEntorno(env);
  } catch (error) {
    if (error instanceof ErrorEntorno) return error.problemas;
    throw error;
  }
  throw new Error('Se esperaba un ErrorEntorno');
}

const leer = (env: Record<string, string | undefined>): unknown =>
  (validarEntorno(env) as unknown as Record<string, unknown>)['TAREAS_PROGRAMADAS'];

describe('TAREAS_PROGRAMADAS en el entorno (criterio 23)', () => {
  it('criterio 23: sin la variable, las tareas están activas (por defecto)', () => {
    expect(leer(BASE)).toBe('activas');
  });

  it.each(['activas', 'inactivas'])('criterio 23: %s es un valor válido y se respeta', (valor) => {
    expect(leer({ ...BASE, TAREAS_PROGRAMADAS: valor })).toBe(valor);
  });

  it.each(['apagadas', 'quizas', 'desactivadas', 'encendidas'])(
    'criterio 23: el valor «%s» se rechaza con un problema que nombra TAREAS_PROGRAMADAS y no repite el valor',
    (valor) => {
      const lista = problemas({ ...BASE, TAREAS_PROGRAMADAS: valor });

      expect(lista.some((problema) => problema.includes('TAREAS_PROGRAMADAS'))).toBe(true);
      expect(lista.join('\n')).not.toContain(valor);
    },
  );

  it('criterio 23: el entorno de las pruebas trae TAREAS_PROGRAMADAS=inactivas, y una prueba puede reemplazarla (criterio 33)', () => {
    expect((crearEntornoDePruebas() as unknown as Record<string, unknown>)['TAREAS_PROGRAMADAS']).toBe('inactivas');
    expect(
      (crearEntornoDePruebas({ TAREAS_PROGRAMADAS: 'activas' }) as unknown as Record<string, unknown>)[
        'TAREAS_PROGRAMADAS'
      ],
    ).toBe('activas');
  });
});
