import { afterEach, describe, expect, it } from 'vitest';
import {
  borrarBases,
  ejecutarScript,
  nombresTemporales,
  servidorDePruebas,
  tablasDePublic,
  urlAppDePruebas,
  urlDe,
} from './ayuda.mjs';
import { urlAppAlineada } from './ayuda-ronda9.mjs';

const servidor = servidorDePruebas();

// Tablas de `public` después de aplicar todas las migraciones (la 000 no creaba ninguna; la 001 crea cinco y la 002, `usuarios`).
// Cada historia con tablas nuevas agrega las suyas aquí.
const TABLAS_DESPUES_DE_MIGRAR = [
  '_prisma_migrations',
  'academias',
  'auditoria',
  'auditoria_plataforma',
  'configuraciones',
  'superadmins',
  'usuarios',
].sort();
const creadas = [];

function prepararEntorno() {
  const nombres = nombresTemporales();
  creadas.push(nombres.desarrollo, nombres.pruebas);
  const desarrollo = urlDe(servidor, nombres.desarrollo);
  return {
    nombres,
    variables: {
      DATABASE_URL: desarrollo,
      DATABASE_URL_PRUEBAS: urlDe(servidor, nombres.pruebas),
      // Criterio 148 (ataque ronda 9): la URL de la app lleva el mismo servidor, puerto y base que DATABASE_URL del caso.
      DATABASE_URL_APP: urlAppAlineada(urlAppDePruebas(), desarrollo),
    },
  };
}

afterEach(async () => {
  await borrarBases(servidor, creadas.splice(0));
});

describe('db:migrar y db:migrar:pruebas (scripts/prisma.mjs)', () => {
  it('aplica las migraciones, informa que no hay pendientes al repetir y crea solo las tablas de las historias 001 y 002', async () => {
    const { nombres, variables } = prepararEntorno();
    expect(ejecutarScript(['crear-bases.mjs'], variables).estado).toBe(0);

    const primera = ejecutarScript(['prisma.mjs', 'migrate', 'deploy'], variables);
    expect(primera.estado).toBe(0);
    expect(primera.salida).toMatch(/inicial/);
    expect(primera.salida).toMatch(/successfully applied/);

    const segunda = ejecutarScript(['prisma.mjs', 'migrate', 'deploy'], variables);
    expect(segunda.estado).toBe(0);
    expect(segunda.salida).toMatch(/No pending migrations to apply/);

    expect(await tablasDePublic(servidor, nombres.desarrollo)).toEqual(TABLAS_DESPUES_DE_MIGRAR);
  });

  it('con --pruebas migra la base de pruebas y deja la de desarrollo intacta', async () => {
    const { nombres, variables } = prepararEntorno();
    expect(ejecutarScript(['crear-bases.mjs'], variables).estado).toBe(0);

    const resultado = ejecutarScript(['prisma.mjs', '--pruebas', 'migrate', 'deploy'], variables);

    expect(resultado.estado).toBe(0);
    expect(await tablasDePublic(servidor, nombres.pruebas)).toEqual(TABLAS_DESPUES_DE_MIGRAR);
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
      'Academia de ejemplo creada: delfines',
      'Academia de ejemplo creada: tiburones',
      'Bases de datos listas.',
    ];
    for (const marca of marcas) expect(posicion(marca), marca).toBeGreaterThanOrEqual(0);
    const posiciones = marcas.map(posicion);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);

    expect(await tablasDePublic(servidor, nombres.desarrollo)).toEqual(TABLAS_DESPUES_DE_MIGRAR);
    expect(await tablasDePublic(servidor, nombres.pruebas)).toEqual(TABLAS_DESPUES_DE_MIGRAR);

    // Repetirlo es seguro.
    const repetido = ejecutarScript(['preparar-bases.mjs'], variables);
    expect(repetido.estado).toBe(0);
    expect(repetido.salida).toMatch(/No pending migrations to apply/);
    // La semilla de la historia 001 solo agrega lo que falta: repetirla no duplica las academias de ejemplo.
    expect(repetido.salida).toContain('La academia de ejemplo ya existía: delfines');
    expect(repetido.salida).not.toContain('Academia de ejemplo creada');
  });

  it('se detiene en el primer paso que falla e indica cómo reintentar', () => {
    const desarrollo = 'postgresql://u:p@127.0.0.1:1/aqua_tmp_x';
    const resultado = ejecutarScript(['preparar-bases.mjs'], {
      DATABASE_URL: desarrollo,
      DATABASE_URL_PRUEBAS: 'postgresql://u:p@127.0.0.1:1/aqua_tmp_x_pruebas',
      // Criterio 148 (ataque ronda 9): sin esta variable, la del .env (otro puerto y otra base) haria fallar el paso por la diferencia y
      // no por la conexion que prueba el caso.
      DATABASE_URL_APP: urlAppAlineada(urlAppDePruebas(), desarrollo),
    });
    expect(resultado.estado).not.toBe(0);
    expect(resultado.salida).toContain('Falló el paso: Creando las bases de datos');
    expect(resultado.salida).toContain('npm run db:preparar');
    expect(resultado.salida).not.toContain('== Migrando');
  });
});
