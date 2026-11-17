import { crearPlanSchema } from '@aquagestion/contratos';
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAcademias } from '../../utilidades/datos';
import { leerClases, leerPlanes } from '../../utilidades/planes-clases';

// Spec 004, criterio 30: la semilla deja a `delfines` con dos planes de ejemplo y clases de los tres niveles del entrenador de ejemplo, a
// `tiburones` sin planes ni clases, y se puede ejecutar dos veces sin duplicar ni fallar ni pisar lo que el administrador cambió. Prueba no
// protegida. El segundo entrenador de `delfines` y las dos clases en el mismo bloque quedan pendientes de la prueba protegida de la 002
// (criterio 45), que fija cuatro usuarios en `delfines`.

const TIMEOUT = 120_000;
const VARIABLES = {
  SUPERADMIN_CORREO: 'superadmin@aquagestion.test',
  SUPERADMIN_NOMBRE: 'Superadmin de desarrollo',
  SUPERADMIN_CLAVE: 'clave-de-desarrollo-123',
};

async function idDe(nombreCorto: string): Promise<string> {
  const academia = (await leerAcademias()).find((fila) => fila.nombre_corto === nombreCorto);
  if (!academia) throw new Error(`Falta la academia ${nombreCorto}.`);
  return academia.id;
}

describe('semilla: planes y clases de ejemplo (criterio 30)', () => {
  beforeEach(limpiarBase);

  it(
    'delfines queda con dos planes válidos y clases de los tres niveles; tiburones sin planes ni clases',
    async () => {
      const resultado = ejecutarComando('db:semilla', VARIABLES);

      expect(resultado.estado, resultado.salida).toBe(0);
      const delfinesId = await idDe('delfines');
      const planes = await leerPlanes(delfinesId);
      expect(
        planes.map((plan) => [plan.nombre, plan.veces_por_semana, plan.clases_por_mes, plan.precio]).sort(),
      ).toEqual([
        ['2 veces por semana', 2, 8, '90.00'],
        ['3 veces por semana', 3, 12, '120.00'],
      ]);
      for (const plan of planes) {
        const cuerpo = {
          nombre: plan.nombre,
          vecesPorSemana: plan.veces_por_semana,
          clasesPorMes: plan.clases_por_mes,
          precio: plan.precio,
          diasPermitidos: plan.dias_permitidos,
          franjasPermitidas: plan.franjas_permitidas,
          nivelesAplicables: plan.niveles_aplicables,
        };
        expect(crearPlanSchema.safeParse(cuerpo).success, plan.nombre).toBe(true);
        expect(plan.franjas_permitidas).toHaveLength(12);
        expect(plan.niveles_aplicables).toEqual(['BASICO', 'INTERMEDIO', 'AVANZADO']);
      }
      const clases = await leerClases(delfinesId);
      expect(new Set(clases.map((clase) => clase.nivel))).toEqual(new Set(['BASICO', 'INTERMEDIO', 'AVANZADO']));
      expect(clases.every((clase) => clase.activo && clase.aforo >= 20 && clase.aforo <= 50)).toBe(true);
      const tiburonesId = await idDe('tiburones');
      expect(await leerPlanes(tiburonesId)).toEqual([]);
      expect(await leerClases(tiburonesId)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'repetirla no falla, no duplica y no pisa lo que el administrador cambió',
    async () => {
      expect(ejecutarComando('db:semilla', VARIABLES).estado).toBe(0);
      const delfinesId = await idDe('delfines');
      const planesAntes = await leerPlanes(delfinesId);
      const clasesAntes = await leerClases(delfinesId);
      await ejecutarComo(
        'propietario',
        `UPDATE planes SET precio = 99.90, activo = false WHERE academia_id = $1::uuid AND nombre = '2 veces por semana'`,
        [delfinesId],
        { academiaId: delfinesId },
      );
      await ejecutarComo(
        'propietario',
        `UPDATE clases SET activo = false, aforo = 44 WHERE academia_id = $1::uuid AND nivel = 'BASICO' AND dia_semana = 1`,
        [delfinesId],
        { academiaId: delfinesId },
      );

      const segunda = ejecutarComando('db:semilla', VARIABLES);

      expect(segunda.estado, segunda.salida).toBe(0);
      const planes = await leerPlanes(delfinesId);
      const clases = await leerClases(delfinesId);
      expect(planes).toHaveLength(planesAntes.length);
      expect(clases).toHaveLength(clasesAntes.length);
      expect(planes.find((plan) => plan.nombre === '2 veces por semana')).toMatchObject({
        precio: '99.90',
        activo: false,
      });
      expect(clases.find((clase) => clase.nivel === 'BASICO' && clase.dia_semana === 1)).toMatchObject({
        activo: false,
        aforo: 44,
      });
    },
    TIMEOUT,
  );
});
