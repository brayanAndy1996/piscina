import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dniInventado } from '../../utilidades/usuarios';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAcademias } from '../../utilidades/datos';
import { leerClases } from '../../utilidades/planes-clases';
import {
  type AppInscripciones,
  buscarTextoEnBase,
  cargarContratos,
  contarFilasDeInscripciones,
  crearAppInscripciones,
  fechaEnLima,
  instanteEnLima,
  instantaneaDeInscripciones,
  leerMatriculas,
  leerSolicitudes,
  type Objeto,
  rutaPublica,
} from '../../utilidades/inscripciones';
import { Decimal } from '../../../src/infraestructura/prisma';
import { montoProporcional } from '../../../src/modulos/matriculas/dominio/cobro';

// Spec 005, criterio 47 (base, a, b y d; ataque ronda 1 y respuesta R1). Prueba no protegida. Cubre:
//  - a) con `RELOJ` fijo en el día 1 del mes en curso a las 00:00 de Lima, se puede completar una inscripción con cada plan de ejemplo
//    de `delfines` (cotización y envío con una selección de las clases sembradas responden 200 y 201);
//  - b) cada matrícula sembrada tiene `veces_por_semana` clases del nivel del alumno, una por día, en los días y franjas del plan, con
//    `clases_totales` sin pasar de `clases_por_mes_plan` y `monto_calculado` igual a `montoProporcional(...)`;
//  - d) las matrículas sembradas son del mes en curso y ninguna reserva sembrada pasa del fin de su mes;
//  - base) ejecutar la semilla dos veces no duplica alumnos, solicitudes ni matrículas ni reactiva una clase desactivada, `tiburones`
//    queda sin solicitudes y ningún token se guarda en claro ni se imprime.

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

/** Los textos de ejemplo de los que la semilla deriva el hash de cada token (seed.ts): nunca deben guardarse ni imprimirse. */
const TEXTOS_DE_TOKEN = [
  'semilla-delfines-solicitud-1',
  'semilla-delfines-solicitud-2',
  'semilla-delfines-solicitud-3',
] as const;

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
    'criterio 47 b: cada matrícula sembrada tiene veces_por_semana clases del nivel del alumno, una por día, en los días y franjas del plan, y su monto es el del cálculo',
    async () => {
      const { rows: matriculas } = await ejecutarComo(
        'propietario',
        `SELECT m.id::text AS id, m.clases_totales::int AS clases_totales, m.clases_por_mes_plan::int AS clases_por_mes_plan,
                m.precio_plan::text AS precio_plan, m.monto_calculado::text AS monto_calculado, a.nivel::text AS nivel_alumno,
                p.veces_por_semana::int AS veces_por_semana, p.dias_permitidos::int[] AS dias_permitidos,
                ARRAY(SELECT to_char(f, 'HH24:MI') FROM unnest(p.franjas_permitidas) AS f) AS franjas_permitidas,
                ARRAY(SELECT c.nivel::text || '|' || c.dia_semana::int || '|' || to_char(c.hora_inicio, 'HH24:MI')
                        FROM matricula_clases mc
                        JOIN clases c ON c.academia_id = mc.academia_id AND c.id = mc.clase_id
                       WHERE mc.academia_id = m.academia_id AND mc.matricula_id = m.id
                       ORDER BY c.dia_semana) AS clases
           FROM matriculas m
           JOIN alumnos a ON a.academia_id = m.academia_id AND a.id = m.alumno_id
           JOIN planes p ON p.academia_id = m.academia_id AND p.id = m.plan_id
          WHERE m.academia_id = $1::uuid AND m.solicitud_id IS NOT NULL`,
        [delfinesId],
        { academiaId: delfinesId },
      );

      expect(matriculas.length).toBeGreaterThanOrEqual(3);
      for (const fila of matriculas as {
        id: string;
        clases_totales: number;
        clases_por_mes_plan: number;
        precio_plan: string;
        monto_calculado: string;
        nivel_alumno: string;
        veces_por_semana: number;
        dias_permitidos: number[];
        franjas_permitidas: string[];
        clases: string[];
      }[]) {
        const clases = fila.clases.map((texto) => {
          const [nivel = '', dia = '', hora = ''] = texto.split('|');
          return { nivel, dia: Number(dia), hora };
        });
        expect(clases, 'tantas clases como veces por semana').toHaveLength(fila.veces_por_semana);
        expect(
          clases.every((clase) => clase.nivel === fila.nivel_alumno),
          'todas del nivel del alumno',
        ).toBe(true);
        expect(new Set(clases.map((clase) => clase.dia)).size, 'una por día').toBe(clases.length);
        expect(
          clases.every((clase) => fila.dias_permitidos.includes(clase.dia)),
          'en los días del plan',
        ).toBe(true);
        expect(
          clases.every((clase) => fila.franjas_permitidas.includes(clase.hora)),
          'en las franjas del plan',
        ).toBe(true);
        expect(fila.clases_totales).toBeLessThanOrEqual(fila.clases_por_mes_plan);
        expect(fila.monto_calculado).toBe(
          montoProporcional(new Decimal(fila.precio_plan), fila.clases_por_mes_plan, fila.clases_totales).toFixed(2),
        );
      }
    },
    TIMEOUT,
  );

  it(
    'criterio 47: tiburones queda sin solicitudes, matrículas ni alumnos clientes de ejemplo',
    async () => {
      const tiburones = (await leerAcademias()).find((fila) => fila.nombre_corto === 'tiburones');
      if (!tiburones) throw new Error('Falta la academia tiburones.');

      const cuentas = await contarFilasDeInscripciones(tiburones.id);

      expect(await leerSolicitudes(tiburones.id)).toEqual([]);
      expect(cuentas.solicitudes_inscripcion).toBe(0);
      expect(cuentas.matriculas).toBe(0);
      expect(cuentas.alumnos).toBe(0);
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

describe('semilla: repetirla y los tokens (criterio 47)', () => {
  let delfinesId: string;
  let salidaPrimera = '';

  beforeAll(async () => {
    await limpiarBase();
    const resultado = ejecutarComando('db:semilla', VARIABLES);
    expect(resultado.estado, resultado.salida).toBe(0);
    salidaPrimera = resultado.salida;
    const academia = (await leerAcademias()).find((fila) => fila.nombre_corto === 'delfines');
    if (!academia) throw new Error('Falta la academia delfines.');
    delfinesId = academia.id;
  }, TIMEOUT);

  it(
    'criterio 47: ejecutarla dos veces no duplica alumnos, solicitudes ni matrículas (nada cambia) y no reactiva una clase desactivada',
    async () => {
      const antes = await contarFilasDeInscripciones(delfinesId);
      expect(antes.alumnos).toBe(3);
      expect(antes.solicitudes_inscripcion).toBe(3);
      expect(antes.matriculas).toBe(3);
      await ejecutarComo(
        'propietario',
        `UPDATE clases SET activo = false WHERE academia_id = $1::uuid AND nivel = 'BASICO' AND dia_semana = 1 AND hora_inicio = '18:00'`,
        [delfinesId],
        { academiaId: delfinesId },
      );
      const clasesAntes = await leerClases(delfinesId);
      const filasAntes = await instantaneaDeInscripciones(delfinesId);

      const segunda = ejecutarComando('db:semilla', VARIABLES);

      expect(segunda.estado, segunda.salida).toBe(0);
      expect(await contarFilasDeInscripciones(delfinesId)).toEqual(antes);
      expect(await instantaneaDeInscripciones(delfinesId), 'ninguna fila de inscripción cambia').toBe(filasAntes);
      const clasesDespues = await leerClases(delfinesId);
      expect(clasesDespues).toHaveLength(clasesAntes.length);
      expect(
        clasesDespues.find(
          (clase) => clase.nivel === 'BASICO' && clase.dia_semana === 1 && clase.hora_inicio.startsWith('18:00'),
        ),
        'la clase desactivada sigue desactivada',
      ).toMatchObject({ activo: false });
    },
    TIMEOUT,
  );

  it(
    'criterio 47: ningún token se guarda en claro ni se imprime (solo el hash de 32 bytes)',
    async () => {
      const segunda = ejecutarComando('db:semilla', VARIABLES);
      expect(segunda.estado, segunda.salida).toBe(0);

      for (const texto of TEXTOS_DE_TOKEN) {
        const hash = createHash('sha256').update(texto).digest('hex');
        for (const salida of [salidaPrimera, segunda.salida]) {
          expect(salida).not.toContain(texto);
          expect(salida).not.toContain(hash);
        }
        expect(await buscarTextoEnBase(delfinesId, texto), `el texto "${texto}" no está en la base`).toBe(0);
      }
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT octet_length(token_hash)::int AS largo FROM solicitudes_inscripcion WHERE academia_id = $1::uuid`,
        [delfinesId],
        { academiaId: delfinesId },
      );
      expect(rows).toHaveLength(3);
      for (const fila of rows as { largo: number }[]) expect(fila.largo).toBe(32);
    },
    TIMEOUT,
  );
});
