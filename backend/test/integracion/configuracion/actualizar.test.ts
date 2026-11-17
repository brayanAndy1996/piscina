import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCION_AUDITORIA,
  esperarConfiguracion,
  fijarConfiguracion,
  fijarFilaConfiguracion,
  instantaneaDeConfiguracion,
  leerFilaConfiguracion,
  leerFilasConfiguracion,
  POR_DEFECTO,
} from '../../utilidades/configuracion';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  type ErrorCuerpo,
  type Escenario,
  pedir,
} from '../../utilidades/usuarios';

// Spec 003, criterios 7 a 10: el PATCH del administrador (qué escribe y audita, qué rechaza, idempotencia y teléfono). Pruebas de
// integración no protegidas: los valores esperados están escritos a mano.

describe('PATCH /api/configuracion (criterios 7 a 10)', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let admin: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
  });
  beforeEach(async () => {
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await app?.close();
  });

  const patch = (cuerpo: unknown) => pedir(app, 'patch', '/api/configuracion', { cookie: admin, cuerpo });
  const auditorias = () => leerAuditoriaDeAcademia(e.A.id, ACCION_AUDITORIA);
  const detalleDe = (respuesta: { body: unknown }) => (respuesta.body as ErrorCuerpo).detalles;

  describe('criterio 7: cambios válidos', () => {
    it('responde 200 con todos los valores efectivos, escribe una fila por campo con actualizado_en del reloj y no toca los demás', async () => {
      await fijarConfiguracion(e.A.id, { diasPorVencer: 7 }, new Date('2026-01-01T00:00:00.000Z'));

      const respuesta = await patch({ minutosBloqueo: 30, telefono: '999 888 777' });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, {
        ...POR_DEFECTO,
        diasPorVencer: 7,
        minutosBloqueo: 30,
        telefono: '999 888 777',
      });
      const filas = await leerFilasConfiguracion(e.A.id);
      expect(filas.map((fila) => [fila.clave, fila.valor, fila.actualizado_en.toISOString()])).toEqual([
        ['dias_por_vencer', 7, '2026-01-01T00:00:00.000Z'],
        ['minutos_bloqueo', 30, AHORA_PRUEBAS.toISOString()],
        ['telefono', '999 888 777', AHORA_PRUEBAS.toISOString()],
      ]);
    });

    it('actualiza una fila que ya existía y registra un solo CONFIGURACION_ACTUALIZADA con solo los campos cambiados', async () => {
      await fijarConfiguracion(e.A.id, { minutosBloqueo: 30, diasPorVencer: 7 });

      const respuesta = await patch({ minutosBloqueo: 20, toleranciaTardanzaMinutos: 15, diasPorVencer: 7 });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect((await leerFilaConfiguracion(e.A.id, 'minutos_bloqueo'))?.valor).toBe(20);
      expect((await leerFilaConfiguracion(e.A.id, 'tolerancia_tardanza_minutos'))?.valor).toBe(15);
      const registros = await auditorias();
      expect(registros).toHaveLength(1);
      const [registro] = registros;
      expect(registro).toMatchObject({
        actor_tipo: 'USUARIO',
        actor_id: e.adminA.id,
        accion: ACCION_AUDITORIA,
        entidad: 'configuracion',
        entidad_id: null,
        datos_antes: { minutosBloqueo: 30, toleranciaTardanzaMinutos: 10 },
        datos_despues: { minutosBloqueo: 20, toleranciaTardanzaMinutos: 15 },
      });
      expect(registro?.ip, 'la auditoría guarda la IP').toBeTruthy();
      expect(registro?.fecha_hora.toISOString()).toBe(AHORA_PRUEBAS.toISOString());
    });

    it('quitar el teléfono guarda JSON null, lo audita y GET /api/mi-academia responde telefono null', async () => {
      await fijarConfiguracion(e.A.id, { telefono: '999 888 777' });

      const respuesta = await patch({ telefono: null });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, POR_DEFECTO);
      expect((await leerFilaConfiguracion(e.A.id, 'telefono'))?.valor).toBeNull();
      const [registro] = await auditorias();
      expect(registro).toMatchObject({ datos_antes: { telefono: '999 888 777' }, datos_despues: { telefono: null } });
      const identidad = await pedir(app, 'get', '/api/mi-academia', { cookie: admin });
      expect(identidad.body).toEqual({ academia: { nombre: 'Academia A', nombreCorto: 'academia-a', telefono: null } });
    });

    it('el siguiente GET ve el cambio y los seis campos a la vez se aceptan', async () => {
      const cuerpo = {
        toleranciaTardanzaMinutos: 0,
        diasPorVencer: 15,
        diasPrioridadRenovacion: 1,
        intentosInicioSesion: 10,
        minutosBloqueo: 5,
        telefono: '+51 (01) 555-0199',
      };

      const respuesta = await patch(cuerpo);
      const lectura = await pedir(app, 'get', '/api/configuracion', { cookie: admin });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect(lectura.body).toEqual({ configuracion: cuerpo });
      const [registro] = await auditorias();
      expect(registro?.datos_despues).toEqual(cuerpo);
      expect(registro?.datos_antes).toEqual({ ...POR_DEFECTO, telefono: null });
    });

    it('1e1 y 10.0 llegan como el número 10: se aceptan', async () => {
      const respuesta = await request(app.getHttpServer())
        .patch('/api/configuracion')
        .set('Cookie', admin)
        .set('Content-Type', 'application/json')
        .send('{"diasPorVencer":1e1,"diasPrioridadRenovacion":10.0}');

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect((await leerFilaConfiguracion(e.A.id, 'dias_por_vencer'))?.valor).toBe(10);
      expect((await leerFilaConfiguracion(e.A.id, 'dias_prioridad_renovacion'))?.valor).toBe(10);
    });
  });

  describe('criterio 8: cuerpos inválidos', () => {
    async function sinCambios(accion: () => Promise<{ status: number; body: unknown }>) {
      await fijarConfiguracion(e.A.id, { diasPorVencer: 7 });
      const antes = await instantaneaDeConfiguracion(e.A.id);
      const auditoriaAntes = JSON.stringify(await leerAuditoriaDeAcademia(e.A.id));
      const respuesta = await accion();
      expect(await instantaneaDeConfiguracion(e.A.id), 'no escribe').toBe(antes);
      expect(JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)), 'no audita').toBe(auditoriaAntes);
      return respuesta;
    }

    it.each([
      ['{} (sin ningún campo)', {}, ''],
      ['nombre', { nombre: 'Otra academia' }, ''],
      ['logo', { logo: 'x.png' }, ''],
      ['academiaId', { academiaId: '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f' }, ''],
      ['un campo válido y otro de más', { minutosBloqueo: 20, nombre: 'x' }, ''],
      ['un decimal', { toleranciaTardanzaMinutos: 10.5 }, 'toleranciaTardanzaMinutos'],
      ['un texto con dígitos', { toleranciaTardanzaMinutos: '10' }, 'toleranciaTardanzaMinutos'],
      ['un booleano', { diasPorVencer: true }, 'diasPorVencer'],
      ['null en un campo numérico', { diasPrioridadRenovacion: null }, 'diasPrioridadRenovacion'],
      ['un objeto en un campo numérico', { intentosInicioSesion: { valor: 5 } }, 'intentosInicioSesion'],
      ['tolerancia 31', { toleranciaTardanzaMinutos: 31 }, 'toleranciaTardanzaMinutos'],
      ['tolerancia -1', { toleranciaTardanzaMinutos: -1 }, 'toleranciaTardanzaMinutos'],
      ['por vencer 0', { diasPorVencer: 0 }, 'diasPorVencer'],
      ['por vencer 16', { diasPorVencer: 16 }, 'diasPorVencer'],
      ['prioridad 0', { diasPrioridadRenovacion: 0 }, 'diasPrioridadRenovacion'],
      ['prioridad 16', { diasPrioridadRenovacion: 16 }, 'diasPrioridadRenovacion'],
      ['intentos 2', { intentosInicioSesion: 2 }, 'intentosInicioSesion'],
      ['intentos 11', { intentosInicioSesion: 11 }, 'intentosInicioSesion'],
      ['minutos 4', { minutosBloqueo: 4 }, 'minutosBloqueo'],
      ['minutos 61', { minutosBloqueo: 61 }, 'minutosBloqueo'],
      ['teléfono corto', { telefono: '12345' }, 'telefono'],
      ['teléfono con letras', { telefono: '999 abc 777' }, 'telefono'],
      ['teléfono con un número', { telefono: 999888777 }, 'telefono'],
      ['teléfono con dígitos árabes', { telefono: '٩٩٩٨٨٨٧٧٧' }, 'telefono'],
      ['teléfono con un salto de línea en medio', { telefono: '999\n888777' }, 'telefono'],
    ])('%s responde 400 SOLICITUD_INVALIDA sin escribir ni auditar', async (_nombre, cuerpo, campo) => {
      const respuesta = await sinCambios(() => patch(cuerpo));

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
      if (campo) {
        expect(detalleDe(respuesta)?.errores?.map((error) => error.campo)).toContain(campo);
      }
    });

    it('un cuerpo que no es JSON responde 400 SOLICITUD_INVALIDA sin escribir ni auditar', async () => {
      const respuesta = await sinCambios(() =>
        request(app.getHttpServer())
          .patch('/api/configuracion')
          .set('Cookie', admin)
          .set('Content-Type', 'application/json')
          .send('{"minutosBloqueo": 20'),
      );

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
    });

    it('1e400 (infinito al leer el JSON) responde 400 sin escribir', async () => {
      const respuesta = await sinCambios(() =>
        request(app.getHttpServer())
          .patch('/api/configuracion')
          .set('Cookie', admin)
          .set('Content-Type', 'application/json')
          .send('{"minutosBloqueo":1e400}'),
      );

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorCuerpo).codigo).toBe('SOLICITUD_INVALIDA');
    });

    it.each([
      ['toleranciaTardanzaMinutos', 0, 30],
      ['diasPorVencer', 1, 15],
      ['diasPrioridadRenovacion', 1, 15],
      ['intentosInicioSesion', 3, 10],
      ['minutosBloqueo', 5, 60],
    ])('los límites de %s son inclusivos: se aceptan %i y %i', async (campo, minimo, maximo) => {
      for (const valor of [minimo, maximo]) {
        const respuesta = await patch({ [campo]: valor });
        expect(respuesta.status, `${campo}=${valor}: ${JSON.stringify(respuesta.body)}`).toBe(200);
        expect((respuesta.body as { configuracion: Record<string, unknown> }).configuracion[campo]).toBe(valor);
      }
    });
  });

  describe('criterio 9: idempotente', () => {
    it('un PATCH con los valores ya guardados responde 200 sin escribir filas ni auditar', async () => {
      await fijarConfiguracion(e.A.id, { minutosBloqueo: 30, telefono: '999 888 777' });
      const antes = await instantaneaDeConfiguracion(e.A.id);

      const respuesta = await patch({ minutosBloqueo: 30, telefono: '999 888 777' });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, { ...POR_DEFECTO, minutosBloqueo: 30, telefono: '999 888 777' });
      expect(await instantaneaDeConfiguracion(e.A.id)).toBe(antes);
      expect(await auditorias()).toHaveLength(0);
    });

    it('sin filas, un PATCH con los valores por defecto no escribe ni audita', async () => {
      const respuesta = await patch({ toleranciaTardanzaMinutos: 10, minutosBloqueo: 15, telefono: null });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, POR_DEFECTO);
      expect(await leerFilasConfiguracion(e.A.id)).toEqual([]);
      expect(await auditorias()).toHaveLength(0);
    });

    it('dos envíos seguidos del mismo cambio dejan una sola CONFIGURACION_ACTUALIZADA y la fila no se vuelve a escribir', async () => {
      const primero = await patch({ diasPorVencer: 9 });
      const filaTrasElPrimero = JSON.stringify(await leerFilasConfiguracion(e.A.id));
      const segundo = await patch({ diasPorVencer: 9 });

      expect(primero.status).toBe(200);
      expect(segundo.status).toBe(200);
      expect(segundo.body).toEqual(primero.body);
      expect(JSON.stringify(await leerFilasConfiguracion(e.A.id))).toBe(filaTrasElPrimero);
      expect(await auditorias()).toHaveLength(1);
    });

    it('un cambio mixto solo escribe y audita los campos que cambiaron', async () => {
      await fijarConfiguracion(e.A.id, { diasPorVencer: 9 }, new Date('2026-01-01T00:00:00.000Z'));

      await patch({ diasPorVencer: 9, minutosBloqueo: 40 });

      const dias = await leerFilaConfiguracion(e.A.id, 'dias_por_vencer');
      expect(dias?.actualizado_en.toISOString(), 'la fila que no cambió no se reescribe').toBe(
        '2026-01-01T00:00:00.000Z',
      );
      const [registro] = await auditorias();
      expect(registro?.datos_despues).toEqual({ minutosBloqueo: 40 });
      expect(registro?.datos_antes).toEqual({ minutosBloqueo: 15 });
    });

    it('una fila guardada inválida se reescribe aunque el valor pedido sea el de por defecto, y la auditoría muestra el valor por defecto como "antes"', async () => {
      await fijarFilaConfiguracion(e.A.id, 'minutos_bloqueo', 'x');

      const respuesta = await patch({ minutosBloqueo: 15 });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect((await leerFilaConfiguracion(e.A.id, 'minutos_bloqueo'))?.valor).toBe(15);
      const [registro] = await auditorias();
      expect(registro).toMatchObject({ datos_antes: { minutosBloqueo: 15 }, datos_despues: { minutosBloqueo: 15 } });
    });

    it('una fila inválida de otro campo no impide guardar uno válido y responde el valor por defecto en el inválido', async () => {
      await fijarFilaConfiguracion(e.A.id, 'dias_por_vencer', { roto: true });

      const respuesta = await patch({ minutosBloqueo: 25 });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      esperarConfiguracion(respuesta.body, { ...POR_DEFECTO, minutosBloqueo: 25 });
    });
  });

  describe('criterio 10: teléfono', () => {
    it.each([
      ['  999 888 777  ', '999 888 777'],
      ['+51 999 888 777', '+51 999 888 777'],
      ['(01) 555-0199', '(01) 555-0199'],
      ['123456', '123456'],
      ['1'.repeat(20), '1'.repeat(20)],
    ])('guarda %j como %j', async (entrada, esperado) => {
      const respuesta = await patch({ telefono: entrada });

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      expect((respuesta.body as { configuracion: { telefono: string } }).configuracion.telefono).toBe(esperado);
      expect((await leerFilaConfiguracion(e.A.id, 'telefono'))?.valor).toBe(esperado);
      const identidad = await pedir(app, 'get', '/api/mi-academia', { cookie: admin });
      expect((identidad.body as { academia: { telefono: string } }).academia.telefono).toBe(esperado);
    });

    it('el mismo teléfono con espacios en los extremos no cambia nada (se recorta antes de comparar)', async () => {
      await fijarConfiguracion(e.A.id, { telefono: '999 888 777' });

      const respuesta = await patch({ telefono: ' 999 888 777 ' });

      expect(respuesta.status).toBe(200);
      expect(await auditorias()).toHaveLength(0);
    });

    it('sin teléfono guardado, null no escribe nada', async () => {
      const respuesta = await patch({ telefono: null });

      expect(respuesta.status).toBe(200);
      expect(await leerFilasConfiguracion(e.A.id)).toEqual([]);
    });
  });
});
