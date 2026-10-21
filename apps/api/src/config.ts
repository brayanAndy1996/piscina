export interface ApiConfig {
  host: string;
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  corsOrigins: string[];
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.API_PORT ?? '4000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT debe ser un puerto válido.');
  }
  const databaseUrl = env.API_DATABASE_URL;
  try {
    if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error('API_DATABASE_URL debe configurar PostgreSQL.');
  }
  const databaseSsl = env.API_DATABASE_SSL ?? (env.NODE_ENV === 'production' ? 'require' : 'disable');
  if (!['require', 'disable'].includes(databaseSsl)) {
    throw new Error('API_DATABASE_SSL debe ser require o disable.');
  }
  if (env.NODE_ENV === 'production' && databaseSsl !== 'require') {
    throw new Error('PostgreSQL requiere TLS en producción.');
  }
  const corsOrigins = (env.API_CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',').map((value) => value.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin ||
          (env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) throw new Error();
    } catch {
      throw new Error('API_CORS_ORIGINS debe contener orígenes HTTP(S) válidos; HTTPS en producción.');
    }
  }
  return { host: env.API_HOST ?? '127.0.0.1', port, databaseUrl: databaseUrl!, databaseSsl: databaseSsl === 'require', corsOrigins };
}
