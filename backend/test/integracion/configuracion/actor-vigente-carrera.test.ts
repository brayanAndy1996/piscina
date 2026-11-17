// spec: 003-configuracion-academia (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCION_AUDITORIA,
  type ClienteDeConfiguracion,
  escucharParaConfiguracion,
  exigirRutasDeConfiguracion,
  fijarConfiguracion,
  instantaneaDeConfiguracion,
  leerFilaConfiguracion,
} from '../../utilidades/configuracion';
import { conFilaRetenida } from '../../utilidades/carreras';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type Escenario,
  leerUsuario,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 11 (crítico, DT-5 de 002): PATCH /api/configuracion llama a `bloquearActorVigente` como primera sentencia de su transacción.
// Carrera determinista, como la del criterio 56 de 002: la prueba abre su propia transacción sobre la fila del ADMIN X, la deja sin
// confirmar (desactivándolo, o subiendo solo su `version_token`), X envía un PATCH válido (que pasa el middleware porque su lectura no
// ve lo no confirmado), la prueba detecta con `pg_blocking_pids` que la conexión de la API quedó esperando el bloqueo y entonces
// confirma. Entonces la respuesta es 401 NO_AUTENTICADO, ninguna fila de `configuraciones` cambia y no hay CONFIGURACION_ACTUALIZADA.
// Sin tiempos ni esperas fijas: el límite de seguridad de `carreras.ts` solo evita que una prueba se cuelgue.

const CAMBIO_PEDIDO = { intentosInicioSesion: 4, telefono: '999 888 777' };

describe('criterio 11: el administrador sigue vigente dentro de la transacción que escribe la configuración', () => {
  let app: NestExpressApplication;
  let http: ClienteDeConfiguracion;
  let e: Escenario;
  let x: UsuarioDePrueba; // ADMIN de A que hace las peticiones
  let cookieX: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    http = await escucharParaConfiguracion(app);
  });
  beforeEach(async () => {
    exigirRutasDeConfiguracion(app);
    e = await crearEscenario();
    x = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_COMUN });
    cookieX = cookieDeUsuario(x, AHORA_PRUEBAS);
    // Filas previas en A y en B: "ninguna fila cambia" tiene que poder verse.
    await fijarConfiguracion(e.A.id, { toleranciaTardanzaMinutos: 12, intentosInicioSesion: 6 });
    await fijarConfiguracion(e.B.id, { toleranciaTardanzaMinutos: 3 });
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  const carrera = (cambio: 'desactivar' | 'solo-version' | 'bloquear-sin-cambiar', liberar: 'COMMIT' | 'ROLLBACK') =>
    conFilaRetenida({
      academiaId: e.A.id,
      actorId: x.id,
      cambio,
      liberar,
      enviar: () => http.patch('/api/configuracion', cookieX, CAMBIO_PEDIDO),
    });

  async function instantanea() {
    return {
      filasA: await instantaneaDeConfiguracion(e.A.id),
      filasB: await instantaneaDeConfiguracion(e.B.id),
      auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
      auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
    };
  }

  describe('X deja de estar vigente mientras la petición espera: 401 NO_AUTENTICADO y no se escribe nada', () => {
    it.each([
      { cambio: 'desactivar' as const, estado: 'INACTIVO' },
      { cambio: 'solo-version' as const, estado: 'ACTIVO' },
    ])(
      'criterio 11 ($cambio): X envía un PATCH válido, la petición espera el bloqueo y al confirmar la prueba responde 401; ninguna fila de configuraciones cambia y no hay CONFIGURACION_ACTUALIZADA',
      async ({ cambio, estado }) => {
        const antes = await instantanea();
        const versionAntes = (await leerUsuario(e.A.id, x.id))?.version_token ?? 0;

        const { resultado, esperoElBloqueo } = await carrera(cambio, 'COMMIT');

        expect.soft(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
        expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(401);
        expect.soft(resultado.body?.codigo).toBe('NO_AUTENTICADO');
        const fila = await leerUsuario(e.A.id, x.id);
        expect(fila?.estado, 'X quedó como lo dejó la prueba').toBe(estado);
        expect(fila?.version_token, 'el que dejó la prueba').toBe(versionAntes + 1);
        expect(await instantanea(), 'ninguna fila de configuraciones ni de auditoría cambia, en A ni en B').toEqual(
          antes,
        );
        expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_AUDITORIA)).toHaveLength(0);
        expect(await contarAuditoria(e.A.id)).toBe(0);
        expect(await leerFilaConfiguracion(e.A.id, 'telefono'), 'el teléfono pedido no se escribió').toBeUndefined();
      },
    );
  });

  describe('control: la prueba bloquea la fila sin cambiarla y hace ROLLBACK', () => {
    it('criterio 11 (control): la petición espera el bloqueo de la fila del actor y, al liberarlo, responde 200, escribe los dos campos y registra una sola CONFIGURACION_ACTUALIZADA', async () => {
      const { resultado, esperoElBloqueo } = await carrera('bloquear-sin-cambiar', 'ROLLBACK');

      expect
        .soft(esperoElBloqueo, 'PATCH debía pasar por el bloqueo de la fila del actor (bloquearActorVigente)')
        .toBe(true);
      expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(200);
      expect(resultado.body?.configuracion).toMatchObject({ intentosInicioSesion: 4, telefono: '999 888 777' });
      expect((await leerFilaConfiguracion(e.A.id, 'intentos_inicio_sesion'))?.valor).toBe(4);
      expect((await leerFilaConfiguracion(e.A.id, 'telefono'))?.valor).toBe('999 888 777');
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_AUDITORIA)).toHaveLength(1);
      const fila = await leerUsuario(e.A.id, x.id);
      expect(fila?.estado).toBe('ACTIVO');
    });
  });
});
