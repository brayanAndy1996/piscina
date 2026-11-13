// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearClienteDelDueno, enPlataforma } from '../../../src/cli/conexion';
import { insertarEnAuditoriaPlataforma } from '../../../src/modulos/auditoria/insercion';
import { limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, leerAcademias, leerAuditoriaPlataforma } from '../../utilidades/datos';
import {
  correrVariante,
  esperarFalloPosterior,
  esperarRechazoPropio,
  esperarTransaccionAbortada,
  leerEscritoDePlataforma,
  NADA,
  pasosDeEnPlataforma,
  resultadoDe,
  siguienteNumero,
  TODO,
  VALOR,
  type Seguimiento,
  type Variante,
} from '../../utilidades/ronda10';
import { cargarPuntoAutorizado } from '../../utilidades/ronda4';

// Criterio 150 (ataque ronda 10, F1; amplia el criterio 90 y el contrato de `enPlataforma`, P-17 y P-23): lo mismo que el criterio 149, en los
// comandos y la semilla. `enPlataforma(cliente, trabajo)` devuelve el valor de `trabajo` solo si, despues de que `trabajo` termina bien y antes
// de pedir la confirmacion, la transaccion sigue activa y sin abortar; si no, rechaza con `ErrorTransaccionAbortada` (la misma clase de P-36) y no
// queda nada escrito; si `trabajo` lanza, rechaza con ese error, como hoy. `trabajo` sigue recibiendo la transaccion completa de Prisma (P-24).
// Con `crearClienteDelDueno(<URL del duenio de pruebas>, { max: 1 })`: las variantes 1 a 3 del criterio 149 (sin la del modelo en la 3: riesgo
// aceptado), escribiendo una academia nueva con `tx.$executeRaw` y un registro con `insertarEnAuditoriaPlataforma`; en la 3, la consulta sin
// `await` se envia con `tx.$executeRaw`...`.catch(...)`. En cada una rechaza con `ErrorTransaccionAbortada` y, leido como duenio con una conexion
// nueva, no queda nada. Controles como en el 149, y despues de cada variante otro `enPlataforma` con el mismo cliente resuelve.
//
// Criterio 151 (caso `ROLLBACK` en `enPlataforma`): `trabajo` escribe, ejecuta `ROLLBACK` con `$executeRaw` y devuelve un valor: rechaza con
// `ErrorTransaccionAbortada` y no queda nada escrito.
//
// Criterio 152 (parte de los comandos y la semilla): `insertarEnAuditoriaPlataforma`, que usan los comandos y la semilla, guarda la IP sin la
// zona IPv6 y una IP que no se puede guardar hace fallar la operacion entera (sin nada escrito).

type Cliente = ReturnType<typeof crearClienteDelDueno>;

const VARIANTES_150: readonly { readonly variante: Variante; readonly titulo: string }[] = [
  { variante: 'unicidad', titulo: 'variante 1, reintento que atrapa esViolacionDeUnicidad tras una escritura previa' },
  { variante: 'error-try', titulo: 'variante 2, SELECT 1/0 atrapado con try/catch vacio' },
  { variante: 'error-catch', titulo: 'variante 2, SELECT 1/0 atrapado con .catch(() => undefined)' },
  {
    variante: 'sin-await-cruda',
    titulo: 'variante 3, tx.$executeRaw sin await que falla despues de que trabajo termina',
  },
];

describe('criterio 150: enPlataforma no reporta como confirmada una transaccion abortada', () => {
  let cliente: Cliente | undefined;

  beforeEach(async () => {
    await limpiarBase();
    await crearDatosDeAislamiento();
    cliente = crearClienteDelDueno(urlPropietarioPruebas(), { max: 1 });
  });
  afterEach(async () => {
    await cliente?.$disconnect();
    cliente = undefined;
  });

  function corrida(variante: Variante, errorPropio?: Error) {
    const n = siguienteNumero();
    const seguimiento: Seguimiento = errorPropio === undefined ? {} : { errorPropio };
    return {
      n,
      seguimiento,
      llamada: () =>
        enPlataforma(cliente as Cliente, (tx) => correrVariante(variante, pasosDeEnPlataforma(tx, n), seguimiento)),
      leer: () => leerEscritoDePlataforma(n),
    };
  }

  /** Otro `enPlataforma` con el mismo cliente (un solo conector): resuelve y lee el contexto de plataforma. */
  async function esperarClienteSano(contexto: string): Promise<void> {
    const visto = await enPlataforma(cliente as Cliente, async (tx) => {
      const filas = await tx.$queryRaw<{ plataforma: string | null; academia: string | null }[]>`
        SELECT current_setting('app.plataforma', true) AS plataforma, current_setting('app.academia_id', true) AS academia`;
      return filas[0];
    });
    expect(visto?.plataforma, `${contexto}: contexto de plataforma`).toBe('si');
    expect(visto?.academia ?? '', `${contexto}: sin academia`).toBe('');
  }

  for (const { variante, titulo } of VARIANTES_150) {
    describe(`criterio 150, ${titulo}`, () => {
      it('criterio 150: enPlataforma rechaza con ErrorTransaccionAbortada y no devuelve el valor de trabajo', async () => {
        const c = corrida(variante);

        const resultado = await resultadoDe(c.llamada);

        await esperarTransaccionAbortada(resultado, `enPlataforma, ${titulo}`);
      });

      it('criterio 150: leido como duenio con una conexion nueva no queda nada: ni la academia ni el registro de auditoria', async () => {
        const c = corrida(variante);

        await resultadoDe(c.llamada);

        expect(await c.leer()).toEqual(NADA);
      });

      it('criterio 150: despues de la variante, otro enPlataforma con el mismo cliente resuelve con el contexto de plataforma', async () => {
        const c = corrida(variante);

        await resultadoDe(c.llamada);

        await esperarClienteSano(titulo);
      });
    });
  }

  it('criterio 150 (premisa de la variante 3): trabajo termina antes de que la consulta enviada sin await falle', async () => {
    const c = corrida('sin-await-cruda');

    await resultadoDe(c.llamada);

    await esperarFalloPosterior(c.seguimiento);
  });

  describe('criterio 150 (controles)', () => {
    it('criterio 150 (control): el mismo trabajo sin el paso que falla resuelve con el valor y la academia y su registro quedan', async () => {
      const c = corrida('sin-fallo');

      const resultado = await resultadoDe(c.llamada);

      expect(resultado).toEqual({ resolvio: true, valor: VALOR });
      expect(await c.leer()).toEqual(TODO);
    });

    it('criterio 150 (control): una consulta sin await que no falla no hace rechazar la transaccion', async () => {
      const c = corrida('sin-await-ok');

      const resultado = await resultadoDe(c.llamada);

      expect(resultado).toEqual({ resolvio: true, valor: VALOR });
      expect(await c.leer()).toEqual(TODO);
    });

    it('criterio 150 (control): un trabajo que relanza el error de unicidad atrapado rechaza con ese error (23505), no con ErrorTransaccionAbortada', async () => {
      const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
      const c = corrida('relanza-unicidad');

      const resultado = await resultadoDe(c.llamada);

      expect(codigoDeErrorDeBase(esperarRechazoPropio(resultado, 'enPlataforma, relanza la unicidad'))).toBe('23505');
      expect(await c.leer()).toEqual(NADA);
      await esperarClienteSano('relanza la unicidad');
    });

    it('criterio 150 (control): un trabajo que relanza SELECT 1/0 rechaza con ese error (22012), no con ErrorTransaccionAbortada', async () => {
      const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
      const c = corrida('relanza-division');

      const resultado = await resultadoDe(c.llamada);

      expect(codigoDeErrorDeBase(esperarRechazoPropio(resultado, 'enPlataforma, relanza SELECT 1/0'))).toBe('22012');
      expect(await c.leer()).toEqual(NADA);
      await esperarClienteSano('relanza SELECT 1/0');
    });

    it('criterio 150 (control): un trabajo que atrapa SELECT 1/0 y despues lanza un error propio rechaza con ese mismo error', async () => {
      const propio = new Error('error propio de la prueba r10');
      const c = corrida('relanza-propio', propio);

      const resultado = await resultadoDe(c.llamada);

      expect(resultado.resolvio).toBe(false);
      expect(resultado.error).toBe(propio);
      expect(await c.leer()).toEqual(NADA);
      await esperarClienteSano('error propio');
    });

    it('criterio 150 (control, P-24): trabajo sigue recibiendo la transaccion completa de Prisma', async () => {
      const visto = await enPlataforma(cliente as Cliente, (tx) =>
        Promise.resolve({
          consulta: typeof tx.$queryRaw,
          ejecucion: typeof tx.$executeRaw,
          modelo: typeof (tx as unknown as { configuracion?: { findMany?: unknown } }).configuracion?.findMany,
        }),
      );

      expect(visto).toEqual({ consulta: 'function', ejecucion: 'function', modelo: 'function' });
    });
  });

  describe('criterio 151: ROLLBACK escrito dentro de trabajo en enPlataforma', () => {
    it('criterio 151: trabajo escribe, ejecuta ROLLBACK con $executeRaw y devuelve un valor: rechaza con ErrorTransaccionAbortada', async () => {
      const c = corrida('rollback');

      const resultado = await resultadoDe(c.llamada);

      await esperarTransaccionAbortada(resultado, 'enPlataforma, ROLLBACK escrito');
    });

    it('criterio 151: tras el ROLLBACK escrito no queda nada escrito', async () => {
      const c = corrida('rollback');

      await resultadoDe(c.llamada);

      expect(await c.leer()).toEqual(NADA);
    });

    it('criterio 151: tras el ROLLBACK escrito otro enPlataforma con el mismo cliente resuelve con el contexto de plataforma', async () => {
      const c = corrida('rollback');

      await resultadoDe(c.llamada);

      await esperarClienteSano('ROLLBACK escrito');
    });
  });

  describe('criterio 152: la IP de la auditoria en los comandos y la semilla', () => {
    const entrada = (accion: string, ip: string | null) => ({
      actorTipo: 'SISTEMA' as const,
      actorId: null,
      accion,
      entidad: 'prueba',
      entidadId: null,
      ip,
    });

    it('criterio 152: insertarEnAuditoriaPlataforma con fe80::1%eth0 guarda host(ip) = fe80::1', async () => {
      await enPlataforma(cliente as Cliente, (tx) =>
        insertarEnAuditoriaPlataforma(tx, new Date(), entrada('PRUEBA_R10_IP_ZONA', 'fe80::1%eth0')),
      );

      const filas = await leerAuditoriaPlataforma('PRUEBA_R10_IP_ZONA');
      expect(filas.map((fila) => fila.ip)).toEqual(['fe80::1']);
    });

    it('criterio 152: con una IPv4 se guarda sin cambios y con null se guarda NULL (actor SISTEMA sin IP)', async () => {
      await enPlataforma(cliente as Cliente, async (tx) => {
        await insertarEnAuditoriaPlataforma(tx, new Date(), entrada('PRUEBA_R10_IP_V4', '203.0.113.5'));
        await insertarEnAuditoriaPlataforma(tx, new Date(), entrada('PRUEBA_R10_IP_NULA', null));
      });

      expect((await leerAuditoriaPlataforma('PRUEBA_R10_IP_V4')).map((fila) => fila.ip)).toEqual(['203.0.113.5']);
      expect((await leerAuditoriaPlataforma('PRUEBA_R10_IP_NULA')).map((fila) => fila.ip)).toEqual([null]);
    });

    it('criterio 152: una IP que no se puede normalizar hace fallar la operacion entera y no queda nada escrito (ni la academia ni el registro)', async () => {
      const n = siguienteNumero();

      const resultado = await resultadoDe(() =>
        enPlataforma(cliente as Cliente, async (tx) => {
          await tx.$executeRaw`INSERT INTO academias (id, nombre, nombre_corto, estado, creada_en, actualizada_en)
            VALUES (gen_random_uuid(), 'Academia IP invalida', ${`ip-invalida-${n}`}, 'ACTIVA', now(), now())`;
          await insertarEnAuditoriaPlataforma(tx, new Date(), entrada(`PRUEBA_R10_IP_${n}`, 'no-es-ip'));
          return VALOR;
        }),
      );

      expect(resultado.resolvio, 'debia rechazar').toBe(false);
      expect((resultado.error as Error).message, 'el error no repite el texto recibido').not.toContain('no-es-ip');
      expect((await leerAcademias()).filter((fila) => fila.nombre_corto === `ip-invalida-${n}`)).toHaveLength(0);
      expect(await leerAuditoriaPlataforma(`PRUEBA_R10_IP_${n}`)).toHaveLength(0);
    });
  });
});
