// spec: 002-autenticacion-roles (pruebas protegidas)
import { gzipSync } from 'node:zlib';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AHORA_PRUEBAS,
  atributosDeCookie,
  contarAuditoria,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  instantaneaDeUsuarios,
  leerUsuario,
  NOMBRE_COOKIE_ACADEMIA,
  pedir,
  type RolUsuario,
} from '../../utilidades/usuarios';

// Criterio 54 (ataque ronda 1, F2): `DELETE /api/sesion` no lee el cuerpo. Con cualquiera de los cuerpos que lista la spec responde
// 204 sin cuerpo, con `Cache-Control: no-store` y la cookie borrada; con una sesión válida sube `version_token` en 1 y esa cookie y
// otra sesión de la misma cuenta dejan de valer; sin sesión válida no cambia nada en la base. Las demás rutas conservan las reglas de
// cuerpos de 001 (400 con JSON roto, 413 con más de 100 KB).
//
// Los cuerpos raros (sin `Content-Type`, `Content-Encoding: br`, gzip corrupto, bytes que no son UTF-8) se envían con `node:http`,
// para que ninguna librería de pruebas corrija la petición. Las sesiones se firman sin pasar por el ingreso (no cuentan para el
// límite por IP, que es de 10 por minuto).

const CIENTO_CINCUENTA_KB = 150 * 1024;

interface CuerpoDePrueba {
  nombre: string;
  /** `undefined` = sin cabecera `Content-Type`. */
  tipo?: string;
  codificacion?: string;
  cuerpo: Buffer;
}

const CUERPOS: readonly CuerpoDePrueba[] = [
  { nombre: 'JSON roto con application/json', tipo: 'application/json', cuerpo: Buffer.from('{"x":') },
  { nombre: 'text/plain', tipo: 'text/plain', cuerpo: Buffer.from('hola, esto no es JSON') },
  {
    nombre: 'JSON válido de más de 100 KB',
    tipo: 'application/json',
    cuerpo: Buffer.from(JSON.stringify({ relleno: 'a'.repeat(CIENTO_CINCUENTA_KB) })),
  },
  { nombre: 'un cuerpo sin Content-Type', cuerpo: Buffer.from('cuerpo sin tipo') },
  {
    nombre: 'Content-Encoding no admitido (br)',
    tipo: 'application/json',
    codificacion: 'br',
    cuerpo: Buffer.from('{"x":1}'),
  },
  {
    nombre: 'gzip corrupto',
    tipo: 'application/json',
    codificacion: 'gzip',
    cuerpo: Buffer.concat([gzipSync(Buffer.from('{"x":1}')).subarray(0, 12), Buffer.from('basura que no es gzip')]),
  },
  {
    nombre: 'bytes que no son UTF-8 válido',
    tipo: 'application/json; charset=utf-8',
    cuerpo: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0xc3, 0x28, 0x22, 0x7d]),
  },
  { nombre: 'JSON válido {}', tipo: 'application/json', cuerpo: Buffer.from('{}') },
  { nombre: 'JSON válido {"x":1}', tipo: 'application/json', cuerpo: Buffer.from('{"x":1}') },
];

interface RespuestaCruda {
  estado: number;
  cabeceras: http.IncomingHttpHeaders;
  texto: string;
}

describe('criterio 54: DELETE /api/sesion cierra con cualquier cuerpo', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let puerto: number;

  /** Una petición cruda: el método, la ruta, las cabeceras y los bytes exactos del cuerpo. */
  function cruda(
    metodo: string,
    ruta: string,
    cabeceras: Record<string, string>,
    cuerpo?: Buffer,
  ): Promise<RespuestaCruda> {
    return new Promise((resolver, rechazar) => {
      const peticion = http.request(
        { host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers: cabeceras },
        (respuesta) => {
          const trozos: Buffer[] = [];
          respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
          respuesta.on('end', () =>
            resolver({
              estado: respuesta.statusCode ?? 0,
              cabeceras: respuesta.headers,
              texto: Buffer.concat(trozos).toString('utf8'),
            }),
          );
          respuesta.on('error', rechazar);
        },
      );
      peticion.on('error', rechazar);
      peticion.end(cuerpo);
    });
  }

  /** `DELETE /api/sesion` con el cuerpo de prueba y, si hay, la cookie. */
  function cerrarSesion(prueba: CuerpoDePrueba, cookie?: string): Promise<RespuestaCruda> {
    const cabeceras: Record<string, string> = { 'Content-Length': String(prueba.cuerpo.length) };
    if (prueba.tipo !== undefined) cabeceras['Content-Type'] = prueba.tipo;
    if (prueba.codificacion !== undefined) cabeceras['Content-Encoding'] = prueba.codificacion;
    if (cookie !== undefined) cabeceras['Cookie'] = cookie;
    return cruda('DELETE', '/api/sesion', cabeceras, prueba.cuerpo);
  }

  function cookieBorrada(respuesta: RespuestaCruda): string[] {
    const crudo = respuesta.cabeceras['set-cookie'] ?? [];
    const cookie = crudo.find((valor) => valor.startsWith(`${NOMBRE_COOKIE_ACADEMIA}=`));
    expect(cookie, 'la respuesta debe llevar Set-Cookie: aq_sesion=').toBeDefined();
    return atributosDeCookie(cookie as string);
  }

  function esperarCierreCorrecto(respuesta: RespuestaCruda): void {
    expect(respuesta.estado).toBe(204);
    expect(respuesta.texto).toBe('');
    expect(respuesta.cabeceras['cache-control']).toBe('no-store');
    const atributos = cookieBorrada(respuesta);
    expect(atributos[0]).toBe(`${NOMBRE_COOKIE_ACADEMIA}=`);
    expect(atributos).toContain('max-age=0');
    expect(atributos).toContain('path=/api');
  }

  /** Dos sesiones distintas de la misma cuenta, con la versión actual del token. */
  function dosSesiones(usuario: { id: string; academiaId: string; rol: RolUsuario }, version: number) {
    return {
      primera: cookieDeUsuario(usuario, AHORA_PRUEBAS, {}, version),
      otra: cookieDeUsuario(usuario, new Date(AHORA_PRUEBAS.getTime() - 5_000), {}, version),
    };
  }

  beforeAll(async () => {
    e = await crearEscenario();
    ({ app } = await crearAppConReloj());
    const servidor = app.getHttpServer();
    if (!servidor.listening) await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', () => resolver()));
    puerto = (servidor.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('con una sesión válida', () => {
    for (const prueba of CUERPOS) {
      it(`${prueba.nombre}: responde 204 sin cuerpo, borra la cookie, sube version_token en 1 y deja de valer en las dos sesiones`, async () => {
        const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA' });
        const { primera, otra } = dosSesiones(usuario, 0);
        expect((await pedir(app, 'get', '/api/sesion', { cookie: primera })).status).toBe(200);
        expect((await pedir(app, 'get', '/api/sesion', { cookie: otra })).status).toBe(200);
        const antes = await leerUsuario(e.A.id, usuario.id);

        const respuesta = await cerrarSesion(prueba, primera);

        esperarCierreCorrecto(respuesta);
        const despues = await leerUsuario(e.A.id, usuario.id);
        expect(despues?.version_token).toBe((antes?.version_token ?? 0) + 1);
        for (const cookie of [primera, otra]) {
          const sesion = await pedir(app, 'get', '/api/sesion', { cookie });
          expect(sesion.status).toBe(401);
          expect((sesion.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');
        }
      });
    }
  });

  describe('sin sesión válida', () => {
    /** Un token con la firma alterada: cambia un carácter del medio de la firma. */
    function cookieAlterada(): string {
      const usuario = { id: e.secretariaA.id, academiaId: e.A.id, rol: e.secretariaA.rol };
      const token = cookieDeUsuario(usuario, AHORA_PRUEBAS).slice(NOMBRE_COOKIE_ACADEMIA.length + 1);
      const posicion = token.lastIndexOf('.') + 10;
      const letra = token[posicion] === 'A' ? 'B' : 'A';
      return `${NOMBRE_COOKIE_ACADEMIA}=${token.slice(0, posicion)}${letra}${token.slice(posicion + 1)}`;
    }

    for (const [descripcion, cookie] of [
      ['sin cookie', undefined],
      ['con un token alterado', 'alterado'],
    ] as const) {
      for (const prueba of CUERPOS) {
        it(`${descripcion}, ${prueba.nombre}: responde 204, borra la cookie y no cambia nada en la base`, async () => {
          const usuariosAntes = await instantaneaDeUsuarios(e.A.id);
          const usuariosAntesB = await instantaneaDeUsuarios(e.B.id);
          const auditoriaAntes = await contarAuditoria(e.A.id);

          const respuesta = await cerrarSesion(prueba, cookie === 'alterado' ? cookieAlterada() : undefined);

          esperarCierreCorrecto(respuesta);
          expect(await instantaneaDeUsuarios(e.A.id)).toBe(usuariosAntes);
          expect(await instantaneaDeUsuarios(e.B.id)).toBe(usuariosAntesB);
          expect(await contarAuditoria(e.A.id)).toBe(auditoriaAntes);
        });
      }
    }
  });

  describe('las demás rutas conservan las reglas de cuerpos de 001', () => {
    it('POST /api/sesion/clave con JSON roto sigue respondiendo 400 SOLICITUD_INVALIDA y no cambia la versión del token', async () => {
      const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA' });
      const cookie = cookieDeUsuario(usuario, AHORA_PRUEBAS);
      const antes = await leerUsuario(e.A.id, usuario.id);

      const respuesta = await cruda(
        'POST',
        '/api/sesion/clave',
        { 'Content-Type': 'application/json', 'Content-Length': '5', Cookie: cookie },
        Buffer.from('{"x":'),
      );

      expect(respuesta.estado).toBe(400);
      expect((JSON.parse(respuesta.texto) as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      expect((await leerUsuario(e.A.id, usuario.id))?.version_token).toBe(antes?.version_token);
    });

    it('POST /api/sesion/clave con un JSON de más de 100 KB sigue respondiendo 413 CARGA_EXCESIVA', async () => {
      const usuario = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA' });
      const cookie = cookieDeUsuario(usuario, AHORA_PRUEBAS);
      const cuerpo = Buffer.from(JSON.stringify({ relleno: 'a'.repeat(CIENTO_CINCUENTA_KB) }));

      const respuesta = await cruda(
        'POST',
        '/api/sesion/clave',
        { 'Content-Type': 'application/json', 'Content-Length': String(cuerpo.length), Cookie: cookie },
        cuerpo,
      );

      expect(respuesta.estado).toBe(413);
      expect((JSON.parse(respuesta.texto) as ErrorCuerpo).codigo).toBe('CARGA_EXCESIVA');
    });
  });
});
