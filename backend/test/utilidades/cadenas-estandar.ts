// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type TestContext } from 'vitest';
import { limpiarBase } from './base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from './datos';
import {
  CADENAS_EN_OFF,
  crearApiContaminada,
  detectarCapacidades,
  limpiarRestos,
  motivoParaOmitir,
  type ApiContaminada,
  type Capacidades,
  type Via,
} from './ronda5';

// Criterio 122 (ataque ronda 5, O3; complementa los criterios 107 y 121): con `standard_conforming_strings = off` una `\` dentro
// de un literal SQL cambia de significado, y el valor puede llegar por las mismas vias que los parametros del criterio 107. Por eso
// toda transaccion de `BaseDatos` y de `enPlataforma` fija `standard_conforming_strings` en `on`, local a la transaccion, en la
// misma primera sentencia (criterio 121); dentro de `trabajo`, current_setting('standard_conforming_strings') es `on`.
// Prueba como la del criterio 107, con las vias (a) a (e) en `off` (las que exigen superusuario se omiten con aviso en la nube):
//   (a) un `trabajo` anterior con set_config(..., false); (b) `options` en DATABASE_URL_APP; (c) ALTER DATABASE; (d) ALTER ROLE
//   ALL [IN DATABASE]; (e) el archivo de configuracion del servidor (ALTER SYSTEM y pg_reload_conf()).
// Dentro de `trabajo` el parametro es `on`, y una consulta cuyo texto SQL es `SELECT length('a\b') AS n` (una sola barra invertida
// en el texto que llega a PostgreSQL) devuelve 3 (con `off` seria 2: `\b` es un retroceso).
// Las vias (a) y (b) estan en backend/test/integracion/aislamiento/cadenas-estandar.test.ts; las vias (c), (d) y (e), que cambian
// valores compartidos con otras conexiones, en backend/test/integracion-aislada/cadenas-estandar-servidor.test.ts (proyecto
// `backend-aislado`, en serie y al final).

const NOMBRES = ['standard_conforming_strings'];

export interface ViaDeCadenas {
  readonly titulo: string;
  readonly via: Via;
}

export const VIAS_LOCALES: readonly ViaDeCadenas[] = [
  { titulo: "(a) un trabajo anterior ejecuta set_config('standard_conforming_strings', 'off', false)", via: 'sesion' },
  { titulo: '(b) DATABASE_URL_APP lleva ?options=-c standard_conforming_strings=off', via: 'url' },
];

export const VIAS_DEL_SERVIDOR: readonly ViaDeCadenas[] = [
  { titulo: '(c) ALTER DATABASE <base> SET standard_conforming_strings = off', via: 'base' },
  { titulo: '(d) ALTER ROLE ALL SET standard_conforming_strings = off', via: 'roles' },
  { titulo: '(d) ALTER ROLE ALL IN DATABASE <base> SET standard_conforming_strings = off', via: 'roles-base' },
  { titulo: '(e) el archivo de configuracion del servidor (ALTER SYSTEM SET ... y pg_reload_conf())', via: 'servidor' },
];

/** Registra los hooks y las pruebas del criterio 122 para las vias indicadas. */
export function registrarPruebasDeCadenas(vias: readonly ViaDeCadenas[]): void {
  let capacidades: Capacidades = { superusuario: false, alteraLaBase: false, creaEsquemas: false };
  const conPrivilegios = vias.some((via) => via.via !== 'sesion' && via.via !== 'url');

  beforeAll(async () => {
    capacidades = await detectarCapacidades();
    if (conPrivilegios) await limpiarRestos(NOMBRES, capacidades).catch(() => undefined);
    if (vias.some((via) => via.via === 'base') && !capacidades.alteraLaBase) {
      console.warn(
        '[criterio 122] AVISO: el dueno de la base de pruebas no puede ejecutar ALTER DATABASE ... SET; la via (c) se omite.',
      );
    }
    if (
      vias.some((via) => via.via === 'roles' || via.via === 'roles-base' || via.via === 'servidor') &&
      !capacidades.superusuario
    ) {
      console.warn(
        '[criterio 122] AVISO: el dueno de la base de pruebas no es superusuario (nube); las vias (d) ALTER ROLE ALL y (e) ALTER SYSTEM se omiten. Corren en Docker y en la CI.',
      );
    }
  });
  afterAll(async () => {
    if (conPrivilegios) await limpiarRestos(NOMBRES, capacidades).catch(() => undefined);
  });

  describe.each(vias)('criterio 122: standard_conforming_strings en off $titulo', (variante) => {
    let datos: DatosDeAislamiento;
    let api: ApiContaminada | undefined;
    let omitida: string | undefined;

    beforeEach(async () => {
      omitida = motivoParaOmitir(variante.via, capacidades, false);
      if (omitida) return;
      await limpiarBase();
      datos = await crearDatosDeAislamiento();
    });
    afterEach(async () => {
      try {
        await api?.cerrar();
      } finally {
        api = undefined;
      }
    });

    async function iniciar(contexto: TestContext): Promise<ApiContaminada> {
      if (omitida) contexto.skip(omitida);
      api = await crearApiContaminada(variante.via, [CADENAS_EN_OFF]);
      return api;
    }

    it("criterio 122: dentro de conAcademia y de comoPlataforma, current_setting('standard_conforming_strings') es on", async (ctx) => {
      const { baseDatos } = await iniciar(ctx);

      const enAcademia = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const filas = await tx.cliente.$queryRaw<
          { valor: string }[]
        >`SELECT current_setting('standard_conforming_strings') AS valor`;
        return filas[0]?.valor;
      });
      const enPlataforma = await baseDatos.comoPlataforma(async (tx) => {
        const filas = await tx.cliente.$queryRaw<
          { valor: string }[]
        >`SELECT current_setting('standard_conforming_strings') AS valor`;
        return filas[0]?.valor;
      });

      expect(enAcademia).toBe('on');
      expect(enPlataforma).toBe('on');
    });

    it("criterio 122: SELECT length('a\\b') (una sola barra invertida en el texto SQL) devuelve 3 en conAcademia y en comoPlataforma", async (ctx) => {
      const { baseDatos } = await iniciar(ctx);

      // En la plantilla, `\\` es una sola barra invertida: a PostgreSQL le llega `SELECT length('a\b') AS n`.
      const enAcademia = await baseDatos.conAcademia(datos.B.id, async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ n: number }[]>`SELECT length('a\\b') AS n`;
        return Number(filas[0]?.n);
      });
      const enPlataforma = await baseDatos.comoPlataforma(async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ n: number }[]>`SELECT length('a\\b') AS n`;
        return Number(filas[0]?.n);
      });

      expect(enAcademia, 'con standard_conforming_strings = off el resultado seria 2').toBe(3);
      expect(enPlataforma).toBe(3);
    });

    it('criterio 122: resolverAcademia sigue encontrando la academia (su transaccion tambien fija el parametro)', async (ctx) => {
      const { baseDatos } = await iniciar(ctx);

      const academia = await baseDatos.resolverAcademia(datos.A.nombreCorto);

      expect(academia?.id).toBe(datos.A.id);
    });
  });
}
