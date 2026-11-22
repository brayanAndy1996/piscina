// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_ABIERTA,
  type AppCaja,
  cajaDe,
  cookiesDeCaja,
  crearAppCaja,
  crearEscenarioDeCaja,
  type EscenarioCaja,
  exigirRutasDeCaja,
  leerCajas,
} from '../../utilidades/caja';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 12 (crítico, RNF-12; "Fechas y horas de negocio" de docs/arquitectura.md): la fecha de la caja es la de Lima. Con `RELOJ` fijo y el
// proceso en TZ=Asia/Tokyo y en TZ=UTC:
//   a) abrir a las 2026-11-30T23:59:00Z (18:59 del 30 en Lima) y a las 2026-12-01T00:30:00Z (19:30 del 30 en Lima) da `fecha` 2026-11-30 en los dos
//      casos (en UTC ya sería el 1 de diciembre);
//   b) abrir a las 2026-12-01T04:59:59.999Z (23:59:59.999 del 30 en Lima) da 2026-11-30, y a las 2026-12-01T05:00:00Z (00:00 del 1 de diciembre en
//      Lima) da 2026-12-01;
//   c) lo mismo en el cambio de año (2026-12-31 a 2027-01-01).
// Lo exige también la base (criterio 4 a). La sesión se firma para el mismo instante que el reloj (su vencimiento se lee del reloj).

const ZONA_ORIGINAL = process.env['TZ'];

const CASOS: { instante: string; fecha: string; nombre: string }[] = [
  { instante: '2026-11-30T23:59:00.000Z', fecha: '2026-11-30', nombre: '18:59 del 30 de noviembre en Lima' },
  {
    instante: '2026-12-01T00:30:00.000Z',
    fecha: '2026-11-30',
    nombre: '19:30 del 30 de noviembre en Lima (en UTC ya es 1 de diciembre)',
  },
  { instante: '2026-12-01T04:59:59.999Z', fecha: '2026-11-30', nombre: '23:59:59.999 del 30 de noviembre en Lima' },
  { instante: '2026-12-01T05:00:00.000Z', fecha: '2026-12-01', nombre: '00:00 del 1 de diciembre en Lima' },
  { instante: '2026-11-30T05:00:00.000Z', fecha: '2026-11-30', nombre: '00:00 del 30 de noviembre en Lima' },
  { instante: '2026-11-30T04:59:59.999Z', fecha: '2026-11-29', nombre: '23:59:59.999 del 29 de noviembre en Lima' },
  { instante: '2026-12-31T23:30:00.000Z', fecha: '2026-12-31', nombre: '18:30 del 31 de diciembre en Lima' },
  {
    instante: '2027-01-01T00:30:00.000Z',
    fecha: '2026-12-31',
    nombre: '19:30 del 31 de diciembre en Lima (en UTC ya es 1 de enero)',
  },
  { instante: '2027-01-01T04:59:59.999Z', fecha: '2026-12-31', nombre: '23:59:59.999 del 31 de diciembre en Lima' },
  { instante: '2027-01-01T05:00:00.000Z', fecha: '2027-01-01', nombre: '00:00 del 1 de enero en Lima' },
];

describe.each(['UTC', 'Asia/Tokyo'])(
  'la fecha de la caja es la de Lima (criterio 12) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppCaja;
    let e: EscenarioCaja;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppCaja();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      exigirRutasDeCaja(ctx.app);
      ctx.reloj.fijar(AHORA_PRUEBAS);
      e = await crearEscenarioDeCaja();
    });
    afterAll(async () => {
      await ctx?.http.cerrar();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    it.each(CASOS)('criterio 12: abrir a las $nombre ($instante) da fecha $fecha', async ({ instante, fecha }) => {
      const ahora = new Date(instante);
      ctx.reloj.fijar(ahora);
      const cookie = cookiesDeCaja(e, ahora).secretaria;

      const respuesta = await ctx.http.post('/api/cajas', cookie, {
        claveIdempotencia: randomUUID(),
        montoInicial: '100.00',
      });

      expect(respuesta.status, respuesta.texto).toBe(201);
      const caja = cajaDe(respuesta);
      expect(caja.fecha).toBe(fecha);
      expect(caja.deOtroDia).toBe(false);
      expect(Date.parse(caja.abiertaEn)).toBe(ahora.getTime());
      const filas = await leerCajas(e.A.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.fecha, 'la fecha de la fila es la de Lima, no la de UTC ni la del proceso').toBe(fecha);
      expect(filas[0]?.abierta_en.getTime()).toBe(ahora.getTime());
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_ABIERTA);
      expect((auditoria[0]?.datos_despues as { fecha?: string } | null)?.fecha).toBe(fecha);
    });
  },
);
