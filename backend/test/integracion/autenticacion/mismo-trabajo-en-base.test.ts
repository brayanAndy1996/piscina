// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComo, tablasDelNegocio } from '../../utilidades/base-datos';
import {
  actualizarUsuario,
  cookieDeAcademia,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  dniInventado,
  type Escenario,
  leerUsuario,
  pedir,
} from '../../utilidades/usuarios';

// Criterio 53 (ataque ronda 1, F1): con una clave equivocada, el trabajo que la API hace en la base de datos es el mismo si el DNI
// es de un usuario ACTIVO de la academia, de un INACTIVO, de nadie o de otra academia. La prueba no mide tiempos: observa las
// sentencias SQL que llegan al controlador de PostgreSQL (`pg`), espiando `query` de su cliente, entre el envío de la petición y su
// respuesta. `@prisma/adapter-pg` y esta prueba cargan el mismo módulo `pg` (el del repositorio).
//
// Las peticiones van una tras otra y sin otras en paralelo. Con el calentamiento (dos peticiones) y dos repeticiones de cada uno de
// los cuatro casos, la aplicación recibe 10 peticiones de ingreso: el límite por IP del criterio 12 (10 por minuto) no se supera.

type CasoDeIngreso = 'i-activo' | 'ii-inactivo' | 'iii-sin-cuenta' | 'iv-solo-en-B';

const CASOS: readonly CasoDeIngreso[] = ['i-activo', 'ii-inactivo', 'iii-sin-cuenta', 'iv-solo-en-B'];
const CLAVE_EQUIVOCADA = 'clave-equivocada-para-el-ataque';

interface Observacion {
  estado: number;
  cuerpo: unknown;
  hayCookie: boolean;
  /** Texto normalizado de cada sentencia que llegó a `pg` durante la petición, en orden. */
  sentencias: string[];
}

interface Repeticion extends Observacion {
  /** `intentos_fallidos` antes y después (solo casos (i) y (ii)). */
  intentosAntes?: number;
  intentosDespues?: number;
  /** Instantánea de todas las tablas antes y después (solo casos (iii) y (iv)). */
  baseAntes?: Record<string, string[]>;
  baseDespues?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Espía de las sentencias que llegan a `pg`
// ---------------------------------------------------------------------------------------------------------------------

type FuncionQuery = (this: pg.Client, ...argumentos: unknown[]) => unknown;

// eslint-disable-next-line @typescript-eslint/unbound-method -- se guarda para restaurarlo y para llamarlo con el `this` del cliente
const consultaOriginal = pg.Client.prototype.query as unknown as FuncionQuery;
let grabando: string[] | undefined;

/** El texto de una sentencia (`query('SQL')`, `query({ text })` o un objeto `Query`), con los espacios seguidos en uno. */
function textoNormalizado(primerArgumento: unknown): string {
  const texto =
    typeof primerArgumento === 'string'
      ? primerArgumento
      : ((primerArgumento as { text?: string } | undefined)?.text ?? '');
  return texto.replace(/\s+/g, ' ').trim();
}

function instalarEspia(): void {
  pg.Client.prototype.query = function (this: pg.Client, ...argumentos: unknown[]) {
    grabando?.push(textoNormalizado(argumentos[0]));
    return consultaOriginal.apply(this, argumentos);
  } as unknown as typeof pg.Client.prototype.query;
}

function quitarEspia(): void {
  pg.Client.prototype.query = consultaOriginal as unknown as typeof pg.Client.prototype.query;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instantánea de la base (todas las tablas), independiente del rol del dueño: filtra por academia con su contexto
// ---------------------------------------------------------------------------------------------------------------------

async function instantaneaDeLaBase(e: Escenario): Promise<Record<string, string[]>> {
  const resultado: Record<string, string[]> = {};
  for (const tabla of await tablasDelNegocio()) {
    const columnas = await ejecutarComo(
      'propietario',
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'academia_id'",
      [tabla],
    );
    const filas: string[] = [];
    if (columnas.rows.length > 0) {
      for (const academia of [e.A, e.B]) {
        const { rows } = await ejecutarComo(
          'propietario',
          `SELECT to_jsonb(t)::text AS fila FROM "public"."${tabla}" t WHERE t.academia_id = $1::uuid ORDER BY 1`,
          [academia.id],
          { academiaId: academia.id },
        );
        filas.push(...rows.map((fila: { fila: string }) => fila.fila));
      }
    } else {
      const { rows } = await ejecutarComo(
        'propietario',
        `SELECT to_jsonb(t)::text AS fila FROM "public"."${tabla}" t ORDER BY 1`,
        [],
        { plataforma: true },
      );
      filas.push(...rows.map((fila: { fila: string }) => fila.fila));
    }
    resultado[tabla] = filas;
  }
  return resultado;
}

// ---------------------------------------------------------------------------------------------------------------------

describe('criterio 53: el mismo trabajo en la base con un DNI que no tiene cuenta', () => {
  let app: NestExpressApplication;
  let e: Escenario;
  let calentamiento: string[][] = [];
  const repeticiones = new Map<CasoDeIngreso, Repeticion[]>();

  beforeAll(async () => {
    e = await crearEscenario();
    ({ app } = await crearAppConReloj());
    const activo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA' });
    const inactivo = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', estado: 'INACTIVO' });
    const calentador = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ALUMNO' });
    const dniSinCuenta = [dniInventado(), dniInventado(), dniInventado()];
    const dniSoloEnB = e.secretariaB.dni;
    // El DNI de B no debe existir en A: si no, el caso (iv) no sería "solo en B".
    expect(
      await ejecutarComo(
        'propietario',
        'SELECT 1 FROM usuarios WHERE dni = $1 AND academia_id = $2::uuid',
        [dniSoloEnB, e.A.id],
        { academiaId: e.A.id },
      ).then((r) => r.rows.length),
    ).toBe(0);

    instalarEspia();

    /** Una petición de ingreso con clave equivocada; graba las sentencias entre el envío y la respuesta. */
    async function ingresar(dni: string): Promise<Observacion> {
      const sentencias: string[] = [];
      grabando = sentencias;
      try {
        const respuesta = await pedir(app, 'post', '/api/a/academia-a/sesion', {
          cuerpo: { usuario: dni, clave: CLAVE_EQUIVOCADA },
        });
        return {
          estado: respuesta.status,
          cuerpo: respuesta.body,
          hayCookie: cookieDeAcademia(respuesta.headers) !== undefined || respuesta.headers['set-cookie'] !== undefined,
          sentencias,
        };
      } finally {
        grabando = undefined;
      }
    }

    // Calentamiento: lo que se comprueba una sola vez por proceso (el rol de 001, el hash ficticio) con un DNI que existe y con uno
    // que no. Las sentencias se guardan solo para comprobar que el espía ve algo.
    calentamiento = [
      (await ingresar(calentador.dni)).sentencias,
      (await ingresar(dniSinCuenta[0] as string)).sentencias,
    ];

    for (let vuelta = 0; vuelta < 2; vuelta++) {
      for (const caso of CASOS) {
        const repeticion = {} as Repeticion;
        let dni: string;
        if (caso === 'i-activo' || caso === 'ii-inactivo') {
          const usuario = caso === 'i-activo' ? activo : inactivo;
          dni = usuario.dni;
          // "Con menos de 4 fallos": se parte de cero en cada repetición.
          await actualizarUsuario(e.A.id, usuario.id, { intentos_fallidos: 0, bloqueado_hasta: null });
          repeticion.intentosAntes = (await leerUsuario(e.A.id, usuario.id))?.intentos_fallidos;
        } else {
          dni = caso === 'iii-sin-cuenta' ? (dniSinCuenta[1 + vuelta] as string) : dniSoloEnB;
          repeticion.baseAntes = await instantaneaDeLaBase(e);
        }

        Object.assign(repeticion, await ingresar(dni));

        if (caso === 'i-activo' || caso === 'ii-inactivo') {
          const usuario = caso === 'i-activo' ? activo : inactivo;
          repeticion.intentosDespues = (await leerUsuario(e.A.id, usuario.id))?.intentos_fallidos;
        } else {
          repeticion.baseDespues = await instantaneaDeLaBase(e);
        }
        repeticiones.set(caso, [...(repeticiones.get(caso) ?? []), repeticion]);
      }
    }
  });

  afterAll(async () => {
    quitarEspia();
    await app?.close();
  });

  const primera = (caso: CasoDeIngreso): Repeticion => (repeticiones.get(caso) as Repeticion[])[0] as Repeticion;
  const todas = (): { caso: CasoDeIngreso; repeticion: Repeticion }[] =>
    CASOS.flatMap((caso) => (repeticiones.get(caso) ?? []).map((repeticion) => ({ caso, repeticion })));
  const transacciones = (sentencias: string[]): number =>
    sentencias.filter((s) => /^(BEGIN|START TRANSACTION)\b/i.test(s)).length;

  it('el calentamiento registra sentencias: el `pg` espiado es el que usa la API (si no, la prueba no vale)', () => {
    for (const sentencias of calentamiento) {
      expect(
        sentencias.length,
        'el espía de `pg.Client.prototype.query` no vio ninguna sentencia de la API: no es la instancia que usa el adaptador de Prisma',
      ).toBeGreaterThan(0);
    }
  });

  it('el caso (i) hace lo que dice la spec: transacciones, lectura del usuario por DNI, SELECT … FOR UPDATE y UPDATE del conteo', () => {
    const sentencias = primera('i-activo').sentencias;

    expect(transacciones(sentencias)).toBeGreaterThanOrEqual(2);
    expect(sentencias.some((s) => /^SELECT\b.*\busuarios\b/i.test(s) && !/FOR UPDATE/i.test(s))).toBe(true);
    expect(sentencias.some((s) => /^SELECT\b.*\bFOR UPDATE\b/i.test(s))).toBe(true);
    expect(sentencias.some((s) => /^UPDATE\b.*\busuarios\b/i.test(s))).toBe(true);
    expect(sentencias.some((s) => /^(COMMIT|ROLLBACK)\b/i.test(s))).toBe(true);
  });

  it('a) la secuencia de sentencias SQL es la misma en los cuatro casos y en las dos repeticiones (mismo texto normalizado, mismo orden)', () => {
    const referencia = primera('i-activo').sentencias;

    for (const { caso, repeticion } of todas()) {
      expect(repeticion.sentencias, `caso ${caso}`).toEqual(referencia);
    }
  });

  it('a) el número de transacciones (BEGIN) es el mismo en los cuatro casos', () => {
    const esperado = transacciones(primera('i-activo').sentencias);

    for (const { caso, repeticion } of todas()) {
      expect(transacciones(repeticion.sentencias), `caso ${caso}`).toBe(esperado);
    }
  });

  it('b) con un DNI sin cuenta o solo de B, no cambia ninguna fila de ninguna tabla (tampoco actualizado_en) ni se inserta nada en auditoría', () => {
    for (const caso of ['iii-sin-cuenta', 'iv-solo-en-B'] as const) {
      for (const repeticion of repeticiones.get(caso) ?? []) {
        expect(repeticion.baseDespues, `caso ${caso}`).toEqual(repeticion.baseAntes);
      }
    }
  });

  it('c) con un DNI de un usuario ACTIVO o INACTIVO de A, intentos_fallidos sube en 1', () => {
    for (const caso of ['i-activo', 'ii-inactivo'] as const) {
      for (const repeticion of repeticiones.get(caso) ?? []) {
        expect(repeticion.intentosAntes, `caso ${caso}`).toBe(0);
        expect(repeticion.intentosDespues, `caso ${caso}`).toBe(1);
      }
    }
  });

  it('d) los cuatro casos responden 401 CREDENCIALES_INVALIDAS con el mismo cuerpo y sin Set-Cookie', () => {
    const referencia = primera('i-activo').cuerpo;

    for (const { caso, repeticion } of todas()) {
      expect(repeticion.estado, `caso ${caso}`).toBe(401);
      expect((repeticion.cuerpo as { codigo?: string }).codigo, `caso ${caso}`).toBe('CREDENCIALES_INVALIDAS');
      expect(repeticion.cuerpo, `caso ${caso}`).toEqual(referencia);
      expect(repeticion.hayCookie, `caso ${caso}`).toBe(false);
    }
  });
});
