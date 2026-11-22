// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { urlAppPruebas } from '../../utilidades/base-datos';
import {
  AHORA_005,
  crearEscenarioInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  rutaPublica,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import {
  AlmacenDeFallosDePrueba,
  type AppConAlmacen,
  archivosDelAlumno,
  crearAppConAlmacen,
  exigirAlmacen,
  existeArchivoDeClave,
  fotoClaveDe,
  lineasJson,
  png,
  subirFoto,
} from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { conUrlDeAppEnElProxy, type ModoDeCorte, ProxyPostgres } from '../../utilidades/proxy-postgres';
import { contarAuditoria } from '../../utilidades/usuarios';

// Criterio 61 (crítico, ronda 1 del ataque de la 005b, falla 1; amplía el 37): la confirmación de la foto puede terminar con un error aunque el
// `COMMIT` ya se aplicó en la base (la conexión se corta después de que PostgreSQL confirma y antes de que la respuesta llegue a la API). El
// servicio no sabe entonces si la foto quedó: no borra nada todavía, relee `foto_clave` en una transacción nueva y decide con lo que ve:
//   b1) quedó la clave nueva: 204 (con el `info` 'Foto de la solicitud guardada'), el archivo anterior se borra;
//   b2) no quedó: se borra el archivo nuevo, el anterior no se toca y la respuesta es 500 ERROR_INTERNO;
//   b3) la relectura también falla: no se borra ningún archivo y la respuesta es 500 ERROR_INTERNO.
// En b1 a b3 se registra un `warn` 'Confirmación de la foto incierta' con `academiaId` y `error: { tipo }`, sin el mensaje del error, el token, la clave
// ni datos personales. Invariante c): después de cualquier subida, `foto_clave` es nula o apunta a un archivo que existe.
//
// Pruebas deterministas con un proxy TCP entre la API y PostgreSQL (`proxy-postgres.ts`, decisión AB1-2) que corta la conexión en un punto exacto del
// protocolo: la aplicación se crea con `DATABASE_URL_APP` apuntando al proxy y todo lo que la prueba lee o escribe como dueño va directo a la base.
//   Caso 1) `cortarTrasCommit`: 204 y un solo archivo (también si es la primera subida);
//   Caso 2) `cortarAntesDelCommit`: 500 y la foto anterior intacta;
//   Caso 3) `caer`: 500 sin borrar nada;
//   Caso 4) un reintento sin cortes tras el caso 1 no arrastra restos;
//   Caso 5) el invariante, sin auditoría y el `warn` sin el token, en todos los casos.

const MENSAJE_INCIERTO = 'Confirmación de la foto incierta';
const MENSAJE_GUARDADA = 'Foto de la solicitud guardada';
const NIVEL_INFO = 30;
const NIVEL_WARN = 40;

interface Banco {
  proxy: ProxyPostgres;
  ctx: AppConAlmacen;
  fallos: AlmacenDeFallosDePrueba;
  lineas: string[];
}

/** Levanta el proxy y la aplicación (con `DATABASE_URL_APP` apuntando al proxy solo mientras se crea). Si algo falla, cierra lo que abrió. */
async function levantar(): Promise<Banco> {
  const { destino, lineas } = crearDestinoDeRegistro();
  const proxy = await ProxyPostgres.iniciar(urlAppPruebas());
  let fallos: AlmacenDeFallosDePrueba | undefined;
  let ctx: AppConAlmacen | undefined;
  try {
    ctx = await conUrlDeAppEnElProxy(proxy, () =>
      crearAppConAlmacen({
        ahora: AHORA_005,
        nivelRegistro: 'trace',
        destinoRegistro: destino,
        envolver: (real) => {
          fallos = new AlmacenDeFallosDePrueba(real);
          return fallos;
        },
      }),
    );
  } catch (error) {
    await proxy.cerrar();
    throw error;
  }
  if (!fallos) {
    await ctx.cerrarTodo();
    await proxy.cerrar();
    throw new Error('No se pudo envolver el almacén de la prueba (¿falta el módulo del almacén de la 005b?).');
  }
  return { proxy, ctx, fallos, lineas };
}

async function bajar(banco: Banco | undefined): Promise<void> {
  if (!banco) return;
  try {
    await banco.ctx.cerrarTodo();
  } finally {
    await banco.proxy.cerrar();
  }
}

// Estas utilidades se definen dentro de cada describe: cada uno tiene su propia aplicación y su propio proxy.
function utilidadesDe(banco: () => Banco, escenario: () => EscenarioInscripcion, cliente: () => SolicitudSembrada) {
  const subir = (cuerpo: Buffer = png(100, 100), plazoMs = 25_000) =>
    subirFoto(banco().ctx, 'academia-a', { token: cliente().token, cuerpo, plazoMs });
  const claveDeFoto = () => fotoClaveDe(escenario().A.id, cliente().alumnoId);
  const archivos = () =>
    archivosDelAlumno(banco().ctx.raiz, escenario().A.id, cliente().alumnoId).sort((a, b) => a.localeCompare(b));
  const existe = (clave: string) => existeArchivoDeClave(banco().ctx.raiz, clave);
  /** Arma el proxy desde `guardar` del almacén: después de la comprobación previa y antes de la confirmación. */
  const armarAlGuardar = (modo: ModoDeCorte) => {
    banco().fallos.alGuardar = () => {
      banco().proxy.armar(modo);
      return Promise.resolve();
    };
  };
  const desarmarAlGuardar = () => {
    banco().fallos.alGuardar = undefined;
    banco().proxy.desarmar();
  };
  const vistaCompleta = () =>
    banco().ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { token: cliente().token });
  const avisosInciertos = () => lineasJson(banco().lineas).filter((linea) => linea['msg'] === MENSAJE_INCIERTO);

  /** Caso 5, en cada caso: el invariante c), nada en `auditoria`, el `warn` sin secretos y ninguna línea con el token. */
  async function comprobarComun(opciones: { conAviso: boolean; claves: readonly string[] }): Promise<void> {
    const clave = await claveDeFoto();
    if (clave !== null) {
      expect(existe(clave), 'foto_clave apunta a un archivo que no existe (referencia rota)').toBe(true);
    }
    expect(await contarAuditoria(escenario().A.id), 'una subida escribió en auditoria').toBe(0);
    expect(await contarAuditoria(escenario().B.id)).toBe(0);

    if (opciones.conAviso) {
      await esperarHasta(() => avisosInciertos().length > 0);
      const avisos = avisosInciertos();
      expect(avisos, `el registro técnico debía tener un warn '${MENSAJE_INCIERTO}'`).toHaveLength(1);
      expect(avisos[0]?.['level'], 'es un warn').toBe(NIVEL_WARN);
      expect(avisos[0]?.['academiaId']).toBe(escenario().A.id);
      const error = avisos[0]?.['error'] as Record<string, unknown> | undefined;
      expect(error, 'el warn debe traer error: { tipo }').toBeDefined();
      expect(Object.keys(error ?? {}), 'solo el tipo del error, sin message, stack ni otras propiedades').toEqual([
        'tipo',
      ]);
      expect(typeof error?.['tipo']).toBe('string');
      const lineaDelAviso = JSON.stringify(avisos[0]);
      for (const secreto of [cliente().token, cliente().dni, 'Valeria', ...opciones.claves]) {
        expect(lineaDelAviso, `el warn lleva ${secreto}`).not.toContain(secreto);
      }
    } else {
      expect(avisosInciertos(), 'una subida sin incertidumbre no debe registrar el warn').toHaveLength(0);
    }
    expect(banco().lineas.join('\n'), 'alguna línea del registro lleva el token').not.toContain(cliente().token);
  }

  return {
    banco,
    escenario,
    subir,
    claveDeFoto,
    archivos,
    existe,
    armarAlGuardar,
    desarmarAlGuardar,
    vistaCompleta,
    comprobarComun,
  };
}

type Utilidades = ReturnType<typeof utilidadesDe>;

/** Un `describe` con su propia aplicación y su propio proxy, y un escenario nuevo con una solicitud activa antes de cada caso. */
function conBanco(titulo: string, restablecerAntesDeCerrar: boolean, definir: (u: Utilidades) => void): void {
  describe(titulo, () => {
    let banco: Banco | undefined;
    let e: EscenarioInscripcion;
    let cliente: SolicitudSembrada;
    const actual = (): Banco => {
      if (!banco) throw new Error('La aplicación de la prueba no se levantó.');
      return banco;
    };

    beforeAll(async () => {
      banco = await levantar();
    });
    beforeEach(async () => {
      const b = actual();
      exigirAlmacen(b.ctx);
      await exigirTablasDeInscripcion();
      b.ctx.reloj.fijar(AHORA_005);
      b.ctx.vaciarAlmacen();
      b.fallos.fallarGuardar = false;
      b.fallos.fallarBorrar = false;
      b.fallos.alGuardar = undefined;
      b.fallos.alBorrar = undefined;
      b.fallos.llamadas.length = 0;
      b.proxy.restablecer();
      b.proxy.reiniciarContador();
      b.lineas.length = 0;
      e = await crearEscenarioInscripcion();
      cliente = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
      });
    });
    afterAll(async () => {
      // Con el proxy caído, cerrar la aplicación no debe quedarse esperando conexiones rechazadas.
      if (restablecerAntesDeCerrar) banco?.proxy.restablecer();
      await bajar(banco);
    });

    definir(
      utilidadesDe(
        actual,
        () => e,
        () => cliente,
      ),
    );
  });
}

conBanco('confirmación incierta de la foto, COMMIT confirmado o no llegado a la base (criterio 61)', false, (u) => {
  describe('caso 1: cortarTrasCommit (la base confirmó y la API no se entera)', () => {
    it('criterio 61 b1: al reemplazar la foto, responde 204; foto_clave es una clave nueva y su archivo existe; el de F1 ya no; queda un solo archivo y la vista dice fotoCargada: true', async () => {
      const primera = await u.subir(png(100, 100));
      expect(primera.status, primera.texto).toBe(204);
      const f1 = (await u.claveDeFoto()) as string;
      expect(f1).not.toBeNull();
      u.banco().lineas.length = 0;
      u.armarAlGuardar('cortarTrasCommit');

      const respuesta = await u.subir(png(140, 140));
      u.desarmarAlGuardar();

      expect(u.banco().proxy.cortes, 'el proxy debía cortar una vez en el COMMIT').toBe(1);
      expect(respuesta.status, respuesta.texto).toBe(204);
      expect(respuesta.texto).toBe('');
      const f2 = (await u.claveDeFoto()) as string;
      expect(f2, 'la foto quedó guardada: foto_clave debe ser una clave nueva').not.toBeNull();
      expect(f2).not.toBe(f1);
      expect(u.existe(f2), 'foto_clave apunta a un archivo borrado').toBe(true);
      expect(u.existe(f1), 'el archivo anterior debía borrarse').toBe(false);
      expect(u.archivos(), 'en la carpeta del alumno debe quedar solo el archivo de foto_clave').toEqual([f2]);
      const solicitud = (await u.vistaCompleta()).body?.['solicitud'] as Record<string, unknown>;
      expect(solicitud['fotoCargada']).toBe(true);
      await esperarHasta(() => lineasJson(u.banco().lineas).some((linea) => linea['msg'] === MENSAJE_GUARDADA));
      const guardadas = lineasJson(u.banco().lineas).filter((linea) => linea['msg'] === MENSAJE_GUARDADA);
      expect(guardadas, `debía registrarse el info '${MENSAJE_GUARDADA}'`).toHaveLength(1);
      expect(guardadas[0]?.['level']).toBe(NIVEL_INFO);
      expect(guardadas[0]?.['academiaId']).toBe(u.escenario().A.id);
      await u.comprobarComun({ conAviso: true, claves: [f1, f2] });
    });

    it('criterio 61 b1: lo mismo cuando la primera subida es la cortada: 204, foto_clave con su archivo y un solo archivo', async () => {
      u.armarAlGuardar('cortarTrasCommit');

      const respuesta = await u.subir(png(120, 120));
      u.desarmarAlGuardar();

      expect(u.banco().proxy.cortes, 'el proxy debía cortar una vez en el COMMIT').toBe(1);
      expect(respuesta.status, respuesta.texto).toBe(204);
      const clave = (await u.claveDeFoto()) as string;
      expect(clave, 'la foto quedó guardada: foto_clave no puede ser nula').not.toBeNull();
      expect(u.existe(clave), 'foto_clave apunta a un archivo borrado').toBe(true);
      expect(u.archivos()).toEqual([clave]);
      const solicitud = (await u.vistaCompleta()).body?.['solicitud'] as Record<string, unknown>;
      expect(solicitud['fotoCargada']).toBe(true);
      await u.comprobarComun({ conAviso: true, claves: [clave] });
    });
  });

  describe('caso 2: cortarAntesDelCommit (la base revierte)', () => {
    it('criterio 61 b2: responde 500 ERROR_INTERNO; foto_clave sigue siendo la de F1 y su archivo existe; en la carpeta del alumno queda solo ese archivo', async () => {
      const primera = await u.subir(png(100, 100));
      expect(primera.status, primera.texto).toBe(204);
      const f1 = (await u.claveDeFoto()) as string;
      u.banco().lineas.length = 0;
      u.armarAlGuardar('cortarAntesDelCommit');

      const respuesta = await u.subir(png(140, 140));
      u.desarmarAlGuardar();

      expect(u.banco().proxy.cortes, 'el proxy debía cortar una vez antes del COMMIT').toBe(1);
      expect(respuesta.status, respuesta.texto).toBe(500);
      expect(respuesta.body?.['codigo']).toBe('ERROR_INTERNO');
      expect(await u.claveDeFoto()).toBe(f1);
      expect(u.existe(f1), 'el archivo de F1 debía seguir en el disco').toBe(true);
      expect(u.archivos(), 'el archivo nuevo debía borrarse y el anterior quedar solo').toEqual([f1]);
      await u.comprobarComun({ conAviso: true, claves: [f1] });
    });
  });

  describe('caso 4: reintento limpio tras una confirmación incierta', () => {
    it('criterio 61 (caso 4): después del caso 1, una subida F3 sin cortes responde 204 y en la carpeta del alumno queda exactamente un archivo, el de F3', async () => {
      expect((await u.subir(png(100, 100))).status).toBe(204);
      const f1 = (await u.claveDeFoto()) as string;
      u.armarAlGuardar('cortarTrasCommit');
      const cortada = await u.subir(png(140, 140));
      u.desarmarAlGuardar();
      expect(u.banco().proxy.cortes).toBe(1);
      expect(cortada.status, cortada.texto).toBe(204);
      const f2 = (await u.claveDeFoto()) as string;
      expect(f2).not.toBe(f1);
      u.banco().lineas.length = 0;

      const reintento = await u.subir(png(160, 160));

      expect(reintento.status, reintento.texto).toBe(204);
      const f3 = (await u.claveDeFoto()) as string;
      expect(f3).not.toBe(f2);
      expect(u.existe(f3)).toBe(true);
      expect(u.archivos(), 'el reintento arrastra restos').toEqual([f3]);
      await u.comprobarComun({ conAviso: false, claves: [f1, f2, f3] });
    });
  });
});

conBanco('confirmación incierta de la foto, la base cae (criterio 61)', true, (u) => {
  describe('caso 3: caer (la base confirmó y la API ya no puede releer)', () => {
    it('criterio 61 b3: responde 500 ERROR_INTERNO sin borrar nada: con el proxy restablecido, foto_clave es la clave nueva y su archivo existe, y el de F1 sigue en el disco', async () => {
      const primera = await u.subir(png(100, 100));
      expect(primera.status, primera.texto).toBe(204);
      const f1 = (await u.claveDeFoto()) as string;
      u.banco().lineas.length = 0;
      u.armarAlGuardar('caer');

      // Plazo amplio: el resultado no depende del tiempo (la relectura puede tardar hasta la espera de conexión).
      const respuesta = await u.subir(png(140, 140), 60_000);
      u.desarmarAlGuardar();
      const cortes = u.banco().proxy.cortes;
      u.banco().proxy.restablecer();

      expect(cortes, 'el proxy debía cortar una vez en el COMMIT').toBe(1);
      expect(respuesta.status, respuesta.texto).toBe(500);
      expect(respuesta.body?.['codigo']).toBe('ERROR_INTERNO');
      const f2 = (await u.claveDeFoto()) as string;
      expect(f2, 'la foto quedó guardada: foto_clave debe ser una clave nueva').not.toBeNull();
      expect(f2).not.toBe(f1);
      expect(u.existe(f2), 'se borró el archivo nuevo sin saber si la foto quedó').toBe(true);
      expect(u.existe(f1), 'se borró el archivo anterior sin saber si la foto quedó').toBe(true);
      expect(u.archivos()).toEqual([f1, f2].sort((a, b) => a.localeCompare(b)));
      await u.comprobarComun({ conAviso: true, claves: [f1, f2] });
    }, 120_000);
  });
});
