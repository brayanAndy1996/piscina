import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAcademias } from '../../utilidades/datos';
import { leerAlumnos, leerMatriculas } from '../../utilidades/inscripciones';

// Spec 007, criterio 57 (parte de la 007a; tarea T24; prueba no protegida): la semilla deja en `delfines` un ajuste de monto con su motivo
// en la solicitud de ejemplo del DNI 20000001; repetirla no lo duplica ni pisa un ajuste editado; no se siembran pagos confirmados (con la
// 007b se siembra un único Yape pendiente, en otra solicitud: ver `semilla-pago-007b.test.ts`) y `tiburones` queda sin pagos.

const TIMEOUT = 120_000;
const VARIABLES = {
  SUPERADMIN_CORREO: 'superadmin@aquagestion.test',
  SUPERADMIN_NOMBRE: 'Superadmin de desarrollo',
  SUPERADMIN_CLAVE: 'clave-de-desarrollo-123',
};
const DNI_CON_AJUSTE = '20000001';
const MOTIVO_DE_EJEMPLO = 'Descuento de ejemplo autorizado por la dirección';

async function idDe(nombreCorto: string): Promise<string> {
  const academia = (await leerAcademias()).find((fila) => fila.nombre_corto === nombreCorto);
  if (!academia) throw new Error(`Falta la academia ${nombreCorto}.`);
  return academia.id;
}

async function contarPagos(academiaId: string): Promise<number> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT count(*)::int AS n FROM pagos WHERE academia_id = $1::uuid AND estado <> 'PENDIENTE_VERIFICACION'::estado_pago`,
    [academiaId],
    { academiaId },
  );
  return (rows[0] as { n: number }).n;
}

async function matriculasConAjuste(academiaId: string) {
  const alumnos = await leerAlumnos(academiaId);
  const matriculas = await leerMatriculas(academiaId);
  return matriculas
    .filter((matricula) => matricula.monto_ajustado !== null)
    .map((matricula) => ({
      dni: alumnos.find((alumno) => alumno.id === matricula.alumno_id)?.dni,
      monto: matricula.monto_ajustado,
      motivo: matricula.motivo_ajuste,
      estado: matricula.estado,
    }));
}

describe('semilla: ajuste de ejemplo y sin pagos (criterio 57, 007a)', () => {
  beforeEach(limpiarBase);

  it(
    'delfines queda con un único ajuste de ejemplo con su motivo en una matrícula reservada; delfines sin pagos confirmados y tiburones sin pagos',
    async () => {
      const resultado = ejecutarComando('db:semilla', VARIABLES);

      expect(resultado.estado, resultado.salida).toBe(0);
      const delfinesId = await idDe('delfines');
      expect(await matriculasConAjuste(delfinesId)).toEqual([
        { dni: DNI_CON_AJUSTE, monto: '60.00', motivo: MOTIVO_DE_EJEMPLO, estado: 'RESERVADA' },
      ]);
      expect(await contarPagos(delfinesId), 'no se siembran pagos resueltos en delfines').toBe(0);
      const tiburonesId = await idDe('tiburones');
      expect(await contarPagos(tiburonesId), 'tiburones queda sin pagos').toBe(0);
      const { rows } = await ejecutarComo(
        'propietario',
        'SELECT count(*)::int AS n FROM pagos WHERE academia_id = $1::uuid',
        [tiburonesId],
        { academiaId: tiburonesId },
      );
      expect((rows[0] as { n: number }).n, 'tiburones queda sin ningún pago').toBe(0);
      expect(await matriculasConAjuste(tiburonesId)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'repetir la semilla no duplica el ajuste ni pisa un ajuste editado',
    async () => {
      expect(ejecutarComando('db:semilla', VARIABLES).estado).toBe(0);
      const delfinesId = await idDe('delfines');
      const sinEditar = await matriculasConAjuste(delfinesId);
      const segunda = ejecutarComando('db:semilla', VARIABLES);
      expect(segunda.estado, segunda.salida).toBe(0);
      expect(await matriculasConAjuste(delfinesId)).toEqual(sinEditar);

      // El administrador edita el ajuste: la semilla no lo vuelve a pisar.
      await ejecutarComo(
        'propietario',
        `UPDATE matriculas m SET monto_ajustado = 70::numeric(10,2), motivo_ajuste = 'Ajuste editado por el administrador'
           FROM alumnos a
          WHERE m.academia_id = $1::uuid AND a.academia_id = m.academia_id AND a.id = m.alumno_id AND a.dni = $2`,
        [delfinesId, DNI_CON_AJUSTE],
        { academiaId: delfinesId },
      );
      const tercera = ejecutarComando('db:semilla', VARIABLES);

      expect(tercera.estado, tercera.salida).toBe(0);
      expect(await matriculasConAjuste(delfinesId)).toEqual([
        { dni: DNI_CON_AJUSTE, monto: '70.00', motivo: 'Ajuste editado por el administrador', estado: 'RESERVADA' },
      ]);
      expect(await contarPagos(delfinesId)).toBe(0);
    },
    TIMEOUT,
  );
});
