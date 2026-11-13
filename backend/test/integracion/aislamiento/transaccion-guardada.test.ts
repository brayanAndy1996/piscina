// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import {
  obtenerBaseDatosRonda3,
  type BaseDatosRonda3,
  type TransaccionAcademiaRonda3,
  type TransaccionPlataformaRonda3,
} from '../../utilidades/ronda3';

// Criterio 134 (ataque ronda 6, F3; complementa los criterios 100 y 106): el envoltorio solo responde en el contexto de su `trabajo`.
// Un servicio de Nest es una sola instancia para todas las peticiones: guardar `tx` en un campo (`this.tx = tx`) deja que una peticion
// simultanea use la transaccion de otra academia mientras sigue abierta. Entonces:
//   - `BaseDatos` ejecuta todo lo que usa el envoltorio de una transaccion (la comprobacion de la academia de `conAcademia` y
//     `trabajo`) dentro de un contexto asincrono propio de esa transaccion (`AsyncLocalStorage.run` con una marca unica por
//     transaccion; P-32);
//   - cada funcion del envoltorio (`$queryRaw`, `$executeRaw` y cada operacion de cada delegado) comprueba, al llamarse y antes de enviar
//     nada, que el contexto asincrono actual es el de su transaccion; si no (una llamada desde otra peticion, desde otra transaccion,
//     tambien una anidada, o desde fuera de toda transaccion), devuelve una promesa rechazada con un `Error` y no envia nada a la base,
//     aunque la transaccion siga abierta;
//   - dentro de `trabajo` siguen funcionando las formas normales de concurrencia, porque heredan el contexto: `Promise.all`, funciones
//     `async` llamadas desde `trabajo`, `setTimeout`, `setImmediate`, `queueMicrotask` y eventos emitidos desde `trabajo` (las pruebas
//     de los criterios 24 y 106 siguen pasando);
//   - lo de los criterios 106 y 112 no cambia (despues de terminar `trabajo` rechaza con un `Error`; con argumentos no admitidos, con
//     `TypeError`).
// Prueba de integracion con DATABASE_POOL_MAX=2, los datos de `crearDatosDeAislamiento` y un servicio de prueba (una instancia de una
// clase con un campo), cuyo metodo `primera` llama a `conAcademia(A, ...)`, guarda `tx` en `this.tx`, avisa y espera una barrera; y
// cuyo metodo `segunda`, llamado a la vez, dentro de `conAcademia(B, ...)` y despues del aviso (con la transaccion de A todavia
// abierta), usa `this.tx.cliente` con `$queryRaw` (lectura), `$executeRaw` (un INSERT con una clave nueva), un delegado de lectura y
// otro de escritura; y lo mismo desde `comoPlataforma` y desde el cuerpo de la prueba, fuera de toda transaccion. Cada llamada rechaza
// con un `Error` y no devuelve filas; cuando las dos transacciones terminan, las filas que esas llamadas intentaron escribir no existen
// (leidas como dueno con `pg`); y la transaccion de A termina bien, con sus propias consultas dentro de `trabajo` funcionando. Ademas,
// dentro de `conAcademia(A, ...)` con un `conAcademia(B, ...)` anidado (el plan pide no anidar, nota O1), usar el `tx` de A dentro del
// `trabajo` de B rechaza. Se prueba tambien con una transaccion de plataforma guardada (`comoPlataforma`).

type TxGuardada = TransaccionAcademiaRonda3 | TransaccionPlataformaRonda3;
type Operacion = (argumentos?: object) => unknown;
interface ClienteAmplio {
  $queryRaw(partes: TemplateStringsArray, ...valores: unknown[]): unknown;
  $executeRaw(partes: TemplateStringsArray, ...valores: unknown[]): unknown;
}

interface Ataque {
  readonly nombre: string;
  readonly ejecutar: () => unknown;
}

interface Resultado {
  readonly nombre: string;
  /** Lo que lanzo la llamada de forma sincrona (debe ser nada: se espera una promesa rechazada). */
  readonly sincrono?: unknown;
  readonly resolvio: boolean;
  readonly valor?: unknown;
  readonly rechazo?: unknown;
  readonly esPromesa: boolean;
}

/** Las cuatro llamadas del criterio 134 con el cliente de una transaccion de academia (lectura, INSERT, delegado de lectura y de escritura). */
function ataquesDeAcademia(cliente: ClienteAmplio, academiaId: string, marca: string): Ataque[] {
  const delegado = (nombre: string): Record<string, Operacion> =>
    (cliente as unknown as Record<string, Record<string, Operacion>>)[nombre] ?? {};
  return [
    {
      nombre: '$queryRaw (lectura de auditoria)',
      ejecutar: () => cliente.$queryRaw`SELECT id::text AS id FROM auditoria`,
    },
    {
      nombre: '$executeRaw (INSERT en configuraciones)',
      ejecutar: () =>
        cliente.$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
          VALUES (${academiaId}::uuid, ${`${marca}_sql`}, '{}'::jsonb, now())`,
    },
    { nombre: 'delegado de lectura (auditoria.findMany)', ejecutar: () => delegado('auditoria')['findMany']?.() },
    {
      nombre: 'delegado de escritura (configuracion.create)',
      ejecutar: () => delegado('configuracion')['create']?.({ data: { academiaId, clave: `${marca}_del`, valor: {} } }),
    },
  ];
}

/** Lo mismo con el cliente de una transaccion de plataforma (sobre `academias`, la tabla que la plataforma escribe). */
function ataquesDePlataforma(cliente: ClienteAmplio, marca: string): Ataque[] {
  const delegado = (nombre: string): Record<string, Operacion> =>
    (cliente as unknown as Record<string, Record<string, Operacion>>)[nombre] ?? {};
  const corto = (sufijo: string): string => `${marca.replace('_', '-')}-${sufijo}`;
  return [
    {
      nombre: '$queryRaw (lectura de academias)',
      ejecutar: () => cliente.$queryRaw`SELECT id::text AS id FROM academias`,
    },
    {
      nombre: '$executeRaw (INSERT en academias)',
      ejecutar: () =>
        cliente.$executeRaw`INSERT INTO academias (nombre, nombre_corto) VALUES (${`Robada ${marca} sql`}, ${corto('sql')})`,
    },
    { nombre: 'delegado de lectura (academia.findMany)', ejecutar: () => delegado('academia')['findMany']?.() },
    {
      nombre: 'delegado de escritura (academia.create)',
      ejecutar: () =>
        delegado('academia')['create']?.({ data: { nombre: `Robada ${marca} del`, nombreCorto: corto('del') } }),
    },
  ];
}

/** Ejecuta las llamadas una tras otra y devuelve lo que paso con cada una (si lanzo, si resolvio o si rechazo). */
async function ejecutarAtaques(ataques: readonly Ataque[]): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  for (const { nombre, ejecutar } of ataques) {
    let promesa: unknown;
    try {
      promesa = ejecutar();
    } catch (sincrono) {
      resultados.push({ nombre, sincrono, resolvio: false, esPromesa: false });
      continue;
    }
    const esPromesa = typeof (promesa as { then?: unknown } | null)?.then === 'function';
    try {
      const valor = await promesa;
      resultados.push({ nombre, resolvio: true, valor, esPromesa });
    } catch (rechazo) {
      resultados.push({ nombre, resolvio: false, rechazo, esPromesa });
    }
  }
  return resultados;
}

function esperarQueRechacenTodas(resultados: readonly Resultado[]): void {
  expect(resultados.length).toBe(4);
  const incumplimientos: string[] = [];
  for (const r of resultados) {
    if (r.sincrono !== undefined)
      incumplimientos.push(`${r.nombre}: lanzo de forma sincrona en vez de devolver una promesa rechazada`);
    else if (!r.esPromesa) incumplimientos.push(`${r.nombre}: no devolvio una promesa`);
    else if (r.resolvio)
      incumplimientos.push(
        `${r.nombre}: respondio (${JSON.stringify(r.valor)}) usando la transaccion de otro contexto`,
      );
    else if (!(r.rechazo instanceof Error)) incumplimientos.push(`${r.nombre}: rechazo con algo que no es un Error`);
  }
  expect(incumplimientos, 'cada llamada con la transaccion de otro contexto debe rechazar con un Error').toEqual([]);
}

/** Una sola instancia, como un servicio de Nest, con un campo donde (mal) se guarda la transaccion. */
class ServicioDePrueba {
  tx: TxGuardada | undefined;
  constructor(private readonly baseDatos: BaseDatosRonda3) {}

  /** `conAcademia(A)` o `comoPlataforma`: guarda `tx` en `this.tx`, avisa, espera la barrera y hace una consulta propia. */
  primera(
    guardada: 'academia' | 'plataforma',
    academiaId: string,
    avisar: () => void,
    barrera: Promise<void>,
  ): Promise<number> {
    const trabajo = async (tx: TxGuardada): Promise<number> => {
      this.tx = tx;
      avisar();
      await barrera;
      const filas =
        guardada === 'academia'
          ? await tx.cliente.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM auditoria`
          : await tx.cliente.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM academias`;
      return filas[0]?.n ?? -1;
    };
    return guardada === 'academia'
      ? this.baseDatos.conAcademia(academiaId, trabajo)
      : this.baseDatos.comoPlataforma(trabajo);
  }

  /** Dentro de otra transaccion, despues del aviso, usa `this.tx.cliente`. */
  segunda(
    donde: 'otra-academia' | 'plataforma',
    academiaId: string,
    aviso: Promise<void>,
    ataques: () => readonly Ataque[],
  ): Promise<Resultado[]> {
    const trabajo = async (): Promise<Resultado[]> => {
      await aviso;
      return ejecutarAtaques(ataques());
    };
    return donde === 'otra-academia'
      ? this.baseDatos.conAcademia(academiaId, trabajo)
      : this.baseDatos.comoPlataforma(trabajo);
  }
}

describe('criterio 134: el envoltorio solo responde en el contexto de su trabajo', () => {
  let app: NestExpressApplication | undefined;
  let baseDatos: BaseDatosRonda3;
  let datos: DatosDeAislamiento;
  let marca: string;

  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
    marca = `tg134_${randomBytes(4).toString('hex')}`;
    app = await crearAppDePruebas({ nivelRegistro: 'silent', variables: { DATABASE_POOL_MAX: '2' } });
    baseDatos = await obtenerBaseDatosRonda3(app);
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  /** Claves de `configuraciones` y nombres cortos de academias que las llamadas de la prueba intentaron escribir. */
  async function filasEscritas(): Promise<string[]> {
    const encontradas: string[] = [];
    for (const academia of [datos.A, datos.B]) {
      const { rows } = await ejecutarComo(
        'propietario',
        'SELECT clave FROM configuraciones WHERE academia_id = $1::uuid AND clave LIKE $2',
        [academia.id, `${marca}%`],
        { academiaId: academia.id },
      );
      encontradas.push(...rows.map((fila: { clave: string }) => `configuraciones:${fila.clave}`));
    }
    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT nombre_corto FROM academias WHERE nombre_corto LIKE $1',
      [`${marca.replace('_', '-')}%`],
      { plataforma: true },
    );
    encontradas.push(...rows.map((fila: { nombre_corto: string }) => `academias:${fila.nombre_corto}`));
    return encontradas;
  }

  const GUARDADAS = [
    ['conAcademia(A)', 'academia'],
    ['comoPlataforma', 'plataforma'],
  ] as const;
  const USOS = [
    ['conAcademia(B) de otra peticion', 'otra-academia'],
    ['comoPlataforma de otra peticion', 'plataforma'],
    ['el cuerpo de la prueba, fuera de toda transaccion', 'cuerpo'],
  ] as const;

  describe.each(GUARDADAS)('la transaccion guardada viene de %s', (_nombre, guardada) => {
    it.each(USOS)(
      'criterio 134: usada desde %s, con la transaccion todavia abierta, cada llamada rechaza con un Error y no escribe nada',
      async (_uso, uso) => {
        const servicio = new ServicioDePrueba(baseDatos);
        let avisar!: () => void;
        const aviso = new Promise<void>((resolver) => (avisar = resolver));
        let soltar!: () => void;
        const barrera = new Promise<void>((resolver) => (soltar = resolver));
        const ataques = (): readonly Ataque[] => {
          const cliente = servicio.tx?.cliente as unknown as ClienteAmplio | undefined;
          if (!cliente) throw new Error('La prueba no guardo la transaccion.');
          return guardada === 'academia'
            ? ataquesDeAcademia(cliente, datos.A.id, marca)
            : ataquesDePlataforma(cliente, marca);
        };

        const primera = servicio.primera(guardada, datos.A.id, avisar, barrera);
        let resultados: Resultado[];
        try {
          if (uso === 'cuerpo') {
            await aviso;
            resultados = await ejecutarAtaques(ataques());
          } else {
            resultados = await servicio.segunda(uso, datos.B.id, aviso, ataques);
          }
        } finally {
          soltar();
        }
        const propias = await primera;

        esperarQueRechacenTodas(resultados);
        expect(propias, 'la transaccion que guardo tx debe terminar bien, con sus propias consultas funcionando').toBe(
          guardada === 'academia' ? datos.filas.auditoriaA : 2,
        );
        expect(await filasEscritas(), 'las filas que las llamadas intentaron escribir no deben existir').toEqual([]);
      },
    );
  });

  it('criterio 134: dentro de conAcademia(A) con un conAcademia(B) anidado, usar el tx de A dentro del trabajo de B rechaza', async () => {
    let resultados: Resultado[] = [];
    let propiaDeB = -1;
    const propiaDeA = await baseDatos.conAcademia(datos.A.id, async (txA) => {
      await baseDatos.conAcademia(datos.B.id, async (txB) => {
        resultados = await ejecutarAtaques(ataquesDeAcademia(txA.cliente, datos.A.id, marca));
        const filas = await txB.cliente.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM auditoria`;
        propiaDeB = filas[0]?.n ?? -1;
      });
      const filas = await txA.cliente.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM auditoria`;
      return filas[0]?.n ?? -1;
    });

    esperarQueRechacenTodas(resultados);
    expect(propiaDeB, 'la transaccion anidada de B funciona con su propio cliente').toBe(datos.filas.auditoriaB);
    expect(propiaDeA, 'la transaccion de A funciona con su propio cliente despues de la anidada').toBe(
      datos.filas.auditoriaA,
    );
    expect(await filasEscritas()).toEqual([]);
  });

  describe('criterio 134 (control): dentro de trabajo siguen funcionando las formas normales de concurrencia', () => {
    const lectura = (tx: TransaccionAcademiaRonda3) => async (): Promise<number> => {
      const filas = await tx.cliente.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM auditoria`;
      return filas[0]?.n ?? -1;
    };

    it('criterio 134: Promise.all y funciones async llamadas desde trabajo usan el tx de trabajo', async () => {
      const [a, b, c] = await baseDatos.conAcademia(datos.A.id, async (tx) => {
        const leer = lectura(tx);
        const anidada = async (): Promise<number> => (await leer()) + 0;
        return Promise.all([leer(), leer(), anidada()]);
      });

      expect([a, b, c]).toEqual([datos.filas.auditoriaA, datos.filas.auditoriaA, datos.filas.auditoriaA]);
    });

    it('criterio 134: setTimeout, setImmediate y queueMicrotask llamados desde trabajo usan el tx de trabajo', async () => {
      const resultado = await baseDatos.conAcademia(datos.A.id, async (tx) => {
        const leer = lectura(tx);
        const desde = (programar: (alto: () => void) => void): Promise<number> =>
          new Promise<number>((resolver, rechazar) => programar(() => void leer().then(resolver, rechazar)));
        return {
          timeout: await desde((alto) => void setTimeout(alto, 5)),
          inmediato: await desde((alto) => void setImmediate(alto)),
          microtarea: await desde((alto) => queueMicrotask(alto)),
        };
      });

      expect(resultado).toEqual({
        timeout: datos.filas.auditoriaA,
        inmediato: datos.filas.auditoriaA,
        microtarea: datos.filas.auditoriaA,
      });
    });

    it('criterio 134: un evento emitido desde trabajo ejecuta su escucha con el tx de trabajo', async () => {
      const resultado = await baseDatos.conAcademia(datos.A.id, async (tx) => {
        const leer = lectura(tx);
        const emisor = new EventEmitter();
        const escuchado = new Promise<number>((resolver, rechazar) => {
          emisor.once('listo', () => void leer().then(resolver, rechazar));
        });
        emisor.emit('listo');
        return escuchado;
      });

      expect(resultado).toBe(datos.filas.auditoriaA);
    });

    it('criterio 134: dos conAcademia simultaneas (A y B) cada una con su propio tx, sin mezclarse', async () => {
      const [deA, deB] = await Promise.all([
        baseDatos.conAcademia(datos.A.id, async (tx) => {
          await new Promise((resolver) => setTimeout(resolver, 20));
          return lectura(tx)();
        }),
        baseDatos.conAcademia(datos.B.id, async (tx) => {
          await new Promise((resolver) => setTimeout(resolver, 5));
          return lectura(tx)();
        }),
      ]);

      expect(deA).toBe(datos.filas.auditoriaA);
      expect(deB).toBe(datos.filas.auditoriaB);
    });
  });
});
