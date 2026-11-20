import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaseDatos } from '../../../src/infraestructura/prisma';
import { leerConfiguracion } from '../../../src/modulos/configuracion';
import {
  CLAVE_EN_BASE,
  esperarConfiguracion,
  fijarConfiguracion,
  fijarFilaConfiguracion,
  instantaneaDeConfiguracion,
  leerFilasConfiguracion,
  POR_DEFECTO,
} from '../../utilidades/configuracion';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  type ErrorCuerpo,
  type Escenario,
  pedir,
} from '../../utilidades/usuarios';

// Spec 003, criterios 1 a 3 (lectura y valores por defecto), 6 (`leerConfiguracion(tx)`), 20 y 21 (identidad). Pruebas de integración
// no protegidas: los valores esperados están escritos a mano.

describe('lectura de la configuración (criterios 1 a 3, 6, 20 y 21)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let app: NestExpressApplication;
  let e: Escenario;
  let admin: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj(AHORA_PRUEBAS, { nivelRegistro: 'warn', destinoRegistro: destino }));
  });
  beforeEach(async () => {
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  const leer = () => pedir(app, 'get', '/api/configuracion', { cookie: admin });

  it('criterio 1: una academia sin filas recibe los valores por defecto y crear la academia no insertó filas', async () => {
    expect(await leerFilasConfiguracion(e.A.id)).toEqual([]);
    expect(await leerFilasConfiguracion(e.B.id)).toEqual([]);

    const respuesta = await leer();

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
    esperarConfiguracion(respuesta.body, {
      toleranciaTardanzaMinutos: 10,
      diasPorVencer: 5,
      diasPrioridadRenovacion: 5,
      intentosInicioSesion: 5,
      minutosBloqueo: 15,
      telefono: null,
    });
    expect(await leerFilasConfiguracion(e.A.id), 'leer no escribe').toEqual([]);
  });

  it('criterio 2: con filas válidas para algunas claves, responde esas y las demás por defecto; ignora las claves desconocidas', async () => {
    await fijarConfiguracion(e.A.id, { diasPorVencer: 8, telefono: '+51 999 888 777' });
    await fijarFilaConfiguracion(e.A.id, 'logo', 'https://ejemplo.test/logo.png');
    await fijarFilaConfiguracion(e.A.id, 'clave_de_una_historia_futura', { a: 1 });

    const respuesta = await leer();

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
    esperarConfiguracion(respuesta.body, { ...POR_DEFECTO, diasPorVencer: 8, telefono: '+51 999 888 777' });
    expect(JSON.stringify(respuesta.body)).not.toMatch(/logo|futura/);
  });

  it.each([
    ['un texto', 'cinco'],
    ['un texto con dígitos', '5'],
    ['true', true],
    ['un objeto', { valor: 5 }],
    ['una lista', [5]],
    ['JSON null', null],
    ['un decimal', 5.5],
    ['fuera de rango (mil)', 1000],
    ['fuera de rango (negativo)', -3],
  ])(
    'criterio 3: un valor guardado inválido (%s) en una clave numérica responde 200 con el valor por defecto y un aviso sin el valor',
    async (_nombre, valor) => {
      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.diasPorVencer, valor);
      await fijarConfiguracion(e.A.id, { minutosBloqueo: 20 });
      const antes = lineas.length;

      const respuesta = await leer();

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, { ...POR_DEFECTO, minutosBloqueo: 20 });
      await esperarHasta(() => lineas.length > antes);
      const nuevas = lineas.slice(antes).join('\n');
      expect(nuevas).toContain('dias_por_vencer');
      expect(nuevas).toContain(e.A.id);
      expect(nuevas, 'el aviso no repite el valor guardado').not.toContain('cinco');
      expect(nuevas).not.toContain('minutos_bloqueo');
    },
  );

  it.each([
    ['5 caracteres', '12345'],
    ['con letras', 'llamar a recepcion'],
    ['con espacios en los extremos', ' 999 888 777 '],
    ['un número', 999888777],
  ])('criterio 3: un teléfono guardado inválido (%s) responde 200 con telefono null', async (_nombre, valor) => {
    await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.telefono, valor);

    const respuesta = await leer();

    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
    esperarConfiguracion(respuesta.body, POR_DEFECTO);
  });

  it('criterio 3: el aviso lleva la academia y la clave y nunca el valor guardado', async () => {
    const secreto = 'valor-invalido-unico-98765';
    await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.telefono, secreto);
    const antes = lineas.length;

    await leer();
    await esperarHasta(() => lineas.length > antes);

    const avisos = lineas.slice(antes).filter((linea) => linea.includes('Valor de configuración inválido'));
    expect(avisos.length).toBeGreaterThan(0);
    for (const aviso of avisos) {
      const objeto = JSON.parse(aviso) as Record<string, unknown>;
      expect(objeto['academiaId']).toBe(e.A.id);
      expect(objeto['clave']).toBe('telefono');
      expect(aviso).not.toContain(secreto);
    }
  });

  describe('leerConfiguracion(tx) (criterio 6)', () => {
    it('devuelve los valores de la academia de la transacción, no los de otra', async () => {
      await fijarConfiguracion(e.A.id, { toleranciaTardanzaMinutos: 20, telefono: '111 222 333' });
      await fijarConfiguracion(e.B.id, { toleranciaTardanzaMinutos: 3, telefono: '444 555 666' });
      const baseDatos = app.get(BaseDatos, { strict: false });

      const deA = await baseDatos.conAcademia(e.A.id, (tx) => leerConfiguracion(tx));
      const deB = await baseDatos.conAcademia(e.B.id, (tx) => leerConfiguracion(tx));

      expect(deA).toEqual({ ...POR_DEFECTO, toleranciaTardanzaMinutos: 20, telefono: '111 222 333' });
      expect(deB).toEqual({ ...POR_DEFECTO, toleranciaTardanzaMinutos: 3, telefono: '444 555 666' });
    });

    it('no guarda nada entre llamadas: un cambio confirmado se ve en la siguiente', async () => {
      const baseDatos = app.get(BaseDatos, { strict: false });
      await fijarConfiguracion(e.A.id, { diasPorVencer: 7 });
      const primera = await baseDatos.conAcademia(e.A.id, (tx) => leerConfiguracion(tx));
      await fijarConfiguracion(e.A.id, { diasPorVencer: 9 });
      const segunda = await baseDatos.conAcademia(e.A.id, (tx) => leerConfiguracion(tx));

      expect(primera.diasPorVencer).toBe(7);
      expect(segunda.diasPorVencer).toBe(9);
    });

    it('usa una sola consulta, sin escribir, y avisa de los valores inválidos con el registro que recibe', async () => {
      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.intentosInicioSesion, 'x');
      const antes = await instantaneaDeConfiguracion(e.A.id);
      const avisos: { contexto: object; mensaje: string }[] = [];
      const baseDatos = app.get(BaseDatos, { strict: false });

      const configuracion = await baseDatos.conAcademia(e.A.id, (tx) =>
        leerConfiguracion(tx, { registro: { warn: (contexto, mensaje) => avisos.push({ contexto, mensaje }) } }),
      );

      expect(configuracion).toEqual(POR_DEFECTO);
      expect(avisos).toEqual([
        {
          contexto: { academiaId: e.A.id, clave: 'intentos_inicio_sesion' },
          mensaje: 'Valor de configuración inválido: se usa el valor por defecto',
        },
      ]);
      expect(await instantaneaDeConfiguracion(e.A.id)).toBe(antes);
    });

    it('hace una sola consulta dentro de la transacción de quien llama', async () => {
      const consultas: string[] = [];
      const tx = {
        academiaId: e.A.id,
        cliente: {
          $queryRaw: (partes: TemplateStringsArray) => {
            consultas.push(partes.join('?'));
            return Promise.resolve([{ clave: 'minutos_bloqueo', valor: 30 }]);
          },
        },
      };

      const configuracion = await leerConfiguracion(tx as never);

      expect(consultas).toHaveLength(1);
      expect(consultas[0]).toMatch(/FROM configuraciones/);
      expect(configuracion).toEqual({ ...POR_DEFECTO, minutosBloqueo: 30 });
    });
  });

  describe('GET /api/mi-academia (criterio 20) y la ruta pública (criterio 21)', () => {
    it('criterio 20: responde nombre, nombreCorto y el teléfono efectivo a un rol sin permiso de configurar', async () => {
      await fijarConfiguracion(e.A.id, { telefono: '(01) 555-0199' });

      const respuesta = await pedir(app, 'get', '/api/mi-academia', {
        cookie: cookieDeUsuario(e.alumnoA, AHORA_PRUEBAS),
      });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(respuesta.body).toEqual({
        academia: { nombre: 'Academia A', nombreCorto: 'academia-a', telefono: '(01) 555-0199' },
      });
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('criterio 20: sin teléfono guardado responde telefono null, y con uno inválido también', async () => {
      const sinFila = await pedir(app, 'get', '/api/mi-academia', { cookie: admin });
      expect(sinFila.body).toEqual({ academia: { nombre: 'Academia A', nombreCorto: 'academia-a', telefono: null } });

      await fijarFilaConfiguracion(e.A.id, CLAVE_EN_BASE.telefono, 'abc');
      const invalido = await pedir(app, 'get', '/api/mi-academia', { cookie: admin });
      expect(invalido.body).toEqual({ academia: { nombre: 'Academia A', nombreCorto: 'academia-a', telefono: null } });
    });

    it('criterio 20: sin sesión responde 401 y con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO', async () => {
      const sinSesion = await pedir(app, 'get', '/api/mi-academia');
      expect(sinSesion.status).toBe(401);
      expect((sinSesion.body as ErrorCuerpo).codigo).toBe('NO_AUTENTICADO');

      const pendiente = await crearUsuarioDePrueba({
        academiaId: e.A.id,
        rol: 'SECRETARIA',
        clave: CLAVE_COMUN,
        debeCambiarClave: true,
      });
      const respuesta = await pedir(app, 'get', '/api/mi-academia', {
        cookie: cookieDeUsuario(pendiente, AHORA_PRUEBAS),
      });
      expect(respuesta.status).toBe(403);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('CAMBIO_DE_CLAVE_OBLIGATORIO');
    });

    it('criterio 20: el Superadmin no tiene ruta para ver la configuración de una academia (D-29)', async () => {
      for (const ruta of [
        '/api/configuracion',
        `/api/plataforma/academias/${e.A.id}/configuracion`,
        `/api/plataforma/configuracion`,
      ]) {
        const respuesta = await pedir(app, 'get', ruta);
        expect([401, 404], `${ruta}: ${respuesta.status}`).toContain(respuesta.status);
        expect(JSON.stringify(respuesta.body)).not.toContain('toleranciaTardanzaMinutos');
      }
    });

    // Desde la 005 (DR-4 de 003, criterio 5 de 005) la ruta pública SÍ publica el teléfono efectivo de la configuración: solo eso se
    // suma, sin id, estado ni motivo. `GET /api/mi-academia` (criterio 20) no cambia.
    it('criterio 21 (ampliado por el criterio 5 de 005): GET /api/a/{nombreCorto} responde nombreCorto, nombre y el teléfono efectivo', async () => {
      await fijarConfiguracion(e.A.id, { telefono: '(01) 555-0199' });

      const respuesta = await pedir(app, 'get', '/api/a/academia-a');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({ nombreCorto: 'academia-a', nombre: 'Academia A', telefono: '(01) 555-0199' });
    });
  });
});
