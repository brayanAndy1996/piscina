// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  pagosPendientesDe,
  pedirBinario,
  RUTA_PENDIENTES,
  rutaComprobante,
  sembrarEnVerificacion,
} from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  cargarContratosDe010a,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  INSTANTES,
  MES_DICIEMBRE,
  MES_NOVIEMBRE,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
} from '../../utilidades/escenario-renovacion';
import { leerAlumnos } from '../../utilidades/inscripciones';
import { FIRMA_JPEG, jpeg, leerArchivoDeClave } from '../../utilidades/inscripciones-005b';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 14 (crítico, HU-09): `GET /api/pagos/pendientes` lista también los pagos de renovación, con `solicitud: null` y las mismas claves de siempre (DT-10); el orden, el tope de 200 y `mesTerminado` no cambian. `GET /api/pagos/{id}/comprobante` devuelve el de una renovación.
// (La web de `/panel/pagos`, que muestra «Renovación» y el mes en lugar del código de la solicitud, es del criterio 22 y de las pruebas de componentes.)
// Lecturas estrictas elegidas: (1) las claves de un elemento de la bandeja son exactamente las de la 007b (`id`, `metodo`, `monto`, `numeroOperacion`, `fechaOperacion`, `enviadoEn`, `solicitud`, `cliente`, `mes`, `mesTerminado`) y `solicitud` está siempre, con `null` en la renovación;
// (2) el orden es el de la 007b (los más antiguos primero, por la hora en que se subió el comprobante) también cuando se mezclan solicitudes y renovaciones; (3) una renovación en efectivo (`CONFIRMADO`) no aparece; (4) `mesTerminado` mira el mes de la matrícula de la
// renovación frente a hoy en Lima; (5) el comprobante de una renovación se descarga como el de una solicitud: 200, `image/jpeg`, `Cache-Control: no-store` y los mismos bytes que se guardaron.

const CLAVES_DE_UN_ELEMENTO = [
  'cliente',
  'enviadoEn',
  'fechaOperacion',
  'id',
  'mes',
  'mesTerminado',
  'metodo',
  'monto',
  'numeroOperacion',
  'solicitud',
];

describe('la bandeja de verificación con renovaciones (criterio 14)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeRenovacion(ctx);
    await abrirCajaPara(esc, INSTANTES.viernes27);
    cookies = en(ctx, esc, INSTANTES.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const bandeja = async (cookie = cookies.secretaria) => {
    const respuesta = await ctx.http.get(RUTA_PENDIENTES, { cookie });
    expect(respuesta.status, respuesta.texto).toBe(200);
    return pagosPendientesDe(respuesta);
  };

  it('criterio 14: una renovación por Yape aparece con solicitud: null, las mismas claves de siempre, el cliente (alumno), el número y la fecha de la operación, el mes y mesTerminado: false', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
      sobre: { numeroOperacion: '  0098-76 ' },
    });
    const pagoId = renovacionDe(respuesta, 201).pago.id;
    const datos = (await leerAlumnos(esc.e.A.id)).find((a) => a.id === alumno.alumnoId);

    const pagos = await bandeja();

    expect(pagos).toHaveLength(1);
    const [elemento] = pagos;
    expect(Object.keys(elemento ?? {}).sort()).toEqual(CLAVES_DE_UN_ELEMENTO);
    expect(elemento).toMatchObject({
      id: pagoId,
      metodo: 'YAPE',
      monto: '120.00',
      numeroOperacion: '0098-76',
      fechaOperacion: '2026-11-26',
      solicitud: null,
      cliente: { nombres: datos?.nombres, apellidos: datos?.apellidos, dni: alumno.dni },
      mes: MES_DICIEMBRE,
      mesTerminado: false,
    });
    expect(elemento?.enviadoEn).toMatch(/^2026-11-27T15:00:00\.\d{3}Z$/);
    const contratos = await cargarContratosDe010a();
    expect(contratos.pagoPendienteSchema.safeParse(elemento).success, JSON.stringify(elemento)).toBe(true);
  });

  it('criterio 14: una renovación por transferencia también, y una renovación en efectivo (ya confirmada) no aparece', async () => {
    const [porTransferencia, enEfectivo] = [
      await crearAlumnoDeNoviembre(ctx, esc),
      await crearAlumnoDeNoviembre(ctx, esc),
    ];
    const a = await registrarRenovacion(ctx, esc, 'TRANSFERENCIA', cookies.secretaria, porTransferencia.alumnoId);
    const b = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, enEfectivo.alumnoId);
    expect(a.respuesta.status, a.respuesta.texto).toBe(201);
    expect(b.respuesta.status, b.respuesta.texto).toBe(201);

    const pagos = await bandeja();

    expect(pagos.map((p) => [p.metodo, p.solicitud])).toEqual([['TRANSFERENCIA', null]]);
  });

  it('criterio 14: mezcladas con las solicitudes, las renovaciones siguen el mismo orden de siempre (la que se subió antes, primero) y la solicitud conserva su { id, codigo }', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId);
    const renovacion = renovacionDe(respuesta, 201).pago.id;
    const antigua = await sembrarEnVerificacion(esc.e, { registradoEn: new Date('2026-11-20T15:00:00.000Z') });
    const nueva = await sembrarEnVerificacion(esc.e, { registradoEn: new Date('2026-11-28T15:00:00.000Z') });

    const pagos = await bandeja();

    expect(pagos.map((p) => p.id)).toEqual([antigua.pagoId, renovacion, nueva.pagoId]);
    expect(pagos[0]?.solicitud).toEqual({ id: antigua.solicitudId, codigo: antigua.codigo });
    expect(pagos[1]?.solicitud).toBeNull();
    expect(pagos[2]?.solicitud).toEqual({ id: nueva.solicitudId, codigo: nueva.codigo });
  });

  it('criterio 14: mesTerminado de una renovación de noviembre es true el 1/12 (hoy en Lima ya no es noviembre) y el de diciembre sigue en false', async () => {
    const [deNoviembre, deDiciembre] = [await crearAlumnoVencido(ctx, esc), await crearAlumnoDeNoviembre(ctx, esc)];
    const noviembre = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, deNoviembre.alumnoId, {
      seleccion: { mes: MES_NOVIEMBRE },
      total: '20.00',
      fechaOperacion: '2026-11-27',
    });
    // La bandeja desempata por id (un UUID al azar) si dos pagos se registran en el mismo instante: la de diciembre se registra unos segundos después.
    ctx.reloj.fijar(new Date(INSTANTES.viernes27.getTime() + 5_000));
    const diciembre = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, deDiciembre.alumnoId);
    expect(noviembre.respuesta.status, noviembre.respuesta.texto).toBe(201);
    expect(diciembre.respuesta.status, diciembre.respuesta.texto).toBe(201);

    const alDiaSiguiente = en(ctx, esc, INSTANTES.primeroDeDiciembre);
    const pagos = await bandeja(alDiaSiguiente.secretaria);

    expect(pagos.map((p) => [p.mes, p.mesTerminado])).toEqual([
      [MES_NOVIEMBRE, true],
      [MES_DICIEMBRE, false],
    ]);
  });

  describe('el comprobante de una renovación', () => {
    it('criterio 14: GET /api/pagos/{id}/comprobante devuelve la imagen guardada (200, image/jpeg, no-store, los mismos bytes) a la secretaria y al administrador', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId);
      const pagoId = renovacionDe(respuesta, 201).pago.id;
      const clave = (await leerPagos(esc.e.A.id)).find((p) => p.id === pagoId)?.comprobante_clave as string;
      const guardado = leerArchivoDeClave(ctx.raiz, clave);

      for (const cookie of [cookies.secretaria, cookies.admin]) {
        const descarga = await pedirBinario(ctx, 'GET', rutaComprobante(pagoId), cookie);

        expect(descarga.status).toBe(200);
        expect(descarga.headers.get('content-type')).toMatch(/^image\/jpeg/);
        expect(descarga.headers.get('cache-control')).toBe('no-store');
        expect(descarga.cuerpo.equals(guardado)).toBe(true);
        expect(descarga.cuerpo.subarray(0, 3).equals(FIRMA_JPEG)).toBe(true);
      }
    });

    it('criterio 14: el comprobante de una renovación de A no se descarga con la sesión de B (404) ni sin sesión (401), y el de una solicitud sigue funcionando', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId);
      const pagoId = renovacionDe(respuesta, 201).pago.id;
      const cliente = await sembrarEnVerificacion(esc.e);
      await ctx.almacen.guardar(esc.e.A.id, cliente.comprobanteClave, await jpeg(300, 200), 'image/jpeg');

      const deB = await pedirBinario(ctx, 'GET', rutaComprobante(pagoId), cookies.secretariaB);
      const sinSesion = await pedirBinario(ctx, 'GET', rutaComprobante(pagoId));
      const deSolicitud = await pedirBinario(ctx, 'GET', rutaComprobante(cliente.pagoId), cookies.secretaria);

      expect(deB.status).toBe(404);
      expect(sinSesion.status).toBe(401);
      expect(deSolicitud.status).toBe(200);
    });

    it('criterio 14: el entrenador y el alumno no ven la bandeja ni el comprobante de una renovación (403 SIN_PERMISO)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId);
      const pagoId = renovacionDe(respuesta, 201).pago.id;

      for (const cookie of [cookies.entrenador, alumno.cookie]) {
        const lista = await ctx.http.get(RUTA_PENDIENTES, { cookie });
        const imagen = await pedirBinario(ctx, 'GET', rutaComprobante(pagoId), cookie);
        expect(lista.status, lista.texto).toBe(403);
        expect(imagen.status).toBe(403);
      }
    });
  });
});
