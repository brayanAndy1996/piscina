// spec: 002-autenticacion-roles (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ClienteHttp, conFilaRetenida, escucharAplicacion } from '../../utilidades/carreras';
import {
  actualizarUsuario,
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type Escenario,
  leerUsuario,
  QUINCE_MINUTOS,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 60 (ataque ronda 3, F1): un fallo de la `claveActual` solo se cuenta con la sesión todavía vigente. Carreras
// deterministas con `conFilaRetenida`: la prueba retiene la fila de X en su propia transacción, envía `POST /api/sesion/clave` con
// una `claveActual` equivocada (pasa el middleware porque su lectura no ve lo no confirmado), detecta con `pg_blocking_pids` que la
// API quedó esperando el bloqueo y entonces confirma o revierte. Sin tiempos ni esperas fijas.

const CLAVE_DE_X = CLAVE_COMUN;
const CUERPO_EQUIVOCADO = { claveActual: 'Equivocada-2026', claveNueva: 'Una-Clave-Nueva-2026' };

describe('criterio 60: un fallo de la clave actual solo se cuenta con la sesión todavía vigente', () => {
  let http: ClienteHttp;
  let e: Escenario;

  beforeAll(async () => {
    const { app } = await crearAppConReloj();
    http = await escucharAplicacion(app);
  });
  afterAll(async () => {
    await http?.cerrar();
  });
  beforeEach(async () => {
    e = await crearEscenario();
  });

  /** Un X nuevo de A: clave conocida distinta de su DNI, sin cambio obligatorio y con `previos` fallos ya contados. */
  async function nuevoX(previos: number): Promise<UsuarioDePrueba> {
    const x = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_DE_X });
    expect(x.clave).not.toBe(x.dni);
    if (previos > 0) await actualizarUsuario(e.A.id, x.id, { intentos_fallidos: previos });
    return x;
  }

  const enviarEquivocada = (x: UsuarioDePrueba) =>
    http.post('/api/sesion/clave', cookieDeUsuario(x, AHORA_PRUEBAS), CUERPO_EQUIVOCADO);

  describe('(i) y (ii) X deja de estar vigente mientras la petición espera: 401 NO_AUTENTICADO y no se cuenta el fallo', () => {
    const casos = [
      { cambio: 'desactivar' as const, estado: 'INACTIVO', previos: 0 },
      { cambio: 'desactivar' as const, estado: 'INACTIVO', previos: 4 },
      { cambio: 'solo-version' as const, estado: 'ACTIVO', previos: 0 },
      { cambio: 'solo-version' as const, estado: 'ACTIVO', previos: 4 },
    ];

    it.each(casos)(
      'criterio 60 ($cambio, $previos fallos previos): espera el bloqueo, responde 401 y X queda con el mismo contador, sin bloqueo y sin auditoría nueva',
      async ({ cambio, estado, previos }) => {
        const x = await nuevoX(previos);
        const antes = await leerUsuario(e.A.id, x.id);
        const auditoriaAntes = await contarAuditoria(e.A.id);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: e.A.id,
          actorId: x.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => enviarEquivocada(x),
        });

        expect.soft(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
        expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(401);
        expect.soft(resultado.body?.codigo).toBe('NO_AUTENTICADO');
        const despues = await leerUsuario(e.A.id, x.id);
        expect(despues?.estado).toBe(estado);
        expect(despues?.version_token, 'el que dejó la prueba').toBe((antes?.version_token ?? 0) + 1);
        expect(despues?.intentos_fallidos, 'el fallo no se cuenta').toBe(previos);
        expect(despues?.bloqueado_hasta).toBeNull();
        expect(despues?.clave_hash).toBe(antes?.clave_hash);
        expect(despues?.actualizado_en.toISOString(), 'la API no escribe la fila de X').toBe(
          antes?.actualizado_en.toISOString(),
        );
        expect(await contarAuditoria(e.A.id), 'sin auditoría nueva').toBe(auditoriaAntes);
      },
    );
  });

  describe('(iii) control: la prueba bloquea la fila sin cambiarla y hace ROLLBACK', () => {
    it('criterio 60 (iii): con 0 fallos previos, espera el bloqueo y al liberarlo responde 400 CLAVE_ACTUAL_INCORRECTA con el contador en 1', async () => {
      const x = await nuevoX(0);
      const antes = await leerUsuario(e.A.id, x.id);

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: e.A.id,
        actorId: x.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'ROLLBACK',
        enviar: () => enviarEquivocada(x),
      });

      expect.soft(esperoElBloqueo, 'el conteo debía pasar por el bloqueo de la fila del actor').toBe(true);
      expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(400);
      expect.soft(resultado.body?.codigo).toBe('CLAVE_ACTUAL_INCORRECTA');
      const despues = await leerUsuario(e.A.id, x.id);
      expect(despues?.intentos_fallidos).toBe(1);
      expect(despues?.bloqueado_hasta).toBeNull();
      expect(despues?.estado).toBe('ACTIVO');
      expect(despues?.version_token).toBe(antes?.version_token);
      expect(despues?.clave_hash).toBe(antes?.clave_hash);
    });

    it('criterio 60 (iii): con 4 fallos previos, espera el bloqueo y al liberarlo responde 423 CUENTA_BLOQUEADA con el contador en 5 y bloqueado_hasta = ahora + 15 min', async () => {
      const x = await nuevoX(4);

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: e.A.id,
        actorId: x.id,
        cambio: 'bloquear-sin-cambiar',
        liberar: 'ROLLBACK',
        enviar: () => enviarEquivocada(x),
      });

      expect.soft(esperoElBloqueo, 'el conteo debía pasar por el bloqueo de la fila del actor').toBe(true);
      expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(423);
      expect.soft(resultado.body?.codigo).toBe('CUENTA_BLOQUEADA');
      const despues = await leerUsuario(e.A.id, x.id);
      expect(despues?.intentos_fallidos).toBe(5);
      expect(despues?.bloqueado_hasta?.toISOString()).toBe(
        new Date(AHORA_PRUEBAS.getTime() + QUINCE_MINUTOS).toISOString(),
      );
    });
  });

  describe('(iv) precisión de la c): con el cambio obligatorio pendiente, X sigue vigente para esta ruta', () => {
    it('criterio 60 (iv): solo debe_cambiar_clave = true confirmado mientras espera: responde 400 CLAVE_ACTUAL_INCORRECTA y el contador queda en 1', async () => {
      const x = await nuevoX(0);

      const { resultado, esperoElBloqueo } = await conFilaRetenida({
        academiaId: e.A.id,
        actorId: x.id,
        cambio: 'solo-cambio-pendiente',
        liberar: 'COMMIT',
        enviar: () => enviarEquivocada(x),
      });

      expect.soft(esperoElBloqueo, 'la petición debía quedar esperando el bloqueo de la fila del actor').toBe(true);
      expect.soft(resultado.status, JSON.stringify(resultado.body)).toBe(400);
      expect.soft(resultado.body?.codigo).toBe('CLAVE_ACTUAL_INCORRECTA');
      const despues = await leerUsuario(e.A.id, x.id);
      expect(despues?.debe_cambiar_clave).toBe(true);
      expect(despues?.estado).toBe('ACTIVO');
      expect(despues?.intentos_fallidos).toBe(1);
    });
  });
});
