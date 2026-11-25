// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  instantaneaDeLaAcademia,
  pagoDe,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  consultarPorCodigo,
  consultarPorToken,
  exigirRutasDe007b,
  rutaAprobacion,
  sembrarEnVerificacion,
  sembrarRechazada,
  vistaDeRespuesta,
} from '../../utilidades/escenario-pagos-007b';
import { actualizarFilas, cuerpoInscripcion, type Objeto, type RespuestaApi } from '../../utilidades/inscripciones';
import { type AppConAlmacen, crearAppConAlmacen, exigirAlmacen } from '../../utilidades/inscripciones-005b';
import { contarAuditoria } from '../../utilidades/usuarios';
import { filaPagoValida, insertarPago, T_PAGO } from '../../utilidades/pagos';

// Criterio 28, partes [007b] (crítico, D-05, DR-9 y DR-14 de 005, RNF-05): la vista de seguimiento suma, con las claves de la vista completa de 005 salvo `reservaVenceEn`: `EN_VERIFICACION` con `fotoCargada` y `pago: { metodo, monto, fechaOperacion,
// enviadoEn }`; `PAGO_RECHAZADO` con `fotoCargada`, `rechazo: { motivo, rechazadoEn }` y `pagableHasta` (el fin del mes de la matrícula en Lima, ISO). Ninguna lleva DNI, apellidos, número de operación, comprobante, quién verificó, ids internos ni el
// hash del token. La regla de DR-14 de 005 sigue: el nombre solo va en la solicitud vigente del cliente; una `VENCIDA` o `CANCELADA` muestra la vista reducida. Pruebas por token y por código con DNI, con el mismo cuerpo.
// Notas para la 007b (plan, «Notas para la 007b», revisión de la 007a): ninguna vista debe mostrar un método, una fecha o un ticket inventados (si falta el pago, error del servidor y no un valor por defecto); la vista `CONFIRMADA` muestra el método, el
// monto y el ticket del pago `CONFIRMADO`, aunque la matrícula tenga un pago `RECHAZADO` con un `registrado_en` posterior (relojes distintos entre instancias); el «último pago» queda para lo que depende del intento más reciente.

const CLAVES_EN_VERIFICACION = [
  'clases',
  'clasesTotales',
  'codigo',
  'creadaEn',
  'esProporcional',
  'estado',
  'fotoCargada',
  'mes',
  'monto',
  'nombres',
  'pago',
  'plan',
];
const CLAVES_PAGO_RECHAZADO = [
  'clases',
  'clasesTotales',
  'codigo',
  'creadaEn',
  'esProporcional',
  'estado',
  'fotoCargada',
  'mes',
  'monto',
  'nombres',
  'pagableHasta',
  'plan',
  'rechazo',
];
const CLAVES_CONFIRMADA = [
  'clases',
  'clasesTotales',
  'codigo',
  'creadaEn',
  'esProporcional',
  'estado',
  'mes',
  'monto',
  'nombres',
  'pago',
  'plan',
];
const HORA = 60 * 60 * 1000;

describe('seguimiento de una solicitud con un comprobante en revisión, rechazado o confirmado (criterio 28, partes de la 007b)', () => {
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
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const vista = (respuesta: Pick<RespuestaApi, 'body' | 'status'>): Objeto => vistaDeRespuesta(respuesta);
  const prohibidos = (c: {
    dni: string;
    token: string;
    pagoId: string;
    alumnoId: string;
    solicitudId: string;
    matriculaId: string;
  }) => [
    c.dni,
    'Mendoza',
    'Salas',
    c.token,
    c.pagoId,
    c.alumnoId,
    c.solicitudId,
    c.matriculaId,
    e.secretariaA.id,
    e.secretariaA.nombres,
    'numeroOperacion',
    'comprobante',
    'verificadoPor',
    'tokenHash',
    'reservaVenceEn',
    'apoderado',
    'fichaMedica',
  ];

  describe('EN_VERIFICACION', () => {
    it('criterio 28: por token responde 200 con las claves de la vista completa sin reservaVenceEn, con fotoCargada y el pago { metodo, monto, fechaOperacion, enviadoEn }', async () => {
      const cliente = await sembrarEnVerificacion(e, { numeroOperacion: '9087654321', fechaOperacion: '2026-11-10' });

      const respuesta = await consultarPorToken(ctx, cliente.token);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['academia', 'solicitud']);
      expect(Object.keys(vista(respuesta)).sort()).toEqual(CLAVES_EN_VERIFICACION);
      expect(vista(respuesta)).toMatchObject({
        codigo: cliente.codigo,
        estado: 'EN_VERIFICACION',
        nombres: 'Valeria',
        mes: '2026-11',
        clasesTotales: 5,
        monto: '42.00',
        esProporcional: true,
        fotoCargada: false,
        pago: { metodo: 'YAPE', monto: '42.00', fechaOperacion: '2026-11-10', enviadoEn: T_PAGO.toISOString() },
      });
      expect(Object.keys(vista(respuesta)['pago'] as object).sort()).toEqual([
        'enviadoEn',
        'fechaOperacion',
        'metodo',
        'monto',
      ]);
      for (const prohibido of [...prohibidos(cliente), '9087654321']) {
        expect(respuesta.texto, `la vista lleva ${prohibido}`).not.toContain(prohibido);
      }
    });

    it('criterio 28: por código y DNI responde exactamente lo mismo que por token (el mismo cuerpo)', async () => {
      const cliente = await sembrarEnVerificacion(e);

      const porToken = await consultarPorToken(ctx, cliente.token);
      const porCodigo = await consultarPorCodigo(ctx, cliente.codigo.toLowerCase(), ` ${cliente.dni} `);

      expect(porCodigo.status, porCodigo.texto).toBe(200);
      expect(porCodigo.texto).toBe(porToken.texto);
      expect(vista(porToken)['estado']).toBe('EN_VERIFICACION');
    });

    it('criterio 28: una transferencia en revisión muestra su método; y con la foto cargada muestra fotoCargada: true', async () => {
      const cliente = await sembrarEnVerificacion(e, { metodo: 'TRANSFERENCIA' });
      await ejecutarComo(
        'propietario',
        'UPDATE alumnos SET foto_clave = $3 WHERE academia_id = $1::uuid AND id = $2::uuid',
        [
          e.A.id,
          cliente.alumnoId,
          `academias/${e.A.id}/alumnos/${cliente.alumnoId}/foto-00000000-0000-4000-8000-000000000001.jpg`,
        ],
        { academiaId: e.A.id },
      );

      const respuesta = await consultarPorToken(ctx, cliente.token);

      expect(vista(respuesta)).toMatchObject({
        estado: 'EN_VERIFICACION',
        fotoCargada: true,
        pago: { metodo: 'TRANSFERENCIA' },
      });
    });

    it('criterio 28 y notas de la 007b: si la matrícula tiene un pago RECHAZADO con un registrado_en posterior al del pago pendiente, la vista muestra el método, la fecha y el envío del pago pendiente y no los del rechazado', async () => {
      const cliente = await sembrarEnVerificacion(e, { fechaOperacion: '2026-11-10', registradoEn: T_PAGO });
      await insertarPago(
        'propietario',
        e.A.id,
        filaPagoValida(
          e.A.id,
          { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId, usuarioId: e.secretariaA.id },
          { metodo: 'TRANSFERENCIA', estado: 'RECHAZADO' },
          {
            fecha_operacion: '2026-11-05',
            registrado_en: new Date(T_PAGO.getTime() + 2 * HORA),
            verificado_en: new Date(T_PAGO.getTime() + 3 * HORA),
            creado_en: new Date(T_PAGO.getTime() + 2 * HORA),
            actualizado_en: new Date(T_PAGO.getTime() + 2 * HORA),
          },
        ),
      );

      const respuesta = await consultarPorToken(ctx, cliente.token);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(vista(respuesta)).toMatchObject({
        estado: 'EN_VERIFICACION',
        pago: { metodo: 'YAPE', fechaOperacion: '2026-11-10', enviadoEn: T_PAGO.toISOString(), monto: '42.00' },
      });
    });

    it('criterio 28: la consulta es de solo lectura (no escribe ni audita) y se puede repetir', async () => {
      const cliente = await sembrarEnVerificacion(e);
      const antes = { academia: await instantaneaDeLaAcademia(e.A.id), auditoria: await contarAuditoria(e.A.id) };

      const uno = await consultarPorToken(ctx, cliente.token);
      const dos = await consultarPorToken(ctx, cliente.token);

      expect(uno.texto).toBe(dos.texto);
      expect({ academia: await instantaneaDeLaAcademia(e.A.id), auditoria: await contarAuditoria(e.A.id) }).toEqual(
        antes,
      );
    });

    it('criterio 28 y 31 de 005: el token de A en la dirección de B y un código con el DNI equivocado responden el mismo 404 de siempre', async () => {
      const cliente = await sembrarEnVerificacion(e);

      const deB = await consultarPorToken(ctx, cliente.token, 'academia-b');
      const otroDni = await consultarPorCodigo(ctx, cliente.codigo, '11112222');

      for (const respuesta of [deB, otroDni]) {
        expect([respuesta.status, respuesta.body?.['codigo']], respuesta.texto).toEqual([
          404,
          'SOLICITUD_NO_ENCONTRADA',
        ]);
      }
    });
  });

  describe('PAGO_RECHAZADO', () => {
    it('criterio 28: por token responde 200 con las claves de la vista completa sin reservaVenceEn, con fotoCargada, rechazo { motivo, rechazadoEn } y pagableHasta (el fin del mes en Lima)', async () => {
      const cliente = await sembrarRechazada(e, { motivo: 'La imagen no se lee', numeroOperacion: '9087654321' });

      const respuesta = await consultarPorToken(ctx, cliente.token);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(Object.keys(vista(respuesta)).sort()).toEqual(CLAVES_PAGO_RECHAZADO);
      expect(vista(respuesta)).toMatchObject({
        codigo: cliente.codigo,
        estado: 'PAGO_RECHAZADO',
        nombres: 'Valeria',
        mes: '2026-11',
        monto: '42.00',
        fotoCargada: false,
        rechazo: {
          motivo: 'La imagen no se lee',
          rechazadoEn: new Date(T_PAGO.getTime() + 15 * 60 * 1000).toISOString(),
        },
        pagableHasta: '2026-12-01T04:59:59.999Z',
      });
      expect(Object.keys(vista(respuesta)['rechazo'] as object).sort()).toEqual(['motivo', 'rechazadoEn']);
      for (const prohibido of [...prohibidos(cliente), '9087654321']) {
        expect(respuesta.texto, `la vista lleva ${prohibido}`).not.toContain(prohibido);
      }
    });

    it('criterio 28: por código y DNI responde exactamente lo mismo que por token', async () => {
      const cliente = await sembrarRechazada(e);

      const porToken = await consultarPorToken(ctx, cliente.token);
      const porCodigo = await consultarPorCodigo(ctx, cliente.codigo, cliente.dni);

      expect(porCodigo.status, porCodigo.texto).toBe(200);
      expect(porCodigo.texto).toBe(porToken.texto);
    });

    it('criterio 28: con dos pagos rechazados el motivo es el del último (por registrado_en; a igual instante, el de mayor id)', async () => {
      const cliente = await sembrarRechazada(e, { motivo: 'Primer rechazo', registradoEn: T_PAGO });
      await insertarPago(
        'propietario',
        e.A.id,
        filaPagoValida(
          e.A.id,
          { alumnoId: cliente.alumnoId, matriculaId: cliente.matriculaId, usuarioId: e.secretariaA.id },
          { metodo: 'YAPE', estado: 'RECHAZADO' },
          {
            motivo_rechazo: 'Segundo rechazo',
            registrado_en: new Date(T_PAGO.getTime() + HORA),
            verificado_en: new Date(T_PAGO.getTime() + 2 * HORA),
          },
        ),
      );
      const empatado = await sembrarRechazada(e, {
        motivo: 'Empate, id menor',
        registradoEn: T_PAGO,
        sobrePago: { id: '00000000-0000-4000-8000-0000000000aa' },
      });
      await insertarPago(
        'propietario',
        e.A.id,
        filaPagoValida(
          e.A.id,
          { alumnoId: empatado.alumnoId, matriculaId: empatado.matriculaId, usuarioId: e.secretariaA.id },
          { metodo: 'YAPE', estado: 'RECHAZADO' },
          { id: '00000000-0000-4000-8000-0000000000bb', motivo_rechazo: 'Empate, id mayor' },
        ),
      );

      const delPrimero = await consultarPorToken(ctx, cliente.token);
      const delEmpate = await consultarPorToken(ctx, empatado.token);

      expect((vista(delPrimero)['rechazo'] as Objeto)['motivo']).toBe('Segundo rechazo');
      expect((vista(delEmpate)['rechazo'] as Objeto)['motivo']).toBe('Empate, id mayor');
    });

    it('criterio 28 y DR-14 de 005: pasado el fin del mes la solicitud ya es VENCIDA y muestra la vista reducida (sin nombre, sin rechazo, sin pago)', async () => {
      const cliente = await sembrarRechazada(e);
      ctx.reloj.fijar(new Date('2026-12-01T05:00:00.000Z'));

      const respuesta = await consultarPorToken(ctx, cliente.token);

      expect(vista(respuesta)['estado']).toBe('VENCIDA');
      expect(Object.keys(vista(respuesta)).sort()).toEqual(
        ['clases', 'clasesTotales', 'codigo', 'creadaEn', 'esProporcional', 'estado', 'mes', 'monto', 'plan'].sort(),
      );
      expect(respuesta.texto).not.toContain('Valeria');
      expect(respuesta.texto).not.toContain('rechazo');
      expect(respuesta.texto).not.toContain('pagableHasta');
    });

    it('criterio 28: el último milisegundo del mes todavía es PAGO_RECHAZADO', async () => {
      const cliente = await sembrarRechazada(e);
      ctx.reloj.fijar(new Date('2026-12-01T04:59:59.999Z'));

      const respuesta = await consultarPorToken(ctx, cliente.token);

      expect(vista(respuesta)['estado']).toBe('PAGO_RECHAZADO');
    });

    it('criterio 28 y DR-14 de 005: el cliente que volvió a inscribirse (con su solicitud rechazada) ve su solicitud anterior como VENCIDA, con la vista reducida, y la nueva con su nombre', async () => {
      const cliente = await sembrarRechazada(e);
      const nueva = await ctx.http.post(
        '/api/a/academia-a/inscripcion',
        // El envío de la 005 con el DNI del cliente rechazado (criterio 32).
        await cuerpoInscripcion(e, { sobre: { alumno: { dni: cliente.dni } } }),
      );
      expect(nueva.status, nueva.texto).toBe(201);

      const anterior = await consultarPorToken(ctx, cliente.token);

      expect(vista(anterior)['estado']).toBe('VENCIDA');
      expect(anterior.texto).not.toContain('Valeria');
    });
  });

  describe('CONFIRMADA con un comprobante aprobado', () => {
    it('criterio 28: la vista CONFIRMADA de una transferencia aprobada muestra su método, monto, cuándo se confirmó y el ticket', async () => {
      exigirRutasDe007b(ctx.app);
      await abrirCajaDeHoy(e);
      const cliente = await sembrarEnVerificacion(e, { metodo: 'TRANSFERENCIA' });
      const aprobacion = await ctx.http.post(rutaAprobacion(cliente.pagoId), {}, { cookie: cookies.secretaria });
      expect(aprobacion.status, aprobacion.texto).toBe(200);

      const respuesta = await consultarPorToken(ctx, cliente.token);

      expect(Object.keys(vista(respuesta)).sort()).toEqual(CLAVES_CONFIRMADA);
      expect(vista(respuesta)).toMatchObject({
        estado: 'CONFIRMADA',
        pago: { metodo: 'TRANSFERENCIA', monto: '42.00', confirmadoEn: AHORA_007.toISOString(), numeroTicket: 1 },
      });
      expect(Object.keys(vista(respuesta)['pago'] as object).sort()).toEqual([
        'confirmadoEn',
        'metodo',
        'monto',
        'numeroTicket',
      ]);
      for (const prohibido of prohibidos(cliente)) {
        expect(respuesta.texto, `la vista lleva ${prohibido}`).not.toContain(prohibido);
      }
    });

    it.each([
      ['un Yape aprobado', 'YAPE'],
      ['un pago en efectivo', 'EFECTIVO'],
    ] as const)(
      'criterio 28 y notas de la 007b: con %s y un pago RECHAZADO de la misma matrícula con un registrado_en posterior, la vista CONFIRMADA muestra el método, el monto y el ticket del pago confirmado',
      async (_nombre, metodo) => {
        await abrirCajaDeHoy(e);
        let alumnoId: string;
        let matriculaId: string;
        let token: string;
        let monto: string;
        if (metodo === 'YAPE') {
          const cliente = await sembrarEnVerificacion(e);
          const aprobacion = await ctx.http.post(rutaAprobacion(cliente.pagoId), {}, { cookie: cookies.secretaria });
          expect(aprobacion.status, aprobacion.texto).toBe(200);
          ({ alumnoId, matriculaId, token } = cliente);
          monto = '42.00';
        } else {
          const cliente = await sembrarCobrable(e);
          const cobro = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), {
            cookie: cookies.secretaria,
          });
          expect(pagoDe(cobro).numeroTicket).toBe(1);
          ({ alumnoId, matriculaId, token } = cliente);
          monto = '42.00';
        }
        // Un intento rechazado anterior cuyo registrado_en quedó después (otra instancia con otro reloj).
        await insertarPago(
          'propietario',
          e.A.id,
          filaPagoValida(
            e.A.id,
            { alumnoId, matriculaId, usuarioId: e.secretariaA.id },
            { metodo: metodo === 'YAPE' ? 'TRANSFERENCIA' : 'YAPE', estado: 'RECHAZADO', monto: '40.00' },
            {
              registrado_en: new Date(AHORA_007.getTime() + HORA),
              verificado_en: new Date(AHORA_007.getTime() + 2 * HORA),
              creado_en: new Date(AHORA_007.getTime() + HORA),
              actualizado_en: new Date(AHORA_007.getTime() + HORA),
            },
          ),
        );

        const respuesta = await consultarPorToken(ctx, token);

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(vista(respuesta)).toMatchObject({
          estado: 'CONFIRMADA',
          monto,
          pago: { metodo, monto, confirmadoEn: AHORA_007.toISOString(), numeroTicket: 1 },
        });
        expect(respuesta.texto).not.toContain('40.00');
      },
    );
  });

  describe('ninguna vista muestra un método, una fecha o un ticket inventados', () => {
    it('criterio 28 y notas de la 007b: una solicitud CONFIRMADA en la fila sin pago confirmado (datos inconsistentes) no se muestra con un método, un monto ni un ticket por defecto: el servidor responde con un error (5xx) y no inventa nada', async () => {
      const cliente = await sembrarCobrable(e);
      await actualizarFilas(
        'propietario',
        'solicitudes_inscripcion',
        e.A.id,
        { id: cliente.solicitudId },
        { estado: 'CONFIRMADA' },
      );

      const respuesta = await consultarPorToken(ctx, cliente.token);

      expect(respuesta.status, respuesta.texto).toBeGreaterThanOrEqual(500);
      for (const inventado of ['EFECTIVO', 'YAPE', 'TRANSFERENCIA', '"numeroTicket":0', 'confirmadoEn']) {
        expect(respuesta.texto, `la respuesta trae ${inventado}`).not.toContain(inventado);
      }
    });

    it('criterio 28 y notas de la 007b: una solicitud CONFIRMADA en la fila cuyo único pago es un RECHAZADO no se muestra con los datos del rechazado: error del servidor', async () => {
      const rechazada = await sembrarRechazada(e, { metodo: 'TRANSFERENCIA' });
      await actualizarFilas(
        'propietario',
        'solicitudes_inscripcion',
        e.A.id,
        { id: rechazada.solicitudId },
        { estado: 'CONFIRMADA' },
      );

      const respuesta = await consultarPorToken(ctx, rechazada.token);

      expect(respuesta.status, respuesta.texto).toBeGreaterThanOrEqual(500);
      expect(respuesta.texto).not.toContain('TRANSFERENCIA');
    });

    it('criterio 28: en las vistas normales el método es de los tres conocidos, la fecha de operación es una fecha y el ticket es un número desde 1', async () => {
      exigirRutasDe007b(ctx.app);
      await abrirCajaDeHoy(e);
      const enRevision = await sembrarEnVerificacion(e);
      const aprobada = await sembrarEnVerificacion(e);
      expect((await ctx.http.post(rutaAprobacion(aprobada.pagoId), {}, { cookie: cookies.secretaria })).status).toBe(
        200,
      );

      const a = vista(await consultarPorToken(ctx, enRevision.token))['pago'] as Objeto;
      const b = vista(await consultarPorToken(ctx, aprobada.token))['pago'] as Objeto;

      expect(['YAPE', 'TRANSFERENCIA']).toContain(a['metodo']);
      expect(a['fechaOperacion']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a['enviadoEn']).toBe(T_PAGO.toISOString());
      expect(['YAPE', 'TRANSFERENCIA']).toContain(b['metodo']);
      expect(b['numeroTicket']).toBeGreaterThanOrEqual(1);
      expect(b['confirmadoEn']).toBe(AHORA_007.toISOString());
    });
  });
});
