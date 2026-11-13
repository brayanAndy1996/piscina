// spec: 001-academias-aislamiento (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearClienteDelDueno, enPlataforma } from '../../../src/cli/conexion';
import { limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAuditoriaPlataforma } from '../../utilidades/datos';
import { urlConOpciones } from '../../utilidades/ronda3';

// Criterio 98 (ataque ronda 3, F3), parte de los comandos: con `crearClienteDelDueno` y la URL del dueno con
// `?options=-c TimeZone=Pacific/Kiritimati`, dentro de `enPlataforma` `current_setting('TimeZone')` es `UTC` y `SELECT now()`
// llega a menos de 5 segundos del instante real; y `npm run plataforma:superadmin` con esa URL deja la `fecha_hora` de
// `SUPERADMIN_CREADO` a menos de 5 segundos del instante real (leida como dueno con `pg`). Para que `enPlataforma` lo fije,
// en backend/src/cli/ la regla de lint admite exactamente `set_config('TimeZone', 'UTC', true)` (eso lo prueba el lint).

const TIMEOUT = 90_000;
const OPCIONES_ZONA = '-c TimeZone=Pacific/Kiritimati';
const CLAVE_NUEVA = 'Clave-Zona-Horaria-2026';

describe('criterio 98: enPlataforma fija TimeZone en UTC', () => {
  let cliente: ReturnType<typeof crearClienteDelDueno> | undefined;

  beforeEach(limpiarBase);
  afterEach(async () => {
    await cliente?.$disconnect();
    cliente = undefined;
  });

  it('criterio 98 (premisa): la URL con options deja TimeZone=Pacific/Kiritimati en la sesion del dueno', async () => {
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), OPCIONES_ZONA));

    const [fila] = await cliente.$queryRaw<{ zona: string }[]>`SELECT current_setting('TimeZone') AS zona`;

    expect(fila?.zona).toBe('Pacific/Kiritimati');
  });

  it('criterio 98: dentro de enPlataforma, current_setting(TimeZone) es UTC aunque la sesion venga con otra zona', async () => {
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), OPCIONES_ZONA));

    const zona = await enPlataforma(cliente, async (tx) => {
      const [fila] = await tx.$queryRaw<{ zona: string }[]>`SELECT current_setting('TimeZone') AS zona`;
      return fila?.zona;
    });

    expect(zona).toBe('UTC');
  });

  it('criterio 98: dentro de enPlataforma, SELECT now() llega como un Date a menos de 5 segundos del instante real', async () => {
    cliente = crearClienteDelDueno(urlConOpciones(urlPropietarioPruebas(), OPCIONES_ZONA));

    const ahora = await enPlataforma(cliente, async (tx) => {
      const [fila] = await tx.$queryRaw<{ ahora: unknown }[]>`SELECT now() AS ahora`;
      return fila?.ahora;
    });

    expect(ahora).toBeInstanceOf(Date);
    expect(Math.abs((ahora as Date).getTime() - Date.now())).toBeLessThan(5000);
  });

  it('criterio 98: sin options, enPlataforma tambien trabaja en UTC', async () => {
    cliente = crearClienteDelDueno(urlPropietarioPruebas());

    const zona = await enPlataforma(cliente, async (tx) => {
      const [fila] = await tx.$queryRaw<{ zona: string }[]>`SELECT current_setting('TimeZone') AS zona`;
      return fila?.zona;
    });

    expect(zona).toBe('UTC');
  });
});

describe('criterio 98: npm run plataforma:superadmin con la URL del dueno en otra zona horaria', () => {
  beforeEach(limpiarBase);

  it(
    'criterio 98: la fecha_hora de SUPERADMIN_CREADO queda a menos de 5 segundos del instante real',
    async () => {
      const antes = Date.now();

      const resultado = ejecutarComando('plataforma:superadmin', {
        SUPERADMIN_CORREO: 'zona@aquagestion.test',
        SUPERADMIN_NOMBRE: 'Superadmin de la zona',
        SUPERADMIN_CLAVE: CLAVE_NUEVA,
        DATABASE_URL: urlConOpciones(urlPropietarioPruebas(), OPCIONES_ZONA),
      });

      const despues = Date.now();
      expect(resultado.estado, resultado.salida).toBe(0);
      const auditoria = await leerAuditoriaPlataforma('SUPERADMIN_CREADO');
      expect(auditoria).toHaveLength(1);
      // El comando escribe entre `antes` y `despues`: con la zona corrida seria horas distinta.
      const instante = auditoria[0]?.fecha_hora.getTime() ?? 0;
      expect(instante).toBeGreaterThanOrEqual(antes - 5000);
      expect(instante).toBeLessThanOrEqual(despues + 5000);
    },
    TIMEOUT,
  );
});
