// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { obtenerBaseDatos } from '../../utilidades/modulos';

// Criterio 86 (ataque ronda 2, F3): `BaseDatos` no entrega el cliente de Prisma en tiempo de ejecucion. Dada la API de
// pruebas y `const b = app.get(BaseDatos)`, ni `b['prisma']`, ni ningun valor de `Reflect.ownKeys(b)` (propiedades propias,
// enumerables o no, y simbolos), ni ningun getter de su prototipo, ni las propiedades propias de esos valores (un nivel
// mas) es un objeto con alguna de las funciones $transaction, $queryRaw, $queryRawUnsafe, $executeRaw, $executeRawUnsafe
// o $connect. `BaseDatos` guarda el cliente en un campo privado real de JavaScript (#...), no en una propiedad con
// `private` de TypeScript: eso no se puede observar mas que por su ausencia.

const FUNCIONES_DEL_CLIENTE = [
  '$transaction',
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
  '$connect',
] as const;

/** ¿Es un objeto (o funcion) con alguna de las funciones del cliente de la base, propia o heredada? */
function pareceClienteDeLaBase(valor: unknown): boolean {
  if ((typeof valor !== 'object' && typeof valor !== 'function') || valor === null) return false;
  return FUNCIONES_DEL_CLIENTE.some((nombre) => {
    try {
      return typeof (valor as Record<string, unknown>)[nombre] === 'function';
    } catch {
      return false;
    }
  });
}

/** Lee una propiedad sin que un getter que lance rompa la inspeccion. */
function leer(objeto: object, clave: PropertyKey): { valor: unknown; leido: boolean } {
  try {
    return { valor: Reflect.get(objeto, clave, objeto) as unknown, leido: true };
  } catch {
    return { valor: undefined, leido: false };
  }
}

/** Claves de las propiedades propias (enumerables o no, y simbolos) de un valor que sea objeto o funcion. */
function clavesPropias(valor: unknown): PropertyKey[] {
  if ((typeof valor !== 'object' && typeof valor !== 'function') || valor === null) return [];
  return Reflect.ownKeys(valor);
}

/** Nombres de los getters de la cadena de prototipos (hasta antes de Object.prototype). */
function gettersDelPrototipo(objeto: object): PropertyKey[] {
  const claves: PropertyKey[] = [];
  let prototipo: object | null = Object.getPrototypeOf(objeto) as object | null;
  while (prototipo !== null && prototipo !== Object.prototype) {
    for (const clave of Reflect.ownKeys(prototipo)) {
      if (Object.getOwnPropertyDescriptor(prototipo, clave)?.get) claves.push(clave);
    }
    prototipo = Object.getPrototypeOf(prototipo) as object | null;
  }
  return claves;
}

/**
 * Rutas (para el mensaje de error) de todo lo que la inspeccion del criterio 86 encuentra y parece el cliente de la base:
 * `b['prisma']`, cada valor de Reflect.ownKeys(b), cada getter del prototipo y las propiedades propias de esos valores.
 */
function accesosAlCliente(b: object): string[] {
  const encontrados: string[] = [];
  const revisarValor = (ruta: string, valor: unknown): void => {
    if (pareceClienteDeLaBase(valor)) encontrados.push(ruta);
    if (typeof valor === 'object' || typeof valor === 'function') {
      if (valor === null) return;
      for (const clave of clavesPropias(valor)) {
        const { valor: interno, leido } = leer(valor, clave);
        if (leido && pareceClienteDeLaBase(interno)) encontrados.push(`${ruta} -> ${String(clave)}`);
      }
    }
  };

  const { valor: prisma } = leer(b, 'prisma');
  revisarValor("b['prisma']", prisma);
  for (const clave of Reflect.ownKeys(b)) {
    const { valor, leido } = leer(b, clave);
    if (leido) revisarValor(`propiedad propia ${String(clave)}`, valor);
  }
  for (const clave of gettersDelPrototipo(b)) {
    const { valor, leido } = leer(b, clave);
    if (leido) revisarValor(`getter ${String(clave)}`, valor);
  }
  return encontrados;
}

describe('criterio 86: la inspeccion detecta un cliente (control de la propia prueba)', () => {
  it('criterio 86 (control): un objeto con $transaction se reconoce como cliente de la base', () => {
    expect(pareceClienteDeLaBase({ $transaction: () => Promise.resolve() })).toBe(true);
    expect(pareceClienteDeLaBase(Object.create({ $queryRaw: () => Promise.resolve([]) }))).toBe(true);
  });

  it('criterio 86 (control): se detecta un cliente a un nivel de profundidad y en un getter', () => {
    const cliente = { $connect: () => Promise.resolve() };
    class ConCampo {
      envoltorio = { dentro: cliente };
    }
    class ConGetter {
      get cliente(): unknown {
        return cliente;
      }
    }

    expect(accesosAlCliente(new ConCampo())).toHaveLength(1);
    expect(accesosAlCliente(new ConGetter())).toHaveLength(1);
  });

  it('criterio 86 (control): un objeto sin nada del cliente no se marca', () => {
    class Limpio {
      readonly #secreto = { $transaction: () => Promise.resolve() };
      leer(): boolean {
        return typeof this.#secreto.$transaction === 'function';
      }
    }

    expect(accesosAlCliente(new Limpio())).toEqual([]);
  });
});

describe('criterio 86: BaseDatos de la aplicacion de pruebas', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it("criterio 86: b['prisma'] no es un objeto con las funciones del cliente", async () => {
    const baseDatos = await obtenerBaseDatos(app);

    expect(pareceClienteDeLaBase((baseDatos as unknown as Record<string, unknown>)['prisma'])).toBe(false);
  });

  it('criterio 86: ninguna propiedad propia (enumerable o no, ni simbolo) ni getter entrega el cliente, a un nivel de profundidad', async () => {
    const baseDatos = await obtenerBaseDatos(app);

    expect(accesosAlCliente(baseDatos)).toEqual([]);
  });

  it('criterio 86: BaseDatos sigue funcionando (el cliente esta en un campo privado, no ausente)', async () => {
    const baseDatos = await obtenerBaseDatos(app);

    await expect(baseDatos.comprobarConexion()).resolves.toBeUndefined();
  });
});
