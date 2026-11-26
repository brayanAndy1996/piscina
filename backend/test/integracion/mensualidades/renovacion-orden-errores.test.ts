// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, cambiarAlumno, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  abrirCajaPara,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  detallesDe,
  INSTANTES,
  instantaneaDeRenovacion,
  MES_ENERO,
  MES_NOVIEMBRE,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
  resumen,
  sembrarMatriculaDelMes,
  type OpcionesDeRegistro,
  type Via,
} from '../../utilidades/escenario-renovacion';
import { sembrarCobrable } from '../../utilidades/escenario-pagos';
import { llenarClase } from '../../utilidades/inscripciones';
import { crearPlanDePrueba } from '../../utilidades/planes-clases';
import { enLima } from '../../utilidades/caja';
import { sembrarEnVerificacion } from '../../utilidades/escenario-pagos-007b';
import { png } from '../../utilidades/inscripciones-005b';

// Criterio 8 (crítico, HU-12): en las dos rutas, la primera que falla decide: 401 `NO_AUTENTICADO` (actor) → 404 `NO_ENCONTRADO` (id que no es UUID, inexistente, de otra academia o de un `CLIENTE`) → clave (criterio 12) → 409 `ALUMNO_INACTIVO` (DT-19) →
// `MES_NO_PERMITIDO` → `MENSUALIDAD_YA_REGISTRADA` → `PLAN_NO_DISPONIBLE` → `SELECCION_NO_VALIDA` → `SIN_CLASES_EN_EL_MES` → `SIN_CUPO` (con `detalles.claseIds` de las clases sin lugar) → `MONTO_CAMBIO` o `MONTO_DISTINTO` → `FECHA_OPERACION_NO_VALIDA` y
// `NUMERO_OPERACION_YA_USADO` (solo el comprobante) → la caja (solo el efectivo). En el comprobante, los 400 y el 413 del criterio 7 van antes del actor, y la imagen (400 `IMAGEN_NO_VALIDA`) se decide después de una lectura corta (actor, alumno y clave) y
// antes de la transacción de escritura, como en la 008b. Ningún rechazo escribe, audita ni deja archivo.
// Lecturas estrictas elegidas: (1) cada eslabón se prueba contra el siguiente con las dos fallas presentes a la vez (la que va primero gana); `FECHA_OPERACION_NO_VALIDA` y `NUMERO_OPERACION_YA_USADO` están en la misma posición de la lista y no se ordenan entre
// sí; (2) la imagen inválida gana a un mes que no se permite, a un monto distinto y al resto de lo que decide la transacción de escritura, y pierde ante el 404 y ante la clave; (3) con la misma clave y los mismos datos, un reintento con una imagen basura
// responde 200 repetida sin procesar la imagen (el 200 se decide en la lectura corta); (4) `detalles.claseIds` del `SIN_CUPO` lista, ordenadas, solo las clases sin lugar; (5) el estado `INACTIVO` frente a la imagen no se fija aquí (la spec no dice si ese 409 se
// decide en la lectura corta).

const VIAS: Via[] = ['EFECTIVO', 'YAPE'];
const FIN_DE_NOVIEMBRE = enLima('2026-11-30', '20:00');

describe.each(VIAS)('el orden de los errores del registro por %s (criterio 8)', (via) => {
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

  /** Registra y comprueba que el rechazo es el esperado y que no escribió, auditó ni dejó archivos. */
  async function rechaza(
    alumnoId: string,
    opciones: OpcionesDeRegistro,
    esperado: [number, string],
    cookie: string | null = cookies.secretaria,
  ) {
    const antes = await instantaneaDeRenovacion(ctx, esc);
    const { respuesta } = await registrarRenovacion(ctx, esc, via, cookie ?? undefined, alumnoId, opciones);
    expect(resumen(respuesta), respuesta.texto).toEqual(esperado);
    expect(await instantaneaDeRenovacion(ctx, esc), 'un rechazo no escribe, no audita y no deja archivos').toBe(antes);
    return respuesta;
  }

  /** Un pago de renovación ya registrado (de otro alumno) y su clave, para provocar `CLAVE_YA_USADA`. */
  async function claveYaUsada(): Promise<string> {
    const otro = await crearAlumnoDeNoviembre(ctx, esc);
    const { cuerpo, respuesta } = await registrarRenovacion(ctx, esc, via, cookies.secretaria, otro.alumnoId);
    expect(respuesta.status, respuesta.texto).toBe(201);
    return cuerpo['claveIdempotencia'] as string;
  }

  it('criterio 8: 401 NO_AUTENTICADO gana a todo: sin sesión, con un id inexistente, un monto distinto y una cabecera o una imagen inválidas', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);

    await rechaza(
      randomUUID(),
      { total: '1.00', imagen: { datos: null, tipo: 'image/gif' } },
      [401, 'NO_AUTENTICADO'],
      null,
    );
    await rechaza(
      alumno.alumnoId,
      { total: '1.00', imagen: { datos: 'no es json', cuerpo: Buffer.from('basura') } },
      [401, 'NO_AUTENTICADO'],
      'aq_sesion=no-es-un-token',
    );
  });

  describe('404 gana a la clave y a lo que sigue', () => {
    it.each([
      ['un id que no es UUID', 'no-es-un-uuid'],
      ['un id inexistente', '00000000-0000-4000-8000-000000000000'],
    ])(
      'criterio 8: %s con una clave ya usada, un mes que no se permite y un monto distinto: 404 NO_ENCONTRADO',
      async (_nombre, id) => {
        const clave = await claveYaUsada();

        await rechaza(
          id,
          { sobre: { claveIdempotencia: clave, mes: MES_ENERO }, seleccion: { mes: MES_ENERO }, total: '1.00' },
          [404, 'NO_ENCONTRADO'],
        );
      },
    );

    it('criterio 8: un alumno de otra academia o un CLIENTE responde el mismo 404 NO_ENCONTRADO que un id inexistente', async () => {
      const clave = await claveYaUsada();
      const cliente = await sembrarCobrable(esc.e);
      const deB = await crearAlumnoDeNoviembre(ctx, esc, { academia: 'B' });
      const inexistente = await rechaza(randomUUID(), { sobre: { claveIdempotencia: clave } }, [404, 'NO_ENCONTRADO']);

      const comoCliente = await rechaza(cliente.alumnoId, { sobre: { claveIdempotencia: clave }, total: '1.00' }, [
        404,
        'NO_ENCONTRADO',
      ]);
      const otraAcademia = await rechaza(deB.alumnoId, { sobre: { claveIdempotencia: clave } }, [404, 'NO_ENCONTRADO']);

      expect(comoCliente.texto.replaceAll(/[0-9a-f-]{36}/g, '<id>')).toBe(
        inexistente.texto.replaceAll(/[0-9a-f-]{36}/g, '<id>'),
      );
      expect(otraAcademia.texto.replaceAll(/[0-9a-f-]{36}/g, '<id>')).toBe(
        inexistente.texto.replaceAll(/[0-9a-f-]{36}/g, '<id>'),
      );
    });
  });

  it('criterio 8: la clave ya usada (CLAVE_YA_USADA) gana a ALUMNO_INACTIVO, al mes y al monto', async () => {
    const clave = await claveYaUsada();
    const inactivo = await crearAlumnoDeNoviembre(ctx, esc);
    await cambiarAlumno(esc.e.A.id, inactivo.alumnoId, { estado: 'INACTIVO' });

    await rechaza(
      inactivo.alumnoId,
      { sobre: { claveIdempotencia: clave }, seleccion: { mes: MES_ENERO }, total: '1.00' },
      [409, 'CLAVE_YA_USADA'],
    );
  });

  it('criterio 8: ALUMNO_INACTIVO gana al mes, a la selección y al monto', async () => {
    const inactivo = await crearAlumnoDeNoviembre(ctx, esc);
    await cambiarAlumno(esc.e.A.id, inactivo.alumnoId, { estado: 'INACTIVO' });

    await rechaza(inactivo.alumnoId, { seleccion: { mes: MES_ENERO, claseIds: [esc.e.lunes.id] }, total: '1.00' }, [
      409,
      'ALUMNO_INACTIVO',
    ]);
  });

  it('criterio 8: MES_NO_PERMITIDO gana a MENSUALIDAD_YA_REGISTRADA (una matrícula de enero de 2027 ya existe y enero no se permite)', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    await sembrarMatriculaDelMes(esc.e.A.id, esc.e.plan.id, [alumno.alumnoId], [esc.e.lunes.id], {
      anio: 2027,
      mes: 1,
    });

    const respuesta = await rechaza(alumno.alumnoId, { seleccion: { mes: MES_ENERO }, total: '1.00' }, [
      409,
      'MES_NO_PERMITIDO',
    ]);

    expect(detallesDe(respuesta)['mesesPermitidos']).toEqual(['2026-12']);
  });

  it('criterio 8: MENSUALIDAD_YA_REGISTRADA gana al plan, a la selección y al monto', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    await sembrarMatriculaDelMes(esc.e.A.id, esc.e.plan.id, [alumno.alumnoId], [esc.e.lunes.id], {
      anio: 2026,
      mes: 12,
    });

    await rechaza(
      alumno.alumnoId,
      { seleccion: { planId: randomUUID(), claseIds: [esc.e.lunes.id, esc.e.lunes17.id] }, total: '1.00' },
      [409, 'MENSUALIDAD_YA_REGISTRADA'],
    );
  });

  it('criterio 8: PLAN_NO_DISPONIBLE (un plan inactivo) gana a SELECCION_NO_VALIDA y al monto', async () => {
    const inactivo = await crearPlanDePrueba(esc.e.A.id, {
      nombre: 'Plan inactivo',
      veces_por_semana: 3,
      clases_por_mes: 12,
      precio: '120.00',
      dias_permitidos: [1, 3, 5],
      franjas_permitidas: ['17:00', '18:00', '19:00'],
      niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
      activo: false,
    });
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);

    await rechaza(
      alumno.alumnoId,
      {
        seleccion: { planId: inactivo.id, claseIds: [esc.e.lunes.id, esc.e.lunes17.id, esc.e.viernes.id] },
        total: '1.00',
      },
      [409, 'PLAN_NO_DISPONIBLE'],
    );
  });

  it('criterio 8: SELECCION_NO_VALIDA gana a SIN_CLASES_EN_EL_MES, a SIN_CUPO y al monto (el 30/11 a las 20:00 ya no quedan clases en noviembre)', async () => {
    await llenarClase(esc.e.A.id, esc.e.lunes.id, esc.e.plan.id, 20, { mes: { anio: 2026, mes: 11 } });
    const alumno = await crearAlumnoVencido(ctx, esc);
    cookies = en(ctx, esc, FIN_DE_NOVIEMBRE);

    await rechaza(
      alumno.alumnoId,
      {
        seleccion: { mes: MES_NOVIEMBRE, claseIds: [esc.e.lunes.id, esc.e.lunes17.id, esc.e.viernes.id] },
        total: '1.00',
        fechaOperacion: '2026-11-30',
      },
      [409, 'SELECCION_NO_VALIDA'],
      cookies.secretaria,
    );
  });

  it('criterio 8: SIN_CLASES_EN_EL_MES gana a SIN_CUPO y al monto (la clase de noviembre está llena y el 30/11 a las 20:00 ya no quedan clases)', async () => {
    await llenarClase(esc.e.A.id, esc.e.lunes.id, esc.e.plan.id, 20, { mes: { anio: 2026, mes: 11 } });
    const alumno = await crearAlumnoVencido(ctx, esc);
    cookies = en(ctx, esc, FIN_DE_NOVIEMBRE);

    await rechaza(
      alumno.alumnoId,
      { seleccion: { mes: MES_NOVIEMBRE }, total: '1.00', fechaOperacion: '2026-11-30' },
      [409, 'SIN_CLASES_EN_EL_MES'],
      cookies.secretaria,
    );
  });

  describe('SIN_CUPO gana al monto y a todo lo que sigue', () => {
    it('criterio 8: con la clase del lunes llena en diciembre, SIN_CUPO con detalles.claseIds = [lunes], aunque el monto sea distinto, la fecha futura', async () => {
      await llenarClase(esc.e.A.id, esc.e.lunes.id, esc.e.plan.id, 20, { mes: { anio: 2026, mes: 12 } });
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);

      const respuesta = await rechaza(alumno.alumnoId, { total: '1.00', fechaOperacion: '2026-12-31' }, [
        409,
        'SIN_CUPO',
      ]);

      expect(detallesDe(respuesta)['claseIds']).toEqual([esc.e.lunes.id]);
    });

    it('criterio 8: con dos de las tres clases llenas, detalles.claseIds lista solo esas dos, ordenadas', async () => {
      await llenarClase(esc.e.A.id, esc.e.lunes.id, esc.e.plan.id, 20, { mes: { anio: 2026, mes: 12 } });
      await llenarClase(esc.e.A.id, esc.e.viernes.id, esc.e.plan.id, 20, { mes: { anio: 2026, mes: 12 } });
      const alumno = await crearAlumnoVencido(ctx, esc);

      const respuesta = await rechaza(alumno.alumnoId, {}, [409, 'SIN_CUPO']);

      expect(detallesDe(respuesta)['claseIds']).toEqual([esc.e.lunes.id, esc.e.viernes.id].sort());
    });
  });

  if (via === 'EFECTIVO') {
    it('criterio 8: MONTO_CAMBIO gana a la caja: con la caja abierta de otro día y un monto distinto, 409 MONTO_CAMBIO', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      // La caja abierta por `beforeEach` es la del 27/11; el 28/11 todavía está en la ventana y esa caja es de otro día.
      cookies = en(ctx, esc, INSTANTES.sabado28);

      const respuesta = await rechaza(alumno.alumnoId, { total: '1.00' }, [409, 'MONTO_CAMBIO'], cookies.secretaria);

      expect(detallesDe(respuesta)['total']).toBe('120.00');
    });

    it('criterio 8: con el monto correcto y la caja de otro día, 409 CAJA_DE_OTRO_DIA (la caja es lo último)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      cookies = en(ctx, esc, INSTANTES.sabado28);

      await rechaza(alumno.alumnoId, {}, [409, 'CAJA_DE_OTRO_DIA'], cookies.secretaria);
    });
  } else {
    it('criterio 8: MONTO_DISTINTO gana a FECHA_OPERACION_NO_VALIDA y a NUMERO_OPERACION_YA_USADO', async () => {
      await sembrarEnVerificacion(esc.e, { numeroOperacion: '4455' });
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);

      const respuesta = await rechaza(
        alumno.alumnoId,
        { total: '1.00', fechaOperacion: '2026-12-31', sobre: { numeroOperacion: '4455' } },
        [409, 'MONTO_DISTINTO'],
      );

      expect(detallesDe(respuesta)['total']).toBe('120.00');
    });

    it('criterio 8: con el monto correcto, una fecha futura y un número ya usado a la vez, responde uno de los dos 409 que siguen al monto (FECHA_OPERACION_NO_VALIDA o NUMERO_OPERACION_YA_USADO)', async () => {
      await sembrarEnVerificacion(esc.e, { numeroOperacion: '4455' });
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const antes = await instantaneaDeRenovacion(ctx, esc);

      const { respuesta } = await registrarRenovacion(ctx, esc, via, cookies.secretaria, alumno.alumnoId, {
        fechaOperacion: '2026-12-31',
        sobre: { numeroOperacion: '4455' },
      });

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(['FECHA_OPERACION_NO_VALIDA', 'NUMERO_OPERACION_YA_USADO']).toContain(resumen(respuesta)[1]);
      expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
    });

    describe('la imagen se decide después de la lectura corta (actor, alumno y clave) y antes de la transacción de escritura', () => {
      const BASURA = { cuerpo: Buffer.from('esto no es una imagen') };

      it('criterio 8: una imagen inválida gana a un mes que no se permite, a MENSUALIDAD_YA_REGISTRADA, al plan, a la selección y al monto: 400 IMAGEN_NO_VALIDA', async () => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);

        await rechaza(alumno.alumnoId, { seleccion: { mes: MES_ENERO }, total: '1.00', imagen: BASURA }, [
          400,
          'IMAGEN_NO_VALIDA',
        ]);
        await rechaza(
          alumno.alumnoId,
          {
            seleccion: { planId: randomUUID(), claseIds: [esc.e.lunes.id, esc.e.lunes17.id] },
            total: '1.00',
            imagen: BASURA,
          },
          [400, 'IMAGEN_NO_VALIDA'],
        );
        await rechaza(alumno.alumnoId, { total: '1.00', imagen: { cuerpo: png(50, 50) } }, [400, 'IMAGEN_NO_VALIDA']);
      });

      it('criterio 8: una imagen inválida pierde ante el 404 (el alumno no existe) y ante la clave ya usada de otro alumno', async () => {
        const clave = await claveYaUsada();
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);

        await rechaza(randomUUID(), { imagen: BASURA }, [404, 'NO_ENCONTRADO']);
        await rechaza(alumno.alumnoId, { sobre: { claveIdempotencia: clave }, imagen: BASURA }, [
          409,
          'CLAVE_YA_USADA',
        ]);
      });

      it('criterio 8 y 12: con la misma clave y los mismos datos, un reintento con una imagen basura responde 200 repetida sin procesar la imagen y no deja archivo', async () => {
        const alumno = await crearAlumnoDeNoviembre(ctx, esc);
        const primero = await registrarRenovacion(ctx, esc, via, cookies.secretaria, alumno.alumnoId);
        expect(primero.respuesta.status, primero.respuesta.texto).toBe(201);
        const antes = await instantaneaDeRenovacion(ctx, esc);

        const { respuesta } = await registrarRenovacion(ctx, esc, via, cookies.secretaria, alumno.alumnoId, {
          sobre: {
            claveIdempotencia: primero.cuerpo['claveIdempotencia'],
            numeroOperacion: primero.cuerpo['numeroOperacion'],
          },
          imagen: BASURA,
        });

        expect(renovacionDe(respuesta, 200).repetida).toBe(true);
        expect(await instantaneaDeRenovacion(ctx, esc)).toBe(antes);
      });
    });
  }
});
