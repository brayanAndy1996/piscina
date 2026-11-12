import 'reflect-metadata';
import { PinoLogger } from 'nestjs-pino';
import { crearApp } from './crear-app';
import { ErrorEntorno, retirarVariablesSensibles, validarEntorno } from './infraestructura/entorno';
import { cargarEnvRaiz } from './infraestructura/entorno/cargar-env';
import { errorParaRegistro } from './infraestructura/prisma';
import { crearManejadorDeRechazos } from './infraestructura/proceso/rechazos';

async function arrancar(): Promise<void> {
  cargarEnvRaiz();

  let entorno;
  try {
    entorno = validarEntorno(process.env);
  } catch (error) {
    if (error instanceof ErrorEntorno) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  // La API solo necesita DATABASE_URL_APP: las conexiones del dueño y las PG* salen del entorno del proceso (criterio 99).
  retirarVariablesSensibles(process.env);

  const app = await crearApp(entorno);
  await app.listen(entorno.PUERTO_API);

  // Criterio 157: ya atendiendo, una promesa rechazada que nadie maneja se registra y el proceso sigue (en Node 22 lo terminaría).
  // Se registra después de `listen`: un fallo al arrancar sigue terminando el proceso. No se toca `uncaughtException`.
  const registro = await app.resolve(PinoLogger);
  registro.setContext('Proceso');
  process.on('unhandledRejection', crearManejadorDeRechazos(registro));
}

arrancar().catch((error: unknown) => {
  // Criterio 157: un fallo al arrancar sigue terminando el proceso con error (antes lo hacía Node con el rechazo sin manejar).
  console.error('No se pudo arrancar la API.', errorParaRegistro(error)); // criterio 162: un error de la base, sin sus valores
  process.exit(1);
});
