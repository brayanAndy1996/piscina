// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  codigoDeRespuesta,
  crearEscenarioDePagos,
  detallesDeRespuesta,
  type EscenarioPagos,
  exigirRutasDePagos,
  AHORA_007,
  HOY_007,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  comprobanteDe,
  datosDeComprobante,
  exigirRutasDe007b,
  instantaneaConArchivos,
  jsonAscii,
  sembrarEnVerificacion,
  sembrarRechazada,
  subirComprobante,
} from '../../utilidades/escenario-pagos-007b';
import {
  camposConError,
  conRetencion,
  llenarClase,
  type RespuestaApi,
  rutaPublica,
  tokenAleatorio,
} from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  archivosBajo,
  crearAppConAlmacen,
  exigirAlmacen,
  FIRMA_JPEG,
  FIRMA_PNG,
  png,
} from '../../utilidades/inscripciones-005b';
import { leerPagos } from '../../utilidades/pagos';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 37 (crítico, HU-08, RNF-09; criterio 34 de 005): el orden de las comprobaciones de la subida del comprobante; la primera que falla decide:
//   1. límite por conexión (aparte, en `comprobante-limite-registro-007b.test.ts`); 2. tipo y codificación (400 `IMAGEN_NO_VALIDA`), antes de leer el cuerpo; 3. tamaño: más de 5 242 880 bytes, 413 `CARGA_EXCESIVA`;
//   4. academia: 404 `ACADEMIA_NO_ENCONTRADA` o 403 `ACADEMIA_SUSPENDIDA`; 5. `X-Pago-Datos`: falta, no es JSON, pasa de 1024 bytes o no cumple el esquema: 400 `SOLICITUD_INVALIDA` con `detalles.errores[].campo`;
//   6. token: el 404 `SOLICITUD_NO_ENCONTRADA` del seguimiento; 7. clave de idempotencia (criterio 42); 8. estado visible (criterio 41); 9. imagen (400 `IMAGEN_NO_VALIDA`, criterio 40);
//   10. dentro de la transacción, con las filas bloqueadas: estado otra vez, 409 `MONTO_DISTINTO`, 409 `NUMERO_OPERACION_YA_USADO` y 409 `SIN_CUPO` (reintento). Ningún rechazo deja un pago, un archivo ni una auditoría.
// Criterio 38 (crítico, HU-08, D-07, RNF-12; DR-6): `numeroOperacion`: texto de 1 a 40 caracteres que, normalizado, cumple `^[0-9A-Z]{1,30}$`. `monto`: `montoSchema`; si no es igual al total a cobrar, 409 `MONTO_DISTINTO` con
// `detalles: { total }`. `fechaOperacion`: una fecha real `AAAA-MM-DD`, no posterior a hoy en Lima ni anterior al día en Lima en que se creó la solicitud; si no, 400 en ese campo.
// Caso límite: un comprobante de 5 242 880 bytes pasa al resto de las comprobaciones; un byte más, 413.

const MB5 = 5 * 1024 * 1024; // 5 242 880

describe('subida del comprobante: el orden de las comprobaciones y los datos (criterios 37 y 38)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioPagos;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ ahora: AHORA_007 });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const snapshot = () => instantaneaConArchivos(ctx, e);
  const subir = (cliente: { token: string }, datos: Record<string, unknown> = {}, extra = {}) =>
    comprobanteDe(ctx, cliente, datos, extra);

  /** Una subida que debe rechazarse con ese estado y ese código, sin cambiar nada (ni pagos, ni auditoría, ni archivos). */
  async function rechazada(
    respuesta: Promise<RespuestaApi>,
    status: number,
    codigo: string,
    descripcion: string,
  ): Promise<RespuestaApi> {
    const antes = await snapshot();
    const resultado = await respuesta;
    expect(resultado.status, `${descripcion}: ${resultado.texto}`).toBe(status);
    expect(codigoDeRespuesta(resultado), descripcion).toBe(codigo);
    expect(resultado.cacheControl, descripcion).toBe('no-store');
    expect(await snapshot(), `${descripcion}: un rechazo cambió algo`).toBe(antes);
    return resultado;
  }

  describe('2. tipo y codificación: antes del cuerpo, de los datos, de la academia y del token', () => {
    it.each([
      ['un tipo que no es de imagen (image/gif)', { tipo: 'image/gif' }],
      ['sin Content-Type', { tipo: null }],
      ['image/jpg', { tipo: 'image/jpg' }],
      ['una codificación gzip', { codificacion: 'gzip' }],
    ])(
      'criterio 37: %s responde 400 IMAGEN_NO_VALIDA aunque falten los datos, el token y la academia no exista',
      async (_nombre, extra) => {
        const cliente = await sembrarCobrable(e);

        await rechazada(
          subirComprobante(ctx, 'no-existe', { token: tokenAleatorio(), datos: null, cuerpo: png(100, 100), ...extra }),
          400,
          'IMAGEN_NO_VALIDA',
          'tipo o codificación sin datos, con token inexistente y academia inexistente',
        );
        await rechazada(
          subir(cliente, { monto: '1.00' }, extra),
          400,
          'IMAGEN_NO_VALIDA',
          'tipo o codificación con datos que fallarían después',
        );
      },
    );

    it('criterio 37: con la academia suspendida, un tipo malo también responde 400 (el tipo va antes que la academia)', async () => {
      await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');

      await rechazada(
        subirComprobante(ctx, 'academia-b', { token: tokenAleatorio(), tipo: 'image/gif' }),
        400,
        'IMAGEN_NO_VALIDA',
        'academia suspendida con tipo malo',
      );
    });
  });

  describe('3. tamaño: 5 242 880 bytes pasan; un byte más es 413', () => {
    it('criterio 37: 5 242 881 bytes responden 413 CARGA_EXCESIVA y no cambian nada', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = Buffer.concat([FIRMA_JPEG, Buffer.alloc(MB5 + 1 - FIRMA_JPEG.length)]);

      await rechazada(subir(cliente, {}, { cuerpo, tipo: 'image/jpeg' }), 413, 'CARGA_EXCESIVA', '5 242 881 bytes');
    });

    it('criterio 37: un Content-Length de 6 MB responde 413 sin leer el cuerpo, también con datos inválidos, sin token y con una academia que no existe o suspendida (el tamaño va antes)', async () => {
      await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');

      for (const nombreCorto of ['academia-a', 'no-existe', 'academia-b']) {
        const respuesta = await subirComprobante(ctx, nombreCorto, {
          token: null,
          datos: '{',
          cuerpo: Buffer.from(FIRMA_PNG),
          largoDeclarado: 6 * 1024 * 1024,
          plazoMs: 8000,
        });

        expect([respuesta.status, codigoDeRespuesta(respuesta)], `${nombreCorto}: ${respuesta.texto}`).toEqual([
          413,
          'CARGA_EXCESIVA',
        ]);
      }
    });

    it('criterio 37: sin Content-Length (cuerpo troceado) que pasa de 5 MB, la lectura se corta y responde 413', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = Buffer.concat([FIRMA_JPEG, Buffer.alloc(6 * 1024 * 1024)]);

      await rechazada(
        subir(cliente, {}, { cuerpo, tipo: 'image/jpeg', troceado: true }),
        413,
        'CARGA_EXCESIVA',
        'cuerpo troceado de 6 MB',
      );
    });

    it('criterio 37 (caso límite): un cuerpo de 5 242 880 bytes exactos no se rechaza por tamaño: pasa a las demás comprobaciones (400 IMAGEN_NO_VALIDA del paso 9, no 413)', async () => {
      const cliente = await sembrarCobrable(e);
      const cuerpo = Buffer.concat([FIRMA_JPEG, Buffer.alloc(MB5 - FIRMA_JPEG.length)]);
      expect(cuerpo.length).toBe(5_242_880);

      await rechazada(subir(cliente, {}, { cuerpo, tipo: 'image/jpeg' }), 400, 'IMAGEN_NO_VALIDA', '5 242 880 bytes');
    });
  });

  describe('4. academia: antes de los datos', () => {
    it('criterio 37: una academia que no existe responde 404 ACADEMIA_NO_ENCONTRADA aunque falte X-Pago-Datos', async () => {
      await rechazada(
        subirComprobante(ctx, 'no-existe', { token: tokenAleatorio(), datos: null }),
        404,
        'ACADEMIA_NO_ENCONTRADA',
        'academia inexistente',
      );
    });

    it('criterio 37: con la academia suspendida responde 403 ACADEMIA_SUSPENDIDA antes de mirar los datos y el token (datos inválidos, token inexistente o sin token)', async () => {
      await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');

      for (const [nombre, opciones] of [
        ['datos inválidos', { token: tokenAleatorio(), datos: '{' }],
        ['sin datos y sin token', { token: null, datos: null }],
        ['todo válido pero de B', { token: tokenAleatorio() }],
      ] as const) {
        await rechazada(subirComprobante(ctx, 'academia-b', { ...opciones }), 403, 'ACADEMIA_SUSPENDIDA', nombre);
      }
    });
  });

  describe('5. X-Pago-Datos: antes del token', () => {
    it.each([
      ['falta la cabecera', null],
      ['no es JSON', '{'],
      ['es JSON pero no un objeto (arreglo)', '[]'],
      ['es JSON pero no un objeto (null)', 'null'],
      ['es JSON pero no un objeto (texto)', '"texto"'],
    ])(
      'criterio 37: si %s, responde 400 SOLICITUD_INVALIDA aunque el token no exista (los datos van antes que el token)',
      async (_nombre, datos) => {
        await rechazada(
          subirComprobante(ctx, 'academia-a', { token: tokenAleatorio(), datos }),
          400,
          'SOLICITUD_INVALIDA',
          `datos ${String(datos)}`,
        );
      },
    );

    it('criterio 37: más de 1024 bytes responden 400 aunque el JSON sea válido; exactamente 1024 bytes se aceptan', async () => {
      const cliente = await sembrarCobrable(e);
      const otro = await sembrarCobrable(e);
      const relleno = (datos: Record<string, unknown>, largo: number): string => {
        const base = jsonAscii(datos);
        return `{${' '.repeat(largo - base.length)}${base.slice(1)}`;
      };
      const exactos = relleno(datosDeComprobante(), 1024);
      const demasiado = relleno(datosDeComprobante(), 1025);
      expect([exactos.length, demasiado.length]).toEqual([1024, 1025]);

      await rechazada(
        subirComprobante(ctx, 'academia-a', { token: cliente.token, datos: demasiado }),
        400,
        'SOLICITUD_INVALIDA',
        '1025 bytes',
      );
      const aceptado = await subirComprobante(ctx, 'academia-a', { token: otro.token, datos: exactos });

      expect(aceptado.status, aceptado.texto).toBe(201);
    });

    it('criterio 37: los datos se comprueban antes que el token: un token de otra academia con datos inválidos responde 400, no 404', async () => {
      const deB = await sembrarCobrable(e);

      await rechazada(
        subirComprobante(ctx, 'academia-b', { token: deB.token, datos: jsonAscii(datosDeComprobante({ monto: 'x' })) }),
        400,
        'SOLICITUD_INVALIDA',
        'token de A en B con datos inválidos',
      );
    });
  });

  describe('6. token: el mismo 404 del seguimiento', () => {
    it('criterio 37: sin la cabecera, vacía, repetida, con otro formato, inexistente o de otra academia responde 404 SOLICITUD_NO_ENCONTRADA, todos con el mismo cuerpo que el de la consulta', async () => {
      const cliente = await sembrarCobrable(e);
      const referencia = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
        token: tokenAleatorio(),
      });
      expect(referencia.status).toBe(404);
      const casos: [string, Parameters<typeof subirComprobante>[2]][] = [
        ['sin la cabecera', { token: null }],
        ['cabecera vacía', { token: '' }],
        ['cabecera repetida', { token: [cliente.token, cliente.token] }],
        ['un carácter de más', { token: `${cliente.token}A` }],
        ['un carácter de menos', { token: cliente.token.slice(0, -1) }],
        ['inexistente', { token: tokenAleatorio() }],
      ];

      for (const [nombre, opciones] of casos) {
        const respuesta = await rechazada(
          subirComprobante(ctx, 'academia-a', { ...opciones }),
          404,
          'SOLICITUD_NO_ENCONTRADA',
          nombre,
        );
        expect(respuesta.texto, nombre).toBe(referencia.texto);
      }
    });

    it('criterio 37: el token de A usado en la dirección de B (y al revés) responde el mismo 404 y no toca nada; un `academiaId` en la dirección no cambia de academia', async () => {
      const deA = await sembrarCobrable(e);

      await rechazada(
        subirComprobante(ctx, 'academia-b', { token: deA.token }),
        404,
        'SOLICITUD_NO_ENCONTRADA',
        'token de A en B',
      );
      await rechazada(
        subirComprobante(ctx, 'academia-b', {
          token: deA.token,
          ruta: `/api/a/academia-b/solicitudes/comprobante?academiaId=${e.A.id}`,
          headers: { 'x-academia-id': e.A.id },
        }),
        404,
        'SOLICITUD_NO_ENCONTRADA',
        'token de A en B con academiaId de A',
      );
    });

    it('criterio 37: el token va antes que la clave, el estado, la imagen y el monto: un token inexistente con una imagen que no sirve, una clave usada y un monto distinto responde 404', async () => {
      const uno = await sembrarCobrable(e);
      const datos = datosDeComprobante();
      expect((await subirComprobante(ctx, 'academia-a', { token: uno.token, datos })).status).toBe(201);

      await rechazada(
        subirComprobante(ctx, 'academia-a', {
          token: tokenAleatorio(),
          datos: { ...datos, monto: '1.00' },
          cuerpo: Buffer.from('basura'),
        }),
        404,
        'SOLICITUD_NO_ENCONTRADA',
        'token inexistente con basura y clave usada',
      );
    });
  });

  describe('7 a 9. clave, estado e imagen, en ese orden', () => {
    it('criterio 37: la clave va antes que el estado y que la imagen: la clave de otra solicitud con una cancelada y una imagen que no sirve responde 409 CLAVE_YA_USADA', async () => {
      const uno = await sembrarCobrable(e);
      const cancelada = await sembrarCobrable(e, { estado: 'CANCELADA' });
      const pendiente = await sembrarCobrable(e);
      const datos = datosDeComprobante();
      expect((await subirComprobante(ctx, 'academia-a', { token: uno.token, datos })).status).toBe(201);

      await rechazada(
        subirComprobante(ctx, 'academia-a', { token: cancelada.token, datos: { ...datos, numeroOperacion: '777' } }),
        409,
        'CLAVE_YA_USADA',
        'clave usada con una solicitud cancelada',
      );
      await rechazada(
        subirComprobante(ctx, 'academia-a', {
          token: pendiente.token,
          datos: { ...datos, numeroOperacion: '778' },
          cuerpo: Buffer.from('basura'),
        }),
        409,
        'CLAVE_YA_USADA',
        'clave usada con una imagen que no sirve',
      );
    });

    it('criterio 37: el estado va antes que la imagen: una solicitud cancelada con un cuerpo que no es una imagen responde 409 SOLICITUD_NO_EDITABLE, no 400; con un comprobante en revisión, 409 PAGO_EN_VERIFICACION', async () => {
      const cancelada = await sembrarCobrable(e, { estado: 'CANCELADA' });
      const enRevision = await sembrarEnVerificacion(e);

      await rechazada(
        subir(cancelada, {}, { cuerpo: Buffer.from('basura') }),
        409,
        'SOLICITUD_NO_EDITABLE',
        'cancelada con basura',
      );
      await rechazada(
        subir(enRevision, {}, { cuerpo: Buffer.from('basura') }),
        409,
        'PAGO_EN_VERIFICACION',
        'en revisión con basura',
      );
    });

    it('criterio 37: la imagen va antes que las comprobaciones de la transacción: una imagen que no sirve con un monto distinto y con un número ya usado responde 400 IMAGEN_NO_VALIDA', async () => {
      const cliente = await sembrarCobrable(e);
      await sembrarEnVerificacion(e, { numeroOperacion: '555123' });

      await rechazada(
        subir(cliente, { monto: '1.00', numeroOperacion: '555123' }, { cuerpo: Buffer.from('basura') }),
        400,
        'IMAGEN_NO_VALIDA',
        'imagen mala con monto distinto y número usado',
      );
    });
  });

  describe('10. dentro de la transacción: estado, monto, número y cupo, en ese orden', () => {
    it('criterio 37: el monto distinto va antes que el número ya usado: 409 MONTO_DISTINTO con { total }', async () => {
      const cliente = await sembrarCobrable(e);
      await sembrarEnVerificacion(e, { numeroOperacion: '555123' });

      const respuesta = await rechazada(
        subir(cliente, { monto: '41.99', numeroOperacion: '555123' }),
        409,
        'MONTO_DISTINTO',
        'monto distinto y número usado',
      );

      expect(detallesDeRespuesta(respuesta)).toEqual({ total: '42.00' });
    });

    it('criterio 37: el número ya usado va antes que el cupo: un reintento con la clase llena y el número de otro pago abierto responde 409 NUMERO_OPERACION_YA_USADO; con un número libre, SIN_CUPO', async () => {
      const cliente = await sembrarRechazada(e);
      await sembrarEnVerificacion(e, { numeroOperacion: '555123', claseIds: [e.miercoles.id] });
      await llenarClase(e.A.id, e.lunes.id, e.plan.id, 20);

      await rechazada(
        subir(cliente, { numeroOperacion: '555123' }),
        409,
        'NUMERO_OPERACION_YA_USADO',
        'número usado con la clase llena',
      );
      await rechazada(
        subir(cliente, { numeroOperacion: '555124' }),
        409,
        'SIN_CUPO',
        'número libre con la clase llena',
      );
    });

    it('criterio 37: el estado se decide otra vez con las filas bloqueadas: si la solicitud se cancela mientras la subida espera, responde 409 SOLICITUD_NO_EDITABLE, no deja pago ni archivo', async () => {
      const cliente = await sembrarCobrable(e);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar(
            `UPDATE solicitudes_inscripcion SET estado = 'CANCELADA' WHERE academia_id = $1::uuid AND id = $2::uuid`,
            [e.A.id, cliente.solicitudId],
          );
          await retenedor.consultar(
            `UPDATE matriculas SET estado = 'CANCELADA', reserva_vence_en = NULL WHERE academia_id = $1::uuid AND id = $2::uuid`,
            [e.A.id, cliente.matriculaId],
          );
        },
        enviar: [() => subir(cliente)],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron, 'la subida debía quedar esperando la fila de la solicitud o de la matrícula').toBe(true);
      const respuesta = resultados[0] as RespuestaApi;
      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(await leerPagos(e.A.id)).toEqual([]);
      expect(archivosBajo(ctx.raiz), 'el archivo nuevo se borra si la transacción rechaza').toEqual([]);
    });
  });

  describe('criterio 38: los datos del comprobante (DR-6)', () => {
    const MALOS: [string, string, Record<string, unknown>][] = [
      ['numeroOperacion', 'vacío', { numeroOperacion: '' }],
      ['numeroOperacion', 'solo espacios', { numeroOperacion: '     ' }],
      ['numeroOperacion', 'de 41 caracteres', { numeroOperacion: '1'.repeat(41) }],
      ['numeroOperacion', 'con 31 caracteres normalizados', { numeroOperacion: '1'.repeat(31) }],
      ['numeroOperacion', 'con una letra con tilde', { numeroOperacion: 'operación123' }],
      ['numeroOperacion', 'con un carácter de control', { numeroOperacion: '123\u0007456' }],
      ['numeroOperacion', 'con un carácter de dirección del texto', { numeroOperacion: '123\u202E456' }],
      ['numeroOperacion', 'con un símbolo', { numeroOperacion: '123#456' }],
      ['numeroOperacion', 'que no es un texto', { numeroOperacion: 12345 }],
      ['monto', 'que no es un número', { monto: 'abc' }],
      ['monto', 'cero', { monto: '0' }],
      ['monto', 'negativo', { monto: '-42' }],
      ['monto', 'con tres decimales', { monto: '42.001' }],
      ['monto', 'de más de 99999.99', { monto: '100000' }],
      ['monto', 'como número JSON', { monto: 42 }],
      ['fechaOperacion', 'que no existe (30 de febrero)', { fechaOperacion: '2026-02-30' }],
      ['fechaOperacion', 'con otro formato', { fechaOperacion: '11/11/2026' }],
      ['fechaOperacion', 'sin ceros', { fechaOperacion: '2026-11-1' }],
      ['fechaOperacion', 'con hora', { fechaOperacion: '2026-11-11T10:00:00Z' }],
      ['fechaOperacion', 'vacía', { fechaOperacion: '' }],
      ['fechaOperacion', 'posterior a hoy en Lima', { fechaOperacion: '2026-11-12' }],
      ['fechaOperacion', 'anterior al día en que se creó la solicitud', { fechaOperacion: '2026-11-10' }],
      ['metodo', 'EFECTIVO (no se sube comprobante de efectivo)', { metodo: 'EFECTIVO' }],
      ['metodo', 'desconocido', { metodo: 'PAYPAL' }],
      ['metodo', 'en minúsculas', { metodo: 'yape' }],
      ['claveIdempotencia', 'que no es un UUID', { claveIdempotencia: 'no-es-uuid' }],
      ['claveIdempotencia', 'ausente', { claveIdempotencia: undefined }],
      ['monto', 'ausente', { monto: undefined }],
    ];

    it.each(MALOS)(
      'criterio 38: %s %s responde 400 SOLICITUD_INVALIDA en ese campo y no escribe',
      async (campo, _nombre, cambio) => {
        const cliente = await sembrarCobrable(e);

        const respuesta = await rechazada(
          subirComprobante(ctx, 'academia-a', { token: cliente.token, datos: datosDeComprobante(cambio) }),
          400,
          'SOLICITUD_INVALIDA',
          `${campo} ${_nombre}`,
        );

        expect(camposConError(respuesta)).toContain(campo);
      },
    );

    it('criterio 38: un campo de más (la academia, el estado, quién lo registró) responde 400 por el esquema estricto', async () => {
      const cliente = await sembrarCobrable(e);

      for (const extra of [{ academiaId: e.A.id }, { estado: 'CONFIRMADO' }, { registradoPor: e.secretariaA.id }]) {
        await rechazada(
          subirComprobante(ctx, 'academia-a', { token: cliente.token, datos: datosDeComprobante(extra) }),
          400,
          'SOLICITUD_INVALIDA',
          JSON.stringify(extra),
        );
      }
    });

    it('criterio 38: los límites que sí valen se aceptan: 40 caracteres que normalizados son 30, letras en minúscula con guiones y espacios, y letras de ancho completo', async () => {
      for (const numeroOperacion of [`0000000000${'1'.repeat(30)}`, ' ab-12 cd.34/ef_56 ', 'ＡＢ１２３４']) {
        const cliente = await sembrarCobrable(e);

        const respuesta = await subir(cliente, { numeroOperacion });

        expect(respuesta.status, `${numeroOperacion}: ${respuesta.texto}`).toBe(201);
      }
    });

    it.each([
      ['uno menos', '41.99'],
      ['un céntimo más', '42.01'],
      ['un sol más', '43.00'],
      ['el precio del plan', '120.00'],
      ['la mitad', '21.00'],
    ])(
      'criterio 38 y DR-6: un monto distinto del total (%s) responde 409 MONTO_DISTINTO con { total: "42.00" } y no escribe',
      async (_nombre, monto) => {
        const cliente = await sembrarCobrable(e);

        const respuesta = await rechazada(subir(cliente, { monto }), 409, 'MONTO_DISTINTO', `monto ${monto}`);

        expect(detallesDeRespuesta(respuesta)).toEqual({ total: '42.00' });
      },
    );

    it('criterio 38: el total es el de la matrícula guardada, no el del plan: si el administrador sube el precio del plan después de la solicitud, el total sigue siendo S/ 42.00', async () => {
      const cliente = await sembrarCobrable(e);
      await ejecutarComo(
        'propietario',
        'UPDATE planes SET precio = 200.00 WHERE academia_id = $1::uuid AND id = $2::uuid',
        [e.A.id, e.plan.id],
        { academiaId: e.A.id },
      );

      const conElPrecioNuevo = await subir(cliente, { monto: '200.00' });
      const conElTotal = await subir(cliente, { monto: '42.00' });

      expect([conElPrecioNuevo.status, codigoDeRespuesta(conElPrecioNuevo)]).toEqual([409, 'MONTO_DISTINTO']);
      expect(conElTotal.status, conElTotal.texto).toBe(201);
    });

    it('criterio 38 y RNF-12: la fecha de operación se compara en Lima: el día de la creación (según Lima, no UTC) se acepta y el anterior no', async () => {
      // Creada el 10 de noviembre a las 03:00 UTC = el 9 de noviembre a las 22:00 en Lima.
      const cliente = await sembrarCobrable(e, { creadaEn: new Date('2026-11-10T03:00:00.000Z') });
      const otro = await sembrarCobrable(e, { creadaEn: new Date('2026-11-10T03:00:00.000Z') });

      await rechazada(
        subir(cliente, { fechaOperacion: '2026-11-08' }),
        400,
        'SOLICITUD_INVALIDA',
        'el día anterior a la creación en Lima',
      );
      const mismoDia = await subir(otro, { fechaOperacion: '2026-11-09' });

      expect(mismoDia.status, mismoDia.texto).toBe(201);
    });

    it('criterio 38 y RNF-12: hoy se compara en Lima: a las 23:30 del 11 en Lima (ya es 12 en UTC) el 11 se acepta y el 12 no; a las 00:00 del 12 el 12 se acepta', async () => {
      const antes = await sembrarCobrable(e);
      const despues = await sembrarCobrable(e);

      ctx.reloj.fijar(new Date('2026-11-12T04:30:00.000Z'));
      await rechazada(subir(antes, { fechaOperacion: '2026-11-12' }), 400, 'SOLICITUD_INVALIDA', 'mañana en Lima');
      const hoy = await subir(antes, { fechaOperacion: HOY_007 });
      ctx.reloj.fijar(new Date('2026-11-12T05:00:00.000Z'));
      const alDiaSiguiente = await subir(despues, { fechaOperacion: '2026-11-12' });

      expect(hoy.status, hoy.texto).toBe(201);
      expect(alDiaSiguiente.status, alDiaSiguiente.texto).toBe(201);
    });
  });
});
