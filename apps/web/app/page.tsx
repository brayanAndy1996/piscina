export const dynamic = 'force-dynamic';

async function getApiState(): Promise<string> {
  try {
    const url = new URL('/health/ready', process.env.API_URL ?? 'http://127.0.0.1:4000');
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const data: unknown = await response.json();
    if (response.ok && typeof data === 'object' && data !== null && 'status' in data && data.status === 'ready') {
      return 'API y PostgreSQL disponibles';
    }
  } catch { /* La pantalla sigue siendo utilizable cuando no responde la API. */ }
  return 'Servicio no disponible. Comprueba la API y PostgreSQL.';
}

export default async function Home() {
  const state = await getApiState();
  return <main><p><a href="/academia">Operación de academia</a> · <a href="/operacion">Cajas, cobros y asistencia</a> · <a href="/portal">Portal del alumno</a> · <a href="/inscripcion">Solicitud online</a></p>
    <h1>Academia de natación</h1>
    <p>Gestión de acceso disponible</p>
    <p><a href="/acceso">Iniciar sesión y administrar acceso</a></p>
    <section aria-labelledby="connection-title">
      <h2 id="connection-title">Estado del servicio</h2>
      <p role="status">{state}</p>
      <a href="/">Actualizar estado</a>
    </section>
    <p>Inscripciones, pagos y asistencia se incorporarán en las siguientes funcionalidades.</p>
  </main>;
}
