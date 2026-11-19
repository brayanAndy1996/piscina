// spec: 004-planes-clases-aforo (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CLASE_ACTUALIZADA,
  ACTUALIZADO_EN_DE_LA_PRUEBA,
  type ClaseDePrueba,
  type ClientePC,
  conClaseRetenida,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  escucharParaPlanesClases,
  exigirRutasDePlanesYClases,
  leerClase,
} from '../../utilidades/planes-clases';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type Escenario,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 22 (crítico, RN-11; regla "aforo y caja en transacciones sin carreras" de CLAUDE.md): un PATCH /api/clases/{id} bloquea la
// fila de la clase con `bloquearClasesParaCupo` justo después de `bloquearActorVigente` y antes de leerla, siempre (cambie o no el
// aforo). Pruebas deterministas, sin depender de tiempos: la prueba retiene la fila de la clase (SELECT ... FOR UPDATE) en una
// transacción propia, envía las peticiones, comprueba con `pg_blocking_pids` que quedaron esperando y solo entonces confirma o revierte.
//   a) la transacción de la prueba cambia el aforo de 30 a 25 sin confirmar; el ADMIN envía { "aforo": 40 }, que queda esperando; la
//      prueba confirma; entonces responde 200 con aforo 40 y su CLASE_ACTUALIZADA tiene datosAntes.aforo 25 (leyó después del bloqueo);
//   b) igual, pero el ADMIN envía { "aforo": 25 }: responde 200 sin escribir ni auditar;
//   c) dos ADMIN envían a la vez aforos distintos sobre la misma clase: los dos responden 200 (nunca 500 ni 40P01), el valor final es el
//      de uno de ellos y las dos auditorías quedan encadenadas.

describe('criterio 22: el cambio de aforo se ordena con el cupo', () => {
  let app: NestExpressApplication;
  let http: ClientePC;
  let e: Escenario;
  let adminX: UsuarioDePrueba;
  let adminY: UsuarioDePrueba;
  let cookieX: string;
  let cookieY: string;
  let clase: ClaseDePrueba;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    http = await escucharParaPlanesClases(app);
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    adminX = e.adminA;
    adminY = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: CLAVE_COMUN });
    cookieX = cookieDeUsuario(adminX, AHORA_PRUEBAS);
    cookieY = cookieDeUsuario(adminY, AHORA_PRUEBAS);
    clase = await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { aforo: 30 });
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  const patch =
    (cookie: string, cuerpo: unknown, id = clase.id) =>
    () =>
      http.patch(`/api/clases/${id}`, cookie, cuerpo);

  describe('a) el aforo se lee después del bloqueo de la clase', () => {
    it('criterio 22 a: la transacción de la prueba cambia el aforo de 30 a 25 sin confirmar; { aforo: 40 } espera y, al confirmar, responde 200 con aforo 40 y datosAntes.aforo 25', async () => {
      const { resultados, todasEsperaron } = await conClaseRetenida({
        academiaId: e.A.id,
        claseId: clase.id,
        cambio: { tipo: 'aforo', aforo: 25 },
        liberar: 'COMMIT',
        enviar: [patch(cookieX, { aforo: 40 })],
      });

      const [respuesta] = resultados;
      expect.soft(todasEsperaron, 'el PATCH debía quedar esperando el bloqueo de la fila de la clase').toBe(true);
      expect.soft(respuesta?.status, JSON.stringify(respuesta?.body)).toBe(200);
      expect(respuesta?.body?.clase?.aforo).toBe(40);
      expect((await leerClase(e.A.id, clase.id))?.aforo).toBe(40);
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_ACTUALIZADA);
      expect(auditoria, 'una sola CLASE_ACTUALIZADA').toHaveLength(1);
      expect(auditoria[0]?.entidad).toBe('clase');
      expect(auditoria[0]?.entidad_id).toBe(clase.id);
      expect(auditoria[0]?.datos_antes, 'leyó el aforo después del bloqueo: el que dejó la prueba').toMatchObject({
        aforo: 25,
      });
      expect(auditoria[0]?.datos_despues).toMatchObject({ aforo: 40 });
    });

    it('criterio 22 a (control): si la prueba revierte, el aforo de antes es 30 y el PATCH lo cambia a 40 con datosAntes.aforo 30', async () => {
      const { resultados, todasEsperaron } = await conClaseRetenida({
        academiaId: e.A.id,
        claseId: clase.id,
        cambio: { tipo: 'aforo', aforo: 25 },
        liberar: 'ROLLBACK',
        enviar: [patch(cookieX, { aforo: 40 })],
      });

      expect.soft(todasEsperaron, 'el PATCH debía quedar esperando el bloqueo de la fila de la clase').toBe(true);
      expect.soft(resultados[0]?.status, JSON.stringify(resultados[0]?.body)).toBe(200);
      expect((await leerClase(e.A.id, clase.id))?.aforo).toBe(40);
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_ACTUALIZADA);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.datos_antes).toMatchObject({ aforo: 30 });
      expect(auditoria[0]?.datos_despues).toMatchObject({ aforo: 40 });
    });
  });

  describe('b) lo que ya vale tras el bloqueo no se escribe', () => {
    it('criterio 22 b: la prueba confirma el aforo 25; { aforo: 25 } espera y responde 200 con 25 sin escribir ni auditar', async () => {
      const { resultados, todasEsperaron } = await conClaseRetenida({
        academiaId: e.A.id,
        claseId: clase.id,
        cambio: { tipo: 'aforo', aforo: 25 },
        liberar: 'COMMIT',
        enviar: [patch(cookieX, { aforo: 25 })],
      });

      expect.soft(todasEsperaron, 'el PATCH debía quedar esperando el bloqueo de la fila de la clase').toBe(true);
      expect.soft(resultados[0]?.status, JSON.stringify(resultados[0]?.body)).toBe(200);
      expect(resultados[0]?.body?.clase?.aforo).toBe(25);
      const fila = await leerClase(e.A.id, clase.id);
      expect(fila?.aforo).toBe(25);
      expect(fila?.actualizado_en.toISOString(), 'la API no escribió la fila: actualizado_en es el de la prueba').toBe(
        ACTUALIZADO_EN_DE_LA_PRUEBA,
      );
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_ACTUALIZADA)).toHaveLength(0);
    });

    it('criterio 22 (siempre): un PATCH que no toca el aforo ({ activo: false }) también espera el bloqueo de la clase y la conserva con el aforo que dejó la prueba', async () => {
      const { resultados, todasEsperaron } = await conClaseRetenida({
        academiaId: e.A.id,
        claseId: clase.id,
        cambio: { tipo: 'aforo', aforo: 25 },
        liberar: 'COMMIT',
        enviar: [patch(cookieX, { activo: false })],
      });

      expect.soft(todasEsperaron, 'el PATCH debía quedar esperando el bloqueo de la fila de la clase').toBe(true);
      expect.soft(resultados[0]?.status, JSON.stringify(resultados[0]?.body)).toBe(200);
      const fila = await leerClase(e.A.id, clase.id);
      expect(fila).toMatchObject({ activo: false, aforo: 25 });
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_ACTUALIZADA);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.datos_antes).toEqual({ activo: true });
      expect(auditoria[0]?.datos_despues).toEqual({ activo: false });
    });

    it('criterio 22 (siempre): un PATCH que no cambia nada ({ aforo: 30 } sobre 30) también espera el bloqueo, responde 200 y no escribe ni audita', async () => {
      const { resultados, todasEsperaron } = await conClaseRetenida({
        academiaId: e.A.id,
        claseId: clase.id,
        cambio: { tipo: 'bloquear' },
        liberar: 'ROLLBACK',
        enviar: [patch(cookieX, { aforo: 30 })],
      });

      expect.soft(todasEsperaron, 'el PATCH debía quedar esperando el bloqueo de la fila de la clase').toBe(true);
      expect.soft(resultados[0]?.status, JSON.stringify(resultados[0]?.body)).toBe(200);
      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_ACTUALIZADA)).toHaveLength(0);
      expect((await leerClase(e.A.id, clase.id))?.aforo).toBe(30);
    });
  });

  describe('c) dos administradores a la vez sobre la misma clase', () => {
    /** Las dos auditorías forman una cadena que empieza en `inicial` y termina en lo que quedó guardado. */
    async function comprobarCadena(claseId: string, inicial: number, pedidos: [number, number]) {
      const filas = await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_ACTUALIZADA);
      expect(filas, 'una CLASE_ACTUALIZADA por cada PATCH').toHaveLength(2);
      const pasos = filas.map((fila) => ({
        antes: (fila.datos_antes as { aforo?: number } | null)?.aforo,
        despues: (fila.datos_despues as { aforo?: number } | null)?.aforo,
      }));
      const primero = pasos.find((paso) => paso.antes === inicial);
      const segundo = pasos.find((paso) => paso !== primero);
      expect(primero, `una auditoría parte del aforo inicial ${inicial}: ${JSON.stringify(pasos)}`).toBeDefined();
      expect(segundo?.antes, 'el antes de la segunda es el después de la primera').toBe(primero?.despues);
      const final = (await leerClase(e.A.id, claseId))?.aforo;
      expect(segundo?.despues, 'la cadena termina en lo guardado').toBe(final);
      expect(pedidos, 'el valor final es el de uno de los dos').toContain(final);
      expect([primero?.despues, segundo?.despues].sort(), 'cada PATCH aparece una vez').toEqual([...pedidos].sort());
    }

    it('criterio 22 c: los dos PATCH esperan el bloqueo, responden 200 (ni 500 ni 40P01), el valor final es el de uno y las dos auditorías quedan encadenadas', async () => {
      const { resultados, todasEsperaron } = await conClaseRetenida({
        academiaId: e.A.id,
        claseId: clase.id,
        cambio: { tipo: 'bloquear' },
        liberar: 'ROLLBACK',
        enviar: [patch(cookieX, { aforo: 35 }), patch(cookieY, { aforo: 45 })],
      });

      expect.soft(todasEsperaron, 'los dos PATCH debían quedar esperando el bloqueo de la fila de la clase').toBe(true);
      for (const respuesta of resultados) {
        expect.soft(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      }
      await comprobarCadena(clase.id, 30, [35, 45]);
    });

    it('criterio 22 c (sin retención, varias rondas): dos administradores sobre cada clase con aforos distintos nunca dan 500 ni 40P01 y las auditorías encadenan', async () => {
      const entrenador = await crearEntrenadorDePrueba(e.A.id);
      for (let ronda = 0; ronda < 6; ronda++) {
        const otra = await crearClaseDePrueba(e.A.id, entrenador.id, {
          dia_semana: 2 + (ronda % 6),
          nivel: 'AVANZADO',
          aforo: 30,
        });

        const respuestas = await Promise.all([
          http.patch(`/api/clases/${otra.id}`, cookieX, { aforo: 31 + ronda }),
          http.patch(`/api/clases/${otra.id}`, cookieY, { aforo: 41 + ronda }),
        ]);

        for (const respuesta of respuestas) {
          expect(respuesta.status, `ronda ${ronda}: ${JSON.stringify(respuesta.body)}`).toBe(200);
        }
        const filas = (await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_ACTUALIZADA)).filter(
          (fila) => fila.entidad_id === otra.id,
        );
        expect(filas, `ronda ${ronda}: una auditoría por PATCH`).toHaveLength(2);
        const pasos = filas.map((fila) => ({
          antes: (fila.datos_antes as { aforo?: number } | null)?.aforo,
          despues: (fila.datos_despues as { aforo?: number } | null)?.aforo,
        }));
        const primero = pasos.find((paso) => paso.antes === 30);
        const segundo = pasos.find((paso) => paso !== primero);
        expect(segundo?.antes, `ronda ${ronda}: encadenadas`).toBe(primero?.despues);
        expect((await leerClase(e.A.id, otra.id))?.aforo).toBe(segundo?.despues);
      }
    });
  });
});
