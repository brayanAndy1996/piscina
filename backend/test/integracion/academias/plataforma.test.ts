// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { crearAcademiaDePrueba } from '../../utilidades/academias';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import {
  contarDeAcademia,
  insertarAuditoria,
  insertarConfiguracion,
  leerAcademias,
  leerAuditoriaPlataforma,
} from '../../utilidades/datos';
import { type BaseDatosPrueba, cargarPrisma, obtenerBaseDatos, uuidInexistente } from '../../utilidades/modulos';
import { cookieDeSesion, crearSuperadminDePrueba, type SuperadminDePrueba } from '../../utilidades/superadmins';

const AHORA = new Date('2026-11-11T15:00:00.000Z');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CLAVES_DE_ACADEMIA = ['id', 'nombre', 'nombreCorto', 'estado', 'creadaEn', 'suspendidaEn', 'motivoSuspension'];

interface ErrorCuerpo {
  codigo: string;
  mensaje: string;
  detalles?: { errores?: { campo: string; mensaje: string }[] };
}
interface AcademiaCuerpo {
  id: string;
  nombre: string;
  nombreCorto: string;
  estado: string;
  creadaEn: string;
  suspendidaEn: string | null;
  motivoSuspension: string | null;
}

describe('academias desde la plataforma', () => {
  let app: NestExpressApplication;
  let reloj: RelojFijo;
  let baseDatos: BaseDatosPrueba;
  let superadmin: SuperadminDePrueba;
  let cookie: string;

  const servidor = () => app.getHttpServer();
  const conSesion = (t: request.Test) => t.set('Cookie', cookie);
  const crear = (cuerpo: unknown) =>
    conSesion(request(servidor()).post('/api/plataforma/academias')).send(cuerpo as object);
  const listar = () => conSesion(request(servidor()).get('/api/plataforma/academias'));
  const peticionSuspender = (id: string) =>
    conSesion(request(servidor()).post(`/api/plataforma/academias/${id}/suspender`));
  const suspender = (id: string, cuerpo: unknown = { motivo: 'Falta de pago' }) =>
    peticionSuspender(id).send(cuerpo as object);
  const reactivar = (id: string, cuerpo: unknown = {}) =>
    conSesion(request(servidor()).post(`/api/plataforma/academias/${id}/reactivar`)).send(cuerpo as object);

  beforeAll(async () => {
    reloj = new RelojFijo(AHORA);
    app = await crearAppDePruebas({
      nivelRegistro: 'silent',
      ajustar: (constructor) => constructor.overrideProvider(RELOJ).useValue(reloj),
    });
    baseDatos = await obtenerBaseDatos(app);
  });
  beforeEach(async () => {
    await limpiarBase();
    reloj.fijar(AHORA);
    superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });
    cookie = cookieDeSesion(superadmin, AHORA);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('criterio 48: crear una academia', () => {
    it('criterio 48: responde 201 con { academia } ACTIVA, creadaEn = RELOJ.ahora() y sin suspensión', async () => {
      const respuesta = await crear({ nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines' });

      expect(respuesta.status).toBe(201);
      const cuerpo = respuesta.body as { academia: AcademiaCuerpo };
      expect(Object.keys(cuerpo)).toEqual(['academia']);
      expect(Object.keys(cuerpo.academia).sort()).toEqual([...CLAVES_DE_ACADEMIA].sort());
      expect(cuerpo.academia).toMatchObject({
        nombre: 'Academia de Natación Los Delfines',
        nombreCorto: 'delfines',
        estado: 'ACTIVA',
        creadaEn: AHORA.toISOString(),
        suspendidaEn: null,
        motivoSuspension: null,
      });
      expect(cuerpo.academia.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(cuerpo.academia.creadaEn).toMatch(ISO);
    });

    it('criterio 48: la fila existe en academias', async () => {
      const respuesta = await crear({ nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines' });

      const filas = await leerAcademias();
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        id: (respuesta.body as { academia: AcademiaCuerpo }).academia.id,
        nombre: 'Academia de Natación Los Delfines',
        nombre_corto: 'delfines',
        estado: 'ACTIVA',
        motivo_suspension: null,
        suspendida_en: null,
      });
      expect(filas[0]?.creada_en.toISOString()).toBe(AHORA.toISOString());
    });

    it('criterio 48: no crea ninguna fila en tablas con academia_id', async () => {
      const respuesta = await crear({ nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines' });
      const id = (respuesta.body as { academia: AcademiaCuerpo }).academia.id;

      expect(await contarDeAcademia('auditoria', id)).toBe(0);
      expect(await contarDeAcademia('configuraciones', id)).toBe(0);
    });

    it('criterio 48: la respuesta lleva Cache-Control: no-store', async () => {
      const respuesta = await crear({ nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines' });

      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 32: ACADEMIA_CREADA queda en auditoria_plataforma con actor SUPERADMIN, entidad_id, datos_despues e ip', async () => {
      const respuesta = await crear({ nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines' });
      const id = (respuesta.body as { academia: AcademiaCuerpo }).academia.id;

      const filas = await leerAuditoriaPlataforma('ACADEMIA_CREADA');
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        actor_tipo: 'SUPERADMIN',
        actor_id: superadmin.id,
        entidad_id: id,
        datos_despues: { id, nombre: 'Academia de Natación Los Delfines', nombreCorto: 'delfines', estado: 'ACTIVA' },
      });
      expect(filas[0]?.entidad).toMatch(/^academias?$/i);
      expect(filas[0]?.fecha_hora.toISOString()).toBe(AHORA.toISOString());
      expect(filas[0]?.ip, 'falta la ip de la petición').toMatch(/127\.0\.0\.1|::1/);
    });
  });

  describe('criterio 49: validación del nombre y del nombre corto', () => {
    it.each([
      ['un nombre corto de 2 caracteres', { nombre: 'Academia válida', nombreCorto: 'ab' }, 'nombreCorto'],
      ['un nombre corto de 31 caracteres', { nombre: 'Academia válida', nombreCorto: 'a'.repeat(31) }, 'nombreCorto'],
      ['un nombre corto con espacios dentro', { nombre: 'Academia válida', nombreCorto: 'mi academia' }, 'nombreCorto'],
      ['un nombre corto con ñ', { nombre: 'Academia válida', nombreCorto: 'peñalolen' }, 'nombreCorto'],
      ['un nombre corto con guiones dobles', { nombre: 'Academia válida', nombreCorto: 'mi--academia' }, 'nombreCorto'],
      [
        'un nombre corto que empieza con número',
        { nombre: 'Academia válida', nombreCorto: '1academia' },
        'nombreCorto',
      ],
      ['un nombre corto reservado', { nombre: 'Academia válida', nombreCorto: 'Admin' }, 'nombreCorto'],
      ['un nombre de 2 caracteres', { nombre: 'Ab', nombreCorto: 'academia-valida' }, 'nombre'],
      [
        'un nombre con caracteres de control',
        { nombre: 'Academia\u0007 mala', nombreCorto: 'academia-valida' },
        'nombre',
      ],
    ])(
      'criterio 49: %s responde 400 SOLICITUD_INVALIDA nombrando el campo, y no crea nada',
      async (_caso, cuerpo, campo) => {
        const respuesta = await crear(cuerpo);

        expect(respuesta.status).toBe(400);
        const error = respuesta.body as ErrorCuerpo;
        expect(error.codigo).toBe('SOLICITUD_INVALIDA');
        expect(error.detalles?.errores?.map((detalle) => detalle.campo)).toContain(campo);
        expect(await leerAcademias()).toEqual([]);
      },
    );

    it('criterio 49: el nombre corto se recorta y se pasa a minúsculas, y el nombre se recorta', async () => {
      const respuesta = await crear({ nombre: '  Club Tiburones  ', nombreCorto: '  TiBuRoNeS-2 ' });

      expect(respuesta.status).toBe(201);
      expect((respuesta.body as { academia: AcademiaCuerpo }).academia).toMatchObject({
        nombre: 'Club Tiburones',
        nombreCorto: 'tiburones-2',
      });
    });
  });

  describe('criterio 50: nombre corto repetido', () => {
    it.each(['delfines', 'Delfines', ' delfines ', 'DELFINES'])(
      'criterio 50: crear con el nombre corto %j existente responde 409 NOMBRE_CORTO_EN_USO sin crear ni auditar',
      async (nombreCorto) => {
        await crear({ nombre: 'Academia Delfines', nombreCorto: 'delfines' });
        const auditoriaAntes = await leerAuditoriaPlataforma('ACADEMIA_CREADA');

        const respuesta = await crear({ nombre: 'Otra academia', nombreCorto });

        expect(respuesta.status).toBe(409);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NOMBRE_CORTO_EN_USO');
        expect(await leerAcademias()).toHaveLength(1);
        expect(await leerAuditoriaPlataforma('ACADEMIA_CREADA')).toEqual(auditoriaAntes);
      },
    );

    it('criterio 50: dos creaciones simultáneas con el mismo nombre corto: una responde 201, la otra 409, y queda una fila y un registro', async () => {
      const respuestas = await Promise.all(
        Array.from({ length: 2 }, () => crear({ nombre: 'Academia doble clic', nombreCorto: 'doble-clic' })),
      );

      expect(respuestas.map((respuesta) => respuesta.status).sort()).toEqual([201, 409]);
      expect((respuestas.find((respuesta) => respuesta.status === 409)?.body as ErrorCuerpo).codigo).toBe(
        'NOMBRE_CORTO_EN_USO',
      );
      expect(await leerAcademias()).toHaveLength(1);
      expect(await leerAuditoriaPlataforma('ACADEMIA_CREADA')).toHaveLength(1);
    });

    it('criterio 50: muchas creaciones simultáneas con el mismo nombre corto dejan exactamente una', async () => {
      const respuestas = await Promise.all(
        Array.from({ length: 8 }, () => crear({ nombre: 'Academia en carrera', nombreCorto: 'en-carrera' })),
      );

      const estados = respuestas.map((respuesta) => respuesta.status);
      expect(estados.filter((estado) => estado === 201)).toHaveLength(1);
      expect(estados.filter((estado) => estado === 409)).toHaveLength(7);
      expect(await leerAcademias()).toHaveLength(1);
      expect(await leerAuditoriaPlataforma('ACADEMIA_CREADA')).toHaveLength(1);
    });

    it('criterio 50: la base tiene una restricción única sobre nombre_corto (el dueño tampoco puede repetirlo)', async () => {
      await crearAcademiaDePrueba({ nombreCorto: 'unica' });

      await expect(crearAcademiaDePrueba({ nombreCorto: 'unica' })).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('criterio 51: listar academias', () => {
    it('criterio 51: devuelve todas, activas y suspendidas, ordenadas por nombreCorto, con el esquema estricto', async () => {
      const zeta = await crearAcademiaDePrueba({ nombreCorto: 'zeta', nombre: 'Zeta' });
      const alfa = await crearAcademiaDePrueba({ nombreCorto: 'alfa', nombre: 'Alfa', estado: 'SUSPENDIDA' });
      const medio = await crearAcademiaDePrueba({ nombreCorto: 'medio', nombre: 'Medio' });
      await insertarAuditoria(zeta.id);
      await insertarConfiguracion(medio.id, 'clave_interna');

      const respuesta = await listar();

      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['cache-control']).toBe('no-store');
      const cuerpo = respuesta.body as { academias: AcademiaCuerpo[] };
      expect(Object.keys(cuerpo)).toEqual(['academias']);
      expect(cuerpo.academias.map((academia) => academia.nombreCorto)).toEqual(['alfa', 'medio', 'zeta']);
      expect(cuerpo.academias.map((academia) => academia.id)).toEqual([alfa.id, medio.id, zeta.id]);
      expect(cuerpo.academias.map((academia) => academia.estado)).toEqual(['SUSPENDIDA', 'ACTIVA', 'ACTIVA']);
      for (const academia of cuerpo.academias) {
        expect(Object.keys(academia).sort()).toEqual([...CLAVES_DE_ACADEMIA].sort());
        expect(academia.creadaEn).toMatch(ISO);
      }
      expect(cuerpo.academias[0]?.suspendidaEn).toMatch(ISO);
      expect(cuerpo.academias[0]?.motivoSuspension).toBe('Suspendida para la prueba');
      expect(cuerpo.academias[1]).toMatchObject({ suspendidaEn: null, motivoSuspension: null });
    });

    it('criterio 51: sin academias devuelve una lista vacía', async () => {
      const respuesta = await listar();

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({ academias: [] });
    });

    it('criterio 51: no devuelve datos internos de ninguna academia (auditoría, configuración)', async () => {
      const academia = await crearAcademiaDePrueba({ nombreCorto: 'con-datos' });
      await insertarAuditoria(academia.id, 'ACCION_SECRETA_DE_LA_ACADEMIA');
      await insertarConfiguracion(academia.id, 'clave_secreta', { valor: 'valor-secreto-de-la-academia' });

      const respuesta = await listar();

      expect(JSON.stringify(respuesta.body)).not.toMatch(/ACCION_SECRETA|clave_secreta|valor-secreto/);
    });
  });

  describe('criterio 52: suspender', () => {
    it('criterio 52: responde 200 con la academia SUSPENDIDA, suspendidaEn = RELOJ.ahora() y el motivo recortado', async () => {
      const academia = await crearAcademiaDePrueba();
      const instante = new Date('2026-11-12T09:30:00.000Z');
      reloj.fijar(instante);
      cookie = cookieDeSesion(superadmin, instante);

      const respuesta = await suspender(academia.id, { motivo: '  Falta de pago  ' });

      expect(respuesta.status).toBe(200);
      const cuerpo = respuesta.body as { academia: AcademiaCuerpo };
      expect(Object.keys(cuerpo.academia).sort()).toEqual([...CLAVES_DE_ACADEMIA].sort());
      expect(cuerpo.academia).toMatchObject({
        id: academia.id,
        estado: 'SUSPENDIDA',
        suspendidaEn: instante.toISOString(),
        motivoSuspension: 'Falta de pago',
      });
      const [fila] = await leerAcademias();
      expect(fila).toMatchObject({ estado: 'SUSPENDIDA', motivo_suspension: 'Falta de pago' });
      expect(fila?.suspendida_en?.toISOString()).toBe(instante.toISOString());
    });

    it('criterio 32: ACADEMIA_SUSPENDIDA registra estados antes y después, motivo, actor e ip', async () => {
      const academia = await crearAcademiaDePrueba();

      await suspender(academia.id, { motivo: 'Falta de pago' });

      const filas = await leerAuditoriaPlataforma('ACADEMIA_SUSPENDIDA');
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        actor_tipo: 'SUPERADMIN',
        actor_id: superadmin.id,
        entidad_id: academia.id,
        datos_antes: { estado: 'ACTIVA' },
        datos_despues: { estado: 'SUSPENDIDA' },
        motivo: 'Falta de pago',
      });
      expect(filas[0]?.entidad).toMatch(/^academias?$/i);
      expect(filas[0]?.ip, 'falta la ip de la petición').toMatch(/127\.0\.0\.1|::1/);
    });

    it.each([
      ['sin cuerpo', undefined],
      ['sin motivo', {}],
      ['un motivo de 2 caracteres', { motivo: 'ab' }],
      ['un motivo de solo espacios', { motivo: '      ' }],
      ['un motivo de 501 caracteres', { motivo: 'm'.repeat(501) }],
      ['un motivo que no es texto', { motivo: 123 }],
      ['campos de más', { motivo: 'Falta de pago', extra: true }],
    ])('criterio 52: %s responde 400 SOLICITUD_INVALIDA y no cambia nada', async (_caso, cuerpo) => {
      const academia = await crearAcademiaDePrueba();

      const peticion = peticionSuspender(academia.id);

      const respuesta = await (cuerpo === undefined ? peticion : peticion.send(cuerpo));

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      expect((await leerAcademias())[0]?.estado).toBe('ACTIVA');
      expect(await leerAuditoriaPlataforma('ACADEMIA_SUSPENDIDA')).toEqual([]);
    });

    it('criterio 52: un motivo de exactamente 3 y de exactamente 500 caracteres es válido', async () => {
      const una = await crearAcademiaDePrueba();
      const otra = await crearAcademiaDePrueba();

      expect((await suspender(una.id, { motivo: 'abc' })).status).toBe(200);
      expect((await suspender(otra.id, { motivo: 'm'.repeat(500) })).status).toBe(200);
    });
  });

  describe('criterio 53: reactivar', () => {
    it.each([
      ['con {}', {}, null],
      ['con un motivo', { motivo: '  Pago regularizado ' }, 'Pago regularizado'],
    ])('criterio 53: %s responde 200 con la academia ACTIVA, sin suspensión', async (_caso, cuerpo, motivo) => {
      const academia = await crearAcademiaDePrueba({ estado: 'SUSPENDIDA' });

      const respuesta = await reactivar(academia.id, cuerpo);

      expect(respuesta.status).toBe(200);
      const resultado = (respuesta.body as { academia: AcademiaCuerpo }).academia;
      expect(Object.keys(resultado).sort()).toEqual([...CLAVES_DE_ACADEMIA].sort());
      expect(resultado).toMatchObject({
        id: academia.id,
        estado: 'ACTIVA',
        suspendidaEn: null,
        motivoSuspension: null,
      });
      const [fila] = await leerAcademias();
      expect(fila).toMatchObject({ estado: 'ACTIVA', suspendida_en: null, motivo_suspension: null });
      const auditoria = await leerAuditoriaPlataforma('ACADEMIA_REACTIVADA');
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({
        actor_tipo: 'SUPERADMIN',
        actor_id: superadmin.id,
        entidad_id: academia.id,
        datos_antes: { estado: 'SUSPENDIDA' },
        datos_despues: { estado: 'ACTIVA' },
        motivo,
      });
      expect(auditoria[0]?.ip, 'falta la ip de la petición').toMatch(/127\.0\.0\.1|::1/);
    });

    it.each([
      ['un motivo de 2 caracteres', { motivo: 'ab' }],
      ['un motivo de 501 caracteres', { motivo: 'm'.repeat(501) }],
      ['campos de más', { extra: true }],
    ])('criterio 53: %s responde 400 SOLICITUD_INVALIDA', async (_caso, cuerpo) => {
      const academia = await crearAcademiaDePrueba({ estado: 'SUSPENDIDA' });

      const respuesta = await reactivar(academia.id, cuerpo);

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      expect((await leerAcademias())[0]?.estado).toBe('SUSPENDIDA');
    });

    it('criterio 53: suspender y reactivar de nuevo funciona (ciclo completo)', async () => {
      const academia = await crearAcademiaDePrueba();

      expect((await suspender(academia.id)).status).toBe(200);
      expect((await reactivar(academia.id)).status).toBe(200);
      expect((await suspender(academia.id, { motivo: 'Otra vez' })).status).toBe(200);
      expect((await leerAcademias())[0]?.estado).toBe('SUSPENDIDA');
      expect(await leerAuditoriaPlataforma('ACADEMIA_SUSPENDIDA')).toHaveLength(2);
    });
  });

  describe('criterio 54: estados repetidos y carreras', () => {
    it('criterio 54: suspender una academia ya suspendida responde 409 ACADEMIA_YA_SUSPENDIDA sin cambios ni auditoría', async () => {
      const academia = await crearAcademiaDePrueba({ estado: 'SUSPENDIDA' });
      const antes = await leerAcademias();

      const respuesta = await suspender(academia.id, { motivo: 'Otro motivo distinto' });

      expect(respuesta.status).toBe(409);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_YA_SUSPENDIDA');
      expect(await leerAcademias()).toEqual(antes);
      expect(await leerAuditoriaPlataforma('ACADEMIA_SUSPENDIDA')).toEqual([]);
    });

    it('criterio 54: reactivar una academia activa responde 409 ACADEMIA_YA_ACTIVA sin cambios ni auditoría', async () => {
      const academia = await crearAcademiaDePrueba();
      const antes = await leerAcademias();

      const respuesta = await reactivar(academia.id);

      expect(respuesta.status).toBe(409);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('ACADEMIA_YA_ACTIVA');
      expect(await leerAcademias()).toEqual(antes);
      expect(await leerAuditoriaPlataforma('ACADEMIA_REACTIVADA')).toEqual([]);
    });

    it('criterio 54: dos suspensiones simultáneas: una responde 200, la otra 409, y queda un solo registro', async () => {
      const academia = await crearAcademiaDePrueba();

      const respuestas = await Promise.all([suspender(academia.id), suspender(academia.id)]);

      expect(respuestas.map((respuesta) => respuesta.status).sort()).toEqual([200, 409]);
      expect((respuestas.find((respuesta) => respuesta.status === 409)?.body as ErrorCuerpo).codigo).toBe(
        'ACADEMIA_YA_SUSPENDIDA',
      );
      expect(await leerAuditoriaPlataforma('ACADEMIA_SUSPENDIDA')).toHaveLength(1);
    });

    it('criterio 54: dos reactivaciones simultáneas: una responde 200, la otra 409, y queda un solo registro', async () => {
      const academia = await crearAcademiaDePrueba({ estado: 'SUSPENDIDA' });

      const respuestas = await Promise.all([reactivar(academia.id), reactivar(academia.id)]);

      expect(respuestas.map((respuesta) => respuesta.status).sort()).toEqual([200, 409]);
      expect(await leerAuditoriaPlataforma('ACADEMIA_REACTIVADA')).toHaveLength(1);
    });
  });

  describe('criterio 55: ids inválidos o inexistentes', () => {
    it.each([
      ['no es un UUID', 'abc'],
      ['es un número', '123'],
      ['es un UUID con un carácter de más', `${uuidInexistente()}0`],
      ['no existe', uuidInexistente()],
    ])('criterio 55: suspender y reactivar con un id que %s responden 404 NO_ENCONTRADO', async (_caso, id) => {
      const academia = await crearAcademiaDePrueba();

      const alSuspender = await suspender(id);
      const alReactivar = await reactivar(id);

      for (const respuesta of [alSuspender, alReactivar]) {
        expect(respuesta.status).toBe(404);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
      }
      expect((await leerAcademias())[0]).toMatchObject({ id: academia.id, estado: 'ACTIVA' });
      expect(await leerAuditoriaPlataforma()).toEqual([]);
    });
  });

  describe('criterio 56: una academia suspendida conserva sus datos y se corta el acceso', () => {
    it('criterio 56: conAcademia la rechaza, GET /api/a/{nombreCorto} responde 403 y sus filas siguen en la base', async () => {
      const { ErrorAcademiaSuspendida } = await cargarPrisma();
      const academia = await crearAcademiaDePrueba({ nombreCorto: 'con-datos' });
      await insertarAuditoria(academia.id);
      await insertarAuditoria(academia.id);
      await insertarConfiguracion(academia.id, 'clave_a');

      expect((await suspender(academia.id)).status).toBe(200);

      await expect(baseDatos.conAcademia(academia.id, () => Promise.resolve('no'))).rejects.toBeInstanceOf(
        ErrorAcademiaSuspendida,
      );
      const publica = await request(servidor()).get('/api/a/con-datos');
      expect(publica.status).toBe(403);
      expect((publica.body as ErrorCuerpo).codigo).toBe('ACADEMIA_SUSPENDIDA');
      // Comprobado como dueño: nada se borró.
      expect(await contarDeAcademia('auditoria', academia.id)).toBe(2);
      expect(await contarDeAcademia('configuraciones', academia.id)).toBe(1);
    });

    it('criterio 56: al reactivarla, conAcademia y la ruta pública vuelven a funcionar con los mismos datos', async () => {
      const academia = await crearAcademiaDePrueba({ nombreCorto: 'con-datos' });
      await insertarAuditoria(academia.id);
      await insertarConfiguracion(academia.id, 'clave_a');
      await suspender(academia.id);

      expect((await reactivar(academia.id)).status).toBe(200);

      const visto = await baseDatos.conAcademia(academia.id, async (tx) => {
        const filas = await tx.cliente.$queryRawUnsafe<{ n: number }[]>('SELECT count(*)::int AS n FROM auditoria');
        return filas[0]?.n;
      });
      expect(visto).toBe(1);
      const publica = await request(servidor()).get('/api/a/con-datos');
      expect(publica.status).toBe(200);
    });
  });

  describe('criterio 57: no hay forma de borrar una academia', () => {
    it('criterio 57: DELETE /api/plataforma/academias/{id} responde 404 NO_ENCONTRADO y la academia sigue', async () => {
      const academia = await crearAcademiaDePrueba();

      const respuesta = await conSesion(request(servidor()).delete(`/api/plataforma/academias/${academia.id}`));

      expect(respuesta.status).toBe(404);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
      expect(await leerAcademias()).toHaveLength(1);
    });

    it('criterio 57: el rol de la app no tiene DELETE sobre academias', async () => {
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT pg_catalog.has_table_privilege('aquagestion_app', 'public.academias', 'DELETE') AS puede`,
      );

      expect(rows).toEqual([{ puede: false }]);
    });
  });

  describe('criterio 30: si la auditoría falla, la operación completa falla', () => {
    it('criterio 30: con un disparador que falla en auditoria_plataforma, POST /api/plataforma/academias responde 500 y la academia no existe', async () => {
      await ejecutarComo(
        'propietario',
        `CREATE OR REPLACE FUNCTION public.prueba_001_falla_auditoria() RETURNS trigger LANGUAGE plpgsql AS
           $$ BEGIN RAISE EXCEPTION 'falla de auditoría provocada por la prueba'; END $$`,
      );
      await ejecutarComo(
        'propietario',
        `CREATE TRIGGER prueba_001_falla BEFORE INSERT ON auditoria_plataforma
           FOR EACH ROW EXECUTE FUNCTION public.prueba_001_falla_auditoria()`,
      );
      try {
        const respuesta = await crear({ nombre: 'Academia que no debe existir', nombreCorto: 'no-existe-aun' });

        expect(respuesta.status).toBe(500);
        expect((respuesta.body as ErrorCuerpo).codigo).toBe('ERROR_INTERNO');
        expect(JSON.stringify(respuesta.body)).not.toContain('provocada por la prueba');
        expect(await leerAcademias()).toEqual([]);
      } finally {
        await ejecutarComo('propietario', 'DROP TRIGGER IF EXISTS prueba_001_falla ON auditoria_plataforma');
        await ejecutarComo('propietario', 'DROP FUNCTION IF EXISTS public.prueba_001_falla_auditoria()');
      }
    });

    it('criterio 30: lo mismo al suspender: la academia sigue ACTIVA', async () => {
      const academia = await crearAcademiaDePrueba();
      await ejecutarComo(
        'propietario',
        `CREATE OR REPLACE FUNCTION public.prueba_001_falla_auditoria() RETURNS trigger LANGUAGE plpgsql AS
           $$ BEGIN RAISE EXCEPTION 'falla de auditoría provocada por la prueba'; END $$`,
      );
      await ejecutarComo(
        'propietario',
        `CREATE TRIGGER prueba_001_falla BEFORE INSERT ON auditoria_plataforma
           FOR EACH ROW EXECUTE FUNCTION public.prueba_001_falla_auditoria()`,
      );
      try {
        const respuesta = await suspender(academia.id);

        expect(respuesta.status).toBe(500);
        expect((await leerAcademias())[0]?.estado).toBe('ACTIVA');
      } finally {
        await ejecutarComo('propietario', 'DROP TRIGGER IF EXISTS prueba_001_falla ON auditoria_plataforma');
        await ejecutarComo('propietario', 'DROP FUNCTION IF EXISTS public.prueba_001_falla_auditoria()');
      }
    });
  });

  describe('Cache-Control: no-store en todas las respuestas de /api/plataforma/*', () => {
    it('criterio 48 a 57: lo llevan las respuestas de éxito, de error de negocio y de falta de sesión', async () => {
      const academia = await crearAcademiaDePrueba();

      const respuestas = [
        await listar(),
        await crear({ nombre: 'Academia nueva', nombreCorto: 'academia-nueva' }),
        await crear({ nombre: 'Academia nueva', nombreCorto: 'academia-nueva' }),
        await crear({ nombre: 'x', nombreCorto: 'x' }),
        await suspender(academia.id),
        await suspender(academia.id),
        await suspender(uuidInexistente()),
        await reactivar(academia.id),
        await request(servidor()).get('/api/plataforma/academias'),
        await request(servidor()).get('/api/plataforma/sesion'),
      ];

      expect(respuestas.map((respuesta) => respuesta.status)).toEqual([
        200, 201, 409, 400, 200, 409, 404, 200, 401, 401,
      ]);
      for (const respuesta of respuestas) expect(respuesta.headers['cache-control']).toBe('no-store');
    });
  });
});
