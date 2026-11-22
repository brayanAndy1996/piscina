// spec: 006-caja (pruebas protegidas)
import { MATRIZ_PERMISOS } from '@aquagestion/contratos';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_ABIERTA,
  ACCION_CAJA_CERRADA,
  ACCION_CAJA_EGRESO,
  ACCION_CAJA_REABIERTA,
  type AppCaja,
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  cuerpoApertura,
  cuerpoCierre,
  cuerpoEgreso,
  cuerpoReapertura,
  type EscenarioCaja,
  exigirRutasDeCaja,
  instantaneaDeCaja,
  rutaCaja,
} from '../../utilidades/caja';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearUsuarioDePrueba,
  fijarEstadoDeAcademia,
  rutasRegistradas,
} from '../../utilidades/usuarios';

// Criterio 7 (crítico, sección 2.1, HU-27, D-29): dadas sesiones válidas de cada rol de A:
//   - GET /api/cajas/actual, POST /api/cajas, POST /api/cajas/{id}/egresos y POST /api/cajas/{id}/cierre (permiso ABRIR_CERRAR_CAJA)
//     responden a ADMIN y SECRETARIA, y 403 SIN_PERMISO a ENTRENADOR y ALUMNO;
//   - POST /api/cajas/{id}/reapertura (permiso nuevo REABRIR_CAJA, solo ADMIN: 'TODO', DT-1) responde al ADMIN y 403 SIN_PERMISO a SECRETARIA,
//     ENTRENADOR y ALUMNO.
// Ningún 403 escribe ni audita. Sin sesión, 401 NO_AUTENTICADO; con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO; con A
// suspendida, 403 ACADEMIA_SUSPENDIDA, en el orden de comprobaciones de la 002 (sesión -> academia activa -> cambio obligatorio -> permiso ->
// cuerpo -> operación). La cookie del Superadmin (aq_plataforma) responde 401 y el Superadmin no tiene rutas de caja (D-29). La matriz pasa
// de 24 a 25 filas con REABRIR_CAJA (la prueba de la matriz está en packages/contratos/src/permisos.test.ts).
// Las rutas de la 006b (historial, detalle y PDF) las prueba la 006b.

type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';

interface RutaDelContrato {
  nombre: string;
  metodo: 'get' | 'post';
  /** Los roles que sí pasan el permiso. */
  roles: readonly Rol[];
  exito: 200 | 201;
  /** Prepara el estado que la ruta necesita (otra caja abierta, una cerrada…) y devuelve la dirección y el cuerpo válidos. */
  preparar: () => Promise<{ ruta: string; cuerpo?: Record<string, unknown> }>;
  /** La acción que una escritura exitosa deja en la auditoría. */
  accion?: string;
}

describe('criterio 7: permisos de las rutas de la caja', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    // Auditoría previa en A: "no audita nada" tiene que poder verse.
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const RUTAS: RutaDelContrato[] = [
    {
      nombre: 'GET /api/cajas/actual',
      metodo: 'get',
      roles: ['admin', 'secretaria'],
      exito: 200,
      preparar: () => Promise.resolve({ ruta: '/api/cajas/actual' }),
    },
    {
      nombre: 'POST /api/cajas',
      metodo: 'post',
      roles: ['admin', 'secretaria'],
      exito: 201,
      accion: ACCION_CAJA_ABIERTA,
      preparar: () => Promise.resolve({ ruta: '/api/cajas', cuerpo: cuerpoApertura() }),
    },
    {
      nombre: 'POST /api/cajas/{id}/egresos',
      metodo: 'post',
      roles: ['admin', 'secretaria'],
      exito: 201,
      accion: ACCION_CAJA_EGRESO,
      preparar: async () => {
        const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
        return { ruta: rutaCaja(caja.id, '/egresos'), cuerpo: cuerpoEgreso() };
      },
    },
    {
      nombre: 'POST /api/cajas/{id}/cierre',
      metodo: 'post',
      roles: ['admin', 'secretaria'],
      exito: 200,
      accion: ACCION_CAJA_CERRADA,
      preparar: async () => {
        const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
        return { ruta: rutaCaja(caja.id, '/cierre'), cuerpo: cuerpoCierre() };
      },
    },
    {
      nombre: 'POST /api/cajas/{id}/reapertura',
      metodo: 'post',
      roles: ['admin'],
      exito: 200,
      accion: ACCION_CAJA_REABIERTA,
      preparar: async () => {
        const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
        await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
        return { ruta: rutaCaja(caja.id, '/reapertura'), cuerpo: cuerpoReapertura() };
      },
    },
  ];
  const INDICES = [0, 1, 2, 3, 4];
  const ESCRITURAS = [1, 2, 3, 4];
  const POST_CON_CUERPO = [1, 2, 3, 4];
  const ROLES_DE_A: Rol[] = ['admin', 'secretaria', 'entrenador', 'alumno'];

  type Preparada = { ruta: string; cuerpo?: Record<string, unknown> };
  /** Envía la petición ya preparada, con la cookie y, si se indica, otro cuerpo. */
  const enviarPreparada = (
    ruta: RutaDelContrato,
    preparada: Preparada,
    cookie: string | undefined,
    cuerpo?: unknown,
  ) =>
    ruta.metodo === 'get'
      ? ctx.http.get(preparada.ruta, cookie)
      : ctx.http.post(preparada.ruta, cookie, cuerpo === undefined ? preparada.cuerpo : cuerpo);
  /** Prepara y envía. */
  const enviar = async (ruta: RutaDelContrato, cookie: string | undefined, cuerpo?: unknown) =>
    enviarPreparada(ruta, await ruta.preparar(), cookie, cuerpo);

  async function estado() {
    return {
      cajasA: await instantaneaDeCaja(e.A.id),
      cajasB: await instantaneaDeCaja(e.B.id),
      auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
      auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
    };
  }

  describe('cada rol de A', () => {
    const CASOS = INDICES.flatMap((indice) => ROLES_DE_A.map((rol) => ({ indice, rol })));

    it.each(CASOS)(
      'criterio 7: la ruta $indice, con el rol $rol: si el permiso lo deja pasar responde con éxito y Cache-Control: no-store; si no, 403 SIN_PERMISO sin escribir ni auditar nada y sin datos',
      async ({ indice, rol }) => {
        const ruta = RUTAS[indice] as RutaDelContrato;
        const pasa = ruta.roles.includes(rol);
        const preparada = await ruta.preparar();
        const antes = await estado();

        const respuesta = await enviarPreparada(ruta, preparada, cookies[rol]);

        expect(respuesta.cacheControl).toBe('no-store');
        if (pasa) {
          expect(respuesta.status, `${ruta.nombre} (${rol}): ${respuesta.texto}`).toBe(ruta.exito);
          return;
        }
        expect(respuesta.status, `${ruta.nombre} (${rol}): ${respuesta.texto}`).toBe(403);
        expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
        expect(respuesta.texto).not.toMatch(/"caja":|"movimientos":|"montoInicial"|"resumen"/);
        expect(await estado()).toEqual(antes);
      },
    );

    it.each(ESCRITURAS)(
      'criterio 7: la escritura %# deja una auditoría con su acción cuando la hace un rol con permiso',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDelContrato;

        const respuesta = await enviar(ruta, cookies.admin);

        expect(respuesta.status, `${ruta.nombre}: ${respuesta.texto}`).toBe(ruta.exito);
        expect(await leerAuditoriaDeAcademia(e.A.id, ruta.accion)).toHaveLength(1);
      },
    );

    it('criterio 7: solo el ADMIN reabre: la SECRETARIA que abrió y cerró la caja recibe 403 SIN_PERMISO al reabrirla', async () => {
      const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id);
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);
      const antes = await estado();

      const respuesta = await ctx.http.post(rutaCaja(caja.id, '/reapertura'), cookies.secretaria, cuerpoReapertura());

      expect(respuesta.status).toBe(403);
      expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
      expect(await estado()).toEqual(antes);
    });

    it.each(POST_CON_CUERPO)(
      'criterio 7: el permiso se comprueba antes que el cuerpo (ruta %#): con un cuerpo inválido, un rol sin permiso responde 403 y uno con permiso 400',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDelContrato;
        const preparada = await ruta.preparar();
        const antes = await estado();

        for (const rol of ROLES_DE_A) {
          const respuesta = await ctx.http.post(preparada.ruta, cookies[rol], { academiaId: e.B.id });
          if (ruta.roles.includes(rol)) {
            expect(respuesta.status, `${ruta.nombre} ${rol}`).toBe(400);
            expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
          } else {
            expect(respuesta.status, `${ruta.nombre} ${rol}`).toBe(403);
            expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
          }
        }
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 7: el rol se lee de la base en cada petición: una SECRETARIA que pasa a ENTRENADOR pierde al instante el permiso de la caja', async () => {
      const antes = await ctx.http.get('/api/cajas/actual', cookies.secretaria);
      await actualizarUsuario(e.A.id, e.secretariaA.id, { rol: 'ENTRENADOR' });

      const lectura = await ctx.http.get('/api/cajas/actual', cookies.secretaria);
      const escritura = await ctx.http.post('/api/cajas', cookies.secretaria, cuerpoApertura());

      expect(antes.status).toBe(200);
      expect(lectura.status).toBe(403);
      expect(codigoDe(lectura)).toBe('SIN_PERMISO');
      expect(escritura.status).toBe(403);
      expect(codigoDe(escritura)).toBe('SIN_PERMISO');
    });
  });

  describe('sin sesión', () => {
    it.each(INDICES)(
      'criterio 7: la ruta %#, sin sesión, responde 401 NO_AUTENTICADO y no escribe nada, ni con un cuerpo inválido',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDelContrato;
        const preparada = await ruta.preparar();
        const antes = await estado();

        const valido = await enviarPreparada(ruta, preparada, undefined);
        const invalido = await enviarPreparada(ruta, preparada, undefined, ruta.metodo === 'post' ? {} : undefined);

        for (const respuesta of [valido, invalido]) {
          expect(respuesta.status, `${ruta.nombre}: ${respuesta.texto}`).toBe(401);
          expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
        }
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 7: una cookie con un token que no es válido responde 401 NO_AUTENTICADO en las cinco rutas', async () => {
      for (const ruta of RUTAS) {
        const respuesta = await enviar(ruta, 'aq_sesion=no-es-un-token');

        expect(respuesta.status, ruta.nombre).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
      }
    });
  });

  describe('cambio de contraseña pendiente', () => {
    it.each(INDICES)(
      'criterio 7: la ruta %#, con un ADMIN con el cambio pendiente, responde 403 CAMBIO_DE_CLAVE_OBLIGATORIO y no escribe nada',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDelContrato;
        const pendiente = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', debeCambiarClave: true });
        const cookie = cookieDeUsuario(pendiente, AHORA_PRUEBAS);
        const preparada = await ruta.preparar();
        const antes = await estado();

        const respuestas = [
          await enviarPreparada(ruta, preparada, cookie),
          await enviarPreparada(ruta, preparada, cookie, ruta.metodo === 'post' ? {} : undefined),
        ];

        for (const respuesta of respuestas) {
          expect(respuesta.status, `${ruta.nombre}: ${respuesta.texto}`).toBe(403);
          expect(codigoDe(respuesta)).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
        }
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 7: el cambio pendiente se comprueba antes que el permiso: una secretaria con el cambio pendiente recibe CAMBIO_DE_CLAVE_OBLIGATORIO, también al reabrir', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });

      for (const ruta of RUTAS) {
        const respuesta = await enviar(ruta, cookies.secretaria);

        expect(respuesta.status, ruta.nombre).toBe(403);
        expect(codigoDe(respuesta)).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
      }
    });
  });

  describe('academia suspendida', () => {
    it('criterio 7: con A suspendida, las cinco rutas responden 403 ACADEMIA_SUSPENDIDA a su ADMIN y no se escribe nada; B sigue sirviendo', async () => {
      const preparadas: Preparada[] = [];
      for (const ruta of RUTAS) preparadas.push(await ruta.preparar());
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      const antes = await estado();

      for (const [indice, ruta] of RUTAS.entries()) {
        const respuesta = await enviarPreparada(ruta, preparadas[indice] as Preparada, cookies.admin);

        expect(respuesta.status, `${ruta.nombre}: ${respuesta.texto}`).toBe(403);
        expect(codigoDe(respuesta)).toBe('ACADEMIA_SUSPENDIDA');
      }
      const deB = await ctx.http.get('/api/cajas/actual', cookies.adminB);
      expect(deB.status).toBe(200);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 7: la academia suspendida se comprueba antes que el cambio pendiente y que el permiso', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });

      for (const cookie of [cookies.secretaria, cookies.alumno]) {
        for (const ruta of RUTAS) {
          const respuesta = await enviar(ruta, cookie);

          expect(respuesta.status, ruta.nombre).toBe(403);
          expect(codigoDe(respuesta)).toBe('ACADEMIA_SUSPENDIDA');
        }
      }
    });
  });

  describe('Superadmin (D-29)', () => {
    it('criterio 7: las cinco rutas están registradas y ninguna ruta de plataforma ve ni cambia las cajas de una academia', () => {
      const rutas = rutasRegistradas(ctx.app).map(([metodo, ruta]) => `${metodo} ${ruta}`);

      expect(rutas).toContain('GET /api/cajas/actual');
      expect(rutas).toContain('POST /api/cajas');
      expect(
        rutas.filter((ruta) => /^[A-Z]+ \/api\/plataforma/.test(ruta) && /caja|movimiento|cierre|arqueo/i.test(ruta)),
        'una ruta de plataforma toca la caja de las academias',
      ).toEqual([]);
    });

    it.each(INDICES)(
      'criterio 7: la ruta %#, con la sesión de plataforma del Superadmin (aq_plataforma), responde 401 NO_AUTENTICADO y no escribe nada',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDelContrato;
        const cookie = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
        const preparada = await ruta.preparar();
        const antes = await estado();

        const respuesta = await enviarPreparada(ruta, preparada, cookie);

        expect(respuesta.status, `${ruta.nombre}: ${respuesta.texto}`).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
        expect(await estado()).toEqual(antes);
      },
    );

    it.each([
      ['GET', (id: string) => `/api/plataforma/academias/${id}/cajas`],
      ['GET', (id: string) => `/api/plataforma/academias/${id}/cajas/actual`],
      ['POST', (id: string) => `/api/plataforma/academias/${id}/cajas`],
      ['GET', () => '/api/plataforma/cajas'],
    ] as const)(
      'criterio 7: %s %#: el Superadmin no tiene ninguna ruta de plataforma con la caja de una academia (404) y no se escribe nada',
      async (metodo, ruta) => {
        const cookie = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
        const antes = await estado();

        const respuesta =
          metodo === 'GET'
            ? await ctx.http.get(ruta(e.A.id), cookie)
            : await ctx.http.post(ruta(e.A.id), cookie, cuerpoApertura());

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(404);
        expect(await estado()).toEqual(antes);
      },
    );
  });

  describe('la matriz', () => {
    // La fila nueva todavía no está en el tipo de la matriz: se lee como un registro de texto (falta la funcionalidad, no un error de tipos).
    const matriz = MATRIZ_PERMISOS as Readonly<Record<string, unknown>>;

    it('criterio 7: REABRIR_CAJA es solo de ADMIN y ABRIR_CERRAR_CAJA de ADMIN y SECRETARIA (la API y la web leen la misma matriz)', () => {
      expect(matriz['REABRIR_CAJA']).toEqual({ ADMIN: 'TODO' });
      expect(matriz['ABRIR_CERRAR_CAJA']).toEqual({ ADMIN: 'TODO', SECRETARIA: 'TODO' });
      expect(Object.keys(matriz)).toHaveLength(25);
    });
  });
});
