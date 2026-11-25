// spec: 004-planes-clases-aforo (pruebas protegidas)
// Actualizada por la 007 (spec 007-pagos, DT-12 y criterio 8): la matriz pasa de 25 a 26 filas con `AJUSTAR_MONTO_COBRO` (solo ADMIN); solo cambia el conteo de la matriz.
import { MATRIZ_PERMISOS, puede } from '@aquagestion/contratos';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  type ClaseDePrueba,
  cuerpoClase,
  cuerpoPlan,
  crearClaseDePrueba,
  crearPlanDePrueba,
  exigirRutasDePlanesYClases,
  instantaneaDePlanesYClases,
  type PlanDePrueba,
} from '../../utilidades/planes-clases';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  fijarEstadoDeAcademia,
  pedir,
  type RolUsuario,
  rutasRegistradas,
} from '../../utilidades/usuarios';

// Criterio 5 (crítico, sección 2.1, D-29): las seis rutas del contrato responden 200 o 201 al ADMIN y 403 SIN_PERMISO a SECRETARIA,
// ENTRENADOR y ALUMNO, sin escribir ni auditar nada; sin sesión, 401 NO_AUTENTICADO; con el cambio de contraseña pendiente, 403
// CAMBIO_DE_CLAVE_OBLIGATORIO; con A suspendida, 403 ACADEMIA_SUSPENDIDA, en el orden de comprobaciones de la 002 (sesión -> academia
// activa -> cambio obligatorio -> permiso -> cuerpo -> operación). La cookie del Superadmin (aq_plataforma) responde 401 y el
// Superadmin no tiene rutas de planes ni de clases (D-29). Todas usan CONFIGURAR_PLANES_HORARIOS_AFORO, que sigue solo con
// ADMIN: 'TODO' (MATRIZ_PERMISOS no cambia: 24 filas, pregunta T2).

type Metodo = 'get' | 'post' | 'patch';
interface RutaDelContrato {
  nombre: string;
  metodo: Metodo;
  ruta: () => string;
  cuerpo?: () => Record<string, unknown>;
  exito: 200 | 201;
  escribe: boolean;
}

describe('criterio 5: permisos de planes y clases', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let plan: PlanDePrueba;
  let clase: ClaseDePrueba;
  const cookies = {} as Record<RolUsuario, string>;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    cookies.ADMIN = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    cookies.SECRETARIA = cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS);
    cookies.ENTRENADOR = cookieDeUsuario(e.entrenadorA, AHORA_PRUEBAS);
    cookies.ALUMNO = cookieDeUsuario(e.alumnoA, AHORA_PRUEBAS);
    // Filas y auditoría previas en A y en B: "no escribe ni audita nada" tiene que poder verse.
    plan = await crearPlanDePrueba(e.A.id, { nombre: 'Plan de A' });
    clase = await crearClaseDePrueba(e.A.id, e.entrenadorA.id);
    await crearPlanDePrueba(e.B.id, { nombre: 'Plan de B' });
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await app?.close();
  });

  const RUTAS: RutaDelContrato[] = [
    { nombre: 'GET /api/planes', metodo: 'get', ruta: () => '/api/planes', exito: 200, escribe: false },
    {
      nombre: 'POST /api/planes',
      metodo: 'post',
      ruta: () => '/api/planes',
      cuerpo: () => cuerpoPlan({ nombre: 'Plan creado en la prueba' }),
      exito: 201,
      escribe: true,
    },
    {
      nombre: 'PATCH /api/planes/{id}',
      metodo: 'patch',
      ruta: () => `/api/planes/${plan.id}`,
      cuerpo: () => ({ precio: '130.00' }),
      exito: 200,
      escribe: true,
    },
    { nombre: 'GET /api/clases', metodo: 'get', ruta: () => '/api/clases', exito: 200, escribe: false },
    {
      nombre: 'POST /api/clases',
      metodo: 'post',
      ruta: () => '/api/clases',
      cuerpo: () => cuerpoClase(e.entrenadorA.id, { diaSemana: 2, horaInicio: '10:00' }),
      exito: 201,
      escribe: true,
    },
    {
      nombre: 'PATCH /api/clases/{id}',
      metodo: 'patch',
      ruta: () => `/api/clases/${clase.id}`,
      cuerpo: () => ({ aforo: 40 }),
      exito: 200,
      escribe: true,
    },
  ];

  const enviar = (ruta: RutaDelContrato, cookie?: string, cuerpo = ruta.cuerpo?.()) =>
    pedir(app, ruta.metodo, ruta.ruta(), { cookie, cuerpo });

  async function estado() {
    return {
      filasA: await instantaneaDePlanesYClases(e.A.id),
      filasB: await instantaneaDePlanesYClases(e.B.id),
      auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
      auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
    };
  }
  const codigoDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).codigo;

  describe('cada rol de A', () => {
    it.each([0, 1, 2, 3, 4, 5])(
      'criterio 5: la ruta %#, con el ADMIN, responde 200 o 201 con Cache-Control: no-store',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDelContrato;

        const respuesta = await enviar(ruta, cookies.ADMIN);

        expect(respuesta.status, `${ruta.nombre}: ${JSON.stringify(respuesta.body)}`).toBe(ruta.exito);
        expect(respuesta.headers['cache-control']).toBe('no-store');
      },
    );

    it('criterio 5: las cuatro escrituras del ADMIN dejan una auditoría cada una (PLAN_CREADO, PLAN_ACTUALIZADO, CLASE_CREADA y CLASE_ACTUALIZADA)', async () => {
      for (const ruta of RUTAS.filter((r) => r.escribe)) {
        const respuesta = await enviar(ruta, cookies.ADMIN);
        expect(respuesta.status, ruta.nombre).toBe(ruta.exito);
      }

      const acciones = (await leerAuditoriaDeAcademia(e.A.id))
        .map((fila) => fila.accion)
        .filter((accion) => accion !== 'ACCION_PREVIA_A')
        .sort();
      expect(acciones).toEqual(['CLASE_ACTUALIZADA', 'CLASE_CREADA', 'PLAN_ACTUALIZADO', 'PLAN_CREADO']);
    });

    describe.each(['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const)('%s', (rol) => {
      it.each([0, 1, 2, 3, 4, 5])(
        'criterio 5: la ruta %#, con este rol, responde 403 SIN_PERMISO sin escribir ni auditar nada y sin datos',
        async (indice) => {
          const ruta = RUTAS[indice] as RutaDelContrato;
          const antes = await estado();

          const respuesta = await enviar(ruta, cookies[rol]);

          expect(respuesta.status, `${ruta.nombre}: ${JSON.stringify(respuesta.body)}`).toBe(403);
          expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
          expect(respuesta.headers['cache-control']).toBe('no-store');
          expect(JSON.stringify(respuesta.body)).not.toMatch(/Plan de A|"planes":|"clases":|"precio"|"aforo"/);
          expect(await estado()).toEqual(antes);
        },
      );
    });

    it('criterio 5: el permiso se comprueba antes que el cuerpo: con un cuerpo inválido, un rol sin permiso responde 403 y el ADMIN 400', async () => {
      const casos: [string, Metodo, string, unknown][] = [
        ['POST /api/planes', 'post', '/api/planes', {}],
        ['POST /api/planes', 'post', '/api/planes', { academiaId: e.B.id }],
        ['PATCH /api/planes/{id}', 'patch', `/api/planes/${plan.id}`, {}],
        ['POST /api/clases', 'post', '/api/clases', {}],
        ['POST /api/clases', 'post', '/api/clases', { aforo: 5 }],
        ['PATCH /api/clases/{id}', 'patch', `/api/clases/${clase.id}`, {}],
        ['PATCH /api/clases/{id}', 'patch', `/api/clases/${clase.id}`, { aforo: 99 }],
      ];
      const antes = await estado();

      for (const [nombre, metodo, ruta, cuerpo] of casos) {
        for (const rol of ['SECRETARIA', 'ENTRENADOR', 'ALUMNO'] as const) {
          const sinPermiso = await pedir(app, metodo, ruta, { cookie: cookies[rol], cuerpo });
          expect(sinPermiso.status, `${nombre} ${rol} con ${JSON.stringify(cuerpo)}`).toBe(403);
          expect(codigoDe(sinPermiso)).toBe('SIN_PERMISO');
        }
        const admin = await pedir(app, metodo, ruta, { cookie: cookies.ADMIN, cuerpo });
        expect(admin.status, `${nombre} ADMIN con ${JSON.stringify(cuerpo)}`).toBe(400);
        expect(codigoDe(admin)).toBe('SOLICITUD_INVALIDA');
      }
      expect(await estado()).toEqual(antes);
    });

    it('criterio 5: el rol se lee de la base en cada petición: un ADMIN que pasa a SECRETARIA pierde el permiso al instante', async () => {
      const antes = await pedir(app, 'get', '/api/planes', { cookie: cookies.ADMIN });
      await actualizarUsuario(e.A.id, e.adminA.id, { rol: 'SECRETARIA' });

      const lectura = await pedir(app, 'get', '/api/planes', { cookie: cookies.ADMIN });
      const escritura = await pedir(app, 'post', '/api/clases', {
        cookie: cookies.ADMIN,
        cuerpo: cuerpoClase(e.entrenadorA.id, { diaSemana: 3 }),
      });

      expect(antes.status).toBe(200);
      expect(lectura.status).toBe(403);
      expect(codigoDe(lectura)).toBe('SIN_PERMISO');
      expect(escritura.status).toBe(403);
      expect(codigoDe(escritura)).toBe('SIN_PERMISO');
    });

    it('criterio 5: el ADMIN de otra academia solo ve y escribe lo suyo (no tiene permiso sobre lo de A)', async () => {
      const respuesta = await pedir(app, 'get', '/api/planes', { cookie: cookieDeUsuario(e.adminB, AHORA_PRUEBAS) });

      expect(respuesta.status).toBe(200);
      expect((respuesta.body as { planes: { nombre: string }[] }).planes.map((p) => p.nombre)).toEqual(['Plan de B']);
    });
  });

  describe('sin sesión', () => {
    it.each([0, 1, 2, 3, 4, 5])(
      'criterio 5: la ruta %#, sin sesión, responde 401 NO_AUTENTICADO y no escribe nada, ni con un cuerpo inválido',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDelContrato;
        const antes = await estado();

        const valido = await enviar(ruta, undefined);
        const invalido = await enviar(ruta, undefined, ruta.cuerpo ? {} : undefined);

        for (const respuesta of [valido, invalido]) {
          expect(respuesta.status, `${ruta.nombre}: ${JSON.stringify(respuesta.body)}`).toBe(401);
          expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
        }
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 5: una cookie con un token que no es válido responde 401 NO_AUTENTICADO en las seis rutas', async () => {
      for (const ruta of RUTAS) {
        const respuesta = await enviar(ruta, 'aq_sesion=no-es-un-token');

        expect(respuesta.status, ruta.nombre).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
      }
    });
  });

  describe('cambio de contraseña pendiente', () => {
    it.each([0, 1, 2, 3, 4, 5])(
      'criterio 5: la ruta %#, con un ADMIN con el cambio pendiente, responde 403 CAMBIO_DE_CLAVE_OBLIGATORIO y no escribe nada',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDelContrato;
        const pendiente = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', debeCambiarClave: true });
        const cookie = cookieDeUsuario(pendiente, AHORA_PRUEBAS);
        const antes = await estado();

        const valido = await enviar(ruta, cookie);
        const invalido = await enviar(ruta, cookie, ruta.cuerpo ? {} : undefined);

        for (const respuesta of [valido, invalido]) {
          expect(respuesta.status, `${ruta.nombre}: ${JSON.stringify(respuesta.body)}`).toBe(403);
          expect(codigoDe(respuesta)).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
        }
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 5: el cambio pendiente se comprueba antes que el permiso: una secretaria con el cambio pendiente recibe CAMBIO_DE_CLAVE_OBLIGATORIO, no SIN_PERMISO', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });

      for (const ruta of RUTAS) {
        const respuesta = await enviar(ruta, cookies.SECRETARIA);

        expect(respuesta.status, ruta.nombre).toBe(403);
        expect(codigoDe(respuesta)).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
      }
    });
  });

  describe('academia suspendida', () => {
    it('criterio 5: con A suspendida, las seis rutas responden 403 ACADEMIA_SUSPENDIDA a su ADMIN y no se escribe nada; B sigue sirviendo', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      const antes = await estado();

      for (const ruta of RUTAS) {
        const respuesta = await enviar(ruta, cookies.ADMIN);

        expect(respuesta.status, `${ruta.nombre}: ${JSON.stringify(respuesta.body)}`).toBe(403);
        expect(codigoDe(respuesta)).toBe('ACADEMIA_SUSPENDIDA');
      }
      const deB = await pedir(app, 'get', '/api/planes', { cookie: cookieDeUsuario(e.adminB, AHORA_PRUEBAS) });
      expect(deB.status).toBe(200);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 5: la academia suspendida se comprueba antes que el cambio pendiente y que el permiso', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });

      for (const cookie of [cookies.SECRETARIA, cookies.ALUMNO]) {
        for (const ruta of RUTAS) {
          const respuesta = await enviar(ruta, cookie);

          expect(respuesta.status, ruta.nombre).toBe(403);
          expect(codigoDe(respuesta)).toBe('ACADEMIA_SUSPENDIDA');
        }
      }
    });
  });

  describe('Superadmin (D-29)', () => {
    it('criterio 5: las seis rutas están registradas y ninguna ruta de plataforma ve ni cambia planes o clases de una academia', () => {
      const rutas = rutasRegistradas(app).map(([metodo, ruta]) => `${metodo} ${ruta}`);

      expect(rutas).toContain('GET /api/planes');
      expect(rutas).toContain('GET /api/clases');
      expect(
        rutas.filter((ruta) => /^[A-Z]+ \/api\/plataforma/.test(ruta) && /plan|clase|horario|aforo/i.test(ruta)),
        'una ruta de plataforma toca los planes o las clases de las academias',
      ).toEqual([]);
    });

    it.each([0, 1, 2, 3, 4, 5])(
      'criterio 5: la ruta %#, con la sesión de plataforma del Superadmin (aq_plataforma), responde 401 NO_AUTENTICADO y no escribe nada',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDelContrato;
        const cookie = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
        const antes = await estado();

        const respuesta = await enviar(ruta, cookie);

        expect(respuesta.status, `${ruta.nombre}: ${JSON.stringify(respuesta.body)}`).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
        expect(await estado()).toEqual(antes);
      },
    );

    it.each([
      ['GET', (id: string) => `/api/plataforma/academias/${id}/planes`],
      ['GET', (id: string) => `/api/plataforma/academias/${id}/clases`],
      ['POST', (id: string) => `/api/plataforma/academias/${id}/planes`],
      ['GET', () => '/api/plataforma/planes'],
      ['GET', () => '/api/plataforma/clases'],
    ] as const)(
      'criterio 5: %s %#: el Superadmin no tiene ninguna ruta de plataforma con los planes o las clases de una academia (404) y no se escribe nada',
      async (metodo, ruta) => {
        const cookie = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
        const antes = await estado();

        const respuesta = await pedir(app, metodo === 'GET' ? 'get' : 'post', ruta(e.A.id), {
          cookie,
          cuerpo: metodo === 'GET' ? undefined : cuerpoPlan(),
        });

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(404);
        expect(JSON.stringify(respuesta.body)).not.toContain('Plan de A');
        expect(await estado()).toEqual(antes);
      },
    );
  });

  describe('la matriz de permisos', () => {
    it('criterio 5: CONFIGURAR_PLANES_HORARIOS_AFORO sigue solo con ADMIN: TODO y la matriz sigue con 24 filas más REABRIR_CAJA de la 006 (DT-2)', () => {
      expect(MATRIZ_PERMISOS['CONFIGURAR_PLANES_HORARIOS_AFORO']).toEqual({ ADMIN: 'TODO' });
      // Historia 006 (DT-1): la matriz suma la fila REABRIR_CAJA (de 24 a 25); historia 007 (DT-12): suma AJUSTAR_MONTO_COBRO (de 25 a 26).
      expect(Object.keys(MATRIZ_PERMISOS)).toHaveLength(26);
      expect(puede('ADMIN', 'CONFIGURAR_PLANES_HORARIOS_AFORO')).toBe(true);
      for (const rol of ['SECRETARIA', 'ENTRENADOR', 'ALUMNO']) {
        expect(puede(rol, 'CONFIGURAR_PLANES_HORARIOS_AFORO'), rol).toBe(false);
      }
    });
  });
});
