// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { urlAppPruebas } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  ACCION_RENOVACION,
  cuantasDelMes,
  crearAlumnoDeNoviembre,
  DICIEMBRE,
  INSTANTES,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
  resumen,
} from '../../utilidades/escenario-renovacion';
import { leerMatriculas } from '../../utilidades/inscripciones';
import { AlmacenDeFallosDePrueba, archivosBajo, existeArchivoDeClave } from '../../utilidades/inscripciones-005b';
import { leerPagos } from '../../utilidades/pagos';
import { conUrlDeAppEnElProxy, INSERTA_PAGO, type ModoDeCorte, ProxyPostgres } from '../../utilidades/proxy-postgres';

// Criterio 7, parte de la confirmación incierta (crítico, HU-08, RN-28; criterios 61 y 64 de 005, criterio 40 de 007): la transacción de escritura del comprobante de la renovación puede fallar con el `COMMIT` ya aplicado en la base (la conexión se corta
// después de que PostgreSQL confirma y antes de que la respuesta llegue a la API). El servicio no borra el archivo nuevo sin mirar: relee `comprobante_clave` del pago con `FOR SHARE` y espera máxima de 5 s, y decide con lo que ve. Invariante: después de
// cualquier registro, toda `comprobante_clave` apunta a un archivo que existe y todo archivo del almacén es de un pago.
// Pruebas deterministas con el proxy TCP de `proxy-postgres.ts`, que corta la conexión en un punto exacto del protocolo (la sentencia que marca la transacción es el `INSERT` en `pagos`).
//   a) cortarTrasCommit: la base confirmó y la API no se entera: 201 (como la 007b), la matrícula, el pago y la auditoría `RENOVACION_REGISTRADA` existen y el archivo se conserva;
//   b) cortarAntesDelCommit: la base revierte: 500 `ERROR_INTERNO` (como la 007b), no queda matrícula, pago ni auditoría y el archivo nuevo se borra;
//   c) un reintento con la misma clave después de a) responde 200 con `repetida: true`, sin otra matrícula, otro pago ni otro archivo.
// Lectura estricta elegida: las respuestas de a) y b) son las de la 007b (201 y 500 `ERROR_INTERNO`), porque la spec manda seguir «el criterio 61 de 005» y esa es su decisión.

describe('la confirmación incierta del comprobante de la renovación (criterio 7)', () => {
  let proxy: ProxyPostgres | undefined;
  let ctx: AppCarnet | undefined;
  let fallos: AlmacenDeFallosDePrueba | undefined;
  let esc: EscenarioDeAsistencia;

  const banco = () => {
    if (!proxy || !ctx || !fallos) throw new Error('La aplicación de la prueba no se levantó.');
    return { proxy, ctx, fallos };
  };

  beforeAll(async () => {
    proxy = await ProxyPostgres.iniciar(urlAppPruebas(), { marca: INSERTA_PAGO });
    try {
      ctx = await conUrlDeAppEnElProxy(proxy, () =>
        crearAppCarnet({
          envolverAlmacen: (real) => {
            fallos = new AlmacenDeFallosDePrueba(real);
            return fallos;
          },
        }),
      );
      if (!fallos) throw new Error('No se pudo envolver el almacén de la prueba.');
    } catch (error) {
      await ctx?.cerrarTodo().catch(() => undefined);
      await proxy.cerrar();
      throw error;
    }
  });
  beforeEach(async () => {
    const b = banco();
    b.proxy.restablecer();
    b.proxy.reiniciarContador();
    b.fallos.alGuardar = undefined;
    esc = await prepararEscenarioDeRenovacion(b.ctx);
    b.fallos.llamadas.length = 0;
  });
  afterAll(async () => {
    try {
      await ctx?.cerrarTodo();
    } finally {
      await proxy?.cerrar();
    }
  });

  /** Arma el proxy desde `guardar` del almacén: después de las comprobaciones previas y antes de la transacción de escritura. */
  const armarAlGuardar = (modo: ModoDeCorte) => {
    banco().fallos.alGuardar = () => {
      banco().proxy.armar(modo);
      return Promise.resolve();
    };
  };

  async function comprobarInvariante(): Promise<void> {
    const claves = (await leerPagos(esc.e.A.id)).map((p) => p.comprobante_clave).filter((c): c is string => c !== null);
    for (const clave of claves) {
      expect(existeArchivoDeClave(banco().ctx.raiz, clave), `comprobante_clave sin archivo: ${clave}`).toBe(true);
    }
    expect(archivosBajo(banco().ctx.raiz), 'hay archivos huérfanos o faltan archivos').toEqual([...claves].sort());
  }

  const registrar = async (alumnoId: string, sobre: Parameters<typeof registrarRenovacion>[5] = {}) => {
    const cookies = en(banco().ctx, esc, INSTANTES.viernes27);
    return registrarRenovacion(banco().ctx, esc, 'YAPE', cookies.secretaria, alumnoId, {
      ...sobre,
      imagen: { plazoMs: 25_000, ...sobre.imagen },
    });
  };

  it('criterio 7 (61 b1): cortarTrasCommit: la base confirmó y la API no se entera: responde 201, la matrícula, el pago y la auditoría existen y el archivo se conserva', async () => {
    const alumno = await crearAlumnoDeNoviembre(banco().ctx, esc);
    armarAlGuardar('cortarTrasCommit');

    const { respuesta } = await registrar(alumno.alumnoId);
    banco().proxy.desarmar();

    expect(banco().proxy.cortes, 'el proxy debía cortar una vez en el COMMIT').toBe(1);
    expect(respuesta.status, respuesta.texto).toBe(201);
    expect(renovacionDe(respuesta, 201).renovacion).toMatchObject({ mes: '2026-12', estado: 'EN_VERIFICACION' });
    const pagos = (await leerPagos(esc.e.A.id)).filter((p) => p.estado === 'PENDIENTE_VERIFICACION');
    expect(pagos).toHaveLength(1);
    expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
    expect(await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION)).toHaveLength(1);
    await comprobarInvariante();
  });

  it('criterio 7 (61 b2): cortarAntesDelCommit: la base revierte: 500 ERROR_INTERNO, no queda matrícula, pago ni auditoría y el archivo nuevo se borra', async () => {
    const alumno = await crearAlumnoDeNoviembre(banco().ctx, esc);
    const matriculasAntes = (await leerMatriculas(esc.e.A.id)).length;
    armarAlGuardar('cortarAntesDelCommit');

    const { respuesta } = await registrar(alumno.alumnoId);
    banco().proxy.desarmar();

    expect(banco().proxy.cortes, 'el proxy debía cortar una vez antes del COMMIT').toBe(1);
    expect(resumen(respuesta), respuesta.texto).toEqual([500, 'ERROR_INTERNO']);
    expect((await leerPagos(esc.e.A.id)).filter((p) => p.estado === 'PENDIENTE_VERIFICACION')).toEqual([]);
    expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(0);
    expect((await leerMatriculas(esc.e.A.id)).length).toBe(matriculasAntes);
    expect(await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION)).toEqual([]);
    await comprobarInvariante();
  });

  it('criterio 7 y 12: después de una confirmación incierta, el reintento con la misma clave responde 200 repetida, sin otra matrícula, otro pago ni otro archivo', async () => {
    const alumno = await crearAlumnoDeNoviembre(banco().ctx, esc);
    armarAlGuardar('cortarTrasCommit');
    const primero = await registrar(alumno.alumnoId);
    banco().proxy.desarmar();
    expect(primero.respuesta.status, primero.respuesta.texto).toBe(201);
    const pagosAntes = await leerPagos(esc.e.A.id);

    const cookies = en(banco().ctx, esc, INSTANTES.viernes27);
    const reintento = await registrarRenovacion(banco().ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
      sobre: {
        claveIdempotencia: primero.cuerpo['claveIdempotencia'],
        numeroOperacion: primero.cuerpo['numeroOperacion'],
      },
      imagen: { plazoMs: 25_000 },
    });

    const resultado = renovacionDe(reintento.respuesta, 200);
    expect(resultado.repetida).toBe(true);
    expect(await leerPagos(esc.e.A.id)).toEqual(pagosAntes);
    expect(await cuantasDelMes(esc.e.A.id, alumno.alumnoId, DICIEMBRE)).toBe(1);
    expect(await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION)).toHaveLength(1);
    await comprobarInvariante();
  });
});
