// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contarAuditoria } from '../../utilidades/usuarios';
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
  type AppInscripciones,
  codigoDe,
  crearAppInscripciones,
  type Objeto,
  rutaPublica,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';

// Criterio 24 (crítico, D-05, DR-14 de 005): la consulta del seguimiento (por token o por código y DNI) de una solicitud `CONFIRMADA` responde la vista de confirmada (criterio 28) y la página muestra que el
// pago está confirmado y cómo ingresar (`/a/{nombreCorto}/ingresar`, con su DNI; la página es de la web).
// Criterio 28 (crítico, D-05, DR-9 y DR-14 de 005, RNF-05): `vistaSolicitudSchema` (unión estricta por estado) suma `CONFIRMADA` con las claves de la vista completa de 005 salvo `reservaVenceEn` y sin `fotoCargada`,
// con `pago: { metodo, monto, confirmadoEn, numeroTicket }`. Ninguna lleva DNI, apellidos, número de operación, comprobante, quién verificó, ids internos ni el hash del token. La regla de DR-14 de 005 sigue: el
// nombre solo va en la solicitud vigente del cliente; una `VENCIDA` o `CANCELADA` muestra la vista reducida. Pruebas por token y por código con DNI, con el mismo cuerpo.

const CLAVES_DE_LA_VISTA_CONFIRMADA = [
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

describe('seguimiento de una solicitud confirmada (criterios 24 y 28)', () => {
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
    await abrirCajaDeHoy(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const porToken = (token: string, nombreCorto = 'academia-a') =>
    ctx.http.post(rutaPublica(nombreCorto, '/solicitudes/consulta'), { token });
  const porCodigo = (codigo: string, dni: string) =>
    ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { codigo, dni });
  const vista = (respuesta: { body: Objeto | null }) => respuesta.body?.['solicitud'] as Objeto;

  async function confirmada() {
    const cliente = await sembrarCobrable(e, { nombres: 'Valeria Isabel', apellidos: 'Mendoza Salas' });
    const cobro = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), {
      cookie: cookies.secretaria,
    });
    expect(cobro.status, cobro.texto).toBe(201);
    return { cliente, pagoId: pagoDe(cobro).id };
  }

  it('criterio 24 y 28: por token responde 200 con la vista CONFIRMADA: las claves de la vista completa sin reservaVenceEn ni fotoCargada, y el pago { metodo, monto, confirmadoEn, numeroTicket }', async () => {
    const { cliente } = await confirmada();

    const respuesta = await porToken(cliente.token);

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(respuesta.cacheControl).toBe('no-store');
    expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['academia', 'solicitud']);
    expect(Object.keys(vista(respuesta)).sort()).toEqual(CLAVES_DE_LA_VISTA_CONFIRMADA);
    expect(vista(respuesta)).toMatchObject({
      codigo: cliente.codigo,
      estado: 'CONFIRMADA',
      nombres: 'Valeria',
      mes: '2026-11',
      clasesTotales: 5,
      monto: '42.00',
      esProporcional: true,
      pago: { metodo: 'EFECTIVO', monto: '42.00', confirmadoEn: AHORA_007.toISOString(), numeroTicket: 1 },
    });
    expect(Object.keys(vista(respuesta)['pago'] as Objeto).sort()).toEqual([
      'confirmadoEn',
      'metodo',
      'monto',
      'numeroTicket',
    ]);
    expect(respuesta.body?.['academia']).toEqual({ nombre: 'Academia A', telefono: null });
  });

  it('criterio 24: por código y DNI responde exactamente lo mismo que por token (el mismo cuerpo)', async () => {
    const { cliente } = await confirmada();

    const token = await porToken(cliente.token);
    const codigo = await porCodigo(cliente.codigo.toLowerCase(), ` ${cliente.dni} `);

    expect(codigo.status, codigo.texto).toBe(200);
    expect(codigo.texto).toBe(token.texto);
  });

  it('criterio 28: la vista no lleva el DNI, los apellidos, el número de operación, el comprobante, quién verificó, ids internos ni el hash del token', async () => {
    const { cliente, pagoId } = await confirmada();

    const respuesta = await porToken(cliente.token);

    const texto = respuesta.texto;
    for (const prohibido of [
      cliente.dni,
      'Mendoza',
      'Salas',
      cliente.token,
      pagoId,
      cliente.alumnoId,
      cliente.solicitudId,
      cliente.matriculaId,
      e.secretariaA.id,
      e.secretariaA.nombres,
      'numeroOperacion',
      'comprobante',
      'verificadoPor',
      'tokenHash',
      'fotoCargada',
      'reservaVenceEn',
      'apoderado',
      'fichaMedica',
    ]) {
      expect(texto, `la vista lleva ${prohibido}`).not.toContain(prohibido);
    }
  });

  it('criterio 24: la consulta es de solo lectura: no escribe ni audita, y se puede repetir', async () => {
    const { cliente } = await confirmada();
    const antes = { academia: await instantaneaDeLaAcademia(e.A.id), auditoria: await contarAuditoria(e.A.id) };

    const uno = await porToken(cliente.token);
    const dos = await porToken(cliente.token);

    expect(uno.texto).toBe(dos.texto);
    expect({ academia: await instantaneaDeLaAcademia(e.A.id), auditoria: await contarAuditoria(e.A.id) }).toEqual(
      antes,
    );
  });

  it('criterio 24 y 31 de 005: el mismo 404 de siempre para un token de otra academia o un código con el DNI equivocado', async () => {
    const { cliente } = await confirmada();

    const deB = await porToken(cliente.token, 'academia-b');
    const otroDni = await porCodigo(cliente.codigo, '11112222');

    for (const r of [deB, otroDni]) expect([r.status, codigoDe(r)], r.texto).toEqual([404, 'SOLICITUD_NO_ENCONTRADA']);
  });

  it('criterio 28 y DR-14 de 005: la solicitud CONFIRMADA es la vigente del cliente (con nombre); la anterior VENCIDA de la misma persona muestra la vista reducida, sin nombre ni pago', async () => {
    const anterior = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id],
      estado: 'VENCIDA',
      nombres: 'Valeria Isabel',
      apellidos: 'Mendoza Salas',
    });
    const vencida = await porToken(anterior.token);

    expect(Object.keys(vista(vencida)).sort()).toEqual(
      ['clases', 'clasesTotales', 'codigo', 'creadaEn', 'esProporcional', 'estado', 'mes', 'monto', 'plan'].sort(),
    );
    expect(vista(vencida)['estado']).toBe('VENCIDA');
    expect(vencida.texto).not.toContain('Valeria');
    expect(vencida.texto).not.toContain('pago');
  });

  it('criterio 28: una solicitud sin pagar sigue con su vista completa (PENDIENTE_PAGO, con fotoCargada y reservaVenceEn, sin pago): las vistas de la 005 no cambian', async () => {
    const cliente = await sembrarCobrable(e);

    const respuesta = await porToken(cliente.token);

    expect(Object.keys(vista(respuesta)).sort()).toEqual(
      [
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
        'plan',
        'reservaVenceEn',
      ].sort(),
    );
    expect(vista(respuesta)['estado']).toBe('PENDIENTE_PAGO');
  });

  it('criterio 28: el monto de la vista es el total a cobrar (con un ajuste, el ajustado) y, confirmada, el del pago', async () => {
    const cliente = await sembrarCobrable(e);
    const ajuste = await ctx.http.post(
      `/api/solicitudes/${cliente.solicitudId}/ajuste-monto`,
      { montoAjustado: '35', motivo: 'Descuento autorizado' },
      { cookie: cookies.admin },
    );
    expect(ajuste.status, ajuste.texto).toBe(200);
    expect(vista(await porToken(cliente.token))['monto']).toBe('35.00');

    await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('35'), { cookie: cookies.secretaria });

    const confirmadaVista = vista(await porToken(cliente.token));
    expect(confirmadaVista['monto']).toBe('35.00');
    expect(confirmadaVista['pago']).toMatchObject({ monto: '35.00' });
  });
});
