// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { urlAppPruebas } from '../../utilidades/base-datos';
import { obtenerBaseDatos } from '../../utilidades/modulos';
import { cargarFuncionalidad } from '../../utilidades/ronda3';

// Criterio 143 (ataque ronda 8, O1; AMPLIA el criterio 5), parte de integracion de la API: dada la `DATABASE_URL_APP` de pruebas mas alguno
// de `user`, `host`, `hostaddr`, `password`, `port`, `dbname` o `database` en la cadena de consulta (decodificado, sin distinguir
// mayusculas, con cualquier valor, tambien vacio, en cualquier posicion y aunque se repita), `validarEntorno` lanza `ErrorEntorno` y la API
// no arranca (no se crea la aplicacion, y por lo tanto no se abre ninguna conexion). El mensaje nombra `DATABASE_URL_APP` y el parametro, y
// nunca la URL, el valor del parametro ni la contrasena. `options` y `sslmode` siguen permitidos. La prueba unitaria de `validarEntorno`
// esta en `backend/src/infraestructura/entorno/entorno-ronda8.test.ts`.

const VALOR = 'valor-reconocible-r8';
const LISTA = ['user', 'host', 'hostaddr', 'password', 'port', 'dbname', 'database'] as const;

interface ModuloEntorno {
  ErrorEntorno: new (problemas: readonly string[]) => Error & { problemas: readonly string[] };
}
const cargarEntorno = (): Promise<ModuloEntorno> =>
  cargarFuncionalidad<ModuloEntorno>('infraestructura/entorno/entorno.ts', ['ErrorEntorno']);

const conConsulta = (url: string, consulta: string): string => `${url}${url.includes('?') ? '&' : '?'}${consulta}`;

/** La API de pruebas con esa `DATABASE_URL_APP`: debe rechazarse con `ErrorEntorno` que nombra la variable y el parametro. */
async function debeNoArrancar(consulta: string, parametro: string, valor: string | undefined = VALOR): Promise<void> {
  const { ErrorEntorno } = await cargarEntorno();
  const url = conConsulta(urlAppPruebas(), consulta);

  const error: unknown = await crearAppDePruebas({
    nivelRegistro: 'silent',
    variables: { DATABASE_URL_APP: url },
  }).then(
    async (app) => {
      await app.close();
      return undefined;
    },
    (rechazo: unknown) => rechazo,
  );

  expect(error, 'la API no debia arrancar con esa DATABASE_URL_APP').toBeInstanceOf(ErrorEntorno);
  const { message, problemas } = error as { message: string; problemas: readonly string[] };
  const texto = `${message}\n${problemas.join('\n')}`;
  expect(texto, 'el mensaje debe nombrar la variable').toContain('DATABASE_URL_APP');
  expect(texto.toLowerCase(), `el mensaje debe nombrar el parametro ${parametro}`).toContain(parametro);
  expect(texto, 'el mensaje no puede traer la URL').not.toContain(url);
  const clave = new URL(urlAppPruebas()).password;
  if (clave) expect(texto, 'el mensaje no puede traer la contrasena').not.toContain(clave);
  if (valor) expect(texto, 'el mensaje no puede traer el valor del parametro').not.toContain(valor);
}

describe('criterio 143: la API no arranca con parametros de conexion en la cadena de consulta de DATABASE_URL_APP', () => {
  it.for(LISTA)(
    'criterio 143: ?%s=<valor> lanza ErrorEntorno que nombra DATABASE_URL_APP y el parametro',
    async (nombre) => {
      await debeNoArrancar(`${nombre}=${VALOR}`, nombre);
    },
  );

  it('criterio 143: ?user=<usuario del duenio de las tablas> (cambiar el usuario de la app por el del duenio) no arranca', async () => {
    const duenio = new URL(process.env['DATABASE_URL_PRUEBAS'] ?? '').username;

    await debeNoArrancar(`user=${duenio}`, 'user', undefined);
  });

  it.for([
    ['en mayusculas', `USER=${VALOR}`, 'user', VALOR],
    ['codificado (%75ser)', `%75ser=${VALOR}`, 'user', VALOR],
    ['con valor vacio', 'host=', 'host', undefined],
    ['en segunda posicion', `sslmode=disable&dbname=${VALOR}`, 'dbname', VALOR],
    ['repetido', `port=${VALOR}&Port=otro-${VALOR}`, 'port', VALOR],
  ] as const)('criterio 143: %s tampoco arranca', async ([, consulta, parametro, valor]) => {
    await debeNoArrancar(consulta, parametro, valor);
  });

  it('criterio 143 (control): ?sslmode=disable sigue permitido: la API arranca y atiende la base', async () => {
    const app = await crearAppDePruebas({
      nivelRegistro: 'silent',
      variables: { DATABASE_URL_APP: conConsulta(urlAppPruebas(), 'sslmode=disable') },
    });
    try {
      const baseDatos = await obtenerBaseDatos(app);

      await expect(baseDatos.comprobarConexion()).resolves.toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('criterio 143 (control): ?options=-c TimeZone=UTC sigue permitido: la API arranca', async () => {
    const app = await crearAppDePruebas({
      nivelRegistro: 'silent',
      variables: {
        DATABASE_URL_APP: conConsulta(urlAppPruebas(), `options=${encodeURIComponent('-c TimeZone=UTC')}`),
      },
    });

    await app.close();
  });
});
