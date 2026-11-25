import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEXTO_REDACTADO } from '../../../src/infraestructura/registro/opciones-registro';
import {
  AHORA_007,
  crearEscenarioDePagos,
  type EscenarioPagos,
  exigirRutasDePagos,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import { datosDeComprobante, exigirRutasDe007b, subirComprobante } from '../../utilidades/escenario-pagos-007b';
import { desde } from '../../utilidades/inscripciones-ronda1';
import { tokenAleatorio } from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  crearAppConAlmacen,
  exigirAlmacen,
  jpeg,
  TEXTO_MARCADO,
} from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';

// Criterio 43 de la 007b (prueba no protegida, complemento de `comprobante-limite-registro-007b.test.ts`): el registro técnico de la subida del
// comprobante redacta `X-Pago-Datos` y `X-Token-Solicitud` y no lleva el token, el DNI, el número de operación, el monto declarado, la clave ni el
// contenido de la imagen. Va en su propio archivo con una sola aplicación: el registro técnico (nivel y redacción) lo fija la primera aplicación
// que crea el proceso, así que no puede compartir archivo con pruebas que levantan otras con el registro en silencio.

describe('registro técnico de la subida del comprobante (criterio 43)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({
      nivelRegistro: 'trace',
      destinoRegistro: destino,
      conLimites: true,
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

  /** Cuenta los valores de `x-pago-datos` y de `x-token-solicitud` de las líneas; cada uno debe estar redactado. */
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

  it('una subida correcta, una con datos malos, una con otro monto y una de un token inexistente no dejan datos sensibles en el registro', async () => {
    const dni = '47811902';
    const cliente = await sembrarCobrable(e, {
      dni,
      nombres: 'Zenobia',
      apellidos: 'Quillahuaman Torrico',
      monto: '77.00',
    });
    const otro = await sembrarCobrable(e, { monto: '77.00' });
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
    const montoDistinto = await subir(otro.token, {
      datos: datosDeComprobante({ numeroOperacion: '9087654322', monto: '70.00' }),
    });
    const noEncontrada = await subir(tokenAleatorio());
    expect([correcta.status, datosMalos.status, montoDistinto.status, noEncontrada.status]).toEqual([
      201, 400, 409, 404,
    ]);
    await esperarHasta(() => lineas.filter((linea) => linea.includes('/solicitudes/comprobante')).length >= 4);
    await new Promise((resolver) => setTimeout(resolver, 150));

    expect(lineas.length, 'la aplicación escribió registros').toBeGreaterThan(0);
    const todo = lineas.join('\n');
    const sensibles: Record<string, string> = {
      token: cliente.token,
      dni,
      nombres: 'Zenobia',
      apellidos: 'Quillahuaman',
      numeroDeOperacion: numero,
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
      expect(todo).not.toContain(trozo.toString('base64'));
      expect(todo).not.toContain(trozo.toString('hex'));
      expect(todo).not.toContain(trozo.toString('base64url'));
    }
    expect(todo, 'el encabezado JPEG en base64').not.toContain('/9j/4');
    const redactadas = cabecerasRedactadas(lineas);
    expect(redactadas.datos, 'ninguna línea lleva req.headers["x-pago-datos"] redactado').toBeGreaterThan(0);
    expect(redactadas.token, 'ninguna línea lleva req.headers["x-token-solicitud"] redactado').toBeGreaterThan(0);
    expect(todo).toContain(TEXTO_REDACTADO);
    expect(todo, 'la petición se anota con su dirección sin datos').toContain('/solicitudes/comprobante');
  });
});
