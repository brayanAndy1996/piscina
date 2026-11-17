// spec: 004-planes-clases-aforo (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { uuidInexistente } from '../../utilidades/modulos';
import {
  type ClaseApi,
  type ClaseDePrueba,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  crearPlanDePrueba,
  cuerpoClase,
  cuerpoPlan,
  exigirRutasDePlanesYClases,
  instantaneaDePlanesYClases,
  leerClase,
  leerPlan,
  type PlanApi,
  type PlanDePrueba,
} from '../../utilidades/planes-clases';
import {
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  type ErrorCuerpo,
  type Escenario,
  pedir,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 6 (crítico, D-23; criterio 20 de 002): aislamiento en la API. Un ADMIN de A solo ve y cambia planes y clases de A:
// GET /api/planes y GET /api/clases traen solo filas de A; un PATCH sobre el id de un plan o una clase de B responde 404
// NO_ENCONTRADO, con el mismo cuerpo que un id que no existe (y que un id que no es UUID); un cuerpo con academiaId o con cualquier campo
// que no sea del contrato responde 400 sin escribir; un parámetro de consulta ?academiaId=<id de B> se ignora o responde 400, pero nunca
// muestra ni escribe datos de B; un entrenadorId de un usuario de B responde 409 ENTRENADOR_NO_VALIDO, igual que uno que no existe.
// Las filas y la auditoría de B no cambian. Los valores esperados están escritos a mano.

describe('criterio 6: aislamiento de planes y clases en la API', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let entrenadorB: UsuarioDePrueba;
  let planesA: PlanDePrueba[];
  let planesB: PlanDePrueba[];
  let clasesA: ClaseDePrueba[];
  let clasesB: ClaseDePrueba[];
  let adminA: string;
  let adminB: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    adminA = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    adminB = cookieDeUsuario(e.adminB, AHORA_PRUEBAS);
    entrenadorB = await crearEntrenadorDePrueba(e.B.id, { nombres: 'Entrenador', apellidos: 'De Be' });
    planesA = [
      await crearPlanDePrueba(e.A.id, { nombre: 'Plan A uno', precio: '120.00' }),
      await crearPlanDePrueba(e.A.id, { nombre: 'Plan A dos', precio: '90.00' }),
    ];
    planesB = [
      await crearPlanDePrueba(e.B.id, { nombre: 'Plan B uno', precio: '777.00' }),
      await crearPlanDePrueba(e.B.id, { nombre: 'Plan B dos', precio: '888.00' }),
      await crearPlanDePrueba(e.B.id, { nombre: 'Plan B tres', precio: '999.00' }),
    ];
    clasesA = [
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { dia_semana: 1, hora_inicio: '08:00', aforo: 30 }),
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { dia_semana: 2, hora_inicio: '09:00', aforo: 25 }),
    ];
    clasesB = [
      await crearClaseDePrueba(e.B.id, entrenadorB.id, { dia_semana: 1, hora_inicio: '08:00', aforo: 41 }),
      await crearClaseDePrueba(e.B.id, entrenadorB.id, { dia_semana: 2, hora_inicio: '09:00', aforo: 42 }),
    ];
    // Una fila de auditoría previa en cada academia: "la auditoría de B no cambia" tiene que poder verse.
    await insertarAuditoria(e.B.id, 'ACCION_PREVIA_B');
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await app?.close();
  });

  const codigoDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).codigo;
  const sinDatosDeB = (respuesta: { body: unknown }) => {
    const texto = JSON.stringify(respuesta.body);
    for (const plan of planesB) {
      expect(texto).not.toContain(plan.id);
      expect(texto).not.toContain(plan.nombre);
    }
    for (const clase of clasesB) expect(texto).not.toContain(clase.id);
    expect(texto).not.toContain(entrenadorB.id);
    expect(texto).not.toContain(entrenadorB.apellidos);
  };

  async function estadoDeB() {
    return {
      filas: await instantaneaDePlanesYClases(e.B.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
    };
  }
  async function estadoDeA() {
    return {
      filas: await instantaneaDePlanesYClases(e.A.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }

  describe('lecturas', () => {
    it('criterio 6: GET /api/planes trae solo los planes de A, con sus precios, y ninguno de B', async () => {
      const respuesta = await pedir(app, 'get', '/api/planes', { cookie: adminA });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      const planes = (respuesta.body as { planes: PlanApi[] }).planes;
      expect(planes.map((plan) => plan.id).sort()).toEqual(planesA.map((plan) => plan.id).sort());
      expect(planes.map((plan) => plan.precio).sort()).toEqual(['120.00', '90.00']);
      sinDatosDeB(respuesta);
    });

    it('criterio 6: GET /api/planes con el ADMIN de B trae solo los planes de B', async () => {
      const respuesta = await pedir(app, 'get', '/api/planes', { cookie: adminB });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      const planes = (respuesta.body as { planes: PlanApi[] }).planes;
      expect(planes.map((plan) => plan.id).sort()).toEqual(planesB.map((plan) => plan.id).sort());
      expect(JSON.stringify(respuesta.body)).not.toContain('Plan A');
    });

    it('criterio 6: GET /api/clases trae solo las clases de A, con su entrenador de A, y ninguna de B', async () => {
      const respuesta = await pedir(app, 'get', '/api/clases', { cookie: adminA });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      const clases = (respuesta.body as { clases: ClaseApi[] }).clases;
      expect(clases.map((clase) => clase.id).sort()).toEqual(clasesA.map((clase) => clase.id).sort());
      expect(clases.every((clase) => clase.entrenador.id === e.entrenadorA.id)).toBe(true);
      sinDatosDeB(respuesta);
    });

    it('criterio 6: GET /api/clases con el ADMIN de B trae solo las clases de B', async () => {
      const respuesta = await pedir(app, 'get', '/api/clases', { cookie: adminB });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      const clases = (respuesta.body as { clases: ClaseApi[] }).clases;
      expect(clases.map((clase) => clase.id).sort()).toEqual(clasesB.map((clase) => clase.id).sort());
      expect(JSON.stringify(respuesta.body)).not.toContain(e.entrenadorA.id);
    });

    it('criterio 6: una academia sin planes ni clases recibe listas vacías aunque la otra tenga filas', async () => {
      const nuevo = await crearEscenario();
      await crearPlanDePrueba(nuevo.B.id);

      const planes = await pedir(app, 'get', '/api/planes', { cookie: cookieDeUsuario(nuevo.adminA, AHORA_PRUEBAS) });
      const clases = await pedir(app, 'get', '/api/clases', { cookie: cookieDeUsuario(nuevo.adminA, AHORA_PRUEBAS) });

      expect(planes.body).toEqual({ planes: [] });
      expect(clases.body).toEqual({ clases: [] });
    });

    it.each([
      ['?academiaId=<id de B>', (id: string) => `?academiaId=${id}`],
      ['?academia_id=<id de B>&academiaId=<id de B>', (id: string) => `?academia_id=${id}&academiaId=${id}`],
      ['?nombreCorto=academia-b', () => '?nombreCorto=academia-b'],
    ])(
      'criterio 6: un parámetro de consulta (%s) en las listas no cambia la academia: responde con lo de A o 400, nunca con lo de B',
      async (_nombre, consulta) => {
        for (const ruta of ['/api/planes', '/api/clases']) {
          const respuesta = await pedir(app, 'get', `${ruta}${consulta(e.B.id)}`, { cookie: adminA });

          expect([200, 400], `${ruta}: respondió ${respuesta.status}: ${JSON.stringify(respuesta.body)}`).toContain(
            respuesta.status,
          );
          sinDatosDeB(respuesta);
        }
      },
    );

    it('criterio 6: leer no escribe nada en ninguna academia', async () => {
      const antesA = await estadoDeA();
      const antesB = await estadoDeB();

      for (const cookie of [adminA, adminB]) {
        await pedir(app, 'get', '/api/planes', { cookie });
        await pedir(app, 'get', '/api/clases', { cookie });
      }

      expect(await estadoDeA()).toEqual(antesA);
      expect(await estadoDeB()).toEqual(antesB);
    });
  });

  describe('PATCH sobre el id de otra academia', () => {
    const ID_QUE_NO_ES_UUID = 'no-es-un-uuid';

    it('criterio 6: PATCH /api/planes/{id de un plan de B} responde 404 NO_ENCONTRADO, con el mismo cuerpo que un id que no existe y que uno que no es UUID, y no escribe nada', async () => {
      const antesA = await estadoDeA();
      const antesB = await estadoDeB();
      const cuerpo = { precio: '1.00', activo: false, nombre: 'Plan hackeado' };

      const deB = await pedir(app, 'patch', `/api/planes/${planesB[0]?.id}`, { cookie: adminA, cuerpo });
      const inexistente = await pedir(app, 'patch', `/api/planes/${uuidInexistente()}`, { cookie: adminA, cuerpo });
      const noUuid = await pedir(app, 'patch', `/api/planes/${ID_QUE_NO_ES_UUID}`, { cookie: adminA, cuerpo });

      for (const respuesta of [deB, inexistente, noUuid]) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
      }
      expect(deB.body, 'el 404 de un plan de B no se distingue del de un id que no existe').toEqual(inexistente.body);
      expect(noUuid.body, 'ni del de un id que no es UUID').toEqual(inexistente.body);
      sinDatosDeB(deB);
      expect(await estadoDeA()).toEqual(antesA);
      expect(await estadoDeB()).toEqual(antesB);
    });

    it('criterio 6: PATCH /api/clases/{id de una clase de B} responde 404 NO_ENCONTRADO, con el mismo cuerpo que un id que no existe y que uno que no es UUID, y no escribe nada', async () => {
      const antesA = await estadoDeA();
      const antesB = await estadoDeB();
      const cuerpo = { aforo: 20, activo: false, entrenadorId: e.entrenadorA.id };

      const deB = await pedir(app, 'patch', `/api/clases/${clasesB[0]?.id}`, { cookie: adminA, cuerpo });
      const inexistente = await pedir(app, 'patch', `/api/clases/${uuidInexistente()}`, { cookie: adminA, cuerpo });
      const noUuid = await pedir(app, 'patch', `/api/clases/${ID_QUE_NO_ES_UUID}`, { cookie: adminA, cuerpo });

      for (const respuesta of [deB, inexistente, noUuid]) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
      }
      expect(deB.body, 'el 404 de una clase de B no se distingue del de un id que no existe').toEqual(inexistente.body);
      expect(noUuid.body, 'ni del de un id que no es UUID').toEqual(inexistente.body);
      sinDatosDeB(deB);
      expect(await estadoDeA()).toEqual(antesA);
      expect(await estadoDeB()).toEqual(antesB);
    });

    it('criterio 6: un id de B en mayúsculas tampoco alcanza el plan ni la clase de B (404), y el propio id de A en mayúsculas sí funciona', async () => {
      const antesB = await estadoDeB();

      const planDeB = await pedir(app, 'patch', `/api/planes/${planesB[0]?.id.toUpperCase()}`, {
        cookie: adminA,
        cuerpo: { activo: false },
      });
      const claseDeB = await pedir(app, 'patch', `/api/clases/${clasesB[0]?.id.toUpperCase()}`, {
        cookie: adminA,
        cuerpo: { aforo: 20 },
      });
      const propio = await pedir(app, 'patch', `/api/planes/${planesA[0]?.id.toUpperCase()}`, {
        cookie: adminA,
        cuerpo: { activo: false },
      });

      expect(planDeB.status).toBe(404);
      expect(claseDeB.status).toBe(404);
      expect(propio.status, JSON.stringify(propio.body)).toBe(200);
      expect(await estadoDeB()).toEqual(antesB);
    });

    it('criterio 6: el cuerpo se comprueba antes que la operación: un cuerpo inválido sobre un id de B responde 400, no 404, y no escribe nada', async () => {
      const antesB = await estadoDeB();

      const plan = await pedir(app, 'patch', `/api/planes/${planesB[0]?.id}`, { cookie: adminA, cuerpo: {} });
      const clase = await pedir(app, 'patch', `/api/clases/${clasesB[0]?.id}`, {
        cookie: adminA,
        cuerpo: { aforo: 99 },
      });

      expect(plan.status, JSON.stringify(plan.body)).toBe(400);
      expect(clase.status, JSON.stringify(clase.body)).toBe(400);
      expect(await estadoDeB()).toEqual(antesB);
    });

    it('criterio 6: el ADMIN de B sí cambia lo suyo (control) y A queda igual', async () => {
      const antesA = await estadoDeA();

      const plan = await pedir(app, 'patch', `/api/planes/${planesB[0]?.id}`, {
        cookie: adminB,
        cuerpo: { precio: '555.50' },
      });
      const clase = await pedir(app, 'patch', `/api/clases/${clasesB[0]?.id}`, {
        cookie: adminB,
        cuerpo: { aforo: 22 },
      });

      expect(plan.status, JSON.stringify(plan.body)).toBe(200);
      expect(clase.status, JSON.stringify(clase.body)).toBe(200);
      expect((await leerPlan(e.B.id, planesB[0]?.id ?? ''))?.precio).toBe('555.50');
      expect((await leerClase(e.B.id, clasesB[0]?.id ?? ''))?.aforo).toBe(22);
      expect(await estadoDeA()).toEqual(antesA);
    });
  });

  describe('cuerpos y direcciones con la academia de otro', () => {
    it.each([
      ['academiaId de B', (b: string) => ({ academiaId: b })],
      ['academia_id de B', (b: string) => ({ academia_id: b })],
      ['un campo que no es del contrato (estado)', () => ({ estado: 'VIGENTE' })],
      ['el id', () => ({ id: uuidInexistente() })],
    ])(
      'criterio 6: POST /api/planes con %s responde 400 SOLICITUD_INVALIDA y no escribe ni audita nada, en A ni en B',
      async (_nombre, extra) => {
        const antesA = await estadoDeA();
        const antesB = await estadoDeB();

        const respuesta = await pedir(app, 'post', '/api/planes', {
          cookie: adminA,
          cuerpo: cuerpoPlan({ nombre: 'Plan con campo de más', ...extra(e.B.id) }),
        });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await estadoDeA()).toEqual(antesA);
        expect(await estadoDeB()).toEqual(antesB);
      },
    );

    it.each([
      ['academiaId de B', (b: string) => ({ academiaId: b })],
      ['academia_id de B', (b: string) => ({ academia_id: b })],
      ['un campo que no es del contrato (estado)', () => ({ estado: 'VIGENTE' })],
      ['el id', () => ({ id: uuidInexistente() })],
    ])(
      'criterio 6: PATCH /api/planes/{id} con un cuerpo válido y %s responde 400 SOLICITUD_INVALIDA y no escribe nada, en A ni en B',
      async (_nombre, extra) => {
        const antesA = await estadoDeA();
        const antesB = await estadoDeB();

        const respuesta = await pedir(app, 'patch', `/api/planes/${planesA[0]?.id}`, {
          cookie: adminA,
          cuerpo: { precio: '99.00', ...extra(e.B.id) },
        });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await estadoDeA()).toEqual(antesA);
        expect(await estadoDeB()).toEqual(antesB);
      },
    );

    it.each([
      ['academiaId de B', (b: string) => ({ academiaId: b })],
      ['academia_id de B', (b: string) => ({ academia_id: b })],
      ['un campo que no es del contrato (activo en la creación)', () => ({ activo: false })],
      ['el id', () => ({ id: uuidInexistente() })],
    ])(
      'criterio 6: POST /api/clases con un cuerpo válido y %s responde 400 SOLICITUD_INVALIDA y no escribe ni audita nada, en A ni en B',
      async (_nombre, extra) => {
        const antesA = await estadoDeA();
        const antesB = await estadoDeB();

        const respuesta = await pedir(app, 'post', '/api/clases', {
          cookie: adminA,
          cuerpo: cuerpoClase(e.entrenadorA.id, { diaSemana: 5, ...extra(e.B.id) }),
        });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await estadoDeA()).toEqual(antesA);
        expect(await estadoDeB()).toEqual(antesB);
      },
    );

    it.each([
      ['academiaId de B', (b: string) => ({ academiaId: b })],
      ['academia_id de B', (b: string) => ({ academia_id: b })],
      ['un campo que no es del contrato (id)', () => ({ id: uuidInexistente() })],
    ])(
      'criterio 6: PATCH /api/clases/{id} con un cuerpo válido y %s responde 400 SOLICITUD_INVALIDA y no escribe nada, en A ni en B',
      async (_nombre, extra) => {
        const antesA = await estadoDeA();
        const antesB = await estadoDeB();

        const respuesta = await pedir(app, 'patch', `/api/clases/${clasesA[0]?.id}`, {
          cookie: adminA,
          cuerpo: { aforo: 44, ...extra(e.B.id) },
        });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(await estadoDeA()).toEqual(antesA);
        expect(await estadoDeB()).toEqual(antesB);
      },
    );

    it('criterio 6: con ?academiaId=<id de B> en la dirección, un POST o un PATCH no llega a B (se escribe en A o se rechaza con 400 sin escribir)', async () => {
      const antesB = await estadoDeB();
      const peticiones: [Parameters<typeof pedir>[1], string, unknown][] = [
        ['post', `/api/planes?academiaId=${e.B.id}`, cuerpoPlan({ nombre: 'Plan por la dirección' })],
        ['patch', `/api/planes/${planesA[0]?.id}?academiaId=${e.B.id}`, { precio: '77.00' }],
        [
          'post',
          `/api/clases?academiaId=${e.B.id}`,
          cuerpoClase(e.entrenadorA.id, { diaSemana: 4, horaInicio: '12:00' }),
        ],
        ['patch', `/api/clases/${clasesA[0]?.id}?academiaId=${e.B.id}`, { aforo: 35 }],
      ];

      for (const [metodo, ruta, cuerpo] of peticiones) {
        const respuesta = await pedir(app, metodo, ruta, { cookie: adminA, cuerpo });

        expect([200, 201, 400], `${ruta}: respondió ${respuesta.status}: ${JSON.stringify(respuesta.body)}`).toContain(
          respuesta.status,
        );
        sinDatosDeB(respuesta);
      }
      expect(await estadoDeB()).toEqual(antesB);
    });

    it('criterio 6: los planes y las clases creados por el ADMIN de A quedan en A y B no los ve', async () => {
      const plan = await pedir(app, 'post', '/api/planes', {
        cookie: adminA,
        cuerpo: cuerpoPlan({ nombre: 'Solo de A' }),
      });
      const clase = await pedir(app, 'post', '/api/clases', {
        cookie: adminA,
        cuerpo: cuerpoClase(e.entrenadorA.id, { diaSemana: 6, horaInicio: '11:00' }),
      });

      expect(plan.status, JSON.stringify(plan.body)).toBe(201);
      expect(clase.status, JSON.stringify(clase.body)).toBe(201);
      const planesDeB = await pedir(app, 'get', '/api/planes', { cookie: adminB });
      const clasesDeB = await pedir(app, 'get', '/api/clases', { cookie: adminB });
      expect(JSON.stringify(planesDeB.body)).not.toContain('Solo de A');
      expect((clasesDeB.body as { clases: ClaseApi[] }).clases).toHaveLength(clasesB.length);
      expect((planesDeB.body as { planes: PlanApi[] }).planes).toHaveLength(planesB.length);
    });
  });

  describe('entrenador de otra academia', () => {
    it('criterio 6: POST /api/clases con el entrenadorId de un usuario de B responde 409 ENTRENADOR_NO_VALIDO, con el mismo cuerpo que un entrenador que no existe, y no escribe ni audita nada', async () => {
      const antesA = await estadoDeA();
      const antesB = await estadoDeB();

      const deB = await pedir(app, 'post', '/api/clases', {
        cookie: adminA,
        cuerpo: cuerpoClase(entrenadorB.id, { diaSemana: 3 }),
      });
      const inexistente = await pedir(app, 'post', '/api/clases', {
        cookie: adminA,
        cuerpo: cuerpoClase(uuidInexistente(), { diaSemana: 3 }),
      });

      for (const respuesta of [deB, inexistente]) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(409);
        expect(codigoDe(respuesta)).toBe('ENTRENADOR_NO_VALIDO');
      }
      expect(deB.body, 'el entrenador de B no se distingue de uno que no existe').toEqual(inexistente.body);
      sinDatosDeB(deB);
      expect(await estadoDeA()).toEqual(antesA);
      expect(await estadoDeB()).toEqual(antesB);
    });

    it('criterio 6: PATCH /api/clases/{id} de A con el entrenadorId de un usuario de B responde 409 ENTRENADOR_NO_VALIDO, con el mismo cuerpo que uno que no existe, y la clase conserva su entrenador', async () => {
      const antesA = await estadoDeA();
      const antesB = await estadoDeB();

      const deB = await pedir(app, 'patch', `/api/clases/${clasesA[0]?.id}`, {
        cookie: adminA,
        cuerpo: { entrenadorId: entrenadorB.id },
      });
      const inexistente = await pedir(app, 'patch', `/api/clases/${clasesA[0]?.id}`, {
        cookie: adminA,
        cuerpo: { entrenadorId: uuidInexistente() },
      });

      for (const respuesta of [deB, inexistente]) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(409);
        expect(codigoDe(respuesta)).toBe('ENTRENADOR_NO_VALIDO');
      }
      expect(deB.body).toEqual(inexistente.body);
      sinDatosDeB(deB);
      expect((await leerClase(e.A.id, clasesA[0]?.id ?? ''))?.entrenador_id).toBe(e.entrenadorA.id);
      expect(await estadoDeA()).toEqual(antesA);
      expect(await estadoDeB()).toEqual(antesB);
    });

    it('criterio 6: el entrenador de la propia academia sí se acepta (control)', async () => {
      const otro = await crearEntrenadorDePrueba(e.A.id);

      const respuesta = await pedir(app, 'patch', `/api/clases/${clasesA[0]?.id}`, {
        cookie: adminA,
        cuerpo: { entrenadorId: otro.id },
      });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect((await leerClase(e.A.id, clasesA[0]?.id ?? ''))?.entrenador_id).toBe(otro.id);
    });
  });
});
