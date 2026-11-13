// spec: 001-academias-aislamiento (pruebas protegidas)
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTORNO } from '../../../src/infraestructura/entorno';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo, limpiarBase, urlPropietarioPruebas } from '../../utilidades/base-datos';
import { ejecutarComando, existeElScript } from '../../utilidades/comandos';
import {
  cargarPrisma,
  crearDestinoDeRegistro,
  esperarHasta,
  type BaseDatosPrueba,
  type OpcionesTransaccionPrueba,
  type TransaccionPlataformaPrueba,
} from '../../utilidades/modulos';
import { hashDeLaClaveDelAtacante } from '../../utilidades/ronda5';
import {
  CLAVE_SUPERADMIN_PRUEBAS,
  OTRA_CLAVE_SUPERADMIN_PRUEBAS,
  cookieDePlataforma,
  crearSuperadminDePrueba,
  type SuperadminDePrueba,
} from '../../utilidades/superadmins';

// Criterio 120 (ataque ronda 5, F1; complementa los criterios 34, 36, 39 y 40): la sesion solo se emite para la clave que sigue
// vigente. La clave se verifica fuera de la transaccion que acepta el ingreso (el hash tarda decenas de milisegundos), asi que la
// transaccion que acepta (la que pone intentos_fallidos en 0 y escribe ultimo_acceso) relee la fila bajo su bloqueo (SELECT ... FOR
// UPDATE) y comprueba que `clave_hash` y `version_token` son exactamente los que se leyeron para verificar la clave; si cualquiera
// cambio (porque `npm run plataforma:superadmin` restablecio la clave, o un DELETE /api/plataforma/sesion cerro las sesiones,
// mientras se calculaba el hash), responde 401 CREDENCIALES_INVALIDAS con el mismo cuerpo del criterio 38, sin Set-Cookie, sin
// token y sin escribir nada en la fila (ni intentos_fallidos, ni bloqueado_hasta, ni ultimo_acceso, ni actualizado_en): no cuenta
// como intento fallido. El log tecnico lo registra con nivel `warn`, sin la clave. Una implementacion que verifica la clave dentro
// de la misma transaccion que bloqueo la fila desde la lectura tambien cumple. Garantia observable: ninguna cookie emitida a partir
// de la clave anterior a un restablecimiento sirve despues de el (GET /api/plataforma/sesion responde 401).
//
// Prueba de integracion determinista: un superadmin con clave K1 y la API de pruebas con `BaseDatos` reemplazado (`ajustar`) por un
// doble que delega en un `BaseDatos` real y que, durante una peticion de inicio de sesion, justo antes de la SEGUNDA llamada a
// `comoPlataforma` (despues de la que leyo la fila y de calcular el hash), ejecuta el comando real `npm run plataforma:superadmin`
// (`ejecutarComando`) con el mismo correo y la clave K2. Entonces, con K1: 401 CREDENCIALES_INVALIDAS sin Set-Cookie; la fila tiene
// intentos_fallidos 0, ultimo_acceso igual al de antes y la version_token que dejo el comando; despues K2 entra (200) y K1 responde
// 401. Si la implementacion no hace una segunda llamada, el doble ejecuta el comando despues de la respuesta, y la prueba exige que,
// si fue 200, esa cookie responda 401 en GET /api/plataforma/sesion tras el comando. Variante: en lugar del comando, el doble sube
// `version_token` como dueno (UPDATE superadmins SET version_token = version_token + 1); con K1, que sigue siendo la clave, responde
// 401 y no escribe nada. Sin intercalar nada, K1 entra (200). Ademas, sin pausas: 8 inicios de sesion con K1 a la vez (menos que el
// limite por IP del criterio 41), en paralelo con el comando que cambia a K2; cuando todo termina, toda cookie obtenida responde 401
// en GET /api/plataforma/sesion.
//
// nestjs-pino crea un unico registrador por proceso: el registro se inspecciona en la primera aplicacion que crea este archivo (la
// del primer caso); las demas se crean en silencio.

const K1 = CLAVE_SUPERADMIN_PRUEBAS;
const K2 = OTRA_CLAVE_SUPERADMIN_PRUEBAS;
const NOMBRE_RESTABLECIDO = 'Superadmin restablecido';

interface FilaSesion {
  clave_hash: string;
  version_token: number;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
  ultimo_acceso: Date | null;
  actualizado_en: Date;
  nombre: string;
}

async function leerFila(id: string): Promise<FilaSesion> {
  const { rows } = await ejecutarComo(
    'propietario',
    `SELECT clave_hash, version_token, intentos_fallidos, bloqueado_hasta, ultimo_acceso, actualizado_en, nombre
       FROM superadmins WHERE id = $1::uuid`,
    [id],
    { plataforma: true },
  );
  return rows[0] as FilaSesion;
}

/**
 * Doble de `BaseDatos`: delega todo en un `BaseDatos` real y, si hay una `accion` armada, la ejecuta justo antes de la SEGUNDA
 * llamada a `comoPlataforma` de la peticion (la primera lee la fila del superadmin; la segunda acepta el ingreso).
 */
class BaseDatosIntercalada {
  llamadasAComoPlataforma = 0;
  /** ¿Se ejecuto la accion intercalada (hubo una segunda llamada a `comoPlataforma`)? */
  seEjecuto = false;
  accion: (() => Promise<void>) | undefined;
  constructor(private readonly real: BaseDatosPrueba & { onModuleDestroy?: () => Promise<void> }) {}

  armar(accion: () => Promise<void>): void {
    this.llamadasAComoPlataforma = 0;
    this.seEjecuto = false;
    this.accion = accion;
  }

  conAcademia<T>(...argumentos: Parameters<BaseDatosPrueba['conAcademia']>): Promise<T> {
    return this.real.conAcademia(...argumentos) as Promise<T>;
  }
  async comoPlataforma<T>(
    trabajo: (tx: TransaccionPlataformaPrueba) => Promise<T>,
    opciones?: OpcionesTransaccionPrueba,
  ): Promise<T> {
    this.llamadasAComoPlataforma++;
    if (this.llamadasAComoPlataforma === 2 && this.accion) {
      const accion = this.accion;
      this.accion = undefined;
      this.seEjecuto = true;
      await accion();
    }
    return this.real.comoPlataforma(trabajo, opciones);
  }
  resolverAcademia(nombreCorto: string): ReturnType<BaseDatosPrueba['resolverAcademia']> {
    return this.real.resolverAcademia(nombreCorto);
  }
  comprobarConexion(): Promise<void> {
    return this.real.comprobarConexion();
  }
  async onModuleDestroy(): Promise<void> {
    await this.real.onModuleDestroy?.();
  }
}

/** Ejecuta `npm run plataforma:superadmin` sin bloquear el proceso (para correr en paralelo con las peticiones). */
function ejecutarComandoEnParalelo(
  variables: Record<string, string>,
): Promise<{ estado: number | null; salida: string }> {
  if (!existeElScript('plataforma:superadmin')) {
    return Promise.reject(new Error('Falta la funcionalidad de la 001: no existe el script plataforma:superadmin.'));
  }
  const raiz = path.resolve(__dirname, '..', '..', '..', '..');
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL: urlPropietarioPruebas(),
    NODE_ENV: 'test',
    ...variables,
  };
  return new Promise((resolver, rechazar) => {
    const hijo = spawn('npm', ['run', '--silent', 'plataforma:superadmin'], {
      cwd: raiz,
      env,
      shell: process.platform === 'win32',
    });
    let salida = '';
    hijo.stdout.on('data', (trozo: Buffer) => (salida += trozo.toString('utf8')));
    hijo.stderr.on('data', (trozo: Buffer) => (salida += trozo.toString('utf8')));
    hijo.on('error', rechazar);
    hijo.on('close', (estado) => resolver({ estado, salida }));
  });
}

describe('criterio 120: la sesion solo se emite para la clave que sigue vigente', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let registroPendiente = true;
  let app: NestExpressApplication;
  let doble: BaseDatosIntercalada;
  let sa: SuperadminDePrueba;
  let capturaRegistro = false;

  beforeEach(async () => {
    await limpiarBase();
    sa = await crearSuperadminDePrueba();
    const { BaseDatos } = await cargarPrisma();
    capturaRegistro = registroPendiente;
    registroPendiente = false;
    lineas.length = 0;
    app = await crearAppDePruebas({
      ...(capturaRegistro ? { nivelRegistro: 'info', destinoRegistro: destino } : { nivelRegistro: 'silent' }),
      ajustar: (constructor) =>
        constructor.overrideProvider(BaseDatos).useFactory({
          factory: (entorno: unknown, registro: unknown) => {
            // El `BaseDatos` real recibe el mismo entorno y registrador que recibiria sin el reemplazo.
            const Real = BaseDatos as unknown as new (entorno: unknown, registro: unknown) => BaseDatosPrueba;
            doble = new BaseDatosIntercalada(new Real(entorno, registro));
            return doble;
          },
          inject: [ENTORNO, PinoLogger],
        }),
    });
  });
  afterEach(async () => {
    await app?.close();
  });

  const servidor = () => app.getHttpServer();
  const entrar = (clave: string, correo = sa.correo) =>
    request(servidor()).post('/api/plataforma/sesion').send({ correo, clave });
  const consultarSesion = (cookie: string) => request(servidor()).get('/api/plataforma/sesion').set('Cookie', cookie);
  const cookieDe = (respuesta: { headers: Record<string, unknown> }): string =>
    (cookieDePlataforma(respuesta.headers) ?? '').split(';')[0] ?? '';

  /** El cuerpo del 401 de siempre (criterio 38): el de un correo que no existe, que no escribe nada. */
  async function cuerpoDe401(): Promise<unknown> {
    const respuesta = await entrar(K1, 'no-existe-ronda5@aquagestion.test');
    expect(respuesta.status).toBe(401);
    return respuesta.body;
  }

  /** Comprueba la respuesta, la fila y la cookie tras un cambio intercalado (el comando o la variante), con K1. */
  async function comprobarTrasElCambio(
    respuesta: request.Response,
    cuerpo401: unknown,
    antes: FilaSesion,
    tras: FilaSesion | undefined,
    cambio: () => Promise<void>,
  ): Promise<void> {
    if (doble.seEjecuto) {
      expect(tras, 'el cambio no se ejecuto antes de aceptar el ingreso').toBeDefined();
      expect(respuesta.status, 'con la clave que ya no esta vigente no debe haber sesion').toBe(401);
      expect((respuesta.body as { codigo: string }).codigo).toBe('CREDENCIALES_INVALIDAS');
      expect(respuesta.body).toEqual(cuerpo401);
      expect(respuesta.headers['set-cookie'], 'no debe haber Set-Cookie').toBeUndefined();
      const despues = await leerFila(sa.id);
      expect(despues.intentos_fallidos, 'no cuenta como intento fallido').toBe(0);
      expect(despues.bloqueado_hasta).toBeNull();
      expect(despues.ultimo_acceso, 'no debe escribir ultimo_acceso').toEqual(antes.ultimo_acceso);
      expect(despues.ultimo_acceso).toEqual(tras?.ultimo_acceso);
      expect(despues.actualizado_en, 'no debe escribir actualizado_en').toEqual(tras?.actualizado_en);
      expect(Number(despues.version_token)).toBe(Number(tras?.version_token));
      expect(despues.clave_hash).toBe(tras?.clave_hash);
      return;
    }
    // La implementacion verifica la clave dentro de la transaccion que bloquea la fila: el cambio se ejecuta despues de la respuesta.
    await cambio();
    if (respuesta.status === 200) {
      expect(
        (await consultarSesion(cookieDe(respuesta))).status,
        'la cookie emitida con la clave anterior sigue sirviendo',
      ).toBe(401);
    } else {
      expect(respuesta.status).toBe(401);
    }
  }

  describe('criterio 120: el comando plataforma:superadmin restablece la clave mientras se calcula el hash', () => {
    it('criterio 120: el log tecnico registra el rechazo con nivel warn y nunca la clave (se inspecciona en la primera aplicacion del archivo)', async (contexto) => {
      if (!capturaRegistro) contexto.skip('el registro solo se inspecciona en la primera aplicacion del archivo');
      doble.armar(() => {
        ejecutarComando('plataforma:superadmin', {
          SUPERADMIN_CORREO: sa.correo,
          SUPERADMIN_NOMBRE: NOMBRE_RESTABLECIDO,
          SUPERADMIN_CLAVE: K2,
        });
        return Promise.resolve();
      });

      await entrar(K1);

      if (doble.seEjecuto) {
        await esperarHasta(() => lineas.some((linea) => (JSON.parse(linea) as { level: number }).level === 40));
        const registros = lineas.map((linea) => JSON.parse(linea) as { level: number });
        expect(
          registros.some((registro) => registro.level === 40),
          'falta un registro de nivel warn',
        ).toBe(true);
      }
      for (const linea of lineas) {
        expect(linea).not.toContain(K1);
        expect(linea).not.toContain(K2);
      }
    });

    it('criterio 120: con K1 responde 401 CREDENCIALES_INVALIDAS sin Set-Cookie y sin escribir en la fila; despues K2 entra y K1 responde 401', async () => {
      const cuerpo401 = await cuerpoDe401();
      const antes = await leerFila(sa.id);
      let tras: FilaSesion | undefined;
      let comando: { estado: number | null; salida: string } | undefined;
      const restablecer = async (): Promise<void> => {
        comando = ejecutarComando('plataforma:superadmin', {
          SUPERADMIN_CORREO: sa.correo,
          SUPERADMIN_NOMBRE: NOMBRE_RESTABLECIDO,
          SUPERADMIN_CLAVE: K2,
        });
        tras = await leerFila(sa.id);
      };
      doble.armar(restablecer);

      const respuesta = await entrar(K1);
      if (!tras) await restablecer();
      expect(comando?.estado, comando?.salida).toBe(0);
      expect(Number(tras?.version_token), 'el comando debia subir version_token').toBe(Number(antes.version_token) + 1);
      expect(tras?.nombre).toBe(NOMBRE_RESTABLECIDO);
      await comprobarTrasElCambio(respuesta, cuerpo401, antes, tras, () => Promise.resolve());

      const conK2 = await entrar(K2);
      expect(conK2.status, 'K2, la clave nueva, debe entrar').toBe(200);
      expect((await consultarSesion(cookieDe(conK2))).status).toBe(200);
      const otraVezK1 = await entrar(K1);
      expect(otraVezK1.status, 'K1 ya no es la clave').toBe(401);
      expect(otraVezK1.body).toEqual(cuerpo401);
      expect(otraVezK1.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('criterio 120: variantes sin el comando', () => {
    it('criterio 120: el doble sube version_token como dueno; con K1, que sigue siendo la clave, responde 401 y no escribe nada', async () => {
      const cuerpo401 = await cuerpoDe401();
      const antes = await leerFila(sa.id);
      let tras: FilaSesion | undefined;
      const subirLaVersion = async (): Promise<void> => {
        await ejecutarComo(
          'propietario',
          'UPDATE superadmins SET version_token = version_token + 1 WHERE id = $1::uuid',
          [sa.id],
          { plataforma: true },
        );
        tras = await leerFila(sa.id);
      };
      doble.armar(subirLaVersion);

      const respuesta = await entrar(K1);
      if (!tras) await subirLaVersion();

      expect(Number(tras?.version_token)).toBe(Number(antes.version_token) + 1);
      await comprobarTrasElCambio(respuesta, cuerpo401, antes, tras, () => Promise.resolve());
    });

    it('criterio 120: un DELETE /api/plataforma/sesion (cierra las sesiones) mientras se calcula el hash tambien corta el ingreso', async () => {
      const cuerpo401 = await cuerpoDe401();
      const sesionAbierta = cookieDe(await entrar(K1));
      const antes = await leerFila(sa.id);
      let tras: FilaSesion | undefined;
      const cerrarSesiones = async (): Promise<void> => {
        const cierre = await request(servidor()).delete('/api/plataforma/sesion').set('Cookie', sesionAbierta);
        expect(cierre.status).toBe(204);
        tras = await leerFila(sa.id);
      };
      doble.armar(cerrarSesiones);

      const respuesta = await entrar(K1);
      if (!tras) await cerrarSesiones();

      expect(Number(tras?.version_token)).toBe(Number(antes.version_token) + 1);
      await comprobarTrasElCambio(respuesta, cuerpo401, antes, tras, () => Promise.resolve());
    });

    it('criterio 120: si solo cambia clave_hash (sin subir version_token) mientras se calcula el hash, el ingreso con K1 tampoco vale', async () => {
      const hashDeK2 = await hashDeLaClaveDelAtacante(K2);
      const cuerpo401 = await cuerpoDe401();
      const antes = await leerFila(sa.id);
      let tras: FilaSesion | undefined;
      const cambiarElHash = async (): Promise<void> => {
        await ejecutarComo(
          'propietario',
          'UPDATE superadmins SET clave_hash = $2 WHERE id = $1::uuid',
          [sa.id, hashDeK2],
          {
            plataforma: true,
          },
        );
        tras = await leerFila(sa.id);
      };
      doble.armar(cambiarElHash);

      const respuesta = await entrar(K1);
      if (!tras) await cambiarElHash();

      expect(tras?.clave_hash).toBe(hashDeK2);
      expect(Number(tras?.version_token), 'esta variante no sube la version').toBe(Number(antes.version_token));
      // Con una sola llamada (la clave se verifica dentro de la transaccion que bloquea), no hay nada mas que comprobar: el hash
      // cambio despues de aceptar el ingreso.
      if (doble.seEjecuto) {
        await comprobarTrasElCambio(respuesta, cuerpo401, antes, tras, () => Promise.resolve());
      } else {
        expect(respuesta.status).toBe(200);
      }
    });

    it('criterio 120 (control): sin intercalar nada, K1 entra con 200, la cookie sirve y escribe ultimo_acceso', async () => {
      const antes = await leerFila(sa.id);

      const respuesta = await entrar(K1);

      expect(respuesta.status).toBe(200);
      expect((await consultarSesion(cookieDe(respuesta))).status).toBe(200);
      const despues = await leerFila(sa.id);
      expect(despues.intentos_fallidos).toBe(0);
      expect(despues.ultimo_acceso).not.toBeNull();
      expect(antes.ultimo_acceso).toBeNull();
      expect(Number(despues.version_token)).toBe(Number(antes.version_token));
    });

    it('criterio 120 (control): con K1 equivocada el camino de la clave equivocada no cambia (401, cuenta un intento)', async () => {
      const respuesta = await entrar('Clave-Equivocada-9999');

      expect(respuesta.status).toBe(401);
      expect((respuesta.body as { codigo: string }).codigo).toBe('CREDENCIALES_INVALIDAS');
      expect(respuesta.headers['set-cookie']).toBeUndefined();
      expect((await leerFila(sa.id)).intentos_fallidos).toBe(1);
    });
  });

  describe('criterio 120: 8 inicios de sesion a la vez, en paralelo con el comando que cambia a K2 (sin pausas)', () => {
    it('criterio 120: cuando todo termina, toda cookie obtenida responde 401 en GET /api/plataforma/sesion', async () => {
      const comando = ejecutarComandoEnParalelo({
        SUPERADMIN_CORREO: sa.correo,
        SUPERADMIN_NOMBRE: NOMBRE_RESTABLECIDO,
        SUPERADMIN_CLAVE: K2,
      });
      const intentos = Array.from({ length: 8 }, () => entrar(K1));

      const respuestas = await Promise.all(intentos);
      const resultado = await comando;

      expect(resultado.estado, resultado.salida).toBe(0);
      for (const respuesta of respuestas) expect([200, 401]).toContain(respuesta.status);
      const cookies = respuestas.filter((respuesta) => respuesta.status === 200).map(cookieDe);
      for (const cookie of cookies) {
        expect(
          (await consultarSesion(cookie)).status,
          'una cookie emitida con K1 sigue sirviendo tras el restablecimiento',
        ).toBe(401);
      }
      expect((await entrar(K2)).status, 'K2 debe entrar al terminar').toBe(200);
    });
  });
});
