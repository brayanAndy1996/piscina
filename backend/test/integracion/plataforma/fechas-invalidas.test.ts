// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerSuperadmin } from '../../utilidades/datos';
import { cargarPrisma, crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { textoDeConsulta } from '../../utilidades/ronda4';
import {
  CLAVE_SUPERADMIN_PRUEBAS,
  cookieDePlataforma,
  cookieDeSesion,
  crearSuperadminDePrueba,
  type SuperadminDePrueba,
} from '../../utilidades/superadmins';

// Criterio 108 (ataque ronda 4, F2; complementa los criterios 39 y 98), parte de integracion: una fecha de la base que llega
// invalida (`Invalid Date`) falla cerrada. Con la API de pruebas y `BaseDatos` reemplazado (`ajustar`) por un doble cuyo
// `trabajo` recibe un cliente falso:
//   - si la fila del superadmin trae `bloqueado_hasta: new Date(NaN)` (o `ultimo_acceso`), POST /api/plataforma/sesion con la
//     clave correcta responde 500 ERROR_INTERNO con el formato comun, sin Set-Cookie, sin token y sin datos del superadmin, y
//     el doble no recibio ninguna escritura (no se pone a cero intentos_fallidos ni bloqueado_hasta, ni se escribe
//     ultimo_acceso); el log tecnico registra el motivo sin la clave;
//   - si una academia trae `creada_en: new Date(NaN)` (o `suspendida_en`), GET /api/plataforma/academias responde 500
//     ERROR_INTERNO sin `academias` en el cuerpo, en vez de un 200 con null, "Invalid Date" o una fecha cualquiera.
// El cliente falso responde segun la tabla que nombra la consulta (`superadmins` o `academias`), con filas de la forma de la base
// (nombres de columna en snake_case) y, para los delegados, con los mismos datos en camelCase.

const AHORA = new Date('2026-11-12T03:30:00.000Z');
const INVALIDA = new Date(Number.NaN);

interface FilaSuperadmin {
  id: string;
  correo: string;
  nombre: string;
  clave_hash: string;
  version_token: number;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
  ultimo_acceso: Date | null;
  creado_en: Date;
  actualizado_en: Date;
}
interface FilaAcademia {
  id: string;
  nombre: string;
  nombre_corto: string;
  estado: 'ACTIVA' | 'SUSPENDIDA';
  motivo_suspension: string | null;
  suspendida_en: Date | null;
  creada_en: Date;
  actualizada_en: Date;
}

const aCamel = (fila: object): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fila).map(([clave, valor]) => [
      clave.replace(/_([a-z])/g, (_t, c: string) => c.toUpperCase()),
      valor,
    ]),
  );

/** Lo que el doble devuelve y lo que recibio. */
const escenario: {
  superadmin: FilaSuperadmin;
  academias: FilaAcademia[];
  escrituras: string[];
  consultas: string[];
} = { superadmin: undefined as never, academias: [], escrituras: [], consultas: [] };

function clasificar(texto: string): 'superadmin' | 'academia' | 'otra' {
  if (/\bsuperadmins?\b/i.test(texto)) return 'superadmin';
  if (/\bacademias?\b/i.test(texto)) return 'academia';
  return 'otra';
}
const esEscritura = (texto: string): boolean => /^\s*(update|insert|delete|merge|truncate)\b/i.test(texto);

function filasPara(texto: string): unknown[] {
  switch (clasificar(texto)) {
    case 'superadmin':
      return [escenario.superadmin];
    case 'academia':
      return escenario.academias;
    default:
      return [];
  }
}

function crearClienteFalso(): Record<string, unknown> {
  const consultar = (primero: unknown): Promise<unknown[]> => {
    const texto = textoDeConsulta(primero);
    escenario.consultas.push(texto);
    if (esEscritura(texto)) escenario.escrituras.push(texto);
    return Promise.resolve(filasPara(texto));
  };
  const ejecutar = (primero: unknown): Promise<number> => {
    const texto = textoDeConsulta(primero);
    escenario.consultas.push(texto);
    escenario.escrituras.push(texto || '$executeRaw');
    return Promise.resolve(1);
  };
  const delegado = (modelo: 'superadmin' | 'academia'): Record<string, unknown> => {
    const filas = (): Record<string, unknown>[] =>
      (modelo === 'superadmin' ? [escenario.superadmin] : escenario.academias).map((fila) => aCamel(fila));
    const leer = (): Promise<unknown> => Promise.resolve(filas()[0] ?? null);
    const escribir = (nombre: string) => (): Promise<unknown> => {
      escenario.escrituras.push(`${modelo}.${nombre}`);
      return Promise.resolve(filas()[0] ?? null);
    };
    return {
      findUnique: leer,
      findUniqueOrThrow: leer,
      findFirst: leer,
      findFirstOrThrow: leer,
      findMany: () => Promise.resolve(filas()),
      count: () => Promise.resolve(filas().length),
      create: escribir('create'),
      createMany: escribir('createMany'),
      update: escribir('update'),
      updateMany: escribir('updateMany'),
      upsert: escribir('upsert'),
      delete: escribir('delete'),
      deleteMany: escribir('deleteMany'),
    };
  };
  return {
    $queryRaw: consultar,
    $executeRaw: ejecutar,
    superadmin: delegado('superadmin'),
    academia: delegado('academia'),
  };
}

class BaseDatosDoble {
  conAcademia<T>(_academiaId: string, trabajo: (tx: unknown) => Promise<T>): Promise<T> {
    return trabajo({ academiaId: _academiaId, cliente: crearClienteFalso() });
  }
  comoPlataforma<T>(trabajo: (tx: unknown) => Promise<T>): Promise<T> {
    return trabajo({ cliente: crearClienteFalso() });
  }
  resolverAcademia(): Promise<null> {
    return Promise.resolve(null);
  }
  comprobarConexion(): Promise<void> {
    return Promise.resolve();
  }
}

describe('criterio 108: una fecha invalida leida de la base falla cerrada (BaseDatos reemplazado por un doble)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let app: NestExpressApplication;
  let base: FilaSuperadmin;
  let sa: SuperadminDePrueba;

  beforeAll(async () => {
    await limpiarBase();
    sa = await crearSuperadminDePrueba();
    const fila = await leerSuperadmin(sa.id);
    if (!fila) throw new Error('No se pudo leer el superadmin de prueba.');
    base = {
      id: fila.id,
      correo: fila.correo,
      nombre: fila.nombre,
      clave_hash: fila.clave_hash,
      version_token: fila.version_token,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_acceso: null,
      creado_en: new Date('2026-01-01T00:00:00.000Z'),
      actualizado_en: new Date('2026-01-01T00:00:00.000Z'),
    };
    const { BaseDatos } = await cargarPrisma();
    const reloj = new RelojFijo(AHORA);
    app = await crearAppDePruebas({
      nivelRegistro: 'info',
      destinoRegistro: destino,
      ajustar: (constructor) =>
        constructor.overrideProvider(RELOJ).useValue(reloj).overrideProvider(BaseDatos).useValue(new BaseDatosDoble()),
    });
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    escenario.superadmin = { ...base };
    escenario.academias = [];
    escenario.escrituras = [];
    escenario.consultas = [];
    lineas.length = 0;
  });

  const servidor = () => app.getHttpServer();
  const entrar = () =>
    request(servidor()).post('/api/plataforma/sesion').send({ correo: sa.correo, clave: CLAVE_SUPERADMIN_PRUEBAS });
  const listar = () => request(servidor()).get('/api/plataforma/academias').set('Cookie', cookieDeSesion(sa, AHORA));
  const academia = (cambios: Partial<FilaAcademia> = {}): FilaAcademia => ({
    id: randomUUID(),
    nombre: 'Academia del doble',
    nombre_corto: 'doble',
    estado: 'ACTIVA',
    motivo_suspension: null,
    suspendida_en: null,
    creada_en: new Date('2026-03-01T12:00:00.000Z'),
    actualizada_en: new Date('2026-03-01T12:00:00.000Z'),
    ...cambios,
  });

  describe('criterio 108: el doble funciona (controles de la propia prueba)', () => {
    it('criterio 108 (control): con las fechas validas, la clave correcta inicia sesion con 200 y cookie', async () => {
      const respuesta = await entrar();

      expect(respuesta.status).toBe(200);
      expect(cookieDePlataforma(respuesta.headers)).toBeDefined();
      expect((respuesta.body as { superadmin: { id: string } }).superadmin.id).toBe(sa.id);
    });

    it('criterio 108 (control): con las fechas validas, el listado responde 200 con las fechas en ISO 8601 UTC', async () => {
      escenario.academias = [
        academia({ nombre_corto: 'a-1' }),
        academia({
          nombre_corto: 's-1',
          estado: 'SUSPENDIDA',
          motivo_suspension: 'Falta de pago',
          suspendida_en: new Date('2026-04-01T08:00:00.000Z'),
        }),
      ];

      const respuesta = await listar();

      expect(respuesta.status).toBe(200);
      const cuerpo = respuesta.body as { academias: { creadaEn: string; suspendidaEn: string | null }[] };
      expect(cuerpo.academias.map((a) => a.creadaEn)).toEqual(['2026-03-01T12:00:00.000Z', '2026-03-01T12:00:00.000Z']);
      expect(new Set(cuerpo.academias.map((a) => a.suspendidaEn))).toEqual(new Set([null, '2026-04-01T08:00:00.000Z']));
    });
  });

  describe('criterio 108: POST /api/plataforma/sesion con una fecha invalida del superadmin', () => {
    it.each([
      ['bloqueado_hasta', { bloqueado_hasta: INVALIDA }],
      ['bloqueado_hasta con intentos fallidos', { bloqueado_hasta: INVALIDA, intentos_fallidos: 5 }],
      ['ultimo_acceso', { ultimo_acceso: INVALIDA }],
    ] as [string, Partial<FilaSuperadmin>][])(
      'criterio 108: %s invalido y la clave correcta responde 500 ERROR_INTERNO, sin cookie, sin token y sin datos',
      async (_nombre, cambios) => {
        escenario.superadmin = { ...base, ...cambios };

        const respuesta = await entrar();

        expect(respuesta.status).toBe(500);
        expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');
        expect(respuesta.headers['set-cookie'], 'no debe haber Set-Cookie').toBeUndefined();
        const texto = JSON.stringify(respuesta.body);
        expect(texto).not.toContain(sa.correo);
        expect(texto).not.toContain(sa.id);
        expect(texto).not.toMatch(/token|superadmin"/i);
        expect((respuesta.body as { superadmin?: unknown }).superadmin).toBeUndefined();
      },
    );

    it('criterio 108: con bloqueado_hasta invalido el doble no recibe ninguna escritura (ni intentos_fallidos, ni bloqueado_hasta, ni ultimo_acceso)', async () => {
      escenario.superadmin = { ...base, intentos_fallidos: 3, bloqueado_hasta: INVALIDA };

      const respuesta = await entrar();

      expect(respuesta.status).toBe(500);
      expect(escenario.escrituras).toEqual([]);
    });

    it('criterio 108: con bloqueado_hasta invalido y una clave equivocada tampoco hay escrituras ni cookie, y no es 200', async () => {
      escenario.superadmin = { ...base, bloqueado_hasta: INVALIDA };

      const respuesta = await request(servidor())
        .post('/api/plataforma/sesion')
        .send({ correo: sa.correo, clave: 'clave-equivocada-123' });

      expect(respuesta.status).not.toBe(200);
      expect(respuesta.headers['set-cookie']).toBeUndefined();
      expect(escenario.escrituras).toEqual([]);
    });

    it('criterio 108: el log tecnico registra el motivo (nivel error) y nunca la clave', async () => {
      escenario.superadmin = { ...base, bloqueado_hasta: INVALIDA };

      await entrar();

      await esperarHasta(() => lineas.some((linea) => (JSON.parse(linea) as { level: number }).level >= 50));
      const registros = lineas.map((linea) => JSON.parse(linea) as { level: number });
      expect(
        registros.some((registro) => registro.level >= 50),
        'falta un registro de nivel error',
      ).toBe(true);
      expect(lineas.join('\n')).not.toContain(CLAVE_SUPERADMIN_PRUEBAS);
    });
  });

  describe('criterio 108: GET /api/plataforma/academias con una fecha invalida', () => {
    it('criterio 108: creada_en invalida responde 500 ERROR_INTERNO sin academias en el cuerpo', async () => {
      escenario.academias = [
        academia({ nombre_corto: 'buena-1' }),
        academia({ nombre_corto: 'rota-1', creada_en: INVALIDA }),
      ];

      const respuesta = await listar();

      expect(respuesta.status).toBe(500);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');
      expect((respuesta.body as { academias?: unknown }).academias).toBeUndefined();
      expect(JSON.stringify(respuesta.body)).not.toMatch(/Invalid Date|rota-1|buena-1/);
    });

    it('criterio 108: suspendida_en invalida responde 500 ERROR_INTERNO sin academias en el cuerpo', async () => {
      escenario.academias = [
        academia({
          nombre_corto: 'rota-2',
          estado: 'SUSPENDIDA',
          motivo_suspension: 'Falta de pago',
          suspendida_en: INVALIDA,
        }),
      ];

      const respuesta = await listar();

      expect(respuesta.status).toBe(500);
      expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');
      expect((respuesta.body as { academias?: unknown }).academias).toBeUndefined();
    });

    it('criterio 108: una sola fecha invalida entre muchas academias tumba todo el listado (no se omite ni se reemplaza)', async () => {
      escenario.academias = [
        academia({ nombre_corto: 'ok-1' }),
        academia({ nombre_corto: 'ok-2' }),
        academia({ nombre_corto: 'rota-3', creada_en: INVALIDA }),
        academia({ nombre_corto: 'ok-3' }),
      ];

      const respuesta = await listar();

      expect(respuesta.status).toBe(500);
      expect((respuesta.body as { academias?: unknown }).academias).toBeUndefined();
    });

    it('criterio 108: el listado no escribe nada en la base', async () => {
      escenario.academias = [academia({ creada_en: INVALIDA })];

      await listar();

      expect(escenario.escrituras).toEqual([]);
    });
  });
});
