// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_EGRESO,
  type AppCaja,
  type CajaDePrueba,
  type Objeto,
  camposConError,
  codigoDe,
  cookiesDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  cuerpoEgreso,
  type EscenarioCaja,
  exigirRutasDeCaja,
  instantaneaDeCaja,
  leerMovimientos,
  movimientoDe,
  rutaCaja,
} from '../../utilidades/caja';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 47 (crítico, HU-26, DR-3, RN-22; ronda adversarial 1): el comprobante del egreso, con las reglas de texto de la descripción.
// `POST /api/cajas/{C}/egresos` trata el `comprobante` en este orden:
//   a) recorte, igual que la descripción (el `trim` de `textoVisibleSchema`, que también quita U+2028 y U+2029 de los bordes);
//   b) rechazo: 400 SOLICITUD_INVALIDA en el campo `comprobante`, sin escribir ni auditar, si el texto recortado tiene controles o sustitutos sueltos,
//      más de 60 caracteres, o caracteres de dirección del texto (`\p{Bidi_Control}`) o separadores U+2028 y U+2029. `{U+202E}` solo también se
//      rechaza: el rechazo va antes que la normalización de c;
//   c) sin ningún carácter visible (`contarVisibles`: no cuentan los `Default_Ignorable_Code_Point`, U+2800 ni las marcas combinantes) cuenta como
//      ausente y se guarda `null`; con al menos uno visible se guarda el texto recortado tal como llega, invisibles incluidos, sin mínimo de
//      visibles (`"1"` es válido);
//   d) en los casos de c, `movimiento.comprobante` y `datosDespues.comprobante` de CAJA_EGRESO_REGISTRADO son `null`;
//   e) idempotencia (criterio 22): la clave repetida se compara con el comprobante ya normalizado; con la clave K, un comprobante visible frente a
//      uno que se guarda `null` (en cualquier orden) es 409 CLAVE_YA_USADA; un reintento con un comprobante que cae en b responde 400 aunque la clave
//      ya exista (el esquema va antes que la clave).
// Los caracteres invisibles se escriben con escapes `\uXXXX`. Las reglas del esquema, una por una, están en
// `packages/contratos/src/caja-comprobante-protegido.test.ts`; aquí se prueba la ruta contra PostgreSQL real.

const ZONA_ORIGINAL = process.env['TZ'];

/** Los comprobantes que se guardan `null` (sin nada visible), con su nombre. `undefined` es la clave ausente. */
const SIN_NADA_VISIBLE: readonly (readonly [string, string | null | undefined])[] = [
  ['vacío', ''],
  ['solo espacios', '   '],
  ['null', null],
  ['ausente', undefined],
  ['U+200B', '\u200B'],
  ['U+3164', '\u3164'],
  ['U+2800', '\u2800'],
  ['U+00AD', '\u00AD'],
  ['U+0301 solo', '\u0301'],
  ['U+200B y U+3164 con un espacio antes y otro después', ' \u200B\u3164 '],
  ['U+2028 solo (el recorte lo quita)', '\u2028'],
];

describe('comprobante del egreso (criterio 47)', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let caja: CajaDePrueba;

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });

  const egreso = (cuerpo: unknown) => ctx.http.post(rutaCaja(caja.id, '/egresos'), cookies.secretaria, cuerpo);
  const auditorias = () => leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO);
  /** Un cuerpo con el comprobante dado; `undefined` no viaja en el JSON (clave ausente). */
  const conComprobante = (comprobante: unknown, sobre: Objeto = {}): Objeto =>
    cuerpoEgreso({ monto: '1.00', comprobante, ...sobre });

  async function estado() {
    return {
      cajas: await instantaneaDeCaja(e.A.id),
      cajasB: await instantaneaDeCaja(e.B.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }

  describe('criterio 47 b: el rechazo', () => {
    it.each([
      ['U+202E en medio', 'B001\u202E321'],
      ['U+202E al inicio', '\u202EB001'],
      ['U+2066 y U+2069 alrededor', '\u2066B001\u2069'],
      ['U+200F al final de un texto visible', 'B001\u200F'],
      ['U+2028 en medio', 'B001\u2028123'],
      ['U+2029 en medio', 'B001\u2029123'],
      ['U+202E solo (el rechazo va antes que la normalización a null)', '\u202E'],
      ['U+061C en medio', 'B001\u061C321'],
      ['U+200E en medio', 'B001\u200E321'],
      ['U+202A en medio', 'B001\u202A321'],
      ['U+2067 solo', '\u2067'],
      ['U+200F con espacios alrededor, sin nada visible', '  \u200F  '],
    ])(
      'criterio 47 b: un comprobante con %s responde 400 SOLICITUD_INVALIDA en comprobante, sin escribir ni auditar',
      async (_nombre, comprobante) => {
        const antes = await estado();

        const respuesta = await egreso(conComprobante(comprobante));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
        expect(camposConError(respuesta)).toContain('comprobante');
        expect(await estado()).toEqual(antes);
        expect(await leerMovimientos(e.A.id)).toHaveLength(0);
        expect(await auditorias()).toHaveLength(0);
      },
    );

    it.each([
      ['de 61 caracteres', 'a'.repeat(61)],
      ['con un tabulador en medio', 'B001\t123'],
      ['con un salto de línea en medio', 'B001\n123'],
      ['con un carácter nulo', 'B001\u0000123'],
    ])(
      'criterio 47 b: un comprobante %s sigue respondiendo 400 en comprobante, sin escribir ni auditar (como hoy)',
      async (_nombre, comprobante) => {
        const antes = await estado();

        const respuesta = await egreso(conComprobante(comprobante));

        expect(respuesta.status, respuesta.texto).toBe(400);
        expect(camposConError(respuesta)).toContain('comprobante');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 47 b: un reintento con la clave K y un comprobante que cae en b responde 400 aunque la clave ya exista (el esquema va antes que la clave)', async () => {
      const clave = randomUUID();
      const primero = await egreso(conComprobante('B001', { claveIdempotencia: clave }));
      expect(primero.status, primero.texto).toBe(201);
      const antes = await estado();

      const reintento = await egreso(conComprobante('B001\u202E', { claveIdempotencia: clave }));

      expect(reintento.status, reintento.texto).toBe(400);
      expect(codigoDe(reintento)).toBe('SOLICITUD_INVALIDA');
      expect(camposConError(reintento)).toContain('comprobante');
      expect(await estado()).toEqual(antes);
    });
  });

  describe('criterio 47 a y c: el recorte y lo que no tiene nada visible', () => {
    it.each([
      ['B001\u2028 (U+2028 al final)', 'B001\u2028', 'B001'],
      ['\u2029B001\u2029 (U+2029 alrededor)', '\u2029B001\u2029', 'B001'],
      ['  B001  (espacios alrededor)', '  B001  ', 'B001'],
    ])('criterio 47 a: el comprobante %s se guarda recortado como "B001"', async (_nombre, comprobante, guardado) => {
      const respuesta = await egreso(conComprobante(comprobante));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(movimientoDe(respuesta).comprobante).toBe(guardado);
      expect((await leerMovimientos(e.A.id))[0]?.comprobante).toBe(guardado);
      expect((await auditorias())[0]?.datos_despues).toMatchObject({ comprobante: guardado });
    });

    it.each(SIN_NADA_VISIBLE)(
      'criterio 47 c y d: un comprobante %s se guarda null en la respuesta, en la fila y en la auditoría',
      async (_nombre, comprobante) => {
        const respuesta = await egreso(conComprobante(comprobante));

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(movimientoDe(respuesta).comprobante).toBeNull();
        const filas = await leerMovimientos(e.A.id);
        expect(filas).toHaveLength(1);
        expect(filas[0]?.comprobante).toBeNull();
        const registros = await auditorias();
        expect(registros).toHaveLength(1);
        expect((registros[0]?.datos_despues as Objeto | null)?.['comprobante']).toBeNull();
      },
    );

    it.each([
      ['con un invisible en medio (B, U+200B, 1)', 'B\u200B1'],
      ['con invisibles alrededor de lo visible', '\u200BB001\u3164'],
      ['de un solo carácter ("1"): sin mínimo de visibles', '1'],
      ['con una letra y su marca combinante', 'e\u0301'],
    ])(
      'criterio 47 c: un comprobante %s se guarda tal como llega, invisibles incluidos, en la respuesta, la fila y la auditoría',
      async (_nombre, comprobante) => {
        const respuesta = await egreso(conComprobante(comprobante));

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(movimientoDe(respuesta).comprobante).toBe(comprobante);
        expect((await leerMovimientos(e.A.id))[0]?.comprobante).toBe(comprobante);
        expect((await auditorias())[0]?.datos_despues).toMatchObject({ comprobante });
      },
    );
  });

  describe('criterio 47 e: la idempotencia compara el comprobante ya normalizado', () => {
    it('criterio 47 e: con la clave K y cualquiera de los comprobantes que se guardan null, un reintento con cualquier otro de ellos responde 200 con el mismo movimiento, sin otra fila ni otra auditoría', async () => {
      const nulos = SIN_NADA_VISIBLE.slice(0, 6);
      for (const [nombreInicial, inicial] of nulos) {
        const clave = randomUUID();
        const primero = await egreso(conComprobante(inicial, { claveIdempotencia: clave }));
        expect(primero.status, `${nombreInicial}: ${primero.texto}`).toBe(201);
        const filas = (await leerMovimientos(e.A.id)).length;
        const registros = (await auditorias()).length;

        for (const [nombre, reintento] of nulos) {
          const repetido = await egreso(conComprobante(reintento, { claveIdempotencia: clave }));

          expect(repetido.status, `${nombreInicial} y luego ${nombre}: ${repetido.texto}`).toBe(200);
          expect(movimientoDe(repetido), `${nombreInicial} y luego ${nombre}`).toEqual(movimientoDe(primero));
        }
        expect(await leerMovimientos(e.A.id)).toHaveLength(filas);
        expect(await auditorias()).toHaveLength(registros);
      }
    });

    it.each(SIN_NADA_VISIBLE.slice(0, 6))(
      'criterio 47 e: con la clave K, un comprobante visible ("B001") y un reintento con %s, y al revés, responden 409 CLAVE_YA_USADA sin escribir',
      async (_nombre, sinNada) => {
        const claveA = randomUUID();
        const claveB = randomUUID();
        expect((await egreso(conComprobante('B001', { claveIdempotencia: claveA }))).status).toBe(201);
        expect((await egreso(conComprobante(sinNada, { claveIdempotencia: claveB }))).status).toBe(201);
        const antes = await estado();

        const visibleLuegoNada = await egreso(conComprobante(sinNada, { claveIdempotencia: claveA }));
        const nadaLuegoVisible = await egreso(conComprobante('B001', { claveIdempotencia: claveB }));

        expect(visibleLuegoNada.status, visibleLuegoNada.texto).toBe(409);
        expect(codigoDe(visibleLuegoNada)).toBe('CLAVE_YA_USADA');
        expect(nadaLuegoVisible.status, nadaLuegoVisible.texto).toBe(409);
        expect(codigoDe(nadaLuegoVisible)).toBe('CLAVE_YA_USADA');
        expect(await estado()).toEqual(antes);
      },
    );

    it('criterio 47 e: con la clave K y el mismo comprobante visible recortado ("  B001  " frente a "B001") responde 200 con el mismo movimiento', async () => {
      const clave = randomUUID();
      const primero = await egreso(conComprobante('B001', { claveIdempotencia: clave }));

      const repetido = await egreso(conComprobante('  B001\u2028', { claveIdempotencia: clave }));

      expect(repetido.status, repetido.texto).toBe(200);
      expect(movimientoDe(repetido).id).toBe(movimientoDe(primero).id);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
      expect(await auditorias()).toHaveLength(1);
    });
  });
});
