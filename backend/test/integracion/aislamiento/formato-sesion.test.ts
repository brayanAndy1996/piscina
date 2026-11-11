// spec: 001-academias-aislamiento (pruebas protegidas)
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { conClienteComo, urlAppPruebas } from '../../utilidades/base-datos';
import {
  CONTAMINADOS,
  CONTAMINADOS_ALEMAN,
  LEER_PARAMETROS,
  opcionesDeUrl,
  registrarPruebasDeFormato,
  type Parametros,
} from '../../utilidades/formato-sesion';
import { urlConOpciones } from '../../utilidades/ronda3';

// Criterio 107 (ataque ronda 4, F2; complementa los criterios 72, 90 y 98): el adaptador de Prisma interpreta el texto que
// devuelve PostgreSQL y ese texto depende de la sesion, asi que toda transaccion de `BaseDatos` (`conAcademia`,
// `comoPlataforma` y `resolverAcademia`) fija, local a la transaccion y en la misma primera sentencia que el contexto y
// `TimeZone`, antes de `trabajo`: DateStyle = 'ISO, MDY', IntervalStyle = 'postgres', extra_float_digits = '1' y
// bytea_output = 'hex'. Con la API en DATABASE_POOL_MAX=1, un RelojFijo y cada vía de contaminacion de los cuatro parametros:
//   (a) un `trabajo` anterior en la misma conexion ejecuto set_config(..., false) y confirmo;
//   (b) `options` en DATABASE_URL_APP;
//   (c) ALTER DATABASE <base de pruebas> SET ... (si el dueno puede; si no, se omite con aviso);
//   (d) ALTER ROLE ALL SET ... y ALTER ROLE ALL IN DATABASE <base> SET ... (exigen superusuario: en la nube se omiten con
//       aviso; corren en Docker y en la CI);
//   (e) el archivo de configuracion del servidor, simulado con ALTER SYSTEM SET ... y pg_reload_conf() (solo superusuario);
// cada via se restaura al final (RESET, ALTER SYSTEM RESET y recarga), tambien si la prueba falla. Entonces:
//   - el 5.o intento fallido bloquea y, durante el bloqueo, la clave correcta responde 423 CUENTA_BLOQUEADA (no 200); a los
//     15 minutos de RELOJ, entra;
//   - GET /api/plataforma/academias responde 200 con creadaEn y suspendidaEn iguales a los instantes guardados;
//   - dentro de `trabajo`, SELECT now(), 0.1::float8 y un bytea llegan como un Date valido a menos de 5 segundos del
//     instante real, 0.1 y los bytes 01 02; y current_setting de cada parametro da exactamente los valores fijados.

// Este archivo prueba las vias que solo afectan a la conexion de la prueba: (a) set_config(..., false) en un `trabajo` anterior
// y (b) `options` en DATABASE_URL_APP. Las vias (c) ALTER DATABASE, (d) ALTER ROLE ALL y (e) ALTER SYSTEM cambian valores
// compartidos con otras conexiones y estan en backend/test/integracion-aislada/formato-sesion-servidor.test.ts, que corre en
// serie y despues de todos los demas proyectos de PostgreSQL.

// Premisas: la contaminacion que usan las pruebas existe de verdad en PostgreSQL (no dependen de la API).
describe('criterio 107: premisas de la contaminacion (solo PostgreSQL)', () => {
  it('criterio 107: set_config(..., false) en una transaccion que confirma sigue visible en la siguiente de la misma conexion', async () => {
    const visto = await conClienteComo('app', async (cliente) => {
      await cliente.query('BEGIN');
      await cliente.query(
        `SELECT set_config('DateStyle', 'SQL, DMY', false), set_config('IntervalStyle', 'iso_8601', false),
                set_config('extra_float_digits', '-15', false), set_config('bytea_output', 'escape', false)`,
      );
      await cliente.query('COMMIT');
      await cliente.query('BEGIN');
      const { rows } = await cliente.query(LEER_PARAMETROS);
      await cliente.query('ROLLBACK');
      return rows[0] as Parametros;
    });

    expect(visto).toEqual({ ...CONTAMINADOS, DateStyle: 'SQL, DMY' });
  });

  it('criterio 107: ?options=-c DateStyle=German -c IntervalStyle=iso_8601 … deja esos valores en la sesion', async () => {
    const cliente = new pg.Client({
      connectionString: urlConOpciones(urlAppPruebas(), opcionesDeUrl(CONTAMINADOS_ALEMAN)),
    });
    await cliente.connect();
    try {
      const { rows } = await cliente.query(LEER_PARAMETROS);

      expect(rows[0]).toEqual({ ...CONTAMINADOS_ALEMAN, DateStyle: 'German, DMY' });
    } finally {
      await cliente.end();
    }
  });
});

registrarPruebasDeFormato(['sesion', 'sesion-aleman', 'url']);
