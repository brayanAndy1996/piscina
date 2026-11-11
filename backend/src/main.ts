import 'reflect-metadata';
import { crearApp } from './crear-app';
import { cargarEnvRaiz, ErrorEntorno, validarEntorno } from './infraestructura/entorno';

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

  const app = await crearApp(entorno);
  await app.listen(entorno.PUERTO_API);
}

void arrancar();
