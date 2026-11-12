// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AcademiasService } from '../../../src/modulos/academias/academias.service';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import {
  crearDatosDeAislamiento,
  leerAcademias,
  leerAuditoriaDeAcademia,
  leerAuditoriaPlataforma,
  type DatosDeAislamiento,
} from '../../utilidades/datos';
import { obtenerAuditoria, type AuditoriaServicePrueba } from '../../utilidades/modulos';
import { obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';

// Criterio 152 (ataque ronda 10, O2; amplia los criterios 29, 31 y 32): `ipParaAuditoria` (P-37), que aplican `insertarEnAuditoriaDeAcademia` e
// `insertarEnAuditoriaPlataforma` (y por ellas `registrarEnAcademia`, `registrarEnPlataforma`, los comandos y la semilla), quita la zona de una
// IPv6 de enlace local (`fe80::1%eth0` guarda `fe80::1`; la columna `inet` no admite zonas) y una IP recibida que no se puede normalizar hace fallar
// la operacion entera: no se guarda NULL en su lugar y no queda nada escrito, ni la operacion ni su auditoria (criterio 30).
// Integracion, con `AcademiasService` y `AuditoriaService` de la app: `crear(datos, superadmin, 'fe80::1%eth0')` crea la academia y su registro de
// `auditoria_plataforma` tiene `host(ip) = 'fe80::1'`; en `conAcademia(A, ...)`, `registrarEnAcademia` con `'::ffff:203.0.113.5'` guarda
// `host(ip) = '::ffff:203.0.113.5'`; y `crear(datos, superadmin, 'no-es-ip')` rechaza y, leido como duenio, no existen la academia ni el registro.
// La parte de los comandos y la semilla (`insertarEnAuditoriaPlataforma` dentro de `enPlataforma`) esta en
// `cli/transaccion-abortada-ronda10.test.ts`. Las unitarias de `ipParaAuditoria` estan en `backend/src/modulos/auditoria/ip.test.ts`.

describe('criterio 152: IP de la auditoria sin zona IPv6; una IP que no se puede guardar hace fallar la operacion', () => {
  let app: NestExpressApplication;
  let academias: AcademiasService;
  let auditoria: AuditoriaServicePrueba;
  let base: BaseDatosRonda3;
  let datos: DatosDeAislamiento;

  beforeAll(async () => {
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    academias = app.get(AcademiasService, { strict: false });
    auditoria = await obtenerAuditoria(app);
    base = await obtenerBaseDatosRonda3(app);
  });
  beforeEach(async () => {
    await limpiarBase();
    datos = await crearDatosDeAislamiento();
  });
  afterAll(async () => {
    await app?.close();
  });

  const actor = () => ({
    id: datos.superadmin.id,
    correo: datos.superadmin.correo,
    nombre: datos.superadmin.nombre,
  });
  const entrada = (accion: string, ip: string | null | undefined) => ({
    actorTipo: 'SISTEMA' as const,
    actorId: null,
    accion,
    entidad: 'prueba',
    entidadId: null,
    ...(ip === undefined ? {} : { ip }),
  });

  describe('AcademiasService.crear (auditoria_plataforma)', () => {
    it('criterio 152: crear(datos, superadmin, "fe80::1%eth0") crea la academia y su registro de auditoria_plataforma tiene host(ip) = fe80::1', async () => {
      const creada = await academias.crear(
        { nombre: 'Delfines', nombreCorto: 'delfines-ip-zona' },
        actor(),
        'fe80::1%eth0',
      );

      expect(creada.nombreCorto).toBe('delfines-ip-zona');
      expect((await leerAcademias()).some((fila) => fila.nombre_corto === 'delfines-ip-zona')).toBe(true);
      const registros = await leerAuditoriaPlataforma('ACADEMIA_CREADA');
      expect(registros.filter((fila) => fila.entidad_id === creada.id).map((fila) => fila.ip)).toEqual(['fe80::1']);
    });

    it('criterio 152: con la zona codificada (fe80::1%25eth0) el registro tiene host(ip) = fe80::1', async () => {
      const creada = await academias.crear(
        { nombre: 'Tiburones', nombreCorto: 'tiburones-ip-zona' },
        actor(),
        'fe80::1%25eth0',
      );

      const registros = await leerAuditoriaPlataforma('ACADEMIA_CREADA');
      expect(registros.filter((fila) => fila.entidad_id === creada.id).map((fila) => fila.ip)).toEqual(['fe80::1']);
    });

    it('criterio 152: crear(datos, superadmin, "no-es-ip") rechaza, y leido como duenio no existen la academia ni el registro', async () => {
      const antes = (await leerAuditoriaPlataforma('ACADEMIA_CREADA')).length;

      const error = await academias
        .crear({ nombre: 'Rayas', nombreCorto: 'rayas-ip-invalida' }, actor(), 'no-es-ip')
        .then(
          () => undefined,
          (motivo: unknown) => motivo,
        );

      expect(error, 'crear debia rechazar con una IP que no se puede normalizar').toBeInstanceOf(Error);
      expect((error as Error).message, 'el error no repite el texto recibido').not.toContain('no-es-ip');
      expect((await leerAcademias()).some((fila) => fila.nombre_corto === 'rayas-ip-invalida')).toBe(false);
      expect(await leerAuditoriaPlataforma('ACADEMIA_CREADA')).toHaveLength(antes);
    });

    it('criterio 152 (control): con una IPv4 se guarda sin cambios y con null se guarda NULL', async () => {
      const v4 = await academias.crear({ nombre: 'Nutrias', nombreCorto: 'nutrias-ip-v4' }, actor(), '203.0.113.5');
      const nula = await academias.crear({ nombre: 'Focas', nombreCorto: 'focas-ip-nula' }, actor(), null);

      const registros = await leerAuditoriaPlataforma('ACADEMIA_CREADA');
      expect(registros.find((fila) => fila.entidad_id === v4.id)?.ip).toBe('203.0.113.5');
      expect(registros.find((fila) => fila.entidad_id === nula.id)?.ip).toBeNull();
    });
  });

  describe('AuditoriaService (auditoria de academia y de plataforma)', () => {
    it('criterio 152: en conAcademia(A), registrarEnAcademia con "::ffff:203.0.113.5" guarda host(ip) = ::ffff:203.0.113.5', async () => {
      await base.conAcademia(datos.A.id, (tx) =>
        auditoria.registrarEnAcademia(tx, entrada('PRUEBA_R10_IP_MAPEADA', '::ffff:203.0.113.5')),
      );

      const filas = await leerAuditoriaDeAcademia(datos.A.id, 'PRUEBA_R10_IP_MAPEADA');
      expect(filas.map((fila) => fila.ip)).toEqual(['::ffff:203.0.113.5']);
    });

    it('criterio 152: en conAcademia(A), registrarEnAcademia con "fe80::1%eth0" guarda host(ip) = fe80::1', async () => {
      await base.conAcademia(datos.A.id, (tx) =>
        auditoria.registrarEnAcademia(tx, entrada('PRUEBA_R10_IP_ZONA_ACADEMIA', 'fe80::1%eth0')),
      );

      const filas = await leerAuditoriaDeAcademia(datos.A.id, 'PRUEBA_R10_IP_ZONA_ACADEMIA');
      expect(filas.map((fila) => fila.ip)).toEqual(['fe80::1']);
    });

    it('criterio 152: comoPlataforma, registrarEnPlataforma con "fe80::1%eth0" guarda host(ip) = fe80::1', async () => {
      await base.comoPlataforma((tx) =>
        auditoria.registrarEnPlataforma(tx, entrada('PRUEBA_R10_IP_ZONA_PLATAFORMA', 'fe80::1%eth0')),
      );

      const filas = await leerAuditoriaPlataforma('PRUEBA_R10_IP_ZONA_PLATAFORMA');
      expect(filas.map((fila) => fila.ip)).toEqual(['fe80::1']);
    });

    it('criterio 152: registrarEnAcademia con una IP invalida hace fallar la operacion entera: no queda ni la fila escrita antes ni el registro', async () => {
      const resultado = await base
        .conAcademia(datos.A.id, async (tx) => {
          await tx.cliente.$executeRaw`INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
            VALUES (${tx.academiaId}::uuid, 'prueba_r10_ip_invalida', '{}'::jsonb, now())`;
          await auditoria.registrarEnAcademia(tx, entrada('PRUEBA_R10_IP_INVALIDA', ' 203.0.113.5'));
          return 'resolvio';
        })
        .then(
          (valor) => ({ valor, error: undefined as unknown }),
          (error: unknown) => ({ valor: undefined, error }),
        );

      expect(resultado.valor, 'debia rechazar con una IP con espacios alrededor').toBeUndefined();
      expect(resultado.error).toBeInstanceOf(Error);
      expect(await leerAuditoriaDeAcademia(datos.A.id, 'PRUEBA_R10_IP_INVALIDA')).toHaveLength(0);
      const filas = await base.conAcademia(
        datos.A.id,
        (tx) =>
          tx.cliente.$queryRaw<
            { n: number }[]
          >`SELECT count(*)::int AS n FROM configuraciones WHERE clave = 'prueba_r10_ip_invalida'`,
      );
      expect(filas[0]?.n).toBe(0);
    });

    it('criterio 152: registrarEnPlataforma con una IP invalida no guarda NULL en su lugar: rechaza y no queda registro', async () => {
      const resultado = await base
        .comoPlataforma((tx) =>
          auditoria.registrarEnPlataforma(tx, entrada('PRUEBA_R10_IP_INVALIDA_PLATAFORMA', '203.0.113.5%eth0')),
        )
        .then(
          () => ({ rechazo: false }),
          () => ({ rechazo: true }),
        );

      expect(resultado.rechazo, 'debia rechazar: una IPv4 con zona no es valida').toBe(true);
      expect(await leerAuditoriaPlataforma('PRUEBA_R10_IP_INVALIDA_PLATAFORMA')).toHaveLength(0);
    });

    it('criterio 152 (control): sin ip (undefined) y con ip null se guarda NULL, y con una IPv4 o ::1 se guarda el mismo texto', async () => {
      await base.conAcademia(datos.A.id, async (tx) => {
        await auditoria.registrarEnAcademia(tx, entrada('PRUEBA_R10_IP_AUSENTE', undefined));
        await auditoria.registrarEnAcademia(tx, entrada('PRUEBA_R10_IP_NULA', null));
        await auditoria.registrarEnAcademia(tx, entrada('PRUEBA_R10_IP_V4', '203.0.113.5'));
        await auditoria.registrarEnAcademia(tx, entrada('PRUEBA_R10_IP_LOCAL', '::1'));
      });

      const ip = async (accion: string) => (await leerAuditoriaDeAcademia(datos.A.id, accion)).map((fila) => fila.ip);
      expect(await ip('PRUEBA_R10_IP_AUSENTE')).toEqual([null]);
      expect(await ip('PRUEBA_R10_IP_NULA')).toEqual([null]);
      expect(await ip('PRUEBA_R10_IP_V4')).toEqual(['203.0.113.5']);
      expect(await ip('PRUEBA_R10_IP_LOCAL')).toEqual(['::1']);
    });
  });
});
