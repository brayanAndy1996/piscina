import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerFilasConfiguracion } from '../../utilidades/configuracion';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  AHORA_007,
  cookiesDePagos,
  crearEscenarioDePagos,
  type EscenarioPagos,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import { consultarPorToken } from '../../utilidades/escenario-pagos-007b';
import { sembrarSolicitud } from '../../utilidades/inscripciones';
import { type AppConAlmacen, crearAppConAlmacen, exigirAlmacen } from '../../utilidades/inscripciones-005b';

// Criterio 53 de la 007 [007b] (prueba obligatoria, no protegida): los datos de pago de la academia (`yapeNumero`, `yapeTitular`, `transferenciaBanco`,
// `transferenciaCuenta`, `transferenciaCci` y `transferenciaTitular`) se guardan con `PATCH /api/configuracion` (`CONFIGURAR_ACADEMIA`), la
// configuración los devuelve solo si tienen valor y la consulta del seguimiento los devuelve en `academia.datosDePago` cuando la solicitud espera
// el pago (`PENDIENTE_PAGO` o `PAGO_RECHAZADO`). Los valores esperados están escritos a mano.

const DATOS = {
  yapeNumero: '987654321',
  yapeTitular: 'Academia Delfines SAC',
  transferenciaBanco: 'Banco de Ejemplo',
  transferenciaCuenta: '191-0000000-0-00',
  transferenciaCci: '00219100000000000055',
  transferenciaTitular: 'Academia Delfines SAC',
};

describe('datos de pago de la academia (criterio 53)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ ahora: AHORA_007 });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const guardar = (cuerpo: unknown, cookie = cookies.admin) => ctx.http.patch('/api/configuracion', cookie, cuerpo);

  it('sin datos de pago, GET /api/configuracion trae solo los seis campos de siempre', async () => {
    const respuesta = await ctx.http.get('/api/configuracion', { cookie: cookies.admin });

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(Object.keys(respuesta.body?.['configuracion'] ?? {}).sort()).toEqual([
      'diasPorVencer',
      'diasPrioridadRenovacion',
      'intentosInicioSesion',
      'minutosBloqueo',
      'telefono',
      'toleranciaTardanzaMinutos',
    ]);
  });

  it('el administrador guarda los seis datos de pago; el GET y el PATCH los devuelven y se audita la configuración', async () => {
    const respuesta = await guardar(DATOS);

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(respuesta.body?.['configuracion']).toMatchObject(DATOS);
    const lectura = await ctx.http.get('/api/configuracion', { cookie: cookies.admin });
    expect(lectura.body?.['configuracion']).toMatchObject(DATOS);
    expect((await leerFilasConfiguracion(e.A.id)).map((fila) => fila.clave).sort()).toEqual([
      'transferencia_banco',
      'transferencia_cci',
      'transferencia_cuenta',
      'transferencia_titular',
      'yape_numero',
      'yape_titular',
    ]);
    expect(await leerAuditoriaDeAcademia(e.A.id, 'CONFIGURACION_ACTUALIZADA')).toHaveLength(1);
    expect(
      (await ctx.http.get('/api/configuracion', { cookie: cookies.adminB })).body?.['configuracion'],
    ).not.toHaveProperty('yapeNumero');
  });

  it('la secretaria no los cambia (CONFIGURAR_ACADEMIA es del administrador)', async () => {
    const respuesta = await guardar({ yapeNumero: '987654321' }, cookies.secretaria);

    expect(respuesta.status).toBe(403);
    expect(await leerFilasConfiguracion(e.A.id)).toEqual([]);
  });

  it.each([
    ['un celular de 8 dígitos', { yapeNumero: '98765432' }],
    ['un celular que no empieza con 9', { yapeNumero: '887654321' }],
    ['un celular con letras', { yapeNumero: '98765432a' }],
    ['un titular vacío', { yapeTitular: '   ' }],
    ['un titular con un carácter de control', { yapeTitular: 'Delfines\u0007' }],
    ['un banco de más de 80 caracteres', { transferenciaBanco: 'B'.repeat(81) }],
    ['una cuenta de más de 40 caracteres', { transferenciaCuenta: '1'.repeat(41) }],
    ['un campo que no es del contrato', { yapeCelular: '987654321' }],
  ])('rechaza %s con 400 y no escribe', async (_nombre, cuerpo) => {
    const respuesta = await guardar(cuerpo);

    expect(respuesta.status, respuesta.texto).toBe(400);
    expect(await leerFilasConfiguracion(e.A.id)).toEqual([]);
  });

  it('el celular se guarda sin espacios ni guiones y null quita un dato (deja de aparecer)', async () => {
    const primero = await guardar({ yapeNumero: ' 987-654 321 ', yapeTitular: 'Delfines' });
    expect(primero.body?.['configuracion']).toMatchObject({ yapeNumero: '987654321', yapeTitular: 'Delfines' });

    const quitado = await guardar({ yapeTitular: null });

    expect(quitado.status, quitado.texto).toBe(200);
    expect(quitado.body?.['configuracion']).toMatchObject({ yapeNumero: '987654321' });
    expect(quitado.body?.['configuracion']).not.toHaveProperty('yapeTitular');
    const lectura = await ctx.http.get('/api/configuracion', { cookie: cookies.admin });
    expect(lectura.body?.['configuracion']).not.toHaveProperty('yapeTitular');
  });

  it('el seguimiento devuelve en academia.datosDePago solo los que tienen valor, con la solicitud PENDIENTE_PAGO', async () => {
    const cliente = await sembrarCobrable(e);
    await guardar({ yapeNumero: '987654321', transferenciaBanco: 'Banco de Ejemplo' });

    const respuesta = await consultarPorToken(ctx, cliente.token);

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect((respuesta.body?.['solicitud'] as { estado: string }).estado).toBe('PENDIENTE_PAGO');
    expect(respuesta.body?.['academia']).toEqual({
      nombre: 'Academia A',
      telefono: null,
      datosDePago: { yapeNumero: '987654321', transferenciaBanco: 'Banco de Ejemplo' },
    });
  });

  it('sin datos de pago configurados, la academia del seguimiento no trae datosDePago', async () => {
    const cliente = await sembrarCobrable(e);

    const respuesta = await consultarPorToken(ctx, cliente.token);

    expect(respuesta.body?.['academia']).toEqual({ nombre: 'Academia A', telefono: null });
  });

  it('con la solicitud vencida o cancelada no se devuelven los datos de pago, y los de A no llegan a B', async () => {
    await guardar(DATOS);
    const cancelada = await sembrarCobrable(e, { estado: 'CANCELADA' });
    const deB = await sembrarSolicitud(e.B.id, {
      planId: e.planB.id,
      claseIds: [e.lunesB.id],
      clasesTotales: 5,
      clasesPorMesPlan: 12,
      precioPlan: '100.00',
      monto: '42.00',
    });

    const deA = await consultarPorToken(ctx, cancelada.token);
    const enB = await consultarPorToken(ctx, deB.token, 'academia-b');

    expect((deA.body?.['solicitud'] as { estado: string }).estado).toBe('CANCELADA');
    expect(deA.body?.['academia']).not.toHaveProperty('datosDePago');
    expect(enB.status, enB.texto).toBe(200);
    expect(enB.body?.['academia']).not.toHaveProperty('datosDePago');
    expect(enB.texto).not.toContain(DATOS.yapeNumero);
  });
});
