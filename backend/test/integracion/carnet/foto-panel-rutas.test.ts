// spec: 008-carnet-qr (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { AHORA_007, partesDeLaAcademia, sembrarCobrable } from '../../utilidades/escenario-pagos';
import { sembrarEnVerificacion, sembrarRechazada } from '../../utilidades/escenario-pagos-007b';
import {
  type AlumnoConQr,
  type AppCarnet,
  cambiarAlumno,
  carnetDe,
  codigoDeRespuesta,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
  leerQr,
  RUTA_MI_CARNET,
  rutaCarnet,
} from '../../utilidades/escenario-carnet';
import {
  instantaneaDeLaFoto,
  type OpcionesFotoPanel,
  patronDeClave,
  prepararEscenarioFotoPanel,
  rutaFotoAlumno,
  rutaFotoSolicitud,
  subirFotoPanel,
} from '../../utilidades/escenario-foto-panel';
import {
  codigoAleatorio,
  cuerpoInscripcion,
  insertarFila,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  type OpcionesSembrado,
  rutaPublica,
  sembrarSolicitud,
  sha256,
  sinUuid,
  tokenAleatorio,
} from '../../utilidades/inscripciones';
import {
  archivosBajo,
  archivosDelAlumno,
  existeArchivoDeClave,
  fotoClaveDe,
  jpeg,
  leerArchivoDeClave,
  png,
} from '../../utilidades/inscripciones-005b';
import { cookieDeUsuario } from '../../utilidades/usuarios';

// Criterio 22 (crítico, D-20, D-24, DR-21 de 005): `PUT /api/alumnos/{id}/foto`, con `@Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')` (`ADMIN` y `SECRETARIA`) y la imagen como cuerpo binario (`image/jpeg` o `image/png`), responde 204 sin cuerpo y con
// `Cache-Control: no-store` para cualquier alumno de la academia (no `CLIENTE`), en cualquier estado. Los 404 son los del criterio 5. La foto nueva reemplaza a la anterior, y el carnet la muestra desde ese momento.
// Criterio 23 (crítico, DR-21 de 005): `PUT /api/solicitudes/{id}/foto`, con el mismo permiso, cuerpo y respuesta, guarda la foto del alumno de esa solicitud si su estado visible es `PENDIENTE_PAGO`, `EN_VERIFICACION` o `PAGO_RECHAZADO` (con la
// regla de editable de la foto pública: fila `PENDIENTE_PAGO`, alumno en `CLIENTE`, solicitud vigente; criterio 34 f de 005) o `CONFIRMADA` (el alumno ya no es `CLIENTE`). Responde 409 `SOLICITUD_NO_EDITABLE` (cuerpo `{ codigo, mensaje }`) si está
// `VENCIDA` (también en el instante del vencimiento, con el tope del fin de mes) o `CANCELADA`, o si es la fila anterior de un cliente que volvió (criterio 21 b de 005); y 404 `NO_ENCONTRADO` con un id que no es UUID, que no existe o de otra academia.
// Criterio 5 (crítico, D-23, RN-05, AT-2 de 004), para la foto: un `{id}` que no es UUID, que no existe, que es de otra academia o que es de un `CLIENTE` responde el mismo 404 `NO_ENCONTRADO`, con el mismo cuerpo; `?academiaId=` no cambia la academia.
// Criterio 24 d: `ALUMNO` y `ENTRENADOR` reciben 403 `SIN_PERMISO`. Ningún rechazo cambia `foto_clave`, deja un archivo nuevo en el almacén ni audita.
// Lecturas estrictas elegidas: el 204 de la subida guarda `actualizado_en` con «ahora» de `RELOJ` (criterio 25) y no cambia ninguna otra columna del alumno; el 404 de la ruta de la solicitud tiene el mismo cuerpo para todos los casos (id que no es UUID, que no existe,
// de otra academia o de otra tabla); un alumno `INACTIVO` o `ALUMNO_VENCIDO` también recibe la foto (criterio 22: «en cualquier estado»).

describe('foto de un alumno desde el panel (criterios 22 y 5)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioFotoPanel(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const subir = (
    alumnoId: string,
    cookie: string | undefined = esc.cookies.secretaria,
    extra: OpcionesFotoPanel = {},
  ) => subirFotoPanel(ctx, rutaFotoAlumno(alumnoId), { cookie, ...extra });
  const claveDe = (alumnoId = alumno.alumnoId, academiaId = esc.e.A.id) => fotoClaveDe(academiaId, alumnoId);
  const MAS_TARDE = new Date(AHORA_007.getTime() + 60 * 60 * 1000);

  describe('204', () => {
    it.each(['secretaria', 'admin'] as const)(
      'criterio 22: la %s sube la foto: 204 sin cuerpo y con Cache-Control: no-store; foto_clave es la clave del servidor y su archivo es un JPEG que existe y el único del alumno',
      async (rol) => {
        const respuesta = await subir(alumno.alumnoId, esc.cookies[rol]);

        expect(respuesta.status, respuesta.texto).toBe(204);
        expect(respuesta.texto).toBe('');
        expect(respuesta.cacheControl).toBe('no-store');
        const clave = await claveDe();
        expect(clave).toMatch(patronDeClave(esc.e.A.id, alumno.alumnoId));
        expect(existeArchivoDeClave(ctx.raiz, clave as string)).toBe(true);
        expect([...leerArchivoDeClave(ctx.raiz, clave as string).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
        expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, alumno.alumnoId)).toEqual([clave]);
      },
    );

    it('criterio 22: acepta JPEG y PNG', async () => {
      const conJpeg = await subir(alumno.alumnoId, esc.cookies.secretaria, {
        cuerpo: await jpeg(300, 200),
        tipo: 'image/jpeg',
      });
      const conPng = await subir(alumno.alumnoId, esc.cookies.secretaria, { cuerpo: png(200, 200), tipo: 'image/png' });

      expect([conJpeg.status, conPng.status]).toEqual([204, 204]);
    });

    it.each(['ALUMNO_ACTIVO', 'ALUMNO_VENCIDO', 'INACTIVO'])(
      'criterio 22: un alumno en estado %s también recibe la foto (cualquier estado que no sea CLIENTE)',
      async (estado) => {
        await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { estado });

        const respuesta = await subir(alumno.alumnoId);

        expect(respuesta.status, respuesta.texto).toBe(204);
        expect(await claveDe()).toMatch(patronDeClave(esc.e.A.id, alumno.alumnoId));
      },
    );

    it('criterio 22: la foto nueva reemplaza a la anterior: otra clave, el archivo anterior ya no está y queda uno solo', async () => {
      expect((await subir(alumno.alumnoId)).status).toBe(204);
      const primera = (await claveDe()) as string;

      const segunda = await subir(alumno.alumnoId, esc.cookies.admin, { cuerpo: png(150, 150) });

      expect(segunda.status, segunda.texto).toBe(204);
      const clave = (await claveDe()) as string;
      expect(clave).not.toBe(primera);
      expect(existeArchivoDeClave(ctx.raiz, primera), 'el archivo anterior debía borrarse').toBe(false);
      expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, alumno.alumnoId)).toEqual([clave]);
    });

    it('criterio 22: el carnet muestra la foto desde ese momento, para el personal y para el alumno, y la nueva reemplaza a la vieja en el carnet', async () => {
      const antes = carnetDe(await ctx.http.get(rutaCarnet(alumno.alumnoId), { cookie: esc.cookies.secretaria }));
      expect(antes.foto, 'sin foto, «Foto pendiente»').toBeNull();

      expect((await subir(alumno.alumnoId)).status).toBe(204);
      const primera = leerArchivoDeClave(ctx.raiz, (await claveDe()) as string);
      const conLaPrimera = carnetDe(
        await ctx.http.get(rutaCarnet(alumno.alumnoId), { cookie: esc.cookies.secretaria }),
      );
      expect(conLaPrimera.foto).toBe(`data:image/jpeg;base64,${primera.toString('base64')}`);

      expect((await subir(alumno.alumnoId, esc.cookies.admin, { cuerpo: png(180, 120) })).status).toBe(204);
      const segunda = leerArchivoDeClave(ctx.raiz, (await claveDe()) as string);
      const delPersonal = carnetDe(await ctx.http.get(rutaCarnet(alumno.alumnoId), { cookie: esc.cookies.admin }));
      const propio = carnetDe(await ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie }));
      expect(delPersonal.foto).toBe(`data:image/jpeg;base64,${segunda.toString('base64')}`);
      expect(propio.foto).toBe(delPersonal.foto);
      expect(delPersonal.foto).not.toBe(conLaPrimera.foto);
    });

    it('criterio 22 (control de datos): guarda foto_clave y actualizado_en (con «ahora») y no cambia nada más: ni el alumno, ni su QR, ni otros alumnos, ni la caja, los pagos o la academia B', async () => {
      const otro = await crearAlumnoPorPago(ctx, esc, { nombres: 'Camila', apellidos: 'Torres Vega' });
      const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });
      const alumnosAntes = await leerAlumnos(esc.e.A.id);
      const qrAntes = await leerQr(esc.e.A.id, alumno.alumnoId);
      const partesAntes = await partesDeLaAcademia(esc.e.A.id);
      ctx.reloj.fijar(MAS_TARDE);

      const respuesta = await subir(alumno.alumnoId);

      expect(respuesta.status, respuesta.texto).toBe(204);
      const alumnosDespues = await leerAlumnos(esc.e.A.id);
      const propioAntes = alumnosAntes.find((fila) => fila.id === alumno.alumnoId);
      const propioDespues = alumnosDespues.find((fila) => fila.id === alumno.alumnoId);
      expect(propioDespues).toEqual({
        ...propioAntes,
        foto_clave: expect.stringMatching(patronDeClave(esc.e.A.id, alumno.alumnoId)) as unknown,
        actualizado_en: MAS_TARDE,
      });
      expect(alumnosDespues.find((fila) => fila.id === otro.alumnoId)).toEqual(
        alumnosAntes.find((fila) => fila.id === otro.alumnoId),
      );
      const qrDespues = await leerQr(esc.e.A.id, alumno.alumnoId);
      expect(qrDespues.qr_token, 'el token del QR no cambia').toBe(qrAntes.qr_token);
      expect(qrDespues.qr_generado_en).toEqual(qrAntes.qr_generado_en);
      const partesDespues = await partesDeLaAcademia(esc.e.A.id);
      expect(partesDespues.pagos).toEqual(partesAntes.pagos);
      expect(partesDespues.caja).toBe(partesAntes.caja);
      expect(partesDespues.usuarios).toBe(partesAntes.usuarios);
      expect(await fotoClaveDe(esc.e.B.id, deB.alumnoId), 'la academia B no se toca').toBeNull();
      expect(archivosBajo(ctx.raiz).every((archivo) => archivo.startsWith(`academias/${esc.e.A.id}/`))).toBe(true);
    });
  });

  describe('404 (criterio 5)', () => {
    it('criterio 5 y 22: un id que no es UUID, que no existe, que es de otra academia, que es de un CLIENTE (de A o de B) o de otra tabla responde el mismo 404 NO_ENCONTRADO con el mismo cuerpo, sin el id, y no cambia nada', async () => {
      const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });
      const clienteDeA = await sembrarCobrable(esc.e);
      const clienteDeB = await sembrarSolicitud(esc.e.B.id, {
        planId: esc.e.planB.id,
        claseIds: [esc.e.lunesB.id],
        clasesTotales: 5,
        clasesPorMesPlan: 12,
        precioPlan: '100.00',
        monto: '42.00',
      });
      const ids = [
        'no-es-un-uuid',
        'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
        `${randomUUID()}x`,
        randomUUID(),
        deB.alumnoId,
        clienteDeA.alumnoId,
        clienteDeB.alumnoId,
        alumno.solicitudId,
        alumno.usuarioId,
      ];
      const antes = await instantaneaDeLaFoto(ctx, esc);
      const cuerpos = new Set<string>();

      for (const cookie of [esc.cookies.secretaria, esc.cookies.admin]) {
        for (const id of ids) {
          const respuesta = await subir(id, cookie);

          expect([respuesta.status, codigoDeRespuesta(respuesta)], `${id}: ${respuesta.texto.slice(0, 200)}`).toEqual([
            404,
            'NO_ENCONTRADO',
          ]);
          expect(respuesta.texto, 'sin el id en el cuerpo').not.toContain(id);
          cuerpos.add(sinUuid(respuesta.texto));
        }
      }

      expect(cuerpos.size, 'el mismo cuerpo para todos los casos').toBe(1);
      expect(await instantaneaDeLaFoto(ctx, esc)).toBe(antes);
    });

    it('criterio 5 y 22: el personal de B no puede subir la foto de un alumno de A (404) y el de A tampoco la de uno de B; cada subida correcta queda en la carpeta de su academia', async () => {
      const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });
      const antes = await instantaneaDeLaFoto(ctx, esc);

      const bSobreA = await subir(alumno.alumnoId, esc.cookies.secretariaB);
      const adminBSobreA = await subir(alumno.alumnoId, esc.cookies.adminB);
      const aSobreB = await subir(deB.alumnoId, esc.cookies.secretaria);

      for (const respuesta of [bSobreA, adminBSobreA, aSobreB]) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
          404,
          'NO_ENCONTRADO',
        ]);
      }
      expect(await instantaneaDeLaFoto(ctx, esc)).toBe(antes);

      expect((await subir(alumno.alumnoId, esc.cookies.secretaria)).status).toBe(204);
      expect((await subir(deB.alumnoId, esc.cookies.secretariaB)).status).toBe(204);
      expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
      expect(archivosDelAlumno(ctx.raiz, esc.e.B.id, deB.alumnoId)).toHaveLength(1);
      expect(await claveDe(deB.alumnoId, esc.e.B.id)).toMatch(patronDeClave(esc.e.B.id, deB.alumnoId));
      expect(await claveDe(alumno.alumnoId, esc.e.A.id)).toMatch(patronDeClave(esc.e.A.id, alumno.alumnoId));
      expect(
        archivosBajo(ctx.raiz).every(
          (a) => a.startsWith(`academias/${esc.e.A.id}/`) || a.startsWith(`academias/${esc.e.B.id}/`),
        ),
      ).toBe(true);
    });

    it('criterio 5: ?academiaId=<B> en la dirección y las cabeceras con la academia no cambian la academia: el alumno de B sigue siendo 404 para A, y el de A recibe la foto en la carpeta de A', async () => {
      const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });
      const antes = await instantaneaDeLaFoto(ctx, esc);

      const conParametro = await subirFotoPanel(ctx, `${rutaFotoAlumno(deB.alumnoId)}?academiaId=${esc.e.B.id}`, {
        cookie: esc.cookies.secretaria,
      });
      const conCabecera = await subir(deB.alumnoId, esc.cookies.secretaria, {
        headers: { 'x-academia-id': esc.e.B.id, 'x-academia': 'academia-b' },
      });

      for (const respuesta of [conParametro, conCabecera]) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
          404,
          'NO_ENCONTRADO',
        ]);
      }
      expect(await instantaneaDeLaFoto(ctx, esc)).toBe(antes);
      const propio = await subirFotoPanel(ctx, `${rutaFotoAlumno(alumno.alumnoId)}?academiaId=${esc.e.B.id}`, {
        cookie: esc.cookies.secretaria,
        headers: { 'x-academia-id': esc.e.B.id },
      });
      expect(propio.status, propio.texto).toBe(204);
      expect(await claveDe()).toMatch(patronDeClave(esc.e.A.id, alumno.alumnoId));
      expect(archivosBajo(ctx.raiz).every((archivo) => archivo.startsWith(`academias/${esc.e.A.id}/`))).toBe(true);
    });
  });

  describe('permisos (criterio 24 d)', () => {
    it('criterio 24 d: el entrenador y el alumno (también con su propio id) reciben 403 SIN_PERMISO y no cambian nada', async () => {
      const otro = await crearAlumnoPorPago(ctx, esc, { nombres: 'Camila', apellidos: 'Torres Vega' });
      const antes = await instantaneaDeLaFoto(ctx, esc);

      const respuestas = [
        await subir(alumno.alumnoId, esc.cookies.entrenador),
        await subir(alumno.alumnoId, alumno.cookie),
        await subir(otro.alumnoId, alumno.cookie),
        await subir(randomUUID(), alumno.cookie),
        await subir('no-es-un-uuid', esc.cookies.entrenador),
      ];

      for (const respuesta of respuestas) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
          403,
          'SIN_PERMISO',
        ]);
      }
      expect(await instantaneaDeLaFoto(ctx, esc)).toBe(antes);
      expect(await claveDe()).toBeNull();
      expect(await claveDe(otro.alumnoId)).toBeNull();
    });
  });
});

describe('foto de una solicitud desde el panel (criterio 23)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioFotoPanel(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const subir = (
    solicitudId: string,
    cookie: string | undefined = esc.cookies.secretaria,
    extra: OpcionesFotoPanel = {},
  ) => subirFotoPanel(ctx, rutaFotoSolicitud(solicitudId), { cookie, ...extra });
  const claveDe = (alumnoId: string, academiaId = esc.e.A.id) => fotoClaveDe(academiaId, alumnoId);
  const sembrar = (opciones: Partial<OpcionesSembrado> = {}) => sembrarCobrable(esc.e, opciones);

  type Cliente = { alumnoId: string; solicitudId: string };
  const EDITABLES: [string, () => Promise<Cliente>][] = [
    ['PENDIENTE_PAGO', () => sembrar()],
    ['EN_VERIFICACION (el pago de Yape espera la revisión)', () => sembrarEnVerificacion(esc.e)],
    ['PAGO_RECHAZADO', () => sembrarRechazada(esc.e)],
    ['CONFIRMADA (el alumno ya no es CLIENTE)', () => crearAlumnoPorPago(ctx, esc)],
  ];

  describe('204', () => {
    it.each(EDITABLES)(
      'criterio 23: una solicitud %s recibe la foto: 204 sin cuerpo, no-store, y la clave queda en el alumno de esa solicitud',
      async (_nombre, armar) => {
        const cliente = await armar();

        const respuesta = await subir(cliente.solicitudId);

        expect(respuesta.status, respuesta.texto).toBe(204);
        expect(respuesta.texto).toBe('');
        expect(respuesta.cacheControl).toBe('no-store');
        const clave = await claveDe(cliente.alumnoId);
        expect(clave).toMatch(patronDeClave(esc.e.A.id, cliente.alumnoId));
        expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, cliente.alumnoId)).toEqual([clave]);
        expect(archivosBajo(ctx.raiz)).toEqual([clave]);
      },
    );

    it('criterio 23: el administrador también puede, y una foto nueva reemplaza a la anterior (otra clave, un solo archivo)', async () => {
      const cliente = await sembrar();
      expect((await subir(cliente.solicitudId, esc.cookies.secretaria)).status).toBe(204);
      const primera = (await claveDe(cliente.alumnoId)) as string;

      const segunda = await subir(cliente.solicitudId, esc.cookies.admin, { cuerpo: png(140, 140) });

      expect(segunda.status, segunda.texto).toBe(204);
      const clave = (await claveDe(cliente.alumnoId)) as string;
      expect(clave).not.toBe(primera);
      expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, cliente.alumnoId)).toEqual([clave]);
    });

    it('criterio 23: la foto de una solicitud CONFIRMADA llega al carnet del alumno y no toca su QR ni su estado', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);
      const qrAntes = await leerQr(esc.e.A.id, alumno.alumnoId);

      const respuesta = await subir(alumno.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(204);
      const carnet = carnetDe(await ctx.http.get(rutaCarnet(alumno.alumnoId), { cookie: esc.cookies.secretaria }));
      const guardada = leerArchivoDeClave(ctx.raiz, (await claveDe(alumno.alumnoId)) as string);
      expect(carnet.foto).toBe(`data:image/jpeg;base64,${guardada.toString('base64')}`);
      expect(carnet.alumno.estado).toBe('ALUMNO_ACTIVO');
      const qrDespues = await leerQr(esc.e.A.id, alumno.alumnoId);
      expect(qrDespues.qr_token).toBe(qrAntes.qr_token);
      expect(qrDespues.qr_token).not.toBeNull();
    });

    it('criterio 23: subir la foto de un cliente no cambia su estado ni su solicitud, su matrícula, otros clientes ni la academia B', async () => {
      const cliente = await sembrar();
      const otro = await sembrar();
      const solicitudesAntes = await leerSolicitudes(esc.e.A.id);
      const matriculasAntes = await leerMatriculas(esc.e.A.id);
      const alumnosAntes = await leerAlumnos(esc.e.A.id);
      const partesAntes = await partesDeLaAcademia(esc.e.A.id);
      const bAntes = await partesDeLaAcademia(esc.e.B.id);

      const respuesta = await subir(cliente.solicitudId);

      expect(respuesta.status, respuesta.texto).toBe(204);
      expect(await leerSolicitudes(esc.e.A.id)).toEqual(solicitudesAntes);
      expect(await leerMatriculas(esc.e.A.id)).toEqual(matriculasAntes);
      const alumnosDespues = await leerAlumnos(esc.e.A.id);
      const propio = alumnosDespues.find((fila) => fila.id === cliente.alumnoId);
      expect(propio?.estado).toBe('CLIENTE');
      expect(alumnosDespues.find((fila) => fila.id === otro.alumnoId)).toEqual(
        alumnosAntes.find((fila) => fila.id === otro.alumnoId),
      );
      const partesDespues = await partesDeLaAcademia(esc.e.A.id);
      expect(partesDespues.pagos).toEqual(partesAntes.pagos);
      expect(partesDespues.caja).toBe(partesAntes.caja);
      expect(await partesDeLaAcademia(esc.e.B.id)).toEqual(bAntes);
    });

    it('criterio 23 (caso límite): una solicitud EN_VERIFICACION, con su matrícula sin vencimiento (RN-28), sigue aceptando la foto días después', async () => {
      const enRevision = await sembrarEnVerificacion(esc.e);
      const tresDiasDespues = new Date(AHORA_007.getTime() + 3 * 24 * 60 * 60 * 1000);
      ctx.reloj.fijar(tresDiasDespues);

      const respuesta = await subir(enRevision.solicitudId, cookieDeUsuario(esc.e.secretariaA, tresDiasDespues));

      expect(respuesta.status, respuesta.texto).toBe(204);
    });
  });

  describe('409 SOLICITUD_NO_EDITABLE', () => {
    const NO_EDITABLES: [string, Partial<OpcionesSembrado>][] = [
      ['la fila VENCIDA (la anterior de un cliente que volvió)', { estado: 'VENCIDA' }],
      ['una solicitud CANCELADA', { estado: 'CANCELADA' }],
      ['una PENDIENTE_PAGO cuya reserva ya venció (se muestra VENCIDA)', { estado: 'PENDIENTE_PAGO_VENCIDA' }],
    ];

    it.each(NO_EDITABLES)(
      'criterio 23: %s responde 409 con { codigo, mensaje }, sin detalles, y no cambia nada',
      async (_nombre, opciones) => {
        const cliente = await sembrar(opciones);
        const antes = await instantaneaDeLaFoto(ctx, esc);

        const respuesta = await subir(cliente.solicitudId);

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([
          409,
          'SOLICITUD_NO_EDITABLE',
        ]);
        expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['codigo', 'mensaje']);
        expect(await claveDe(cliente.alumnoId)).toBeNull();
        expect(archivosBajo(ctx.raiz)).toEqual([]);
        expect(await instantaneaDeLaFoto(ctx, esc)).toBe(antes);
      },
    );

    it('criterio 23: el 409 deja intacta la foto anterior (clave y archivo)', async () => {
      const cliente = await sembrar();
      expect((await subir(cliente.solicitudId)).status).toBe(204);
      const anterior = (await claveDe(cliente.alumnoId)) as string;
      await ejecutarComo(
        'propietario',
        "UPDATE solicitudes_inscripcion SET estado = 'CANCELADA' WHERE academia_id = $1::uuid AND id = $2::uuid",
        [esc.e.A.id, cliente.solicitudId],
        { academiaId: esc.e.A.id },
      );
      await ejecutarComo(
        'propietario',
        "UPDATE matriculas SET estado = 'CANCELADA', reserva_vence_en = NULL WHERE academia_id = $1::uuid AND solicitud_id = $2::uuid",
        [esc.e.A.id, cliente.solicitudId],
        { academiaId: esc.e.A.id },
      );

      const respuesta = await subir(cliente.solicitudId, esc.cookies.secretaria, { cuerpo: png(150, 150) });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(await claveDe(cliente.alumnoId)).toBe(anterior);
      expect(archivosBajo(ctx.raiz)).toEqual([anterior]);
    });

    it('criterio 23 (instante del vencimiento): un milisegundo antes se acepta; en el instante exacto del vencimiento ya es 409', async () => {
      const casi = await sembrar({ reservaVenceEn: new Date(AHORA_007.getTime() + 1) });
      const justo = await sembrar({ reservaVenceEn: new Date(AHORA_007.getTime()) });

      const aceptada = await subir(casi.solicitudId);
      const rechazada = await subir(justo.solicitudId);

      expect(aceptada.status, aceptada.texto).toBe(204);
      expect([rechazada.status, codigoDeRespuesta(rechazada)], rechazada.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(await claveDe(justo.alumnoId)).toBeNull();
    });

    it('criterio 23 (tope del fin de mes): a las 23:59:59.998 del último día del mes en Lima se acepta; a las 23:59:59.999, cuando la reserva ya venció por el tope, 409', async () => {
      const finDelMes = new Date('2026-12-01T04:59:59.999Z');
      const cliente = await sembrar({ reservaVenceEn: finDelMes });
      const cookie = cookieDeUsuario(esc.e.secretariaA, new Date('2026-12-01T04:00:00.000Z'));

      ctx.reloj.fijar(new Date('2026-12-01T04:59:59.998Z'));
      const antes = await subir(cliente.solicitudId, cookie);
      ctx.reloj.fijar(finDelMes);
      const justo = await subir(cliente.solicitudId, cookie);

      expect(antes.status, antes.texto).toBe(204);
      expect([justo.status, codigoDeRespuesta(justo)], justo.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
    });

    it('criterio 23 (caso límite, 21 b de 005): desde la solicitud anterior de un cliente que volvió responde 409; desde la nueva, 204', async () => {
      const anterior = await sembrar({ estado: 'PENDIENTE_PAGO_VENCIDA' });
      const envio = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(esc.e, { sobre: { alumno: { dni: anterior.dni } } }),
      );
      expect(envio.status, envio.texto).toBe(201);
      const codigo = (envio.body?.['solicitud'] as { codigo: string }).codigo;
      const filaNueva = (await leerSolicitudes(esc.e.A.id)).find((fila) => fila.codigo === codigo);
      expect(filaNueva, 'la solicitud nueva debía existir').toBeTruthy();
      expect(filaNueva?.alumno_id).toBe(anterior.alumnoId);

      const conLaAnterior = await subir(anterior.solicitudId);
      const conLaNueva = await subir((filaNueva as { id: string }).id);

      expect([conLaAnterior.status, codigoDeRespuesta(conLaAnterior)], conLaAnterior.texto).toEqual([
        409,
        'SOLICITUD_NO_EDITABLE',
      ]);
      expect(conLaNueva.status, conLaNueva.texto).toBe(204);
      expect(await claveDe(anterior.alumnoId)).toMatch(patronDeClave(esc.e.A.id, anterior.alumnoId));
      expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, anterior.alumnoId)).toHaveLength(1);
    });

    it('criterio 23 (caso límite): un alumno con una solicitud VENCIDA y otra CONFIRMADA: la foto por la vencida responde 409, y por la confirmada o por /api/alumnos/{id}/foto, 204', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);
      const vieja = randomUUID();
      await insertarFila('propietario', 'solicitudes_inscripcion', esc.e.A.id, {
        id: vieja,
        alumno_id: alumno.alumnoId,
        codigo: codigoAleatorio(),
        token_hash: sha256(tokenAleatorio()),
        clave_idempotencia: randomUUID(),
        estado: 'VENCIDA',
        ip_origen: '198.51.100.9',
        creado_en: AHORA_007,
        actualizado_en: AHORA_007,
      });

      const porLaVencida = await subir(vieja);
      const porLaConfirmada = await subir(alumno.solicitudId);
      const porElAlumno = await subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), {
        cookie: esc.cookies.secretaria,
        cuerpo: png(120, 120),
      });

      expect([porLaVencida.status, codigoDeRespuesta(porLaVencida)], porLaVencida.texto).toEqual([
        409,
        'SOLICITUD_NO_EDITABLE',
      ]);
      expect(porLaConfirmada.status, porLaConfirmada.texto).toBe(204);
      expect(porElAlumno.status, porElAlumno.texto).toBe(204);
      expect(archivosDelAlumno(ctx.raiz, esc.e.A.id, alumno.alumnoId)).toHaveLength(1);
    });
  });

  describe('404', () => {
    it('criterio 23: un id que no es UUID, que no existe, de otra academia o de otra tabla responde el mismo 404 NO_ENCONTRADO con el mismo cuerpo, sin el id, y no cambia nada', async () => {
      const alumnoDeA = await crearAlumnoPorPago(ctx, esc);
      const deB = await sembrarSolicitud(esc.e.B.id, {
        planId: esc.e.planB.id,
        claseIds: [esc.e.lunesB.id],
        clasesTotales: 5,
        clasesPorMesPlan: 12,
        precioPlan: '100.00',
        monto: '42.00',
      });
      const confirmadaDeB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });
      const ids = [
        'no-es-un-uuid',
        `${randomUUID()}x`,
        randomUUID(),
        deB.solicitudId,
        confirmadaDeB.solicitudId,
        alumnoDeA.alumnoId,
        deB.alumnoId,
      ];
      const antes = await instantaneaDeLaFoto(ctx, esc);
      const cuerpos = new Set<string>();

      for (const cookie of [esc.cookies.secretaria, esc.cookies.admin]) {
        for (const id of ids) {
          const respuesta = await subir(id, cookie);

          expect([respuesta.status, codigoDeRespuesta(respuesta)], `${id}: ${respuesta.texto.slice(0, 200)}`).toEqual([
            404,
            'NO_ENCONTRADO',
          ]);
          expect(respuesta.texto).not.toContain(id);
          cuerpos.add(sinUuid(respuesta.texto));
        }
      }

      expect(cuerpos.size, 'el mismo cuerpo para todos los casos').toBe(1);
      expect(await instantaneaDeLaFoto(ctx, esc)).toBe(antes);
    });

    it('criterio 23 y 5: la solicitud de A no existe para el personal de B (y al revés), ni con ?academiaId= ni con cabeceras de academia', async () => {
      const deA = await sembrar();
      const alumnoDeA = await crearAlumnoPorPago(ctx, esc);
      const antes = await instantaneaDeLaFoto(ctx, esc);

      const respuestas = [
        await subir(deA.solicitudId, esc.cookies.secretariaB),
        await subir(alumnoDeA.solicitudId, esc.cookies.adminB),
        await subirFotoPanel(ctx, `${rutaFotoSolicitud(deA.solicitudId)}?academiaId=${esc.e.A.id}`, {
          cookie: esc.cookies.secretariaB,
          headers: { 'x-academia-id': esc.e.A.id },
        }),
      ];

      for (const respuesta of respuestas) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
          404,
          'NO_ENCONTRADO',
        ]);
      }
      expect(await instantaneaDeLaFoto(ctx, esc)).toBe(antes);
      const propia = await subirFotoPanel(ctx, `${rutaFotoSolicitud(deA.solicitudId)}?academiaId=${esc.e.B.id}`, {
        cookie: esc.cookies.secretaria,
      });
      expect(propia.status, propia.texto).toBe(204);
      expect(archivosBajo(ctx.raiz).every((archivo) => archivo.startsWith(`academias/${esc.e.A.id}/`))).toBe(true);
    });
  });

  describe('permisos (criterio 24 d)', () => {
    it('criterio 24 d: el entrenador y el alumno reciben 403 SIN_PERMISO en la ruta de la solicitud y no cambian nada', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);
      const cliente = await sembrar();
      const antes = await instantaneaDeLaFoto(ctx, esc);

      const respuestas = [
        await subir(cliente.solicitudId, esc.cookies.entrenador),
        await subir(cliente.solicitudId, alumno.cookie),
        await subir(alumno.solicitudId, alumno.cookie),
        await subir(randomUUID(), esc.cookies.entrenador),
      ];

      for (const respuesta of respuestas) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
          403,
          'SIN_PERMISO',
        ]);
      }
      expect(await instantaneaDeLaFoto(ctx, esc)).toBe(antes);
      expect(await claveDe(cliente.alumnoId)).toBeNull();
    });
  });
});
