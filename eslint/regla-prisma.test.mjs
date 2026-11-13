// spec: 001-academias-aislamiento (pruebas protegidas)
// Criterio 28: los módulos solo llegan a la base a través de BaseDatos. `npm run lint` falla si un archivo de
// backend/src/ fuera de infraestructura/prisma/ y de cli/ importa un valor (no un tipo) de generated/prisma o importa
// PrismaService. Se prueba con el eslint.config.mjs real, sin información de tipos.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// La configuración real exige información de tipos, que no existe para archivos que no están en disco: se desactiva
// solo eso, y se conservan todas las demás reglas del repositorio.
const eslint = new ESLint({
  cwd: raiz,
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

async function importacionesRestringidas(codigo, archivo) {
  const [resultado] = await eslint.lintText(codigo, { filePath: path.join(raiz, archivo) });
  const fatales = resultado.messages.filter((mensaje) => mensaje.fatal);
  expect(fatales, `error al analizar ${archivo}`).toEqual([]);
  // Efecto observable: un error de ESLint sobre una de las líneas de importación cuyo texto mencione BaseDatos. No se
  // fija el nombre de la regla, que la spec no define; solo se descartan las de variables sin uso, que también
  // pueden nombrar lo importado.
  const lineasDeImportacion = codigo.split('\n').length;
  return resultado.messages.filter(
    (mensaje) =>
      mensaje.severity === 2 &&
      mensaje.line <= lineasDeImportacion &&
      /BaseDatos/.test(mensaje.message) &&
      !/unused/.test(mensaje.ruleId ?? ''),
  );
}

const MODULO = 'backend/src/modulos/ejemplo/ejemplo.service.ts';

describe('criterio 28: regla de importaciones de Prisma', () => {
  it.each([
    ['PrismaClient desde el cliente generado', "import { PrismaClient } from '../../generated/prisma/client';"],
    ['Prisma (valor) desde el cliente generado', "import { Prisma } from '../../generated/prisma/client';"],
    ['un enum del cliente generado', "import { EstadoAcademia } from '../../generated/prisma/enums';"],
    ['todo el cliente generado con *', "import * as Prisma from '../../generated/prisma/client';"],
    ['PrismaService', "import { PrismaService } from '../../infraestructura/prisma/prisma.service';"],
    ['PrismaClient junto con un tipo', "import { PrismaClient, type Prisma } from '../../generated/prisma/client';"],
  ])('criterio 28: rechaza importar %s en un módulo', async (_nombre, codigo) => {
    const mensajes = await importacionesRestringidas(codigo, MODULO);

    expect(mensajes.length, 'la regla no rechazó la importación').toBeGreaterThan(0);
  });

  it.each([
    ['un tipo de Prisma', "import type { Prisma } from '../../generated/prisma/client';"],
    ['un tipo en línea', "import { type Prisma } from '../../generated/prisma/client';"],
    ['varios tipos en línea', "import { type Prisma, type PrismaClient } from '../../generated/prisma/client';"],
    ['BaseDatos', "import { BaseDatos } from '../../infraestructura/prisma';"],
    ['otro módulo cualquiera', "import { Injectable } from '@nestjs/common';"],
  ])('criterio 28: permite importar %s en un módulo', async (_nombre, codigo) => {
    expect(await importacionesRestringidas(codigo, MODULO)).toEqual([]);
  });

  it.each([
    ['la carpeta de Prisma de la infraestructura', 'backend/src/infraestructura/prisma/base-datos.ts'],
    ['PrismaService dentro de su carpeta', 'backend/src/infraestructura/prisma/prisma.service.ts'],
    ['los comandos', 'backend/src/cli/superadmin.ts'],
  ])('criterio 28: no se aplica en %s', async (_nombre, archivo) => {
    const codigo = [
      "import { PrismaClient } from '../../generated/prisma/client';",
      "import { PrismaService } from './prisma.service';",
    ].join('\n');

    expect(await importacionesRestringidas(codigo, archivo)).toEqual([]);
  });

  it.each([
    ['una prueba dentro de backend/src', 'backend/src/modulos/ejemplo/ejemplo.service.test.ts'],
    ['las pruebas de integración', 'backend/test/integracion/ejemplo.test.ts'],
    ['las utilidades de prueba', 'backend/test/utilidades/ejemplo.ts'],
  ])('criterio 28: no se aplica en %s', async (_nombre, archivo) => {
    const codigo = "import { PrismaClient } from '../../src/generated/prisma/client';";

    expect(await importacionesRestringidas(codigo, archivo)).toEqual([]);
  });
});
