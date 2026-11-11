// Pruebas de la verificación de pruebas protegidas (spec 000, criterios 33 a 41): funciones puras y, sobre
// repositorios git temporales, el modo rango y el modo preparados.
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analizarArgumentos,
  buscarMarca,
  esCommitDePruebasProtegidas,
  tieneMarcaProtegida,
  tituloDeMensaje,
} from '../verificar-pruebas-protegidas.mjs';
import { RepoTemporal } from './ayuda-git.mjs';

const SCRIPT = 'verificar-pruebas-protegidas.mjs';
const MARCA = '// spec: 005-cobro (pruebas protegidas)';
const PRUEBA = `${MARCA}\nimport { it } from 'vitest';\nit('cobra', () => {});\n`;

describe('tieneMarcaProtegida (criterio 33)', () => {
  it.each([
    ['//', '// spec: 005-cobro (pruebas protegidas)'],
    ['#', '# spec: 005-cobro (pruebas protegidas)'],
    ['/*', '/* spec: 005-cobro (pruebas protegidas) */'],
    ['--', '-- spec: 005-cobro (pruebas protegidas)'],
    ['<!--', '<!-- spec: 005-cobro (pruebas protegidas) -->'],
    ['sin espacio tras la barra', '//spec:005-cobro (pruebas protegidas)'],
    ['con sangría', '   // spec: 005-cobro (pruebas protegidas)'],
    ['nombre con dígitos y guiones', '// spec: 012-ataque-ronda-2 (pruebas protegidas)'],
  ])('reconoce la marca abierta con %s', (_nombre, linea) => {
    expect(tieneMarcaProtegida(`${linea}\ncódigo\n`)).toBe(true);
  });

  it('devuelve la especificación de la marca', () => {
    expect(buscarMarca(`\n\n${MARCA}\n`)).toBe('005-cobro');
  });

  it('acepta la marca en cualquiera de las 5 primeras líneas, no en la 6', () => {
    const relleno = (n) => Array.from({ length: n }, (_, i) => `// línea ${i + 1}`).join('\n');
    expect(tieneMarcaProtegida(`${relleno(4)}\n${MARCA}\nfin`)).toBe(true);
    expect(tieneMarcaProtegida(`${relleno(5)}\n${MARCA}\nfin`)).toBe(false);
  });

  it('funciona con finales de línea CRLF y con BOM', () => {
    expect(tieneMarcaProtegida(`import a;\r\n${MARCA}\r\nfin`)).toBe(true);
    expect(tieneMarcaProtegida(`\uFEFF${MARCA}\n`)).toBe(true);
  });

  it.each([
    ['sin comentario', 'spec: 005-cobro (pruebas protegidas)'],
    ['con dos dígitos', '// spec: 05-cobro (pruebas protegidas)'],
    ['con cuatro dígitos', '// spec: 0005-cobro (pruebas protegidas)'],
    ['con mayúsculas en el nombre', '// spec: 005-Cobro (pruebas protegidas)'],
    ['sin nombre', '// spec: 005 (pruebas protegidas)'],
    ['sin paréntesis', '// spec: 005-cobro pruebas protegidas'],
    ['con otro texto', '// spec: 005-cobro (pruebas normales)'],
    ['con texto antes del comentario', 'const a = 1; // spec: 005-cobro (pruebas protegidas)'],
    ['de otro tipo de comentario', '% spec: 005-cobro (pruebas protegidas)'],
  ])('no reconoce una marca %s', (_nombre, linea) => {
    expect(tieneMarcaProtegida(`${linea}\n`)).toBe(false);
  });

  it('un archivo binario, vacío o inexistente no está protegido', () => {
    expect(tieneMarcaProtegida(Buffer.concat([Buffer.from(`${MARCA}\n`), Buffer.from([0, 1, 2])]))).toBe(false);
    expect(tieneMarcaProtegida('')).toBe(false);
    expect(tieneMarcaProtegida(null)).toBe(false);
    expect(tieneMarcaProtegida(undefined)).toBe(false);
  });
});

describe('esCommitDePruebasProtegidas (criterio 34)', () => {
  it.each([
    'Pruebas protegidas (005): cobro proporcional (en rojo)',
    'Pruebas protegidas (009), ataque ronda 2: clase de 19:00 (en rojo)',
    'pruebas protegidas (001)',
    'PRUEBAS PROTEGIDAS (123): x',
  ])('acepta %j', (titulo) => {
    expect(esCommitDePruebasProtegidas(titulo)).toBe(true);
  });

  it.each([
    'Implementación (005): cobro',
    'Pruebas protegidas: cobro',
    'Pruebas protegidas (5): cobro',
    'Pruebas protegidas (0005): cobro',
    'Pruebas protegidas (abc): cobro',
    'Corrige Pruebas protegidas (005)',
    ' Pruebas protegidas (005)',
    '',
  ])('rechaza %j', (titulo) => {
    expect(esCommitDePruebasProtegidas(titulo)).toBe(false);
  });
});

describe('tituloDeMensaje', () => {
  it('toma la primera línea con contenido, sin comentarios', () => {
    expect(tituloDeMensaje('Título\n\ncuerpo')).toBe('Título');
    expect(tituloDeMensaje('\n# comentario\n  Título con espacios  \nmás')).toBe('Título con espacios');
    expect(tituloDeMensaje('# solo comentarios\n')).toBe('');
    expect(tituloDeMensaje('Título\r\ncuerpo')).toBe('Título');
  });
});

describe('analizarArgumentos', () => {
  it('interpreta las opciones', () => {
    expect(analizarArgumentos(['--desde', 'a', '--hasta', 'b']).opciones).toMatchObject({ desde: 'a', hasta: 'b' });
    expect(analizarArgumentos(['--preparados', '--mensaje', 'm.txt']).opciones).toMatchObject({
      preparados: true,
      mensaje: 'm.txt',
    });
  });

  it('rechaza opciones desconocidas o sin valor', () => {
    expect(analizarArgumentos(['--otra']).error).toMatch(/--otra/);
    expect(analizarArgumentos(['--desde']).error).toMatch(/--desde/);
    expect(analizarArgumentos(['--desde', '--hasta', 'x']).error).toMatch(/--desde/);
  });
});

describe('modo rango sobre repositorios git temporales', () => {
  /** @type {RepoTemporal[]} */
  const repos = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.limpiar();
  });

  /** Repositorio con un commit inicial que ya tiene una prueba protegida. Devuelve el repositorio y la base. */
  function repoConBase(rutaPrueba = 'backend/test/cobro.test.ts') {
    const repo = new RepoTemporal();
    repos.push(repo);
    const base = repo.confirmar('Inicio', {
      'README.md': 'hola\n',
      'backend/src/cobro.ts': 'export const cobro = 1;\n',
      [rutaPrueba]: PRUEBA,
    });
    return { repo, base, rutaPrueba };
  }

  const correr = (repo, base, hasta = 'HEAD') => repo.ejecutarScript(SCRIPT, ['--desde', base, '--hasta', hasta]);

  describe('violaciones (criterio 35)', () => {
    const casos = [
      ['modifica un archivo protegido', (repo, ruta) => repo.escribir(ruta, `${PRUEBA}it('otra', () => {});\n`)],
      ['borra un archivo protegido', (repo, ruta) => repo.borrar(ruta)],
      [
        'renombra un archivo protegido',
        (repo, ruta) => {
          const contenido = repo.leer(ruta);
          repo.borrar(ruta);
          repo.escribir('backend/test/cobro-nuevo.test.ts', contenido);
        },
      ],
      ['quita la marca', (repo, ruta) => repo.escribir(ruta, PRUEBA.split('\n').slice(1).join('\n'))],
      ['mueve la marca bajo la línea 5', (repo, ruta) => repo.escribir(ruta, `\n\n\n\n\n${PRUEBA}`)],
    ];

    it.each(casos)('falla si un commit normal %s', (_nombre, cambiar) => {
      const { repo, base, rutaPrueba } = repoConBase();
      cambiar(repo, rutaPrueba);
      const hash = repo.commit('Implementación (005): cobro');
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(1);
      expect(resultado.texto).toContain(hash.slice(0, 7));
      expect(resultado.texto).toContain('Implementación (005): cobro');
      expect(resultado.texto).toContain(rutaPrueba);
      expect(resultado.texto).toContain('005-cobro');
    });

    it('falla si un commit normal cambia los permisos de un archivo protegido', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.git('update-index', '--chmod=+x', rutaPrueba);
      repo.git('commit', '-q', '-m', 'Permisos');
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(1);
      expect(resultado.texto).toContain(rutaPrueba);
    });

    it('falla si un commit normal agrega la marca a un archivo nuevo', () => {
      const { repo, base } = repoConBase();
      repo.confirmar('Mis pruebas', { 'backend/test/propia.test.ts': PRUEBA });
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(1);
      expect(resultado.texto).toContain('backend/test/propia.test.ts');
    });

    it('falla si un commit normal agrega la marca a un archivo existente', () => {
      const { repo, base } = repoConBase();
      repo.confirmar('Marca', { 'backend/src/cobro.ts': `${MARCA}\nexport const cobro = 1;\n` });
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(1);
      expect(resultado.texto).toContain('backend/src/cobro.ts');
    });

    it('informa una línea por cada violación, con el commit que la causó', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.escribir('backend/test/otra.test.ts', PRUEBA.replace('005-cobro', '006-caja'));
      repo.commit('Pruebas protegidas (006): caja (en rojo)');
      const base2 = repo.git('rev-parse', 'HEAD');
      repo.confirmar('Primer cambio', { [rutaPrueba]: `${PRUEBA}// uno\n` });
      repo.confirmar('Segundo cambio', {
        'backend/test/otra.test.ts': `${PRUEBA.replace('005-cobro', '006-caja')}// dos\n`,
      });
      const resultado = correr(repo, base2);
      expect(resultado.codigo).toBe(1);
      expect(resultado.texto).toContain('2 cambio(s)');
      expect(resultado.texto).toMatch(/Primer cambio.*cobro\.test\.ts.*005-cobro/);
      expect(resultado.texto).toMatch(/Segundo cambio.*otra\.test\.ts.*006-caja/);
      expect(correr(repo, base).codigo).toBe(1);
    });
  });

  describe('sin violaciones (criterio 36)', () => {
    it('termina en 0 e informa los commits y archivos revisados si solo cambian commits de pruebas protegidas', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.confirmar('Pruebas protegidas (005): más casos (en rojo)', { [rutaPrueba]: `${PRUEBA}// más\n` });
      repo.confirmar('Pruebas protegidas (006): caja (en rojo)', {
        'backend/test/caja.test.ts': PRUEBA.replace('005-cobro', '006-caja'),
      });
      repo.confirmar('Implementación (005): cobro', { 'backend/src/cobro.ts': 'export const cobro = 2;\n' });
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(0);
      expect(resultado.salida).toContain('3 commit(s)');
      expect(resultado.salida).toContain('2 archivo(s) protegido(s)');
    });

    it('un commit normal que no toca archivos protegidos no es violación', () => {
      const { repo, base } = repoConBase();
      repo.confirmar('Cambio normal', { 'README.md': 'otro\n', 'backend/src/nuevo.ts': 'export {};\n' });
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(0);
      expect(resultado.salida).toContain('1 commit(s)');
      expect(resultado.salida).toContain('0 archivo(s) protegido(s)');
    });

    it('acepta el título de ataque con ronda', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.confirmar('Pruebas protegidas (005), ataque ronda 2: borde (en rojo)', { [rutaPrueba]: `${PRUEBA}// r2\n` });
      expect(correr(repo, base).codigo).toBe(0);
    });
  });

  describe('diferencia neta (criterio 37)', () => {
    it('no hay violación si un commit posterior deja el archivo como estaba', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.confirmar('Error: edita la prueba', { [rutaPrueba]: `${PRUEBA}// edición indebida\n` });
      expect(correr(repo, base).codigo).toBe(1);
      repo.confirmar('Revierte la edición', { [rutaPrueba]: PRUEBA });
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(0);
      expect(resultado.salida).toContain('2 commit(s)');
    });

    it('un archivo borrado por error y restaurado después no es violación', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.borrar(rutaPrueba);
      repo.commit('Borra por error');
      repo.escribir(rutaPrueba, PRUEBA);
      repo.commit('Lo restaura');
      expect(correr(repo, base).codigo).toBe(0);
    });

    it('sigue siendo violación si el archivo queda distinto al final', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.confirmar('Edita', { [rutaPrueba]: `${PRUEBA}// uno\n` });
      repo.confirmar('Edita otra vez', { [rutaPrueba]: `${PRUEBA}// dos\n` });
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(1);
      expect(resultado.texto).toContain('Edita');
    });
  });

  describe('merges (criterio 38)', () => {
    it('un merge limpio no cuenta lo que trae cada rama', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.git('checkout', '-q', '-b', 'lateral');
      repo.confirmar('Pruebas protegidas (005): casos (en rojo)', { [rutaPrueba]: `${PRUEBA}// lateral\n` });
      repo.git('checkout', '-q', 'main');
      repo.confirmar('Cambio en main', { 'README.md': 'cambio\n' });
      repo.git('merge', '-q', '--no-ff', '-m', 'Merge de lateral', 'lateral');
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(0);
      expect(resultado.salida).toContain('3 commit(s)');
    });

    it('un commit indebido dentro de la rama traída por el merge se informa por su propio commit', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.git('checkout', '-q', '-b', 'lateral');
      const malo = repo.confirmar('Edita la prueba por error', { [rutaPrueba]: `${PRUEBA}// indebido\n` });
      repo.git('checkout', '-q', 'main');
      repo.confirmar('Cambio en main', { 'README.md': 'cambio\n' });
      repo.git('merge', '-q', '--no-ff', '-m', 'Merge de lateral', 'lateral');
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(1);
      expect(resultado.texto).toContain(malo.slice(0, 7));
      expect(resultado.texto).toContain('1 cambio(s)');
      expect(resultado.texto).not.toContain('Merge de lateral');
    });

    it('un merge que resuelve un conflicto en un archivo protegido es violación del merge', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.git('checkout', '-q', '-b', 'lateral');
      repo.confirmar('Pruebas protegidas (005): lateral (en rojo)', { [rutaPrueba]: `${MARCA}\n// lateral\n` });
      repo.git('checkout', '-q', 'main');
      repo.confirmar('Pruebas protegidas (005): principal (en rojo)', { [rutaPrueba]: `${MARCA}\n// principal\n` });
      try {
        repo.git('merge', '--no-ff', '-m', 'Resuelve el conflicto', 'lateral');
      } catch {
        // El conflicto es esperado: se resuelve a mano abajo.
      }
      repo.escribir(rutaPrueba, `${MARCA}\n// lateral\n// principal\n`);
      repo.git('add', '-A');
      repo.git('commit', '-q', '-m', 'Resuelve el conflicto');
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(1);
      expect(resultado.texto).toContain('Resuelve el conflicto');
      expect(resultado.texto).toContain(rutaPrueba);
    });
  });

  describe('rangos vacíos y referencias inexistentes (criterio 39)', () => {
    it('un rango vacío termina en 0 e informa que no hay commits', () => {
      const { repo } = repoConBase();
      const resultado = repo.ejecutarScript(SCRIPT, ['--desde', 'HEAD', '--hasta', 'HEAD']);
      expect(resultado.codigo).toBe(0);
      expect(resultado.salida).toContain('Sin commits que revisar.');
    });

    it.each([
      ['--desde', ['--desde', 'no-existe-xyz', '--hasta', 'HEAD']],
      ['--hasta', ['--desde', 'HEAD', '--hasta', 'tampoco-existe']],
    ])('una referencia inexistente en %s termina en 2 y la nombra', (_nombre, argumentos) => {
      const { repo } = repoConBase();
      const resultado = repo.ejecutarScript(SCRIPT, argumentos);
      expect(resultado.codigo).toBe(2);
      expect(resultado.texto).toContain(argumentos.find((a) => a.includes('existe')));
    });

    it('una referencia que parece una opción de git se rechaza', () => {
      const { repo } = repoConBase();
      const resultado = repo.ejecutarScript(SCRIPT, ['--desde', '-x', '--hasta', 'HEAD']);
      expect(resultado.codigo).toBe(2);
    });

    it('un argumento desconocido termina en 2', () => {
      const { repo } = repoConBase();
      expect(repo.ejecutarScript(SCRIPT, ['--otra']).codigo).toBe(2);
    });
  });

  describe('rutas con espacios, tildes y "ñ" (criterio 40)', () => {
    const rutas = ['pruebas/año ñandú/cobro mensual.test.ts', 'pruebas/prueba única.test.ts', 'pruebas/niño.test.ts'];

    it.each(rutas)('identifica e informa %s', (ruta) => {
      const { repo, base } = repoConBase(ruta);
      repo.confirmar('Edita', { [ruta]: `${PRUEBA}// cambio\n` });
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(1);
      expect(resultado.texto).toContain(ruta);
    });

    it.each(rutas)('acepta %s en un commit de pruebas protegidas', (ruta) => {
      const { repo, base } = repoConBase(ruta);
      repo.confirmar('Pruebas protegidas (005): casos (en rojo)', { [ruta]: `${PRUEBA}// cambio\n` });
      const resultado = correr(repo, base);
      expect(resultado.codigo).toBe(0);
      expect(resultado.salida).toContain('1 archivo(s) protegido(s)');
    });
  });

  describe('rango por defecto', () => {
    it('usa el merge-base con origin/main y HEAD', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.git('update-ref', 'refs/remotes/origin/main', base);
      repo.confirmar('Edita', { [rutaPrueba]: `${PRUEBA}// cambio\n` });
      const resultado = repo.ejecutarScript(SCRIPT);
      expect(resultado.codigo).toBe(1);
      expect(resultado.texto).toContain(rutaPrueba);
    });

    it('trata el hash de ceros de GitHub como "usar el merge-base"', () => {
      const { repo, base, rutaPrueba } = repoConBase();
      repo.git('update-ref', 'refs/remotes/origin/main', base);
      repo.confirmar('Edita', { [rutaPrueba]: `${PRUEBA}// cambio\n` });
      const resultado = repo.ejecutarScript(SCRIPT, ['--desde', '0'.repeat(40)]);
      expect(resultado.codigo).toBe(1);
    });

    it('sin origin/main ni main termina en 2 con un mensaje claro', () => {
      const { repo } = repoConBase();
      repo.git('branch', '-m', 'trabajo');
      const resultado = repo.ejecutarScript(SCRIPT);
      expect(resultado.codigo).toBe(2);
      expect(resultado.texto).toContain('origin/main');
    });
  });
});

describe('modo preparados (criterio 41)', () => {
  /** @type {RepoTemporal[]} */
  const repos = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.limpiar();
  });

  const RUTA = 'backend/test/cobro.test.ts';

  function repoConBase() {
    const repo = new RepoTemporal();
    repos.push(repo);
    repo.confirmar('Inicio', { 'README.md': 'hola\n', [RUTA]: PRUEBA });
    return repo;
  }

  /** Escribe el mensaje en un archivo temporal dentro de .git y ejecuta el modo preparados. */
  function verificar(repo, mensaje) {
    const archivo = '.git/MENSAJE_PRUEBA';
    fs.writeFileSync(repo.ruta(archivo), mensaje);
    return repo.ejecutarScript(SCRIPT, ['--preparados', '--mensaje', archivo]);
  }

  it('rechaza un cambio preparado a un archivo protegido con un título normal', () => {
    const repo = repoConBase();
    repo.escribir(RUTA, `${PRUEBA}// cambio\n`);
    repo.git('add', '-A');
    const resultado = verificar(repo, 'Implementación (005)\n\ncuerpo');
    expect(resultado.codigo).toBe(1);
    expect(resultado.texto).toContain(RUTA);
    expect(resultado.texto).toContain('Implementación (005)');
    expect(resultado.texto).toContain('005-cobro');
  });

  it('acepta el mismo cambio con el título de un commit de pruebas protegidas', () => {
    const repo = repoConBase();
    repo.escribir(RUTA, `${PRUEBA}// cambio\n`);
    repo.git('add', '-A');
    expect(verificar(repo, 'Pruebas protegidas (005): casos (en rojo)\n').codigo).toBe(0);
  });

  it('ignora las líneas de comentario del mensaje al buscar el título', () => {
    const repo = repoConBase();
    repo.escribir(RUTA, `${PRUEBA}// cambio\n`);
    repo.git('add', '-A');
    expect(verificar(repo, '# Por favor escribe el mensaje\nPruebas protegidas (005): casos\n').codigo).toBe(0);
    expect(verificar(repo, '# comentario\nOtro título\n').codigo).toBe(1);
  });

  it.each([
    ['borrar el archivo', (repo) => repo.git('rm', '-q', RUTA)],
    ['quitar la marca', (repo) => repo.escribir(RUTA, 'sin marca\n')],
    ['agregar la marca a un archivo nuevo', (repo) => repo.escribir('backend/test/nueva.test.ts', PRUEBA)],
    ['agregar la marca a un archivo existente', (repo) => repo.escribir('README.md', `${MARCA}\nhola\n`)],
  ])('rechaza al %s', (_nombre, cambiar) => {
    const repo = repoConBase();
    cambiar(repo);
    repo.git('add', '-A');
    expect(verificar(repo, 'Implementación').codigo).toBe(1);
  });

  it('acepta los cambios preparados que no tocan archivos protegidos', () => {
    const repo = repoConBase();
    repo.escribir('README.md', 'otro\n');
    repo.escribir('backend/src/nuevo.ts', 'export {};\n');
    repo.git('add', '-A');
    const resultado = verificar(repo, 'Cambio normal');
    expect(resultado.codigo).toBe(0);
    expect(resultado.texto).toBe('');
  });

  it('solo mira lo preparado, no los cambios sin preparar', () => {
    const repo = repoConBase();
    repo.escribir(RUTA, `${PRUEBA}// sin preparar\n`);
    expect(verificar(repo, 'Cambio normal').codigo).toBe(0);
  });

  it('funciona en un repositorio sin commits mirando solo el índice', () => {
    const repo = new RepoTemporal();
    repos.push(repo);
    repo.escribir(RUTA, PRUEBA);
    repo.escribir('README.md', 'hola\n');
    repo.git('add', '-A');
    expect(verificar(repo, 'Primer commit').codigo).toBe(1);
    expect(verificar(repo, 'Pruebas protegidas (005): primeras (en rojo)').codigo).toBe(0);
  });

  it('con un merge en curso no revisa', () => {
    const repo = repoConBase();
    repo.escribir(RUTA, `${PRUEBA}// cambio\n`);
    repo.git('add', '-A');
    fs.writeFileSync(repo.ruta('.git/MERGE_HEAD'), `${repo.git('rev-parse', 'HEAD')}\n`);
    const resultado = verificar(repo, 'Merge de algo');
    expect(resultado.codigo).toBe(0);
  });

  it('identifica rutas con espacios, tildes y "ñ"', () => {
    const repo = new RepoTemporal();
    repos.push(repo);
    const ruta = 'pruebas/año ñandú/cobro mensual.test.ts';
    repo.confirmar('Inicio', { [ruta]: PRUEBA });
    repo.escribir(ruta, `${PRUEBA}// cambio\n`);
    repo.git('add', '-A');
    const resultado = verificar(repo, 'Cambio normal');
    expect(resultado.codigo).toBe(1);
    expect(resultado.texto).toContain(ruta);
  });

  it('sin --mensaje termina en 2', () => {
    const repo = repoConBase();
    expect(repo.ejecutarScript(SCRIPT, ['--preparados']).codigo).toBe(2);
  });
});
