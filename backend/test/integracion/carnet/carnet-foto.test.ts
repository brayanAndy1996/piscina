// spec: 008-carnet-qr (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlmacenObservableDePrueba,
  type AppCarnet,
  cambiarAlumno,
  carnetDe,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
  prepararEscenarioDelCarnet,
  RUTA_MI_CARNET,
  rutaCarnet,
} from '../../utilidades/escenario-carnet';
import { jpeg, lineasJson } from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';

// Criterio 9 (crítico, D-24, D-21, D-23): si `alumnos.foto_clave` es nula, `foto` es `null` y la web y el PDF muestran «Foto pendiente». Si no, `foto` es `data:image/jpeg;base64,…` con los bytes del archivo guardado, leído con `AlmacenArchivos.leer`
// y la academia de la sesión, fuera de toda transacción (DT-6). Si el archivo no se puede leer, `foto` es `null` y queda un `warn` `'No se pudo leer la foto del alumno'` con la academia y `error: { tipo }`, sin la clave ni la ruta; la respuesta sigue
// siendo 200. Prueba: una `foto_clave` que apunta a la carpeta de otra academia (escrita como dueño) da `foto: null` y no devuelve los bytes de ese archivo.
// Va en su propio archivo, con una sola aplicación y la primera del proceso: el registro técnico de pino (nivel y redacción) es global del proceso y lo fija la primera aplicación que se crea.
// Lectura estricta elegida: el `warn` lleva exactamente `error: { tipo }` (ninguna otra clave: ni mensaje ni pila) y la academia de la sesión (su id) en alguna clave de la línea.

const MENSAJE_DEL_AVISO = 'No se pudo leer la foto del alumno';

describe('la foto del carnet (criterio 9)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let observable: AlmacenObservableDePrueba;
  let esc: EscenarioDelCarnet;

  beforeAll(async () => {
    ctx = await crearAppCarnet({
      nivelRegistro: 'trace',
      destinoRegistro: destino,
      envolverAlmacen: (real) => {
        observable = new AlmacenObservableDePrueba(real);
        return observable;
      },
    });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
    observable.lecturas.length = 0;
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const leer = (alumnoId: string) => ctx.http.get(rutaCarnet(alumnoId), { cookie: esc.cookies.secretaria });
  const avisos = () =>
    lineasJson(lineas).filter((linea) => String(linea['msg'] ?? linea['message']) === MENSAJE_DEL_AVISO);
  const claveDeFoto = (academiaId: string, alumnoId: string) =>
    `academias/${academiaId}/alumnos/${alumnoId}/foto-${randomUUID()}.jpg`;

  it('criterio 9: sin foto_clave, foto es null, no se lee el almacén y no hay aviso', async () => {
    const alumno = await crearAlumnoPorPago(ctx, esc);

    const respuesta = await leer(alumno.alumnoId);

    expect(carnetDe(respuesta).foto).toBeNull();
    expect(observable.lecturas, 'sin clave no se llama al almacén').toEqual([]);
    expect(avisos()).toEqual([]);
  });

  it('criterio 9: con foto, foto es data:image/jpeg;base64 con los bytes exactos del archivo guardado, leído con la academia de la sesión y fuera de toda transacción', async () => {
    const alumno = await crearAlumnoPorPago(ctx, esc);
    const bytes = await jpeg(300, 200);
    const clave = claveDeFoto(esc.e.A.id, alumno.alumnoId);
    await ctx.almacen.guardar(esc.e.A.id, clave, bytes, 'image/jpeg');
    await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { foto_clave: clave });

    const respuesta = await leer(alumno.alumnoId);

    const carnet = carnetDe(respuesta);
    expect(carnet.foto).toBe(`data:image/jpeg;base64,${bytes.toString('base64')}`);
    expect(observable.lecturas.map(({ academiaId, clave: leida }) => [academiaId, leida])).toEqual([
      [esc.e.A.id, clave],
    ]);
    expect(
      observable.lecturas.map((lectura) => lectura.transaccionesAbiertas),
      'la foto se lee fuera de toda transacción (DT-6): ninguna conexión de la API tenía una transacción abierta',
    ).toEqual([0]);
    expect(respuesta.texto, 'ni la clave ni la ruta viajan en el carnet').not.toContain(clave);
    expect(avisos()).toEqual([]);
  });

  it('criterio 9: el alumno ve la misma foto en /api/mi-carnet', async () => {
    const alumno = await crearAlumnoPorPago(ctx, esc);
    const bytes = await jpeg(120, 160);
    const clave = claveDeFoto(esc.e.A.id, alumno.alumnoId);
    await ctx.almacen.guardar(esc.e.A.id, clave, bytes, 'image/jpeg');
    await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { foto_clave: clave });

    const respuesta = await ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie });

    expect(carnetDe(respuesta).foto).toBe(`data:image/jpeg;base64,${bytes.toString('base64')}`);
    expect(observable.lecturas.every((l) => l.academiaId === esc.e.A.id && l.transaccionesAbiertas === 0)).toBe(true);
  });

  it('criterio 9: dos alumnos con fotos distintas reciben cada uno la suya', async () => {
    const uno = await crearAlumnoPorPago(ctx, esc);
    const otro = await crearAlumnoPorPago(ctx, esc);
    const fotoUno = await jpeg(100, 100, { orientacion: 1 });
    const fotoOtro = await jpeg(200, 100);
    for (const [alumno, bytes] of [
      [uno, fotoUno],
      [otro, fotoOtro],
    ] as const) {
      const clave = claveDeFoto(esc.e.A.id, alumno.alumnoId);
      await ctx.almacen.guardar(esc.e.A.id, clave, bytes, 'image/jpeg');
      await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { foto_clave: clave });
    }

    const deUno = carnetDe(await leer(uno.alumnoId));
    const deOtro = carnetDe(await leer(otro.alumnoId));

    expect(deUno.foto).toBe(`data:image/jpeg;base64,${fotoUno.toString('base64')}`);
    expect(deOtro.foto).toBe(`data:image/jpeg;base64,${fotoOtro.toString('base64')}`);
    expect(deUno.foto).not.toBe(deOtro.foto);
  });

  it('criterio 9: una foto_clave que apunta a la carpeta de otra academia da foto null, no devuelve los bytes de ese archivo y deja el aviso, con 200', async () => {
    const alumno = await crearAlumnoPorPago(ctx, esc);
    const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });
    const bytesDeB = await jpeg(333, 222);
    const claveDeB = claveDeFoto(esc.e.B.id, deB.alumnoId);
    await ctx.almacen.guardar(esc.e.B.id, claveDeB, bytesDeB, 'image/jpeg');
    // Escrita como dueño: el alumno de A apunta al archivo de B.
    await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { foto_clave: claveDeB });

    const respuesta = await leer(alumno.alumnoId);

    expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
    expect(carnetDe(respuesta).foto).toBeNull();
    expect(respuesta.texto, 'ni un byte del archivo de B').not.toContain(bytesDeB.toString('base64').slice(0, 200));
    expect(respuesta.cuerpo.includes(bytesDeB.subarray(0, 64))).toBe(false);
    expect(
      observable.lecturas.map((l) => l.academiaId),
      'se lee siempre con la academia de la sesión, nunca con la de la clave',
    ).toEqual([esc.e.A.id]);
    await esperarHasta(() => avisos().length > 0);
    expect(avisos()).toHaveLength(1);
  });

  it('criterio 9: el aviso lleva la academia y error: { tipo }, y no lleva la clave, la ruta, el id del alumno, su DNI ni su nombre', async () => {
    const alumno = await crearAlumnoPorPago(ctx, esc);
    const clave = claveDeFoto(esc.e.A.id, alumno.alumnoId);
    await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { foto_clave: clave });

    const respuesta = await leer(alumno.alumnoId);

    expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
    expect(carnetDe(respuesta).foto).toBeNull();
    await esperarHasta(() => avisos().length > 0);
    const [aviso] = avisos();
    expect(aviso, 'queda un warn «No se pudo leer la foto del alumno»').toBeTruthy();
    const registro = aviso as Record<string, unknown>;
    expect(registro['level'], 'es un warn (nivel 40 de pino)').toBe(40);
    const texto = JSON.stringify(registro);
    expect(texto, 'lleva la academia').toContain(esc.e.A.id);
    const error = registro['error'] as Record<string, unknown> | undefined;
    expect(error, 'lleva error: { tipo }').toBeTruthy();
    expect(Object.keys(error ?? {})).toEqual(['tipo']);
    expect(typeof error?.['tipo']).toBe('string');
    for (const [que, valor] of [
      ['la clave', clave],
      ['la ruta', 'academias/'],
      ['el nombre del archivo', 'foto-'],
      ['el DNI', alumno.dni],
      ['el nombre', 'Valeria'],
    ]) {
      expect(texto, `el aviso no lleva ${que}`).not.toContain(valor as string);
    }
    expect(JSON.stringify(lineasJson(lineas)), 'ninguna línea del registro lleva la clave').not.toContain(clave);
  });

  it('criterio 9: un archivo que falta en el almacén (borrado a mano) da foto null con 200 y el aviso, para el personal y para el alumno', async () => {
    const alumno = await crearAlumnoPorPago(ctx, esc);
    const clave = claveDeFoto(esc.e.A.id, alumno.alumnoId);
    await ctx.almacen.guardar(esc.e.A.id, clave, await jpeg(100, 100), 'image/jpeg');
    await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { foto_clave: clave });
    await ctx.almacen.borrar(esc.e.A.id, clave);

    const delPersonal = await leer(alumno.alumnoId);
    const propio = await ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie });

    expect(carnetDe(delPersonal).foto).toBeNull();
    expect(carnetDe(propio).foto).toBeNull();
    await esperarHasta(() => avisos().length >= 2);
    expect(avisos()).toHaveLength(2);
  });

  it.each([
    [
      'con una ruta que sale de la carpeta',
      (a: string, id: string) => `academias/${a}/alumnos/${id}/../../../../etc/passwd`,
    ],
    ['con otro formato', () => 'cualquier-cosa.jpg'],
    [
      'de otra academia que no existe',
      (_a: string, id: string) => `academias/${randomUUID()}/alumnos/${id}/foto-${randomUUID()}.jpg`,
    ],
  ])('criterio 9: una foto_clave %s no rompe el carnet ni lee nada: foto null y 200', async (_nombre, armar) => {
    const alumno = await crearAlumnoPorPago(ctx, esc);
    await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { foto_clave: armar(esc.e.A.id, alumno.alumnoId) });

    const respuesta = await leer(alumno.alumnoId);

    expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
    expect(carnetDe(respuesta).foto).toBeNull();
    expect(respuesta.texto).not.toContain('root:');
  });
});
