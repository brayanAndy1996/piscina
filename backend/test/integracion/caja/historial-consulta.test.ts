// spec: 006-caja (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  camposConError,
  codigoDe,
  cookiesDeCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  detallesDe,
  type EscenarioCaja,
  mensajeDelCampo,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  crearAppHistorial,
  exigirRutasDeHistorial,
  idsDeLista,
  listaDe,
} from '../../utilidades/caja-historial';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 40 y PQ3 (crítico, HU-27, sección 2.1): la consulta y el rango de la lista. Solo `desde` y `hasta`, cada uno con `fechaSchema` (una fecha
// AAAA-MM-DD que existe). La API lee la consulta tal como llegó (como `?estado=` de la 005b): un parámetro repetido (`?desde=…&desde=…`) o con
// corchetes (`desde[]=…`, `desde[x]=…`) es un 400 en ese campo; un valor vacío (`?desde=`) es un 400 en ese campo (no cuenta como ausente); los demás
// parámetros se ignoran. Valores por defecto con "hoy" de RELOJ en Lima: sin `hasta`, `hasta` es hoy; sin `desde`, `desde` es `hasta` menos 30 días
// (31 días contando los dos extremos), sin bajar de 0001-01-01. Reglas del rango, después de aplicar los valores por defecto y solo si los dos valores
// tienen formato válido: `desde` posterior a `hasta` -> 400 en `desde` ("La fecha inicial no puede ser posterior a la final."); más de 366 días contando
// los dos extremos (hasta - desde > 365) -> 400 en `desde` ("El rango puede ser de como mucho 366 días."). Los errores de formato van primero, uno por
// campo, en el orden `desde`, `hasta`. Todo 400 es SOLICITUD_INVALIDA con `detalles.errores[0].campo`. Las cuentas son en días de calendario, sin zona
// horaria: el resultado no cambia con el proceso en TZ=Asia/Tokyo. La respuesta es { desde, hasta, cajas } con el rango aplicado.
// Los valores esperados están escritos a mano, con hoy 2026-11-11 (como los ejemplos de PQ3).

const MENSAJE_INVERTIDO = 'La fecha inicial no puede ser posterior a la final.';
const MENSAJE_RANGO = 'El rango puede ser de como mucho 366 días.';

const ZONA_ORIGINAL = process.env['TZ'];

describe.each(['UTC', 'Asia/Tokyo'])(
  'consulta y rango de la lista (criterio 40, PQ3) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppHistorial;
    let e: EscenarioCaja;
    let cookies: ReturnType<typeof cookiesDeCaja>;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppHistorial();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      exigirRutasDeHistorial(ctx.app);
      ctx.reloj.fijar(AHORA_PRUEBAS);
      e = await crearEscenarioDeCaja();
      cookies = cookiesDeCaja(e);
    });
    afterAll(async () => {
      await ctx?.http.cerrar();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    const lista = (consulta: string, cookie = cookies.admin) => ctx.http.get(`/api/cajas${consulta}`, cookie);

    describe('respuestas 200: el rango aplicado', () => {
      const CASOS: [string, string, string][] = [
        ['sin parámetros: los últimos 31 días hasta hoy en Lima', '', '2026-10-12|2026-11-11'],
        ['366 días contando los dos extremos', '?desde=2025-11-11&hasta=2026-11-11', '2025-11-11|2026-11-11'],
        ['366 días en un año bisiesto', '?desde=2024-02-29&hasta=2025-02-28', '2024-02-29|2025-02-28'],
        ['365 días de febrero a febrero', '?desde=2025-02-28&hasta=2026-02-28', '2025-02-28|2026-02-28'],
        ['todo el año bisiesto 2024', '?desde=2024-01-01&hasta=2024-12-31', '2024-01-01|2024-12-31'],
        ['solo hasta lejano: desde es 30 días antes', '?hasta=2099-12-31', '2099-12-01|2099-12-31'],
        ['solo hasta cerca del año 1: desde no baja de 0001-01-01', '?hasta=0001-01-15', '0001-01-01|0001-01-15'],
        ['solo hasta en el cambio de año', '?hasta=2026-01-05', '2025-12-06|2026-01-05'],
        ['solo hasta igual a hoy', '?hasta=2026-11-11', '2026-10-12|2026-11-11'],
        ['solo desde igual a hoy (hasta es hoy)', '?desde=2026-11-11', '2026-11-11|2026-11-11'],
        ['solo desde a 366 días de hoy', '?desde=2025-11-11', '2025-11-11|2026-11-11'],
        ['un solo día', '?desde=2026-11-01&hasta=2026-11-01', '2026-11-01|2026-11-01'],
        ['hasta en el futuro', '?desde=2026-11-01&hasta=2026-12-31', '2026-11-01|2026-12-31'],
        ['los dos en el futuro', '?desde=2027-03-01&hasta=2027-03-31', '2027-03-01|2027-03-31'],
        ['parámetros que no son del contrato se ignoran', '?foo=1&limite=5&pagina=2', '2026-10-12|2026-11-11'],
        ['un parámetro ajeno junto a uno válido', '?hasta=2026-11-05&orden=asc', '2026-10-06|2026-11-05'],
      ];

      it.each(CASOS)('PQ3: %s (%s)', async (_nombre, consulta, esperado) => {
        const [desde, hasta] = esperado.split('|');

        const respuesta = await lista(consulta);

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(respuesta.cacheControl).toBe('no-store');
        expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['cajas', 'desde', 'hasta']);
        expect(listaDe(respuesta)).toMatchObject({ desde, hasta, cajas: [] });
      });

      it('PQ3: la secretaria recibe el mismo rango que el administrador', async () => {
        const respuesta = await lista('?hasta=2026-11-05', cookies.secretaria);

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(listaDe(respuesta)).toMatchObject({ desde: '2026-10-06', hasta: '2026-11-05' });
      });
    });

    describe('respuestas 400: formato y reglas del rango', () => {
      const CASOS: [string, string, string, string?][] = [
        ['más de 366 días (367 contando los extremos)', '?desde=2025-11-10&hasta=2026-11-11', 'desde', MENSAJE_RANGO],
        ['más de 366 días con solo desde (hasta es hoy)', '?desde=2025-11-10', 'desde', MENSAJE_RANGO],
        ['hasta - desde = 366 días en un año bisiesto', '?desde=2023-12-31&hasta=2024-12-31', 'desde', MENSAJE_RANGO],
        ['367 días a través de un 29 de febrero', '?desde=2024-02-29&hasta=2025-03-01', 'desde', MENSAJE_RANGO],
        ['desde posterior a hasta', '?desde=2026-11-12&hasta=2026-11-11', 'desde', MENSAJE_INVERTIDO],
        ['solo desde posterior a hoy (hasta es hoy)', '?desde=2026-11-12', 'desde', MENSAJE_INVERTIDO],
        [
          'desde un día después de hasta, en el cambio de año',
          '?desde=2027-01-01&hasta=2026-12-31',
          'desde',
          MENSAJE_INVERTIDO,
        ],
        ['fecha que no existe en desde', '?desde=2026-02-30', 'desde'],
        ['fecha que no existe en hasta', '?hasta=2026-02-30', 'hasta'],
        ['mes 13', '?desde=2026-13-01', 'desde'],
        ['29 de febrero de un año que no es bisiesto', '?hasta=2026-02-29', 'hasta'],
        ['fecha con hora', '?desde=2026-11-01T00:00', 'desde'],
        ['fecha con hora y zona en hasta', '?hasta=2026-11-01T00:00:00Z', 'hasta'],
        ['formato dd/mm/aaaa', '?desde=01/11/2026', 'desde'],
        ['sin ceros', '?desde=2026-1-5', 'desde'],
        ['sin guiones', '?hasta=20261101', 'hasta'],
        ['texto cualquiera', '?desde=hoy', 'desde'],
        ['desde vacío', '?desde=', 'desde'],
        ['hasta vacío', '?hasta=', 'hasta'],
        ['desde repetido', '?desde=2026-11-01&desde=2026-11-02', 'desde'],
        ['desde repetido con el mismo valor', '?desde=2026-11-01&desde=2026-11-01', 'desde'],
        ['hasta repetido', '?hasta=2026-11-01&hasta=2026-11-02', 'hasta'],
        ['desde con corchetes', '?desde[]=2026-11-01', 'desde'],
        ['desde como objeto', '?desde[x]=2026-11-01', 'desde'],
        ['hasta con corchetes', '?hasta[]=2026-11-01', 'hasta'],
        ['hasta como objeto', '?hasta[x]=2026-11-01', 'hasta'],
      ];

      it.each(CASOS)(
        'PQ3: %s (%s) responde 400 SOLICITUD_INVALIDA en el campo %s',
        async (_nombre, consulta, campo, mensaje) => {
          const respuesta = await lista(consulta);

          expect(respuesta.status, respuesta.texto).toBe(400);
          expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
          expect(respuesta.cacheControl).toBe('no-store');
          const errores = detallesDe(respuesta)['errores'] as { campo: string }[];
          expect(errores[0]?.campo).toBe(campo);
          if (mensaje !== undefined) expect(mensajeDelCampo(respuesta, campo)).toBe(mensaje);
          expect(respuesta.body?.['cajas'], 'un 400 no trae cajas').toBeUndefined();
        },
      );

      it.each([
        ['los dos con formato inválido: uno por campo, desde primero', '?desde=x&hasta=y', ['desde', 'hasta']],
        [
          'los dos repetidos o con corchetes: uno por campo, desde primero',
          '?hasta[]=2026-11-01&desde=a&desde=b',
          ['desde', 'hasta'],
        ],
        ['dos fechas que no existen', '?desde=2026-02-30&hasta=2026-02-31', ['desde', 'hasta']],
        [
          'desde inválido con hasta válido: la regla del rango no se evalúa',
          '?desde=2026-02-30&hasta=2026-01-01',
          ['desde'],
        ],
        [
          'hasta inválido con desde válido: la regla del rango no se evalúa',
          '?desde=2027-01-01&hasta=2026-02-30',
          ['hasta'],
        ],
        ['desde con corchetes y hasta válido: solo desde falla', '?desde[]=2026-11-01&hasta=2026-11-01', ['desde']],
        ['hasta vacío y desde válido y fuera de rango: solo hasta falla', '?desde=2020-01-01&hasta=', ['hasta']],
      ])('PQ3: %s (%s)', async (_nombre, consulta, campos) => {
        const respuesta = await lista(consulta);

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toEqual(campos);
      });
    });

    describe('"hoy" es el de Lima, no el del servidor ni el de UTC', () => {
      const CASOS: [string, string, string][] = [
        ['18:59 del 30 de noviembre en Lima', '2026-11-30T23:59:00.000Z', '2026-10-31|2026-11-30'],
        [
          '19:30 del 30 de noviembre en Lima (en UTC ya es 1 de diciembre)',
          '2026-12-01T00:30:00.000Z',
          '2026-10-31|2026-11-30',
        ],
        ['23:59:59.999 del 30 de noviembre en Lima', '2026-12-01T04:59:59.999Z', '2026-10-31|2026-11-30'],
        ['00:00 del 1 de diciembre en Lima', '2026-12-01T05:00:00.000Z', '2026-11-01|2026-12-01'],
        ['23:59:59.999 del 31 de diciembre en Lima', '2027-01-01T04:59:59.999Z', '2026-12-01|2026-12-31'],
        ['00:00 del 1 de enero en Lima', '2027-01-01T05:00:00.000Z', '2026-12-02|2027-01-01'],
      ];

      it.each(CASOS)('PQ3: sin parámetros, a las %s el rango es %s', async (_nombre, instante, esperado) => {
        const ahora = new Date(instante);
        ctx.reloj.fijar(ahora);
        const [desde, hasta] = esperado.split('|');

        const respuesta = await ctx.http.get('/api/cajas', cookiesDeCaja(e, ahora).admin);

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(listaDe(respuesta)).toMatchObject({ desde, hasta });
      });

      it('PQ3: con solo desde, "hasta" es hoy en Lima: a las 19:30 del 30 de noviembre, desde=2026-11-30 vale y desde=2026-12-01 es posterior a hoy', async () => {
        const ahora = new Date('2026-12-01T00:30:00.000Z');
        ctx.reloj.fijar(ahora);
        const cookie = cookiesDeCaja(e, ahora).admin;

        const valido = await ctx.http.get('/api/cajas?desde=2026-11-30', cookie);
        const posterior = await ctx.http.get('/api/cajas?desde=2026-12-01', cookie);

        expect(valido.status, valido.texto).toBe(200);
        expect(listaDe(valido)).toMatchObject({ desde: '2026-11-30', hasta: '2026-11-30' });
        expect(posterior.status, posterior.texto).toBe(400);
        expect(camposConError(posterior)[0]).toBe('desde');
        expect(mensajeDelCampo(posterior, 'desde')).toBe(MENSAJE_INVERTIDO);
      });
    });

    describe('qué cajas entran en el rango (PQ4)', () => {
      it('PQ4: las cajas con fecha entre desde y hasta, los dos incluidos, de la más reciente a la más antigua; las de fuera (también una abierta) no aparecen', async () => {
        const fechas = ['2026-10-11', '2026-10-12', '2026-11-10', '2026-11-11'];
        const cajas: Record<string, string> = {};
        for (const fecha of fechas) {
          cajas[fecha] = (await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha, estado: 'CERRADA' })).id;
        }
        // Una caja abierta de otro día, fuera del rango por defecto: se ve en /panel/caja, no en el historial.
        const abierta = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-09-01' });

        const porDefecto = await lista('');
        const exacto = await lista('?desde=2026-10-11&hasta=2026-10-12');
        const unDia = await lista('?desde=2026-11-10&hasta=2026-11-10');
        const amplio = await lista('?desde=2026-09-01&hasta=2026-11-11');

        expect(idsDeLista(porDefecto)).toEqual([cajas['2026-11-11'], cajas['2026-11-10'], cajas['2026-10-12']]);
        expect(idsDeLista(exacto)).toEqual([cajas['2026-10-12'], cajas['2026-10-11']]);
        expect(idsDeLista(unDia)).toEqual([cajas['2026-11-10']]);
        expect(idsDeLista(amplio)).toEqual([
          cajas['2026-11-11'],
          cajas['2026-11-10'],
          cajas['2026-10-12'],
          cajas['2026-10-11'],
          abierta.id,
        ]);
      });
    });
  },
);
