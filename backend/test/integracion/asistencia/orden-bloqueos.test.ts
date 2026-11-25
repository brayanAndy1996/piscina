// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AppCarnet,
  conAlumnoRetenido,
  crearAppCarnet,
  cuerpoRegenerar,
  leerQr,
  rutaRegenerarQr,
} from '../../utilidades/escenario-carnet';
import { cuerpoCobro, rutaCobro, sembrarCobrable } from '../../utilidades/escenario-pagos';
import { rutaFotoAlumno, subirFotoPanel, exigirRutasDe008b } from '../../utilidades/escenario-foto-panel';
import {
  abrirCajaDelDia,
  type AlumnoDeAsistencia,
  asistenciasDe,
  clasesUsadasDe,
  codigoDeRespuesta,
  comprobarSinErrores,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  leerAsistencias,
  LUNES,
  marcar,
  prepararEscenarioDeAsistencia,
  rechazoDe,
  resultadoDe,
  ULTIMO_LUNES_DE_NOVIEMBRE,
  type Via,
} from '../../utilidades/escenario-asistencia';
import { leerMatriculas, type RespuestaApi } from '../../utilidades/inscripciones';
import { abrirRetenedor, conLimite, esperarEspera, observar } from '../../utilidades/planes-clases';

// Criterio 14 (crítico, «Orden de bloqueos» de 005a y 006a): en una sola transacción, en este orden: `bloquearActorVigente`; la fila del alumno con `FOR SHARE` (por token o por id); la matrícula del día con `FOR UPDATE`; después se leen «ahora», la configuración, las asistencias de
// hoy y las clases restantes, y al final se insertan la fila y el descuento. No bloquea `clases` (la asistencia no mueve cupo). Pruebas deterministas sin `40P01`: una lectura a la vez que la confirmación de un pago del mismo alumno (007), que la foto del panel (008b) y que la
// regeneración del QR (criterio 4).
// DT-16 («ahora» después de los bloqueos, como DT-10 de 007): una lectura que espera un bloqueo y cruza el fin de la clase responde `FUERA_DE_HORARIO`. Pruebas deterministas: la prueba retiene la fila (del alumno, o la de su matrícula), lanza la lectura con el reloj en T0, espera con la cadena
// de bloqueos de PostgreSQL a que la API quede esperando, mueve el reloj a T1 y suelta; todo se decide con T1 (la hora de después de la espera): la fila guarda T1 en `llegada_en`, `registrado_en` y el `actualizado_en` de la matrícula.
// Lecturas estrictas elegidas: la lectura que espera y cruza el inicio de la clase (T0 17:59 → T1 18:00:00.000) registra con T1; la que cruza el límite de la puntualidad (T0 18:10:30 → T1 18:11:00) es `TARDE`; la que cruza la medianoche de Lima y deja la mensualidad vencida es un rechazo, nunca un registro.
// En las carreras con otras operaciones del mismo alumno, la prueba retiene la fila del alumno, envía las dos peticiones (en los dos órdenes), comprueba que ambas esperan y suelta: ninguna responde 5xx; cada una da su éxito o el rechazo que le toca según quién llegó primero.

describe('el orden de los bloqueos y «ahora» después de bloquear (criterio 14, DT-16)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  describe('«ahora» se lee después de tomar los bloqueos (DT-16)', () => {
    /**
     * Retiene la fila del alumno o la de su matrícula, lanza la lectura con el reloj en `t0`, espera a que la API quede esperando, mueve el reloj a `t1`, suelta
     * y devuelve la respuesta (y si de verdad esperó).
     */
    async function leerMientrasElRelojAvanza(opciones: {
      alumno: AlumnoDeAsistencia;
      via: Via;
      retener: 'alumno' | 'matricula';
      t0: Date;
      t1: Date;
    }): Promise<{ respuesta: RespuestaApi; esperando: boolean }> {
      const cookie = en(ctx, esc, opciones.t0).secretaria;
      const retenedor = await abrirRetenedor(esc.e.A.id);
      try {
        await retenedor.consultar(
          opciones.retener === 'alumno'
            ? 'SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE'
            : 'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
          [esc.e.A.id, opciones.retener === 'alumno' ? opciones.alumno.alumnoId : opciones.alumno.matriculaId],
        );
        const peticion = observar(marcar(ctx, opciones.via, cookie, opciones.alumno));
        const esperando = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [peticion],
          `la lectura ni respondió ni quedó esperando la fila (${opciones.retener}).`,
        );
        ctx.reloj.fijar(opciones.t1);
        await retenedor.liberar('ROLLBACK');
        const respuesta = await conLimite(
          peticion.resultado,
          'Límite de seguridad: la lectura no respondió tras soltar la fila.',
        );
        return { respuesta, esperando };
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    }

    const RETENCIONES = (['alumno', 'matricula'] as const).flatMap((retener) =>
      (['QR', 'MANUAL'] as const).map((via) => ({ retener, via })),
    );

    it.each(RETENCIONES)(
      'criterio 14 y DT-16: lanzada a las 18:59:00 y soltada a las 19:00:00.000 (reteniendo $retener, por $via): FUERA_DE_HORARIO, sin fila ni descuento',
      async ({ retener, via }) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);

        const { respuesta, esperando } = await leerMientrasElRelojAvanza({
          alumno,
          via,
          retener,
          t0: enLima(LUNES, '18:59:00.000'),
          t1: enLima(LUNES, '19:00:00.000'),
        });

        expect(esperando, 'la lectura debía quedar esperando la fila').toBe(true);
        rechazoDe(respuesta, 'FUERA_DE_HORARIO', 'AMARILLA');
        expect(await asistenciasDe(esc.e.A.id, alumno.alumnoId)).toEqual([]);
        expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(0);
      },
    );

    it.each(RETENCIONES)(
      'criterio 14 y DT-16: lanzada a las 17:59:00 y soltada a las 18:00:00.000 (reteniendo $retener, por $via): registra con la hora de después de la espera',
      async ({ retener, via }) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        const t1 = enLima(LUNES, '18:00:00.000');

        const { respuesta, esperando } = await leerMientrasElRelojAvanza({
          alumno,
          via,
          retener,
          t0: enLima(LUNES, '17:59:00.000'),
          t1,
        });

        expect(esperando).toBe(true);
        const resultado = resultadoDe(respuesta, 201);
        expect(resultado.asistencia).toMatchObject({
          llegadaEn: t1.toISOString(),
          horaLlegada: '18:00',
          estadoLlegada: 'PUNTUAL',
        });
        const [fila] = await asistenciasDe(esc.e.A.id, alumno.alumnoId);
        expect(fila?.llegada_en.toISOString()).toBe(t1.toISOString());
        expect(fila?.registrado_en.toISOString()).toBe(t1.toISOString());
      },
    );

    it.each(RETENCIONES)(
      'criterio 14 y DT-16: lanzada a las 18:10:30 (puntual) y soltada a las 18:11:00.000 (reteniendo $retener, por $via): TARDE, con T1 en llegada_en, registrado_en y el actualizado_en de la matrícula',
      async ({ retener, via }) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        const t1 = enLima(LUNES, '18:11:00.000');

        const { respuesta, esperando } = await leerMientrasElRelojAvanza({
          alumno,
          via,
          retener,
          t0: enLima(LUNES, '18:10:30.000'),
          t1,
        });

        expect(esperando).toBe(true);
        expect(resultadoDe(respuesta, 201).asistencia).toMatchObject({ estadoLlegada: 'TARDE', horaLlegada: '18:11' });
        const [fila] = await asistenciasDe(esc.e.A.id, alumno.alumnoId);
        expect(fila).toMatchObject({ estado_llegada: 'TARDE' });
        expect(fila?.llegada_en.toISOString()).toBe(t1.toISOString());
        expect(fila?.registrado_en.toISOString()).toBe(t1.toISOString());
        const matricula = (await leerMatriculas(esc.e.A.id)).find((m) => m.id === alumno.matriculaId);
        expect(matricula?.actualizado_en.toISOString()).toBe(t1.toISOString());
      },
    );

    it('criterio 14 y DT-16: lanzada el 30/11 a las 23:59:59.500 y soltada el 1/12 a las 00:00:00.100 de Lima: la matrícula bloqueada ya no es la del día y el resultado es un rechazo (MENSUALIDAD_NO_VIGENTE), nunca un registro', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, { claseIds: [esc.lunes19.id] });

      const { respuesta, esperando } = await leerMientrasElRelojAvanza({
        alumno,
        via: 'QR',
        retener: 'matricula',
        t0: enLima(ULTIMO_LUNES_DE_NOVIEMBRE, '23:59:59.500'),
        t1: enLima('2026-12-01', '00:00:00.100'),
      });

      expect(esperando).toBe(true);
      rechazoDe(respuesta, 'MENSUALIDAD_NO_VIGENTE', 'ROJA');
      expect(await leerAsistencias(esc.e.A.id)).toEqual([]);
    });

    it('criterio 14 y DT-16 (control): lanzada a las 18:30 y soltada a las 18:40: 201 con la hora de después de la espera', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const t1 = enLima(LUNES, '18:40:00.000');

      const { respuesta, esperando } = await leerMientrasElRelojAvanza({
        alumno,
        via: 'MANUAL',
        retener: 'alumno',
        t0: enLima(LUNES, '18:30:00.000'),
        t1,
      });

      expect(esperando).toBe(true);
      expect(resultadoDe(respuesta, 201).asistencia.llegadaEn).toBe(t1.toISOString());
    });
  });

  describe('lo que espera y lo que no espera', () => {
    it('criterio 14: la lectura de un alumno no espera la fila de otro alumno (no hay un bloqueo global): con otro alumno retenido, marca de inmediato', async () => {
      const retenido = await crearAlumnoDeAsistencia(ctx, esc);
      const libre = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;
      const retenedor = await abrirRetenedor(esc.e.A.id);
      try {
        await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
          esc.e.A.id,
          retenido.alumnoId,
        ]);
        await retenedor.consultar(
          'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
          [esc.e.A.id, retenido.matriculaId],
        );

        const respuesta = await respuestaAntesDe(
          marcar(ctx, 'QR', cookie, libre),
          5000,
          'la lectura de otro alumno esperó una fila que no es suya',
        );

        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
    });

    it.each(['QR', 'MANUAL'] as const)(
      'criterio 14: la asistencia no bloquea ni espera la fila de la clase (no mueve cupo): con la clase modificada y sin confirmar por otra transacción (UPDATE del aforo), la lectura por %s responde 201 sin esperar',
      async (via) => {
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;
        const retenedor = await abrirRetenedor(esc.e.A.id);
        try {
          // `UPDATE` de una columna que no es clave: toma FOR NO KEY UPDATE, que no choca con la lectura de la llave de la clase por la llave foránea del INSERT.
          await retenedor.consultar('UPDATE clases SET aforo = aforo WHERE academia_id = $1::uuid AND id = $2::uuid', [
            esc.e.A.id,
            esc.e.lunes.id,
          ]);

          const respuesta = await respuestaAntesDe(
            marcar(ctx, via, cookie, alumno),
            5000,
            'la asistencia esperó la fila de la clase: no debe bloquear clases (no mueve cupo)',
          );

          expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
        } finally {
          await retenedor.liberar('ROLLBACK');
        }
      },
    );

    /** La respuesta de `peticion`, o un error claro si no llega en `milisegundos`. */
    async function respuestaAntesDe(
      peticion: Promise<RespuestaApi>,
      milisegundos: number,
      mensaje: string,
    ): Promise<RespuestaApi> {
      let temporizador: NodeJS.Timeout | undefined;
      const vencida = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new Error(mensaje)), milisegundos);
      });
      try {
        return await Promise.race([peticion, vencida]);
      } finally {
        clearTimeout(temporizador);
      }
    }
  });

  describe('a la vez que otras operaciones del mismo alumno: sin 40P01 ni 5xx', () => {
    it.each([
      ['la foto del panel (008b)', 'foto'],
      ['la regeneración del QR (criterio 4)', 'regeneracion'],
    ] as const)(
      'criterio 14: la lectura y %s, a la vez y en los dos órdenes, terminan sin 5xx; cada una da su éxito o el rechazo que le toca',
      async (_nombre, otra) => {
        exigirRutasDe008b(ctx.app);
        for (const orden of ['lectura-primero', 'otra-primero'] as const) {
          const alumno = await crearAlumnoDeAsistencia(ctx, esc);
          const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;
          const lectura = () => marcar(ctx, 'QR', cookie, alumno);
          const otraOperacion = () =>
            otra === 'foto'
              ? subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie })
              : ctx.http.post(rutaRegenerarQr(alumno.alumnoId), cuerpoRegenerar(), { cookie });

          const { resultados, esperaron } = await conAlumnoRetenido({
            academiaId: esc.e.A.id,
            alumnoId: alumno.alumnoId,
            esperando: 2,
            enviar: orden === 'lectura-primero' ? [lectura, otraOperacion] : [otraOperacion, lectura],
          });

          expect(esperaron, `${orden}: las dos peticiones debían quedar esperando la fila del alumno`).toBe(true);
          const respuestaLectura = resultados[orden === 'lectura-primero' ? 0 : 1] as RespuestaApi;
          const respuestaOtra = resultados[orden === 'lectura-primero' ? 1 : 0] as RespuestaApi;
          comprobarSinErrores([respuestaLectura, respuestaOtra]);
          expect(respuestaOtra.status, `${orden} (${otra}): ${respuestaOtra.texto.slice(0, 300)}`).toBe(
            otra === 'foto' ? 204 : 200,
          );
          if (otra === 'foto') {
            expect(respuestaLectura.status, respuestaLectura.texto.slice(0, 300)).toBe(201);
          } else {
            // Si la lectura llegó antes que la regeneración, marca; si llegó después, el token viejo ya no vale.
            expect([201, 404], respuestaLectura.texto.slice(0, 300)).toContain(respuestaLectura.status);
            if (respuestaLectura.status === 404) expect(codigoDeRespuesta(respuestaLectura)).toBe('QR_NO_RECONOCIDO');
            expect((await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token).not.toBe(alumno.token);
          }
          expect((await asistenciasDe(esc.e.A.id, alumno.alumnoId)).length).toBe(
            respuestaLectura.status === 201 ? 1 : 0,
          );
          expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(respuestaLectura.status === 201 ? 1 : 0);
        }
      },
    );

    it('criterio 14: la lectura manual y la regeneración del QR a la vez: la lectura siempre marca (no usa el token) y la regeneración responde 200', async () => {
      const alumno = await crearAlumnoDeAsistencia(ctx, esc);
      const cookie = en(ctx, esc, enLima(LUNES, '18:05')).secretaria;

      const { resultados, esperaron } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: alumno.alumnoId,
        esperando: 2,
        enviar: [
          () => ctx.http.post(rutaRegenerarQr(alumno.alumnoId), cuerpoRegenerar(), { cookie }),
          () => marcar(ctx, 'MANUAL', cookie, alumno),
        ],
      });

      expect(esperaron).toBe(true);
      expect(resultados.map((r) => r.status)).toEqual([200, 201]);
    });

    it.each(['lectura-primero', 'cobro-primero'] as const)(
      'criterio 14: la lectura manual y la confirmación del pago del mismo alumno (007) a la vez (%s): el cobro responde 201, la lectura marca (201) o no encuentra todavía al alumno (404), sin 5xx; la matrícula y las asistencias cuadran',
      async (orden) => {
        const t = enLima(LUNES, '18:05');
        const cookies = en(ctx, esc, t);
        await abrirCajaDelDia(esc, LUNES);
        const cliente = await sembrarCobrable(esc.e, { reservaVenceEn: enLima('2026-11-20', '10:00') });
        const lectura = () => marcar(ctx, 'MANUAL', cookies.secretaria, { alumnoId: cliente.alumnoId, contenido: '' });
        const cobro = () =>
          ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('42.00'), { cookie: cookies.secretaria });

        // Un `CLIENTE` todavía no es un alumno: la lectura puede no esperar su fila (no cumple el filtro de estado) y responder 404 al instante; el cobro sí la espera.
        const { resultados, esperaron } = await conAlumnoRetenido({
          academiaId: esc.e.A.id,
          alumnoId: cliente.alumnoId,
          esperando: 1,
          enviar: orden === 'lectura-primero' ? [lectura, cobro] : [cobro, lectura],
        });

        expect(
          esperaron || resultados.some((r) => r.status === 404),
          'el cobro debía quedar esperando la fila del alumno',
        ).toBe(true);
        const respuestaLectura = resultados[orden === 'lectura-primero' ? 0 : 1] as RespuestaApi;
        const respuestaCobro = resultados[orden === 'lectura-primero' ? 1 : 0] as RespuestaApi;
        comprobarSinErrores([respuestaLectura, respuestaCobro]);
        expect(respuestaCobro.status, respuestaCobro.texto.slice(0, 300)).toBe(201);
        expect([201, 404], respuestaLectura.texto.slice(0, 300)).toContain(respuestaLectura.status);
        const marcadas = await asistenciasDe(esc.e.A.id, cliente.alumnoId);
        expect(marcadas).toHaveLength(respuestaLectura.status === 201 ? 1 : 0);
        expect(await clasesUsadasDe(esc.e.A.id, cliente.matriculaId)).toBe(marcadas.length);
      },
    );
  });
});
