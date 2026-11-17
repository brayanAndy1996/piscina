// spec: 004-planes-clases-aforo (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conFilaRetenida } from '../../utilidades/carreras';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CLASE_ACTUALIZADA,
  ACCION_CLASE_CREADA,
  ACCION_PLAN_ACTUALIZADO,
  ACCION_PLAN_CREADO,
  type ClaseDePrueba,
  type ClientePC,
  crearClaseDePrueba,
  crearPlanDePrueba,
  cuerpoClase,
  cuerpoPlan,
  escucharParaPlanesClases,
  exigirRutasDePlanesYClases,
  instantaneaDePlanesYClases,
  leerClase,
  leerPlan,
  type PlanDePrueba,
} from '../../utilidades/planes-clases';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type Escenario,
  leerUsuario,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 7 (crítico, DT-5 de 002): POST y PATCH de planes y de clases llaman a `bloquearActorVigente` como primera sentencia de su
// transacción. Carrera determinista, como la del criterio 56 de 002: la prueba abre su propia transacción sobre la fila del ADMIN X, la
// deja sin confirmar (desactivándolo, o subiendo solo su `version_token`), X envía una petición válida (que pasa el middleware porque su
// lectura no ve lo no confirmado), la prueba detecta con `pg_blocking_pids` que la conexión de la API quedó esperando el bloqueo y
// entonces confirma. Entonces la respuesta es 401 NO_AUTENTICADO, no se crea ni cambia ninguna fila y no hay auditoría. Sin tiempos ni
// esperas fijas: el límite de seguridad de `carreras.ts` solo evita que una prueba se cuelgue.

describe('criterio 7: el administrador sigue vigente dentro de la transacción que escribe planes y clases', () => {
  let app: NestExpressApplication;
  let http: ClientePC;
  let e: Escenario;
  let x: UsuarioDePrueba; // ADMIN de A que hace las peticiones
  let cookieX: string;
  let plan: PlanDePrueba;
  let clase: ClaseDePrueba;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    http = await escucharParaPlanesClases(app);
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    x = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_COMUN });
    cookieX = cookieDeUsuario(x, AHORA_PRUEBAS);
    // Filas previas en A y en B: "ninguna fila cambia" tiene que poder verse.
    plan = await crearPlanDePrueba(e.A.id, { nombre: 'Plan de A', precio: '120.00' });
    clase = await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { aforo: 30 });
    await crearPlanDePrueba(e.B.id, { nombre: 'Plan de B' });
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  interface Peticion {
    nombre: string;
    enviar: () => Promise<{ status: number; body: { codigo?: string } | null }>;
    accion: string;
    /** Qué cambia si la petición se acepta, para el caso de control. */
    comprobarExito: () => Promise<void>;
  }

  const PETICIONES: (() => Peticion)[] = [
    () => ({
      nombre: 'POST /api/planes',
      enviar: () => http.post('/api/planes', cookieX, cuerpoPlan({ nombre: 'Plan de la carrera', precio: '150.00' })),
      accion: ACCION_PLAN_CREADO,
      comprobarExito: async () => {
        expect((await leerPlan(e.A.id, plan.id))?.precio).toBe('120.00');
        expect(await leerPlanDeNombre('Plan de la carrera')).toBe(true);
      },
    }),
    () => ({
      nombre: 'PATCH /api/planes/{id}',
      enviar: () => http.patch(`/api/planes/${plan.id}`, cookieX, { precio: '150.00' }),
      accion: ACCION_PLAN_ACTUALIZADO,
      comprobarExito: async () => {
        expect((await leerPlan(e.A.id, plan.id))?.precio).toBe('150.00');
      },
    }),
    () => ({
      nombre: 'POST /api/clases',
      enviar: () =>
        http.post('/api/clases', cookieX, cuerpoClase(e.entrenadorA.id, { diaSemana: 3, horaInicio: '12:00' })),
      accion: ACCION_CLASE_CREADA,
      comprobarExito: async () => {
        expect(await contarClasesDeA()).toBe(2);
      },
    }),
    () => ({
      nombre: 'PATCH /api/clases/{id}',
      enviar: () => http.patch(`/api/clases/${clase.id}`, cookieX, { aforo: 40 }),
      accion: ACCION_CLASE_ACTUALIZADA,
      comprobarExito: async () => {
        expect((await leerClase(e.A.id, clase.id))?.aforo).toBe(40);
      },
    }),
  ];

  async function leerPlanDeNombre(nombre: string): Promise<boolean> {
    const lista = await http.get('/api/planes', cookieDeUsuario(e.adminA, AHORA_PRUEBAS));
    return (lista.body?.planes ?? []).some((p) => p.nombre === nombre);
  }
  async function contarClasesDeA(): Promise<number> {
    const lista = await http.get('/api/clases', cookieDeUsuario(e.adminA, AHORA_PRUEBAS));
    return lista.body?.clases?.length ?? 0;
  }

  async function instantanea() {
    return {
      filasA: await instantaneaDePlanesYClases(e.A.id),
      filasB: await instantaneaDePlanesYClases(e.B.id),
      auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
      auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
    };
  }

  describe('X deja de estar vigente mientras la petición espera: 401 NO_AUTENTICADO y no se escribe nada', () => {
    const CASOS = PETICIONES.flatMap((peticion, indice) =>
      [
        { cambio: 'desactivar' as const, estado: 'INACTIVO' },
        { cambio: 'solo-version' as const, estado: 'ACTIVO' },
      ].map((cambio) => ({ indice, ...cambio })),
    );

    it.each(CASOS)(
      'criterio 7 (petición $indice, $cambio): X envía una petición válida, espera el bloqueo y al confirmar la prueba responde 401; no se crea ni cambia ninguna fila y no hay auditoría',
      async ({ indice, cambio, estado }) => {
        const peticion = (PETICIONES[indice] as () => Peticion)();
        const antes = await instantanea();
        const versionAntes = (await leerUsuario(e.A.id, x.id))?.version_token ?? 0;

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: x.id,
          cambio,
          liberar: 'COMMIT',
          enviar: peticion.enviar,
        });

        expect
          .soft(
            esperoElBloqueo,
            `${peticion.nombre}: la petición debía quedar esperando el bloqueo de la fila del actor`,
          )
          .toBe(true);
        expect.soft(resultado.status, `${peticion.nombre}: ${JSON.stringify(resultado.body)}`).toBe(401);
        expect.soft(resultado.body?.codigo).toBe('NO_AUTENTICADO');
        const fila = await leerUsuario(e.A.id, x.id);
        expect(fila?.estado, 'X quedó como lo dejó la prueba').toBe(estado);
        expect(fila?.version_token, 'el que dejó la prueba').toBe(versionAntes + 1);
        expect(await instantanea(), 'ninguna fila de planes, clases ni auditoría cambia, en A ni en B').toEqual(antes);
        expect(await leerAuditoriaDeAcademia(e.A.id, peticion.accion)).toHaveLength(0);
        expect(await contarAuditoria(e.A.id)).toBe(0);
      },
    );
  });

  describe('control: la prueba bloquea la fila sin cambiarla y hace ROLLBACK', () => {
    it.each([0, 1, 2, 3])(
      'criterio 7 (control, petición %#): la petición espera el bloqueo de la fila del actor y, al liberarlo, tiene éxito y registra una sola auditoría',
      async (indice) => {
        const peticion = (PETICIONES[indice] as () => Peticion)();

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: x.id,
          cambio: 'bloquear-sin-cambiar',
          liberar: 'ROLLBACK',
          enviar: peticion.enviar,
        });

        expect
          .soft(
            esperoElBloqueo,
            `${peticion.nombre} debía pasar por el bloqueo de la fila del actor (bloquearActorVigente)`,
          )
          .toBe(true);
        expect.soft(resultado.status, `${peticion.nombre}: ${JSON.stringify(resultado.body)}`).toBeLessThan(300);
        expect(resultado.status).toBeGreaterThanOrEqual(200);
        await peticion.comprobarExito();
        expect(await leerAuditoriaDeAcademia(e.A.id, peticion.accion)).toHaveLength(1);
        expect((await leerUsuario(e.A.id, x.id))?.estado).toBe('ACTIVO');
      },
    );
  });
});
