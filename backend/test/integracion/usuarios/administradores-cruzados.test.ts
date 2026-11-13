// spec: 002-autenticacion-roles (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conFilasRetenidas, type ClienteHttp, escucharAplicacion, type RespuestaHttp } from '../../utilidades/carreras';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type Escenario,
  leerUsuario,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 57 (ataque ronda 2, consecuencia del criterio 56): dos ADMIN activos de A, X e Y, que se desactivan entre sí a la vez:
// una petición responde 200 y la otra 401 NO_AUTENTICADO, nunca 500 (tampoco por un interbloqueo `40P01`); al final queda
// exactamente uno de los dos ACTIVO y hay exactamente un USUARIO_DESACTIVADO entre los dos. La aserción vale en cualquier orden de
// llegada: no depende de tiempos.

const RONDAS = 20;

describe('criterio 57: dos administradores que se desactivan entre sí a la vez', () => {
  let http: ClienteHttp;
  let e: Escenario;

  beforeAll(async () => {
    const { app } = await crearAppConReloj();
    http = await escucharAplicacion(app);
  });
  beforeEach(async () => {
    e = await crearEscenario();
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  const nuevoAdmin = () => crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_COMUN });
  const desactivar = (actor: UsuarioDePrueba, objetivo: UsuarioDePrueba) => () =>
    http.post(`/api/usuarios/${objetivo.id}/desactivar`, cookieDeUsuario(actor, AHORA_PRUEBAS), {});

  /** Las aserciones de una ronda, iguales para las dos formas de lanzar las peticiones. */
  async function comprobarRonda(
    etiqueta: string,
    x: UsuarioDePrueba,
    y: UsuarioDePrueba,
    deX: RespuestaHttp,
    deY: RespuestaHttp,
  ) {
    const estados = [deX.status, deY.status].sort((a, b) => a - b);
    expect(
      estados,
      `${etiqueta}: X→Y respondió ${deX.status} ${JSON.stringify(deX.body)}; Y→X respondió ${deY.status} ${JSON.stringify(deY.body)}`,
    ).toEqual([200, 401]);
    const perdedor = deX.status === 401 ? deX : deY;
    expect(perdedor.body?.codigo, `${etiqueta}: el 401`).toBe('NO_AUTENTICADO');

    const filaX = await leerUsuario(e.A.id, x.id);
    const filaY = await leerUsuario(e.A.id, y.id);
    const activos = [filaX, filaY].filter((fila) => fila?.estado === 'ACTIVO');
    expect(activos, `${etiqueta}: debe quedar exactamente uno de los dos ACTIVO`).toHaveLength(1);
    // Quien respondió 200 desactivó al otro y sigue activo; quien respondió 401 quedó desactivado.
    const ganadorEsX = deX.status === 200;
    expect(filaX?.estado, `${etiqueta}: X`).toBe(ganadorEsX ? 'ACTIVO' : 'INACTIVO');
    expect(filaY?.estado, `${etiqueta}: Y`).toBe(ganadorEsX ? 'INACTIVO' : 'ACTIVO');

    const desactivaciones = (await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_DESACTIVADO')).filter(
      (fila) => fila.entidad_id === x.id || fila.entidad_id === y.id,
    );
    expect(desactivaciones, `${etiqueta}: exactamente un USUARIO_DESACTIVADO entre los dos`).toHaveLength(1);
    expect(desactivaciones[0]?.actor_id, `${etiqueta}: lo desactivó el ganador`).toBe(ganadorEsX ? x.id : y.id);
  }

  it(`criterio 57: ${RONDAS} rondas con las dos peticiones lanzadas a la vez (administradores nuevos en cada ronda): una 200 y la otra 401, nunca 500, uno activo y un solo USUARIO_DESACTIVADO`, async () => {
    for (let ronda = 1; ronda <= RONDAS; ronda++) {
      const x = await nuevoAdmin();
      const y = await nuevoAdmin();

      const [deX, deY] = await Promise.all([desactivar(x, y)(), desactivar(y, x)()]);

      await comprobarRonda(`ronda ${ronda}`, x, y, deX, deY);
    }
  }, 60_000);

  it('criterio 57: con las dos peticiones esperando a la vez el bloqueo de las dos filas (cruce forzado), una responde 200 y la otra 401, nunca 500', async () => {
    for (let ronda = 1; ronda <= 5; ronda++) {
      const x = await nuevoAdmin();
      const y = await nuevoAdmin();

      const { resultados } = await conFilasRetenidas({
        academiaId: e.A.id,
        ids: [x.id, y.id],
        enviar: [desactivar(x, y), desactivar(y, x)],
      });

      const [deX, deY] = resultados as [RespuestaHttp, RespuestaHttp];
      await comprobarRonda(`cruce forzado ${ronda}`, x, y, deX, deY);
    }
  }, 60_000);

  it('criterio 57 (control): un administrador que desactiva a otro sin ningún cruce responde 200 y sigue ACTIVO', async () => {
    const x = await nuevoAdmin();
    const y = await nuevoAdmin();

    const respuesta = await desactivar(x, y)();

    expect(respuesta.status).toBe(200);
    expect((await leerUsuario(e.A.id, x.id))?.estado).toBe('ACTIVO');
    expect((await leerUsuario(e.A.id, y.id))?.estado).toBe('INACTIVO');
  });
});
