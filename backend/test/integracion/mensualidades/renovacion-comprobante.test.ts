// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cerrarCajaDePrueba, enLima, leerMovimientos } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  normalizadoDeReferencia,
  rutaAprobacion,
  rutaRechazo,
  sembrarEnVerificacion,
} from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  CABECERA_DATOS_RENOVACION,
  CLAVES_DE_LA_RENOVACION,
  CLAVES_DE_LA_RESPUESTA,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  datosComprobanteRenovacion,
  detallesDe,
  DICIEMBRE,
  estadoDelAlumno,
  INSTANTES,
  instantaneaDeRenovacion,
  LARGO_MAXIMO_DE_LA_CABECERA,
  MES_DICIEMBRE,
  MES_NOVIEMBRE,
  matriculaDelMes,
  NOVIEMBRE,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovarConComprobante,
  renovacionDe,
  resumen,
  seleccionDeDiciembre,
  type Via,
} from '../../utilidades/escenario-renovacion';
import {
  archivosBajo,
  existeArchivoDeClave,
  FIRMA_JPEG,
  jpeg,
  leerArchivoDeClave,
  metadatosDe,
  png,
} from '../../utilidades/inscripciones-005b';
import { jsonAscii } from '../../utilidades/escenario-pagos-007b';
import { crearAlumnoSolo } from '../../utilidades/inscripciones';
import { crearMatriculaDeApoyo, filaPagoValida, insertarPago, leerPagos } from '../../utilidades/pagos';
import { leerUsuarios } from '../../utilidades/usuarios';

// Criterio 7 (crítico, HU-08, HU-12, RN-04, RN-28, D-04): `PUT /api/alumnos/{id}/renovacion/comprobante`, con la imagen como cuerpo binario (`image/jpeg` o `image/png`) y los datos en la cabecera `X-Renovacion-Datos` (JSON ASCII de hasta 2048 bytes que cumple
// `datosRenovacionComprobanteSchema`, estricto: `{ claveIdempotencia, mes, planId, claseIds, metodo: 'YAPE' | 'TRANSFERENCIA', numeroOperacion, monto, fechaOperacion }`). Crea, en una transacción, la matrícula `RESERVADA` sin vencimiento, sus clases y el pago
// `PENDIENTE_VERIFICACION` con `registrado_por` el actor, el número escrito y el normalizado, la fecha y la clave del comprobante. No toca la caja (D-04) ni el estado del alumno. Responde 201 con `respuestaRenovacionSchema` (`estado: 'EN_VERIFICACION'`).
// Reglas de la 007b: el tipo (400 `IMAGEN_NO_VALIDA`) y el tamaño (413 `CARGA_EXCESIVA`) antes de leer el cuerpo; la cabecera que falta, repetida, de más de 2048 bytes, con bytes fuera de ASCII o que no cumple el esquema, 400 `SOLICITUD_INVALIDA`; la imagen, como el
// criterio 40 de 007 (firma, `sharp`, lados y megapíxeles; 400 `IMAGEN_NO_VALIDA`), recodificada como JPEG de hasta 2000 píxeles sin metadatos y guardada con la clave `academias/{academiaId}/pagos/{pagoId}/comprobante-{uuid}.jpg`; si la transacción rechaza, se
// borra el archivo. `monto` distinto del total: 409 `MONTO_DISTINTO` con `detalles.total`. Número de operación de un pago abierto de la academia con el mismo método (normalizado, DR-9 de 007): 409 `NUMERO_OPERACION_YA_USADO`, también entre una renovación y una
// solicitud. `fechaOperacion` futura o anterior al primer día de la ventana (para M+1) o al día 1 de M (para M): 409 `FECHA_OPERACION_NO_VALIDA` (DR-1).
// Lecturas estrictas elegidas: (1) «abierto» es `PENDIENTE_VERIFICACION` o `CONFIRMADO` (un `RECHAZADO` se puede volver a usar y el otro método y otra academia no cuentan), como en la 007b; (2) «futura» es posterior al día de Lima de «ahora»; (3) el exacto límite de
// 2048 bytes de la cabecera se prueba con espacios dentro del JSON (una cabecera HTTP pierde los espacios del final); (4) el JPEG guardado no lleva EXIF, GPS ni comentarios; (5) la confirmación incierta está en `renovacion-comprobante-incierta.test.ts`.

const MB5 = 5 * 1024 * 1024;
const VIAS_CON_COMPROBANTE: Via[] = ['YAPE', 'TRANSFERENCIA'];

describe('el registro de la renovación con comprobante (criterio 7)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const clasesDeNoviembre = () => [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id].sort();
  const registrar = (
    alumnoId: string,
    via: Via = 'YAPE',
    cookie?: string,
    opciones: Parameters<typeof registrarRenovacion>[5] = {},
  ) => registrarRenovacion(ctx, esc, via, cookie ?? en(ctx, esc, INSTANTES.viernes27).secretaria, alumnoId, opciones);

  describe('el registro correcto', () => {
    it.each(VIAS_CON_COMPROBANTE)(
      'criterio 7: %s: 201 EN_VERIFICACION; matrícula RESERVADA sin vencimiento ni solicitud con sus clases; pago PENDIENTE_VERIFICACION del actor con el número escrito y el normalizado; sin caja, sin cuenta y sin cambiar el estado del alumno',
      async (via) => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const cookies = en(ctx, esc, INSTANTES.viernes27);
        const movimientosAntes = await leerMovimientos(esc.e.A.id);
        const usuariosAntes = (await leerUsuarios(esc.e.A.id)).length;

        const { cuerpo, respuesta } = await registrar(alumno.alumnoId, via, cookies.secretaria, {
          sobre: { numeroOperacion: '  ab-0012 ' },
        });

        const resultado = renovacionDe(respuesta, 201);
        expect(Object.keys(resultado).sort()).toEqual(CLAVES_DE_LA_RESPUESTA);
        expect(Object.keys(resultado.renovacion).sort()).toEqual(CLAVES_DE_LA_RENOVACION);
        expect(resultado.repetida).toBe(false);
        expect(resultado.renovacion).toMatchObject({
          mes: MES_DICIEMBRE,
          estado: 'EN_VERIFICACION',
          fechaInicio: '2026-12-01',
          fechaFin: '2026-12-31',
          clasesTotales: 12,
          total: '120.00',
        });
        expect(resultado.pago).toMatchObject({
          estado: 'PENDIENTE_VERIFICACION',
          metodo: via,
          concepto: 'MENSUALIDAD',
          monto: '120.00',
          numeroOperacion: 'ab-0012',
          fechaOperacion: '2026-11-26',
          verificadoEn: null,
          motivoRechazo: null,
          numeroTicket: null,
        });
        expect(respuesta.texto, 'la respuesta no lleva la clave del archivo').not.toContain('comprobante-');
        expect(respuesta.texto, 'ni el DNI ni el token del QR').not.toContain(alumno.dni);
        expect(respuesta.texto).not.toContain(alumno.token);

        const matricula = await matriculaDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE);
        expect(matricula).toMatchObject({
          id: resultado.renovacion.matriculaId,
          solicitud_id: null,
          estado: 'RESERVADA',
          reserva_vence_en: null,
          plan_id: esc.e.plan.id,
          clases_totales: 12,
          precio_plan: '120.00',
          clases_por_mes_plan: 12,
          monto_calculado: '120.00',
          es_proporcional: false,
        });
        expect(matricula.clases).toEqual(clasesDeNoviembre());
        const pago = (await leerPagos(esc.e.A.id)).find((p) => p.id === resultado.pago.id);
        expect(pago).toMatchObject({
          alumno_id: alumno.alumnoId,
          matricula_id: matricula.id,
          concepto: 'MENSUALIDAD',
          metodo: via,
          estado: 'PENDIENTE_VERIFICACION',
          monto: '120.00',
          numero_operacion: 'ab-0012',
          numero_operacion_normalizado: normalizadoDeReferencia('ab-0012'),
          fecha_operacion: '2026-11-26',
          registrado_por: esc.e.secretariaA.id,
          verificado_por: null,
          verificado_en: null,
          numero_ticket: null,
          clave_idempotencia: cuerpo['claveIdempotencia'],
        });
        expect(pago?.numero_operacion_normalizado).toBe('AB12');
        expect(pago?.comprobante_clave).toMatch(
          new RegExp(
            `^academias/${esc.e.A.id}/pagos/${resultado.pago.id}/comprobante-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.jpg$`,
          ),
        );
        expect(archivosBajo(ctx.raiz)).toEqual([pago?.comprobante_clave]);

        expect(await leerMovimientos(esc.e.A.id), 'no toca la caja (D-04)').toEqual(movimientosAntes);
        expect((await leerUsuarios(esc.e.A.id)).length, 'no crea cuenta').toBe(usuariosAntes);
        expect(await estadoDelAlumno(esc.e.A.id, alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
      },
    );

    it('criterio 7: el comprobante de un ALUMNO_VENCIDO para M (renovación tardía) no cambia su estado: lo cambia la aprobación', async () => {
      const alumno = await crearAlumnoVencido(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.jueves26);

      const { respuesta } = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, {
        seleccion: { mes: MES_NOVIEMBRE },
        total: '20.00',
        fechaOperacion: '2026-11-26',
      });

      expect(renovacionDe(respuesta, 201).renovacion).toMatchObject({
        mes: MES_NOVIEMBRE,
        estado: 'EN_VERIFICACION',
        total: '20.00',
      });
      expect(await estadoDelAlumno(esc.e.A.id, alumno.alumnoId)).toBe('ALUMNO_VENCIDO');
      expect(await matriculaDelMes(esc.e.A.id, alumno.alumnoId, NOVIEMBRE)).toMatchObject({
        estado: 'RESERVADA',
        reserva_vence_en: null,
        es_proporcional: true,
        clases_totales: 2,
      });
    });

    it('criterio 7 y D-04: el comprobante se registra con la caja cerrada o de otro día (el Yape no necesita caja hasta que se verifica)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      await cerrarCajaDePrueba(esc.e.A.id, esc.cajaA, esc.e.secretariaA.id);

      const { respuesta } = await registrar(alumno.alumnoId);

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 7: el archivo guardado es un JPEG de hasta 2000 píxeles sin EXIF, GPS ni comentarios (una foto de 3000 × 1500 con GPS y un texto marcado)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const original = await jpeg(3000, 1500, { gps: true, orientacion: 1, comentario: 'SECRETO-010A' });
      expect(original.includes('SECRETO-010A')).toBe(true);

      const { respuesta } = await registrar(alumno.alumnoId, 'YAPE', undefined, {
        imagen: { cuerpo: original, tipo: 'image/jpeg' },
      });

      const resultado = renovacionDe(respuesta, 201);
      const clave = (await leerPagos(esc.e.A.id)).find((p) => p.id === resultado.pago.id)?.comprobante_clave as string;
      const guardado = leerArchivoDeClave(ctx.raiz, clave);
      const metadatos = await metadatosDe(guardado);
      expect(metadatos.format).toBe('jpeg');
      expect(Math.max(metadatos.width ?? 0, metadatos.height ?? 0)).toBe(2000);
      expect(metadatos.exif, 'sin EXIF').toBeUndefined();
      expect(guardado.includes('SECRETO-010A'), 'sin el comentario').toBe(false);
      expect(guardado.subarray(0, 3).equals(FIRMA_JPEG)).toBe(true);
    });

    it('criterio 7: un PNG se guarda recodificado como JPEG', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);

      const { respuesta } = await registrar(alumno.alumnoId, 'TRANSFERENCIA');

      const resultado = renovacionDe(respuesta, 201);
      const clave = (await leerPagos(esc.e.A.id)).find((p) => p.id === resultado.pago.id)?.comprobante_clave as string;
      expect(clave.endsWith('.jpg')).toBe(true);
      expect((await metadatosDe(leerArchivoDeClave(ctx.raiz, clave))).format).toBe('jpeg');
    });
  });

  describe('la cabecera X-Renovacion-Datos', () => {
    const MALOS: [string, (valido: Record<string, unknown>) => string | string[] | null][] = [
      ['sin la cabecera', () => null],
      ['la cabecera repetida', (v) => [JSON.stringify(v), JSON.stringify(v)]],
      ['un texto que no es JSON', () => 'esto no es json'],
      ['una lista en vez de un objeto', () => '[]'],
      ['un objeto vacío', () => '{}'],
      ['un campo de más (academiaId)', (v) => jsonAscii({ ...v, academiaId: '00000000-0000-4000-8000-000000000000' })],
      ['un campo de más (montoAjustado)', (v) => jsonAscii({ ...v, montoAjustado: '10' })],
      ['un campo de más (alumnoId)', (v) => jsonAscii({ ...v, alumnoId: '00000000-0000-4000-8000-000000000000' })],
      ['el método EFECTIVO', (v) => jsonAscii({ ...v, metodo: 'EFECTIVO' })],
      ['el monto como número', (v) => jsonAscii({ ...v, monto: 120 })],
      ['la clave que no es UUID', (v) => jsonAscii({ ...v, claveIdempotencia: 'no-es-uuid' })],
      ['sin fechaOperacion', (v) => jsonAscii({ ...v, fechaOperacion: undefined })],
      ['sin numeroOperacion', (v) => jsonAscii({ ...v, numeroOperacion: undefined })],
      ['el mes con otro formato', (v) => jsonAscii({ ...v, mes: '12-2026' })],
      ['sin claseIds', (v) => jsonAscii({ ...v, claseIds: undefined })],
      ['el número de operación con símbolos', (v) => jsonAscii({ ...v, numeroOperacion: '12$45' })],
      ['bytes fuera de ASCII (una ñ sin escapar)', (v) => `${JSON.stringify(v).slice(0, -1)},"nota":"ñ"}`],
      [
        'más de 2048 bytes (espacios dentro del JSON)',
        (v) => rellenar(JSON.stringify(v), LARGO_MAXIMO_DE_LA_CABECERA + 1),
      ],
    ];

    function rellenar(json: string, largo: number): string {
      return `{${' '.repeat(largo - json.length)}${json.slice(1)}`;
    }

    it.each(MALOS)(
      'criterio 7: %s: 400 SOLICITUD_INVALIDA, sin escribir ni dejar archivo',
      async (_nombre, estropear) => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const cookies = en(ctx, esc, INSTANTES.viernes27);
        const valido = datosComprobanteRenovacion(seleccionDeDiciembre(esc), '120.00', '2026-11-26');
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const respuesta = await renovarConComprobante(ctx, alumno.alumnoId, {
          cookie: cookies.secretaria,
          datos: estropear(valido),
        });

        expect(resumen(respuesta), respuesta.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
        expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      },
    );

    it('criterio 7 (control): la cabecera de exactamente 2048 bytes con el mismo contenido válido se acepta (201)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const valido = datosComprobanteRenovacion(seleccionDeDiciembre(esc), '120.00', '2026-11-26');
      const json = JSON.stringify(valido);
      const justo = `{${' '.repeat(LARGO_MAXIMO_DE_LA_CABECERA - json.length)}${json.slice(1)}`;
      expect(Buffer.byteLength(justo, 'latin1')).toBe(LARGO_MAXIMO_DE_LA_CABECERA);

      const respuesta = await renovarConComprobante(ctx, alumno.alumnoId, { cookie: cookies.secretaria, datos: justo });

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 7: la cabecera se llama X-Renovacion-Datos: con los mismos datos en X-Pago-Datos (la de la 007b) y sin la nuestra, 400 SOLICITUD_INVALIDA', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const valido = datosComprobanteRenovacion(seleccionDeDiciembre(esc), '120.00', '2026-11-26');
      expect(CABECERA_DATOS_RENOVACION).toBe('x-renovacion-datos');

      const respuesta = await renovarConComprobante(ctx, alumno.alumnoId, {
        cookie: cookies.secretaria,
        datos: null,
        headers: { 'x-pago-datos': jsonAscii(valido) },
      });

      expect(resumen(respuesta), respuesta.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
    });
  });

  describe('la imagen', () => {
    const TIPOS_MALOS: [string, string | null][] = [
      ['sin Content-Type', null],
      ['image/jpg', 'image/jpg'],
      ['image/gif', 'image/gif'],
      ['image/webp', 'image/webp'],
      ['application/json', 'application/json'],
      ['multipart/form-data', 'multipart/form-data; boundary=x'],
      ['text/plain', 'text/plain'],
    ];

    it.each(TIPOS_MALOS)(
      'criterio 7: %s: 400 IMAGEN_NO_VALIDA, sin escribir ni dejar archivo',
      async (_nombre, tipo) => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const cookies = en(ctx, esc, INSTANTES.viernes27);
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const { respuesta } = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, { imagen: { tipo } });

        expect(resumen(respuesta), respuesta.texto).toEqual([400, 'IMAGEN_NO_VALIDA']);
        expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      },
    );

    it('criterio 7: un Content-Encoding distinto de identity: 400 IMAGEN_NO_VALIDA', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);

      const { respuesta } = await registrar(alumno.alumnoId, 'YAPE', undefined, { imagen: { codificacion: 'gzip' } });

      expect(resumen(respuesta), respuesta.texto).toEqual([400, 'IMAGEN_NO_VALIDA']);
    });

    it('criterio 7: más de 5 MiB: 413 CARGA_EXCESIVA (con el cuerpo entero y con Content-Length declarado sin enviarlo); exactamente 5 MiB no es 413 (la imagen es la que no vale: 400)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const antes = await instantaneaDeRenovacion(ctx, esc);
      const enorme = Buffer.concat([FIRMA_JPEG, Buffer.alloc(MB5)]);
      const justo = Buffer.concat([FIRMA_JPEG, Buffer.alloc(MB5 - FIRMA_JPEG.length)]);

      const entero = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, {
        imagen: { cuerpo: enorme, tipo: 'image/jpeg' },
      });
      const declarado = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, {
        imagen: { largoDeclarado: MB5 + 1, plazoMs: 5000 },
      });
      const exacto = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, {
        imagen: { cuerpo: justo, tipo: 'image/jpeg' },
      });

      expect(resumen(entero.respuesta), entero.respuesta.texto).toEqual([413, 'CARGA_EXCESIVA']);
      expect(resumen(declarado.respuesta), declarado.respuesta.texto).toEqual([413, 'CARGA_EXCESIVA']);
      expect(resumen(exacto.respuesta), exacto.respuesta.texto).toEqual([400, 'IMAGEN_NO_VALIDA']);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    it('criterio 7: una imagen que no es una imagen (un texto, una firma sin imagen, lados menores de 100 o mayores de 8000) responde 400 IMAGEN_NO_VALIDA con el mismo cuerpo y no escribe', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const antes = await instantaneaDeRenovacion(ctx, esc);
      const malas = [
        Buffer.from('esto no es una imagen'),
        Buffer.concat([FIRMA_JPEG, Buffer.from('basura')]),
        png(50, 50),
        png(8001, 100, { profundidad: 1 }),
        png(100, 8001, { profundidad: 1 }),
      ];

      const cuerpos: string[] = [];
      for (const cuerpo of malas) {
        const { respuesta } = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, { imagen: { cuerpo } });
        expect(resumen(respuesta), respuesta.texto).toEqual([400, 'IMAGEN_NO_VALIDA']);
        cuerpos.push(respuesta.texto);
      }

      expect(new Set(cuerpos).size, 'el mismo cuerpo para todos los 400').toBe(1);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });
  });

  describe('el monto, la fecha y el número de operación', () => {
    it.each(['119.99', '120.01', '100.00', '20.00'])(
      'criterio 7: monto %s distinto del total (S/ 120.00): 409 MONTO_DISTINTO con detalles.total, sin escribir ni dejar archivo',
      async (monto) => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const cookies = en(ctx, esc, INSTANTES.viernes27);
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const { respuesta } = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, { total: monto });

        expect(resumen(respuesta), respuesta.texto).toEqual([409, 'MONTO_DISTINTO']);
        expect(detallesDe(respuesta)['total']).toBe('120.00');
        expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      },
    );

    it('criterio 7: la fecha de la operación: hoy y el primer día de la ventana (26/11) se aceptan; el 25/11 (antes de la ventana) y mañana, 409 FECHA_OPERACION_NO_VALIDA', async () => {
      const instante = enLima('2026-11-27', '20:00');
      expect(instante.toISOString(), 'es el 28/11 en UTC').toBe('2026-11-28T01:00:00.000Z');
      const cookies = en(ctx, esc, instante);
      const resultados: [string, number, string | undefined][] = [];

      for (const fecha of ['2026-11-25', '2026-11-28', '2026-12-01', '2026-11-26', '2026-11-27']) {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const { respuesta } = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, { fechaOperacion: fecha });
        resultados.push([fecha, respuesta.status, resumen(respuesta)[1]]);
      }

      expect(resultados).toEqual([
        ['2026-11-25', 409, 'FECHA_OPERACION_NO_VALIDA'],
        ['2026-11-28', 409, 'FECHA_OPERACION_NO_VALIDA'],
        ['2026-12-01', 409, 'FECHA_OPERACION_NO_VALIDA'],
        ['2026-11-26', 201, undefined],
        ['2026-11-27', 201, undefined],
      ]);
    });

    it('criterio 7: para M (renovación tardía de noviembre) la fecha no puede ser anterior al día 1 de noviembre: el 31/10 responde 409 y el 1/11 se acepta', async () => {
      const [antes, justo] = [await crearAlumnoVencido(ctx, esc), await crearAlumnoVencido(ctx, esc)];
      const cookies = en(ctx, esc, INSTANTES.jueves26);
      const noviembre = { seleccion: { mes: MES_NOVIEMBRE }, total: '20.00' };

      const tarde = await registrar(antes.alumnoId, 'YAPE', cookies.secretaria, {
        ...noviembre,
        fechaOperacion: '2026-10-31',
      });
      const bien = await registrar(justo.alumnoId, 'YAPE', cookies.secretaria, {
        ...noviembre,
        fechaOperacion: '2026-11-01',
      });

      expect(resumen(tarde.respuesta), tarde.respuesta.texto).toEqual([409, 'FECHA_OPERACION_NO_VALIDA']);
      expect(bien.respuesta.status, bien.respuesta.texto).toBe(201);
    });

    const FORMAS_DE_12345 = ['12345', ' 12 345 ', '00012345', '0001-2345', '1.2345', '１２３４５'];

    it.each(FORMAS_DE_12345)(
      'criterio 7: con "12345" ya en revisión en una solicitud (Yape), una renovación por Yape con %j responde 409 NUMERO_OPERACION_YA_USADO sin escribir ni dejar archivo',
      async (forma) => {
        await sembrarEnVerificacion(esc.e, { numeroOperacion: '12345' });
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const cookies = en(ctx, esc, INSTANTES.viernes27);
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const { respuesta } = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, {
          sobre: { numeroOperacion: forma },
        });

        expect(resumen(respuesta), respuesta.texto).toEqual([409, 'NUMERO_OPERACION_YA_USADO']);
        expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      },
    );

    it('criterio 7: entre dos renovaciones el número se compara normalizado (ab12 frente a AB-12), mismo método: 409; con el otro método o en el otro orden de mayúsculas distintas del mismo número normalizado, también', async () => {
      const [primero, segundo, tercero] = [
        await crearAlumnoDeNoviembre(ctx, esc),
        await crearAlumnoDeNoviembre(ctx, esc),
        await crearAlumnoDeNoviembre(ctx, esc),
      ];
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const uno = await registrar(primero.alumnoId, 'YAPE', cookies.secretaria, { sobre: { numeroOperacion: 'ab12' } });
      const mismo = await registrar(segundo.alumnoId, 'YAPE', cookies.secretaria, {
        sobre: { numeroOperacion: 'AB-12' },
      });
      const otroMetodo = await registrar(tercero.alumnoId, 'TRANSFERENCIA', cookies.secretaria, {
        sobre: { numeroOperacion: 'AB-12' },
      });

      expect(uno.respuesta.status, uno.respuesta.texto).toBe(201);
      expect(resumen(mismo.respuesta), mismo.respuesta.texto).toEqual([409, 'NUMERO_OPERACION_YA_USADO']);
      expect(otroMetodo.respuesta.status, 'el otro método no cuenta (DR-9 de 007)').toBe(201);
    });

    it('criterio 7: una solicitud (Yape) con el número de una renovación en revisión también responde 409 en la 007b: el índice es el mismo', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const renovacion = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, {
        sobre: { numeroOperacion: '777888' },
      });
      expect(renovacion.respuesta.status, renovacion.respuesta.texto).toBe(201);

      const otro = await crearAlumnoDeNoviembre(ctx, esc);
      const choque = await registrar(otro.alumnoId, 'YAPE', cookies.secretaria, {
        sobre: { numeroOperacion: '0777-888' },
      });

      expect(resumen(choque.respuesta), choque.respuesta.texto).toEqual([409, 'NUMERO_OPERACION_YA_USADO']);
    });

    it('criterio 7: el número de un pago RECHAZADO se puede volver a usar (D-07) y el de un pago CONFIRMADO no', async () => {
      const [a, b, c] = [
        await crearAlumnoDeNoviembre(ctx, esc),
        await crearAlumnoDeNoviembre(ctx, esc),
        await crearAlumnoDeNoviembre(ctx, esc),
      ];
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const primera = await registrar(a.alumnoId, 'YAPE', cookies.secretaria, { sobre: { numeroOperacion: '55001' } });
      const pagoA = renovacionDe(primera.respuesta, 201).pago.id;
      const rechazo = await ctx.http.post(
        rutaRechazo(pagoA),
        { motivo: 'La imagen no se lee' },
        { cookie: cookies.secretaria },
      );
      expect(rechazo.status, rechazo.texto).toBe(200);

      const reuso = await registrar(b.alumnoId, 'YAPE', cookies.secretaria, { sobre: { numeroOperacion: '55001' } });
      expect(reuso.respuesta.status, reuso.respuesta.texto).toBe(201);
      const pagoB = renovacionDe(reuso.respuesta, 201).pago.id;
      await abrirCajaPara(esc, INSTANTES.viernes27);
      const aprobacion = await ctx.http.post(rutaAprobacion(pagoB), {}, { cookie: cookies.secretaria });
      expect(aprobacion.status, aprobacion.texto).toBe(200);

      const sobreConfirmado = await registrar(c.alumnoId, 'YAPE', cookies.secretaria, {
        sobre: { numeroOperacion: '55001' },
      });
      expect(resumen(sobreConfirmado.respuesta), sobreConfirmado.respuesta.texto).toEqual([
        409,
        'NUMERO_OPERACION_YA_USADO',
      ]);
    });

    it('criterio 7: dos renovaciones de alumnos distintos con el mismo número a la vez: exactamente una responde 201 y la otra 409 NUMERO_OPERACION_YA_USADO (nunca 500) y queda un solo archivo', async () => {
      const [a, b] = [await crearAlumnoDeNoviembre(ctx, esc), await crearAlumnoDeNoviembre(ctx, esc)];
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const [uno, otro] = await Promise.all([
        registrar(a.alumnoId, 'YAPE', cookies.secretaria, { sobre: { numeroOperacion: '90210' } }),
        registrar(b.alumnoId, 'YAPE', cookies.secretaria, { sobre: { numeroOperacion: '90210' } }),
      ]);

      const respuestas = [uno.respuesta, otro.respuesta];
      expect(respuestas.map((r) => r.status).sort(), respuestas.map((r) => r.texto).join(' | ')).toEqual([201, 409]);
      const perdedora = respuestas.find((r) => r.status === 409);
      expect(perdedora && resumen(perdedora)).toEqual([409, 'NUMERO_OPERACION_YA_USADO']);
      const claves = (await leerPagos(esc.e.A.id)).map((p) => p.comprobante_clave).filter((c) => c !== null);
      expect(archivosBajo(ctx.raiz)).toEqual(claves.map(String).sort());
    });

    it('criterio 7: el número de operación de otra academia no cuenta', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const cookies = en(ctx, esc, INSTANTES.viernes27);
      const alumnoDeB = await crearAlumnoSolo(esc.e.B.id);
      const apoyo = await crearMatriculaDeApoyo(esc.e.B.id, alumnoDeB);
      await insertarPago(
        'propietario',
        esc.e.B.id,
        filaPagoValida(
          esc.e.B.id,
          { alumnoId: alumnoDeB, matriculaId: apoyo.matriculaId },
          { metodo: 'YAPE' },
          {
            numero_operacion: '31415',
            numero_operacion_normalizado: '31415',
          },
        ),
      );

      const { respuesta } = await registrar(alumno.alumnoId, 'YAPE', cookies.secretaria, {
        sobre: { numeroOperacion: '31415' },
      });

      expect(respuesta.status, respuesta.texto).toBe(201);
    });
  });

  describe('la auditoría y el archivo de un rechazo', () => {
    it('criterio 7: un 201 deja el archivo del pago y el rechazo posterior de otro intento no lo toca: solo hay archivos de pagos que existen', async () => {
      const [a, b] = [await crearAlumnoDeNoviembre(ctx, esc), await crearAlumnoDeNoviembre(ctx, esc)];
      const cookies = en(ctx, esc, INSTANTES.viernes27);

      const bien = await registrar(a.alumnoId, 'YAPE', cookies.secretaria);
      const mal = await registrar(b.alumnoId, 'YAPE', cookies.secretaria, { total: '1.00' });

      expect(bien.respuesta.status).toBe(201);
      expect(mal.respuesta.status).toBe(409);
      const claves = (await leerPagos(esc.e.A.id))
        .map((p) => p.comprobante_clave)
        .filter((c): c is string => c !== null);
      expect(archivosBajo(ctx.raiz)).toEqual([...claves].sort());
      for (const clave of claves) expect(existeArchivoDeClave(ctx.raiz, clave)).toBe(true);
      expect(await leerAuditoriaDeAcademia(esc.e.A.id, 'RENOVACION_REGISTRADA')).toHaveLength(1);
    });
  });
});
