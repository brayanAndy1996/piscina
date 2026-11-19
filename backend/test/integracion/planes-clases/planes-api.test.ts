import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_PLAN_ACTUALIZADO,
  ACCION_PLAN_CREADO,
  camposConError,
  crearPlanDePrueba,
  cuerpoPlan,
  type ClientePC,
  escucharParaPlanesClases,
  exigirRutasDePlanesYClases,
  instantaneaDePlanesYClases,
  leerPlan,
  leerPlanes,
  type PlanApi,
  type PlanDePrueba,
} from '../../utilidades/planes-clases';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  pedir,
} from '../../utilidades/usuarios';

// Planes (spec 004, criterios 8, 9, 11, 12, 13 y 15): crear, validar, nombre único, editar, activar y desactivar, sin borrar, y la lista.

describe('planes: API de la academia', () => {
  let app: NestExpressApplication;
  let http: ClientePC;
  let e: Escenario;
  let admin: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    http = await escucharParaPlanesClases(app);
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  async function estadoDeA() {
    return {
      filas: await instantaneaDePlanesYClases(e.A.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }
  const crear = (cuerpo: unknown, cookie = admin) => pedir(app, 'post', '/api/planes', { cookie, cuerpo });
  const editar = (id: string, cuerpo: unknown, cookie = admin) =>
    pedir(app, 'patch', `/api/planes/${id}`, { cookie, cuerpo });
  const planDe = (respuesta: { body: unknown }) => (respuesta.body as { plan: PlanApi }).plan;

  describe('crear (criterio 8)', () => {
    it('criterio 8: responde 201 con { plan }: arreglos ordenados, precio con dos decimales, activo, estado VIGENTE y duración 60', async () => {
      const respuesta = await crear(
        cuerpoPlan({
          nombre: '  Tres veces por semana  ',
          diasPermitidos: [5, 1, 3],
          franjasPermitidas: ['18:00', '08:00', '09:00'],
          nivelesAplicables: ['AVANZADO', 'BASICO'],
          precio: '120',
        }),
      );

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
      expect(respuesta.headers['cache-control']).toMatch(/no-store/);
      const plan = planDe(respuesta);
      expect(plan).toEqual({
        id: expect.any(String) as string,
        nombre: 'Tres veces por semana',
        vecesPorSemana: 3,
        clasesPorMes: 12,
        duracionMinutos: 60,
        precio: '120.00',
        diasPermitidos: [1, 3, 5],
        franjasPermitidas: ['08:00', '09:00', '18:00'],
        nivelesAplicables: ['BASICO', 'AVANZADO'],
        vigenciaInicio: null,
        vigenciaFin: null,
        activo: true,
        estado: 'VIGENTE',
      });
      expect(await leerPlan(e.A.id, plan.id)).toMatchObject({
        nombre: 'Tres veces por semana',
        duracion_minutos: 60,
        dias_permitidos: [1, 3, 5],
        franjas_permitidas: ['08:00', '09:00', '18:00'],
        niveles_aplicables: ['BASICO', 'AVANZADO'],
        activo: true,
      });
    });

    it('criterio 8: registra PLAN_CREADO con la entidad plan, su id, el actor USUARIO, la IP y los datos del plan', async () => {
      const respuesta = await crear(cuerpoPlan({ nombre: 'Plan auditado', precio: '99.5' }));

      const plan = planDe(respuesta);
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_CREADO);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({
        actor_tipo: 'USUARIO',
        actor_id: e.adminA.id,
        entidad: 'plan',
        entidad_id: plan.id,
        datos_antes: null,
      });
      expect(auditoria[0]?.ip).toEqual(expect.any(String));
      expect(auditoria[0]?.datos_despues).toMatchObject({
        nombre: 'Plan auditado',
        precio: '99.50',
        clasesPorMes: 12,
        diasPermitidos: [1, 3, 5],
      });
    });

    it('criterio 8: acepta una duración y fechas de vigencia, y el estado sale de la fecha de Lima del reloj', async () => {
      const respuesta = await crear(
        cuerpoPlan({ duracionMinutos: 45, vigenciaInicio: '2026-11-12', vigenciaFin: '2026-12-31' }),
      );

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
      expect(planDe(respuesta)).toMatchObject({
        duracionMinutos: 45,
        vigenciaInicio: '2026-11-12',
        vigenciaFin: '2026-12-31',
        estado: 'PROGRAMADO',
      });
    });
  });

  describe('validar (criterio 9)', () => {
    const CUERPOS_INVALIDOS: [string, Record<string, unknown>, string][] = [
      ['nombre de 2 caracteres', { nombre: ' ab ' }, 'nombre'],
      ['nombre de 81 caracteres', { nombre: 'a'.repeat(81) }, 'nombre'],
      ['nombre con un control', { nombre: 'Plan\tX' }, 'nombre'],
      ['nombre con menos de 3 visibles', { nombre: ' a  b ' }, 'nombre'],
      ['vecesPorSemana 0', { vecesPorSemana: 0 }, 'vecesPorSemana'],
      ['vecesPorSemana 8', { vecesPorSemana: 8 }, 'vecesPorSemana'],
      ['vecesPorSemana 2.5', { vecesPorSemana: 2.5 }, 'vecesPorSemana'],
      ['vecesPorSemana "3"', { vecesPorSemana: '3' }, 'vecesPorSemana'],
      ['vecesPorSemana null', { vecesPorSemana: null }, 'vecesPorSemana'],
      ['clasesPorMes 32', { clasesPorMes: 32 }, 'clasesPorMes'],
      ['duracionMinutos 14', { duracionMinutos: 14 }, 'duracionMinutos'],
      ['duracionMinutos 61', { duracionMinutos: 61 }, 'duracionMinutos'],
      ['duracionMinutos null', { duracionMinutos: null }, 'duracionMinutos'],
      ['diasPermitidos vacío', { diasPermitidos: [] }, 'diasPermitidos'],
      ['diasPermitidos con repetidos', { diasPermitidos: [1, 1, 3] }, 'diasPermitidos'],
      ['diasPermitidos con un 8', { diasPermitidos: [1, 3, 8] }, 'diasPermitidos'],
      ['diasPermitidos con menos días que vecesPorSemana', { diasPermitidos: [1, 3] }, 'diasPermitidos'],
      ['diasPermitidos que no es una lista', { diasPermitidos: '135' }, 'diasPermitidos'],
      ['franjasPermitidas vacía', { franjasPermitidas: [] }, 'franjasPermitidas'],
      ['franjasPermitidas con repetidas', { franjasPermitidas: ['08:00', '08:00'] }, 'franjasPermitidas'],
      ['franjasPermitidas con 08:30', { franjasPermitidas: ['08:30'] }, 'franjasPermitidas'],
      ['franjasPermitidas con 20:00', { franjasPermitidas: ['20:00'] }, 'franjasPermitidas'],
      ['nivelesAplicables vacío', { nivelesAplicables: [] }, 'nivelesAplicables'],
      ['nivelesAplicables con repetidos', { nivelesAplicables: ['BASICO', 'BASICO'] }, 'nivelesAplicables'],
      ['nivelesAplicables con un nivel desconocido', { nivelesAplicables: ['EXPERTO'] }, 'nivelesAplicables'],
      ['vigenciaInicio que no existe (2026-02-30)', { vigenciaInicio: '2026-02-30' }, 'vigenciaInicio'],
      ['vigenciaFin que no es una fecha', { vigenciaFin: '30/11/2026' }, 'vigenciaFin'],
      [
        'vigenciaFin anterior a vigenciaInicio',
        { vigenciaInicio: '2026-03-01', vigenciaFin: '2026-02-28' },
        'vigenciaFin',
      ],
      ['un campo calculado (estado)', { estado: 'VIGENTE' }, ''],
    ];

    it.each(CUERPOS_INVALIDOS)(
      'criterio 9: %s responde 400 SOLICITUD_INVALIDA con el error en el campo y no escribe ni audita nada',
      async (_nombre, cambio, campo) => {
        const antes = await estadoDeA();

        const respuesta = await crear(cuerpoPlan(cambio));

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        if (campo !== '')
          expect(camposConError(respuesta).some((c) => c === campo || c.startsWith(`${campo}.`))).toBe(true);
        expect(await estadoDeA()).toEqual(antes);
      },
    );

    it('criterio 9: un cuerpo que no es un objeto o viene vacío responde 400', async () => {
      const antes = await estadoDeA();

      for (const cuerpo of [{}, [], 'plan', 5, null]) {
        const respuesta = await http.post('/api/planes', admin, cuerpo);
        expect(respuesta.status, JSON.stringify(cuerpo)).toBe(400);
      }
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 9: un plan de 7 veces por semana exige los 7 días y con los 7 se acepta', async () => {
      const incompleto = await crear(cuerpoPlan({ vecesPorSemana: 7, diasPermitidos: [1, 2, 3, 4, 5, 6] }));
      const completo = await crear(cuerpoPlan({ vecesPorSemana: 7, diasPermitidos: [1, 2, 3, 4, 5, 6, 7] }));

      expect(incompleto.status).toBe(400);
      expect(completo.status, JSON.stringify(completo.body)).toBe(201);
    });
  });

  describe('nombre único (criterio 11)', () => {
    it('criterio 11: crear o renombrar con el mismo nombre recortado y sin distinguir mayúsculas responde 409 NOMBRE_PLAN_EN_USO, aunque el plan esté inactivo', async () => {
      await crearPlanDePrueba(e.A.id, { nombre: 'Plan Mensual', activo: false });
      const otro = await crearPlanDePrueba(e.A.id, { nombre: 'Otro plan' });
      const antes = await estadoDeA();

      for (const nombre of ['plan mensual', ' PLAN MENSUAL ', 'Plan Mensual']) {
        const creado = await crear(cuerpoPlan({ nombre }));
        expect(creado.status, nombre).toBe(409);
        expect((creado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
        const renombrado = await editar(otro.id, { nombre });
        expect(renombrado.status, nombre).toBe(409);
        expect((renombrado.body as ErrorCuerpo).codigo).toBe('NOMBRE_PLAN_EN_USO');
      }
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 11: el mismo nombre se acepta en otra academia, y renombrar un plan con su propio nombre en otra capitalización es un cambio válido', async () => {
      await crearPlanDePrueba(e.B.id, { nombre: 'Plan Mensual' });
      const propio = await crearPlanDePrueba(e.A.id, { nombre: 'plan mensual' });

      const enA = await crear(cuerpoPlan({ nombre: 'Plan Mensual' }));
      const renombrado = await editar(propio.id, { nombre: 'PLAN MENSUAL' });

      // El plan nuevo en A choca con el propio de A ("plan mensual"); el renombrado del propio plan no choca consigo mismo.
      expect(enA.status).toBe(409);
      expect(renombrado.status, JSON.stringify(renombrado.body)).toBe(200);
      expect(planDe(renombrado).nombre).toBe('PLAN MENSUAL');
      const enB = await crear(cuerpoPlan({ nombre: 'Plan Mensual' }), cookieDeUsuario(e.adminB, AHORA_PRUEBAS));
      expect(enB.status, JSON.stringify(enB.body)).toBe(409);
    });

    it('criterio 11: dos creaciones simultáneas con el mismo nombre: exactamente una responde 201 y la otra 409; queda una fila y un PLAN_CREADO', async () => {
      for (let ronda = 0; ronda < 5; ronda++) {
        const nombre = `Plan simultáneo ${ronda}`;
        const respuestas = await Promise.all([
          http.post('/api/planes', admin, cuerpoPlan({ nombre })),
          http.post('/api/planes', admin, cuerpoPlan({ nombre: nombre.toUpperCase() })),
        ]);

        expect(respuestas.map((r) => r.status).sort(), `ronda ${ronda}`).toEqual([201, 409]);
        expect(respuestas.find((r) => r.status === 409)?.body?.codigo).toBe('NOMBRE_PLAN_EN_USO');
        expect((await leerPlanes(e.A.id)).filter((p) => p.nombre.toLowerCase() === nombre.toLowerCase())).toHaveLength(
          1,
        );
      }
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_CREADO)).toHaveLength(5);
    });

    it('criterio 11: un PATCH que renombra y una creación simultánea con ese nombre: uno gana y el otro responde 409, nunca 500', async () => {
      for (let ronda = 0; ronda < 5; ronda++) {
        const plan = await crearPlanDePrueba(e.A.id, { nombre: `Original ${ronda}` });
        const nombre = `Disputado ${ronda}`;

        const [renombrado, creado] = await Promise.all([
          http.patch(`/api/planes/${plan.id}`, admin, { nombre }),
          http.post('/api/planes', admin, cuerpoPlan({ nombre })),
        ]);

        expect([renombrado.status, creado.status].sort(), `ronda ${ronda}`).toEqual(
          renombrado.status === 200 ? [200, 409] : [201, 409],
        );
        expect((await leerPlanes(e.A.id)).filter((p) => p.nombre === nombre)).toHaveLength(1);
      }
    });
  });

  describe('editar (criterio 12)', () => {
    let plan: PlanDePrueba;

    beforeEach(async () => {
      plan = await crearPlanDePrueba(e.A.id, {
        nombre: 'Plan Mensual',
        precio: '120.00',
        clases_por_mes: 12,
        vigencia_inicio: '2026-03-01',
        vigencia_fin: '2026-06-30',
      });
    });

    it('criterio 12: responde 200 con { plan } ya cambiado y registra un solo PLAN_ACTUALIZADO con los campos que cambiaron', async () => {
      const respuesta = await editar(plan.id, {
        nombre: 'Plan Anual',
        precio: '1200',
        diasPermitidos: [6, 2, 4],
        clasesPorMes: 12,
        franjasPermitidas: ['09:00', '08:00'],
      });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(planDe(respuesta)).toMatchObject({
        id: plan.id,
        nombre: 'Plan Anual',
        precio: '1200.00',
        diasPermitidos: [2, 4, 6],
        clasesPorMes: 12,
      });
      expect(await leerPlan(e.A.id, plan.id)).toMatchObject({ nombre: 'Plan Anual', precio: '1200.00' });
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_ACTUALIZADO);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ actor_id: e.adminA.id, entidad: 'plan', entidad_id: plan.id });
      expect(auditoria[0]?.datos_antes).toEqual({
        nombre: 'Plan Mensual',
        precio: '120.00',
        diasPermitidos: [1, 3, 5],
      });
      expect(auditoria[0]?.datos_despues).toEqual({
        nombre: 'Plan Anual',
        precio: '1200.00',
        diasPermitidos: [2, 4, 6],
      });
    });

    it('criterio 12: un PATCH sin cambios responde 200 sin escribir ni auditar; dos envíos iguales dejan una sola auditoría', async () => {
      const igual = await editar(plan.id, { nombre: 'Plan Mensual', precio: '120', diasPermitidos: [5, 3, 1] });
      const antes = await estadoDeA();

      expect(igual.status, JSON.stringify(igual.body)).toBe(200);
      expect(planDe(igual).precio).toBe('120.00');
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_ACTUALIZADO)).toHaveLength(0);

      const uno = await editar(plan.id, { clasesPorMes: 8 });
      const dos = await editar(plan.id, { clasesPorMes: 8 });
      expect(uno.status).toBe(200);
      expect(dos.status).toBe(200);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_ACTUALIZADO)).toHaveLength(1);
      expect(await instantaneaDePlanesYClases(e.A.id)).not.toEqual(antes.filas);
    });

    it('criterio 12: las reglas que cruzan campos se comprueban con lo guardado y el error va al campo enviado', async () => {
      const antes = await estadoDeA();
      const casos: [string, Record<string, unknown>, string][] = [
        ['subir las veces por semana sin dar más días (4 de 3)', { vecesPorSemana: 4 }, 'vecesPorSemana'],
        ['dejar menos días que las veces por semana guardadas', { diasPermitidos: [1, 3] }, 'diasPermitidos'],
        ['un fin anterior al inicio guardado', { vigenciaFin: '2026-02-28' }, 'vigenciaFin'],
        ['un inicio posterior al fin guardado', { vigenciaInicio: '2026-07-01' }, 'vigenciaInicio'],
      ];

      for (const [nombre, cuerpo, campo] of casos) {
        const respuesta = await editar(plan.id, cuerpo);
        expect(respuesta.status, nombre).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta), nombre).toEqual([campo]);
      }
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 12: con las reglas cruzadas cumplidas por el cuerpo combinado sí se aplica (más veces por semana con más días a la vez)', async () => {
      const respuesta = await editar(plan.id, { vecesPorSemana: 5, diasPermitidos: [1, 2, 3, 4, 5] });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(planDe(respuesta)).toMatchObject({ vecesPorSemana: 5, diasPermitidos: [1, 2, 3, 4, 5] });
    });

    it('criterio 12: null en vigenciaInicio o vigenciaFin quita esa fecha', async () => {
      const respuesta = await editar(plan.id, { vigenciaFin: null });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(planDe(respuesta)).toMatchObject({ vigenciaInicio: '2026-03-01', vigenciaFin: null });
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_ACTUALIZADO);
      expect(auditoria[0]?.datos_antes).toEqual({ vigenciaFin: '2026-06-30' });
      expect(auditoria[0]?.datos_despues).toEqual({ vigenciaFin: null });
      expect((await leerPlan(e.A.id, plan.id))?.vigencia_fin).toBeNull();
    });

    it('criterio 12: {} y los campos de más responden 400', async () => {
      const antes = await estadoDeA();

      expect((await editar(plan.id, {})).status).toBe(400);
      expect((await editar(plan.id, { estado: 'VIGENTE' })).status).toBe(400);
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 12: dos PATCH simultáneos sobre el mismo plan responden 200 y sus auditorías quedan encadenadas', async () => {
      for (let ronda = 0; ronda < 6; ronda++) {
        const otro = await crearPlanDePrueba(e.A.id, { nombre: `Concurrente ${ronda}`, clases_por_mes: 12 });

        const respuestas = await Promise.all([
          http.patch(`/api/planes/${otro.id}`, admin, { clasesPorMes: 8 }),
          http.patch(`/api/planes/${otro.id}`, admin, { clasesPorMes: 16 }),
        ]);

        for (const respuesta of respuestas) expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
        const filas = (await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_ACTUALIZADO)).filter(
          (fila) => fila.entidad_id === otro.id,
        );
        expect(filas, `ronda ${ronda}`).toHaveLength(2);
        const pasos = filas.map((fila) => ({
          antes: (fila.datos_antes as { clasesPorMes: number }).clasesPorMes,
          despues: (fila.datos_despues as { clasesPorMes: number }).clasesPorMes,
        }));
        const primero = pasos.find((paso) => paso.antes === 12);
        const segundo = pasos.find((paso) => paso !== primero);
        expect(segundo?.antes, `ronda ${ronda}: encadenadas`).toBe(primero?.despues);
        expect((await leerPlan(e.A.id, otro.id))?.clases_por_mes).toBe(segundo?.despues);
      }
    });

    it('criterio 12: el precio, el nombre y cualquier campo solo cambian la fila del plan (no hay otra tabla que tocar)', async () => {
      const otro = await crearPlanDePrueba(e.A.id, { nombre: 'Otro plan', precio: '50.00' });

      await editar(plan.id, { precio: '130.00' });

      expect((await leerPlan(e.A.id, otro.id))?.precio).toBe('50.00');
    });
  });

  describe('activar, desactivar y sin borrar (criterio 13)', () => {
    it('criterio 13: activo false desactiva el plan (estado INACTIVO) y activo true lo vuelve a activar, cada uno con su PLAN_ACTUALIZADO', async () => {
      const plan = await crearPlanDePrueba(e.A.id);

      const apagado = await editar(plan.id, { activo: false });
      const encendido = await editar(plan.id, { activo: true });

      expect(apagado.status, JSON.stringify(apagado.body)).toBe(200);
      expect(planDe(apagado)).toMatchObject({ activo: false, estado: 'INACTIVO' });
      expect(planDe(encendido)).toMatchObject({ activo: true, estado: 'VIGENTE' });
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_ACTUALIZADO);
      // El reloj de la prueba está fijo: las dos auditorías tienen la misma hora y su orden no se distingue.
      expect(auditoria.map((fila) => JSON.stringify([fila.datos_antes, fila.datos_despues])).sort()).toEqual(
        [
          JSON.stringify([{ activo: true }, { activo: false }]),
          JSON.stringify([{ activo: false }, { activo: true }]),
        ].sort(),
      );
    });

    it('criterio 13: DELETE /api/planes/{id} y DELETE /api/clases/{id} responden 404 y no tocan nada', async () => {
      const plan = await crearPlanDePrueba(e.A.id);
      const antes = await estadoDeA();

      const planes = await pedir(app, 'delete', `/api/planes/${plan.id}`, { cookie: admin });
      const clases = await pedir(app, 'delete', `/api/clases/${plan.id}`, { cookie: admin });

      expect(planes.status).toBe(404);
      expect(clases.status).toBe(404);
      expect(await estadoDeA()).toEqual(antes);
    });
  });

  describe('lista (criterio 15)', () => {
    it('criterio 15: GET /api/planes trae todos los de la academia, activos e inactivos, por nombre en español y, a igual nombre, por id', async () => {
      await crearPlanDePrueba(e.A.id, { nombre: 'Zorro' });
      await crearPlanDePrueba(e.A.id, { nombre: 'Ñandú' });
      await crearPlanDePrueba(e.A.id, { nombre: 'Nube', activo: false });
      await crearPlanDePrueba(e.A.id, { nombre: 'álamo' });
      await crearPlanDePrueba(e.B.id, { nombre: 'De otra academia' });

      const respuesta = await pedir(app, 'get', '/api/planes', { cookie: admin });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      const planes = (respuesta.body as { planes: PlanApi[] }).planes;
      expect(planes.map((plan) => plan.nombre)).toEqual(['álamo', 'Nube', 'Ñandú', 'Zorro']);
      expect(planes.map((plan) => plan.estado)).toEqual(['VIGENTE', 'INACTIVO', 'VIGENTE', 'VIGENTE']);
    });

    it('criterio 15: un nombre repetido solo es posible con otra capitalización en otra academia; la lista nunca mezcla academias', async () => {
      const otraAdmin = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_COMUN });
      await crearPlanDePrueba(e.A.id, { nombre: 'Plan' });

      const respuesta = await pedir(app, 'get', '/api/planes', { cookie: cookieDeUsuario(otraAdmin, AHORA_PRUEBAS) });

      expect((respuesta.body as { planes: PlanApi[] }).planes).toHaveLength(1);
    });
  });
});
