// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import {
  actualizarFilas,
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  conRetencion,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  cuerpoInscripcionMenor,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  llenarClase,
  type MensajeDeCorreo,
  type Objeto,
  retenerClases,
  rutaPublica,
  sembrarSolicitud,
  solicitudDe,
  variante,
} from '../../utilidades/inscripciones';
import { EnviadorProgramable, medir } from '../../utilidades/inscripciones-ronda1';

// Criterio 57 (crítico, D-05, D-19, DR-13, RN-20, Ley 29733; criterios 27, 51 y 52; respuesta R2, ronda 1): después de confirmar, el envío llama
// a `EnviadorCorreo.enviar` una vez por cada destinatario distinto, con la misma plantilla `SEGUIMIENTO_SOLICITUD`, el mismo código y el mismo
// enlace: el correo del alumno, si lo dio, y, si es menor y el apoderado dio correo, el del apoderado. "Distinto" se compara con los correos ya
// normalizados por el esquema (recortados y en minúsculas), sin otras equivalencias.
//   a) menor con correo propio y del apoderado, distintos: dos llamadas, una con cada `para`;
//   b) menor con `Familia@Correo.test` en el alumno y ` familia@correo.test ` en el apoderado: una sola llamada;
//   c) menor sin correo propio y con correo del apoderado: una llamada, al apoderado; menor con correo propio y sin correo del apoderado: una, al
//      alumno; sin ninguno: ninguna;
//   d) mayor de edad con correo: una, al alumno (no hay apoderado, criterio 13);
//   e) cliente que vuelve (criterio 21 b): se usan los correos del formulario nuevo, no los guardados antes;
//   f) los criterios 51 y 52 valen para cada envío: con el envío al alumno colgado y el del apoderado fallando (y al revés), la respuesta es el
//      mismo 201 sin demora, los dos envíos se iniciaron, y el registro técnico tiene una línea de fallo con solo el tipo del error, sin ninguno
//      de los dos destinatarios, el enlace ni el token; el envío simulado deja una línea por envío, sin destinatario;
//   g) un rechazo (400, 409, 429), un reintento con la misma `claveIdempotencia` (criterio 23) o el envío que pierde una carrera (criterio 22)
//      no llaman a `enviar` para ninguno de los dos.

const ALUMNO = 'mateo.alumno@ejemplo.test';
const APODERADO = 'rosa.apoderada@ejemplo.test';
const LIMITE_MS = 2000;

describe('el enlace llega al alumno y al apoderado (criterio 57)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  const correo = new EnviadorProgramable();
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ correo, nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    correo.reiniciar();
    e = await crearEscenarioInscripcion();
  });
  afterEach(() => {
    correo.liberar();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
  const menor = (alumno?: string, apoderado?: string, sobre: Objeto = {}) =>
    cuerpoInscripcionMenor(e, {
      sobre: variante({ alumno: { correo: alumno }, apoderado: { correo: apoderado } }, sobre),
    });
  const paraDe = () => correo.mensajes.map((mensaje) => mensaje.para).sort();

  describe('a a d: quién recibe el enlace', () => {
    it('criterio 57 a: un menor con correo propio y del apoderado, distintos, genera dos llamadas, una con cada destinatario, con la misma plantilla, el mismo código y el mismo enlace', async () => {
      const respuesta = await enviar(await menor(ALUMNO, APODERADO));

      expect(respuesta.status, respuesta.texto).toBe(201);
      const solicitud = solicitudDe(respuesta);
      expect(correo.mensajes).toHaveLength(2);
      expect(paraDe()).toEqual([ALUMNO, APODERADO].sort());
      for (const mensaje of correo.mensajes) {
        expect(mensaje).toMatchObject({ academiaId: e.A.id, plantilla: 'SEGUIMIENTO_SOLICITUD' });
        const valores = Object.values(mensaje.datos);
        expect(valores, 'el código').toContain(solicitud.codigo);
        expect(
          valores.some((valor) => valor.includes(solicitud.enlace)),
          'el enlace',
        ).toBe(true);
      }
    });

    it('criterio 57 b: el mismo correo en el alumno ("Familia@Correo.test") y en el apoderado (" familia@correo.test ") se normaliza y genera una sola llamada', async () => {
      const respuesta = await enviar(await menor('Familia@Correo.test', ' familia@correo.test '));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(paraDe()).toEqual(['familia@correo.test']);
    });

    it('criterio 57 c: un menor sin correo propio y con correo del apoderado genera una llamada, al apoderado', async () => {
      const respuesta = await enviar(await menor(undefined, APODERADO));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(paraDe()).toEqual([APODERADO]);
    });

    it('criterio 57 c: un menor con correo propio y sin correo del apoderado genera una llamada, al alumno', async () => {
      const respuesta = await enviar(await menor(ALUMNO, undefined));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(paraDe()).toEqual([ALUMNO]);
    });

    it('criterio 57 c: un menor sin ningún correo no genera llamadas', async () => {
      const respuesta = await enviar(await menor(undefined, undefined));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(correo.mensajes).toEqual([]);
    });

    it('criterio 57 d: un mayor de edad con correo genera una llamada, al alumno', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e, { sobre: { alumno: { correo: ALUMNO } } }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(paraDe()).toEqual([ALUMNO]);
    });

    it('criterio 57: dos correos que solo se parecen (puntos, etiquetas "+", otro dominio) son distintos: se envían los dos', async () => {
      const respuesta = await enviar(await menor('rosa.apoderada@ejemplo.test', 'rosaapoderada@ejemplo.test'));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(correo.mensajes).toHaveLength(2);
    });
  });

  describe('e: el cliente que vuelve', () => {
    /** Un cliente menor con una solicitud vencida y correos guardados antes (alumno y apoderado). */
    async function clienteQueVuelve() {
      const antes = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
        estado: 'VENCIDA',
        conApoderado: true,
      });
      await actualizarFilas(
        'propietario',
        'alumnos',
        e.A.id,
        { id: antes.alumnoId },
        { correo: 'viejo.alumno@ejemplo.test' },
      );
      await actualizarFilas(
        'propietario',
        'apoderados',
        e.A.id,
        { alumno_id: antes.alumnoId },
        { correo: 'viejo.apoderado@ejemplo.test' },
      );
      return antes;
    }

    it('criterio 57 e: con los correos nuevos del formulario se envía a los nuevos y no a los guardados antes', async () => {
      const antes = await clienteQueVuelve();

      const respuesta = await enviar(await menor(ALUMNO, APODERADO, { alumno: { dni: antes.dni } }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(paraDe()).toEqual([ALUMNO, APODERADO].sort());
      expect(correo.mensajes.some((mensaje) => mensaje.para.startsWith('viejo.'))).toBe(false);
    });

    it('criterio 57 e: si el formulario nuevo no trae correos, no se envía nada (tampoco a los guardados antes)', async () => {
      const antes = await clienteQueVuelve();

      const respuesta = await enviar(await menor(undefined, undefined, { alumno: { dni: antes.dni } }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(correo.mensajes).toEqual([]);
    });
  });

  describe('f: los criterios 51 y 52 valen para cada envío', () => {
    const fallo = (para: string) => ({
      rechazar: Object.assign(new Error(`No se entregó a ${para}`), { rejected: [para] }),
    });

    it.each([
      [
        'el del alumno colgado y el del apoderado fallando',
        (m: MensajeDeCorreo) => (m.para === ALUMNO ? 'colgar' : fallo(m.para)),
      ],
      [
        'el del apoderado colgado y el del alumno fallando',
        (m: MensajeDeCorreo) => (m.para === APODERADO ? 'colgar' : fallo(m.para)),
      ],
    ] as const)(
      'criterio 57 f: con %s, la respuesta es el mismo 201 sin demora, los dos envíos se iniciaron y el registro tiene una línea de fallo solo con el tipo del error',
      async (_nombre, accion) => {
        correo.accion = accion;
        const antes = lineas.length;

        const { valor: respuesta, ms } = await medir(
          enviar(await menor(ALUMNO, APODERADO)),
          LIMITE_MS,
          'la respuesta esperó a uno de los correos',
        );

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(ms).toBeLessThan(LIMITE_MS);
        await esperarHasta(
          () => correo.mensajes.length === 2 && lineas.slice(antes).some((linea) => /"tipo"/.test(linea)),
        );
        expect(paraDe(), 'los dos envíos se iniciaron').toEqual([ALUMNO, APODERADO].sort());
        const solicitud = solicitudDe(respuesta);
        const nuevas = lineas.slice(antes);
        const lineasDeFallo = nuevas
          .map((linea) => {
            try {
              return JSON.parse(linea) as Objeto;
            } catch {
              return undefined;
            }
          })
          .filter(
            (linea): linea is Objeto =>
              linea !== undefined && typeof linea['error'] === 'object' && linea['error'] !== null,
          );
        expect(lineasDeFallo, 'una sola línea de fallo').toHaveLength(1);
        expect((lineasDeFallo[0] as Objeto)['error']).toEqual({ tipo: 'Error' });
        const texto = nuevas.join('\n');
        for (const prohibido of [ALUMNO, APODERADO, 'ejemplo.test', solicitud.token, solicitud.enlace]) {
          expect(texto, `el registro no debe llevar ${prohibido}`).not.toContain(prohibido);
        }
      },
    );

    it('criterio 57 f: si fallan los dos envíos, hay una línea de fallo por envío, las dos con solo el tipo del error', async () => {
      correo.accion = (mensaje) => fallo(mensaje.para);
      const antes = lineas.length;

      const respuesta = await enviar(await menor(ALUMNO, APODERADO));

      expect(respuesta.status, respuesta.texto).toBe(201);
      await esperarHasta(() => lineas.slice(antes).filter((linea) => /"tipo"/.test(linea)).length >= 2);
      const nuevas = lineas.slice(antes);
      expect(nuevas.filter((linea) => /"tipo":"Error"/.test(linea))).toHaveLength(2);
      const texto = nuevas.join('\n');
      for (const prohibido of [ALUMNO, APODERADO, 'ejemplo.test', solicitudDe(respuesta).token]) {
        expect(texto).not.toContain(prohibido);
      }
    });
  });

  describe('g: lo que no envía correos', () => {
    it('criterio 57 g: un rechazo 400 o 409 no llama a enviar para ninguno de los dos', async () => {
      await llenarClase(e.A.id, e.viernes.id, e.plan.id, 20);
      const cuerpos = [
        await menor(ALUMNO, APODERADO, { alumno: { dni: '1' } }), // 400
        await menor(ALUMNO, APODERADO, { consentimientos: { version: 'vieja' } }), // 409 TEXTOS_ACTUALIZADOS
        await menor(ALUMNO, APODERADO, { inscripcion: { mes: '2026-12' } }), // 409 MES_CAMBIO
        await menor(ALUMNO, APODERADO), // 409 SIN_CUPO (el viernes está lleno)
      ];

      const estados: number[] = [];
      for (const cuerpo of cuerpos) estados.push((await enviar(cuerpo)).status);

      expect(estados).toEqual([400, 409, 409, 409]);
      expect(correo.mensajes).toEqual([]);
    });

    it('criterio 57 g: un reintento con la misma claveIdempotencia (criterio 23) no vuelve a enviar a ninguno de los dos', async () => {
      const cuerpo = await menor(ALUMNO, APODERADO);
      const primero = await enviar(cuerpo);
      expect(primero.status, primero.texto).toBe(201);
      expect(correo.mensajes).toHaveLength(2);

      const reintento = await enviar(cuerpo);

      expect([reintento.status, codigoDe(reintento)]).toEqual([409, 'SOLICITUD_YA_REGISTRADA']);
      expect(correo.mensajes, 'siguen siendo los dos del primer envío').toHaveLength(2);
    });

    it('criterio 57 g: el envío que pierde una carrera (criterio 22) no llama a enviar: dos envíos simultáneos con el mismo DNI dejan solo los dos correos del que ganó', async () => {
      const base = await menor(ALUMNO, APODERADO);
      const segundo = { ...base, claveIdempotencia: '0b8c2a54-3d7e-4f61-9a20-5c1e7d8f9a01' };

      const { resultados } = await conRetencion({
        academiaId: e.A.id,
        retener: retenerClases([e.lunes.id], e.A.id),
        enviar: [() => enviar(base), () => enviar(segundo)],
        liberar: 'ROLLBACK',
      });

      expect(resultados.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(correo.mensajes, 'solo los dos del envío que confirmó').toHaveLength(2);
      expect(paraDe()).toEqual([ALUMNO, APODERADO].sort());
    });
  });
});

describe('criterio 57 f: el envío simulado deja una línea por envío, sin destinatario', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it('criterio 57 f: un menor con correo propio y del apoderado deja dos líneas con la plantilla y la academia, y ninguna con un destinatario, el enlace ni el token', async () => {
    const antes = lineas.length;

    const respuesta = await ctx.http.post(
      rutaPublica('academia-a', '/inscripcion'),
      await cuerpoInscripcionMenor(e, { sobre: { alumno: { correo: ALUMNO }, apoderado: { correo: APODERADO } } }),
    );

    expect(respuesta.status, respuesta.texto).toBe(201);
    const solicitud = solicitudDe(respuesta);
    await esperarHasta(
      () => lineas.slice(antes).filter((linea) => linea.includes('SEGUIMIENTO_SOLICITUD')).length >= 2,
    );
    const nuevas = lineas.slice(antes);
    const delCorreo = nuevas.filter((linea) => linea.includes('SEGUIMIENTO_SOLICITUD'));
    expect(delCorreo, 'una línea por envío').toHaveLength(2);
    expect(delCorreo.every((linea) => linea.includes(e.A.id))).toBe(true);
    const texto = nuevas.join('\n');
    for (const prohibido of [ALUMNO, APODERADO, 'ejemplo.test', solicitud.token, solicitud.enlace]) {
      expect(texto, `el registro no debe llevar ${prohibido}`).not.toContain(prohibido);
    }
  });
});

describe('criterio 57 g: un rechazo por el límite (429) no llama a enviar', () => {
  const correo = new EnviadorProgramable();
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ correo, conLimites: true });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    correo.reiniciar();
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it('criterio 57 g: el envío número 11 de la hora responde 429 y no llama a enviar para ninguno de los dos', async () => {
    for (let i = 0; i < 10; i++) await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), { basura: true });

    const limitado = await ctx.http.post(
      rutaPublica('academia-a', '/inscripcion'),
      await cuerpoInscripcionMenor(e, { sobre: { alumno: { correo: ALUMNO }, apoderado: { correo: APODERADO } } }),
    );

    expect(limitado.status).toBe(429);
    expect(correo.mensajes).toEqual([]);
  });
});
