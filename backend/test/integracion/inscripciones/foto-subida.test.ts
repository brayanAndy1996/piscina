// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fijarEstadoDeAcademia, contarAuditoria } from '../../utilidades/usuarios';
import {
  AHORA_005,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerAlumnos,
  type OpcionesSembrado,
  type RespuestaApi,
  rutaPublica,
  sembrarSolicitud,
  type SolicitudSembrada,
  solicitudDe,
  tokenAleatorio,
  cancelarTodasLasReservas,
} from '../../utilidades/inscripciones';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  type AppConAlmacen,
  archivosBajo,
  archivosDelAlumno,
  crearAppConAlmacen,
  exigirAlmacen,
  existeArchivoDeClave,
  fotoClaveDe,
  jpeg,
  png,
  subirFoto,
  subirFotoValida,
  FIRMA_JPEG,
  FIRMA_PNG,
} from '../../utilidades/inscripciones-005b';

// Criterio 34 (crítico, D-20, D-24; límites de `CLAUDE.md`; PB3, PB4 y PB5), subida de la foto: `PUT /api/a/{nombreCorto}/solicitudes/foto`
// con el token en `X-Token-Solicitud` y la imagen como cuerpo binario (`image/jpeg` o `image/png`). Responde 204 si el token es de una
// solicitud PENDIENTE_PAGO no vencida de la academia cuyo alumno es CLIENTE. El orden de las comprobaciones, la primera que falla decide:
//   a) límite por conexión (429; aparte, en `limite-foto.test.ts`);
//   b) tipo y codificación, antes de leer el cuerpo y antes de buscar la academia → 400 IMAGEN_NO_VALIDA;
//   c) tamaño: más de 5 242 880 bytes → 413 CARGA_EXCESIVA (con Content-Length mayor, sin leer el cuerpo; sin Content-Length, deja de leer);
//   d) academia → 404 ACADEMIA_NO_ENCONTRADA o 403 ACADEMIA_SUSPENDIDA;
//   e) token (sin cabecera, vacía, repetida, con otro formato, inexistente, de otra academia) → 404 SOLICITUD_NO_ENCONTRADA, el mismo del criterio 31;
//   f) solicitud editable: 409 SOLICITUD_NO_EDITABLE ({ codigo, mensaje }, sin detalles) si el estado visible es VENCIDA o CANCELADA (también
//      en el instante exacto del vencimiento y en el último milisegundo del mes), si la fila ya no es PENDIENTE_PAGO o si el alumno ya no es CLIENTE;
//   g) imagen: 400 IMAGEN_NO_VALIDA con el cuerpo vacío, la firma que no es la del tipo declarado, una imagen que sharp no decodifica (también
//      cortada) o dimensiones (tal como vienen en el archivo) con un lado menor que 100 o mayor que 8000 píxeles, o más de 40 000 000 píxeles.
// Con todo bien: 204 sin cuerpo y con `Cache-Control: no-store`; la foto nueva reemplaza a la anterior y la vista completa pasa a
// `fotoCargada: true`. Todos los 400 IMAGEN_NO_VALIDA tienen el mismo cuerpo. Ningún rechazo cambia `alumnos.foto_clave`, deja un archivo
// nuevo en el almacén ni audita. Los demás métodos sobre esa dirección no son rutas.

interface Imagen {
  cuerpo: Buffer;
  tipo: string;
}
const MB5 = 5 * 1024 * 1024; // 5 242 880
const PATRON_CLAVE =
  /^academias\/[0-9a-f-]{36}\/alumnos\/[0-9a-f-]{36}\/foto-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

describe('subida de la foto de la solicitud (criterio 34)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ ahora: AHORA_005 });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    ctx.vaciarAlmacen();
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const sembrar = (opciones: Partial<OpcionesSembrado> = {}, academiaId = e.A.id): Promise<SolicitudSembrada> =>
    sembrarSolicitud(academiaId, {
      planId: academiaId === e.A.id ? e.plan.id : e.planB.id,
      claseIds: academiaId === e.A.id ? [e.lunes.id, e.miercoles.id, e.viernes.id] : [e.lunesB.id],
      ...opciones,
    });
  const subir = (token: string, cuerpo: Buffer = png(100, 100), extra = {}, nombreCorto = 'academia-a') =>
    subirFoto(ctx, nombreCorto, { token, cuerpo, ...extra });
  const consultarPorToken = (token: string) =>
    ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { token });
  const fotoDe = (alumnoId: string, academiaId = e.A.id) => fotoClaveDe(academiaId, alumnoId);

  /** Todo lo que un rechazo no puede cambiar: las siete tablas de A y de B, los archivos del almacén y la auditoría. */
  async function estado() {
    return {
      tablasA: await instantaneaDeInscripciones(e.A.id),
      tablasB: await instantaneaDeInscripciones(e.B.id),
      archivos: archivosBajo(ctx.raiz),
      auditoriaA: await contarAuditoria(e.A.id),
      auditoriaB: await contarAuditoria(e.B.id),
    };
  }

  async function rechazada(
    respuesta: Promise<RespuestaApi>,
    status: number,
    codigo: string,
    descripcion: string,
  ): Promise<RespuestaApi> {
    const antes = await estado();
    const resultado = await respuesta;
    expect(resultado.status, `${descripcion}: ${resultado.texto}`).toBe(status);
    expect(resultado.body?.['codigo'], descripcion).toBe(codigo);
    expect(resultado.cacheControl, descripcion).toBe('no-store');
    expect(await estado(), `${descripcion}: un rechazo cambió algo`).toEqual(antes);
    return resultado;
  }

  describe('éxito', () => {
    it('criterio 34: un PNG válido responde 204 sin cuerpo y con Cache-Control: no-store, y guarda la foto con la clave del servidor', async () => {
      const cliente = await sembrar();

      const respuesta = await subir(cliente.token);

      expect(respuesta.status, respuesta.texto).toBe(204);
      expect(respuesta.texto).toBe('');
      expect(respuesta.cacheControl).toBe('no-store');
      const clave = await fotoDe(cliente.alumnoId);
      expect(clave).toMatch(PATRON_CLAVE);
      expect(clave).toContain(`academias/${e.A.id}/alumnos/${cliente.alumnoId}/`);
      expect(existeArchivoDeClave(ctx.raiz, clave as string)).toBe(true);
      expect(archivosDelAlumno(ctx.raiz, e.A.id, cliente.alumnoId)).toEqual([clave]);
    });

    it('criterio 34: un JPEG válido responde 204', async () => {
      const cliente = await sembrar();

      const respuesta = await subir(cliente.token, await jpeg(300, 200), { tipo: 'image/jpeg' });

      expect(respuesta.status, respuesta.texto).toBe(204);
      expect(await fotoDe(cliente.alumnoId)).toMatch(PATRON_CLAVE);
    });

    it.each([
      ['IMAGE/PNG', undefined],
      ['  image/png  ', undefined],
      ['image/png; charset=binary', undefined],
      ['image/png', 'identity'],
      ['image/png', '  IDENTITY  '],
    ])(
      'criterio 34 b: el tipo %j (con Content-Encoding %j) se acepta: el tipo se compara sin mayúsculas, recortado y sin sus parámetros',
      async (tipo, codificacion) => {
        const cliente = await sembrar();

        const respuesta = await subir(cliente.token, png(100, 100), { tipo, codificacion });

        expect(respuesta.status, respuesta.texto).toBe(204);
      },
    );

    it('criterio 34: la dirección con barra final y con otras mayúsculas en sus segmentos fijos también es la ruta de la foto', async () => {
      const a = await sembrar();
      const b = await sembrar();

      const conBarra = await subirFoto(ctx, 'academia-a', {
        token: a.token,
        cuerpo: png(100, 100),
        ruta: '/api/a/academia-a/solicitudes/foto/',
      });
      const conMayusculas = await subirFoto(ctx, 'academia-a', {
        token: b.token,
        cuerpo: png(100, 100),
        ruta: '/api/a/academia-a/Solicitudes/FOTO',
      });

      expect(conBarra.status, conBarra.texto).toBe(204);
      expect(conMayusculas.status, conMayusculas.texto).toBe(204);
    });

    it('criterio 34 y 58: antes de subir, la vista completa trae fotoCargada: false; después, true, por token y por código con DNI; la vista reducida sigue sin la clave', async () => {
      const cliente = await sembrar();
      const consultarPorCodigo = () =>
        ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { codigo: cliente.codigo, dni: cliente.dni });
      const solicitudDeVista = (r: RespuestaApi) => r.body?.['solicitud'] as Record<string, unknown>;
      expect(solicitudDeVista(await consultarPorToken(cliente.token))['fotoCargada']).toBe(false);

      expect((await subir(cliente.token)).status).toBe(204);

      const porToken = await consultarPorToken(cliente.token);
      const porCodigo = await consultarPorCodigo();
      expect(solicitudDeVista(porToken)['fotoCargada']).toBe(true);
      expect(solicitudDeVista(porCodigo)['fotoCargada']).toBe(true);
      expect(porToken.texto).toBe(porCodigo.texto);

      await cancelarTodasLasReservas(e.A.id);
      const reducida = solicitudDeVista(await consultarPorToken(cliente.token));
      expect(reducida['estado']).toBe('CANCELADA');
      expect('fotoCargada' in reducida).toBe(false);
    });

    it('criterio 34: una foto nueva reemplaza a la anterior: cambia la clave, queda un solo archivo y es el de foto_clave', async () => {
      const cliente = await sembrar();
      expect((await subir(cliente.token, png(100, 100))).status).toBe(204);
      const primera = await fotoDe(cliente.alumnoId);

      const segunda = await subir(cliente.token, await jpeg(120, 120), { tipo: 'image/jpeg' });

      expect(segunda.status, segunda.texto).toBe(204);
      const clave = await fotoDe(cliente.alumnoId);
      expect(clave).toMatch(PATRON_CLAVE);
      expect(clave).not.toBe(primera);
      expect(existeArchivoDeClave(ctx.raiz, primera as string), 'la foto anterior sigue en el almacén').toBe(false);
      expect(archivosDelAlumno(ctx.raiz, e.A.id, cliente.alumnoId)).toEqual([clave]);
    });

    it('criterio 34: una solicitud PENDIENTE_PAGO sin vencimiento (pago en verificación, desde la 007) sigue aceptando la foto', async () => {
      const cliente = await sembrar({ reservaVenceEn: null });

      const respuesta = await subir(cliente.token);

      expect(respuesta.status, respuesta.texto).toBe(204);
    });

    it('criterio 34 f: un milisegundo antes del vencimiento de la reserva se acepta; en el instante exacto del vencimiento ya es 409 SOLICITUD_NO_EDITABLE', async () => {
      const casi = await sembrar({ reservaVenceEn: new Date(AHORA_005.getTime() + 1) });
      const justo = await sembrar({ reservaVenceEn: new Date(AHORA_005.getTime()) });

      expect((await subir(casi.token)).status).toBe(204);
      const rechazo = await subir(justo.token);
      expect(rechazo.status, rechazo.texto).toBe(409);
      expect(rechazo.body?.['codigo']).toBe('SOLICITUD_NO_EDITABLE');
    });

    it('criterio 34 f y 54 (caso límite): a las 23:59:59.998 del último día del mes en Lima se acepta; a las 23:59:59.999, cuando la reserva ya venció por el tope del fin de mes, 409', async () => {
      const finDelMes = new Date('2026-12-01T04:59:59.999Z');
      const cliente = await sembrar({ reservaVenceEn: finDelMes });

      ctx.reloj.fijar(new Date('2026-12-01T04:59:59.998Z'));
      const antes = await subir(cliente.token);
      ctx.reloj.fijar(finDelMes);
      const justo = await subir(cliente.token);

      expect(antes.status, antes.texto).toBe(204);
      expect(justo.status, justo.texto).toBe(409);
      expect(justo.body?.['codigo']).toBe('SOLICITUD_NO_EDITABLE');
    });

    it('criterio 34 (caso límite 21 b): desde el enlace de la solicitud anterior de un cliente que volvió (fila VENCIDA) responde 409; desde el enlace de la nueva, 204', async () => {
      const anterior = await sembrar({ estado: 'PENDIENTE_PAGO_VENCIDA' });
      const envio = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(e, { sobre: { alumno: { dni: anterior.dni } } }),
      );
      expect(envio.status, envio.texto).toBe(201);
      const nueva = solicitudDe(envio);

      const conLaAnterior = await subir(anterior.token);
      const conLaNueva = await subir(nueva.token);

      expect(conLaAnterior.status, conLaAnterior.texto).toBe(409);
      expect(conLaAnterior.body?.['codigo']).toBe('SOLICITUD_NO_EDITABLE');
      expect(conLaNueva.status, conLaNueva.texto).toBe(204);
    });

    it('criterio 34 (caso límite, respuesta B3 / DR-19): un cliente que vuelve con una foto ya subida la conserva: el reenvío no toca foto_clave y la nueva solicitud muestra fotoCargada: true', async () => {
      const anterior = await sembrar({ estado: 'PENDIENTE_PAGO_VENCIDA' });
      const claveGuardada = `academias/${e.A.id}/alumnos/${anterior.alumnoId}/foto-00000000-0000-4000-8000-000000000001.jpg`;
      await ejecutarComo(
        'propietario',
        'UPDATE alumnos SET foto_clave = $3 WHERE academia_id = $1::uuid AND id = $2::uuid',
        [e.A.id, anterior.alumnoId, claveGuardada],
        { academiaId: e.A.id },
      );

      const envio = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(e, { sobre: { alumno: { dni: anterior.dni } } }),
      );

      expect(envio.status, envio.texto).toBe(201);
      expect(await fotoDe(anterior.alumnoId)).toBe(claveGuardada);
      const vista = (await consultarPorToken(solicitudDe(envio).token)).body?.['solicitud'] as Record<string, unknown>;
      expect(vista['fotoCargada']).toBe(true);
    });
  });

  describe('409 SOLICITUD_NO_EDITABLE (f)', () => {
    const CASOS: [string, Partial<OpcionesSembrado>][] = [
      ['la fila VENCIDA (la solicitud anterior de un cliente que volvió)', { estado: 'VENCIDA' }],
      ['una solicitud CANCELADA', { estado: 'CANCELADA' }],
      ['una PENDIENTE_PAGO cuya reserva ya venció (se muestra VENCIDA)', { estado: 'PENDIENTE_PAGO_VENCIDA' }],
      ['un alumno que ya no es CLIENTE', { estadoAlumno: 'ALUMNO_ACTIVO' }],
    ];

    it.each(CASOS)(
      'criterio 34 f: %s responde 409 con { codigo, mensaje }, sin detalles, y no cambia nada',
      async (_nombre, opciones) => {
        const cliente = await sembrar(opciones);

        const respuesta = await rechazada(subir(cliente.token), 409, 'SOLICITUD_NO_EDITABLE', _nombre);

        expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['codigo', 'mensaje']);
        expect(await fotoDe(cliente.alumnoId)).toBeNull();
      },
    );

    it('criterio 34 f: el 409 se decide antes que la imagen: una solicitud vencida con un cuerpo que no es una imagen responde 409, no 400', async () => {
      const cliente = await sembrar({ estado: 'CANCELADA' });

      await rechazada(
        subir(cliente.token, Buffer.from('esto no es una imagen')),
        409,
        'SOLICITUD_NO_EDITABLE',
        'cancelada con basura',
      );
    });
  });

  describe('404 del token (e)', () => {
    it('criterio 34 e: sin la cabecera, con la cabecera vacía, repetida, con otro formato, inexistente o de otra academia responde 404 SOLICITUD_NO_ENCONTRADA, todos con el mismo cuerpo que el de la consulta (criterio 31)', async () => {
      const cliente = await sembrar();
      const deB = await sembrar({}, e.B.id);
      const referencia = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
        token: tokenAleatorio(),
      });
      expect(referencia.status).toBe(404);
      const casos: [string, Parameters<typeof subirFoto>[2]][] = [
        ['sin la cabecera', { token: null }],
        ['cabecera vacía', { token: '' }],
        ['cabecera repetida (dos tokens válidos de A)', { token: [cliente.token, cliente.token] }],
        ['un carácter de más', { token: `${cliente.token}A` }],
        ['un carácter de menos', { token: cliente.token.slice(0, -1) }],
        ['otro alfabeto', { token: `${cliente.token.slice(0, -1)}+` }],
        ['con espacios', { token: ` ${cliente.token} ` }],
        ['inexistente', { token: tokenAleatorio() }],
        ['de otra academia', { token: deB.token }],
      ];
      for (const [nombre, opciones] of casos) {
        const respuesta = await rechazada(
          subirFoto(ctx, 'academia-a', { cuerpo: png(100, 100), ...opciones }),
          404,
          'SOLICITUD_NO_ENCONTRADA',
          nombre,
        );
        expect(respuesta.texto, nombre).toBe(referencia.texto);
      }
    });

    it('criterio 34 e: el token de A usado en la dirección de B responde el mismo 404 y no toca nada de A ni de B', async () => {
      const cliente = await sembrar();

      await rechazada(
        subir(cliente.token, png(100, 100), {}, 'academia-b'),
        404,
        'SOLICITUD_NO_ENCONTRADA',
        'token de A en B',
      );
      expect(await fotoDe(cliente.alumnoId)).toBeNull();
    });

    it('criterio 34 e: el token se comprueba antes que la imagen: un token que no sirve con un cuerpo que no es una imagen responde 404, no 400', async () => {
      await rechazada(
        subir(tokenAleatorio(), Buffer.from('basura')),
        404,
        'SOLICITUD_NO_ENCONTRADA',
        'token inexistente con basura',
      );
    });

    it('criterio 34 y 7: un `academiaId`, en la dirección o en la consulta, no cambia de academia', async () => {
      const deB = await sembrar({}, e.B.id);

      await rechazada(
        subirFoto(ctx, 'academia-a', {
          token: deB.token,
          cuerpo: png(100, 100),
          ruta: `/api/a/academia-a/solicitudes/foto?academiaId=${e.B.id}`,
          headers: { 'x-academia-id': e.B.id },
        }),
        404,
        'SOLICITUD_NO_ENCONTRADA',
        'token de B con academiaId de B',
      );
    });
  });

  describe('academia (d)', () => {
    it('criterio 34 d: una academia que no existe responde 404 ACADEMIA_NO_ENCONTRADA, también con un token y una imagen válidos', async () => {
      const cliente = await sembrar();

      const respuesta = await subir(cliente.token, png(100, 100), {}, 'no-existe');

      expect(respuesta.status, respuesta.texto).toBe(404);
      expect(respuesta.body?.['codigo']).toBe('ACADEMIA_NO_ENCONTRADA');
      expect(await fotoDe(cliente.alumnoId)).toBeNull();
    });

    it('criterio 34 d (caso límite): con la academia suspendida responde 403 ACADEMIA_SUSPENDIDA antes de mirar el token (con token válido, inexistente o sin él) y no cambia nada', async () => {
      const deB = await sembrar({}, e.B.id);
      await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');

      for (const [nombre, token] of [
        ['token válido de B', deB.token],
        ['token inexistente', tokenAleatorio()],
        ['sin token', null],
      ] as const) {
        const antes = await estado();
        const respuesta = await subirFoto(ctx, 'academia-b', { token, cuerpo: png(100, 100) });

        expect(respuesta.status, `${nombre}: ${respuesta.texto}`).toBe(403);
        expect(respuesta.body?.['codigo'], nombre).toBe('ACADEMIA_SUSPENDIDA');
        expect(await estado(), nombre).toEqual(antes);
      }
    });
  });

  describe('tipo y codificación (b): antes del cuerpo y antes de la academia', () => {
    const TIPOS_MALOS: [string, string | null][] = [
      ['sin Content-Type', null],
      ['image/jpg', 'image/jpg'],
      ['image/gif', 'image/gif'],
      ['image/webp', 'image/webp'],
      ['application/octet-stream', 'application/octet-stream'],
      ['application/json', 'application/json'],
      ['multipart/form-data', 'multipart/form-data; boundary=x'],
      ['text/plain', 'text/plain'],
      ['vacío', ''],
    ];

    it.each(TIPOS_MALOS)(
      'criterio 34 b: %s responde 400 IMAGEN_NO_VALIDA aunque el cuerpo sea un PNG válido, y no cambia nada',
      async (nombre, tipo) => {
        const cliente = await sembrar();

        await rechazada(subir(cliente.token, png(100, 100), { tipo }), 400, 'IMAGEN_NO_VALIDA', nombre);
      },
    );

    it.each(['gzip', 'deflate', 'br', 'gzip, br', '', 'compress'])(
      'criterio 34 b: Content-Encoding %j (distinto de identity) responde 400 IMAGEN_NO_VALIDA y no cambia nada',
      async (codificacion) => {
        const cliente = await sembrar();

        await rechazada(
          subir(cliente.token, png(100, 100), { codificacion }),
          400,
          'IMAGEN_NO_VALIDA',
          `Content-Encoding ${JSON.stringify(codificacion)}`,
        );
      },
    );

    it('criterio 34 b: el tipo y la codificación se deciden antes de buscar la academia: una academia que no existe o suspendida con un tipo malo responde 400, no 404 ni 403', async () => {
      await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');

      for (const nombreCorto of ['no-existe', 'academia-b']) {
        const conTipo = await subirFoto(ctx, nombreCorto, {
          token: tokenAleatorio(),
          cuerpo: png(100, 100),
          tipo: 'image/gif',
        });
        const conCodificacion = await subirFoto(ctx, nombreCorto, {
          token: tokenAleatorio(),
          cuerpo: png(100, 100),
          codificacion: 'gzip',
        });

        for (const respuesta of [conTipo, conCodificacion]) {
          expect(respuesta.status, `${nombreCorto}: ${respuesta.texto}`).toBe(400);
          expect(respuesta.body?.['codigo']).toBe('IMAGEN_NO_VALIDA');
        }
      }
    });

    it('criterio 34 b y c: el tipo se decide antes que el tamaño: un cuerpo de más de 5 MB con un tipo malo responde 400, no 413', async () => {
      const respuesta = await subirFoto(ctx, 'academia-a', {
        token: tokenAleatorio(),
        tipo: 'image/gif',
        cuerpo: Buffer.alloc(16),
        largoDeclarado: 6 * 1024 * 1024,
      });

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(respuesta.body?.['codigo']).toBe('IMAGEN_NO_VALIDA');
    });
  });

  describe('tamaño (c)', () => {
    it('criterio 34 c: 5 242 881 bytes (con Content-Length) responden 413 CARGA_EXCESIVA y no cambian nada', async () => {
      const cliente = await sembrar();
      const cuerpo = Buffer.concat([FIRMA_JPEG, Buffer.alloc(MB5 + 1 - FIRMA_JPEG.length)]);

      const respuesta = await rechazada(
        subir(cliente.token, cuerpo, { tipo: 'image/jpeg' }),
        413,
        'CARGA_EXCESIVA',
        '5 242 881 bytes',
      );

      expect(
        Object.keys(respuesta.body ?? {}).every((clave) => ['codigo', 'mensaje', 'detalles'].includes(clave)),
      ).toBe(true);
    });

    it('criterio 34 c: un Content-Length de 6 MB responde 413 sin leer el cuerpo: la respuesta llega aunque el cuerpo nunca se envíe', async () => {
      const cliente = await sembrar();

      const respuesta = await rechazada(
        subirFoto(ctx, 'academia-a', {
          token: cliente.token,
          cuerpo: Buffer.from(FIRMA_PNG),
          largoDeclarado: 6 * 1024 * 1024,
          plazoMs: 8000,
        }),
        413,
        'CARGA_EXCESIVA',
        'Content-Length de 6 MB',
      );

      expect(respuesta.status).toBe(413);
    });

    it('criterio 34 c: sin Content-Length (cuerpo troceado) que pasa de 5 MB, la lectura se corta y responde 413', async () => {
      const cliente = await sembrar();
      const cuerpo = Buffer.concat([FIRMA_JPEG, Buffer.alloc(6 * 1024 * 1024)]);

      await rechazada(
        subirFoto(ctx, 'academia-a', { token: cliente.token, tipo: 'image/jpeg', cuerpo, troceado: true }),
        413,
        'CARGA_EXCESIVA',
        'cuerpo troceado de 6 MB',
      );
    });

    it('criterio 34 c: el tamaño se decide antes de buscar la academia (413 con una academia que no existe o suspendida)', async () => {
      await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');

      for (const nombreCorto of ['no-existe', 'academia-b']) {
        const respuesta = await subirFoto(ctx, nombreCorto, {
          token: tokenAleatorio(),
          cuerpo: Buffer.alloc(8),
          largoDeclarado: 6 * 1024 * 1024,
          plazoMs: 8000,
        });

        expect(respuesta.status, `${nombreCorto}: ${respuesta.texto}`).toBe(413);
        expect(respuesta.body?.['codigo']).toBe('CARGA_EXCESIVA');
      }
    });

    it('criterio 34 c y casos límite: un cuerpo de 5 242 880 bytes exactos no se rechaza por tamaño: pasa a las demás comprobaciones (400 IMAGEN_NO_VALIDA, no 413)', async () => {
      const cliente = await sembrar();
      const cuerpo = Buffer.concat([FIRMA_JPEG, Buffer.alloc(MB5 - FIRMA_JPEG.length)]);
      expect(cuerpo.length).toBe(5_242_880);

      await rechazada(
        subir(cliente.token, cuerpo, { tipo: 'image/jpeg' }),
        400,
        'IMAGEN_NO_VALIDA',
        '5 242 880 bytes exactos',
      );
    });
  });

  describe('imagen (g)', () => {
    const RECHAZADAS: [string, () => Imagen | Promise<Imagen>][] = [
      ['el cuerpo vacío', () => ({ cuerpo: Buffer.alloc(0), tipo: 'image/png' })],
      [
        'un PNG enviado como image/jpeg (la firma no es la del tipo)',
        () => ({ cuerpo: png(100, 100), tipo: 'image/jpeg' }),
      ],
      ['un JPEG enviado como image/png', async () => ({ cuerpo: await jpeg(200, 200), tipo: 'image/png' })],
      [
        'bytes que empiezan con la firma de JPEG y no son una imagen',
        () => ({ cuerpo: Buffer.concat([FIRMA_JPEG, Buffer.alloc(200, 7)]), tipo: 'image/jpeg' }),
      ],
      [
        'bytes que empiezan con la firma de PNG y no son una imagen',
        () => ({ cuerpo: Buffer.concat([FIRMA_PNG, Buffer.alloc(200, 7)]), tipo: 'image/png' }),
      ],
      ['un texto', () => ({ cuerpo: Buffer.from('hola, esto no es una foto'), tipo: 'image/png' })],
      ['un PNG cortado', () => ({ cuerpo: png(400, 300).subarray(0, 90), tipo: 'image/png' })],
      [
        'un JPEG cortado',
        async () => {
          const entero = await jpeg(400, 300);
          return { cuerpo: entero.subarray(0, Math.floor(entero.length / 2)), tipo: 'image/jpeg' };
        },
      ],
      ['un lado menor que 100 (99 × 500)', () => ({ cuerpo: png(99, 500), tipo: 'image/png' })],
      ['un lado menor que 100 (500 × 99)', () => ({ cuerpo: png(500, 99), tipo: 'image/png' })],
      [
        'un lado mayor que 8000 (8001 × 100)',
        () => ({ cuerpo: png(8001, 100, { profundidad: 1 }), tipo: 'image/png' }),
      ],
      [
        'un lado mayor que 8000 (100 × 8001)',
        () => ({ cuerpo: png(100, 8001, { profundidad: 1 }), tipo: 'image/png' }),
      ],
      [
        'más de 40 megapíxeles (8000 × 5001)',
        () => ({ cuerpo: png(8000, 5001, { profundidad: 1 }), tipo: 'image/png' }),
      ],
      [
        'más de 40 megapíxeles con los dos lados permitidos (7000 × 5715)',
        () => ({ cuerpo: png(7000, 5715, { profundidad: 1 }), tipo: 'image/png' }),
      ],
      [
        'un JPEG de 500 × 99 con orientación 6 (las dimensiones son las del archivo, antes de girar)',
        async () => ({ cuerpo: await jpeg(500, 99, { orientacion: 6 }), tipo: 'image/jpeg' }),
      ],
    ];

    it.each(RECHAZADAS)('criterio 34 g: %s responde 400 IMAGEN_NO_VALIDA y no cambia nada', async (nombre, armar) => {
      const cliente = await sembrar();
      const { cuerpo, tipo } = await armar();

      await rechazada(subir(cliente.token, cuerpo, { tipo }), 400, 'IMAGEN_NO_VALIDA', nombre);
    });

    it('criterio 34 g: todos los 400 IMAGEN_NO_VALIDA tienen el mismo cuerpo ({ codigo, mensaje }, el mismo mensaje, sin detalles)', async () => {
      const cliente = await sembrar();
      const textos = new Set<string>();

      for (const [nombre, armar] of RECHAZADAS.slice(0, 9)) {
        const { cuerpo, tipo } = await armar();
        const respuesta = await subir(cliente.token, cuerpo, { tipo });
        expect(respuesta.status, nombre).toBe(400);
        expect(Object.keys(respuesta.body ?? {}).sort(), nombre).toEqual(['codigo', 'mensaje']);
        textos.add(respuesta.texto);
      }
      for (const [tipo, codificacion] of [
        ['image/gif', undefined],
        ['image/png', 'gzip'],
      ] as const) {
        const respuesta = await subir(cliente.token, png(100, 100), { tipo, codificacion });
        expect(respuesta.status).toBe(400);
        textos.add(respuesta.texto);
      }

      expect([...textos], 'hay más de un cuerpo distinto entre los 400').toHaveLength(1);
    });

    const ACEPTADAS: [string, () => Imagen | Promise<Imagen>][] = [
      ['100 × 100 (el borde inferior)', () => ({ cuerpo: png(100, 100), tipo: 'image/png' })],
      [
        '8000 × 5000 (40 megapíxeles exactos, el borde superior)',
        () => ({ cuerpo: png(8000, 5000, { profundidad: 1 }), tipo: 'image/png' }),
      ],
      ['100 × 8000', () => ({ cuerpo: png(100, 8000, { profundidad: 1 }), tipo: 'image/png' })],
      ['8000 × 100', () => ({ cuerpo: png(8000, 100, { profundidad: 1 }), tipo: 'image/png' })],
      [
        'un JPEG de 200 × 100 con orientación 6',
        async () => ({ cuerpo: await jpeg(200, 100, { orientacion: 6 }), tipo: 'image/jpeg' }),
      ],
    ];

    it.each(ACEPTADAS)('criterio 34 g: %s se acepta (204)', async (nombre, armar) => {
      const cliente = await sembrar();
      const { cuerpo, tipo } = await armar();

      const respuesta = await subir(cliente.token, cuerpo, { tipo });

      expect(respuesta.status, `${nombre}: ${respuesta.texto}`).toBe(204);
      expect(await fotoDe(cliente.alumnoId)).toMatch(PATRON_CLAVE);
    });
  });

  describe('orden de las comprobaciones', () => {
    it('criterio 34: con una solicitud válida, cada comprobación que falla da su respuesta y deja la foto anterior intacta', async () => {
      const cliente = await sembrar();
      expect((await subir(cliente.token, png(100, 100))).status).toBe(204);
      const claveAntes = await fotoDe(cliente.alumnoId);
      const archivosAntes = archivosBajo(ctx.raiz);
      const rechazos: Promise<RespuestaApi>[] = [
        subir(cliente.token, png(100, 100), { tipo: 'image/gif' }),
        subir(cliente.token, Buffer.alloc(0)),
        subir(cliente.token, png(99, 99)),
        subir(cliente.token, Buffer.from('basura')),
        subir(cliente.token, Buffer.alloc(MB5 + 1), { tipo: 'image/jpeg' }),
        subir(tokenAleatorio(), png(100, 100)),
      ];

      const estados = (await Promise.all(rechazos)).map((r) => r.status);

      expect(estados).toEqual([400, 400, 400, 400, 413, 404]);
      expect(await fotoDe(cliente.alumnoId)).toBe(claveAntes);
      expect(archivosBajo(ctx.raiz)).toEqual(archivosAntes);
      expect(existeArchivoDeClave(ctx.raiz, claveAntes as string)).toBe(true);
    });
  });

  describe('otros métodos', () => {
    it('criterio 34: GET, POST, PATCH y DELETE sobre la dirección de la foto responden como una ruta inexistente', async () => {
      const cliente = await sembrar();
      const inexistente = await subirFoto(ctx, 'academia-a', {
        metodo: 'PUT',
        token: cliente.token,
        cuerpo: png(100, 100),
        ruta: rutaPublica('academia-a', '/solicitudes/no-existe-ninguna-ruta'),
      });
      expect(inexistente.status).toBe(404);

      for (const metodo of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const antes = await estado();
        const respuesta = await subirFoto(ctx, 'academia-a', {
          metodo,
          token: cliente.token,
          cuerpo: metodo === 'GET' || metodo === 'DELETE' ? undefined : png(100, 100),
          tipo: metodo === 'GET' || metodo === 'DELETE' ? null : 'image/png',
        });

        expect(respuesta.status, `${metodo}: ${respuesta.texto}`).toBe(inexistente.status);
        expect(respuesta.body?.['codigo'], metodo).toBe(inexistente.body?.['codigo']);
        expect(await estado(), metodo).toEqual(antes);
      }
    });
  });

  describe('control de los datos del alumno', () => {
    it('criterio 34: subir la foto no cambia nada más del alumno ni de otras solicitudes', async () => {
      const cliente = await sembrar();
      const otro = await sembrar();
      const antes = (await leerAlumnos(e.A.id)).find((a) => a.id === otro.alumnoId);

      expect((await subirFotoValida(ctx, 'academia-a', cliente.token)).status).toBe(204);

      expect((await leerAlumnos(e.A.id)).find((a) => a.id === otro.alumnoId)).toEqual(antes);
      const propio = (await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId);
      expect(propio?.estado).toBe('CLIENTE');
      expect(propio?.nombres).toBe('Valeria');
    });
  });
});
