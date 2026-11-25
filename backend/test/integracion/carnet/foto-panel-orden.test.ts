// spec: 008-carnet-qr (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conFilaRetenida } from '../../utilidades/carreras';
import {
  type AlumnoConQr,
  type AppCarnet,
  codigoDeRespuesta,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
} from '../../utilidades/escenario-carnet';
import {
  instantaneaDeLaFoto,
  type OpcionesFotoPanel,
  prepararEscenarioFotoPanel,
  rutaFotoAlumno,
  rutaFotoSolicitud,
  sembrarCliente,
  subirFotoPanel,
} from '../../utilidades/escenario-foto-panel';
import { AHORA_007 } from '../../utilidades/escenario-pagos';
import type { RespuestaApi, SolicitudSembrada } from '../../utilidades/inscripciones';
import { archivosBajo, FIRMA_JPEG, FIRMA_PNG, fotoClaveDe, jpeg, png } from '../../utilidades/inscripciones-005b';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, contarAuditoria, fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 24 (crítico, sección 2.1, criterio 34 de 005, criterios 74 y 75 de 001): orden de las comprobaciones de la foto del panel, para `PUT /api/alumnos/{id}/foto` y `PUT /api/solicitudes/{id}/foto`. La primera que falla decide:
// (a) sesión, 401 `NO_AUTENTICADO`; (b) academia suspendida, 403 `ACADEMIA_SUSPENDIDA`; (c) cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; (d) permiso, 403 `SIN_PERMISO` (`ALUMNO`, `ENTRENADOR`); (e) tipo y codificación, 400
// `IMAGEN_NO_VALIDA` (las reglas del criterio 34 b de 005); (f) tamaño, 413 `CARGA_EXCESIVA` (más de `FOTO_TAMANO_MAXIMO`; exactamente 5 242 880 bytes sigue); (g) actor vigente, 401; (h) el 404 de los criterios 5 o 23; (i) el 409 del criterio 23;
// (j) la imagen, 400 `IMAGEN_NO_VALIDA` (criterio 34 g de 005: firma, decodificación, lados de 100 a 8000 y 40 megapíxeles). Con (a) a (d) la API responde sin leer el cuerpo: una petición que declara 5 MB y no los envía recibe su 401 o 403 sin esperar.
// Ningún rechazo cambia `foto_clave`, deja un archivo nuevo en el almacén ni audita. (Que estas rutas no cuentan en `LIMITES_PUBLICOS` está en `foto-panel-limites.test.ts`.)
// Lecturas estrictas elegidas: «sin esperar» es una petición con `Content-Length` de exactamente 5 MB y un cuerpo de unos cientos de bytes, con un plazo de 5 s; los 400 de (e) y de (j) tienen el mismo cuerpo `{ codigo, mensaje }` sin detalles
// (criterio 34 de 005); el 401 de (g) llega también cuando el actor se desactiva o cambia su versión de token mientras la petición espera el bloqueo de su fila (criterio 56 de 002).

const MB5 = 5 * 1024 * 1024;
const SIN_ESPERAR = { largoDeclarado: MB5, plazoMs: 5000 } as const;

type Cual = 'alumno' | 'solicitud';
const CUALES: readonly Cual[] = ['alumno', 'solicitud'];

describe('orden de las comprobaciones de la foto del panel (criterio 24)', () => {
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

  /** La dirección de la foto de un objetivo válido: el alumno ya confirmado o la solicitud del cliente. */
  const valida = (cual: Cual): string =>
    cual === 'alumno' ? rutaFotoAlumno(alumno.alumnoId) : rutaFotoSolicitud(cliente.solicitudId);
  /** Una dirección con un id que no existe. */
  const inexistente = (cual: Cual): string =>
    cual === 'alumno' ? rutaFotoAlumno(randomUUID()) : rutaFotoSolicitud(randomUUID());
  const subir = (ruta: string, cookie: string | undefined, extra: OpcionesFotoPanel = {}): Promise<RespuestaApi> =>
    subirFotoPanel(ctx, ruta, { cookie, ...extra });
  const claveDe = (cual: Cual) => fotoClaveDe(esc.e.A.id, cual === 'alumno' ? alumno.alumnoId : cliente.alumnoId);

  /** Una lista de intentos que deben dar la misma respuesta y no cambiar nada (ni la base, ni los archivos, ni la auditoría). */
  async function rechazados(
    intentos: readonly (readonly [string, () => Promise<RespuestaApi>])[],
    esperado: [number, string],
  ): Promise<string[]> {
    const antes = await instantaneaDeLaFoto(ctx, esc);
    const cuerpos: string[] = [];
    for (const [descripcion, hacer] of intentos) {
      const respuesta = await hacer();
      expect(
        [respuesta.status, codigoDeRespuesta(respuesta)],
        `${descripcion}: ${respuesta.texto.slice(0, 200)}`,
      ).toEqual(esperado);
      cuerpos.push(respuesta.texto);
    }
    expect(await instantaneaDeLaFoto(ctx, esc), 'un rechazo cambió la base, un archivo o la auditoría').toBe(antes);
    return cuerpos;
  }

  describe.each(CUALES)('ruta de la %s: (a) a (d) responden sin leer el cuerpo', (cual) => {
    it('(a) sin sesión, con la sesión del Superadmin o con una cookie rota: 401 NO_AUTENTICADO sin esperar el cuerpo, antes que el tipo, el tamaño, el id y la imagen', async () => {
      const superadmin = cookieDeSesion(esc.e.superadmin, AHORA_007);
      const sesiones: [string, string | undefined][] = [
        ['sin sesión', undefined],
        ['Superadmin', superadmin],
        ['cookie rota', 'aq_sesion=no-es-un-token'],
      ];
      const intentos = sesiones.flatMap(([nombre, cookie]) => [
        [`${nombre}, 5 MB declarados`, () => subir(valida(cual), cookie, SIN_ESPERAR)] as const,
        [`${nombre}, tipo malo`, () => subir(valida(cual), cookie, { ...SIN_ESPERAR, tipo: 'image/gif' })] as const,
        [`${nombre}, id inexistente`, () => subir(inexistente(cual), cookie, SIN_ESPERAR)] as const,
        [
          `${nombre}, cuerpo real de 6 MB`,
          () => subir(valida(cual), cookie, { cuerpo: Buffer.concat([FIRMA_JPEG, Buffer.alloc(6 * 1024 * 1024)]) }),
        ] as const,
      ]);

      await rechazados(intentos, [401, 'NO_AUTENTICADO']);
    });

    it('(b) con la academia suspendida: 403 ACADEMIA_SUSPENDIDA sin esperar el cuerpo, para todos los roles y antes que el cambio de contraseña, el permiso, el tipo y el tamaño', async () => {
      await fijarEstadoDeAcademia(esc.e.A.id, 'SUSPENDIDA');
      await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });
      const cookies = [esc.cookies.admin, esc.cookies.secretaria, esc.cookies.entrenador, alumno.cookie];
      const intentos = cookies.flatMap((cookie, i) => [
        [`rol ${i}, 5 MB declarados`, () => subir(valida(cual), cookie, SIN_ESPERAR)] as const,
        [`rol ${i}, tipo malo`, () => subir(valida(cual), cookie, { ...SIN_ESPERAR, tipo: 'image/gif' })] as const,
      ]);

      await rechazados(intentos, [403, 'ACADEMIA_SUSPENDIDA']);
    });

    it('(c) con el cambio de contraseña pendiente: 403 CAMBIO_DE_CLAVE_OBLIGATORIO sin esperar el cuerpo, antes que el permiso, el tipo y el tamaño', async () => {
      await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(esc.e.A.id, esc.e.entrenadorA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(esc.e.A.id, alumno.usuarioId, { debe_cambiar_clave: true });
      const cookies = [esc.cookies.secretaria, esc.cookies.entrenador, alumno.cookie];
      const intentos = cookies.flatMap((cookie, i) => [
        [`rol ${i}, 5 MB declarados`, () => subir(valida(cual), cookie, SIN_ESPERAR)] as const,
        [`rol ${i}, tipo malo`, () => subir(valida(cual), cookie, { ...SIN_ESPERAR, tipo: 'image/gif' })] as const,
        [`rol ${i}, id inexistente`, () => subir(inexistente(cual), cookie, SIN_ESPERAR)] as const,
      ]);

      await rechazados(intentos, [403, 'CAMBIO_DE_CLAVE_OBLIGATORIO']);
    });

    it('(d) el entrenador y el alumno: 403 SIN_PERMISO sin leer el cuerpo, antes que el tipo, el tamaño, el id y la imagen; también con un cuerpo real de 6 MB', async () => {
      const cookies = [esc.cookies.entrenador, alumno.cookie];
      const enorme = Buffer.concat([FIRMA_JPEG, Buffer.alloc(6 * 1024 * 1024)]);
      const intentos = cookies.flatMap((cookie, i) => [
        [`rol ${i}, 5 MB declarados`, () => subir(valida(cual), cookie, SIN_ESPERAR)] as const,
        [`rol ${i}, tipo malo`, () => subir(valida(cual), cookie, { ...SIN_ESPERAR, tipo: 'image/gif' })] as const,
        [`rol ${i}, sin tipo`, () => subir(valida(cual), cookie, { ...SIN_ESPERAR, tipo: null })] as const,
        [`rol ${i}, id inexistente`, () => subir(inexistente(cual), cookie, SIN_ESPERAR)] as const,
        [
          `rol ${i}, id que no es UUID`,
          () => subir(valida(cual).replace(/[0-9a-f-]{36}/, 'no-es-uuid'), cookie, SIN_ESPERAR),
        ] as const,
        [
          `rol ${i}, cuerpo real de 6 MB`,
          () => subir(valida(cual), cookie, { cuerpo: enorme, tipo: 'image/jpeg' }),
        ] as const,
        [
          `rol ${i}, un texto como imagen`,
          () => subir(valida(cual), cookie, { cuerpo: Buffer.from('basura') }),
        ] as const,
      ]);

      await rechazados(intentos, [403, 'SIN_PERMISO']);
    });
  });

  describe.each(CUALES)('ruta de la %s: (e) tipo y codificación', (cual) => {
    const TIPOS_MALOS: [string, string | null][] = [
      ['sin Content-Type', null],
      ['image/jpg', 'image/jpg'],
      ['image/gif', 'image/gif'],
      ['image/webp', 'image/webp'],
      ['image/svg+xml', 'image/svg+xml'],
      ['application/octet-stream', 'application/octet-stream'],
      ['application/json', 'application/json'],
      ['multipart/form-data', 'multipart/form-data; boundary=x'],
      ['text/plain', 'text/plain'],
    ];
    const CODIFICACIONES_MALAS = ['gzip', 'deflate', 'br', 'gzip, br', '', 'compress'];

    it('400 IMAGEN_NO_VALIDA con un tipo que no es image/jpeg ni image/png, con el mismo cuerpo, y no cambia nada', async () => {
      const cuerpos = await rechazados(
        TIPOS_MALOS.map(
          ([nombre, tipo]) => [nombre, () => subir(valida(cual), esc.cookies.secretaria, { tipo })] as const,
        ),
        [400, 'IMAGEN_NO_VALIDA'],
      );

      expect(new Set(cuerpos).size, 'el mismo cuerpo para todos los 400').toBe(1);
    });

    it('400 IMAGEN_NO_VALIDA con un Content-Encoding distinto de identity, y no cambia nada', async () => {
      await rechazados(
        CODIFICACIONES_MALAS.map(
          (codificacion) =>
            [
              `Content-Encoding "${codificacion}"`,
              () => subir(valida(cual), esc.cookies.secretaria, { codificacion }),
            ] as const,
        ),
        [400, 'IMAGEN_NO_VALIDA'],
      );
    });

    it('el tipo se decide antes que el id, que el tamaño y que la imagen: un id inexistente, 6 MB o un cuerpo que no es imagen con un tipo malo responden 400, no 404 ni 413', async () => {
      const enorme = Buffer.concat([FIRMA_JPEG, Buffer.alloc(6 * 1024 * 1024)]);

      await rechazados(
        [
          ['id inexistente', () => subir(inexistente(cual), esc.cookies.secretaria, { tipo: 'image/gif' })],
          [
            'id que no es UUID',
            () => subir(valida(cual).replace(/[0-9a-f-]{36}/, 'x'), esc.cookies.secretaria, { tipo: 'image/gif' }),
          ],
          ['6 MB reales', () => subir(valida(cual), esc.cookies.secretaria, { cuerpo: enorme, tipo: 'image/gif' })],
          [
            'Content-Length de 6 MB',
            () =>
              subir(valida(cual), esc.cookies.secretaria, {
                largoDeclarado: 6 * 1024 * 1024,
                plazoMs: 8000,
                tipo: 'image/gif',
              }),
          ],
          [
            'un texto',
            () => subir(valida(cual), esc.cookies.secretaria, { cuerpo: Buffer.from('hola'), tipo: 'text/plain' }),
          ],
        ],
        [400, 'IMAGEN_NO_VALIDA'],
      );
    });

    it('el tipo con parámetros, con mayúsculas o con espacios, y Content-Encoding identity en cualquier forma, siguen a las demás comprobaciones: 204', async () => {
      const variantes: OpcionesFotoPanel[] = [
        { tipo: 'Image/PNG; charset=binary' },
        { tipo: 'IMAGE/PNG' },
        { tipo: ' image/png ' },
        { tipo: 'image/png', codificacion: 'identity' },
        { tipo: 'image/png', codificacion: 'IDENTITY' },
        { tipo: 'image/png', codificacion: ' Identity ' },
      ];

      for (const variante of variantes) {
        const respuesta = await subir(valida(cual), esc.cookies.secretaria, variante);
        expect(respuesta.status, `${JSON.stringify(variante)}: ${respuesta.texto}`).toBe(204);
      }
    });
  });

  describe.each(CUALES)('ruta de la %s: (f) tamaño', (cual) => {
    it('5 242 881 bytes (con Content-Length) responden 413 CARGA_EXCESIVA y no cambian nada', async () => {
      const cuerpo = Buffer.concat([FIRMA_JPEG, Buffer.alloc(MB5 + 1 - FIRMA_JPEG.length)]);

      await rechazados(
        [['5 242 881 bytes', () => subir(valida(cual), esc.cookies.secretaria, { cuerpo, tipo: 'image/jpeg' })]],
        [413, 'CARGA_EXCESIVA'],
      );
    });

    it('un Content-Length de 6 MB responde 413 sin leer el cuerpo (la respuesta llega aunque el cuerpo nunca se envíe), y sin Content-Length el cuerpo que pasa de 5 MB se corta con 413', async () => {
      const troceado = Buffer.concat([FIRMA_JPEG, Buffer.alloc(6 * 1024 * 1024)]);

      await rechazados(
        [
          [
            'Content-Length de 6 MB',
            () =>
              subir(valida(cual), esc.cookies.secretaria, {
                cuerpo: Buffer.from(FIRMA_PNG),
                largoDeclarado: 6 * 1024 * 1024,
                plazoMs: 8000,
              }),
          ],
          [
            'cuerpo troceado de 6 MB',
            () => subir(valida(cual), esc.cookies.secretaria, { cuerpo: troceado, tipo: 'image/jpeg', troceado: true }),
          ],
        ],
        [413, 'CARGA_EXCESIVA'],
      );
    });

    it('el tamaño se decide antes que el id: un id inexistente o que no es UUID con un Content-Length de 6 MB responde 413, no 404', async () => {
      await rechazados(
        [
          [
            'id inexistente',
            () =>
              subir(inexistente(cual), esc.cookies.secretaria, {
                cuerpo: Buffer.alloc(8),
                largoDeclarado: 6 * 1024 * 1024,
                plazoMs: 8000,
              }),
          ],
          [
            'id que no es UUID',
            () =>
              subir(valida(cual).replace(/[0-9a-f-]{36}/, 'x'), esc.cookies.secretaria, {
                cuerpo: Buffer.alloc(8),
                largoDeclarado: 6 * 1024 * 1024,
                plazoMs: 8000,
              }),
          ],
        ],
        [413, 'CARGA_EXCESIVA'],
      );
    });

    it('un cuerpo de 5 242 880 bytes exactos no se rechaza por tamaño: sigue a las demás comprobaciones (400 IMAGEN_NO_VALIDA con un objetivo válido; 404 con un id inexistente)', async () => {
      const cuerpo = Buffer.concat([FIRMA_JPEG, Buffer.alloc(MB5 - FIRMA_JPEG.length)]);
      expect(cuerpo.length).toBe(5_242_880);

      await rechazados(
        [
          [
            '5 242 880 exactos, objetivo válido',
            () => subir(valida(cual), esc.cookies.secretaria, { cuerpo, tipo: 'image/jpeg' }),
          ],
        ],
        [400, 'IMAGEN_NO_VALIDA'],
      );
      await rechazados(
        [
          [
            '5 242 880 exactos, id inexistente',
            () => subir(inexistente(cual), esc.cookies.secretaria, { cuerpo, tipo: 'image/jpeg' }),
          ],
        ],
        [404, 'NO_ENCONTRADO'],
      );
    });
  });

  describe.each(CUALES)('ruta de la %s: (g) actor vigente', (cual) => {
    it.each(['desactivar', 'solo-version'] as const)(
      'la secretaria cambia (%s) mientras la petición espera el bloqueo de su fila: 401 NO_AUTENTICADO, sin archivo nuevo, sin cambios y sin auditoría',
      async (cambio) => {
        const auditoriaAntes = await contarAuditoria(esc.e.A.id);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: esc.e.A.id,
          actorId: esc.e.secretariaA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => subir(valida(cual), esc.cookies.secretaria),
        });

        expect(esperoElBloqueo, 'la subida debía esperar el bloqueo de la fila del actor (bloquearActorVigente)').toBe(
          true,
        );
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto).toEqual([401, 'NO_AUTENTICADO']);
        expect(await claveDe(cual)).toBeNull();
        expect(archivosBajo(ctx.raiz)).toEqual([]);
        expect(await contarAuditoria(esc.e.A.id), 'una subida rechazada no audita').toBe(auditoriaAntes);
      },
    );
  });

  describe('(h), (i) y (j): el 404, el 409 y la imagen, en ese orden', () => {
    it('(h) un id que no existe con un cuerpo que no es una imagen responde 404, no 400, en las dos rutas', async () => {
      await rechazados(
        [
          [
            'alumno inexistente',
            () => subir(inexistente('alumno'), esc.cookies.secretaria, { cuerpo: Buffer.from('basura') }),
          ],
          [
            'solicitud inexistente',
            () => subir(inexistente('solicitud'), esc.cookies.secretaria, { cuerpo: Buffer.from('basura') }),
          ],
          [
            'cliente en /api/alumnos',
            () => subir(rutaFotoAlumno(cliente.alumnoId), esc.cookies.secretaria, { cuerpo: Buffer.from('basura') }),
          ],
        ],
        [404, 'NO_ENCONTRADO'],
      );
    });

    it('(i) una solicitud CANCELADA o VENCIDA con un cuerpo que no es una imagen responde 409 SOLICITUD_NO_EDITABLE, no 400', async () => {
      const cancelada = await sembrarCliente(esc, { estado: 'CANCELADA' });
      const vencida = await sembrarCliente(esc, { estado: 'PENDIENTE_PAGO_VENCIDA' });

      await rechazados(
        [
          [
            'cancelada con basura',
            () =>
              subir(rutaFotoSolicitud(cancelada.solicitudId), esc.cookies.secretaria, {
                cuerpo: Buffer.from('basura'),
              }),
          ],
          [
            'vencida con una imagen de 99 × 99',
            () => subir(rutaFotoSolicitud(vencida.solicitudId), esc.cookies.secretaria, { cuerpo: png(99, 99) }),
          ],
        ],
        [409, 'SOLICITUD_NO_EDITABLE'],
      );
    });

    const RECHAZADAS: [string, () => { cuerpo: Buffer; tipo: string } | Promise<{ cuerpo: Buffer; tipo: string }>][] = [
      ['el cuerpo vacío', () => ({ cuerpo: Buffer.alloc(0), tipo: 'image/png' })],
      ['un PNG enviado como image/jpeg', () => ({ cuerpo: png(100, 100), tipo: 'image/jpeg' })],
      ['un JPEG enviado como image/png', async () => ({ cuerpo: await jpeg(200, 200), tipo: 'image/png' })],
      [
        'bytes con la firma de JPEG que no son una imagen',
        () => ({ cuerpo: Buffer.concat([FIRMA_JPEG, Buffer.alloc(200, 7)]), tipo: 'image/jpeg' }),
      ],
      [
        'bytes con la firma de PNG que no son una imagen',
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

    it.each(CUALES)(
      '(j) en la ruta de la %s, una imagen que no sirve responde 400 IMAGEN_NO_VALIDA con el mismo cuerpo, también tras la foto anterior, que queda intacta',
      async (cual) => {
        expect((await subir(valida(cual), esc.cookies.secretaria)).status).toBe(204);
        const anterior = await claveDe(cual);
        const intentos: (readonly [string, () => Promise<RespuestaApi>])[] = [];
        for (const [nombre, armar] of RECHAZADAS) {
          const { cuerpo, tipo } = await armar();
          intentos.push([nombre, () => subir(valida(cual), esc.cookies.secretaria, { cuerpo, tipo })] as const);
        }

        const cuerpos = await rechazados(intentos, [400, 'IMAGEN_NO_VALIDA']);

        expect(new Set(cuerpos).size, 'todos los 400 tienen el mismo cuerpo').toBe(1);
        expect(Object.keys(JSON.parse(cuerpos[0] as string) as object).sort()).toEqual(['codigo', 'mensaje']);
        expect(await claveDe(cual)).toBe(anterior);
      },
    );

    const ACEPTADAS: [string, () => { cuerpo: Buffer; tipo: string } | Promise<{ cuerpo: Buffer; tipo: string }>][] = [
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

    it.each(ACEPTADAS)('(j) %s se acepta (204), en las dos rutas', async (_nombre, armar) => {
      const { cuerpo, tipo } = await armar();

      for (const cual of CUALES) {
        const respuesta = await subir(valida(cual), esc.cookies.secretaria, { cuerpo, tipo });
        expect(respuesta.status, `${cual}: ${respuesta.texto}`).toBe(204);
      }
    });
  });
});
