// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fijarConfiguracion } from '../../utilidades/configuracion';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  asistenciasDe,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  LUNES,
  marcar,
  prepararEscenarioDeAsistencia,
  resultadoDe,
  type Via,
} from '../../utilidades/escenario-asistencia';

// Criterio 10 (crítico, D-11, D-08): la tolerancia se lee con `leerConfiguracion(tx)` en la misma transacción, sin caché. Con 10 minutos: 18:10:59.999 es `PUNTUAL` y 18:11:00.000 es `TARDE` (la llegada se compara truncada al minuto, DT-3); con 0: 18:00:59.999 `PUNTUAL` y
// 18:01:00.000 `TARDE`; con 30: 18:30:59.999 `PUNTUAL`. Un `PATCH /api/configuracion` confirmado vale para la siguiente lectura, sin reiniciar; las asistencias ya registradas no cambian (DR-7 de 003). Dos academias con tolerancias distintas a la misma hora dan resultados
// distintos. La clase de la prueba es la de los lunes de 18:00 a 19:00 (el lunes 16/11), con el proceso en UTC y en Asia/Tokyo.
// Lecturas estrictas elegidas: sin una fila de configuración la tolerancia es la de por defecto (10); el estado se guarda en la fila (`estado_llegada`) y se devuelve en `asistencia.estadoLlegada`; la tolerancia se lee en el momento de marcar: un cambio directo en la base entre dos
// lecturas (sin pasar por la API de configuración) también vale para la siguiente.

const ZONA_ORIGINAL = process.env['TZ'];

interface Caso {
  tolerancia: number | 'por defecto';
  hora: string;
  estado: 'PUNTUAL' | 'TARDE';
}

const CASOS: Caso[] = [
  { tolerancia: 10, hora: '18:00:00.000', estado: 'PUNTUAL' },
  { tolerancia: 10, hora: '18:10:00.000', estado: 'PUNTUAL' },
  { tolerancia: 10, hora: '18:10:59.999', estado: 'PUNTUAL' },
  { tolerancia: 10, hora: '18:11:00.000', estado: 'TARDE' },
  { tolerancia: 10, hora: '18:59:59.999', estado: 'TARDE' },
  { tolerancia: 'por defecto', hora: '18:10:59.999', estado: 'PUNTUAL' },
  { tolerancia: 'por defecto', hora: '18:11:00.000', estado: 'TARDE' },
  { tolerancia: 0, hora: '18:00:00.000', estado: 'PUNTUAL' },
  { tolerancia: 0, hora: '18:00:59.999', estado: 'PUNTUAL' },
  { tolerancia: 0, hora: '18:01:00.000', estado: 'TARDE' },
  { tolerancia: 30, hora: '18:30:59.999', estado: 'PUNTUAL' },
  { tolerancia: 30, hora: '18:31:00.000', estado: 'TARDE' },
  { tolerancia: 5, hora: '18:05:59.999', estado: 'PUNTUAL' },
  { tolerancia: 5, hora: '18:06:00.000', estado: 'TARDE' },
];

describe.each(['UTC', 'Asia/Tokyo'])(
  'puntual o tarde con la tolerancia de la academia (criterio 10) con el proceso en TZ=%s',
  (zona) => {
    let ctx: AppCarnet;
    let esc: EscenarioDeAsistencia;

    beforeAll(async () => {
      process.env['TZ'] = zona;
      ctx = await crearAppCarnet();
    });
    beforeEach(async () => {
      process.env['TZ'] = zona;
      esc = await prepararEscenarioDeAsistencia(ctx);
    });
    afterAll(async () => {
      await ctx?.cerrarTodo();
      if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
      else process.env['TZ'] = ZONA_ORIGINAL;
    });

    describe.each<Via>(['QR', 'MANUAL'])('por la vía %s', (via) => {
      it.each(CASOS)(
        'criterio 10: con tolerancia $tolerancia, la llegada a las $hora es $estado',
        async ({ tolerancia, hora, estado }) => {
          if (tolerancia !== 'por defecto')
            await fijarConfiguracion(esc.e.A.id, { toleranciaTardanzaMinutos: tolerancia });
          const alumno = await crearAlumnoDeAsistencia(ctx, esc);
          const cookie = en(ctx, esc, enLima(LUNES, hora)).secretaria;

          const resultado = resultadoDe(await marcar(ctx, via, cookie, alumno), 201);

          expect(resultado.asistencia.estadoLlegada).toBe(estado);
          expect(resultado.asistencia.horaLlegada).toBe(hora.slice(0, 5));
          expect((await asistenciasDe(esc.e.A.id, alumno.alumnoId))[0]?.estado_llegada).toBe(estado);
        },
      );
    });

    describe('la tolerancia se lee en el momento de marcar', () => {
      it('criterio 10: un PATCH /api/configuracion del administrador vale para la siguiente lectura, sin reiniciar: de 0 a 30 minutos', async () => {
        const cookies = en(ctx, esc, enLima(LUNES, '18:20'));
        const primero = await crearAlumnoDeAsistencia(ctx, esc);
        const segundo = await crearAlumnoDeAsistencia(ctx, esc);
        const cambio = (minutos: number) =>
          ctx.http.enviar('PATCH', '/api/configuracion', {
            cookie: cookies.admin,
            cuerpo: { toleranciaTardanzaMinutos: minutos },
          });

        expect((await cambio(0)).status).toBe(200);
        const conCero = resultadoDe(await marcar(ctx, 'QR', cookies.secretaria, primero), 201);
        expect((await cambio(30)).status).toBe(200);
        const conTreinta = resultadoDe(await marcar(ctx, 'QR', cookies.secretaria, segundo), 201);

        expect(conCero.asistencia.estadoLlegada, 'a las 18:20 con 0 minutos de tolerancia').toBe('TARDE');
        expect(conTreinta.asistencia.estadoLlegada, 'a las 18:20 con 30 minutos de tolerancia').toBe('PUNTUAL');
      });

      it('criterio 10: un cambio directo en la base entre dos lecturas también vale para la siguiente (sin caché)', async () => {
        const cookies = en(ctx, esc, enLima(LUNES, '18:20'));
        const primero = await crearAlumnoDeAsistencia(ctx, esc);
        const segundo = await crearAlumnoDeAsistencia(ctx, esc);

        await fijarConfiguracion(esc.e.A.id, { toleranciaTardanzaMinutos: 30 });
        const conTreinta = resultadoDe(await marcar(ctx, 'MANUAL', cookies.secretaria, primero), 201);
        await fijarConfiguracion(esc.e.A.id, { toleranciaTardanzaMinutos: 0 });
        const conCero = resultadoDe(await marcar(ctx, 'MANUAL', cookies.secretaria, segundo), 201);

        expect(conTreinta.asistencia.estadoLlegada).toBe('PUNTUAL');
        expect(conCero.asistencia.estadoLlegada).toBe('TARDE');
      });

      it('criterio 10 (DR-7 de 003): un cambio de la tolerancia no cambia las asistencias ya registradas', async () => {
        const cookies = en(ctx, esc, enLima(LUNES, '18:20'));
        const alumno = await crearAlumnoDeAsistencia(ctx, esc);
        await fijarConfiguracion(esc.e.A.id, { toleranciaTardanzaMinutos: 30 });
        const registrada = resultadoDe(await marcar(ctx, 'QR', cookies.secretaria, alumno), 201);
        expect(registrada.asistencia.estadoLlegada).toBe('PUNTUAL');

        const cambio = await ctx.http.enviar('PATCH', '/api/configuracion', {
          cookie: cookies.admin,
          cuerpo: { toleranciaTardanzaMinutos: 0 },
        });

        expect(cambio.status).toBe(200);
        const [fila] = await asistenciasDe(esc.e.A.id, alumno.alumnoId);
        expect(fila?.estado_llegada, 'lo registrado no cambia').toBe('PUNTUAL');
        expect(fila?.id).toBe(registrada.asistencia.id);
      });
    });

    describe('cada academia con su tolerancia', () => {
      it('criterio 10: a las 18:20, con 0 minutos en A y 30 en B, el alumno de A llega tarde y el de B, puntual (la tolerancia sale de la academia de la sesión)', async () => {
        await fijarConfiguracion(esc.e.A.id, { toleranciaTardanzaMinutos: 0 });
        await fijarConfiguracion(esc.e.B.id, { toleranciaTardanzaMinutos: 30 });
        const deA = await crearAlumnoDeAsistencia(ctx, esc);
        const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' });
        const cookies = en(ctx, esc, enLima(LUNES, '18:20'));

        const resultadoA = resultadoDe(await marcar(ctx, 'QR', cookies.secretaria, deA), 201);
        const resultadoB = resultadoDe(await marcar(ctx, 'QR', cookies.secretariaB, deB), 201);

        expect(resultadoA.asistencia.estadoLlegada).toBe('TARDE');
        expect(resultadoB.asistencia.estadoLlegada).toBe('PUNTUAL');
      });

      it('criterio 10: con las tolerancias al revés (30 en A, 0 en B) los resultados se invierten', async () => {
        await fijarConfiguracion(esc.e.A.id, { toleranciaTardanzaMinutos: 30 });
        await fijarConfiguracion(esc.e.B.id, { toleranciaTardanzaMinutos: 0 });
        const deA = await crearAlumnoDeAsistencia(ctx, esc);
        const deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B' });
        const cookies = en(ctx, esc, enLima(LUNES, '18:20'));

        const resultadoA = resultadoDe(await marcar(ctx, 'MANUAL', cookies.secretaria, deA), 201);
        const resultadoB = resultadoDe(await marcar(ctx, 'MANUAL', cookies.secretariaB, deB), 201);

        expect(resultadoA.asistencia.estadoLlegada).toBe('PUNTUAL');
        expect(resultadoB.asistencia.estadoLlegada).toBe('TARDE');
      });
    });
  },
);
