// spec: 008-carnet-qr (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  type AlumnoConQr,
  apareceEnPdf,
  type AppCarnet,
  carnetDe,
  codigoDeRespuesta,
  contarImagenesDelPdf,
  crearAlumnoPorPago,
  crearAppCarnet,
  cuerpoRegenerar,
  type EscenarioDelCarnet,
  flujosDelPdf,
  GeneradorDeCarnetDePrueba,
  instantaneaDelCarnet,
  leerQr,
  PDF_FALSO,
  pdfSinFlujos,
  prepararEscenarioDelCarnet,
  RUTA_MI_CARNET,
  RUTA_MI_CARNET_PDF,
  rutaCarnet,
  rutaCarnetPdf,
  rutaRegenerarQr,
} from '../../utilidades/escenario-carnet';
import { leerInfoPdf, tieneFormaDePdf } from '../../utilidades/pdf';

// Criterio 11 (crítico en permisos, errores y aislamiento; el dibujo es prueba obligatoria; HU-13): `GET /api/alumnos/{id}/carnet/pdf` y `GET /api/mi-carnet/pdf` responden 200 con `Content-Type: application/pdf`, `Content-Disposition: attachment;
// filename="carnet.pdf"` y `Cache-Control: no-store`. El nombre del archivo y los metadatos del PDF (`Title`, `Author`, `Subject`, `Keywords`) no llevan nombres, DNI ni token. Los datos se leen en una transacción corta que termina antes de dibujar; si el
// generador falla, 500 `ERROR_INTERNO` y nada cambia. Las rutas de PDF de una academia nunca devuelven el carnet de otra (criterio 5, en `carnet-404-aislamiento.test.ts`; los permisos, en `carnet-permisos.test.ts`).
// Criterio 12 (crítico, HU-13, RN-06): el generador del PDF es inyectable (`GENERADOR_PDF_CARNET`, como el de 006b) y recibe `contenidoQr` del token guardado: el mismo `qr.contenido` que devuelve el carnet en ese momento. Prueba de integración: con el
// generador reemplazado, el contenido que recibe es `AQ1:` + `alumnos.qr_token`, igual a `qr.contenido` de `GET …/carnet`; después de regenerar, los dos cambian juntos. Prueba del generador real: el PDF contiene una imagen y no contiene el texto del token
// (el token solo va dentro del QR).
// Lectura estricta elegida para lo que la spec no dice con todas las letras: el generador recibe los datos con la clave `contenidoQr` (texto) y se llama una sola vez por descarga; el PDF no lleva el texto del token ni `AQ1:` en ningún flujo, tampoco descomprimido.

describe('el PDF con el generador reemplazado (criterios 11 y 12)', () => {
  const generador = new GeneradorDeCarnetDePrueba();
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;

  beforeAll(async () => {
    ctx = await crearAppCarnet({ generador });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc);
    generador.modo = 'falso';
    generador.llamadas.length = 0;
    generador.transaccionesAbiertas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const pdfDelPersonal = (alumnoId = alumno.alumnoId, cookie = esc.cookies.secretaria) =>
    ctx.http.get(rutaCarnetPdf(alumnoId), { cookie });
  const pdfPropio = (cookie = alumno.cookie) => ctx.http.get(RUTA_MI_CARNET_PDF, { cookie });

  describe('criterio 11: cabeceras', () => {
    it('criterio 11: el personal (secretaria y administrador) recibe 200 application/pdf, attachment con filename="carnet.pdf" y no-store, con el PDF del generador', async () => {
      for (const cookie of [esc.cookies.secretaria, esc.cookies.admin]) {
        const respuesta = await pdfDelPersonal(alumno.alumnoId, cookie);

        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
        expect(respuesta.headers.get('content-type')).toBe('application/pdf');
        expect(respuesta.headers.get('content-disposition')).toBe('attachment; filename="carnet.pdf"');
        expect(respuesta.cacheControl).toBe('no-store');
        expect(respuesta.cuerpo.equals(PDF_FALSO), 'el cuerpo es el PDF que devolvió el generador').toBe(true);
      }
    });

    it('criterio 11: el alumno recibe el suyo en /api/mi-carnet/pdf con las mismas cabeceras', async () => {
      const respuesta = await pdfPropio();

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      expect(respuesta.headers.get('content-type')).toBe('application/pdf');
      expect(respuesta.headers.get('content-disposition')).toBe('attachment; filename="carnet.pdf"');
      expect(respuesta.cacheControl).toBe('no-store');
      expect(respuesta.cuerpo.equals(PDF_FALSO)).toBe(true);
    });

    it('criterio 11: el nombre del archivo es siempre carnet.pdf, sin nombres, DNI ni token (también con otro alumno y con apellidos con tilde)', async () => {
      const otro = await crearAlumnoPorPago(ctx, esc, { nombres: 'José Ángel', apellidos: 'Núñez Ñahui' });

      for (const respuesta of [await pdfDelPersonal(otro.alumnoId), await pdfPropio(otro.cookie)]) {
        expect(respuesta.headers.get('content-disposition')).toBe('attachment; filename="carnet.pdf"');
      }
    });

    it('criterio 11: leer el PDF no escribe, no cambia el token y no audita', async () => {
      const antes = await instantaneaDelCarnet(esc.e);
      const auditoriaAntes = (await leerAuditoriaDeAcademia(esc.e.A.id)).length;

      await pdfDelPersonal();
      await pdfPropio();

      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
      expect((await leerAuditoriaDeAcademia(esc.e.A.id)).length).toBe(auditoriaAntes);
    });

    it('criterio 11: un rechazo (403, 404 o 401) no llega al generador', async () => {
      const respuestas = await Promise.all([
        ctx.http.get(rutaCarnetPdf(alumno.alumnoId), { cookie: esc.cookies.entrenador }),
        ctx.http.get(rutaCarnetPdf(alumno.alumnoId), { cookie: alumno.cookie }),
        ctx.http.get(rutaCarnetPdf(alumno.alumnoId), { cookie: esc.cookies.secretariaB }),
        ctx.http.get(rutaCarnetPdf(alumno.alumnoId)),
        ctx.http.get(RUTA_MI_CARNET_PDF, { cookie: esc.cookies.secretaria }),
        ctx.http.get(RUTA_MI_CARNET_PDF, { cookie: esc.cookies.alumno }),
      ]);

      expect(respuestas.map((r) => r.status)).toEqual([403, 403, 404, 401, 403, 404]);
      expect(generador.llamadas).toEqual([]);
    });
  });

  describe('criterio 11: los datos se leen en una transacción corta que termina antes de dibujar', () => {
    it('criterio 11: cuando el generador empieza a dibujar, ninguna conexión de la API tiene una transacción abierta (personal y alumno)', async () => {
      await pdfDelPersonal();
      await pdfPropio();

      expect(generador.llamadas).toHaveLength(2);
      expect(generador.transaccionesAbiertas).toEqual([0, 0]);
    });

    it.each(['rechaza', 'lanza'] as const)(
      'criterio 11: si el generador %s, 500 ERROR_INTERNO sin filtrar el motivo ni datos del alumno y nada cambia; con el generador sano, la misma descarga responde 200',
      async (modo) => {
        const antes = await instantaneaDelCarnet(esc.e);
        const auditoriaAntes = (await leerAuditoriaDeAcademia(esc.e.A.id)).length;
        generador.modo = modo;

        const delPersonal = await pdfDelPersonal();
        const propio = await pdfPropio();

        for (const respuesta of [delPersonal, propio]) {
          expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
            500,
            'ERROR_INTERNO',
          ]);
          expect(respuesta.headers.get('content-type') ?? '').toContain('application/json');
          expect(respuesta.headers.get('content-disposition')).toBeNull();
          expect(respuesta.cacheControl).toBe('no-store');
          expect(respuesta.texto).not.toContain('Falla simulada');
          expect(respuesta.texto).not.toContain(alumno.dni);
          expect(respuesta.texto).not.toContain('AQ1:');
        }
        expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
        expect((await leerAuditoriaDeAcademia(esc.e.A.id)).length).toBe(auditoriaAntes);
        generador.modo = 'falso';
        expect((await pdfDelPersonal()).status).toBe(200);
      },
    );
  });

  describe('criterio 12: el mismo QR en pantalla y en PDF', () => {
    it('criterio 12: el generador recibe AQ1: + alumnos.qr_token, igual a qr.contenido de GET …/carnet y de GET /api/mi-carnet', async () => {
      const token = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token as string;
      const enPantalla = carnetDe(await ctx.http.get(rutaCarnet(alumno.alumnoId), { cookie: esc.cookies.secretaria }));
      const propio = carnetDe(await ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie }));

      const pdf = await pdfDelPersonal();
      const pdfDelAlumno = await pdfPropio();

      expect(pdf.status, pdf.texto.slice(0, 300)).toBe(200);
      expect(pdfDelAlumno.status, pdfDelAlumno.texto.slice(0, 300)).toBe(200);
      expect(generador.llamadas).toHaveLength(2);
      expect(generador.contenidoRecibido(0)).toBe(`AQ1:${token}`);
      expect(generador.contenidoRecibido(1)).toBe(`AQ1:${token}`);
      expect(generador.contenidoRecibido(0)).toBe(enPantalla.qr?.contenido);
      expect(generador.contenidoRecibido(1)).toBe(propio.qr?.contenido);
    });

    it('criterio 12: cada alumno recibe el QR de su carnet: el PDF de /api/mi-carnet/pdf lleva el token de la sesión y no el de otro', async () => {
      const otro = await crearAlumnoPorPago(ctx, esc, { nombres: 'Camila', apellidos: 'Torres Vega' });
      const tokenOtro = (await leerQr(esc.e.A.id, otro.alumnoId)).qr_token as string;
      const tokenMio = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token as string;

      await pdfPropio(otro.cookie);
      await pdfPropio(alumno.cookie);
      await pdfDelPersonal(otro.alumnoId);

      expect(generador.contenidoRecibido(0)).toBe(`AQ1:${tokenOtro}`);
      expect(generador.contenidoRecibido(1)).toBe(`AQ1:${tokenMio}`);
      expect(generador.contenidoRecibido(2)).toBe(`AQ1:${tokenOtro}`);
    });

    it('criterio 12: después de regenerar, el carnet y el generador cambian juntos al mismo contenido nuevo (y el anterior ya no llega al PDF)', async () => {
      const antes = carnetDe(await ctx.http.get(rutaCarnet(alumno.alumnoId), { cookie: esc.cookies.secretaria }));
      await pdfDelPersonal();
      const contenidoViejo = generador.contenidoRecibido(0);
      expect(contenidoViejo).toBe(antes.qr?.contenido);

      const regeneracion = await ctx.http.post(rutaRegenerarQr(alumno.alumnoId), cuerpoRegenerar(), {
        cookie: esc.cookies.secretaria,
      });
      expect(regeneracion.status, regeneracion.texto.slice(0, 300)).toBe(200);
      const despues = carnetDe(await ctx.http.get(rutaCarnet(alumno.alumnoId), { cookie: esc.cookies.secretaria }));
      await pdfDelPersonal();
      await pdfPropio();

      const nuevo = despues.qr?.contenido as string;
      expect(nuevo).not.toBe(contenidoViejo);
      expect(
        carnetDe(regeneracion).qr?.contenido,
        'la respuesta de la regeneración trae el mismo contenido nuevo',
      ).toBe(nuevo);
      expect(generador.contenidoRecibido(1)).toBe(nuevo);
      expect(generador.contenidoRecibido(2)).toBe(nuevo);
      expect(generador.llamadas.map((_, i) => generador.contenidoRecibido(i)).slice(1)).not.toContain(contenidoViejo);
    });

    it('criterio 12: cada descarga llama una sola vez al generador', async () => {
      await pdfDelPersonal();
      expect(generador.llamadas).toHaveLength(1);
      await pdfPropio();
      expect(generador.llamadas).toHaveLength(2);
    });
  });
});

describe('el PDF con el generador real (criterios 11 y 12)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc, { nombres: 'Valeria', apellidos: 'Mendoza Salas' });
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  it('criterio 11: el PDF real tiene forma de PDF, las cabeceras del contrato y, tanto para el personal como para el alumno, el mismo tamaño de documento sano', async () => {
    const delPersonal = await ctx.http.get(rutaCarnetPdf(alumno.alumnoId), { cookie: esc.cookies.secretaria });
    const propio = await ctx.http.get(RUTA_MI_CARNET_PDF, { cookie: alumno.cookie });

    for (const respuesta of [delPersonal, propio]) {
      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      expect(respuesta.headers.get('content-type')).toBe('application/pdf');
      expect(respuesta.headers.get('content-disposition')).toBe('attachment; filename="carnet.pdf"');
      expect(respuesta.cacheControl).toBe('no-store');
      expect(tieneFormaDePdf(respuesta.cuerpo), 'empieza con %PDF- y termina con %%EOF').toBe(true);
    }
  });

  it('criterio 11: los metadatos del PDF (Title, Author, Subject, Keywords y todo lo que no es el contenido de las páginas) no llevan nombres, apellidos, DNI, ids ni token', async () => {
    const token = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token as string;
    const respuesta = await ctx.http.get(rutaCarnetPdf(alumno.alumnoId), { cookie: esc.cookies.secretaria });
    expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);

    const sinFlujos = pdfSinFlujos(respuesta.cuerpo);
    const info = leerInfoPdf(respuesta.cuerpo);

    for (const [que, valor] of [
      ['el nombre', 'Valeria'],
      ['el primer apellido', 'Mendoza'],
      ['el segundo apellido', 'Salas'],
      ['el DNI', alumno.dni],
      ['el id del alumno', alumno.alumnoId],
      ['el id de su usuario', alumno.usuarioId],
      ['el token', token],
      ['el prefijo del contenido del QR', 'AQ1:'],
      ['el código de la solicitud', alumno.codigoSolicitud],
    ]) {
      expect(apareceEnPdf(sinFlujos, valor as string), `los metadatos del PDF no llevan ${que}`).toBe(false);
    }
    for (const campo of [info.Title, info.Author, info.Creator, info.Producer]) {
      for (const valor of ['Valeria', 'Mendoza', 'Salas', alumno.dni, token]) {
        expect(campo ?? '', 'ni el título ni el autor llevan datos personales').not.toContain(valor);
      }
    }
    for (const nombre of ['Subject', 'Keywords']) {
      const coincidencia = new RegExp(`/${nombre}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9a-fA-F\\s]*>)`).exec(sinFlujos);
      for (const valor of ['Valeria', 'Mendoza', 'Salas', alumno.dni, token]) {
        expect(coincidencia?.[1] ?? '', `${nombre} sin datos personales`).not.toContain(valor);
      }
    }
  });

  it('criterio 12: el PDF real contiene una imagen (el QR) y no contiene el texto del token ni AQ1: en ningún flujo, tampoco descomprimido (el token solo va dentro del QR)', async () => {
    const token = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token as string;
    const respuesta = await ctx.http.get(rutaCarnetPdf(alumno.alumnoId), { cookie: esc.cookies.secretaria });
    expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);

    const flujos = flujosDelPdf(respuesta.cuerpo).join('\n');

    expect(contarImagenesDelPdf(respuesta.cuerpo), 'el QR es una imagen').toBeGreaterThanOrEqual(1);
    expect(apareceEnPdf(flujos, token), 'el texto del token no está en el PDF').toBe(false);
    expect(apareceEnPdf(flujos, 'AQ1:'), 'el contenido del QR no está en texto').toBe(false);
    expect(apareceEnPdf(pdfSinFlujos(respuesta.cuerpo), token)).toBe(false);
    expect(respuesta.cuerpo.includes(Buffer.from(token, 'latin1'))).toBe(false);
  });
});
