// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import {
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  conRetencion,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  EnviadorDePrueba,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  leerMatriculas,
  leerSolicitudes,
  llenarClase,
  retenerClases,
  rutaPublica,
  solicitudDe,
} from '../../utilidades/inscripciones';

// Criterio 27 (crítico, D-05, D-19): si el formulario trae correo, DESPUÉS de confirmar la transacción se llama una vez a
// `EnviadorCorreo.enviar` con el enlace de seguimiento y el código. Si la transacción falla, no se llama. Si el envío del correo falla,
// la respuesta sigue siendo 201 y el fallo queda en el registro técnico (sin el destinatario ni el enlace).

describe('envío: el correo se envía después de confirmar (criterio 27)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  const correo = new EnviadorDePrueba();
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  const DIRECCION = 'familia.reservada@ejemplo.test';

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ correo, nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    correo.mensajes.length = 0;
    correo.fallar = false;
    correo.alEnviar = undefined;
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
  const conCorreo = (sobre = {}) => cuerpoInscripcion(e, { sobre: { alumno: { correo: DIRECCION }, ...sobre } });

  it('criterio 27: con correo, se llama una vez a enviar con la academia, el destinatario, la plantilla SEGUIMIENTO_SOLICITUD y el código y el enlace de seguimiento', async () => {
    const respuesta = await enviar(await conCorreo());

    expect(respuesta.status, respuesta.texto).toBe(201);
    const solicitud = solicitudDe(respuesta);
    expect(correo.mensajes).toHaveLength(1);
    const [mensaje] = correo.mensajes;
    expect(mensaje).toMatchObject({ academiaId: e.A.id, para: DIRECCION, plantilla: 'SEGUIMIENTO_SOLICITUD' });
    const valores = Object.values(mensaje?.datos ?? {});
    expect(valores, 'el código viaja en los datos').toContain(solicitud.codigo);
    expect(
      valores.some((valor) => valor.includes(solicitud.token) || valor.includes(solicitud.enlace)),
      'el enlace (con el token) viaja en los datos',
    ).toBe(true);
  });

  it('criterio 27: sin correo en el formulario no se llama a enviar', async () => {
    const respuesta = await enviar(await cuerpoInscripcion(e));

    expect(respuesta.status, respuesta.texto).toBe(201);
    expect(correo.mensajes).toEqual([]);
  });

  it('criterio 27: se llama después de confirmar: cuando el enviador recibe el mensaje, la solicitud y la matrícula ya están guardadas y visibles', async () => {
    let vistoAlEnviar: { solicitudes: number; matriculas: number } | undefined;
    correo.alEnviar = async () => {
      vistoAlEnviar = {
        solicitudes: (await leerSolicitudes(e.A.id)).length,
        matriculas: (await leerMatriculas(e.A.id)).length,
      };
    };

    const respuesta = await enviar(await conCorreo());

    expect(respuesta.status, respuesta.texto).toBe(201);
    // La respuesta no espera al correo (criterio 51): se espera a que `alEnviar` termine antes de mirar lo que vio.
    await esperarHasta(() => vistoAlEnviar !== undefined);
    expect(vistoAlEnviar).toEqual({ solicitudes: 1, matriculas: 1 });
  });

  it('criterio 27: si el envío rechaza el formulario (400 o 409) no se llama a enviar', async () => {
    await llenarClase(e.A.id, e.viernes.id, e.plan.id, 20);

    const casos = [
      await conCorreo({ alumno: { dni: '1' } }), // 400
      await conCorreo({ consentimientos: { version: 'vieja' } }), // 409 TEXTOS_ACTUALIZADOS
      await conCorreo({ inscripcion: { mes: '2026-12' } }), // 409 MES_CAMBIO
      await conCorreo(), // 409 SIN_CUPO (el viernes está lleno)
    ];
    for (const cuerpo of casos) await enviar(cuerpo);

    expect(correo.mensajes).toEqual([]);
  });

  it('criterio 27: dos envíos simultáneos con el mismo DNI y correo: uno confirma y el otro falla; solo el que confirmó envía el correo', async () => {
    const base = await conCorreo();
    const segundo = { ...base, claveIdempotencia: '0b8c2a54-3d7e-4f61-9a20-5c1e7d8f9a01' };

    const { resultados } = await conRetencion({
      academiaId: e.A.id,
      retener: retenerClases([e.lunes.id], e.A.id),
      enviar: [() => enviar(base), () => enviar(segundo)],
      liberar: 'ROLLBACK',
    });

    expect(resultados.map((r) => r.status).sort()).toEqual([201, 409]);
    const rechazo = resultados.find((r) => r.status === 409);
    expect(rechazo && codigoDe(rechazo)).toBe('DNI_YA_REGISTRADO');
    expect(correo.mensajes).toHaveLength(1);
  });

  it('criterio 27: si el envío del correo falla, la respuesta sigue siendo 201, la solicitud queda creada y el fallo queda en el registro técnico sin el destinatario ni el enlace', async () => {
    correo.fallar = true;
    const antes = lineas.length;

    const respuesta = await enviar(await conCorreo());

    expect(respuesta.status, respuesta.texto).toBe(201);
    expect(await leerSolicitudes(e.A.id)).toHaveLength(1);
    await esperarHasta(() => lineas.slice(antes).some((linea) => /"level":(40|50)/.test(linea)));
    const nuevas = lineas.slice(antes);
    expect(
      nuevas.some((linea) => /"level":(40|50)/.test(linea)),
      'el fallo del correo queda registrado como aviso o error',
    ).toBe(true);
    const solicitud = solicitudDe(respuesta);
    const texto = nuevas.join('\n');
    expect(texto).not.toContain(DIRECCION);
    expect(texto).not.toContain(solicitud.token);
    expect(texto).not.toContain(solicitud.enlace);
    expect(texto).not.toContain('ejemplo.test');
  });

  it('criterio 27: el correo no cambia lo que se responde: con y sin fallo, la respuesta 201 trae la misma forma', async () => {
    const bien = solicitudDe(await enviar(await conCorreo()));
    correo.fallar = true;
    const mal = solicitudDe(await enviar(await conCorreo()));

    expect(Object.keys(mal).sort()).toEqual(Object.keys(bien).sort());
  });
});
