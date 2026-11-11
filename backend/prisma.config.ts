import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// Un solo .env en la raíz del repositorio. Las variables ya definidas (por ejemplo, las de la CI) mandan.
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

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
