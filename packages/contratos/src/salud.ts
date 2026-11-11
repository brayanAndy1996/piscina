import { z } from 'zod';

/** Estado de un componente: funciona (`ok`) o falló (`error`). */
export const estadoComponenteSchema = z.enum(['ok', 'error']);

/** Cuerpo de `GET /api/salud`: 200 cuando todo está bien, 503 cuando la base de datos no responde. */
export const respuestaSaludSchema = z.object({
  estado: estadoComponenteSchema,
  baseDatos: estadoComponenteSchema,
});

export type RespuestaSalud = z.infer<typeof respuestaSaludSchema>;
