// spec: 010d-inscripcion-mes-siguiente (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  cargarContratosDe010d,
  cuposDe,
  type EscenarioMesSiguiente,
  INSTANTE,
  MES_DIC,
  MES_NOV,
  pedirFormulario,
  planesDelFormulario,
  prepararEscenarioDeMesSiguiente,
} from '../../utilidades/escenario-mes-siguiente';
import { instantaneaDeLaAcademia } from '../../utilidades/escenario-pagos';
import { DICIEMBRE, NOVIEMBRE, sembrarMatriculaDelMes, sembrarTitulares } from '../../utilidades/escenario-renovacion';
import {
  camposConError,
  codigoDe,
  conRetencion,
  retenerClases,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';
import { crearPlanDePrueba } from '../../utilidades/planes-clases';
import { contarAuditoria } from '../../utilidades/usuarios';

// Criterio 2 (crítico, HU-02, D-06, RN-11, DR-10): `GET /api/a/{nombreCorto}/inscripcion` sin `mes`, o con `?mes=` igual a M, responde exactamente lo del criterio 6 de 005 (mismas claves; `mes` es M). Con `?mes=` igual a M+1 y la ventana abierta responde el
// mismo `respuestaFormularioInscripcionSchema` con `mes` M+1, el `hoy` de Lima, los `planes` disponibles para M+1 (vigentes el día 1, DT-5 de 010) y las `clases` activas con `cuposRestantes` igual al cupo libre para una inscripción nueva en M+1
// (`aforo − ocupación − reservas de prioridad`); las que tienen 0 no aparecen. Con un `mes` bien escrito que no es de inscripción (M+1 fuera de la ventana, M+2, un mes pasado), 200 con `planes: []` y `clases: []`. Un `mes` que no es `AAAA-MM` o que viene repetido: 400
// `SOLICITUD_INVALIDA` con el campo `mes`; los demás parámetros se ignoran. Ejemplo (27/11/2026, N = 5): c (sábado 10:00, aforo 20) con 16 titulares, 2 de ellos ya renovaron diciembre en c y un cliente con una reserva de 24 horas de diciembre en c: `?mes=2026-12`
// muestra c con 3 (`20 − 3 − 14`) y sin `mes`, con 4 (`20 − 16`). Una clase con los lugares libres de diciembre todos apartados no aparece con `?mes=2026-12` aunque sí para noviembre. No escribe, no bloquea y no audita.

const CLAVES_DE_LA_RESPUESTA = ['academia', 'clases', 'consentimientos', 'hoy', 'mes', 'planes'];

describe('GET …/inscripcion con ?mes= (criterio 2)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioMesSiguiente;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeMesSiguiente(ctx);
    en(ctx, esc, INSTANTE.viernes27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;

  /** El ejemplo de la spec: c con 16 titulares, 2 ya renovaron diciembre en c y una reserva de 24 horas de un cliente. Devuelve los titulares. */
  async function ejemploDeLaSpec(): Promise<string[]> {
    const titulares = await sembrarTitulares(A(), esc.planUnDia.id, 16, { claseIds: [esc.c.id] });
    await sembrarMatriculaDelMes(A(), esc.planUnDia.id, titulares.slice(0, 2), [esc.c.id], DICIEMBRE);
    await sembrarSolicitud(A(), {
      planId: esc.planUnDia.id,
      claseIds: [esc.c.id],
      mes: DICIEMBRE,
      ahora: INSTANTE.viernes27,
      clasesTotales: 4,
      clasesPorMesPlan: 4,
      precioPlan: '40.00',
      monto: '40.00',
    });
    return titulares;
  }

  describe('sin `mes` o con M: lo de siempre', () => {
    it('criterio 2: sin `mes` y con `?mes=2026-11` responden lo mismo, con las claves de la 005 y `mes` igual a M', async () => {
      const sin = await pedirFormulario(ctx);
      const conM = await pedirFormulario(ctx, `?mes=${MES_NOV}`);

      expect(sin.status, sin.texto).toBe(200);
      expect(conM.status, conM.texto).toBe(200);
      expect(Object.keys(conM.body ?? {}).sort()).toEqual(CLAVES_DE_LA_RESPUESTA);
      expect(conM.body?.['mes']).toBe(MES_NOV);
      expect(conM.body?.['hoy']).toBe('2026-11-27');
      expect(conM.body).toEqual(sin.body);
      expect(conM.cacheControl).toBe('no-store');
    });

    it('criterio 2: sin `mes`, c muestra `20 − 16` = 4 cupos aunque la ventana esté abierta (las reservas de prioridad no restan al mes en curso)', async () => {
      await ejemploDeLaSpec();

      expect(cuposDe(await pedirFormulario(ctx), esc.c.id)).toBe(4);
      expect(cuposDe(await pedirFormulario(ctx, `?mes=${MES_NOV}`), esc.c.id)).toBe(4);
    });
  });

  describe('con M+1 y la ventana abierta', () => {
    it('criterio 2: responde el mismo `respuestaFormularioInscripcionSchema` con `mes` igual a M+1, el `hoy` de Lima, y sus planes y clases', async () => {
      const { respuestaFormularioInscripcionSchema } = await cargarContratosDe010d();

      const respuesta = await pedirFormulario(ctx, `?mes=${MES_DIC}`);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(CLAVES_DE_LA_RESPUESTA);
      expect(respuestaFormularioInscripcionSchema.safeParse(respuesta.body).success, respuesta.texto).toBe(true);
      expect(respuesta.body?.['mes']).toBe(MES_DIC);
      expect(respuesta.body?.['hoy']).toBe('2026-11-27');
      expect(respuesta.cacheControl).toBe('no-store');
      expect(planesDelFormulario(respuesta).map((plan) => plan['id'])).toContain(esc.e.plan.id);
      expect(cuposDe(respuesta, esc.c.id)).toBe(20);
      expect(cuposDe(respuesta, esc.e.lunes.id)).toBe(20);
    });

    it('criterio 2 (ejemplo): c con 16 titulares, 2 renovados en diciembre y una reserva de 24 horas: `?mes=2026-12` muestra 3 (20 − 3 − 14)', async () => {
      await ejemploDeLaSpec();

      const respuesta = await pedirFormulario(ctx, `?mes=${MES_DIC}`);

      expect(cuposDe(respuesta, esc.c.id)).toBe(3);
    });

    it('criterio 2: una clase con todos sus lugares libres de diciembre apartados no aparece con `?mes=2026-12`, aunque sí para noviembre; cuando un titular renueva en otra clase, el lugar se libera y la clase vuelve a aparecer', async () => {
      // c: 20 titulares de 20. En noviembre está llena y en diciembre sus 20 lugares están apartados: no aparece en ninguno.
      const titulares = await sembrarTitulares(A(), esc.planUnDia.id, 20, { claseIds: [esc.c.id] });
      // El sábado de las 17:00: 19 titulares y un cliente con una reserva de diciembre. Noviembre: 20 − 19 = 1; diciembre: 20 − 1 − 19 = 0.
      await sembrarTitulares(A(), esc.planUnDia.id, 19, { claseIds: [esc.sabado17.id] });
      await sembrarSolicitud(A(), {
        planId: esc.planUnDia.id,
        claseIds: [esc.sabado17.id],
        mes: DICIEMBRE,
        ahora: INSTANTE.viernes27,
        clasesTotales: 4,
        clasesPorMesPlan: 4,
        precioPlan: '40.00',
        monto: '40.00',
      });

      const dic = await pedirFormulario(ctx, `?mes=${MES_DIC}`);
      const nov = await pedirFormulario(ctx);

      expect(cuposDe(dic, esc.c.id), 'c: sus 20 lugares de diciembre están apartados').toBeUndefined();
      expect(cuposDe(nov, esc.c.id), 'c está llena en noviembre').toBeUndefined();
      expect(cuposDe(nov, esc.sabado17.id), 'el sábado de las 17:00 tiene 1 cupo en noviembre').toBe(1);
      expect(
        cuposDe(dic, esc.sabado17.id),
        'el sábado de las 17:00: el único lugar libre de diciembre está apartado',
      ).toBeUndefined();

      // Un titular de c renueva diciembre en otra clase: ya no es titular y su lugar queda libre.
      await sembrarMatriculaDelMes(A(), esc.planUnDia.id, [titulares[0] as string], [esc.martes10.id], DICIEMBRE);
      const despues = await pedirFormulario(ctx, `?mes=${MES_DIC}`);
      expect(cuposDe(despues, esc.c.id)).toBe(1);
    });

    it('criterio 2: los planes son los vigentes el día 1 de diciembre: uno que vence el 30/11 no aparece y uno que empieza el 1/12 sí; con `?mes=` igual a M pasa lo contrario', async () => {
      const venceElTreinta = await crearPlanDePrueba(A(), {
        nombre: 'Vence el 30/11',
        veces_por_semana: 3,
        clases_por_mes: 12,
        precio: '120.00',
        dias_permitidos: [1, 3, 5],
        franjas_permitidas: ['18:00'],
        niveles_aplicables: ['BASICO'],
        vigencia_fin: '2026-11-30',
      });
      const empiezaElPrimero = await crearPlanDePrueba(A(), {
        nombre: 'Empieza el 1/12',
        veces_por_semana: 3,
        clases_por_mes: 12,
        precio: '130.00',
        dias_permitidos: [1, 3, 5],
        franjas_permitidas: ['18:00'],
        niveles_aplicables: ['BASICO'],
        vigencia_inicio: '2026-12-01',
      });

      const idsDe = (respuesta: Parameters<typeof planesDelFormulario>[0]) =>
        planesDelFormulario(respuesta).map((plan) => plan['id']);
      const dic = idsDe(await pedirFormulario(ctx, `?mes=${MES_DIC}`));
      const nov = idsDe(await pedirFormulario(ctx, `?mes=${MES_NOV}`));

      expect(dic).toContain(empiezaElPrimero.id);
      expect(dic).not.toContain(venceElTreinta.id);
      expect(nov).toContain(venceElTreinta.id);
      expect(nov).not.toContain(empiezaElPrimero.id);
    });
  });

  describe('un `mes` que no es de inscripción', () => {
    it.each([
      ['M+1 fuera de la ventana (el 21/11)', '2026-12', new Date('2026-11-21T15:00:00.000Z')],
      ['M+2 (enero de 2027) con la ventana abierta', '2027-01', INSTANTE.viernes27],
      ['un mes pasado (octubre)', '2026-10', INSTANTE.viernes27],
      ['un año lejano', '2031-11', INSTANTE.viernes27],
    ])('criterio 2: %s responde 200 con `planes: []` y `clases: []`', async (_nombre, mes, instante) => {
      en(ctx, esc, instante);

      const respuesta = await pedirFormulario(ctx, `?mes=${mes}`);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.body?.['planes']).toEqual([]);
      expect(respuesta.body?.['clases']).toEqual([]);
      expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(CLAVES_DE_LA_RESPUESTA);
    });
  });

  describe('un `mes` mal escrito o repetido', () => {
    it.each([
      ['sin guion', '?mes=202612'],
      ['con un solo dígito de mes', '?mes=2026-1'],
      ['el mes 13', '?mes=2026-13'],
      ['el mes 00', '?mes=2026-00'],
      ['con día', '?mes=2026-12-01'],
      ['vacío', '?mes='],
      ['con texto', '?mes=diciembre'],
      ['repetido', '?mes=2026-11&mes=2026-12'],
      ['repetido con el mismo valor', '?mes=2026-12&mes=2026-12'],
    ])('criterio 2: %s responde 400 SOLICITUD_INVALIDA con el campo `mes` y no escribe', async (_nombre, consulta) => {
      const antes = await instantaneaDeLaAcademia(A());

      const respuesta = await pedirFormulario(ctx, consulta);

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
      expect(camposConError(respuesta)).toContain('mes');
      expect(await instantaneaDeLaAcademia(A())).toBe(antes);
    });

    it('criterio 2: los demás parámetros se ignoran (también con un `mes` válido): `?academiaId=…&x=1&mes=2026-12` responde lo de diciembre de A', async () => {
      const respuesta = await pedirFormulario(ctx, `?academiaId=${esc.e.B.id}&x=1&mes=${MES_DIC}`);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.body?.['mes']).toBe(MES_DIC);
      expect(respuesta.body?.['academia']).toMatchObject({ nombre: 'Academia A' });
    });
  });

  describe('no escribe, no bloquea y no audita', () => {
    it('criterio 2: la lectura de M+1 no cambia ninguna tabla, no audita y no envía correo', async () => {
      await ejemploDeLaSpec();
      const antes = await instantaneaDeLaAcademia(A());
      const auditoria = await contarAuditoria(A());

      const respuesta = await pedirFormulario(ctx, `?mes=${MES_DIC}`);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(await instantaneaDeLaAcademia(A())).toBe(antes);
      expect(await contarAuditoria(A())).toBe(auditoria);
      expect(ctx.correo.mensajes).toEqual([]);
    });

    it('criterio 2: la lectura de M+1 no espera el bloqueo de las clases que retiene otra transacción', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: A(),
        retener: retenerClases([esc.c.id, esc.e.lunes.id], A()),
        enviar: [() => pedirFormulario(ctx, `?mes=${MES_DIC}`)],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'la lectura del formulario no debe esperar a las clases').toBe(false);
      expect(resultados[0]?.status, resultados[0]?.texto).toBe(200);
    });
  });

  it('criterio 2: noviembre sigue igual en la misma base: la ocupación de noviembre cuenta solo matrículas de noviembre', async () => {
    await sembrarTitulares(A(), esc.planUnDia.id, 5, { claseIds: [esc.c.id], mes: NOVIEMBRE });
    await sembrarTitulares(A(), esc.planUnDia.id, 3, { claseIds: [esc.c.id], mes: DICIEMBRE });

    const nov = await pedirFormulario(ctx);
    const dic = await pedirFormulario(ctx, `?mes=${MES_DIC}`);

    expect(cuposDe(nov, esc.c.id), '20 − 5 de noviembre').toBe(15);
    // Diciembre: 3 ocupan y 5 titulares de noviembre (alumnos no renovados) reservan: 20 − 3 − 5.
    expect(cuposDe(dic, esc.c.id)).toBe(12);
  });
});
