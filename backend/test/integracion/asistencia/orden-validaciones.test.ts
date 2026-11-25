// spec: 009-asistencia (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AppCarnet, cambiarAlumno, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type AlumnoDeAsistencia,
  cambiarMatricula,
  CLAVES_DE_LA_ASISTENCIA_DE_HOY,
  CLAVES_DE_LA_CLASE_DE_HOY,
  CLAVES_DE_LAS_CLASES,
  CLAVES_DEL_ALUMNO,
  CLAVES_DEL_RECHAZO,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  filaAsistenciaValida,
  insertarAsistencia,
  instantaneaDeAsistencia,
  LUNES,
  MARTES,
  marcar,
  ponerPagoEnVerificacion,
  prepararEscenarioDeAsistencia,
  rechazoDe,
  type Via,
} from '../../utilidades/escenario-asistencia';

// Criterio 7 (crítico, HU-14, RN-15, 4.2): la primera validación que falla decide; cada rechazo es un 409 con `{ codigo, mensaje, detalles }` y `detalles` cumple `rechazoAsistenciaSchema` (`alerta`, `alumno`, `claseDeHoy`, `asistenciaDeHoy` y `clases`,
// estrictos). Un rechazo no escribe, no descuenta ni audita. El orden y la alerta de cada código:
//   d ALUMNO_INACTIVO (ROJA) → e ASISTENCIA_YA_REGISTRADA (AMARILLA) → f PAGO_EN_VERIFICACION (ROJA, DR-3) → g MENSUALIDAD_NO_VIGENTE (ROJA) → h SIN_CLASES_RESTANTES (ROJA) → i FUERA_DE_HORARIO (AMARILLA) → j CLASE_NO_INCLUIDA (AMARILLA).
// Prueba, por las dos vías (criterio 5: el mismo orden y la misma respuesta): para cada fila, un alumno que cumple esa condición y todas las de abajo responde ese código (por ejemplo, vencido y fuera de horario da `MENSUALIDAD_NO_VIGENTE`; ya marcado hoy y
// con la última clase usada da `ASISTENCIA_YA_REGISTRADA`). Las filas a y b (401 y 404) están en `permisos.test.ts` y `qr-no-reconocido.test.ts`; la c (clave ya usada), en `idempotencia.test.ts`.
// Lecturas estrictas elegidas: los `detalles` solo se comprueban donde la spec los define: `claseDeHoy` en `FUERA_DE_HORARIO` (con la clase de hoy, o `null` el día sin clase), `asistenciaDeHoy` en `ASISTENCIA_YA_REGISTRADA`, `clases` `null` sin matrícula del día
// (`PAGO_EN_VERIFICACION` y `MENSUALIDAD_NO_VIGENTE`) y con los números de la matrícula cuando la hay (e con clases, h, i y j). La forma exacta (claves) se comprueba en todos. «Ocurrencia no incluida» = la clase de hoy empezó antes de que se creara la matrícula.

type Condicion =
  'inactivo' | 'yaMarco' | 'pagoEnVerificacion' | 'sinMatricula' | 'sinClases' | 'fueraDeHorario' | 'noIncluida';

interface Fila {
  nombre: string;
  codigo: string;
  alerta: 'ROJA' | 'AMARILLA';
  condiciones: readonly Condicion[];
  /** Cuándo se lee (por defecto, 19:30 del lunes, después de la clase; con `dentro`, 18:20; con `martes`, 18:20 del martes, sin clase). */
  cuando?: 'dentro' | 'despues' | 'martes';
  /** Las `clases` esperadas en los `detalles` (`null` sin matrícula del día); `undefined` = no se comprueba. */
  clases?: { usadas: number; totales: number; restantes: number } | null;
  claseDeHoy?: { horaInicio: string; horaFin: string } | null;
  asistenciaDeHoy?: { horaLlegada: string; estadoLlegada: string; metodo: string } | null;
}

const FILAS: Fila[] = [
  {
    nombre:
      'd) un alumno INACTIVO que además ya marcó, no tiene matrícula (con pago en verificación) y está fuera de horario',
    codigo: 'ALUMNO_INACTIVO',
    alerta: 'ROJA',
    condiciones: ['inactivo', 'yaMarco', 'pagoEnVerificacion', 'fueraDeHorario'],
  },
  {
    nombre: 'd) un alumno INACTIVO con matrícula vigente dentro de su clase',
    codigo: 'ALUMNO_INACTIVO',
    alerta: 'ROJA',
    condiciones: ['inactivo'],
    cuando: 'dentro',
  },
  {
    nombre: 'e) quien ya marcó hoy, ya no tiene matrícula del día y está fuera de horario',
    codigo: 'ASISTENCIA_YA_REGISTRADA',
    alerta: 'AMARILLA',
    condiciones: ['yaMarco', 'sinMatricula', 'fueraDeHorario'],
    asistenciaDeHoy: { horaLlegada: '18:05', estadoLlegada: 'PUNTUAL', metodo: 'QR' },
  },
  {
    nombre: 'e) quien ya marcó hoy con la última clase usada, fuera de horario y con la ocurrencia no incluida',
    codigo: 'ASISTENCIA_YA_REGISTRADA',
    alerta: 'AMARILLA',
    condiciones: ['yaMarco', 'sinClases', 'fueraDeHorario', 'noIncluida'],
    clases: { usadas: 12, totales: 12, restantes: 0 },
    asistenciaDeHoy: { horaLlegada: '18:05', estadoLlegada: 'PUNTUAL', metodo: 'QR' },
  },
  {
    nombre: 'e) quien ya marcó hoy y lo vuelve a intentar dentro de su clase',
    codigo: 'ASISTENCIA_YA_REGISTRADA',
    alerta: 'AMARILLA',
    condiciones: ['yaMarco'],
    cuando: 'dentro',
    clases: { usadas: 1, totales: 12, restantes: 11 },
    asistenciaDeHoy: { horaLlegada: '18:05', estadoLlegada: 'PUNTUAL', metodo: 'QR' },
  },
  {
    nombre: 'f) sin matrícula del día y con un pago en verificación del mes, fuera de horario',
    codigo: 'PAGO_EN_VERIFICACION',
    alerta: 'ROJA',
    condiciones: ['pagoEnVerificacion', 'fueraDeHorario'],
    clases: null,
    asistenciaDeHoy: null,
  },
  {
    nombre: 'g) sin matrícula del día y sin pago en verificación (vencido), fuera de horario',
    codigo: 'MENSUALIDAD_NO_VIGENTE',
    alerta: 'ROJA',
    condiciones: ['sinMatricula', 'fueraDeHorario'],
    clases: null,
    asistenciaDeHoy: null,
  },
  {
    nombre: 'h) sin clases restantes, fuera de horario y con la ocurrencia no incluida',
    codigo: 'SIN_CLASES_RESTANTES',
    alerta: 'ROJA',
    condiciones: ['sinClases', 'fueraDeHorario', 'noIncluida'],
    clases: { usadas: 12, totales: 12, restantes: 0 },
    asistenciaDeHoy: null,
  },
  {
    nombre: 'h) sin clases restantes dentro de su clase',
    codigo: 'SIN_CLASES_RESTANTES',
    alerta: 'ROJA',
    condiciones: ['sinClases'],
    cuando: 'dentro',
    clases: { usadas: 12, totales: 12, restantes: 0 },
    asistenciaDeHoy: null,
  },
  {
    nombre: 'i) después de su clase y con la ocurrencia no incluida',
    codigo: 'FUERA_DE_HORARIO',
    alerta: 'AMARILLA',
    condiciones: ['fueraDeHorario', 'noIncluida'],
    clases: { usadas: 0, totales: 12, restantes: 12 },
    claseDeHoy: { horaInicio: '18:00', horaFin: '19:00' },
    asistenciaDeHoy: null,
  },
  {
    nombre: 'i) el martes, día sin clase suya',
    codigo: 'FUERA_DE_HORARIO',
    alerta: 'AMARILLA',
    condiciones: [],
    cuando: 'martes',
    clases: { usadas: 0, totales: 12, restantes: 12 },
    claseDeHoy: null,
    asistenciaDeHoy: null,
  },
  {
    nombre: 'j) dentro de su clase, pero la clase empezó antes de que se creara la matrícula',
    codigo: 'CLASE_NO_INCLUIDA',
    alerta: 'AMARILLA',
    condiciones: ['noIncluida'],
    cuando: 'dentro',
    clases: { usadas: 0, totales: 12, restantes: 12 },
    asistenciaDeHoy: null,
  },
];

describe.each<Via>(['QR', 'MANUAL'])(
  'el orden de las validaciones y la alerta de cada código, por la vía %s (criterios 5 y 7)',
  (via) => {
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

    /** Arma un alumno que cumple las condiciones (con la matrícula de noviembre, la clase de los lunes de 18:00 y 12 clases). */
    async function armar(condiciones: readonly Condicion[]): Promise<AlumnoDeAsistencia> {
      const tiene = (c: Condicion) => condiciones.includes(c);
      const alumno = await crearAlumnoDeAsistencia(ctx, esc, {
        // La clase de hoy empezó a las 18:00; la matrícula se crea a las 18:10 (nunca incluyó la clase de hoy).
        matriculaCreadaEn: tiene('noIncluida') ? enLima(LUNES, '18:10') : undefined,
        clasesUsadas: tiene('sinClases') ? 12 : tiene('yaMarco') ? 1 : 0,
      });
      if (tiene('yaMarco')) {
        await insertarAsistencia(
          'propietario',
          alumno.academiaId,
          filaAsistenciaValida({
            alumnoId: alumno.alumnoId,
            matriculaId: alumno.matriculaId,
            claseId: alumno.claseId,
            usuarioId: esc.e.secretariaA.id,
          }),
        );
      }
      if (tiene('pagoEnVerificacion')) await ponerPagoEnVerificacion(esc, alumno);
      else if (tiene('sinMatricula'))
        await cambiarMatricula(alumno.academiaId, alumno.matriculaId, { estado: 'FINALIZADA' });
      if (tiene('inactivo')) await cambiarAlumno(alumno.academiaId, alumno.alumnoId, { estado: 'INACTIVO' });
      return alumno;
    }

    const instanteDe = (fila: Fila): Date =>
      fila.cuando === 'dentro'
        ? enLima(LUNES, '18:20')
        : fila.cuando === 'martes'
          ? enLima(MARTES, '18:20')
          : enLima(LUNES, '19:30');

    it.each(FILAS)('criterio 7: $nombre → 409 $codigo ($alerta), sin escribir, descontar ni auditar', async (fila) => {
      const alumno = await armar(fila.condiciones);
      const cookie = en(ctx, esc, instanteDe(fila)).secretaria;
      const antes = await instantaneaDeAsistencia(esc.e);

      const respuesta = await marcar(ctx, via, cookie, alumno);

      const detalles = rechazoDe(respuesta, fila.codigo, fila.alerta);
      const mensaje = respuesta.body?.['mensaje'];
      expect(typeof mensaje === 'string' && mensaje.length > 0, 'lleva un mensaje').toBe(true);
      expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['codigo', 'detalles', 'mensaje']);
      expect(Object.keys(detalles).sort(), 'las claves de rechazoAsistenciaSchema').toEqual(CLAVES_DEL_RECHAZO);
      expect(Object.keys(detalles.alumno).sort()).toEqual(CLAVES_DEL_ALUMNO);
      expect(detalles.alumno).toMatchObject({
        id: alumno.alumnoId,
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        nivel: 'BASICO',
      });
      if (detalles.claseDeHoy) expect(Object.keys(detalles.claseDeHoy).sort()).toEqual(CLAVES_DE_LA_CLASE_DE_HOY);
      if (detalles.asistenciaDeHoy)
        expect(Object.keys(detalles.asistenciaDeHoy).sort()).toEqual(CLAVES_DE_LA_ASISTENCIA_DE_HOY);
      if (detalles.clases) expect(Object.keys(detalles.clases).sort()).toEqual(CLAVES_DE_LAS_CLASES);
      if (fila.clases !== undefined) expect(detalles.clases, 'clases').toEqual(fila.clases);
      if (fila.claseDeHoy !== undefined) expect(detalles.claseDeHoy, 'claseDeHoy').toEqual(fila.claseDeHoy);
      if (fila.asistenciaDeHoy !== undefined)
        expect(detalles.asistenciaDeHoy, 'asistenciaDeHoy').toEqual(fila.asistenciaDeHoy);
      expect(respuesta.texto, 'el rechazo no lleva el DNI ni el token').not.toContain(alumno.dni);
      expect(respuesta.texto).not.toContain(alumno.token);
      expect(await instantaneaDeAsistencia(esc.e), 'un rechazo no escribe, no descuenta ni audita').toBe(antes);
    });

    it('criterio 7 (control): el alumno sin ninguna condición, dentro de su clase, no se rechaza: 201', async () => {
      const alumno = await armar([]);
      const cookie = en(ctx, esc, enLima(LUNES, '18:20')).secretaria;

      const respuesta = await marcar(ctx, via, cookie, alumno);

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(201);
    });

    it('criterio 7: la alerta de cada código es la de la tabla: ROJA para inactivo, pago en verificación, sin matrícula y sin clases; AMARILLA para ya marcó, fuera de horario y clase no incluida', () => {
      const porCodigo = new Map(FILAS.map((fila) => [fila.codigo, fila.alerta]));

      expect(Object.fromEntries(porCodigo)).toEqual({
        ALUMNO_INACTIVO: 'ROJA',
        ASISTENCIA_YA_REGISTRADA: 'AMARILLA',
        PAGO_EN_VERIFICACION: 'ROJA',
        MENSUALIDAD_NO_VIGENTE: 'ROJA',
        SIN_CLASES_RESTANTES: 'ROJA',
        FUERA_DE_HORARIO: 'AMARILLA',
        CLASE_NO_INCLUIDA: 'AMARILLA',
      });
    });
  },
);
