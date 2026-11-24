// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  enLima,
  type EscenarioCaja,
  instantaneaDeCaja,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  archivosDelAlmacen,
  crearAppHistorial,
  exigirGeneradorInyectable,
  exigirRutasDeHistorial,
  GeneradorDePrueba,
  PDF_FALSO,
  type RespuestaHistorial,
  rutaPdf,
} from '../../utilidades/caja-historial';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  crearUsuarioDePrueba,
  cookieDeUsuario,
  fijarEstadoDeAcademia,
} from '../../utilidades/usuarios';

// Criterio 50 (crítico, ronda adversarial 1 de la 006b; amplía el criterio 23 y PQ15; DT-9; D-23): `HEAD` no existe en las rutas de la caja. Express atiende
// un `HEAD` con el manejador del `GET` de la misma dirección; en la caja no.
//   - Rutas: `HEAD` sobre /api/cajas/{id}/cierres/{numero}/pdf, /api/cajas, /api/cajas/actual y /api/cajas/{id}.
//   - Respuesta: 404 NO_ENCONTRADO, igual que `PATCH` sobre esas direcciones (PQ15).
//   - Casos: con la sesión válida de cualquier rol (también ENTRENADOR y ALUMNO, que en el GET reciben 403); con un id o un `numero` que existen, que no
//     existen o que no son válidos; con parámetros de consulta, con barra final y con mayúsculas en la dirección (`/api/Cajas/…`).
//   - Cabeceras: las del JSON de error de siempre (`Content-Type: application/json`, `Cache-Control: no-store`) y ninguna del PDF (`Content-Disposition`).
//     No hay cuerpo (un `HEAD` nunca lo tiene).
//   - Sin efectos: no llama al generador del PDF (generador espía de PQ9 a), no escribe y no audita.
//   - Sin sesión, con el cambio de contraseña pendiente o con la academia suspendida: responde lo mismo que `PATCH` en esa dirección.
//   - El `GET` de las cuatro rutas no cambia.

type Rol = 'admin' | 'secretaria' | 'entrenador' | 'alumno';
const ROLES: readonly Rol[] = ['admin', 'secretaria', 'entrenador', 'alumno'];

/** Las cuatro rutas de lectura de la caja. */
type Ruta = 'pdf' | 'lista' | 'actual' | 'detalle';
const RUTAS: readonly Ruta[] = ['pdf', 'lista', 'actual', 'detalle'];

interface Ids {
  /** Una caja de A que existe, con su cierre 1. */
  existe: string;
  /** Una caja de B (otra academia). */
  deB: string;
}

/** Las direcciones de cada ruta: con ids y números que existen, que no existen y que no son válidos; con consulta, barra final y mayúsculas. */
function direccionesDe(ruta: Ruta, { existe, deB }: Ids): string[] {
  const inexistente = randomUUID();
  switch (ruta) {
    case 'pdf':
      return [
        `/api/cajas/${existe}/cierres/1/pdf`,
        `/api/cajas/${existe}/cierres/2/pdf`,
        `/api/cajas/${existe}/cierres/0/pdf`,
        `/api/cajas/${existe}/cierres/uno/pdf`,
        `/api/cajas/${existe}/cierres/99999999999999999999/pdf`,
        `/api/cajas/${inexistente}/cierres/1/pdf`,
        `/api/cajas/no-es-un-uuid/cierres/1/pdf`,
        `/api/cajas/${deB}/cierres/1/pdf`,
        `/api/cajas/${existe}/cierres/1/pdf?x=1`,
        `/api/cajas/${existe}/cierres/1/pdf?academiaId=${deB}`,
        `/api/cajas/${existe}/cierres/1/pdf/`,
        `/api/cajas/${existe.toUpperCase()}/cierres/1/pdf`,
        `/api/Cajas/${existe}/cierres/1/pdf`,
        `/api/CAJAS/${existe}/CIERRES/1/PDF`,
        `/api/Cajas/${existe}/Cierres/1/Pdf/?x=1`,
      ];
    case 'lista':
      return [
        '/api/cajas',
        '/api/cajas?desde=2026-11-01&hasta=2026-11-11',
        '/api/cajas?desde=basura&hasta=2020-13-45',
        `/api/cajas?academiaId=${deB}`,
        '/api/cajas/',
        '/api/cajas/?x=1',
        '/api/Cajas',
        '/api/CAJAS/',
        '/api/Cajas?desde=2026-11-01',
      ];
    case 'actual':
      return [
        '/api/cajas/actual',
        '/api/cajas/actual?x=1',
        `/api/cajas/actual?academiaId=${deB}`,
        '/api/cajas/actual/',
        '/api/Cajas/actual',
        '/api/cajas/Actual',
        '/api/CAJAS/ACTUAL/',
      ];
    case 'detalle':
      return [
        `/api/cajas/${existe}`,
        `/api/cajas/${inexistente}`,
        '/api/cajas/no-es-un-uuid',
        `/api/cajas/${deB}`,
        `/api/cajas/${existe}?x=1`,
        `/api/cajas/${existe}?academiaId=${deB}`,
        `/api/cajas/${existe}/`,
        `/api/cajas/${existe.toUpperCase()}`,
        `/api/Cajas/${existe}`,
        `/api/CAJAS/${existe.toUpperCase()}/`,
      ];
  }
}

describe('HEAD no existe en las rutas de la caja (criterio 50, PQ15)', () => {
  const generador = new GeneradorDePrueba();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let ids: Ids;

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
    const alumno = await crearAlumnoDeCaja(e.A.id);
    // Una caja cerrada de otro día (con su cierre 1) y la caja abierta de hoy, las dos de A; y una caja cerrada de B.
    const cerrada = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-02', monto_inicial: '100.00' });
    await crearIngresoDePrueba(e.A.id, cerrada.id, e.secretariaA.id, alumno.id, {
      monto: '42.00',
      registrado_en: enLima('2026-11-02', '10:00'),
    });
    await cerrarCajaDePrueba(e.A.id, cerrada.id, e.secretariaA.id, { cerradoEn: enLima('2026-11-02', '18:00:00') });
    await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '20.00' });
    const deB = await crearCajaDePrueba(e.B.id, e.secretariaB.id, { fecha: '2026-11-02', monto_inicial: '30.00' });
    await cerrarCajaDePrueba(e.B.id, deB.id, e.secretariaB.id, { cerradoEn: enLima('2026-11-02', '18:00:00') });
    ids = { existe: cerrada.id, deB: deB.id };
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const head = (ruta: string, cookie?: string) => ctx.http.enviar('HEAD', ruta, cookie);
  const estado = async () => ({
    cajasA: await instantaneaDeCaja(e.A.id),
    cajasB: await instantaneaDeCaja(e.B.id),
    auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
  });

  /** Lo que un `HEAD` sobre una ruta de la caja no cumple de la spec (vacío si todo está bien), para listar todas las direcciones que fallan. */
  function problemasDelHead(direccion: string, r: RespuestaHistorial): string[] {
    const problemas: string[] = [];
    if (r.status !== 404) problemas.push(`respondió ${r.status} y no 404`);
    if (!(r.headers.get('content-type') ?? '').includes('application/json'))
      problemas.push(`Content-Type ${String(r.headers.get('content-type'))} y no application/json`);
    if (r.cacheControl !== 'no-store') problemas.push(`Cache-Control ${String(r.cacheControl)} y no no-store`);
    if (r.headers.get('content-disposition') !== null)
      problemas.push(`trae Content-Disposition ${String(r.headers.get('content-disposition'))}`);
    if (r.cuerpo.length !== 0) problemas.push(`trae cuerpo de ${r.cuerpo.length} bytes`);
    return problemas.map((problema) => `HEAD ${direccion}: ${problema}`);
  }

  describe('404 NO_ENCONTRADO con la sesión de cualquier rol', () => {
    it.each(RUTAS.flatMap((ruta) => ROLES.map((rol) => [ruta, rol] as const)))(
      'criterio 50: HEAD sobre la ruta %s con la sesión de %s responde 404 con el JSON de error de siempre, sin Content-Disposition ni cuerpo, sin llamar al generador y sin escribir ni auditar, con ids y números que existen, que no existen y que no son válidos, con consulta, barra final y mayúsculas',
      async (ruta, rol) => {
        const antes = await estado();
        const archivosAntes = archivosDelAlmacen();
        const problemas: string[] = [];

        for (const direccion of direccionesDe(ruta, ids)) {
          problemas.push(...problemasDelHead(direccion, await head(direccion, cookies[rol])));
        }

        expect(problemas.join('\n')).toBe('');
        expect(generador.llamadas, 'un HEAD no genera el PDF').toHaveLength(0);
        expect(archivosDelAlmacen()).toEqual(archivosAntes);
        expect(await estado(), 'un HEAD no escribe ni audita').toEqual(antes);
      },
    );

    it('criterio 50: el 404 de HEAD es el mismo que el de PATCH sobre la misma dirección: mismo estado y mismas cabeceras (el JSON NO_ENCONTRADO de siempre)', async () => {
      for (const ruta of RUTAS) {
        for (const direccion of direccionesDe(ruta, ids).slice(0, 3)) {
          const delHead = await head(direccion, cookies.admin);
          const delPatch = await ctx.http.enviar('PATCH', direccion, cookies.admin, {});

          expect(delPatch.status, `PATCH ${direccion}`).toBe(404);
          expect(codigoDe(delPatch)).toBe('NO_ENCONTRADO');
          expect(delHead.status, `HEAD ${direccion}`).toBe(delPatch.status);
          expect(delHead.headers.get('content-type'), `HEAD ${direccion}`).toBe(delPatch.headers.get('content-type'));
          expect(delHead.cacheControl, `HEAD ${direccion}`).toBe(delPatch.cacheControl);
        }
      }
    });
  });

  describe('sin sesión, con el cambio de contraseña pendiente o con la academia suspendida: lo mismo que PATCH', () => {
    /** Una dirección de cada ruta (la que existe, con la consulta y la mayúscula) para comparar con `PATCH`. */
    const representantes = () =>
      RUTAS.flatMap((ruta) => {
        const direcciones = direccionesDe(ruta, ids);
        return [direcciones[0] as string, direcciones[direcciones.length - 1] as string];
      });

    async function compararConPatch(cookie: string | undefined, estadoEsperado: number, codigoEsperado: string) {
      const problemas: string[] = [];
      for (const direccion of representantes()) {
        const delHead = await head(direccion, cookie);
        const delPatch = await ctx.http.enviar('PATCH', direccion, cookie, {});

        if (delPatch.status !== estadoEsperado || codigoDe(delPatch) !== codigoEsperado)
          problemas.push(`PATCH ${direccion}: respondió ${delPatch.status} ${String(codigoDe(delPatch))}`);
        if (delHead.status !== delPatch.status)
          problemas.push(`HEAD ${direccion}: respondió ${delHead.status} y PATCH ${delPatch.status}`);
        if (delHead.headers.get('content-type') !== delPatch.headers.get('content-type'))
          problemas.push(`HEAD ${direccion}: Content-Type distinto del de PATCH`);
        if (delHead.cacheControl !== delPatch.cacheControl)
          problemas.push(`HEAD ${direccion}: Cache-Control distinto del de PATCH`);
        if (delHead.headers.get('content-disposition') !== null)
          problemas.push(`HEAD ${direccion}: trae Content-Disposition`);
        if (delHead.cuerpo.length !== 0) problemas.push(`HEAD ${direccion}: trae cuerpo`);
      }
      return problemas;
    }

    it('criterio 50: sin sesión, HEAD responde lo mismo que PATCH (401 NO_AUTENTICADO) en las cuatro rutas', async () => {
      const antes = await estado();

      const problemas = await compararConPatch(undefined, 401, 'NO_AUTENTICADO');

      expect(problemas.join('\n')).toBe('');
      expect(generador.llamadas).toHaveLength(0);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 50: con el cambio de contraseña pendiente, HEAD responde lo mismo que PATCH (403 CAMBIO_DE_CLAVE_OBLIGATORIO) en las cuatro rutas', async () => {
      const pendiente = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', debeCambiarClave: true });
      const antes = await estado();

      const problemas = await compararConPatch(
        cookieDeUsuario(pendiente, AHORA_PRUEBAS),
        403,
        'CAMBIO_DE_CLAVE_OBLIGATORIO',
      );

      expect(problemas.join('\n')).toBe('');
      expect(generador.llamadas).toHaveLength(0);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 50: con la academia suspendida, HEAD responde lo mismo que PATCH (403 ACADEMIA_SUSPENDIDA) en las cuatro rutas, también para quien además tiene el cambio pendiente', async () => {
      await fijarEstadoDeAcademia(e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });
      const antes = await estado();

      const delAdmin = await compararConPatch(cookies.admin, 403, 'ACADEMIA_SUSPENDIDA');
      const delaSecretaria = await compararConPatch(cookies.secretaria, 403, 'ACADEMIA_SUSPENDIDA');

      expect(delAdmin.join('\n')).toBe('');
      expect(delaSecretaria.join('\n')).toBe('');
      expect(generador.llamadas).toHaveLength(0);
      expect(await estado()).toEqual(antes);
    });
  });

  describe('el GET de las cuatro rutas no cambia (control)', () => {
    it('control: el GET de las cuatro rutas sigue respondiendo 200 al ADMIN (el PDF llama al generador espía) y 403 SIN_PERMISO al ENTRENADOR y al ALUMNO', async () => {
      const rutas = [
        `/api/cajas/${ids.existe}/cierres/1/pdf`,
        '/api/cajas',
        '/api/cajas/actual',
        `/api/cajas/${ids.existe}`,
      ];

      for (const ruta of rutas) {
        const respuesta = await ctx.http.get(ruta, cookies.admin);

        expect(respuesta.status, `GET ${ruta}: ${respuesta.texto.slice(0, 200)}`).toBe(200);
        expect(respuesta.cacheControl).toBe('no-store');
      }
      expect(generador.llamadas, 'el GET del PDF sí llama al generador').toHaveLength(1);
      const pdf = await ctx.http.get(rutaPdf(ids.existe, 1), cookies.secretaria);
      expect(pdf.status, pdf.texto.slice(0, 200)).toBe(200);
      expect(pdf.headers.get('content-type')).toBe('application/pdf');
      expect(pdf.headers.get('content-disposition')).toBe('attachment; filename="cierre-caja-2026-11-02-1.pdf"');
      expect(pdf.cuerpo.equals(PDF_FALSO)).toBe(true);
      for (const rol of ['entrenador', 'alumno'] as const) {
        for (const ruta of rutas) {
          const respuesta = await ctx.http.get(ruta, cookies[rol]);

          expect(respuesta.status, `GET ${ruta} como ${rol}`).toBe(403);
          expect(codigoDe(respuesta)).toBe('SIN_PERMISO');
        }
      }
      expect(generador.llamadas, 'el 403 no llama al generador').toHaveLength(2);
    });
  });
});
