// spec: 003-configuracion-academia (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fijarConfiguracion, instantaneaDeConfiguracion } from '../../utilidades/configuracion';
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

// Criterio 17 (crítico, criterio 53 de 002): con filas de `intentos_inicio_sesion` y `minutos_bloqueo` en A (3 y 30) y otras distintas en B
// (7 y 10), los cuatro casos del criterio 53 de 002 (DNI activo de A, inactivo de A, inexistente y solo de B, por la ruta de A y con la clave
// equivocada) cumplen sus puntos a) a d): la misma secuencia de sentencias SQL, en la que la lectura de la configuración es la misma
// sentencia y ocurre en el mismo lugar en los cuatro casos. La prueba no mide tiempos: observa las sentencias SQL que llegan al controlador
// de PostgreSQL (`pg`), espiando `query` de su cliente, entre el envío de la petición y su respuesta.
//
// Las peticiones van una tras otra y sin otras en paralelo. Para dejar margen bajo el límite por IP del criterio 12 (10 por minuto por
// aplicación) cada vuelta usa su propia aplicación: 2 peticiones de calentamiento y los 4 casos (6 peticiones por aplicación). Dos vueltas,
// de modo que cada caso se observa dos veces.

type CasoDeIngreso = 'i-activo' | 'ii-inactivo' | 'iii-sin-cuenta' | 'iv-solo-en-B';

const CASOS: readonly CasoDeIngreso[] = ['i-activo', 'ii-inactivo', 'iii-sin-cuenta', 'iv-solo-en-B'];
const CLAVE_EQUIVOCADA = 'clave-equivocada-para-el-ataque';
const VUELTAS = 2;

interface Observacion {
  estado: number;
  cuerpo: unknown;
  hayCookie: boolean;
  /** Texto normalizado de cada sentencia que llegó a `pg` durante la petición, en orden. */
  sentencias: string[];
}

interface Repeticion extends Observacion {
  intentosAntes?: number;
  intentosDespues?: number;
  /** Instantánea de todas las tablas antes y después (solo casos (iii) y (iv)). */
  baseAntes?: Record<string, string[]>;
  baseDespues?: Record<string, string[]>;
  /** Filas de `configuraciones` de A y de B antes y después. */
  configuracionAntes?: string[];
  configuracionDespues?: string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Espía de las sentencias que llegan a `pg`
// ---------------------------------------------------------------------------------------------------------------------

type FuncionQuery = (this: pg.Client, ...argumentos: unknown[]) => unknown;

// eslint-disable-next-line @typescript-eslint/unbound-method -- se guarda para restaurarlo y para llamarlo con el `this` del cliente
const consultaOriginal = pg.Client.prototype.query as unknown as FuncionQuery;
let grabando: string[] | undefined;

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

const filasDeConfiguracion = async (e: Escenario): Promise<string[]> => [
  await instantaneaDeConfiguracion(e.A.id),
  await instantaneaDeConfiguracion(e.B.id),
];

// ---------------------------------------------------------------------------------------------------------------------

describe('criterio 17: el mismo trabajo en la base con un DNI que no tiene cuenta, con filas de configuración', () => {
  let e: Escenario;
  let calentamiento: string[][] = [];
  const repeticiones = new Map<CasoDeIngreso, Repeticion[]>();

  beforeAll(async () => {
    e = await crearEscenario();
    await fijarConfiguracion(e.A.id, { intentosInicioSesion: 3, minutosBloqueo: 30 });
    await fijarConfiguracion(e.B.id, { intentosInicioSesion: 7, minutosBloqueo: 10 });
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

    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      const { app } = await crearAppConReloj();
      try {
        /** Una petición de ingreso con clave equivocada; graba las sentencias entre el envío y la respuesta. */
        const ingresar = async (nombreApp: NestExpressApplication, dni: string): Promise<Observacion> => {
          const sentencias: string[] = [];
          grabando = sentencias;
          try {
            const respuesta = await pedir(nombreApp, 'post', '/api/a/academia-a/sesion', {
              cuerpo: { usuario: dni, clave: CLAVE_EQUIVOCADA },
            });
            return {
              estado: respuesta.status,
              cuerpo: respuesta.body,
              hayCookie:
                cookieDeAcademia(respuesta.headers) !== undefined || respuesta.headers['set-cookie'] !== undefined,
              sentencias,
            };
          } finally {
            grabando = undefined;
          }
        };

        // Calentamiento de la aplicación: lo que se comprueba una sola vez por proceso o por aplicación (el rol de 001, el hash ficticio),
        // con un DNI que existe y con uno que no. Las sentencias solo se guardan para comprobar que el espía ve algo.
        const sentenciasDeCalentamiento = [
          (await ingresar(app, calentador.dni)).sentencias,
          (await ingresar(app, dniSinCuenta[0] as string)).sentencias,
        ];
        if (vuelta === 0) calentamiento = sentenciasDeCalentamiento;
        // El calentador y el DNI sin cuenta de la primera vuelta cuentan fallos de nadie más: se deja al calentador limpio.
        await actualizarUsuario(e.A.id, calentador.id, { intentos_fallidos: 0, bloqueado_hasta: null });

        for (const caso of CASOS) {
          const repeticion = {} as Repeticion;
          let dni: string;
          if (caso === 'i-activo' || caso === 'ii-inactivo') {
            const usuario = caso === 'i-activo' ? activo : inactivo;
            dni = usuario.dni;
            // "Con menos de 2 fallos" (A bloquea al 3.º): se parte de cero en cada repetición.
            await actualizarUsuario(e.A.id, usuario.id, { intentos_fallidos: 0, bloqueado_hasta: null });
            repeticion.intentosAntes = (await leerUsuario(e.A.id, usuario.id))?.intentos_fallidos;
          } else {
            dni = caso === 'iii-sin-cuenta' ? (dniSinCuenta[1 + vuelta] as string) : dniSoloEnB;
            repeticion.baseAntes = await instantaneaDeLaBase(e);
          }
          repeticion.configuracionAntes = await filasDeConfiguracion(e);

          Object.assign(repeticion, await ingresar(app, dni));

          repeticion.configuracionDespues = await filasDeConfiguracion(e);
          if (caso === 'i-activo' || caso === 'ii-inactivo') {
            const usuario = caso === 'i-activo' ? activo : inactivo;
            repeticion.intentosDespues = (await leerUsuario(e.A.id, usuario.id))?.intentos_fallidos;
          } else {
            repeticion.baseDespues = await instantaneaDeLaBase(e);
          }
          repeticiones.set(caso, [...(repeticiones.get(caso) ?? []), repeticion]);
        }
      } finally {
        await app.close();
      }
    }
  });

  afterAll(() => {
    quitarEspia();
  });

  const primera = (caso: CasoDeIngreso): Repeticion => (repeticiones.get(caso) as Repeticion[])[0] as Repeticion;
  const todas = (): { caso: CasoDeIngreso; repeticion: Repeticion }[] =>
    CASOS.flatMap((caso) => (repeticiones.get(caso) ?? []).map((repeticion) => ({ caso, repeticion })));
  const transacciones = (sentencias: string[]): number =>
    sentencias.filter((s) => /^(BEGIN|START TRANSACTION)\b/i.test(s)).length;
  const esLecturaDeConfiguracion = (sentencia: string): boolean => /\bconfiguraciones\b/i.test(sentencia);
  const lecturasDeConfiguracion = (sentencias: string[]): number[] =>
    sentencias.flatMap((s, indice) => (esLecturaDeConfiguracion(s) ? [indice] : []));

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

  it('el fallo se cuenta con los valores de A: con filas de configuración en A y en B, el caso (i) lee la configuración con una sola sentencia SELECT', () => {
    const sentencias = primera('i-activo').sentencias;

    const lecturas = lecturasDeConfiguracion(sentencias);

    expect(lecturas, 'el ingreso fallido debe leer la tabla configuraciones').toHaveLength(1);
    expect(sentencias[lecturas[0] as number]).toMatch(/^SELECT\b/i);
  });

  it('a) la secuencia de sentencias SQL es la misma en los cuatro casos y en las dos vueltas (mismo texto normalizado, mismo orden)', () => {
    const referencia = primera('i-activo').sentencias;

    for (const { caso, repeticion } of todas()) {
      expect(repeticion.sentencias, `caso ${caso}`).toEqual(referencia);
    }
  });

  it('a) la lectura de la configuración es la misma sentencia y ocurre en el mismo lugar en los cuatro casos, dentro de una transacción', () => {
    const referencia = primera('i-activo').sentencias;
    const lugar = lecturasDeConfiguracion(referencia);
    expect(lugar, 'la configuración se lee una sola vez').toHaveLength(1);
    const posicion = lugar[0] as number;

    for (const { caso, repeticion } of todas()) {
      const lecturas = lecturasDeConfiguracion(repeticion.sentencias);
      expect(lecturas, `caso ${caso}: una sola lectura de la configuración`).toEqual([posicion]);
      expect(repeticion.sentencias[posicion], `caso ${caso}`).toBe(referencia[posicion]);
      const antes = repeticion.sentencias.slice(0, posicion);
      const despues = repeticion.sentencias.slice(posicion + 1);
      const ultimoBegin = antes.map((s) => /^(BEGIN|START TRANSACTION)\b/i.test(s)).lastIndexOf(true);
      const ultimoFin = antes.map((s) => /^(COMMIT|ROLLBACK)\b/i.test(s)).lastIndexOf(true);
      expect(ultimoBegin, `caso ${caso}: antes de leer la configuración hay un BEGIN`).toBeGreaterThan(ultimoFin);
      expect(
        despues.some((s) => /^(COMMIT|ROLLBACK)\b/i.test(s)),
        `caso ${caso}: la lectura queda dentro de la transacción (después hay un COMMIT)`,
      ).toBe(true);
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

  it('b) leer la configuración no la escribe: las filas de A y de B (valor y actualizado_en) quedan iguales en los cuatro casos', () => {
    for (const { caso, repeticion } of todas()) {
      expect(repeticion.configuracionDespues, `caso ${caso}`).toEqual(repeticion.configuracionAntes);
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
