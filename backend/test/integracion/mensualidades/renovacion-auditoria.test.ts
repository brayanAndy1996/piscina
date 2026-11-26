// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { en, type EscenarioDeAsistencia } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { rutaAprobacion, rutaRechazo } from '../../utilidades/escenario-pagos-007b';
import {
  abrirCajaPara,
  ACCION_RENOVACION,
  crearAlumnoDeNoviembre,
  crearAlumnoVencido,
  INSTANTES,
  MES_DICIEMBRE,
  prepararEscenarioDeRenovacion,
  registrarRenovacion,
  renovacionDe,
  type Via,
} from '../../utilidades/escenario-renovacion';
import { IP_RE, leerAlumnos } from '../../utilidades/inscripciones';

// Criterio 19 (crítico, RN-22, DT-18): cada renovación escribe una sola entrada `RENOVACION_REGISTRADA` (entidad `matricula`, `entidadId` la matrícula, actor `USUARIO`, IP, `datosDespues: { mes, planId, claseIds, clasesTotales, total, metodo, conPrioridad }`), además de
// `PAGO_REGISTRADO` en el efectivo (007a) y `PAGO_APROBADO` o `PAGO_RECHAZADO` al verificar (007b). Sin DNI, nombres ni datos médicos. Un 200 repetido o un rechazo no audita.
// Lecturas estrictas elegidas: (1) `datosDespues` tiene exactamente esas siete claves; `total` es el texto con dos decimales (`120.00`), `claseIds` las clases elegidas y `conPrioridad` los ids de las clases en las que el alumno usó su prioridad (los mismos de la respuesta, criterio 11);
// (2) el comprobante no escribe `PAGO_REGISTRADO` (como la 007b); (3) aprobar o rechazar no escribe otra `RENOVACION_REGISTRADA`; (4) «sin DNI ni nombres» se comprueba con el texto de toda la fila.

const VIAS: Via[] = ['EFECTIVO', 'YAPE', 'TRANSFERENCIA'];

describe('la auditoría de la renovación (criterio 19)', () => {
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

  const clasesDeNoviembre = () => [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id].sort();

  it.each(VIAS)(
    'criterio 19: una renovación por %s escribe una sola RENOVACION_REGISTRADA con la matrícula, el actor, la IP y los datos de la renovación, y nada más de lo suyo',
    async (via) => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const registradosAntes = (await leerAuditoriaDeAcademia(esc.e.A.id, 'PAGO_REGISTRADO')).length;

      const { respuesta } = await registrarRenovacion(ctx, esc, via, cookies.secretaria, alumno.alumnoId);

      const resultado = renovacionDe(respuesta, 201);
      const filas = await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION);
      expect(filas).toHaveLength(1);
      const [fila] = filas;
      expect(fila).toMatchObject({
        accion: ACCION_RENOVACION,
        entidad: 'matricula',
        entidad_id: resultado.renovacion.matriculaId,
        actor_tipo: 'USUARIO',
        actor_id: esc.e.secretariaA.id,
      });
      expect(fila?.ip).toMatch(IP_RE);
      const despues = fila?.datos_despues as Record<string, unknown>;
      expect(Object.keys(despues).sort()).toEqual([
        'claseIds',
        'clasesTotales',
        'conPrioridad',
        'mes',
        'metodo',
        'planId',
        'total',
      ]);
      expect(despues).toMatchObject({
        mes: MES_DICIEMBRE,
        planId: esc.e.plan.id,
        clasesTotales: 12,
        total: '120.00',
        metodo: via,
      });
      expect([...(despues['claseIds'] as string[])].sort()).toEqual(clasesDeNoviembre());
      expect([...(despues['conPrioridad'] as string[])].sort()).toEqual(clasesDeNoviembre());
      const registrados = await leerAuditoriaDeAcademia(esc.e.A.id, 'PAGO_REGISTRADO');
      if (via === 'EFECTIVO') {
        expect(registrados, 'el efectivo también audita el pago (007a)').toHaveLength(registradosAntes + 1);
        expect(registrados.at(-1)).toMatchObject({ entidad: 'pago', entidad_id: resultado.pago.id });
      } else {
        expect(registrados, 'el comprobante no escribe PAGO_REGISTRADO').toHaveLength(registradosAntes);
      }
    },
  );

  it('criterio 19: el alumno sin prioridad (vencido) audita conPrioridad vacío y la renovación tardía de noviembre audita su mes y el total proporcional', async () => {
    const alumno = await crearAlumnoVencido(ctx, esc);

    const { respuesta } = await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
      seleccion: { mes: '2026-11' },
      total: '20.00',
      fechaOperacion: '2026-11-27',
    });

    renovacionDe(respuesta, 201);
    const [fila] = await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION);
    expect(fila?.datos_despues).toMatchObject({
      mes: '2026-11',
      clasesTotales: 2,
      total: '20.00',
      metodo: 'YAPE',
      conPrioridad: [],
    });
  });

  it('criterio 19: la entrada no lleva el DNI, los nombres ni datos médicos del alumno (se comprueba el texto de toda la fila)', async () => {
    const alumno = await crearAlumnoDeNoviembre(ctx, esc);
    const datos = (await leerAlumnos(esc.e.A.id)).find((a) => a.id === alumno.alumnoId);
    const { respuesta } = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId);
    renovacionDe(respuesta, 201);

    const filas = await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION);

    const texto = JSON.stringify(filas);
    expect(texto).not.toContain(alumno.dni);
    expect(texto).not.toContain(datos?.nombres ?? 'sin-nombres');
    expect(texto).not.toContain(datos?.apellidos ?? 'sin-apellidos');
    expect(texto).not.toMatch(/sangre|alergia|enfermedad|medicamento|seguro|emergencia/i);
  });

  describe('lo que no audita', () => {
    it('criterio 19: un 200 repetido no escribe otra entrada (ni RENOVACION_REGISTRADA ni PAGO_REGISTRADO)', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const primero = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId);
      const antes = await leerAuditoriaDeAcademia(esc.e.A.id);

      const segundo = await registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId, {
        sobre: { claveIdempotencia: primero.cuerpo['claveIdempotencia'] },
      });

      expect(segundo.respuesta.status, segundo.respuesta.texto).toBe(200);
      expect(await leerAuditoriaDeAcademia(esc.e.A.id)).toEqual(antes);
    });

    it('criterio 19: ningún rechazo audita: monto distinto, mes que no se permite, mensualidad ya registrada, sin cupo, sin caja, sin permiso y alumno inexistente', async () => {
      const alumno = await crearAlumnoDeNoviembre(ctx, esc);
      const entrenador = en(ctx, esc, INSTANTES.viernes27).entrenador;
      const antes = await leerAuditoriaDeAcademia(esc.e.A.id);

      const intentos = [
        registrarRenovacion(ctx, esc, 'EFECTIVO', cookies.secretaria, alumno.alumnoId, { total: '1.00' }),
        registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, { total: '1.00' }),
        registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, { seleccion: { mes: '2027-01' } }),
        registrarRenovacion(ctx, esc, 'EFECTIVO', entrenador, alumno.alumnoId),
        registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, '00000000-0000-4000-8000-000000000000'),
        registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId, {
          seleccion: { mes: '2026-11' },
          total: '20.00',
        }),
      ];
      const respuestas = await Promise.all(intentos);

      for (const { respuesta } of respuestas) expect(respuesta.status, respuesta.texto).toBeGreaterThanOrEqual(400);
      expect(await leerAuditoriaDeAcademia(esc.e.A.id)).toEqual(antes);
    });

    it('criterio 19: rechazar y aprobar escriben PAGO_RECHAZADO y PAGO_APROBADO (007b), no otra RENOVACION_REGISTRADA, y el rechazo guarda su motivo', async () => {
      const [aprobada, rechazada] = [await crearAlumnoDeNoviembre(ctx, esc), await crearAlumnoDeNoviembre(ctx, esc)];
      const [a, b] = [
        renovacionDe(
          (await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, aprobada.alumnoId)).respuesta,
          201,
        ),
        renovacionDe(
          (await registrarRenovacion(ctx, esc, 'TRANSFERENCIA', cookies.secretaria, rechazada.alumnoId)).respuesta,
          201,
        ),
      ];
      const registradas = (await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION)).length;

      const ok = await ctx.http.post(rutaAprobacion(a.pago.id), {}, { cookie: cookies.secretaria });
      const no = await ctx.http.post(
        rutaRechazo(b.pago.id),
        { motivo: 'La imagen no se lee' },
        { cookie: cookies.secretaria },
      );

      expect(ok.status, ok.texto).toBe(200);
      expect(no.status, no.texto).toBe(200);
      expect(await leerAuditoriaDeAcademia(esc.e.A.id, ACCION_RENOVACION)).toHaveLength(registradas);
      const aprobadas = (await leerAuditoriaDeAcademia(esc.e.A.id, 'PAGO_APROBADO')).filter(
        (f) => f.entidad_id === a.pago.id,
      );
      expect(aprobadas).toHaveLength(1);
      const rechazos = (await leerAuditoriaDeAcademia(esc.e.A.id, 'PAGO_RECHAZADO')).filter(
        (f) => f.entidad_id === b.pago.id,
      );
      expect(rechazos).toHaveLength(1);
      expect(JSON.stringify(rechazos[0])).toContain('La imagen no se lee');
    });
  });
});
