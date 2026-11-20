// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearClaseDePrueba, crearEntrenadorDePrueba, crearPlanDePrueba } from '../../utilidades/planes-clases';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { leerUsuarios } from '../../utilidades/usuarios';
import {
  ACCION_SOLICITUD_CREADA,
  type AppInscripciones,
  AHORA_005,
  buscarTextoEnBase,
  codigoDe,
  contarFilasDeInscripciones,
  cotizacionEsperada,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  cuerpoInscripcionMenor,
  EnviadorDePrueba,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  FORMATO_CODIGO,
  FORMATO_TOKEN,
  IP_RE,
  leerAlumnos,
  leerFichas,
  leerMatriculaClases,
  leerMatriculas,
  leerSolicitudes,
  type Objeto,
  ocupacionDeClase,
  rutaPublica,
  sha256,
  solicitudDe,
  VEINTICUATRO_HORAS,
} from '../../utilidades/inscripciones';

// Criterio 16 (crítico, HU-01, HU-02, RN-01, RN-27, RN-28, D-05): el envío correcto crea, en una sola transacción, el alumno CLIENTE (con
// su nivel), su ficha médica, el apoderado si es menor, los consentimientos, la solicitud PENDIENTE_PAGO y la matrícula RESERVADA del mes
// en curso con sus clases: `fecha_inicio` hoy, `fecha_fin` el último día del mes, `clases_totales`, `clases_usadas` 0,
// `es_proporcional`, `precio_plan` y `clases_por_mes_plan` copiados del plan, `monto_calculado` del criterio 9 y `reserva_vence_en`
// ahora + 24 horas. Responde 201 con { solicitud: { codigo, token, enlace, estado, reservaVenceEn, cotizacion } }; la ocupación de cada
// clase sube en 1; no se crea usuario, carnet ni pago.
// Criterio 24 (formato): el código es `AQ-` y 6 caracteres de Crockford en mayúsculas; el token son 32 bytes en base64url (43
// caracteres); en la base solo se guarda su SHA-256 y el token en claro aparece solo en la respuesta 201 y en el correo.
// Criterio 26 (crítico, RN-22, RNF-06, Ley 29733): la auditoría SOLICITUD_INSCRIPCION_CREADA (actor PUBLICO, sin id, con IP) lleva solo
// codigo, planId, claseIds, mes, clasesTotales, montoCalculado, esProporcional, menorDeEdad y reservaVenceEn; nunca datos personales,
// médicos, del apoderado, token ni foto; los rechazos no se auditan.

describe('envío correcto: lo que se crea y lo que se responde (criterios 16, 24 y 26)', () => {
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
  const vence = (ahora: Date) => new Date(ahora.getTime() + VEINTICUATRO_HORAS);

  describe('criterio 16: la respuesta 201', () => {
    it('criterio 16: responde 201 con { solicitud: { codigo, token, enlace, estado, reservaVenceEn, cotizacion } } y Cache-Control: no-store', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {})).toEqual(['solicitud']);
      const solicitud = solicitudDe(respuesta);
      expect(Object.keys(solicitud).sort()).toEqual([
        'codigo',
        'cotizacion',
        'enlace',
        'estado',
        'reservaVenceEn',
        'token',
      ]);
      expect(solicitud.estado).toBe('PENDIENTE_PAGO');
      expect(solicitud.codigo).toMatch(FORMATO_CODIGO);
      expect(solicitud.token).toMatch(FORMATO_TOKEN);
      expect(solicitud.enlace).toBe(`/a/academia-a/solicitud/${solicitud.token}`);
      expect(new Date(solicitud.reservaVenceEn).toISOString()).toBe(vence(AHORA_005).toISOString());
    });

    it('criterio 16: la cotización de la respuesta es la del cálculo: mes, fechas, clases restantes y totales, precio, monto y proporcional', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e));

      const esperada = cotizacionEsperada(e.plan, [e.lunes, e.miercoles, e.viernes], AHORA_005);
      expect(esperada).toMatchObject({ clasesRestantes: 9, clasesTotales: 9, monto: '90.00', esProporcional: true });
      expect(solicitudDe(respuesta).cotizacion).toEqual(esperada);
    });

    it('criterio 16: no devuelve datos personales en la respuesta (ni el DNI, ni los apellidos, ni la fecha de nacimiento)', async () => {
      const cuerpo = await cuerpoInscripcion(e);

      const respuesta = await enviar(cuerpo);

      const alumno = cuerpo['alumno'] as Objeto;
      for (const dato of [alumno['dni'], alumno['apellidos'], alumno['fechaNacimiento'], alumno['telefono']]) {
        expect(respuesta.texto).not.toContain(String(dato));
      }
    });
  });

  describe('criterio 16: las filas que se crean', () => {
    it('criterio 16: crea el alumno CLIENTE con su nivel y sus datos, sin foto, sin usuario y sin estado de alumno activo', async () => {
      // Las clases deben ser del nivel elegido (criterio 15 b): lunes, miércoles y viernes INTERMEDIO a las 18:00.
      const entrenador = await crearEntrenadorDePrueba(e.A.id);
      const intermedio = (dia: number) =>
        crearClaseDePrueba(e.A.id, entrenador.id, {
          nivel: 'INTERMEDIO',
          dia_semana: dia,
          hora_inicio: '18:00',
          aforo: 20,
        });
      const cuerpo = await cuerpoInscripcion(e, {
        clases: [e.intermedioLunes, await intermedio(3), await intermedio(5)],
        sobre: { alumno: { nivel: 'INTERMEDIO', correo: 'camila@ejemplo.test', direccion: 'Jr. Los Pinos 123' } },
      });

      const respuesta = await enviar(cuerpo);

      expect(respuesta.status, respuesta.texto).toBe(201);
      const alumnos = await leerAlumnos(e.A.id);
      expect(alumnos).toHaveLength(1);
      expect(alumnos[0]).toMatchObject({
        dni: (cuerpo['alumno'] as Objeto)['dni'],
        nombres: 'Camila',
        apellidos: 'Quispe Rojas',
        fecha_nacimiento: '1995-05-20',
        telefono: '987654321',
        correo: 'camila@ejemplo.test',
        direccion: 'Jr. Los Pinos 123',
        nivel: 'INTERMEDIO',
        estado: 'CLIENTE',
        foto_clave: null,
        usuario_id: null,
      });
    });

    it('criterio 16: crea la ficha médica con el tipo de sangre, los textos médicos y el contacto de emergencia', async () => {
      const cuerpo = await cuerpoInscripcion(e, {
        sobre: {
          fichaMedica: {
            enfermedades: 'Asma leve',
            alergias: 'Polen',
            medicamentos: 'Inhalador',
            seguro: 'Seguro de ejemplo',
          },
        },
      });

      await enviar(cuerpo);

      const [ficha] = await leerFichas(e.A.id);
      const [alumno] = await leerAlumnos(e.A.id);
      expect(ficha).toMatchObject({
        alumno_id: alumno?.id,
        tipo_sangre: (cuerpo['fichaMedica'] as Objeto)['tipoSangre'],
        enfermedades: 'Asma leve',
        alergias: 'Polen',
        medicamentos: 'Inhalador',
        seguro: 'Seguro de ejemplo',
        contacto_emergencia_nombre: 'Rosa Quispe',
        contacto_emergencia_telefono: '912345678',
      });
    });

    it('criterio 16: crea la solicitud PENDIENTE_PAGO con su código, el SHA-256 del token, la clave de idempotencia y la IP de origen; el token en claro no queda en la base', async () => {
      const cuerpo = await cuerpoInscripcion(e);

      const respuesta = await enviar(cuerpo);

      const solicitud = solicitudDe(respuesta);
      const [fila] = await leerSolicitudes(e.A.id);
      const [alumno] = await leerAlumnos(e.A.id);
      expect(await leerSolicitudes(e.A.id)).toHaveLength(1);
      expect(fila).toMatchObject({
        alumno_id: alumno?.id,
        codigo: solicitud.codigo,
        estado: 'PENDIENTE_PAGO',
        clave_idempotencia: cuerpo['claveIdempotencia'],
      });
      expect(fila?.token_hash.equals(sha256(solicitud.token)), 'token_hash es el SHA-256 del token').toBe(true);
      expect(fila?.ip_origen, 'la IP de origen').toMatch(IP_RE);
      expect(
        await buscarTextoEnBase(e.A.id, solicitud.token),
        'el token en claro no está en la base ni en la auditoría',
      ).toBe(0);
    });

    it('criterio 16: crea la matrícula RESERVADA del mes en curso con el cálculo, los datos copiados del plan y el vencimiento de la reserva', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e));

      const [matricula] = await leerMatriculas(e.A.id);
      const [solicitud] = await leerSolicitudes(e.A.id);
      const [alumno] = await leerAlumnos(e.A.id);
      expect(await leerMatriculas(e.A.id)).toHaveLength(1);
      expect(matricula).toMatchObject({
        alumno_id: alumno?.id,
        plan_id: e.plan.id,
        solicitud_id: solicitud?.id,
        anio: 2026,
        mes: 11,
        fecha_inicio: '2026-11-11',
        fecha_fin: '2026-11-30',
        clases_totales: 9,
        clases_usadas: 0,
        es_proporcional: true,
        precio_plan: '120.00',
        clases_por_mes_plan: 12,
        monto_calculado: '90.00',
        monto_ajustado: null,
        motivo_ajuste: null,
        estado: 'RESERVADA',
      });
      expect(matricula?.reserva_vence_en?.toISOString()).toBe(vence(AHORA_005).toISOString());
      expect(new Date(solicitudDe(respuesta).reservaVenceEn).getTime()).toBe(matricula?.reserva_vence_en?.getTime());
    });

    it('criterio 16: crea una fila de matricula_clases por cada clase elegida', async () => {
      await enviar(await cuerpoInscripcion(e));

      const [matricula] = await leerMatriculas(e.A.id);
      const clases = await leerMatriculaClases(e.A.id);
      expect(clases.map((c) => c.clase_id).sort()).toEqual([e.lunes.id, e.miercoles.id, e.viernes.id].sort());
      expect(clases.every((c) => c.matricula_id === matricula?.id)).toBe(true);
    });

    it('criterio 16: desde ese momento la ocupación de cada clase elegida sube en 1 y la de las demás no cambia', async () => {
      const mes = { anio: 2026, mes: 11 };
      await enviar(await cuerpoInscripcion(e));

      for (const clase of [e.lunes, e.miercoles, e.viernes]) {
        expect(await ocupacionDeClase(e.A.id, clase.id, mes, AHORA_005), clase.dia_semana.toString()).toBe(1);
      }
      expect(await ocupacionDeClase(e.A.id, e.lunes17.id, mes, AHORA_005)).toBe(0);
      const lectura = await ctx.http.get(rutaPublica('academia-a', '/inscripcion'));
      const cupos = (id: string) =>
        (lectura.body?.['clases'] as Objeto[]).find((c) => c['id'] === id)?.['cuposRestantes'];
      expect(cupos(e.lunes.id)).toBe(19);
      expect(cupos(e.lunes17.id)).toBe(20);
    });

    it('criterio 16: no crea usuario, carnet ni pago: los usuarios de la academia son los mismos y no hay filas en B', async () => {
      const usuariosAntes = (await leerUsuarios(e.A.id)).map((u) => u.id).sort();

      await enviar(await cuerpoInscripcion(e));

      expect((await leerUsuarios(e.A.id)).map((u) => u.id).sort()).toEqual(usuariosAntes);
      expect(Object.values(await contarFilasDeInscripciones(e.B.id)).reduce((a, b) => a + b, 0)).toBe(0);
    });

    it('criterio 16: una persona menor de edad deja también su apoderado', async () => {
      const respuesta = await enviar(await cuerpoInscripcionMenor(e));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect((await contarFilasDeInscripciones(e.A.id)).apoderados).toBe(1);
    });

    it('criterio 16: una persona mayor de edad no deja apoderado', async () => {
      await enviar(await cuerpoInscripcion(e));

      expect((await contarFilasDeInscripciones(e.A.id)).apoderados).toBe(0);
    });

    it('criterio 16: crea todo en una sola transacción: una fila de cada tabla (alumno, ficha, solicitud, matrícula) y los consentimientos', async () => {
      await enviar(await cuerpoInscripcion(e));

      expect(await contarFilasDeInscripciones(e.A.id)).toEqual({
        alumnos: 1,
        apoderados: 0,
        fichas_medicas: 1,
        consentimientos: 2,
        solicitudes_inscripcion: 1,
        matriculas: 1,
        matricula_clases: 3,
      });
    });
  });

  describe('criterio 16 y 9: el monto guardado', () => {
    it('criterio 16: el mes completo (1 de noviembre, quedan 13 clases de un plan de 12) guarda 12 clases, no es proporcional y cobra el precio entero', async () => {
      const ahora = new Date('2026-11-01T15:00:00.000Z'); // domingo 1, 10:00 en Lima
      ctx.reloj.fijar(ahora);

      const respuesta = await enviar(await cuerpoInscripcion(e, { ahora }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect((await leerMatriculas(e.A.id))[0]).toMatchObject({
        fecha_inicio: '2026-11-01',
        clases_totales: 12,
        es_proporcional: false,
        monto_calculado: '120.00',
      });
      expect(solicitudDe(respuesta).cotizacion).toMatchObject({
        clasesRestantes: 13,
        clasesTotales: 12,
        esProporcional: false,
      });
    });

    it('criterio 16: un precio con céntimos se cobra redondeado hacia arriba al sol (S/ 120.50 con el mes completo → S/ 121) y se copia tal cual', async () => {
      const ahora = new Date('2026-11-01T15:00:00.000Z');
      ctx.reloj.fijar(ahora);
      const plan = await crearPlanDePrueba(e.A.id, {
        nombre: 'Plan con céntimos',
        veces_por_semana: 3,
        clases_por_mes: 12,
        precio: '120.50',
        dias_permitidos: [1, 3, 5],
        franjas_permitidas: ['17:00', '18:00', '19:00'],
        niveles_aplicables: ['BASICO', 'INTERMEDIO', 'AVANZADO'],
      });

      const respuesta = await enviar(await cuerpoInscripcion(e, { plan, ahora }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect((await leerMatriculas(e.A.id))[0]).toMatchObject({ precio_plan: '120.50', monto_calculado: '121.00' });
    });

    it('criterio 16: el monto proporcional se redondea hacia arriba una sola vez (S/ 120 de 12 clases con 10 → S/ 100; con 9 → S/ 90; con 8 → S/ 80)', async () => {
      const casos: [string, number, string][] = [
        ['2026-11-11T15:00:00.000Z', 9, '90.00'],
        ['2026-11-13T12:00:00.000Z', 8, '80.00'], // viernes 13, 07:00: el viernes 13 a las 18:00 todavía cuenta
      ];
      for (const [instante, totales, monto] of casos) {
        const ahora = new Date(instante);
        ctx.reloj.fijar(ahora);
        e = await crearEscenarioInscripcion();

        const respuesta = await enviar(await cuerpoInscripcion(e, { ahora }));

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect((await leerMatriculas(e.A.id))[0], instante).toMatchObject({
          clases_totales: totales,
          monto_calculado: monto,
        });
      }
    });
  });

  describe('criterio 24: el código y el token', () => {
    it('criterio 24: el código tiene el formato AQ- y 6 caracteres del alfabeto de Crockford (sin I, L, O ni U) y el token son 43 caracteres base64url', async () => {
      const solicitud = solicitudDe(await enviar(await cuerpoInscripcion(e)));

      expect(solicitud.codigo).toMatch(/^AQ-[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(solicitud.codigo.slice(3)).not.toMatch(/[ILOU]/);
      expect(solicitud.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(solicitud.token, 'base64url')).toHaveLength(32);
    });

    it('criterio 24: dos envíos seguidos dan códigos y tokens distintos', async () => {
      const uno = solicitudDe(await enviar(await cuerpoInscripcion(e)));
      const dos = solicitudDe(await enviar(await cuerpoInscripcion(e)));

      expect(dos.codigo).not.toBe(uno.codigo);
      expect(dos.token).not.toBe(uno.token);
    });
  });

  describe('criterio 26: auditoría', () => {
    it('criterio 26: registra SOLICITUD_INSCRIPCION_CREADA con el actor PUBLICO sin id, la entidad solicitud_inscripcion, su id y la IP', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e));

      const auditoria = await leerAuditoriaDeAcademia(e.A.id, ACCION_SOLICITUD_CREADA);
      const [solicitud] = await leerSolicitudes(e.A.id);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({
        actor_tipo: 'PUBLICO',
        actor_id: null,
        entidad: 'solicitud_inscripcion',
        entidad_id: solicitud?.id,
        datos_antes: null,
      });
      expect(auditoria[0]?.ip).toMatch(IP_RE);
      expect(respuesta.status).toBe(201);
    });

    it('criterio 26: datosDespues lleva exactamente codigo, planId, claseIds, mes, clasesTotales, montoCalculado, esProporcional, menorDeEdad y reservaVenceEn', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e));

      const [fila] = await leerAuditoriaDeAcademia(e.A.id, ACCION_SOLICITUD_CREADA);
      const datos = fila?.datos_despues as Objeto;
      expect(Object.keys(datos).sort()).toEqual([
        'claseIds',
        'clasesTotales',
        'codigo',
        'esProporcional',
        'menorDeEdad',
        'mes',
        'montoCalculado',
        'planId',
        'reservaVenceEn',
      ]);
      expect(datos).toMatchObject({
        codigo: solicitudDe(respuesta).codigo,
        planId: e.plan.id,
        mes: '2026-11',
        clasesTotales: 9,
        montoCalculado: '90.00',
        esProporcional: true,
        menorDeEdad: false,
      });
      expect([...(datos['claseIds'] as string[])].sort()).toEqual([e.lunes.id, e.miercoles.id, e.viernes.id].sort());
      expect(new Date(datos['reservaVenceEn'] as string).toISOString()).toBe(vence(AHORA_005).toISOString());
    });

    it('criterio 26: para una persona menor de edad, menorDeEdad es true', async () => {
      await enviar(await cuerpoInscripcionMenor(e));

      const [fila] = await leerAuditoriaDeAcademia(e.A.id, ACCION_SOLICITUD_CREADA);
      expect((fila?.datos_despues as Objeto)['menorDeEdad']).toBe(true);
    });

    it('criterio 26: nunca lleva el DNI, los nombres, la fecha de nacimiento, el contacto, los datos médicos, el apoderado, el token ni la foto', async () => {
      const cuerpo = await cuerpoInscripcionMenor(e, {
        sobre: {
          alumno: { correo: 'secreto.familiar@ejemplo.test', direccion: 'Pasaje Reservado 987' },
          fichaMedica: {
            enfermedades: 'Diabetes tipo 1',
            alergias: 'Penicilina',
            medicamentos: 'Insulina',
            seguro: 'Seguro Secreto',
          },
          apoderado: { correo: 'apoderado.secreto@ejemplo.test' },
        },
      });

      const respuesta = await enviar(cuerpo);

      const solicitud = solicitudDe(respuesta);
      const fila = (await leerAuditoriaDeAcademia(e.A.id, ACCION_SOLICITUD_CREADA))[0];
      const texto = JSON.stringify(fila);
      const alumno = cuerpo['alumno'] as Objeto;
      const apoderado = cuerpo['apoderado'] as Objeto;
      const prohibidos = [
        alumno['dni'],
        alumno['nombres'],
        alumno['apellidos'],
        alumno['fechaNacimiento'],
        alumno['telefono'],
        alumno['correo'],
        alumno['direccion'],
        'Diabetes',
        'Penicilina',
        'Insulina',
        'Seguro Secreto',
        'Rosa Quispe',
        '912345678',
        apoderado['nombres'],
        apoderado['dni'],
        apoderado['telefono'],
        apoderado['correo'],
        solicitud.token,
        sha256(solicitud.token).toString('hex'),
        'foto',
      ];
      for (const dato of prohibidos)
        expect(texto, `la auditoría no debe llevar ${String(dato)}`).not.toContain(String(dato));
    });

    it('criterio 26: los rechazos (400, 409) no se auditan', async () => {
      await enviar(await cuerpoInscripcion(e, { sobre: { alumno: { dni: '1' } } })); // 400
      await enviar(await cuerpoInscripcion(e, { sobre: { consentimientos: { version: 'vieja' } } })); // 409 TEXTOS_ACTUALIZADOS
      await enviar(await cuerpoInscripcion(e, { sobre: { inscripcion: { montoMostrado: '1.00' } } })); // 409 MONTO_CAMBIO
      await enviar(await cuerpoInscripcion(e, { sobre: { inscripcion: { mes: '2026-12' } } })); // 409 MES_CAMBIO

      expect(await leerAuditoriaDeAcademia(e.A.id, ACCION_SOLICITUD_CREADA)).toEqual([]);
      expect(codigoDe(await enviar(await cuerpoInscripcion(e, { sobre: { inscripcion: { mes: '2026-12' } } })))).toBe(
        'MES_CAMBIO',
      );
    });

    it('criterio 26: la auditoría es de la academia que recibió el envío y no aparece en la de B', async () => {
      await enviar(await cuerpoInscripcion(e));

      expect(await leerAuditoriaDeAcademia(e.B.id, ACCION_SOLICITUD_CREADA)).toEqual([]);
    });
  });
});
