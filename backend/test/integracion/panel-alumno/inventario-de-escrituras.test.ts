// spec: 011-panel-alumno (pruebas protegidas)
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { puede } from '@aquagestion/contratos';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLAVE_PERMISO, CLAVE_SOLO_SESION } from '../../../src/modulos/autenticacion/permiso.decorator';
import {
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import { prepararEscenarioDe009b } from '../../utilidades/escenario-faltas';
import { instantaneaDeTodasLasTablas, pedirCrudo } from '../../utilidades/escenario-panel';
import { leerPagos } from '../../utilidades/pagos';
import { rutasRegistradas } from '../../utilidades/usuarios';

// Criterio 15 (crítico, D-14, HU-03, sección 2.1): la cuenta del alumno solo cambia su contraseña. Una prueba recorre todos los manejadores de la aplicación real con un método distinto de `GET`, fuera de `/api/a/…`, `/api/plataforma/…` y `/api/salud`, y sin `DELETE /api/sesion` (cerrar sesión, que no lleva decorador ni pasa por el middleware de sesión,
// criterio 54 de 002): los únicos que el guard de permisos deja pasar al rol `ALUMNO` (por `@SoloSesion()` o por un `@Permiso` cuya fila de la matriz tiene celda para `ALUMNO`) son `POST /api/sesion/clave` y `POST /api/alumnos/buscar` (de `VER_CARNET`, que el alcance rechaza con 403, criterio 16 de 008); cada uno de los demás, y
// `POST /api/alumnos/buscar`, pedido con la sesión de un alumno (cambio de clave hecho), sin cuerpo o con `{}` y con los parámetros de la dirección llenos con ids que existen en su academia (su propio alumno, su matrícula, su pago, una clase, la caja), responde 4xx (nunca 2xx) y no cambia ninguna fila. Si una historia futura agrega
// una escritura que deja pasar al alumno, esta prueba falla hasta que su spec la agregue a la lista con una decisión del responsable (DT-13 del plan).
// Lecturas estrictas elegidas: el inventario sale de la metadata de Nest (`DiscoveryService` y `MetadataScanner`), con la misma regla del guard (lo declarado en el manejador manda sobre lo de la clase); se contrasta con las rutas que de verdad están registradas en Express, para que un manejador que el inventario no vea haga fallar la prueba y no pasar
// vacía; `HEAD` y `OPTIONS` no son escrituras; los ids de la dirección se prueban uno por uno (también uno de otro alumno, uno de B y uno que no existe); «no cambia ninguna fila» es la instantánea de todas las tablas de A y de B.

const AHORA = enLima('2026-11-24', '10:00:00.000');
const PERMITIDAS_AL_ALUMNO = ['POST /api/alumnos/buscar', 'POST /api/sesion/clave'];
/** Las escrituras que existen hoy y que el inventario tiene que ver (si no las ve, la metadata de Nest cambió y la prueba no puede pasar vacía). */
const ESCRITURAS_QUE_EXISTEN_HOY = [
  'POST /api/asistencias/qr',
  'POST /api/asistencias/manual',
  'POST /api/asistencias/posterior',
  'POST /api/solicitudes/:p/pago-efectivo',
  'POST /api/solicitudes/:p/ajuste-monto',
  'POST /api/pagos/:p/aprobacion',
  'POST /api/pagos/:p/rechazo',
  'POST /api/cajas',
  'POST /api/cajas/:p/cierre',
  'POST /api/cajas/:p/egresos',
  'POST /api/cajas/:p/reapertura',
  'POST /api/matriculas/:p/horario',
  'POST /api/alumnos/:p/renovacion/efectivo',
  'PUT /api/alumnos/:p/renovacion/comprobante',
  'POST /api/alumnos/:p/carnet/qr',
  'PUT /api/alumnos/:p/foto',
  'POST /api/usuarios/:p/restablecer-clave',
  'POST /api/sesion/clave',
];

interface Manejador {
  metodo: string;
  /** La ruta completa con sus parámetros como `:id`. */
  ruta: string;
  /** La misma ruta con todos los parámetros como `:p`, para comparar. */
  clave: string;
  permiso: string | undefined;
  soloSesion: boolean;
  dejaPasarAlAlumno: boolean;
  nombre: string;
}

const comoLista = (valor: unknown): string[] =>
  Array.isArray(valor) ? valor.map(String) : typeof valor === 'string' ? [valor] : [''];
const normalizarParametros = (ruta: string): string => ruta.replaceAll(/:[A-Za-z0-9_]+/g, ':p');
const unir = (...partes: string[]): string =>
  `/${partes
    .flatMap((parte) => parte.split('/'))
    .filter((parte) => parte !== '')
    .join('/')}`;

/** Todos los manejadores de ruta de la aplicación, leídos de la metadata de Nest (`@Controller`, `@Get`/`@Post`/…, `@Permiso`, `@SoloSesion`), con la regla del guard de permisos. */
function inventariar(app: NestExpressApplication): Manejador[] {
  const descubridor = new DiscoveryService(app.get(ModulesContainer));
  const escaner = new MetadataScanner();
  const manejadores: Manejador[] = [];
  for (const envoltorio of descubridor.getControllers()) {
    const instancia = envoltorio.instance as object | undefined;
    const clase = envoltorio.metatype;
    if (!instancia || typeof clase !== 'function') continue;
    for (const nombre of escaner.getAllMethodNames(Object.getPrototypeOf(instancia) as object)) {
      const manejador = (instancia as Record<string, unknown>)[nombre];
      if (typeof manejador !== 'function') continue;
      const codigoDeMetodo = Reflect.getMetadata(METHOD_METADATA, manejador) as number | undefined;
      if (codigoDeMetodo === undefined) continue;
      // Igual que `PermisosGuard`: se mira primero el manejador y después la clase; el primero que declare algo manda.
      let permiso: string | undefined;
      let soloSesion = false;
      for (const destino of [manejador, clase]) {
        permiso = Reflect.getMetadata(CLAVE_PERMISO, destino) as string | undefined;
        soloSesion = (Reflect.getMetadata(CLAVE_SOLO_SESION, destino) as boolean | undefined) === true;
        if (permiso !== undefined || soloSesion) break;
      }
      const dejaPasarAlAlumno = soloSesion || (permiso !== undefined && puede('ALUMNO', permiso));
      const delControlador = comoLista(Reflect.getMetadata(PATH_METADATA, clase));
      const delManejador = comoLista(Reflect.getMetadata(PATH_METADATA, manejador));
      for (const base of delControlador) {
        for (const propia of delManejador) {
          const ruta = unir('api', base, propia);
          manejadores.push({
            metodo: RequestMethod[codigoDeMetodo] ?? String(codigoDeMetodo),
            ruta,
            clave: normalizarParametros(ruta),
            permiso,
            soloSesion,
            dejaPasarAlAlumno,
            nombre: `${clase.name}.${nombre}`,
          });
        }
      }
    }
  }
  return manejadores;
}

const esEscritura = (metodo: string): boolean => !['GET', 'HEAD', 'OPTIONS'].includes(metodo);
const estaExenta = (m: Pick<Manejador, 'metodo' | 'ruta'>): boolean =>
  /^\/api\/(a|plataforma|salud)(\/|$)/.test(m.ruta) || (m.metodo === 'DELETE' && m.ruta === '/api/sesion');

describe('el inventario de manejadores de escritura (criterio 15)', () => {
  let ctx: AppCarnet;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  it('el inventario ve las escrituras que existen hoy (mínimo de manejadores) y coincide con las rutas registradas en Express', () => {
    const manejadores = inventariar(ctx.app);
    const escrituras = manejadores.filter((m) => esEscritura(m.metodo));
    const delInventario = new Set(escrituras.map((m) => `${m.metodo} ${m.clave}`));

    expect(
      escrituras.length,
      'la metadata de Nest no dio manejadores: la prueba no puede pasar vacía',
    ).toBeGreaterThanOrEqual(ESCRITURAS_QUE_EXISTEN_HOY.length);
    for (const esperada of ESCRITURAS_QUE_EXISTEN_HOY) {
      expect(delInventario.has(esperada), `el inventario no ve «${esperada}»`).toBe(true);
    }
    const deExpress = new Set(
      rutasRegistradas(ctx.app)
        .filter(
          ([metodo, ruta]) =>
            esEscritura(metodo) && ruta.startsWith('/api/') && !ruta.includes('{') && !ruta.includes('*'),
        )
        .map(([metodo, ruta]) => `${metodo} ${normalizarParametros(ruta)}`),
    );
    expect([...delInventario].sort(), 'lo que Nest declara es lo que Express registró').toEqual([...deExpress].sort());
  });

  it('los únicos manejadores de escritura que el guard deja pasar al rol ALUMNO son POST /api/sesion/clave y POST /api/alumnos/buscar', () => {
    const quePasan = inventariar(ctx.app)
      .filter((m) => esEscritura(m.metodo) && !estaExenta(m) && m.dejaPasarAlAlumno)
      .map((m) => `${m.metodo} ${m.clave}`)
      .sort();

    expect(quePasan).toEqual(PERMITIDAS_AL_ALUMNO);
  });
});

describe('lo que un alumno logra con cada escritura (criterio 15)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;
  let otro: AlumnoDeAsistencia;
  let deB: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDe009b(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc, { dni: '36000001', nombres: 'Alma', apellidos: 'Inventario' });
    otro = await crearAlumnoDeAsistencia(ctx, esc, { dni: '36000002', nombres: 'Beto', apellidos: 'Inventario' });
    deB = await crearAlumnoDeAsistencia(ctx, esc, { academia: 'B', dni: '36000003', nombres: 'Cora' });
    en(ctx, esc, AHORA);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  it('cada escritura (y la búsqueda), pedida por un alumno sin cuerpo o con {} y con cada id de su academia en la dirección, responde 4xx y no cambia ninguna fila', async () => {
    const pedidas = inventariar(ctx.app).filter(
      (m) =>
        esEscritura(m.metodo) &&
        !estaExenta(m) &&
        (!m.dejaPasarAlAlumno || `${m.metodo} ${m.clave}` === 'POST /api/alumnos/buscar') &&
        `${m.metodo} ${m.clave}` !== 'POST /api/sesion/clave',
    );
    const pagos = await leerPagos(esc.e.A.id);
    const ids = [
      alumno.alumnoId,
      alumno.matriculaId,
      alumno.usuarioId,
      alumno.solicitudId,
      esc.e.lunes.id,
      esc.cajaA,
      pagos[0]?.id ?? randomUUID(),
      esc.e.plan.id,
      otro.alumnoId,
      deB.alumnoId,
      randomUUID(),
      'no-es-un-uuid',
    ];
    expect(pedidas.length, 'hay escrituras que pedir').toBeGreaterThanOrEqual(25);
    const antes = await instantaneaDeTodasLasTablas([esc.e.A, esc.e.B]);
    const fallas: string[] = [];

    for (const manejador of pedidas) {
      const conParametros = manejador.ruta.includes(':');
      for (const id of conParametros ? ids : [undefined]) {
        const ruta = id === undefined ? manejador.ruta : manejador.ruta.replaceAll(/:[A-Za-z0-9_]+/g, id);
        for (const cuerpo of [undefined, {}] as const) {
          const respuesta = await pedirCrudo(ctx.app, manejador.metodo, ruta, { cookie: alumno.cookie, cuerpo });
          if (respuesta.status < 400 || respuesta.status >= 500) {
            fallas.push(
              `${manejador.metodo} ${ruta} (${manejador.nombre}) ${cuerpo === undefined ? 'sin cuerpo' : 'con {}'}: HTTP ${respuesta.status}`,
            );
          }
        }
      }
    }

    expect(fallas, 'ninguna escritura puede dar 2xx ni error del servidor a un alumno').toEqual([]);
    expect(await instantaneaDeTodasLasTablas([esc.e.A, esc.e.B]), 'ninguna fila cambió').toEqual(antes);
  }, 180_000);
});
