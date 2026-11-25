// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  type EscenarioPagos,
  exigirRutasDePagos,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  comprobanteDe,
  exigirRutasDe007b,
  instantaneaConArchivos,
  normalizadoDeReferencia,
  rutaAprobacion,
  sembrarEnVerificacion,
  sembrarRechazada,
} from '../../utilidades/escenario-pagos-007b';
import { sembrarSolicitud } from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  archivosBajo,
  crearAppConAlmacen,
  exigirAlmacen,
} from '../../utilidades/inscripciones-005b';
import { filaPagoValida, insertarPago, leerPagos } from '../../utilidades/pagos';

// Criterio 39 (crítico, HU-08, D-07, sección 8.4; DR-9; «el mismo número de operación con espacios, ceros o mayúsculas distintas» de `CLAUDE.md`): con un pago abierto (`PENDIENTE_VERIFICACION` o `CONFIRMADO`) de la academia con el
// número normalizado N y el mismo método, una subida con un número que se normaliza a N responde 409 `NUMERO_OPERACION_YA_USADO` sin escribir. Pruebas con `12345`, ` 12 345 `, `00012345`, `0001-2345`, `1.2345`, `１２３４５` y,
// para letras, `ab12` frente a `AB12`. Un número de un pago `RECHAZADO` se puede volver a usar (D-07); el de otra academia no cuenta; el del otro método (Yape frente a transferencia) tampoco (DR-9). Dos subidas simultáneas con el
// mismo número para solicitudes distintas: exactamente una responde 201 y la otra 409 `NUMERO_OPERACION_YA_USADO` (el código sale del nombre del índice violado, nunca 500).

const FORMAS_DE_12345 = ['12345', ' 12 345 ', '00012345', '0001-2345', '1.2345', '１２３４５', '12/345', '12_345'];

describe('subida del comprobante: el número de operación sin duplicados (criterio 39)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ ahora: AHORA_007 });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const snapshot = () => instantaneaConArchivos(ctx, e);
  const subir = (cliente: { token: string }, datos: Record<string, unknown> = {}) => comprobanteDe(ctx, cliente, datos);

  describe('el mismo número escrito de otra forma choca con el pago abierto (409 NUMERO_OPERACION_YA_USADO)', () => {
    it.each(FORMAS_DE_12345)(
      'criterio 39: con "12345" ya en revisión, subir %j responde 409 y no escribe',
      async (forma) => {
        await sembrarEnVerificacion(e, { numeroOperacion: '12345' });
        const nuevo = await sembrarCobrable(e);
        const antes = await snapshot();

        const respuesta = await subir(nuevo, { numeroOperacion: forma });

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
          409,
          'NUMERO_OPERACION_YA_USADO',
        ]);
        expect(respuesta.cacheControl).toBe('no-store');
        expect(await snapshot()).toBe(antes);
      },
    );

    it.each(FORMAS_DE_12345)(
      'criterio 39: con %j ya en revisión, subir "12345" responde 409 (el normalizado es el que cuenta)',
      async (forma) => {
        const existente = await sembrarEnVerificacion(e, { numeroOperacion: forma });
        expect(normalizadoDeReferencia(existente.numeroOperacion)).toBe('12345');
        const nuevo = await sembrarCobrable(e);

        const respuesta = await subir(nuevo, { numeroOperacion: '12345' });

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
          409,
          'NUMERO_OPERACION_YA_USADO',
        ]);
      },
    );

    it.each([
      ['ab12', 'AB12'],
      ['AB12', 'ab12'],
      ['Ab-12', 'aB 12'],
      ['a.b/1_2', 'AB12'],
      ['００ab12', 'AB12'],
    ])(
      'criterio 39: con %j en revisión, subir %j (mayúsculas y minúsculas, separadores, ceros y ancho completo) responde 409',
      async (existente, nuevoNumero) => {
        await sembrarEnVerificacion(e, { numeroOperacion: existente });
        const nuevo = await sembrarCobrable(e);

        const respuesta = await subir(nuevo, { numeroOperacion: nuevoNumero });

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
          409,
          'NUMERO_OPERACION_YA_USADO',
        ]);
      },
    );

    it('criterio 39: un número distinto después de normalizar no choca ("12345" frente a "12346", "0012" frente a "120", "AB12" frente a "BA12")', async () => {
      await sembrarEnVerificacion(e, { numeroOperacion: '12345' });
      await sembrarEnVerificacion(e, { numeroOperacion: '0012' });
      await sembrarEnVerificacion(e, { numeroOperacion: 'AB12' });

      for (const numeroOperacion of ['12346', '120', 'BA12']) {
        const nuevo = await sembrarCobrable(e);
        const respuesta = await subir(nuevo, { numeroOperacion });
        expect(respuesta.status, `${numeroOperacion}: ${respuesta.texto}`).toBe(201);
      }
    });

    it('criterio 39: también choca con un pago ya CONFIRMADO (aprobado) con ese número', async () => {
      await abrirCajaDeHoy(e);
      const aprobado = await sembrarEnVerificacion(e, { numeroOperacion: '12345' });
      const aprobacion = await ctx.http.post(rutaAprobacion(aprobado.pagoId), {}, { cookie: cookies.secretaria });
      expect(aprobacion.status, aprobacion.texto).toBe(200);
      const nuevo = await sembrarCobrable(e);
      const antes = await snapshot();

      const respuesta = await subir(nuevo, { numeroOperacion: '0001-2345' });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
        409,
        'NUMERO_OPERACION_YA_USADO',
      ]);
      expect(await snapshot()).toBe(antes);
    });
  });

  describe('lo que no cuenta como duplicado', () => {
    it('criterio 39 y DR-9: el mismo número en una transferencia y en un Yape no choca (el método es parte de la clave)', async () => {
      await sembrarEnVerificacion(e, { numeroOperacion: '12345', metodo: 'YAPE' });
      const nuevo = await sembrarCobrable(e);

      const respuesta = await subir(nuevo, { numeroOperacion: '0001-2345', metodo: 'TRANSFERENCIA' });

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect((await leerPagos(e.A.id)).map((p) => [p.metodo, p.numero_operacion_normalizado]).sort()).toEqual([
        ['TRANSFERENCIA', '12345'],
        ['YAPE', '12345'],
      ]);
    });

    it('criterio 39 y DR-9: una transferencia en revisión tampoco bloquea el mismo número en un Yape', async () => {
      await sembrarEnVerificacion(e, { numeroOperacion: '12345', metodo: 'TRANSFERENCIA' });
      const nuevo = await sembrarCobrable(e);

      const respuesta = await subir(nuevo, { numeroOperacion: '12345', metodo: 'YAPE' });

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 39 y D-07: el número de un pago RECHAZADO se puede volver a usar, en otra solicitud o en la misma', async () => {
      const rechazada = await sembrarRechazada(e, { numeroOperacion: '12345' });
      const otra = await sembrarCobrable(e);

      const enOtra = await subir(otra, { numeroOperacion: ' 00012 345 ' });
      const enLaMisma = await subir(rechazada, { numeroOperacion: '12345' });

      expect(enOtra.status, enOtra.texto).toBe(201);
      // La otra solicitud ya tiene ese número en revisión: el de la rechazada, ahora, sí choca con el pago abierto.
      expect([enLaMisma.status, codigoDeRespuesta(enLaMisma)], enLaMisma.texto).toEqual([
        409,
        'NUMERO_OPERACION_YA_USADO',
      ]);
    });

    it('criterio 39: el número de otra academia no cuenta (la unicidad es por academia, D-23)', async () => {
      const deB = await sembrarSolicitud(e.B.id, {
        planId: e.planB.id,
        claseIds: [e.lunesB.id],
        clasesTotales: 5,
        clasesPorMesPlan: 12,
        precioPlan: '100.00',
        monto: '42.00',
        reservaVenceEn: null,
      });
      await insertarPago(
        'propietario',
        e.B.id,
        filaPagoValida(
          e.B.id,
          { alumnoId: deB.alumnoId, matriculaId: deB.matriculaId },
          { metodo: 'YAPE' },
          { numero_operacion: '12345', numero_operacion_normalizado: '12345' },
        ),
      );
      const nuevo = await sembrarCobrable(e);

      const respuesta = await subir(nuevo, { numeroOperacion: '12345' });

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 39: un número ya usado no deja ni pago, ni archivo, ni auditoría, y el siguiente intento con otro número sí se acepta', async () => {
      await sembrarEnVerificacion(e, { numeroOperacion: '12345' });
      const nuevo = await sembrarCobrable(e);
      const archivosAntes = archivosBajo(ctx.raiz);
      const auditoriaAntes = await leerAuditoriaDeAcademia(e.A.id);

      const repetido = await subir(nuevo, { numeroOperacion: '12345' });

      expect(repetido.status).toBe(409);
      expect(archivosBajo(ctx.raiz)).toEqual(archivosAntes);
      expect(await leerAuditoriaDeAcademia(e.A.id)).toEqual(auditoriaAntes);
      const libre = await subir(nuevo, { numeroOperacion: '12346' });
      expect(libre.status, libre.texto).toBe(201);
    });
  });

  describe('subidas simultáneas', () => {
    it.each([
      ['el mismo texto', '77001', '77001'],
      ['la misma cifra con ceros y separadores', '77002', '0007-7002'],
      ['las mismas letras en mayúscula y minúscula', 'XY77003', 'xy-77003'],
    ])(
      'criterio 39: dos subidas simultáneas de solicitudes distintas con %s: exactamente una 201 y la otra 409 NUMERO_OPERACION_YA_USADO, un solo pago y un solo archivo',
      async (_nombre, uno, otro) => {
        const a = await sembrarCobrable(e);
        const b = await sembrarCobrable(e);

        const respuestas = await Promise.all([subir(a, { numeroOperacion: uno }), subir(b, { numeroOperacion: otro })]);

        const estados = respuestas.map((r) => `${r.status} ${codigoDeRespuesta(r) ?? ''}`.trim()).sort();
        expect(estados, respuestas.map((r) => r.texto).join(' | ')).toEqual(['201', '409 NUMERO_OPERACION_YA_USADO']);
        const pagos = await leerPagos(e.A.id);
        expect(pagos).toHaveLength(1);
        expect(archivosBajo(ctx.raiz)).toEqual([pagos[0]?.comprobante_clave]);
        expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_COMPROBANTE_REGISTRADO')).toHaveLength(1);
      },
    );

    it('criterio 39: cinco subidas simultáneas con el mismo número y solicitudes distintas dejan exactamente un pago y cuatro 409, sin 500', async () => {
      const clientes = [
        await sembrarCobrable(e),
        await sembrarCobrable(e),
        await sembrarCobrable(e),
        await sembrarCobrable(e),
        await sembrarCobrable(e),
      ];

      const respuestas = await Promise.all(clientes.map((c) => subir(c, { numeroOperacion: '88001' })));

      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
      const otros = respuestas.filter((r) => r.status !== 201);
      expect(otros.map((r) => [r.status, codigoDeRespuesta(r)])).toEqual(
        Array.from({ length: 4 }, () => [409, 'NUMERO_OPERACION_YA_USADO']),
      );
      expect(await leerPagos(e.A.id)).toHaveLength(1);
      expect(archivosBajo(ctx.raiz)).toHaveLength(1);
    });
  });
});
