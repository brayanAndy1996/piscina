// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_ABIERTA,
  type AppCaja,
  cajaDe,
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  crearEgresoDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  cuerpoApertura,
  detallesDe,
  type EscenarioCaja,
  exigirRutasDeCaja,
  HOY,
  instantaneaDeCaja,
  leerCajas,
  type RespuestaCaja,
  retenerUsuarios,
} from '../../utilidades/caja';
import { conRetencion } from '../../utilidades/inscripciones';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 13 (simultáneas) y criterio 16 (crítico, regla de idempotencia de CLAUDE.md, RN-17, D-04). Carreras deterministas: la prueba retiene
// con su propia transacción las filas de los usuarios que piden (la primera sentencia de cada petición es `bloquearActorVigente`), envía las
// peticiones sin esperarlas, comprueba con `pg_blocking_pids` que todas quedaron esperando y las suelta a la vez. Sin tiempos ni esperas fijas.
//  13. Dos aperturas simultáneas en A (dos personas, claves distintas): exactamente una responde 201 y la otra 409 CAJA_YA_ABIERTA (nunca 500 ni
//      40P01); queda una fila y un CAJA_ABIERTA.
//  16. Una apertura con la misma clave K y el mismo monto responde 200 con { caja } de la caja ya creada tal como está ahora (aunque tenga movimientos
//      o esté cerrada), sin crear otra caja ni auditar otra vez; con K y otro monto, 409 CLAVE_YA_USADA. Dos envíos simultáneos con la misma clave
//      dejan una sola caja y un solo CAJA_ABIERTA: uno responde 201 y el otro 200. Una clave de B no choca con una de A.

describe('apertura: carreras e idempotencia (criterios 13 y 16)', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const abrir = (cuerpo: unknown, cookie = cookies.secretaria) => ctx.http.post('/api/cajas', cookie, cuerpo);
  const auditorias = () => leerAuditoriaDeAcademia(e.A.id, ACCION_CAJA_ABIERTA);
  const estados = (respuestas: RespuestaCaja[]) => respuestas.map((r) => r.status).sort((a, b) => a - b);

  describe('criterio 13: aperturas simultáneas', () => {
    it('criterio 13: dos personas abren a la vez con claves distintas: una responde 201 y la otra 409 CAJA_YA_ABIERTA; queda una fila y un CAJA_ABIERTA', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerUsuarios(e.A.id, [e.secretariaA.id, e.adminA.id]),
        enviar: [
          () => abrir(cuerpoApertura({ montoInicial: '10.00' }), cookies.secretaria),
          () => abrir(cuerpoApertura({ montoInicial: '20.00' }), cookies.admin),
        ],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'las dos aperturas no quedaron esperando la fila del actor').toBe(true);
      expect(estados(resultados), resultados.map((r) => r.texto).join(' | ')).toEqual([201, 409]);
      const perdedora = resultados.find((r) => r.status === 409) as RespuestaCaja;
      expect(codigoDe(perdedora)).toBe('CAJA_YA_ABIERTA');
      const filas = await leerCajas(e.A.id);
      expect(filas).toHaveLength(1);
      const ganadora = resultados.find((r) => r.status === 201) as RespuestaCaja;
      expect(cajaDe(ganadora).id).toBe(filas[0]?.id);
      expect(detallesDe(perdedora)).toEqual({ cajaId: filas[0]?.id, fecha: HOY });
      expect(await auditorias()).toHaveLength(1);
    });

    it('criterio 13: cuatro personas abren a la vez: una responde 201 y las otras tres 409 CAJA_YA_ABIERTA, ninguna 500', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerUsuarios(e.A.id, [e.secretariaA.id, e.secretariaA2.id, e.adminA.id, e.adminA2.id]),
        enviar: [cookies.secretaria, cookies.secretaria2, cookies.admin, cookies.admin2].map(
          (cookie) => () => abrir(cuerpoApertura(), cookie),
        ),
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron).toBe(true);
      expect(estados(resultados), resultados.map((r) => r.texto).join(' | ')).toEqual([201, 409, 409, 409]);
      for (const perdedora of resultados.filter((r) => r.status === 409)) {
        expect(codigoDe(perdedora)).toBe('CAJA_YA_ABIERTA');
      }
      expect(await leerCajas(e.A.id)).toHaveLength(1);
      expect(await auditorias()).toHaveLength(1);
    });
  });

  describe('criterio 16: doble clic en la apertura', () => {
    it('criterio 16: la misma clave con el mismo monto responde 200 con la misma caja, sin crear otra ni auditar otra vez', async () => {
      const cuerpo = cuerpoApertura({ montoInicial: '120' });
      const primera = await abrir(cuerpo);
      expect(primera.status, primera.texto).toBe(201);
      const antes = await instantaneaDeCaja(e.A.id);

      const repetida = await abrir(cuerpo, cookies.admin);

      expect(repetida.status, repetida.texto).toBe(200);
      expect(repetida.cacheControl).toBe('no-store');
      expect(cajaDe(repetida)).toEqual(cajaDe(primera));
      expect(await instantaneaDeCaja(e.A.id)).toBe(antes);
      expect(await auditorias()).toHaveLength(1);
    });

    it('criterio 16: el monto equivalente ("120" y "120.00") es el mismo monto: 200', async () => {
      const clave = randomUUID();
      const primera = await abrir({ claveIdempotencia: clave, montoInicial: '120' });
      expect(primera.status, primera.texto).toBe(201);

      const repetida = await abrir({ claveIdempotencia: clave, montoInicial: '120.00' });

      expect(repetida.status, repetida.texto).toBe(200);
      expect(await leerCajas(e.A.id)).toHaveLength(1);
    });

    it('criterio 16: aunque la caja ya tenga movimientos, el reintento devuelve la caja como está ahora (con sus movimientos y el esperado al día)', async () => {
      const cuerpo = cuerpoApertura({ montoInicial: '100.00' });
      const primera = await abrir(cuerpo);
      const caja = cajaDe(primera);
      const alumno = await crearAlumnoDeCaja(e.A.id);
      await crearIngresoDePrueba(e.A.id, caja.id, e.secretariaA.id, alumno.id, { monto: '42.00' });
      await crearEgresoDePrueba(e.A.id, caja.id, e.secretariaA.id, { monto: '15.50' });

      const repetida = await abrir(cuerpo);

      expect(repetida.status, repetida.texto).toBe(200);
      expect(cajaDe(repetida).id).toBe(caja.id);
      expect(cajaDe(repetida).movimientos).toHaveLength(2);
      expect(cajaDe(repetida).resumen.esperado.efectivo).toBe('126.50');
      expect(await auditorias()).toHaveLength(1);
    });

    it('criterio 16: aunque la caja ya esté cerrada, el reintento responde 200 con la caja cerrada y su cierre (no 409)', async () => {
      const cuerpo = cuerpoApertura({ montoInicial: '100.00' });
      const caja = cajaDe(await abrir(cuerpo));
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id);

      const repetida = await abrir(cuerpo);

      expect(repetida.status, repetida.texto).toBe(200);
      expect(cajaDe(repetida).estado).toBe('CERRADA');
      expect(cajaDe(repetida).cierres).toHaveLength(1);
      expect(await leerCajas(e.A.id)).toHaveLength(1);
      expect(await auditorias()).toHaveLength(1);
    });

    it('criterio 16: la misma clave con otro monto responde 409 CLAVE_YA_USADA y no escribe', async () => {
      const clave = randomUUID();
      await abrir({ claveIdempotencia: clave, montoInicial: '100.00' });
      const antes = await instantaneaDeCaja(e.A.id);

      const repetida = await abrir({ claveIdempotencia: clave, montoInicial: '100.01' });

      expect(repetida.status, repetida.texto).toBe(409);
      expect(codigoDe(repetida)).toBe('CLAVE_YA_USADA');
      expect(await instantaneaDeCaja(e.A.id)).toBe(antes);
      expect(await auditorias()).toHaveLength(1);
    });

    it('criterio 16: dos envíos simultáneos con la misma clave dejan una sola caja y un solo CAJA_ABIERTA: uno responde 201 y el otro 200', async () => {
      const cuerpo = cuerpoApertura({ montoInicial: '100.00' });

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerUsuarios(e.A.id, [e.secretariaA.id]),
        enviar: [() => abrir(cuerpo), () => abrir(cuerpo)],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'los dos envíos no quedaron esperando la fila del actor').toBe(true);
      expect(estados(resultados), resultados.map((r) => r.texto).join(' | ')).toEqual([200, 201]);
      const filas = await leerCajas(e.A.id);
      expect(filas).toHaveLength(1);
      for (const respuesta of resultados) expect(cajaDe(respuesta).id).toBe(filas[0]?.id);
      expect(await auditorias()).toHaveLength(1);
    });

    it('criterio 16: dos envíos simultáneos de dos personas con la misma clave también dejan una sola caja: 201 y 200', async () => {
      const cuerpo = cuerpoApertura({ montoInicial: '100.00' });

      const { resultados } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerUsuarios(e.A.id, [e.secretariaA.id, e.adminA.id]),
        enviar: [() => abrir(cuerpo, cookies.secretaria), () => abrir(cuerpo, cookies.admin)],
        liberar: 'ROLLBACK',
      });

      expect(estados(resultados), resultados.map((r) => r.texto).join(' | ')).toEqual([200, 201]);
      expect(await leerCajas(e.A.id)).toHaveLength(1);
      expect(await auditorias()).toHaveLength(1);
    });

    it('criterio 16: una clave de B no choca con una de A: la misma clave abre la caja de A aunque B ya la usó', async () => {
      const clave = randomUUID();
      await crearCajaDePrueba(e.B.id, e.secretariaB.id, { clave_idempotencia: clave });

      const respuesta = await abrir({ claveIdempotencia: clave, montoInicial: '100.00' });

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await leerCajas(e.A.id)).toHaveLength(1);
    });

    it('criterio 16: la clave de la caja de A usada por B no devuelve la caja de A ni choca: B abre la suya', async () => {
      const clave = randomUUID();
      const deA = cajaDe(await abrir({ claveIdempotencia: clave, montoInicial: '100.00' }));

      const respuesta = await abrir({ claveIdempotencia: clave, montoInicial: '100.00' }, cookies.secretariaB);

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(cajaDe(respuesta).id).not.toBe(deA.id);
      expect(await leerCajas(e.B.id)).toHaveLength(1);
    });
  });
});
