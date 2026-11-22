// spec: 006-caja (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codigoDeErrorDeBase } from '../../../src/infraestructura/prisma';
import {
  type AppCaja,
  type CajaDePrueba,
  cobroImitado,
  codigoDe,
  codigoDeError,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearAppCaja,
  crearCajaDePrueba,
  cuerpoCierre,
  cuerpoEgreso,
  estadoDeError,
  exigirRutasDeCaja,
  exigirTablasDeCaja,
  ingresoDeEjemplo,
  leerCajas,
  leerCierres,
  leerMovimientos,
  retenerCaja,
  rutaCaja,
} from '../../utilidades/caja';
import {
  AHORA_005,
  conRetencion,
  crearEscenarioInscripcion,
  type EscenarioInscripcion,
  leerMatriculas,
  leerSolicitudes,
  retenerClases,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { cookieDeUsuario } from '../../utilidades/usuarios';

// Criterio 26 (crítico, regla "aforo y caja en transacciones sin carreras" de CLAUDE.md; «Cupo de una clase» de 004): la caja se bloquea al final.
// Una transacción de cobro (007) toma, en este orden, `usuarios` (`bloquearActorVigente`), sus filas del cliente, las clases (`bloquearClasesParaCupo`) y
// por último la caja (`registrarIngresoEnCaja`). Ninguna transacción de esta historia bloquea filas de `alumnos`, `solicitudes_inscripcion`, `matriculas`
// ni `clases`. Prueba de integración: una transacción que imita la 007 (actor, `bloquearClasesParaCupo` de una clase, `registrarIngresoEnCaja`) corre a la
// vez que un egreso, un cierre y la cancelación de una solicitud de 005b sobre esa clase; todas terminan, nunca con 40P01 ni 500.
// Determinista, sin tiempos: la prueba retiene una fila con su propia transacción, envía las cuatro operaciones una tras otra (cada una cuando la anterior ya
// quedó esperando) y suelta; en el primer caso retiene la caja y en el segundo, la clase.

interface Resultado {
  nombre: string;
  status: number;
  codigo: string | undefined;
  sqlstate: string | null;
}

describe('criterio 26: el orden de bloqueos con los cobros', () => {
  let ctx: AppCaja;
  let e: EscenarioInscripcion;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  let cookieAdmin: string;
  let caja: CajaDePrueba;
  let alumnoId: string;
  let solicitud: SolicitudSembrada;

  beforeAll(async () => {
    ctx = await crearAppCaja(AHORA_005);
  });
  beforeEach(async () => {
    exigirRutasDeCaja(ctx.app);
    await exigirTablasDeCaja();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
    cookies = cookiesDeCaja({ ...e, secretariaA2: e.secretariaA, adminA2: e.adminA }, AHORA_005);
    cookieAdmin = cookieDeUsuario(e.adminA, AHORA_005);
    caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { monto_inicial: '100.00' });
    alumnoId = (await crearAlumnoDeCaja(e.A.id)).id;
    solicitud = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  /** Una transacción que imita la de la 007: actor, clase y, al final, la caja. */
  const cobro = async (): Promise<Resultado> => {
    const resultado = await cobroImitado(await ctx.baseDatos(), {
      academiaId: e.A.id,
      actor: { id: e.secretariaA.id },
      claseId: e.lunes.id,
      ingreso: ingresoDeEjemplo(alumnoId, e.secretariaA.id),
      ahora: AHORA_005,
    });
    if (resultado.ok) return { nombre: 'cobro', status: 201, codigo: undefined, sqlstate: null };
    return {
      nombre: 'cobro',
      status: estadoDeError(resultado.error) ?? 500,
      codigo: codigoDeError(resultado.error),
      sqlstate: codigoDeErrorDeBase(resultado.error),
    };
  };
  const egreso = async (): Promise<Resultado> => {
    const r = await ctx.http.post(rutaCaja(caja.id, '/egresos'), cookies.secretaria, cuerpoEgreso({ monto: '10.00' }));
    return { nombre: 'egreso', status: r.status, codigo: codigoDe(r), sqlstate: null };
  };
  const cierre = async (): Promise<Resultado> => {
    const r = await ctx.http.post(
      rutaCaja(caja.id, '/cierre'),
      cookies.admin,
      cuerpoCierre({ montoDeclarado: '100.00', ultimoMovimientoVisto: 0 }),
    );
    return { nombre: 'cierre', status: r.status, codigo: codigoDe(r), sqlstate: null };
  };
  const cancelacion = async (): Promise<Resultado> => {
    const r = await ctx.http.post(`/api/solicitudes/${solicitud.solicitudId}/cancelar`, cookieAdmin, {
      motivo: 'Cancelada por la secretaría',
    });
    return { nombre: 'cancelación', status: r.status, codigo: codigoDe(r), sqlstate: null };
  };

  /** Lo que debe cumplirse al terminar todo, en cualquier orden en que hayan entrado. */
  async function comprobarResultados(resultados: Resultado[]): Promise<void> {
    const texto = JSON.stringify(resultados);
    for (const resultado of resultados) {
      expect(resultado.sqlstate, `interbloqueo en ${resultado.nombre}: ${texto}`).not.toBe('40P01');
      expect(resultado.status, `${resultado.nombre} respondió 500: ${texto}`).toBeLessThan(500);
    }
    const por = (nombre: string) => resultados.find((r) => r.nombre === nombre) as Resultado;
    expect([201, 409], texto).toContain(por('cobro').status);
    if (por('cobro').status === 409) expect(por('cobro').codigo).toBe('SIN_CAJA_ABIERTA');
    expect([201, 409], texto).toContain(por('egreso').status);
    if (por('egreso').status === 409) expect(por('egreso').codigo).toBe('CAJA_CERRADA');
    expect([200, 409], texto).toContain(por('cierre').status);
    if (por('cierre').status === 409) expect(por('cierre').codigo).toBe('CAJA_CAMBIO');
    expect(por('cancelación').status, texto).toBe(200);

    // La cancelación terminó su trabajo y la caja quedó coherente: cerrada con un solo cierre vigente que cubre todos sus movimientos.
    expect((await leerSolicitudes(e.A.id))[0]?.estado).toBe('CANCELADA');
    expect((await leerMatriculas(e.A.id))[0]?.estado).toBe('CANCELADA');
    const filas = await leerCajas(e.A.id);
    const movimientos = await leerMovimientos(e.A.id);
    const cierres = await leerCierres(e.A.id);
    if (filas[0]?.estado === 'CERRADA') {
      expect(cierres.filter((c) => c.reabierto_en === null)).toHaveLength(1);
      expect(cierres[0]?.movimientos_hasta).toBe(Math.max(0, ...movimientos.map((m) => m.numero)));
    } else {
      expect(cierres).toHaveLength(0);
    }
  }

  it('criterio 26: con la caja retenida, el cobro (actor, clase, caja), el egreso, el cierre y la cancelación de 005b sobre esa clase terminan todos, sin 40P01 ni 500', async () => {
    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerCaja(e.A.id, caja.id),
      enviar: [cobro, egreso, cierre, cancelacion],
      liberar: 'ROLLBACK',
      enOrden: true,
    });

    expect(todasEsperaron, 'las cuatro operaciones no quedaron esperando (directa o transitivamente) a la prueba').toBe(
      true,
    );
    await comprobarResultados(resultados);
    expect(resultados.find((r) => r.nombre === 'cobro')?.status, 'el cobro llegó primero a la caja').toBe(201);
  });

  it('criterio 26: con la clase retenida, el cobro y la cancelación esperan la clase y el egreso y el cierre (que no la tocan) terminan sin esperarla; al soltar, todas terminan', async () => {
    const { resultados } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerClases([e.lunes.id], e.A.id),
      enviar: [cobro, cancelacion, egreso, cierre],
      liberar: 'ROLLBACK',
      enOrden: true,
    });

    await comprobarResultados(resultados);
    const egresoYCierre = resultados.filter((r) => r.nombre === 'egreso' || r.nombre === 'cierre');
    expect(egresoYCierre.map((r) => r.nombre).sort(), 'el egreso y el cierre respondieron').toEqual([
      'cierre',
      'egreso',
    ]);
  });

  it('criterio 26: ni el egreso ni el cierre bloquean la clase ni la solicitud: con la clase y la solicitud retenidas, un egreso y un cierre responden sin esperar', async () => {
    const { resultados } = await conRetencion({
      academiaId: e.A.id,
      retener: async (retenedor) => {
        await retenerClases([e.lunes.id], e.A.id)(retenedor);
        await retenedor.consultar(
          'SELECT id FROM solicitudes_inscripcion WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
          [e.A.id, solicitud.solicitudId],
        );
        await retenedor.consultar(
          'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
          [e.A.id, solicitud.matriculaId],
        );
        await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
          e.A.id,
          solicitud.alumnoId,
        ]);
      },
      enviar: [egreso, cierre],
      liberar: 'ROLLBACK',
      enOrden: true,
    });

    expect(resultados.map((r) => r.nombre)).toEqual(['egreso', 'cierre']);
    expect(resultados[0]?.status, JSON.stringify(resultados)).toBe(201);
    expect([200, 409]).toContain(resultados[1]?.status);
  });
});
