import type { Diagnostic } from './diagnostic-schema';

export async function checkApi(baseUrl: string | undefined): Promise<Diagnostic> {
  if (!baseUrl) throw new Error('Configura EXPO_PUBLIC_API_URL para consultar la API.');
  const url = new URL('/health/ready', baseUrl);
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('La dirección de API debe ser HTTP(S), sin credenciales.');
  }
  if (!__DEV__ && url.protocol !== 'https:') {
    throw new Error('La aplicación distribuida requiere HTTPS.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('service' in data) || data.service !== 'piscina-api' ||
        !('status' in data) || !((response.status === 200 && data.status === 'ready') ||
        (response.status === 503 && data.status === 'unavailable'))) {
      throw new Error('Respuesta de API no reconocida.');
    }
    return { status: data.status as Diagnostic['status'], checked_at: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}
