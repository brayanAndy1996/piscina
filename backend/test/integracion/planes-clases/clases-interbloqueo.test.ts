import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type ClientePC,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  cuerpoClase,
  escucharParaPlanesClases,
  exigirRutasDePlanesYClases,
} from '../../utilidades/planes-clases';
import {
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  type Escenario,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Spec 004, plan "Riesgos": crear una clase con el entrenador E, desactivar a E y desactivar al administrador que crea, a la vez, nunca
// dan 500 ni interbloqueo (40P01). Las llaves foráneas toman `FOR KEY SHARE` sobre la fila del entrenador, y desactivar (002) toma `FOR
// UPDATE` sobre las filas del actor y del objetivo en el orden de `id`: la clase debe tomar las filas de `usuarios` en ese mismo orden.

describe('clases: crear, reasignar y desactivar a la vez no se interbloquean', () => {
  let app: NestExpressApplication;
  let http: ClientePC;
  let e: Escenario;
  let cookieX: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    http = await escucharParaPlanesClases(app);
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    cookieX = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  /** Un entrenador nuevo cuyo id es menor (o mayor) que el del administrador: el orden en que `desactivar` toma las dos filas. */
  async function entrenadorConIdMenorQue(admin: string, menor: boolean): Promise<UsuarioDePrueba> {
    for (let intento = 0; intento < 200; intento++) {
      const entrenador = await crearEntrenadorDePrueba(e.A.id);
      if (entrenador.id < admin === menor) return entrenador;
    }
    throw new Error('No se pudo crear un entrenador con el orden de id pedido.');
  }

  it.each([true, false])(
    'el mismo administrador crea una clase con E (id de E menor que el suyo: %s) mientras desactiva a E: 200 o 409 y 201 o 409, nunca 500',
    async (menor) => {
      for (let ronda = 0; ronda < 7; ronda++) {
        const entrenador = await entrenadorConIdMenorQue(e.adminA.id, menor);

        const [creada, desactivada] = await Promise.all([
          http.post(
            '/api/clases',
            cookieX,
            cuerpoClase(entrenador.id, { diaSemana: 1 + (ronda % 7), horaInicio: '14:00' }),
          ),
          http.post(`/api/usuarios/${entrenador.id}/desactivar`, cookieX, {}),
        ]);

        expect([201, 409], `ronda ${ronda}: ${JSON.stringify(creada.body)}`).toContain(creada.status);
        expect(desactivada.status, `ronda ${ronda}: ${JSON.stringify(desactivada.body)}`).toBe(200);
      }
    },
  );

  it.each([true, false])(
    'el mismo administrador reasigna una clase a E (id de E menor que el suyo: %s) mientras desactiva a E: nunca 500',
    async (menor) => {
      const actual = await crearEntrenadorDePrueba(e.A.id);
      for (let ronda = 0; ronda < 7; ronda++) {
        const entrenador = await entrenadorConIdMenorQue(e.adminA.id, menor);
        const clase = await crearClaseDePrueba(e.A.id, actual.id, {
          dia_semana: 1 + (ronda % 7),
          hora_inicio: '15:00',
        });

        const [reasignada, desactivada] = await Promise.all([
          http.patch(`/api/clases/${clase.id}`, cookieX, { entrenadorId: entrenador.id }),
          http.post(`/api/usuarios/${entrenador.id}/desactivar`, cookieX, {}),
        ]);

        expect([200, 409], `ronda ${ronda}: ${JSON.stringify(reasignada.body)}`).toContain(reasignada.status);
        expect(desactivada.status, `ronda ${ronda}: ${JSON.stringify(desactivada.body)}`).toBe(200);
      }
    },
  );
});
