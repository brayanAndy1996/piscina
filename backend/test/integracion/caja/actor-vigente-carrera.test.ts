// spec: 006-caja (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conFilaRetenida } from '../../utilidades/carreras';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CAJA_ABIERTA,
  ACCION_CAJA_CERRADA,
  ACCION_CAJA_EGRESO,
  ACCION_CAJA_REABIERTA,
  type AppCaja,
  cerrarCajaDePrueba,
  crearAppCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  cuerpoApertura,
  cuerpoCierre,
  cuerpoEgreso,
  cuerpoReapertura,
  type EscenarioCaja,
  exigirRutasDeCaja,
  instantaneaDeCaja,
  leerCajas,
  leerCierres,
  leerMovimientos,
  type RespuestaCaja,
  rutaCaja,
} from '../../utilidades/caja';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  contarAuditoria,
  cookieDeUsuario,
  crearUsuarioDePrueba,
  leerUsuario,
  type RolUsuario,
} from '../../utilidades/usuarios';

// Criterio 9 (crítico, DT-5 de 002): la apertura, el egreso, el cierre y la reapertura llaman a `bloquearActorVigente` como primera sentencia
// de su `conAcademia`. Carrera determinista, como la del criterio 7 de 004: la prueba desactiva a la SECRETARIA X (`estado = 'INACTIVO'`,
// `version_token + 1`) en una transacción sin confirmar; X envía una apertura, un egreso y un cierre válidos, que pasan el middleware y quedan
// esperando; la prueba confirma. Entonces los tres responden 401 NO_AUTENTICADO, sin crear ni cambiar filas ni auditar. Lo mismo con el ADMIN
// que reabre, y si solo sube `version_token`. Sin tiempos ni esperas fijas: el límite de seguridad de `carreras.ts` solo evita que una prueba
// se cuelgue.

interface Peticion {
  nombre: string;
  /** El rol de X. */
  rol: RolUsuario;
  /** Prepara las filas que la petición necesita. */
  preparar: (e: EscenarioCaja) => Promise<void>;
  enviar: (ctx: AppCaja, cookie: string, e: EscenarioCaja) => Promise<RespuestaCaja>;
  accion: string;
  /** Qué cambia si la petición se acepta, para el caso de control. */
  comprobarExito: (e: EscenarioCaja) => Promise<void>;
}

const unaCajaAbierta = async (e: EscenarioCaja) => {
  await crearCajaDePrueba(e.A.id, e.adminA.id, { monto_inicial: '100.00' });
};
const idDeLaCaja = async (e: EscenarioCaja) => (await leerCajas(e.A.id))[0]?.id ?? '';

const PETICIONES: Peticion[] = [
  {
    nombre: 'POST /api/cajas',
    rol: 'SECRETARIA',
    preparar: () => Promise.resolve(),
    enviar: (ctx, cookie) => ctx.http.post('/api/cajas', cookie, cuerpoApertura()),
    accion: ACCION_CAJA_ABIERTA,
    comprobarExito: async (e) => {
      expect(await leerCajas(e.A.id)).toHaveLength(1);
    },
  },
  {
    nombre: 'POST /api/cajas/{id}/egresos',
    rol: 'SECRETARIA',
    preparar: unaCajaAbierta,
    enviar: async (ctx, cookie, e) => ctx.http.post(rutaCaja(await idDeLaCaja(e), '/egresos'), cookie, cuerpoEgreso()),
    accion: ACCION_CAJA_EGRESO,
    comprobarExito: async (e) => {
      expect(await leerMovimientos(e.A.id)).toHaveLength(1);
    },
  },
  {
    nombre: 'POST /api/cajas/{id}/cierre',
    rol: 'SECRETARIA',
    preparar: unaCajaAbierta,
    enviar: async (ctx, cookie, e) => ctx.http.post(rutaCaja(await idDeLaCaja(e), '/cierre'), cookie, cuerpoCierre()),
    accion: ACCION_CAJA_CERRADA,
    comprobarExito: async (e) => {
      expect((await leerCajas(e.A.id))[0]?.estado).toBe('CERRADA');
      expect(await leerCierres(e.A.id)).toHaveLength(1);
    },
  },
  {
    nombre: 'POST /api/cajas/{id}/reapertura',
    rol: 'ADMIN',
    preparar: async (e) => {
      const caja = await crearCajaDePrueba(e.A.id, e.adminA.id, { monto_inicial: '100.00' });
      await cerrarCajaDePrueba(e.A.id, caja.id, e.adminA.id);
    },
    enviar: async (ctx, cookie, e) =>
      ctx.http.post(rutaCaja(await idDeLaCaja(e), '/reapertura'), cookie, cuerpoReapertura()),
    accion: ACCION_CAJA_REABIERTA,
    comprobarExito: async (e) => {
      expect((await leerCajas(e.A.id))[0]?.estado).toBe('ABIERTA');
    },
  },
];

describe('criterio 9: quien pide sigue vigente dentro de la transacción de la caja', () => {
  let ctx: AppCaja;
  let e: EscenarioCaja;

  beforeAll(async () => {
    ctx = await crearAppCaja();
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  async function instantanea() {
    return {
      cajasA: await instantaneaDeCaja(e.A.id),
      cajasB: await instantaneaDeCaja(e.B.id),
      auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
      auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
    };
  }

  describe('X deja de estar vigente mientras la petición espera: 401 NO_AUTENTICADO y no se escribe nada', () => {
    const CASOS = PETICIONES.flatMap((peticion, indice) =>
      [
        { cambio: 'desactivar' as const, estado: 'INACTIVO' },
        { cambio: 'solo-version' as const, estado: 'ACTIVO' },
      ].map((cambio) => ({ indice, nombre: peticion.nombre, ...cambio })),
    );

    it.each(CASOS)(
      'criterio 9 ($nombre, $cambio): X envía una petición válida, espera el bloqueo y al confirmar la prueba responde 401; no se crea ni cambia ninguna fila y no hay auditoría',
      async ({ indice, cambio, estado }) => {
        const peticion = PETICIONES[indice] as Peticion;
        const x = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: peticion.rol, clave: CLAVE_COMUN });
        const cookieX = cookieDeUsuario(x, AHORA_PRUEBAS);
        await peticion.preparar(e);
        const antes = await instantanea();
        const versionAntes = (await leerUsuario(e.A.id, x.id))?.version_token ?? 0;

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: x.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => peticion.enviar(ctx, cookieX, e),
        });

        expect
          .soft(
            esperoElBloqueo,
            `${peticion.nombre}: la petición debía quedar esperando el bloqueo de la fila del actor`,
          )
          .toBe(true);
        expect.soft(resultado.status, `${peticion.nombre}: ${resultado.texto}`).toBe(401);
        expect.soft(resultado.body?.['codigo']).toBe('NO_AUTENTICADO');
        const fila = await leerUsuario(e.A.id, x.id);
        expect(fila?.estado, 'X quedó como lo dejó la prueba').toBe(estado);
        expect(fila?.version_token, 'el que dejó la prueba').toBe(versionAntes + 1);
        expect(await instantanea(), 'ninguna fila de la caja ni la auditoría cambia, en A ni en B').toEqual(antes);
        expect(await leerAuditoriaDeAcademia(e.A.id, peticion.accion)).toHaveLength(0);
        expect(await contarAuditoria(e.A.id)).toBe(0);
      },
    );
  });

  describe('control: la prueba bloquea la fila sin cambiarla y hace ROLLBACK', () => {
    it.each(PETICIONES.map((peticion, indice) => ({ indice, nombre: peticion.nombre })))(
      'criterio 9 (control, $nombre): la petición espera el bloqueo de la fila del actor y, al liberarlo, tiene éxito y registra una sola auditoría',
      async ({ indice }) => {
        const peticion = PETICIONES[indice] as Peticion;
        const x = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: peticion.rol, clave: CLAVE_COMUN });
        const cookieX = cookieDeUsuario(x, AHORA_PRUEBAS);
        await peticion.preparar(e);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: x.id,
          cambio: 'bloquear-sin-cambiar',
          liberar: 'ROLLBACK',
          enviar: () => peticion.enviar(ctx, cookieX, e),
        });

        expect
          .soft(
            esperoElBloqueo,
            `${peticion.nombre} debía pasar por el bloqueo de la fila del actor (bloquearActorVigente)`,
          )
          .toBe(true);
        expect.soft(resultado.status, `${peticion.nombre}: ${resultado.texto}`).toBeLessThan(300);
        expect(resultado.status).toBeGreaterThanOrEqual(200);
        await peticion.comprobarExito(e);
        expect(await leerAuditoriaDeAcademia(e.A.id, peticion.accion)).toHaveLength(1);
        expect((await leerUsuario(e.A.id, x.id))?.estado).toBe('ACTIVO');
      },
    );
  });
});
