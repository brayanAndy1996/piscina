// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AHORA_005,
  codigoDe,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  EnviadorDePrueba,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  leerSolicitudes,
  type Objeto,
  rutaPublica,
  solicitudDe,
} from '../../utilidades/inscripciones';
import { dejarPasarEventos } from '../../utilidades/inscripciones-ronda1';
import {
  AlmacenDeFallosDePrueba,
  type AppConAlmacen,
  archivosDelAlumno,
  crearAppConAlmacen,
  exigirAlmacen,
  existeArchivoDeClave,
  fotoClaveDe,
  leerArchivoDeClave,
  png,
  subirFoto,
} from '../../utilidades/inscripciones-005b';
import { esperarHasta } from '../../utilidades/modulos';
import { cookieDeUsuario } from '../../utilidades/usuarios';

// Criterio 39, "Sin aviso al cliente" y prueba h (crítico; respuestas B1 y B2, DR-17 y DR-18): la cancelación no envía correo ni ningún otro aviso; el
// cliente ve "Cancelada" en su enlace de seguimiento. Tampoco toca la foto: `alumnos.foto_clave` y el archivo guardado no cambian. Prueba h: con el
// `EnviadorCorreo` de prueba, una cancelación correcta de una solicitud cuyo alumno tiene foto no llama a `enviar`; después, `alumnos.foto_clave`
// sigue igual y su archivo sigue en el almacén. (El vencimiento tampoco borra la foto: DR-18.)

describe('cancelar no avisa al cliente ni toca su foto (criterio 39 h)', () => {
  const correo = new EnviadorDePrueba();
  let ctx: AppConAlmacen;
  let almacen: AlmacenDeFallosDePrueba;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppConAlmacen({
      ahora: AHORA_005,
      correo,
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
    correo.mensajes.length = 0;
    correo.fallar = false;
    almacen.llamadas.length = 0;
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  /** Envía el formulario con correo del alumno y del apoderado (menor), sube una foto y deja los mensajes y las llamadas al almacén en cero. */
  async function solicitudConFoto() {
    const cuerpo = await cuerpoInscripcion(e, {
      sobre: { alumno: { correo: 'alumno@ejemplo.test' } },
    });
    const envio = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
    expect(envio.status, envio.texto).toBe(201);
    const creada = solicitudDe(envio);
    await esperarHasta(() => correo.mensajes.length >= 1);
    expect(correo.mensajes.length, 'el envío del formulario sí manda el correo del enlace').toBe(1);
    const subida = await subirFoto(ctx, 'academia-a', { token: creada.token, cuerpo: png(120, 120) });
    expect(subida.status, subida.texto).toBe(204);
    const fila = (await leerSolicitudes(e.A.id)).find((s) => s.codigo === creada.codigo);
    expect(fila).toBeDefined();
    const clave = (await fotoClaveDe(e.A.id, fila?.alumno_id as string)) as string;
    expect(clave).toBeTruthy();
    correo.mensajes.length = 0;
    almacen.llamadas.length = 0;
    return { creada, solicitudId: fila?.id as string, alumnoId: fila?.alumno_id as string, clave };
  }

  it('criterio 39 h: cancelar la solicitud de un alumno con foto no llama a enviar; foto_clave sigue igual y su archivo sigue en el almacén, sin ninguna operación de borrado', async () => {
    const { creada, solicitudId, alumnoId, clave } = await solicitudConFoto();
    const bytes = leerArchivoDeClave(ctx.raiz, clave);

    const respuesta = await ctx.http.post(
      `/api/solicitudes/${solicitudId}/cancelar`,
      { motivo: 'La familia llamó para anular' },
      { cookie: cookieDeUsuario(e.secretariaA, AHORA_005) },
    );

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect((respuesta.body?.['solicitud'] as Objeto)['estado']).toBe('CANCELADA');
    await dejarPasarEventos();
    expect(correo.mensajes, 'la cancelación mandó un correo').toEqual([]);
    expect(await fotoClaveDe(e.A.id, alumnoId)).toBe(clave);
    expect(existeArchivoDeClave(ctx.raiz, clave)).toBe(true);
    expect(leerArchivoDeClave(ctx.raiz, clave).equals(bytes)).toBe(true);
    expect(archivosDelAlumno(ctx.raiz, e.A.id, alumnoId)).toEqual([clave]);
    expect(
      almacen.llamadas.filter((llamada) => llamada.operacion !== 'leer'),
      'la cancelación escribió o borró en el almacén',
    ).toEqual([]);
    // El cliente ve "Cancelada" en su enlace (vista reducida), que sigue funcionando.
    const seguimiento = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
      token: creada.token,
    });
    expect(seguimiento.status).toBe(200);
    expect((seguimiento.body?.['solicitud'] as Objeto)['estado']).toBe('CANCELADA');
  });

  it('criterio 39 h: una segunda cancelación (200 sin escribir) tampoco manda correo ni toca la foto', async () => {
    const { solicitudId, alumnoId, clave } = await solicitudConFoto();
    const cookie = cookieDeUsuario(e.adminA, AHORA_005);
    await ctx.http.post(`/api/solicitudes/${solicitudId}/cancelar`, { motivo: 'Primera cancelación' }, { cookie });

    const otra = await ctx.http.post(
      `/api/solicitudes/${solicitudId}/cancelar`,
      { motivo: 'Segunda cancelación' },
      { cookie },
    );

    expect(otra.status).toBe(200);
    await dejarPasarEventos();
    expect(correo.mensajes).toEqual([]);
    expect(await fotoClaveDe(e.A.id, alumnoId)).toBe(clave);
    expect(existeArchivoDeClave(ctx.raiz, clave)).toBe(true);
  });

  it('criterio 39 h: una cancelación rechazada (409 SOLICITUD_NO_CANCELABLE) o con un id que no existe tampoco manda correo ni toca la foto', async () => {
    const { solicitudId, alumnoId, clave } = await solicitudConFoto();
    const cookie = cookieDeUsuario(e.adminA, AHORA_005);

    const noExiste = await ctx.http.post(
      '/api/solicitudes/00000000-0000-4000-8000-000000000000/cancelar',
      { motivo: 'No existe' },
      { cookie },
    );
    const malCuerpo = await ctx.http.post(`/api/solicitudes/${solicitudId}/cancelar`, { motivo: 'x' }, { cookie });

    expect([noExiste.status, malCuerpo.status]).toEqual([404, 400]);
    expect(codigoDe(noExiste)).toBe('NO_ENCONTRADO');
    await dejarPasarEventos();
    expect(correo.mensajes).toEqual([]);
    expect(await fotoClaveDe(e.A.id, alumnoId)).toBe(clave);
  });

  it('criterio 39 h (DR-18): el vencimiento de la reserva tampoco borra la foto: pasadas las 24 horas la solicitud se ve VENCIDA y foto_clave y el archivo siguen', async () => {
    const { creada, alumnoId, clave } = await solicitudConFoto();

    ctx.reloj.fijar(new Date(AHORA_005.getTime() + 25 * 60 * 60 * 1000));
    const seguimiento = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
      token: creada.token,
    });

    expect((seguimiento.body?.['solicitud'] as Objeto)['estado']).toBe('VENCIDA');
    expect(await fotoClaveDe(e.A.id, alumnoId)).toBe(clave);
    expect(existeArchivoDeClave(ctx.raiz, clave)).toBe(true);
    expect(almacen.llamadas.filter((llamada) => llamada.operacion === 'borrar')).toEqual([]);
  });
});
