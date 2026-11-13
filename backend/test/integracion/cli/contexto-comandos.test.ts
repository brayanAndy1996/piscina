// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearClienteDelDueno, enPlataforma } from '../../../src/cli/conexion';
import { ejecutarComo, limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';

// Criterio 90 (ataque ronda 2, O6; complementa el criterio 72): una transaccion de plataforma abierta por un comando o por
// la semilla (`enPlataforma` de backend/src/cli/conexion.ts) fija como primera sentencia los dos valores de contexto con
// set_config(..., true): app.academia_id en '' y app.plataforma en 'si'. Prueba: con `crearClienteDelDueno(url)` sobre la base
// de pruebas y la URL del dueno con `?options=-c app.academia_id=<id de A> -c app.plataforma=no` (codificado), dentro de
// `enPlataforma` current_setting('app.academia_id', true) es '' y current_setting('app.plataforma', true) es 'si'; y, si el
// dueno no es superusuario (la nube), `auditoria` y `configuraciones` devuelven 0 filas.

interface ContextoLeido {
  academia: string | null;
  plataforma: string | null;
}

/** URL del dueno con la sesion contaminada: `?options=-c app.academia_id=<id> -c app.plataforma=no` (codificado). */
function urlDelDuenoContaminada(academiaId: string): string {
  const url = urlPropietarioPruebas();
  const opciones = `-c app.academia_id=${academiaId} -c app.plataforma=no`;
  return `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(opciones)}`;
}

async function duenoEsSuperusuario(): Promise<boolean> {
  const { rows } = await ejecutarComo(
    'propietario',
    'SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user',
  );
  return (rows[0] as { rolsuper: boolean }).rolsuper;
}

describe('criterio 90: enPlataforma fija el contexto completo en los comandos y la semilla', () => {
  let datos: DatosDeAislamiento;
  let cliente: ReturnType<typeof crearClienteDelDueno> | undefined;

  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
  });
  afterEach(async () => {
    await cliente?.$disconnect();
    cliente = undefined;
  });

  it('criterio 90 (premisa): la URL contaminada deja los valores en la sesion de la conexion del dueno', async () => {
    cliente = crearClienteDelDueno(urlDelDuenoContaminada(datos.A.id));

    const [fila] = await cliente.$queryRaw<ContextoLeido[]>`
      SELECT current_setting('app.academia_id', true) AS academia, current_setting('app.plataforma', true) AS plataforma`;

    expect(fila).toEqual({ academia: datos.A.id, plataforma: 'no' });
  });

  it("criterio 90: dentro de enPlataforma, app.academia_id es '' y app.plataforma es 'si' aunque la sesion venga contaminada", async () => {
    cliente = crearClienteDelDueno(urlDelDuenoContaminada(datos.A.id));

    const fila = await enPlataforma(cliente, async (tx) => {
      const [leida] = await tx.$queryRaw<ContextoLeido[]>`
        SELECT current_setting('app.academia_id', true) AS academia, current_setting('app.plataforma', true) AS plataforma`;
      return leida;
    });

    expect(fila).toEqual({ academia: '', plataforma: 'si' });
  });

  it('criterio 90: sin contaminar, enPlataforma tambien deja app.academia_id en vacio y app.plataforma en si', async () => {
    cliente = crearClienteDelDueno(urlPropietarioPruebas());

    const fila = await enPlataforma(cliente, async (tx) => {
      const [leida] = await tx.$queryRaw<ContextoLeido[]>`
        SELECT current_setting('app.academia_id', true) AS academia, current_setting('app.plataforma', true) AS plataforma`;
      return leida;
    });

    expect(fila).toEqual({ academia: '', plataforma: 'si' });
  });

  it('criterio 90: si el dueno no es superusuario (la nube), auditoria y configuraciones devuelven 0 filas dentro de enPlataforma', async (contexto) => {
    if (await duenoEsSuperusuario()) {
      contexto.skip('el dueno es superusuario (Docker y CI): se salta la seguridad por fila siempre');
    }
    cliente = crearClienteDelDueno(urlDelDuenoContaminada(datos.A.id));

    const conteos = await enPlataforma(cliente, async (tx) => {
      const [auditoria] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM auditoria`;
      const [configuraciones] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM configuraciones`;
      return { auditoria: auditoria?.n, configuraciones: configuraciones?.n };
    });

    expect(conteos).toEqual({ auditoria: 0, configuraciones: 0 });
  });
});
