// spec: 006-caja (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  enLima,
  type EscenarioCaja,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  conexionesInactivasEnTransaccion,
  crearAppHistorial,
  exigirGeneradorInyectable,
  exigirRutasDeHistorial,
  PDF_FALSO,
  type RespuestaHistorial,
  rutaPdf,
} from '../../utilidades/caja-historial';
import {
  cookieDeLargaDuracion,
  crearCajaDeHoyCerrada,
  fotoDeEscrituras,
  renombrarAcademia,
} from '../../utilidades/caja-pdf-academias';
import { esperarHasta, pausa } from '../../utilidades/caja-pdf-concurrencia';
import {
  comoGeneradorDePrueba,
  datosDeLlamada,
  esperarCondicion,
  GeneradorConSenal,
} from '../../utilidades/caja-pdf-senal';
import { conLimite, observar } from '../../utilidades/planes-clases';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 53 (crítico, ronda adversarial 2 de la 006b; amplía el criterio 49 b, PQ1 y PQ2; DT-12; sección 2.1): la sesión se vuelve a comprobar
// después de la espera. Una descarga puede esperar turno decenas de segundos: si mientras espera desactivan a la persona, cierra su sesión, le
// restablecen la contraseña, le cambian el rol o suspenden la academia, no recibe el PDF.
//   a) Cuándo: al obtener el turno y antes de la lectura (entre los pasos 5 y 6 de 49 b), siempre.
//   b) Qué: lo mismo que comprueba una petición nueva con la misma cookie, en el orden de PQ1: 1. sesión (401 NO_AUTENTICADO); 2. academia activa
//      (403 ACADEMIA_SUSPENDIDA); 3. sin cambio de contraseña pendiente (403 CAMBIO_DE_CLAVE_OBLIGATORIO); 4. el rol vigente tiene
//      VER_REPORTES_FINANCIEROS (403 SIN_PERMISO). La respuesta es la misma que daría una petición nueva con esa cookie (estado y cuerpo JSON entero),
//      con `Cache-Control: no-store` y sin `Content-Disposition`.
//   c) Con lo vigente: si pasa, el alcance de PQ2 se calcula con el rol vigente y el nombre de la academia del PDF es el vigente.
//   d) Es una lectura: no bloquea, no escribe ni audita.
//   e) Si falla: libera su lugar y sus cupos, sin leer la caja ni llamar al generador.
//   g) Pruebas, con el generador retenido: dos descargas del ADMIN de B ocupan los dos lugares y la SECRETARIA de A que abrió la caja (S1) lanza una
//      descarga, que espera; con la descarga esperando, la prueba hace un cambio y suelta el generador. En cada caso: la respuesta es igual, en estado y
//      cuerpo, a la de una petición nueva con la misma cookie hecha justo después; el generador no recibió su llamada; fuera del cambio que hizo la
//      prueba, no cambia ninguna fila ni la auditoría; y su lugar queda libre: otra descarga que esperaba entra al generador. Control: sin cambios,
//      la descarga responde 200.

const AHORA_DE_NOVIEMBRE = AHORA_PRUEBAS.getTime();
const HORA_EN_MS = 3600 * 1000;

interface Contexto {
  e: EscenarioCaja;
  cookies: ReturnType<typeof cookiesDeCaja>;
  ctx: AppHistorial;
  /** La caja de hoy de A, cerrada: la ven todas las personas de A con permiso (DR-13). */
  kA: { id: string };
  /** Una caja de un día anterior de A, abierta y cerrada por la SECRETARIA S2 (como C1 de PQ2): fuera del alcance de S1 y de un ADMIN que pase a SECRETARIA. */
  kVieja: { id: string };
}

interface Caso {
  nombre: string;
  /** La cookie de quien descarga (por defecto, la de S1, la SECRETARIA de A que abrió la caja). */
  descarga?: (c: Contexto) => { cookie: string; cajaId: string };
  cambiar: (c: Contexto) => Promise<void>;
  estado: number;
  codigo: string;
}

const exito = (respuesta: RespuestaHistorial, contexto: string) => {
  expect(respuesta.status, `${contexto}: ${respuesta.texto.slice(0, 300)}`).toBeGreaterThanOrEqual(200);
  expect(respuesta.status, `${contexto}: ${respuesta.texto.slice(0, 300)}`).toBeLessThan(300);
};

const CASOS: Caso[] = [
  {
    nombre: 'desactivan a S1 (el ADMIN de A, por la API)',
    cambiar: async ({ ctx, e, cookies }) => {
      const r = await ctx.http.enviar('POST', `/api/usuarios/${e.secretariaA.id}/desactivar`, cookies.admin, {});
      exito(r, 'desactivar a S1 por la API');
    },
    estado: 401,
    codigo: 'NO_AUTENTICADO',
  },
  {
    nombre: 'S1 cierra su sesión con su cookie (DELETE /api/sesion, que sube version_token)',
    cambiar: async ({ ctx, cookies }) => {
      const r = await ctx.http.enviar('DELETE', '/api/sesion', cookies.secretaria);
      exito(r, 'DELETE /api/sesion de S1');
    },
    estado: 401,
    codigo: 'NO_AUTENTICADO',
  },
  {
    nombre: 'suben version_token de S1 como dueño de las tablas',
    cambiar: async ({ e }) => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { version_token: 1 });
    },
    estado: 401,
    codigo: 'NO_AUTENTICADO',
  },
  {
    nombre: 'adelantan RELOJ más allá del vencimiento del token de S1',
    cambiar: ({ ctx }) => {
      // El token del personal dura 12 horas; a las 13 horas sigue siendo el mismo día de Lima (hoy 23:00).
      ctx.reloj.fijar(new Date(AHORA_DE_NOVIEMBRE + 13 * HORA_EN_MS));
      return Promise.resolve();
    },
    estado: 401,
    codigo: 'NO_AUTENTICADO',
  },
  {
    nombre: 'el Superadmin suspende la academia A (por la API)',
    cambiar: async ({ ctx, e }) => {
      const cookieDelSuperadmin = cookieDeSesion(e.superadmin, AHORA_PRUEBAS);
      const r = await ctx.http.enviar('POST', `/api/plataforma/academias/${e.A.id}/suspender`, cookieDelSuperadmin, {
        motivo: 'Falta de pago',
      });
      exito(r, 'suspender la academia A');
    },
    estado: 403,
    codigo: 'ACADEMIA_SUSPENDIDA',
  },
  {
    nombre: 'ponen debe_cambiar_clave = true en S1 como dueño',
    cambiar: async ({ e }) => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { debe_cambiar_clave: true });
    },
    estado: 403,
    codigo: 'CAMBIO_DE_CLAVE_OBLIGATORIO',
  },
  {
    nombre: 'cambian el rol de S1 a ENTRENADOR como dueño',
    cambiar: async ({ e }) => {
      await actualizarUsuario(e.A.id, e.secretariaA.id, { rol: 'ENTRENADOR' });
    },
    estado: 403,
    codigo: 'SIN_PERMISO',
  },
  {
    nombre:
      'un ADMIN de A que espera el PDF de una caja fuera del alcance de una SECRETARIA pasa a SECRETARIA (como dueño)',
    descarga: ({ cookies, kVieja }) => ({ cookie: cookies.admin, cajaId: kVieja.id }),
    cambiar: async ({ e }) => {
      await actualizarUsuario(e.A.id, e.adminA.id, { rol: 'SECRETARIA' });
    },
    estado: 404,
    codigo: 'NO_ENCONTRADO',
  },
];

describe('la sesión se vuelve a comprobar después de la espera (criterio 53)', () => {
  const generador = new GeneradorConSenal();
  let ctx: AppHistorial;
  let c: Contexto;
  let kB: { id: string };
  let lanzadas: Promise<unknown>[];

  beforeAll(async () => {
    ctx = await crearAppHistorial(AHORA_PRUEBAS, comoGeneradorDePrueba(generador));
  });
  beforeEach(async () => {
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    generador.restablecer();
    lanzadas = [];
    ctx.reloj.fijar(AHORA_PRUEBAS);
    const e = await crearEscenarioDeCaja();
    const kA = await crearCajaDeHoyCerrada(e.A.id, e.secretariaA.id, e.adminA.id, '100.00');
    kB = await crearCajaDeHoyCerrada(e.B.id, e.secretariaB.id, e.adminB.id, '50.00');
    // C1 de PQ2: un día anterior, la abrió y la cerró S2 (la otra SECRETARIA de A): fuera del alcance de S1 y de una SECRETARIA que no sea S2.
    const kVieja = await crearCajaDePrueba(e.A.id, e.secretariaA2.id, { fecha: '2026-11-03', monto_inicial: '70.00' });
    await cerrarCajaDePrueba(e.A.id, kVieja.id, e.secretariaA2.id, { cerradoEn: enLima('2026-11-03', '18:00:00') });
    c = { e, cookies: cookiesDeCaja(e), ctx, kA, kVieja };
  });
  afterEach(async () => {
    // Pase lo que pase en la prueba, ninguna descarga queda colgada del generador ni ocupando un lugar de la cola del proceso.
    generador.liberar();
    await Promise.race([Promise.allSettled(lanzadas), pausa(15_000)]);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const lanzar = (cajaId: string, cookie: string) => {
    const descarga = observar(ctx.http.get(rutaPdf(cajaId, 1), cookie));
    lanzadas.push(descarga.resultado);
    return descarga;
  };

  /**
   * La preparación de la spec (53 g): dos descargas del ADMIN de B ocupan los dos lugares; la descarga de quien se prueba (S1 por defecto) espera; y
   * detrás espera otra descarga (de la SECRETARIA de B, con una sesión de larga duración para que siga valiendo si la prueba adelanta `RELOJ`).
   */
  async function prepararEspera(descarga: { cookie: string; cajaId: string }) {
    const delAdminB = [lanzar(kB.id, c.cookies.adminB), lanzar(kB.id, c.cookies.adminB)];
    await conLimite(generador.esperarEnCurso(2), 'las dos descargas del ADMIN de B no llegaron al generador');
    const deS1 = lanzar(descarga.cajaId, descarga.cookie);
    await pausa(150);
    const otra = lanzar(kB.id, cookieDeLargaDuracion(c.e.secretariaB));
    await pausa(300);
    expect(deS1.terminada(), 'la descarga de S1 espera su turno').toBe(false);
    expect(otra.terminada(), 'la otra descarga espera su turno').toBe(false);
    expect(generador.llamadas, 'solo las dos del ADMIN de B están en el generador').toHaveLength(2);
    return { delAdminB, deS1, otra };
  }

  describe.each(CASOS)('si, mientras espera, $nombre', (caso) => {
    it(`responde ${caso.estado} ${caso.codigo}, igual que una petición nueva con la misma cookie, sin llamar al generador, sin cambiar nada más y liberando su lugar`, async () => {
      const descarga = caso.descarga?.(c) ?? { cookie: c.cookies.secretaria, cajaId: c.kA.id };
      const { delAdminB, deS1, otra } = await prepararEspera(descarga);

      await caso.cambiar(c);
      const despuesDelCambio = await fotoDeEscrituras([c.e.A.id, c.e.B.id], { incluirUsuarios: true });

      // Se suelta una de las dos del ADMIN de B: el turno pasa a S1, que vuelve a comprobar su sesión.
      expect(generador.soltarUno(), 'se suelta la primera descarga del ADMIN de B').toBe(0);
      const respondio = await esperarHasta(deS1.resultado, 3000);
      expect(
        respondio,
        `la descarga de S1 no respondió al llegarle el turno: la sesión no se volvió a comprobar y la descarga siguió hasta el generador (llamadas al generador: ${generador.llamadas.length})`,
      ).toBeDefined();
      const respuesta = respondio as RespuestaHistorial;

      // Su lugar queda libre: la otra descarga que esperaba entra al generador (la 3.ª llamada, de la caja de B).
      expect(
        await esperarCondicion(() => generador.llamadas.length >= 3, 3000),
        `su lugar debe quedar libre: la otra descarga que esperaba no entró al generador (llamadas: ${generador.llamadas.length})`,
      ).toBe(true);

      // La respuesta es la que dio la comprobación de la sesión: el estado y el cuerpo esperados, con `no-store` y sin `Content-Disposition`.
      expect(
        respuesta.status,
        `la descarga de S1 respondió ${respuesta.status}: ${respuesta.texto.slice(0, 200)}`,
      ).toBe(caso.estado);
      expect(codigoDe(respuesta)).toBe(caso.codigo);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(respuesta.headers.get('content-disposition')).toBeNull();
      expect(respuesta.headers.get('content-type') ?? '').toContain('application/json');

      // El generador no recibió su llamada: solo tiene las dos del ADMIN de B y la de la otra descarga (todas de la academia B).
      expect(generador.llamadas, 'el generador no recibió la llamada de S1').toHaveLength(3);
      for (const llamada of generador.llamadas) {
        expect(datosDeLlamada(llamada).caja.id, 'todas las llamadas son de la caja de B').toBe(kB.id);
      }

      // Se suelta todo y se compara con una petición nueva con la misma cookie hecha justo después.
      const terminaron = await generador.soltarHastaQueTerminen([...delAdminB, otra].map((d) => d.resultado));
      expect(terminaron).toBe(true);
      expect((await otra.resultado).status, 'la otra descarga responde 200').toBe(200);
      generador.liberar();
      const nueva = await ctx.http.get(rutaPdf(descarga.cajaId, 1), descarga.cookie);
      expect(respuesta.status, 'el mismo estado que una petición nueva').toBe(nueva.status);
      expect(respuesta.body, 'el mismo cuerpo JSON entero que una petición nueva').toEqual(nueva.body);
      expect(respuesta.cacheControl).toBe(nueva.cacheControl);

      // Fuera del cambio que hizo la prueba, no cambia ninguna fila ni la auditoría; y nadie queda idle in transaction.
      expect(
        await fotoDeEscrituras([c.e.A.id, c.e.B.id], { incluirUsuarios: true }),
        'fuera del cambio de la prueba, no cambia ninguna fila ni la auditoría',
      ).toEqual(despuesDelCambio);
      expect(await conexionesInactivasEnTransaccion()).toEqual([]);
    });
  });

  it('control: sin cambios, la descarga de S1 que esperaba responde 200 con el PDF y llama una vez al generador', async () => {
    const { delAdminB, deS1 } = await prepararEspera({ cookie: c.cookies.secretaria, cajaId: c.kA.id });
    const antes = await fotoDeEscrituras([c.e.A.id, c.e.B.id], { incluirUsuarios: true });

    const terminaron = await generador.soltarHastaQueTerminen([...delAdminB, deS1].map((d) => d.resultado));

    expect(terminaron).toBe(true);
    const respuesta = await deS1.resultado;
    expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(200);
    expect(respuesta.cuerpo.equals(PDF_FALSO)).toBe(true);
    expect(generador.llamadas.filter((l) => datosDeLlamada(l).caja.id === c.kA.id)).toHaveLength(1);
    expect(await fotoDeEscrituras([c.e.A.id, c.e.B.id], { incluirUsuarios: true })).toEqual(antes);
    expect(await conexionesInactivasEnTransaccion()).toEqual([]);
  });

  it('criterio 53 c: con lo vigente: si la comprobación pasa, el PDF lleva el nombre vigente de la academia (el que tenía al llegarle el turno, no el de cuando entró)', async () => {
    const { delAdminB, deS1 } = await prepararEspera({ cookie: c.cookies.secretaria, cajaId: c.kA.id });
    await renombrarAcademia(c.e.A.id, 'Academia A con otro nombre');

    const terminaron = await generador.soltarHastaQueTerminen([...delAdminB, deS1].map((d) => d.resultado));

    expect(terminaron).toBe(true);
    expect((await deS1.resultado).status).toBe(200);
    const llamadaDeS1 = generador.llamadas.find((l) => datosDeLlamada(l).caja.id === c.kA.id);
    expect(llamadaDeS1, 'el generador recibió la llamada de S1').toBeDefined();
    expect(datosDeLlamada(llamadaDeS1 as { datos: unknown }).academia).toBe('Academia A con otro nombre');
  });
});
