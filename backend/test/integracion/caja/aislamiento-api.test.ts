// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  AYER,
  type AppCaja,
  cajaDe,
  type CajaDePrueba,
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  cuerpoApertura,
  cuerpoCierre,
  cuerpoEgreso,
  cuerpoReapertura,
  enLima,
  type EscenarioCaja,
  exigirRutasDeCaja,
  instantaneaDeCaja,
  leerCajas,
  rutaCaja,
} from '../../utilidades/caja';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 8 (crítico, D-23): aislamiento en la API. Dadas cajas en A y en B, cuando un ADMIN o una SECRETARIA de A usa las rutas:
// GET /api/cajas/actual nunca devuelve la caja de B, aunque A no tenga caja y B tenga una abierta; un POST de egreso, cierre o reapertura sobre
// el id de una caja de B responde 404 NO_ENCONTRADO, con el mismo cuerpo que un id que no existe y que uno que no es UUID; un cuerpo con
// `academiaId`, `cajaId`, `fecha`, `abiertaPor` o cualquier campo que no sea del contrato responde 400 sin escribir; un parámetro
// `?academiaId=<id de B>` se ignora o responde 400, pero nunca muestra ni escribe datos de B. Abrir la caja en A no cuenta la caja abierta de
// B (criterio 13). Las filas y la auditoría de B no cambian. Los valores esperados están escritos a mano. (006b: lo mismo en la lista, el
// detalle y el PDF.)

describe('criterio 8: aislamiento de la caja en la API', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  /** La caja ABIERTA de hoy de B, con un ingreso y un egreso. */
  let cajaAbiertaB: CajaDePrueba;
  /** La caja de ayer de B, cerrada. */
  let cajaCerradaB: CajaDePrueba;
  let alumnoB: { id: string; nombres: string; apellidos: string };

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    alumnoB = await crearAlumnoDeCaja(e.B.id, 'Beto', 'Bravo Zeta');
    cajaCerradaB = await crearCajaDePrueba(e.B.id, e.secretariaB.id, { fecha: AYER, monto_inicial: '300.00' });
    await cerrarCajaDePrueba(e.B.id, cajaCerradaB.id, e.secretariaB.id, { cerradoEn: enLima(AYER, '18:00') });
    cajaAbiertaB = await crearCajaDePrueba(e.B.id, e.secretariaB.id, { monto_inicial: '777.00' });
    await crearIngresoDePrueba(e.B.id, cajaAbiertaB.id, e.secretariaB.id, alumnoB.id, { monto: '88.00' });
    await crearEgresoDePrueba(e.B.id, cajaAbiertaB.id, e.secretariaB.id, { descripcion: 'Gasto secreto de B' });
    await insertarAuditoria(e.B.id, 'ACCION_PREVIA_B');
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const estadoDeB = async () => ({
    cajas: await instantaneaDeCaja(e.B.id),
    auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
  });
  const estadoDeA = async () => ({
    cajas: await instantaneaDeCaja(e.A.id),
    auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
  });
  const sinDatosDeB = (texto: string) => {
    for (const marca of [
      cajaAbiertaB.id,
      cajaCerradaB.id,
      alumnoB.id,
      e.secretariaB.id,
      'Beto',
      'Bravo',
      'Gasto secreto de B',
      '777.00',
      e.B.id,
    ]) {
      expect(texto).not.toContain(marca);
    }
  };

  describe('lecturas: GET /api/cajas/actual', () => {
    it.each(['admin', 'secretaria'] as const)(
      'criterio 8: el %s de A, sin caja en A, recibe { caja: null } aunque B tenga una caja abierta, y nada de B',
      async (rol) => {
        const respuesta = await ctx.http.get('/api/cajas/actual', cookies[rol]);

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(respuesta.body).toEqual({ caja: null });
        sinDatosDeB(respuesta.texto);
      },
    );

    it('criterio 8: con caja en A, trae la de A (nunca la de B, aunque las dos sean de hoy)', async () => {
      const deA = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '55.00' });

      const respuesta = await ctx.http.get('/api/cajas/actual', cookies.admin);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const caja = cajaDe(respuesta);
      expect(caja.id).toBe(deA.id);
      expect(caja.montoInicial).toBe('55.00');
      expect(caja.movimientos).toEqual([]);
      sinDatosDeB(respuesta.texto);
    });

    it('criterio 8: el ADMIN de B trae solo la caja de B', async () => {
      const respuesta = await ctx.http.get('/api/cajas/actual', cookies.adminB);

      expect(respuesta.status, respuesta.texto).toBe(200);
      const caja = cajaDe(respuesta);
      expect(caja.id).toBe(cajaAbiertaB.id);
      expect(caja.movimientos).toHaveLength(2);
      expect(JSON.stringify(respuesta.body)).not.toContain(e.A.id);
    });

    it('criterio 8: un parámetro ?academiaId=<id de B> se ignora o responde 400, pero nunca muestra datos de B', async () => {
      const respuesta = await ctx.http.get(`/api/cajas/actual?academiaId=${e.B.id}`, cookies.admin);

      expect([200, 400], respuesta.texto).toContain(respuesta.status);
      if (respuesta.status === 200) expect(respuesta.body).toEqual({ caja: null });
      sinDatosDeB(respuesta.texto);
    });

    it('criterio 8: lo mismo con ?cajaId=<id de la caja de B> y con otros parámetros de consulta', async () => {
      for (const consulta of [
        `cajaId=${cajaAbiertaB.id}`,
        `id=${cajaAbiertaB.id}`,
        `fecha=${AYER}`,
        'estado=ABIERTA',
      ]) {
        const respuesta = await ctx.http.get(`/api/cajas/actual?${consulta}`, cookies.secretaria);

        expect([200, 400], `${consulta}: ${respuesta.texto}`).toContain(respuesta.status);
        if (respuesta.status === 200) expect(respuesta.body).toEqual({ caja: null });
        sinDatosDeB(respuesta.texto);
      }
    });
  });

  describe('escrituras sobre el id de una caja de B', () => {
    interface Escritura {
      nombre: string;
      sufijo: string;
      cuerpo: () => Record<string, unknown>;
      /** La caja de B a la que apunta. */
      objetivo: () => string;
      cookie: () => string;
    }

    const ESCRITURAS: Escritura[] = [
      {
        nombre: 'egreso',
        sufijo: '/egresos',
        cuerpo: () => cuerpoEgreso(),
        objetivo: () => cajaAbiertaB.id,
        cookie: () => cookies.secretaria,
      },
      {
        nombre: 'cierre',
        sufijo: '/cierre',
        cuerpo: () => cuerpoCierre({ montoDeclarado: '777.00', ultimoMovimientoVisto: 2 }),
        objetivo: () => cajaAbiertaB.id,
        cookie: () => cookies.secretaria,
      },
      {
        nombre: 'reapertura',
        sufijo: '/reapertura',
        cuerpo: () => cuerpoReapertura(),
        objetivo: () => cajaCerradaB.id,
        cookie: () => cookies.admin,
      },
    ];

    it.each(ESCRITURAS)(
      'criterio 8: un POST de $nombre sobre una caja de B responde 404 NO_ENCONTRADO, con el mismo cuerpo que un id que no existe y que uno que no es UUID, sin escribir ni auditar en ninguna academia',
      async (escritura) => {
        const antesB = await estadoDeB();
        const antesA = await estadoDeA();

        const deB = await ctx.http.post(
          rutaCaja(escritura.objetivo(), escritura.sufijo),
          escritura.cookie(),
          escritura.cuerpo(),
        );
        const inexistente = await ctx.http.post(
          rutaCaja(randomUUID(), escritura.sufijo),
          escritura.cookie(),
          escritura.cuerpo(),
        );
        const noUuid = await ctx.http.post(
          rutaCaja('no-es-un-uuid', escritura.sufijo),
          escritura.cookie(),
          escritura.cuerpo(),
        );
        const enMayusculas = await ctx.http.post(
          rutaCaja(escritura.objetivo().toUpperCase(), escritura.sufijo),
          escritura.cookie(),
          escritura.cuerpo(),
        );

        for (const respuesta of [deB, inexistente, noUuid, enMayusculas]) {
          expect(respuesta.status, respuesta.texto).toBe(404);
          expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
          expect(respuesta.cacheControl).toBe('no-store');
          sinDatosDeB(respuesta.texto);
        }
        expect(deB.body, 'el mismo cuerpo que un id que no existe').toEqual(inexistente.body);
        expect(noUuid.body, 'el mismo cuerpo que un id que no existe').toEqual(inexistente.body);
        expect(enMayusculas.body).toEqual(inexistente.body);
        expect(await estadoDeB()).toEqual(antesB);
        expect(await estadoDeA()).toEqual(antesA);
      },
    );

    it('criterio 8: la reapertura de una caja cerrada de B por el ADMIN de A responde 404 aunque en A no haya otra caja abierta (no 409)', async () => {
      const respuesta = await ctx.http.post(
        rutaCaja(cajaCerradaB.id, '/reapertura'),
        cookies.admin,
        cuerpoReapertura(),
      );

      expect(respuesta.status, respuesta.texto).toBe(404);
      expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
    });

    it('criterio 8: lo mismo al revés: el ADMIN de B no toca la caja de A', async () => {
      const deA = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '55.00' });
      const antesA = await estadoDeA();

      const egreso = await ctx.http.post(rutaCaja(deA.id, '/egresos'), cookies.adminB, cuerpoEgreso());
      const cierre = await ctx.http.post(
        rutaCaja(deA.id, '/cierre'),
        cookies.adminB,
        cuerpoCierre({ montoDeclarado: '55.00' }),
      );

      for (const respuesta of [egreso, cierre]) {
        expect(respuesta.status, respuesta.texto).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
      }
      expect(await estadoDeA()).toEqual(antesA);
    });

    it('criterio 8: un UUID en mayúsculas de la propia caja se trata igual que en minúsculas (control del 404 anterior)', async () => {
      const deA = await crearCajaDePrueba(e.A.id, e.secretariaA.id);

      const respuesta = await ctx.http.post(
        rutaCaja(deA.id.toUpperCase(), '/egresos'),
        cookies.secretaria,
        cuerpoEgreso(),
      );

      expect(respuesta.status, respuesta.texto).toBe(201);
    });
  });

  describe('cuerpos con campos de más', () => {
    const CAMPOS_DE_MAS: [string, unknown][] = [
      ['academiaId', 'B'],
      ['cajaId', 'B'],
      ['fecha', '2026-11-10'],
      ['abiertaPor', 'B'],
      ['registradoPor', 'B'],
      ['estado', 'CERRADA'],
      ['campoInventado', 1],
    ];

    const valor = (v: unknown) => (v === 'B' ? e.B.id : v);

    it.each(CAMPOS_DE_MAS)(
      'criterio 8: POST /api/cajas con %s de más responde 400 SOLICITUD_INVALIDA sin escribir',
      async (campo, v) => {
        const antesA = await estadoDeA();
        const antesB = await estadoDeB();

        const respuesta = await ctx.http.post('/api/cajas', cookies.admin, cuerpoApertura({ [campo]: valor(v) }));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await estadoDeA()).toEqual(antesA);
        expect(await estadoDeB()).toEqual(antesB);
      },
    );

    it.each(CAMPOS_DE_MAS)(
      'criterio 8: POST …/egresos con %s de más responde 400 SOLICITUD_INVALIDA sin escribir',
      async (campo, v) => {
        const deA = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
        const antesA = await estadoDeA();
        const antesB = await estadoDeB();

        const respuesta = await ctx.http.post(
          rutaCaja(deA.id, '/egresos'),
          cookies.secretaria,
          cuerpoEgreso({ [campo]: valor(v) }),
        );

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await estadoDeA()).toEqual(antesA);
        expect(await estadoDeB()).toEqual(antesB);
      },
    );

    it.each(CAMPOS_DE_MAS)(
      'criterio 8: POST …/cierre con %s de más responde 400 SOLICITUD_INVALIDA sin escribir',
      async (campo, v) => {
        const deA = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
        const antesA = await estadoDeA();
        const antesB = await estadoDeB();

        const respuesta = await ctx.http.post(
          rutaCaja(deA.id, '/cierre'),
          cookies.secretaria,
          cuerpoCierre({ montoDeclarado: '100.00', [campo]: valor(v) }),
        );

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await estadoDeA()).toEqual(antesA);
        expect(await estadoDeB()).toEqual(antesB);
      },
    );

    it.each(CAMPOS_DE_MAS)(
      'criterio 8: POST …/reapertura con %s de más responde 400 SOLICITUD_INVALIDA sin escribir',
      async (campo, v) => {
        const deA = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER });
        await cerrarCajaDePrueba(e.A.id, deA.id, e.secretariaA.id, { cerradoEn: enLima(AYER, '18:00') });
        const antesA = await estadoDeA();
        const antesB = await estadoDeB();

        const respuesta = await ctx.http.post(
          rutaCaja(deA.id, '/reapertura'),
          cookies.admin,
          cuerpoReapertura({ [campo]: valor(v) }),
        );

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await estadoDeA()).toEqual(antesA);
        expect(await estadoDeB()).toEqual(antesB);
      },
    );
  });

  describe('parámetros de consulta en las escrituras', () => {
    it('criterio 8: POST /api/cajas?academiaId=<B> se ignora o responde 400: la caja nueva, si se crea, es de A y B no cambia', async () => {
      const antesB = await estadoDeB();

      const respuesta = await ctx.http.post(`/api/cajas?academiaId=${e.B.id}`, cookies.secretaria, cuerpoApertura());

      expect([201, 400], respuesta.texto).toContain(respuesta.status);
      expect(await estadoDeB()).toEqual(antesB);
      if (respuesta.status === 201) {
        expect((await leerCajas(e.A.id)).map((caja) => caja.id)).toEqual([cajaDe(respuesta).id]);
      } else {
        expect(await leerCajas(e.A.id)).toEqual([]);
      }
    });

    it('criterio 8: POST …/egresos?academiaId=<B> sobre una caja de A: nunca escribe en B', async () => {
      const deA = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
      const antesB = await estadoDeB();

      const respuesta = await ctx.http.post(
        `${rutaCaja(deA.id, '/egresos')}?academiaId=${e.B.id}&cajaId=${cajaAbiertaB.id}`,
        cookies.secretaria,
        cuerpoEgreso(),
      );

      expect([201, 400], respuesta.texto).toContain(respuesta.status);
      expect(await estadoDeB()).toEqual(antesB);
    });
  });

  describe('la caja abierta de B no cuenta en A', () => {
    it('criterio 8: con una caja abierta en B, abrir la de A responde 201 (la de B sigue abierta y sin cambios)', async () => {
      const antesB = await estadoDeB();

      const respuesta = await ctx.http.post(
        '/api/cajas',
        cookies.secretaria,
        cuerpoApertura({ montoInicial: '10.00' }),
      );

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(cajaDe(respuesta).montoInicial).toBe('10.00');
      expect(await estadoDeB()).toEqual(antesB);
    });

    it('criterio 8: cerrar la caja de A no cierra la de B, aunque las dos sean de la misma fecha', async () => {
      const deA = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
      const antesB = await estadoDeB();

      const respuesta = await ctx.http.post(
        rutaCaja(deA.id, '/cierre'),
        cookies.secretaria,
        cuerpoCierre({ montoDeclarado: '100.00' }),
      );

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(await estadoDeB()).toEqual(antesB);
      expect((await leerCajas(e.B.id)).filter((caja) => caja.estado === 'ABIERTA')).toHaveLength(1);
    });
  });
});
