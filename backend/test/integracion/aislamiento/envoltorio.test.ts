// spec: 001-academias-aislamiento (pruebas protegidas)
import { ModuleRef, ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { limpiarBase } from '../../utilidades/base-datos';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { cargarPrisma } from '../../utilidades/modulos';
import {
  cargarFuncionalidad,
  intentar,
  obtenerBaseDatosRonda3,
  Prisma,
  type BaseDatosRonda3,
} from '../../utilidades/ronda3';

// Criterio 100 (ataque ronda 3, F5; complementa los criterios 28 y 86): `trabajo` recibe un envoltorio, no el cliente. Dada la API
// de pruebas:
//   - dentro de `trabajo` de `conAcademia` y de `comoPlataforma`, `tx.cliente` es un objeto armado por `BaseDatos` (envoltorio)
//     que solo tiene `$queryRaw`, `$executeRaw` y un objeto por cada modelo de Prisma con sus operaciones (`findMany`,
//     `create`, ...); `$queryRaw` y `$executeRaw` funcionan como etiqueta de plantilla y con `Prisma.sql`, y todo corre en la
//     misma transaccion;
//   - `tx.cliente.$parent`, `._originalClient`, `.$transaction`, `.$queryRawUnsafe`, `.$executeRawUnsafe`, `.$connect`,
//     `.$disconnect`, `.$on` y `.$extends` son `undefined`;
//   - recorriendo `tx`, `tx.cliente`, sus propiedades propias y las propiedades propias de cada una (con `Reflect.ownKeys`:
//     enumerables o no, y simbolos; los getters se leen), ningun valor es un objeto o funcion con alguna de las propiedades
//     `$transaction`, `$queryRawUnsafe`, `$executeRawUnsafe`, `$connect`, `$disconnect`, `$on`, `$extends`, `$parent` o
//     `_originalClient`; ninguna clave empieza por `_`; y el prototipo de cada objeto recorrido es `Object.prototype`,
//     `Function.prototype` o `null`;
//   - el cliente de Prisma no es un proveedor de Nest: recorriendo todos los modulos del contenedor (`app.get(ModulesContainer)`,
//     sus `providers` y la `instance` de cada uno) y los `providers` de los metadatos de cada modulo
//     (`Reflect.getMetadata('providers', ...)`, incluido `PrismaModule`), ni la instancia, ni `app.get(token, { strict: false })`,
//     ni `moduleRef.get(token, { strict: false })` es, para ningun token, un objeto con las funciones `$transaction` o
//     `$queryRawUnsafe`, ni uno que las tenga en una propiedad propia (un nivel); y
//     `Reflect.getMetadata('design:paramtypes', BaseDatos)` no contiene una clase cuyo prototipo tenga `$transaction`;
//   - los metodos de `BaseDatos` que usan el cliente sin envoltorio son privados reales (`#...`); `BaseDatos.prototype` esta
//     congelado (`Object.isFrozen`) y sus claves propias son solo `constructor`, `conAcademia`, `comoPlataforma`,
//     `resolverAcademia`, `comprobarConexion` y, si existe, `onModuleDestroy`.

const PROHIBIDAS = [
  '$transaction',
  '$queryRawUnsafe',
  '$executeRawUnsafe',
  '$connect',
  '$disconnect',
  '$on',
  '$extends',
  '$parent',
  '_originalClient',
] as const;

const SOLO_CLIENTE = ['$transaction', '$queryRawUnsafe'] as const;

/** Lee una propiedad sin que un getter que lance rompa la inspeccion. */
function leer(objeto: object, clave: PropertyKey): { valor: unknown; leido: boolean } {
  try {
    return { valor: Reflect.get(objeto, clave, objeto) as unknown, leido: true };
  } catch {
    return { valor: undefined, leido: false };
  }
}

function esObjeto(valor: unknown): valor is object {
  return (typeof valor === 'object' || typeof valor === 'function') && valor !== null;
}

function tiene(valor: object, nombre: string): boolean {
  try {
    return nombre in valor;
  } catch {
    return false;
  }
}

/**
 * Recorre `raices`, los valores de sus propiedades propias (enumerables o no, y simbolos) y los valores de las propiedades propias
 * de esos (criterio 100) y devuelve lo que incumple: propiedades prohibidas, claves que empiezan por `_` y prototipos que no son
 * `Object.prototype`, `Function.prototype` ni `null`.
 */
function incumplimientos(raices: Record<string, object>): string[] {
  const problemas: string[] = [];
  const vistos = new Set<object>();
  const permitidos = new Set<object | null>([Object.prototype, Function.prototype, null]);

  const revisar = (ruta: string, valor: object): void => {
    if (vistos.has(valor)) return;
    vistos.add(valor);
    for (const nombre of PROHIBIDAS) {
      if (tiene(valor, nombre)) problemas.push(`${ruta} tiene la propiedad ${nombre}`);
    }
    if (!permitidos.has(Object.getPrototypeOf(valor) as object | null)) {
      problemas.push(`${ruta} tiene un prototipo que no es Object.prototype, Function.prototype ni null`);
    }
    for (const clave of Reflect.ownKeys(valor)) {
      if (typeof clave === 'string' && clave.startsWith('_')) problemas.push(`${ruta} tiene la clave ${clave}`);
    }
  };

  for (const [nombre, raiz] of Object.entries(raices)) {
    revisar(nombre, raiz);
    for (const clave of Reflect.ownKeys(raiz)) {
      const { valor: nivel1, leido } = leer(raiz, clave);
      if (!leido || !esObjeto(nivel1)) continue;
      const ruta1 = `${nombre}.${String(clave)}`;
      revisar(ruta1, nivel1);
      for (const clave2 of Reflect.ownKeys(nivel1)) {
        const { valor: nivel2, leido: leido2 } = leer(nivel1, clave2);
        if (leido2 && esObjeto(nivel2)) revisar(`${ruta1}.${String(clave2)}`, nivel2);
      }
    }
  }
  return problemas;
}

const minuscula = (nombre: string): string => `${nombre.charAt(0).toLowerCase()}${nombre.slice(1)}`;

describe('criterio 100: la inspeccion detecta un cliente (control de la propia prueba)', () => {
  it.each(PROHIBIDAS)('criterio 100 (control): un objeto con %s se marca', (nombre) => {
    expect(incumplimientos({ x: { [nombre]: () => undefined } })).not.toEqual([]);
  });

  it('criterio 100 (control): se detecta a un nivel y a dos niveles de profundidad, en un getter y en una propiedad no enumerable', () => {
    const cliente = { $transaction: () => undefined };
    // Las raices son los objetos de `tx` y `tx.cliente`; sus propiedades son el nivel 1 y las de estas el nivel 2.
    const unNivel = { dentro: cliente };
    const dosNiveles = { medio: { dentro: cliente } };
    const conGetter = Object.defineProperty({}, 'oculto', { get: () => cliente, enumerable: false });
    const conSimbolo = { [Symbol('cliente')]: cliente };

    for (const [nombre, raiz] of Object.entries({ unNivel, dosNiveles, conGetter, conSimbolo })) {
      expect(incumplimientos({ raiz }), nombre).not.toEqual([]);
    }
  });

  it('criterio 100 (control): se marcan una clave que empieza por _ y un prototipo que no es Object.prototype', () => {
    class Otra {
      campo = 1;
    }
    expect(incumplimientos({ x: { _privado: 1 } })).not.toEqual([]);
    expect(incumplimientos({ x: new Otra() })).not.toEqual([]);
    expect(incumplimientos({ x: { y: Object.create({ heredada: 1 }) as object } })).not.toEqual([]);
  });

  it('criterio 100 (control): un objeto plano, una funcion flecha y un objeto sin prototipo no se marcan', () => {
    expect(
      incumplimientos({
        x: { $queryRaw: () => 1, modelo: { findMany: () => 1 }, nulo: Object.create(null) as object },
      }),
    ).toEqual([]);
  });
});

describe('criterio 100: el envoltorio de trabajo', () => {
  let app: NestExpressApplication;
  let baseDatos: BaseDatosRonda3;
  let datos: DatosDeAislamiento;

  beforeAll(async () => {
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    baseDatos = await obtenerBaseDatosRonda3(app);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
  });

  const modelos = Object.values(Prisma.ModelName).map(minuscula);

  /** Ejecuta `inspeccionar` con la transaccion de `conAcademia(B)` y con la de `comoPlataforma`. */
  async function enAmbas<T>(
    inspeccionar: (tx: { cliente: unknown }) => T | Promise<T>,
  ): Promise<{ academia: T; plataforma: T }> {
    const academia = await baseDatos.conAcademia(datos.B.id, async (tx) => inspeccionar(tx));
    const plataforma = await baseDatos.comoPlataforma(async (tx) => inspeccionar(tx));
    return { academia, plataforma };
  }

  describe('criterio 100: que tiene el envoltorio', () => {
    it('criterio 100: solo tiene $queryRaw, $executeRaw y un objeto por cada modelo de Prisma', async () => {
      const claves = await enAmbas((tx) =>
        Reflect.ownKeys(tx.cliente as object)
          .map(String)
          .sort(),
      );

      const esperadas = ['$queryRaw', '$executeRaw', ...modelos].sort();
      expect(claves.academia).toEqual(esperadas);
      expect(claves.plataforma).toEqual(esperadas);
    });

    it('criterio 100: cada modelo tiene sus operaciones (findMany, findFirst, findUnique, create, update, delete, count...) como funciones', async () => {
      const operaciones = await enAmbas((tx) =>
        modelos.map((modelo) => {
          const delegado = (tx.cliente as Record<string, Record<string, unknown>>)[modelo] ?? {};
          const faltan = [
            'findMany',
            'findFirst',
            'findUnique',
            'create',
            'createMany',
            'update',
            'updateMany',
            'upsert',
            'delete',
            'deleteMany',
            'count',
            'aggregate',
            'groupBy',
          ].filter((nombre) => typeof delegado[nombre] !== 'function');
          return `${modelo}: faltan ${faltan.join(', ') || 'ninguna'}`;
        }),
      );

      expect(operaciones.academia).toEqual(modelos.map((modelo) => `${modelo}: faltan ninguna`));
      expect(operaciones.plataforma).toEqual(modelos.map((modelo) => `${modelo}: faltan ninguna`));
    });

    it.each([
      '$parent',
      '_originalClient',
      '$transaction',
      '$queryRawUnsafe',
      '$executeRawUnsafe',
      '$connect',
      '$disconnect',
      '$on',
      '$extends',
    ])('criterio 100: tx.cliente.%s es undefined', async (nombre) => {
      // Se compara el tipo y no el valor: si existiera, el mensaje de error intentaria imprimir todo el cliente.
      const tipos = await enAmbas((tx) => typeof (tx.cliente as Record<string, unknown>)[nombre]);

      expect(tipos.academia).toBe('undefined');
      expect(tipos.plataforma).toBe('undefined');
    });

    it('criterio 100: recorriendo tx, tx.cliente y sus propiedades (dos niveles) no hay cliente, claves con _ ni prototipos raros', async () => {
      const problemas = await enAmbas((tx) => incumplimientos({ tx, 'tx.cliente': tx.cliente as object }));

      expect(problemas.academia).toEqual([]);
      expect(problemas.plataforma).toEqual([]);
    });
  });

  describe('criterio 100: el envoltorio funciona', () => {
    it('criterio 100: $queryRaw como etiqueta de plantilla, con un valor interpolado', async () => {
      const filas = await baseDatos.conAcademia(
        datos.B.id,
        (tx) => tx.cliente.$queryRaw<{ n: number }[]>`SELECT ${7}::int AS n`,
      );

      expect(filas).toEqual([{ n: 7 }]);
    });

    it('criterio 100: $queryRaw con Prisma.sql', async () => {
      const filas = await baseDatos.comoPlataforma((tx) =>
        tx.cliente.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT ${9}::int AS n`),
      );

      expect(filas).toEqual([{ n: 9 }]);
    });

    it('criterio 100: $executeRaw como etiqueta y con Prisma.sql devuelven la cantidad de filas', async () => {
      const resultado = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const comoEtiqueta = await tx.cliente
          .$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${datos.B.id}::uuid, 'envoltorio_etiqueta', '{}'::jsonb)`;
        const conSql = await tx.cliente.$executeRaw(
          Prisma.sql`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${datos.B.id}::uuid, 'envoltorio_sql', '{}'::jsonb)`,
        );
        return { comoEtiqueta, conSql };
      });

      expect(resultado).toEqual({ comoEtiqueta: 1, conSql: 1 });
    });

    it('criterio 100: $queryRaw, $executeRaw y las operaciones de los modelos corren en la misma transaccion', async () => {
      const resultado = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const cliente = tx.cliente as unknown as {
          configuracion: {
            findMany(args: object): Promise<{ clave: string }[]>;
            count(args?: object): Promise<number>;
          };
        };
        const transaccionAntes = (await tx.cliente.$queryRaw<{ id: string }[]>`SELECT txid_current()::text AS id`)[0]
          ?.id;
        await tx.cliente
          .$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${datos.B.id}::uuid, 'misma_transaccion', '{}'::jsonb)`;
        const delModelo = await cliente.configuracion.findMany({ where: { clave: 'misma_transaccion' } });
        const total = await cliente.configuracion.count();
        const transaccionDespues = (await tx.cliente.$queryRaw<{ id: string }[]>`SELECT txid_current()::text AS id`)[0]
          ?.id;
        return { mismaTransaccion: transaccionAntes === transaccionDespues, delModelo: delModelo.length, total };
      });

      expect(resultado).toEqual({ mismaTransaccion: true, delModelo: 1, total: datos.filas.configuracionesB + 1 });
    });

    it('criterio 100: si trabajo falla, todo lo que hizo con el envoltorio se revierte', async () => {
      const error = await intentar(() =>
        baseDatos.conAcademia(datos.B.id, async (tx) => {
          await tx.cliente
            .$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor) VALUES (${datos.B.id}::uuid, 'se_revierte', '{}'::jsonb)`;
          throw new Error('falla a proposito');
        }),
      );

      expect(error).toBeInstanceOf(Error);
      const filas = await baseDatos.conAcademia(
        datos.B.id,
        (tx) =>
          tx.cliente.$queryRaw<
            { n: number }[]
          >`SELECT count(*)::int AS n FROM configuraciones WHERE clave = 'se_revierte'`,
      );
      expect(filas).toEqual([{ n: 0 }]);
    });

    it('criterio 100: las operaciones de los modelos respetan la seguridad por fila (conAcademia ve solo su academia; comoPlataforma ve todas)', async () => {
      const vistas = await enAmbas(async (tx) => {
        const cliente = tx.cliente as {
          academia: { findMany(args?: object): Promise<{ id: string }[]> };
          configuracion: { findMany(args?: object): Promise<{ academiaId: string }[]> };
        };
        return {
          academias: (await cliente.academia.findMany()).map((fila) => fila.id).sort(),
          configuraciones: (await cliente.configuracion.findMany()).length,
        };
      });

      expect(vistas.academia).toEqual({ academias: [datos.B.id], configuraciones: datos.filas.configuracionesB });
      expect(vistas.plataforma).toEqual({ academias: [datos.A.id, datos.B.id].sort(), configuraciones: 0 });
    });

    it('criterio 100: create de un modelo dentro de conAcademia respeta la academia del contexto (otra academia falla con 42501)', async () => {
      const cliente = (tx: { cliente: unknown }) =>
        tx.cliente as { configuracion: { create(args: object): Promise<{ clave: string }> } };

      const propia = await baseDatos.conAcademia(datos.B.id, (tx) =>
        cliente(tx).configuracion.create({
          data: { academiaId: datos.B.id, clave: 'creada_con_el_modelo', valor: {} },
        }),
      );
      const ajena = await intentar(() =>
        baseDatos.conAcademia(datos.B.id, (tx) =>
          cliente(tx).configuracion.create({ data: { academiaId: datos.A.id, clave: 'de_otra_academia', valor: {} } }),
        ),
      );

      expect(propia.clave).toBe('creada_con_el_modelo');
      expect(ajena, 'insertar con la academia A en el contexto de B debia fallar').toBeDefined();
    });
  });

  describe('criterio 100: el cliente de Prisma no es un proveedor de Nest', () => {
    const tieneLasFunciones = (valor: unknown): boolean => {
      if (!esObjeto(valor)) return false;
      return SOLO_CLIENTE.some((nombre) => {
        try {
          return typeof (valor as Record<string, unknown>)[nombre] === 'function';
        } catch {
          return false;
        }
      });
    };

    /** ¿Es el cliente o tiene el cliente en una propiedad propia (un nivel)? */
    const pareceOTieneElCliente = (valor: unknown): string | null => {
      if (tieneLasFunciones(valor)) return 'el valor mismo';
      if (!esObjeto(valor)) return null;
      for (const clave of Reflect.ownKeys(valor)) {
        const { valor: interno, leido } = leer(valor, clave);
        if (leido && tieneLasFunciones(interno)) return `la propiedad ${String(clave)}`;
      }
      return null;
    };

    const nombreDe = (token: unknown): string =>
      typeof token === 'function' ? token.name : typeof token === 'symbol' ? token.toString() : String(token);

    it('criterio 100: ninguna instancia de ningun proveedor de ningun modulo del contenedor es el cliente ni lo tiene en una propiedad propia', () => {
      const contenedor = app.get(ModulesContainer);
      const encontrados: string[] = [];

      for (const modulo of contenedor.values()) {
        for (const [token, proveedor] of modulo.providers) {
          const hallazgo = pareceOTieneElCliente(proveedor.instance);
          if (hallazgo) encontrados.push(`${nombreDe(modulo.metatype)} -> ${nombreDe(token)}: ${hallazgo}`);
        }
      }

      expect(encontrados).toEqual([]);
    });

    it('criterio 100: ningun token de ningun modulo devuelve el cliente con app.get(token, { strict: false })', () => {
      const contenedor = app.get(ModulesContainer);
      const encontrados: string[] = [];

      for (const modulo of contenedor.values()) {
        for (const token of modulo.providers.keys()) {
          let resultado: unknown;
          try {
            resultado = app.get(token as never, { strict: false });
          } catch {
            continue;
          }
          const hallazgo = pareceOTieneElCliente(resultado);
          if (hallazgo) encontrados.push(`${nombreDe(token)}: ${hallazgo}`);
        }
      }

      expect(encontrados).toEqual([]);
    });

    it('criterio 100: ningun token devuelve el cliente con moduleRef.get(token, { strict: false })', () => {
      const referencia = app.get(ModuleRef);
      const contenedor = app.get(ModulesContainer);
      const encontrados: string[] = [];

      for (const modulo of contenedor.values()) {
        for (const token of modulo.providers.keys()) {
          let resultado: unknown;
          try {
            resultado = referencia.get(token as never, { strict: false });
          } catch {
            continue;
          }
          const hallazgo = pareceOTieneElCliente(resultado);
          if (hallazgo) encontrados.push(`${nombreDe(token)}: ${hallazgo}`);
        }
      }

      expect(encontrados).toEqual([]);
    });

    it('criterio 100: los providers de los metadatos de cada modulo (incluido PrismaModule) no declaran una clase ni un valor que sea el cliente', async () => {
      const { PrismaModule } = await cargarFuncionalidad<{ PrismaModule: object }>('infraestructura/prisma/index.ts', [
        'PrismaModule',
      ]);
      const contenedor = app.get(ModulesContainer);
      const clases = new Set<object>([PrismaModule]);
      for (const modulo of contenedor.values()) clases.add(modulo.metatype);
      const encontrados: string[] = [];

      for (const clase of clases) {
        const declarados = (Reflect.getMetadata('providers', clase) ?? []) as unknown[];
        for (const declarado of declarados) {
          const candidato = declarado as {
            provide?: unknown;
            useClass?: unknown;
            useValue?: unknown;
            prototype?: unknown;
          };
          const piezas: unknown[] = [declarado, candidato.prototype, candidato.useClass, candidato.useValue];
          const pieza = piezas.find((valor) => tieneLasFunciones(valor));
          if (pieza !== undefined)
            encontrados.push(`${nombreDe(clase)} declara ${nombreDe(candidato.provide ?? declarado)}`);
        }
      }

      expect(encontrados).toEqual([]);
    });

    it('criterio 100: design:paramtypes de BaseDatos no contiene una clase cuyo prototipo tenga $transaction', async () => {
      const { BaseDatos } = await cargarPrisma();

      const tipos = (Reflect.getMetadata('design:paramtypes', BaseDatos) ?? []) as { prototype?: object }[];

      for (const tipo of tipos) {
        expect(
          tipo?.prototype !== undefined && '$transaction' in tipo.prototype,
          `un parametro del constructor es el cliente`,
        ).toBe(false);
      }
    });
  });

  describe('criterio 100: BaseDatos', () => {
    it('criterio 100: BaseDatos.prototype esta congelado', async () => {
      const { BaseDatos } = await cargarPrisma();

      expect(Object.isFrozen(BaseDatos.prototype)).toBe(true);
    });

    it('criterio 100: las claves propias de BaseDatos.prototype son solo constructor, conAcademia, comoPlataforma, resolverAcademia, comprobarConexion y onModuleDestroy', async () => {
      const { BaseDatos } = await cargarPrisma();

      const claves = Reflect.ownKeys(BaseDatos.prototype as object).map(String);

      const permitidas = [
        'constructor',
        'conAcademia',
        'comoPlataforma',
        'resolverAcademia',
        'comprobarConexion',
        'onModuleDestroy',
      ];
      expect(claves.filter((clave) => !permitidas.includes(clave))).toEqual([]);
      for (const obligatoria of permitidas.slice(0, 5)) expect(claves).toContain(obligatoria);
    });

    it('criterio 100: no se puede reemplazar ni agregar un metodo en BaseDatos.prototype', async () => {
      const { BaseDatos } = await cargarPrisma();
      const prototipo = BaseDatos.prototype as unknown as Record<string, unknown>;

      expect(Reflect.set(prototipo, 'conAcademia', () => Promise.resolve())).toBe(false);
      expect(Reflect.set(prototipo, 'metodoNuevo', () => 1)).toBe(false);
      expect(Reflect.defineProperty(prototipo, 'otroMetodo', { value: () => 1 })).toBe(false);
      expect(Reflect.deleteProperty(prototipo, 'comoPlataforma')).toBe(false);
    });

    it('criterio 100: BaseDatos sigue funcionando con el prototipo congelado', async () => {
      await expect(baseDatos.comprobarConexion()).resolves.toBeUndefined();
    });
  });
});
