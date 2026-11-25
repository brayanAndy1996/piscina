// spec: 008-carnet-qr (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conFilaRetenida } from '../../utilidades/carreras';
import { ejecutarComo } from '../../utilidades/base-datos';
import { insertarAuditoria, leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { AHORA_007 } from '../../utilidades/escenario-pagos';
import {
  type AlumnoConQr,
  type AppCarnet,
  carnetDe,
  CLAVES_DEL_CARNET,
  codigoDeRespuesta,
  conAlumnoRetenido,
  crearAlumnoPorPago,
  crearAppCarnet,
  cuerpoRegenerar,
  type EscenarioDelCarnet,
  FORMATO_CONTENIDO_QR,
  fijarQr,
  GeneradorDeCarnetDePrueba,
  instantaneaDelCarnet,
  leerQr,
  prepararEscenarioDelCarnet,
  RUTA_MI_CARNET,
  rutaCarnet,
  rutaCarnetPdf,
  rutaRegenerarQr,
  todosLosTokens,
} from '../../utilidades/escenario-carnet';
import { IP_RE, type Objeto } from '../../utilidades/inscripciones';

// Criterio 13 (crítico, 8.6, RNF-06): `POST /api/alumnos/{id}/carnet/qr`, con `@Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')` (`ADMIN` y `SECRETARIA`) y cuerpo `regenerarQrSchema` (`{ claveIdempotencia, motivo }`, estricto), en una sola transacción y en este
// orden: `bloquearActorVigente`, la fila del alumno con `FOR UPDATE`, un token nuevo distinto del anterior, `qr_token`, `qr_generado_en` («ahora»), `qr_clave_idempotencia` y `actualizado_en`, y la auditoría `CARNET_QR_REGENERADO` (entidad `alumno`,
// `entidadId` el id del alumno, actor `USUARIO`, `motivo`, IP, `datosAntes: { qrGeneradoEn }` y `datosDespues: { qrGeneradoEn }`, con `null` si no tenía QR). Responde 200 con `carnetSchema`. Después de confirmar, ninguna fila de ninguna academia tiene el
// token anterior; `GET …/carnet`, `GET /api/mi-carnet` y los PDF dan el nuevo. Sin correo (DR-5).
// Criterio 15 (crítico, D-14, DT-5 de 002): `ALUMNO` (también sobre sí mismo) y `ENTRENADOR` reciben 403 `SIN_PERMISO`; sin sesión, 401 (en `carnet-permisos.test.ts`). El 404 del criterio 5 sale después de `bloquearActorVigente`, y el 401 de un actor que
// ya no está vigente gana a ese 404. Un cuerpo con campos de más, sin motivo o con una clave que no es UUID responde 400 `SOLICITUD_INVALIDA` sin escribir. Ningún rechazo cambia el token ni audita.
// (La idempotencia, el criterio 14, en `qr-regenerar-idempotencia.test.ts`.)

describe('regenerar el QR de un alumno (criterios 13 y 15)', () => {
  const generador = new GeneradorDeCarnetDePrueba();
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;

  beforeAll(async () => {
    ctx = await crearAppCarnet({ generador });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc);
    generador.modo = 'falso';
    generador.llamadas.length = 0;
    generador.transaccionesAbiertas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const regenerar = (
    cuerpo: unknown = cuerpoRegenerar(),
    cookie = esc.cookies.secretaria,
    alumnoId = alumno.alumnoId,
  ) => ctx.http.post(rutaRegenerarQr(alumnoId), cuerpo, { cookie });
  const auditoriasDeQr = () => leerAuditoriaDeAcademia(esc.e.A.id, 'CARNET_QR_REGENERADO');
  const MAS_TARDE = new Date(AHORA_007.getTime() + 60 * 60 * 1000);

  describe('criterio 13: la regeneración correcta', () => {
    it.each([
      ['la secretaria', 'secretaria'],
      ['el administrador', 'admin'],
    ] as const)(
      'criterio 13: %s regenera: 200 con carnetSchema, token nuevo distinto, «ahora», la clave y actualizado_en',
      async (_nombre, cookie) => {
        const antes = await leerQr(esc.e.A.id, alumno.alumnoId);
        ctx.reloj.fijar(MAS_TARDE);
        const cuerpo = cuerpoRegenerar();

        const respuesta = await regenerar(cuerpo, esc.cookies[cookie]);

        const carnet = carnetDe(respuesta);
        expect(respuesta.cacheControl).toBe('no-store');
        expect(Object.keys(carnet).sort()).toEqual(CLAVES_DEL_CARNET);
        const despues = await leerQr(esc.e.A.id, alumno.alumnoId);
        expect(despues.qr_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(despues.qr_token, 'el token nuevo es distinto del anterior').not.toBe(antes.qr_token);
        expect(despues.qr_generado_en?.getTime(), 'qr_generado_en es «ahora»').toBe(MAS_TARDE.getTime());
        expect(despues.qr_clave_idempotencia, 'guarda la clave de esta regeneración').toBe(cuerpo['claveIdempotencia']);
        expect(despues.actualizado_en.getTime(), 'actualizado_en es «ahora»').toBe(MAS_TARDE.getTime());
        expect(carnet.qr).toEqual({ contenido: `AQ1:${despues.qr_token}`, generadoEn: MAS_TARDE.toISOString() });
        expect(carnet.qr?.contenido).toMatch(FORMATO_CONTENIDO_QR);
        expect(carnet.alumno.id).toBe(alumno.alumnoId);
      },
    );

    it('criterio 13: audita CARNET_QR_REGENERADO una vez, con la entidad alumno, su id, el actor, el motivo recortado, la IP y las fechas antes y después, y sin ningún token', async () => {
      const antes = await leerQr(esc.e.A.id, alumno.alumnoId);
      ctx.reloj.fijar(MAS_TARDE);
      await insertarAuditoria(esc.e.A.id, 'ACCION_PREVIA_A');

      const respuesta = await regenerar(cuerpoRegenerar({ motivo: '   Se perdió el carnet   ' }));

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      const despues = await leerQr(esc.e.A.id, alumno.alumnoId);
      const filas = await auditoriasDeQr();
      expect(filas).toHaveLength(1);
      const [fila] = filas;
      expect(fila).toMatchObject({
        actor_tipo: 'USUARIO',
        actor_id: esc.e.secretariaA.id,
        accion: 'CARNET_QR_REGENERADO',
        entidad: 'alumno',
        entidad_id: alumno.alumnoId,
        motivo: 'Se perdió el carnet',
      });
      expect(fila?.ip).toMatch(IP_RE);
      const datosAntes = fila?.datos_antes as Objeto;
      const datosDespues = fila?.datos_despues as Objeto;
      expect(Object.keys(datosAntes)).toEqual(['qrGeneradoEn']);
      expect(Object.keys(datosDespues)).toEqual(['qrGeneradoEn']);
      expect(new Date(datosAntes['qrGeneradoEn'] as string).getTime()).toBe(antes.qr_generado_en?.getTime());
      expect(new Date(datosDespues['qrGeneradoEn'] as string).getTime()).toBe(despues.qr_generado_en?.getTime());
      const todo = JSON.stringify(await leerAuditoriaDeAcademia(esc.e.A.id));
      expect(todo, 'la auditoría no lleva el token anterior').not.toContain(antes.qr_token as string);
      expect(todo, 'la auditoría no lleva el token nuevo').not.toContain(despues.qr_token as string);
      expect(todo).not.toContain('AQ1:');
      expect(todo, 'ni la clave de idempotencia').not.toContain(despues.qr_clave_idempotencia as string);
    });

    it('criterio 13: a un alumno sin QR (fila escrita fuera de la API) le crea uno y audita qrGeneradoEn: null antes', async () => {
      await fijarQr(esc.e.A.id, alumno.alumnoId, { token: null });
      ctx.reloj.fijar(MAS_TARDE);

      const respuesta = await regenerar();

      const carnet = carnetDe(respuesta);
      expect(carnet.qr).not.toBeNull();
      const despues = await leerQr(esc.e.A.id, alumno.alumnoId);
      expect(despues.qr_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [fila] = await auditoriasDeQr();
      expect(fila?.datos_antes).toEqual({ qrGeneradoEn: null });
      expect(new Date((fila?.datos_despues as Objeto)['qrGeneradoEn'] as string).getTime()).toBe(MAS_TARDE.getTime());
    });

    it('criterio 13: después de confirmar, ninguna fila de ninguna academia tiene el token anterior, y el token nuevo solo lo tiene este alumno', async () => {
      const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });
      const tokenDeB = (await leerQr(esc.e.B.id, deB.alumnoId)).qr_token;
      const anterior = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token as string;

      const respuesta = await regenerar();

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      const tokens = await todosLosTokens(esc.e);
      expect(tokens, 'ninguna fila (de A ni de B) conserva el token anterior').not.toContain(anterior);
      const nuevo = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token as string;
      expect(tokens.filter((t) => t === nuevo)).toHaveLength(1);
      expect((await leerQr(esc.e.B.id, deB.alumnoId)).qr_token, 'el alumno de B no cambió').toBe(tokenDeB);
      // La búsqueda por token que hará la asistencia (009): (academia_id, qr_token).
      const buscar = async (academiaId: string, token: string) =>
        (
          await ejecutarComo(
            'app',
            'SELECT id FROM alumnos WHERE academia_id = $1::uuid AND qr_token = $2',
            [academiaId, token],
            {
              academiaId,
            },
          )
        ).rows as { id: string }[];
      expect(await buscar(esc.e.A.id, anterior), 'el QR anterior ya no corresponde a ningún alumno').toEqual([]);
      expect(await buscar(esc.e.A.id, nuevo)).toEqual([{ id: alumno.alumnoId }]);
    });

    it('criterio 13: GET …/carnet, GET /api/mi-carnet y los dos PDF dan el token nuevo, y el anterior no vuelve a salir en ninguna respuesta', async () => {
      const anterior = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token as string;
      const regeneracion = await regenerar();
      const nuevo = `AQ1:${(await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token as string}`;

      const delPersonal = await ctx.http.get(rutaCarnet(alumno.alumnoId), { cookie: esc.cookies.secretaria });
      const propio = await ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie });
      await ctx.http.get(rutaCarnetPdf(alumno.alumnoId), { cookie: esc.cookies.secretaria });
      await ctx.http.get('/api/mi-carnet/pdf', { cookie: alumno.cookie });

      expect(carnetDe(regeneracion).qr?.contenido).toBe(nuevo);
      expect(carnetDe(delPersonal).qr?.contenido).toBe(nuevo);
      expect(carnetDe(propio).qr?.contenido).toBe(nuevo);
      expect(generador.llamadas).toHaveLength(2);
      expect(generador.contenidoRecibido(0)).toBe(nuevo);
      expect(generador.contenidoRecibido(1)).toBe(nuevo);
      for (const respuesta of [regeneracion, delPersonal, propio]) expect(respuesta.texto).not.toContain(anterior);
    });

    it('criterio 13: no manda ningún correo (DR-5): ni al alumno ni a su apoderado, aunque tengan correo registrado', async () => {
      await ejecutarComo(
        'propietario',
        "UPDATE alumnos SET correo = 'alumno.privado@correo.test' WHERE id = $1::uuid",
        [alumno.alumnoId],
        { academiaId: esc.e.A.id },
      );
      const antes = ctx.correo.mensajes.length;

      const respuesta = await regenerar();
      await new Promise((resolver) => setTimeout(resolver, 300));

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      expect(ctx.correo.mensajes.length, JSON.stringify(ctx.correo.mensajes)).toBe(antes);
    });

    it('criterio 13: regenerar a un alumno no toca a los demás (ni su token ni su fecha) ni a su propia matrícula, ni audita otra cosa', async () => {
      const otro = await crearAlumnoPorPago(ctx, esc, { nombres: 'Camila', apellidos: 'Torres Vega' });
      const otroAntes = await leerQr(esc.e.A.id, otro.alumnoId);
      const auditoriaAntes = (await leerAuditoriaDeAcademia(esc.e.A.id)).length;

      await regenerar();

      const otroDespues = await leerQr(esc.e.A.id, otro.alumnoId);
      expect(otroDespues).toEqual(otroAntes);
      const auditoria = await leerAuditoriaDeAcademia(esc.e.A.id);
      expect(auditoria.length, 'una sola auditoría nueva').toBe(auditoriaAntes + 1);
    });

    it('criterio 13: tres regeneraciones con claves distintas dejan tres tokens distintos entre sí y distintos del original', async () => {
      const tokens = [(await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token];
      for (let i = 0; i < 3; i += 1) {
        const respuesta = await regenerar();
        expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
        tokens.push((await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token);
      }

      expect(new Set(tokens).size).toBe(4);
      expect(tokens.every((t) => t !== null && /^[A-Za-z0-9_-]{43}$/.test(t))).toBe(true);
    });
  });

  describe('criterio 15: un cuerpo inválido responde 400 SOLICITUD_INVALIDA sin escribir', () => {
    const CASOS: [string, () => unknown][] = [
      ['un campo de más (alumnoId)', () => cuerpoRegenerar({ alumnoId: randomUUID() })],
      ['un campo de más (qrToken)', () => cuerpoRegenerar({ qrToken: 'A'.repeat(43) })],
      ['un campo de más (academiaId)', () => cuerpoRegenerar({ academiaId: randomUUID() })],
      ['sin motivo', () => ({ claveIdempotencia: randomUUID() })],
      ['un motivo de 2 caracteres', () => cuerpoRegenerar({ motivo: 'ab' })],
      ['un motivo de 201 caracteres', () => cuerpoRegenerar({ motivo: 'a'.repeat(201) })],
      ['un motivo de puros espacios', () => cuerpoRegenerar({ motivo: '     ' })],
      ['un motivo invisible', () => cuerpoRegenerar({ motivo: '​​​​' })],
      ['un motivo con un salto de línea', () => cuerpoRegenerar({ motivo: 'ab\ncd' })],
      ['sin clave', () => ({ motivo: 'El alumno perdió su carnet' })],
      ['una clave que no es UUID', () => cuerpoRegenerar({ claveIdempotencia: 'no-es-uuid' })],
      ['una clave vacía', () => cuerpoRegenerar({ claveIdempotencia: '' })],
      ['una clave numérica', () => cuerpoRegenerar({ claveIdempotencia: 12345 })],
      ['un cuerpo vacío', () => ({})],
      ['un cuerpo que es una lista', () => [cuerpoRegenerar()]],
      ['un cuerpo que es un texto', () => 'regenerar'],
      ['un cuerpo nulo', () => null],
    ];

    it.each(CASOS)('criterio 15: %s', async (_nombre, armar) => {
      const antes = await instantaneaDelCarnet(esc.e);

      const respuesta = await regenerar(armar());

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
        400,
        'SOLICITUD_INVALIDA',
      ]);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
      expect(await auditoriasDeQr()).toEqual([]);
    });

    it('criterio 15: un JSON roto responde 400 sin escribir', async () => {
      const antes = await instantaneaDelCarnet(esc.e);
      const { port } = ctx.app.getHttpServer().address() as { port: number };

      const roto = await fetch(`http://127.0.0.1:${port}${rutaRegenerarQr(alumno.alumnoId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: esc.cookies.secretaria },
        body: '{"claveIdempotencia": ',
      });

      expect(roto.status).toBe(400);
      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    });
  });

  describe('criterio 15: el actor se comprueba antes que el alumno', () => {
    const CAMBIOS = [
      ['desactivado', 'desactivar'],
      ['con la versión de token cambiada', 'solo-version'],
    ] as const;

    describe.each(CAMBIOS)('el actor %s mientras la petición espera', (_nombre, cambio) => {
      it('criterio 15: una regeneración que habría dado 200 responde 401 NO_AUTENTICADO y no escribe ni audita', async () => {
        const antes = await leerQr(esc.e.A.id, alumno.alumnoId);

        const { resultado, esperoElBloqueo } = await conFilaRetenida({
          academiaId: esc.e.A.id,
          actorId: esc.e.secretariaA.id,
          cambio,
          liberar: 'COMMIT',
          enviar: () => regenerar(),
        });

        expect(esperoElBloqueo, 'la petición debía quedar esperando la fila del actor (bloquearActorVigente)').toBe(
          true,
        );
        expect([resultado.status, codigoDeRespuesta(resultado)], resultado.texto.slice(0, 300)).toEqual([
          401,
          'NO_AUTENTICADO',
        ]);
        expect(await leerQr(esc.e.A.id, alumno.alumnoId), 'el alumno no cambió').toEqual(antes);
        expect(await auditoriasDeQr()).toEqual([]);
      });

      it('criterio 15: el 401 del actor que ya no está vigente gana al 404 de un alumno que no existe, y al de uno de otra academia', async () => {
        const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });

        for (const id of [randomUUID(), deB.alumnoId, 'no-es-un-uuid']) {
          const { resultado, esperoElBloqueo } = await conFilaRetenida({
            academiaId: esc.e.A.id,
            actorId: esc.e.secretariaA.id,
            cambio,
            liberar: 'ROLLBACK',
            enviar: () => regenerar(cuerpoRegenerar(), esc.cookies.secretaria, id),
          });

          expect(esperoElBloqueo, id).toBe(true);
          // Con ROLLBACK el actor sigue vigente: el 404 sale después de bloquearlo.
          expect([resultado.status, codigoDeRespuesta(resultado)], `${id}: ${resultado.texto.slice(0, 200)}`).toEqual([
            404,
            'NO_ENCONTRADO',
          ]);
        }
        for (const id of [randomUUID(), deB.alumnoId, 'no-es-un-uuid']) {
          const { resultado } = await conFilaRetenida({
            academiaId: esc.e.A.id,
            actorId: esc.e.adminA.id,
            cambio,
            liberar: 'COMMIT',
            enviar: () => regenerar(cuerpoRegenerar(), esc.cookies.admin, id),
          });
          expect([resultado.status, codigoDeRespuesta(resultado)], `${id}: ${resultado.texto.slice(0, 200)}`).toEqual([
            401,
            'NO_AUTENTICADO',
          ]);
        }
      });
    });
  });

  describe('criterio 13: el orden de los bloqueos', () => {
    it('criterio 13 (determinista): con la fila del alumno retenida, la regeneración espera (pg_locks) y, al soltarla, responde 200 con el token nuevo', async () => {
      const antes = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token;

      const { resultados, esperaron, maximoEnEspera } = await conAlumnoRetenido({
        academiaId: esc.e.A.id,
        alumnoId: alumno.alumnoId,
        enviar: [() => regenerar()],
        esperando: 1,
      });

      expect(
        esperaron,
        `la regeneración debía esperar el FOR UPDATE de la fila del alumno (bloqueos en espera: ${maximoEnEspera})`,
      ).toBe(true);
      expect(resultados[0]?.status, resultados[0]?.texto.slice(0, 300)).toBe(200);
      expect((await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token).not.toBe(antes);
      expect(await auditoriasDeQr()).toHaveLength(1);
    });
  });
});
