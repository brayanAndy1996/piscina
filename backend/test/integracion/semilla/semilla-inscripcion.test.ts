import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dniInventado } from '../../utilidades/usuarios';
import { limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAcademias } from '../../utilidades/datos';
import {
  type AppInscripciones,
  cargarContratos,
  crearAppInscripciones,
  fechaEnLima,
  instanteEnLima,
  leerMatriculas,
  type Objeto,
  rutaPublica,
} from '../../utilidades/inscripciones';

// Spec 005, criterio 47 (a, b y d; ataque ronda 1 y respuesta R1). Prueba no protegida: después de la semilla, con `RELOJ` fijo en el día 1
// del mes en curso a las 00:00 de Lima, se puede completar una inscripción con cada plan de ejemplo de `delfines` (cotización y envío con
// una selección de las clases sembradas responden 200 y 201); las matrículas sembradas son del mes en curso, con tantas clases como las
// veces por semana de su plan, y ninguna reserva sembrada pasa del fin de su mes.

const TIMEOUT = 120_000;
const VARIABLES = {
  SUPERADMIN_CORREO: 'superadmin@aquagestion.test',
  SUPERADMIN_NOMBRE: 'Superadmin de desarrollo',
  SUPERADMIN_CLAVE: 'clave-de-desarrollo-123',
};

interface PlanFormulario {
  id: string;
  nombre: string;
  vecesPorSemana: number;
  diasPermitidos: number[];
  franjasPermitidas: string[];
  nivelesAplicables: string[];
}
interface ClaseFormulario {
  id: string;
  nivel: string;
  diaSemana: number;
  horaInicio: string;
}

describe('semilla: inscripción con cada plan de ejemplo y reservas dentro del mes (criterio 47)', () => {
  let ctx: AppInscripciones;
  let delfinesId: string;

  beforeAll(async () => {
    await limpiarBase();
    const resultado = ejecutarComando('db:semilla', VARIABLES);
    expect(resultado.estado, resultado.salida).toBe(0);
    const academia = (await leerAcademias()).find((fila) => fila.nombre_corto === 'delfines');
    if (!academia) throw new Error('Falta la academia delfines.');
    delfinesId = academia.id;
    const hoy = fechaEnLima(new Date());
    ctx = await crearAppInscripciones({ ahora: instanteEnLima(`${hoy.mesTexto}-01`, '00:00') });
  }, TIMEOUT);
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it(
    'criterio 47 a: con cada plan de ejemplo, una selección de las clases sembradas se cotiza (200) y se envía (201)',
    async () => {
      const contratos = await cargarContratos();
      const formulario = await ctx.http.get(rutaPublica('delfines', '/inscripcion'));
      expect(formulario.status, formulario.texto).toBe(200);
      const planes = formulario.body?.['planes'] as PlanFormulario[];
      const clases = formulario.body?.['clases'] as ClaseFormulario[];
      expect(planes).toHaveLength(2);

      for (const plan of planes) {
        // Un nivel del plan con una clase por día permitido (en las franjas del plan), tantas como veces por semana.
        const elegidas = plan.diasPermitidos
          .map((dia) =>
            clases.find(
              (clase) =>
                clase.nivel === 'BASICO' &&
                clase.diaSemana === dia &&
                plan.nivelesAplicables.includes(clase.nivel) &&
                plan.franjasPermitidas.includes(clase.horaInicio),
            ),
          )
          .filter((clase): clase is ClaseFormulario => clase !== undefined)
          .slice(0, plan.vecesPorSemana);
        expect(elegidas, `clases sembradas para ${plan.nombre}`).toHaveLength(plan.vecesPorSemana);
        const claseIds = elegidas.map((clase) => clase.id);

        const cotizacion = await ctx.http.post(rutaPublica('delfines', '/inscripcion/cotizacion'), {
          planId: plan.id,
          nivel: 'BASICO',
          claseIds,
        });
        expect(cotizacion.status, `${plan.nombre}: ${cotizacion.texto}`).toBe(200);
        const { mes, monto } = (cotizacion.body?.['cotizacion'] ?? {}) as Objeto;

        const envio = await ctx.http.post(rutaPublica('delfines', '/inscripcion'), {
          claveIdempotencia: randomUUID(),
          alumno: {
            nombres: 'Camila',
            apellidos: 'Quispe Rojas',
            dni: dniInventado(),
            fechaNacimiento: '1995-05-20',
            telefono: '987654321',
            nivel: 'BASICO',
          },
          fichaMedica: {
            tipoSangre: contratos.TIPOS_SANGRE[0],
            contactoEmergencia: { nombre: 'Rosa Quispe', telefono: '912345678' },
          },
          inscripcion: { planId: plan.id, claseIds, mes, montoMostrado: monto },
          consentimientos: { version: contratos.VERSION_CONSENTIMIENTOS, datosPersonales: true, deslinde: true },
        });
        expect(envio.status, `${plan.nombre}: ${envio.texto}`).toBe(201);
      }
    },
    TIMEOUT,
  );

  it(
    'criterio 47 d: ninguna reserva sembrada pasa del fin de su mes, y las matrículas de ejemplo son del mes en curso',
    async () => {
      const hoy = fechaEnLima(new Date());
      const matriculas = (await leerMatriculas(delfinesId)).filter((fila) => fila.solicitud_id !== null);

      expect(matriculas.length).toBeGreaterThanOrEqual(3);
      for (const matricula of matriculas) {
        expect([matricula.anio, matricula.mes]).toEqual([hoy.anio, hoy.mes]);
        if (matricula.reserva_vence_en === null) continue;
        // El inicio del mes siguiente en Lima (UTC-5): la reserva es anterior.
        const limite = Date.UTC(matricula.anio, matricula.mes, 1, 5, 0, 0, 0);
        expect(matricula.reserva_vence_en.getTime()).toBeLessThan(limite);
      }
    },
    TIMEOUT,
  );
});
