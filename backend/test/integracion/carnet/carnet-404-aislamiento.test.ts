// spec: 008-carnet-qr (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria } from '../../utilidades/datos';
import { sembrarCobrable } from '../../utilidades/escenario-pagos';
import {
  type AlumnoConQr,
  type AppCarnet,
  carnetDe,
  codigoDeRespuesta,
  crearAlumnoPorPago,
  crearAppCarnet,
  cuerpoRegenerar,
  type EscenarioDelCarnet,
  instantaneaDelCarnet,
  leerQr,
  prepararEscenarioDelCarnet,
  rutaCarnet,
  rutaCarnetPdf,
  rutaRegenerarQr,
  tokenDelCarnet,
} from '../../utilidades/escenario-carnet';
import { sembrarSolicitud, sinUuid } from '../../utilidades/inscripciones';

// Criterio 5 (crítico, D-23, RN-05, AT-2 de 004): en todas las rutas `/api/alumnos/{id}/…` de esta historia (carnet, PDF, regeneración), un `{id}` que no es UUID, que no existe, que es de otra academia o que es de un `CLIENTE` responde el mismo
// 404 `NO_ENCONTRADO`, con el mismo cuerpo. `?academiaId=` o un `academiaId` en el cuerpo no cambian la academia, que sale siempre de la sesión.
// Aislamiento entre academias y entre alumnos (CLAUDE.md): cambiar un id, un identificador de academia o una cabecera no da el carnet, el PDF ni la regeneración de otra academia; un alumno no ve el carnet de otro.
// Lectura estricta elegida: un `academiaId` en el cuerpo de la regeneración responde 400 `SOLICITUD_INVALIDA` (cuerpo estricto, criterio 15) sin escribir; en la dirección se ignora.

describe('el id de un alumno que no es de la academia responde 404 (criterio 5)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let deA: AlumnoConQr;
  let deB: AlumnoConQr;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
    deA = await crearAlumnoPorPago(ctx, esc);
    deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });
    await insertarAuditoria(esc.e.A.id, 'ACCION_PREVIA_A');
    await insertarAuditoria(esc.e.B.id, 'ACCION_PREVIA_B');
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const IDS_INVALIDOS = [
    'no-es-un-uuid',
    'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
    `${randomUUID()}x`,
    'alumno-que-no-existe',
  ];

  /** Los tres intentos sobre un id: leer el carnet, bajar el PDF y regenerar el QR (todos con la secretaria, salvo que se indique). */
  const intentos = (id: string, cookie = esc.cookies.secretaria) =>
    [
      ['carnet', () => ctx.http.get(rutaCarnet(id), { cookie })],
      ['pdf', () => ctx.http.get(rutaCarnetPdf(id), { cookie })],
      ['regeneración', () => ctx.http.post(rutaRegenerarQr(id), cuerpoRegenerar(), { cookie })],
    ] as const;

  it('criterio 5: un id que no es UUID, que no existe, que es de otra academia o que es de un CLIENTE (de A o de B) responde el mismo 404 NO_ENCONTRADO con el mismo cuerpo y sin el id, sin escribir ni auditar', async () => {
    const clienteDeA = await sembrarCobrable(esc.e);
    const clienteDeB = await sembrarSolicitud(esc.e.B.id, {
      planId: esc.e.planB.id,
      claseIds: [esc.e.lunesB.id],
      clasesTotales: 5,
      clasesPorMesPlan: 12,
      precioPlan: '100.00',
      monto: '42.00',
    });
    const ids = [...IDS_INVALIDOS, randomUUID(), deB.alumnoId, clienteDeA.alumnoId, clienteDeB.alumnoId];
    const antes = await instantaneaDelCarnet(esc.e);
    const cuerpos = new Set<string>();

    for (const id of ids) {
      for (const [nombre, hacer] of intentos(id)) {
        const respuesta = await hacer();
        expect(
          [respuesta.status, codigoDeRespuesta(respuesta)],
          `${nombre} ${id}: ${respuesta.texto.slice(0, 200)}`,
        ).toEqual([404, 'NO_ENCONTRADO']);
        expect(respuesta.cacheControl).toBe('no-store');
        expect(respuesta.texto, `${nombre}: sin el id en el cuerpo`).not.toContain(id);
        cuerpos.add(sinUuid(respuesta.texto));
      }
    }

    expect(cuerpos.size, 'el mismo cuerpo para todos los casos y todas las rutas').toBe(1);
    expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
  });

  it('criterio 5: el carnet de A no existe para el personal de B: 404 con el mismo cuerpo, y el alumno de A no se toca', async () => {
    const antes = await instantaneaDelCarnet(esc.e);
    const tokenAntes = (await leerQr(esc.e.A.id, deA.alumnoId)).qr_token;

    const respuestas = await Promise.all(intentos(deA.alumnoId, esc.cookies.secretariaB).map(([, hacer]) => hacer()));
    const deAdminB = await ctx.http.get(rutaCarnet(deA.alumnoId), { cookie: esc.cookies.adminB });

    for (const respuesta of [...respuestas, deAdminB]) {
      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        404,
        'NO_ENCONTRADO',
      ]);
      expect(respuesta.texto).not.toContain(deA.dni);
      expect(respuesta.texto).not.toContain(tokenAntes);
    }
    expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
  });

  it('criterio 5: ?academiaId=<B> en la dirección no cambia la academia: el carnet de B sigue siendo un 404 para A, y el de A se sirve con los datos de A', async () => {
    const antes = await instantaneaDelCarnet(esc.e);

    for (const [, hacer] of [
      [
        'carnet',
        () => ctx.http.get(`${rutaCarnet(deB.alumnoId)}?academiaId=${esc.e.B.id}`, { cookie: esc.cookies.secretaria }),
      ],
      [
        'pdf',
        () =>
          ctx.http.get(`${rutaCarnetPdf(deB.alumnoId)}?academiaId=${esc.e.B.id}`, { cookie: esc.cookies.secretaria }),
      ],
      [
        'regeneración',
        () =>
          ctx.http.post(`${rutaRegenerarQr(deB.alumnoId)}?academiaId=${esc.e.B.id}`, cuerpoRegenerar(), {
            cookie: esc.cookies.secretaria,
          }),
      ],
    ] as const) {
      const respuesta = await hacer();
      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        404,
        'NO_ENCONTRADO',
      ]);
    }
    const propio = await ctx.http.get(`${rutaCarnet(deA.alumnoId)}?academiaId=${esc.e.B.id}`, {
      cookie: esc.cookies.secretaria,
    });
    expect(carnetDe(propio).academia.nombre).toBe('Academia A');
    expect(carnetDe(propio).alumno.id).toBe(deA.alumnoId);
    const desdeB = await ctx.http.get(`${rutaCarnet(deA.alumnoId)}?academiaId=${esc.e.A.id}`, {
      cookie: esc.cookies.secretariaB,
    });
    expect([desdeB.status, codigoDeRespuesta(desdeB)]).toEqual([404, 'NO_ENCONTRADO']);
    expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
  });

  it('criterio 5: una cabecera con la academia (X-Academia-Id, X-Academia, X-Forwarded-Host) no cambia nada: el alumno de B sigue siendo un 404 para la sesión de A', async () => {
    for (const cabecera of <Record<string, string>[]>[
      { 'x-academia-id': esc.e.B.id },
      { 'x-academia': 'academia-b' },
      { 'x-forwarded-host': 'academia-b.ejemplo.pe' },
    ]) {
      const respuesta = await ctx.http.get(rutaCarnet(deB.alumnoId), {
        cookie: esc.cookies.secretaria,
        headers: cabecera,
      });
      expect([respuesta.status, codigoDeRespuesta(respuesta)], JSON.stringify(cabecera)).toEqual([
        404,
        'NO_ENCONTRADO',
      ]);
    }
  });

  it('criterio 5 y 15: un academiaId en el cuerpo de la regeneración responde 400 SOLICITUD_INVALIDA sin escribir (la academia no se acepta del cliente), para un alumno de A y para uno de B', async () => {
    const antes = await instantaneaDelCarnet(esc.e);

    for (const [alumnoId, academiaId] of [
      [deA.alumnoId, esc.e.B.id],
      [deB.alumnoId, esc.e.B.id],
      [deA.alumnoId, esc.e.A.id],
    ] as const) {
      const respuesta = await ctx.http.post(rutaRegenerarQr(alumnoId), cuerpoRegenerar({ academiaId }), {
        cookie: esc.cookies.secretaria,
      });
      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
        400,
        'SOLICITUD_INVALIDA',
      ]);
    }
    expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
  });

  it('criterio 5: el PDF del carnet de A nunca lleva datos de B, y el de B nunca los de A (cada academia, el suyo)', async () => {
    const pdfA = await ctx.http.get(rutaCarnetPdf(deA.alumnoId), { cookie: esc.cookies.secretaria });
    const pdfB = await ctx.http.get(rutaCarnetPdf(deB.alumnoId), { cookie: esc.cookies.secretariaB });

    expect(pdfA.status, pdfA.texto.slice(0, 200)).toBe(200);
    expect(pdfB.status, pdfB.texto.slice(0, 200)).toBe(200);
    expect(pdfA.headers.get('content-type')).toContain('application/pdf');
    expect(pdfB.headers.get('content-type')).toContain('application/pdf');
    expect(pdfA.cuerpo.equals(pdfB.cuerpo), 'son documentos distintos').toBe(false);
  });

  it('aislamiento entre alumnos: un alumno que cambia el id no ve el carnet de otro (el único carnet de /api/mi-carnet es el suyo) ni por las rutas del personal', async () => {
    const otro = await crearAlumnoPorPago(ctx, esc, { nombres: 'Camila', apellidos: 'Torres Vega' });
    const tokenDelOtro = (await leerQr(esc.e.A.id, otro.alumnoId)).qr_token as string;

    const respuestas = await Promise.all([
      ctx.http.get(rutaCarnet(otro.alumnoId), { cookie: deA.cookie }),
      ctx.http.get(rutaCarnetPdf(otro.alumnoId), { cookie: deA.cookie }),
      ctx.http.post(rutaRegenerarQr(otro.alumnoId), cuerpoRegenerar(), { cookie: deA.cookie }),
      ctx.http.get(`/api/mi-carnet?id=${otro.alumnoId}&alumnoId=${otro.alumnoId}`, { cookie: deA.cookie }),
    ]);

    for (const respuesta of respuestas.slice(0, 3)) expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(403);
    expect(carnetDe(respuestas[3]).alumno.id).toBe(deA.alumnoId);
    for (const respuesta of respuestas) {
      expect(respuesta.texto).not.toContain(tokenDelOtro);
      expect(respuesta.texto).not.toContain(otro.dni);
    }
    expect((await leerQr(esc.e.A.id, otro.alumnoId)).qr_token, 'el token del otro no cambió').toBe(tokenDelOtro);
  });

  it('aislamiento entre academias: el token de un alumno de B no aparece en ninguna respuesta de A, y los dos carnets son de su academia', async () => {
    const carnetA = carnetDe(await ctx.http.get(rutaCarnet(deA.alumnoId), { cookie: esc.cookies.secretaria }));
    const carnetB = carnetDe(await ctx.http.get(rutaCarnet(deB.alumnoId), { cookie: esc.cookies.secretariaB }));

    expect(carnetA.academia.nombre).toBe('Academia A');
    expect(carnetB.academia.nombre).toBe('Academia B');
    expect(tokenDelCarnet(carnetA)).not.toBe(tokenDelCarnet(carnetB));
    expect(JSON.stringify(carnetA)).not.toContain(deB.dni);
    expect(JSON.stringify(carnetB)).not.toContain(deA.dni);
  });
});
