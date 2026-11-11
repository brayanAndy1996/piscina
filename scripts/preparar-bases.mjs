// Prepara las bases locales: crea las bases, migra la de desarrollo y la de pruebas, y ejecuta la semilla.
// Uso: npm run db:preparar
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const carpeta = path.dirname(fileURLToPath(import.meta.url));

const pasos = [
  ['Creando las bases de datos', ['crear-bases.mjs']],
  ['Migrando la base de desarrollo', ['prisma.mjs', 'migrate', 'deploy']],
  ['Migrando la base de pruebas', ['prisma.mjs', '--pruebas', 'migrate', 'deploy']],
  ['Ejecutando la semilla', ['prisma.mjs', 'db', 'seed']],
];

for (const [titulo, [script, ...argumentos]] of pasos) {
  console.log(`\n== ${titulo} ==`);
  const resultado = spawnSync(process.execPath, [path.join(carpeta, script), ...argumentos], { stdio: 'inherit' });
  if (resultado.error || resultado.status !== 0) {
    console.error(`\nFalló el paso: ${titulo}. Revisa el mensaje de arriba y vuelve a ejecutar: npm run db:preparar`);
    process.exit(resultado.status ?? 1);
  }
}
console.log('\nBases de datos listas.');
