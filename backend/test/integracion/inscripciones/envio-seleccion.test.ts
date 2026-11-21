// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actualizarFila, crearClaseDePrueba, crearPlanDePrueba } from '../../utilidades/planes-clases';
import { contarAuditoria } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  crearPlanDeDosVeces,
  cuerpoInscripcion,
  detallesDe,
  EnviadorDePrueba,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerSolicitudes,
  llenarClase,
  ocupacionDeClase,
  rutaPublica,
  sinUuid,
  VEINTICUATRO_HORAS,
} from '../../utilidades/inscripciones';

// Criterio 15 (crítico, HU-02, RN-07, RN-08, D-15, DR-2 de 004): plan y clases válidos.
//   a) un planId que no existe, de otra academia, inactivo, programado o vencido hoy, o que no aplica al nivel elegido responde 409
//      PLAN_NO_DISPONIBLE, con el mismo cuerpo en todos los casos;
//   b) las claseIds deben ser exactamente `vecesPorSemana` clases, en días distintos, todas activas, del nivel elegido, en un día de
//      `diasPermitidos` y en una franja de `franjasPermitidas`; si no, 409 SELECCION_NO_VALIDA con `detalles.errores[]`; un id que no
//      existe o de otra academia da ese mismo 409, sin distinguirlo de una clase inactiva;
//   c) si las clases elegidas no tienen ninguna clase restante en el mes, 409 SIN_CLASES_EN_EL_MES.
//   Ninguno escribe, audita ni envía correo.
// Criterio 17 (crítico, HU-02, RN-11): si alguna clase elegida no tiene cupos restantes, 409 SIN_CUPO con `detalles.clasesSinCupo` (los
// ids de todas las llenas), sin escribir, auditar ni enviar correo. Una clase con el aforo bajado por debajo de sus inscritos no tiene cupo.

describe('envío: plan y clases válidos (criterio 15) y cupo (criterio 17)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  const correo = new EnviadorDePrueba();
  const COLUMNAS_PLAN = {
    veces_por_semana: 3,
    clases_por_mes: 12,
    precio: '120.00',
    dias_permitidos: [1, 3, 5],
    franjas_permitidas: ['17:00', '18:00', '19:00'],
    niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
  };

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ correo });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    correo.mensajes.length = 0;
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
  const estado = async () => ({
    filas: await instantaneaDeInscripciones(e.A.id),
    filasB: await instantaneaDeInscripciones(e.B.id),
    auditoria: await contarAuditoria(e.A.id),
    correos: correo.mensajes.length,
  });

  describe('criterio 15 a: PLAN_NO_DISPONIBLE con el mismo cuerpo en todos los casos', () => {
    it('criterio 15 a: un plan que no existe, de otra academia, inactivo, programado, vencido o que no aplica al nivel responden 409 con el mismo cuerpo y no escriben', async () => {
      const inactivo = await crearPlanDePrueba(e.A.id, { ...COLUMNAS_PLAN, nombre: 'Inactivo', activo: false });
      const programado = await crearPlanDePrueba(e.A.id, {
        ...COLUMNAS_PLAN,
        nombre: 'Programado',
        vigencia_inicio: '2026-11-12',
      });
      const vencido = await crearPlanDePrueba(e.A.id, {
        ...COLUMNAS_PLAN,
        nombre: 'Vencido',
        vigencia_fin: '2026-11-10',
      });
      const soloAvanzado = await crearPlanDePrueba(e.A.id, {
        ...COLUMNAS_PLAN,
        nombre: 'Solo avanzado',
        niveles_aplicables: ['AVANZADO'],
      });
      const inexistente = { id: '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f', clases_por_mes: 12, precio: '120.00' };
      const antes = await estado();

      const respuestas = [];
      for (const plan of [inexistente, e.planB, inactivo, programado, vencido, soloAvanzado]) {
        respuestas.push(await enviar(await cuerpoInscripcion(e, { plan })));
      }

      for (const respuesta of respuestas) {
        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'PLAN_NO_DISPONIBLE']);
      }
      for (const respuesta of respuestas) expect(sinUuid(respuesta.texto)).toBe(sinUuid(respuestas[0]?.texto ?? ''));
      expect(await estado(), 'un 409 no escribe, no audita y no envía correo').toEqual(antes);
    });

    it('criterio 15 a: un plan que vence hoy o empieza hoy todavía se acepta (la fecha es la de Lima)', async () => {
      ctx.reloj.fijar(new Date('2026-11-12T03:00:00.000Z')); // 22:00 del 11 de noviembre en Lima
      const venceHoy = await crearPlanDePrueba(e.A.id, {
        ...COLUMNAS_PLAN,
        nombre: 'Vence hoy',
        vigencia_fin: '2026-11-11',
      });

      const respuesta = await enviar(await cuerpoInscripcion(e, { plan: venceHoy, ahora: ctx.reloj.ahora() }));

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 15 a: el nivel elegido decide: un plan solo para AVANZADO no aplica a BASICO pero sí a AVANZADO', async () => {
      const soloAvanzado = await crearPlanDePrueba(e.A.id, {
        ...COLUMNAS_PLAN,
        nombre: 'Solo avanzado',
        niveles_aplicables: ['AVANZADO'],
      });

      const basico = await enviar(await cuerpoInscripcion(e, { plan: soloAvanzado }));

      expect([basico.status, codigoDe(basico)]).toEqual([409, 'PLAN_NO_DISPONIBLE']);
    });

    it('criterio 15 a: un plan desactivado después de reservar no afecta a lo ya reservado (DR-2 de 004): solo deja de ofrecerse', async () => {
      const primero = await enviar(await cuerpoInscripcion(e));
      expect(primero.status, primero.texto).toBe(201);

      await actualizarFila('propietario', 'planes', e.A.id, e.plan.id, { activo: false });

      expect((await leerSolicitudes(e.A.id)).map((s) => s.estado)).toEqual(['PENDIENTE_PAGO']);
      const otro = await enviar(await cuerpoInscripcion(e));
      expect([otro.status, codigoDe(otro)]).toEqual([409, 'PLAN_NO_DISPONIBLE']);
    });
  });

  describe('criterio 15 b: SELECCION_NO_VALIDA', () => {
    const casos = (): [string, () => string[]][] => [
      ['dos clases para un plan de tres veces por semana', () => [e.lunes.id, e.miercoles.id]],
      [
        'cuatro clases para un plan de tres veces por semana',
        () => [e.lunes.id, e.miercoles.id, e.viernes.id, e.lunes17.id],
      ],
      ['dos clases el mismo día (lunes 17:00 y lunes 18:00)', () => [e.lunes.id, e.lunes17.id, e.miercoles.id]],
      [
        'una clase de otro nivel (INTERMEDIO con el nivel BASICO)',
        () => [e.intermedioLunes.id, e.miercoles.id, e.viernes.id],
      ],
      ['una clase en un día que el plan no permite (martes)', () => [e.martes.id, e.miercoles.id, e.viernes.id]],
      ['una clase en una franja que el plan no permite (08:00)', () => [e.lunes08.id, e.miercoles.id, e.viernes.id]],
    ];

    it.each(casos().map(([nombre]) => nombre))(
      'criterio 15 b: %s responde 409 SELECCION_NO_VALIDA con detalles.errores y no escribe',
      async (nombre) => {
        const pedido = casos().find(([n]) => n === nombre);
        const antes = await estado();

        const respuesta = await enviar(
          await cuerpoInscripcion(e, { sobre: { inscripcion: { claseIds: pedido?.[1]() } } }),
        );

        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
        const errores = detallesDe(respuesta)['errores'];
        expect(Array.isArray(errores) && errores.length > 0, 'detalles.errores[] no vacío').toBe(true);
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 15 b: una clase inexistente, una de otra academia y una inactiva responden el mismo 409 (sin distinguirlas)', async () => {
      await actualizarFila('propietario', 'clases', e.A.id, e.viernes.id, { activo: false });
      const pedir = async (viernes: string) =>
        enviar(
          await cuerpoInscripcion(e, { sobre: { inscripcion: { claseIds: [e.lunes.id, e.miercoles.id, viernes] } } }),
        );

      const inactiva = await pedir(e.viernes.id);
      const inexistente = await pedir('3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f');
      const deB = await pedir(e.viernesB.id);

      for (const respuesta of [inactiva, inexistente, deB]) {
        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
      }
      expect(sinUuid(inexistente.texto)).toBe(sinUuid(inactiva.texto));
      expect(sinUuid(deB.texto)).toBe(sinUuid(inactiva.texto));
      expect(deB.texto).not.toContain(e.viernesB.id);
    });

    it('criterio 15 b: otra clase válida del mismo día (lunes 17:00 en vez de lunes 18:00) se acepta', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e, { clases: [e.lunes17, e.miercoles, e.viernes] }));

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 15 b: la cantidad es la del plan: un plan de 2 veces por semana acepta exactamente 2 clases en días distintos y rechaza 3', async () => {
      const plan = await crearPlanDeDosVeces(e);

      const dos = await enviar(await cuerpoInscripcion(e, { plan, clases: [e.lunes, e.viernes] }));
      const tres = await enviar(await cuerpoInscripcion(e, { plan, clases: [e.lunes, e.miercoles, e.viernes] }));

      expect(dos.status, dos.texto).toBe(201);
      expect([tres.status, codigoDe(tres)]).toEqual([409, 'SELECCION_NO_VALIDA']);
    });

    it('criterio 15 b: una clase de otro nivel sí se acepta si el cuerpo pide ese nivel (el nivel decide las clases, D-15)', async () => {
      const plan = await crearPlanDePrueba(e.A.id, {
        ...COLUMNAS_PLAN,
        nombre: 'Una vez',
        veces_por_semana: 1,
        clases_por_mes: 4,
        precio: '40.00',
      });

      const respuesta = await enviar(
        await cuerpoInscripcion(e, {
          plan,
          clases: [e.intermedioLunes],
          sobre: { alumno: { nivel: 'INTERMEDIO' } },
        }),
      );

      expect(respuesta.status, respuesta.texto).toBe(201);
    });
  });

  describe('criterio 15 c: SIN_CLASES_EN_EL_MES', () => {
    it('criterio 15 c: el último día del mes después de la última clase (lunes 30 de noviembre a las 20:00 de Lima) responde 409 y no escribe', async () => {
      ctx.reloj.fijar(new Date('2026-12-01T01:00:00.000Z'));
      const antes = await estado();

      const respuesta = await enviar(
        await cuerpoInscripcion(e, { ahora: ctx.reloj.ahora(), sobre: { inscripcion: { montoMostrado: '120.00' } } }),
      );

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'SIN_CLASES_EN_EL_MES']);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 15 c: la clase de 19:00 del último día del mes: a las 18:59:59 de Lima todavía queda (201) y a las 19:00:00 ya no (409 SIN_CLASES_EN_EL_MES)', async () => {
      const plan = await crearPlanDePrueba(e.A.id, {
        ...COLUMNAS_PLAN,
        nombre: 'Una vez',
        veces_por_semana: 1,
        clases_por_mes: 4,
        precio: '40.00',
      });
      const lunes19 = await crearClaseDePrueba(e.A.id, e.entrenadorA.id, {
        nivel: 'AVANZADO',
        dia_semana: 1,
        hora_inicio: '19:00',
        aforo: 20,
      });
      const cuerpo = async (ahora: Date) =>
        cuerpoInscripcion(e, {
          plan,
          clases: [lunes19],
          ahora,
          sobre: { alumno: { nivel: 'AVANZADO' }, inscripcion: { montoMostrado: '10.00' } },
        });

      const despues = new Date('2026-12-01T00:00:00.000Z'); // 19:00:00 del lunes 30 de noviembre en Lima
      ctx.reloj.fijar(despues);
      const yaEmpezo = await enviar(await cuerpo(despues));
      expect([yaEmpezo.status, codigoDe(yaEmpezo)], yaEmpezo.texto).toEqual([409, 'SIN_CLASES_EN_EL_MES']);

      const antes = new Date('2026-11-30T23:59:59.000Z'); // 18:59:59 del lunes 30 de noviembre en Lima
      ctx.reloj.fijar(antes);
      const todaviaNo = await enviar(await cuerpo(antes));
      expect(todaviaNo.status, todaviaNo.texto).toBe(201);
    });
  });

  describe('criterio 17: SIN_CUPO', () => {
    it('criterio 17: una clase llena responde 409 SIN_CUPO con sus ids en detalles.clasesSinCupo y no escribe, audita ni envía correo', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);
      const antes = await estado();

      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'SIN_CUPO']);
      expect(detallesDe(respuesta)['clasesSinCupo']).toEqual([e.lunes.id]);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 17: informa todas las clases llenas (no solo la primera)', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);
      await llenarClase(e.A.id, e.viernes.id, e.plan.id, 20);

      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'SIN_CUPO']);
      expect([...(detallesDe(respuesta)['clasesSinCupo'] as string[])].sort()).toEqual(
        [e.lunes.id, e.viernes.id].sort(),
      );
    });

    it('criterio 17: con 19 de 20 ocupados todavía hay un cupo: se acepta y la ocupación llega a 20 (control)', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 19);

      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await ocupacionDeClase(e.A.id, e.lunes.id, { anio: 2026, mes: 11 }, AHORA_005)).toBe(20);
    });

    it('criterio 17: una clase con el aforo por debajo de sus inscritos (21 de 20) no tiene cupo (DR-5 de 004)', async () => {
      await llenarClase(e.A.id, e.miercoles.id, e.plan.id, 21);

      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'SIN_CUPO']);
      expect(detallesDe(respuesta)['clasesSinCupo']).toEqual([e.miercoles.id]);
    });

    it('criterio 17: las reservas vencidas, las canceladas y las de otro mes no ocupan cupo (criterio 20)', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20, {
        estado: 'RESERVADA',
        reservaVenceEn: new Date(AHORA_005.getTime() - 1000),
      });
      await llenarClase(e.A.id, e.viernes.id, e.plan.id, 20, { mes: { anio: 2026, mes: 10 } });
      await llenarClase(e.A.id, e.miercoles.id, e.plan.id, 20, { mes: { anio: 2026, mes: 12 } });

      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 17: las reservas vigentes y las sin vencimiento sí ocupan cupo', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 10, {
        estado: 'RESERVADA',
        reservaVenceEn: new Date(AHORA_005.getTime() + VEINTICUATRO_HORAS),
      });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 10, { estado: 'RESERVADA', reservaVenceEn: null });

      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'SIN_CUPO']);
    });

    it('criterio 17: SIN_CUPO se decide antes que MONTO_CAMBIO (orden de los 409 del envío)', async () => {
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);

      const respuesta = await enviar(await cuerpoInscripcion(e, { sobre: { inscripcion: { montoMostrado: '1.00' } } }));

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'SIN_CUPO']);
    });

    it('criterio 17: la ocupación de otra academia no cuenta: la clase de B llena no afecta a A', async () => {
      await llenarClase(e.B.id, e.lunesB.id, e.planB.id, 20);

      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect(respuesta.status, respuesta.texto).toBe(201);
    });
  });
});
