// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import {
  AHORA_005,
  conRetencion,
  contarFilasDeInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerMatriculas,
  leerSolicitudes,
  rutaPublica,
  sembrarSolicitud,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import {
  AlmacenDeFallosDePrueba,
  type AppConAlmacen,
  archivosBajo,
  archivosDelAlumno,
  crearAppConAlmacen,
  exigirAlmacen,
  existeArchivoDeClave,
  fotoClaveDe,
  lineasJson,
  png,
  subirFoto,
  TEXTO_DE_RUTA_EN_EL_ERROR,
} from '../../utilidades/inscripciones-005b';
import type { Retenedor } from '../../utilidades/planes-clases';
import { contarAuditoria } from '../../utilidades/usuarios';

// Criterio 37 (crítico, efectos después de confirmar; D-21; PB8), archivo y transacción, sin restos visibles. La imagen se procesa y se guarda con
// una clave nueva antes de la transacción; la transacción vuelve a comprobar la solicitud (alumno `FOR UPDATE` y después solicitud `FOR UPDATE`),
// guarda la clave en `alumnos.foto_clave` y confirma; después se borra el archivo anterior. Si la transacción falla, se borra el archivo nuevo y la
// clave guardada no cambia; si falla el borrado del anterior, se registra un aviso (sin datos personales) y la respuesta sigue siendo 204. Dos subidas
// simultáneas con el mismo token dejan una sola foto, la de la última en confirmar. Sin auditoría. Fallos: si `guardar` falla, 500 ERROR_INTERNO y no
// cambia nada en la base; un borrado que falla deja un `warn` con el mensaje fijo 'No se pudo borrar un archivo', la academia y `error: { tipo }`, sin
// el mensaje del error (que lleva la ruta), el token ni datos personales. Una subida correcta escribe un `info` con el mensaje fijo 'Foto de la solicitud
// guardada' y la academia. Pruebas deterministas con la espera comprobada en `pg_locks`:
//   a) cancelación mientras sube; b) dos subidas a la vez; c) `borrar` que rechaza; d) `guardar` que rechaza; e) una subida y un envío con el mismo
//   DNI a la vez; f) ninguna subida escribe en `auditoria`.

describe('la foto y la transacción (criterio 37)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppConAlmacen;
  let almacen: AlmacenDeFallosDePrueba;
  let e: EscenarioInscripcion;
  let cliente: SolicitudSembrada;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({
      ahora: AHORA_005,
      nivelRegistro: 'trace',
      destinoRegistro: destino,
      envolver: (real) => {
        almacen = new AlmacenDeFallosDePrueba(real);
        return almacen;
      },
    });
  });
  beforeEach(async () => {
    exigirAlmacen(ctx);
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    ctx.vaciarAlmacen();
    almacen.fallarBorrar = false;
    almacen.fallarGuardar = false;
    almacen.alGuardar = undefined;
    almacen.alBorrar = undefined;
    almacen.llamadas.length = 0;
    lineas.length = 0;
    e = await crearEscenarioInscripcion();
    cliente = await sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
    });
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const subir = (token = cliente.token, cuerpo: Buffer = png(100, 100)) =>
    subirFoto(ctx, 'academia-a', { token, cuerpo });
  const claveDeFoto = () => fotoClaveDe(e.A.id, cliente.alumnoId);
  const archivos = () => archivosDelAlumno(ctx.raiz, e.A.id, cliente.alumnoId);
  const bloquearAlumno = (alumnoId: string) => async (retenedor: Retenedor) => {
    await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
      e.A.id,
      alumnoId,
    ]);
  };

  /** Pasa la solicitud y su matrícula a CANCELADA dentro de la transacción de la prueba (como dueño). */
  const cancelarSinConfirmar = (alumnoId: string, solicitudId: string) => async (retenedor: Retenedor) => {
    await bloquearAlumno(alumnoId)(retenedor);
    await retenedor.consultar(
      "UPDATE solicitudes_inscripcion SET estado = 'CANCELADA', actualizado_en = now() WHERE academia_id = $1::uuid AND id = $2::uuid",
      [e.A.id, solicitudId],
    );
    await retenedor.consultar(
      "UPDATE matriculas SET estado = 'CANCELADA', reserva_vence_en = NULL, actualizado_en = now() WHERE academia_id = $1::uuid AND solicitud_id = $2::uuid",
      [e.A.id, solicitudId],
    );
  };

  describe('secuencia', () => {
    it('criterio 37: la imagen se guarda con una clave nueva antes de la transacción (foto_clave aún no cambió) y la anterior se borra después de confirmar (foto_clave ya apunta a la nueva)', async () => {
      expect((await subir()).status).toBe(204);
      const anterior = (await claveDeFoto()) as string;
      almacen.llamadas.length = 0;
      let claveEnElGuardado: string | null | undefined;
      let claveEnElBorrado: string | null | undefined;
      almacen.alGuardar = async () => {
        claveEnElGuardado = await claveDeFoto();
      };
      almacen.alBorrar = async () => {
        claveEnElBorrado = await claveDeFoto();
      };

      const respuesta = await subir(cliente.token, png(120, 120));

      expect(respuesta.status, respuesta.texto).toBe(204);
      const nueva = (await claveDeFoto()) as string;
      expect(nueva).not.toBe(anterior);
      expect(almacen.llamadas.filter((l) => l.operacion === 'guardar').map((l) => l.clave)).toEqual([nueva]);
      expect(almacen.llamadas.filter((l) => l.operacion === 'borrar').map((l) => l.clave)).toEqual([anterior]);
      expect(claveEnElGuardado, 'al guardar el archivo nuevo la base no debía haber cambiado').toBe(anterior);
      expect(claveEnElBorrado, 'al borrar el anterior la base ya debía apuntar al nuevo').toBe(nueva);
      expect(almacen.llamadas.every((l) => l.academiaId === e.A.id)).toBe(true);
    });

    it('criterio 37: una subida correcta escribe un info con el mensaje fijo y la academia, sin el token ni datos personales', async () => {
      const respuesta = await subir();
      expect(respuesta.status).toBe(204);
      await esperarHasta(() => lineasJson(lineas).some((l) => l['msg'] === 'Foto de la solicitud guardada'));

      const registros = lineasJson(lineas).filter((l) => l['msg'] === 'Foto de la solicitud guardada');
      expect(registros).toHaveLength(1);
      expect(registros[0]?.['academiaId']).toBe(e.A.id);
      const clave = (await claveDeFoto()) as string;
      const texto = lineas.join('\n');
      for (const secreto of [cliente.token, cliente.dni, 'Valeria', 'Mendoza', clave]) {
        expect(texto, `el registro lleva ${secreto}`).not.toContain(secreto);
      }
    });
  });

  describe('a) cancelación mientras sube', () => {
    it('criterio 37 a: la subida válida espera la fila del alumno; la prueba cancela la solicitud y su matrícula y confirma: 409 SOLICITUD_NO_EDITABLE, foto_clave nula y ningún archivo nuevo', async () => {
      const antes = await instantaneaDeInscripciones(e.B.id);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: cancelarSinConfirmar(cliente.alumnoId, cliente.solicitudId),
        enviar: [() => subir()],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron, 'la subida no quedó esperando la fila del alumno').toBe(true);
      const [respuesta] = resultados;
      expect(respuesta?.status, respuesta?.texto).toBe(409);
      expect(respuesta?.body?.['codigo']).toBe('SOLICITUD_NO_EDITABLE');
      expect(await claveDeFoto()).toBeNull();
      expect(archivos(), 'quedó un archivo nuevo en la carpeta del alumno').toEqual([]);
      expect(archivosBajo(ctx.raiz)).toEqual([]);
      expect((await leerSolicitudes(e.A.id)).map((s) => s.estado)).toEqual(['CANCELADA']);
      expect((await leerMatriculas(e.A.id)).map((m) => m.estado)).toEqual(['CANCELADA']);
      expect(await instantaneaDeInscripciones(e.B.id)).toBe(antes);
    });

    it('criterio 37 a: con una foto anterior, la subida que pierde la carrera deja foto_clave y el archivo anterior intactos y sin archivos nuevos', async () => {
      expect((await subir()).status).toBe(204);
      const anterior = (await claveDeFoto()) as string;

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: cancelarSinConfirmar(cliente.alumnoId, cliente.solicitudId),
        enviar: [() => subir(cliente.token, png(150, 150))],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      expect(resultados[0]?.status).toBe(409);
      expect(await claveDeFoto()).toBe(anterior);
      expect(archivos()).toEqual([anterior]);
      expect(existeArchivoDeClave(ctx.raiz, anterior)).toBe(true);
    });

    it('criterio 37 a: si además falla el borrado del archivo nuevo, la respuesta sigue siendo la del fallo (409), el aviso lleva solo el tipo del error y la base no cambia', async () => {
      almacen.fallarBorrar = true;

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: cancelarSinConfirmar(cliente.alumnoId, cliente.solicitudId),
        enviar: [() => subir()],
        liberar: 'COMMIT',
      });

      expect(todasEsperaron).toBe(true);
      expect(resultados[0]?.status, resultados[0]?.texto).toBe(409);
      expect(await claveDeFoto()).toBeNull();
      await esperarHasta(() => lineasJson(lineas).some((l) => l['msg'] === 'No se pudo borrar un archivo'));
      const avisos = lineasJson(lineas).filter((l) => l['msg'] === 'No se pudo borrar un archivo');
      expect(avisos).toHaveLength(1);
      expect(avisos[0]?.['level']).toBe(40);
      expect(avisos[0]?.['academiaId']).toBe(e.A.id);
      expect(avisos[0]?.['error']).toEqual({ tipo: 'ErrorDeAlmacenDePrueba' });
      const texto = lineas.join('\n');
      for (const secreto of [cliente.token, TEXTO_DE_RUTA_EN_EL_ERROR, 'NombrePropioQueNoSeRegistra']) {
        expect(texto, `el registro lleva ${secreto}`).not.toContain(secreto);
      }
    });
  });

  describe('b) dos subidas a la vez', () => {
    it('criterio 37 b: dos subidas con el mismo token e imágenes distintas responden 204; foto_clave apunta a un archivo que existe y es el único de la carpeta del alumno', async () => {
      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: bloquearAlumno(cliente.alumnoId),
        enviar: [() => subir(cliente.token, png(100, 100)), () => subir(cliente.token, png(130, 130))],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'las dos subidas no quedaron esperando').toBe(true);
      expect(resultados.map((r) => r.status)).toEqual([204, 204]);
      const clave = await claveDeFoto();
      expect(clave).not.toBeNull();
      expect(existeArchivoDeClave(ctx.raiz, clave as string), 'foto_clave apunta a un archivo que no existe').toBe(
        true,
      );
      expect(archivos(), 'quedan archivos sin referencia').toEqual([clave]);
    });

    it('criterio 37 b: con una foto anterior, dos subidas simultáneas dejan una sola foto (la de foto_clave) y borran la anterior', async () => {
      expect((await subir()).status).toBe(204);
      const anterior = (await claveDeFoto()) as string;

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: e.A.id,
        retener: bloquearAlumno(cliente.alumnoId),
        enviar: [() => subir(cliente.token, png(110, 110)), () => subir(cliente.token, png(140, 140))],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron).toBe(true);
      expect(resultados.map((r) => r.status)).toEqual([204, 204]);
      const clave = (await claveDeFoto()) as string;
      expect(clave).not.toBe(anterior);
      expect(archivos()).toEqual([clave]);
    });
  });

  describe('c) el borrado del archivo anterior falla', () => {
    it('criterio 37 c: una segunda subida responde 204 y cambia foto_clave; el archivo anterior sigue en el disco y el registro tiene el aviso sin el token', async () => {
      expect((await subir()).status).toBe(204);
      const anterior = (await claveDeFoto()) as string;
      almacen.fallarBorrar = true;
      lineas.length = 0;

      const respuesta = await subir(cliente.token, png(120, 120));

      expect(respuesta.status, respuesta.texto).toBe(204);
      const nueva = (await claveDeFoto()) as string;
      expect(nueva).not.toBe(anterior);
      expect(existeArchivoDeClave(ctx.raiz, anterior), 'el archivo anterior debía seguir en el disco').toBe(true);
      expect(existeArchivoDeClave(ctx.raiz, nueva)).toBe(true);
      await esperarHasta(() => lineasJson(lineas).some((l) => l['msg'] === 'No se pudo borrar un archivo'));
      const avisos = lineasJson(lineas).filter((l) => l['msg'] === 'No se pudo borrar un archivo');
      expect(avisos).toHaveLength(1);
      expect(avisos[0]?.['level'], 'es un warn').toBe(40);
      expect(avisos[0]?.['academiaId']).toBe(e.A.id);
      expect(avisos[0]?.['error'], 'solo el tipo del error').toEqual({ tipo: 'ErrorDeAlmacenDePrueba' });
      const texto = lineas.join('\n');
      for (const secreto of [
        cliente.token,
        TEXTO_DE_RUTA_EN_EL_ERROR,
        'NombrePropioQueNoSeRegistra',
        cliente.dni,
        'Valeria',
      ]) {
        expect(texto, `el registro lleva ${secreto}`).not.toContain(secreto);
      }
    });
  });

  describe('d) guardar falla', () => {
    it('criterio 37 d: con un almacén cuyo guardar rechaza, la subida responde 500 ERROR_INTERNO y foto_clave no cambia (nula)', async () => {
      almacen.fallarGuardar = true;
      const antes = await instantaneaDeInscripciones(e.A.id);

      const respuesta = await subir();

      expect(respuesta.status, respuesta.texto).toBe(500);
      expect(respuesta.body?.['codigo']).toBe('ERROR_INTERNO');
      expect(respuesta.texto).not.toContain(TEXTO_DE_RUTA_EN_EL_ERROR);
      expect(await claveDeFoto()).toBeNull();
      expect(await instantaneaDeInscripciones(e.A.id)).toBe(antes);
      expect(archivosBajo(ctx.raiz)).toEqual([]);
      expect(await contarAuditoria(e.A.id)).toBe(0);
    });

    it('criterio 37 d: con una foto anterior, el guardar que falla deja foto_clave y el archivo anterior como estaban', async () => {
      expect((await subir()).status).toBe(204);
      const anterior = (await claveDeFoto()) as string;
      almacen.fallarGuardar = true;

      const respuesta = await subir(cliente.token, png(150, 150));

      expect(respuesta.status).toBe(500);
      expect(await claveDeFoto()).toBe(anterior);
      expect(archivos()).toEqual([anterior]);
    });

    it('criterio 37 d: el 500 no deja el token ni la ruta en el registro técnico', async () => {
      almacen.fallarGuardar = true;
      lineas.length = 0;

      await subir();
      await esperarHasta(() => lineas.length > 0);

      const texto = lineas.join('\n');
      expect(texto).not.toContain(cliente.token);
      expect(texto).not.toContain(cliente.dni);
    });
  });

  describe('e) una subida y un envío con el mismo DNI a la vez', () => {
    it('criterio 37 e: la prueba retiene la fila de la solicitud; la subida y el envío quedan esperando y, al soltar, no hay 500 ni 40P01 (la subida 204 y el envío 409 DNI_YA_REGISTRADO)', async () => {
      const cuerpo = await cuerpoInscripcion(e, { sobre: { alumno: { dni: cliente.dni } } });

      const { resultados } = await conRetencion({
        academiaId: e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar(
            'SELECT id FROM solicitudes_inscripcion WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [e.A.id, cliente.solicitudId],
          );
        },
        // La subida primero y el envío después, cuando la subida ya espera: el orden de bloqueos (alumno antes que solicitud) las deja sin ciclo.
        enviar: [() => subir(), () => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo)],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      // La espera del envío no se exige (puede decidir su 409 sin esperar): lo que importa es que ninguno falle.
      const [subida, envio] = resultados;
      expect(subida?.status, subida?.texto).toBe(204);
      expect(envio?.status, envio?.texto).toBe(409);
      expect(envio?.body?.['codigo']).toBe('DNI_YA_REGISTRADO');
      expect(await claveDeFoto()).toMatch(/^academias\//);
      expect(await contarFilasDeInscripciones(e.A.id)).toMatchObject({
        alumnos: 1,
        solicitudes_inscripcion: 1,
        matriculas: 1,
      });
    });

    it('criterio 37 e: lo mismo con el envío primero y la subida después', async () => {
      const cuerpo = await cuerpoInscripcion(e, { sobre: { alumno: { dni: cliente.dni } } });

      const { resultados } = await conRetencion({
        academiaId: e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar(
            'SELECT id FROM solicitudes_inscripcion WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [e.A.id, cliente.solicitudId],
          );
        },
        enviar: [() => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo), () => subir()],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      const [envio, subida] = resultados;
      expect(envio?.status, envio?.texto).toBe(409);
      expect(subida?.status, subida?.texto).toBe(204);
    });
  });

  describe('f) ninguna subida audita', () => {
    it('criterio 37 f: una subida correcta, un reemplazo y varios rechazos no escriben ninguna fila en auditoria', async () => {
      const antes = await contarAuditoria(e.A.id);

      await subir();
      await subir(cliente.token, png(120, 120));
      await subirFoto(ctx, 'academia-a', { token: cliente.token, cuerpo: Buffer.from('basura') });
      await subirFoto(ctx, 'academia-a', { token: cliente.token, cuerpo: png(100, 100), tipo: 'image/gif' });
      await subir('x'.repeat(43));

      expect(await contarAuditoria(e.A.id)).toBe(antes);
      expect(await contarAuditoria(e.B.id)).toBe(0);
      const { rows } = await ejecutarComo(
        'propietario',
        'SELECT count(*)::int AS n FROM auditoria WHERE academia_id = $1::uuid',
        [e.A.id],
        {
          academiaId: e.A.id,
        },
      );
      expect((rows[0] as { n: number }).n).toBe(0);
    });
  });
});
