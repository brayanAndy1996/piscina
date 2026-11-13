// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { ejecutarComo, limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { cargarPrisma, crearDestinoDeRegistro, esperarHasta, obtenerBaseDatos } from '../../utilidades/modulos';

// Criterio 4: la API falla cerrada si DATABASE_URL_APP apunta a un rol inseguro. En estas pruebas, el rol inseguro es
// el dueño de las tablas (la URL de DATABASE_URL_PRUEBAS). nestjs-pino crea un único registrador por proceso: la
// primera aplicación de este archivo es la que tiene el destino de registros que se inspecciona.
describe('criterio 4: falla cerrada con un rol inseguro (el dueño de las tablas)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let app: NestExpressApplication;
  let academia: AcademiaDePrueba;

  beforeAll(async () => {
    app = await crearAppDePruebas({
      variables: { DATABASE_URL_APP: urlPropietarioPruebas() },
      nivelRegistro: 'info',
      destinoRegistro: destino,
    });
  });
  beforeEach(async () => {
    await limpiarBase();
    academia = await crearAcademiaDePrueba({ nombreCorto: 'delfines' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('criterio 4: el primer uso registra con nivel error un mensaje que nombra DATABASE_URL_APP', async () => {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    const baseDatos = await obtenerBaseDatos(app);

    await expect(baseDatos.conAcademia(academia.id, () => Promise.resolve('no'))).rejects.toBeInstanceOf(
      ErrorRolBaseDatosInseguro,
    );

    await esperarHasta(() => lineas.some((linea) => linea.includes('DATABASE_URL_APP')));
    const registros = lineas.map((linea) => JSON.parse(linea) as { level: number; msg?: string });
    const errores = registros.filter((registro) => registro.level >= 50 && registro.msg?.includes('DATABASE_URL_APP'));
    expect(errores.length, 'falta un registro de nivel error que nombre DATABASE_URL_APP').toBeGreaterThan(0);
  });

  it('criterio 4: conAcademia rechaza con ErrorRolBaseDatosInseguro sin ejecutar el trabajo', async () => {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    const baseDatos = await obtenerBaseDatos(app);
    const trabajo = vi.fn(() => Promise.resolve('no'));

    await expect(baseDatos.conAcademia(academia.id, trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
    expect(trabajo).not.toHaveBeenCalled();
  });

  it('criterio 4: comoPlataforma rechaza con ErrorRolBaseDatosInseguro sin ejecutar el trabajo', async () => {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    const baseDatos = await obtenerBaseDatos(app);
    const trabajo = vi.fn(() => Promise.resolve('no'));

    await expect(baseDatos.comoPlataforma(trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
    expect(trabajo).not.toHaveBeenCalled();
  });

  it('criterio 4: resolverAcademia rechaza con ErrorRolBaseDatosInseguro', async () => {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    const baseDatos = await obtenerBaseDatos(app);

    await expect(baseDatos.resolverAcademia(academia.nombreCorto)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
  });

  it('criterio 4: POST /api/plataforma/sesion responde 500 ERROR_INTERNO', async () => {
    const respuesta = await request(app.getHttpServer())
      .post('/api/plataforma/sesion')
      .send({ correo: 'alguien@aquagestion.test', clave: 'ClaveCualquiera-1' });

    expect(respuesta.status).toBe(500);
    expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');
  });

  it('criterio 4: GET /api/a/{nombreCorto} responde 500 ERROR_INTERNO', async () => {
    const respuesta = await request(app.getHttpServer()).get(`/api/a/${academia.nombreCorto}`);

    expect(respuesta.status).toBe(500);
    expect((respuesta.body as { codigo: string }).codigo).toBe('ERROR_INTERNO');
  });

  it('criterio 4: GET /api/salud conserva su contrato (200 con la base encendida)', async () => {
    const respuesta = await request(app.getHttpServer()).get('/api/salud');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ estado: 'ok', baseDatos: 'ok' });
  });

  it('criterio 4: ningún registro del log contiene la URL ni la contraseña de la base', () => {
    expect(lineas.length).toBeGreaterThan(0);
    const url = new URL(urlPropietarioPruebas());
    const clave = decodeURIComponent(url.password);
    for (const linea of lineas) {
      expect(linea).not.toContain(urlPropietarioPruebas());
      expect(linea).not.toMatch(/postgres(ql)?:\/\/[^\s"\\]*:[^\s"\\@]*@/);
      if (clave.length >= 8 && !url.pathname.includes(clave) && clave !== decodeURIComponent(url.username)) {
        expect(linea).not.toContain(clave);
      }
    }
  });
});

// Otros roles inseguros: solo donde el usuario de la base puede crear roles (Docker y la integración continua).
describe('criterio 4: otros roles inseguros (se omiten si el usuario de la base no puede crear roles)', () => {
  const ROLES = ['aq_prueba_super', 'aq_prueba_bypass', 'aq_prueba_miembro', 'aq_prueba_otro'] as const;
  const CLAVE = 'clave-de-prueba-temporal';
  let capacidad = { superusuario: false, crearRoles: false };

  function urlDeRol(rol: string): string {
    const url = new URL(urlPropietarioPruebas());
    url.username = rol;
    url.password = CLAVE;
    return url.toString();
  }

  async function sentencias(...lista: string[]): Promise<void> {
    for (const sentencia of lista) await ejecutarComo('propietario', sentencia);
  }

  async function borrarRoles(): Promise<void> {
    for (const rol of ROLES) await ejecutarComo('propietario', `DROP ROLE IF EXISTS ${rol}`);
  }

  beforeAll(async () => {
    const { rows } = await ejecutarComo(
      'propietario',
      'SELECT rolsuper, rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user',
    );
    const fila = rows[0] as { rolsuper: boolean; rolcreaterole: boolean };
    capacidad = { superusuario: fila.rolsuper, crearRoles: fila.rolsuper || fila.rolcreaterole };
    if (!capacidad.crearRoles) return;
    await borrarRoles();
    await sentencias(
      `CREATE ROLE aq_prueba_otro NOLOGIN`,
      `CREATE ROLE aq_prueba_miembro LOGIN PASSWORD '${CLAVE}'`,
      `GRANT aq_prueba_otro TO aq_prueba_miembro`,
    );
    if (capacidad.superusuario) {
      await sentencias(
        `CREATE ROLE aq_prueba_super LOGIN SUPERUSER PASSWORD '${CLAVE}'`,
        `CREATE ROLE aq_prueba_bypass LOGIN BYPASSRLS PASSWORD '${CLAVE}'`,
      );
    }
  });
  afterAll(async () => {
    if (capacidad.crearRoles) await borrarRoles();
  });

  async function comprobarRechazo(rol: string): Promise<void> {
    const { ErrorRolBaseDatosInseguro } = await cargarPrisma();
    await limpiarBase();
    const academia = await crearAcademiaDePrueba();
    const app = await crearAppDePruebas({ variables: { DATABASE_URL_APP: urlDeRol(rol) } });
    try {
      const baseDatos = await obtenerBaseDatos(app);
      const trabajo = vi.fn(() => Promise.resolve('no'));
      await expect(baseDatos.conAcademia(academia.id, trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      await expect(baseDatos.comoPlataforma(trabajo)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      await expect(baseDatos.resolverAcademia(academia.nombreCorto)).rejects.toBeInstanceOf(ErrorRolBaseDatosInseguro);
      expect(trabajo).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }

  it('criterio 4: un rol miembro de otro rol es rechazado', async (contexto) => {
    if (!capacidad.crearRoles) contexto.skip();
    await comprobarRechazo('aq_prueba_miembro');
  });

  it('criterio 4: un superusuario es rechazado', async (contexto) => {
    if (!capacidad.superusuario) contexto.skip();
    await comprobarRechazo('aq_prueba_super');
  });

  it('criterio 4: un rol con BYPASSRLS es rechazado', async (contexto) => {
    if (!capacidad.superusuario) contexto.skip();
    await comprobarRechazo('aq_prueba_bypass');
  });
});
