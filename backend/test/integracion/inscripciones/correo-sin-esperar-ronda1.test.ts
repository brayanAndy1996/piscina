// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  type AppInscripciones,
  AHORA_005,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  leerMatriculas,
  leerSolicitudes,
  rutaPublica,
  solicitudDe,
} from '../../utilidades/inscripciones';
import { EnviadorProgramable, medir, observarErroresDeProceso } from '../../utilidades/inscripciones-ronda1';

// Criterio 51 (crítico, D-05, D-19; efectos después de confirmar, criterio 27; ataque ronda 1, F3): después de confirmar la transacción,
// la API responde el 201 sin esperar a que `EnviadorCorreo.enviar` termine: el envío se inicia después de confirmar y la respuesta no
// depende de que su promesa se resuelva ni se rechace. Pruebas con un `EnviadorCorreo` de prueba cuya promesa no se resuelve nunca:
//   a) el envío responde 201 con la solicitud creada en menos de 2 segundos (margen de la prueba) y `enviar` se llamó una vez, después de
//      confirmar (la solicitud ya se ve en la base desde otra conexión en el momento de la llamada);
//   b) un segundo envío de otra persona, mientras el primer correo sigue colgado, también responde 201 sin demora: un correo colgado no
//      retiene conexiones de la base ni transacciones;
//   c) con un `enviar` que lanza un error de forma síncrona y con uno que rechaza su promesa, la respuesta es el mismo 201 y el proceso no
//      emite `unhandledRejection` ni `uncaughtException`.
// El reintento del cliente sigue cubierto por el criterio 23: no envía otro correo.

const LIMITE_MS = 2000;

describe('la respuesta no espera al correo (criterio 51)', () => {
  const correo = new EnviadorProgramable();
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ correo });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    correo.reiniciar();
    e = await crearEscenarioInscripcion();
  });
  afterEach(() => {
    // Si la implementación esperara al correo, esto deja terminar las peticiones colgadas antes de cerrar la aplicación.
    correo.liberar();
  });
  afterAll(async () => {
    correo.liberar();
    await ctx?.http.cerrar();
  });

  const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
  const conCorreo = (direccion: string) => cuerpoInscripcion(e, { sobre: { alumno: { correo: direccion } } });

  it('criterio 51 a: con un correo que nunca se resuelve, el envío responde 201 en menos de 2 segundos, enviar se llamó una vez y la solicitud ya se veía en la base en el momento de la llamada', async () => {
    correo.accion = () => 'colgar';
    let visto: Promise<{ solicitudes: number; matriculas: number }> | undefined;
    correo.alLlamar = () => {
      visto = Promise.all([leerSolicitudes(e.A.id), leerMatriculas(e.A.id)]).then(([solicitudes, matriculas]) => ({
        solicitudes: solicitudes.length,
        matriculas: matriculas.length,
      }));
    };

    const { valor: respuesta, ms } = await medir(
      enviar(await conCorreo('colgado.a@ejemplo.test')),
      LIMITE_MS,
      `la respuesta del envío esperó al correo (más de ${LIMITE_MS} ms con un correo que nunca termina)`,
    );

    expect(respuesta.status, respuesta.texto).toBe(201);
    expect(ms).toBeLessThan(LIMITE_MS);
    expect(solicitudDe(respuesta).estado).toBe('PENDIENTE_PAGO');
    expect(await leerSolicitudes(e.A.id)).toHaveLength(1);
    expect(correo.mensajes, 'enviar se llamó una vez').toHaveLength(1);
    expect(await visto, 'al llamar a enviar, la solicitud y la matrícula ya estaban confirmadas').toEqual({
      solicitudes: 1,
      matriculas: 1,
    });
  });

  it('criterio 51 b: mientras el primer correo sigue colgado, un segundo envío de otra persona también responde 201 sin demora y no queda ninguna transacción abierta', async () => {
    correo.accion = () => 'colgar';

    const primero = await medir(
      enviar(await conCorreo('colgado.b1@ejemplo.test')),
      LIMITE_MS,
      'el primer envío esperó al correo',
    );
    const segundo = await medir(
      enviar(await conCorreo('colgado.b2@ejemplo.test')),
      LIMITE_MS,
      'el segundo envío esperó al correo',
    );

    expect([primero.valor.status, segundo.valor.status], `${primero.valor.texto} ${segundo.valor.texto}`).toEqual([
      201, 201,
    ]);
    expect(await leerSolicitudes(e.A.id)).toHaveLength(2);
    expect(correo.mensajes).toHaveLength(2);
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`,
    );
    expect((rows[0] as { n: number }).n, 'un correo colgado no retiene ninguna transacción de la base').toBe(0);
  });

  it.each([
    ['lanza un error de forma síncrona', { lanzar: new Error('Fallo síncrono del proveedor') }],
    ['rechaza su promesa', { rechazar: new Error('Fallo asíncrono del proveedor') }],
    ['rechaza con un texto', { rechazar: 'texto suelto' }],
    ['lanza un valor que no es un error', { lanzar: { codigo: 535 } }],
  ])(
    'criterio 51 c: con un enviar que %s, la respuesta es el mismo 201 y el proceso no emite unhandledRejection ni uncaughtException',
    async (_nombre, accion) => {
      correo.accion = () => accion;
      let respuesta: Awaited<ReturnType<typeof enviar>> | undefined;

      const eventos = await observarErroresDeProceso(async () => {
        respuesta = (
          await medir(enviar(await conCorreo('falla.c@ejemplo.test')), LIMITE_MS, 'la respuesta esperó al correo')
        ).valor;
      });

      expect(respuesta?.status, respuesta?.texto).toBe(201);
      expect(eventos, 'ningún unhandledRejection ni uncaughtException').toEqual([]);
      expect(await leerSolicitudes(e.A.id)).toHaveLength(1);
      expect(correo.mensajes).toHaveLength(1);
    },
  );

  it('criterio 51 c: el 201 de un envío con correo que falla es igual, en su forma, al de uno con correo que funciona', async () => {
    const bien = solicitudDe(await enviar(await conCorreo('bien.c@ejemplo.test')));
    correo.accion = () => ({ rechazar: new Error('Fallo') });

    const mal = solicitudDe(await enviar(await conCorreo('mal.c@ejemplo.test')));

    expect(Object.keys(mal).sort()).toEqual(Object.keys(bien).sort());
  });

  it('criterio 51: un reintento del cliente con la misma claveIdempotencia mientras el primer correo sigue colgado responde 409 sin llamar otra vez a enviar', async () => {
    correo.accion = () => 'colgar';
    const cuerpo = await conCorreo('colgado.d@ejemplo.test');
    const primero = await medir(enviar(cuerpo), LIMITE_MS, 'el envío esperó al correo');
    expect(primero.valor.status, primero.valor.texto).toBe(201);

    const repetido = await medir(enviar(cuerpo), LIMITE_MS, 'el reintento esperó al correo');

    expect(repetido.valor.status, repetido.valor.texto).toBe(409);
    expect(correo.mensajes).toHaveLength(1);
  });
});
