// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerMovimientos, retenerCaja, retenerUsuarios } from '../../utilidades/caja';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoAjuste,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  rutaAjuste,
  rutaCancelar,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  subirFotoValida,
} from '../../utilidades/inscripciones-005b';
import {
  conRetencion,
  cuerpoInscripcion,
  type RespuestaApi,
  retenerClases,
  rutaPublica,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';
import type { Retenedor } from '../../utilidades/planes-clases';

// Criterio 19 (crítico; «Orden de bloqueos con la caja» de la 006; criterio 26 de 006): un cobro en efectivo que corre a la vez que un egreso, un cierre de la caja, la cancelación de la
// misma solicitud (005b), la subida de su foto (005b), un envío del formulario con el mismo DNI (005), un ajuste del monto y otro cobro de otra solicitud de la misma clase, termina
// sin `40P01` ni 500: cada operación responde su éxito o su 409. Orden de bloqueos: `usuarios` (actor) → bloqueo consultivo del DNI → `alumnos` → `solicitudes_inscripcion` → `matriculas` →
// `pagos` → `clases` → la caja, al final. Pruebas deterministas: la prueba retiene una fila que las dos operaciones necesitan, las envía (en los dos órdenes), comprueba que esperan y
// recién entonces libera, para que se crucen siempre.

interface Par {
  nombre: string;
  /** Lo que retiene la prueba para que las dos operaciones queden esperando. */
  retener: (c: SolicitudSembrada) => (retenedor: Retenedor) => Promise<void>;
  /** La otra operación (la primera es siempre el cobro de `c` por la secretaria). */
  otra: (c: SolicitudSembrada) => Promise<RespuestaApi>;
  /** Las respuestas posibles del cobro y de la otra operación (en cualquier orden de entrada). */
  validar: (cobro: RespuestaApi, otra: RespuestaApi) => void;
}

describe('el cobro en efectivo contra otras operaciones a la vez: sin interbloqueos (criterio 19)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;
  let cajaId: string;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen();
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
    cajaId = (await abrirCajaDeHoy(e)).id;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const cobrar = (c: SolicitudSembrada, montoMostrado = '42.00') =>
    ctx.http.post(rutaCobro(c.solicitudId), cuerpoCobro(montoMostrado), { cookie: cookies.secretaria });
  const sinError500 = (r: RespuestaApi) => {
    expect(r.status, r.texto).toBeLessThan(500);
    expect(r.texto).not.toMatch(/40P01|deadlock|interbloqueo/i);
  };
  const o = (r: RespuestaApi) => [r.status, codigoDeRespuesta(r)];

  const PARES: Par[] = [
    {
      nombre: 'un egreso de la misma caja',
      retener: () => retenerCaja(e.A.id, cajaId),
      otra: () =>
        ctx.http.post(
          `/api/cajas/${cajaId}/egresos`,
          { claveIdempotencia: randomUUID(), descripcion: 'Compra de útiles de limpieza', monto: '10.00' },
          { cookie: cookies.admin },
        ),
      validar: (cobro, egreso) => {
        expect(cobro.status, cobro.texto).toBe(201);
        expect(egreso.status, egreso.texto).toBe(201);
      },
    },
    {
      nombre: 'el cierre de la misma caja',
      retener: () => retenerCaja(e.A.id, cajaId),
      otra: () =>
        ctx.http.post(
          `/api/cajas/${cajaId}/cierre`,
          {
            claveIdempotencia: randomUUID(),
            montoDeclarado: '100.00',
            ultimoMovimientoVisto: 0,
            observacion: 'Conteo de la prueba',
          },
          { cookie: cookies.admin },
        ),
      validar: (cobro, cierre) => {
        const cobroPrimero = cobro.status === 201 && cierre.status === 409;
        const cierrePrimero = cierre.status === 200 && o(cobro).join() === '409,SIN_CAJA_ABIERTA';
        expect(cobroPrimero || cierrePrimero, `cobro ${cobro.texto} cierre ${cierre.texto}`).toBe(true);
      },
    },
    {
      nombre: 'la cancelación de la misma solicitud',
      retener: () => retenerClases([e.lunes.id], e.A.id),
      otra: (c) =>
        ctx.http.post(
          rutaCancelar(c.solicitudId),
          { motivo: 'Pidió que la cancelen por teléfono' },
          { cookie: cookies.admin },
        ),
      validar: (cobro, cancelar) => {
        const cobroPrimero = cobro.status === 201 && o(cancelar).join() === '409,SOLICITUD_NO_CANCELABLE';
        const cancelarPrimero = cancelar.status === 200 && o(cobro).join() === '409,SOLICITUD_NO_COBRABLE';
        expect(cobroPrimero || cancelarPrimero, `cobro ${cobro.texto} cancelar ${cancelar.texto}`).toBe(true);
      },
    },
    {
      nombre: 'la subida de la foto de la misma solicitud',
      retener: () => retenerClases([e.lunes.id], e.A.id),
      otra: (c) => subirFotoValida(ctx, 'academia-a', c.token),
      validar: (cobro, foto) => {
        expect(cobro.status, cobro.texto).toBe(201);
        const fotoPrimero = foto.status === 204;
        const cobroPrimero = o(foto).join() === '409,SOLICITUD_NO_EDITABLE';
        expect(fotoPrimero || cobroPrimero, `foto ${foto.texto}`).toBe(true);
      },
    },
    {
      nombre: 'un envío del formulario con el mismo DNI',
      retener: () => retenerClases([e.lunes.id], e.A.id),
      otra: async (c) =>
        ctx.http.post(
          rutaPublica('academia-a', '/inscripcion'),
          await cuerpoInscripcion(e, { sobre: { alumno: { dni: c.dni } } }),
        ),
      validar: (cobro, envio) => {
        expect(cobro.status, cobro.texto).toBe(201);
        expect(o(envio).join(), envio.texto).toBe('409,DNI_YA_REGISTRADO');
      },
    },
    {
      nombre: 'un ajuste del monto de la misma solicitud',
      retener: () => retenerClases([e.lunes.id], e.A.id),
      otra: (c) => ctx.http.post(rutaAjuste(c.solicitudId), cuerpoAjuste('35'), { cookie: cookies.admin }),
      validar: (cobro, ajuste) => {
        const cobroPrimero = cobro.status === 201 && o(ajuste).join() === '409,SOLICITUD_NO_AJUSTABLE';
        const ajustePrimero = ajuste.status === 200 && o(cobro).join() === '409,MONTO_CAMBIO';
        expect(cobroPrimero || ajustePrimero, `cobro ${cobro.texto} ajuste ${ajuste.texto}`).toBe(true);
      },
    },
  ];

  describe.each([
    ['el cobro primero', false],
    ['la otra operación primero', true],
  ])('%s', (_orden, alReves) => {
    it.each(PARES.map((par) => [par.nombre, par] as const))(
      'criterio 19: un cobro y %s a la vez: sin 40P01 ni 500',
      async (_nombre, par) => {
        const cliente = await sembrarCobrable(e);
        const operaciones = [() => cobrar(cliente), () => par.otra(cliente)];
        if (alReves) operaciones.reverse();

        const { resultados, todasEsperaron } = await conRetencion({
          academiaId: e.A.id,
          retener: par.retener(cliente),
          enviar: operaciones,
          enOrden: true,
          liberar: 'COMMIT',
        });

        // Con el cobro primero, la otra operación espera (directa o transitivamente) lo que retuvo la prueba. En el orden inverso, una operación que
        // no necesita lo retenido (el ajuste, la foto) puede terminar antes de que llegue el cobro: lo que se exige es que no haya interbloqueo.
        if (!alReves)
          expect(todasEsperaron, 'las dos operaciones debían quedar esperando lo que retuvo la prueba').toBe(true);
        const [cobro, otra] = (alReves ? [...resultados].reverse() : resultados) as [RespuestaApi, RespuestaApi];
        sinError500(cobro);
        sinError500(otra);
        par.validar(cobro, otra);
        expect((await leerPagos(e.A.id)).length).toBeLessThanOrEqual(1);
        expect((await leerMovimientos(e.A.id)).filter((m) => m.tipo === 'INGRESO')).toHaveLength(
          (await leerPagos(e.A.id)).length,
        );
      },
    );
  });

  it('criterio 19: dos cobros de solicitudes distintas de la misma clase, a la vez: los dos 201, con los tickets 1 y 2 y sin 40P01', async () => {
    const uno = await sembrarCobrable(e);
    const dos = await sembrarCobrable(e);

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerClases([e.lunes.id], e.A.id),
      enviar: [
        () => cobrar(uno),
        () => ctx.http.post(rutaCobro(dos.solicitudId), cuerpoCobro('42.00'), { cookie: cookies.admin }),
      ],
      liberar: 'COMMIT',
    });

    expect(todasEsperaron).toBe(true);
    for (const r of resultados) {
      sinError500(r);
      expect(r.status, r.texto).toBe(201);
    }
    expect((await leerPagos(e.A.id)).map((p) => p.numero_ticket).sort()).toEqual([1, 2]);
    expect(await leerMovimientos(e.A.id)).toHaveLength(2);
  });

  it('criterio 19: cuatro cobros de cuatro solicitudes de la misma clase y un egreso, todos a la vez desde la liberación de los usuarios: sin 40P01 ni 500 y cada ingreso entra una sola vez', async () => {
    const clientes = [
      await sembrarCobrable(e),
      await sembrarCobrable(e),
      await sembrarCobrable(e),
      await sembrarCobrable(e),
    ];
    const actores = [e.secretariaA.id, e.secretariaA2.id, e.adminA.id, e.adminA2.id];
    const cookie = [cookies.secretaria, cookies.secretaria2, cookies.admin, cookies.admin2];

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerUsuarios(e.A.id, actores),
      enviar: [
        ...clientes.map(
          (c, i) => () => ctx.http.post(rutaCobro(c.solicitudId), cuerpoCobro('42.00'), { cookie: cookie[i] }),
        ),
        () =>
          ctx.http.post(
            `/api/cajas/${cajaId}/egresos`,
            { claveIdempotencia: randomUUID(), descripcion: 'Compra de útiles de limpieza', monto: '10.00' },
            { cookie: cookies.admin },
          ),
      ],
      liberar: 'COMMIT',
    });

    expect(todasEsperaron).toBe(true);
    for (const r of resultados) sinError500(r);
    expect(
      resultados.every((r) => r.status === 201),
      JSON.stringify(resultados.map((r) => r.status)),
    ).toBe(true);
    expect((await leerPagos(e.A.id)).map((p) => p.numero_ticket).sort()).toEqual([1, 2, 3, 4]);
    expect((await leerMovimientos(e.A.id)).filter((m) => m.tipo === 'INGRESO')).toHaveLength(4);
  });
});
