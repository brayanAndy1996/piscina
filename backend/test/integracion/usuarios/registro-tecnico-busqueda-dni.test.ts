// spec: 002-autenticacion-roles (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import {
  AHORA_PRUEBAS,
  CLAVE_COMUN,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  crearUsuarioDePrueba,
  dniInventado,
  type ErrorCuerpo,
  type Escenario,
  pedir,
  type RolUsuario,
  type UsuarioDePrueba,
} from '../../utilidades/usuarios';

// Criterio 43, ampliación (precisión del orquestador (13/11/2026), PO-3; Ley 29733, RNF-05): el DNI que se busca para restablecer una
// contraseña es un dato personal y, en una cuenta nueva o recién restablecida, también su contraseña. La búsqueda es
// `POST /api/usuarios/buscar-por-dni` con `{ dni }` en el cuerpo, y el registro técnico, en ningún nivel (aquí `trace`), contiene el DNI
// buscado, ni recortado ni tal como se envió: ni la línea de la petición, ni los registros del servicio, ni los de errores.
//
// Ocho dígitos seguidos pueden aparecer dentro de un UUID o de una marca de tiempo: cada caso elige DNIs que el registro acumulado
// todavía no contiene (`dniLibre`) antes de hacer la petición. nestjs-pino crea un único registrador por proceso: este archivo tiene
// una sola aplicación, con el destino de registros en memoria.
//
// Fuera de esta prueba (spec, criterio 43): un cliente que invente una ruta con un DNI en la dirección. La línea de pino-http de esa
// ruta inexistente sí lo tendría; no es un camino de la aplicación. Por eso el caso de `GET /api/usuarios/por-dni/{dni}` usa un DNI
// aparte que no se comprueba en el registro.

const RUTA_BUSQUEDA = '/api/usuarios/buscar-por-dni';

describe('criterio 43 (PO-3): el registro técnico nunca contiene el DNI buscado para restablecer', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let app: NestExpressApplication;
  let e: Escenario;
  let cookieAdmin: string;
  let cookieSecretaria: string;
  let cookieEntrenador: string;
  /** Todo texto que no puede aparecer en el registro (el DNI buscado, recortado o tal como se envió), de todos los casos. */
  const prohibidos = new Set<string>();

  const registro = () => lineas.join('\n');

  /** Un DNI inventado cuyas derivadas (el DNI mismo y los textos que se envían) no aparecen todavía en el registro acumulado. */
  function dniLibre(derivados: (dni: string) => string[] = (dni) => [dni]): string {
    for (let intento = 0; intento < 1000; intento++) {
      const dni = dniInventado();
      const textos = [dni, ...derivados(dni)];
      const actual = registro();
      if (textos.every((texto) => !actual.includes(texto))) return dni;
    }
    throw new Error('No se encontró un DNI de prueba que no esté ya en el registro técnico acumulado.');
  }

  const usuarioNuevo = (academiaId: string, rol: RolUsuario, extras: { debeCambiarClave?: boolean } = {}) =>
    crearUsuarioDePrueba({ academiaId, rol, dni: dniLibre(), clave: CLAVE_COMUN, ...extras });

  const cuerpoJsonRoto = (cookie: string, texto: string) =>
    pedir(app, 'post', RUTA_BUSQUEDA, { cookie }).set('Content-Type', 'application/json').send(texto);

  beforeAll(async () => {
    e = await crearEscenario();
    cookieAdmin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
    cookieSecretaria = cookieDeUsuario(e.secretariaA, AHORA_PRUEBAS);
    cookieEntrenador = cookieDeUsuario(e.entrenadorA, AHORA_PRUEBAS);
    ({ app } = await crearAppConReloj(AHORA_PRUEBAS, { nivelRegistro: 'trace', destinoRegistro: destino }));
  });
  afterAll(async () => {
    await app?.close();
  });

  interface Preparado {
    readonly peticion: () => request.Test;
    readonly buscados: string[];
  }

  interface Caso {
    readonly nombre: string;
    readonly estado: number;
    readonly codigo?: string;
    /** Prepara los datos (con DNIs libres de registro) y devuelve la petición y los textos que no pueden llegar al registro. */
    readonly preparar: () => Preparado | Promise<Preparado>;
  }

  const buscar = (cookie: string | undefined, dni: unknown) => () =>
    pedir(app, 'post', RUTA_BUSQUEDA, { cookie, cuerpo: { dni } });

  const CASOS: readonly Caso[] = [
    {
      nombre: 'un ADMIN busca el DNI de un usuario de su academia (200)',
      estado: 200,
      preparar: async () => {
        const objetivo = await usuarioNuevo(e.A.id, 'ENTRENADOR');
        return { peticion: buscar(cookieAdmin, objetivo.dni), buscados: [objetivo.dni] };
      },
    },
    {
      nombre: 'una SECRETARIA busca el DNI de un alumno de su academia (200)',
      estado: 200,
      preparar: async () => {
        const objetivo = await usuarioNuevo(e.A.id, 'ALUMNO');
        return { peticion: buscar(cookieSecretaria, objetivo.dni), buscados: [objetivo.dni] };
      },
    },
    {
      nombre:
        'un DNI con espacios en los extremos se recorta y se encuentra (200); no queda ni recortado ni tal como se envió',
      estado: 200,
      preparar: async () => {
        const objetivo = await usuarioNuevo(e.A.id, 'ALUMNO');
        const enviado = `  ${objetivo.dni}  `;
        return { peticion: buscar(cookieSecretaria, enviado), buscados: [objetivo.dni, enviado] };
      },
    },
    {
      nombre: 'un DNI que no existe (404 NO_ENCONTRADO)',
      estado: 404,
      codigo: 'NO_ENCONTRADO',
      preparar: () => {
        const dni = dniLibre();
        return { peticion: buscar(cookieAdmin, dni), buscados: [dni] };
      },
    },
    {
      nombre: 'un DNI con espacios que no existe (404 NO_ENCONTRADO)',
      estado: 404,
      codigo: 'NO_ENCONTRADO',
      preparar: () => {
        const dni = dniLibre();
        const enviado = ` ${dni}\t`;
        return { peticion: buscar(cookieSecretaria, enviado), buscados: [dni, enviado] };
      },
    },
    {
      nombre: 'un DNI que solo existe en la otra academia (404 NO_ENCONTRADO)',
      estado: 404,
      codigo: 'NO_ENCONTRADO',
      preparar: async () => {
        const deB = await usuarioNuevo(e.B.id, 'ALUMNO');
        return { peticion: buscar(cookieAdmin, deB.dni), buscados: [deB.dni] };
      },
    },
    {
      nombre: 'una SECRETARIA busca el DNI de un entrenador de su academia, fuera de su alcance (404 NO_ENCONTRADO)',
      estado: 404,
      codigo: 'NO_ENCONTRADO',
      preparar: async () => {
        const fuera = await usuarioNuevo(e.A.id, 'ENTRENADOR');
        return { peticion: buscar(cookieSecretaria, fuera.dni), buscados: [fuera.dni] };
      },
    },
    {
      nombre: 'un DNI de 7 dígitos, sin el formato (404 NO_ENCONTRADO)',
      estado: 404,
      codigo: 'NO_ENCONTRADO',
      preparar: () => {
        const siete = dniLibre((dni) => [dni.slice(0, 7)]).slice(0, 7);
        return { peticion: buscar(cookieAdmin, siete), buscados: [siete] };
      },
    },
    {
      nombre: 'un DNI de 9 dígitos, sin el formato (404 NO_ENCONTRADO)',
      estado: 404,
      codigo: 'NO_ENCONTRADO',
      preparar: () => {
        const nueve = `${dniLibre((dni) => [`${dni}7`])}7`;
        return { peticion: buscar(cookieSecretaria, nueve), buscados: [nueve] };
      },
    },
    {
      nombre: 'un DNI con guion en medio, sin el formato (404 NO_ENCONTRADO)',
      estado: 404,
      codigo: 'NO_ENCONTRADO',
      preparar: () => {
        const dni = dniLibre((d) => [`${d.slice(0, 4)}-${d.slice(4)}`]);
        const conGuion = `${dni.slice(0, 4)}-${dni.slice(4)}`;
        return { peticion: buscar(cookieAdmin, conGuion), buscados: [conGuion] };
      },
    },
    {
      nombre: 'sin sesión (401 NO_AUTENTICADO), aunque el cuerpo lleve un DNI',
      estado: 401,
      codigo: 'NO_AUTENTICADO',
      preparar: async () => {
        const objetivo = await usuarioNuevo(e.A.id, 'ALUMNO');
        return { peticion: buscar(undefined, objetivo.dni), buscados: [objetivo.dni] };
      },
    },
    {
      nombre: 'sin sesión y con un JSON roto que lleva el DNI (401 NO_AUTENTICADO, antes de leer el cuerpo)',
      estado: 401,
      codigo: 'NO_AUTENTICADO',
      preparar: () => {
        const dni = dniLibre();
        return {
          peticion: () =>
            pedir(app, 'post', RUTA_BUSQUEDA).set('Content-Type', 'application/json').send(`{"dni": "${dni}`),
          buscados: [dni],
        };
      },
    },
    {
      nombre: 'un ENTRENADOR (403 SIN_PERMISO)',
      estado: 403,
      codigo: 'SIN_PERMISO',
      preparar: async () => {
        const objetivo = await usuarioNuevo(e.A.id, 'ALUMNO');
        return { peticion: buscar(cookieEntrenador, objetivo.dni), buscados: [objetivo.dni] };
      },
    },
    {
      nombre: 'un usuario con el cambio de contraseña pendiente (403 CAMBIO_DE_CLAVE_OBLIGATORIO)',
      estado: 403,
      codigo: 'CAMBIO_DE_CLAVE_OBLIGATORIO',
      preparar: async () => {
        const pendiente = await usuarioNuevo(e.A.id, 'SECRETARIA', { debeCambiarClave: true });
        const objetivo = await usuarioNuevo(e.A.id, 'ALUMNO');
        return {
          peticion: buscar(cookieDeUsuario(pendiente, AHORA_PRUEBAS), objetivo.dni),
          buscados: [objetivo.dni],
        };
      },
    },
    {
      nombre: 'un cuerpo con campos de más (400 SOLICITUD_INVALIDA)',
      estado: 400,
      codigo: 'SOLICITUD_INVALIDA',
      preparar: async () => {
        const objetivo = await usuarioNuevo(e.A.id, 'ALUMNO');
        return {
          peticion: () =>
            pedir(app, 'post', RUTA_BUSQUEDA, { cookie: cookieAdmin, cuerpo: { dni: objetivo.dni, rol: 'ADMIN' } }),
          buscados: [objetivo.dni],
        };
      },
    },
    {
      nombre: 'un dni que es un número y no un texto (400 SOLICITUD_INVALIDA)',
      estado: 400,
      codigo: 'SOLICITUD_INVALIDA',
      preparar: async () => {
        const objetivo = await usuarioNuevo(e.A.id, 'ALUMNO');
        return { peticion: buscar(cookieSecretaria, Number(objetivo.dni)), buscados: [objetivo.dni] };
      },
    },
    {
      nombre: 'un dni dentro de una lista (400 SOLICITUD_INVALIDA)',
      estado: 400,
      codigo: 'SOLICITUD_INVALIDA',
      preparar: async () => {
        const objetivo = await usuarioNuevo(e.A.id, 'ALUMNO');
        return { peticion: buscar(cookieAdmin, [objetivo.dni]), buscados: [objetivo.dni] };
      },
    },
    {
      nombre: 'un dni de más de 64 caracteres que empieza con un DNI (400 SOLICITUD_INVALIDA)',
      estado: 400,
      codigo: 'SOLICITUD_INVALIDA',
      preparar: () => {
        const dni = dniLibre();
        return { peticion: buscar(cookieAdmin, `${dni}${'0'.repeat(60)}`), buscados: [dni] };
      },
    },
    {
      nombre: 'un JSON roto que lleva el DNI (400 SOLICITUD_INVALIDA)',
      estado: 400,
      codigo: 'SOLICITUD_INVALIDA',
      preparar: () => {
        const dni = dniLibre();
        return { peticion: () => cuerpoJsonRoto(cookieAdmin, `{"dni": "${dni}`), buscados: [dni] };
      },
    },
    {
      nombre: 'un cuerpo que no es JSON pero llega como JSON y lleva el DNI (400 SOLICITUD_INVALIDA)',
      estado: 400,
      codigo: 'SOLICITUD_INVALIDA',
      preparar: () => {
        const dni = dniLibre();
        return { peticion: () => cuerpoJsonRoto(cookieSecretaria, `dni=${dni}`), buscados: [dni] };
      },
    },
  ];

  it.each(CASOS.map((caso) => [caso.nombre, caso] as const))(
    'criterio 43: %s no deja el DNI buscado en ningún nivel del registro',
    async (_nombre, caso) => {
      const { peticion, buscados } = await caso.preparar();
      for (const texto of buscados) {
        // Precondición: el texto buscado todavía no está en el registro acumulado (si no, la prueba no distinguiría nada).
        expect(registro(), `precondición: el registro ya contenía ${texto}`).not.toContain(texto);
        prohibidos.add(texto);
      }
      const antes = lineas.length;

      const respuesta = await peticion();

      expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(caso.estado);
      if (caso.codigo) expect((respuesta.body as ErrorCuerpo).codigo).toBe(caso.codigo);
      await esperarHasta(() => lineas.length > antes);
      await new Promise((resolver) => setTimeout(resolver, 50));
      const nuevas = lineas.slice(antes);
      expect(nuevas.length, 'la petición no dejó ningún registro: la prueba no comprobaría nada').toBeGreaterThan(0);
      const texto = nuevas.join('\n');
      for (const prohibido of buscados) {
        expect(texto, `el registro técnico contiene el DNI buscado ${prohibido}`).not.toContain(prohibido);
      }
    },
  );

  it('criterio 34 y 43: GET /api/usuarios/por-dni/{dni} ya no existe: con sesión de ADMIN responde 404 NO_ENCONTRADO', async () => {
    // Este DNI no se comprueba en el registro: la línea de pino-http de una ruta inexistente lleva su dirección.
    const objetivo = await usuarioNuevo(e.A.id, 'ALUMNO');

    const respuesta = await pedir(app, 'get', `/api/usuarios/por-dni/${objetivo.dni}`, { cookie: cookieAdmin });
    const conPost = await pedir(app, 'post', RUTA_BUSQUEDA, { cookie: cookieAdmin, cuerpo: { dni: objetivo.dni } });

    expect(respuesta.status).toBe(404);
    expect((respuesta.body as ErrorCuerpo).codigo).toBe('NO_ENCONTRADO');
    expect(JSON.stringify(respuesta.body)).not.toContain('"usuario"');
    expect(conPost.status, 'control: la búsqueda por POST sí encuentra al usuario').toBe(200);
    expect((conPost.body as { usuario: UsuarioDePrueba }).usuario).toMatchObject({ id: objetivo.id });
  });

  it('criterio 43: al final, ninguna línea de todo el registro acumulado contiene un DNI buscado en ningún caso', async () => {
    await new Promise((resolver) => setTimeout(resolver, 100));
    expect(prohibidos.size, 'los casos anteriores no registraron ningún DNI buscado').toBeGreaterThan(10);
    const sospechosas = lineas.filter((linea) => [...prohibidos].some((texto) => linea.includes(texto)));

    expect(
      sospechosas.map((linea) => linea.slice(0, 200)),
      'líneas del registro técnico con un DNI buscado',
    ).toEqual([]);
  });
});
