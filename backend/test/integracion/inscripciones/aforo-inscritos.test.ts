// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { actualizarFila, leerClase } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS, cookieDeUsuario, crearUsuarioDePrueba, CLAVE_COMUN } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  detallesDe,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerMatriculas,
  llenarClase,
  rutaPublica,
  sembrarSolicitud,
  VEINTICUATRO_HORAS,
} from '../../utilidades/inscripciones';

// Criterio 41 (crítico, HU-17, RN-11, DR-5 de 004): `PATCH /api/clases/{id}` con un `aforo` menor que los inscritos de la clase responde
// 409 AFORO_MENOR_QUE_INSCRITOS con `detalles.inscritos`, sin escribir ni auditar, salvo que el cuerpo traiga `confirmarAforoMenor: true`;
// con la confirmación se guarda (200), nadie pierde su lugar y la clase no recibe inscripciones nuevas hasta que su ocupación baje del
// aforo. La auditoría CLASE_ACTUALIZADA suma `inscritos` y `confirmacion: 'AFORO_MENOR_QUE_INSCRITOS'` en `datosDespues`. Un aforo mayor o
// igual que los inscritos se guarda como en la 004 (`confirmarAforoMenor` se ignora). Los inscritos son la mayor ocupación entre el mes
// en curso y los siguientes, sin reservas vencidas ni canceladas.
// Criterio 42 (crítico, DR-5 de 004): `activo: false` sobre una clase con inscritos responde 409 CLASE_CON_INSCRITOS con
// `detalles.inscritos`, sin escribir ni auditar; sin inscritos (o con todas sus reservas vencidas o canceladas) se desactiva como en la 004.

describe('aforo menor que los inscritos y desactivar con inscritos (criterios 41 y 42)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  let cookie: string;
  const proximoMes = { anio: 2026, mes: 12 };

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
    cookie = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    await actualizarFila('propietario', 'clases', e.A.id, e.lunes.id, { aforo: 30 });
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const patch = (cuerpo: unknown, claseId = e.lunes.id, galleta = cookie) =>
    ctx.http.patch(`/api/clases/${claseId}`, galleta, cuerpo);
  const auditoria = async () =>
    (await leerAuditoriaDeAcademia(e.A.id, 'CLASE_ACTUALIZADA')).filter((fila) => fila.entidad_id === e.lunes.id);
  const aforoActual = async () => (await leerClase(e.A.id, e.lunes.id))?.aforo;
  async function estado() {
    return {
      clase: JSON.stringify(await leerClase(e.A.id, e.lunes.id)),
      matriculas: await instantaneaDeInscripciones(e.A.id),
      auditoria: (await auditoria()).length,
    };
  }

  describe('criterio 41: bajar el aforo por debajo de los inscritos', () => {
    it('criterio 41: con 25 inscritos, bajar el aforo a 22 sin confirmar responde 409 AFORO_MENOR_QUE_INSCRITOS con detalles.inscritos 25 y no escribe ni audita', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 25);
      const antes = await estado();

      const respuesta = await patch({ aforo: 22 });

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'AFORO_MENOR_QUE_INSCRITOS']);
      expect(detallesDe(respuesta)['inscritos']).toBe(25);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(await estado()).toEqual(antes);
      expect(await aforoActual()).toBe(30);
    });

    it('criterio 41: con confirmarAforoMenor false sigue siendo 409 (solo true confirma)', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 25);

      const respuesta = await patch({ aforo: 22, confirmarAforoMenor: false });

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'AFORO_MENOR_QUE_INSCRITOS']);
      expect(await aforoActual()).toBe(30);
    });

    it('criterio 41: confirmarAforoMenor que no es booleano responde 400 SOLICITUD_INVALIDA', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 25);

      for (const valor of ['true', 1, null]) {
        const respuesta = await patch({ aforo: 22, confirmarAforoMenor: valor });
        expect([respuesta.status, codigoDe(respuesta)], JSON.stringify(valor)).toEqual([400, 'SOLICITUD_INVALIDA']);
      }
    });

    it('criterio 41: con confirmarAforoMenor true se guarda (200), nadie pierde su lugar y la auditoría suma inscritos y confirmacion', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 25);
      const matriculasAntes = (await leerMatriculas(e.A.id)).map((m) => `${m.id}:${m.estado}`).sort();

      const respuesta = await patch({ aforo: 22, confirmarAforoMenor: true });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((respuesta.body?.['clase'] as { aforo: number }).aforo).toBe(22);
      expect(await aforoActual()).toBe(22);
      expect((await leerMatriculas(e.A.id)).map((m) => `${m.id}:${m.estado}`).sort(), 'nadie pierde su lugar').toEqual(
        matriculasAntes,
      );
      const [fila] = await auditoria();
      expect(await auditoria()).toHaveLength(1);
      expect(fila).toMatchObject({
        actor_tipo: 'USUARIO',
        actor_id: e.adminA.id,
        entidad: 'clase',
        entidad_id: e.lunes.id,
      });
      expect(fila?.datos_antes).toMatchObject({ aforo: 30 });
      expect(fila?.datos_despues).toMatchObject({
        aforo: 22,
        inscritos: 25,
        confirmacion: 'AFORO_MENOR_QUE_INSCRITOS',
      });
    });

    it('criterio 41: la clase con el aforo por debajo de la ocupación deja de ofrecerse y no recibe inscripciones nuevas (SIN_CUPO) hasta que la ocupación baje del aforo', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 25);
      await patch({ aforo: 22, confirmarAforoMenor: true });

      const lectura = await ctx.http.get(rutaPublica('academia-a', '/inscripcion'));
      const envio = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));

      expect((lectura.body?.['clases'] as { id: string }[]).map((c) => c.id)).not.toContain(e.lunes.id);
      expect([envio.status, codigoDe(envio)]).toEqual([409, 'SIN_CUPO']);
    });

    it('criterio 41: un aforo igual a los inscritos se guarda como en la 004, sin confirmar, y la auditoría no suma inscritos ni confirmacion', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 25);

      const respuesta = await patch({ aforo: 25 });

      expect(respuesta.status, respuesta.texto).toBe(200);
      const [fila] = await auditoria();
      expect(fila?.datos_antes).toEqual({ aforo: 30 });
      expect(fila?.datos_despues).toEqual({ aforo: 25 });
    });

    it('criterio 41: un aforo mayor que los inscritos se guarda como en la 004 y confirmarAforoMenor se ignora (sin inscritos ni confirmacion en la auditoría)', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 25);

      const respuesta = await patch({ aforo: 28, confirmarAforoMenor: true });

      expect(respuesta.status, respuesta.texto).toBe(200);
      const [fila] = await auditoria();
      expect(fila?.datos_despues).toEqual({ aforo: 28 });
    });

    it('criterio 41: sin inscritos se puede bajar el aforo hasta el mínimo sin confirmar', async () => {
      const respuesta = await patch({ aforo: 20 });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(await aforoActual()).toBe(20);
      expect((await auditoria())[0]?.datos_despues).toEqual({ aforo: 20 });
    });

    it('criterio 41: los inscritos son la mayor ocupación entre el mes en curso y los siguientes: 27 en diciembre pesan más que 5 en noviembre', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 5);
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 27, { mes: proximoMes });

      const sinConfirmar = await patch({ aforo: 26 });
      const aforoIgual = await patch({ aforo: 27 });

      expect([sinConfirmar.status, codigoDe(sinConfirmar)]).toEqual([409, 'AFORO_MENOR_QUE_INSCRITOS']);
      expect(detallesDe(sinConfirmar)['inscritos']).toBe(27);
      expect(aforoIgual.status, aforoIgual.texto).toBe(200);
    });

    it('criterio 41: los meses pasados no cuentan: 30 inscritos de octubre no impiden bajar el aforo', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 30, { mes: { anio: 2026, mes: 10 } });

      const respuesta = await patch({ aforo: 21 });

      expect(respuesta.status, respuesta.texto).toBe(200);
    });

    it('criterio 41: las reservas vencidas y las canceladas no cuentan como inscritos; las vigentes y las sin vencimiento sí', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 10, {
        estado: 'RESERVADA',
        reservaVenceEn: new Date(AHORA_005.getTime() - 1000),
      });
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'CANCELADA' });
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'VENCIDA' });
      const libre = await patch({ aforo: 20 });
      expect(libre.status, 'con todas las reservas vencidas o canceladas no hay inscritos').toBe(200);

      await actualizarFila('propietario', 'clases', e.A.id, e.lunes.id, { aforo: 30 });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 12, {
        estado: 'RESERVADA',
        reservaVenceEn: new Date(AHORA_005.getTime() + VEINTICUATRO_HORAS),
      });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 6, { estado: 'RESERVADA', reservaVenceEn: null });
      const conInscritos = await patch({ aforo: 20 });

      expect([conInscritos.status, codigoDe(conInscritos)]).toEqual([409, 'AFORO_MENOR_QUE_INSCRITOS']);
      expect(detallesDe(conInscritos)['inscritos']).toBe(18);
    });

    it('criterio 41: los inscritos de otra academia no cuentan', async () => {
      await llenarClase(e.B.id, e.lunesB.id, e.planB.id, 30);

      const respuesta = await patch({ aforo: 20 });

      expect(respuesta.status, respuesta.texto).toBe(200);
    });

    it('criterio 41: el 409 de ENTRENADOR_NO_VALIDO (004) se decide antes que el de los inscritos', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 25);
      const secretaria = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA', clave: CLAVE_COMUN });

      const respuesta = await patch({ aforo: 22, entrenadorId: secretaria.id });

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'ENTRENADOR_NO_VALIDO']);
      expect(await aforoActual()).toBe(30);
    });

    it('criterio 41: el permiso es el de la 004: la secretaria y el entrenador no cambian el aforo (403) aunque haya inscritos', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 25);

      for (const usuario of [e.secretariaA, e.entrenadorA]) {
        const respuesta = await patch(
          { aforo: 22, confirmarAforoMenor: true },
          e.lunes.id,
          cookieDeUsuario(usuario, AHORA_PRUEBAS),
        );
        expect(respuesta.status, usuario.rol).toBe(403);
      }
      expect(await aforoActual()).toBe(30);
    });
  });

  describe('criterio 42: no se desactiva una clase con inscritos', () => {
    it('criterio 42: desactivar una clase con inscritos responde 409 CLASE_CON_INSCRITOS con detalles.inscritos y no escribe ni audita', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 3);
      const antes = await estado();

      const respuesta = await patch({ activo: false });

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'CLASE_CON_INSCRITOS']);
      expect(detallesDe(respuesta)['inscritos']).toBe(3);
      expect(await estado()).toEqual(antes);
      expect((await leerClase(e.A.id, e.lunes.id))?.activo).toBe(true);
    });

    it('criterio 42: una sola reserva basta (una solicitud pendiente de pago con su reserva vigente)', async () => {
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });

      const respuesta = await patch({ activo: false });

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'CLASE_CON_INSCRITOS']);
      expect(detallesDe(respuesta)['inscritos']).toBe(1);
    });

    it('criterio 42: una inscripción del mes siguiente también cuenta (los inscritos son la mayor ocupación de este mes y los siguientes)', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 2, { mes: proximoMes });

      const respuesta = await patch({ activo: false });

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'CLASE_CON_INSCRITOS']);
      expect(detallesDe(respuesta)['inscritos']).toBe(2);
    });

    it('criterio 42: sin inscritos se desactiva como en la 004 (200) y se audita', async () => {
      const respuesta = await patch({ activo: false });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((await leerClase(e.A.id, e.lunes.id))?.activo).toBe(false);
      const [fila] = await auditoria();
      expect(fila?.datos_antes).toEqual({ activo: true });
      expect(fila?.datos_despues).toEqual({ activo: false });
    });

    it('criterio 42: con todas sus reservas vencidas o canceladas, o de un mes pasado, se desactiva (200)', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 3, {
        estado: 'RESERVADA',
        reservaVenceEn: new Date(AHORA_005.getTime() - 1000),
      });
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'CANCELADA' });
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'VENCIDA' });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 4, { mes: { anio: 2026, mes: 10 } });

      const respuesta = await patch({ activo: false });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((await leerClase(e.A.id, e.lunes.id))?.activo).toBe(false);
    });

    it('criterio 42: un cambio que deja la clase activa (activo true, o el mismo valor) no se bloquea por los inscritos', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 3);

      const respuesta = await patch({ activo: true });

      expect(respuesta.status, respuesta.texto).toBe(200);
    });

    it('criterio 42: los inscritos de otra academia no cuentan', async () => {
      await llenarClase(e.B.id, e.lunesB.id, e.planB.id, 3);

      const respuesta = await patch({ activo: false });

      expect(respuesta.status, respuesta.texto).toBe(200);
    });

    it('criterio 42: la clase de otra academia sigue siendo inexistente para el administrador de A (404, como en la 004)', async () => {
      await llenarClase(e.B.id, e.lunesB.id, e.planB.id, 3);

      const respuesta = await patch({ activo: false }, e.lunesB.id);

      expect(respuesta.status).toBe(404);
      expect((await leerClase(e.B.id, e.lunesB.id))?.activo).toBe(true);
    });

    it('criterio 42: el permiso es el de la 004: la secretaria no desactiva clases (403)', async () => {
      const respuesta = await patch({ activo: false }, e.lunes.id, cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS));

      expect(respuesta.status).toBe(403);
    });
  });
});
