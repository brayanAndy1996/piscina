// spec: 004-planes-clases-aforo (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_PLAN_ACTUALIZADO,
  ACCION_PLAN_CREADO,
  camposConError,
  crearPlanDePrueba,
  cuerpoPlan,
  exigirRutasDePlanesYClases,
  instantaneaDePlanesYClases,
  leerPlan,
  leerPlanes,
  type PlanApi,
  type PlanDePrueba,
  sinCampo,
} from '../../utilidades/planes-clases';
import {
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  type ErrorCuerpo,
  type Escenario,
  pedir,
} from '../../utilidades/usuarios';

// Criterio 10 (crítico, RN-25, D-03): `precio` es un texto con hasta dos decimales, mayor que 0 y como mucho "99999.99": "120", "120.5",
// "0.01" y "99999.99" se aceptan, se guardan en numeric(10,2) sin pasar por coma flotante y se devuelven como "120.00", "120.50",
// "0.01" y "99999.99", también al leerlos con GET /api/planes. Responden 400 sin escribir: un número JSON (120), "0", "0.00", "-1",
// "120.505", "1e2", "120,50", " 120", "100000", "" y null. `clasesPorMes` es un entero de 1 en adelante: 0 responde 400 y nunca se
// guarda (es el divisor de RN-25). El precio es el monto final con IGV incluido: el sistema no le suma ni le resta nada (D-03).
// Los precios se comparan siempre como texto exacto, nunca como número. Además, el estado del plan en America/Lima con el reloj fijo
// (criterio 14), que viaja en la misma respuesta.

const VALIDOS: [string, string][] = [
  ['120', '120.00'],
  ['120.5', '120.50'],
  ['0.01', '0.01'],
  ['99999.99', '99999.99'],
  ['120.0', '120.00'],
  ['120.00', '120.00'],
  ['0.5', '0.50'],
  ['99999', '99999.00'],
  // Valores que la coma flotante no guarda exactos (0.57 * 100 = 56.99999999999999 y similares).
  ['0.57', '0.57'],
  ['1.15', '1.15'],
  ['8.2', '8.20'],
  ['19.99', '19.99'],
  ['57.01', '57.01'],
  ['118.00', '118.00'],
];

const INVALIDOS: [string, unknown][] = [
  ['un número JSON (120)', 120],
  ['un número JSON con decimales (120.5)', 120.5],
  ['"0"', '0'],
  ['"0.00"', '0.00'],
  ['"-1"', '-1'],
  ['"-0.01"', '-0.01'],
  ['"120.505"', '120.505'],
  ['"1e2"', '1e2'],
  ['"120,50"', '120,50'],
  ['" 120" (con un espacio delante)', ' 120'],
  ['"120 " (con un espacio detrás)', '120 '],
  ['"100000" (por encima del máximo)', '100000'],
  ['"99999.995"', '99999.995'],
  ['"" (vacío)', ''],
  ['null', null],
  ['true', true],
  ['una lista', ['120']],
  ['un objeto', { valor: '120' }],
  ['un texto sin dígitos', 'abc'],
  ['"S/ 120"', 'S/ 120'],
];

describe('criterio 10: precio exacto y clases por mes', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let admin: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await app?.close();
  });

  async function estadoDeA() {
    return {
      filas: await instantaneaDePlanesYClases(e.A.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }
  const crear = (cuerpo: Record<string, unknown>) => pedir(app, 'post', '/api/planes', { cookie: admin, cuerpo });
  const editar = (id: string, cuerpo: unknown) => pedir(app, 'patch', `/api/planes/${id}`, { cookie: admin, cuerpo });

  describe('POST /api/planes: el precio', () => {
    it.each(VALIDOS)(
      'criterio 10: el precio "%s" se acepta, se guarda en numeric(10,2) y se devuelve como "%s", al crear y al leer',
      async (enviado, esperado) => {
        const respuesta = await crear(cuerpoPlan({ precio: enviado }));

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
        const plan = (respuesta.body as { plan: PlanApi }).plan;
        expect(plan.precio, 'el precio de la respuesta es el texto exacto').toBe(esperado);
        expect(typeof plan.precio).toBe('string');
        expect(respuesta.text, 'el JSON lleva el precio entre comillas, no como número').toContain(
          `"precio":"${esperado}"`,
        );
        expect((await leerPlan(e.A.id, plan.id))?.precio, 'lo guardado en la base').toBe(esperado);
        const lista = await pedir(app, 'get', '/api/planes', { cookie: admin });
        const leido = (lista.body as { planes: PlanApi[] }).planes.find((p) => p.id === plan.id);
        expect(leido?.precio, 'GET /api/planes devuelve el mismo texto').toBe(esperado);
        expect(lista.text).toContain(`"precio":"${esperado}"`);
        const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_CREADO);
        expect(auditoria).toHaveLength(1);
        expect((auditoria[0]?.datos_despues as { precio?: unknown } | null)?.precio).toBe(esperado);
      },
    );

    it.each(INVALIDOS)(
      'criterio 10: el precio %s responde 400 SOLICITUD_INVALIDA con el error en precio y no escribe ni audita nada',
      async (_nombre, precio) => {
        const antes = await estadoDeA();

        const respuesta = await crear(cuerpoPlan({ precio }));

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('precio');
        expect(await estadoDeA()).toEqual(antes);
      },
    );

    it('criterio 10: sin precio responde 400 con el error en precio y no escribe nada', async () => {
      const antes = await estadoDeA();

      const respuesta = await crear(sinCampo(cuerpoPlan(), 'precio'));

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect(camposConError(respuesta)).toContain('precio');
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 10: el precio es el monto final con IGV incluido: el sistema no le suma ni le resta nada (D-03)', async () => {
      const respuesta = await crear(cuerpoPlan({ precio: '118.00' }));

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
      expect((await leerPlanes(e.A.id)).map((fila) => fila.precio)).toEqual(['118.00']);
    });
  });

  describe('PATCH /api/planes/{id}: el precio', () => {
    let plan: PlanDePrueba;

    beforeEach(async () => {
      plan = await crearPlanDePrueba(e.A.id, { nombre: 'Plan Mensual', precio: '120.00', clases_por_mes: 12 });
    });

    it.each(VALIDOS.filter(([, esperado]) => esperado !== '120.00'))(
      'criterio 10: cambiar el precio a "%s" lo guarda y lo devuelve como "%s", y la auditoría trae los dos textos',
      async (enviado, esperado) => {
        const respuesta = await editar(plan.id, { precio: enviado });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
        expect((respuesta.body as { plan: PlanApi }).plan.precio).toBe(esperado);
        expect(respuesta.text).toContain(`"precio":"${esperado}"`);
        expect((await leerPlan(e.A.id, plan.id))?.precio).toBe(esperado);
        const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_ACTUALIZADO);
        expect(auditoria).toHaveLength(1);
        expect((auditoria[0]?.datos_antes as { precio?: unknown } | null)?.precio).toBe('120.00');
        expect((auditoria[0]?.datos_despues as { precio?: unknown } | null)?.precio).toBe(esperado);
      },
    );

    it.each(INVALIDOS)(
      'criterio 10: cambiar el precio a %s responde 400 con el error en precio y el plan no cambia',
      async (_nombre, precio) => {
        const antes = await estadoDeA();

        const respuesta = await editar(plan.id, { precio });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect(camposConError(respuesta)).toContain('precio');
        expect(await estadoDeA()).toEqual(antes);
      },
    );

    it.each(['120', '120.0', '120.00'])(
      'criterio 10: cambiar "120.00" por "%s" no es un cambio: responde 200 con "120.00" sin escribir ni auditar',
      async (mismoPrecio) => {
        const antes = await estadoDeA();

        const respuesta = await editar(plan.id, { precio: mismoPrecio });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
        expect((respuesta.body as { plan: PlanApi }).plan.precio).toBe('120.00');
        expect(await estadoDeA()).toEqual(antes);
      },
    );

    it('criterio 10: cambiar el precio no toca las clases por mes ni ningún otro campo del plan (HU-19: vale para matrículas nuevas)', async () => {
      const antes = await leerPlan(e.A.id, plan.id);

      const respuesta = await editar(plan.id, { precio: '130.00' });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      const despues = await leerPlan(e.A.id, plan.id);
      expect(despues).toMatchObject({ ...antes, precio: '130.00', actualizado_en: expect.any(Date) as Date });
      expect(despues?.clases_por_mes).toBe(12);
    });
  });

  describe('GET /api/planes: lee el precio exacto de la base', () => {
    it('criterio 10: devuelve cada precio guardado como texto con dos decimales, sin pasar por coma flotante', async () => {
      const guardados = ['0.01', '99999.99', '120.50', '1234.50', '0.57', '8.20'];
      for (const [i, precio] of guardados.entries()) await crearPlanDePrueba(e.A.id, { nombre: `Plan ${i}`, precio });

      const respuesta = await pedir(app, 'get', '/api/planes', { cookie: admin });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      const planes = (respuesta.body as { planes: PlanApi[] }).planes;
      expect(planes.map((plan) => plan.precio).sort()).toEqual([...guardados].sort());
      for (const precio of guardados) expect(respuesta.text).toContain(`"precio":"${precio}"`);
    });
  });

  describe('clasesPorMes', () => {
    it.each([
      ['0', 0],
      ['-1', -1],
      ['1.5', 1.5],
      ['"12" (un texto)', '12'],
      ['null', null],
      ['true', true],
      ['"" (vacío)', ''],
    ])(
      'criterio 10: POST con clasesPorMes %s responde 400 SOLICITUD_INVALIDA con el error en clasesPorMes y no escribe nada',
      async (_nombre, valor) => {
        const antes = await estadoDeA();

        const respuesta = await crear(cuerpoPlan({ clasesPorMes: valor }));

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('clasesPorMes');
        expect(await estadoDeA()).toEqual(antes);
      },
    );

    it('criterio 10: POST sin clasesPorMes responde 400 y no escribe nada', async () => {
      const antes = await estadoDeA();

      const respuesta = await crear(sinCampo(cuerpoPlan(), 'clasesPorMes'));

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect(camposConError(respuesta)).toContain('clasesPorMes');
      expect(await estadoDeA()).toEqual(antes);
    });

    it.each([1, 8, 12])(
      'criterio 10: POST con clasesPorMes %i se acepta y se guarda tal cual',
      async (clasesPorMes) => {
        const respuesta = await crear(cuerpoPlan({ clasesPorMes }));

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
        expect((respuesta.body as { plan: PlanApi }).plan.clasesPorMes).toBe(clasesPorMes);
        expect((await leerPlanes(e.A.id)).map((fila) => fila.clases_por_mes)).toEqual([clasesPorMes]);
      },
    );

    it.each([
      ['0', 0],
      ['-3', -3],
      ['2.5', 2.5],
      ['"8" (un texto)', '8'],
      ['null', null],
    ])(
      'criterio 10: PATCH con clasesPorMes %s responde 400 con el error en clasesPorMes y el plan conserva sus 12 clases',
      async (_nombre, valor) => {
        const plan = await crearPlanDePrueba(e.A.id, { clases_por_mes: 12 });
        const antes = await estadoDeA();

        const respuesta = await editar(plan.id, { clasesPorMes: valor });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect(camposConError(respuesta)).toContain('clasesPorMes');
        expect(await estadoDeA()).toEqual(antes);
        expect((await leerPlan(e.A.id, plan.id))?.clases_por_mes).toBe(12);
      },
    );

    it('criterio 10: PATCH con clasesPorMes 8 lo guarda, lo devuelve y audita el antes y el después', async () => {
      const plan = await crearPlanDePrueba(e.A.id, { clases_por_mes: 12 });

      const respuesta = await editar(plan.id, { clasesPorMes: 8 });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect((respuesta.body as { plan: PlanApi }).plan.clasesPorMes).toBe(8);
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_PLAN_ACTUALIZADO);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.datos_antes).toMatchObject({ clasesPorMes: 12 });
      expect(auditoria[0]?.datos_despues).toMatchObject({ clasesPorMes: 8 });
    });
  });
});

// Criterio 14 (estado del plan en America/Lima) tal como sale en la respuesta: con RELOJ fijo y el servidor en UTC, el día de Lima
// cambia a las 05:00:00Z.
describe('criterio 14 (en la respuesta): el estado del plan se calcula con la fecha de hoy en America/Lima', () => {
  const ANTES_DE_MEDIANOCHE_EN_LIMA = new Date('2026-11-30T04:59:59.000Z'); // 23:59:59 del 29 en Lima
  let app: NestExpressApplication;
  let reloj: Awaited<ReturnType<typeof crearAppConReloj>>['reloj'];
  let e: Escenario;

  beforeAll(async () => {
    ({ app, reloj } = await crearAppConReloj(ANTES_DE_MEDIANOCHE_EN_LIMA));
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    reloj.fijar(ANTES_DE_MEDIANOCHE_EN_LIMA);
    e = await crearEscenario();
  });
  afterAll(async () => {
    await app?.close();
  });

  const estados = async () => {
    // La sesión se firma al mismo instante del reloj, para que no esté vencida ni sea del futuro.
    const cookie = cookieDeUsuario(e.adminA, reloj.ahora());
    const respuesta = await pedir(app, 'get', '/api/planes', { cookie });
    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
    return Object.fromEntries(
      (respuesta.body as { planes: PlanApi[] }).planes.map((plan) => [plan.nombre, plan.estado]),
    );
  };

  it('criterio 14: con vigenciaFin 2026-11-29, a las 23:59:59 de Lima es VIGENTE y a las 00:00 del 30 es VENCIDO; con vigenciaInicio 2026-11-30 pasa de PROGRAMADO a VIGENTE', async () => {
    await crearPlanDePrueba(e.A.id, { nombre: 'Termina el 29', vigencia_fin: '2026-11-29' });
    await crearPlanDePrueba(e.A.id, { nombre: 'Empieza el 30', vigencia_inicio: '2026-11-30' });
    await crearPlanDePrueba(e.A.id, { nombre: 'Sin fechas' });
    await crearPlanDePrueba(e.A.id, {
      nombre: 'Un solo día',
      vigencia_inicio: '2026-11-29',
      vigencia_fin: '2026-11-29',
    });
    await crearPlanDePrueba(e.A.id, { nombre: 'Apagado', activo: false });

    expect(await estados()).toEqual({
      'Termina el 29': 'VIGENTE',
      'Empieza el 30': 'PROGRAMADO',
      'Sin fechas': 'VIGENTE',
      'Un solo día': 'VIGENTE',
      Apagado: 'INACTIVO',
    });

    reloj.avanzar(1000); // 2026-11-30T05:00:00Z = 00:00:00 del 30 en Lima

    expect(await estados()).toEqual({
      'Termina el 29': 'VENCIDO',
      'Empieza el 30': 'VIGENTE',
      'Sin fechas': 'VIGENTE',
      'Un solo día': 'VENCIDO',
      Apagado: 'INACTIVO',
    });
  });

  it('criterio 14: el cambio de año se hace también a medianoche de Lima (2027-01-01T05:00:00Z)', async () => {
    await crearPlanDePrueba(e.A.id, { nombre: 'Termina el 31', vigencia_fin: '2026-12-31' });
    reloj.fijar(new Date('2027-01-01T04:59:59.000Z'));
    const antes = await estados();
    reloj.fijar(new Date('2027-01-01T05:00:00.000Z'));
    const despues = await estados();

    expect(antes).toEqual({ 'Termina el 31': 'VIGENTE' });
    expect(despues).toEqual({ 'Termina el 31': 'VENCIDO' });
  });
});
