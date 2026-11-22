// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codigoDeErrorDeBase } from '../../../src/infraestructura/prisma';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_EGRESO,
  type AppCaja,
  type CajaDePrueba,
  type EgresoEnCajaPrueba,
  type IngresoEnCajaPrueba,
  cargarModuloCaja,
  cerrarCajaDePrueba,
  codigoDeError,
  crearAlumnoDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  decimal,
  type EscenarioCaja,
  exigirRutasDeCaja,
  ingresoDeEjemplo,
  intentar,
  leerMovimientos,
  type ModuloCaja,
} from '../../utilidades/caja';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 48 (crítico, HU-26, RN-17, RN-22; ronda adversarial 1): las interfaces de la caja que usarán la 007 y la 019 no confían en que quien llama
// haya validado. Se cargan con importación dinámica desde `backend/src/modulos/caja/index.ts` y se llaman dentro de `conAcademia`, con el reloj fijo
// y la caja de hoy abierta (para que el `RangeError` no se confunda con SIN_CAJA_ABIERTA ni con el 404).
//  a) `registrarEgresoEnCaja(tx, egreso, ahora)` aplica las reglas de `registrarEgresoSchema`, recorte incluido: `descripcion` (recortada, de 3 a 200
//     caracteres, sin controles ni sustitutos sueltos, sin caracteres de dirección del texto ni separadores, con al menos 3 visibles), `comprobante`
//     (criterios 18 y 47), `claveIdempotencia` (UUID con la regla de `z.uuid()` del contrato), `usuarioId` (forma de UUID, `PATRON_UUID`) y el monto.
//     Si no cumple, lanza `RangeError` antes de tocar la base (antes de bloquear la caja y de buscar la clave), sin insertar movimiento ni auditoría.
//     Un `cajaId` que no es UUID sigue respondiendo 404 NO_ENCONTRADO, igual que uno que no existe.
//  b) Se guarda lo normalizado: la descripción recortada y el comprobante recortado o `null` se insertan, se auditan y se comparan con el egreso
//     previo de la misma clave (criterio 22).
//  c) `registrarIngresoEnCaja(tx, ingreso, ahora)` comprueba la forma de lo que recibe: `alumnoId`, `pagoId` y `usuarioId` con forma de UUID,
//     `concepto` uno de INSCRIPCION, MENSUALIDAD o CLASE_PARTICULAR, `metodo` uno de EFECTIVO, YAPE o TRANSFERENCIA. Si no, `RangeError` antes de
//     tocar la base, sin insertar ni auditar. Un `alumnoId` con forma de UUID que no existe o es de otra academia sigue fallando con 23503.
//  e) Un `usuarioId` con forma de UUID que no es de la academia falla con 23503 (llave compuesta, criterio 3): la interfaz no comprueba el rol.
// Los caracteres invisibles se escriben con escapes `\uXXXX`.

const ZONA_ORIGINAL = process.env['TZ'];

describe('interfaces de la caja: validación de las entradas (criterio 48)', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let caja: CajaDePrueba;
  let modulo: ModuloCaja;
  let alumno: { id: string };

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    process.env['TZ'] = 'UTC';
    ctx.reloj.fijar(AHORA_PRUEBAS);
    modulo = await cargarModuloCaja();
    e = await crearEscenarioDeCaja();
    alumno = await crearAlumnoDeCaja(e.A.id);
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });

  const egresoDe = (sobre: Record<string, unknown> = {}): EgresoEnCajaPrueba => ({
    cajaId: caja.id,
    claveIdempotencia: randomUUID(),
    descripcion: 'Compra de útiles',
    monto: decimal('20'),
    comprobante: null,
    usuarioId: e.secretariaA.id,
    ip: null,
    ...sobre,
  });
  async function egresar(egreso: EgresoEnCajaPrueba, ahora: Date = AHORA_PRUEBAS) {
    const baseDatos = await ctx.baseDatos();
    return intentar(baseDatos.conAcademia(e.A.id, (tx) => modulo.registrarEgresoEnCaja(tx, egreso, ahora)));
  }
  async function ingresar(ingreso: IngresoEnCajaPrueba, ahora: Date = AHORA_PRUEBAS) {
    const baseDatos = await ctx.baseDatos();
    return intentar(baseDatos.conAcademia(e.A.id, (tx) => modulo.registrarIngresoEnCaja(tx, ingreso, ahora)));
  }
  /** Un ingreso con campos que el tipo no admite (la prueba lo fuerza como lo haría quien llama sin validar). */
  const ingresoInvalido = (sobre: Record<string, unknown>): IngresoEnCajaPrueba => ({
    ...ingresoDeEjemplo(alumno.id, e.secretariaA.id),
    ...sobre,
  });

  /** Todo lo que cambiaría una llamada rechazada: las filas de `movimientos_caja` y de `auditoria` de la academia. */
  async function filas() {
    return JSON.stringify({
      movimientos: await leerMovimientos(e.A.id),
      auditoria: await leerAuditoriaDeAcademia(e.A.id),
    });
  }

  /** La llamada lanza un `RangeError` (no un `ErrorNegocio`, ni un error de Prisma o de PostgreSQL) y no cambia nada. */
  async function exigirRangeError(
    llamada: () => Promise<{ ok: true; valor: unknown } | { ok: false; error: unknown }>,
  ) {
    const antes = await filas();

    const resultado = await llamada();

    expect(resultado.ok, 'la interfaz aceptó una entrada inválida').toBe(false);
    if (!resultado.ok) {
      expect(resultado.error, String(resultado.error)).toBeInstanceOf(RangeError);
      expect(codigoDeError(resultado.error), 'no debe ser un ErrorNegocio').toBeUndefined();
      expect(codigoDeErrorDeBase(resultado.error), 'no debe ser un error de PostgreSQL').toBeNull();
    }
    expect(await filas()).toBe(antes);
  }

  describe('criterio 48 a y d: registrarEgresoEnCaja valida sus entradas', () => {
    it.each([
      ['descripcion vacía', { descripcion: '' }],
      ['descripcion solo espacios', { descripcion: '  ' }],
      ['descripcion de 2 caracteres', { descripcion: 'ab' }],
      ['descripcion de 201 caracteres', { descripcion: 'a'.repeat(201) }],
      ['descripcion con un salto de línea en medio', { descripcion: 'Compra\nútiles' }],
      ['descripcion con U+202E', { descripcion: 'Compra\u202Eútiles' }],
      ['descripcion con U+2028 en medio', { descripcion: 'Compra\u2028útiles' }],
      ['descripcion con tres U+200B (nada visible)', { descripcion: '\u200B\u200B\u200B' }],
      ['descripcion con un tabulador en medio', { descripcion: 'Compra\tútiles' }],
      ['descripcion con dos letras y un U+3164 (2 visibles)', { descripcion: 'ab\u3164' }],
      ['comprobante con U+202E', { comprobante: 'B001\u202E321' }],
      ['comprobante con U+202E solo', { comprobante: '\u202E' }],
      ['comprobante con U+2028 en medio', { comprobante: 'B001\u2028123' }],
      ['comprobante de 61 caracteres', { comprobante: 'a'.repeat(61) }],
      ['comprobante con un tabulador en medio', { comprobante: 'B001\t123' }],
      ['claveIdempotencia "no-es-uuid"', { claveIdempotencia: 'no-es-uuid' }],
      ['claveIdempotencia vacía', { claveIdempotencia: '' }],
      [
        'claveIdempotencia con forma de UUID pero que z.uuid() rechaza (versión y variante inválidas)',
        { claveIdempotencia: '11111111-1111-1111-1111-111111111111' },
      ],
      ['usuarioId "x"', { usuarioId: 'x' }],
      ['usuarioId vacío', { usuarioId: '' }],
    ])('criterio 48 a: con %s lanza RangeError y no cambia nada', async (_nombre, sobre) => {
      await exigirRangeError(() => egresar(egresoDe(sobre)));
    });

    it.each([
      ['0', '0'],
      ['0.00', '0.00'],
      ['negativo', '-1.00'],
      ['con tres decimales', '5.555'],
      ['de 100000000 (no cabe en numeric(10,2))', '100000000'],
    ])('criterio 48 a: un monto %s sigue lanzando RangeError y no cambia nada', async (_nombre, monto) => {
      await exigirRangeError(() => egresar(egresoDe({ monto: decimal(monto) })));
    });

    it('criterio 48 a: el RangeError va antes de buscar la caja: con una caja que no existe y una descripción inválida lanza RangeError y no NO_ENCONTRADO', async () => {
      await exigirRangeError(() => egresar(egresoDe({ cajaId: randomUUID(), descripcion: 'ab' })));
    });

    it('criterio 48 a: el RangeError va antes de bloquear la caja y de buscar la clave: con la caja cerrada y una clave ya usada, una descripción inválida lanza RangeError y no CAJA_CERRADA ni repetido', async () => {
      const usado = egresoDe();
      expect((await egresar(usado)).ok).toBe(true);
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);

      await exigirRangeError(() => egresar({ ...usado, descripcion: '' }));
      await exigirRangeError(() => egresar({ ...usado, comprobante: '\u202E' }));
    });

    it('criterio 48 a: un cajaId que no es UUID sigue respondiendo NO_ENCONTRADO, igual que uno que no existe', async () => {
      const antes = await filas();

      const noEsUuid = await egresar(egresoDe({ cajaId: 'no-es-uuid' }));
      const noExiste = await egresar(egresoDe({ cajaId: randomUUID() }));

      expect(!noEsUuid.ok && codigoDeError(noEsUuid.error)).toBe('NO_ENCONTRADO');
      expect(!noExiste.ok && codigoDeError(noExiste.error)).toBe('NO_ENCONTRADO');
      expect(await filas()).toBe(antes);
    });

    it('criterio 48 e: un usuarioId con forma de UUID que no es de la academia falla con 23503 (la interfaz no comprueba el rol) y no deja nada', async () => {
      const antes = await filas();

      const resultado = await egresar(egresoDe({ usuarioId: randomUUID() }));

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(codigoDeErrorDeBase(resultado.error)).toBe('23503');
      expect(await filas()).toBe(antes);
    });

    it('criterio 48 a: una entrada válida (clave con z.uuid() válido, usuario y datos normales) se sigue aceptando', async () => {
      const resultado = await egresar(egresoDe({ comprobante: 'Boleta 1' }));

      expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });
  });

  describe('criterio 48 b: registrarEgresoEnCaja guarda lo normalizado', () => {
    it('criterio 48 b: una descripción con espacios alrededor se guarda recortada, se audita recortada y la misma clave con la descripción recortada devuelve repetido: true', async () => {
      const clave = randomUUID();

      const primero = await egresar(
        egresoDe({ claveIdempotencia: clave, descripcion: '  Compra de útiles  ', comprobante: 'B001' }),
      );
      const repetido = await egresar(
        egresoDe({ claveIdempotencia: clave, descripcion: 'Compra de útiles', comprobante: 'B001' }),
      );

      expect(primero.ok, JSON.stringify(primero)).toBe(true);
      expect(repetido.ok, JSON.stringify(repetido)).toBe(true);
      if (!primero.ok || !repetido.ok) return;
      expect(primero.valor.repetido).toBe(false);
      expect(repetido.valor).toMatchObject({ id: primero.valor.id, repetido: true });
      const guardadas = await leerMovimientos(e.A.id);
      expect(guardadas).toHaveLength(1);
      expect(guardadas[0]?.descripcion).toBe('Compra de útiles');
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.datos_despues).toMatchObject({ descripcion: 'Compra de útiles', comprobante: 'B001' });
    });

    it('criterio 48 b: y al revés, la clave con la descripción con espacios alrededor tampoco es otro egreso', async () => {
      const clave = randomUUID();
      const primero = await egresar(egresoDe({ claveIdempotencia: clave, descripcion: 'Compra de útiles' }));

      const repetido = await egresar(egresoDe({ claveIdempotencia: clave, descripcion: '  Compra de útiles ' }));

      expect(repetido.ok, JSON.stringify(repetido)).toBe(true);
      expect(repetido.ok && primero.ok && repetido.valor.id === primero.valor.id && repetido.valor.repetido).toBe(true);
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    });

    it('criterio 48 b: un comprobante recortado se guarda recortado ("  B001  " queda "B001")', async () => {
      const resultado = await egresar(egresoDe({ comprobante: '  B001  ' }));

      expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
      expect((await leerMovimientos(e.A.id))[0]?.comprobante).toBe('B001');
      expect((await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO))[0]?.datos_despues).toMatchObject({
        comprobante: 'B001',
      });
    });

    it.each([
      ['solo espacios', '   '],
      ['U+200B', '\u200B'],
      ['U+3164', '\u3164'],
    ])(
      'criterio 48 b: un comprobante %s se guarda null (en la fila y en la auditoría) y equivale a null con la misma clave',
      async (_nombre, comprobante) => {
        const clave = randomUUID();

        const primero = await egresar(egresoDe({ claveIdempotencia: clave, comprobante }));
        const repetido = await egresar(egresoDe({ claveIdempotencia: clave, comprobante: null }));

        expect(primero.ok, JSON.stringify(primero)).toBe(true);
        expect(repetido.ok, JSON.stringify(repetido)).toBe(true);
        if (!primero.ok || !repetido.ok) return;
        expect(repetido.valor).toMatchObject({ id: primero.valor.id, repetido: true });
        const guardadas = await leerMovimientos(e.A.id);
        expect(guardadas).toHaveLength(1);
        expect(guardadas[0]?.comprobante).toBeNull();
        const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO);
        expect(auditoria).toHaveLength(1);
        expect((auditoria[0]?.datos_despues as Record<string, unknown> | null)?.['comprobante']).toBeNull();
      },
    );

    it('criterio 48 b: con la misma clave, un comprobante visible frente a uno que se guarda null es CLAVE_YA_USADA y no escribe', async () => {
      const clave = randomUUID();
      expect((await egresar(egresoDe({ claveIdempotencia: clave, comprobante: 'B001' }))).ok).toBe(true);
      const antes = await filas();

      const otro = await egresar(egresoDe({ claveIdempotencia: clave, comprobante: '\u3164' }));

      expect(!otro.ok && codigoDeError(otro.error)).toBe('CLAVE_YA_USADA');
      expect(await filas()).toBe(antes);
    });

    it('criterio 48 b: un comprobante con algo visible se guarda tal como llega, invisibles incluidos', async () => {
      const resultado = await egresar(egresoDe({ comprobante: 'B\u200B1' }));

      expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
      expect((await leerMovimientos(e.A.id))[0]?.comprobante).toBe('B\u200B1');
    });
  });

  describe('criterio 48 c y d: registrarIngresoEnCaja comprueba la forma de lo que recibe', () => {
    it.each([
      ['alumnoId "x"', { alumnoId: 'x' }],
      ['pagoId "x"', { pagoId: 'x' }],
      ['usuarioId "x"', { usuarioId: 'x' }],
      ['concepto EGRESO_MENOR', { concepto: 'EGRESO_MENOR' }],
      ['concepto OTRO', { concepto: 'OTRO' }],
      ['metodo TARJETA', { metodo: 'TARJETA' }],
      ['alumnoId vacío', { alumnoId: '' }],
      ['pagoId vacío', { pagoId: '' }],
      ['metodo en minúsculas', { metodo: 'yape' }],
    ])('criterio 48 c: con %s lanza RangeError y no cambia nada', async (_nombre, sobre) => {
      await exigirRangeError(() => ingresar(ingresoInvalido(sobre)));
    });

    it('criterio 48 c: la forma se comprueba antes de tocar la base: sin caja abierta y con un pagoId "x" lanza RangeError y no SIN_CAJA_ABIERTA', async () => {
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);

      await exigirRangeError(() => ingresar(ingresoInvalido({ pagoId: 'x' })));
    });

    it('criterio 48 c: el pagoId inválido no llega a la consulta del paso b: con un ingreso ya registrado, un pagoId "x" lanza RangeError y no un error de PostgreSQL', async () => {
      expect((await ingresar(ingresoDeEjemplo(alumno.id, e.secretariaA.id))).ok).toBe(true);

      await exigirRangeError(() => ingresar(ingresoInvalido({ pagoId: 'x' })));
    });

    it('criterio 48 c: un alumnoId con forma de UUID que no existe sigue fallando con 23503', async () => {
      const antes = await filas();

      const resultado = await ingresar(ingresoInvalido({ alumnoId: randomUUID() }));

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(codigoDeErrorDeBase(resultado.error)).toBe('23503');
      expect(await filas()).toBe(antes);
    });

    it('criterio 48 c: un ingreso válido se sigue aceptando con cada concepto y cada método permitidos', async () => {
      for (const [concepto, metodo] of [
        ['INSCRIPCION', 'EFECTIVO'],
        ['MENSUALIDAD', 'YAPE'],
        ['CLASE_PARTICULAR', 'TRANSFERENCIA'],
      ] as const) {
        const resultado = await ingresar(ingresoDeEjemplo(alumno.id, e.secretariaA.id, { concepto, metodo }));

        expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
      }
      expect(await leerMovimientos(e.A.id)).toHaveLength(3);
    });
  });

  describe('criterio 48 d: el egreso previo no cambia con las llamadas rechazadas', () => {
    it('criterio 48 d: con un egreso ya registrado, las llamadas rechazadas no cambian ni sus filas ni su auditoría', async () => {
      await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id);
      const primero = await egresar(egresoDe());
      expect(primero.ok).toBe(true);

      await exigirRangeError(() => egresar(egresoDe({ descripcion: '' })));
      await exigirRangeError(() => ingresar(ingresoInvalido({ metodo: 'TARJETA' })));

      expect(await leerMovimientos(e.A.id)).toHaveLength(2);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_EGRESO)).toHaveLength(1);
    });
  });
});
