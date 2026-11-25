import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  type AlumnoConQr,
  type AppCarnet,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
} from '../../utilidades/escenario-carnet';
import {
  ACCION_FOTO_PANEL,
  prepararEscenarioFotoPanel,
  rutaFotoAlumno,
  rutaFotoSolicitud,
  sembrarCliente,
  subirFotoPanel,
} from '../../utilidades/escenario-foto-panel';
import { IP_RE, type SolicitudSembrada } from '../../utilidades/inscripciones';
import { fotoClaveDe, lineasJson, png } from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';

// Prueba no protegida de la 008b (T20, criterio 27, «prueba obligatoria»): cada subida correcta del panel audita una sola entrada `ALUMNO_FOTO_ACTUALIZADA` (entidad `alumno`, `entidadId` el id del alumno, actor `USUARIO`, IP, `datosAntes: { tieneFoto }`,
// `datosDespues: { tieneFoto: true, origen }` con `origen` `'PANEL_ALUMNO'` o `'PANEL_SOLICITUD'`), sin la imagen, la clave, el DNI ni datos médicos; y un `info` `'Foto del alumno guardada'` con la academia. La subida pública de la 005b sigue sin auditar. Un rechazo no audita.
// `origen` va dentro de `datosDespues` porque `auditoria` no tiene una columna para él (DT de la 008b).

const MENSAJE_GUARDADA = 'Foto del alumno guardada';

describe('la auditoría de la foto del panel (criterio 27)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;
  let cliente: SolicitudSembrada;

  beforeAll(async () => {
    ctx = await crearAppCarnet({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioFotoPanel(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc);
    cliente = await sembrarCliente(esc);
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const entradas = () => leerAuditoriaDeAcademia(esc.e.A.id, ACCION_FOTO_PANEL);
  const guardadas = () => lineasJson(lineas).filter((linea) => linea['msg'] === MENSAJE_GUARDADA);

  it('la foto de un alumno sin foto: una entrada con tieneFoto false antes y true después, origen PANEL_ALUMNO, el actor y la IP', async () => {
    const respuesta = await subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), {
      cookie: esc.cookies.secretaria,
      cuerpo: png(100, 100),
    });
    expect(respuesta.status, respuesta.texto).toBe(204);

    const filas = await entradas();
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila).toMatchObject({
      actor_tipo: 'USUARIO',
      actor_id: esc.e.secretariaA.id,
      accion: ACCION_FOTO_PANEL,
      entidad: 'alumno',
      entidad_id: alumno.alumnoId,
      datos_antes: { tieneFoto: false },
      datos_despues: { tieneFoto: true, origen: 'PANEL_ALUMNO' },
    });
    expect(fila?.ip).toMatch(IP_RE);
  });

  it('una segunda foto del mismo alumno: otra entrada, con tieneFoto true antes; la del administrador va a su nombre', async () => {
    await subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: esc.cookies.secretaria });
    const respuesta = await subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), {
      cookie: esc.cookies.admin,
      cuerpo: png(150, 150),
    });
    expect(respuesta.status, respuesta.texto).toBe(204);

    const filas = await entradas();
    expect(filas).toHaveLength(2);
    expect(filas[1]).toMatchObject({
      actor_id: esc.e.adminA.id,
      datos_antes: { tieneFoto: true },
      datos_despues: { tieneFoto: true, origen: 'PANEL_ALUMNO' },
    });
  });

  it('la foto por la solicitud de un cliente: origen PANEL_SOLICITUD y la entidad es el alumno de la solicitud', async () => {
    const respuesta = await subirFotoPanel(ctx, rutaFotoSolicitud(cliente.solicitudId), {
      cookie: esc.cookies.secretaria,
    });
    expect(respuesta.status, respuesta.texto).toBe(204);

    const filas = await entradas();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      actor_tipo: 'USUARIO',
      actor_id: esc.e.secretariaA.id,
      entidad: 'alumno',
      entidad_id: cliente.alumnoId,
      datos_antes: { tieneFoto: false },
      datos_despues: { tieneFoto: true, origen: 'PANEL_SOLICITUD' },
    });
  });

  it('la entrada no lleva la clave, la imagen, el DNI ni datos médicos; el info lleva la academia y no la clave', async () => {
    await subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: esc.cookies.secretaria });
    const clave = (await fotoClaveDe(esc.e.A.id, alumno.alumnoId)) as string;

    const fila = (await entradas())[0];
    const texto = JSON.stringify(fila);
    expect(texto).not.toContain(clave);
    expect(texto).not.toContain('foto-');
    expect(texto).not.toContain(alumno.dni);
    expect(texto.toLowerCase()).not.toMatch(/medic|alergia|condicion/);
    expect(Object.keys(fila?.datos_antes as object)).toEqual(['tieneFoto']);
    expect(Object.keys(fila?.datos_despues as object).sort()).toEqual(['origen', 'tieneFoto']);

    await esperarHasta(() => guardadas().length > 0);
    expect(guardadas()).toHaveLength(1);
    expect(JSON.stringify(guardadas()[0])).toContain(esc.e.A.id);
    expect(JSON.stringify(lineasJson(lineas))).not.toContain(clave);
  });

  it('los rechazos (permiso, 404, 409, imagen) no auditan ni dejan un info', async () => {
    const intentos = [
      subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), { cookie: esc.cookies.entrenador }),
      subirFotoPanel(ctx, rutaFotoAlumno(cliente.alumnoId), { cookie: esc.cookies.secretaria }),
      subirFotoPanel(ctx, rutaFotoAlumno(alumno.alumnoId), {
        cookie: esc.cookies.secretaria,
        cuerpo: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)]),
      }),
    ];
    const estados = (await Promise.all(intentos)).map((r) => r.status);

    expect(estados).toEqual([403, 404, 400]);
    expect(await entradas()).toHaveLength(0);
    expect(guardadas()).toHaveLength(0);
  });
});
