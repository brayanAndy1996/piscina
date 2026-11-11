import { afterEach, describe, expect, it } from 'vitest';
import { borrarBases, ejecutarScript, nombresTemporales, servidorDePruebas, tablasDePublic, urlDe } from './ayuda.mjs';

const servidor = servidorDePruebas();
const creadas = [];

function prepararEntorno() {
  const nombres = nombresTemporales();
  creadas.push(nombres.desarrollo, nombres.pruebas);
  return {
    nombres,
    variables: {
      DATABASE_URL: urlDe(servidor, nombres.desarrollo),
      DATABASE_URL_PRUEBAS: urlDe(servidor, nombres.pruebas),
    },
  };
}

afterEach(async () => {
  await borrarBases(servidor, creadas.splice(0));
});

describe('db:migrar y db:migrar:pruebas (scripts/prisma.mjs)', () => {
  it('aplica la migración inicial, informa que no hay pendientes al repetir y no crea tablas de negocio', async () => {
    const { nombres, variables } = prepararEntorno();
    expect(ejecutarScript(['crear-bases.mjs'], variables).estado).toBe(0);

    const primera = ejecutarScript(['prisma.mjs', 'migrate', 'deploy'], variables);
    expect(primera.estado).toBe(0);
    expect(primera.salida).toMatch(/inicial/);
    expect(primera.salida).toMatch(/successfully applied/);

    const segunda = ejecutarScript(['prisma.mjs', 'migrate', 'deploy'], variables);
    expect(segunda.estado).toBe(0);
    expect(segunda.salida).toMatch(/No pending migrations to apply/);

    expect(await tablasDePublic(servidor, nombres.desarrollo)).toEqual(['_prisma_migrations']);
  });

  it('con --pruebas migra la base de pruebas y deja la de desarrollo intacta', async () => {
    const { nombres, variables } = prepararEntorno();
    expect(ejecutarScript(['crear-bases.mjs'], variables).estado).toBe(0);

    const resultado = ejecutarScript(['prisma.mjs', '--pruebas', 'migrate', 'deploy'], variables);

    expect(resultado.estado).toBe(0);
    expect(await tablasDePublic(servidor, nombres.pruebas)).toEqual(['_prisma_migrations']);
    expect(await tablasDePublic(servidor, nombres.desarrollo)).toEqual([]);
  });

  it.each([
    ['es igual a DATABASE_URL', (v) => ({ DATABASE_URL_PRUEBAS: v.DATABASE_URL })],
    ['no termina en _pruebas', (v) => ({ DATABASE_URL_PRUEBAS: `${v.DATABASE_URL_PRUEBAS}_x` })],
    ['falta', () => ({ DATABASE_URL_PRUEBAS: '' })],
  ])('con --pruebas se niega a actuar si DATABASE_URL_PRUEBAS %s', (_motivo, cambiar) => {
    const { variables } = prepararEntorno();
    const resultado = ejecutarScript(['prisma.mjs', '--pruebas', 'migrate', 'deploy'], {
      ...variables,
      ...cambiar(variables),
    });
    expect(resultado.estado).toBe(1);
    expect(resultado.salida).toMatch(/DATABASE_URL_PRUEBAS/);
  });

  it('sin comando de Prisma, explica cómo usarlo', () => {
    const { variables } = prepararEntorno();
    const resultado = ejecutarScript(['prisma.mjs'], variables);
    expect(resultado.estado).toBe(1);
    expect(resultado.salida).toMatch(/Indica el comando de Prisma/);
  });
});

describe('db:preparar (scripts/preparar-bases.mjs)', () => {
  it('crea las bases, migra desarrollo y pruebas, y ejecuta la semilla, en ese orden', async () => {
    const { nombres, variables } = prepararEntorno();

    const resultado = ejecutarScript(['preparar-bases.mjs'], variables);

    expect(resultado.estado).toBe(0);
    const posicion = (texto) => resultado.salida.indexOf(texto);
    const marcas = [
      '== Creando las bases de datos ==',
      '== Migrando la base de desarrollo ==',
      '== Migrando la base de pruebas ==',
      '== Ejecutando la semilla ==',
      'Sin datos de ejemplo todavía.',
      'Bases de datos listas.',
    ];
    for (const marca of marcas) expect(posicion(marca), marca).toBeGreaterThanOrEqual(0);
    const posiciones = marcas.map(posicion);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);

    expect(await tablasDePublic(servidor, nombres.desarrollo)).toEqual(['_prisma_migrations']);
    expect(await tablasDePublic(servidor, nombres.pruebas)).toEqual(['_prisma_migrations']);

    // Repetirlo es seguro.
    const repetido = ejecutarScript(['preparar-bases.mjs'], variables);
    expect(repetido.estado).toBe(0);
    expect(repetido.salida).toMatch(/No pending migrations to apply/);
  });

  it('se detiene en el primer paso que falla e indica cómo reintentar', () => {
    const resultado = ejecutarScript(['preparar-bases.mjs'], {
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/aqua_tmp_x',
      DATABASE_URL_PRUEBAS: 'postgresql://u:p@127.0.0.1:1/aqua_tmp_x_pruebas',
    });
    expect(resultado.estado).not.toBe(0);
    expect(resultado.salida).toContain('Falló el paso: Creando las bases de datos');
    expect(resultado.salida).toContain('npm run db:preparar');
    expect(resultado.salida).not.toContain('== Migrando');
  });
});
