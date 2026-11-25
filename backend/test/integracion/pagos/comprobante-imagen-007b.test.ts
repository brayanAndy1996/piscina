// spec: 007-pagos (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { urlAppPruebas } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  type EscenarioPagos,
  exigirRutasDePagos,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  datosDeComprobante,
  estadoVisibleDe,
  exigirRutasDe007b,
  instantaneaConArchivos,
  rutaAprobacion,
  rutaRechazo,
  subirComprobante,
} from '../../utilidades/escenario-pagos-007b';
import { leerMatriculas, type RespuestaApi } from '../../utilidades/inscripciones';
import {
  AlmacenDeFallosDePrueba,
  type AppConAlmacen,
  archivosBajo,
  cargarSharp,
  crearAppConAlmacen,
  exigirAlmacen,
  existeArchivoDeClave,
  FIRMA_JPEG,
  FIRMA_PNG,
  jpeg,
  leerArchivoDeClave,
  metadatosDe,
  png,
  TEXTO_DE_RUTA_EN_EL_ERROR,
  TEXTO_MARCADO,
} from '../../utilidades/inscripciones-005b';
import { conUrlDeAppEnElProxy, type ModoDeCorte, ProxyPostgres } from '../../utilidades/proxy-postgres';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 40 (crítico, HU-08, RNF-09; criterios 35 a 37, 61 y 64 de 005; regla «Archivos»): la imagen del comprobante pasa las mismas comprobaciones de la foto (firma del tipo declarado, decodificable con `sharp`, lados de 100 a
// 8000 píxeles y hasta 40 megapíxeles). La imagen aceptada se vuelve a codificar como JPEG de como mucho 2000 píxeles en su lado mayor (DT-8), con la orientación aplicada y sin metadatos (EXIF, GPS, XMP, ICC, comentarios), y se
// guarda en `AlmacenArchivos` con una clave del servidor (`academias/{academiaId}/pagos/{pagoId}/comprobante-{uuid}.jpg`) antes de la transacción. Si la transacción rechaza la subida, el archivo nuevo se borra; si la
// confirmación es incierta, se aplica el proceso de los criterios 61 y 64 de 005 sobre la fila del pago (la base confirmó: 201 y el archivo se conserva; la base revirtió: 500 y el archivo nuevo se borra). Ningún rechazo ni
// ningún pago resuelto borra un comprobante ya guardado (es evidencia).

const PATRON_CLAVE =
  /^academias\/[0-9a-f-]{36}\/pagos\/[0-9a-f-]{36}\/comprobante-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

describe('el comprobante que se guarda se recodifica sin metadatos (criterio 40)', () => {
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

  /** Sube el comprobante de una solicitud nueva y devuelve lo guardado (los bytes del archivo de `comprobante_clave`) y su clave. */
  async function subirYLeer(
    cuerpo: Buffer,
    tipo: 'image/jpeg' | 'image/png',
  ): Promise<{ guardado: Buffer; clave: string }> {
    const cliente = await sembrarCobrable(e);
    const respuesta = await subirComprobante(ctx, 'academia-a', {
      token: cliente.token,
      datos: datosDeComprobante(),
      cuerpo,
      tipo,
    });
    expect(respuesta.status, respuesta.texto).toBe(201);
    const pago = (await leerPagos(e.A.id)).find((p) => p.matricula_id === cliente.matriculaId);
    expect(pago?.comprobante_clave, 'pagos.comprobante_clave').toMatch(PATRON_CLAVE);
    const clave = pago?.comprobante_clave as string;
    expect(existeArchivoDeClave(ctx.raiz, clave), 'el archivo de comprobante_clave existe').toBe(true);
    return { guardado: leerArchivoDeClave(ctx.raiz, clave), clave };
  }

  /** Lo que vale para cualquier comprobante guardado. */
  async function comprobarGuardado(guardado: Buffer, subido: Buffer): Promise<void> {
    expect([...guardado.subarray(0, 3)], 'empieza con FF D8 FF').toEqual([0xff, 0xd8, 0xff]);
    const metadatos = await metadatosDe(guardado);
    expect(metadatos.format).toBe('jpeg');
    for (const metadato of ['exif', 'icc', 'iptc', 'xmp', 'orientation'] as const) {
      expect(metadatos[metadato], `lo guardado lleva ${metadato}`).toBeUndefined();
    }
    expect(guardado.equals(subido), 'lo guardado es el archivo original').toBe(false);
    for (const texto of [
      TEXTO_MARCADO,
      'Exif',
      'ns.adobe.com',
      'COLA-',
      'PK\u0003\u0004',
      'tEXt',
      'IEND',
      'POLIGLOTA',
    ]) {
      expect(guardado.includes(Buffer.from(texto, 'latin1')), `lo guardado contiene ${JSON.stringify(texto)}`).toBe(
        false,
      );
    }
  }

  describe('sin metadatos y con la orientación aplicada', () => {
    it('criterio 40: un JPEG con coordenadas GPS, comentario, XMP y perfil de color se guarda sin ninguno de ellos', async () => {
      const subido = await jpeg(3000, 1500, { gps: true, comentario: TEXTO_MARCADO, xmp: TEXTO_MARCADO, icc: true });
      const original = await metadatosDe(subido);
      expect(original.exif, 'la foto de prueba no lleva EXIF').toBeDefined();
      expect(original.xmp, 'la foto de prueba no lleva XMP').toBeDefined();
      expect(original.icc, 'la foto de prueba no lleva perfil de color').toBeDefined();
      expect(subido.includes(Buffer.from(TEXTO_MARCADO))).toBe(true);

      const { guardado } = await subirYLeer(subido, 'image/jpeg');

      await comprobarGuardado(guardado, subido);
      const metadatos = await metadatosDe(guardado);
      expect([metadatos.width, metadatos.height]).toEqual([2000, 1000]);
    });

    it('criterio 40: un PNG con un trozo tEXt con el texto marcado se guarda como JPEG sin ese texto', async () => {
      const subido = png(1600, 1200, { texto: TEXTO_MARCADO });
      expect(subido.includes(Buffer.from(TEXTO_MARCADO))).toBe(true);

      const { guardado } = await subirYLeer(subido, 'image/png');

      await comprobarGuardado(guardado, subido);
      const metadatos = await metadatosDe(guardado);
      expect([metadatos.width, metadatos.height], 'a 2000 píxeles, no a 800 como la foto').toEqual([1600, 1200]);
    });

    it('criterio 40: un JPEG con datos después del final de la imagen (FF D9) se guarda sin ellos y termina en FF D9', async () => {
      const subido = await jpeg(500, 400, { despues: Buffer.from(`COLA-DEL-JPEG ${TEXTO_MARCADO}`) });
      expect(subido.includes(Buffer.from('COLA-DEL-JPEG'))).toBe(true);

      const { guardado } = await subirYLeer(subido, 'image/jpeg');

      await comprobarGuardado(guardado, subido);
      expect([...guardado.subarray(guardado.length - 2)], 'termina en FF D9').toEqual([0xff, 0xd9]);
    });

    it('criterio 40: un archivo poliglota (un PNG válido con otro contenido pegado después de IEND) se guarda solo como la imagen recodificada', async () => {
      const pegado = Buffer.concat([
        Buffer.from('PK\u0003\u0004', 'latin1'),
        Buffer.from(`POLIGLOTA ${TEXTO_MARCADO} contenido de otro formato`, 'latin1'),
      ]);
      const subido = png(300, 200, { despues: pegado });

      const { guardado } = await subirYLeer(subido, 'image/png');

      await comprobarGuardado(guardado, subido);
      const sharp = await cargarSharp();
      await expect(sharp(guardado).toBuffer()).resolves.toBeInstanceOf(Buffer);
    });

    it.each([
      ['3000 × 1500 (se reduce a 2000 de lado mayor)', 3000, 1500, 2000, 1000],
      ['4000 × 3000 (se reduce con la proporción)', 4000, 3000, 2000, 1500],
      ['1600 × 1200 (cabe en 2000: no se toca)', 1600, 1200, 1600, 1200],
      ['2000 × 1000 (el borde: no se reduce)', 2000, 1000, 2000, 1000],
      ['400 × 300 (no se agranda)', 400, 300, 400, 300],
      ['100 × 100 (el mínimo)', 100, 100, 100, 100],
    ])('criterio 40 y DT-8: un JPEG de %s', async (_nombre, ancho, alto, anchoEsperado, altoEsperado) => {
      const subido = await jpeg(ancho, alto);

      const { guardado } = await subirYLeer(subido, 'image/jpeg');

      const metadatos = await metadatosDe(guardado);
      expect([metadatos.width, metadatos.height]).toEqual([anchoEsperado, altoEsperado]);
      expect(Math.max(metadatos.width ?? 0, metadatos.height ?? 0)).toBeLessThanOrEqual(2000);
    });

    it('criterio 40: una imagen de 200 × 100 con la orientación EXIF 6 (90°) se guarda girada: 100 × 200; una de 1500 × 3000 con la orientación 6 queda 2000 × 1000', async () => {
      const girada = await subirYLeer(await jpeg(200, 100, { orientacion: 6 }), 'image/jpeg');
      const grande = await subirYLeer(await jpeg(1500, 3000, { orientacion: 6 }), 'image/jpeg');

      const a = await metadatosDe(girada.guardado);
      const b = await metadatosDe(grande.guardado);
      expect([a.width, a.height]).toEqual([100, 200]);
      expect([b.width, b.height]).toEqual([2000, 1000]);
      expect(a.orientation).toBeUndefined();
    });

    it('criterio 40: la clave es del servidor, con el id del pago y un UUID: dos comprobantes iguales no comparten archivo y nunca llevan el nombre que mandó el cliente', async () => {
      const subido = png(120, 120);

      const uno = await subirYLeer(subido, 'image/png');
      const dos = await subirYLeer(subido, 'image/png');

      expect(uno.clave).not.toBe(dos.clave);
      expect(archivosBajo(ctx.raiz).sort()).toEqual([uno.clave, dos.clave].sort());
    });
  });

  describe('las comprobaciones de la imagen (las mismas de la foto)', () => {
    interface Imagen {
      cuerpo: Buffer;
      tipo: string;
    }
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
      ['un texto', () => ({ cuerpo: Buffer.from('hola, esto no es un comprobante'), tipo: 'image/png' })],
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
        'más de 40 megapíxeles con los dos lados permitidos (7000 × 5715)',
        () => ({ cuerpo: png(7000, 5715, { profundidad: 1 }), tipo: 'image/png' }),
      ],
      [
        'un JPEG de 500 × 99 con orientación 6 (las dimensiones son las del archivo, antes de girar)',
        async () => ({ cuerpo: await jpeg(500, 99, { orientacion: 6 }), tipo: 'image/jpeg' }),
      ],
    ];

    it.each(RECHAZADAS)(
      'criterio 40: %s responde 400 IMAGEN_NO_VALIDA y no deja pago, archivo ni auditoría',
      async (nombre, armar) => {
        const cliente = await sembrarCobrable(e);
        const { cuerpo, tipo } = await armar();
        const antes = await snapshot();

        const respuesta = await subirComprobante(ctx, 'academia-a', {
          token: cliente.token,
          datos: datosDeComprobante(),
          cuerpo,
          tipo,
        });

        expect([respuesta.status, codigoDeRespuesta(respuesta)], `${nombre}: ${respuesta.texto}`).toEqual([
          400,
          'IMAGEN_NO_VALIDA',
        ]);
        expect(respuesta.cacheControl).toBe('no-store');
        expect(await snapshot()).toBe(antes);
      },
    );

    it('criterio 40: todos los 400 IMAGEN_NO_VALIDA tienen el mismo cuerpo ({ codigo, mensaje }, sin detalles)', async () => {
      const cliente = await sembrarCobrable(e);
      const textos = new Set<string>();

      for (const [nombre, armar] of RECHAZADAS.slice(0, 9)) {
        const { cuerpo, tipo } = await armar();
        const respuesta = await subirComprobante(ctx, 'academia-a', {
          token: cliente.token,
          datos: datosDeComprobante(),
          cuerpo,
          tipo,
        });
        expect(respuesta.status, nombre).toBe(400);
        expect(Object.keys(respuesta.body ?? {}).sort(), nombre).toEqual(['codigo', 'mensaje']);
        textos.add(respuesta.texto);
      }

      expect([...textos], 'hay más de un cuerpo distinto entre los 400').toHaveLength(1);
    });

    it.each([
      ['100 × 100 (el borde inferior)', () => ({ cuerpo: png(100, 100), tipo: 'image/png' as const })],
      ['100 × 8000', () => ({ cuerpo: png(100, 8000, { profundidad: 1 }), tipo: 'image/png' as const })],
      ['8000 × 100', () => ({ cuerpo: png(8000, 100, { profundidad: 1 }), tipo: 'image/png' as const })],
    ])('criterio 40: %s se acepta (201)', async (_nombre, armar) => {
      const { cuerpo, tipo } = armar();

      const { guardado } = await subirYLeer(cuerpo, tipo);

      expect([...guardado.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    });
  });
});

describe('el archivo del comprobante y el almacén (criterio 40)', () => {
  let ctx: AppConAlmacen;
  let fallos: AlmacenDeFallosDePrueba;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({
      ahora: AHORA_007,
      envolver: (real) => {
        fallos = new AlmacenDeFallosDePrueba(real);
        return fallos;
      },
    });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    ctx.reloj.fijar(AHORA_007);
    ctx.vaciarAlmacen();
    fallos.fallarGuardar = false;
    fallos.fallarBorrar = false;
    fallos.alGuardar = undefined;
    fallos.alBorrar = undefined;
    fallos.llamadas.length = 0;
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    exigirRutasDe007b(ctx.app);
    cookies = cookiesDePagos(e);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const snapshot = () => instantaneaConArchivos(ctx, e);
  const subir = (cliente: { token: string }, datos: Record<string, unknown> = {}): Promise<RespuestaApi> =>
    subirComprobante(ctx, 'academia-a', { token: cliente.token, datos: datosDeComprobante(datos) });

  it('criterio 40: el archivo se guarda antes de la transacción, con la clave que lleva el id del pago, y la fila queda con esa misma clave', async () => {
    const cliente = await sembrarCobrable(e);
    let pagosAlGuardar = -1;
    fallos.alGuardar = async () => {
      pagosAlGuardar = (await leerPagos(e.A.id)).length;
    };

    const respuesta = await subir(cliente);

    expect(respuesta.status, respuesta.texto).toBe(201);
    expect(pagosAlGuardar, 'al guardar el archivo todavía no hay pago: se guarda antes de la transacción').toBe(0);
    const guardados = fallos.llamadas.filter((llamada) => llamada.operacion === 'guardar');
    expect(guardados).toHaveLength(1);
    expect(guardados[0]?.academiaId).toBe(e.A.id);
    const pago = (await leerPagos(e.A.id))[0];
    expect(pago?.comprobante_clave).toBe(guardados[0]?.clave);
    expect(guardados[0]?.clave).toContain(`academias/${e.A.id}/pagos/${pago?.id}/comprobante-`);
    expect(fallos.llamadas.filter((llamada) => llamada.operacion === 'borrar')).toEqual([]);
  });

  it('criterio 40: si el almacén falla al guardar, responde 500 sin datos del archivo y no deja pago, auditoría ni cambios en la matrícula', async () => {
    const cliente = await sembrarCobrable(e);
    fallos.fallarGuardar = true;
    const antes = await snapshot();

    const respuesta = await subir(cliente);

    expect(respuesta.status, respuesta.texto).toBe(500);
    expect(respuesta.texto, 'el 500 no lleva datos del archivo').not.toContain(TEXTO_DE_RUTA_EN_EL_ERROR);
    expect(respuesta.texto).not.toContain('academias/');
    expect(await snapshot()).toBe(antes);
    expect(await leerPagos(e.A.id)).toEqual([]);
  });

  it('criterio 40: si la transacción rechaza la subida (el monto no es el total), el archivo nuevo se guardó y se borra: no queda ningún archivo', async () => {
    const cliente = await sembrarCobrable(e);

    const respuesta = await subir(cliente, { monto: '41.00' });

    expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'MONTO_DISTINTO']);
    const guardadas = fallos.llamadas.filter((llamada) => llamada.operacion === 'guardar');
    const borradas = fallos.llamadas.filter((llamada) => llamada.operacion === 'borrar');
    expect(guardadas, 'el archivo se guarda antes de la transacción').toHaveLength(1);
    expect(
      borradas.map((llamada) => llamada.clave),
      'y se borra el mismo archivo',
    ).toEqual([guardadas[0]?.clave]);
    expect(archivosBajo(ctx.raiz)).toEqual([]);
    expect(await leerPagos(e.A.id)).toEqual([]);
  });

  it('criterio 40: un rechazo del comprobante, una nueva subida y la aprobación no borran ningún comprobante guardado (es evidencia): quedan los dos archivos y nunca se llama a borrar', async () => {
    await abrirCajaDeHoy(e);
    const cliente = await sembrarCobrable(e);
    expect((await subir(cliente)).status).toBe(201);
    const primero = (await leerPagos(e.A.id))[0];
    const rechazo = await ctx.http.post(
      rutaRechazo(primero?.id ?? ''),
      { motivo: 'La imagen no se lee' },
      { cookie: cookies.secretaria },
    );
    expect(rechazo.status, rechazo.texto).toBe(200);
    expect(existeArchivoDeClave(ctx.raiz, primero?.comprobante_clave ?? ''), 'el rechazo borró el comprobante').toBe(
      true,
    );

    const segundo = await subir(cliente);
    expect(segundo.status, segundo.texto).toBe(201);
    const pagos = await leerPagos(e.A.id);
    const nuevo = pagos.find((p) => p.estado === 'PENDIENTE_VERIFICACION');
    const aprobacion = await ctx.http.post(rutaAprobacion(nuevo?.id ?? ''), {}, { cookie: cookies.secretaria });
    expect(aprobacion.status, aprobacion.texto).toBe(200);

    const claves = [primero?.comprobante_clave, nuevo?.comprobante_clave].map(String).sort();
    expect(archivosBajo(ctx.raiz)).toEqual(claves);
    expect(fallos.llamadas.filter((llamada) => llamada.operacion === 'borrar')).toEqual([]);
    expect((await leerMatriculas(e.A.id))[0]?.estado).toBe('VIGENTE');
  });
});

describe('confirmación incierta de la subida del comprobante (criterio 40; criterios 61 y 64 de 005)', () => {
  interface Banco {
    proxy: ProxyPostgres;
    ctx: AppConAlmacen;
    fallos: AlmacenDeFallosDePrueba;
  }
  let banco: Banco | undefined;
  let e: EscenarioPagos;
  const actual = (): Banco => {
    if (!banco) throw new Error('La aplicación de la prueba no se levantó.');
    return banco;
  };

  beforeAll(async () => {
    const proxy = await ProxyPostgres.iniciar(urlAppPruebas());
    let fallos: AlmacenDeFallosDePrueba | undefined;
    let ctx: AppConAlmacen | undefined;
    try {
      ctx = await conUrlDeAppEnElProxy(proxy, () =>
        crearAppConAlmacen({
          ahora: AHORA_007,
          envolver: (real) => {
            fallos = new AlmacenDeFallosDePrueba(real);
            return fallos;
          },
        }),
      );
    } catch (error) {
      await proxy.cerrar();
      throw error;
    }
    if (!fallos) {
      await ctx.cerrarTodo();
      await proxy.cerrar();
      throw new Error('No se pudo envolver el almacén de la prueba.');
    }
    banco = { proxy, ctx, fallos };
  });
  beforeEach(async () => {
    const b = actual();
    exigirAlmacen(b.ctx);
    b.ctx.reloj.fijar(AHORA_007);
    b.ctx.vaciarAlmacen();
    b.fallos.alGuardar = undefined;
    b.fallos.llamadas.length = 0;
    b.proxy.restablecer();
    b.proxy.reiniciarContador();
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(b.ctx.app);
    exigirRutasDe007b(b.ctx.app);
  });
  afterAll(async () => {
    if (!banco) return;
    try {
      await banco.ctx.cerrarTodo();
    } finally {
      await banco.proxy.cerrar();
    }
  });

  /** Arma el proxy desde `guardar` del almacén: después de las comprobaciones previas y antes de la confirmación. */
  const armarAlGuardar = (modo: ModoDeCorte) => {
    actual().fallos.alGuardar = () => {
      actual().proxy.armar(modo);
      return Promise.resolve();
    };
  };
  const subir = (token: string) =>
    subirComprobante(actual().ctx, 'academia-a', { token, datos: datosDeComprobante(), plazoMs: 25_000 });

  /** El invariante: toda `comprobante_clave` apunta a un archivo que existe y todo archivo guardado es de un pago. */
  async function comprobarInvariante(): Promise<void> {
    const claves = (await leerPagos(e.A.id)).map((p) => p.comprobante_clave).filter((c): c is string => c !== null);
    for (const clave of claves) {
      expect(existeArchivoDeClave(actual().ctx.raiz, clave), `comprobante_clave sin archivo: ${clave}`).toBe(true);
    }
    expect(archivosBajo(actual().ctx.raiz), 'hay archivos huérfanos o faltan archivos').toEqual([...claves].sort());
  }

  it('criterio 40 (61 b1): cortarTrasCommit: la base confirmó y la API no se entera: responde 201, el pago y la auditoría existen y el archivo se conserva', async () => {
    const cliente = await sembrarCobrable(e);
    armarAlGuardar('cortarTrasCommit');

    const respuesta = await subir(cliente.token);
    actual().proxy.desarmar();

    expect(actual().proxy.cortes, 'el proxy debía cortar una vez en el COMMIT').toBe(1);
    expect(respuesta.status, respuesta.texto).toBe(201);
    const pagos = await leerPagos(e.A.id);
    expect(pagos).toHaveLength(1);
    expect(pagos[0]?.estado).toBe('PENDIENTE_VERIFICACION');
    expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_COMPROBANTE_REGISTRADO')).toHaveLength(1);
    await comprobarInvariante();
    expect(await estadoVisibleDe(actual().ctx, cliente.token)).toBe('EN_VERIFICACION');
  });

  it('criterio 40 (61 b2): cortarAntesDelCommit: la base revierte: responde 500 ERROR_INTERNO, no queda pago ni auditoría y el archivo nuevo se borra', async () => {
    const cliente = await sembrarCobrable(e);
    armarAlGuardar('cortarAntesDelCommit');

    const respuesta = await subir(cliente.token);
    actual().proxy.desarmar();

    expect(actual().proxy.cortes, 'el proxy debía cortar una vez antes del COMMIT').toBe(1);
    expect(respuesta.status, respuesta.texto).toBe(500);
    expect(respuesta.body?.['codigo']).toBe('ERROR_INTERNO');
    expect(await leerPagos(e.A.id)).toEqual([]);
    expect(await leerAuditoriaDeAcademia(e.A.id, 'PAGO_COMPROBANTE_REGISTRADO')).toEqual([]);
    await comprobarInvariante();
    expect((await leerMatriculas(e.A.id))[0]).toMatchObject({ estado: 'RESERVADA' });
  });

  it('criterio 40 (61, caso 4): después de una confirmación incierta, un reintento limpio con otra clave responde 409 PAGO_EN_VERIFICACION (el primero sí quedó) y no arrastra archivos', async () => {
    const cliente = await sembrarCobrable(e);
    armarAlGuardar('cortarTrasCommit');
    expect((await subir(cliente.token)).status).toBe(201);
    actual().proxy.desarmar();

    const reintento = await subir(cliente.token);

    expect([reintento.status, codigoDeRespuesta(reintento)], reintento.texto).toEqual([409, 'PAGO_EN_VERIFICACION']);
    await comprobarInvariante();
  });
});
