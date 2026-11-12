// Comando `npm run plataforma:superadmin` (spec 001, criterios 33 a 35 y 46): crea el superadmin de la plataforma o,
// si el correo ya existe, restablece su contraseña. Lee SUPERADMIN_CORREO, SUPERADMIN_NOMBRE, SUPERADMIN_CLAVE y
// DATABASE_URL del entorno o del .env (las del entorno mandan). Nunca imprime la contraseña.
import { RelojSistema } from '../infraestructura/reloj/reloj-sistema';
import { hashearClave } from '../infraestructura/seguridad/claves';
import {
  cargarEnvDeLaRaiz,
  crearClienteDelDueno,
  enPlataforma,
  leerVariable,
  problemaDeUrlDeConexion,
} from './conexion';
import { mensajeSeguro } from './mensaje-seguro';
import { guardarSuperadmin, leerDatosSuperadmin } from './superadmin-datos';

async function ejecutar(): Promise<number> {
  cargarEnvDeLaRaiz();

  const lectura = leerDatosSuperadmin(process.env);
  const problemas = lectura.ok ? [] : [...lectura.problemas];
  const urlBase = leerVariable(process.env, 'DATABASE_URL');
  if (urlBase === undefined) problemas.push('Falta la variable DATABASE_URL.');
  else {
    const problemaUrl = problemaDeUrlDeConexion(urlBase, 'DATABASE_URL');
    if (problemaUrl) problemas.push(problemaUrl);
  }
  if (!lectura.ok || urlBase === undefined || problemas.length > 0) {
    console.error(`No se hizo ningún cambio. Corrige la configuración:\n${problemas.map((p) => `- ${p}`).join('\n')}`);
    return 1;
  }

  const { datos } = lectura;
  const cliente = crearClienteDelDueno(urlBase);
  try {
    const claveHash = await hashearClave(datos.clave);
    const ahora = new RelojSistema().ahora();
    const resultado = await enPlataforma(cliente, (tx) =>
      guardarSuperadmin(tx, datos, claveHash, ahora, { restablecer: true }),
    );
    console.log(
      resultado === 'CREADO'
        ? `Superadmin creado: ${datos.correo}`
        : `Contraseña del superadmin restablecida: ${datos.correo}`,
    );
    return 0;
  } catch (error) {
    console.error(`No se pudo guardar el superadmin: ${mensajeSeguro(error, [datos.clave, urlBase])}`);
    return 1;
  } finally {
    await cliente.$disconnect().catch(() => undefined);
  }
}

ejecutar().then(
  (codigo) => {
    process.exitCode = codigo;
  },
  () => {
    console.error('No se pudo guardar el superadmin por un error inesperado.');
    process.exitCode = 1;
  },
);
