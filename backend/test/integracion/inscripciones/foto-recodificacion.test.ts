// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AHORA_005,
  crearEscenarioInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import {
  type AppConAlmacen,
  archivosDelAlumno,
  cargarSharp,
  crearAppConAlmacen,
  exigirAlmacen,
  fotoClaveDe,
  jpeg,
  leerArchivoDeClave,
  metadatosDe,
  png,
  subirFoto,
  TEXTO_MARCADO,
} from '../../utilidades/inscripciones-005b';

// Criterio 35 (crítico, RNF-05: fotos de menores; PB6), la foto que se guarda: la imagen aceptada se vuelve a codificar con sharp como JPEG de
// como mucho 800 píxeles en su lado mayor (sin agrandar), con la orientación aplicada y sin metadatos (EXIF, GPS, XMP, ICC, comentarios): lo
// guardado nunca es el archivo original. Lo guardado se comprueba leyendo el archivo de `alumnos.foto_clave`:
//   - empieza con FF D8 FF y `sharp(...).metadata()` da `format: 'jpeg'`, sin `exif`, `icc`, `iptc` ni `xmp`, y sin `orientation`;
//   - su lado mayor es min(800, lado mayor ya orientado), con la proporción conservada: 1600 × 1200 → 800 × 600; 400 × 300 → 400 × 300 (no se
//     agranda); 100 × 100 → 100 × 100;
//   - una imagen de 200 × 100 con la orientación EXIF 6 (90°) se guarda con 100 × 200;
//   - sus bytes no contienen el texto marcado del comentario JPEG, del trozo tEXt del PNG ni de lo pegado después del final de la imagen (FF D9 en
//     JPEG, IEND en PNG), y nunca son iguales a los bytes subidos. Las coordenadas GPS viajan en el EXIF, así que la ausencia de `exif` las cubre.

describe('la foto que se guarda se recodifica sin metadatos (criterio 35)', () => {
  let ctx: AppConAlmacen;
  let e: EscenarioInscripcion;
  let cliente: SolicitudSembrada;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({ ahora: AHORA_005 });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    ctx.vaciarAlmacen();
    e = await crearEscenarioInscripcion();
    cliente = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
    });
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  /** Sube la imagen y devuelve lo guardado (los bytes del archivo de `foto_clave`). */
  async function subirYLeer(cuerpo: Buffer, tipo: 'image/jpeg' | 'image/png'): Promise<Buffer> {
    const respuesta = await subirFoto(ctx, 'academia-a', { token: cliente.token, cuerpo, tipo });
    expect(respuesta.status, respuesta.texto).toBe(204);
    const clave = await fotoClaveDe(e.A.id, cliente.alumnoId);
    expect(clave, 'alumnos.foto_clave').not.toBeNull();
    expect(archivosDelAlumno(ctx.raiz, e.A.id, cliente.alumnoId)).toEqual([clave]);
    return leerArchivoDeClave(ctx.raiz, clave as string);
  }

  /** Lo que vale para cualquier foto guardada. */
  async function comprobarGuardada(guardado: Buffer, subido: Buffer): Promise<void> {
    expect([...guardado.subarray(0, 3)], 'empieza con FF D8 FF').toEqual([0xff, 0xd8, 0xff]);
    const metadatos = await metadatosDe(guardado);
    expect(metadatos.format).toBe('jpeg');
    for (const metadato of ['exif', 'icc', 'iptc', 'xmp', 'orientation'] as const) {
      expect(metadatos[metadato], `lo guardado lleva ${metadato}`).toBeUndefined();
    }
    expect(guardado.equals(subido), 'lo guardado es el archivo original').toBe(false);
    // Los marcadores de los segmentos de metadatos y los textos de la prueba no están en los bytes.
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

  it('criterio 35: una foto JPEG con coordenadas GPS, comentario, XMP y perfil de color se guarda sin ninguno de ellos', async () => {
    const subido = await jpeg(1600, 1200, { gps: true, comentario: TEXTO_MARCADO, xmp: TEXTO_MARCADO, icc: true });
    const original = await metadatosDe(subido);
    // Control de la propia prueba: lo subido sí lleva los metadatos.
    expect(original.exif, 'la foto de prueba no lleva EXIF').toBeDefined();
    expect(original.xmp, 'la foto de prueba no lleva XMP').toBeDefined();
    expect(original.icc, 'la foto de prueba no lleva perfil de color').toBeDefined();
    expect(subido.includes(Buffer.from(TEXTO_MARCADO))).toBe(true);

    const guardado = await subirYLeer(subido, 'image/jpeg');

    await comprobarGuardada(guardado, subido);
    const metadatos = await metadatosDe(guardado);
    expect([metadatos.width, metadatos.height]).toEqual([800, 600]);
  });

  it('criterio 35: un PNG con un trozo tEXt con el texto marcado se guarda como JPEG sin ese texto', async () => {
    const subido = png(1600, 1200, { texto: TEXTO_MARCADO });
    expect(subido.includes(Buffer.from(TEXTO_MARCADO))).toBe(true);

    const guardado = await subirYLeer(subido, 'image/png');

    await comprobarGuardada(guardado, subido);
    const metadatos = await metadatosDe(guardado);
    expect([metadatos.width, metadatos.height]).toEqual([800, 600]);
  });

  it('criterio 35: un JPEG con datos después del final de la imagen (FF D9) se guarda sin ellos y termina en FF D9', async () => {
    const subido = await jpeg(500, 400, { despues: Buffer.from(`COLA-DEL-JPEG ${TEXTO_MARCADO}`) });
    expect(subido.includes(Buffer.from('COLA-DEL-JPEG'))).toBe(true);

    const guardado = await subirYLeer(subido, 'image/jpeg');

    await comprobarGuardada(guardado, subido);
    expect([...guardado.subarray(guardado.length - 2)], 'termina en FF D9').toEqual([0xff, 0xd9]);
  });

  it('criterio 35: un archivo poliglota (un PNG válido con otro contenido pegado después de IEND) se guarda solo como la imagen recodificada', async () => {
    const pegado = Buffer.concat([
      Buffer.from('PK\u0003\u0004', 'latin1'),
      Buffer.from(`POLIGLOTA ${TEXTO_MARCADO} contenido de otro formato`, 'latin1'),
    ]);
    const subido = png(300, 200, { despues: pegado });

    const guardado = await subirYLeer(subido, 'image/png');

    await comprobarGuardada(guardado, subido);
    const metadatos = await metadatosDe(guardado);
    expect([metadatos.width, metadatos.height]).toEqual([300, 200]);
    // Es una sola imagen: sharp la decodifica entera sin pegados.
    const sharp = await cargarSharp();
    await expect(sharp(guardado).toBuffer()).resolves.toBeInstanceOf(Buffer);
  });

  it.each([
    ['1600 × 1200 (se reduce)', 1600, 1200, 800, 600],
    ['1200 × 1600 (se reduce, vertical)', 1200, 1600, 600, 800],
    ['400 × 300 (no se agranda)', 400, 300, 400, 300],
    ['100 × 100 (no se agranda)', 100, 100, 100, 100],
    ['800 × 800 (el borde)', 800, 800, 800, 800],
    ['3000 × 100 (se reduce con la proporción)', 3000, 100, 800, 27],
  ])(
    'criterio 35: un PNG de %s se guarda con el lado mayor en min(800, lado mayor) y la proporción conservada',
    async (_nombre, ancho, alto, anchoEsperado, altoEsperado) => {
      const guardado = await subirYLeer(png(ancho, alto), 'image/png');

      const metadatos = await metadatosDe(guardado);
      expect(metadatos.width).toBe(anchoEsperado);
      // El redondeo es el de sharp: una diferencia de un píxel no es un error.
      expect(Math.abs((metadatos.height ?? 0) - altoEsperado)).toBeLessThanOrEqual(1);
    },
  );

  it('criterio 35 y casos límite: una imagen de 200 × 100 con la orientación EXIF 6 se guarda girada, con 100 × 200 y sin EXIF ni orientación', async () => {
    const subido = await jpeg(200, 100, { orientacion: 6 });
    expect((await metadatosDe(subido)).orientation, 'la foto de prueba no lleva orientación').toBe(6);

    const guardado = await subirYLeer(subido, 'image/jpeg');

    await comprobarGuardada(guardado, subido);
    const metadatos = await metadatosDe(guardado);
    expect([metadatos.width, metadatos.height]).toEqual([100, 200]);
  });

  it('criterio 35: una foto grande con orientación se guarda con el lado mayor ya orientado en 800 (1600 × 800 con orientación 6 → 400 × 800)', async () => {
    const guardado = await subirYLeer(await jpeg(1600, 800, { orientacion: 6 }), 'image/jpeg');

    const metadatos = await metadatosDe(guardado);
    expect([metadatos.width, metadatos.height]).toEqual([400, 800]);
  });

  it('criterio 35: la imagen guardada conserva la imagen (no queda en blanco): el color promedio sigue siendo el de la foto subida', async () => {
    const guardado = await subirYLeer(await jpeg(300, 300, { color: { r: 200, g: 40, b: 40 } }), 'image/jpeg');

    const sharp = await cargarSharp();
    const { channels } = await sharp(guardado).stats();
    const [rojo, verde, azul] = channels.map((canal) => canal.mean);
    expect(rojo).toBeGreaterThan(170);
    expect(verde).toBeLessThan(80);
    expect(azul).toBeLessThan(80);
  });

  it('criterio 35: una segunda foto también se guarda recodificada y sin metadatos, y la primera deja de existir', async () => {
    await subirYLeer(png(200, 200), 'image/png');
    const subida = await jpeg(900, 900, { gps: true, comentario: TEXTO_MARCADO });

    const guardado = await subirYLeer(subida, 'image/jpeg');

    await comprobarGuardada(guardado, subida);
    expect((await metadatosDe(guardado)).width).toBe(800);
  });
});
