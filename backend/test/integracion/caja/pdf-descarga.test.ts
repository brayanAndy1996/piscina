// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  enLima,
  type EscenarioCaja,
  HOY,
  instantaneaDeCaja,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  crearAppHistorial,
  dispositionDelPdf,
  exigirGeneradorInyectable,
  exigirRutasDeHistorial,
  GeneradorDePrueba,
  PDF_FALSO,
  reabrirCajaDePrueba,
  rutaPdf,
} from '../../utilidades/caja-historial';
import { tieneFormaDePdf } from '../../utilidades/pdf';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 42, PQ6, PQ7 y PQ15 (crítico el alcance y el 404; HU-27: "se genera un PDF del cierre"; D-10).
// PQ6: tiene PDF cualquier cierre de una caja que se puede ver: el vigente y los reabiertos, aunque la caja esté abierta otra vez. Una caja que nunca se cerró
//   no tiene ninguno (404). El `numero` vale solo si cumple ^[1-9][0-9]{0,4}$ y es como mucho 32767 (smallint); si no, 404 sin consultar la base. Responden
//   404: 0, -1, 01, +1, 1.0, 1e0, " 1" (%201), 32768, 99999999999999999999, uno, y un número válido que no es de un cierre de esa caja. Nunca 500.
// PQ7: 200 con `Content-Type` exactamente application/pdf (sin charset), `Content-Disposition` exactamente attachment; filename="cierre-caja-<fecha de la
//   caja>-<numero>.pdf" (el número sin ceros a la izquierda; el nombre no lleva ningún texto de un usuario), `Cache-Control: no-store` y `Content-Length` igual
//   al tamaño del cuerpo. El cuerpo empieza con %PDF- y termina con %%EOF (con o sin salto de línea final). Las respuestas de error son el JSON de error de
//   siempre, con `Cache-Control: no-store` y sin `Content-Disposition`.
// PQ15: PATCH, PUT, DELETE y POST sobre /api/cajas/{id}, y cualquier método que no sea GET sobre /api/cajas/{id}/cierres/{numero}/pdf, siguen respondiendo
//   404 sin tocar nada.

describe('la descarga del PDF de un cierre (criterio 42, PQ6, PQ7)', () => {
  const generador = new GeneradorDePrueba();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  /** K: la caja del 2 de noviembre, cerrada por la secretaria (cierre 1, reabierto) y por el ADMIN (cierre 2, vigente). */
  let k: { id: string };
  /** R: la caja de hoy con su cierre 1 reabierto: está ABIERTA otra vez. */
  let r: { id: string };

  beforeAll(async () => {
    ctx = await crearAppHistorial(AHORA_PRUEBAS, generador);
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    generador.restablecer();
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    const alumno = await crearAlumnoDeCaja(e.A.id);
    k = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-02', monto_inicial: '100.00' });
    await crearIngresoDePrueba(e.A.id, k.id, e.secretariaA.id, alumno.id, {
      monto: '42.00',
      registrado_en: enLima('2026-11-02', '10:00'),
    });
    await cerrarCajaDePrueba(e.A.id, k.id, e.secretariaA.id, {
      montoDeclarado: '140.00',
      cerradoEn: enLima('2026-11-02', '18:00:00'),
    });
    await reabrirCajaDePrueba(e.A.id, k.id, 1, e.adminA.id, enLima('2026-11-02', '19:00:00'));
    await cerrarCajaDePrueba(e.A.id, k.id, e.adminA.id, { cerradoEn: enLima('2026-11-02', '20:00:00') });
    r = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '20.00' });
    await cerrarCajaDePrueba(e.A.id, r.id, e.secretariaA.id, { cerradoEn: enLima(HOY, '09:40:00') });
    await reabrirCajaDePrueba(e.A.id, r.id, 1, e.adminA.id, enLima(HOY, '09:45:00'));
  });
  afterEach(() => {
    generador.cancelarRetenido();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const pdf = (id: string, numero: number | string, cookie = cookies.admin) =>
    ctx.http.get(rutaPdf(id, numero), cookie);

  describe('cabeceras y cuerpo (PQ7)', () => {
    it.each([
      [1, 'real'],
      [2, 'real'],
      [1, 'falso'],
      [2, 'falso'],
    ] as const)(
      'PQ7: el cierre %s con el generador %s responde 200 con application/pdf, el nombre del archivo, no-store y Content-Length',
      async (numero, modo) => {
        generador.modo = modo;

        const respuesta = await pdf(k.id, numero);

        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
        expect(respuesta.headers.get('content-type')).toBe('application/pdf');
        expect(respuesta.headers.get('content-disposition')).toBe(dispositionDelPdf('2026-11-02', numero));
        expect(respuesta.cacheControl).toBe('no-store');
        expect(respuesta.headers.get('content-length')).toBe(String(respuesta.cuerpo.length));
        expect(respuesta.cuerpo.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(tieneFormaDePdf(respuesta.cuerpo), 'el cuerpo termina con %%EOF').toBe(true);
        expect(generador.llamadas).toHaveLength(1);
      },
    );

    it('PQ7: con el generador falso, el cuerpo es exactamente lo que devolvió el generador (sin cambios ni relleno)', async () => {
      const respuesta = await pdf(k.id, 2);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cuerpo.equals(PDF_FALSO)).toBe(true);
    });

    it('PQ7: el número del archivo no lleva ceros a la izquierda y la fecha es la de la caja, no la de hoy ni la del cierre', async () => {
      const deHoy = await pdf(r.id, 1);
      const antigua = await pdf(k.id, 1);

      expect(deHoy.headers.get('content-disposition')).toBe(dispositionDelPdf(HOY, 1));
      expect(antigua.headers.get('content-disposition')).toBe(dispositionDelPdf('2026-11-02', 1));
    });

    it('PQ7: el nombre del archivo no lleva ningún texto de un usuario: una observación con comillas y saltos de línea no cambia las cabeceras', async () => {
      const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-03', estado: 'CERRADA' });
      await cerrarCajaDePrueba(e.A.id, caja.id, e.adminA.id, {
        montoDeclarado: '90.00',
        observacion: 'Falta "sencillo"\r\nX-Inyectada: 1\r\n\r\n%PDF-',
        cerradoEn: enLima('2026-11-03', '18:00:00'),
      });

      const respuesta = await pdf(caja.id, 1);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.headers.get('content-disposition')).toBe(dispositionDelPdf('2026-11-03', 1));
      expect(respuesta.headers.get('x-inyectada')).toBeNull();
    });

    it('PQ1: un UUID en mayúsculas es la misma caja: 200 con el mismo nombre de archivo', async () => {
      const respuesta = await ctx.http.get(rutaPdf(k.id.toUpperCase(), 2), cookies.admin);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.headers.get('content-disposition')).toBe(dispositionDelPdf('2026-11-02', 2));
    });
  });

  describe('qué cierres tienen PDF (PQ6)', () => {
    it('PQ6: tienen PDF el cierre vigente (2) y el reabierto (1) de una caja cerrada', async () => {
      for (const numero of [1, 2]) {
        const respuesta = await pdf(k.id, numero);

        expect(respuesta.status, `cierre ${numero}: ${respuesta.texto}`).toBe(200);
      }
    });

    it('PQ6: tiene PDF el cierre reabierto de una caja que está abierta otra vez', async () => {
      const respuesta = await pdf(r.id, 1);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.headers.get('content-disposition')).toBe(dispositionDelPdf(HOY, 1));
    });

    it('PQ6: una caja que nunca se cerró no tiene PDF: 404, no 500', async () => {
      const nunca = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-04', estado: 'CERRADA' });

      for (const numero of [1, 2]) {
        const respuesta = await pdf(nunca.id, numero);

        expect(respuesta.status, `${numero}: ${respuesta.texto}`).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
      }
      expect(generador.llamadas).toHaveLength(0);
    });

    it.each([
      ['cero', '0'],
      ['negativo', '-1'],
      ['con cero a la izquierda', '01'],
      ['con cero a la izquierda y varios dígitos', '0002'],
      ['con signo más', '+1'],
      ['decimal', '1.0'],
      ['notación científica', '1e0'],
      ['con un espacio delante', '%201'],
      ['con un espacio detrás', '1%20'],
      ['en hexadecimal', '0x1'],
      ['mayor que smallint', '32768'],
      ['de cinco dígitos fuera de rango', '99999'],
      ['gigante', '99999999999999999999'],
      ['texto', 'uno'],
      ['con coma', '1,0'],
      ['con unicode', '%EF%BC%91'],
      ['un número válido que no es de un cierre de esa caja', '3'],
      ['el máximo de smallint, que no existe', '32767'],
    ])(
      'PQ6: el número %s (%s) responde el mismo 404 que una caja inexistente, sin Content-Disposition y sin generar nada',
      async (_nombre, numero) => {
        const inexistente = await pdf(randomUUID(), 1);

        const respuesta = await pdf(k.id, numero);

        expect(respuesta.status, respuesta.texto).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
        expect(respuesta.cacheControl).toBe('no-store');
        expect(respuesta.headers.get('content-disposition')).toBeNull();
        expect(respuesta.headers.get('content-type') ?? '').not.toContain('application/pdf');
        expect(respuesta.body).toEqual(inexistente.body);
        expect(generador.llamadas).toHaveLength(0);
      },
    );
  });

  describe('las respuestas de error son el JSON de siempre (PQ7)', () => {
    it('PQ7: 404 de una caja que no existe y de un id que no es UUID: JSON, no-store y sin Content-Disposition', async () => {
      for (const id of [randomUUID(), 'no-es-un-uuid']) {
        const respuesta = await pdf(id, 1);

        expect(respuesta.status).toBe(404);
        expect(respuesta.headers.get('content-type') ?? '').toContain('application/json');
        expect(respuesta.cacheControl).toBe('no-store');
        expect(respuesta.headers.get('content-disposition')).toBeNull();
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
      }
    });

    it('PQ7: 401 sin sesión y 403 sin permiso: JSON, no-store y sin Content-Disposition', async () => {
      const sinSesion = await ctx.http.get(rutaPdf(k.id, 1));
      const sinPermiso = await pdf(k.id, 1, cookies.entrenador);

      for (const respuesta of [sinSesion, sinPermiso]) {
        expect(respuesta.headers.get('content-type') ?? '').toContain('application/json');
        expect(respuesta.cacheControl).toBe('no-store');
        expect(respuesta.headers.get('content-disposition')).toBeNull();
      }
      expect(sinSesion.status).toBe(401);
      expect(sinPermiso.status).toBe(403);
    });
  });
});

describe('las rutas de edición y borrado siguen sin existir (criterio 23, PQ15)', () => {
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let caja: { id: string };

  beforeAll(async () => {
    ctx = await crearAppHistorial();
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
    await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, { cerradoEn: enLima(HOY, '09:50') });
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const estado = async () => ({
    filas: await instantaneaDeCaja(e.A.id),
    auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
  });

  it('control: con las rutas de lectura registradas, GET /api/cajas/{id} y el PDF responden (así los 404 de abajo son de los métodos y no de que falte la ruta)', () => {
    exigirRutasDeHistorial(ctx.app);
  });

  it.each(['PATCH', 'PUT', 'DELETE', 'POST'])(
    'PQ15: %s sobre /api/cajas/{id} responde 404 y no toca nada, con cuerpo vacío, con un cuerpo y con un id que no existe',
    async (metodo) => {
      const antes = await estado();

      for (const direccion of [`/api/cajas/${caja.id}`, `/api/cajas/${randomUUID()}`, '/api/cajas/no-es-un-uuid']) {
        for (const cuerpo of [
          undefined,
          {},
          { montoInicial: '1.00', estado: 'ABIERTA', motivo: 'Se cerró por error' },
        ]) {
          const respuesta = await ctx.http.enviar(metodo, direccion, cookies.admin, cuerpo);

          expect(respuesta.status, `${metodo} ${direccion} ${JSON.stringify(cuerpo)}: ${respuesta.texto}`).toBe(404);
        }
      }
      expect(await estado()).toEqual(antes);
    },
  );

  it.each(['PATCH', 'PUT', 'DELETE', 'POST'])(
    'PQ15: %s sobre /api/cajas/{id}/cierres/{numero}/pdf responde 404 y no toca nada',
    async (metodo) => {
      const antes = await estado();

      for (const direccion of [rutaPdf(caja.id, 1), rutaPdf(caja.id, 2), rutaPdf(randomUUID(), 1)]) {
        for (const cuerpo of [undefined, {}]) {
          const respuesta = await ctx.http.enviar(metodo, direccion, cookies.admin, cuerpo);

          expect(respuesta.status, `${metodo} ${direccion}: ${respuesta.texto}`).toBe(404);
        }
      }
      expect(await estado()).toEqual(antes);
    },
  );

  it.each(['PATCH', 'PUT', 'DELETE'])(
    'PQ15: %s sobre /api/cajas (la lista) responde 404 y no toca nada',
    async (metodo) => {
      const antes = await estado();

      const respuesta = await ctx.http.enviar(metodo, '/api/cajas', cookies.admin, {});

      expect(respuesta.status, respuesta.texto).toBe(404);
      expect(await estado()).toEqual(antes);
    },
  );

  it.each([
    ['GET', (id: string) => `/api/cajas/${id}/cierres`],
    ['GET', (id: string) => `/api/cajas/${id}/cierres/1`],
    ['DELETE', (id: string) => `/api/cajas/${id}/cierres/1`],
    ['PATCH', (id: string) => `/api/cajas/${id}/cierres/1`],
    ['GET', (id: string) => `/api/cajas/${id}/movimientos`],
    ['DELETE', (id: string) => `/api/cajas/${id}/egresos/${randomUUID()}`],
    ['PATCH', (id: string) => `/api/cajas/${id}/egresos/${randomUUID()}`],
    ['DELETE', () => `/api/movimientos-caja/${randomUUID()}`],
  ])(
    'PQ15: %s %#: las rutas de cierres, movimientos y egresos que no son del contrato responden 404',
    async (metodo, ruta) => {
      const antes = await estado();

      const respuesta = await ctx.http.enviar(metodo, ruta(caja.id), cookies.admin);

      expect(respuesta.status, respuesta.texto).toBe(404);
      expect(await estado()).toEqual(antes);
    },
  );
});
