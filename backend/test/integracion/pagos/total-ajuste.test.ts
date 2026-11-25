// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoAjuste,
  cuerpoCobro,
  detallesDeRespuesta,
  type EscenarioPagos,
  exigirRutasDePagos,
  instantaneaDeLaAcademia,
  pagoDe,
  rutaAjuste,
  rutaCobro,
  sembrarCobrable,
  solicitudPanelDe,
  totalDeReferencia,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  camposConError,
  codigoDe,
  crearAppInscripciones,
  leerMatriculas,
  ocupacionDeClase,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { leerMovimientos } from '../../utilidades/caja';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 10 (crítico, D-03, RN-25, HU-34, HU-19): el total a cobrar (definición) se calcula con `calcularTotal` y lo guardado en la matrícula, y es un
// entero de soles. Una matrícula de S/ 100 de 12 clases con 5 totales sin ajuste cobra S/ 42 (igual a `monto_calculado`); con `monto_ajustado` 35, S/ 35; si
// después del envío el administrador cambia el precio del plan a S/ 200, el total sigue siendo S/ 42 (HU-19); una matrícula de S/ 210 de 12 con 5 cobra S/ 88.
// El monto del pago, el del movimiento de caja, el de la vista de seguimiento, el del panel y el del ticket son ese total. Ningún paso usa `number`.
// Criterio 11 (crítico, RN-25, HU-34, RN-22, D-03): `POST /api/solicitudes/{id}/ajuste-monto` con `{ montoAjustado, motivo }` (`ajustarMontoSchema`: un monto en
// soles enteros de "1" a "99999", DR-11; `motivo` con `textoVisibleSchema` de 3 a 200 caracteres) responde 200 con `{ solicitud }` (el elemento del panel).
// Guarda `monto_ajustado` y `motivo_ajuste` en la matrícula y registra `MATRICULA_MONTO_AJUSTADO` (entidad `matricula`, `entidadId` la matrícula, actor el
// administrador, `motivo`, `datosAntes: { montoAjustado, total }` y `datosDespues: { montoAjustado, total }`, montos como texto con dos decimales). Solo se
// ajusta una solicitud con estado visible `PENDIENTE_PAGO` o `PAGO_RECHAZADO`; en `CONFIRMADA`, `VENCIDA` o `CANCELADA` responde 409 `SOLICITUD_NO_AJUSTABLE`
// con `detalles: { estado }`, sin escribir (el estado `EN_VERIFICACION` y el `PAGO_RECHAZADO` los prueba la 007b). Un nuevo ajuste reemplaza al anterior; el
// mismo monto y el mismo motivo que ya tiene responden 200 sin escribir ni auditar. El ajuste no toca el cupo, la reserva ni las clases totales (DR-11).

const ACCION = 'MATRICULA_MONTO_AJUSTADO';
const MOTIVO = 'Descuento autorizado por la dirección';

describe('total a cobrar y ajuste del administrador (criterios 10 y 11)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const cobrar = (c: SolicitudSembrada, monto: string, cookie = cookies.secretaria) =>
    ctx.http.post(rutaCobro(c.solicitudId), cuerpoCobro(monto), { cookie });
  const ajustar = (c: SolicitudSembrada, cuerpo: unknown, cookie = cookies.admin) =>
    ctx.http.post(rutaAjuste(c.solicitudId), cuerpo, { cookie });
  const lista = (query = '') => ctx.http.get(`/api/solicitudes${query}`, { cookie: cookies.admin });
  const delPanel = async (c: SolicitudSembrada) => {
    const respuesta = await lista('?estado=TODAS');
    expect(respuesta.status, respuesta.texto).toBe(200);
    return (respuesta.body?.['solicitudes'] as { id: string; monto: string }[]).find((s) => s.id === c.solicitudId);
  };
  const fijarMatricula = (c: SolicitudSembrada, cambios: string) =>
    ejecutarComo(
      'propietario',
      `UPDATE matriculas SET ${cambios} WHERE academia_id = $1::uuid AND id = $2::uuid`,
      [e.A.id, c.matriculaId],
      {
        academiaId: e.A.id,
      },
    );

  describe('criterio 10: el total sale de la matrícula', () => {
    it.each([
      [
        'S/ 100 de 12 clases con 5 totales, sin ajuste: S/ 42',
        { precioPlan: '100.00', clasesPorMesPlan: 12, clasesTotales: 5, monto: '42.00' },
        '42.00',
      ],
      [
        'S/ 210 de 12 clases con 5 totales: S/ 88 (hacia arriba)',
        { precioPlan: '210.00', clasesPorMesPlan: 12, clasesTotales: 5, monto: '88.00' },
        '88.00',
      ],
      [
        'S/ 120 de 12 clases con 12 totales (mes completo): S/ 120',
        { precioPlan: '120.00', clasesPorMesPlan: 12, clasesTotales: 12, monto: '120.00' },
        '120.00',
      ],
      [
        'S/ 37.20 de 30 clases con 25 totales: S/ 31 exactos (sin coma flotante, que daría 32)',
        { precioPlan: '37.20', clasesPorMesPlan: 30, clasesTotales: 25, monto: '31.00' },
        '31.00',
      ],
      [
        'S/ 99.99 de 7 clases con 3 totales: S/ 43 (42.85… hacia arriba)',
        { precioPlan: '99.99', clasesPorMesPlan: 7, clasesTotales: 3, monto: '43.00' },
        '43.00',
      ],
    ])(
      'criterio 10: %s: el cobro, el movimiento de caja, el panel y la respuesta usan ese total',
      async (_nombre, datos, total) => {
        await abrirCajaDeHoy(e);
        const cliente = await sembrarCobrable(e, datos);
        expect(
          totalDeReferencia(datos.precioPlan, datos.clasesPorMesPlan, datos.clasesTotales),
          'la referencia de la prueba',
        ).toBe(total);
        expect((await delPanel(cliente))?.monto, 'el panel antes de cobrar').toBe(total);

        const respuesta = await cobrar(cliente, total);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(pagoDe(respuesta).monto).toBe(total);
        expect(solicitudPanelDe(respuesta).monto).toBe(total);
        expect((await leerPagos(e.A.id))[0]?.monto).toBe(total);
        expect((await leerMovimientos(e.A.id))[0]?.monto).toBe(total);
      },
    );

    it('criterio 10: con monto_ajustado 35 el total es S/ 35 (el ajuste reemplaza al calculado) y es lo que cobra y lo que ve el panel', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      await fijarMatricula(cliente, "monto_ajustado = 35, motivo_ajuste = 'Descuento autorizado'");
      expect((await delPanel(cliente))?.monto).toBe('35.00');

      const caro = await cobrar(cliente, '42');
      expect([caro.status, codigoDe(caro)], 'quien cobra vio el total viejo').toEqual([409, 'MONTO_CAMBIO']);
      expect(detallesDeRespuesta(caro)['total']).toBe('35.00');
      const respuesta = await cobrar(cliente, '35');

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(pagoDe(respuesta).monto).toBe('35.00');
      expect((await leerMovimientos(e.A.id))[0]?.monto).toBe('35.00');
    });

    it('criterio 10: si después del envío el administrador cambia el precio del plan a S/ 200, el total sigue siendo S/ 42 (HU-19: nunca se lee del plan)', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      await ejecutarComo(
        'propietario',
        'UPDATE planes SET precio = 200.00 WHERE academia_id = $1::uuid AND id = $2::uuid',
        [e.A.id, e.plan.id],
        {
          academiaId: e.A.id,
        },
      );

      expect((await delPanel(cliente))?.monto).toBe('42.00');
      const respuesta = await cobrar(cliente, '42.00');

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(pagoDe(respuesta).monto).toBe('42.00');
      expect((await leerMatriculas(e.A.id))[0]?.precio_plan).toBe('100.00');
    });

    it('criterio 10 y D-03: un ajuste con céntimos escrito como dueño (99.5) da un total de S/ 100: se redondea hacia arriba, una sola vez', async () => {
      await abrirCajaDeHoy(e);
      const cliente = await sembrarCobrable(e);
      await fijarMatricula(cliente, "monto_ajustado = 99.5, motivo_ajuste = 'Escrito por la base'");
      expect((await delPanel(cliente))?.monto).toBe('100.00');

      const respuesta = await cobrar(cliente, '100.00');

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(pagoDe(respuesta).monto).toBe('100.00');
      expect((await leerMovimientos(e.A.id))[0]?.monto).toBe('100.00');
    });

    it('criterio 10: el total del panel es el de la matrícula también cuando la solicitud ya no se puede cobrar (vencida)', async () => {
      const cliente = await sembrarCobrable(e, {
        estado: 'PENDIENTE_PAGO_VENCIDA',
        clasesTotales: 5,
        precioPlan: '210.00',
        monto: '88.00',
      });

      expect((await delPanel(cliente))?.monto).toBe('88.00');
    });
  });

  describe('criterio 11: el ajuste del monto', () => {
    it('criterio 11: el administrador ajusta S/ 42 a S/ 35: 200 con { solicitud } (monto 35.00 y ajuste { montoCalculado, motivo }), Cache-Control: no-store', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await ajustar(cliente, cuerpoAjuste('35', `  ${MOTIVO}  `));

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {})).toEqual(['solicitud']);
      const solicitud = solicitudPanelDe(respuesta);
      expect(solicitud).toMatchObject({
        id: cliente.solicitudId,
        estado: 'PENDIENTE_PAGO',
        monto: '35.00',
        ajuste: { montoCalculado: '42.00', motivo: MOTIVO },
        pago: null,
      });
      expect((await delPanel(cliente))?.monto).toBe('35.00');
    });

    it('criterio 11: guarda monto_ajustado y motivo_ajuste en la matrícula, sin tocar el precio, el monto calculado, las clases, el cupo ni la reserva', async () => {
      const cliente = await sembrarCobrable(e);
      const [antes] = await leerMatriculas(e.A.id);

      await ajustar(cliente, cuerpoAjuste('35', MOTIVO));

      const [despues] = await leerMatriculas(e.A.id);
      expect(despues).toMatchObject({ monto_ajustado: '35.00', motivo_ajuste: MOTIVO });
      expect({ ...despues, monto_ajustado: null, motivo_ajuste: null, actualizado_en: null }).toEqual({
        ...antes,
        monto_ajustado: null,
        motivo_ajuste: null,
        actualizado_en: null,
      });
    });

    it('criterio 11: audita MATRICULA_MONTO_AJUSTADO (entidad matricula, el administrador, el motivo, antes y después con los montos como texto con dos decimales)', async () => {
      const cliente = await sembrarCobrable(e);

      await ajustar(cliente, cuerpoAjuste('35', MOTIVO));

      const filas = await leerAuditoriaDeAcademia(e.A.id, ACCION);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        entidad: 'matricula',
        entidad_id: cliente.matriculaId,
        actor_tipo: 'USUARIO',
        actor_id: e.adminA.id,
        motivo: MOTIVO,
      });
      expect(filas[0]?.datos_antes).toMatchObject({ total: '42.00' });
      expect(
        (filas[0]?.datos_antes as { montoAjustado?: string | null }).montoAjustado ?? null,
        'sin ajuste anterior',
      ).toBeNull();
      expect(filas[0]?.datos_despues).toEqual({ montoAjustado: '35.00', total: '35.00' });
      expect(JSON.stringify(filas[0]), 'sin el DNI de la persona').not.toContain(cliente.dni);
    });

    it('criterio 11: un nuevo ajuste reemplaza al anterior (y la auditoría guarda el anterior en datosAntes)', async () => {
      const cliente = await sembrarCobrable(e);
      await ajustar(cliente, cuerpoAjuste('35', MOTIVO));

      const respuesta = await ajustar(cliente, cuerpoAjuste('30', 'Otro descuento'));

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(solicitudPanelDe(respuesta)).toMatchObject({
        monto: '30.00',
        ajuste: { montoCalculado: '42.00', motivo: 'Otro descuento' },
      });
      const filas = await leerAuditoriaDeAcademia(e.A.id, ACCION);
      expect(filas).toHaveLength(2);
      // Con el reloj fijo las dos filas comparten `fecha_hora`: la spec no garantiza su orden, así que se busca la del segundo ajuste por su motivo.
      const segundo = filas.filter((f) => f.motivo === 'Otro descuento');
      expect(segundo).toHaveLength(1);
      expect(segundo[0]?.datos_antes).toEqual({ montoAjustado: '35.00', total: '35.00' });
      expect(segundo[0]?.datos_despues).toEqual({ montoAjustado: '30.00', total: '30.00' });
      expect(filas.filter((f) => f.motivo === MOTIVO)).toHaveLength(1);
    });

    it('criterio 11: el mismo monto y el mismo motivo que ya tiene responden 200 sin escribir ni auditar', async () => {
      const cliente = await sembrarCobrable(e);
      await ajustar(cliente, cuerpoAjuste('35', MOTIVO));
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const repetido = await ajustar(cliente, cuerpoAjuste('35', `${MOTIVO} `));

      expect(repetido.status, repetido.texto).toBe(200);
      expect(solicitudPanelDe(repetido)).toMatchObject({
        monto: '35.00',
        ajuste: { montoCalculado: '42.00', motivo: MOTIVO },
      });
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION)).toHaveLength(1);
    });

    it('criterio 11: el mismo monto con otro motivo sí es un cambio: se guarda y se audita', async () => {
      const cliente = await sembrarCobrable(e);
      await ajustar(cliente, cuerpoAjuste('35', MOTIVO));

      const respuesta = await ajustar(cliente, cuerpoAjuste('35', 'Beca de la dirección'));

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(solicitudPanelDe(respuesta).ajuste?.motivo).toBe('Beca de la dirección');
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION)).toHaveLength(2);
    });

    it.each([
      ['1', '1.00'],
      ['99999', '99999.00'],
      ['41', '41.00'],
      ['43', '43.00'],
    ])(
      'criterio 11: el monto "%s" (de "1" a "99999", soles enteros) se acepta y deja el total en %s (también uno mayor que el calculado)',
      async (monto, total) => {
        const cliente = await sembrarCobrable(e);

        const respuesta = await ajustar(cliente, cuerpoAjuste(monto));

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(solicitudPanelDe(respuesta).monto).toBe(total);
      },
    );

    describe('cuerpos inválidos: 400 SOLICITUD_INVALIDA sin escribir ni auditar', () => {
      const MALOS: [string, Record<string, unknown>, string][] = [
        ['sin monto', { motivo: MOTIVO }, 'montoAjustado'],
        [
          'con el monto "0" (las becas llegan con los códigos de descuento, DR-11)',
          { montoAjustado: '0', motivo: MOTIVO },
          'montoAjustado',
        ],
        ['con un monto negativo', { montoAjustado: '-5', motivo: MOTIVO }, 'montoAjustado'],
        ['con el monto "100000" (el máximo es 99999)', { montoAjustado: '100000', motivo: MOTIVO }, 'montoAjustado'],
        ['con céntimos ("35.5": soles enteros)', { montoAjustado: '35.5', motivo: MOTIVO }, 'montoAjustado'],
        ['con un monto que no es un número', { montoAjustado: 'abc', motivo: MOTIVO }, 'montoAjustado'],
        [
          'con el monto como número JSON (los montos van como texto)',
          { montoAjustado: 35, motivo: MOTIVO },
          'montoAjustado',
        ],
        ['con el monto vacío', { montoAjustado: '', motivo: MOTIVO }, 'montoAjustado'],
        ['sin motivo', { montoAjustado: '35' }, 'motivo'],
        ['con el motivo vacío', { montoAjustado: '35', motivo: '' }, 'motivo'],
        ['con el motivo de 2 caracteres', { montoAjustado: '35', motivo: 'ab' }, 'motivo'],
        ['con 3 caracteres que no son visibles', { montoAjustado: '35', motivo: '   \t ' }, 'motivo'],
        ['con un motivo de 201 caracteres', { montoAjustado: '35', motivo: 'a'.repeat(201) }, 'motivo'],
        ['con un salto de línea en el motivo', { montoAjustado: '35', motivo: 'Dos\nlíneas' }, 'motivo'],
        ['con un carácter bidireccional en el motivo', { montoAjustado: '35', motivo: 'Texto‮invertido' }, 'motivo'],
        ['con un campo de más', { montoAjustado: '35', motivo: MOTIVO, clasesTotales: 3 }, ''],
        ['con la academiaId en el cuerpo', { montoAjustado: '35', motivo: MOTIVO, academiaId: 'cualquiera' }, ''],
      ];

      it.each(MALOS)('criterio 11: %s', async (_nombre, cuerpo, campo) => {
        const cliente = await sembrarCobrable(e);
        const antes = await instantaneaDeLaAcademia(e.A.id);

        const respuesta = await ajustar(cliente, cuerpo);

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        if (campo !== '') expect(camposConError(respuesta)).toContain(campo);
        expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      });
    });

    describe('solo se ajusta una solicitud con estado visible PENDIENTE_PAGO: las demás responden 409 SOLICITUD_NO_AJUSTABLE con { estado } sin escribir', () => {
      it('criterio 11: CONFIRMADA (ya pagada)', async () => {
        await abrirCajaDeHoy(e);
        const cliente = await sembrarCobrable(e);
        const cobro = await cobrar(cliente, '42');
        expect(cobro.status, cobro.texto).toBe(201);
        const antes = await instantaneaDeLaAcademia(e.A.id);

        const respuesta = await ajustar(cliente, cuerpoAjuste('35'));

        expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'SOLICITUD_NO_AJUSTABLE']);
        expect(detallesDeRespuesta(respuesta)).toEqual({ estado: 'CONFIRMADA' });
        expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      });

      it.each([
        [
          'con la reserva vencida (la fila aún dice PENDIENTE_PAGO)',
          { estado: 'PENDIENTE_PAGO_VENCIDA' as const },
          'VENCIDA',
        ],
        ['con la fila VENCIDA', { estado: 'VENCIDA' as const }, 'VENCIDA'],
        ['CANCELADA', { estado: 'CANCELADA' as const }, 'CANCELADA'],
      ])('criterio 11: %s', async (_nombre, opciones, estado) => {
        const cliente = await sembrarCobrable(e, opciones);
        const antes = await instantaneaDeLaAcademia(e.A.id);

        const respuesta = await ajustar(cliente, cuerpoAjuste('35'));

        expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'SOLICITUD_NO_AJUSTABLE']);
        expect(detallesDeRespuesta(respuesta)).toEqual({ estado });
        expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      });

      it('criterio 11: una reserva que vence en este mismo instante ya es VENCIDA: no se ajusta; un milisegundo antes, sí', async () => {
        const justo = await sembrarCobrable(e, { reservaVenceEn: new Date(AHORA_007.getTime()) });
        const casi = await sembrarCobrable(e, { reservaVenceEn: new Date(AHORA_007.getTime() + 1) });

        const alLimite = await ajustar(justo, cuerpoAjuste('35'));
        const antes = await ajustar(casi, cuerpoAjuste('35'));

        expect([alLimite.status, codigoDe(alLimite)]).toEqual([409, 'SOLICITUD_NO_AJUSTABLE']);
        expect(antes.status, antes.texto).toBe(200);
      });
    });

    it('criterio 11 y DR-11: el ajuste no mueve el cupo ni la reserva: la ocupación de la clase y el vencimiento de la reserva quedan igual', async () => {
      const cliente = await sembrarCobrable(e);
      const mes = { anio: 2026, mes: 11 };
      const antes = {
        ocupacion: await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007),
        matricula: (await leerMatriculas(e.A.id))[0],
      };

      await ajustar(cliente, cuerpoAjuste('35'));

      expect(await ocupacionDeClase(e.A.id, e.lunes.id, mes, AHORA_007)).toBe(antes.ocupacion);
      const despues = (await leerMatriculas(e.A.id))[0];
      expect([despues?.estado, despues?.reserva_vence_en, despues?.clases_totales]).toEqual([
        antes.matricula?.estado,
        antes.matricula?.reserva_vence_en,
        antes.matricula?.clases_totales,
      ]);
    });
  });
});
