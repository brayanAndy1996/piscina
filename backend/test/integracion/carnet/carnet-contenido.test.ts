// spec: 008-carnet-qr (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { insertarAuditoria } from '../../utilidades/datos';
import { AHORA_007, sembrarCobrable } from '../../utilidades/escenario-pagos';
import {
  type AppCarnet,
  cambiarAlumno,
  carnetDe,
  type CarnetApi,
  CLAVES_DE_LA_MATRICULA_EN_EL_CARNET,
  CLAVES_DEL_ALUMNO_EN_EL_CARNET,
  CLAVES_DEL_CARNET,
  CLAVES_DEL_QR_EN_EL_CARNET,
  codigoDeRespuesta,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
  FORMATO_CONTENIDO_QR,
  fijarQr,
  instantaneaDelCarnet,
  leerQr,
  prepararEscenarioDelCarnet,
  RUTA_MI_CARNET,
  rutaCarnet,
  tokenDelCarnet,
} from '../../utilidades/escenario-carnet';
import { conRetencion, leerApoderados, leerFichas } from '../../utilidades/inscripciones';
import { cookieDeUsuario, crearUsuarioDePrueba } from '../../utilidades/usuarios';

// Criterio 4 (crítico, sección 2.1, D-29): `GET /api/alumnos/{id}/carnet` responde 200 con `carnetSchema` (estricto). La lectura no escribe, no bloquea y no audita.
// Criterio 6 (crítico, sección 2.1, D-14): `GET /api/mi-carnet` responde 200 con `carnetSchema` del alumno cuyo `usuario_id` es el de la sesión, en la academia de la sesión. No recibe ningún id: un `?id=` o `?alumnoId=` se ignoran. Si no hay alumno con
// ese usuario (o está en `CLIENTE`), 404 `NO_ENCONTRADO`. Un alumno con la matrícula vencida también ve su carnet.
// Criterio 7 (crítico, HU-13, RN-06, Ley 29733): `carnetSchema` trae la academia (`nombre`); el alumno (`id`, `nombres`, `apellidos`, `dni`, `nivel` y `estado`); `foto`; `matricula`; y `qr` (`{ contenido, generadoEn }` o `null`). No lleva fecha de nacimiento,
// teléfono, correo, dirección, colegio, datos médicos, apoderado, consentimientos, `foto_clave`, `usuario_id`, `qr_clave_idempotencia`, el token o el código de seguimiento, ni datos de pagos. Prueba: las claves exactas del JSON, para un adulto y
// para un menor con apoderado y ficha médica.
// Del criterio 10 (prueba obligatoria) solo se prueba lo que fija la forma del criterio 7: un alumno sin token recibe `qr: null`.

describe('lo que lleva y lo que no lleva el carnet (criterios 4, 6 y 7)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDelCarnet;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelCarnet(ctx);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const delPersonal = (alumnoId: string, cookie = esc.cookies.secretaria) =>
    ctx.http.get(rutaCarnet(alumnoId), { cookie });

  describe('criterio 7: las claves exactas del JSON', () => {
    it('criterio 7: el carnet de un adulto tiene exactamente academia, alumno, foto, matricula y qr, y sus datos son los del alumno', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc, {
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        nivel: 'BASICO',
      });
      const token = (await leerQr(esc.e.A.id, alumno.alumnoId)).qr_token;

      const respuesta = await delPersonal(alumno.alumnoId);

      const carnet = carnetDe(respuesta);
      expect(Object.keys(carnet).sort()).toEqual(CLAVES_DEL_CARNET);
      expect(carnet.academia).toEqual({ nombre: 'Academia A' });
      expect(Object.keys(carnet.alumno).sort()).toEqual(CLAVES_DEL_ALUMNO_EN_EL_CARNET);
      expect(carnet.alumno).toEqual({
        id: alumno.alumnoId,
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        dni: alumno.dni,
        nivel: 'BASICO',
        estado: 'ALUMNO_ACTIVO',
      });
      expect(carnet.foto).toBeNull();
      expect(Object.keys(carnet.matricula ?? {}).sort()).toEqual(CLAVES_DE_LA_MATRICULA_EN_EL_CARNET);
      expect(carnet.matricula).toEqual({
        plan: 'Plan 3 por semana',
        clases: [{ diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
        desde: '2026-11-01',
        hasta: '2026-11-30',
        vigenteHoy: true,
      });
      expect(Object.keys(carnet.qr ?? {}).sort()).toEqual(CLAVES_DEL_QR_EN_EL_CARNET);
      expect(carnet.qr).toEqual({ contenido: `AQ1:${token}`, generadoEn: AHORA_007.toISOString() });
      expect(carnet.qr?.contenido).toMatch(FORMATO_CONTENIDO_QR);
      expect(respuesta.cacheControl).toBe('no-store');
    });

    it('criterio 7: el carnet de un menor con apoderado y ficha médica tiene las mismas claves y ningún dato del apoderado, de la ficha, de la solicitud, de los pagos ni de la cuenta', async () => {
      const menor = await crearAlumnoPorPago(ctx, esc, {
        conApoderado: true,
        nombres: 'Mateo',
        apellidos: 'Quispe Rojas',
      });
      const claveDeFoto = `academias/${esc.e.A.id}/alumnos/${menor.alumnoId}/foto-${randomUUID()}.jpg`;
      await ejecutarComo(
        'propietario',
        `UPDATE alumnos SET correo = 'mateo.privado@correo.test', direccion = 'Av. Los Pinos 123, Lima', foto_clave = $2 WHERE id = $1::uuid`,
        [menor.alumnoId, claveDeFoto],
        { academiaId: esc.e.A.id },
      );
      await ejecutarComo(
        'propietario',
        `UPDATE fichas_medicas SET enfermedades = 'Asma severa', alergias = 'Penicilina', medicamentos = 'Salbutamol', seguro = 'Seguro Rimac 7788'
          WHERE alumno_id = $1::uuid`,
        [menor.alumnoId],
        { academiaId: esc.e.A.id },
      );
      const claveDeRegeneracion = randomUUID();
      await fijarQr(esc.e.A.id, menor.alumnoId, {
        token: (await leerQr(esc.e.A.id, menor.alumnoId)).qr_token,
        clave: claveDeRegeneracion,
      });
      const [apoderado] = (await leerApoderados(esc.e.A.id)).filter((a) => a.alumno_id === menor.alumnoId);
      const [ficha] = (await leerFichas(esc.e.A.id)).filter((f) => f.alumno_id === menor.alumnoId);
      expect(apoderado, 'el menor tiene apoderado').toBeTruthy();
      expect(ficha, 'el menor tiene ficha médica').toBeTruthy();

      const respuesta = await delPersonal(menor.alumnoId);

      const carnet = carnetDe(respuesta);
      expect(Object.keys(carnet).sort()).toEqual(CLAVES_DEL_CARNET);
      expect(Object.keys(carnet.alumno).sort()).toEqual(CLAVES_DEL_ALUMNO_EN_EL_CARNET);
      expect(Object.keys(carnet.matricula ?? {}).sort()).toEqual(CLAVES_DE_LA_MATRICULA_EN_EL_CARNET);
      expect(Object.keys(carnet.qr ?? {}).sort()).toEqual(CLAVES_DEL_QR_EN_EL_CARNET);
      const token = tokenDelCarnet(carnet);
      const prohibidos: [string, string | null | undefined][] = [
        ['la fecha de nacimiento', '2014-03-10'],
        ['el teléfono del alumno', '987654321'],
        ['el correo', 'mateo.privado@correo.test'],
        ['la dirección', 'Av. Los Pinos 123'],
        ['el nombre del apoderado', apoderado?.nombres],
        ['el DNI del apoderado', apoderado?.dni],
        ['el teléfono del apoderado', apoderado?.telefono],
        ['el parentesco', apoderado?.parentesco],
        ['el tipo de sangre', ficha?.tipo_sangre],
        ['las enfermedades', 'Asma severa'],
        ['las alergias', 'Penicilina'],
        ['los medicamentos', 'Salbutamol'],
        ['el seguro', 'Seguro Rimac 7788'],
        ['el contacto de emergencia', ficha?.contacto_emergencia_nombre],
        ['el teléfono de emergencia', ficha?.contacto_emergencia_telefono],
        ['la clave de la foto', claveDeFoto],
        ['la ruta del almacén', 'academias/'],
        ['el id del usuario', menor.usuarioId],
        ['la clave de idempotencia de la regeneración', claveDeRegeneracion],
        ['el código de la solicitud', menor.codigoSolicitud],
        ['el token de seguimiento de la solicitud', menor.tokenSeguimiento],
        ['el id de la solicitud', menor.solicitudId],
        ['el id de la matrícula', menor.matriculaId],
        ['el monto del pago', '42.00'],
        ['el método de pago', 'EFECTIVO'],
      ];
      for (const [que, valor] of prohibidos) {
        expect(valor, `el dato de prueba de ${que} existe`).toBeTruthy();
        expect(respuesta.texto, `el carnet no lleva ${que}`).not.toContain(valor as string);
      }
      for (const clave of [
        'fecha_nacimiento',
        'fechaNacimiento',
        'telefono',
        'correo',
        'direccion',
        'apoderado',
        'ficha',
        'consentimiento',
        'pago',
        'ticket',
        'usuario',
        'fotoClave',
        'foto_clave',
        'claveIdempotencia',
      ]) {
        expect(respuesta.texto.toLowerCase(), `el carnet no tiene una clave «${clave}»`).not.toContain(
          `"${clave.toLowerCase()}`,
        );
      }
      expect(respuesta.texto.split(token).length - 1, 'el token solo viaja dentro de qr.contenido (una vez)').toBe(1);
      expect(respuesta.texto.split('AQ1:').length - 1).toBe(1);
    });

    it('criterio 7 y 10: un alumno activo sin token (fila escrita fuera de la API) recibe qr: null y las mismas cinco claves', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);
      await fijarQr(esc.e.A.id, alumno.alumnoId, { token: null });

      const respuesta = await delPersonal(alumno.alumnoId);

      const carnet = carnetDe(respuesta);
      expect(Object.keys(carnet).sort()).toEqual(CLAVES_DEL_CARNET);
      expect(carnet.qr).toBeNull();
      expect(respuesta.texto).not.toContain('AQ1:');
    });

    it.each(['ALUMNO_VENCIDO', 'INACTIVO'])(
      'criterio 7: un alumno %s también tiene carnet y su estado sale tal cual',
      async (estado) => {
        const alumno = await crearAlumnoPorPago(ctx, esc);
        await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { estado });

        const carnet = carnetDe(await delPersonal(alumno.alumnoId));

        expect(carnet.alumno.estado).toBe(estado);
        expect(carnet.qr).not.toBeNull();
      },
    );

    it('criterio 7: el administrador recibe el mismo carnet que la secretaria', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);

      const deSecretaria = await delPersonal(alumno.alumnoId, esc.cookies.secretaria);
      const deAdmin = await delPersonal(alumno.alumnoId, esc.cookies.admin);

      expect(deAdmin.status, deAdmin.texto).toBe(200);
      expect(deAdmin.body).toEqual(deSecretaria.body);
    });
  });

  describe('criterio 4: la lectura no escribe, no bloquea y no audita', () => {
    it('criterio 4: leer el carnet (varias veces, con administrador y secretaria) no cambia nada en ninguna academia ni agrega auditoría', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);
      await insertarAuditoria(esc.e.A.id, 'ACCION_PREVIA_A');
      const antes = await instantaneaDelCarnet(esc.e);

      for (const cookie of [esc.cookies.secretaria, esc.cookies.admin, esc.cookies.secretaria]) {
        const respuesta = await delPersonal(alumno.alumnoId, cookie);
        expect(respuesta.status, respuesta.texto).toBe(200);
      }
      const propio = await ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie });
      expect(propio.status, propio.texto).toBe(200);

      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    });

    it('criterio 4 (determinista): con la fila del alumno retenida (FOR UPDATE) por otra transacción, la lectura responde 200 sin esperar', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: esc.e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar(
            'SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [esc.e.A.id, alumno.alumnoId],
          );
          await retenedor.consultar(
            'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND alumno_id = $2::uuid FOR UPDATE',
            [esc.e.A.id, alumno.alumnoId],
          );
        },
        enviar: [() => delPersonal(alumno.alumnoId), () => ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie })],
        liberar: 'ROLLBACK',
      });

      expect(
        todasEsperaron,
        'la lectura no debe esperar ningún bloqueo de fila: no bloquea ni lee con FOR UPDATE ni FOR SHARE',
      ).toBe(false);
      for (const respuesta of resultados) expect(respuesta.status, respuesta.texto).toBe(200);
    });
  });

  describe('criterio 6: mi carnet', () => {
    it('criterio 6: el alumno recibe su propio carnet, igual al que ve el personal, con Cache-Control: no-store', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);
      const otro = await crearAlumnoPorPago(ctx, esc, { nombres: 'Camila', apellidos: 'Torres Vega' });

      const mio = await ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie });
      const delOtro = await ctx.http.get(RUTA_MI_CARNET, { cookie: otro.cookie });

      const carnet = carnetDe(mio);
      expect(mio.cacheControl).toBe('no-store');
      expect(carnet.alumno.id).toBe(alumno.alumnoId);
      expect(carnetDe(delOtro).alumno.id).toBe(otro.alumnoId);
      expect(mio.body).toEqual((await delPersonal(alumno.alumnoId)).body);
      expect(tokenDelCarnet(carnet)).not.toBe(tokenDelCarnet(carnetDe(delOtro)));
    });

    it('criterio 6: no recibe ningún id: ?id=, ?alumnoId= y ?academiaId= se ignoran y siempre sale el alumno de la sesión', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);
      const otro = await crearAlumnoPorPago(ctx, esc, { nombres: 'Camila', apellidos: 'Torres Vega' });
      const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B' });

      for (const consulta of [
        `?id=${otro.alumnoId}`,
        `?alumnoId=${otro.alumnoId}`,
        `?alumnoId=${deB.alumnoId}&id=${deB.alumnoId}`,
        `?academiaId=${esc.e.B.id}`,
        `?dni=${otro.dni}`,
      ]) {
        const respuesta = await ctx.http.get(`${RUTA_MI_CARNET}${consulta}`, { cookie: alumno.cookie });
        expect(carnetDe(respuesta).alumno.id, consulta).toBe(alumno.alumnoId);
      }
    });

    it('criterio 6: un alumno con la matrícula vencida (ya terminó el mes) también ve su carnet, con vigenteHoy: false', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);
      ctx.reloj.fijar(new Date('2026-12-02T15:00:00.000Z'));

      const respuesta = await ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie });

      const carnet = carnetDe(respuesta);
      expect(carnet.matricula?.vigenteHoy).toBe(false);
      expect(carnet.qr).not.toBeNull();
    });

    it('criterio 6: un alumno ALUMNO_VENCIDO ve su carnet', async () => {
      const alumno = await crearAlumnoPorPago(ctx, esc);
      await cambiarAlumno(esc.e.A.id, alumno.alumnoId, { estado: 'ALUMNO_VENCIDO' });

      const carnet = carnetDe(await ctx.http.get(RUTA_MI_CARNET, { cookie: alumno.cookie }));

      expect(carnet.alumno.estado).toBe('ALUMNO_VENCIDO');
    });

    it('criterio 6: un usuario ALUMNO sin ficha de alumno (nadie con ese usuario_id) recibe 404 NO_ENCONTRADO', async () => {
      const respuesta = await ctx.http.get(RUTA_MI_CARNET, { cookie: esc.cookies.alumno });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([404, 'NO_ENCONTRADO']);
    });

    it('criterio 6: un usuario ligado a un alumno que sigue en CLIENTE recibe 404 NO_ENCONTRADO', async () => {
      const cliente = await sembrarCobrable(esc.e);
      const cuenta = await crearUsuarioDePrueba({ academiaId: esc.e.A.id, rol: 'ALUMNO' });
      await cambiarAlumno(esc.e.A.id, cliente.alumnoId, { usuario_id: cuenta.id });

      const respuesta = await ctx.http.get(RUTA_MI_CARNET, {
        cookie: cookieDeUsuario({ id: cuenta.id, academiaId: esc.e.A.id, rol: 'ALUMNO' }, AHORA_007),
      });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([404, 'NO_ENCONTRADO']);
    });

    it('criterio 6: el alumno de B nunca recibe datos de A: cada sesión ve solo su academia', async () => {
      const deA = await crearAlumnoPorPago(ctx, esc);
      const deB = await crearAlumnoPorPago(ctx, esc, { academia: 'B', nombres: 'Rocio', apellidos: 'Ccori Huaman' });

      const carnetB: CarnetApi = carnetDe(await ctx.http.get(RUTA_MI_CARNET, { cookie: deB.cookie }));

      expect(carnetB.academia.nombre).toBe('Academia B');
      expect(carnetB.alumno.id).toBe(deB.alumnoId);
      expect(JSON.stringify(carnetB)).not.toContain(deA.dni);
      expect(JSON.stringify(carnetB)).not.toContain(deA.alumnoId);
    });
  });
});
