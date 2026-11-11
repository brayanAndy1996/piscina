// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RELOJ, RelojFijo } from '../../../src/infraestructura/reloj';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { crearAcademiaDePrueba, type AcademiaDePrueba } from '../../utilidades/academias';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { contarDeAcademia, leerAuditoriaDeAcademia, leerAuditoriaPlataforma } from '../../utilidades/datos';
import {
  type AuditoriaServicePrueba,
  type BaseDatosPrueba,
  obtenerAuditoria,
  obtenerBaseDatos,
} from '../../utilidades/modulos';

const AHORA = new Date('2026-11-11T15:30:45.123Z');

describe('AuditoriaService', () => {
  let app: NestExpressApplication;
  let baseDatos: BaseDatosPrueba;
  let auditoria: AuditoriaServicePrueba;
  let A: AcademiaDePrueba;
  let B: AcademiaDePrueba;

  beforeAll(async () => {
    const reloj = new RelojFijo(AHORA);
    app = await crearAppDePruebas({ ajustar: (constructor) => constructor.overrideProvider(RELOJ).useValue(reloj) });
    baseDatos = await obtenerBaseDatos(app);
    auditoria = await obtenerAuditoria(app);
  });
  beforeEach(async () => {
    await limpiarBase();
    A = await crearAcademiaDePrueba();
    B = await crearAcademiaDePrueba();
  });
  afterAll(async () => {
    await app.close();
  });

  describe('criterio 29: registrarEnAcademia', () => {
    it('criterio 29: inserta en auditoria con academia_id de tx, fecha_hora de RELOJ y los campos de la entrada', async () => {
      const actorId = randomUUID();
      const entidadId = randomUUID();

      await baseDatos.conAcademia(A.id, (tx) =>
        auditoria.registrarEnAcademia(tx, {
          actorTipo: 'USUARIO',
          actorId,
          accion: 'PAGO_VERIFICADO',
          entidad: 'pago',
          entidadId,
          datosAntes: { estado: 'PENDIENTE', monto: '100.00' },
          datosDespues: { estado: 'CONFIRMADO', monto: '100.00' },
          motivo: 'Comprobante revisado',
          ip: '203.0.113.7',
        }),
      );

      const filas = await leerAuditoriaDeAcademia(A.id);
      expect(filas).toHaveLength(1);
      const fila = filas[0]!;
      expect(fila.fecha_hora.toISOString()).toBe(AHORA.toISOString());
      expect(fila).toMatchObject({
        actor_tipo: 'USUARIO',
        actor_id: actorId,
        accion: 'PAGO_VERIFICADO',
        entidad: 'pago',
        entidad_id: entidadId,
        datos_antes: { estado: 'PENDIENTE', monto: '100.00' },
        datos_despues: { estado: 'CONFIRMADO', monto: '100.00' },
        motivo: 'Comprobante revisado',
        ip: '203.0.113.7',
      });
      const { rows } = await ejecutarComo('propietario', 'SELECT academia_id FROM auditoria', [], {
        academiaId: A.id,
      });
      expect(rows).toEqual([{ academia_id: A.id }]);
    });

    it('criterio 29: los campos opcionales ausentes quedan en NULL', async () => {
      await baseDatos.conAcademia(A.id, (tx) =>
        auditoria.registrarEnAcademia(tx, {
          actorTipo: 'SISTEMA',
          actorId: null,
          accion: 'TAREA_EJECUTADA',
          entidad: 'tarea',
          entidadId: null,
        }),
      );

      const [fila] = await leerAuditoriaDeAcademia(A.id);
      expect(fila).toMatchObject({
        actor_tipo: 'SISTEMA',
        actor_id: null,
        entidad_id: null,
        datos_antes: null,
        datos_despues: null,
        motivo: null,
        ip: null,
      });
    });

    it('criterio 29: la entrada no tiene campo de academia: aunque se pase uno, se audita en la academia de la transacción', async () => {
      const entradaConIntruso = {
        actorTipo: 'SISTEMA' as const,
        actorId: null,
        accion: 'INTENTO_EN_OTRA',
        entidad: 'prueba',
        entidadId: null,
        academiaId: B.id,
        academia_id: B.id,
      };

      await baseDatos.conAcademia(A.id, (tx) => auditoria.registrarEnAcademia(tx, entradaConIntruso));

      expect(await leerAuditoriaDeAcademia(A.id, 'INTENTO_EN_OTRA')).toHaveLength(1);
      expect(await leerAuditoriaDeAcademia(B.id, 'INTENTO_EN_OTRA')).toHaveLength(0);
    });

    it('criterio 29: una transacción falsificada con la academia de B dentro de la de A falla (RLS) y no deja nada', async () => {
      await expect(
        baseDatos.conAcademia(A.id, (tx) =>
          auditoria.registrarEnAcademia(
            { academiaId: B.id, cliente: tx.cliente },
            { actorTipo: 'SISTEMA', actorId: null, accion: 'FALSIFICADA', entidad: 'prueba', entidadId: null },
          ),
        ),
      ).rejects.toBeInstanceOf(Error);

      expect(await leerAuditoriaDeAcademia(A.id, 'FALSIFICADA')).toHaveLength(0);
      expect(await leerAuditoriaDeAcademia(B.id, 'FALSIFICADA')).toHaveLength(0);
    });
  });

  describe('criterio 30: la auditoría vive y muere con la transacción', () => {
    it('criterio 30: si la transacción se revierte, el registro de auditoría tampoco queda', async () => {
      await expect(
        baseDatos.conAcademia(A.id, async (tx) => {
          await auditoria.registrarEnAcademia(tx, {
            actorTipo: 'SISTEMA',
            actorId: null,
            accion: 'SE_REVIERTE',
            entidad: 'prueba',
            entidadId: null,
          });
          throw new Error('falla después de auditar');
        }),
      ).rejects.toThrow('falla después de auditar');

      expect(await leerAuditoriaDeAcademia(A.id, 'SE_REVIERTE')).toHaveLength(0);
    });

    it('criterio 30: si la inserción de auditoría falla, la operación completa falla y se revierte', async () => {
      await expect(
        baseDatos.conAcademia(A.id, async (tx) => {
          await tx.cliente.$executeRawUnsafe(
            `INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en) VALUES ($1::uuid, 'operacion', '{}'::jsonb, now())`,
            A.id,
          );
          await auditoria.registrarEnAcademia(tx, {
            actorTipo: 'NO_EXISTE' as 'SISTEMA',
            actorId: null,
            accion: 'AUDITORIA_QUE_FALLA',
            entidad: 'prueba',
            entidadId: null,
          });
        }),
      ).rejects.toBeInstanceOf(Error);

      expect(await contarDeAcademia('configuraciones', A.id)).toBe(0);
      expect(await contarDeAcademia('auditoria', A.id)).toBe(0);
    });

    it('criterio 30: lo mismo en la plataforma: un error después de auditar revierte el registro', async () => {
      await expect(
        baseDatos.comoPlataforma(async (tx) => {
          await auditoria.registrarEnPlataforma(tx, {
            actorTipo: 'SISTEMA',
            actorId: null,
            accion: 'PLATAFORMA_SE_REVIERTE',
            entidad: 'prueba',
            entidadId: null,
          });
          throw new Error('falla después de auditar');
        }),
      ).rejects.toThrow('falla después de auditar');

      expect(await leerAuditoriaPlataforma('PLATAFORMA_SE_REVIERTE')).toHaveLength(0);
    });
  });

  describe('criterio 31: registrarEnPlataforma', () => {
    it('criterio 31: inserta en auditoria_plataforma con fecha_hora de RELOJ y los campos de la entrada', async () => {
      const actorId = randomUUID();

      await baseDatos.comoPlataforma((tx) =>
        auditoria.registrarEnPlataforma(tx, {
          actorTipo: 'SUPERADMIN',
          actorId,
          accion: 'ACADEMIA_SUSPENDIDA',
          entidad: 'academia',
          entidadId: A.id,
          datosAntes: { estado: 'ACTIVA' },
          datosDespues: { estado: 'SUSPENDIDA' },
          motivo: 'Falta de pago',
          ip: '198.51.100.9',
        }),
      );

      const filas = await leerAuditoriaPlataforma('ACADEMIA_SUSPENDIDA');
      expect(filas).toHaveLength(1);
      const fila = filas[0]!;
      expect(fila.fecha_hora.toISOString()).toBe(AHORA.toISOString());
      expect(fila).toMatchObject({
        actor_tipo: 'SUPERADMIN',
        actor_id: actorId,
        entidad: 'academia',
        entidad_id: A.id,
        datos_antes: { estado: 'ACTIVA' },
        datos_despues: { estado: 'SUSPENDIDA' },
        motivo: 'Falta de pago',
        ip: '198.51.100.9',
      });
    });

    it('criterio 31: no escribe en la auditoría de ninguna academia', async () => {
      await baseDatos.comoPlataforma((tx) =>
        auditoria.registrarEnPlataforma(tx, {
          actorTipo: 'SISTEMA',
          actorId: null,
          accion: 'SOLO_PLATAFORMA',
          entidad: 'prueba',
          entidadId: null,
        }),
      );

      expect(await contarDeAcademia('auditoria', A.id)).toBe(0);
      expect(await contarDeAcademia('auditoria', B.id)).toBe(0);
    });
  });
});
