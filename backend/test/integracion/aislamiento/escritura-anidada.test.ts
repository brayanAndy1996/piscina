// spec: 001-academias-aislamiento (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { obtenerAuditoria, uuidInexistente, type AuditoriaServicePrueba } from '../../utilidades/modulos';
import { esperarTransaccionAbortada, resultadoDe } from '../../utilidades/ronda10';
import {
  accionDe,
  claveDe,
  contarAuditoriaDeAcademia,
  contarAuditoriaDePlataforma,
  esperarConexionSana,
  leerAcademiasPorPrefijo,
  leerConfiguraciones,
  leerEstadoDeAcademia,
  leerValorDeConfiguracion,
  nada,
  nombreCortoDe,
  siguienteNumero,
  VALOR,
  type DelegadosRonda12,
} from '../../utilidades/ronda12';
import { obtenerBaseDatosRonda3, type BaseDatosRonda3, type ClienteRonda3 } from '../../utilidades/ronda3';
import { cargarPuntoAutorizado } from '../../utilidades/ronda4';

// Criterio 158 (ataque ronda 12, F2; precisa la quinta vineta del criterio 153 y amplia el 30): dentro de una transaccion interactiva,
// Prisma 7.10.1 no usa `SAVEPOINT` en las operaciones de varias sentencias. Una escritura de un delegado con relaciones anidadas que falla
// con un error que no es de la base (P2025, P2018, P2014) despues de ejecutar parte de sus sentencias dejaba escrito lo ejecutado sin abortar
// la transaccion: si `trabajo` atrapaba el error (lo permite el criterio 153) se confirmaba un cambio a medias sin auditoria. Ahora cada
// escritura de un delegado corre dentro de un punto de guardado propio: si rechaza y la transaccion sigue sana, se deshace todo lo que esa
// operacion escribio y rechaza con su mismo error; si la transaccion quedo abortada (error de la base) rige el criterio 149.
//
// Lo escrito se lee como duenio con una conexion nueva. Casos:
//   1  reproduccion en `comoPlataforma`: `academia.update` con `configuraciones: { update: ... }` sobre una configuracion de A que existe
//      (oculta para la plataforma por la RLS) y sobre una clave que no existe; el P2025 se atrapa (solo si `codigoDeErrorDeBase` es null);
//      despues se crea una academia y su registro: resuelve, A sigue ACTIVA (sin `suspendida_en` ni `motivo_suspension`, con `actualizada_en`
//      sin cambio), la configuracion de A no cambio y la academia nueva y su registro existen;
//   2  lo mismo en `conAcademia(A, ...)`: la forma orientativa del criterio (`configuracion.update` con `academia: { update }`) no falla en
//      PostgreSQL (la actualizacion anidada de `academias` es un no-op silencioso, nota O1), asi que se usa `academia.update` con relaciones
//      anidadas hacia `configuraciones` (crear una fila nueva y actualizar dos: una que existe y otra que no) que, con el codigo de
//      `8a63dbc`, dejaba escritas las dos primeras antes del P2025;
//   3  control, P2025 suelto: un `update` de una fila inexistente atrapado con try/catch sigue confirmando todo lo demas (la app no tiene
//      DELETE sobre ninguna tabla: `delete` y `deleteMany` solo se prueban en la unitaria de la capa y, aqui, como error de la base);
//   4  control, error de la base dentro de una escritura anidada: `academia.create` con `configuraciones: { create }` en `comoPlataforma`
//      (la RLS no deja a la plataforma escribir en `configuraciones`) atrapado, y otra academia: rechaza con `ErrorTransaccionAbortada` y
//      no queda ninguna de las dos academias (la segunda escritura tambien se atrapa: rechaza con 25P02);
//   5  las escrituras que van bien no cambian: `create`, `update`, las otras cinco operaciones que la app puede hacer (`createMany`,
//      `createManyAndReturn`, `updateMany`, `updateManyAndReturn`, `upsert`) y 20 escrituras a la vez. El criterio nombra tambien `delete`,
//      pero la app no tiene el privilegio DELETE (migracion `academias_aislamiento`): su unica prueba de integracion es el control del caso 4.
// Despues de cada caso, con `DATABASE_POOL_MAX=1`, un `conAcademia(B, ...)` en la misma conexion resuelve, lee su contexto y no ve nada.

let app: NestExpressApplication;
let base: BaseDatosRonda3;
let auditoria: AuditoriaServicePrueba;
let datos: DatosDeAislamiento;

const delegadosDe = (cliente: ClienteRonda3): DelegadosRonda12 => cliente as unknown as DelegadosRonda12;

const llaveDe = (academiaId: string, clave: string): { academiaId_clave: { academiaId: string; clave: string } } => ({
  academiaId_clave: { academiaId, clave },
});

beforeAll(async () => {
  app = await crearAppDePruebas({ nivelRegistro: 'silent', variables: { DATABASE_POOL_MAX: '1' } });
  base = await obtenerBaseDatosRonda3(app);
  auditoria = await obtenerAuditoria(app);
});
beforeEach(async () => {
  await limpiarBase();
  datos = await crearDatosDeAislamiento();
});
afterAll(async () => {
  await app?.close();
});

/** Atrapa solo un error que no es de la base (`codigoDeErrorDeBase` es null) y lo devuelve; relanza los demas. */
async function atraparSiNoEsDeLaBase(operacion: () => Promise<unknown>): Promise<unknown> {
  const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
  try {
    await operacion();
  } catch (error) {
    if (codigoDeErrorDeBase(error) !== null) throw error;
    return error;
  }
  return undefined;
}

const registroDe = (n: number) =>
  ({ actorTipo: 'SISTEMA', actorId: null, accion: accionDe(n), entidad: 'prueba', entidadId: null }) as const;

describe('criterio 158, caso 1: reproduccion en comoPlataforma (academia.update con configuraciones anidadas)', () => {
  const VARIANTES = [
    { titulo: 'una configuracion de A que existe (oculta para la plataforma por la RLS)', clave: 'clave_a_1' },
    { titulo: 'una clave de configuracion que no existe', clave: 'clave_inexistente_r12' },
  ];

  for (const { titulo, clave } of VARIANTES) {
    it(`criterio 158 (caso 1): ${titulo}: el P2025 atrapado no deja suspendida a A; resuelve y la academia nueva y su registro existen`, async () => {
      const n = siguienteNumero();
      const antes = await leerEstadoDeAcademia(datos.A.id);
      const valorAntes = await leerValorDeConfiguracion(datos.A.id, 'clave_a_1');
      let atrapado: unknown;

      const resultado = await resultadoDe(() =>
        base.comoPlataforma(async (tx) => {
          const d = delegadosDe(tx.cliente);
          atrapado = await atraparSiNoEsDeLaBase(() =>
            d.academia.update({
              where: { id: datos.A.id },
              data: {
                estado: 'SUSPENDIDA',
                suspendidaEn: new Date('2026-11-12T10:00:00.000Z'),
                motivoSuspension: 'prueba r12',
                configuraciones: {
                  update: { where: llaveDe(datos.A.id, clave), data: { valor: { marca: 'cambiada-r12' } } },
                },
              },
            }),
          );
          await d.academia.create({ data: { nombre: `Academia R12 ${n}`, nombreCorto: nombreCortoDe(n) } });
          await auditoria.registrarEnPlataforma(tx, registroDe(n));
          return VALOR;
        }),
      );

      expect(atrapado, 'la escritura anidada debia rechazar con un error de Prisma que no es de la base').toMatchObject(
        {
          code: 'P2025',
        },
      );
      expect(resultado, 'debia resolver con el valor de trabajo').toEqual({ resolvio: true, valor: VALOR });
      const despues = await leerEstadoDeAcademia(datos.A.id);
      expect(despues?.estado, 'A sigue ACTIVA').toBe('ACTIVA');
      expect(despues?.suspendida_en, 'A no tiene suspendida_en').toBeNull();
      expect(despues?.motivo_suspension, 'A no tiene motivo_suspension').toBeNull();
      expect(despues?.actualizada_en.getTime(), 'actualizada_en sin cambio').toBe(antes?.actualizada_en.getTime());
      expect(await leerValorDeConfiguracion(datos.A.id, 'clave_a_1'), 'la configuracion de A no cambio').toEqual(
        valorAntes,
      );
      expect((await leerAcademiasPorPrefijo(nombreCortoDe(n))).length, 'la academia nueva').toBe(1);
      expect(await contarAuditoriaDePlataforma(accionDe(n)), 'el registro de auditoria').toBe(1);
      await esperarConexionSana(base, datos.B.id, `caso 1, ${titulo}`);
    });
  }
});

describe('criterio 158, caso 2: escritura anidada que falla a medias en conAcademia', () => {
  it('criterio 158 (caso 2): academia.update con configuraciones anidadas (crear, actualizar una existente y actualizar una inexistente) atrapada: no queda nada de esa operacion; resuelve y quedan la escritura siguiente y su registro', async () => {
    const n = siguienteNumero();
    const A = datos.A.id;
    const valorAntes = await leerValorDeConfiguracion(A, 'clave_a_1');
    let atrapado: unknown;

    const resultado = await resultadoDe(() =>
      base.conAcademia(A, async (tx) => {
        const d = delegadosDe(tx.cliente);
        atrapado = await atraparSiNoEsDeLaBase(() =>
          d.academia.update({
            where: { id: A },
            data: {
              configuraciones: {
                create: { clave: claveDe(n, '-anidada'), valor: { marca: 'anidada' } },
                update: [
                  { where: llaveDe(A, 'clave_a_1'), data: { valor: { marca: 'cambiada-r12' } } },
                  { where: llaveDe(A, 'clave_inexistente_r12'), data: { valor: { marca: 'inexistente' } } },
                ],
              },
            },
          }),
        );
        await d.configuracion.create({ data: { academiaId: A, clave: claveDe(n), valor: { marca: 'nueva' } } });
        await auditoria.registrarEnAcademia(tx, registroDe(n));
        return VALOR;
      }),
    );

    expect(atrapado, 'la escritura anidada debia rechazar con un error de Prisma que no es de la base').toMatchObject({
      code: 'P2025',
    });
    expect(resultado, 'debia resolver con el valor de trabajo').toEqual({ resolvio: true, valor: VALOR });
    expect(await leerValorDeConfiguracion(A, 'clave_a_1'), 'la configuracion existente conserva su valor').toEqual(
      valorAntes,
    );
    expect(
      await leerValorDeConfiguracion(A, claveDe(n, '-anidada')),
      'la fila creada por la escritura anidada no queda',
    ).toBeUndefined();
    expect(await leerValorDeConfiguracion(A, claveDe(n)), 'la escritura siguiente queda').toEqual({ marca: 'nueva' });
    expect(await contarAuditoriaDeAcademia(A, accionDe(n)), 'el registro de auditoria').toBe(1);
    await esperarConexionSana(base, datos.B.id, 'caso 2');
  });
});

describe('criterio 158, caso 3 (control): un P2025 suelto atrapado sigue confirmando lo demas', () => {
  it('criterio 158 (caso 3, control): conAcademia, update de una fila inexistente atrapado, una escritura y el registro: resuelve, quedan las dos filas y la que fallo no dejo nada', async () => {
    const n = siguienteNumero();
    const A = datos.A.id;
    const configuracionesAntes = await leerConfiguraciones(A, '');
    let atrapado: unknown;

    const resultado = await resultadoDe(() =>
      base.conAcademia(A, async (tx) => {
        const d = delegadosDe(tx.cliente);
        atrapado = await atraparSiNoEsDeLaBase(() =>
          d.configuracion.update({ where: llaveDe(A, claveDe(n, '-inexistente')), data: { valor: { marca: 'x' } } }),
        );
        await d.configuracion.create({ data: { academiaId: A, clave: claveDe(n), valor: { marca: 'nueva' } } });
        await auditoria.registrarEnAcademia(tx, registroDe(n));
        return VALOR;
      }),
    );

    expect(atrapado, 'el update de una fila inexistente rechaza con P2025').toMatchObject({ code: 'P2025' });
    expect(resultado, 'debia resolver').toEqual({ resolvio: true, valor: VALOR });
    expect(await leerValorDeConfiguracion(A, claveDe(n)), 'la escritura siguiente queda').toEqual({ marca: 'nueva' });
    expect(await leerValorDeConfiguracion(A, claveDe(n, '-inexistente')), 'la que fallo no dejo nada').toBeUndefined();
    expect(await contarAuditoriaDeAcademia(A, accionDe(n)), 'el registro de auditoria').toBe(1);
    expect(
      (await leerConfiguraciones(A, '')).filter((c) => !c.clave.startsWith('prueba_r12_')),
      'las configuraciones previas no cambiaron',
    ).toEqual(configuracionesAntes);
    await esperarConexionSana(base, datos.B.id, 'caso 3, conAcademia');
  });

  it('criterio 158 (caso 3, control): comoPlataforma, update de una academia inexistente atrapado, una academia nueva y el registro: resuelve y no cambio ninguna academia existente', async () => {
    const n = siguienteNumero();
    const antesA = await leerEstadoDeAcademia(datos.A.id);
    const antesB = await leerEstadoDeAcademia(datos.B.id);
    let atrapado: unknown;

    const resultado = await resultadoDe(() =>
      base.comoPlataforma(async (tx) => {
        const d = delegadosDe(tx.cliente);
        atrapado = await atraparSiNoEsDeLaBase(() =>
          d.academia.update({ where: { id: uuidInexistente() }, data: { motivoSuspension: 'prueba r12' } }),
        );
        await d.academia.create({ data: { nombre: `Academia R12 ${n}`, nombreCorto: nombreCortoDe(n) } });
        await auditoria.registrarEnPlataforma(tx, registroDe(n));
        return VALOR;
      }),
    );

    expect(atrapado, 'el update de una academia inexistente rechaza con P2025').toMatchObject({ code: 'P2025' });
    expect(resultado, 'debia resolver').toEqual({ resolvio: true, valor: VALOR });
    expect((await leerAcademiasPorPrefijo(nombreCortoDe(n))).length, 'la academia nueva').toBe(1);
    expect(await contarAuditoriaDePlataforma(accionDe(n)), 'el registro de auditoria').toBe(1);
    expect(await leerEstadoDeAcademia(datos.A.id)).toEqual(antesA);
    expect(await leerEstadoDeAcademia(datos.B.id)).toEqual(antesB);
    await esperarConexionSana(base, datos.B.id, 'caso 3, comoPlataforma');
  });
});

describe('criterio 158, caso 4 (control): un error de la base dentro de una escritura anidada hace rechazar (criterio 149)', () => {
  it('criterio 158 (caso 4, control): comoPlataforma, academia.create con configuraciones anidadas (la RLS lo impide) atrapado y otra academia: rechaza con ErrorTransaccionAbortada y no queda ninguna de las dos', async () => {
    const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
    const n = siguienteNumero();
    let errorDeLaBase: unknown;

    const resultado = await resultadoDe(() =>
      base.comoPlataforma(async (tx) => {
        const d = delegadosDe(tx.cliente);
        try {
          await d.academia.create({
            data: {
              nombre: `Academia R12 ${n} a`,
              nombreCorto: nombreCortoDe(n, '-a'),
              configuraciones: { create: [{ clave: claveDe(n), valor: { marca: 'anidada' } }] },
            },
          });
        } catch (error) {
          errorDeLaBase = error;
        }
        // La transaccion quedo abortada: esta escritura rechaza con 25P02. Tambien se atrapa para que el resultado lo decida el criterio 149.
        await d.academia
          .create({ data: { nombre: `Academia R12 ${n} b`, nombreCorto: nombreCortoDe(n, '-b') } })
          .catch(nada);
        return VALOR;
      }),
    );

    expect(
      codigoDeErrorDeBase(errorDeLaBase),
      'la escritura anidada falla con un error de la base (RLS)',
    ).not.toBeNull();
    await esperarTransaccionAbortada(resultado, 'caso 4');
    expect(await leerAcademiasPorPrefijo(`prueba-r12-${n}-`), 'no queda ninguna de las dos academias').toEqual([]);
    await esperarConexionSana(base, datos.B.id, 'caso 4');
  });

  it('criterio 158 (caso 4, control): conAcademia, delete (la app no tiene DELETE sobre configuraciones) atrapado, una escritura y el registro: rechaza con ErrorTransaccionAbortada y no queda nada', async () => {
    const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
    const n = siguienteNumero();
    const A = datos.A.id;
    let errorDeLaBase: unknown;

    const resultado = await resultadoDe(() =>
      base.conAcademia(A, async (tx) => {
        const d = delegadosDe(tx.cliente);
        try {
          await d.configuracion.delete({ where: llaveDe(A, 'clave_a_1') });
        } catch (error) {
          errorDeLaBase = error;
        }
        await d.configuracion
          .create({ data: { academiaId: A, clave: claveDe(n), valor: { marca: 'nueva' } } })
          .catch(nada);
        await auditoria.registrarEnAcademia(tx, registroDe(n)).catch(nada);
        return VALOR;
      }),
    );

    expect(codigoDeErrorDeBase(errorDeLaBase), 'privilegio denegado: error de la base').toBe('42501');
    await esperarTransaccionAbortada(resultado, 'caso 4, delete');
    expect(await leerValorDeConfiguracion(A, claveDe(n)), 'no queda la escritura siguiente').toBeUndefined();
    expect(await leerValorDeConfiguracion(A, 'clave_a_1'), 'la configuracion no se borro').toEqual({});
    expect(await contarAuditoriaDeAcademia(A, accionDe(n)), 'no hay registro de auditoria').toBe(0);
    await esperarConexionSana(base, datos.B.id, 'caso 4, delete');
  });
});

describe('criterio 158, caso 5: las escrituras que van bien no cambian', () => {
  it('criterio 158 (caso 5): conAcademia, create y update devuelven la fila y dejan las filas como hoy', async () => {
    const n = siguienteNumero();
    const A = datos.A.id;

    const resultado = await resultadoDe(() =>
      base.conAcademia(A, async (tx) => {
        const d = delegadosDe(tx.cliente);
        const creada = await d.configuracion.create({ data: { academiaId: A, clave: claveDe(n), valor: { v: 1 } } });
        const actualizada = await d.configuracion.update({
          where: llaveDe(A, claveDe(n)),
          data: { valor: { v: 2 } },
        });
        const otra = await d.configuracion.create({ data: { academiaId: A, clave: claveDe(n, '-otra'), valor: {} } });
        return { creada, actualizada, otra };
      }),
    );

    expect(resultado.resolvio, 'debia resolver').toBe(true);
    const valor = resultado.valor as Record<'creada' | 'actualizada' | 'otra', object>;
    expect(valor.creada).toMatchObject({ academiaId: A, clave: claveDe(n), valor: { v: 1 } });
    expect(valor.actualizada).toMatchObject({ academiaId: A, clave: claveDe(n), valor: { v: 2 } });
    expect(valor.otra).toMatchObject({ academiaId: A, clave: claveDe(n, '-otra'), valor: {} });
    expect(await leerValorDeConfiguracion(A, claveDe(n)), 'la fila actualizada queda').toEqual({ v: 2 });
    expect(await leerValorDeConfiguracion(A, claveDe(n, '-otra')), 'la fila creada queda').toEqual({});
    await esperarConexionSana(base, datos.B.id, 'caso 5, create/update/delete');
  });

  it('criterio 158 (caso 5): conAcademia, las siete operaciones de escritura de un delegado que la app puede hacer devuelven lo de siempre y dejan sus filas', async () => {
    const n = siguienteNumero();
    const A = datos.A.id;
    const clave = (sufijo: string): string => claveDe(n, sufijo);

    const resultado = await resultadoDe(() =>
      base.conAcademia(A, async (tx) => {
        const d = delegadosDe(tx.cliente).configuracion;
        const create = await d.create({ data: { academiaId: A, clave: clave('-c1'), valor: { v: 1 } } });
        const createMany = await d.createMany({
          data: [
            { academiaId: A, clave: clave('-m1'), valor: { v: 1 } },
            { academiaId: A, clave: clave('-m2'), valor: { v: 1 } },
          ],
        });
        const createManyAndReturn = await d.createManyAndReturn({
          data: [
            { academiaId: A, clave: clave('-r1'), valor: { v: 1 } },
            { academiaId: A, clave: clave('-r2'), valor: { v: 1 } },
          ],
        });
        const update = await d.update({ where: llaveDe(A, clave('-c1')), data: { valor: { v: 2 } } });
        const updateMany = await d.updateMany({
          where: { academiaId: A, clave: { startsWith: clave('-m') } },
          data: { valor: { v: 2 } },
        });
        const updateManyAndReturn = await d.updateManyAndReturn({
          where: { academiaId: A, clave: { startsWith: clave('-r') } },
          data: { valor: { v: 2 } },
        });
        const upsertCrea = await d.upsert({
          where: llaveDe(A, clave('-u1')),
          create: { academiaId: A, clave: clave('-u1'), valor: { v: 1 } },
          update: { valor: { v: 9 } },
        });
        const upsertActualiza = await d.upsert({
          where: llaveDe(A, clave('-u1')),
          create: { academiaId: A, clave: clave('-u1'), valor: { v: 1 } },
          update: { valor: { v: 2 } },
        });
        return {
          create,
          createMany,
          createManyAndReturn,
          update,
          updateMany,
          updateManyAndReturn,
          upsertCrea,
          upsertActualiza,
        };
      }),
    );

    expect(resultado.resolvio, 'debia resolver').toBe(true);
    const v = resultado.valor as Record<string, unknown>;
    expect(v['create']).toMatchObject({ clave: clave('-c1'), valor: { v: 1 } });
    expect(v['createMany']).toEqual({ count: 2 });
    expect((v['createManyAndReturn'] as { clave: string }[]).map((f) => f.clave).sort()).toEqual([
      clave('-r1'),
      clave('-r2'),
    ]);
    expect(v['update']).toMatchObject({ clave: clave('-c1'), valor: { v: 2 } });
    expect(v['updateMany']).toEqual({ count: 2 });
    expect((v['updateManyAndReturn'] as { valor: unknown }[]).map((f) => f.valor)).toEqual([{ v: 2 }, { v: 2 }]);
    expect(v['upsertCrea']).toMatchObject({ clave: clave('-u1'), valor: { v: 1 } });
    expect(v['upsertActualiza']).toMatchObject({ clave: clave('-u1'), valor: { v: 2 } });
    const filas = await leerConfiguraciones(A, claveDe(n));
    expect(
      filas.map((f) => [f.clave, f.valor]),
      'quedan todas las filas escritas, con su ultimo valor',
    ).toEqual([
      [clave('-c1'), { v: 2 }],
      [clave('-m1'), { v: 2 }],
      [clave('-m2'), { v: 2 }],
      [clave('-r1'), { v: 2 }],
      [clave('-r2'), { v: 2 }],
      [clave('-u1'), { v: 2 }],
    ]);
    await esperarConexionSana(base, datos.B.id, 'caso 5, nueve operaciones');
  });

  it('criterio 158 (caso 5): conAcademia, 20 escrituras lanzadas a la vez con Promise.all quedan todas, cada una con su resultado', async () => {
    const n = siguienteNumero();
    const A = datos.A.id;

    const resultado = await resultadoDe(() =>
      base.conAcademia(A, (tx) => {
        const d = delegadosDe(tx.cliente).configuracion;
        return Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            d.create({ data: { academiaId: A, clave: claveDe(n, `-${i}`), valor: { indice: i } } }),
          ),
        );
      }),
    );

    expect(resultado.resolvio, 'debia resolver').toBe(true);
    const filas = resultado.valor as { clave: string; valor: unknown }[];
    expect(filas).toHaveLength(20);
    filas.forEach((fila, i) => {
      expect(fila, `resultado de la escritura ${i}`).toMatchObject({
        clave: claveDe(n, `-${i}`),
        valor: { indice: i },
      });
    });
    const guardadas = await leerConfiguraciones(A, `${claveDe(n)}_`);
    expect(guardadas).toHaveLength(20);
    expect(new Set(guardadas.map((f) => f.clave)).size).toBe(20);
    await esperarConexionSana(base, datos.B.id, 'caso 5, 20 a la vez');
  });
});
