import { defineConfig } from 'tsup';

// ESM para Vite y Vitest; CommonJS para NestJS (que compila a CommonJS). Ver plan.md de la historia 000.
export default defineConfig((opciones) => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  // En modo observación (`npm run dev`) no se limpia `dist`: la API y la web ya lo están leyendo.
  clean: !opciones.watch,
  sourcemap: true,
  target: 'es2023',
  // Los archivos de prueba no forman parte del paquete.
  ignoreWatch: ['**/*.test.ts'],
}));
