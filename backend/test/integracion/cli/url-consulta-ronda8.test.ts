// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAcademias, leerAuditoriaPlataforma } from '../../utilidades/datos';

// Criterio 143 (ataque ronda 8, O1; AMPLIA el criterio 5), parte del comando `npm run plataforma:superadmin` y de la semilla
// (`npm run db:semilla`), ejecutados como proceso: el cliente `pg` toma `user`, `host`, `hostaddr`, `password`, `port`, `dbname` y
// `database` de la cadena de consulta de la URL por encima de su parte principal. Con `DATABASE_URL` de pruebas mas alguno de esos
// nombres en la cadena de consulta (decodificado, sin distinguir mayusculas, con cualquier valor, tambien vacio, en cualquier posicion y
// aunque se repita), los dos terminan con codigo 1 SIN conectarse ni escribir nada, con un mensaje que nombra la variable y el parametro y
// que no trae la URL, el valor del parametro ni la contrasena; leido como duenio, no crearon ni cambiaron ningun superadmin ni academia.
// `options` y `sslmode` siguen permitidos. Las funciones que deciden estan en `url-postgres.test.ts` y `scripts/test/entorno-ronda8.test.mjs`.

const TIMEOUT = 120_000;
const VALOR = 'valor_reconocible_r8';
const LISTA = ['user', 'host', 'hostaddr', 'password', 'port', 'dbname', 'database'] as const;
const VALIDAS = {
  SUPERADMIN_CORREO: 'superadmin-r8@aquagestion.test',
  SUPERADMIN_NOMBRE: 'Superadmin de la ronda 8',
  SUPERADMIN_CLAVE: 'clave-de-desarrollo-r8-123',
};
const COMANDOS = ['plataforma:superadmin', 'db:semilla'] as const;
type Comando = (typeof COMANDOS)[number];

const conConsulta = (url: string, consulta: string): string => `${url}${url.includes('?') ? '&' : '?'}${consulta}`;

async function superadmins(): Promise<unknown[]> {
  const { rows } = await ejecutarComo('propietario', 'SELECT id FROM superadmins', [], { plataforma: true });
  return rows as unknown[];
}

/** Codigo 1, nombra la variable y el parametro, no trae la URL, el valor ni la contrasena, y no escribio nada. */
async function esperarFallaCerrada(
  comando: Comando,
  consulta: string,
  parametro: string,
  valor: string | undefined = VALOR,
): Promise<void> {
  const url = conConsulta(urlPropietarioPruebas(), consulta);

  const resultado = ejecutarComando(comando, { ...VALIDAS, DATABASE_URL: url });

  expect(resultado.estado, resultado.salida).toBe(1);
  expect(resultado.salida, 'la salida debe nombrar DATABASE_URL').toMatch(/DATABASE_URL(?![A-Z_])/);
  expect(resultado.salida.toLowerCase(), `la salida debe nombrar el parametro ${parametro}`).toContain(parametro);
  expect(resultado.salida, 'la salida no puede traer la URL').not.toContain(url);
  expect(resultado.salida, 'la salida no puede traer la URL codificada').not.toContain(encodeURIComponent(url));
  if (valor) expect(resultado.salida, 'la salida no puede traer el valor del parametro').not.toContain(valor);
  const clave = new URL(urlPropietarioPruebas()).password;
  if (clave) {
    expect(resultado.salida, 'la salida muestra la contrasena (en una URL)').not.toContain(`:${clave}@`);
    expect(resultado.salida, 'la salida muestra la contrasena (como contrasena)').not.toMatch(
      new RegExp(
        `(password|contrase(ñ|n)a|clave)\\s*[=:]\\s*['"]?${clave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i',
      ),
    );
  }
  expect(resultado.salida).not.toContain(VALIDAS.SUPERADMIN_CLAVE);
  expect(await leerAcademias(), 'no debia crear ninguna academia').toEqual([]);
  expect(await superadmins(), 'no debia crear ningun superadmin').toEqual([]);
  expect(await leerAuditoriaPlataforma(), 'no debia escribir ninguna auditoria').toEqual([]);
}

afterAll(limpiarBase);

describe.each(COMANDOS)(
  'criterio 143: %s con parametros de conexion en la cadena de consulta de DATABASE_URL',
  (comando) => {
    beforeEach(limpiarBase);

    it(
      'criterio 143: el ejemplo de la especificacion, ?user=aquagestion_app, termina con codigo 1 sin escribir nada',
      async () => {
        await esperarFallaCerrada(comando, 'user=aquagestion_app', 'user', undefined);
      },
      TIMEOUT,
    );

    it.for(LISTA)(
      'criterio 143: ?%s=<valor> termina con codigo 1 nombrando DATABASE_URL y el parametro, sin escribir nada',
      { timeout: TIMEOUT },
      async (nombre) => {
        await esperarFallaCerrada(comando, `${nombre}=${VALOR}`, nombre);
      },
    );

    it.for([
      ['en mayusculas', `USER=${VALOR}`, 'user', VALOR],
      ['codificado (%75ser)', `%75ser=${VALOR}`, 'user', VALOR],
      ['con valor vacio', 'host=', 'host', undefined],
      ['en segunda posicion', `sslmode=disable&dbname=${VALOR}`, 'dbname', VALOR],
      ['repetido', `port=${VALOR}&Port=otro_${VALOR}`, 'port', VALOR],
    ] as const)(
      'criterio 143: %s tambien termina con codigo 1 sin escribir nada',
      { timeout: TIMEOUT },
      async ([, consulta, parametro, valor]) => {
        await esperarFallaCerrada(comando, consulta, parametro, valor);
      },
    );

    it(
      'criterio 143 (control): ?sslmode=disable&options=-c TimeZone=UTC sigue permitido: termina con codigo 0',
      () => {
        const url = conConsulta(
          urlPropietarioPruebas(),
          `sslmode=disable&options=${encodeURIComponent('-c TimeZone=UTC')}`,
        );

        const resultado = ejecutarComando(comando, { ...VALIDAS, DATABASE_URL: url });

        expect(resultado.estado, resultado.salida).toBe(0);
      },
      TIMEOUT,
    );
  },
);
