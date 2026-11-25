// spec: 008-carnet-qr (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { rutaTicket } from '../../utilidades/escenario-pagos';
import { leerPagos } from '../../utilidades/pagos';
import {
  type AppCarnet,
  crearAlumnoPorPago,
  crearAppCarnet,
  cuerpoBuscar,
  cuerpoRegenerar,
  type EscenarioDelCarnet,
  leerQr,
  prepararEscenarioDelCarnet,
  RUTA_BUSCAR,
  RUTA_MI_CARNET,
  RUTA_MI_CARNET_PDF,
  rutaCarnet,
  rutaCarnetPdf,
  rutaRegenerarQr,
  todosLosTokens,
} from '../../utilidades/escenario-carnet';
import { rutaPublica } from '../../utilidades/inscripciones';
import { lineasJson } from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import { rutasRegistradas } from '../../utilidades/usuarios';

// Criterio 17 (crítico, RN-06, D-23): el token y el contenido del QR solo viajan en el cuerpo de las respuestas de `carnetSchema` (criterios 4, 6 y 13) y dentro del PDF. Nunca aparecen en una dirección de la API o de la web, en la auditoría (ninguna acción, tampoco
// `PAGO_REGISTRADO`, `PAGO_APROBADO`, `USUARIO_CREADO` ni `CARNET_QR_REGENERADO`), en el registro técnico (ningún nivel), en un correo ni en la vista de seguimiento de la 005. Con la transacción de la academia A, buscar en `alumnos` por un `qr_token` de B no devuelve
// filas (RLS).
// Criterio 16, parte del registro: el texto buscado no va al registro técnico.
// Va en su propio archivo, con una sola aplicación y la primera del proceso: el registro técnico de pino (nivel y redacción) es global del proceso y lo fija la primera aplicación que se crea.
// Lectura estricta elegida: se busca cada token (el vigente y todos los anteriores) y el prefijo `AQ1:` en todas las líneas del registro técnico, en todas las filas de la auditoría de las dos academias, en todos los correos y en todas las respuestas que no son
// de `carnetSchema`; y la dirección de cada petición de la prueba (y las rutas registradas) no lleva token.

describe('el token del QR no sale de su sitio (criterio 17)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;

  beforeAll(async () => {
    ctx = await crearAppCarnet({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const consulta = (token: string) => ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { token });

  it('criterio 17: tras confirmar pagos (efectivo y Yape), leer el carnet y el PDF, regenerar y buscar, ningún token (ni el vigente ni los anteriores) ni AQ1: está en la auditoría, el registro técnico, los correos, las direcciones ni las respuestas que no son del carnet', async () => {
    const textoBuscado = 'Quillahuaman-Texto-Unico';
    const efectivo = await crearAlumnoPorPago(ctx, esc, { nombres: 'Zenobia', apellidos: textoBuscado });
    const yape = await crearAlumnoPorPago(ctx, esc, { metodo: 'YAPE', nombres: 'Yolanda', apellidos: 'Huaman Ccori' });
    const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B', nombres: 'Beatriz', apellidos: 'Flores Ramos' });
    const vistos = new Set<string>();
    const registrar = async () => {
      for (const token of await todosLosTokens(esc.e)) vistos.add(token);
    };
    await registrar();
    const direcciones: string[] = [];
    const pedir = async <T extends { status: number }>(direccion: string, hacer: () => Promise<T>): Promise<T> => {
      direcciones.push(direccion);
      return hacer();
    };
    const otrasRespuestas: string[] = [];

    // Lo que sí lleva el token (el carnet y el PDF) y lo que cambia el token.
    await pedir(rutaCarnet(efectivo.alumnoId), () =>
      ctx.http.get(rutaCarnet(efectivo.alumnoId), { cookie: esc.cookies.secretaria }),
    );
    await pedir(rutaCarnetPdf(efectivo.alumnoId), () =>
      ctx.http.get(rutaCarnetPdf(efectivo.alumnoId), { cookie: esc.cookies.secretaria }),
    );
    await pedir(RUTA_MI_CARNET, () => ctx.http.get(RUTA_MI_CARNET, { cookie: yape.cookie }));
    await pedir(RUTA_MI_CARNET_PDF, () => ctx.http.get(RUTA_MI_CARNET_PDF, { cookie: yape.cookie }));
    await pedir(rutaRegenerarQr(efectivo.alumnoId), () =>
      ctx.http.post(rutaRegenerarQr(efectivo.alumnoId), cuerpoRegenerar(), { cookie: esc.cookies.secretaria }),
    );
    await registrar();
    await pedir(rutaRegenerarQr(efectivo.alumnoId), () =>
      ctx.http.post(rutaRegenerarQr(efectivo.alumnoId), cuerpoRegenerar(), { cookie: esc.cookies.admin }),
    );
    await registrar();
    const busqueda = await pedir(RUTA_BUSCAR, () =>
      ctx.http.post(RUTA_BUSCAR, cuerpoBuscar(textoBuscado), { cookie: esc.cookies.secretaria }),
    );
    expect(busqueda.status, busqueda.texto.slice(0, 300)).toBe(200);
    otrasRespuestas.push(busqueda.texto);

    // Todo lo demás que conoce al alumno: seguimiento de la solicitud (005), lista del panel, ticket del pago, sesión.
    const seguimiento = await pedir('/solicitudes/consulta', () => consulta(efectivo.tokenSeguimiento));
    otrasRespuestas.push(seguimiento.texto);
    const seguimientoDelYape = await pedir('/solicitudes/consulta', () => consulta(yape.tokenSeguimiento));
    otrasRespuestas.push(seguimientoDelYape.texto);
    const porCodigo = await pedir('/solicitudes/consulta', () =>
      ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
        codigo: efectivo.codigoSolicitud,
        dni: efectivo.dni,
      }),
    );
    otrasRespuestas.push(porCodigo.texto);
    const panel = await pedir('/api/solicitudes', () =>
      ctx.http.get('/api/solicitudes', { cookie: esc.cookies.secretaria }),
    );
    otrasRespuestas.push(panel.texto);
    const pagos = await leerPagos(esc.e.A.id);
    for (const pago of pagos) {
      const ticket = await pedir(rutaTicket(pago.id), () =>
        ctx.http.get(rutaTicket(pago.id), { cookie: esc.cookies.secretaria }),
      );
      otrasRespuestas.push(ticket.texto);
    }
    const sesion = await pedir('/api/sesion', () => ctx.http.get('/api/sesion', { cookie: efectivo.cookie }));
    otrasRespuestas.push(sesion.texto);
    const alumnoNoVeOtraSesion = await pedir(rutaCarnet(efectivo.alumnoId), () =>
      ctx.http.get(rutaCarnet(efectivo.alumnoId), { cookie: esc.cookies.secretariaB }),
    );
    otrasRespuestas.push(alumnoNoVeOtraSesion.texto);
    await registrar();

    expect(vistos.size, 'tres alumnos y dos regeneraciones: cinco tokens distintos en total').toBe(5);
    expect(deB.alumnoId).toBeTruthy();
    const buscados = [...vistos, 'AQ1:'];
    const donde: [string, string][] = [
      ['la auditoría de A', JSON.stringify(await leerAuditoriaDeAcademia(esc.e.A.id))],
      ['la auditoría de B', JSON.stringify(await leerAuditoriaDeAcademia(esc.e.B.id))],
      ['los correos', JSON.stringify(ctx.correo.mensajes)],
      ['las respuestas que no son del carnet', otrasRespuestas.join('\n')],
      ['las direcciones pedidas', direcciones.join('\n')],
      [
        'las rutas registradas',
        rutasRegistradas(ctx.app)
          .map(([m, r]) => `${m} ${r}`)
          .join('\n'),
      ],
    ];
    for (const [nombre, texto] of donde) {
      for (const token of buscados) expect(texto, `el token no aparece en ${nombre}`).not.toContain(token);
    }
    expect(lineas.length, 'el registro técnico quedó con líneas (nivel trace)').toBeGreaterThan(0);
    const registro = lineas.join('\n');
    for (const token of buscados)
      expect(registro, 'el token no aparece en ninguna línea del registro técnico (ningún nivel)').not.toContain(token);
    expect(lineasJson(lineas).length).toBeGreaterThan(0);
    // También el contenido codificado para una dirección o para un JSON dentro del registro.
    for (const token of vistos) {
      expect(registro).not.toContain(encodeURIComponent(`AQ1:${token}`));
      expect(registro).not.toContain(JSON.stringify(`AQ1:${token}`));
    }
  });

  it('criterio 16: el texto buscado (nombre y DNI) no va al registro técnico, ni cuando la búsqueda encuentra y ni cuando no encuentra', async () => {
    const alumno = await crearAlumnoPorPago(ctx, esc, {
      nombres: 'Zenobia',
      apellidos: 'Quillahuaman Texto Unico',
      dni: '47811902',
    });
    lineas.length = 0;

    const porNombre = await ctx.http.post(RUTA_BUSCAR, cuerpoBuscar('Quillahuaman Texto'), {
      cookie: esc.cookies.secretaria,
    });
    const porDni = await ctx.http.post(RUTA_BUSCAR, cuerpoBuscar('47811902'), { cookie: esc.cookies.secretaria });
    const sinResultado = await ctx.http.post(RUTA_BUSCAR, cuerpoBuscar('Zorrito Inexistente'), {
      cookie: esc.cookies.secretaria,
    });
    const invalida = await ctx.http.post(
      RUTA_BUSCAR,
      { texto: 'Textoraro-de-más-de-sesenta-caracteres-'.repeat(3) },
      { cookie: esc.cookies.secretaria },
    );

    expect(porNombre.status, porNombre.texto.slice(0, 300)).toBe(200);
    expect(porDni.status).toBe(200);
    expect(sinResultado.status).toBe(200);
    expect(invalida.status).toBe(400);
    expect(alumno.alumnoId).toBeTruthy();
    const registro = lineas.join('\n');
    expect(lineas.length, 'hubo registro técnico de las peticiones').toBeGreaterThan(0);
    for (const texto of ['Quillahuaman', 'Texto Unico', '47811902', 'Zorrito', 'Inexistente', 'Textoraro']) {
      expect(registro, `el registro técnico no lleva «${texto}»`).not.toContain(texto);
    }
  });

  it('criterio 17: la regeneración no escribe su cuerpo ni el token en el registro técnico: ni el motivo, ni la clave, ni el contenido', async () => {
    const alumno = await crearAlumnoPorPago(ctx, esc);
    lineas.length = 0;
    const cuerpo = cuerpoRegenerar({ motivo: 'Motivo-Reservado-Del-Carnet' });

    const respuesta = await ctx.http.post(rutaRegenerarQr(alumno.alumnoId), cuerpo, { cookie: esc.cookies.secretaria });

    expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
    const registro = lineas.join('\n');
    expect(lineas.length).toBeGreaterThan(0);
    const nuevo = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token as string;
    expect(registro).not.toContain(nuevo);
    expect(registro).not.toContain('AQ1:');
    expect(registro, 'el motivo es de la auditoría, no del registro técnico').not.toContain(
      'Motivo-Reservado-Del-Carnet',
    );
  });

  it('criterio 17: con la transacción de la academia A, buscar en alumnos por un qr_token de B no devuelve filas (RLS); con la de B, sí', async () => {
    const deA = await crearAlumnoPorPago(ctx, esc);
    const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });
    const tokenDeB = (await leerQr(esc.e.B.id, deB.alumnoId)).qr_token as string;
    const tokenDeA = (await leerQr(esc.e.A.id, deA.alumnoId)).qr_token as string;

    const comoA = await ejecutarComo('app', 'SELECT id, academia_id FROM alumnos WHERE qr_token = $1', [tokenDeB], {
      academiaId: esc.e.A.id,
    });
    const comoB = await ejecutarComo('app', 'SELECT id FROM alumnos WHERE qr_token = $1', [tokenDeB], {
      academiaId: esc.e.B.id,
    });
    const deBPorA = await ejecutarComo(
      'app',
      'SELECT id FROM alumnos WHERE academia_id = $2::uuid AND qr_token = $1',
      [tokenDeB, esc.e.B.id],
      {
        academiaId: esc.e.A.id,
      },
    );
    const sinContexto = await ejecutarComo('app', 'SELECT id FROM alumnos WHERE qr_token = $1', [tokenDeA]);
    const lista = await ejecutarComo('app', 'SELECT qr_token FROM alumnos', [], { academiaId: esc.e.A.id });

    expect(comoA.rows, 'desde A, el token de B no existe').toEqual([]);
    expect(comoB.rows).toEqual([{ id: deB.alumnoId }]);
    expect(deBPorA.rows, 'ni diciendo la academia de B en la consulta').toEqual([]);
    expect(sinContexto.rows, 'sin academia en la transacción, no se ve ninguna fila').toEqual([]);
    expect((lista.rows as { qr_token: string }[]).map((f) => f.qr_token)).toEqual([tokenDeA]);
  });

  it('criterio 17: con la transacción de A no se puede cambiar el token de un alumno de B (RLS): el UPDATE afecta 0 filas', async () => {
    const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });
    const antes = (await leerQr(esc.e.B.id, deB.alumnoId)).qr_token as string;

    const resultado = await ejecutarComo(
      'app',
      `UPDATE alumnos SET qr_token = $2, qr_generado_en = now() WHERE id = $1::uuid`,
      [deB.alumnoId, 'B'.repeat(43)],
      { academiaId: esc.e.A.id },
    );

    expect(resultado.rowCount).toBe(0);
    expect((await leerQr(esc.e.B.id, deB.alumnoId)).qr_token).toBe(antes);
  });

  it('criterio 17: ninguna ruta de la API ni de la web recibe el token o el contenido del QR en la dirección (sin segmentos :token, :qr ni :contenido en /api/alumnos y /api/mi-carnet)', () => {
    const rutas = rutasRegistradas(ctx.app)
      .map(([metodo, ruta]) => `${metodo} ${ruta}`)
      .filter((ruta) => /\/api\/(alumnos|mi-carnet)/.test(ruta));

    expect(rutas.length).toBeGreaterThanOrEqual(6);
    for (const ruta of rutas) expect(ruta, ruta).not.toMatch(/:(token|qr|contenido|qrToken)\b/i);
  });
});
