// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  exigirRutasDe007b,
  guardarComprobanteSembrado,
  instantaneaConArchivos,
  pagosPendientesDe,
  pedirBinario,
  RUTA_PENDIENTES,
  rutaAprobacion,
  rutaComprobante,
  sembrarEnVerificacion,
  sembrarRechazada,
} from '../../utilidades/escenario-pagos-007b';
import {
  conRetencion,
  leerApoderados,
  type RespuestaApi,
  sembrarSolicitud,
  sinUuid,
} from '../../utilidades/inscripciones';
import { pedir } from '../../utilidades/inscripciones-ronda1';
import {
  AlmacenDeFallosDePrueba,
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  jpeg,
  sembrarEnMasa,
} from '../../utilidades/inscripciones-005b';
import { crearPagoConfirmadoConMovimiento, filaPagoValida, insertarPago, T_PAGO } from '../../utilidades/pagos';

// Criterio 45 (crítico, HU-09, RN-21, D-23): `GET /api/pagos/pendientes` (`VERIFICAR_PAGOS`) responde 200 con `{ pagos }`: los pagos `PENDIENTE_VERIFICACION` de la academia, del más antiguo al más nuevo, como mucho 200, cada uno
// (`pagoPendienteSchema`, estricto) con `id`, `metodo`, `monto`, `numeroOperacion` (el escrito), `fechaOperacion`, `enviadoEn`, `solicitud` (`id` y `codigo`), `cliente` (`nombres`, `apellidos`, `dni`), `mes` de la matrícula y
// `mesTerminado` (si «hoy» ya no es de ese mes, criterio 52). Sin datos médicos, apoderado, token ni la clave del archivo. No bloquea, no escribe y no audita.
// Criterio 46 (crítico, HU-09, D-23; DT-9 de 006): `GET /api/pagos/{id}/comprobante` (`VERIFICAR_PAGOS`) responde 200 con la imagen guardada (`Content-Type: image/jpeg`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
// `Content-Disposition: inline`), para un pago Yape o transferencia en cualquier estado. Un pago en efectivo, inexistente, de otra academia o con un id inválido responde 404 `NO_ENCONTRADO`. `HEAD` sobre `/api/pagos` y lo que
// cuelga de ella responde 404 para cualquier rol, sin llamar al servicio ni al almacén. Si el archivo falta en el almacén, 500 sin datos del archivo. No audita.

const CLAVES_DEL_PAGO_PENDIENTE = [
  'cliente',
  'enviadoEn',
  'fechaOperacion',
  'id',
  'mes',
  'mesTerminado',
  'metodo',
  'monto',
  'numeroOperacion',
  'solicitud',
];

describe('la bandeja de verificación y el comprobante (criterios 45 y 46)', () => {
  let ctx: AppConAlmacen;
  let fallos: AlmacenDeFallosDePrueba;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({
      ahora: AHORA_007,
      envolver: (real) => {
        fallos = new AlmacenDeFallosDePrueba(real);
        return fallos;
      },
    });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    fallos.llamadas.length = 0;
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const snapshot = () => instantaneaConArchivos(ctx, e);
  const bandeja = (cookie = cookies.secretaria): Promise<RespuestaApi> => ctx.http.get(RUTA_PENDIENTES, { cookie });
  const minutos = (n: number) => new Date(T_PAGO.getTime() + n * 60 * 1000);

  async function pendienteDeB(numero = '12345') {
    const solicitud = await sembrarSolicitud(e.B.id, {
      planId: e.planB.id,
      claseIds: [e.lunesB.id],
      clasesTotales: 5,
      clasesPorMesPlan: 12,
      precioPlan: '100.00',
      monto: '42.00',
      reservaVenceEn: null,
    });
    const fila = filaPagoValida(
      e.B.id,
      { alumnoId: solicitud.alumnoId, matriculaId: solicitud.matriculaId },
      { metodo: 'YAPE' },
      { numero_operacion: numero, numero_operacion_normalizado: numero },
    );
    await insertarPago('propietario', e.B.id, fila);
    return { ...solicitud, pagoId: fila['id'] as string, comprobanteClave: fila['comprobante_clave'] as string };
  }

  describe('criterio 45: la bandeja', () => {
    it('criterio 45: sin pagos pendientes responde 200 con { pagos: [] } y Cache-Control: no-store', async () => {
      const respuesta = await bandeja();

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(respuesta.body).toEqual({ pagos: [] });
    });

    it('criterio 45: cada pago pendiente trae exactamente id, método, monto, número escrito, fecha, enviadoEn, solicitud { id, codigo }, cliente { nombres, apellidos, dni }, mes y mesTerminado', async () => {
      const cliente = await sembrarEnVerificacion(e, {
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        numeroOperacion: '00012 345',
        fechaOperacion: '2026-11-10',
        registradoEn: minutos(0),
      });

      const respuesta = await bandeja();

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(Object.keys(respuesta.body ?? {})).toEqual(['pagos']);
      const [pago] = pagosPendientesDe(respuesta);
      expect(Object.keys(pago ?? {}).sort()).toEqual(CLAVES_DEL_PAGO_PENDIENTE);
      expect(pago).toEqual({
        id: cliente.pagoId,
        metodo: 'YAPE',
        monto: '42.00',
        numeroOperacion: '00012 345',
        fechaOperacion: '2026-11-10',
        enviadoEn: minutos(0).toISOString(),
        solicitud: { id: cliente.solicitudId, codigo: cliente.codigo },
        cliente: { nombres: 'Valeria', apellidos: 'Mendoza Salas', dni: cliente.dni },
        mes: '2026-11',
        mesTerminado: false,
      });
    });

    it('criterio 45: del más antiguo al más nuevo; solo los PENDIENTE_VERIFICACION de la academia (no los confirmados, los rechazados, los de B ni los efectivos)', async () => {
      const tercero = await sembrarEnVerificacion(e, { registradoEn: minutos(30), metodo: 'TRANSFERENCIA' });
      const primero = await sembrarEnVerificacion(e, { registradoEn: minutos(0) });
      const segundo = await sembrarEnVerificacion(e, { registradoEn: minutos(10) });
      await sembrarRechazada(e, { registradoEn: minutos(5) });
      const caja = await abrirCajaDeHoy(e);
      const cobrada = await sembrarCobrable(e);
      await crearPagoConfirmadoConMovimiento(e.A.id, {
        cajaId: caja.id,
        alumnoId: cobrada.alumnoId,
        usuarioId: e.secretariaA.id,
        metodo: 'YAPE',
        numeroTicket: 1,
      });
      await pendienteDeB();

      const respuesta = await bandeja();

      expect(pagosPendientesDe(respuesta).map((p) => p.id)).toEqual([primero.pagoId, segundo.pagoId, tercero.pagoId]);
      expect(pagosPendientesDe(respuesta).map((p) => p.metodo)).toEqual(['YAPE', 'YAPE', 'TRANSFERENCIA']);
    });

    it('criterio 45: a igual instante de envío el orden es estable y todos aparecen (ninguno se pierde ni se repite)', async () => {
      const iguales = [
        await sembrarEnVerificacion(e, { registradoEn: minutos(0) }),
        await sembrarEnVerificacion(e, { registradoEn: minutos(0) }),
        await sembrarEnVerificacion(e, { registradoEn: minutos(0) }),
      ];

      const uno = pagosPendientesDe(await bandeja()).map((p) => p.id);
      const dos = pagosPendientesDe(await bandeja()).map((p) => p.id);

      expect([...uno].sort()).toEqual(iguales.map((c) => c.pagoId).sort());
      expect(dos).toEqual(uno);
    });

    it('criterio 45: la bandeja de A no muestra los pagos de B y la de B no muestra los de A', async () => {
      const deA = await sembrarEnVerificacion(e);
      const deB = await pendienteDeB();

      const enA = pagosPendientesDe(await bandeja());
      const enB = pagosPendientesDe(await bandeja(cookies.secretariaB));

      expect(enA.map((p) => p.id)).toEqual([deA.pagoId]);
      expect(enB.map((p) => p.id)).toEqual([deB.pagoId]);
    });

    it('criterio 45: el administrador y la secretaria ven lo mismo', async () => {
      await sembrarEnVerificacion(e);

      const delAdmin = await bandeja(cookies.admin);
      const delaSecretaria = await bandeja(cookies.secretaria);

      expect(delAdmin.status).toBe(200);
      expect(delAdmin.texto).toBe(delaSecretaria.texto);
    });

    it('criterio 45: sin datos médicos, apoderado, token ni la clave del archivo (ni el número normalizado ni la IP)', async () => {
      const cliente = await sembrarEnVerificacion(e, { conApoderado: true, fechaNacimiento: '2014-03-10' });
      const [apoderado] = await leerApoderados(e.A.id);

      const respuesta = await bandeja();

      expect(
        pagosPendientesDe(respuesta).map((p) => p.id),
        'la bandeja trae el pago',
      ).toEqual([cliente.pagoId]);
      const texto = respuesta.texto;
      for (const prohibido of [
        cliente.token,
        cliente.comprobanteClave,
        'academias/',
        'comprobante-',
        'token',
        'apoderado',
        'ficha',
        'tipoSangre',
        'alergias',
        'enfermedades',
        'medicamentos',
        'contactoEmergencia',
        apoderado?.dni ?? 'sin-apoderado',
        apoderado?.nombres ?? 'sin-apoderado',
        '203.0.113.7',
        'Normalizado',
      ]) {
        expect(texto, `la bandeja lleva ${prohibido}`).not.toContain(prohibido);
      }
    });

    it('criterio 45: no escribe, no audita y no bloquea: con las filas del pago y de la matrícula retenidas por otra transacción responde 200 sin esperar', async () => {
      const cliente = await sembrarEnVerificacion(e);
      const antes = await snapshot();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar('SELECT id FROM pagos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
            e.A.id,
            cliente.pagoId,
          ]);
          await retenedor.consultar(
            'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [e.A.id, cliente.matriculaId],
          );
        },
        enviar: [() => bandeja()],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'la bandeja esperó un bloqueo: bloquea filas').toBe(false);
      expect(resultados[0]?.status, resultados[0]?.texto).toBe(200);
      expect(await snapshot()).toBe(antes);
      expect(await leerAuditoriaDeAcademia(e.A.id)).toEqual([]);
    });

    it('criterio 45: trae como mucho 200 pagos, los 200 más antiguos', async () => {
      const claseId = e.lunes.id;
      const solicitudes = await sembrarEnMasa(e.A.id, {
        planId: e.plan.id,
        claseId,
        cantidad: 201,
        estado: 'PENDIENTE_PAGO',
        base: T_PAGO,
        reservaVenceEn: new Date(AHORA_007.getTime() + 24 * 60 * 60 * 1000),
      });
      await ejecutarComo(
        'propietario',
        `UPDATE matriculas SET reserva_vence_en = NULL WHERE academia_id = $1::uuid AND solicitud_id = ANY($2::uuid[])`,
        [e.A.id, solicitudes],
        { academiaId: e.A.id },
      );
      await ejecutarComo(
        'propietario',
        `WITH p AS (
           SELECT gen_random_uuid() AS id, m.alumno_id, m.id AS matricula_id, m.creado_en,
                  row_number() OVER (ORDER BY m.creado_en, m.id) AS n
             FROM matriculas m WHERE m.academia_id = $1::uuid AND m.solicitud_id = ANY($2::uuid[]))
         INSERT INTO pagos (id, academia_id, alumno_id, matricula_id, concepto, metodo, estado, monto, numero_operacion,
                            numero_operacion_normalizado, fecha_operacion, comprobante_clave, ip_origen, registrado_por, verificado_por,
                            registrado_en, verificado_en, motivo_rechazo, numero_ticket, clave_idempotencia, creado_en, actualizado_en)
         SELECT p.id, $1::uuid, p.alumno_id, p.matricula_id, 'INSCRIPCION'::concepto_movimiento_caja, 'YAPE'::metodo_pago,
                'PENDIENTE_VERIFICACION'::estado_pago, 120.00, (100000 + p.n)::text, (100000 + p.n)::text, DATE '2026-11-10',
                'academias/' || $1::text || '/pagos/' || p.id::text || '/comprobante-' || gen_random_uuid()::text || '.jpg',
                '203.0.113.7'::inet, NULL, NULL, p.creado_en, NULL, NULL, NULL, gen_random_uuid(), p.creado_en, p.creado_en
           FROM p`,
        [e.A.id, solicitudes],
        { academiaId: e.A.id },
      );

      const respuesta = await bandeja();

      const pagos = pagosPendientesDe(respuesta);
      expect(pagos).toHaveLength(200);
      expect(pagos[0]?.numeroOperacion).toBe('100001');
      expect(pagos[199]?.numeroOperacion).toBe('100200');
      expect(pagos.map((p) => p.numeroOperacion)).not.toContain('100201');
    }, 60_000);
  });

  describe('criterio 45 y 52: mesTerminado', () => {
    it('criterio 45 y 52: mesTerminado es false hasta el último milisegundo del mes de la matrícula y true desde las 00:00 de Lima del mes siguiente; un pago de diciembre sigue en false', async () => {
      const deNoviembre = await sembrarEnVerificacion(e);
      const deDiciembre = await sembrarEnVerificacion(e, { mes: { anio: 2026, mes: 12 } });
      const consultarEn = async (instante: string) => {
        const ahora = new Date(instante);
        ctx.reloj.fijar(ahora);
        const respuesta = await bandeja(cookiesDePagos(e, ahora).secretaria);
        expect(respuesta.status, `${instante}: ${respuesta.texto}`).toBe(200);
        const pagos = pagosPendientesDe(respuesta);
        return {
          noviembre: pagos.find((p) => p.id === deNoviembre.pagoId),
          diciembre: pagos.find((p) => p.id === deDiciembre.pagoId),
        };
      };

      const alFinal = await consultarEn('2026-12-01T04:59:59.999Z');
      const alComenzar = await consultarEn('2026-12-01T05:00:00.000Z');

      expect([alFinal.noviembre?.mes, alFinal.noviembre?.mesTerminado]).toEqual(['2026-11', false]);
      expect([alFinal.diciembre?.mes, alFinal.diciembre?.mesTerminado]).toEqual(['2026-12', false]);
      expect([alComenzar.noviembre?.mes, alComenzar.noviembre?.mesTerminado]).toEqual(['2026-11', true]);
      expect([alComenzar.diciembre?.mes, alComenzar.diciembre?.mesTerminado]).toEqual(['2026-12', false]);
    });

    it('criterio 45 y 52: con el proceso en otra zona horaria el mes sigue siendo el de Lima (23:59 del 30 de noviembre en Lima ya es 1 de diciembre en UTC)', async () => {
      const cliente = await sembrarEnVerificacion(e);
      const ahora = new Date('2026-12-01T04:30:00.000Z');
      ctx.reloj.fijar(ahora);

      const respuesta = await bandeja(cookiesDePagos(e, ahora).secretaria);

      expect(pagosPendientesDe(respuesta).find((p) => p.id === cliente.pagoId)?.mesTerminado).toBe(false);
    });
  });

  describe('criterio 46: ver el comprobante', () => {
    it.each([
      ['pendiente', 'PENDIENTE_VERIFICACION'],
      ['aprobado', 'CONFIRMADO'],
      ['rechazado', 'RECHAZADO'],
    ] as const)(
      'criterio 46: el comprobante de un pago %s responde 200 con la imagen guardada y las cabeceras de seguridad',
      async (_nombre, estado) => {
        const cliente = await sembrarEnVerificacion(e);
        const imagen = await guardarComprobanteSembrado(ctx, e.A.id, cliente.comprobanteClave, await jpeg(300, 200));
        if (estado === 'CONFIRMADO') {
          await abrirCajaDeHoy(e);
          const aprobacion = await ctx.http.post(rutaAprobacion(cliente.pagoId), {}, { cookie: cookies.secretaria });
          expect(aprobacion.status, aprobacion.texto).toBe(200);
        }
        if (estado === 'RECHAZADO') {
          const rechazo = await ctx.http.post(
            `/api/pagos/${cliente.pagoId}/rechazo`,
            { motivo: 'La imagen no se lee' },
            { cookie: cookies.secretaria },
          );
          expect(rechazo.status, rechazo.texto).toBe(200);
        }
        const antes = await snapshot();

        const respuesta = await pedirBinario(ctx, 'GET', rutaComprobante(cliente.pagoId), cookies.secretaria);

        expect(respuesta.status).toBe(200);
        expect(respuesta.headers.get('content-type')).toBe('image/jpeg');
        expect(respuesta.headers.get('cache-control')).toBe('no-store');
        expect(respuesta.headers.get('x-content-type-options')).toBe('nosniff');
        expect(respuesta.headers.get('content-disposition')).toMatch(/^inline/);
        expect(respuesta.cuerpo.equals(imagen), 'el cuerpo no es la imagen guardada').toBe(true);
        expect(await snapshot(), 'ver el comprobante no escribe ni audita').toBe(antes);
      },
    );

    it('criterio 46: también se ve el de una transferencia y lo ve el administrador', async () => {
      const cliente = await sembrarEnVerificacion(e, { metodo: 'TRANSFERENCIA' });
      const imagen = await guardarComprobanteSembrado(ctx, e.A.id, cliente.comprobanteClave);

      const respuesta = await pedirBinario(ctx, 'GET', rutaComprobante(cliente.pagoId), cookies.admin);

      expect(respuesta.status).toBe(200);
      expect(respuesta.cuerpo.equals(imagen)).toBe(true);
    });

    it('criterio 46: lee el archivo de su academia y de su pago: una sola lectura con la clave del pago', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await guardarComprobanteSembrado(ctx, e.A.id, cliente.comprobanteClave);
      fallos.llamadas.length = 0;

      await pedirBinario(ctx, 'GET', rutaComprobante(cliente.pagoId), cookies.secretaria);

      expect(fallos.llamadas).toEqual([{ operacion: 'leer', academiaId: e.A.id, clave: cliente.comprobanteClave }]);
    });

    it('criterio 46: un pago en efectivo, uno inexistente, uno de otra academia y un id inválido responden el mismo 404 NO_ENCONTRADO, sin leer ningún archivo', async () => {
      await abrirCajaDeHoy(e);
      const propio = await sembrarEnVerificacion(e);
      await guardarComprobanteSembrado(ctx, e.A.id, propio.comprobanteClave);
      const delPropio = await pedirBinario(ctx, 'GET', rutaComprobante(propio.pagoId), cookies.secretaria);
      expect(delPropio.status, 'el comprobante de su propia academia sí se ve').toBe(200);
      const cobrada = await sembrarCobrable(e);
      const cobro = await ctx.http.post(rutaCobro(cobrada.solicitudId), cuerpoCobro('42.00'), {
        cookie: cookies.secretaria,
      });
      expect(cobro.status, cobro.texto).toBe(201);
      const pagoEfectivo = String((cobro.body?.['pago'] as { id: string }).id);
      const ajeno = await pendienteDeB();
      await guardarComprobanteSembrado(ctx, e.B.id, ajeno.comprobanteClave);
      fallos.llamadas.length = 0;
      const antes = await snapshot();

      const respuestas = await Promise.all(
        [pagoEfectivo, randomUUID(), ajeno.pagoId, 'no-es-un-uuid', '123', `${randomUUID()}x`].map((id) =>
          ctx.http.get(rutaComprobante(id), { cookie: cookies.secretaria }),
        ),
      );

      for (const respuesta of respuestas) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([404, 'NO_ENCONTRADO']);
        expect(respuesta.cacheControl).toBe('no-store');
      }
      expect(new Set(respuestas.map((r) => sinUuid(r.texto))).size, 'el mismo cuerpo para todos').toBe(1);
      expect(fallos.llamadas, 'un 404 no lee ningún archivo').toEqual([]);
      expect(await snapshot()).toBe(antes);
    });

    it('criterio 46: con ?academiaId=<B> o una cabecera de academia, el pago de B sigue siendo un 404 para la sesión de A', async () => {
      const ajeno = await pendienteDeB();
      await guardarComprobanteSembrado(ctx, e.B.id, ajeno.comprobanteClave);

      const conConsulta = await ctx.http.get(`${rutaComprobante(ajeno.pagoId)}?academiaId=${e.B.id}`, {
        cookie: cookies.secretaria,
      });
      const conCabecera = await ctx.http.get(rutaComprobante(ajeno.pagoId), {
        cookie: cookies.secretaria,
        headers: { 'x-academia-id': e.B.id },
      });
      const deB = await pedirBinario(ctx, 'GET', rutaComprobante(ajeno.pagoId), cookies.secretariaB);

      expect(conConsulta.status).toBe(404);
      expect(conCabecera.status).toBe(404);
      expect(deB.status, 'la secretaria de B sí lo ve').toBe(200);
    });

    it('criterio 46: si el archivo falta en el almacén responde 500 sin datos del archivo (ni la clave, ni la ruta, ni el motivo del sistema de archivos) y no audita', async () => {
      const cliente = await sembrarEnVerificacion(e);
      const antes = await snapshot();

      const respuesta = await ctx.http.get(rutaComprobante(cliente.pagoId), { cookie: cookies.secretaria });

      expect(respuesta.status, respuesta.texto).toBe(500);
      for (const prohibido of [
        cliente.comprobanteClave,
        'academias/',
        'comprobante-',
        ctx.raiz,
        'ENOENT',
        'no such file',
      ]) {
        expect(respuesta.texto, `el 500 lleva ${prohibido}`).not.toContain(prohibido);
      }
      expect(await snapshot()).toBe(antes);
    });
  });

  describe('criterio 46: HEAD no existe en /api/pagos ni en lo que cuelga de ella (DT-9 de 006, DT-15)', () => {
    const ROLES = ['admin', 'secretaria', 'entrenador', 'alumno'] as const;

    function direcciones(pagoId: string, pagoDeB: string): string[] {
      return [
        '/api/pagos',
        '/api/pagos/',
        '/api/pagos/pendientes',
        '/api/pagos/pendientes?x=1',
        `/api/pagos/pendientes?academiaId=${pagoDeB}`,
        `/api/pagos/${pagoId}/comprobante`,
        `/api/pagos/${pagoId}/comprobante/`,
        `/api/pagos/${pagoId}/comprobante?x=1`,
        `/api/pagos/${pagoDeB}/comprobante`,
        `/api/pagos/${randomUUID()}/comprobante`,
        '/api/pagos/no-es-un-uuid/comprobante',
        `/api/pagos/${pagoId}/ticket`,
        `/api/pagos/${pagoId}/aprobacion`,
        `/api/pagos/${pagoId}/rechazo`,
        `/api/Pagos/pendientes`,
        `/api/PAGOS/${pagoId.toUpperCase()}/COMPROBANTE/`,
      ];
    }

    it.each(ROLES)(
      'criterio 46: HEAD con la sesión de %s responde 404 con el JSON de error de siempre, sin cuerpo, sin leer el almacén y sin escribir ni auditar',
      async (rol) => {
        const cliente = await sembrarEnVerificacion(e);
        await guardarComprobanteSembrado(ctx, e.A.id, cliente.comprobanteClave);
        const ajeno = await pendienteDeB();
        fallos.llamadas.length = 0;
        const antes = await snapshot();
        const problemas: string[] = [];

        for (const direccion of direcciones(cliente.pagoId, ajeno.pagoId)) {
          const r = await pedir(ctx, 'HEAD', direccion, { headers: { cookie: cookies[rol] } });
          if (r.status !== 404) problemas.push(`HEAD ${direccion}: respondió ${r.status} y no 404`);
          if (!(r.headers.get('content-type') ?? '').includes('application/json'))
            problemas.push(`HEAD ${direccion}: Content-Type ${String(r.headers.get('content-type'))}`);
          if (r.cacheControl !== 'no-store')
            problemas.push(`HEAD ${direccion}: Cache-Control ${String(r.cacheControl)}`);
          if (r.headers.get('content-disposition') !== null)
            problemas.push(`HEAD ${direccion}: trae Content-Disposition`);
          if (r.texto.length !== 0) problemas.push(`HEAD ${direccion}: trae cuerpo`);
        }

        expect(problemas.join('\n')).toBe('');
        expect(fallos.llamadas, 'un HEAD no llama al almacén').toEqual([]);
        expect(await snapshot()).toBe(antes);
      },
    );

    it('criterio 46: el 404 de HEAD es el mismo que el de PATCH sobre la misma dirección; sin sesión, HEAD responde lo mismo que PATCH (401)', async () => {
      const cliente = await sembrarEnVerificacion(e);

      for (const direccion of [`/api/pagos/${cliente.pagoId}/comprobante`, '/api/pagos/pendientes', '/api/pagos']) {
        const delHead = await pedir(ctx, 'HEAD', direccion, { headers: { cookie: cookies.admin } });
        const delPatch = await pedir(ctx, 'PATCH', direccion, { headers: { cookie: cookies.admin }, cuerpo: {} });
        expect(delPatch.status, `PATCH ${direccion}`).toBe(404);
        expect(delHead.status, `HEAD ${direccion}`).toBe(delPatch.status);
        expect(delHead.headers.get('content-type'), `HEAD ${direccion}`).toBe(delPatch.headers.get('content-type'));

        const sinSesionHead = await pedir(ctx, 'HEAD', direccion);
        const sinSesionPatch = await pedir(ctx, 'PATCH', direccion, { cuerpo: {} });
        expect(sinSesionHead.status, `sin sesión HEAD ${direccion}`).toBe(sinSesionPatch.status);
        expect(sinSesionHead.status).toBe(401);
      }
    });

    it('criterio 46: el GET de las rutas no cambia (control): la bandeja y el comprobante responden 200 a la secretaria y 403 SIN_PERMISO al entrenador', async () => {
      const cliente = await sembrarEnVerificacion(e);
      await guardarComprobanteSembrado(ctx, e.A.id, cliente.comprobanteClave);

      expect((await ctx.http.get(RUTA_PENDIENTES, { cookie: cookies.secretaria })).status).toBe(200);
      expect((await pedirBinario(ctx, 'GET', rutaComprobante(cliente.pagoId), cookies.secretaria)).status).toBe(200);
      for (const ruta of [RUTA_PENDIENTES, rutaComprobante(cliente.pagoId)]) {
        const respuesta = await ctx.http.get(ruta, { cookie: cookies.entrenador });
        expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([403, 'SIN_PERMISO']);
      }
    });
  });
});
