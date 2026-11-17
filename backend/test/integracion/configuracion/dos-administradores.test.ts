import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCION_AUDITORIA,
  type ClienteDeConfiguracion,
  escucharParaConfiguracion,
  fijarConfiguracion,
  leerFilaConfiguracion,
  POR_DEFECTO,
} from '../../utilidades/configuracion';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
} from '../../utilidades/usuarios';

// Spec 003, criterio 12: dos administradores de la misma academia guardan a la vez. Los dos responden 200 (nunca 500 ni 40P01), el valor
// final es el de uno de ellos y las dos CONFIGURACION_ACTUALIZADA quedan encadenadas. Varias rondas, sin depender de tiempos. Prueba de
// integración no protegida.

const RONDAS = 5;

describe('criterio 12: dos administradores guardan a la vez', () => {
  let app: NestExpressApplication;
  let http: ClienteDeConfiguracion;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    http = await escucharParaConfiguracion(app);
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  async function dosAdministradores() {
    const e = await crearEscenario();
    const segundo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_COMUN });
    return {
      e,
      cookies: [cookieDeUsuario(e.adminA, AHORA_PRUEBAS), cookieDeUsuario(segundo, AHORA_PRUEBAS)] as const,
    };
  }

  it.each(Array.from({ length: RONDAS }, (_, ronda) => ronda + 1))(
    'ronda %i: sobre el mismo campo, los dos responden 200, gana uno y las auditorías se encadenan',
    async (ronda) => {
      const { e, cookies } = await dosAdministradores();
      const a = 11 + ronda;
      const b = 21 + ronda;

      const respuestas = await Promise.all([
        http.patch('/api/configuracion', cookies[0], { toleranciaTardanzaMinutos: a }),
        http.patch('/api/configuracion', cookies[1], { toleranciaTardanzaMinutos: b }),
      ]);

      expect(
        respuestas.map((respuesta) => respuesta.status),
        JSON.stringify(respuestas),
      ).toEqual([200, 200]);
      const final = (await leerFilaConfiguracion(e.A.id, 'tolerancia_tardanza_minutos'))?.valor;
      expect([a, b]).toContain(final);
      const registros = await leerAuditoriaDeAcademia(e.A.id, ACCION_AUDITORIA);
      expect(registros).toHaveLength(2);
      const antes = registros.map(
        (registro) => (registro.datos_antes as { toleranciaTardanzaMinutos: number }).toleranciaTardanzaMinutos,
      );
      const despues = registros.map(
        (registro) => (registro.datos_despues as { toleranciaTardanzaMinutos: number }).toleranciaTardanzaMinutos,
      );
      const primero = antes.indexOf(POR_DEFECTO.toleranciaTardanzaMinutos);
      expect(primero, 'una de las dos auditorías parte del valor de antes').toBeGreaterThanOrEqual(0);
      const segundo = 1 - primero;
      expect(antes[segundo], 'el "antes" de la segunda es el "después" de la primera').toBe(despues[primero]);
      expect(despues[segundo], 'el valor final es el de la segunda').toBe(final);
      expect(new Set(despues)).toEqual(new Set([a, b]));
    },
  );

  it.each(Array.from({ length: RONDAS }, (_, ronda) => ronda + 1))(
    'ronda %i: sobre campos distintos se conservan los dos cambios',
    async (ronda) => {
      const { e, cookies } = await dosAdministradores();
      await fijarConfiguracion(e.A.id, { diasPorVencer: 7 });

      const respuestas = await Promise.all([
        http.patch('/api/configuracion', cookies[0], { minutosBloqueo: 20 + ronda }),
        http.patch('/api/configuracion', cookies[1], { telefono: `999 000 ${100 + ronda}` }),
      ]);

      expect(
        respuestas.map((respuesta) => respuesta.status),
        JSON.stringify(respuestas),
      ).toEqual([200, 200]);
      expect((await leerFilaConfiguracion(e.A.id, 'minutos_bloqueo'))?.valor).toBe(20 + ronda);
      expect((await leerFilaConfiguracion(e.A.id, 'telefono'))?.valor).toBe(`999 000 ${100 + ronda}`);
      expect((await leerFilaConfiguracion(e.A.id, 'dias_por_vencer'))?.valor).toBe(7);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_AUDITORIA)).toHaveLength(2);
    },
  );

  it('el mismo cambio enviado a la vez por los dos deja una sola auditoría', async () => {
    const { e, cookies } = await dosAdministradores();

    const respuestas = await Promise.all([
      http.patch('/api/configuracion', cookies[0], { diasPorVencer: 9 }),
      http.patch('/api/configuracion', cookies[1], { diasPorVencer: 9 }),
    ]);

    expect(respuestas.map((respuesta) => respuesta.status)).toEqual([200, 200]);
    expect((await leerFilaConfiguracion(e.A.id, 'dias_por_vencer'))?.valor).toBe(9);
    expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_AUDITORIA)).toHaveLength(1);
  });
});
