// spec: 004-planes-clases-aforo (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '../../../src/generated/prisma/client';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  abrirRetenedor,
  type ClaseBloqueada,
  type ClaseDePrueba,
  cargarModuloClases,
  conLimite,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  esperarEspera,
  exigirTablasDePlanesYClases,
  type ModuloClases,
  observar,
} from '../../utilidades/planes-clases';
import {
  type BaseDatosPrueba,
  type ClientePrueba,
  obtenerBaseDatos,
  type TransaccionAcademiaPrueba,
  uuidInexistente,
} from '../../utilidades/modulos';
import { crearEscenario, type Escenario, type UsuarioDePrueba } from '../../utilidades/usuarios';

// Criterio 23 (crítico, RN-11; base de 005, 010, 018 y 020): `bloquearClasesParaCupo(tx, claseIds)` (sin Nest, en el módulo de clases,
// como `leerConfiguracion`) bloquea con UNA sola sentencia `... WHERE academia_id = tx.academiaId AND id = ANY(...) ORDER BY id FOR
// UPDATE` las clases pedidas y devuelve, por cada una que existe en la academia de la transacción, id, nivel, diaSemana, horaInicio,
// horaFin, aforo, activo y entrenadorId. Los ids de otra academia, los que no existen y los repetidos no devuelven nada de más ni
// fallan; con una lista vacía no ejecuta ninguna sentencia. Con clases de A y de B, en conAcademia(A) devuelve solo las de A; dos
// transacciones que piden [c1, c2] y [c2, c1] a la vez terminan las dos, sin 40P01.
// Las pruebas de espera son deterministas: la prueba retiene una fila con su propia transacción y mira `pg_blocking_pids`.

/** Texto de lo que se le pasa a `$queryRaw` o `$executeRaw`: una plantilla etiquetada o un `Prisma.sql`. */
function textoDe(consulta: unknown): string {
  if (Array.isArray(consulta)) return (consulta as string[]).join(' ');
  if (consulta !== null && typeof consulta === 'object' && 'sql' in consulta) return String(consulta.sql);
  return '';
}

/** La misma transacción, pero anotando cada sentencia que se envía a la base. */
function contando(tx: TransaccionAcademiaPrueba): { tx: TransaccionAcademiaPrueba; sentencias: string[] } {
  const sentencias: string[] = [];
  const cliente: ClientePrueba = {
    $queryRaw<T = unknown>(consulta: TemplateStringsArray | Prisma.Sql, ...valores: unknown[]): Promise<T> {
      sentencias.push(textoDe(consulta));
      return tx.cliente.$queryRaw<T>(consulta, ...valores);
    },
    $executeRaw(consulta: TemplateStringsArray | Prisma.Sql, ...valores: unknown[]): Promise<number> {
      sentencias.push(textoDe(consulta));
      return tx.cliente.$executeRaw(consulta, ...valores);
    },
  };
  return { tx: { academiaId: tx.academiaId, cliente }, sentencias };
}

/** Sesiones cuya cadena de bloqueos llega al `pid` indicado. */
async function sesionesEsperandoA(pid: number): Promise<number> {
  const { rows } = await ejecutarComo(
    'propietario',
    `WITH RECURSIVE cadena(pid) AS (
       SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
       UNION
       SELECT a.pid FROM pg_stat_activity a JOIN cadena c ON c.pid = ANY(pg_blocking_pids(a.pid))
     )
     SELECT count(*)::int AS n FROM cadena`,
    [pid],
  );
  return (rows[0] as { n: number }).n;
}

describe('criterio 23: bloquearClasesParaCupo', () => {
  let app: NestExpressApplication;
  let baseDatos: BaseDatosPrueba;
  let cupo: ModuloClases;
  let e: Escenario;
  let entrenadorB: UsuarioDePrueba;
  let clasesA: ClaseDePrueba[];
  let clasesB: ClaseDePrueba[];

  beforeAll(async () => {
    await exigirTablasDePlanesYClases();
    app = await crearAppDePruebas({ nivelRegistro: 'silent' });
    baseDatos = await obtenerBaseDatos(app);
  });
  beforeEach(async () => {
    cupo = await cargarModuloClases();
    e = await crearEscenario();
    entrenadorB = await crearEntrenadorDePrueba(e.B.id);
    const otroA = await crearEntrenadorDePrueba(e.A.id);
    clasesA = [
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, {
        nivel: 'BASICO',
        dia_semana: 1,
        hora_inicio: '08:00',
        aforo: 30,
      }),
      await crearClaseDePrueba(e.A.id, e.entrenadorA.id, {
        nivel: 'INTERMEDIO',
        dia_semana: 2,
        hora_inicio: '19:00',
        aforo: 20,
      }),
      await crearClaseDePrueba(e.A.id, otroA.id, {
        nivel: 'AVANZADO',
        dia_semana: 7,
        hora_inicio: '12:00',
        aforo: 50,
        activo: false,
      }),
    ];
    clasesB = [
      await crearClaseDePrueba(e.B.id, entrenadorB.id, {
        nivel: 'BASICO',
        dia_semana: 1,
        hora_inicio: '08:00',
        aforo: 41,
      }),
      await crearClaseDePrueba(e.B.id, entrenadorB.id, {
        nivel: 'BASICO',
        dia_semana: 2,
        hora_inicio: '09:00',
        aforo: 42,
      }),
    ];
  });
  afterAll(async () => {
    await app?.close();
  });

  const ids = (clases: readonly { id: string }[]) => clases.map((clase) => clase.id);
  const bloquear = (academiaId: string, claseIds: readonly string[]) =>
    baseDatos.conAcademia(academiaId, (tx) => cupo.bloquearClasesParaCupo(tx, claseIds));
  const porId = (filas: readonly ClaseBloqueada[]) => [...filas].sort((a, b) => a.id.localeCompare(b.id));

  /** Lo que se espera de una clase de A: los nombres y formatos del contrato (horas `HH:MM`, aforo y día como números). */
  const esperada = (clase: ClaseDePrueba, horaFin: string): ClaseBloqueada => ({
    id: clase.id,
    nivel: clase.nivel as ClaseBloqueada['nivel'],
    diaSemana: clase.dia_semana,
    horaInicio: clase.hora_inicio,
    horaFin,
    aforo: clase.aforo,
    activo: clase.activo,
    entrenadorId: clase.entrenador_id,
  });

  /** Una hora `HH:MM` (o `HH:MM:SS` con ceros, si la implementación no recorta) se compara por sus primeros cinco caracteres. */
  const conHorasRecortadas = (filas: readonly ClaseBloqueada[]) =>
    filas.map((fila) => ({ ...fila, horaInicio: fila.horaInicio.slice(0, 5), horaFin: fila.horaFin.slice(0, 5) }));

  describe('qué devuelve', () => {
    it('criterio 23: en conAcademia(A) devuelve, por cada clase pedida de A, id, nivel, diaSemana, horaInicio, horaFin, aforo, activo y entrenadorId', async () => {
      const filas = await bloquear(e.A.id, ids(clasesA));

      expect(conHorasRecortadas(porId(filas))).toEqual(
        porId([
          esperada(clasesA[0] as ClaseDePrueba, '09:00'),
          esperada(clasesA[1] as ClaseDePrueba, '20:00'),
          esperada(clasesA[2] as ClaseDePrueba, '13:00'),
        ]),
      );
      for (const fila of filas) {
        expect(typeof fila.aforo).toBe('number');
        expect(typeof fila.diaSemana).toBe('number');
        expect(typeof fila.activo).toBe('boolean');
        expect(Object.keys(fila).sort()).toEqual(
          ['activo', 'aforo', 'diaSemana', 'entrenadorId', 'horaFin', 'horaInicio', 'id', 'nivel'].sort(),
        );
      }
    });

    it('criterio 23: las horas son horas locales de Lima sin zona, en el formato HH:MM, y la clase de las 19:00 termina a las 20:00', async () => {
      const [ultima] = await bloquear(e.A.id, [(clasesA[1] as ClaseDePrueba).id]);

      expect(ultima?.horaInicio.slice(0, 5)).toBe('19:00');
      expect(ultima?.horaFin.slice(0, 5)).toBe('20:00');
    });

    it('criterio 23: pedir un subconjunto devuelve solo esas clases (las demás de la academia no entran)', async () => {
      const filas = await bloquear(e.A.id, [(clasesA[1] as ClaseDePrueba).id]);

      expect(filas.map((fila) => fila.id)).toEqual([(clasesA[1] as ClaseDePrueba).id]);
    });

    it('criterio 23: en conAcademia(B) devuelve solo las de B y los ids de A no devuelven nada', async () => {
      const deB = await bloquear(e.B.id, [...ids(clasesB), ...ids(clasesA)]);

      expect(porId(deB).map((fila) => fila.id)).toEqual([...ids(clasesB)].sort());
      expect(deB.every((fila) => fila.entrenadorId === entrenadorB.id)).toBe(true);
    });

    it('criterio 23: en conAcademia(A), con ids de A y de B mezclados, devuelve solo las de A', async () => {
      const filas = await bloquear(e.A.id, [...ids(clasesB), ...ids(clasesA)]);

      expect(porId(filas).map((fila) => fila.id)).toEqual([...ids(clasesA)].sort());
    });

    it('criterio 23: solo ids de otra academia, ids que no existen o una mezcla de ambos devuelven una lista vacía sin fallar', async () => {
      expect(await bloquear(e.A.id, ids(clasesB))).toEqual([]);
      expect(await bloquear(e.A.id, [uuidInexistente(), uuidInexistente()])).toEqual([]);
      expect(await bloquear(e.A.id, [...ids(clasesB), uuidInexistente()])).toEqual([]);
    });

    it('criterio 23: los ids que no existen, junto a los que sí, no devuelven nada de más ni fallan', async () => {
      const filas = await bloquear(e.A.id, [uuidInexistente(), (clasesA[0] as ClaseDePrueba).id, uuidInexistente()]);

      expect(filas.map((fila) => fila.id)).toEqual([(clasesA[0] as ClaseDePrueba).id]);
    });

    it('criterio 23: los ids repetidos no devuelven una clase dos veces ni fallan', async () => {
      const a = (clasesA[0] as ClaseDePrueba).id;
      const b = (clasesA[1] as ClaseDePrueba).id;

      const filas = await bloquear(e.A.id, [a, a, b, a, b]);

      expect(porId(filas).map((fila) => fila.id)).toEqual([a, b].sort());
    });

    it('criterio 23: una clase inactiva también se devuelve, con activo false (quien llama decide qué hacer con ella)', async () => {
      const [fila] = await bloquear(e.A.id, [(clasesA[2] as ClaseDePrueba).id]);

      expect(fila?.activo).toBe(false);
      expect(fila?.aforo).toBe(50);
    });

    it('criterio 23: con la clase de A cambiada por otra transacción ya confirmada, lee el valor de ahora (sin caché)', async () => {
      const id = (clasesA[0] as ClaseDePrueba).id;
      expect((await bloquear(e.A.id, [id]))[0]?.aforo).toBe(30);
      await ejecutarComo(
        'propietario',
        'UPDATE clases SET aforo = 44 WHERE academia_id = $1::uuid AND id = $2::uuid',
        [e.A.id, id],
        {
          academiaId: e.A.id,
        },
      );

      expect((await bloquear(e.A.id, [id]))[0]?.aforo).toBe(44);
    });
  });

  describe('cuántas sentencias ejecuta', () => {
    it('criterio 23: con una lista vacía no ejecuta ninguna sentencia y devuelve []', async () => {
      const { filas, sentencias } = await baseDatos.conAcademia(e.A.id, async (tx) => {
        const contada = contando(tx);
        return { filas: await cupo.bloquearClasesParaCupo(contada.tx, []), sentencias: contada.sentencias };
      });

      expect(filas).toEqual([]);
      expect(sentencias).toEqual([]);
    });

    it('criterio 23: con varias clases (de A, de B y que no existen) ejecuta una sola sentencia', async () => {
      const { sentencias } = await baseDatos.conAcademia(e.A.id, async (tx) => {
        const contada = contando(tx);
        await cupo.bloquearClasesParaCupo(contada.tx, [...ids(clasesA), ...ids(clasesB), uuidInexistente()]);
        return { sentencias: contada.sentencias };
      });

      // El orden de bloqueo (ORDER BY id) y el FOR UPDATE se comprueban por lo que hacen en la base, en "qué bloquea".
      expect(sentencias, 'una sola sentencia para todas las clases').toHaveLength(1);
    });

    it('criterio 23: con una sola clase también ejecuta una sola sentencia', async () => {
      const { sentencias } = await baseDatos.conAcademia(e.A.id, async (tx) => {
        const contada = contando(tx);
        await cupo.bloquearClasesParaCupo(contada.tx, [(clasesA[0] as ClaseDePrueba).id]);
        return { sentencias: contada.sentencias };
      });

      expect(sentencias).toHaveLength(1);
    });
  });

  describe('qué bloquea', () => {
    /** ¿Otra transacción puede bloquear ya la fila de la clase? (`FOR UPDATE NOWAIT` falla con 55P03 si alguien la retiene). */
    async function estaBloqueada(academiaId: string, claseId: string): Promise<boolean> {
      try {
        await ejecutarComo(
          'propietario',
          'SELECT id FROM clases WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE NOWAIT',
          [academiaId, claseId],
          { academiaId },
        );
        return false;
      } catch (error) {
        if ((error as { code?: string }).code === '55P03') return true;
        throw error;
      }
    }

    it('criterio 23: mientras la transacción sigue abierta, las clases pedidas de A están bloqueadas y las demás (de A y de B) no; al confirmar se liberan', async () => {
      const pedidas = [(clasesA[0] as ClaseDePrueba).id, (clasesA[1] as ClaseDePrueba).id];
      let durante: Record<string, boolean> = {};

      await baseDatos.conAcademia(e.A.id, async (tx) => {
        await cupo.bloquearClasesParaCupo(tx, [...pedidas, ...ids(clasesB)]);
        durante = {
          a0: await estaBloqueada(e.A.id, (clasesA[0] as ClaseDePrueba).id),
          a1: await estaBloqueada(e.A.id, (clasesA[1] as ClaseDePrueba).id),
          a2: await estaBloqueada(e.A.id, (clasesA[2] as ClaseDePrueba).id),
          b0: await estaBloqueada(e.B.id, (clasesB[0] as ClaseDePrueba).id),
          b1: await estaBloqueada(e.B.id, (clasesB[1] as ClaseDePrueba).id),
        };
      });

      expect(durante).toEqual({ a0: true, a1: true, a2: false, b0: false, b1: false });
      expect(await estaBloqueada(e.A.id, (clasesA[0] as ClaseDePrueba).id), 'tras confirmar ya no está bloqueada').toBe(
        false,
      );
    });

    it('criterio 23: bloquea en orden de id (ORDER BY id): con otra transacción reteniendo la clase del medio, la de menor id queda bloqueada y la de mayor id no', async () => {
      // Tres clases de A ordenadas por id: menor < medio < mayor. La prueba retiene la del medio; quien pide [mayor, menor, medio] (en ese
      // orden) bloquea primero la menor, espera a la del medio y todavía no ha tocado la mayor. Con otro orden de bloqueo (el de la lista
      // pedida, o uno por sentencias separadas) la mayor quedaría bloqueada primero.
      const [menor, medio, mayor] = ids(clasesA).sort();
      const retenedor = await abrirRetenedor(e.A.id);
      let pedido: { terminada: () => boolean; resultado: Promise<ClaseBloqueada[]> } | undefined;
      try {
        await retenedor.consultar('SELECT id FROM clases WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
          e.A.id,
          medio,
        ]);
        pedido = observar(bloquear(e.A.id, [mayor as string, menor as string, medio as string]));

        const espero = await esperarEspera(
          async () => (await retenedor.sesionesEsperando()) >= 1,
          [pedido],
          'la petición ni terminó ni quedó esperando la clase del medio.',
        );
        expect(espero, 'la petición debía quedar esperando la clase que retiene la prueba').toBe(true);
        const libres = await ejecutarComo(
          'propietario',
          'SELECT id FROM clases WHERE academia_id = $1::uuid AND id = ANY($2::uuid[]) FOR UPDATE SKIP LOCKED',
          [e.A.id, [menor, medio, mayor]],
          { academiaId: e.A.id },
        );
        expect(
          (libres.rows as { id: string }[]).map((fila) => fila.id),
          'solo la de mayor id está libre: la de menor id ya la tiene quien espera y la del medio, la prueba',
        ).toEqual([mayor]);
      } finally {
        await retenedor.liberar('ROLLBACK');
      }
      const filas = await conLimite(
        pedido?.resultado ?? Promise.resolve([]),
        'la petición no terminó tras liberar la clase',
      );
      expect(porId(filas).map((fila) => fila.id)).toEqual([menor, medio, mayor]);
    });
  });

  describe('dos transacciones con ids en orden cruzado', () => {
    it('criterio 23: [c1, c2] y [c2, c1] a la vez terminan las dos, sin 40P01; la segunda espera a la primera y al confirmar la primera obtiene las dos', async () => {
      const [c1, c2] = ids(clasesA);
      let soltar: () => void = () => undefined;
      const compuerta = new Promise<void>((resolver) => {
        soltar = resolver;
      });
      let pidDeLaPrimera = 0;
      let primeraBloqueo!: () => void;
      const primeraYaBloqueo = new Promise<void>((resolver) => {
        primeraBloqueo = resolver;
      });

      const primera = observar(
        baseDatos.conAcademia(e.A.id, async (tx) => {
          const filas = await cupo.bloquearClasesParaCupo(tx, [c1 as string, c2 as string]);
          const [fila] = await tx.cliente.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          pidDeLaPrimera = fila?.pid ?? 0;
          primeraBloqueo();
          await compuerta; // la primera sigue con las dos clases bloqueadas hasta que la prueba lo permita
          return filas;
        }),
      );
      try {
        await conLimite(primeraYaBloqueo, 'la primera transacción no llegó a bloquear las clases');
        const segunda = observar(
          baseDatos.conAcademia(e.A.id, (tx) => cupo.bloquearClasesParaCupo(tx, [c2 as string, c1 as string])),
        );

        const espero = await esperarEspera(
          async () => (await sesionesEsperandoA(pidDeLaPrimera)) >= 1,
          [segunda],
          'la segunda transacción ni terminó ni quedó esperando a la primera.',
        );
        expect(espero, 'la segunda debía esperar a la primera (las dos piden las mismas clases)').toBe(true);
        soltar();

        const [deLaPrimera, deLaSegunda] = await conLimite(
          Promise.all([primera.resultado, segunda.resultado]),
          'las dos transacciones debían terminar (sin interbloqueo)',
        );
        expect(porId(deLaPrimera).map((fila) => fila.id)).toEqual([c1, c2].sort());
        expect(porId(deLaSegunda).map((fila) => fila.id)).toEqual([c1, c2].sort());
      } finally {
        soltar();
        await primera.resultado.catch(() => undefined);
      }
    });

    it('criterio 23: varias rondas de transacciones simultáneas con tres clases pedidas en órdenes distintos terminan todas, sin 40P01', async () => {
      const entrenador = await crearEntrenadorDePrueba(e.A.id);
      const tres = [
        await crearClaseDePrueba(e.A.id, entrenador.id, { nivel: 'BASICO', dia_semana: 3, hora_inicio: '10:00' }),
        await crearClaseDePrueba(e.A.id, entrenador.id, { nivel: 'INTERMEDIO', dia_semana: 3, hora_inicio: '11:00' }),
        await crearClaseDePrueba(e.A.id, entrenador.id, { nivel: 'AVANZADO', dia_semana: 3, hora_inicio: '12:00' }),
      ];
      const [x, y, z] = ids(tres) as [string, string, string];
      const ordenes = [
        [x, y, z],
        [z, y, x],
        [y, z, x],
        [x, z, y],
      ];

      for (let ronda = 0; ronda < 6; ronda++) {
        const resultados = await conLimite(
          Promise.all(ordenes.map((orden) => bloquear(e.A.id, orden))),
          `la ronda ${ronda} no terminó`,
        );

        for (const filas of resultados) {
          expect(
            porId(filas).map((fila) => fila.id),
            `ronda ${ronda}`,
          ).toEqual([x, y, z].sort());
        }
      }
    });
  });
});
