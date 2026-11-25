// spec: 008-carnet-qr (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AlumnoConQr,
  type AppCarnet,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
} from '../../utilidades/escenario-carnet';
import {
  patronDeClave,
  prepararEscenarioFotoPanel,
  rutaFotoAlumno,
  rutaFotoSolicitud,
  sembrarCliente,
  subirFotoPanel,
} from '../../utilidades/escenario-foto-panel';
import type { SolicitudSembrada } from '../../utilidades/inscripciones';
import {
  archivosBajo,
  archivosDelAlumno,
  cargarSharp,
  fotoClaveDe,
  jpeg,
  leerArchivoDeClave,
  metadatosDe,
  png,
  TEXTO_MARCADO,
} from '../../utilidades/inscripciones-005b';

// Criterio 25 (crítico, D-21, D-23, RNF-05: fotos de menores; criterios 35 y 36 de 005), la foto que se guarda desde el panel: fuera de toda transacción, la imagen aceptada se recodifica con `recodificarImagen` (JPEG de como mucho `FOTO_LADO_GUARDADO` = 800
// píxeles en su lado mayor, sin agrandar, con la orientación aplicada y sin EXIF, GPS, XMP, ICC ni comentarios) y se guarda con una clave nueva que genera el servidor, `academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`. Lo guardado nunca es el archivo original.
// Se comprueba leyendo el archivo de `alumnos.foto_clave` (como en el criterio 35 de 005): empieza con FF D8 FF, `sharp(...).metadata()` da `jpeg` sin `exif`, `icc`, `iptc`, `xmp` ni `orientation`; el lado mayor es min(800, lado mayor ya orientado); ni los bytes
// del comentario, del `tEXt`, del XMP, ni lo pegado después del final de la imagen están en el archivo; y no es igual a los bytes subidos. Vale para las dos rutas (`PUT /api/alumnos/{id}/foto` y `PUT /api/solicitudes/{id}/foto`).
// Caso límite de la spec: una foto de la cámara de 1920 × 1080 pasa los límites y se guarda a 800 × 450.
// Clave del servidor: nada de lo que manda el cliente (cabeceras, dirección, nombre de archivo) cambia la clave ni el lugar donde se guarda; la carpeta es la de la academia de la sesión y la del alumno.
// Lectura estricta elegida: la clave lleva un UUID v4 en minúsculas, como en el criterio 36 de 005, y dos subidas del mismo alumno nunca repiten clave.

type Cual = 'alumno' | 'solicitud';
const CUALES: readonly Cual[] = ['alumno', 'solicitud'];

describe('la foto del panel se recodifica sin metadatos y se guarda con la clave del servidor (criterio 25)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;
  let cliente: SolicitudSembrada;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioFotoPanel(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc);
    cliente = await sembrarCliente(esc);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const alumnoId = (cual: Cual) => (cual === 'alumno' ? alumno.alumnoId : cliente.alumnoId);
  const ruta = (cual: Cual) =>
    cual === 'alumno' ? rutaFotoAlumno(alumno.alumnoId) : rutaFotoSolicitud(cliente.solicitudId);

  /** Sube la imagen por la ruta y devuelve lo guardado (los bytes del archivo de `foto_clave`). */
  async function subirYLeer(
    cual: Cual,
    cuerpo: Buffer,
    tipo: 'image/jpeg' | 'image/png',
    extra: { headers?: Record<string, string>; ruta?: string } = {},
  ): Promise<Buffer> {
    const respuesta = await subirFotoPanel(ctx, extra.ruta ?? ruta(cual), {
      cookie: esc.cookies.secretaria,
      cuerpo,
      tipo,
      headers: extra.headers,
    });
    expect(respuesta.status, respuesta.texto).toBe(204);
    const clave = await fotoClaveDe(esc.e.A.id, alumnoId(cual));
    expect(clave, 'alumnos.foto_clave').not.toBeNull();
    expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, alumnoId(cual))).toEqual([clave]);
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

  describe.each(CUALES)('ruta de la %s', (cual) => {
    it('una foto JPEG con coordenadas GPS, comentario, XMP y perfil de color se guarda sin ninguno de ellos y a 800 × 600', async () => {
      const subido = await jpeg(1600, 1200, { gps: true, comentario: TEXTO_MARCADO, xmp: TEXTO_MARCADO, icc: true });
      const original = await metadatosDe(subido);
      // Control de la propia prueba: lo subido sí lleva los metadatos.
      expect(original.exif, 'la foto de prueba no lleva EXIF').toBeDefined();
      expect(original.xmp, 'la foto de prueba no lleva XMP').toBeDefined();
      expect(original.icc, 'la foto de prueba no lleva perfil de color').toBeDefined();
      expect(subido.includes(Buffer.from(TEXTO_MARCADO))).toBe(true);

      const guardado = await subirYLeer(cual, subido, 'image/jpeg');

      await comprobarGuardada(guardado, subido);
      const metadatos = await metadatosDe(guardado);
      expect([metadatos.width, metadatos.height]).toEqual([800, 600]);
    });

    it('un PNG con un trozo tEXt con el texto marcado se guarda como JPEG sin ese texto', async () => {
      const subido = png(1600, 1200, { texto: TEXTO_MARCADO });
      expect(subido.includes(Buffer.from(TEXTO_MARCADO))).toBe(true);

      const guardado = await subirYLeer(cual, subido, 'image/png');

      await comprobarGuardada(guardado, subido);
      const metadatos = await metadatosDe(guardado);
      expect([metadatos.width, metadatos.height]).toEqual([800, 600]);
    });

    it('un JPEG con datos después del final de la imagen (FF D9) se guarda sin ellos y termina en FF D9', async () => {
      const subido = await jpeg(500, 400, { despues: Buffer.from(`COLA-DEL-JPEG ${TEXTO_MARCADO}`) });
      expect(subido.includes(Buffer.from('COLA-DEL-JPEG'))).toBe(true);

      const guardado = await subirYLeer(cual, subido, 'image/jpeg');

      await comprobarGuardada(guardado, subido);
      expect([...guardado.subarray(guardado.length - 2)], 'termina en FF D9').toEqual([0xff, 0xd9]);
    });

    it('un archivo poliglota (un PNG válido con otro contenido pegado después de IEND) se guarda solo como la imagen recodificada', async () => {
      const pegado = Buffer.concat([
        Buffer.from('PK\u0003\u0004', 'latin1'),
        Buffer.from(`POLIGLOTA ${TEXTO_MARCADO} contenido de otro formato`, 'latin1'),
      ]);
      const subido = png(300, 200, { despues: pegado });

      const guardado = await subirYLeer(cual, subido, 'image/png');

      await comprobarGuardada(guardado, subido);
      const metadatos = await metadatosDe(guardado);
      expect([metadatos.width, metadatos.height]).toEqual([300, 200]);
      const sharp = await cargarSharp();
      await expect(sharp(guardado).toBuffer()).resolves.toBeInstanceOf(Buffer);
    });

    it('una imagen de 200 × 100 con la orientación EXIF 6 se guarda girada, con 100 × 200 y sin EXIF ni orientación', async () => {
      const subido = await jpeg(200, 100, { orientacion: 6 });
      expect((await metadatosDe(subido)).orientation, 'la foto de prueba no lleva orientación').toBe(6);

      const guardado = await subirYLeer(cual, subido, 'image/jpeg');

      await comprobarGuardada(guardado, subido);
      const metadatos = await metadatosDe(guardado);
      expect([metadatos.width, metadatos.height]).toEqual([100, 200]);
    });

    it('una foto de la cámara de 1920 × 1080 pasa los límites y se guarda a 800 × 450', async () => {
      const subido = await jpeg(1920, 1080, { gps: true });

      const guardado = await subirYLeer(cual, subido, 'image/jpeg');

      await comprobarGuardada(guardado, subido);
      const metadatos = await metadatosDe(guardado);
      expect(metadatos.width).toBe(800);
      expect(Math.abs((metadatos.height ?? 0) - 450)).toBeLessThanOrEqual(1);
    });

    it('una segunda foto también se guarda recodificada y sin metadatos, y la primera deja de existir', async () => {
      await subirYLeer(cual, png(200, 200), 'image/png');
      const subida = await jpeg(900, 900, { gps: true, comentario: TEXTO_MARCADO });

      const guardado = await subirYLeer(cual, subida, 'image/jpeg');

      await comprobarGuardada(guardado, subida);
      expect((await metadatosDe(guardado)).width).toBe(800);
    });
  });

  it.each([
    ['1600 × 1200 (se reduce)', 1600, 1200, 800, 600],
    ['1200 × 1600 (se reduce, vertical)', 1200, 1600, 600, 800],
    ['400 × 300 (no se agranda)', 400, 300, 400, 300],
    ['100 × 100 (no se agranda)', 100, 100, 100, 100],
    ['800 × 800 (el borde)', 800, 800, 800, 800],
    ['3000 × 100 (se reduce con la proporción)', 3000, 100, 800, 27],
  ])(
    'un PNG de %s se guarda con el lado mayor en min(800, lado mayor) y la proporción conservada',
    async (_nombre, ancho, alto, anchoEsperado, altoEsperado) => {
      const guardado = await subirYLeer('alumno', png(ancho, alto), 'image/png');

      const metadatos = await metadatosDe(guardado);
      expect(metadatos.width).toBe(anchoEsperado);
      expect(Math.abs((metadatos.height ?? 0) - altoEsperado)).toBeLessThanOrEqual(1);
    },
  );

  it('la imagen guardada conserva la imagen (no queda en blanco): el color promedio sigue siendo el de la foto subida', async () => {
    const guardado = await subirYLeer(
      'alumno',
      await jpeg(300, 300, { color: { r: 200, g: 40, b: 40 } }),
      'image/jpeg',
    );

    const sharp = await cargarSharp();
    const { channels } = await sharp(guardado).stats();
    const [rojo, verde, azul] = channels.map((canal) => canal.mean);
    expect(rojo).toBeGreaterThan(170);
    expect(verde).toBeLessThan(80);
    expect(azul).toBeLessThan(80);
  });

  describe('la clave la genera el servidor', () => {
    it.each(CUALES)(
      'ruta de la %s: la clave es academias/{academia de la sesión}/alumnos/{alumno}/foto-{uuid v4}.jpg y dos subidas no repiten clave',
      async (cual) => {
        const claves: string[] = [];
        for (const cuerpo of [png(100, 100), png(110, 110), png(120, 120)]) {
          const respuesta = await subirFotoPanel(ctx, ruta(cual), { cookie: esc.cookies.secretaria, cuerpo });
          expect(respuesta.status, respuesta.texto).toBe(204);
          claves.push((await fotoClaveDe(esc.e.A.id, alumnoId(cual))) as string);
        }

        for (const clave of claves) expect(clave).toMatch(patronDeClave(esc.e.A.id, alumnoId(cual)));
        expect(new Set(claves).size, 'una clave por subida').toBe(3);
        expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, alumnoId(cual))).toEqual([claves[2]]);
      },
    );

    it.each(CUALES)(
      'ruta de la %s: nada de lo que manda el cliente (nombre de archivo, cabeceras, parámetros de la dirección) cambia la clave ni dónde se guarda',
      async (cual) => {
        const maliciosos = '../../../../etc/passwd';
        const conTrampas = `${ruta(cual)}?clave=${encodeURIComponent(`academias/${esc.e.B.id}/alumnos/x/foto-x.jpg`)}&nombre=${encodeURIComponent(maliciosos)}&foto_clave=${encodeURIComponent(maliciosos)}&academiaId=${esc.e.B.id}`;

        const guardado = await subirYLeer(cual, png(150, 150), 'image/png', {
          ruta: conTrampas,
          headers: {
            'content-disposition': `attachment; filename="${maliciosos}"`,
            'x-file-name': maliciosos,
            'x-foto-clave': `academias/${esc.e.B.id}/alumnos/x/foto-x.jpg`,
            'x-academia-id': esc.e.B.id,
          },
        });

        expect(guardado.length).toBeGreaterThan(0);
        const clave = await fotoClaveDe(esc.e.A.id, alumnoId(cual));
        expect(clave).toMatch(patronDeClave(esc.e.A.id, alumnoId(cual)));
        expect(archivosBajo(ctx.raiz)).toEqual([clave]);
      },
    );

    it('la foto de la solicitud se guarda en la carpeta del alumno de esa solicitud, no en la de otro cliente ni en la de otra academia', async () => {
      const otro = await sembrarCliente(esc);
      const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });

      const respuesta = await subirFotoPanel(ctx, rutaFotoSolicitud(cliente.solicitudId), {
        cookie: esc.cookies.secretaria,
      });

      expect(respuesta.status, respuesta.texto).toBe(204);
      expect(await fotoClaveDe(esc.e.A.id, cliente.alumnoId)).toMatch(patronDeClave(esc.e.A.id, cliente.alumnoId));
      expect(await fotoClaveDe(esc.e.A.id, otro.alumnoId)).toBeNull();
      expect(await fotoClaveDe(esc.e.B.id, deB.alumnoId)).toBeNull();
      expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, cliente.alumnoId)).toHaveLength(1);
      expect(archivosBajo(ctx.raiz)).toHaveLength(1);
    });
  });
});
