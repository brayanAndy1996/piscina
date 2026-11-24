// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  enLima,
  type EscenarioCaja,
  HOY,
  instantaneaDeCaja,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  crearAppHistorial,
  crearEscenarioDeAlcance,
  type EscenarioDeAlcance,
  exigirGeneradorInyectable,
  exigirRutasDeHistorial,
  FECHA_C4,
  GeneradorDePrueba,
  idsDeLista,
  reabrirCajaDePrueba,
  rutaPdf,
} from '../../utilidades/caja-historial';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterios 40, 41 y 42 en su parte crítica (alcance y 404), criterio 8 en su parte de la 006b, PQ1 y PQ2 (crítico, sección 2.1, HU-27, D-23, DR-9 y DR-13).
// El servicio lee el alcance de la matriz (VER_REPORTES_FINANCIEROS): TODO ve todas las cajas de la academia; SU_CAJA ve una caja si se cumple al menos
// una de estas condiciones, evaluadas en cada petición: a) la abrió ella; b) algún cierre de esa caja, vigente o ya reabierto, lo hizo ella; c) la caja
// está ABIERTA ahora (de hoy o de otro día); d) (DR-13) la fecha de la caja es hoy en Lima. Dentro de una caja que puede ver, ve todo. El alcance se
// aplica igual en la lista (filtra), en el detalle y en el PDF (404). Todo lo que no se puede mostrar responde el mismo 404 NO_ENCONTRADO (el cuerpo
// JSON, comparado entero): un id que no es UUID, uno que no existe, uno de otra academia y uno fuera del alcance de la secretaria.
// Escenario de PQ2 (cajas creadas como dueño, en días anteriores a hoy, en A, con SECRETARIA S1 y S2):
//   C1: la abrió y la cerró S1 -> la ven S1 y el ADMIN; S2, 404.
//   C2: la abrió S2 y la cerró el ADMIN -> S2 sí; S1, 404.
//   C3: la abrió el ADMIN, S1 hizo el cierre 1, el ADMIN la reabrió e hizo el cierre 2 -> S1 sí (cerró alguna vez), también el PDF del cierre 2; S2, 404.
//   C4: la abrió S2 y sigue abierta (de otro día) -> la ven S1 y S2.
//   C5 (DR-13): la de hoy, cerrada, que abrió S2 y cerró el ADMIN -> la ven S1 y S2.
//   El ADMIN ve las cinco; una caja de B no la ve nadie de A.
// El generador del PDF se reemplaza (PQ8): aquí solo importa si la descarga responde 200 o 404.

type Quien = 'admin' | 'admin2' | 's1' | 's2';
const TODOS: readonly Quien[] = ['admin', 'admin2', 's1', 's2'];
const RANGO = '?desde=2026-11-01&hasta=2026-11-11';

describe('alcance del historial, el detalle y el PDF (criterios 40 a 42, PQ1 y PQ2)', () => {
  const generador = new GeneradorDePrueba();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let x: EscenarioDeAlcance;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let galleta: Record<Quien, string>;

  beforeAll(async () => {
    ctx = await crearAppHistorial(AHORA_PRUEBAS, generador);
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    generador.restablecer();
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    x = await crearEscenarioDeAlcance(e);
    cookies = cookiesDeCaja(e);
    galleta = { admin: cookies.admin, admin2: cookies.admin2, s1: cookies.secretaria, s2: cookies.secretaria2 };
  });
  afterEach(() => {
    generador.cancelarRetenido();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const lista = (quien: Quien, consulta = RANGO, cookie = galleta[quien]) =>
    ctx.http.get(`/api/cajas${consulta}`, cookie);
  const detalle = (quien: Quien, id: string, cookie = galleta[quien]) => ctx.http.get(`/api/cajas/${id}`, cookie);
  const pdf = (quien: Quien, id: string, numero: number | string, cookie = galleta[quien]) =>
    ctx.http.get(rutaPdf(id, numero), cookie);

  /** Quién ve cada caja del escenario (PQ2). */
  const VEN = (): Record<string, readonly Quien[]> => ({
    [x.c1.id]: ['admin', 'admin2', 's1'],
    [x.c2.id]: ['admin', 'admin2', 's2'],
    [x.c3.id]: ['admin', 'admin2', 's1'],
    [x.c4.id]: ['admin', 'admin2', 's1', 's2'],
    [x.c5.id]: ['admin', 'admin2', 's1', 's2'],
  });

  describe('la lista filtra por el alcance', () => {
    it('PQ2: el ADMIN ve las cinco cajas, de la fecha más reciente a la más antigua (C5, C4, C3, C2, C1)', async () => {
      for (const quien of ['admin', 'admin2'] as const) {
        const respuesta = await lista(quien);

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(idsDeLista(respuesta), quien).toEqual([x.c5.id, x.c4.id, x.c3.id, x.c2.id, x.c1.id]);
      }
    });

    it('PQ2: S1 ve C5, C4, C3 y C1 (abrió C1, cerró C1 y C3 alguna vez, C4 está abierta y C5 es de hoy), pero no C2', async () => {
      const respuesta = await lista('s1');

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(idsDeLista(respuesta)).toEqual([x.c5.id, x.c4.id, x.c3.id, x.c1.id]);
    });

    it('PQ2: S2 ve C5, C4 y C2 (abrió C2 y C4, y C5 es de hoy), pero no C1 ni C3', async () => {
      const respuesta = await lista('s2');

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(idsDeLista(respuesta)).toEqual([x.c5.id, x.c4.id, x.c2.id]);
    });

    it('PQ2 b: C3 la ve S1 porque cerró el cierre 1, que ya se reabrió: "cerró alguna vez" cuenta el cierre vigente y los reabiertos', async () => {
      const respuesta = await lista('s1');

      expect(idsDeLista(respuesta)).toContain(x.c3.id);
      const c3 = (respuesta.body?.['cajas'] as { id: string; ultimoCierre: { numero: number } | null }[]).find(
        (caja) => caja.id === x.c3.id,
      );
      expect(c3?.ultimoCierre?.numero, 'el último cierre de C3 es el 2, que cerró el ADMIN').toBe(2);
    });

    it('criterio 40: un rango que no incluye ninguna fecha del escenario da una lista vacía para todos (también con una caja abierta fuera del rango)', async () => {
      for (const quien of TODOS) {
        const respuesta = await lista(quien, '?desde=2026-10-01&hasta=2026-10-31');

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(idsDeLista(respuesta), quien).toEqual([]);
      }
    });
  });

  describe('el detalle: 200 dentro del alcance y el mismo 404 fuera de él', () => {
    const CAJAS = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;
    const CASOS = TODOS.flatMap((quien) => CAJAS.map((caja) => ({ quien, caja })));

    it.each(CASOS)('PQ2: $quien pide la caja $caja', async ({ quien, caja }) => {
      const id = x[caja].id;
      const veLaCaja = VEN()[id]?.includes(quien) ?? false;

      const respuesta = await detalle(quien, id);

      if (veLaCaja) {
        expect(respuesta.status, `${quien} ${caja}: ${respuesta.texto}`).toBe(200);
        expect((respuesta.body?.['caja'] as { id: string }).id).toBe(id);
      } else {
        expect(respuesta.status, `${quien} ${caja}: ${respuesta.texto}`).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
        expect(respuesta.cacheControl).toBe('no-store');
      }
    });

    it('PQ1: una caja fuera del alcance responde exactamente el mismo cuerpo 404 que un id que no existe, que uno que no es UUID y que una caja de otra academia', async () => {
      const deB = await crearCajaDePrueba(e.B.id, e.secretariaB.id);
      const fuera = await detalle('s2', x.c1.id);
      const inexistente = await detalle('s2', randomUUID());
      const noUuid = await detalle('s2', 'no-es-un-uuid');
      const deOtraAcademia = await detalle('s2', deB.id);

      for (const respuesta of [fuera, inexistente, noUuid, deOtraAcademia]) {
        expect(respuesta.status, respuesta.texto).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
        // Nunca 400 ni 403 por el id: una caja fuera del alcance no se distingue de una que no existe.
        expect(respuesta.texto).toBe(inexistente.texto);
      }
      expect(fuera.body).toEqual(inexistente.body);
      expect(noUuid.body).toEqual(inexistente.body);
    });

    it('PQ1: un UUID en mayúsculas es la misma caja (200 si la ve, el mismo 404 si no)', async () => {
      expect((await detalle('s1', x.c1.id.toUpperCase())).status).toBe(200);
      const fuera = await detalle('s2', x.c1.id.toUpperCase());
      expect(fuera.status).toBe(404);
      expect(fuera.body).toEqual((await detalle('s2', randomUUID())).body);
    });

    it('PQ2: dentro de una caja que puede ver, la secretaria ve todo: los movimientos que registró otra persona y todos los cierres con sus reaperturas', async () => {
      const c1 = (await detalle('s1', x.c1.id)).body?.['caja'] as {
        movimientos: { registradoPor: { id: string }; tipo: string }[];
      };
      const c3 = (await detalle('s1', x.c3.id)).body?.['caja'] as {
        cierres: { numero: number; cerradoPor: { id: string }; reapertura: { motivo: string } | null }[];
      };

      expect(c1.movimientos.map((m) => [m.tipo, m.registradoPor.id])).toEqual([
        ['INGRESO', x.admin.id],
        ['EGRESO', x.s2.id],
      ]);
      expect(c3.cierres.map((c) => [c.numero, c.cerradoPor.id])).toEqual([
        [1, x.s1.id],
        [2, x.admin.id],
      ]);
      expect(c3.cierres[0]?.reapertura?.motivo).toBe('Falto contar un sobre');
      expect(c3.cierres[1]?.reapertura).toBeNull();
    });
  });

  describe('el PDF del cierre: el mismo alcance y el mismo 404', () => {
    /** Los cierres que existen: (caja, número). C4 nunca se cerró. */
    const CIERRES = [
      ['c1', 1],
      ['c2', 1],
      ['c3', 1],
      ['c3', 2],
      ['c5', 1],
    ] as const;
    const CASOS = TODOS.flatMap((quien) => CIERRES.map(([caja, numero]) => ({ quien, caja, numero })));

    it.each(CASOS)('PQ2: $quien pide el PDF del cierre $numero de la caja $caja', async ({ quien, caja, numero }) => {
      const id = x[caja].id;
      const veLaCaja = VEN()[id]?.includes(quien) ?? false;

      const respuesta = await pdf(quien, id, numero);

      if (veLaCaja) {
        expect(respuesta.status, `${quien} ${caja}/${numero}: ${respuesta.texto}`).toBe(200);
        expect(respuesta.headers.get('content-type')).toBe('application/pdf');
        expect(generador.llamadas).toHaveLength(1);
      } else {
        expect(respuesta.status, `${quien} ${caja}/${numero}: ${respuesta.texto}`).toBe(404);
        expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
        expect(respuesta.headers.get('content-disposition')).toBeNull();
        expect(generador.llamadas, 'una caja fuera del alcance no llega a generar nada').toHaveLength(0);
      }
    });

    it('PQ2: S1 descarga el PDF del cierre 2 de C3, que hizo el ADMIN (S1 cerró el cierre 1 de esa caja), y el del cierre 1', async () => {
      for (const numero of [1, 2]) {
        const respuesta = await pdf('s1', x.c3.id, numero);

        expect(respuesta.status, `cierre ${numero}: ${respuesta.texto}`).toBe(200);
      }
    });

    it('PQ2 d (DR-13): S1 y S2 descargan el PDF de C5, la caja de hoy, aunque ninguna la abrió ni la cerró (S2 la abrió; S1 no tuvo nada que ver)', async () => {
      for (const quien of ['s1', 's2'] as const) {
        const respuesta = await pdf(quien, x.c5.id, 1);

        expect(respuesta.status, `${quien}: ${respuesta.texto}`).toBe(200);
      }
    });

    it('PQ6: una caja que nunca se cerró (C4) no tiene PDF: 404 para todos, también para el ADMIN y para quien la abrió', async () => {
      for (const quien of TODOS) {
        for (const numero of [1, 2]) {
          const respuesta = await pdf(quien, x.c4.id, numero);

          expect(respuesta.status, `${quien} ${numero}: ${respuesta.texto}`).toBe(404);
          expect(codigoDe(respuesta)).toBe('NO_ENCONTRADO');
        }
      }
      expect(generador.llamadas).toHaveLength(0);
    });

    it('PQ1: fuera del alcance, el 404 del PDF tiene exactamente el mismo cuerpo que el de un id inexistente, uno que no es UUID y un número que no existe', async () => {
      const fuera = await pdf('s2', x.c1.id, 1);
      const inexistente = await pdf('s2', randomUUID(), 1);
      const noUuid = await pdf('s2', 'no-es-un-uuid', 1);
      const numeroInexistente = await pdf('s1', x.c1.id, 9);
      const numeroInvalido = await pdf('s1', x.c1.id, 'uno');

      for (const respuesta of [fuera, inexistente, noUuid, numeroInexistente, numeroInvalido]) {
        expect(respuesta.status, respuesta.texto).toBe(404);
        expect(respuesta.texto).toBe(inexistente.texto);
      }
      expect(generador.llamadas).toHaveLength(0);
    });
  });

  describe('el alcance se evalúa en cada petición (PQ2)', () => {
    it('PQ2: cuando otra persona cierra la caja abierta (C4), S1 la pierde (ya no está abierta ni es de hoy y no la abrió ni la cerró ella) y S2, que la abrió, la conserva', async () => {
      expect((await detalle('s1', x.c4.id)).status).toBe(200);

      await cerrarCajaDePrueba(e.A.id, x.c4.id, x.admin.id, { cerradoEn: enLima(FECHA_C4, '18:00') });

      const s1 = await detalle('s1', x.c4.id);
      expect(s1.status, s1.texto).toBe(404);
      expect(codigoDe(s1)).toBe('NO_ENCONTRADO');
      expect((await pdf('s1', x.c4.id, 1)).status).toBe(404);
      expect(idsDeLista(await lista('s1'))).toEqual([x.c5.id, x.c3.id, x.c1.id]);
      expect((await detalle('s2', x.c4.id)).status).toBe(200);
      expect((await pdf('s2', x.c4.id, 1)).status).toBe(200);
      expect(idsDeLista(await lista('s2'))).toEqual([x.c5.id, x.c4.id, x.c2.id]);
    });

    it('PQ2 c: una caja cerrada por otra persona que se reabre pasa a estar ABIERTA y la ve S1 (C2 reabierta; el cierre 1 sigue teniendo PDF)', async () => {
      expect((await detalle('s1', x.c2.id)).status).toBe(404);
      await cerrarCajaDePrueba(e.A.id, x.c4.id, x.admin.id, { cerradoEn: enLima(FECHA_C4, '18:00') });
      await reabrirCajaDePrueba(e.A.id, x.c2.id, 1, x.admin.id, enLima(HOY, '09:30'), 'Falto un conteo');

      const respuesta = await detalle('s1', x.c2.id);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect((respuesta.body?.['caja'] as { estado: string }).estado).toBe('ABIERTA');
      expect(
        (await pdf('s1', x.c2.id, 1)).status,
        'tiene PDF cualquier cierre de una caja que se puede ver, aunque esté abierta otra vez',
      ).toBe(200);
      expect(idsDeLista(await lista('s1'))).toContain(x.c2.id);
    });

    it('PQ2 d: cuando cambia el día, C5 deja de ser la caja de hoy: S1 la pierde (nunca la abrió ni la cerró) y S2, que la abrió, y el ADMIN la conservan', async () => {
      expect((await detalle('s1', x.c5.id)).status).toBe(200);
      const manana = enLima('2026-11-12', '10:00');
      ctx.reloj.fijar(manana);
      const galletaDeManana = cookiesDeCaja(e, manana);
      const rango = '?desde=2026-11-01&hasta=2026-11-12';

      const s1 = await ctx.http.get(`/api/cajas/${x.c5.id}`, galletaDeManana.secretaria);
      const s2 = await ctx.http.get(`/api/cajas/${x.c5.id}`, galletaDeManana.secretaria2);
      const admin = await ctx.http.get(`/api/cajas/${x.c5.id}`, galletaDeManana.admin);

      expect(s1.status, s1.texto).toBe(404);
      expect(s2.status, s2.texto).toBe(200);
      expect(admin.status, admin.texto).toBe(200);
      expect((await ctx.http.get(rutaPdf(x.c5.id, 1), galletaDeManana.secretaria)).status).toBe(404);
      expect((await ctx.http.get(rutaPdf(x.c5.id, 1), galletaDeManana.secretaria2)).status).toBe(200);
      expect(idsDeLista(await ctx.http.get(`/api/cajas${rango}`, galletaDeManana.secretaria))).toEqual([
        x.c4.id,
        x.c3.id,
        x.c1.id,
      ]);
    });

    it('PQ2 d con el borde de la medianoche de Lima: a las 23:59:59.999 del 11 de noviembre en Lima C5 todavía es de hoy; a las 00:00 del 12, ya no', async () => {
      const antes = enLima(HOY, '23:59:59.999');
      ctx.reloj.fijar(antes);
      const conCookieAntes = cookiesDeCaja(e, antes);
      expect((await ctx.http.get(`/api/cajas/${x.c5.id}`, conCookieAntes.secretaria)).status).toBe(200);

      const despues = enLima('2026-11-12', '00:00:00');
      ctx.reloj.fijar(despues);
      const conCookieDespues = cookiesDeCaja(e, despues);

      expect((await ctx.http.get(`/api/cajas/${x.c5.id}`, conCookieDespues.secretaria)).status).toBe(404);
    });
  });

  describe('aislamiento entre academias (criterio 8, D-23)', () => {
    let cajaDeB: { id: string };
    let cajaAntiguaDeB: { id: string };
    const sinDatosDeB = (texto: string) => {
      for (const marca of [cajaDeB.id, cajaAntiguaDeB.id, 'Gasto secreto de B', '777.00', 'Beto', 'Bravo', e.B.id]) {
        expect(texto).not.toContain(marca);
      }
    };

    beforeEach(async () => {
      const alumnoB = await crearAlumnoDeCaja(e.B.id, 'Beto', 'Bravo Zeta');
      cajaAntiguaDeB = await crearCajaDePrueba(e.B.id, e.secretariaB.id, {
        fecha: '2026-11-05',
        monto_inicial: '300.00',
      });
      await cerrarCajaDePrueba(e.B.id, cajaAntiguaDeB.id, e.secretariaB.id, {
        cerradoEn: enLima('2026-11-05', '18:00'),
      });
      cajaDeB = await crearCajaDePrueba(e.B.id, e.secretariaB.id, { monto_inicial: '777.00' });
      await crearIngresoDePrueba(e.B.id, cajaDeB.id, e.secretariaB.id, alumnoB.id, { monto: '88.00' });
      await crearEgresoDePrueba(e.B.id, cajaDeB.id, e.secretariaB.id, { descripcion: 'Gasto secreto de B' });
      await cerrarCajaDePrueba(e.B.id, cajaDeB.id, e.secretariaB.id, { cerradoEn: enLima(HOY, '09:50') });
    });

    it.each(TODOS)('criterio 8: la lista de %s no trae ninguna caja de B ni un dato de B', async (quien) => {
      const respuesta = await lista(quien);

      expect(respuesta.status, respuesta.texto).toBe(200);
      sinDatosDeB(respuesta.texto);
    });

    it.each(TODOS)(
      'criterio 8: %s pide una caja de B por su id (detalle y PDF de sus cierres): el mismo 404 que un id inexistente, sin datos de B',
      async (quien) => {
        const inexistenteDetalle = await detalle(quien, randomUUID());
        const inexistentePdf = await pdf(quien, randomUUID(), 1);

        for (const caja of [cajaDeB, cajaAntiguaDeB]) {
          const deDetalle = await detalle(quien, caja.id);
          const dePdf = await pdf(quien, caja.id, 1);
          const enMayusculas = await detalle(quien, caja.id.toUpperCase());

          expect(deDetalle.status, deDetalle.texto).toBe(404);
          expect(dePdf.status, dePdf.texto).toBe(404);
          expect(enMayusculas.status, enMayusculas.texto).toBe(404);
          expect(deDetalle.body).toEqual(inexistenteDetalle.body);
          expect(dePdf.body).toEqual(inexistentePdf.body);
          expect(enMayusculas.body).toEqual(inexistenteDetalle.body);
          sinDatosDeB(deDetalle.texto + dePdf.texto + enMayusculas.texto);
        }
        expect(generador.llamadas).toHaveLength(0);
      },
    );

    it('criterio 8: el ADMIN de B ve solo las cajas de B (la lista y el detalle) y recibe el 404 por una caja de A', async () => {
      const respuesta = await lista('admin', RANGO, cookies.adminB);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(idsDeLista(respuesta)).toEqual([cajaDeB.id, cajaAntiguaDeB.id]);
      for (const caja of [x.c1, x.c2, x.c3, x.c4, x.c5]) {
        expect((await detalle('admin', caja.id, cookies.adminB)).status, caja.id).toBe(404);
        expect((await pdf('admin', caja.id, 1, cookies.adminB)).status, caja.id).toBe(404);
      }
      expect((await detalle('admin', cajaDeB.id, cookies.adminB)).status).toBe(200);
    });

    it('criterio 8 y PQ1: ?academiaId=<id de B> (y cualquier otro parámetro) se ignora en la lista, el detalle y el PDF: las respuestas son las mismas que sin el parámetro', async () => {
      const sinParametro = await lista('admin');
      const conParametros = [
        `&academiaId=${e.B.id}`,
        `&academiaId=${e.B.id}&cajaId=${cajaDeB.id}`,
        '&foo=1&limite=2&pagina=3',
        `&id=${cajaDeB.id}`,
      ];

      for (const parametros of conParametros) {
        const respuesta = await lista('admin', `${RANGO}${parametros}`);
        expect(respuesta.status, `${parametros}: ${respuesta.texto}`).toBe(200);
        expect(respuesta.body, parametros).toEqual(sinParametro.body);
        sinDatosDeB(respuesta.texto);
      }
      const propio = await detalle('admin', x.c1.id);
      const conAcademia = await ctx.http.get(`/api/cajas/${x.c1.id}?academiaId=${e.B.id}`, cookies.admin);
      expect(conAcademia.status, conAcademia.texto).toBe(200);
      expect(conAcademia.body).toEqual(propio.body);
      const deB = await ctx.http.get(`/api/cajas/${cajaDeB.id}?academiaId=${e.B.id}`, cookies.admin);
      expect(deB.status, deB.texto).toBe(404);
      sinDatosDeB(deB.texto);
      const pdfConAcademia = await ctx.http.get(`${rutaPdf(cajaDeB.id, 1)}?academiaId=${e.B.id}`, cookies.admin);
      expect(pdfConAcademia.status, pdfConAcademia.texto).toBe(404);
      sinDatosDeB(pdfConAcademia.texto);
      expect((await ctx.http.get(`${rutaPdf(x.c1.id, 1)}?academiaId=${e.B.id}`, cookies.admin)).status).toBe(200);
    });

    it('criterio 8: las lecturas no cambian las filas ni la auditoría de ninguna academia', async () => {
      const antes = {
        a: await instantaneaDeCaja(e.A.id),
        b: await instantaneaDeCaja(e.B.id),
        auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
        auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
      };

      for (const quien of TODOS) {
        await lista(quien);
        await detalle(quien, cajaDeB.id);
        await detalle(quien, x.c1.id);
        await pdf(quien, x.c3.id, 2);
      }
      await lista('admin', RANGO, cookies.adminB);

      expect(await instantaneaDeCaja(e.A.id)).toBe(antes.a);
      expect(await instantaneaDeCaja(e.B.id)).toBe(antes.b);
      expect(JSON.stringify(await leerAuditoriaDeAcademia(e.A.id))).toBe(antes.auditoriaA);
      expect(JSON.stringify(await leerAuditoriaDeAcademia(e.B.id))).toBe(antes.auditoriaB);
    });
  });
});
