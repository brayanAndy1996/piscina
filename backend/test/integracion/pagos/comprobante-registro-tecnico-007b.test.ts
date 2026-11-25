// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEXTO_REDACTADO } from '../../../src/infraestructura/registro/opciones-registro';
import {
  AHORA_007,
  crearEscenarioDePagos,
  type EscenarioPagos,
  exigirRutasDePagos,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  datosDeComprobante,
  exigirRutasDe007b,
  sembrarEnVerificacion,
  subirComprobante,
} from '../../utilidades/escenario-pagos-007b';
import { desde, pedir } from '../../utilidades/inscripciones-ronda1';
import { rutaPublica, tokenAleatorio } from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  jpeg,
  png,
  TEXTO_MARCADO,
} from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';

// Criterio 43, registro técnico (crítico, criterios 28, 33, 53 y 59 de 005): las cabeceras `X-Token-Solicitud` y `X-Pago-Datos` se redactan en todo el registro técnico; ninguna línea lleva el token, el DNI, el número de operación,
// el monto declarado ni el contenido de la imagen. Va en su propio archivo, con una sola aplicación y la primera del proceso: el registro técnico de pino (nivel y redacción) es global del proceso y lo fija la primera aplicación que
// se crea, así que no puede compartir archivo con pruebas que levantan antes otra aplicación con el registro en silencio (los límites, en `comprobante-limite-registro-007b.test.ts`).

describe('el registro técnico del comprobante no lleva datos sensibles (criterio 43)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({
      nivelRegistro: 'trace',
      destinoRegistro: destino,
      conLimites: true,
      // La IP sale de `X-Forwarded-For`: la prueba agota las 10 subidas por hora desde su propia IP y las demás no se ven afectadas.
      ipPorCabecera: true,
      ahora: AHORA_007,
    });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  /** Cada valor de `x-pago-datos` y de `x-token-solicitud` que aparece en una línea está redactado; devuelve cuántos hay de cada uno. */
  function cabecerasRedactadas(todas: readonly string[]): { datos: number; token: number } {
    const cuenta = { datos: 0, token: 0 };
    for (const linea of todas) {
      for (const [cabecera, clave] of [
        ['x-pago-datos', 'datos'],
        ['x-token-solicitud', 'token'],
      ] as const) {
        for (const coincidencia of linea.matchAll(new RegExp(`"${cabecera}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g'))) {
          expect(coincidencia[1], `${cabecera} sin redactar en: ${linea.slice(0, 300)}`).toBe(TEXTO_REDACTADO);
          cuenta[clave] += 1;
        }
      }
    }
    return cuenta;
  }

  it('criterio 43: una subida correcta y una rechazada de cada tipo (400 datos, 400 imagen, 404, 409, 413 y 429) no dejan token, DNI, número de operación, monto, clave, texto marcado ni contenido de la imagen en el registro', async () => {
    const dni = '47811902';
    const cliente = await sembrarCobrable(e, {
      dni,
      nombres: 'Zenobia',
      apellidos: 'Quillahuaman Torrico',
      monto: '77.00',
    });
    const otro = await sembrarCobrable(e, { monto: '77.00' });
    const cancelada = await sembrarCobrable(e, { estado: 'CANCELADA' });
    const enRevision = await sembrarEnVerificacion(e, { monto: '77.00', numeroOperacion: '5550001' });
    const numero = '9087654321';
    const datos = datosDeComprobante({ numeroOperacion: numero, monto: '77.00' });
    const foto = await jpeg(600, 400, { gps: true, comentario: TEXTO_MARCADO, orientacion: 1 });
    const referer = (token: string) => `https://academia.test/a/academia-a/solicitud/${token}`;
    const subir = (token: string, extra: Parameters<typeof subirComprobante>[2] = {}) =>
      subirComprobante(ctx, 'academia-a', {
        token,
        datos,
        cuerpo: foto,
        tipo: 'image/jpeg',
        headers: { referer: referer(token), ...desde('203.0.113.43') },
        ...extra,
      });

    const correcta = await subir(cliente.token);
    const datosMalos = await subir(otro.token, {
      datos: datosDeComprobante({ numeroOperacion: numero, monto: 'abc' }),
    });
    // Cada rechazo lleva su propia clave de idempotencia: la clave va antes que el estado y que la imagen (criterio 37, pasos 7 a 9).
    const imagenMala = await subir(otro.token, {
      cuerpo: png(99, 99),
      tipo: 'image/png',
      datos: datosDeComprobante({ numeroOperacion: '9087654323', monto: '77.00' }),
    });
    const montoDistinto = await subir(otro.token, {
      datos: datosDeComprobante({ numeroOperacion: '9087654322', monto: '70.00' }),
    });
    const noEncontrada = await subir(tokenAleatorio());
    const noEditable = await subir(cancelada.token, {
      datos: datosDeComprobante({ numeroOperacion: '9087654324', monto: '77.00' }),
    });
    const yaEnRevision = await subir(enRevision.token, {
      datos: datosDeComprobante({ numeroOperacion: '9087654325', monto: '77.00' }),
    });
    const grande = await subir(cliente.token, {
      cuerpo: Buffer.alloc(8),
      largoDeclarado: 6 * 1024 * 1024,
      plazoMs: 8000,
    });
    expect([
      correcta.status,
      datosMalos.status,
      imagenMala.status,
      montoDistinto.status,
      noEncontrada.status,
      noEditable.status,
      yaEnRevision.status,
      grande.status,
    ]).toEqual([201, 400, 400, 409, 404, 409, 409, 413]);
    expect(
      [montoDistinto, noEditable, yaEnRevision].map((r) => r.body?.['codigo']),
      'cada 409 es el que se quiere probar y no un CLAVE_YA_USADA',
    ).toEqual(['MONTO_DISTINTO', 'SOLICITUD_NO_EDITABLE', 'PAGO_EN_VERIFICACION']);
    expect(imagenMala.body?.['codigo']).toBe('IMAGEN_NO_VALIDA');
    expect(datosMalos.body?.['codigo']).toBe('SOLICITUD_INVALIDA');
    // Con 8 subidas hechas, dos más agotan las 10 por hora y la siguiente responde 429.
    for (let i = 0; i < 2; i++) await subir(tokenAleatorio());
    const limite = await subir(cliente.token);
    expect(limite.status, limite.texto).toBe(429);
    await esperarHasta(() => lineas.some((linea) => linea.includes('"statusCode":429')));

    expect(lineas.length, 'la aplicación escribió registros').toBeGreaterThan(0);
    const todo = lineas.join('\n');
    const sensibles: Record<string, string> = {
      token: cliente.token,
      tokenDeLaCancelada: cancelada.token,
      dni,
      nombres: 'Zenobia',
      apellidos: 'Quillahuaman',
      numeroDeOperacion: numero,
      numeroDeOperacionDelOtroPago: '5550001',
      numeroDeOperacionDeLaImagenMala: '9087654323',
      numeroDeOperacionDelNoEditable: '9087654324',
      numeroDeOperacionDelQueYaEstaEnRevision: '9087654325',
      montoDeclarado: '77.00',
      clave: String(datos['claveIdempotencia']),
      enlaceDeSeguimiento: referer(cliente.token),
      textoMarcado: TEXTO_MARCADO,
      coordenadas: 'GPS',
      exif: 'Exif',
    };
    for (const [nombre, valor] of Object.entries(sensibles)) {
      expect(todo, `el registro lleva ${nombre}`).not.toContain(valor);
    }
    for (const trozo of [foto.subarray(0, 48), foto.subarray(200, 248), foto.subarray(foto.length - 48)]) {
      expect(todo, 'el registro lleva el contenido de la imagen en base64').not.toContain(trozo.toString('base64'));
      expect(todo, 'el registro lleva el contenido de la imagen en hexadecimal').not.toContain(trozo.toString('hex'));
      expect(todo, 'el registro lleva el contenido de la imagen en base64url').not.toContain(
        trozo.toString('base64url'),
      );
    }
    expect(todo, 'el registro lleva el encabezado JPEG en base64').not.toContain('/9j/4');
    const redactadas = cabecerasRedactadas(lineas);
    expect(redactadas.datos, 'ninguna línea de petición lleva req.headers["x-pago-datos"] redactado').toBeGreaterThan(
      0,
    );
    expect(
      redactadas.token,
      'ninguna línea de petición lleva req.headers["x-token-solicitud"] redactado',
    ).toBeGreaterThan(0);
    expect(todo).toContain(TEXTO_REDACTADO);
    expect(todo, 'la petición se anota con su dirección sin datos').toContain('/solicitudes/comprobante');
  });

  it('criterio 43: un X-Pago-Datos enviado a otra ruta (GET /api/a/{nombreCorto}, la consulta, una ruta que no existe y una del panel) también se redacta', async () => {
    const secreto = datosDeComprobante({ numeroOperacion: '6670001', monto: '88.00' });
    const cabecera = JSON.stringify(secreto);
    const conDatos = { 'x-pago-datos': cabecera };
    const peticiones = [
      pedir(ctx, 'GET', rutaPublica('academia-a'), { headers: conDatos }),
      pedir(ctx, 'POST', rutaPublica('academia-a', '/solicitudes/consulta'), {
        headers: conDatos,
        cuerpo: { token: tokenAleatorio() },
      }),
      pedir(ctx, 'GET', rutaPublica('no-existe'), { headers: conDatos }),
      pedir(ctx, 'GET', '/api/clases', { headers: conDatos }),
    ];
    const estados = (await Promise.all(peticiones)).map((r) => r.status);
    expect(estados.slice(0, 3)).toEqual([200, 404, 404]);
    await esperarHasta(() => lineas.some((linea) => linea.includes('/solicitudes/consulta')));
    await new Promise((resolver) => setTimeout(resolver, 150));

    const todo = lineas.join('\n');
    expect(todo, 'el registro lleva los datos del pago').not.toContain('6670001');
    expect(todo).not.toContain(String(secreto['claveIdempotencia']));
    expect(cabecerasRedactadas(lineas).datos).toBeGreaterThanOrEqual(3);
  });
});
