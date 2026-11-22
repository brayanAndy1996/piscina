// spec: 006-caja (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  actualizarFilasCaja,
  type Columnas,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  cerrarCajaDePrueba,
  type EscenarioCaja,
  AYER,
  enLima,
  filaCajaValida,
  filaCierreValida,
  filaEgresoValida,
  filaIngresoValida,
  insertarFilaCaja,
  leerCajas,
  leerCierres,
  leerMovimientos,
  TABLAS_006,
  type Tabla006,
} from '../../utilidades/caja';

// Criterio 3 (crítico, D-23, D-29): dadas cajas, movimientos y cierres en A y en B, como app: en contexto de A, SELECT devuelve solo filas de
// A; un INSERT con `academia_id` de B y un UPDATE que mueve una fila de A a B fallan con 42501; en contexto de plataforma o sin contexto,
// devuelven 0 filas y el INSERT falla. Aunque quien escriba sea el dueño de las tablas, un movimiento o un cierre de A con la `caja_id` de una
// caja de B, un movimiento de A con el `alumno_id` de un alumno de B, y una caja, un movimiento o un cierre de A con un usuario de B
// (`abierta_por`, `registrado_por`, `cerrado_por`, `reabierto_por`) fallan con 23503. Las filas se leen como dueño filtrando por
// `academia_id` (sirve con un dueño superusuario o no).

interface Datos {
  academiaId: string;
  adminId: string;
  secretariaId: string;
  alumnoId: string;
  /** La caja ABIERTA de hoy, con un ingreso y un egreso. */
  cajaAbiertaId: string;
  /** La caja cerrada de ayer, con su cierre. */
  cajaCerradaId: string;
  movimientoId: string;
  cierreId: string;
}

describe('criterio 3: RLS y llaves compuestas de las tablas de la caja', () => {
  let e: EscenarioCaja;
  let A: Datos;
  let B: Datos;

  async function sembrar(academiaId: string, adminId: string, secretariaId: string): Promise<Datos> {
    const alumno = await crearAlumnoDeCaja(academiaId);
    const cerrada = await crearCajaDePrueba(academiaId, secretariaId, { fecha: AYER });
    const cierre = await cerrarCajaDePrueba(academiaId, cerrada.id, secretariaId, {
      cerradoEn: enLima(AYER, '18:00'),
    });
    const abierta = await crearCajaDePrueba(academiaId, secretariaId);
    const ingreso = await crearIngresoDePrueba(academiaId, abierta.id, secretariaId, alumno.id);
    await crearEgresoDePrueba(academiaId, abierta.id, secretariaId);
    return {
      academiaId,
      adminId,
      secretariaId,
      alumnoId: alumno.id,
      cajaAbiertaId: abierta.id,
      cajaCerradaId: cerrada.id,
      movimientoId: ingreso.id,
      cierreId: cierre.id,
    };
  }

  beforeEach(async () => {
    e = await crearEscenarioDeCaja();
    A = await sembrar(e.A.id, e.adminA.id, e.secretariaA.id);
    B = await sembrar(e.B.id, e.adminB.id, e.secretariaB.id);
  });

  /** Una fila válida y nueva de la tabla para la academia de `d` (usa las filas padre de esa academia). */
  function filaNuevaDe(tabla: Tabla006, d: Datos): Columnas {
    switch (tabla) {
      case 'cajas':
        return filaCajaValida(d.secretariaId, { fecha: '2026-10-01', estado: 'CERRADA' });
      case 'movimientos_caja':
        return filaIngresoValida(d.cajaAbiertaId, d.secretariaId, d.alumnoId, 10);
      case 'cierres_caja':
        return filaCierreValida(d.cajaAbiertaId, d.secretariaId);
    }
  }

  const idsDe = async (tabla: Tabla006, contexto: { academiaId?: string; plataforma?: boolean | string }) => {
    const { rows } = await ejecutarComo('app', `SELECT id::text AS id FROM ${tabla} ORDER BY 1`, [], contexto);
    return (rows as { id: string }[]).map((fila) => fila.id);
  };

  describe.each(TABLAS_006)('SELECT en %s', (tabla) => {
    it('criterio 3: en contexto de A devuelve solo las filas de A; en el de B, solo las de B (cada una tiene al menos una)', async () => {
      const deA = await idsDe(tabla, { academiaId: A.academiaId });
      const deB = await idsDe(tabla, { academiaId: B.academiaId });

      expect(deA.length).toBeGreaterThan(0);
      expect(deB.length).toBeGreaterThan(0);
      expect(deA.filter((id) => deB.includes(id))).toEqual([]);
    });

    it('criterio 3: en contexto de plataforma, sin contexto o con la academia vacía devuelve 0 filas (el Superadmin no ve nada, D-29)', async () => {
      expect(await idsDe(tabla, { plataforma: true })).toEqual([]);
      expect(await idsDe(tabla, {})).toEqual([]);
      expect(await idsDe(tabla, { academiaId: '' })).toEqual([]);
    });

    it('criterio 3: en contexto de plataforma y de A a la vez solo se ven las de A (la marca de plataforma no abre nada)', async () => {
      expect(await idsDe(tabla, { plataforma: true, academiaId: A.academiaId })).toEqual(
        await idsDe(tabla, { academiaId: A.academiaId }),
      );
    });
  });

  describe.each(TABLAS_006)('INSERT en %s', (tabla) => {
    it('criterio 3: un INSERT con la academia_id de B en contexto de A falla con 42501 y B no recibe nada', async () => {
      const antes = await idsDe(tabla, { academiaId: B.academiaId });

      await expect(
        insertarFilaCaja('app', tabla, B.academiaId, filaNuevaDe(tabla, B), {
          contexto: { academiaId: A.academiaId },
        }),
      ).rejects.toMatchObject({ code: '42501' });

      expect(await idsDe(tabla, { academiaId: B.academiaId })).toEqual(antes);
    });

    it('criterio 3: en contexto de plataforma o sin contexto, un INSERT falla con 42501 (con la academia de A o de B)', async () => {
      for (const contexto of [{ plataforma: true }, {}] as const) {
        for (const d of [A, B]) {
          await expect(
            insertarFilaCaja('app', tabla, d.academiaId, filaNuevaDe(tabla, d), { contexto }),
            `${JSON.stringify(contexto)} en ${d.academiaId}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
      }
    });

    it('criterio 3: un INSERT de la propia academia en su contexto sí se acepta (control)', async () => {
      await expect(insertarFilaCaja('app', tabla, A.academiaId, filaNuevaDe(tabla, A))).resolves.toBeDefined();
    });
  });

  describe('UPDATE', () => {
    const CAMBIOS_PERMITIDOS: Record<'cajas' | 'cierres_caja', { donde: (d: Datos) => Columnas; cambio: Columnas }> = {
      cajas: { donde: (d) => ({ id: d.cajaAbiertaId }), cambio: { estado: 'CERRADA' } },
      cierres_caja: {
        donde: (d) => ({ id: d.cierreId }),
        cambio: { motivo_reapertura: 'Se cerró por error' },
      },
    };

    it.each(TABLAS_006)(
      'criterio 3: un UPDATE que mueve una fila de %s de A a B falla con 42501 y la fila sigue en A',
      async (tabla) => {
        const donde: Columnas =
          tabla === 'cajas'
            ? { id: A.cajaAbiertaId }
            : tabla === 'movimientos_caja'
              ? { id: A.movimientoId }
              : { id: A.cierreId };
        const antes = await idsDe(tabla, { academiaId: A.academiaId });

        await expect(
          actualizarFilasCaja('app', tabla, A.academiaId, donde, { academia_id: B.academiaId }),
        ).rejects.toMatchObject({ code: '42501' });

        expect(await idsDe(tabla, { academiaId: A.academiaId })).toEqual(antes);
      },
    );

    it.each(['cajas', 'cierres_caja'] as const)(
      'criterio 3: un UPDATE permitido sobre filas de B desde el contexto de A no cambia ninguna fila (0 filas), %s',
      async (tabla) => {
        const regla = CAMBIOS_PERMITIDOS[tabla];

        const filas = await actualizarFilasCaja('app', tabla, A.academiaId, regla.donde(B), regla.cambio);

        expect(filas).toBe(0);
        expect((await leerCajas(B.academiaId)).filter((c) => c.estado === 'ABIERTA')).toHaveLength(1);
        expect((await leerCierres(B.academiaId))[0]?.motivo_reapertura).toBeNull();
      },
    );

    it.each(['cajas', 'cierres_caja'] as const)(
      'criterio 3: en contexto de plataforma o sin contexto, un UPDATE permitido no cambia ninguna fila (0 filas), %s',
      async (tabla) => {
        const regla = CAMBIOS_PERMITIDOS[tabla];

        for (const contexto of [{ plataforma: true }, {}] as const) {
          expect(
            await actualizarFilasCaja('app', tabla, A.academiaId, regla.donde(A), regla.cambio, { contexto }),
            JSON.stringify(contexto),
          ).toBe(0);
        }
        expect((await leerCajas(A.academiaId)).filter((c) => c.estado === 'ABIERTA')).toHaveLength(1);
      },
    );
  });

  describe('llaves foráneas compuestas, aunque quien escriba sea el dueño de las tablas (23503)', () => {
    const comoDueno = (tabla: Tabla006, d: Datos, fila: Columnas) =>
      insertarFilaCaja('propietario', tabla, d.academiaId, fila);

    it('criterio 3: un movimiento de A con la caja_id de una caja de B falla con 23503', async () => {
      const fila = filaIngresoValida(B.cajaAbiertaId, A.secretariaId, A.alumnoId, 20);

      await expect(comoDueno('movimientos_caja', A, fila)).rejects.toMatchObject({ code: '23503' });

      expect(await leerMovimientos(B.academiaId)).toHaveLength(2);
    });

    it('criterio 3: un cierre de A con la caja_id de una caja de B falla con 23503', async () => {
      const fila = filaCierreValida(B.cajaAbiertaId, A.secretariaId);

      await expect(comoDueno('cierres_caja', A, fila)).rejects.toMatchObject({ code: '23503' });

      expect(await leerCierres(B.academiaId)).toHaveLength(1);
    });

    it('criterio 3: un movimiento de A con el alumno_id de un alumno de B falla con 23503', async () => {
      const fila = filaIngresoValida(A.cajaAbiertaId, A.secretariaId, B.alumnoId, 20);

      await expect(comoDueno('movimientos_caja', A, fila)).rejects.toMatchObject({ code: '23503' });
    });

    it('criterio 3: un movimiento de A con un registrado_por de B falla con 23503', async () => {
      const ingreso = filaIngresoValida(A.cajaAbiertaId, B.secretariaId, A.alumnoId, 20);
      const egreso = filaEgresoValida(A.cajaAbiertaId, B.secretariaId, 21);

      await expect(comoDueno('movimientos_caja', A, ingreso)).rejects.toMatchObject({ code: '23503' });
      await expect(comoDueno('movimientos_caja', A, egreso)).rejects.toMatchObject({ code: '23503' });
    });

    it('criterio 3: una caja de A con un abierta_por de B falla con 23503', async () => {
      const fila = filaCajaValida(B.secretariaId, { fecha: '2026-10-01', estado: 'CERRADA' });

      await expect(comoDueno('cajas', A, fila)).rejects.toMatchObject({ code: '23503' });

      expect(await leerCajas(A.academiaId)).toHaveLength(2);
    });

    it('criterio 3: un cierre de A con un cerrado_por de B falla con 23503', async () => {
      const fila = filaCierreValida(A.cajaAbiertaId, B.secretariaId);

      await expect(comoDueno('cierres_caja', A, fila)).rejects.toMatchObject({ code: '23503' });
    });

    it('criterio 3: un cierre de A con un reabierto_por de B falla con 23503', async () => {
      const fila = filaCierreValida(
        A.cajaAbiertaId,
        A.secretariaId,
        {},
        {
          reabierto_por: B.adminId,
          reabierto_en: enLima('2026-11-11', '19:00'),
          motivo_reapertura: 'Reapertura de la prueba',
        },
      );

      await expect(comoDueno('cierres_caja', A, fila)).rejects.toMatchObject({ code: '23503' });
    });

    it('criterio 3: con usuarios, alumno y caja de la propia academia las mismas filas se aceptan (control)', async () => {
      await comoDueno('movimientos_caja', A, filaIngresoValida(A.cajaAbiertaId, A.adminId, A.alumnoId, 20));
      await comoDueno('cajas', A, filaCajaValida(A.adminId, { fecha: '2026-10-01', estado: 'CERRADA' }));
      await comoDueno(
        'cierres_caja',
        A,
        filaCierreValida(
          A.cajaAbiertaId,
          A.secretariaId,
          {},
          {
            reabierto_por: A.adminId,
            reabierto_en: enLima('2026-11-11', '19:00'),
            motivo_reapertura: 'Reapertura de la prueba',
          },
        ),
      );

      expect(await leerMovimientos(A.academiaId)).toHaveLength(3);
    });
  });
});
