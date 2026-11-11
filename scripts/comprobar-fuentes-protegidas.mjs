// Comprobación previa del paso protegido del lint (spec 001, criterios 111 y 118, precisión P-28): `npm run lint:protegido` la
// ejecuta antes de ESLint. Falla con código 1, nombrando cada ruta, si:
//   - hay un enlace simbólico (o unión de Windows) en cualquier nivel de `backend/src/` o de `packages/contratos/src/`;
//   - `git ls-files -- backend/src/generated` lista algún archivo (esa carpeta está en `.gitignore` y la crea `prisma generate`);
//   - dentro de `backend/src/generated/` hay algo que no sea la carpeta `prisma/`.
// Si `git` no está disponible, falla diciendo el motivo. Solo usa módulos de Node: funciona igual en Windows, Mac y Linux.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entradasAjenasEnGenerated, enlacesSimbolicos } from './lib/fuentes-protegidas.mjs';
import { ejecutarGit, listaNul } from './lib/git.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problemas = [];

for (const ruta of enlacesSimbolicos([
  path.join(raiz, 'backend', 'src'),
  path.join(raiz, 'packages', 'contratos', 'src'),
])) {
  problemas.push(`Enlace simbólico no permitido: ${path.relative(raiz, ruta)}`);
}

const resultado = ejecutarGit(['ls-files', '-z', '--', 'backend/src/generated'], { cwd: raiz });
if (resultado.estado !== 0) {
  problemas.push(
    `No se pudo ejecutar git para comprobar backend/src/generated (¿está instalado git?): ${resultado.errorTexto || 'git no terminó bien'}`,
  );
} else {
  for (const ruta of listaNul(resultado.salida)) {
    problemas.push(`Archivo de backend/src/generated en git (la carpeta se genera, no se versiona): ${ruta}`);
  }
}

for (const ruta of entradasAjenasEnGenerated(path.join(raiz, 'backend', 'src', 'generated'))) {
  problemas.push(
    `Entrada ajena en backend/src/generated (solo se admite la carpeta prisma/): ${path.relative(raiz, ruta)}`,
  );
}

if (problemas.length > 0) {
  console.error(problemas.join('\n'));
  process.exitCode = 1;
}
