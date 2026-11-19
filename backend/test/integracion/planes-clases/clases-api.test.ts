import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  ACCION_CLASE_ACTUALIZADA,
  ACCION_CLASE_CREADA,
  camposConError,
  type ClaseApi,
  type ClaseDePrueba,
  type ClientePC,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  cuerpoClase,
  escucharParaPlanesClases,
  exigirRutasDePlanesYClases,
  instantaneaDePlanesYClases,
  leerClase,
  leerClases,
} from '../../utilidades/planes-clases';
import {
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  pedir,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Clases (spec 004, criterios 16, 17, 19, 20, 21, 24 y 25): crear, bloques, entrenador válido, choques del bloque, editar, lista y entrenador
// desactivado. Lo crítico del aforo, del cupo y del aislamiento está en las pruebas protegidas.

describe('clases: API de la academia', () => {
  let app: NestExpressApplication;
  let http: ClientePC;
  let e: Escenario;
  let admin: string;
  let entrenador2: UsuarioDePrueba;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    http = await escucharParaPlanesClases(app);
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    entrenador2 = await crearEntrenadorDePrueba(e.A.id, { nombres: 'Nora', apellidos: 'Navarro' });
    await insertarAuditoria(e.A.id, 'ACCION_PREVIA_A');
  });
  afterAll(async () => {
    await http?.cerrar();
  });

  async function estadoDeA() {
    return {
      filas: await instantaneaDePlanesYClases(e.A.id),
      auditoria: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    };
  }
  const crear = (cuerpo: unknown) => pedir(app, 'post', '/api/clases', { cookie: admin, cuerpo });
  const editar = (id: string, cuerpo: unknown) => pedir(app, 'patch', `/api/clases/${id}`, { cookie: admin, cuerpo });
  const claseDe = (respuesta: { body: unknown }) => (respuesta.body as { clase: ClaseApi }).clase;
  const codigoDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).codigo;

  describe('crear (criterio 16)', () => {
    it('criterio 16: responde 201 con { clase }: horaFin una hora después, activo y el entrenador sin DNI', async () => {
      const respuesta = await crear(
        cuerpoClase(e.entrenadorA.id, { nivel: 'INTERMEDIO', diaSemana: 3, horaInicio: '10:00' }),
      );

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
      expect(respuesta.headers['cache-control']).toMatch(/no-store/);
      expect(claseDe(respuesta)).toEqual({
        id: expect.any(String) as string,
        nivel: 'INTERMEDIO',
        diaSemana: 3,
        horaInicio: '10:00',
        horaFin: '11:00',
        aforo: 30,
        activo: true,
        entrenador: { id: e.entrenadorA.id, nombres: 'Mario', apellidos: 'Castro', activo: true },
      });
      expect(JSON.stringify(respuesta.body)).not.toContain(e.entrenadorA.dni);
      expect(await leerClase(e.A.id, claseDe(respuesta).id)).toMatchObject({
        nivel: 'INTERMEDIO',
        dia_semana: 3,
        hora_inicio: '10:00',
        hora_fin: '11:00',
        aforo: 30,
        activo: true,
        entrenador_id: e.entrenadorA.id,
      });
    });

    it('criterio 16: registra CLASE_CREADA con la entidad clase, su id, el actor USUARIO, la IP y los datos de la clase', async () => {
      const respuesta = await crear(cuerpoClase(e.entrenadorA.id, { aforo: 25 }));

      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_CREADA);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({
        actor_tipo: 'USUARIO',
        actor_id: e.adminA.id,
        entidad: 'clase',
        entidad_id: claseDe(respuesta).id,
        datos_antes: null,
        datos_despues: {
          nivel: 'BASICO',
          diaSemana: 1,
          horaInicio: '08:00',
          horaFin: '09:00',
          entrenadorId: e.entrenadorA.id,
          aforo: 25,
          activo: true,
        },
      });
      expect(auditoria[0]?.ip).toEqual(expect.any(String));
    });

    it('criterio 16: el entrenador puede venir con el UUID en mayúsculas', async () => {
      const respuesta = await crear(cuerpoClase(e.entrenadorA.id.toUpperCase()));

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
      expect(claseDe(respuesta).entrenador.id).toBe(e.entrenadorA.id);
    });
  });

  describe('bloques de 1 hora (criterio 17)', () => {
    it.each(['08:00', '09:00', '12:00', '18:00', '19:00'])(
      'criterio 17: la hora de inicio %s se acepta',
      async (hora) => {
        const respuesta = await crear(cuerpoClase(e.entrenadorA.id, { horaInicio: hora }));

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
      },
    );

    it('criterio 17: la clase de las 19:00 termina a las 20:00', async () => {
      const respuesta = await crear(cuerpoClase(e.entrenadorA.id, { horaInicio: '19:00' }));

      expect(claseDe(respuesta)).toMatchObject({ horaInicio: '19:00', horaFin: '20:00' });
    });

    it.each(['07:00', '20:00', '08:30', '8:00', '08:00:00', '24:00', '', null, 8])(
      'criterio 17: la hora de inicio %j responde 400 con el error en horaInicio y no escribe nada',
      async (hora) => {
        const antes = await estadoDeA();

        const respuesta = await crear(cuerpoClase(e.entrenadorA.id, { horaInicio: hora }));

        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
        expect(camposConError(respuesta)).toContain('horaInicio');
        expect(await estadoDeA()).toEqual(antes);
      },
    );

    it.each([
      ['diaSemana 0', { diaSemana: 0 }, 'diaSemana'],
      ['diaSemana 8', { diaSemana: 8 }, 'diaSemana'],
      ['diaSemana 1.5', { diaSemana: 1.5 }, 'diaSemana'],
      ['diaSemana "1"', { diaSemana: '1' }, 'diaSemana'],
      ['nivel desconocido', { nivel: 'EXPERTO' }, 'nivel'],
      ['nivel en minúsculas', { nivel: 'basico' }, 'nivel'],
      ['sin nivel', { nivel: undefined }, 'nivel'],
    ])('criterio 17: %s responde 400 con el error en el campo', async (_nombre, cambio, campo) => {
      const antes = await estadoDeA();

      const respuesta = await crear(cuerpoClase(e.entrenadorA.id, cambio));

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect(camposConError(respuesta)).toContain(campo);
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 17: los siete días se aceptan', async () => {
      for (let dia = 1; dia <= 7; dia++) {
        const respuesta = await crear(cuerpoClase(e.entrenadorA.id, { diaSemana: dia }));
        expect(respuesta.status, `día ${dia}: ${JSON.stringify(respuesta.body)}`).toBe(201);
      }
    });
  });

  describe('entrenador válido (criterio 19)', () => {
    it('criterio 19: un entrenador que no existe, de otra academia, con otro rol o inactivo responde 409 ENTRENADOR_NO_VALIDO con el mismo cuerpo, sin escribir ni auditar', async () => {
      const deB = await crearEntrenadorDePrueba(e.B.id);
      const inactivo = await crearEntrenadorDePrueba(e.A.id, { estado: 'INACTIVO' });
      const antes = await estadoDeA();

      const respuestas = [];
      for (const id of [
        '00000000-0000-4000-8000-000000000000',
        deB.id,
        e.secretariaA.id,
        e.adminA.id,
        e.alumnoA.id,
        inactivo.id,
      ]) {
        respuestas.push(await crear(cuerpoClase(id, { diaSemana: 4 })));
      }

      for (const respuesta of respuestas) {
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(409);
        expect(codigoDe(respuesta)).toBe('ENTRENADOR_NO_VALIDO');
        expect(respuesta.body).toEqual(respuestas[0]?.body);
      }
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 19: un entrenadorId que no es UUID responde 400', async () => {
      const respuesta = await crear(cuerpoClase('no-es-un-uuid'));

      expect(respuesta.status).toBe(400);
      expect(camposConError(respuesta)).toContain('entrenadorId');
    });
  });

  describe('clases en el mismo bloque (criterio 20)', () => {
    it('criterio 20 a: clases de niveles distintos con entrenadores distintos se crean en el mismo día y bloque (hasta tres a la vez)', async () => {
      const tercero = await crearEntrenadorDePrueba(e.A.id);

      const basico = await crear(cuerpoClase(e.entrenadorA.id, { nivel: 'BASICO', diaSemana: 2, horaInicio: '18:00' }));
      const intermedio = await crear(
        cuerpoClase(entrenador2.id, { nivel: 'INTERMEDIO', diaSemana: 2, horaInicio: '18:00' }),
      );
      const avanzado = await crear(cuerpoClase(tercero.id, { nivel: 'AVANZADO', diaSemana: 2, horaInicio: '18:00' }));

      expect([basico.status, intermedio.status, avanzado.status]).toEqual([201, 201, 201]);
    });

    it('criterio 20 b: si el entrenador ya tiene otra clase activa ese día en ese bloque responde 409 ENTRENADOR_OCUPADO; en otro día u otro bloque se permite', async () => {
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { nivel: 'BASICO', dia_semana: 2, hora_inicio: '10:00' });
      const antes = await estadoDeA();

      const choca = await crear(
        cuerpoClase(e.entrenadorA.id, { nivel: 'AVANZADO', diaSemana: 2, horaInicio: '10:00' }),
      );

      expect(choca.status, JSON.stringify(choca.body)).toBe(409);
      expect(codigoDe(choca)).toBe('ENTRENADOR_OCUPADO');
      expect(await estadoDeA()).toEqual(antes);
      for (const otro of [
        { nivel: 'AVANZADO', diaSemana: 3, horaInicio: '10:00' },
        { nivel: 'AVANZADO', diaSemana: 2, horaInicio: '11:00' },
      ]) {
        const libre = await crear(cuerpoClase(e.entrenadorA.id, otro));
        expect(libre.status, JSON.stringify(otro)).toBe(201);
      }
    });

    it('criterio 20 c: si ya hay una clase activa del mismo nivel ese día en ese bloque responde 409 CLASE_DUPLICADA, aunque sea de otro entrenador', async () => {
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { nivel: 'INTERMEDIO', dia_semana: 4, hora_inicio: '18:00' });
      const antes = await estadoDeA();

      const choca = await crear(
        cuerpoClase(entrenador2.id, { nivel: 'INTERMEDIO', diaSemana: 4, horaInicio: '18:00' }),
      );

      expect(choca.status, JSON.stringify(choca.body)).toBe(409);
      expect(codigoDe(choca)).toBe('CLASE_DUPLICADA');
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 20 d: las clases inactivas no cuentan para b ni para c', async () => {
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, {
        nivel: 'BASICO',
        dia_semana: 5,
        hora_inicio: '09:00',
        activo: false,
      });

      const mismoEntrenador = await crear(
        cuerpoClase(e.entrenadorA.id, { nivel: 'AVANZADO', diaSemana: 5, horaInicio: '09:00' }),
      );
      const mismoNivel = await crear(
        cuerpoClase(entrenador2.id, { nivel: 'BASICO', diaSemana: 5, horaInicio: '09:00' }),
      );

      expect(mismoEntrenador.status, JSON.stringify(mismoEntrenador.body)).toBe(201);
      expect(mismoNivel.status, JSON.stringify(mismoNivel.body)).toBe(201);
    });

    it('criterio 20 e: si se cumplen b y c a la vez responde CLASE_DUPLICADA', async () => {
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { nivel: 'BASICO', dia_semana: 6, hora_inicio: '12:00' });

      const choca = await crear(cuerpoClase(e.entrenadorA.id, { nivel: 'BASICO', diaSemana: 6, horaInicio: '12:00' }));

      expect(choca.status).toBe(409);
      expect(codigoDe(choca)).toBe('CLASE_DUPLICADA');
    });

    it.each([
      ['por el entrenador (ENTRENADOR_OCUPADO)', ['BASICO', 'a'], ['AVANZADO', 'a'], 'ENTRENADOR_OCUPADO'],
      ['por el nivel (CLASE_DUPLICADA)', ['BASICO', 'a'], ['BASICO', 'b'], 'CLASE_DUPLICADA'],
    ] as const)(
      'criterio 20 f: dos creaciones simultáneas que chocan %s: exactamente una responde 201 y la otra 409; queda una fila y una CLASE_CREADA',
      async (_nombre, primera, segunda, esperado) => {
        const entrenadores = { a: e.entrenadorA.id, b: entrenador2.id };
        for (let ronda = 0; ronda < 5; ronda++) {
          const dia = 1 + ronda;
          const respuestas = await Promise.all(
            [primera, segunda].map(([nivel, entrenador]) =>
              http.post(
                '/api/clases',
                admin,
                cuerpoClase(entrenadores[entrenador], { nivel, diaSemana: dia, horaInicio: '16:00' }),
              ),
            ),
          );

          expect(respuestas.map((r) => r.status).sort(), `ronda ${ronda}`).toEqual([201, 409]);
          expect(respuestas.find((r) => r.status === 409)?.body?.codigo).toBe(esperado);
          expect((await leerClases(e.A.id)).filter((fila) => fila.dia_semana === dia)).toHaveLength(1);
        }
        expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_CREADA)).toHaveLength(5);
      },
    );
  });

  describe('editar (criterio 21)', () => {
    let clase: ClaseDePrueba;

    beforeEach(async () => {
      clase = await crearClaseDePrueba(e.A.id, e.entrenadorA.id, {
        nivel: 'BASICO',
        dia_semana: 2,
        hora_inicio: '10:00',
        aforo: 30,
      });
    });

    it.each([
      ['nivel', { nivel: 'AVANZADO' }],
      ['diaSemana', { diaSemana: 3 }],
      ['horaInicio', { horaInicio: '11:00' }],
      ['horaFin', { aforo: 30, horaFin: '12:00' }],
      ['entrenadorId que no es UUID', { entrenadorId: 'x' }],
      ['activo que no es booleano', { activo: 'no' }],
      ['el cuerpo vacío', {}],
    ])('criterio 21: %s responde 400 y la clase no cambia', async (_nombre, cuerpo) => {
      const antes = await estadoDeA();

      const respuesta = await editar(clase.id, cuerpo);

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 21: cambiar el aforo, el entrenador y el estado devuelve { clase } y registra un solo CLASE_ACTUALIZADA con antes y después de lo que cambió', async () => {
      const respuesta = await editar(clase.id, { aforo: 45, entrenadorId: entrenador2.id, activo: false });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(claseDe(respuesta)).toMatchObject({
        id: clase.id,
        aforo: 45,
        activo: false,
        entrenador: { id: entrenador2.id, nombres: 'Nora', apellidos: 'Navarro', activo: true },
      });
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_ACTUALIZADA);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ actor_id: e.adminA.id, entidad: 'clase', entidad_id: clase.id });
      expect(auditoria[0]?.datos_antes).toEqual({ entrenadorId: e.entrenadorA.id, aforo: 30, activo: true });
      expect(auditoria[0]?.datos_despues).toEqual({ entrenadorId: entrenador2.id, aforo: 45, activo: false });
    });

    it('criterio 21: sin cambios responde 200 sin escribir ni auditar', async () => {
      const antes = await estadoDeA();

      const respuesta = await editar(clase.id, {
        aforo: 30,
        activo: true,
        entrenadorId: e.entrenadorA.id.toUpperCase(),
      });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(claseDe(respuesta).aforo).toBe(30);
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 21: cambiar el entrenador exige uno válido (19) y que no tenga otra clase activa en el bloque (20 b)', async () => {
      await crearClaseDePrueba(e.A.id, entrenador2.id, { nivel: 'AVANZADO', dia_semana: 2, hora_inicio: '10:00' });
      const inactivo = await crearEntrenadorDePrueba(e.A.id, { estado: 'INACTIVO' });
      const antes = await estadoDeA();

      const ocupado = await editar(clase.id, { entrenadorId: entrenador2.id });
      const noValido = await editar(clase.id, { entrenadorId: inactivo.id });
      const deSecretaria = await editar(clase.id, { entrenadorId: e.secretariaA.id });

      expect(ocupado.status).toBe(409);
      expect(codigoDe(ocupado)).toBe('ENTRENADOR_OCUPADO');
      expect(noValido.status).toBe(409);
      expect(codigoDe(noValido)).toBe('ENTRENADOR_NO_VALIDO');
      expect(deSecretaria.status).toBe(409);
      expect(codigoDe(deSecretaria)).toBe('ENTRENADOR_NO_VALIDO');
      expect(await estadoDeA()).toEqual(antes);
    });

    it('criterio 21: reactivar exige un entrenador activo y aplica 20 b y 20 c: si mientras tanto se creó otra clase igual, responde 409', async () => {
      await editar(clase.id, { activo: false });
      const otraDelNivel = await crearClaseDePrueba(e.A.id, entrenador2.id, {
        nivel: 'BASICO',
        dia_semana: 2,
        hora_inicio: '10:00',
      });
      const antes = await estadoDeA();

      const duplicada = await editar(clase.id, { activo: true });

      expect(duplicada.status, JSON.stringify(duplicada.body)).toBe(409);
      expect(codigoDe(duplicada)).toBe('CLASE_DUPLICADA');

      // Sin la clase del mismo nivel, pero con el entrenador ocupado en el bloque, es ENTRENADOR_OCUPADO.
      await editar(otraDelNivel.id, { activo: false });
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { nivel: 'AVANZADO', dia_semana: 2, hora_inicio: '10:00' });
      const ocupado = await editar(clase.id, { activo: true });
      expect(ocupado.status, JSON.stringify(ocupado.body)).toBe(409);
      expect(codigoDe(ocupado)).toBe('ENTRENADOR_OCUPADO');
      expect((await leerClase(e.A.id, clase.id))?.activo).toBe(false);
      expect(antes).toBeDefined();
    });

    it('criterio 21: reactivar una clase sin choques la deja activa y audita el cambio', async () => {
      await editar(clase.id, { activo: false });

      const respuesta = await editar(clase.id, { activo: true });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(claseDe(respuesta).activo).toBe(true);
      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_CLASE_ACTUALIZADA);
      // El reloj de la prueba está fijo: las dos auditorías tienen la misma hora y su orden no se distingue.
      expect(auditoria.map((fila) => JSON.stringify(fila.datos_despues)).sort()).toEqual(
        [JSON.stringify({ activo: false }), JSON.stringify({ activo: true })].sort(),
      );
    });

    it('criterio 21: reactivar una clase cuyo entrenador está inactivo responde 409 ENTRENADOR_NO_VALIDO', async () => {
      const inactivo = await crearEntrenadorDePrueba(e.A.id, { estado: 'INACTIVO' });
      const apagada = await crearClaseDePrueba(e.A.id, inactivo.id, {
        nivel: 'AVANZADO',
        dia_semana: 5,
        hora_inicio: '15:00',
        activo: false,
      });

      const respuesta = await editar(apagada.id, { activo: true });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(409);
      expect(codigoDe(respuesta)).toBe('ENTRENADOR_NO_VALIDO');
      expect((await leerClase(e.A.id, apagada.id))?.activo).toBe(false);
    });

    it('criterio 21: reasignar una clase inactiva a otro entrenador no choca con nadie (los índices solo cubren las activas)', async () => {
      await crearClaseDePrueba(e.A.id, entrenador2.id, { nivel: 'AVANZADO', dia_semana: 2, hora_inicio: '10:00' });
      await editar(clase.id, { activo: false });

      const respuesta = await editar(clase.id, { entrenadorId: entrenador2.id });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(claseDe(respuesta).entrenador.id).toBe(entrenador2.id);
    });

    it('criterio 21: un id que no existe o no es UUID responde 404 con el mismo cuerpo', async () => {
      const inexistente = await editar('00000000-0000-4000-8000-000000000000', { aforo: 40 });
      const noUuid = await editar('abc', { aforo: 40 });

      expect(inexistente.status).toBe(404);
      expect(noUuid.status).toBe(404);
      expect(noUuid.body).toEqual(inexistente.body);
    });
  });

  describe('lista (criterio 24)', () => {
    it('criterio 24: GET /api/clases trae todas las de la academia, activas e inactivas, por día, hora y nivel, con el entrenador y su estado', async () => {
      const tercero = await crearEntrenadorDePrueba(e.A.id);
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { nivel: 'AVANZADO', dia_semana: 2, hora_inicio: '08:00' });
      await crearClaseDePrueba(e.A.id, entrenador2.id, { nivel: 'BASICO', dia_semana: 1, hora_inicio: '19:00' });
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, { nivel: 'BASICO', dia_semana: 1, hora_inicio: '09:00' });
      await crearClaseDePrueba(e.A.id, entrenador2.id, {
        nivel: 'INTERMEDIO',
        dia_semana: 1,
        hora_inicio: '09:00',
        activo: false,
      });
      await crearClaseDePrueba(e.A.id, tercero.id, { nivel: 'AVANZADO', dia_semana: 1, hora_inicio: '09:00' });
      await crearClaseDePrueba(e.B.id, (await crearEntrenadorDePrueba(e.B.id)).id);

      const respuesta = await pedir(app, 'get', '/api/clases', { cookie: admin });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      const clases = (respuesta.body as { clases: ClaseApi[] }).clases;
      expect(clases.map((c) => `${c.diaSemana} ${c.horaInicio} ${c.nivel}`)).toEqual([
        '1 09:00 BASICO',
        '1 09:00 INTERMEDIO',
        '1 09:00 AVANZADO',
        '1 19:00 BASICO',
        '2 08:00 AVANZADO',
      ]);
      expect(clases.map((c) => c.activo)).toEqual([true, false, true, true, true]);
      expect(clases[3]?.entrenador).toEqual({
        id: entrenador2.id,
        nombres: 'Nora',
        apellidos: 'Navarro',
        activo: true,
      });
      expect(JSON.stringify(respuesta.body)).not.toContain(e.entrenadorA.dni);
    });
  });

  describe('entrenador desactivado con clases (criterio 25)', () => {
    it('criterio 25: desactivarlo responde 200 como hoy, sus clases siguen activas y la lista las muestra con entrenador.activo false; se puede cambiar solo el aforo o dar otro entrenador activo', async () => {
      const clase = await crearClaseDePrueba(e.A.id, e.entrenadorA.id, {
        nivel: 'BASICO',
        dia_semana: 3,
        hora_inicio: '17:00',
      });

      const desactivado = await pedir(app, 'post', `/api/usuarios/${e.entrenadorA.id}/desactivar`, { cookie: admin });
      const lista = await pedir(app, 'get', '/api/clases', { cookie: admin });

      expect(desactivado.status, JSON.stringify(desactivado.body)).toBe(200);
      const mostrada = (lista.body as { clases: ClaseApi[] }).clases.find((c) => c.id === clase.id);
      expect(mostrada).toMatchObject({ activo: true, entrenador: { id: e.entrenadorA.id, activo: false } });

      const soloAforo = await editar(clase.id, { aforo: 22 });
      expect(soloAforo.status, JSON.stringify(soloAforo.body)).toBe(200);
      expect(claseDe(soloAforo)).toMatchObject({ aforo: 22, entrenador: { id: e.entrenadorA.id, activo: false } });

      const reasignada = await editar(clase.id, { entrenadorId: entrenador2.id });
      expect(reasignada.status, JSON.stringify(reasignada.body)).toBe(200);
      expect(claseDe(reasignada).entrenador).toMatchObject({ id: entrenador2.id, activo: true });
    });

    it('criterio 25: una clase nueva con un entrenador inactivo se rechaza, y desactivar a un entrenador a la vez que se le crea una clase nunca da 500 ni interbloqueo', async () => {
      const otroAdmin = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ADMIN', clave: 'Clave-Comun-2026' });
      const cookieOtro = cookieDeUsuario(otroAdmin, AHORA_PRUEBAS);
      for (let ronda = 0; ronda < 6; ronda++) {
        const objetivo = await crearEntrenadorDePrueba(e.A.id);

        const [creada, desactivada, desactivaAlAdmin] = await Promise.all([
          http.post(
            '/api/clases',
            admin,
            cuerpoClase(objetivo.id, { diaSemana: 1 + (ronda % 7), horaInicio: '14:00' }),
          ),
          http.post(`/api/usuarios/${objetivo.id}/desactivar`, cookieOtro, {}),
          http.post(`/api/usuarios/${otroAdmin.id}/desactivar`, admin, {}),
        ]);

        expect([201, 409], `ronda ${ronda}: ${JSON.stringify(creada.body)}`).toContain(creada.status);
        expect([200, 401], `ronda ${ronda}: ${JSON.stringify(desactivada.body)}`).toContain(desactivada.status);
        expect([200, 401, 409], `ronda ${ronda}: ${JSON.stringify(desactivaAlAdmin.body)}`).toContain(
          desactivaAlAdmin.status,
        );
        // El segundo administrador queda inactivo tras la primera ronda: lo reactiva el primero.
        await http.post(`/api/usuarios/${otroAdmin.id}/reactivar`, admin, {});
        await crearEntrenadorDePrueba(e.A.id);
      }
    });
  });
});
