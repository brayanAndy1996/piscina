// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { leerSuperadmin } from '../../utilidades/datos';
import { cookieDePlataforma, crearSuperadminDePrueba, type SuperadminDePrueba } from '../../utilidades/superadmins';

// Criterio 75 (ataque ronda 1, F3): toda peticion POST /api/plataforma/sesion desde la misma IP en 60 segundos cuenta
// para el limite del criterio 41 (10 por IP), sea cual sea su resultado: JSON mal formado (400), cuerpo demasiado
// grande (413 CARGA_EXCESIVA), tipo no JSON (400), esquema invalido (400), 401 o 423. Tambien cuentan, y comparten el
// contador, las variantes de la ruta que Express atiende con el mismo controlador. La 11.a y las siguientes reciben 429
// DEMASIADAS_SOLICITUDES sin leer el cuerpo, aunque sean validas, sin contar como intento fallido ni emitir cookie.
// Cada prueba crea su aplicacion: el limitador arranca con el contador en cero.

const RUTA = '/api/plataforma/sesion';
const VARIANTES_DE_RUTA = ['/api/plataforma/sesion/', '/api/Plataforma/SESION', '/api/plataforma/sesion?x=1'];
const CLAVE_EQUIVOCADA = 'clave-equivocada-123';
// Mayor que cualquier limite razonable del lector JSON, para que siempre sea un 413.
const CUERPO_ENORME = JSON.stringify({ correo: 'nadie@aquagestion.test', clave: 'x'.repeat(2_000_000) });

interface ErrorCuerpo {
  codigo?: string;
}

describe('criterio 75: toda peticion de inicio de sesion cuenta para el limite por IP', () => {
  const apps: NestExpressApplication[] = [];
  let superadmin: SuperadminDePrueba;

  async function crearApp(): Promise<NestExpressApplication> {
    const app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    apps.push(app);
    return app;
  }

  beforeEach(async () => {
    await limpiarBase();
    superadmin = await crearSuperadminDePrueba({ correo: 'dueno@aquagestion.test' });
  });
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  /** Las formas de petición que no son un inicio de sesion normal. */
  function formas(app: NestExpressApplication) {
    const servidor = app.getHttpServer();
    return {
      jsonRoto: (ruta = RUTA) =>
        request(servidor).post(ruta).set('Content-Type', 'application/json').send('{"correo": '),
      grande: (ruta = RUTA) => request(servidor).post(ruta).set('Content-Type', 'application/json').send(CUERPO_ENORME),
      formulario: (ruta = RUTA) =>
        request(servidor)
          .post(ruta)
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(`correo=${encodeURIComponent(superadmin.correo)}&clave=${encodeURIComponent(superadmin.clave)}`),
      textoPlano: (ruta = RUTA) => request(servidor).post(ruta).set('Content-Type', 'text/plain').send('hola'),
      esquemaInvalido: (ruta = RUTA) => request(servidor).post(ruta).send({ correo: 'no-es-un-correo' }),
      claveEquivocada: (ruta = RUTA) =>
        request(servidor).post(ruta).send({ correo: superadmin.correo, clave: CLAVE_EQUIVOCADA }),
      correoInexistente: (ruta = RUTA) =>
        request(servidor).post(ruta).send({ correo: 'nadie@aquagestion.test', clave: CLAVE_EQUIVOCADA }),
      valida: (ruta = RUTA) =>
        request(servidor).post(ruta).send({ correo: superadmin.correo, clave: superadmin.clave }),
    };
  }

  async function esperar429SinEfectos(respuesta: request.Response): Promise<void> {
    expect(respuesta.status).toBe(429);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('DEMASIADAS_SOLICITUDES');
    expect(cookieDePlataforma(respuesta.headers)).toBeUndefined();
    const fila = await leerSuperadmin(superadmin.id);
    expect(fila).toMatchObject({ intentos_fallidos: 0, bloqueado_hasta: null, ultimo_acceso: null });
  }

  it('criterio 75: 12 peticiones con JSON mal formado (10 con 400, la 11.a y la 12.a con 429) y despues una valida: 429', async () => {
    const app = await crearApp();
    const f = formas(app);

    const estados: number[] = [];
    for (let i = 1; i <= 12; i++) estados.push((await f.jsonRoto()).status);
    const valida = await f.valida();

    expect(estados).toEqual([400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 429, 429]);
    await esperar429SinEfectos(valida);
  });

  it('criterio 75: las 10 primeras con JSON mal formado responden 400 SOLICITUD_INVALIDA y las siguientes 429 DEMASIADAS_SOLICITUDES', async () => {
    const app = await crearApp();
    const f = formas(app);

    const primeras = [];
    for (let i = 1; i <= 10; i++) primeras.push(await f.jsonRoto());
    const once = await f.jsonRoto();

    for (const respuesta of primeras) expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
    expect((once.body as ErrorCuerpo).codigo).toBe('DEMASIADAS_SOLICITUDES');
  });

  it('criterio 75: 10 cuerpos demasiado grandes (413 CARGA_EXCESIVA) agotan el limite y la valida recibe 429', async () => {
    const app = await crearApp();
    const f = formas(app);

    const primeras = [];
    for (let i = 1; i <= 10; i++) primeras.push(await f.grande());
    const valida = await f.valida();

    expect(primeras.map((respuesta) => respuesta.status)).toEqual(Array<number>(10).fill(413));
    expect((primeras[0]?.body as ErrorCuerpo).codigo).toBe('CARGA_EXCESIVA');
    await esperar429SinEfectos(valida);
  });

  it('criterio 75: pasado el limite, un cuerpo enorme responde 429 y no 413 (no se lee el cuerpo)', async () => {
    const app = await crearApp();
    const f = formas(app);
    for (let i = 1; i <= 10; i++) await f.jsonRoto();

    const enorme = await f.grande();
    const roto = await f.jsonRoto();
    const formulario = await f.formulario();

    for (const respuesta of [enorme, roto, formulario]) {
      expect(respuesta.status).toBe(429);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('DEMASIADAS_SOLICITUDES');
    }
  });

  it('criterio 75: 10 formularios con la clave correcta (400, criterio 74) agotan el limite y la valida recibe 429', async () => {
    const app = await crearApp();
    const f = formas(app);

    const primeras = [];
    for (let i = 1; i <= 10; i++) primeras.push(await f.formulario());
    const valida = await f.valida();

    expect(primeras.map((respuesta) => respuesta.status)).toEqual(Array<number>(10).fill(400));
    await esperar429SinEfectos(valida);
  });

  it('criterio 75: 10 peticiones con esquema invalido (400) agotan el limite y la valida recibe 429', async () => {
    const app = await crearApp();
    const f = formas(app);

    for (let i = 1; i <= 10; i++) expect((await f.esquemaInvalido()).status).toBe(400);

    await esperar429SinEfectos(await f.valida());
  });

  it('criterio 75: 4 con 401, el 5.o con 423 (bloqueo) y 5 mas con la clave correcta (423) agotan el limite; la 11.a recibe 429', async () => {
    const app = await crearApp();
    const f = formas(app);

    const estados: number[] = [];
    for (let i = 1; i <= 5; i++) estados.push((await f.claveEquivocada()).status);
    for (let i = 1; i <= 5; i++) estados.push((await f.valida()).status);
    const once = await f.valida();

    expect(estados).toEqual([401, 401, 401, 401, 423, 423, 423, 423, 423, 423]);
    expect(once.status).toBe(429);
    expect((once.body as ErrorCuerpo).codigo).toBe('DEMASIADAS_SOLICITUDES');
    expect(cookieDePlataforma(once.headers)).toBeUndefined();
  });

  it('criterio 75: mezclando 400, 413, formulario, texto plano, 401 y variantes de la ruta, la 11.a (valida) recibe 429', async () => {
    const app = await crearApp();
    const f = formas(app);

    await f.jsonRoto();
    await f.grande();
    await f.formulario();
    await f.textoPlano();
    await f.correoInexistente('/api/plataforma/sesion/');
    await f.esquemaInvalido('/api/Plataforma/SESION');
    await f.jsonRoto('/api/plataforma/sesion/');
    await f.grande('/api/Plataforma/SESION');
    await f.formulario('/api/plataforma/sesion?x=1');
    await f.correoInexistente();
    const valida = await f.valida();

    await esperar429SinEfectos(valida);
  });

  describe('variantes de la ruta que Express atiende con el mismo controlador', () => {
    it.each(VARIANTES_DE_RUTA)(
      'criterio 75 (premisa): %s atiende el inicio de sesion (200 con la clave correcta)',
      async (ruta) => {
        const app = await crearApp();

        const respuesta = await formas(app).valida(ruta);

        expect(respuesta.status).toBe(200);
        expect(cookieDePlataforma(respuesta.headers)).toBeDefined();
      },
    );

    it.each(VARIANTES_DE_RUTA)(
      'criterio 75: 10 peticiones a %s con JSON mal formado agotan el limite de la ruta normal',
      async (ruta) => {
        const app = await crearApp();
        const f = formas(app);

        for (let i = 1; i <= 10; i++) expect((await f.jsonRoto(ruta)).status).toBe(400);

        await esperar429SinEfectos(await f.valida());
      },
    );

    it.each(VARIANTES_DE_RUTA)(
      'criterio 75: 5 peticiones a la ruta normal y 5 a %s comparten el contador',
      async (ruta) => {
        const app = await crearApp();
        const f = formas(app);

        for (let i = 1; i <= 5; i++) await f.jsonRoto();
        for (let i = 1; i <= 5; i++) await f.jsonRoto(ruta);
        const valida = await f.valida(ruta);

        await esperar429SinEfectos(valida);
      },
    );

    it.each(VARIANTES_DE_RUTA)(
      'criterio 75: pasado el limite, %s tambien responde 429 aunque la clave sea correcta',
      async (ruta) => {
        const app = await crearApp();
        const f = formas(app);
        for (let i = 1; i <= 10; i++) await f.jsonRoto();

        await esperar429SinEfectos(await f.valida(ruta));
      },
    );
  });
});
