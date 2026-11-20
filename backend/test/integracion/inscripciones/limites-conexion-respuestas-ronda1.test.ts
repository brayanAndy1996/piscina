// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  crearEscenarioInscripcion,
  cuerpoCotizacion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  type RespuestaApi,
  rutaPublica,
} from '../../utilidades/inscripciones';
import { crearAppConIpPorCabecera, desde, pedir } from '../../utilidades/inscripciones-ronda1';

// Criterio 59 (crítico, DR-8, DR-15, nota O2 de 001; criterios 33 y 49; respuesta R4, ronda 1), pruebas de integración: todas las reglas del
// criterio 33 (las dos lecturas, también con HEAD; la cotización; el envío; la consulta) cuentan con `claveDeConexion(req.ip)`: una IPv4, también
// escrita como IPv6 mapeada, cuenta por su dirección exacta; cualquier otra IPv6, por su bloque /64. Con una app de prueba que confía en el proxy de
// `loopback` para fijar la IP de cada petición con `X-Forwarded-For` (la app real no cambia), cada una con un almacén limpio:
//   a) 60 lecturas, cada una desde una dirección distinta de 2001:db8:1:2::/64: la 61, desde otra dirección del mismo bloque, responde 429;
//      desde 2001:db8:1:3::1, 200;
//   b) 203.0.113.1 y 203.0.113.2 tienen contadores separados; 203.0.113.1 y ::ffff:203.0.113.1 comparten el suyo (30 lecturas desde cada forma:
//      la 61 responde 429);
//   c) lo mismo con la cotización (30 por minuto), el envío (10 por hora, con cuerpos inválidos, que también cuentan) y la consulta (10 por
//      minuto), cada uno con direcciones distintas del mismo /64.

describe('límites por IP con la clave de conexión (criterio 59)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    e = await crearEscenarioInscripcion();
    ctx = await crearAppConIpPorCabecera({ conLimites: true, ahora: AHORA_005 });
  });
  afterEach(async () => {
    await ctx?.http.cerrar();
  });

  /** La dirección número `n` (1, 2, 3…) del bloque `2001:db8:<bloque>::/64`. */
  const direccion = (n: number, bloque = '1:2') => `2001:db8:${bloque}::${n.toString(16)}`;

  const leer = (ip: string, sufijo = '') =>
    pedir(ctx, 'GET', rutaPublica('academia-a', sufijo), { headers: desde(ip) });
  const cotizar = (ip: string) =>
    pedir(ctx, 'POST', rutaPublica('academia-a', '/inscripcion/cotizacion'), {
      headers: desde(ip),
      cuerpo: cuerpoCotizacion(e),
    });
  const enviarInvalido = (ip: string) =>
    pedir(ctx, 'POST', rutaPublica('academia-a', '/inscripcion'), { headers: desde(ip), cuerpo: { basura: true } });
  const consultar = (ip: string) =>
    pedir(ctx, 'POST', rutaPublica('academia-a', '/solicitudes/consulta'), {
      headers: desde(ip),
      cuerpo: { basura: 1 },
    });

  async function repetir(n: number, pedirUna: (i: number) => Promise<RespuestaApi>): Promise<number[]> {
    const estados: number[] = [];
    for (let i = 0; i < n; i++) estados.push((await pedirUna(i)).status);
    return estados;
  }

  function esLimite(respuesta: RespuestaApi, descripcion = ''): void {
    expect(respuesta.status, `${descripcion} ${respuesta.texto}`).toBe(429);
    expect(codigoDe(respuesta)).toBe('DEMASIADAS_SOLICITUDES');
    expect(respuesta.cacheControl).toBe('no-store');
  }

  it('control: la IP fijada por X-Forwarded-For es la que cuenta: una IPv4 distinta tiene su propio contador de lecturas', async () => {
    await repetir(60, () => leer('203.0.113.1'));

    esLimite(await leer('203.0.113.1'));
    expect((await leer('203.0.113.2')).status).toBe(200);
  });

  describe('a: las lecturas por bloque /64', () => {
    it('criterio 59 a: 60 lecturas desde 60 direcciones distintas de 2001:db8:1:2::/64 agotan el límite: la 61, desde otra dirección del mismo bloque, responde 429; desde 2001:db8:1:3::1, 200', async () => {
      const estados = await repetir(60, (i) => leer(direccion(i + 1)));
      expect(
        estados.filter((estado) => estado === 429),
        'las 60 primeras no reciben 429',
      ).toEqual([]);

      esLimite(await leer(direccion(500)), 'otra dirección del mismo bloque');
      expect((await leer('2001:db8:1:3::1')).status, 'otro bloque').toBe(200);
    });

    it('criterio 59 a: las dos lecturas (la de la academia y la del formulario) y HEAD comparten el contador del bloque', async () => {
      await repetir(20, (i) => leer(direccion(i + 1)));
      await repetir(20, (i) => leer(direccion(i + 100), '/inscripcion'));
      await repetir(20, (i) => pedir(ctx, 'HEAD', rutaPublica('academia-a'), { headers: desde(direccion(i + 200)) }));

      esLimite(await leer(direccion(900)));
      // Una respuesta a HEAD no tiene cuerpo: no hay código JSON que leer; se comprueban el estado y la cabecera.
      const cabeza = await pedir(ctx, 'HEAD', rutaPublica('academia-a', '/inscripcion'), {
        headers: desde(direccion(901)),
      });
      expect(cabeza.status, 'HEAD tras agotar el contador del bloque').toBe(429);
      expect(cabeza.cacheControl).toBe('no-store');
    });

    it('criterio 59 a: las formas escritas distinto de la misma dirección (mayúsculas, ceros a la izquierda, ceros comprimidos) cuentan en el mismo bloque', async () => {
      const formas = [
        '2001:db8:1:2::1',
        '2001:DB8:1:2::1',
        '2001:0db8:0001:0002:ffff:ffff:ffff:ffff',
        '2001:db8:1:2:0:0:0:abc',
      ];
      await repetir(60, (i) => leer(formas[i % formas.length] as string));

      esLimite(await leer('2001:db8:1:2::77'));
    });
  });

  describe('b: IPv4 e IPv4 mapeada', () => {
    it('criterio 59 b: 203.0.113.1 y 203.0.113.2 tienen contadores separados', async () => {
      await repetir(60, () => leer('203.0.113.1'));

      esLimite(await leer('203.0.113.1'));
      expect((await leer('203.0.113.2')).status).toBe(200);
    });

    it('criterio 59 b: 203.0.113.1 y ::ffff:203.0.113.1 comparten el contador: 30 lecturas desde cada forma, y la 61 responde 429', async () => {
      await repetir(30, () => leer('203.0.113.1'));
      await repetir(30, () => leer('::ffff:203.0.113.1'));

      esLimite(await leer('203.0.113.1'), 'la forma IPv4');
      esLimite(await leer('::ffff:203.0.113.1'), 'la forma mapeada');
      esLimite(await leer('::FFFF:cb00:7101'), 'otra forma de escribir la mapeada');
      expect((await leer('203.0.113.2')).status, 'otra IPv4').toBe(200);
    });

    it('criterio 59 b: una IPv4 mapeada no se agrupa con el bloque /64 de ::ffff:0:0 (las mapeadas son IPv4, aunque caigan en ::/64): dos IPv4 distintas, en su forma mapeada, no comparten contador', async () => {
      await repetir(60, () => leer('::ffff:203.0.113.5'));

      esLimite(await leer('::ffff:203.0.113.5'));
      expect((await leer('::ffff:203.0.113.6')).status).toBe(200);
      expect((await leer('203.0.113.6')).status).toBe(200);
    });
  });

  describe('c: la cotización, el envío y la consulta', () => {
    it('criterio 59 c: la cotización (30 por minuto) cuenta por bloque: 30 desde 30 direcciones del mismo /64, la 31 desde otra del bloque responde 429 y otro bloque pasa', async () => {
      const estados = await repetir(30, (i) => cotizar(direccion(i + 1)));
      expect(
        estados.every((estado) => estado === 200),
        estados.join(','),
      ).toBe(true);

      esLimite(await cotizar(direccion(500)));
      expect((await cotizar('2001:db8:1:3::1')).status).toBe(200);
    });

    it('criterio 59 c: el envío (10 por hora, con cuerpos inválidos, que también cuentan) cuenta por bloque: el 11.º desde otra dirección del mismo /64 responde 429 y otro bloque pasa', async () => {
      const estados = await repetir(10, (i) => enviarInvalido(direccion(i + 1)));
      expect(
        estados.every((estado) => estado === 400),
        estados.join(','),
      ).toBe(true);

      esLimite(await enviarInvalido(direccion(500)));
      expect((await enviarInvalido('2001:db8:1:3::1')).status).toBe(400);
    });

    it('criterio 59 c: la consulta (10 por minuto) cuenta por bloque: la 11.ª desde otra dirección del mismo /64 responde 429 y otro bloque pasa', async () => {
      const estados = await repetir(10, (i) => consultar(direccion(i + 1)));
      expect(
        estados.every((estado) => estado === 400),
        estados.join(','),
      ).toBe(true);

      esLimite(await consultar(direccion(500)));
      expect((await consultar('2001:db8:1:3::1')).status).toBe(400);
    });

    it('criterio 59 c: el envío, la cotización y la consulta cuentan la IPv4 y su forma mapeada en el mismo contador', async () => {
      await repetir(5, () => enviarInvalido('203.0.113.9'));
      await repetir(5, () => enviarInvalido('::ffff:203.0.113.9'));
      esLimite(await enviarInvalido('203.0.113.9'), 'envío');

      await repetir(15, () => cotizar('203.0.113.9'));
      await repetir(15, () => cotizar('::ffff:203.0.113.9'));
      esLimite(await cotizar('203.0.113.9'), 'cotización');

      await repetir(5, () => consultar('203.0.113.9'));
      await repetir(5, () => consultar('::ffff:203.0.113.9'));
      esLimite(await consultar('203.0.113.9'), 'consulta');
    });

    it('criterio 59: cada regla sigue con su contador por clave de conexión: agotar el envío en un bloque no agota la lectura de ese bloque', async () => {
      await repetir(10, (i) => enviarInvalido(direccion(i + 1)));
      esLimite(await enviarInvalido(direccion(500)));

      expect((await leer(direccion(600))).status).toBe(200);
      expect((await cotizar(direccion(601))).status).toBe(200);
    });
  });

  it('criterio 59: el límite del ingreso (002) no cambia: sigue contando por dirección exacta (pregunta R6): diez intentos desde una dirección del bloque no agotan el de otra dirección del mismo bloque', async () => {
    const ingresar = (ip: string) =>
      pedir(ctx, 'POST', rutaPublica('academia-a', '/sesion'), {
        headers: desde(ip),
        cuerpo: { usuario: '12345678', clave: 'una-clave-cualquiera' },
      });
    await repetir(10, () => ingresar(direccion(1)));
    esLimite(await ingresar(direccion(1)));

    expect((await ingresar(direccion(2))).status, 'otra dirección exacta del mismo bloque').toBe(401);
  });
});
