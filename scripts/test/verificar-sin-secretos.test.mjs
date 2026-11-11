// Pruebas de la verificación de archivos de secretos en git (spec 000, criterio 5), con repositorios temporales.
import { afterEach, describe, expect, it } from 'vitest';
import { buscarArchivosSecretos } from '../verificar-sin-secretos.mjs';
import { RepoTemporal } from './ayuda-git.mjs';

const SCRIPT = 'verificar-sin-secretos.mjs';

describe('buscarArchivosSecretos', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    '.env.test',
    'backend/.env',
    'a/b/c/.env.desarrollo',
    'certificados/clave.pem',
    'sunat/firma.key',
    'sunat/certificado.p12',
    'sunat/certificado.pfx',
    'CLAVE.PEM',
    'carpeta con espacios/año.key',
  ])('prohíbe %s', (ruta) => {
    expect(buscarArchivosSecretos([ruta])).toEqual([ruta]);
  });

  it.each([
    '.env.example',
    'backend/.env.example',
    'README.md',
    'env.ts',
    'src/entorno.env.ts',
    'docs/pem.md',
    'src/keyboard.ts',
    'carpeta.pem/archivo.ts',
    '.envrc.md',
  ])('permite %s', (ruta) => {
    expect(buscarArchivosSecretos([ruta])).toEqual([]);
  });
});

describe('verificar-sin-secretos (repositorio temporal)', () => {
  /** @type {RepoTemporal[]} */
  const repos = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.limpiar();
  });

  function repoNuevo(archivos) {
    const repo = new RepoTemporal();
    repos.push(repo);
    repo.confirmar('Inicio', archivos);
    return repo;
  }

  it('termina en 0 si solo está .env.example', () => {
    const repo = repoNuevo({ '.env.example': 'A=1\n', 'src/a.ts': 'export {};\n' });
    const resultado = repo.ejecutarScript(SCRIPT);
    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toContain('Sin archivos de secretos');
  });

  it('termina en 1 y lista los archivos prohibidos, en cualquier carpeta', () => {
    const repo = repoNuevo({
      '.env.example': 'A=1\n',
      '.env': 'SECRETO=1\n',
      'backend/.env.produccion': 'SECRETO=2\n',
      'certificados/año nuevo/clave.pem': 'x\n',
      'sunat/firma.pfx': 'x\n',
      'sunat/firma.p12': 'x\n',
      'sunat/firma.key': 'x\n',
      'README.md': 'hola\n',
    });
    const resultado = repo.ejecutarScript(SCRIPT);
    expect(resultado.codigo).toBe(1);
    for (const ruta of [
      '.env',
      'backend/.env.produccion',
      'certificados/año nuevo/clave.pem',
      'sunat/firma.pfx',
      'sunat/firma.p12',
      'sunat/firma.key',
    ]) {
      expect(resultado.error).toContain(ruta);
    }
    expect(resultado.error).not.toContain('README.md');
    expect(resultado.error).not.toContain('- .env.example');
  });

  it('mira el índice y no los archivos sin seguimiento', () => {
    const repo = repoNuevo({ 'src/a.ts': 'export {};\n' });
    repo.escribir('.env', 'SECRETO=1\n');
    expect(repo.ejecutarScript(SCRIPT).codigo).toBe(0);
    repo.git('add', '-f', '.env');
    expect(repo.ejecutarScript(SCRIPT).codigo).toBe(1);
  });

  it('fuera de un repositorio git termina en 2', () => {
    const repo = new RepoTemporal();
    repos.push(repo);
    // Sin la carpeta .git, el directorio temporal ya no es un repositorio.
    repo.limpiarGit();
    const resultado = repo.ejecutarScript(SCRIPT);
    expect(resultado.codigo).toBe(2);
  });
});
