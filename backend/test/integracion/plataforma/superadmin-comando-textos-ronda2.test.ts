// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAuditoriaPlataforma } from '../../utilidades/datos';
import { EN_BLANCO_DE_LA_SPEC, NOMBRES_QUE_SE_ACEPTAN, emojis } from '../../utilidades/textos-ronda2';

// Criterios 87 y 88 (ataque ronda 2, F5 y F6) en el comando `npm run plataforma:superadmin`:
//  - 87: SUPERADMIN_NOMBRE no cuenta como visibles los caracteres \p{Default_Ignorable_Code_Point} ni U+2800.
//  - 88: SUPERADMIN_CLAVE (12 a 128) y SUPERADMIN_NOMBRE (3 a 100) se cuentan por puntos de codigo: una clave de 6 emojis
//    (12 unidades UTF-16) termina con codigo 1; una de 128 emojis se acepta y con ella se inicia sesion; una de 129, no;
//    un nombre de 51 emojis se acepta y uno de 101 no.
// Si no se cumple: codigo 1, la salida nombra la variable y no cambia nada (criterio 35); la clave nunca aparece.

const TIMEOUT = 90_000;
const CORREO = 'dueno@aquagestion.test';
const VALIDAS = {
  SUPERADMIN_CORREO: CORREO,
  SUPERADMIN_NOMBRE: 'Dueño de la plataforma',
  SUPERADMIN_CLAVE: 'Nueva-Clave-Segura-2026',
};

async function filasDeSuperadmins(): Promise<{ id: string; nombre: string }[]> {
  const { rows } = await ejecutarComo('propietario', 'SELECT id, nombre FROM superadmins', [], { plataforma: true });
  return rows as { id: string; nombre: string }[];
}

describe('criterios 87 y 88: entradas de texto del comando plataforma:superadmin', () => {
  beforeEach(limpiarBase);

  async function esperarRechazo(
    variables: Record<string, string>,
    variable: 'SUPERADMIN_NOMBRE' | 'SUPERADMIN_CLAVE',
  ): Promise<void> {
    const resultado = ejecutarComando('plataforma:superadmin', variables);

    expect(resultado.estado, resultado.salida).toBe(1);
    expect(resultado.salida).toContain(variable);
    if (variable !== 'SUPERADMIN_CLAVE') expect(resultado.salida).not.toContain(variables['SUPERADMIN_CLAVE'] ?? '');
    expect(await filasDeSuperadmins()).toEqual([]);
    expect(await leerAuditoriaPlataforma()).toEqual([]);
  }

  describe('criterio 87: SUPERADMIN_NOMBRE con caracteres que se ven en blanco', () => {
    it.each(EN_BLANCO_DE_LA_SPEC)(
      'criterio 87: un nombre de %s termina con codigo 1, nombra la variable y no crea nada',
      async (_caso, nombre) => {
        await esperarRechazo({ ...VALIDAS, SUPERADMIN_NOMBRE: nombre }, 'SUPERADMIN_NOMBRE');
      },
      TIMEOUT,
    );

    it.each(NOMBRES_QUE_SE_ACEPTAN)(
      'criterio 87: el nombre %j se acepta y se guarda tal como llega',
      async (nombre) => {
        const resultado = ejecutarComando('plataforma:superadmin', { ...VALIDAS, SUPERADMIN_NOMBRE: nombre });

        expect(resultado.estado, resultado.salida).toBe(0);
        expect((await filasDeSuperadmins()).map((fila) => fila.nombre)).toEqual([nombre]);
      },
      TIMEOUT,
    );
  });

  describe('criterio 88: longitudes por puntos de codigo', () => {
    it(
      'criterio 88: una clave de 6 emojis (12 unidades UTF-16) termina con codigo 1 y nombra SUPERADMIN_CLAVE',
      async () => {
        const resultado = ejecutarComando('plataforma:superadmin', { ...VALIDAS, SUPERADMIN_CLAVE: emojis(6) });

        expect(resultado.estado, resultado.salida).toBe(1);
        expect(resultado.salida).toContain('SUPERADMIN_CLAVE');
        expect(resultado.salida).not.toContain(emojis(6));
        expect(await filasDeSuperadmins()).toEqual([]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
      TIMEOUT,
    );

    it(
      'criterio 88: una clave de 11 emojis termina con codigo 1 y una de 12 emojis (el minimo) se acepta',
      async () => {
        const corta = ejecutarComando('plataforma:superadmin', { ...VALIDAS, SUPERADMIN_CLAVE: emojis(11) });
        expect(corta.estado, corta.salida).toBe(1);
        expect(corta.salida).toContain('SUPERADMIN_CLAVE');
        expect(await filasDeSuperadmins()).toEqual([]);

        const justa = ejecutarComando('plataforma:superadmin', { ...VALIDAS, SUPERADMIN_CLAVE: emojis(12) });
        expect(justa.estado, justa.salida).toBe(0);
        expect(await filasDeSuperadmins()).toHaveLength(1);
      },
      TIMEOUT,
    );

    it(
      'criterio 88: una clave de 128 emojis se acepta y con ella se inicia sesion (200)',
      async () => {
        const clave = emojis(128);

        const resultado = ejecutarComando('plataforma:superadmin', { ...VALIDAS, SUPERADMIN_CLAVE: clave });

        expect(resultado.estado, resultado.salida).toBe(0);
        expect(resultado.salida).not.toContain(clave);
        const app: NestExpressApplication = await crearAppDePruebas({ nivelRegistro: 'silent' });
        try {
          const sesion = await request(app.getHttpServer())
            .post('/api/plataforma/sesion')
            .send({ correo: CORREO, clave });
          expect(sesion.status).toBe(200);
        } finally {
          await app.close();
        }
      },
      TIMEOUT,
    );

    it(
      'criterio 88: una clave de 129 emojis termina con codigo 1, nombra SUPERADMIN_CLAVE y no crea nada',
      async () => {
        const resultado = ejecutarComando('plataforma:superadmin', { ...VALIDAS, SUPERADMIN_CLAVE: emojis(129) });

        expect(resultado.estado, resultado.salida).toBe(1);
        expect(resultado.salida).toContain('SUPERADMIN_CLAVE');
        expect(resultado.salida).not.toContain(emojis(129));
        expect(await filasDeSuperadmins()).toEqual([]);
        expect(await leerAuditoriaPlataforma()).toEqual([]);
      },
      TIMEOUT,
    );

    it(
      'criterio 88: un nombre de 51 emojis (102 unidades UTF-16) se acepta',
      async () => {
        const resultado = ejecutarComando('plataforma:superadmin', { ...VALIDAS, SUPERADMIN_NOMBRE: emojis(51) });

        expect(resultado.estado, resultado.salida).toBe(0);
        expect((await filasDeSuperadmins()).map((fila) => fila.nombre)).toEqual([emojis(51)]);
      },
      TIMEOUT,
    );

    it(
      'criterio 88: un nombre de 100 emojis se acepta',
      () => {
        const resultado = ejecutarComando('plataforma:superadmin', { ...VALIDAS, SUPERADMIN_NOMBRE: emojis(100) });

        expect(resultado.estado, resultado.salida).toBe(0);
      },
      TIMEOUT,
    );

    it(
      'criterio 88: un nombre de 101 emojis termina con codigo 1, nombra SUPERADMIN_NOMBRE y no crea nada',
      async () => {
        await esperarRechazo({ ...VALIDAS, SUPERADMIN_NOMBRE: emojis(101) }, 'SUPERADMIN_NOMBRE');
      },
      TIMEOUT,
    );
  });
});
