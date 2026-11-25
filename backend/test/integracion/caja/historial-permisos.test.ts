// spec: 006-caja (pruebas protegidas)
// Actualizada por la 007 (spec 007-pagos, DT-12 y criterio 8): la matriz pasa de 25 a 26 filas con `AJUSTAR_MONTO_COBRO` (solo ADMIN); solo cambia el conteo de la matriz.
import { MATRIZ_PERMISOS } from '@aquagestion/contratos';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  enLima,
  type EscenarioCaja,
  HOY,
  instantaneaDeCaja,
  retenerCaja,
  retenerUsuarios,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  crearAppHistorial,
  exigirGeneradorInyectable,
  exigirRutasDeHistorial,
  GeneradorDePrueba,
  rutaPdf,
} from '../../utilidades/caja-historial';
import { abrirRetenedor, conLimite } from '../../utilidades/planes-clases';
import { cookieDeSesion } from '../../utilidades/superadmins';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearUsuarioDePrueba,
  fijarEstadoDeAcademia,
  rutasRegistradas,
} from '../../utilidades/usuarios';

// Criterio 7 en su parte de la 006b y PQ1 (crítico, sección 2.1, HU-27, D-29): GET /api/cajas, GET /api/cajas/{id} y GET
// /api/cajas/{id}/cierres/{numero}/pdf (permiso VER_REPORTES_FINANCIEROS) responden a ADMIN y SECRETARIA (con el alcance del criterio 40, que
// prueba historial-alcance.test.ts) y 403 SIN_PERMISO a ENTRENADOR y ALUMNO, aunque el id, el número o la consulta sean inválidos. Orden de 002
// (PQ1): sesión (401 NO_AUTENTICADO) -> academia activa (403 ACADEMIA_SUSPENDIDA) -> cambio obligatorio (403 CAMBIO_DE_CLAVE_OBLIGATORIO) ->
// permiso (403 SIN_PERMISO) -> consulta (solo la lista) -> operación. La cookie del Superadmin (aq_plataforma) responde 401 y no hay rutas de caja
// de plataforma (D-29). Las tres lecturas no llaman a `bloquearActorVigente`, no bloquean filas, no escriben y no auditan. Ningún 403 escribe ni
// audita. El generador del PDF se reemplaza con `overrideProvider(GENERADOR_PDF_CIERRE)` (PQ8): estas pruebas no miran el contenido del PDF.

type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';
const ROLES: readonly Rol[] = ['admin', 'secretaria', 'entrenador', 'alumno'];
const CON_PERMISO: readonly Rol[] = ['admin', 'secretaria'];

interface RutaDeLectura {
  nombre: string;
  /** La dirección válida (la caja de hoy, ya cerrada, la ven los dos roles con permiso: DR-13). */
  valida: (cajaId: string) => string;
  /** Una dirección con el id, el número o la consulta inválidos. */
  invalida: string;
  /** Lo que responde a un rol con permiso la dirección inválida. */
  estadoInvalida: 400 | 404;
}

const RUTAS: RutaDeLectura[] = [
  {
    nombre: 'GET /api/cajas',
    valida: () => '/api/cajas',
    invalida: '/api/cajas?desde=basura&hasta=2020-13-45',
    estadoInvalida: 400,
  },
  {
    nombre: 'GET /api/cajas/{id}',
    valida: (id) => `/api/cajas/${id}`,
    invalida: '/api/cajas/no-es-un-uuid',
    estadoInvalida: 404,
  },
  {
    nombre: 'GET /api/cajas/{id}/cierres/{numero}/pdf',
    valida: (id) => rutaPdf(id, 1),
    invalida: rutaPdf('no-es-un-uuid', 'uno'),
    estadoInvalida: 404,
  },
];
const INDICES = [0, 1, 2];

describe('criterio 7 (006b): permisos del historial, el detalle y el PDF', () => {
  const generador = new GeneradorDePrueba();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let cajaDeHoy: { id: string };

  beforeAll(async () => {
    ctx = await crearAppHistorial(AHORA_PRUEBAS, generador);
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    generador.restablecer();
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    // La caja de hoy, abierta y cerrada por la secretaria de A (cierre 1 vigente): la ven el ADMIN y cualquier secretaria (DR-13).
    cajaDeHoy = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    await cerrarCajaDePrueba(e.A.id, cajaDeHoy.id, e.secretariaA.id, { cerradoEn: enLima(HOY, '09:50') });
    // Auditoría previa en A: "no audita nada" tiene que poder verse.
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterEach(() => {
    generador.cancelarRetenido();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  async function estado() {
    return {
      cajasA: await instantaneaDeCaja(e.A.id),
      cajasB: await instantaneaDeCaja(e.B.id),
      auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
      auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
    };
  }

  describe('cada rol de A', () => {
    const CASOS = INDICES.flatMap((indice) => ROLES.map((rol) => ({ indice, rol })));

    it.each(CASOS)(
      'criterio 7: la ruta $indice, con el rol $rol: si el permiso lo deja pasar responde 200; si no, 403 SIN_PERMISO sin datos; siempre con Cache-Control: no-store y sin escribir ni auditar',
      async ({ indice, rol }) => {
        const ruta = RUTAS[indice] as RutaDeLectura;
        const antes = await estado();

        const respuesta = await ctx.http.get(ruta.valida(cajaDeHoy.id), cookies[rol]);

        expect(respuesta.cacheControl).toBe('no-store');
        if (CON_PERMISO.includes(rol)) {
          expect(respuesta.status, `${ruta.nombre} (${rol}): ${respuesta.texto}`).toBe(200);
        } else {
          expect(respuesta.status, `${ruta.nombre} (${rol}): ${respuesta.texto}`).toBe(403);
          expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
          expect(respuesta.headers.get('content-disposition')).toBeNull();
          expect(respuesta.texto).not.toMatch(/"cajas?":|"movimientos":|"montoInicial"|"resumen"|%PDF/);
          expect(generador.llamadas).toHaveLength(0);
        }
        expect(await estado()).toEqual(antes);
      },
    );

    it.each(CASOS)(
      'criterio 7 y PQ1: la ruta $indice, con el id, el número o la consulta inválidos y el rol $rol: sin permiso 403 SIN_PERMISO (nunca 400 ni 404); con permiso, el error de la ruta',
      async ({ indice, rol }) => {
        const ruta = RUTAS[indice] as RutaDeLectura;
        const antes = await estado();

        const respuesta = await ctx.http.get(ruta.invalida, cookies[rol]);

        expect(respuesta.cacheControl).toBe('no-store');
        if (CON_PERMISO.includes(rol)) {
          expect(respuesta.status, `${ruta.nombre} (${rol}): ${respuesta.texto}`).toBe(ruta.estadoInvalida);
        } else {
          expect(respuesta.status, `${ruta.nombre} (${rol}): ${respuesta.texto}`).toBe(403);
          expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
        }
        expect(await estado()).toEqual(antes);
      },
    );

    it.each(['entrenador', 'alumno'] as const)(
      'criterio 7 y PQ1: el %s recibe 403 SIN_PERMISO también con el id de una caja de B, con uno que no existe y con un numero de cierre inexistente',
      async (rol) => {
        const deB = await crearCajaDePrueba(e.B.id, e.secretariaB.id);
        await cerrarCajaDePrueba(e.B.id, deB.id, e.secretariaB.id, { cerradoEn: enLima(HOY, '09:50') });
        const direcciones = [
          `/api/cajas/${deB.id}`,
          rutaPdf(deB.id, 1),
          '/api/cajas/00000000-0000-4000-8000-000000000000',
          rutaPdf(cajaDeHoy.id, 99),
          rutaPdf(cajaDeHoy.id, '0'),
          `/api/cajas?academiaId=${e.B.id}`,
        ];

        for (const direccion of direcciones) {
          const respuesta = await ctx.http.get(direccion, cookies[rol]);

          expect(respuesta.status, `${direccion}: ${respuesta.texto}`).toBe(403);
          expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
        }
      },
    );

    it('criterio 7: el rol se lee de la base en cada petición: una SECRETARIA que pasa a ENTRENADOR pierde al instante las tres lecturas', async () => {
      for (const ruta of RUTAS) {
        expect((await ctx.http.get(ruta.valida(cajaDeHoy.id), cookies.secretaria)).status, ruta.nombre).toBe(200);
      }
      await actualizarUsuario(e.A.id, e.secretariaA.id, { rol: 'ENTRENADOR' });

      for (const ruta of RUTAS) {
        const respuesta = await ctx.http.get(ruta.valida(cajaDeHoy.id), cookies.secretaria);

        expect(respuesta.status, ruta.nombre).toBe(403);
        expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
      }
    });
  });

  describe('sin sesión', () => {
    it.each(INDICES)(
      'criterio 7: la ruta %#, sin sesión, responde 401 NO_AUTENTICADO, también con un id, un número o una consulta inválidos',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDeLectura;
        const antes = await estado();

        for (const direccion of [ruta.valida(cajaDeHoy.id), ruta.invalida]) {
          const respuesta = await ctx.http.get(direccion);

          expect(respuesta.status, `${direccion}: ${respuesta.texto}`).toBe(401);
          expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
          expect(respuesta.cacheControl).toBe('no-store');
        }
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 7: una cookie con un token que no es válido responde 401 NO_AUTENTICADO en las tres rutas', async () => {
      for (const ruta of RUTAS) {
        const respuesta = await ctx.http.get(ruta.valida(cajaDeHoy.id), 'aq_sesion=no-es-un-token');

        expect(respuesta.status, ruta.nombre).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
      }
    });
  });

  describe('cambio de contraseña pendiente', () => {
    it.each(INDICES)(
      'criterio 7: la ruta %#, con un ADMIN con el cambio pendiente, responde 403 CAMBIO_DE_CLAVE_OBLIGATORIO, también con un id, un número o una consulta inválidos',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDeLectura;
        const pendiente = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', debeCambiarClave: true });
        const cookie = cookieDeUsuario(pendiente, AHORA_PRUEBAS);
        const antes = await estado();

        for (const direccion of [ruta.valida(cajaDeHoy.id), ruta.invalida]) {
          const respuesta = await ctx.http.get(direccion, cookie);

          expect(respuesta.status, `${direccion}: ${respuesta.texto}`).toBe(403);
          expect(codigoDe(respuesta)).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
        }
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 7: el cambio pendiente se comprueba antes que el permiso: un ENTRENADOR y una SECRETARIA con el cambio pendiente reciben CAMBIO_DE_CLAVE_OBLIGATORIO', async () => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(e.A.id, e.entrenadorA.id, { debe_cambiar_clave: true });

      for (const cookie of [cookies.secretaria, cookies.entrenador]) {
        for (const ruta of RUTAS) {
          const respuesta = await ctx.http.get(ruta.valida(cajaDeHoy.id), cookie);

          expect(respuesta.status, ruta.nombre).toBe(403);
          expect(codigoDe(respuesta)).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
        }
      }
    });
  });

  describe('academia suspendida', () => {
    it('criterio 7: con A suspendida, las tres rutas responden 403 ACADEMIA_SUSPENDIDA a su ADMIN (también con entradas inválidas) y no se escribe nada; B sigue sirviendo', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      const antes = await estado();

      for (const ruta of RUTAS) {
        for (const direccion of [ruta.valida(cajaDeHoy.id), ruta.invalida]) {
          const respuesta = await ctx.http.get(direccion, cookies.admin);

          expect(respuesta.status, `${direccion}: ${respuesta.texto}`).toBe(403);
          expect(codigoDe(respuesta)).toBe('ACADEMIA_SUSPENDIDA');
        }
      }
      expect((await ctx.http.get('/api/cajas', cookies.adminB)).status).toBe(200);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 7: la academia suspendida se comprueba antes que el cambio pendiente y que el permiso', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });

      for (const cookie of [cookies.secretaria, cookies.alumno]) {
        for (const ruta of RUTAS) {
          const respuesta = await ctx.http.get(ruta.valida(cajaDeHoy.id), cookie);

          expect(respuesta.status, ruta.nombre).toBe(403);
          expect(codigoDe(respuesta)).toBe('ACADEMIA_SUSPENDIDA');
        }
      }
    });
  });

  describe('Superadmin (D-29)', () => {
    it.each(INDICES)(
      'criterio 7: la ruta %#, con la sesión de plataforma del Superadmin (aq_plataforma), responde 401 NO_AUTENTICADO y no escribe nada',
      async (indice) => {
        const ruta = RUTAS[indice] as RutaDeLectura;
        const cookie = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
        const antes = await estado();

        const respuesta = await ctx.http.get(ruta.valida(cajaDeHoy.id), cookie);

        expect(respuesta.status, `${ruta.nombre}: ${respuesta.texto}`).toBe(401);
        expect(codigoDe(respuesta)).toBe('NO_AUTENTICADO');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 7: ninguna ruta de plataforma ve la caja de una academia (404) y las tres rutas están registradas', async () => {
      const rutas = rutasRegistradas(ctx.app).map(([metodo, ruta]) => `${metodo} ${ruta}`);
      const cookie = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);

      expect(
        rutas.filter(
          (ruta) => /^[A-Z]+ \/api\/plataforma/.test(ruta) && /caja|movimiento|cierre|arqueo|pdf/i.test(ruta),
        ),
        'una ruta de plataforma toca la caja de las academias',
      ).toEqual([]);
      for (const direccion of [
        `/api/plataforma/academias/${e.A.id}/cajas`,
        `/api/plataforma/academias/${e.A.id}/cajas/${cajaDeHoy.id}`,
        `/api/plataforma/academias/${e.A.id}/cajas/${cajaDeHoy.id}/cierres/1/pdf`,
      ]) {
        const respuesta = await ctx.http.get(direccion, cookie);

        expect(respuesta.status, `${direccion}: ${respuesta.texto}`).toBe(404);
      }
    });
  });

  describe('lecturas sin bloqueos, sin escritura y sin auditoría (PQ1)', () => {
    it('PQ1: las tres lecturas, repetidas por cada rol con permiso, dejan las tres tablas y la auditoría exactamente como estaban', async () => {
      const antes = await estado();

      for (const cookie of [cookies.admin, cookies.secretaria, cookies.admin2]) {
        for (const ruta of RUTAS) {
          expect((await ctx.http.get(ruta.valida(cajaDeHoy.id), cookie)).status, ruta.nombre).toBe(200);
        }
      }

      expect(await estado()).toEqual(antes);
    });

    it('PQ1: no bloquean: mientras la prueba retiene con FOR UPDATE la fila del actor y la de la caja, las tres lecturas responden sin esperar (no llaman a bloquearActorVigente)', async () => {
      const retenedor = await abrirRetenedor(e.A.id);
      try {
        await retenerUsuarios(e.A.id, [e.secretariaA.id, e.adminA.id])(retenedor);
        await retenerCaja(e.A.id, cajaDeHoy.id)(retenedor);

        for (const ruta of RUTAS) {
          const respuesta = await conLimite(
            ctx.http.get(ruta.valida(cajaDeHoy.id), cookies.secretaria),
            `${ruta.nombre} esperó un bloqueo (las lecturas no deben bloquear filas)`,
          );

          expect(respuesta.status, `${ruta.nombre}: ${respuesta.texto}`).toBe(200);
        }
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });
  });

  describe('la matriz', () => {
    it('criterio 7: VER_REPORTES_FINANCIEROS es TODO para ADMIN y SU_CAJA para SECRETARIA, y nadie más (la API y la web leen la misma matriz)', () => {
      const matriz = MATRIZ_PERMISOS as Readonly<Record<string, unknown>>;

      expect(matriz['VER_REPORTES_FINANCIEROS']).toEqual({ ADMIN: 'TODO', SECRETARIA: 'SU_CAJA' });
      expect(Object.keys(matriz)).toHaveLength(26);
    });
  });
});
