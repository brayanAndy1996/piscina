// spec: 007-pagos (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { crearCajaDePrueba } from '../../utilidades/caja';
import { crearEscenarioDePagos, type EscenarioPagos } from '../../utilidades/escenario-pagos';
import { sembrarSolicitud } from '../../utilidades/inscripciones';
import {
  actualizarPagos,
  type Columnas,
  crearPagoConfirmadoConMovimiento,
  filaPagoValida,
  insertarPago,
  leerPagos,
  type MetodoDePago,
  type EstadoDePago,
  numeroDeOperacionInventado,
  T_VERIFICACION,
} from '../../utilidades/pagos';

// Criterio 4 (crítico, RN-04, D-07, D-03; prevención de duplicados de HU-08): un INSERT o UPDATE directo, como app y como dueño, falla con 23514 o 23505 según el caso:
//   a) `monto` menor o igual que 0, mayor que 100000.00 o `NaN` (con más de dos decimales: la columna es numeric(10,2) y redondea al guardar; no hay nada que rechazar);
//   b) `concepto` igual a `EGRESO_MENOR`;
//   c) un pago `EFECTIVO` con número de operación, comprobante o fecha de operación, o en un estado que no sea `CONFIRMADO`; un pago `YAPE` o `TRANSFERENCIA` sin número de
//      operación (el escrito y el normalizado), sin comprobante o sin fecha de operación;
//   d) un número normalizado que no cumple `^(0|[1-9A-Z][0-9A-Z]{0,29})$`, o un número escrito vacío o de más de 40 caracteres;
//   e) coherencia del estado: `PENDIENTE_VERIFICACION` sin `verificado_por`, `verificado_en`, `motivo_rechazo` ni `numero_ticket`; `CONFIRMADO` con `verificado_por`,
//      `verificado_en` y `numero_ticket`, y sin motivo; `RECHAZADO` con `verificado_por`, `verificado_en` y un motivo no vacío, y sin `numero_ticket`; `verificado_en`
//      no anterior a `registrado_en`;
//   f) dos pagos abiertos de la misma matrícula (23505, índice parcial `pagos_un_abierto_por_matricula`);
//   g) dos pagos abiertos de la misma academia y el mismo método con el mismo número normalizado (23505, índice parcial `pagos_numero_operacion_abierto_key`; DR-9);
//      un pago `RECHAZADO` no cuenta, y otra academia tampoco;
//   h) dos pagos de la academia con la misma `clave_idempotencia` o el mismo `numero_ticket` (23505).
// Cada rol corre con su propia base: los números de operación válidos que se aceptan no chocan entre los dos.

const ROLES = ['propietario', 'app'] as const;

describe.each(ROLES)('criterio 4: CHECK e índices únicos de pagos, como %s', (rol) => {
  let e: EscenarioPagos;
  let cajaId: string;

  beforeAll(async () => {
    e = await crearEscenarioDePagos();
    cajaId = (await crearCajaDePrueba(e.A.id, e.secretariaA.id)).id;
  });

  /** Un cliente nuevo de A (alumno, solicitud y matrícula) y sus padres para armar pagos. */
  async function clienteNuevo(academia: 'A' | 'B' = 'A') {
    const esA = academia === 'A';
    const cliente = await sembrarSolicitud(esA ? e.A.id : e.B.id, {
      planId: esA ? e.plan.id : e.planB.id,
      claseIds: [esA ? e.lunes.id : e.lunesB.id],
      monto: '42.00',
    });
    return {
      academiaId: esA ? e.A.id : e.B.id,
      usuarioId: esA ? e.secretariaA.id : e.secretariaB.id,
      alumnoId: cliente.alumnoId,
      matriculaId: cliente.matriculaId,
    };
  }

  type Cliente = Awaited<ReturnType<typeof clienteNuevo>>;

  const fila = (
    c: Cliente,
    opciones: { metodo?: MetodoDePago; estado?: EstadoDePago; numeroTicket?: number } = {},
    sobre: Columnas = {},
  ) =>
    filaPagoValida(
      c.academiaId,
      { alumnoId: c.alumnoId, matriculaId: c.matriculaId, usuarioId: c.usuarioId },
      opciones,
      sobre,
    );

  const insertar = (c: Cliente, columnas: Columnas) => insertarPago(rol, c.academiaId, columnas);

  /** El pago se rechaza con `code` (y, si se indica, por ese índice o restricción) y la academia no gana ninguna fila. */
  async function rechazado(c: Cliente, columnas: Columnas, code: string, restriccion?: string): Promise<void> {
    const antes = (await leerPagos(c.academiaId)).length;
    const promesa = insertar(c, columnas);
    await expect(promesa).rejects.toMatchObject(restriccion ? { code, constraint: restriccion } : { code });
    expect(await leerPagos(c.academiaId)).toHaveLength(antes);
  }

  describe('a) el monto', () => {
    it.each([
      ['0', '0'],
      ['0.00', '0.00'],
      ['negativo', '-1.00'],
      ['mayor que 100000.00', '100000.01'],
      ['un millón', '1000000'],
      ['NaN', 'NaN'],
    ])('criterio 4 a: un monto %s falla con 23514', async (_nombre, monto) => {
      const c = await clienteNuevo();

      await rechazado(c, fila(c, {}, { monto }), '23514');
    });

    it.each([
      ['0.01', '0.01'],
      ['100000.00', '100000.00'],
      ['42.50', '42.50'],
    ])('criterio 4 a: un monto de %s se acepta (control)', async (_nombre, monto) => {
      const c = await clienteNuevo();

      await insertar(c, fila(c, {}, { monto }));

      expect((await leerPagos(c.academiaId)).find((p) => p.matricula_id === c.matriculaId)?.monto).toBe(monto);
    });
  });

  describe('b) el concepto', () => {
    it('criterio 4 b: un pago con el concepto EGRESO_MENOR falla con 23514', async () => {
      const c = await clienteNuevo();

      await rechazado(c, fila(c, {}, { concepto: 'EGRESO_MENOR' }), '23514');
    });

    it.each(['INSCRIPCION', 'MENSUALIDAD', 'CLASE_PARTICULAR'])(
      'criterio 4 b: el concepto %s se acepta (control)',
      async (concepto) => {
        const c = await clienteNuevo();

        await insertar(c, fila(c, {}, { concepto }));

        expect((await leerPagos(c.academiaId)).find((p) => p.matricula_id === c.matriculaId)?.concepto).toBe(concepto);
      },
    );
  });

  describe('c) los datos que exige cada método', () => {
    it.each([
      ['con número de operación', { numero_operacion: '123', numero_operacion_normalizado: '123' }],
      ['con número de operación normalizado', { numero_operacion_normalizado: '123' }],
      ['con comprobante', { comprobante_clave: 'academias/x/pagos/y/comprobante-z.jpg' }],
      ['con fecha de operación', { fecha_operacion: '2026-11-10' }],
    ])('criterio 4 c: un pago EFECTIVO %s falla con 23514', async (_nombre, sobre) => {
      const c = await clienteNuevo();

      await rechazado(c, fila(c, { metodo: 'EFECTIVO', estado: 'CONFIRMADO' }, sobre), '23514');
    });

    it.each(['PENDIENTE_VERIFICACION', 'RECHAZADO'] as const)(
      'criterio 4 c: un pago EFECTIVO en estado %s falla con 23514 (el efectivo nace confirmado)',
      async (estado) => {
        const c = await clienteNuevo();

        await rechazado(c, fila(c, { metodo: 'EFECTIVO', estado }), '23514');
      },
    );

    it.each(['YAPE', 'TRANSFERENCIA'] as const)(
      'criterio 4 c: un pago %s sin cada dato obligatorio falla con 23514',
      async (metodo) => {
        for (const sobre of [
          { numero_operacion: null },
          { numero_operacion_normalizado: null },
          { comprobante_clave: null },
          { fecha_operacion: null },
        ]) {
          const c = await clienteNuevo();

          await rechazado(c, fila(c, { metodo }, sobre), '23514');
        }
      },
    );

    it.each(['YAPE', 'TRANSFERENCIA'] as const)(
      'criterio 4 c: un pago %s pendiente con sus cuatro datos se acepta (control)',
      async (metodo) => {
        const c = await clienteNuevo();

        await insertar(c, fila(c, { metodo }));

        expect((await leerPagos(c.academiaId)).find((p) => p.matricula_id === c.matriculaId)?.metodo).toBe(metodo);
      },
    );
  });

  describe('d) el número de operación', () => {
    it.each([
      ['vacío', ''],
      ['con un cero adelante', '012'],
      ['con un cero adelante y una letra', '0A'],
      ['con minúsculas', 'ab1'],
      ['con un espacio', '1 2'],
      ['con un guion', '1-2'],
      ['con una letra con tilde', 'Ñ1'],
      ['con un punto', '1.2'],
      ['de 31 caracteres', 'A'.repeat(31)],
    ])('criterio 4 d: un número normalizado %s falla con 23514', async (_nombre, normalizado) => {
      const c = await clienteNuevo();

      await rechazado(c, fila(c, {}, { numero_operacion_normalizado: normalizado }), '23514');
    });

    it.each([
      ['vacío', ''],
      ['de 41 caracteres', '1'.repeat(41)],
    ])('criterio 4 d: un número escrito %s falla con 23514', async (_nombre, escrito) => {
      const c = await clienteNuevo();

      await rechazado(c, fila(c, {}, { numero_operacion: escrito }), '23514');
    });

    it.each([
      ['un solo cero', '0'],
      ['un dígito', '7'],
      ['una letra', 'Q'],
      ['letras y dígitos', 'AB12CD'],
      ['30 caracteres', `Z${'9'.repeat(29)}`],
    ])('criterio 4 d: un número normalizado válido (%s) se acepta (control)', async (_nombre, normalizado) => {
      const c = await clienteNuevo();

      await insertar(
        c,
        fila(
          c,
          { metodo: 'TRANSFERENCIA' },
          { numero_operacion: normalizado, numero_operacion_normalizado: normalizado },
        ),
      );

      expect(
        (await leerPagos(c.academiaId)).find((p) => p.matricula_id === c.matriculaId)?.numero_operacion_normalizado,
      ).toBe(normalizado);
    });

    it('criterio 4 d: el número escrito puede ser distinto del normalizado (se guarda lo que escribió la persona) y de hasta 40 caracteres', async () => {
      const c = await clienteNuevo();
      const normalizado = numeroDeOperacionInventado();
      const escrito = ` ${normalizado.slice(0, 2)} ${normalizado.slice(2)} `;
      await insertar(c, fila(c, {}, { numero_operacion: escrito, numero_operacion_normalizado: normalizado }));
      const otro = await clienteNuevo();
      const largo = `0000-${numeroDeOperacionInventado()}-${'1'.repeat(40)}`.slice(0, 40);
      await insertar(
        otro,
        fila(otro, {}, { numero_operacion: largo, numero_operacion_normalizado: `Y${numeroDeOperacionInventado()}` }),
      );

      const pagos = await leerPagos(c.academiaId);
      expect(pagos.find((p) => p.matricula_id === c.matriculaId)?.numero_operacion).toBe(escrito);
      expect(pagos.find((p) => p.matricula_id === otro.matriculaId)?.numero_operacion).toHaveLength(40);
    });
  });

  describe('e) la coherencia del estado', () => {
    it.each([
      ['con verificado_por', (c: Cliente) => ({ verificado_por: c.usuarioId })],
      ['con verificado_en', () => ({ verificado_en: T_VERIFICACION })],
      ['con motivo_rechazo', () => ({ motivo_rechazo: 'Un motivo' })],
      ['con numero_ticket', () => ({ numero_ticket: 7 })],
    ])('criterio 4 e: un pago PENDIENTE_VERIFICACION %s falla con 23514', async (_nombre, sobre) => {
      const c = await clienteNuevo();

      await rechazado(c, fila(c, {}, sobre(c)), '23514');
    });

    it.each([
      ['sin verificado_por', { verificado_por: null }],
      ['sin verificado_en', { verificado_en: null }],
      ['sin numero_ticket', { numero_ticket: null }],
      ['con motivo_rechazo', { motivo_rechazo: 'Un motivo' }],
    ])('criterio 4 e: un pago CONFIRMADO %s falla con 23514', async (_nombre, sobre) => {
      const c = await clienteNuevo();

      await rechazado(c, fila(c, { estado: 'CONFIRMADO' }, sobre), '23514');
    });

    it.each([
      ['sin verificado_por', { verificado_por: null }],
      ['sin verificado_en', { verificado_en: null }],
      ['sin motivo', { motivo_rechazo: null }],
      ['con el motivo vacío', { motivo_rechazo: '' }],
      ['con numero_ticket', { numero_ticket: 7 }],
    ])('criterio 4 e: un pago RECHAZADO %s falla con 23514', async (_nombre, sobre) => {
      const c = await clienteNuevo();

      await rechazado(c, fila(c, { estado: 'RECHAZADO' }, sobre), '23514');
    });

    it('criterio 4 e: verificado_en anterior a registrado_en falla con 23514 (un pago rechazado y uno confirmado)', async () => {
      const c = await clienteNuevo();
      await rechazado(
        c,
        fila(c, { estado: 'RECHAZADO' }, { verificado_en: new Date(T_VERIFICACION.getTime() - 3_600_000) }),
        '23514',
      );
      const d = await clienteNuevo();
      await rechazado(
        d,
        fila(d, { estado: 'CONFIRMADO' }, { verificado_en: new Date(T_VERIFICACION.getTime() - 3_600_000) }),
        '23514',
      );
    });

    it('criterio 4 e: un RECHAZADO coherente (con verificado_por, verificado_en y motivo, sin ticket) se acepta, y verificado_en igual a registrado_en también (control)', async () => {
      const c = await clienteNuevo();
      await insertar(c, fila(c, { estado: 'RECHAZADO' }));
      const d = await clienteNuevo();
      await insertar(d, fila(d, { estado: 'RECHAZADO' }, { verificado_en: new Date('2026-11-11T14:30:00.000Z') }));

      expect((await leerPagos(c.academiaId)).filter((p) => p.estado === 'RECHAZADO').length).toBeGreaterThanOrEqual(2);
    });

    it('criterio 4 e: el mismo UPDATE directo que deja un pago pendiente incoherente (estado CONFIRMADO sin numero_ticket) falla con 23514', async () => {
      const c = await clienteNuevo();
      const pendiente = fila(c);
      await insertar(c, pendiente);

      await expect(
        actualizarPagos(
          rol,
          c.academiaId,
          { id: pendiente['id'] },
          { estado: 'CONFIRMADO', verificado_por: c.usuarioId, verificado_en: T_VERIFICACION },
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect((await leerPagos(c.academiaId)).find((p) => p.id === pendiente['id'])?.estado).toBe(
        'PENDIENTE_VERIFICACION',
      );
    });
  });

  describe('f) un pago abierto por matrícula', () => {
    it('criterio 4 f: dos pagos pendientes de la misma matrícula fallan con 23505 (pagos_un_abierto_por_matricula)', async () => {
      const c = await clienteNuevo();
      await insertar(c, fila(c));

      await rechazado(c, fila(c), '23505', 'pagos_un_abierto_por_matricula');
    });

    it('criterio 4 f: un pago pendiente después de uno confirmado de la misma matrícula falla con 23505 (pagos_un_abierto_por_matricula)', async () => {
      const c = await clienteNuevo();
      await crearPagoConfirmadoConMovimiento(c.academiaId, {
        cajaId,
        alumnoId: c.alumnoId,
        matriculaId: c.matriculaId,
        usuarioId: c.usuarioId,
        numeroTicket: 100 + Math.floor(Math.random() * 1000),
      });

      await rechazado(c, fila(c), '23505', 'pagos_un_abierto_por_matricula');
    });

    it('criterio 4 f: un pago rechazado no cuenta: se aceptan un pendiente después de uno rechazado y otro rechazado más', async () => {
      const c = await clienteNuevo();
      await insertar(c, fila(c, { estado: 'RECHAZADO' }));

      await insertar(c, fila(c, { estado: 'RECHAZADO' }));
      await insertar(c, fila(c));

      expect((await leerPagos(c.academiaId)).filter((p) => p.matricula_id === c.matriculaId)).toHaveLength(3);
    });

    it('criterio 4 f: al rechazar un pago pendiente con un UPDATE, la matrícula puede recibir otro pendiente (D-05)', async () => {
      const c = await clienteNuevo();
      const primero = fila(c);
      await insertar(c, primero);
      await actualizarPagos(
        rol,
        c.academiaId,
        { id: primero['id'] },
        {
          estado: 'RECHAZADO',
          verificado_por: c.usuarioId,
          verificado_en: T_VERIFICACION,
          motivo_rechazo: 'La imagen no se lee',
        },
      );

      await insertar(c, fila(c));

      expect((await leerPagos(c.academiaId)).filter((p) => p.matricula_id === c.matriculaId)).toHaveLength(2);
    });

    it('criterio 4 f: matrículas distintas de la academia pueden tener cada una su pago abierto (control)', async () => {
      const uno = await clienteNuevo();
      const dos = await clienteNuevo();

      await insertar(uno, fila(uno));
      await insertar(dos, fila(dos));

      expect(
        (await leerPagos(uno.academiaId)).filter((p) => [uno.matriculaId, dos.matriculaId].includes(p.matricula_id)),
      ).toHaveLength(2);
    });
  });

  describe('g) un número de operación por academia y método entre los pagos abiertos', () => {
    it('criterio 4 g: dos pagos abiertos de la misma academia, el mismo método y el mismo número normalizado fallan con 23505 (pagos_numero_operacion_abierto_key)', async () => {
      const uno = await clienteNuevo();
      const dos = await clienteNuevo();
      const numero = numeroDeOperacionInventado();
      await insertar(uno, fila(uno, {}, { numero_operacion: numero, numero_operacion_normalizado: numero }));

      await rechazado(
        dos,
        fila(dos, {}, { numero_operacion: ` 0${numero} `, numero_operacion_normalizado: numero }),
        '23505',
        'pagos_numero_operacion_abierto_key',
      );
    });

    it('criterio 4 g: el mismo número en un Yape y en una transferencia no choca (DR-9)', async () => {
      const uno = await clienteNuevo();
      const dos = await clienteNuevo();
      const numero = numeroDeOperacionInventado();
      await insertar(
        uno,
        fila(uno, { metodo: 'YAPE' }, { numero_operacion: numero, numero_operacion_normalizado: numero }),
      );

      await insertar(
        dos,
        fila(dos, { metodo: 'TRANSFERENCIA' }, { numero_operacion: numero, numero_operacion_normalizado: numero }),
      );

      expect((await leerPagos(uno.academiaId)).filter((p) => p.numero_operacion_normalizado === numero)).toHaveLength(
        2,
      );
    });

    it('criterio 4 g: un pago rechazado no cuenta: el número de un pago rechazado se puede volver a usar (D-07), y dos rechazados con el mismo número también', async () => {
      const uno = await clienteNuevo();
      const dos = await clienteNuevo();
      const tres = await clienteNuevo();
      const numero = numeroDeOperacionInventado();
      await insertar(
        uno,
        fila(uno, { estado: 'RECHAZADO' }, { numero_operacion: numero, numero_operacion_normalizado: numero }),
      );

      await insertar(dos, fila(dos, {}, { numero_operacion: numero, numero_operacion_normalizado: numero }));
      await insertar(
        tres,
        fila(tres, { estado: 'RECHAZADO' }, { numero_operacion: numero, numero_operacion_normalizado: numero }),
      );

      expect((await leerPagos(uno.academiaId)).filter((p) => p.numero_operacion_normalizado === numero)).toHaveLength(
        3,
      );
    });

    it('criterio 4 g: un pago confirmado también cuenta como abierto: un pendiente con su número falla con 23505', async () => {
      const uno = await clienteNuevo();
      const dos = await clienteNuevo();
      const numero = numeroDeOperacionInventado();
      await crearPagoConfirmadoConMovimiento(uno.academiaId, {
        cajaId,
        alumnoId: uno.alumnoId,
        matriculaId: uno.matriculaId,
        usuarioId: uno.usuarioId,
        metodo: 'YAPE',
        numeroTicket: 2000 + Math.floor(Math.random() * 1000),
      });
      const confirmado = (await leerPagos(uno.academiaId)).find((p) => p.matricula_id === uno.matriculaId);
      const normalizado = confirmado?.numero_operacion_normalizado ?? numero;

      await rechazado(
        dos,
        fila(dos, {}, { numero_operacion: normalizado, numero_operacion_normalizado: normalizado }),
        '23505',
        'pagos_numero_operacion_abierto_key',
      );
    });

    it('criterio 4 g: otra academia puede usar el mismo número de operación (control)', async () => {
      const deA = await clienteNuevo('A');
      const deB = await clienteNuevo('B');
      const numero = numeroDeOperacionInventado();
      await insertar(deA, fila(deA, {}, { numero_operacion: numero, numero_operacion_normalizado: numero }));

      await insertar(deB, fila(deB, {}, { numero_operacion: numero, numero_operacion_normalizado: numero }));

      expect((await leerPagos(deB.academiaId)).filter((p) => p.numero_operacion_normalizado === numero)).toHaveLength(
        1,
      );
    });
  });

  describe('h) la clave de idempotencia y el número de ticket', () => {
    it('criterio 4 h: dos pagos de la academia con la misma clave_idempotencia fallan con 23505; en otra academia la misma clave se acepta', async () => {
      const uno = await clienteNuevo();
      const dos = await clienteNuevo();
      const deB = await clienteNuevo('B');
      const clave = randomUUID();
      await insertar(uno, fila(uno, {}, { clave_idempotencia: clave }));

      await rechazado(dos, fila(dos, {}, { clave_idempotencia: clave }), '23505');
      await insertar(deB, fila(deB, {}, { clave_idempotencia: clave }));

      expect((await leerPagos(deB.academiaId)).filter((p) => p.clave_idempotencia === clave)).toHaveLength(1);
    });

    it('criterio 4 h: dos pagos de la academia con el mismo numero_ticket fallan con 23505; en otra academia el mismo número se acepta', async () => {
      const uno = await clienteNuevo();
      const dos = await clienteNuevo();
      const ticket = 500 + Math.floor(Math.random() * 100);
      await crearPagoConfirmadoConMovimiento(uno.academiaId, {
        cajaId,
        alumnoId: uno.alumnoId,
        matriculaId: uno.matriculaId,
        usuarioId: uno.usuarioId,
        numeroTicket: ticket,
      });

      await rechazado(dos, fila(dos, { metodo: 'EFECTIVO', estado: 'CONFIRMADO', numeroTicket: ticket }), '23505');
      expect((await leerPagos(uno.academiaId)).filter((p) => p.numero_ticket === ticket)).toHaveLength(1);
    });
  });
});
