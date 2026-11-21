// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contarAuditoria, dniInventado } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  conRetencion,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerAlumnos,
  leerSolicitudes,
  type Objeto,
  retenerClases,
  rutaPublica,
  sembrarSolicitud,
} from '../../utilidades/inscripciones';
import { crearAppConIpPorCabecera, desde } from '../../utilidades/inscripciones-ronda1';

// Criterio 60 (crítico, DR-8, DR-15, riesgo de 11.4; criterio 25; respuesta R4, ronda 1): el límite de 5 solicitudes activas cuenta las creadas
// desde la misma clave de conexión (criterio 59) en la academia, y el bloqueo consultivo de la IP del envío usa esa clave. `ip_origen` sigue
// guardando la dirección exacta (como la normaliza `ipParaAuditoria`), no el bloque. Pruebas:
//   a) 5 solicitudes activas desde cinco direcciones distintas de 2001:db8:1:2::/64: un envío desde una sexta dirección del mismo bloque
//      responde 409 LIMITE_DE_RESERVAS_PENDIENTES sin escribir; desde 2001:db8:1:3::1, 201;
//   b) 5 activas desde 203.0.113.7: desde ::ffff:203.0.113.7, 409; desde 203.0.113.8, 201;
//   c) las filas escritas como dueño cuentan igual: una solicitud activa con ip_origen 2001:db8:1:2::abcd cuenta para un envío desde
//      2001:db8:1:2::1;
//   d) 4 activas en el bloque y dos envíos simultáneos desde dos direcciones distintas del mismo /64 (DNI distintos): exactamente uno responde
//      201 y el otro 409 LIMITE_DE_RESERVAS_PENDIENTES; nunca 500 ni 40P01;
//   e) vencidas, canceladas y de otra academia siguen sin contar.

describe('reservas sin pagar por conexión con la clave de conexión (criterio 60)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppConIpPorCabecera();
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = async (ip: string, nombreCorto = 'academia-a', sobre: Objeto = {}) => {
    const cuerpo =
      nombreCorto === 'academia-b'
        ? await cuerpoInscripcion(e, { plan: e.planB, clases: [e.lunesB, e.miercolesB, e.viernesB], sobre })
        : await cuerpoInscripcion(e, { sobre });
    return ctx.http.post(rutaPublica(nombreCorto, '/inscripcion'), cuerpo, { headers: desde(ip) });
  };
  const direccion = (n: number, bloque = '1:2') => `2001:db8:${bloque}::${n.toString(16)}`;
  /** Siembra, como dueño, `cantidad` solicitudes activas con esa `ip_origen`. */
  async function sembrarActivas(cantidad: number, ipOrigen: string, academiaId = e.A.id) {
    for (let i = 0; i < cantidad; i++) {
      await sembrarSolicitud(academiaId, {
        planId: academiaId === e.A.id ? e.plan.id : e.planB.id,
        claseIds: [academiaId === e.A.id ? e.lunes.id : e.lunesB.id],
        ipOrigen,
        dni: dniInventado(),
      });
    }
  }
  const estadoDeLaBase = async () => ({
    filas: await instantaneaDeInscripciones(e.A.id),
    auditoria: await contarAuditoria(e.A.id),
  });

  it('criterio 60 a: 5 solicitudes activas desde cinco direcciones distintas de 2001:db8:1:2::/64 frenan a una sexta dirección del mismo bloque (409 sin escribir) y no a otro bloque (201); ip_origen guarda la dirección exacta', async () => {
    const origenes = [1, 2, 3, 4, 5].map((n) => direccion(n));
    for (const ip of origenes) {
      const creada = await enviar(ip);
      expect(creada.status, `${ip}: ${creada.texto}`).toBe(201);
    }
    expect((await leerSolicitudes(e.A.id)).map((s) => s.ip_origen).sort(), 'dirección exacta, no el bloque').toEqual(
      [...origenes].sort(),
    );
    const antes = await estadoDeLaBase();

    const sexta = await enviar(direccion(6));

    expect([sexta.status, codigoDe(sexta)], sexta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
    expect(await estadoDeLaBase(), 'el 409 no escribe ni audita').toEqual(antes);
    expect(await leerAlumnos(e.A.id)).toHaveLength(5);
    const otroBloque = await enviar('2001:db8:1:3::1');
    expect(otroBloque.status, otroBloque.texto).toBe(201);
  });

  it('criterio 60 a: con 4 activas del bloque, la quinta desde otra dirección del mismo bloque todavía entra (el límite es 5)', async () => {
    await sembrarActivas(2, direccion(1));
    await sembrarActivas(2, direccion(2));

    const quinta = await enviar(direccion(3));

    expect(quinta.status, quinta.texto).toBe(201);
  });

  it('criterio 60 b: 5 activas desde 203.0.113.7 frenan a ::ffff:203.0.113.7 (409) y no a 203.0.113.8 (201)', async () => {
    await sembrarActivas(5, '203.0.113.7');

    const mapeada = await enviar('::ffff:203.0.113.7');
    const otra = await enviar('203.0.113.8');

    expect([mapeada.status, codigoDe(mapeada)], mapeada.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
    expect(otra.status, otra.texto).toBe(201);
  });

  it('criterio 60 b: al revés, 5 activas guardadas como ::ffff:203.0.113.7 frenan a 203.0.113.7 (409)', async () => {
    await sembrarActivas(5, '::ffff:203.0.113.7');

    const respuesta = await enviar('203.0.113.7');

    expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
  });

  it('criterio 60 b: las activas de una IPv4 no cuentan para otras IPv4 ni para el bloque ::/64 de la IPv6 de loopback (::1)', async () => {
    await sembrarActivas(5, '203.0.113.7');

    expect((await enviar('203.0.113.70')).status).toBe(201);
    expect((await enviar('::1')).status).toBe(201);
  });

  it('criterio 60 c (control): con solo cuatro activas escritas como dueño en el bloque, un envío desde 2001:db8:1:2::1 entra', async () => {
    await sembrarActivas(4, '2001:db8:1:2::1');

    const conCuatro = await enviar('2001:db8:1:2::1');

    expect(conCuatro.status, conCuatro.texto).toBe(201);
  });

  it('criterio 60 c: con cuatro activas en otras direcciones del bloque y una con ip_origen 2001:db8:1:2::abcd, un envío desde 2001:db8:1:2::1 responde 409', async () => {
    await sembrarActivas(2, '2001:db8:1:2::10');
    await sembrarActivas(2, '2001:db8:1:2::ffff:1');
    await sembrarActivas(1, '2001:db8:1:2::abcd');

    const respuesta = await enviar('2001:db8:1:2::1');

    expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
  });

  it('criterio 60 d: con 4 activas en el bloque y dos envíos simultáneos desde dos direcciones distintas del mismo /64 (DNI distintos), exactamente uno responde 201 y el otro 409 LIMITE_DE_RESERVAS_PENDIENTES; nunca 500', async () => {
    await sembrarActivas(4, direccion(9));
    const uno = await cuerpoInscripcion(e);
    const dos = await cuerpoInscripcion(e);

    const { resultados, todasEsperaron } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerClases([e.lunes.id], e.A.id),
      enviar: [
        () => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), uno, { headers: desde(direccion(1)) }),
        () => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), dos, { headers: desde(direccion(2)) }),
      ],
      liberar: 'ROLLBACK',
    });

    expect(todasEsperaron, 'los dos envíos estaban en curso a la vez').toBe(true);
    const estados = resultados.map((r) => r.status).sort();
    expect(estados, resultados.map((r) => r.texto).join(' | ')).toEqual([201, 409]);
    const rechazado = resultados.find((r) => r.status === 409);
    expect(rechazado && codigoDe(rechazado)).toBe('LIMITE_DE_RESERVAS_PENDIENTES');
    expect(await leerSolicitudes(e.A.id)).toHaveLength(5);
  });

  it('criterio 60 d: sin retención, dos envíos simultáneos con el límite a un paso desde el mismo /64 nunca dan 500 ni dos 201', async () => {
    await sembrarActivas(4, direccion(9));
    const cuerpos = [await cuerpoInscripcion(e), await cuerpoInscripcion(e)];

    const resultados = await Promise.all(
      cuerpos.map((cuerpo, i) =>
        ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo, { headers: desde(direccion(i + 1)) }),
      ),
    );

    expect(resultados.map((r) => r.status).sort(), resultados.map((r) => r.texto).join(' | ')).toEqual([201, 409]);
  });

  describe('e: lo que sigue sin contar', () => {
    it('criterio 60 e: las vencidas, las canceladas y las de otra academia del mismo bloque no cuentan: con 4 activas y otras tantas inactivas o de B, la quinta entra y la sexta se frena', async () => {
      await sembrarActivas(4, direccion(1));
      for (const estado of ['PENDIENTE_PAGO_VENCIDA', 'VENCIDA', 'CANCELADA', 'CANCELADA'] as const) {
        await sembrarSolicitud(e.A.id, {
          planId: e.plan.id,
          claseIds: [e.lunes.id],
          ipOrigen: direccion(2),
          estado,
          dni: dniInventado(),
        });
      }
      await sembrarActivas(5, direccion(3), e.B.id);

      const quinta = await enviar(direccion(4));
      expect(quinta.status, quinta.texto).toBe(201);
      const sexta = await enviar(direccion(5));

      expect([sexta.status, codigoDe(sexta)], sexta.texto).toEqual([409, 'LIMITE_DE_RESERVAS_PENDIENTES']);
    });

    it('criterio 60 e: las 5 activas de B en el mismo bloque no frenan a A', async () => {
      await sembrarActivas(5, direccion(1), e.B.id);

      const respuesta = await enviar(direccion(2), 'academia-a');

      expect(respuesta.status, respuesta.texto).toBe(201);
    });
  });
});
