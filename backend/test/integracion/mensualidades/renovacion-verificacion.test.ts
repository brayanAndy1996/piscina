// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cerrarCajaDePrueba, leerCajas, leerMovimientos, totalesDeCaja } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet, leerQr } from '../../utilidades/escenario-carnet';
import { rutaAprobacion, rutaRechazo } from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  cuantasDelMes,
  detallesDe,
  DICIEMBRE,
  estadoDelAlumno,
  INSTANTES,
  instantaneaDeRenovacion,
  matriculaDelMes,
  MES_DICIEMBRE,
  MES_NOVIEMBRE,
  NOVIEMBRE,
  ponerCorreos,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
  resumen,
} from '../../utilidades/escenario-renovacion';
import { crearPlanYClaseSabado, llenarClase, ocupacionDeClase } from '../../utilidades/inscripciones';
import { dejarPasarEventos } from '../../utilidades/inscripciones-ronda1';
import { esperarHasta } from '../../utilidades/modulos';
import { leerPagos } from '../../utilidades/pagos';
import { leerUsuarios } from '../../utilidades/usuarios';

// Criterio 15 (crítico, HU-09, D-04, RN-28): con las rutas de la 007b, aprobar una renovación exige la caja abierta de hoy, el ingreso entra con su método (`YAPE` o `TRANSFERENCIA`, no suma al efectivo, D-04), la matrícula pasa a `VIGENTE`, recibe ticket y no se crea
// cuenta ni cambia el QR; si la matrícula es de M y el alumno está `ALUMNO_VENCIDO`, pasa a `ALUMNO_ACTIVO`. Rechazar exige motivo, deja la matrícula `CANCELADA` y libera el cupo; el alumno puede registrar otra renovación del mismo mes. Aprobar dos veces responde 200
// sin otro movimiento; aprobar un rechazado, 409 `PAGO_YA_RECHAZADO`. Después de confirmar, se envían las plantillas `RENOVACION_CONFIRMADA` y `RENOVACION_RECHAZADA` (con el motivo) al correo del alumno y, si es menor, al de su apoderado, una vez por dirección, con la
// academia, el mes y el plan, sin DNI, token ni credenciales (DR-7); un reintento no envía nada. En efectivo no se envía correo (el alumno recibe su ticket en el acto, DR-7).
// Lecturas estrictas elegidas: (1) el estado de un `ALUMNO_VENCIDO` pasa a `ALUMNO_ACTIVO` cuando la matrícula aprobada es de M en el instante de la aprobación; la aprobación de la de M+1 no lo cambia; (2) el correo se envía después de confirmar: cuando el enviador
// recibe el mensaje, el pago ya está `CONFIRMADO` o `RECHAZADO` en la base; (3) el mes viaja en alguno de los textos del correo como `2026-12` o como su nombre en español; el plan, por su nombre; (4) «sin credenciales» es: ningún texto lleva el DNI, el token del QR ni un hash de
// contraseña; (5) rechazar un pago de renovación no toca el estado del alumno.

describe('aprobar y rechazar una renovación (criterio 15)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    await abrirCajaPara(esc, INSTANTES.viernes27);
    cookies = en(ctx, esc, INSTANTES.viernes27);
    ctx.correo.alEnviar = undefined;
    ctx.correo.fallar = false;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const yape = async (alumnoId: string, opciones: Parameters<typeof registrarRenovacion>[5] = {}) => {
    const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumnoId, opciones);
    return renovacionDe(respuesta, 201);
  };
  const aprobar = (pagoId: string, cookie = cookies.secretaria) =>
    ctx.http.post(rutaAprobacion(pagoId), {}, { cookie });
  const rechazar = (pagoId: string, motivo = 'La imagen no se lee, sube otra foto', cookie = cookies.secretaria) =>
    ctx.http.post(rutaRechazo(pagoId), { motivo }, { cookie });
  const cajaAbierta = async () => (await leerCajas(esc.e.A.id)).find((c) => c.estado === 'ABIERTA');

  describe('aprobar', () => {
    it.each(['YAPE', 'TRANSFERENCIA'] as const)(
      'criterio 15: aprobar una renovación por %s con la caja de hoy abierta: 200 CONFIRMADO con ticket; ingreso con su método que no suma al efectivo; matrícula VIGENTE; sin cuenta nueva ni cambio del QR',
      async (metodo) => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const { respuesta: creada } = await registrarRenovacion(ctx, esc, metodo, cookies.secretaria, alumno.alumnoId);
        const renovacion = renovacionDe(creada, 201);
        const caja = await cajaAbierta();
        const totalesAntes = await totalesDeCaja(esc.e.A.id, caja?.id ?? '');
        const usuariosAntes = (await leerUsuarios(esc.e.A.id)).length;
        const qrAntes = await leerQr(esc.e.A.id, alumno.alumnoId);

        const respuesta = await aprobar(renovacion.pago.id);

        expect(respuesta.status, respuesta.texto).toBe(200);
        const pago = (respuesta.body?.['pago'] ?? {}) as Record<string, unknown>;
        expect(pago).toMatchObject({
          id: renovacion.pago.id,
          estado: 'CONFIRMADO',
          metodo,
          concepto: 'MENSUALIDAD',
          monto: '120.00',
          verificadoEn: INSTANTES.viernes27.toISOString(),
        });
        expect(typeof pago['numeroTicket']).toBe('number');
        const fila = (await leerPagos(esc.e.A.id)).find((p) => p.id === renovacion.pago.id);
        expect(fila).toMatchObject({
          estado: 'CONFIRMADO',
          verificado_por: esc.e.secretariaA.id,
          registrado_por: esc.e.secretariaA.id,
        });
        expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toMatchObject({
          estado: 'VIGENTE',
          reserva_vence_en: null,
          solicitud_id: null,
        });
        const ingreso = (await leerMovimientos(esc.e.A.id)).find((m) => m.pago_id === renovacion.pago.id);
        expect(ingreso).toMatchObject({
          caja_id: caja?.id,
          tipo: 'INGRESO',
          concepto: 'MENSUALIDAD',
          metodo,
          monto: '120.00',
          alumno_id: alumno.alumnoId,
          registrado_por: esc.e.secretariaA.id,
        });
        const totales = await totalesDeCaja(esc.e.A.id, caja?.id ?? '');
        expect(totales.ingresosEfectivo, 'un Yape o una transferencia no suma al efectivo (D-04)').toBe(
          totalesAntes.ingresosEfectivo,
        );
        expect(metodo === 'YAPE' ? totales.ingresosYape : totales.ingresosTransferencia).toBe('120.00');
        expect((await leerUsuarios(esc.e.A.id)).length, 'no crea cuenta').toBe(usuariosAntes);
        expect(await leerQr(esc.e.A.id, alumno.alumnoId), 'no cambia el QR').toEqual(qrAntes);
        expect(await estadoDelAlumno(esc.e.A.id, alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
      },
    );

    it('criterio 15: aprobar la renovación de M (renovación tardía, S/ 20.00) de un ALUMNO_VENCIDO lo pasa a ALUMNO_ACTIVO; aprobar la de M+1 no lo cambia', async () => {
      const [deM, deM1] = [await crearAlumnoVencido(ctx, esc), await crearAlumnoVencido(ctx, esc)];
      const tardia = await yape(deM.alumnoId, {
        seleccion: { mes: MES_NOVIEMBRE },
        total: '20.00',
        fechaOperacion: '2026-11-27',
      });
      const siguiente = await yape(deM1.alumnoId);

      const a = await aprobar(tardia.pago.id);
      const b = await aprobar(siguiente.pago.id);

      expect(a.status, a.texto).toBe(200);
      expect(b.status, b.texto).toBe(200);
      expect(await estadoDelAlumno(esc.e.A.id, deM.alumnoId)).toBe('ALUMNO_ACTIVO');
      expect(await estadoDelAlumno(esc.e.A.id, deM1.alumnoId)).toBe('ALUMNO_VENCIDO');
      expect(await matriculaDelMes(esc.e.A.id, deM.alumnoId, NOVIEMBRE)).toMatchObject({ estado: 'VIGENTE' });
    });

    it('criterio 15: sin caja abierta (la de hoy está cerrada), 409 SIN_CAJA_ABIERTA, no queda nada escrito y el pago sigue pendiente', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const renovacion = await yape(alumno.alumnoId);
      const caja = await cajaAbierta();
      await cerrarCajaDePrueba(esc.e.A.id, caja?.id ?? '', esc.e.secretariaA.id);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const sinCaja = await aprobar(renovacion.pago.id);

      expect(resumen(sinCaja), sinCaja.texto).toEqual([409, 'SIN_CAJA_ABIERTA']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      expect((await leerPagos(esc.e.A.id)).find((p) => p.id === renovacion.pago.id)?.estado).toBe(
        'PENDIENTE_VERIFICACION',
      );
      expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toMatchObject({ estado: 'RESERVADA' });
    });

    it('criterio 15: con la caja abierta de otro día (la del 27/11 y hoy es el 28/11), 409 CAJA_DE_OTRO_DIA, no queda nada escrito y el pago sigue pendiente', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const renovacion = await yape(alumno.alumnoId);
      const alDiaSiguiente = en(ctx, esc, INSTANTES.sabado28);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const otroDia = await aprobar(renovacion.pago.id, alDiaSiguiente.secretaria);

      expect(resumen(otroDia), otroDia.texto).toEqual([409, 'CAJA_DE_OTRO_DIA']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      expect((await leerPagos(esc.e.A.id)).find((p) => p.id === renovacion.pago.id)?.estado).toBe(
        'PENDIENTE_VERIFICACION',
      );
    });

    it('criterio 15: aprobar dos veces responde 200 las dos con el mismo pago, un solo movimiento, un solo ticket y una sola auditoría PAGO_APROBADO, aunque la caja ya esté cerrada', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const renovacion = await yape(alumno.alumnoId);
      const primera = await aprobar(renovacion.pago.id);
      const movimientos = (await leerMovimientos(esc.e.A.id)).length;
      const caja = await cajaAbierta();
      await cerrarCajaDePrueba(esc.e.A.id, caja?.id ?? '', esc.e.secretariaA.id);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const segunda = await aprobar(renovacion.pago.id, cookies.admin);

      expect(primera.status, primera.texto).toBe(200);
      expect(segunda.status, segunda.texto).toBe(200);
      expect(segunda.body).toEqual(primera.body);
      expect((await leerMovimientos(esc.e.A.id)).length).toBe(movimientos);
      expect(await leerAuditoriaDeAcademia(esc.e.A.id, 'PAGO_APROBADO')).toHaveLength(1);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    it('criterio 15 y DR-2 de 007: una renovación de noviembre en verificación se puede aprobar el 1/12 con la caja de ese día: queda VIGENTE en noviembre y entra a la caja de hoy', async () => {
      const alumno = await crearAlumnoVencido(ctx, esc);
      const renovacion = await yape(alumno.alumnoId, {
        seleccion: { mes: MES_NOVIEMBRE },
        total: '20.00',
        fechaOperacion: '2026-11-27',
      });
      await abrirCajaPara(esc, INSTANTES.primeroDeDiciembre);
      const alDiaSiguiente = en(ctx, esc, INSTANTES.primeroDeDiciembre);

      const respuesta = await aprobar(renovacion.pago.id, alDiaSiguiente.secretaria);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, NOVIEMBRE)).toMatchObject({ estado: 'VIGENTE' });
      expect((await leerMovimientos(esc.e.A.id)).find((m) => m.pago_id === renovacion.pago.id)?.monto).toBe('20.00');
    });
  });

  describe('rechazar', () => {
    it('criterio 15: rechazar con motivo: 200 RECHAZADO con el motivo; la matrícula queda CANCELADA sin vencimiento; no hay movimiento ni ticket; el estado del alumno no cambia', async () => {
      const alumno = await crearAlumnoVencido(ctx, esc);
      const renovacion = await yape(alumno.alumnoId);
      const movimientosAntes = (await leerMovimientos(esc.e.A.id)).length;

      const respuesta = await rechazar(renovacion.pago.id);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.body?.['pago']).toMatchObject({
        id: renovacion.pago.id,
        estado: 'RECHAZADO',
        motivoRechazo: 'La imagen no se lee, sube otra foto',
        numeroTicket: null,
      });
      expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toMatchObject({
        estado: 'CANCELADA',
        reserva_vence_en: null,
        solicitud_id: null,
      });
      expect((await leerMovimientos(esc.e.A.id)).length).toBe(movimientosAntes);
      expect(await estadoDelAlumno(esc.e.A.id, alumno.alumnoId)).toBe('ALUMNO_VENCIDO');
    });

    it.each(['', 'ab', '   '])(
      'criterio 15: el motivo %j no vale (3 a 200 caracteres visibles): 400 SOLICITUD_INVALIDA y el pago sigue pendiente',
      async (motivo) => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const renovacion = await yape(alumno.alumnoId);

        const respuesta = await rechazar(renovacion.pago.id, motivo);

        expect(resumen(respuesta), respuesta.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
        expect((await leerPagos(esc.e.A.id)).find((p) => p.id === renovacion.pago.id)?.estado).toBe(
          'PENDIENTE_VERIFICACION',
        );
      },
    );

    it('criterio 15: después de rechazar, el alumno puede registrar otra renovación del mismo mes (con otra clave) y también reusar el número de operación del rechazado', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const primera = await yape(alumno.alumnoId, { sobre: { numeroOperacion: '123456' } });
      expect((await rechazar(primera.pago.id)).status).toBe(200);

      const segunda = await yape(alumno.alumnoId, { sobre: { numeroOperacion: '123456' } });

      expect(segunda.renovacion.matriculaId).not.toBe(primera.renovacion.matriculaId);
      expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(2);
      expect((await aprobar(segunda.pago.id)).status).toBe(200);
    });

    it('criterio 15: rechazar libera el cupo: con la clase llena en diciembre por una renovación en verificación, otro alumno recibe SIN_CUPO y, rechazada la primera, entra (201)', async () => {
      const { plan, clase } = await crearPlanYClaseSabado(esc.e);
      await llenarClase(esc.e.A.id, clase.id, plan.id, 19, { mes: DICIEMBRE });
      const [primero, segundo] = [await crearAlumnoVencido(ctx, esc), await crearAlumnoVencido(ctx, esc)];
      const delSabado = { seleccion: { planId: plan.id, claseIds: [clase.id] }, total: '40.00' };
      const enVerificacion = await yape(primero.alumnoId, delSabado);
      expect(await ocupacionDeClase(esc.e.A.id, clase.id, DICIEMBRE, INSTANTES.viernes27)).toBe(20);
      const lleno = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, segundo.alumnoId, delSabado);
      expect(resumen(lleno.respuesta), lleno.respuesta.texto).toEqual([409, 'SIN_CUPO']);

      expect((await rechazar(enVerificacion.pago.id)).status).toBe(200);
      const libre = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, segundo.alumnoId, delSabado);

      expect(libre.respuesta.status, libre.respuesta.texto).toBe(201);
      expect(await ocupacionDeClase(esc.e.A.id, clase.id, DICIEMBRE, INSTANTES.viernes27)).toBe(20);
    });

    it('criterio 15: rechazar dos veces responde 200 las dos (una sola auditoría PAGO_RECHAZADO) y aprobar un rechazado responde 409 PAGO_YA_RECHAZADO sin escribir', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const renovacion = await yape(alumno.alumnoId);
      const uno = await rechazar(renovacion.pago.id);
      const otro = await rechazar(renovacion.pago.id, 'La imagen no se lee, sube otra foto', cookies.admin);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const aprobada = await aprobar(renovacion.pago.id);

      expect([uno.status, otro.status]).toEqual([200, 200]);
      expect(await leerAuditoriaDeAcademia(esc.e.A.id, 'PAGO_RECHAZADO')).toHaveLength(1);
      expect(resumen(aprobada), aprobada.texto).toEqual([409, 'PAGO_YA_RECHAZADO']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });
  });

  describe('los correos de la renovación (DR-7)', () => {
    const MOTIVO = 'La imagen no se lee, sube otra foto';

    /** Los textos de todos los datos de un mensaje, juntos. */
    const textoDe = (mensajes: typeof ctx.correo.mensajes) => JSON.stringify(mensajes);

    it('criterio 15: al aprobar se envía RENOVACION_CONFIRMADA una vez al correo del alumno, con la academia, el mes y el plan, después de confirmar y sin DNI, token ni credenciales', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await ponerCorreos(esc.e.A.id, alumno.alumnoId, { alumno: 'alumno.renueva@ejemplo.test' });
      const renovacion = await yape(alumno.alumnoId);
      ctx.correo.mensajes.length = 0;
      const estadosAlEnviar: (string | undefined)[] = [];
      ctx.correo.alEnviar = async () => {
        estadosAlEnviar.push((await leerPagos(esc.e.A.id)).find((p) => p.id === renovacion.pago.id)?.estado);
      };

      const respuesta = await aprobar(renovacion.pago.id);

      expect(respuesta.status, respuesta.texto).toBe(200);
      await esperarHasta(() => ctx.correo.mensajes.length >= 1);
      await dejarPasarEventos();
      expect(ctx.correo.mensajes).toHaveLength(1);
      expect(ctx.correo.mensajes[0]).toMatchObject({
        academiaId: esc.e.A.id,
        para: 'alumno.renueva@ejemplo.test',
        plantilla: 'RENOVACION_CONFIRMADA',
      });
      const texto = textoDe(ctx.correo.mensajes);
      expect(texto).toContain(esc.e.A.nombre);
      expect(texto).toContain(esc.e.plan.nombre);
      expect(texto).toMatch(/2026-12|diciembre/i);
      expect(texto).not.toContain(alumno.dni);
      expect(texto).not.toContain(alumno.token);
      expect(texto).not.toMatch(/\$argon2/);
      expect(estadosAlEnviar, 'el correo sale después de confirmar la transacción').toEqual(['CONFIRMADO']);
    });

    it('criterio 15: al rechazar se envía RENOVACION_RECHAZADA una vez con el motivo, el mes y el plan; sin DNI ni token', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await ponerCorreos(esc.e.A.id, alumno.alumnoId, { alumno: 'alumno.rechazado@ejemplo.test' });
      const renovacion = await yape(alumno.alumnoId);
      ctx.correo.mensajes.length = 0;
      const estadosAlEnviar: (string | undefined)[] = [];
      ctx.correo.alEnviar = async () => {
        estadosAlEnviar.push((await leerPagos(esc.e.A.id)).find((p) => p.id === renovacion.pago.id)?.estado);
      };

      const respuesta = await rechazar(renovacion.pago.id, MOTIVO);

      expect(respuesta.status, respuesta.texto).toBe(200);
      await esperarHasta(() => ctx.correo.mensajes.length >= 1);
      await dejarPasarEventos();
      expect(ctx.correo.mensajes).toHaveLength(1);
      expect(ctx.correo.mensajes[0]).toMatchObject({
        academiaId: esc.e.A.id,
        para: 'alumno.rechazado@ejemplo.test',
        plantilla: 'RENOVACION_RECHAZADA',
      });
      const texto = textoDe(ctx.correo.mensajes);
      expect(texto).toContain(MOTIVO);
      expect(texto).toContain(esc.e.plan.nombre);
      expect(texto).toMatch(/2026-12|diciembre/i);
      expect(texto).not.toContain(alumno.dni);
      expect(texto).not.toContain(alumno.token);
      expect(estadosAlEnviar).toEqual(['RECHAZADO']);
    });

    it('criterio 15: un menor con correo propio y con el de su apoderado recibe dos mensajes (uno por dirección); con el mismo correo en los dos, uno solo; sin ningún correo, ninguno', async () => {
      const menor = await crearAlumnoDeNoviembre(ctx, esc, {
        conApoderado: true,
        fechaNacimiento: '2014-03-10',
      });
      const sinCorreo = await crearAlumnoDeNoviembre(ctx, esc);
      const mismo = await crearAlumnoDeNoviembre(ctx, esc, {
        conApoderado: true,
        fechaNacimiento: '2014-03-10',
      });
      await ponerCorreos(esc.e.A.id, menor.alumnoId, {
        alumno: 'menor@ejemplo.test',
        apoderado: 'apoderado@ejemplo.test',
      });
      await ponerCorreos(esc.e.A.id, mismo.alumnoId, {
        alumno: 'familia@ejemplo.test',
        apoderado: 'familia@ejemplo.test',
      });
      const [r1, r2, r3] = [await yape(menor.alumnoId), await yape(sinCorreo.alumnoId), await yape(mismo.alumnoId)];
      ctx.correo.mensajes.length = 0;

      await aprobar(r1.pago.id);
      await esperarHasta(() => ctx.correo.mensajes.length >= 2);
      await dejarPasarEventos();
      const delMenor = ctx.correo.mensajes.map((m) => m.para).sort();
      ctx.correo.mensajes.length = 0;
      await aprobar(r2.pago.id);
      await dejarPasarEventos();
      const sinNada = ctx.correo.mensajes.length;
      await aprobar(r3.pago.id);
      await esperarHasta(() => ctx.correo.mensajes.length >= 1);
      await dejarPasarEventos();

      expect(delMenor).toEqual(['apoderado@ejemplo.test', 'menor@ejemplo.test']);
      expect(sinNada).toBe(0);
      expect(ctx.correo.mensajes.map((m) => m.para)).toEqual(['familia@ejemplo.test']);
    });

    it('criterio 15: un reintento (aprobar dos veces o rechazar dos veces) no envía nada más', async () => {
      const [uno, otro] = [await crearAlumnoDeNoviembre(ctx, esc), await crearAlumnoDeNoviembre(ctx, esc)];
      await ponerCorreos(esc.e.A.id, uno.alumnoId, { alumno: 'uno@ejemplo.test' });
      await ponerCorreos(esc.e.A.id, otro.alumnoId, { alumno: 'otro@ejemplo.test' });
      const [aprobada, rechazada] = [await yape(uno.alumnoId), await yape(otro.alumnoId)];
      ctx.correo.mensajes.length = 0;

      await aprobar(aprobada.pago.id);
      await rechazar(rechazada.pago.id);
      await esperarHasta(() => ctx.correo.mensajes.length >= 2);
      await dejarPasarEventos();
      expect(ctx.correo.mensajes).toHaveLength(2);
      await aprobar(aprobada.pago.id);
      await rechazar(rechazada.pago.id);
      await dejarPasarEventos();

      expect(ctx.correo.mensajes.map((m) => m.plantilla).sort()).toEqual([
        'RENOVACION_CONFIRMADA',
        'RENOVACION_RECHAZADA',
      ]);
    });

    it('criterio 15: una renovación en efectivo no envía correo (el alumno recibe su ticket en el acto) y una aprobación o un rechazo que falla (409) tampoco', async () => {
      const [enEfectivo, sinCaja] = [await crearAlumnoDeNoviembre(ctx, esc), await crearAlumnoDeNoviembre(ctx, esc)];
      await ponerCorreos(esc.e.A.id, enEfectivo.alumnoId, { alumno: 'efectivo@ejemplo.test' });
      await ponerCorreos(esc.e.A.id, sinCaja.alumnoId, { alumno: 'sin.caja@ejemplo.test' });
      const pendiente = await yape(sinCaja.alumnoId);
      const caja = await cajaAbierta();
      ctx.correo.mensajes.length = 0;

      const cobro = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, enEfectivo.alumnoId);
      await cerrarCajaDePrueba(esc.e.A.id, caja?.id ?? '', esc.e.secretariaA.id);
      const fallida = await aprobar(pendiente.pago.id);
      await dejarPasarEventos();

      expect(cobro.respuesta.status, cobro.respuesta.texto).toBe(201);
      expect(resumen(fallida)).toEqual([409, 'SIN_CAJA_ABIERTA']);
      expect(ctx.correo.mensajes).toEqual([]);
    });

    it('criterio 15: un fallo del proveedor de correo no cambia la respuesta ni lo confirmado: el pago queda CONFIRMADO y responde 200', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await ponerCorreos(esc.e.A.id, alumno.alumnoId, { alumno: 'falla@ejemplo.test' });
      const renovacion = await yape(alumno.alumnoId);
      ctx.correo.fallar = true;

      const respuesta = await aprobar(renovacion.pago.id);
      await dejarPasarEventos();

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((await leerPagos(esc.e.A.id)).find((p) => p.id === renovacion.pago.id)?.estado).toBe('CONFIRMADO');
      expect(detallesDe(respuesta)).toEqual({});
    });
  });

  it('criterio 15: la renovación de diciembre aprobada deja la mensualidad lista para marcar el 2/12, con sus 12 clases (la aprobación no cambia las clases)', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    const renovacion = await yape(alumno.alumnoId);

    await aprobar(renovacion.pago.id);

    expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toMatchObject({
      estado: 'VIGENTE',
      clases_totales: 12,
      clases_usadas: 0,
    });
    expect(renovacion.renovacion.mes).toBe(MES_DICIEMBRE);
  });
});
