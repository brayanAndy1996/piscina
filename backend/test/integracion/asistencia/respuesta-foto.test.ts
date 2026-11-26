// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlmacenObservableDePrueba, type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { exigirRutasDe008b, rutaFotoAlumno, subirFotoPanel } from '../../utilidades/escenario-foto-panel';
import {
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  LUNES,
  marcar,
  prepararEscenarioDeAsistencia,
  rechazoDe,
  resultadoDe,
} from '../../utilidades/escenario-asistencia';
import { fotoClaveDe, leerArchivoDeClave } from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';

// Criterio 15 (crítico, HU-14, Ley 29733), parte de la foto: `foto` sigue el criterio 9 de 008: `data:image/jpeg;base64,…` leído del almacén con la academia de la sesión, **después** de cerrar la transacción; si no se puede leer, `null` y un `warn` sin la clave. La foto va en el
// resultado (201 y 200 repetido) y en el alumno de cada rechazo (409), para que la pantalla de recepción la muestre.
// Va en su propio archivo, con una sola aplicación y la primera del proceso: el nivel del registro técnico es global del proceso y lo fija la primera aplicación que se crea.
// Lecturas estrictas elegidas: el contenido de `foto` es el del archivo guardado, byte a byte; cada lectura de la foto la hace la API con la academia y la clave del alumno de la sesión (una sola por respuesta) y sin ninguna transacción de la API abierta en ese instante; un alumno sin foto
// recibe `null` y no cuenta como falla (no hay `warn`); si el archivo falta, la asistencia se registra igual (201) y el `warn` no lleva la clave del archivo, el DNI ni el token del alumno.

describe('la foto en la respuesta del marcado (criterio 15)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let almacen: AlmacenObservableDePrueba | undefined;
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet({
      nivelRegistro: 'warn',
      destinoRegistro: destino,
      envolverAlmacen: (real) => (almacen = new AlmacenObservableDePrueba(real)),
    });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    exigirRutasDe008b(ctx.app);
    alumno = await crearAlumnoDeAsistencia(ctx, esc);
    almacen?.lecturas.splice(0);
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const HORA = enLima(LUNES, '18:05:00.000');

  async function ponerFoto(): Promise<{ clave: string; bytes: Buffer }> {
    const subida = await subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), {
      cookie: en(ctx, esc, HORA).secretaria,
    });
    expect(subida.status, subida.texto.slice(0, 300)).toBe(204);
    const clave = (await fotoClaveDe(esc.e.A.id, alumno.alumnoId)) as string;
    expect(clave, 'el alumno debía quedar con foto').toBeTruthy();
    almacen?.lecturas.splice(0);
    return { clave, bytes: leerArchivoDeClave(ctx.raiz, clave) };
  }

  it('criterio 15: con foto, el 201 lleva data:image/jpeg;base64 con el contenido del archivo, leído después de cerrar la transacción con la academia de la sesión', async () => {
    const { clave, bytes } = await ponerFoto();
    const cookie = en(ctx, esc, HORA).secretaria;

    const resultado = resultadoDe(await marcar(ctx, 'QR', cookie, alumno), 201);

    expect(resultado.alumno.foto).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);
    const decodificada = Buffer.from((resultado.alumno.foto as string).split(',')[1] as string, 'base64');
    expect(decodificada.subarray(0, 3).toString('hex'), 'es un JPEG').toBe('ffd8ff');
    expect(decodificada.equals(bytes), 'es el contenido del archivo guardado').toBe(true);
    expect(almacen?.lecturas).toHaveLength(1);
    expect(almacen?.lecturas[0]).toMatchObject({ academiaId: esc.e.A.id, clave, transaccionesAbiertas: 0 });
  });

  it('criterio 15: el 200 repetido y el 409 de un rechazo llevan la misma foto, también leída fuera de la transacción', async () => {
    const { bytes } = await ponerFoto();
    const clave = randomUUID();
    await marcar(ctx, 'MANUAL', en(ctx, esc, HORA).secretaria, alumno, { claveIdempotencia: clave });
    almacen?.lecturas.splice(0);

    const repetido = resultadoDe(
      await marcar(ctx, 'MANUAL', en(ctx, esc, HORA).secretaria, alumno, { claveIdempotencia: clave }),
      200,
    );
    const rechazo = rechazoDe(
      await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '18:30')).secretaria, alumno),
      'ASISTENCIA_YA_REGISTRADA',
      'AMARILLA',
    );

    for (const foto of [repetido.alumno.foto, rechazo.alumno.foto]) {
      expect(foto).toMatch(/^data:image\/jpeg;base64,/);
      expect(Buffer.from((foto as string).split(',')[1] as string, 'base64').equals(bytes)).toBe(true);
    }
    expect(almacen?.lecturas.length).toBeGreaterThanOrEqual(2);
    expect(
      almacen?.lecturas.every((lectura) => lectura.transaccionesAbiertas === 0 && lectura.academiaId === esc.e.A.id),
    ).toBe(true);
  });

  it('criterio 15: el rechazo por horario también lleva la foto del alumno (la pantalla amarilla la muestra)', async () => {
    await ponerFoto();

    const rechazo = rechazoDe(
      await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '17:30')).secretaria, alumno),
      'FUERA_DE_HORARIO',
      'AMARILLA',
    );

    expect(rechazo.alumno.foto).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('criterio 15: sin foto, foto es null y no hay ninguna lectura del almacén ni aviso', async () => {
    const resultado = resultadoDe(await marcar(ctx, 'QR', en(ctx, esc, HORA).secretaria, alumno), 201);

    expect(resultado.alumno.foto).toBeNull();
    expect(almacen?.lecturas).toEqual([]);
    expect(lineas.filter((linea) => /"level":40/.test(linea))).toEqual([]);
  });

  it('criterio 15: si el archivo de la foto no se puede leer, la asistencia se registra igual (201), foto es null y queda un warn sin la clave, el DNI ni el token', async () => {
    const { clave } = await ponerFoto();
    ctx.vaciarAlmacen();
    lineas.length = 0;

    const respuesta = await marcar(ctx, 'QR', en(ctx, esc, HORA).secretaria, alumno);

    const resultado = resultadoDe(respuesta, 201);
    expect(resultado.alumno.foto).toBeNull();
    const avisos = lineas.filter((linea) => /"level":40/.test(linea));
    expect(avisos.length, 'un warn por la foto que no se pudo leer').toBeGreaterThanOrEqual(1);
    const registro = lineas.join('\n');
    for (const secreto of [clave, alumno.dni, alumno.token, 'AQ1:']) {
      expect(registro, `el registro técnico no lleva «${secreto}»`).not.toContain(secreto);
    }
  });
});
