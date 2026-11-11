import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completarEnv, leerBloques } from '../completar-env.mjs';

const raizReal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(raizReal, 'scripts', 'completar-env.mjs');

const EJEMPLO = `# Cabecera del archivo.

# Base de datos.
DATABASE_URL=postgresql://u:p@127.0.0.1:5432/base

# Puerto de la API.
# En línea aparte de la variable.
PUERTO_API=3000

# Opcional, comentada en el ejemplo.
# POOL=10

# --- Historia nueva ---

# Secreto de las sesiones.
JWT_SECRETO=solo-desarrollo
# Otro dato.
OTRO=valor con espacios
`;

describe('completar-env (criterio 63)', () => {
  let carpeta;
  const ruta = (nombre) => path.join(carpeta, nombre);
  const leerEnv = () => fs.readFileSync(ruta('.env'), 'utf8');

  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-env-'));
    fs.writeFileSync(ruta('.env.example'), EJEMPLO);
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  describe('leerBloques', () => {
    it('devuelve cada variable activa con los comentarios que la preceden, en orden', () => {
      expect(leerBloques(EJEMPLO)).toEqual([
        { nombre: 'DATABASE_URL', lineas: ['# Base de datos.', 'DATABASE_URL=postgresql://u:p@127.0.0.1:5432/base'] },
        {
          nombre: 'PUERTO_API',
          lineas: ['# Puerto de la API.', '# En línea aparte de la variable.', 'PUERTO_API=3000'],
        },
        { nombre: 'JWT_SECRETO', lineas: ['# Secreto de las sesiones.', 'JWT_SECRETO=solo-desarrollo'] },
        { nombre: 'OTRO', lineas: ['# Otro dato.', 'OTRO=valor con espacios'] },
      ]);
    });

    it('ignora las variables comentadas y entiende los saltos de línea de Windows', () => {
      const bloques = leerBloques('# Una.\r\nUNA=1\r\n\r\n# DOS=2\r\n');
      expect(bloques).toEqual([{ nombre: 'UNA', lineas: ['# Una.', 'UNA=1'] }]);
    });
  });

  it('sin .env, lo crea copiando .env.example', () => {
    const resultado = completarEnv(carpeta);

    expect(resultado.accion).toBe('creado');
    expect(resultado.agregadas).toEqual(['DATABASE_URL', 'PUERTO_API', 'JWT_SECRETO', 'OTRO']);
    expect(leerEnv()).toBe(EJEMPLO);
  });

  it('agrega al final solo lo que falta, con su comentario, sin tocar ni reordenar lo existente', () => {
    const existente = '# Mi configuración\nPUERTO_API=4000\nDATABASE_URL=postgresql://yo:mia@localhost/mi_base\n';
    fs.writeFileSync(ruta('.env'), existente);

    const resultado = completarEnv(carpeta);

    expect(resultado).toEqual({ accion: 'completado', agregadas: ['JWT_SECRETO', 'OTRO'] });
    const nuevo = leerEnv();
    expect(nuevo.startsWith(existente)).toBe(true);
    expect(nuevo.slice(existente.length)).toBe(
      '\n# Secreto de las sesiones.\nJWT_SECRETO=solo-desarrollo\n\n# Otro dato.\nOTRO=valor con espacios\n',
    );
    expect(nuevo).not.toContain('\r');
  });

  it('agrega un salto de línea si el .env no terminaba en uno', () => {
    fs.writeFileSync(ruta('.env'), 'PUERTO_API=3000\nDATABASE_URL=a\nJWT_SECRETO=x\nOTRO=y');

    completarEnv(carpeta);

    expect(leerEnv()).toBe('PUERTO_API=3000\nDATABASE_URL=a\nJWT_SECRETO=x\nOTRO=y');
  });

  it('no sobrescribe una variable existente aunque esté vacía o tenga otro valor', () => {
    fs.writeFileSync(ruta('.env'), 'DATABASE_URL=\nPUERTO_API=1\nJWT_SECRETO=propio\n');

    const resultado = completarEnv(carpeta);

    expect(resultado.agregadas).toEqual(['OTRO']);
    expect(leerEnv()).toContain('DATABASE_URL=\nPUERTO_API=1\nJWT_SECRETO=propio\n');
    expect(leerEnv().match(/DATABASE_URL=/g)).toHaveLength(1);
  });

  it('si no falta nada, lo dice y no escribe', () => {
    fs.writeFileSync(ruta('.env'), 'DATABASE_URL=a\r\nPUERTO_API=b\r\nJWT_SECRETO=c\r\nOTRO=d\r\n');
    const antes = leerEnv();

    const resultado = completarEnv(carpeta);

    expect(resultado).toEqual({ accion: 'sin-cambios', agregadas: [] });
    expect(leerEnv()).toBe(antes);
  });

  it('repetirlo no duplica nada', () => {
    fs.writeFileSync(ruta('.env'), 'DATABASE_URL=a\n');
    completarEnv(carpeta);
    const primero = leerEnv();

    expect(completarEnv(carpeta).accion).toBe('sin-cambios');
    expect(leerEnv()).toBe(primero);
  });

  it('falla con un mensaje claro si no existe .env.example', () => {
    fs.rmSync(ruta('.env.example'));
    expect(() => completarEnv(carpeta)).toThrow(/\.env\.example/);
  });

  describe('como comando', () => {
    const ejecutar = () => spawnSync(process.execPath, [SCRIPT, carpeta], { encoding: 'utf8' });

    it('informa los nombres agregados', () => {
      fs.writeFileSync(ruta('.env'), 'DATABASE_URL=a\nPUERTO_API=3\n');

      const resultado = ejecutar();

      expect(resultado.status).toBe(0);
      expect(resultado.stdout).toContain('JWT_SECRETO, OTRO');
      expect(resultado.stdout).not.toContain('solo-desarrollo');
    });

    it('dice que no hizo falta agregar nada', () => {
      fs.writeFileSync(ruta('.env'), EJEMPLO);

      const resultado = ejecutar();

      expect(resultado.status).toBe(0);
      expect(resultado.stdout).toContain('ya tiene todas las variables');
    });

    it('informa que creó el .env cuando no había', () => {
      const resultado = ejecutar();

      expect(resultado.status).toBe(0);
      expect(resultado.stdout).toContain('se creó');
      expect(leerEnv()).toBe(EJEMPLO);
    });

    it('termina con código 1 si falta .env.example', () => {
      fs.rmSync(ruta('.env.example'));

      const resultado = ejecutar();

      expect(resultado.status).toBe(1);
      expect(resultado.stderr).toContain('.env.example');
    });
  });

  it('el .env.example real tiene las variables de la 001 como variables activas', () => {
    const nombres = leerBloques(fs.readFileSync(path.join(raizReal, '.env.example'), 'utf8')).map((b) => b.nombre);
    for (const nombre of [
      'DATABASE_URL_APP',
      'JWT_SECRETO',
      'SUPERADMIN_CORREO',
      'SUPERADMIN_NOMBRE',
      'SUPERADMIN_CLAVE',
    ]) {
      expect(nombres).toContain(nombre);
    }
    expect(nombres).not.toContain('DATABASE_POOL_MAX');
  });
});
