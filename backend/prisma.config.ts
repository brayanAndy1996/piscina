import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';
import { opcionesDotenv } from './src/infraestructura/entorno/opciones-dotenv';

// Un solo .env en la raíz del repositorio. Las variables ya definidas (por ejemplo, las de la CI) mandan.
dotenv.config(opcionesDotenv(path.resolve(__dirname, '..', '.env')));

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // No se usa env() de Prisma: se leería aunque el comando no necesite la base (por ejemplo, `prisma generate`).
    url: process.env.DATABASE_URL ?? '',
  },
});
