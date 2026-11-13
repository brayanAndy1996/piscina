// Ejecuta la CLI de Prisma del backend con el .env de la raíz. Sin shell, así funciona igual en Windows, Mac y Linux.
// Uso: node scripts/prisma.mjs [--pruebas] <comando de prisma...>
//   --pruebas   usa DATABASE_URL_PRUEBAS como DATABASE_URL (la base debe terminar en _pruebas)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { cargarEnv, leerUrlsBases, parametrosDeConexionProhibidos, raizProyecto } from './lib/entorno.mjs';

cargarEnv();

let argumentos = process.argv.slice(2);
const entorno = { ...process.env };

if (argumentos[0] === '--pruebas') {
  argumentos = argumentos.slice(1);
  try {
    leerUrlsBases(entorno);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  entorno.DATABASE_URL = entorno.DATABASE_URL_PRUEBAS;
}

// Criterio 143 (P-34): Prisma tampoco debe conectarse con un usuario, servidor o base distintos de los de la parte principal de
// la URL. Si la URL no es válida, la rechaza Prisma; el mensaje nombra la variable y los parámetros, nunca la URL ni sus valores.
{
  const variable = process.argv[2] === '--pruebas' ? 'DATABASE_URL_PRUEBAS' : 'DATABASE_URL';
  let prohibidos = [];
  try {
    if (entorno.DATABASE_URL) prohibidos = parametrosDeConexionProhibidos(entorno.DATABASE_URL);
  } catch {
    prohibidos = [];
  }
  if (prohibidos.length > 0) {
    console.error(
      `La variable ${variable} no puede llevar ${prohibidos.length === 1 ? 'el parámetro' : 'los parámetros'} ${prohibidos.join(', ')} en la cadena de consulta: el usuario, el servidor y la base van en la parte principal de la URL.`,
    );
    process.exit(1);
  }
}

if (argumentos.length === 0) {
  console.error('Indica el comando de Prisma. Ejemplo: node scripts/prisma.mjs migrate deploy');
  process.exit(1);
}

const requerir = createRequire(path.join(raizProyecto, 'backend', 'package.json'));
const paqueteJson = requerir.resolve('prisma/package.json');
const paquete = JSON.parse(fs.readFileSync(paqueteJson, 'utf8'));
const bin = typeof paquete.bin === 'string' ? paquete.bin : paquete.bin.prisma;
const cli = path.join(path.dirname(paqueteJson), bin);

const resultado = spawnSync(process.execPath, [cli, ...argumentos], {
  cwd: path.join(raizProyecto, 'backend'),
  env: entorno,
  stdio: 'inherit',
});
if (resultado.error) {
  console.error(`No se pudo ejecutar Prisma: ${resultado.error.message}`);
  process.exit(1);
}
process.exit(resultado.status ?? 1);
