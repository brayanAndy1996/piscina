// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contarAuditoria, crearUsuarioDePrueba, dniInventado } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  cargarContratos,
  codigoDe,
  crearAlumnoSolo,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  cuerpoInscripcionMenor,
  EnviadorDePrueba,
  type EscenarioInscripcion,
  type EstadoSembrado,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerAlumnos,
  leerApoderados,
  leerConsentimientos,
  leerFichas,
  leerMatriculaClases,
  leerMatriculas,
  leerSolicitudes,
  type Objeto,
  rutaPublica,
  sembrarSolicitud,
  solicitudDe,
} from '../../utilidades/inscripciones';

// Criterio 21 (crítico, HU-01, RN-03, D-28): DNI ya registrado.
//   a) si es de un alumno de la academia que no está en estado CLIENTE, de un cliente con una solicitud activa o de un usuario del
//      personal, responde 409 DNI_YA_REGISTRADO con el mismo cuerpo en los tres casos (sin decir cuál), sin escribir ni enviar correo;
//   b) si es de un cliente sin solicitud activa (sus solicitudes anteriores vencieron o se cancelaron), el envío se acepta: se actualizan
//      sus datos personales, su ficha y su apoderado (o se quita, si ya es mayor), sus solicitudes PENDIENTE_PAGO vencidas pasan a
//      VENCIDA y sus matrículas RESERVADA vencidas a CANCELADA, y se crean la solicitud y la matrícula nuevas;
//   c) el mismo DNI en otra academia no cuenta (D-28).

describe('envío: DNI ya registrado (criterio 21)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;
  const correo = new EnviadorDePrueba();

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ correo });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    correo.mensajes.length = 0;
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const enviar = (cuerpo: unknown, nombreCorto = 'academia-a') =>
    ctx.http.post(rutaPublica(nombreCorto, '/inscripcion'), cuerpo);
  const estado = async () => ({
    filas: await instantaneaDeInscripciones(e.A.id),
    auditoria: await contarAuditoria(e.A.id),
    correos: correo.mensajes.length,
  });
  const conDni = (dni: string, sobre: Objeto = {}) => cuerpoInscripcion(e, { sobre: { alumno: { dni }, ...sobre } });

  describe('a) se rechaza sin decir por qué', () => {
    it('criterio 21 a: el DNI de un alumno que no es cliente, el de un cliente con solicitud activa y el de un usuario del personal responden 409 DNI_YA_REGISTRADO con el mismo cuerpo, sin escribir ni enviar correo', async () => {
      const alumnoActivo = dniInventado();
      await crearAlumnoSolo(e.A.id, { dni: alumnoActivo, estado: 'ALUMNO_ACTIVO' });
      const conSolicitud = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id] });
      const personal = await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'SECRETARIA' });
      const antes = await estado();

      const respuestas = [];
      for (const dni of [alumnoActivo, conSolicitud.dni, personal.dni])
        respuestas.push(await enviar(await conDni(dni)));

      for (const respuesta of respuestas) {
        expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([409, 'DNI_YA_REGISTRADO']);
      }
      expect(respuestas[1]?.texto).toBe(respuestas[0]?.texto);
      expect(respuestas[2]?.texto).toBe(respuestas[0]?.texto);
      expect(await estado(), 'un 409 no escribe, no audita y no envía correo').toEqual(antes);
    });

    it.each(['ALUMNO_ACTIVO', 'ALUMNO_VENCIDO', 'INACTIVO'])(
      'criterio 21 a: el DNI de un alumno en estado %s responde 409 DNI_YA_REGISTRADO',
      async (estadoAlumno) => {
        const dni = dniInventado();
        await crearAlumnoSolo(e.A.id, { dni, estado: estadoAlumno });

        const respuesta = await enviar(await conDni(dni));

        expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'DNI_YA_REGISTRADO']);
      },
    );

    it('criterio 21 a: un alumno que no es cliente con solicitudes vencidas sigue siendo rechazado (el estado del alumno manda)', async () => {
      const vencido = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        estado: 'VENCIDA',
        estadoAlumno: 'ALUMNO_VENCIDO',
      });

      const respuesta = await enviar(await conDni(vencido.dni));

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'DNI_YA_REGISTRADO']);
    });

    it('criterio 21 a: un cliente con la reserva en verificación (sin vencimiento) también tiene una solicitud activa', async () => {
      const verificando = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        estado: 'PENDIENTE_PAGO',
        reservaVenceEn: null,
      });

      const respuesta = await enviar(await conDni(verificando.dni));

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'DNI_YA_REGISTRADO']);
    });

    it('criterio 21 a: el DNI del personal se rechaza con cualquier rol (administrador, secretaria, entrenador, alumno con cuenta)', async () => {
      for (const usuario of [e.adminA, e.secretariaA, e.entrenadorA, e.alumnoA]) {
        const respuesta = await enviar(await conDni(usuario.dni));

        expect([respuesta.status, codigoDe(respuesta)], usuario.rol).toEqual([409, 'DNI_YA_REGISTRADO']);
      }
    });

    it('criterio 21 a: el DNI se compara recortado (con espacios alrededor sigue siendo el mismo DNI)', async () => {
      const dni = dniInventado();
      await crearAlumnoSolo(e.A.id, { dni, estado: 'ALUMNO_ACTIVO' });

      const respuesta = await enviar(await conDni(` ${dni} `));

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'DNI_YA_REGISTRADO']);
    });

    it('criterio 21 a: con el mismo DNI en un cuerpo con otros errores 409 anteriores en el orden, ese error manda (MES_CAMBIO antes que DNI_YA_REGISTRADO)', async () => {
      const dni = dniInventado();
      await crearAlumnoSolo(e.A.id, { dni, estado: 'ALUMNO_ACTIVO' });

      const respuesta = await enviar(await conDni(dni, { inscripcion: { mes: '2026-12' } }));

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([409, 'MES_CAMBIO']);
    });
  });

  describe('b) un cliente cuyas solicitudes anteriores vencieron o se cancelaron vuelve a inscribirse', () => {
    it.each<EstadoSembrado>(['VENCIDA', 'CANCELADA', 'PENDIENTE_PAGO_VENCIDA'])(
      'criterio 21 b: un cliente con su solicitud %s se acepta (201), conserva su alumno y se crean la solicitud y la matrícula nuevas',
      async (estadoPrevio) => {
        const previo = await sembrarSolicitud(e.A.id, {
          planId: e.plan.id,
          claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
          estado: estadoPrevio,
          nombres: 'Nombre Viejo',
          apellidos: 'Apellido Viejo',
          nivel: 'BASICO',
        });

        const respuesta = await enviar(
          await conDni(previo.dni, {
            alumno: {
              nombres: 'Nombre Nuevo',
              apellidos: 'Apellido Nuevo',
              telefono: '911223344',
              fechaNacimiento: '1990-03-04',
              nivel: 'AVANZADO',
              correo: 'nuevo@ejemplo.test',
            },
          }),
        );

        expect(respuesta.status, respuesta.texto).toBe(201);
        const alumnos = await leerAlumnos(e.A.id);
        expect(alumnos, 'el mismo alumno, no uno nuevo').toHaveLength(1);
        expect(alumnos[0]).toMatchObject({
          id: previo.alumnoId,
          dni: previo.dni,
          nombres: 'Nombre Nuevo',
          apellidos: 'Apellido Nuevo',
          telefono: '911223344',
          fecha_nacimiento: '1990-03-04',
          nivel: 'AVANZADO',
          correo: 'nuevo@ejemplo.test',
          estado: 'CLIENTE',
        });
        const solicitudes = await leerSolicitudes(e.A.id);
        expect(solicitudes).toHaveLength(2);
        const nueva = solicitudes.find((s) => s.id !== previo.solicitudId);
        expect(nueva).toMatchObject({
          estado: 'PENDIENTE_PAGO',
          alumno_id: previo.alumnoId,
          codigo: solicitudDe(respuesta).codigo,
        });
        expect(
          solicitudes.find((s) => s.id === previo.solicitudId)?.codigo,
          'la solicitud vieja conserva su código',
        ).toBe(previo.codigo);
        expect(await leerMatriculas(e.A.id)).toHaveLength(2);
        expect((await leerMatriculas(e.A.id)).filter((m) => m.estado === 'RESERVADA')).toHaveLength(1);
      },
    );

    it('criterio 21 b: la solicitud PENDIENTE_PAGO vencida pasa a VENCIDA y su matrícula RESERVADA vencida a CANCELADA; las que ya eran VENCIDA o CANCELADA no cambian', async () => {
      const vencida = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        estado: 'PENDIENTE_PAGO_VENCIDA',
      });

      const respuesta = await enviar(await conDni(vencida.dni));

      expect(respuesta.status, respuesta.texto).toBe(201);
      const solicitudes = await leerSolicitudes(e.A.id);
      const matriculas = await leerMatriculas(e.A.id);
      expect(solicitudes.find((s) => s.id === vencida.solicitudId)?.estado).toBe('VENCIDA');
      expect(matriculas.find((m) => m.id === vencida.matriculaId)).toMatchObject({
        estado: 'CANCELADA',
        reserva_vence_en: null,
      });
    });

    it('criterio 21 b: una solicitud CANCELADA queda CANCELADA y su matrícula también', async () => {
      const cancelada = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        estado: 'CANCELADA',
      });

      await enviar(await conDni(cancelada.dni));

      expect((await leerSolicitudes(e.A.id)).find((s) => s.id === cancelada.solicitudId)?.estado).toBe('CANCELADA');
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cancelada.matriculaId)?.estado).toBe('CANCELADA');
    });

    it('criterio 21 b: los consentimientos viejos se conservan (son evidencia) y los de la solicitud nueva se suman', async () => {
      const previo = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'VENCIDA' });
      const antes = (await leerConsentimientos(e.A.id)).length;

      await enviar(await conDni(previo.dni));

      const despues = await leerConsentimientos(e.A.id);
      expect(despues.length).toBe(antes + 2);
      expect(despues.filter((c) => c.solicitud_id === previo.solicitudId)).toHaveLength(antes);
    });

    it('criterio 21 b: la ficha médica se actualiza con los datos nuevos (no se duplica)', async () => {
      const previo = await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'VENCIDA' });

      await enviar(
        await conDni(previo.dni, {
          fichaMedica: { alergias: 'Mariscos', contactoEmergencia: { nombre: 'Persona Nueva', telefono: '999888777' } },
        }),
      );

      const fichas = await leerFichas(e.A.id);
      expect(fichas).toHaveLength(1);
      expect(fichas[0]).toMatchObject({
        alumno_id: previo.alumnoId,
        alergias: 'Mariscos',
        contacto_emergencia_nombre: 'Persona Nueva',
        contacto_emergencia_telefono: '999888777',
      });
    });

    it('criterio 21 b: si antes era menor con apoderado y ahora es mayor, el apoderado se quita (el único DELETE)', async () => {
      const previo = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        estado: 'VENCIDA',
        conApoderado: true,
      });
      expect(await leerApoderados(e.A.id)).toHaveLength(1);

      const respuesta = await enviar(await conDni(previo.dni, { alumno: { fechaNacimiento: '1990-03-04' } }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(await leerApoderados(e.A.id)).toEqual([]);
    });

    it('criterio 21 b: si antes era mayor sin apoderado y ahora es menor, se crea el apoderado; si ya tenía, se reemplazan sus datos', async () => {
      const contratos = await cargarContratos();
      const sinApoderado = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id],
        estado: 'VENCIDA',
      });
      const conApoderado = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.miercoles.id],
        estado: 'CANCELADA',
        conApoderado: true,
      });

      const uno = await enviar(
        await cuerpoInscripcionMenor(e, {
          sobre: { alumno: { dni: sinApoderado.dni }, apoderado: { nombres: 'Apoderada Nueva' } },
        }),
      );
      const dos = await enviar(
        await cuerpoInscripcionMenor(e, {
          clases: [e.lunes17, e.miercoles, e.viernes],
          sobre: {
            alumno: { dni: conApoderado.dni },
            apoderado: { nombres: 'Apoderado Reemplazado', parentesco: contratos.PARENTESCOS[0] },
          },
        }),
      );

      expect(uno.status, uno.texto).toBe(201);
      expect(dos.status, dos.texto).toBe(201);
      const apoderados = await leerApoderados(e.A.id);
      expect(apoderados).toHaveLength(2);
      expect(apoderados.find((a) => a.alumno_id === sinApoderado.alumnoId)?.nombres).toBe('Apoderada Nueva');
      expect(apoderados.find((a) => a.alumno_id === conApoderado.alumnoId)?.nombres).toBe('Apoderado Reemplazado');
    });

    it('criterio 21 b: la matrícula nueva tiene el cálculo de hoy y sus clases, y las de la reserva vieja no cuentan para el cupo', async () => {
      const previo = await sembrarSolicitud(e.A.id, {
        planId: e.plan.id,
        claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
        estado: 'PENDIENTE_PAGO_VENCIDA',
      });

      const respuesta = await enviar(await conDni(previo.dni));

      expect(respuesta.status, respuesta.texto).toBe(201);
      const nueva = (await leerMatriculas(e.A.id)).find((m) => m.id !== previo.matriculaId);
      expect(nueva).toMatchObject({
        estado: 'RESERVADA',
        clases_totales: 9,
        monto_calculado: '90.00',
        alumno_id: previo.alumnoId,
      });
      const clases = (await leerMatriculaClases(e.A.id)).filter((c) => c.matricula_id === nueva?.id);
      expect(clases).toHaveLength(3);
    });

    it('criterio 21 b: después de volver a inscribirse, el cliente tiene una solicitud activa nueva y otro envío con su DNI se rechaza', async () => {
      const dni = dniInventado();
      await sembrarSolicitud(e.A.id, { planId: e.plan.id, claseIds: [e.lunes.id], estado: 'VENCIDA', dni });

      const primero = await enviar(await conDni(dni));
      expect(primero.status, primero.texto).toBe(201);
      const segundo = await enviar(await conDni(dni));

      expect([segundo.status, codigoDe(segundo)]).toEqual([409, 'DNI_YA_REGISTRADO']);
    });
  });

  describe('c) el mismo DNI en otra academia no cuenta (D-28)', () => {
    it('criterio 21 c: el DNI de un alumno activo de B, de un cliente con solicitud activa de B o de un usuario de B no impide inscribirse en A', async () => {
      const deAlumnoB = dniInventado();
      await crearAlumnoSolo(e.B.id, { dni: deAlumnoB, estado: 'ALUMNO_ACTIVO' });
      const clienteB = await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });

      for (const dni of [deAlumnoB, clienteB.dni, e.secretariaB.dni]) {
        const respuesta = await enviar(await conDni(dni));
        expect(respuesta.status, `${dni}: ${respuesta.texto}`).toBe(201);
      }

      expect((await leerAlumnos(e.A.id)).map((a) => a.dni).sort()).toEqual(
        [deAlumnoB, clienteB.dni, e.secretariaB.dni].sort(),
      );
    });

    it('criterio 21 c: un DNI de A no se ve desde B: el mismo DNI se acepta en B aunque esté registrado en A', async () => {
      const enA = await enviar(await cuerpoInscripcion(e));
      expect(enA.status, enA.texto).toBe(201);
      const dni = ((await leerAlumnos(e.A.id))[0] as { dni: string }).dni;

      const enB = await enviar(
        await cuerpoInscripcion(e, {
          plan: e.planB,
          clases: [e.lunesB, e.miercolesB, e.viernesB],
          sobre: { alumno: { dni } },
        }),
        'academia-b',
      );

      expect(enB.status, enB.texto).toBe(201);
      expect(await leerAlumnos(e.B.id)).toHaveLength(1);
    });
  });
});
