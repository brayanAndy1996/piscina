import 'reflect-metadata';
import { crearApp } from './crear-app';
import { ErrorEntorno, retirarVariablesSensibles, validarEntorno } from './infraestructura/entorno';
import { cargarEnvRaiz } from './infraestructura/entorno/cargar-env';

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
}

void arrancar();
