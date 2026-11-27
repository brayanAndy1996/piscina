import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enLima, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  DICIEMBRE,
  estadoDeLaMatricula,
  estadoDelAlumno,
  NOVIEMBRE,
  OCTUBRE,
  prepararEscenarioDeCierre,
  sembrarAlumno,
  servicioDeCierre,
} from '../../utilidades/escenario-cierre';
import { lineasJson } from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import { abrirRetenedor } from '../../utilidades/planes-clases';
import { fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Ataque ronda 1 de la 010b, F1 y F2 (no protegidas): (F1) «ahora» se lee por academia, después de los bloqueos: una vuelta que empieza antes de la
// medianoche y llega a una academia después de ella cierra esa academia con el mes nuevo y no deja `ALUMNO_VENCIDO` a quien ya pagó el mes nuevo;
// (F2) una academia que se suspende entre la lista y su turno se salta sin error de nivel 50.

describe('el cierre de mes y el reloj por academia (F1, F2)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet({ nivelRegistro: 'info', destinoRegistro: destino });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeCierre(ctx);
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const orden = (): { primera: 'A' | 'B'; segunda: 'A' | 'B'; idPrimera: string; idSegunda: string } => {
    // Las academias se procesan por id: la prueba retiene un alumno de la primera para que la vuelta espere ahí.
    const [idPrimera, idSegunda] = [esc.e.A.id, esc.e.B.id].sort() as [string, string];
    const letra = (id: string): 'A' | 'B' => (id === esc.e.A.id ? 'A' : 'B');
    return { primera: letra(idPrimera), segunda: letra(idSegunda), idPrimera, idSegunda };
  };
  const errores = () =>
    lineasJson(lineas).filter((registro) => typeof registro['level'] === 'number' && registro['level'] >= 50);

  async function esperarQueLaVueltaEspere(retenedor: Awaited<ReturnType<typeof abrirRetenedor>>): Promise<void> {
    for (let i = 0; i < 150 && (await retenedor.sesionesEsperando()) < 1; i++)
      await new Promise((resolver) => setTimeout(resolver, 20));
    expect(await retenedor.sesionesEsperando(), 'la vuelta debía quedar esperando el bloqueo').toBeGreaterThanOrEqual(
      1,
    );
  }

  it('F1: la vuelta sin argumento que empieza a las 23:59:59.900 y llega a la segunda academia a las 00:00:01 la cierra con diciembre: quien ya pagó diciembre sigue ALUMNO_ACTIVO', async () => {
    const { primera, segunda, idPrimera } = orden();
    const retenido = await sembrarAlumno(esc, {
      academia: primera,
      estado: 'ALUMNO_ACTIVO',
      matriculas: [
        { mes: OCTUBRE, estado: 'VIGENTE' },
        { mes: NOVIEMBRE, estado: 'VIGENTE' },
      ],
    });
    const quePago = await sembrarAlumno(esc, {
      academia: segunda,
      estado: 'ALUMNO_VENCIDO',
      matriculas: [
        { mes: OCTUBRE, estado: 'FINALIZADA' },
        { mes: DICIEMBRE, estado: 'RESERVADA' },
      ],
    });
    ctx.reloj.fijar(enLima('2026-11-30', '23:59:59.900'));
    const retenedor = await abrirRetenedor(idPrimera);
    try {
      await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
        idPrimera,
        retenido.alumnoId,
      ]);
      // Como la tarea: sin argumento, con el reloj de la aplicación.
      const vuelta = ((await servicioDeCierre(ctx.app)) as unknown as { cerrar(): Promise<unknown> }).cerrar();
      await esperarQueLaVueltaEspere(retenedor);
      // Ya es el 1/12: se aprueba el Yape de diciembre (matrícula VIGENTE y el alumno ALUMNO_ACTIVO, porque diciembre ya es M).
      ctx.reloj.fijar(enLima('2026-12-01', '00:00:01'));
      await ejecutarComo(
        'propietario',
        `UPDATE matriculas SET estado = 'VIGENTE' WHERE academia_id = $1::uuid AND id = $2::uuid`,
        [quePago.academiaId, quePago.matriculaIds[1]],
        { academiaId: quePago.academiaId },
      );
      await ejecutarComo(
        'propietario',
        `UPDATE alumnos SET estado = 'ALUMNO_ACTIVO' WHERE academia_id = $1::uuid AND id = $2::uuid`,
        [quePago.academiaId, quePago.alumnoId],
        { academiaId: quePago.academiaId },
      );
      await retenedor.liberar('COMMIT');
      await vuelta;
    } finally {
      await retenedor.liberar('ROLLBACK');
    }

    expect(await estadoDelAlumno(quePago.academiaId, quePago.alumnoId), 'el que pagó diciembre').toBe('ALUMNO_ACTIVO');
    expect(await estadoDeLaMatricula(quePago.academiaId, quePago.alumnoId, DICIEMBRE)).toBe('VIGENTE');
    // La primera academia también se escribió con «ahora» posterior a los bloqueos: ya es diciembre y noviembre se finaliza.
    expect(await estadoDeLaMatricula(retenido.academiaId, retenido.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
    expect(await estadoDelAlumno(retenido.academiaId, retenido.alumnoId)).toBe('ALUMNO_VENCIDO');
    expect(errores()).toEqual([]);
  });

  it('F1: con un «ahora» explícito se respeta ese instante aunque el reloj diga otra cosa (el 30/11 a las 23:59:59.999 no cierra noviembre)', async () => {
    const alumno = await sembrarAlumno(esc, {
      estado: 'ALUMNO_ACTIVO',
      matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
    });
    ctx.reloj.fijar(enLima('2026-12-05', '10:00'));

    await (await servicioDeCierre(ctx.app)).cerrar(enLima('2026-11-30', '23:59:59.999'));

    expect(await estadoDeLaMatricula(alumno.academiaId, alumno.alumnoId, NOVIEMBRE)).toBe('VIGENTE');
    expect(await estadoDelAlumno(alumno.academiaId, alumno.alumnoId)).toBe('ALUMNO_ACTIVO');
  });

  it('F2: la academia que se suspende entre la lista y su turno se salta: sin error de nivel 50, la otra se cierra y la suspendida queda intacta', async () => {
    const { primera, segunda, idPrimera, idSegunda } = orden();
    const retenido = await sembrarAlumno(esc, {
      academia: primera,
      estado: 'ALUMNO_ACTIVO',
      matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
    });
    const deLaSuspendida = await sembrarAlumno(esc, {
      academia: segunda,
      estado: 'ALUMNO_ACTIVO',
      matriculas: [{ mes: NOVIEMBRE, estado: 'VIGENTE' }],
    });
    const retenedor = await abrirRetenedor(idPrimera);
    try {
      await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
        idPrimera,
        retenido.alumnoId,
      ]);
      const vuelta = (await servicioDeCierre(ctx.app)).cerrar(enLima('2026-12-01', '00:00:00.000'));
      await esperarQueLaVueltaEspere(retenedor);
      await fijarEstadoDeAcademia(idSegunda, 'SUSPENDIDA');
      await retenedor.liberar('COMMIT');
      await vuelta;
    } finally {
      await retenedor.liberar('ROLLBACK');
      await fijarEstadoDeAcademia(idSegunda, 'ACTIVA');
    }

    expect(errores(), 'una academia suspendida a mitad de la vuelta no es un error').toEqual([]);
    expect(await estadoDeLaMatricula(retenido.academiaId, retenido.alumnoId, NOVIEMBRE)).toBe('FINALIZADA');
    expect(await estadoDeLaMatricula(deLaSuspendida.academiaId, deLaSuspendida.alumnoId, NOVIEMBRE)).toBe('VIGENTE');
  });
});
