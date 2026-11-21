// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  type AppInscripciones,
  AHORA_005,
  buscarTextoEnBase,
  cancelarTodasLasReservas,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  FORMATO_CODIGO,
  FORMATO_TOKEN,
  leerSolicitudes,
  rutaPublica,
  sha256,
  solicitudDe,
  type SolicitudCreada,
} from '../../utilidades/inscripciones';

// Criterio 24 (crítico, D-05, D-07): el código es `AQ-` y 6 caracteres de Crockford en mayúsculas (sin I, L, O ni U) con un generador
// criptográfico, único por academia; el token son 32 bytes criptográficos en base64url sin relleno (43 caracteres); en la base solo se
// guarda su SHA-256 (token_hash), nunca el token. El token en claro aparece solo en la respuesta 201 y en el correo; nunca en la base ni en
// la auditoría. Prueba: 1000 envíos dan 1000 tokens y códigos distintos, sin orden ni prefijo común entre envíos seguidos.
// (Las reservas se cancelan cada cuatro envíos, como dueño, para no chocar con el límite de 5 reservas por conexión del criterio 25.)

const ENVIOS = 1000;

function prefijoComun(a: string, b: string): number {
  let largo = 0;
  while (largo < a.length && a.charAt(largo) === b.charAt(largo)) largo += 1;
  return largo;
}

describe('código y token de la solicitud: 1000 envíos (criterio 24)', { timeout: 600_000 }, () => {
  let ctx: AppInscripciones | undefined;
  let e: EscenarioInscripcion;
  let preparacion: Promise<SolicitudCreada[]> | undefined;

  /**
   * Los 1000 envíos se hacen una sola vez, la primera vez que una prueba los pide; si algo falla (falta la migración, la ruta), cada
   * prueba falla por sí misma con ese error (no se deja nada omitido en un `beforeAll`).
   */
  function preparar(): Promise<SolicitudCreada[]> {
    preparacion ??= (async () => {
      await exigirTablasDeInscripcion();
      ctx = await crearAppInscripciones();
      ctx.reloj.fijar(AHORA_005);
      e = await crearEscenarioInscripcion();
      const creadas: SolicitudCreada[] = [];
      for (let i = 0; i < ENVIOS; i++) {
        const respuesta = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e));
        if (respuesta.status !== 201)
          throw new Error(`El envío ${i + 1} respondió ${respuesta.status}: ${respuesta.texto}`);
        creadas.push(solicitudDe(respuesta));
        if ((i + 1) % 4 === 0) await cancelarTodasLasReservas(e.A.id);
      }
      return creadas;
    })();
    return preparacion;
  }
  afterAll(async () => {
    await ctx?.http.cerrar();
  });
  it('criterio 24: 1000 envíos dan 1000 códigos distintos y 1000 tokens distintos, todos con el formato del contrato', async () => {
    const creadas = await preparar();
    expect(new Set(creadas.map((c) => c.codigo)).size).toBe(ENVIOS);
    expect(new Set(creadas.map((c) => c.token)).size).toBe(ENVIOS);
    for (const { codigo, token } of creadas) {
      expect(codigo).toMatch(FORMATO_CODIGO);
      expect(token).toMatch(FORMATO_TOKEN);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('criterio 24: los códigos y los tokens de envíos seguidos no comparten prefijo ni siguen un orden (son aleatorios)', async () => {
    const creadas = await preparar();
    let prefijoMaximoToken = 0;
    let prefijoMaximoCodigo = 0;
    let tokensCrecientes = 0;
    let codigosCrecientes = 0;
    for (let i = 1; i < creadas.length; i++) {
      const anterior = creadas[i - 1] as SolicitudCreada;
      const actual = creadas[i] as SolicitudCreada;
      prefijoMaximoToken = Math.max(prefijoMaximoToken, prefijoComun(anterior.token, actual.token));
      prefijoMaximoCodigo = Math.max(
        prefijoMaximoCodigo,
        prefijoComun(anterior.codigo.slice(3), actual.codigo.slice(3)),
      );
      if (actual.token > anterior.token) tokensCrecientes += 1;
      if (actual.codigo > anterior.codigo) codigosCrecientes += 1;
    }

    expect(prefijoMaximoToken, 'prefijo común máximo entre tokens seguidos').toBeLessThanOrEqual(3);
    expect(prefijoMaximoCodigo, 'prefijo común máximo entre códigos seguidos').toBeLessThanOrEqual(4);
    const pares = ENVIOS - 1;
    for (const crecientes of [tokensCrecientes, codigosCrecientes]) {
      expect(crecientes / pares, 'proporción de pares crecientes').toBeGreaterThan(0.4);
      expect(crecientes / pares).toBeLessThan(0.6);
    }
  });

  it('criterio 24: la base guarda el código de cada solicitud y solo el SHA-256 de su token (32 bytes), nunca el token', async () => {
    const creadas = await preparar();
    const filas = await leerSolicitudes(e.A.id);

    expect(filas).toHaveLength(ENVIOS);
    expect(new Set(filas.map((f) => f.codigo)).size).toBe(ENVIOS);
    const hashesEsperados = new Set(creadas.map((c) => sha256(c.token).toString('hex')));
    const hashesGuardados = new Set(filas.map((f) => f.token_hash.toString('hex')));
    expect(hashesGuardados).toEqual(hashesEsperados);
    expect(filas.every((f) => f.token_hash.length === 32)).toBe(true);
    for (const muestra of [creadas[0], creadas[499], creadas[999]] as SolicitudCreada[]) {
      expect(
        await buscarTextoEnBase(e.A.id, muestra.token),
        'el token en claro no está en ninguna tabla ni en la auditoría',
      ).toBe(0);
    }
  });

  it('criterio 24: la auditoría de los 1000 envíos no lleva ningún token', async () => {
    const creadas = await preparar();
    const filas = await leerAuditoriaDeAcademia(e.A.id, 'SOLICITUD_INSCRIPCION_CREADA');
    const texto = JSON.stringify(filas);

    expect(filas).toHaveLength(ENVIOS);
    for (const muestra of [creadas[0], creadas[250], creadas[750], creadas[999]] as SolicitudCreada[]) {
      expect(texto).not.toContain(muestra.token);
    }
  });
});
