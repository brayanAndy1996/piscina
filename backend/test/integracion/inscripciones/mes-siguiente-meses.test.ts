// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fijarConfiguracion } from '../../utilidades/configuracion';
import { en, enLima } from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  type EscenarioMesSiguiente,
  cambiarConfiguracion,
  cargarContratosDe010d,
  exigirRutaDeMeses,
  INSTANTE,
  mesesDe,
  pedirMeses,
  prepararEscenarioDeMesSiguiente,
  rutaMeses,
} from '../../utilidades/escenario-mes-siguiente';
import { instantaneaDeLaAcademia } from '../../utilidades/escenario-pagos';
import { codigoDe, conRetencion, retenerClases } from '../../utilidades/inscripciones';
import { contarAuditoria, fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 1 (crítico, DR-10 de 010, D-06, RNF-12): `GET /api/a/{nombreCorto}/inscripcion/meses` responde 200 con `mesesInscripcionSchema` (estricto): `hoy` (`AAAA-MM-DD` de Lima), `meses` y `aperturaMesSiguiente`. `meses` trae siempre M
// (`{ mes, fechaInicio: hoy, inscripcionHasta: último día de M }`) y, si la ventana está abierta, también M+1 (`{ mes, fechaInicio: día 1 de M+1, inscripcionHasta: último día de M }`), en orden cronológico. `aperturaMesSiguiente` es el primer
// día de la ventana de M mientras la ventana no se abrió y `null` cuando está abierta. Con `RELOJ` fijo, N = 5 y el proceso en `TZ=Asia/Tokyo` (y en UTC): los bordes del 25/11, 26/11, 30/11 y 1/12, el cambio de año y N = 15 en enero y febrero de
// 2027. Un `PATCH /api/configuracion` de `diasPrioridadRenovacion` vale para la petición siguiente. `Cache-Control: no-store`; 404 `ACADEMIA_NO_ENCONTRADA` y 403 `ACADEMIA_SUSPENDIDA`. No escribe, no bloquea y no audita.

const ZONA_ORIGINAL = process.env['TZ'];

interface CasoDeMeses {
  nombre: string;
  instante: Date;
  /** `diasPrioridadRenovacion` de A (por defecto, 5). */
  dias?: number;
  hoy: string;
  meses: { mes: string; fechaInicio: string; inscripcionHasta: string }[];
  aperturaMesSiguiente: string | null;
}

const CASOS: CasoDeMeses[] = [
  {
    nombre: 'el 25/11 a las 23:59:59.999 de Lima (todavía no se abre la ventana): solo noviembre, apertura 2026-11-26',
    instante: enLima('2026-11-25', '23:59:59.999'),
    hoy: '2026-11-25',
    meses: [{ mes: '2026-11', fechaInicio: '2026-11-25', inscripcionHasta: '2026-11-30' }],
    aperturaMesSiguiente: '2026-11-26',
  },
  {
    nombre: 'el 26/11 a las 00:00:00.000 (se abre la ventana): noviembre y diciembre, sin apertura',
    instante: enLima('2026-11-26', '00:00:00.000'),
    hoy: '2026-11-26',
    meses: [
      { mes: '2026-11', fechaInicio: '2026-11-26', inscripcionHasta: '2026-11-30' },
      { mes: '2026-12', fechaInicio: '2026-12-01', inscripcionHasta: '2026-11-30' },
    ],
    aperturaMesSiguiente: null,
  },
  {
    nombre: 'el 30/11 a las 23:59:59.999 (ya es 1/12 en UTC): todavía noviembre y diciembre',
    instante: enLima('2026-11-30', '23:59:59.999'),
    hoy: '2026-11-30',
    meses: [
      { mes: '2026-11', fechaInicio: '2026-11-30', inscripcionHasta: '2026-11-30' },
      { mes: '2026-12', fechaInicio: '2026-12-01', inscripcionHasta: '2026-11-30' },
    ],
    aperturaMesSiguiente: null,
  },
  {
    nombre: 'el 1/12 a las 00:00:00.000: solo diciembre (ya es M), apertura 2026-12-27',
    instante: enLima('2026-12-01', '00:00:00.000'),
    hoy: '2026-12-01',
    meses: [{ mes: '2026-12', fechaInicio: '2026-12-01', inscripcionHasta: '2026-12-31' }],
    aperturaMesSiguiente: '2026-12-27',
  },
  {
    nombre: 'el 31/12/2026 a las 10:00 (cambio de año): diciembre y enero de 2027',
    instante: INSTANTE.jueves31dic,
    hoy: '2026-12-31',
    meses: [
      { mes: '2026-12', fechaInicio: '2026-12-31', inscripcionHasta: '2026-12-31' },
      { mes: '2027-01', fechaInicio: '2027-01-01', inscripcionHasta: '2026-12-31' },
    ],
    aperturaMesSiguiente: null,
  },
  {
    nombre: 'N = 15 en enero de 2027, el 16/01 (un día antes de la ventana, que empieza el 17/01): solo enero',
    instante: enLima('2027-01-16', '10:00'),
    dias: 15,
    hoy: '2027-01-16',
    meses: [{ mes: '2027-01', fechaInicio: '2027-01-16', inscripcionHasta: '2027-01-31' }],
    aperturaMesSiguiente: '2027-01-17',
  },
  {
    nombre: 'N = 15 en enero de 2027, el 17/01 (primer día de la ventana): enero y febrero',
    instante: enLima('2027-01-17', '00:00:00.000'),
    dias: 15,
    hoy: '2027-01-17',
    meses: [
      { mes: '2027-01', fechaInicio: '2027-01-17', inscripcionHasta: '2027-01-31' },
      { mes: '2027-02', fechaInicio: '2027-02-01', inscripcionHasta: '2027-01-31' },
    ],
    aperturaMesSiguiente: null,
  },
  {
    nombre: 'N = 15 en febrero de 2027 (28 días), el 13/02: solo febrero, apertura 2027-02-14',
    instante: enLima('2027-02-13', '23:59:59.999'),
    dias: 15,
    hoy: '2027-02-13',
    meses: [{ mes: '2027-02', fechaInicio: '2027-02-13', inscripcionHasta: '2027-02-28' }],
    aperturaMesSiguiente: '2027-02-14',
  },
  {
    nombre: 'N = 15 en febrero de 2027, el 14/02: febrero y marzo',
    instante: enLima('2027-02-14', '00:00:00.000'),
    dias: 15,
    hoy: '2027-02-14',
    meses: [
      { mes: '2027-02', fechaInicio: '2027-02-14', inscripcionHasta: '2027-02-28' },
      { mes: '2027-03', fechaInicio: '2027-03-01', inscripcionHasta: '2027-02-28' },
    ],
    aperturaMesSiguiente: null,
  },
];

describe.each(['UTC', 'Asia/Tokyo'])('los meses de inscripción (criterio 1) con el proceso en TZ=%s', (zona) => {
  let ctx: AppCarnet;
  let esc: EscenarioMesSiguiente;

  beforeAll(async () => {
    process.env['TZ'] = zona;
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    process.env['TZ'] = zona;
    esc = await prepararEscenarioDeMesSiguiente(ctx);
    exigirRutaDeMeses(ctx.app);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });

  describe('los bordes de la ventana', () => {
    it.each(CASOS)('criterio 1: $nombre', async (caso) => {
      if (caso.dias !== undefined) await fijarConfiguracion(esc.e.A.id, { diasPrioridadRenovacion: caso.dias });
      ctx.reloj.fijar(caso.instante);

      const respuesta = await pedirMeses(ctx);

      const cuerpo = mesesDe(respuesta);
      expect(cuerpo).toEqual({ hoy: caso.hoy, meses: caso.meses, aperturaMesSiguiente: caso.aperturaMesSiguiente });
      expect(respuesta.cacheControl).toBe('no-store');
    });

    it('criterio 1: la respuesta cumple `mesesInscripcionSchema` (estricto) y sus claves son exactamente hoy, meses y aperturaMesSiguiente', async () => {
      const { mesesInscripcionSchema } = await cargarContratosDe010d();
      ctx.reloj.fijar(INSTANTE.viernes27);

      const respuesta = await pedirMeses(ctx);

      expect(Object.keys(mesesDe(respuesta)).sort()).toEqual(['aperturaMesSiguiente', 'hoy', 'meses']);
      expect(mesesInscripcionSchema.safeParse(respuesta.body).success, respuesta.texto).toBe(true);
      for (const elemento of mesesDe(respuesta).meses) {
        expect(Object.keys(elemento).sort()).toEqual(['fechaInicio', 'inscripcionHasta', 'mes']);
      }
    });
  });

  describe('diasPrioridadRenovacion cambia sin reiniciar', () => {
    it('criterio 1: con N = 5 el 21/11 solo noviembre; tras un PATCH a 10 (ventana desde el 21/11) también diciembre; y tras otro PATCH a 3 el 27/11 (ventana desde el 28/11), solo noviembre con apertura 2026-11-28', async () => {
      const el21 = enLima('2026-11-21', '10:00');
      const cookies = en(ctx, esc, el21);

      const conCinco = mesesDe(await pedirMeses(ctx));
      const aDiez = await cambiarConfiguracion(ctx, cookies.admin, { diasPrioridadRenovacion: 10 });
      const conDiez = mesesDe(await pedirMeses(ctx));
      const tarde = en(ctx, esc, INSTANTE.viernes27);
      const aTres = await cambiarConfiguracion(ctx, tarde.admin, { diasPrioridadRenovacion: 3 });
      const conTres = mesesDe(await pedirMeses(ctx));

      expect(conCinco.meses.map((m) => m.mes)).toEqual(['2026-11']);
      expect(conCinco.aperturaMesSiguiente).toBe('2026-11-26');
      expect(aDiez.status, aDiez.texto).toBe(200);
      expect(conDiez.meses.map((m) => m.mes)).toEqual(['2026-11', '2026-12']);
      expect(conDiez.aperturaMesSiguiente).toBeNull();
      expect(aTres.status, aTres.texto).toBe(200);
      expect(conTres.meses.map((m) => m.mes)).toEqual(['2026-11']);
      expect(conTres.aperturaMesSiguiente).toBe('2026-11-28');
    });
  });

  describe('la academia', () => {
    it('criterio 1: una academia que no existe responde 404 ACADEMIA_NO_ENCONTRADA y una suspendida, 403 ACADEMIA_SUSPENDIDA, las dos con Cache-Control: no-store', async () => {
      ctx.reloj.fijar(INSTANTE.viernes27);
      await fijarEstadoDeAcademia(esc.e.B.id, 'SUSPENDIDA');

      const noExiste = await pedirMeses(ctx, 'no-existe');
      const suspendida = await pedirMeses(ctx, 'academia-b');

      expect([noExiste.status, codigoDe(noExiste)], noExiste.texto).toEqual([404, 'ACADEMIA_NO_ENCONTRADA']);
      expect([suspendida.status, codigoDe(suspendida)], suspendida.texto).toEqual([403, 'ACADEMIA_SUSPENDIDA']);
      expect(noExiste.cacheControl).toBe('no-store');
      expect(suspendida.cacheControl).toBe('no-store');
    });

    it('criterio 1: el nombre corto se recorta y se pasa a minúsculas; no pide sesión aunque la cookie sea inválida', async () => {
      ctx.reloj.fijar(INSTANTE.viernes27);

      const respuesta = await ctx.http.get('/api/a/%20ACADEMIA-A/inscripcion/meses', { cookie: 'aq_sesion=invalida' });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(mesesDe(respuesta).hoy).toBe('2026-11-27');
    });

    it('criterio 1: la dirección con otras mayúsculas y con barra final es la misma ruta', async () => {
      ctx.reloj.fijar(INSTANTE.viernes27);

      const mayusculas = await ctx.http.get('/api/a/academia-a/Inscripcion/MESES');
      const barra = await ctx.http.get(`${rutaMeses()}/`);

      expect([mayusculas.status, barra.status], `${mayusculas.texto} ${barra.texto}`).toEqual([200, 200]);
    });
  });

  describe('no escribe, no bloquea y no audita', () => {
    it('criterio 1: la lectura no cambia ninguna tabla, no deja auditoría y no envía correo', async () => {
      ctx.reloj.fijar(INSTANTE.viernes27);
      const antes = { a: await instantaneaDeLaAcademia(esc.e.A.id), b: await instantaneaDeLaAcademia(esc.e.B.id) };
      const auditoria = await contarAuditoria(esc.e.A.id);

      const respuesta = await pedirMeses(ctx);

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect({ a: await instantaneaDeLaAcademia(esc.e.A.id), b: await instantaneaDeLaAcademia(esc.e.B.id) }).toEqual(
        antes,
      );
      expect(await contarAuditoria(esc.e.A.id)).toBe(auditoria);
      expect(ctx.correo.mensajes).toEqual([]);
    });

    it('criterio 1: no bloquea: con las clases retenidas por otra transacción, la lectura responde 200 sin esperar', async () => {
      ctx.reloj.fijar(INSTANTE.viernes27);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: esc.e.A.id,
        retener: retenerClases([esc.c.id, esc.e.lunes.id], esc.e.A.id),
        enviar: [() => pedirMeses(ctx)],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'la lectura de los meses no debe esperar ningún bloqueo de las clases').toBe(false);
      expect(resultados[0]?.status, resultados[0]?.texto).toBe(200);
    });
  });
});
