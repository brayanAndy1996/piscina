// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import {
  type AppInscripciones,
  AHORA_005,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  type MensajeDeCorreo,
  type Objeto,
  rutaPublica,
  solicitudDe,
} from '../../utilidades/inscripciones';
import { EnviadorProgramable } from '../../utilidades/inscripciones-ronda1';

// Criterio 52 (crítico, Ley 29733, criterio 43 de 002; criterios 27 y 28; ataque ronda 1, F4): cuando `EnviadorCorreo.enviar` falla
// (rechaza o lanza), el registro técnico lleva un mensaje fijo, la academia, la plantilla y `error: { tipo }`, donde `tipo` es el nombre de
// la clase del error (el `name` de su constructor, si es un identificador de como mucho 64 caracteres; si no, "Error"), o `typeof` del
// valor si no es un `Error`. Nunca lleva el mensaje del error, su pila, su `cause`, su `name` propio ni ninguna otra propiedad (`rejected`,
// `response`, `envelope`, `code`…). Pruebas con un registro en memoria y un enviador que falla con: un error de una clase propia con el
// destinatario y el enlace en el mensaje, `rejected: [destinatario]`, `response` con el destinatario y `cause` con el token; un `Error` con
// `name` igual al destinatario; un texto y un objeto con el destinatario y el token. En ningún nivel el registro contiene el destinatario,
// el enlace ni el token, y en el primer caso `tipo` es el nombre de la clase.

class ErrorDeProveedorDeCorreo extends Error {
  rejected: string[] = [];
  response = '';
  envelope: unknown;
  code = 'EENVELOPE';
}

const DIRECCION = 'destino.reservado@ejemplo.test';

/** Todo lo que el mensaje de correo lleva y no debe salir en el registro (destinatario, código y enlace con el token). */
const secretoDe = (mensaje: MensajeDeCorreo): string => `${mensaje.para} ${JSON.stringify(mensaje.datos)}`;

function errorDeClasePropia(mensaje: MensajeDeCorreo): ErrorDeProveedorDeCorreo {
  const error = new ErrorDeProveedorDeCorreo(`No se pudo entregar a ${mensaje.para}: ${secretoDe(mensaje)}`);
  error.rejected = [mensaje.para];
  error.response = `550 5.1.1 <${mensaje.para}> usuario desconocido`;
  error.envelope = { from: 'no-responder@aquagestion.test', to: [mensaje.para] };
  error.cause = new Error(`token de seguimiento ${secretoDe(mensaje)}`);
  return error;
}

function errorConNombreDelDestinatario(mensaje: MensajeDeCorreo): Error {
  const error = new Error('Fallo del proveedor');
  error.name = mensaje.para;
  return error;
}

function errorConConstructorRaro(nombre: (mensaje: MensajeDeCorreo) => string) {
  return (mensaje: MensajeDeCorreo): Error => {
    class Raro extends Error {}
    Object.defineProperty(Raro, 'name', { value: nombre(mensaje) });
    return new Raro(`No se pudo entregar a ${mensaje.para}`);
  };
}

interface Caso {
  nombre: string;
  construir: (mensaje: MensajeDeCorreo) => unknown;
  tipo: string;
}

const CASOS: Caso[] = [
  {
    nombre: 'un error de una clase propia con el destinatario, el enlace y el token en el mensaje y en sus propiedades',
    construir: errorDeClasePropia,
    tipo: 'ErrorDeProveedorDeCorreo',
  },
  { nombre: 'un Error con name igual al destinatario', construir: errorConNombreDelDestinatario, tipo: 'Error' },
  { nombre: 'un texto con el destinatario y el token', construir: (m) => `fallo para ${secretoDe(m)}`, tipo: 'string' },
  {
    nombre: 'un objeto con el destinatario y el token',
    construir: (m) => ({ para: m.para, datos: m.datos }),
    tipo: 'object',
  },
  {
    nombre: 'un error cuyo constructor se llama como el destinatario (no es un identificador)',
    construir: errorConConstructorRaro((m) => m.para),
    tipo: 'Error',
  },
  {
    nombre: 'un error cuyo constructor tiene un nombre de más de 64 caracteres',
    construir: errorConConstructorRaro(() => 'A'.repeat(65)),
    tipo: 'Error',
  },
  {
    nombre: 'un error cuyo constructor tiene un nombre de exactamente 64 caracteres',
    construir: errorConConstructorRaro(() => 'B'.repeat(64)),
    tipo: 'B'.repeat(64),
  },
];

describe('el fallo del correo se registra solo con su tipo (criterio 52)', () => {
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

  async function enviarYLeerRegistro(
    accion: (mensaje: MensajeDeCorreo) => { lanzar: unknown } | { rechazar: unknown },
  ) {
    correo.accion = accion;
    const antes = lineas.length;
    const respuesta = await ctx.http.post(
      rutaPublica('academia-a', '/inscripcion'),
      await cuerpoInscripcion(e, { sobre: { alumno: { correo: DIRECCION } } }),
    );
    expect(respuesta.status, respuesta.texto).toBe(201);
    await esperarHasta(() => lineas.slice(antes).some((linea) => /"tipo"/.test(linea)));
    await new Promise((resolver) => setTimeout(resolver, 50));
    const nuevas = lineas.slice(antes);
    const fallos = nuevas
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
    return { respuesta, solicitud: solicitudDe(respuesta), nuevas, fallos };
  }

  const FORMAS = [
    ['rechaza su promesa', (valor: unknown) => ({ rechazar: valor })],
    ['lanza de forma síncrona', (valor: unknown) => ({ lanzar: valor })],
  ] as const;

  describe.each(FORMAS)('cuando enviar %s', (_forma, accionCon) => {
    it.each(CASOS)(
      'criterio 52: con $nombre, el registro lleva el tipo y nada del destinatario, el enlace ni el token',
      async (caso) => {
        const { solicitud, nuevas, fallos } = await enviarYLeerRegistro((mensaje) =>
          accionCon(caso.construir(mensaje)),
        );

        expect(fallos, 'una línea de fallo con error: { tipo }').toHaveLength(1);
        const [fallo] = fallos as [Objeto];
        expect(fallo['error']).toEqual({ tipo: caso.tipo });
        expect(fallo['academiaId']).toBe(e.A.id);
        expect(fallo['plantilla']).toBe('SEGUIMIENTO_SOLICITUD');
        expect(typeof fallo['msg'], 'mensaje fijo').toBe('string');
        expect(fallo['level'], 'queda como aviso o error').toBeGreaterThanOrEqual(40);
        const texto = nuevas.join('\n');
        for (const prohibido of [DIRECCION, 'ejemplo.test', solicitud.token, solicitud.enlace, solicitud.codigo]) {
          expect(texto, `el registro no debe llevar ${prohibido}`).not.toContain(prohibido);
        }
      },
    );
  });

  it('criterio 52: el mensaje del registro es fijo: el mismo para cualquier error, y no contiene el mensaje del error', async () => {
    const mensajes = new Set<unknown>();
    for (const caso of [CASOS[0], CASOS[2]] as Caso[]) {
      e = await crearEscenarioInscripcion();
      const { fallos } = await enviarYLeerRegistro((mensaje) => ({ rechazar: caso.construir(mensaje) }));
      expect(fallos).toHaveLength(1);
      expect((fallos[0] as Objeto)['error'], 'solo el tipo').toEqual({ tipo: caso.tipo });
      mensajes.add((fallos[0] as Objeto)['msg']);
      correo.mensajes.length = 0;
    }

    expect(mensajes.size, 'un solo mensaje para todos los fallos').toBe(1);
    const [mensaje] = [...mensajes];
    expect(typeof mensaje === 'string' && mensaje.length > 0).toBe(true);
    expect(String(mensaje)).not.toContain('No se pudo entregar');
    expect(String(mensaje)).not.toContain('fallo para');
  });

  it('criterio 52: el fallo del correo no deja ningún registro con el error completo (ni "err", ni "stack", ni "cause", ni "rejected", ni "response", ni "envelope")', async () => {
    const { nuevas } = await enviarYLeerRegistro((mensaje) => ({ rechazar: errorDeClasePropia(mensaje) }));

    const texto = nuevas.join('\n');
    for (const clave of [
      '"stack"',
      '"cause"',
      '"rejected"',
      '"response"',
      '"envelope"',
      '"err"',
      'EENVELOPE',
      'usuario desconocido',
    ]) {
      expect(texto, `el registro lleva ${clave}`).not.toContain(clave);
    }
  });

  it('criterio 52: con un enviador que funciona no queda ninguna línea de fallo', async () => {
    const antes = lineas.length;

    const respuesta = await ctx.http.post(
      rutaPublica('academia-a', '/inscripcion'),
      await cuerpoInscripcion(e, { sobre: { alumno: { correo: DIRECCION } } }),
    );

    expect(respuesta.status, respuesta.texto).toBe(201);
    await new Promise((resolver) => setTimeout(resolver, 100));
    expect(lineas.slice(antes).filter((linea) => /"tipo"/.test(linea))).toEqual([]);
  });
});
