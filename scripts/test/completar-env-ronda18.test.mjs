// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 173 (ataque ronda 18, F1 y F2; REEMPLAZA las viñetas "nunca agrega una variable que dotenv lee" y "aviso" del criterio 170;
// R18-3 aceptada por el orquestador), P-45: `completarEnv` y `npm run env:completar` dan por existente exactamente lo que lee
// `analizarEnv` (que es `dotenv.parse`); una variable que se agrega y que ademas parece definida en el `.env` (`clavesPosiblesEnv`) va
// en `ilegibles` (parte de `agregadas`) con un aviso sin su valor; y antes de escribir se comprueba que agregar al final no cambia como
// se lee lo que ya habia: si lo cambiara, se lanza un `Error` que nombra el `.env` y las variables (sin valores), no se escribe nada y el
// comando termina con codigo 1. Pruebas (c1) a (c5) del criterio; (c6) son los casos de (b1), (b2), (b3), (e8) y (b6) del criterio 170 de
// `completar-env-ronda17.test.mjs`, que no cambian de resultado.
// Con el codigo de `d8b5cdd`: (c1) ya pasaba (el dano estaba en `cargarEnv`); (c2) agregaba `DATABASE_URL` y `dotenv` daba `URL_5432`;
// (c3) no agregaba; (c4) escribia y `PUERTO_WEB` cambiaba en silencio; (c5) fallaba con algunos textos.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completarEnv } from '../completar-env.mjs';
import {
  CONJUNTO_D,
  EJEMPLO_REAL,
  NOMBRES_REALES,
  URL_5433,
  dotenv,
  raizReal,
  textosDelFuzz,
} from './ayuda-env-ronda18.mjs';

const SCRIPT = path.join(raizReal, 'scripts', 'completar-env.mjs');

const CLAVE_C3 = 'claveSecretaR18';
const URL_C3 = `postgresql://aquagestion:${CLAVE_C3}@127.0.0.1:5433/aquagestion`;

/** `.env.example` de prueba de (b4) del criterio 170: DATABASE_URL, PUERTO_API y JWT_SECRETO. */
const EJEMPLO_B = [
  '# Base de datos.',
  'DATABASE_URL=postgresql://aquagestion:aquagestion@127.0.0.1:5432/aquagestion',
  '',
  '# Puerto de la API.',
  'PUERTO_API=3000',
  '',
  '# Secreto de las sesiones.',
  'JWT_SECRETO=solo-desarrollo',
  '',
].join('\n');

/** `.env.example` de prueba de (c4): la linea de comentario justo antes de DATABASE_URL_APP termina con la comilla `q`. */
const ejemploC4 = (q) =>
  [
    '# Base de datos.',
    'DATABASE_URL=postgresql://aquagestion:aquagestion@127.0.0.1:5432/aquagestion',
    '',
    '# Puerto de la web.',
    'PUERTO_WEB=5173',
    '',
    `# Se crea con el comando de la guía ${q}`,
    'DATABASE_URL_APP=postgresql://aquagestion_app:aquagestion_app@127.0.0.1:5432/aquagestion',
    '',
  ].join('\n');

/** `.env` de (c4): DATABASE_URL y, como ultima linea y sin salto final, PUERTO_WEB con la comilla `q` sin cerrar. */
const envC4 = (q) => `DATABASE_URL=${URL_5433}\nPUERTO_WEB=${q}5173`;

describe('criterio 173: completarEnv y env:completar dan por existente lo que dotenv lee', () => {
  let carpeta;
  const ruta = (nombre) => path.join(carpeta, nombre);
  const bytesEnv = () => fs.readFileSync(ruta('.env'));
  const textoEnv = () => bytesEnv().toString('utf8');
  const escribir = (contenido) => fs.writeFileSync(ruta('.env'), contenido);
  const ejecutar = () => spawnSync(process.execPath, [SCRIPT, carpeta], { encoding: 'utf8' });
  const prepararEjemplo = (texto) => fs.writeFileSync(ruta('.env.example'), texto);

  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-env18-'));
    prepararEjemplo(EJEMPLO_REAL);
  });
  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  describe('(c1) reproduccion F1: (d1) a (d6) como .env (ya pasaba con d8b5cdd: el dano estaba en cargarEnv)', () => {
    const casos = CONJUNTO_D.slice(0, 6);

    it.each(casos)('%s: completarEnv da sin-cambios y el archivo queda byte a byte igual', (_nombre, texto) => {
      escribir(texto);
      const antes = Buffer.from(bytesEnv());

      const resultado = completarEnv(carpeta);

      expect(resultado).toEqual({ accion: 'sin-cambios', agregadas: [] });
      expect(bytesEnv().equals(antes)).toBe(true);
    });

    it.each(casos)(
      '%s como comando: codigo 0, dice que no hacia falta agregar nada y deja el archivo igual',
      (_nombre, texto) => {
        escribir(texto);
        const antes = Buffer.from(bytesEnv());

        const resultado = ejecutar();

        expect(resultado.status).toBe(0);
        expect(resultado.stdout).toMatch(/No hizo falta agregar nada/);
        expect(resultado.stdout).not.toContain('Se agregaron');
        expect(bytesEnv().equals(antes)).toBe(true);
      },
    );
  });

  describe('(c2) reproduccion F2: salto de linea entre la clave y el =', () => {
    const casos = CONJUNTO_D.slice(6);

    it('el conjunto tiene los dos textos de (d7)', () => {
      expect(casos).toHaveLength(2);
    });

    it.each(casos)('%s: sin-cambios, el archivo queda igual y dotenv.parse sigue dando URL_5433', (_nombre, texto) => {
      escribir(texto);
      const antes = Buffer.from(bytesEnv());

      const resultado = completarEnv(carpeta);

      expect(resultado).toEqual({ accion: 'sin-cambios', agregadas: [] });
      expect(bytesEnv().equals(antes)).toBe(true);
      expect(dotenv.parse(textoEnv())['DATABASE_URL']).toBe(URL_5433);
    });

    it.each(casos)(
      '%s como comando: codigo 0, no agrega nada y dotenv.parse sigue dando URL_5433',
      (_nombre, texto) => {
        escribir(texto);
        const antes = Buffer.from(bytesEnv());

        const resultado = ejecutar();

        expect(resultado.status).toBe(0);
        expect(resultado.stdout).toMatch(/No hizo falta agregar nada/);
        expect(resultado.stdout).not.toContain('Se agregaron');
        expect(bytesEnv().equals(antes)).toBe(true);
        expect(dotenv.parse(textoEnv())['DATABASE_URL']).toBe(URL_5433);
      },
    );
  });

  describe('(c3) lineas que no lee nadie: se agrega la variable y se avisa de la linea', () => {
    beforeEach(() => {
      prepararEjemplo(EJEMPLO_B);
    });

    const CONJUNTO_C3 = [
      ['dos puntos sin espacio despues', `PUERTO_API=1\nJWT_SECRETO=x\nDATABASE_URL:${URL_C3}\n`],
      ['espacio antes de los dos puntos', `PUERTO_API=1\nJWT_SECRETO=x\nDATABASE_URL :${URL_C3}\n`],
      ['espacio antes y despues de los dos puntos', `PUERTO_API=1\nJWT_SECRETO=x\nDATABASE_URL : ${URL_C3}\n`],
      [
        'valor entre comillas dobles en varias lineas con la linea DATABASE_URL=dentro',
        'JWT_SECRETO="uno\nDATABASE_URL=dentro\nfin"\nPUERTO_API=1\n',
      ],
    ];

    it.each(CONJUNTO_C3)('%s: dotenv.parse no da DATABASE_URL (comprobacion previa)', (_nombre, texto) => {
      expect(Object.keys(dotenv.parse(texto))).not.toContain('DATABASE_URL');
    });

    it.each(CONJUNTO_C3)(
      '%s: agregadas e ilegibles son [DATABASE_URL], el archivo empieza con los bytes de antes y dotenv da la DATABASE_URL de .env.example',
      (_nombre, texto) => {
        escribir(texto);
        const antes = Buffer.from(bytesEnv());
        const valoresAntes = dotenv.parse(texto);

        const resultado = completarEnv(carpeta);

        expect(resultado).toEqual({
          accion: 'completado',
          agregadas: ['DATABASE_URL'],
          ilegibles: ['DATABASE_URL'],
        });
        expect(bytesEnv().subarray(0, antes.length).equals(antes)).toBe(true);
        const despues = dotenv.parse(textoEnv());
        expect(despues['DATABASE_URL']).toBe(dotenv.parse(EJEMPLO_B)['DATABASE_URL']);
        for (const clave of Object.keys(valoresAntes))
          expect(despues[clave], `valor de ${clave}`).toBe(valoresAntes[clave]);
      },
    );

    it.each(CONJUNTO_C3)(
      '%s como comando: codigo 0, dice "Se agregaron", nombra DATABASE_URL en una linea mas y no muestra la URL ni su clave',
      (_nombre, texto) => {
        escribir(texto);
        const antes = Buffer.from(bytesEnv());

        const resultado = ejecutar();

        expect(resultado.status).toBe(0);
        expect(resultado.stdout).toContain('Se agregaron');
        const lineasConLaVariable = resultado.stdout.split(/\r?\n/).filter((linea) => linea.includes('DATABASE_URL'));
        const avisos = lineasConLaVariable.filter((linea) => !linea.includes('Se agregaron'));
        expect(
          avisos.length,
          'debe haber una linea de aviso que nombre DATABASE_URL, ademas de la de "Se agregaron"',
        ).toBeGreaterThanOrEqual(1);
        const salida = `${resultado.stdout}\n${resultado.stderr}`;
        expect(salida).not.toContain(URL_C3);
        expect(salida).not.toContain(CLAVE_C3);
        expect(salida).not.toContain(URL_5433);
        expect(bytesEnv().subarray(0, antes.length).equals(antes)).toBe(true);
      },
    );
  });

  describe('(c4) comprobacion antes de escribir: si agregar al final cambiaria como se lee lo que habia, no escribe', () => {
    const COMILLAS = [
      ['comilla invertida', '`'],
      ['comillas dobles', '"'],
    ];

    it.each(COMILLAS)(
      '%s: comprobacion previa: agregando el bloque a mano, dotenv.parse cambia el valor de PUERTO_WEB',
      (_nombre, q) => {
        const env = envC4(q);
        const bloque = `\n\n# Se crea con el comando de la guía ${q}\nDATABASE_URL_APP=postgresql://aquagestion_app:aquagestion_app@127.0.0.1:5432/aquagestion\n`;

        const antes = dotenv.parse(env)['PUERTO_WEB'];
        const despues = dotenv.parse(env + bloque)['PUERTO_WEB'];

        expect(Object.keys(dotenv.parse(env)).sort()).toEqual(['DATABASE_URL', 'PUERTO_WEB']);
        expect(
          despues,
          'la comprobacion previa no reproduce el ataque: agregar el bloque no cambia PUERTO_WEB (el test-writer se detiene e informa)',
        ).not.toBe(antes);
      },
    );

    it.each(COMILLAS)(
      '%s: completarEnv lanza un Error que contiene .env y PUERTO_WEB y no contiene 5173; el archivo queda byte a byte igual',
      (_nombre, q) => {
        prepararEjemplo(ejemploC4(q));
        escribir(envC4(q));
        const antes = Buffer.from(bytesEnv());

        let error;
        try {
          completarEnv(carpeta);
        } catch (e) {
          error = e;
        }

        expect(error, 'completarEnv debe lanzar cuando agregar cambiaria la lectura de PUERTO_WEB').toBeInstanceOf(
          Error,
        );
        expect(error.message).toContain('.env');
        expect(error.message).toContain('PUERTO_WEB');
        expect(error.message).not.toContain('5173');
        expect(error.message).not.toContain(URL_5433);
        expect(bytesEnv().equals(antes)).toBe(true);
      },
    );

    it.each(COMILLAS)('%s como comando: codigo 1 con ese mensaje y el archivo queda igual', (_nombre, q) => {
      prepararEjemplo(ejemploC4(q));
      escribir(envC4(q));
      const antes = Buffer.from(bytesEnv());

      const resultado = ejecutar();

      expect(resultado.status).toBe(1);
      expect(resultado.stderr).toContain('.env');
      expect(resultado.stderr).toContain('PUERTO_WEB');
      expect(`${resultado.stdout}\n${resultado.stderr}`).not.toContain('5173');
      expect(resultado.stdout).not.toContain('Se agregaron');
      expect(bytesEnv().equals(antes)).toBe(true);
    });

    it('con la comilla cerrada en su linea el mismo .env.example agrega sin error (la comprobacion no rechaza de mas)', () => {
      prepararEjemplo(ejemploC4('`'));
      escribir(`DATABASE_URL=${URL_5433}\nPUERTO_WEB=5173\n`);

      const resultado = completarEnv(carpeta);

      expect(resultado.agregadas).toEqual(['DATABASE_URL_APP']);
      expect(dotenv.parse(textoEnv())['PUERTO_WEB']).toBe('5173');
    });
  });

  describe('(c5) fuzz: los primeros 3000 textos de (f) como .env', () => {
    it('o completarEnv lanza el error de (c4) y el archivo queda igual, o agrega exactamente lo que dotenv no leia y no cambia nada mas', () => {
      const textos = textosDelFuzz().slice(0, 3000);
      const delEjemplo = dotenv.parse(EJEMPLO_REAL);
      const fallos = [];
      let lanzaron = 0;
      let completaron = 0;
      let sinCambios = 0;

      for (const texto of textos) {
        escribir(texto);
        const bytesAntes = Buffer.from(bytesEnv());
        const antes = dotenv.parse(texto);
        const mostrar = JSON.stringify(texto);
        let resultado;
        let error;
        try {
          resultado = completarEnv(carpeta);
        } catch (e) {
          error = e;
        }

        if (error) {
          lanzaron += 1;
          const ok =
            error instanceof Error &&
            error.message.includes('.env') &&
            !error.message.includes('UTF-8') &&
            bytesEnv().equals(bytesAntes);
          if (!ok)
            fallos.push(`${mostrar}: lanzo un error que no es el de la comprobacion o escribio (${error?.message})`);
          continue;
        }

        const agregadas = resultado.agregadas;
        const esperadas = NOMBRES_REALES.filter((nombre) => !Object.hasOwn(antes, nombre));
        if (agregadas.some((nombre) => Object.hasOwn(antes, nombre))) {
          fallos.push(`${mostrar}: agrego una variable que dotenv ya leia`);
        }
        if (JSON.stringify([...agregadas].sort()) !== JSON.stringify([...esperadas].sort())) {
          fallos.push(
            `${mostrar}: agregadas ${JSON.stringify(agregadas)} no son las que faltaban ${JSON.stringify(esperadas)}`,
          );
        }
        if (resultado.ilegibles && !resultado.ilegibles.every((nombre) => agregadas.includes(nombre))) {
          fallos.push(`${mostrar}: ilegibles no es parte de agregadas`);
        }
        const despues = dotenv.parse(textoEnv());
        const deseado = { ...antes };
        for (const nombre of agregadas) deseado[nombre] = delEjemplo[nombre];
        if (JSON.stringify(Object.entries(despues).sort()) !== JSON.stringify(Object.entries(deseado).sort())) {
          fallos.push(`${mostrar}: dotenv.parse(despues) no es dotenv.parse(antes) mas las agregadas`);
        }
        if (!bytesEnv().subarray(0, bytesAntes.length).equals(bytesAntes)) {
          fallos.push(`${mostrar}: los bytes de antes no quedaron al principio`);
        }
        if (agregadas.length === 0) {
          sinCambios += 1;
          if (!bytesEnv().equals(bytesAntes)) fallos.push(`${mostrar}: sin agregar nada, el archivo cambio`);
        } else {
          completaron += 1;
        }
      }

      expect(
        fallos.length,
        `${fallos.length} de ${textos.length} textos del fuzz fallan (lanzaron ${lanzaron}, completaron ${completaron}, sin cambios ${sinCambios}); primeros: ${fallos.slice(0, 5).join(' ; ')}`,
      ).toBe(0);
    }, 60_000);
  });
});
