// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { enLima, leerCajas, leerMovimientos } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  cambiarMatricula,
  crearAlumnoConPagoEnVerificacion,
  desactivarClase,
  en,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, cambiarAlumno, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  ACCION_HORARIO,
  cambiarHorario,
  cambioDe,
  CLAVES_DE_LA_MATRICULA,
  CLAVES_DE_LA_RESPUESTA,
  cargarContratosDe010c,
  clasesDeLaMatricula,
  cuerpoHorario,
  crearAlumnoDeHorario,
  crearAlumnoPagadoDeHorario,
  type EscenarioDeHorario,
  filasDeClases,
  idsDeClases,
  instantaneaDeHorario,
  ordenados,
  prepararEscenarioDeHorario,
  resumen,
  rutaHorario,
} from '../../utilidades/escenario-horario';
import {
  DICIEMBRE,
  INSTANTES,
  matriculaDelMes,
  NOVIEMBRE,
  registrarRenovacion,
  renovacionDe,
  sembrarMatriculaDelMes,
} from '../../utilidades/escenario-renovacion';
import { leerMatriculas } from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';

// Criterio 35 (crítico, HU-03, RN-08): `POST /api/matriculas/{id}/horario` con `cambiarHorarioSchema` (`{ claseIds, motivo }`, estricto; motivo de 3 a 200 caracteres visibles) cambia las clases de una matrícula de un alumno (no `CLIENTE`) que es de M o de M+1 y está `VIGENTE` o en verificación; las demás (`FINALIZADA`, `CANCELADA`,
// de otro mes, una reserva de 24 horas) responden 409 `MATRICULA_NO_MODIFICABLE`. Las clases nuevas cumplen el criterio 4 con el plan de la matrícula tal como está hoy y el nivel actual del alumno (DT-20). Borra las filas de las clases que salen e inserta las que entran con `agregada_en` = «ahora»; las que se quedan no
// cambian. Responde 200 con `{ matricula }` (`id`, `mes`, `clases`, `clasesTotales`, `clasesUsadas` y `ocurrenciasRestantes`: las clases del nuevo horario que quedan en el mes desde «ahora»).
// Criterio 37 (prueba obligatoria, DR-9, DT-16): el cambio no toca `clases_totales`, `clases_usadas`, `monto_calculado`, los pagos ni la caja; si las clases pedidas son las que ya tiene, responde 200 sin escribir ni auditar (un doble clic no duplica nada).
// Lecturas estrictas elegidas: (1) «ahora» es `RELOJ` (jueves 26/11/2026 a las 10:00 de Lima, dentro de la ventana de renovación de diciembre con N = 5) y `agregada_en` es exactamente ese instante; (2) `ocurrenciasRestantes` cuenta las ocurrencias de las clases del nuevo horario cuyo inicio es posterior a «ahora»
// y que caen hasta el último día de la matrícula (la regla de «ocurrencia incluida» del criterio 38: una clase que ya empezó no cuenta); con las clases de los lunes de 17:00, miércoles y viernes de 18:00 desde el jueves 26/11 a las 10:00 quedan 2 (el viernes 27 y el lunes 30), y en diciembre, 13; (3) las clases de la respuesta pueden
// venir como objetos con `id` (como en la renovación) o como ids: se comparan por id; (4) «reserva de 24 horas» de un alumno que no es `CLIENTE` es una matrícula `RESERVADA` con `reserva_vence_en` y con solicitud (el de un `CLIENTE` es 404, criterio 41); (5) cualquier rechazo (400, 404, 409) deja la base y la auditoría como estaban;
// (6) «las mismas clases» se compara como conjunto (el orden de `claseIds` no importa).

const CAMBIO_LUNES_A_LUNES17 = (esc: EscenarioDeHorario) => [esc.e.lunes17.id, esc.e.miercoles.id, esc.e.viernes.id];

describe('el cambio de horario (criterio 35)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeHorario;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeHorario(ctx);
    cookies = en(ctx, esc, INSTANTES.jueves26);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const clasesDeNoviembre = () => ordenados([esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id]);

  describe('lo que cambia y lo que responde', () => {
    it.each([
      ['la secretaria', 'secretaria'],
      ['el administrador', 'admin'],
    ] as const)(
      'criterio 35: %s cambia el lunes de las 18:00 por el de las 17:00 en la matrícula VIGENTE de noviembre: 200 con {matricula} (id, mes, clases, clasesTotales, clasesUsadas y ocurrenciasRestantes)',
      async (_nombre, rol) => {
        const alumno = await crearAlumnoDeHorario(ctx, esc);

        const respuesta = await cambiarHorario(ctx, cookies[rol], alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc));

        const cambio = cambioDe(respuesta);
        expect(Object.keys(cambio).sort()).toEqual(CLAVES_DE_LA_RESPUESTA);
        expect(Object.keys(cambio.matricula).sort()).toEqual(CLAVES_DE_LA_MATRICULA);
        expect(cambio.matricula).toMatchObject({
          id: alumno.matriculaId,
          mes: '2026-11',
          clasesTotales: 12,
          clasesUsadas: 0,
          ocurrenciasRestantes: 2,
        });
        expect(idsDeClases(cambio.matricula.clases)).toEqual(ordenados(CAMBIO_LUNES_A_LUNES17(esc)));
        expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(ordenados(CAMBIO_LUNES_A_LUNES17(esc)));
      },
    );

    it('criterio 35: la respuesta cumple respuestaCambioHorarioSchema, que es estricto', async () => {
      const { respuestaCambioHorarioSchema } = await cargarContratosDe010c();
      const alumno = await crearAlumnoDeHorario(ctx, esc);

      const respuesta = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc));

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuestaCambioHorarioSchema.safeParse(respuesta.body).success, respuesta.texto).toBe(true);
      expect(
        respuestaCambioHorarioSchema.safeParse({
          ...respuesta.body,
          dni: '45612378',
        }).success,
        'un campo de más en la respuesta',
      ).toBe(false);
    });

    it('criterio 35: la respuesta no lleva DNI, nombres, apellidos, datos del plan ni del pago', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);

      const respuesta = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc));

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.texto).not.toContain(alumno.dni);
      expect(respuesta.texto).not.toMatch(/Valeria|Mendoza|monto|precio|pago/i);
    });

    it('criterio 35: borra la fila de la clase que sale e inserta la que entra con agregada_en = «ahora»; las que se quedan no cambian (siguen con agregada_en nula)', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);

      cambioDe(await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc)));

      const filas = await filasDeClases(A(), alumno.matriculaId);
      expect(filas.map((fila) => fila.clase_id)).toEqual(ordenados(CAMBIO_LUNES_A_LUNES17(esc)));
      const porClase = new Map(filas.map((fila) => [fila.clase_id, fila.agregada_en]));
      expect(porClase.get(esc.e.lunes17.id)?.toISOString()).toBe(INSTANTES.jueves26.toISOString());
      expect(porClase.get(esc.e.miercoles.id), 'el miércoles se queda: sigue con agregada_en nula').toBeNull();
      expect(porClase.get(esc.e.viernes.id), 'el viernes se queda: sigue con agregada_en nula').toBeNull();
      expect(porClase.has(esc.e.lunes.id), 'el lunes de las 18:00 salió').toBe(false);
    });

    it('criterio 35: un segundo cambio conserva la agregada_en de la clase que ya había entrado y le pone «ahora» solo a la nueva', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      cambioDe(await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc)));
      const viernes = en(ctx, esc, INSTANTES.viernes27);

      cambioDe(
        await cambiarHorario(ctx, viernes.secretaria, alumno.matriculaId, [
          esc.e.lunes17.id,
          esc.miercoles19.id,
          esc.e.viernes.id,
        ]),
      );

      const porClase = new Map(
        (await filasDeClases(A(), alumno.matriculaId)).map((fila) => [fila.clase_id, fila.agregada_en]),
      );
      expect([...porClase.keys()].sort()).toEqual(ordenados([esc.e.lunes17.id, esc.miercoles19.id, esc.e.viernes.id]));
      expect(porClase.get(esc.e.lunes17.id)?.toISOString(), 'la que ya había entrado la conserva').toBe(
        INSTANTES.jueves26.toISOString(),
      );
      expect(porClase.get(esc.miercoles19.id)?.toISOString()).toBe(INSTANTES.viernes27.toISOString());
      expect(porClase.get(esc.e.viernes.id)).toBeNull();
    });

    it('criterio 35: cambia dos clases a la vez y deja las demás matrículas del alumno y de otros alumnos como estaban', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const otro = await crearAlumnoDeHorario(ctx, esc);

      cambioDe(
        await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [
          esc.e.lunes17.id,
          esc.miercoles19.id,
          esc.e.viernes.id,
        ]),
      );

      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(
        ordenados([esc.e.lunes17.id, esc.miercoles19.id, esc.e.viernes.id]),
      );
      expect(await clasesDeLaMatricula(A(), otro.matriculaId), 'la matrícula de otro alumno no cambia').toEqual(
        clasesDeNoviembre(),
      );
    });

    it.each([
      ['las 19:05 del último día del mes, sin clases que queden', enLima('2026-11-30', '19:05'), 0],
      [
        'las 16:00 del último día del mes, con el lunes de las 17:00 todavía por venir',
        enLima('2026-11-30', '16:00'),
        1,
      ],
    ])(
      'criterio 35: ocurrenciasRestantes en el último día de noviembre (%s) es %i',
      async (_nombre, instante, restantes) => {
        const alumno = await crearAlumnoDeHorario(ctx, esc);
        const galletas = en(ctx, esc, instante);

        const cambio = cambioDe(
          await cambiarHorario(ctx, galletas.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc)),
        );

        expect(cambio.matricula.ocurrenciasRestantes).toBe(restantes);
        expect(cambio.matricula.clasesTotales, 'no cambia las clases que le quedan al alumno').toBe(12);
      },
    );
  });

  describe('la matrícula de M+1 (diciembre) y las que están en verificación', () => {
    it('criterio 35: la matrícula VIGENTE de diciembre (M+1 en la ventana) se cambia: mes 2026-12 y 13 ocurrencias restantes (lunes, miércoles y viernes de diciembre)', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc, { mes: DICIEMBRE });
      const galletas = en(ctx, esc, INSTANTES.viernes27);

      const cambio = cambioDe(
        await cambiarHorario(ctx, galletas.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc)),
      );

      expect(cambio.matricula).toMatchObject({ id: alumno.matriculaId, mes: '2026-12', ocurrenciasRestantes: 13 });
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(ordenados(CAMBIO_LUNES_A_LUNES17(esc)));
      expect(
        (await filasDeClases(A(), alumno.matriculaId))
          .find((fila) => fila.clase_id === esc.e.lunes17.id)
          ?.agregada_en?.toISOString(),
      ).toBe(INSTANTES.viernes27.toISOString());
    });

    it('criterio 35: la renovación de diciembre por Yape (en verificación) también se cambia, y su pago sigue pendiente y sin cambios', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const galletas = en(ctx, esc, INSTANTES.viernes27);
      const renovacion = renovacionDe(
        (await registrarRenovacion(ctx, esc, 'YAPE', galletas.secretaria, alumno.alumnoId)).respuesta,
      );
      expect(renovacion.renovacion.estado).toBe('EN_VERIFICACION');
      const pagosAntes = JSON.stringify(await leerPagos(A()));

      const cambio = cambioDe(
        await cambiarHorario(ctx, galletas.admin, renovacion.renovacion.matriculaId, CAMBIO_LUNES_A_LUNES17(esc)),
      );

      expect(cambio.matricula).toMatchObject({ id: renovacion.renovacion.matriculaId, mes: '2026-12' });
      expect(await clasesDeLaMatricula(A(), renovacion.renovacion.matriculaId)).toEqual(
        ordenados(CAMBIO_LUNES_A_LUNES17(esc)),
      );
      expect(JSON.stringify(await leerPagos(A())), 'el pago en verificación no cambia').toBe(pagosAntes);
      expect((await matriculaDelMes(A(), alumno.alumnoId, NOVIEMBRE)).clases, 'la de noviembre no cambia').toEqual(
        clasesDeNoviembre(),
      );
    });

    it('criterio 35: la mensualidad de noviembre en verificación (renovación tardía por Yape sin aprobar) también se cambia', async () => {
      const alumno = await crearAlumnoConPagoEnVerificacion(ctx, esc, {
        claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
      });

      const cambio = cambioDe(
        await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc)),
      );

      expect(cambio.matricula).toMatchObject({ id: alumno.matriculaId, mes: '2026-11' });
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(ordenados(CAMBIO_LUNES_A_LUNES17(esc)));
      const [pago] = (await leerPagos(A())).filter((p) => p.matricula_id === alumno.matriculaId);
      expect(pago?.estado, 'el pago sigue pendiente de verificación').toBe('PENDIENTE_VERIFICACION');
    });
  });

  describe('las matrículas que no se pueden cambiar (409 MATRICULA_NO_MODIFICABLE)', () => {
    type Cual = 'finalizada' | 'cancelada' | 'deOctubre' | 'deEnero' | 'reserva';

    /** La matrícula de noviembre (o la del mes dado) de un alumno nuevo, dejada en el estado que pide el caso. */
    async function matricula(cual: Cual): Promise<string> {
      if (cual === 'deOctubre')
        return (await crearAlumnoDeHorario(ctx, esc, { mes: { anio: 2026, mes: 10 } })).matriculaId;
      if (cual === 'deEnero')
        return (await crearAlumnoDeHorario(ctx, esc, { mes: { anio: 2027, mes: 1 } })).matriculaId;
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      if (cual === 'reserva') {
        await cambiarMatricula(A(), alumno.matriculaId, {
          estado: 'RESERVADA',
          reserva_vence_en: new Date(INSTANTES.jueves26.getTime() + 24 * 60 * 60 * 1000),
        });
      } else {
        await cambiarMatricula(A(), alumno.matriculaId, { estado: cual === 'finalizada' ? 'FINALIZADA' : 'CANCELADA' });
      }
      return alumno.matriculaId;
    }

    it.each([
      ['FINALIZADA de noviembre', 'finalizada'],
      ['CANCELADA de noviembre', 'cancelada'],
      ['VIGENTE de octubre (un mes que ya no es M ni M+1)', 'deOctubre'],
      ['VIGENTE de enero de 2027 (dos meses adelante: ni M ni M+1)', 'deEnero'],
      ['una reserva de 24 horas (RESERVADA con vencimiento) de un alumno que no es CLIENTE', 'reserva'],
    ] as const)(
      'criterio 35: la matrícula %s responde 409 MATRICULA_NO_MODIFICABLE y no escribe ni audita',
      async (_nombre, cual) => {
        const matriculaId = await matricula(cual);
        const antes = await instantaneaDeHorario(esc);

        const respuesta = await cambiarHorario(ctx, cookies.secretaria, matriculaId, CAMBIO_LUNES_A_LUNES17(esc));

        expect(resumen(respuesta), respuesta.texto).toEqual([409, 'MATRICULA_NO_MODIFICABLE']);
        expect(await instantaneaDeHorario(esc)).toBe(antes);
        expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).toEqual([]);
      },
    );

    it('criterio 35: la matrícula de diciembre de quien ya la tiene VIGENTE sí se puede cambiar, aunque la de noviembre esté FINALIZADA (control: lo que decide es la matrícula pedida, no el alumno)', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await cambiarMatricula(A(), alumno.matriculaId, { estado: 'FINALIZADA' });
      await sembrarMatriculaDelMes(
        A(),
        esc.e.plan.id,
        [alumno.alumnoId],
        [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
        DICIEMBRE,
      );
      const diciembre = (await leerMatriculas(A())).find(
        (m) => m.alumno_id === alumno.alumnoId && m.anio === 2026 && m.mes === 12,
      );
      const galletas = en(ctx, esc, INSTANTES.viernes27);

      const respuesta = await cambiarHorario(
        ctx,
        galletas.secretaria,
        (diciembre as { id: string }).id,
        CAMBIO_LUNES_A_LUNES17(esc),
      );

      expect(respuesta.status, respuesta.texto).toBe(200);
    });
  });

  describe('las clases nuevas cumplen el criterio 4 con el plan de hoy y el nivel actual del alumno', () => {
    const rechazadas: [string, (e: EscenarioDeHorario) => string[]][] = [
      ['solo dos clases en un plan de tres por semana', (e) => [e.e.lunes17.id, e.e.miercoles.id]],
      [
        'cuatro clases en un plan de tres por semana',
        (e) => [e.e.lunes17.id, e.e.miercoles.id, e.e.viernes.id, e.martes10.id],
      ],
      ['dos clases el mismo día (lunes de 17:00 y de 19:00)', (e) => [e.e.lunes17.id, e.lunes19.id, e.e.viernes.id]],
      ['una clase en un día que el plan no permite (martes)', (e) => [e.e.martes.id, e.e.miercoles.id, e.e.viernes.id]],
      [
        'una clase en una franja que el plan no permite (lunes de 08:00)',
        (e) => [e.e.lunes08.id, e.e.miercoles.id, e.e.viernes.id],
      ],
      [
        'una clase de otro nivel (intermedio) para un alumno básico',
        (e) => [e.e.intermedioLunes.id, e.e.miercoles.id, e.e.viernes.id],
      ],
      ['una clase que no existe', () => [randomUUID(), randomUUID(), randomUUID()]],
    ];

    it.each(rechazadas)(
      'criterio 35: %s responde 409 SELECCION_NO_VALIDA y no escribe ni audita',
      async (_nombre, clases) => {
        const alumno = await crearAlumnoDeHorario(ctx, esc);
        const antes = await instantaneaDeHorario(esc);

        const respuesta = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, clases(esc));

        expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
        expect(await instantaneaDeHorario(esc)).toBe(antes);
        expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).toEqual([]);
      },
    );

    it('criterio 35: una clase desactivada responde 409 SELECCION_NO_VALIDA', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await desactivarClase(A(), esc.e.lunes17.id);

      const respuesta = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc));

      expect(resumen(respuesta), respuesta.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(clasesDeNoviembre());
    });

    it('criterio 35: vale el plan tal como está hoy: si el plan ya no permite la franja de las 17:00, el lunes de las 17:00 se rechaza y el de las 19:00 se acepta', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await ejecutarComo(
        'propietario',
        `UPDATE planes SET franjas_permitidas = ARRAY['18:00', '19:00']::time(0)[] WHERE academia_id = $1::uuid AND id = $2::uuid`,
        [A(), esc.e.plan.id],
        { academiaId: A() },
      );

      const rechazado = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc));
      const aceptado = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [
        esc.lunes19.id,
        esc.e.miercoles.id,
        esc.e.viernes.id,
      ]);

      expect(resumen(rechazado), rechazado.texto).toEqual([409, 'SELECCION_NO_VALIDA']);
      expect(aceptado.status, aceptado.texto).toBe(200);
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(
        ordenados([esc.lunes19.id, esc.e.miercoles.id, esc.e.viernes.id]),
      );
    });

    it('criterio 35: vale el nivel actual del alumno: pasó a intermedio y su matrícula es de una clase por semana; la clase intermedia se acepta y la básica se rechaza', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc, { plan: esc.planUnDia, claseIds: [esc.sabado17.id] });
      const antesDelNivel = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [
        esc.e.intermedioLunes.id,
      ]);
      await cambiarAlumno(A(), alumno.alumnoId, { nivel: 'INTERMEDIO' });

      const basica = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [esc.e.lunes17.id]);
      const intermedia = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [esc.e.intermedioLunes.id]);

      expect(resumen(antesDelNivel), 'siendo básico, la clase intermedia no es suya').toEqual([
        409,
        'SELECCION_NO_VALIDA',
      ]);
      expect(resumen(basica), 'siendo intermedio, la clase básica ya no es suya').toEqual([409, 'SELECCION_NO_VALIDA']);
      expect(intermedia.status, intermedia.texto).toBe(200);
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual([esc.e.intermedioLunes.id]);
    });

    it('criterio 35: con un plan de una clase por semana, el cambio de una sola clase por otra del mismo día y de otro día se acepta (con un solo id)', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc, { plan: esc.planUnDia, claseIds: [esc.sabado17.id] });

      const aOtroDia = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [esc.martes10.id]);
      const aOtraHora = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, [esc.e.martes.id]);

      expect(aOtroDia.status, aOtroDia.texto).toBe(200);
      expect(aOtraHora.status, aOtraHora.texto).toBe(200);
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual([esc.e.martes.id]);
    });
  });

  describe('el cuerpo (cambiarHorarioSchema, estricto)', () => {
    const CAMPOS_DE_MAS: [string, Record<string, unknown>][] = [
      ['un campo de más (campoDeMas)', { campoDeMas: true }],
      ['un academiaId', { academiaId: '00000000-0000-4000-8000-00000000000b' }],
      ['un alumnoId', { alumnoId: '00000000-0000-4000-8000-00000000000a' }],
      ['un matriculaId', { matriculaId: '00000000-0000-4000-8000-00000000000a' }],
      ['un montoAjustado', { montoAjustado: '10' }],
      ['un planId', { planId: '00000000-0000-4000-8000-00000000000a' }],
    ];
    const INVALIDOS: [string, Record<string, unknown>][] = [
      ['sin motivo', { motivo: undefined }],
      ['un motivo vacío', { motivo: '' }],
      ['un motivo de 2 caracteres', { motivo: 'ab' }],
      ['un motivo de 201 caracteres', { motivo: 'm'.repeat(201) }],
      ['un motivo en blanco', { motivo: '     ' }],
      ['un motivo de espacios de ancho cero', { motivo: '​​​​' }],
      ['un motivo con el patrón Braille en blanco', { motivo: '⠀⠀⠀⠀' }],
      ['un motivo con un carácter de control', { motivo: 'Cambio\u0000' }],
      ['un motivo que no es texto', { motivo: 12345 }],
      ['sin claseIds', { claseIds: undefined }],
      ['claseIds vacío', { claseIds: [] }],
      ['claseIds que no es una lista', { claseIds: 'no-es-una-lista' }],
      ['un claseId que no es UUID', { claseIds: ['no-es-un-uuid'] }],
    ];

    it.each([...CAMPOS_DE_MAS, ...INVALIDOS])(
      'criterio 35: un cuerpo con %s responde 400 SOLICITUD_INVALIDA y no escribe ni audita',
      async (_nombre, sobre) => {
        const alumno = await crearAlumnoDeHorario(ctx, esc);
        const antes = await instantaneaDeHorario(esc);

        const respuesta = await ctx.http.post(
          rutaHorario(alumno.matriculaId),
          cuerpoHorario(CAMBIO_LUNES_A_LUNES17(esc), sobre),
          { cookie: cookies.secretaria },
        );

        expect(resumen(respuesta), respuesta.texto.slice(0, 300)).toEqual([400, 'SOLICITUD_INVALIDA']);
        expect(await instantaneaDeHorario(esc)).toBe(antes);
      },
    );

    it('criterio 35: un cuerpo vacío, sin cuerpo o que no es un objeto responde 400 SOLICITUD_INVALIDA', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);

      const respuestas = [
        await ctx.http.post(rutaHorario(alumno.matriculaId), {}, { cookie: cookies.secretaria }),
        await ctx.http.post(rutaHorario(alumno.matriculaId), undefined, { cookie: cookies.secretaria }),
        await ctx.http.post(rutaHorario(alumno.matriculaId), [], { cookie: cookies.secretaria }),
      ];

      for (const respuesta of respuestas) {
        expect(resumen(respuesta), respuesta.texto.slice(0, 300)).toEqual([400, 'SOLICITUD_INVALIDA']);
      }
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(clasesDeNoviembre());
    });

    it('criterio 35 (control): un motivo de exactamente 3 y de exactamente 200 caracteres visibles se acepta y queda tal cual en la auditoría', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const largo = 'm'.repeat(200);

      const corto = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc), {
        motivo: 'abc',
      });
      const maximo = await cambiarHorario(
        ctx,
        cookies.secretaria,
        alumno.matriculaId,
        [esc.lunes19.id, esc.e.miercoles.id, esc.e.viernes.id],
        { motivo: largo },
      );

      expect(corto.status, corto.texto).toBe(200);
      expect(maximo.status, maximo.texto).toBe(200);
      expect((await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).map((fila) => fila.motivo)).toEqual(['abc', largo]);
    });
  });

  describe('criterio 37: el cambio no toca el dinero ni las clases del mes, y repetirlo no duplica nada', () => {
    const MATRICULA_QUE_NO_CAMBIA = [
      'plan_id',
      'anio',
      'mes',
      'fecha_inicio',
      'fecha_fin',
      'clases_totales',
      'clases_usadas',
      'es_proporcional',
      'precio_plan',
      'clases_por_mes_plan',
      'monto_calculado',
      'monto_ajustado',
      'motivo_ajuste',
      'estado',
    ] as const;

    const dinero = async (matriculaId: string) => {
      const fila = (await leerMatriculas(A())).find((m) => m.id === matriculaId) as unknown as Record<string, unknown>;
      return JSON.stringify({
        matricula: Object.fromEntries(MATRICULA_QUE_NO_CAMBIA.map((columna) => [columna, fila[columna]])),
        pagos: await leerPagos(A()),
        movimientos: await leerMovimientos(A()),
        cajas: await leerCajas(A()),
      });
    };

    it('criterio 37: tras cambiar el horario, clases_totales, clases_usadas, monto_calculado y demás columnas de la matrícula, los pagos y la caja son los mismos (el alumno pagó en efectivo)', async () => {
      const alumno = await crearAlumnoPagadoDeHorario(ctx, esc, {
        clasesUsadas: 3,
        claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
      });
      const antes = await dinero(alumno.matriculaId);
      expect((JSON.parse(antes) as { pagos: unknown[] }).pagos, 'el alumno tiene su pago confirmado').toHaveLength(1);

      const respuesta = await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc));

      expect(cambioDe(respuesta).matricula).toMatchObject({ clasesTotales: 12, clasesUsadas: 3 });
      expect(await dinero(alumno.matriculaId)).toBe(antes);
    });

    it('criterio 37: pedir las clases que ya tiene (en cualquier orden) responde 200 con la matrícula, sin escribir ni auditar', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const antes = await instantaneaDeHorario(esc);

      const respuesta = await cambiarHorario(
        ctx,
        cookies.secretaria,
        alumno.matriculaId,
        [esc.e.viernes.id, esc.e.lunes.id, esc.e.miercoles.id],
        { motivo: 'Un doble clic' },
      );

      const cambio = cambioDe(respuesta);
      expect(cambio.matricula).toMatchObject({
        id: alumno.matriculaId,
        mes: '2026-11',
        clasesTotales: 12,
        clasesUsadas: 0,
      });
      expect(idsDeClases(cambio.matricula.clases)).toEqual(clasesDeNoviembre());
      expect(await instantaneaDeHorario(esc), 'ni una columna ni una fila ni la auditoría cambian').toBe(antes);
      expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).toEqual([]);
    });

    it('criterio 37: repetir el mismo cambio (doble clic) responde 200 las dos veces y deja una sola auditoría y las mismas filas, con la agregada_en de la primera', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      cambioDe(await cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc)));
      const despuesDelPrimero = await instantaneaDeHorario(esc);
      const luego = en(ctx, esc, INSTANTES.viernes27);

      const segundo = await cambiarHorario(ctx, luego.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc));

      expect(segundo.status, segundo.texto).toBe(200);
      expect(await instantaneaDeHorario(esc)).toBe(despuesDelPrimero);
      expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).toHaveLength(1);
    });

    it('criterio 37: dos peticiones iguales a la vez responden 200 las dos, dejan una sola auditoría y la clase agregada una sola vez', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);

      const respuestas = await Promise.all([
        cambiarHorario(ctx, cookies.secretaria, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc)),
        cambiarHorario(ctx, cookies.admin, alumno.matriculaId, CAMBIO_LUNES_A_LUNES17(esc)),
      ]);

      for (const respuesta of respuestas) expect(respuesta.status, respuesta.texto).toBe(200);
      expect(await clasesDeLaMatricula(A(), alumno.matriculaId)).toEqual(ordenados(CAMBIO_LUNES_A_LUNES17(esc)));
      expect(await leerAuditoriaDeAcademia(A(), ACCION_HORARIO)).toHaveLength(1);
    });
  });
});
