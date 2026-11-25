import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerFilasConfiguracion } from '../../utilidades/configuracion';
import { leerAcademias } from '../../utilidades/datos';
import { leerAlumnos, leerMatriculas } from '../../utilidades/inscripciones';
import { leerPagos } from '../../utilidades/pagos';

// Spec 007, criterio 57 (parte de la 007b; tarea T41; prueba no protegida): la semilla deja en `delfines` un Yape pendiente de verificación
// con un comprobante de ejemplo (una imagen generada que existe en el almacén) y los datos de pago de ejemplo de la academia; repetirla no
// duplica ni pisa lo editado (un pago ya resuelto, un dato de pago cambiado); no siembra pagos confirmados y `tiburones` queda sin pagos.

const TIMEOUT = 120_000;
const DNI_DEL_YAPE = '20000003';
const FIRMA_JPEG = Buffer.from([0xff, 0xd8, 0xff]);

let almacen: string;
const variables = () => ({
  SUPERADMIN_CORREO: 'superadmin@aquagestion.test',
  SUPERADMIN_NOMBRE: 'Superadmin de desarrollo',
  SUPERADMIN_CLAVE: 'clave-de-desarrollo-123',
  ALMACEN_DIRECTORIO: almacen,
});

async function idDe(nombreCorto: string): Promise<string> {
  const academia = (await leerAcademias()).find((fila) => fila.nombre_corto === nombreCorto);
  if (!academia) throw new Error(`Falta la academia ${nombreCorto}.`);
  return academia.id;
}

describe('semilla: Yape pendiente y datos de pago de ejemplo (criterio 57, 007b)', () => {
  beforeAll(() => {
    almacen = fs.mkdtempSync(path.join(os.tmpdir(), 'aquagestion-semilla-'));
  });
  afterAll(() => {
    fs.rmSync(almacen, { recursive: true, force: true });
  });
  beforeEach(limpiarBase);

  it(
    'delfines queda con un único pago: un Yape PENDIENTE_VERIFICACION con su comprobante en el almacén, en una matrícula reservada sin vencimiento; tiburones sin pagos',
    async () => {
      const resultado = ejecutarComando('db:semilla', variables());

      expect(resultado.estado, resultado.salida).toBe(0);
      const delfinesId = await idDe('delfines');
      const pagos = await leerPagos(delfinesId);
      expect(pagos).toHaveLength(1);
      const [pago] = pagos;
      expect(pago).toMatchObject({
        metodo: 'YAPE',
        estado: 'PENDIENTE_VERIFICACION',
        concepto: 'INSCRIPCION',
        verificado_por: null,
        numero_ticket: null,
        numero_operacion: '00123456',
        numero_operacion_normalizado: '123456',
      });
      const alumno = (await leerAlumnos(delfinesId)).find((fila) => fila.dni === DNI_DEL_YAPE);
      expect(alumno?.estado, 'sigue siendo cliente: sin cuenta hasta que se apruebe').toBe('CLIENTE');
      const matricula = (await leerMatriculas(delfinesId)).find((fila) => fila.id === pago?.matricula_id);
      expect(matricula).toMatchObject({ alumno_id: alumno?.id, estado: 'RESERVADA', reserva_vence_en: null });
      expect(pago?.monto).toBe(matricula?.monto_calculado);
      const archivo = path.join(almacen, ...(pago?.comprobante_clave ?? '').split('/'));
      expect(pago?.comprobante_clave).toMatch(
        new RegExp(`^academias/${delfinesId}/pagos/${pago?.id}/comprobante-[0-9a-f-]+\\.jpg$`),
      );
      expect(fs.readFileSync(archivo).subarray(0, 3).equals(FIRMA_JPEG), 'el comprobante es un JPEG').toBe(true);
      const tiburonesId = await idDe('tiburones');
      expect(await leerPagos(tiburonesId)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'delfines trae los datos de pago de ejemplo y tiburones no; repetir la semilla no los duplica ni pisa uno cambiado',
    async () => {
      expect(ejecutarComando('db:semilla', variables()).estado).toBe(0);
      const delfinesId = await idDe('delfines');
      const claves = (await leerFilasConfiguracion(delfinesId)).map((fila) => fila.clave);
      expect(claves).toEqual(
        expect.arrayContaining([
          'yape_numero',
          'yape_titular',
          'transferencia_banco',
          'transferencia_cuenta',
          'transferencia_cci',
          'transferencia_titular',
        ]),
      );
      expect(await leerFilasConfiguracion(await idDe('tiburones'))).toEqual([]);
      await ejecutarComo(
        'propietario',
        `UPDATE configuraciones SET valor = '"912345678"'::jsonb WHERE academia_id = $1::uuid AND clave = 'yape_numero'`,
        [delfinesId],
        { academiaId: delfinesId },
      );
      await ejecutarComo(
        'propietario',
        `DELETE FROM configuraciones WHERE academia_id = $1::uuid AND clave = 'transferencia_cci'`,
        [delfinesId],
        { academiaId: delfinesId },
      );

      const segunda = ejecutarComando('db:semilla', variables());

      expect(segunda.estado, segunda.salida).toBe(0);
      const filas = await leerFilasConfiguracion(delfinesId);
      expect(filas.find((fila) => fila.clave === 'yape_numero')?.valor).toBe('912345678');
      expect(
        filas.find((fila) => fila.clave === 'transferencia_cci'),
        'el dato que se quitó no vuelve',
      ).toBeUndefined();
      expect(filas).toHaveLength(claves.length - 1);
    },
    TIMEOUT,
  );

  it(
    'repetir la semilla no duplica el pago ni toca uno ya resuelto (rechazado por la secretaria)',
    async () => {
      expect(ejecutarComando('db:semilla', variables()).estado).toBe(0);
      const delfinesId = await idDe('delfines');
      const [antes] = await leerPagos(delfinesId);
      expect(ejecutarComando('db:semilla', variables()).estado).toBe(0);
      expect(await leerPagos(delfinesId)).toHaveLength(1);

      // La secretaria rechaza el comprobante: la matrícula queda cancelada y la semilla no lo vuelve a sembrar ni lo pisa.
      await ejecutarComo(
        'propietario',
        `UPDATE pagos SET estado = 'RECHAZADO'::estado_pago, verificado_por = (SELECT id FROM usuarios WHERE academia_id = $1::uuid AND dni = '10000002'),
                          verificado_en = now(), motivo_rechazo = 'Imagen ilegible' WHERE academia_id = $1::uuid AND id = $2::uuid`,
        [delfinesId, antes?.id],
        { academiaId: delfinesId },
      );
      await ejecutarComo(
        'propietario',
        `UPDATE matriculas SET estado = 'CANCELADA'::estado_matricula, reserva_vence_en = NULL WHERE academia_id = $1::uuid AND id = $2::uuid`,
        [delfinesId, antes?.matricula_id],
        { academiaId: delfinesId },
      );

      const tercera = ejecutarComando('db:semilla', variables());

      expect(tercera.estado, tercera.salida).toBe(0);
      const pagos = await leerPagos(delfinesId);
      expect(pagos).toHaveLength(1);
      expect(pagos[0]).toMatchObject({ id: antes?.id, estado: 'RECHAZADO', motivo_rechazo: 'Imagen ilegible' });
    },
    TIMEOUT,
  );
});
