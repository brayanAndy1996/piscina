// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contarAuditoria, fijarEstadoDeAcademia } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  camposConError,
  cargarContratos,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  crearPlanYClaseSabado,
  cuerpoInscripcion,
  cuerpoInscripcionMenor,
  detallesDe,
  EnviadorDePrueba,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerAlumnos,
  leerApoderados,
  leerConsentimientos,
  leerSolicitudes,
  type Objeto,
  rutaPublica,
  solicitudDe,
  variante,
} from '../../utilidades/inscripciones';

// Criterios 12, 13 y 14 (críticos, HU-01, RN-20, RNF-05, D-07): el envío del formulario.
//   12. `enviarInscripcionSchema` estricto en todos sus niveles: un cuerpo inválido responde 400 SOLICITUD_INVALIDA con
//       `detalles.errores[].campo` en la ruta del campo, sin escribir, auditar ni enviar correo.
//   13. Es menor si hoy (Lima) todavía no cumplió 18 años; el día del cumpleaños número 18 ya es mayor. Si es menor, `apoderado` es
//       obligatorio; si es mayor, enviarlo es 400. El DNI del apoderado no puede ser el del alumno. Bordes con `RELOJ`.
//   14. Consentimientos: `datosPersonales` y `deslinde` deben ser `true`; `imagen` es opcional y su valor se guarda; una versión que no
//       es la vigente responde 409 TEXTOS_ACTUALIZADOS con los textos vigentes, sin escribir. Evidencia: tipo, versión, "ahora", IP y
//       quién lo otorga (TITULAR, o APODERADO si es menor).

describe('envío: validación del formulario (criterios 12, 13 y 14)', () => {
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

  async function estado() {
    return {
      filas: await instantaneaDeInscripciones(e.A.id),
      filasB: await instantaneaDeInscripciones(e.B.id),
      auditoria: await contarAuditoria(e.A.id),
      correos: correo.mensajes.length,
    };
  }

  /** Comprueba que el envío se rechazó con 400 SOLICITUD_INVALIDA y que no cambió nada. */
  async function rechazado(cuerpo: unknown, camposEsperados?: string[]) {
    const antes = await estado();
    const respuesta = await enviar(cuerpo);
    expect(respuesta.status, respuesta.texto).toBe(400);
    expect(codigoDe(respuesta)).toBe('SOLICITUD_INVALIDA');
    expect(respuesta.cacheControl).toBe('no-store');
    if (camposEsperados) {
      for (const campo of camposEsperados) expect(camposConError(respuesta), campo).toContain(campo);
    }
    expect(await estado(), 'un 400 no escribe, no audita y no envía correo').toEqual(antes);
    return respuesta;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Criterio 12
  // -------------------------------------------------------------------------------------------------------------------

  describe('criterio 12: el cuerpo inválido es 400 con el campo', () => {
    const LARGO_CORREO = `${'x'.repeat(250)}@ejemplo.test`;
    const CASOS: [string, Objeto, string][] = [
      ['DNI de 7 dígitos', { alumno: { dni: '1234567' } }, 'alumno.dni'],
      ['DNI de 9 dígitos', { alumno: { dni: '123456789' } }, 'alumno.dni'],
      ['DNI con letras', { alumno: { dni: '1234567a' } }, 'alumno.dni'],
      ['DNI numérico (no texto)', { alumno: { dni: 12345678 } }, 'alumno.dni'],
      ['DNI nulo', { alumno: { dni: null } }, 'alumno.dni'],
      [
        'fecha de nacimiento que no es una fecha real',
        { alumno: { fechaNacimiento: '2026-02-30' } },
        'alumno.fechaNacimiento',
      ],
      ['fecha de nacimiento con otro formato', { alumno: { fechaNacimiento: '20/05/1995' } }, 'alumno.fechaNacimiento'],
      ['fecha de nacimiento futura', { alumno: { fechaNacimiento: '2026-11-12' } }, 'alumno.fechaNacimiento'],
      [
        'fecha de nacimiento de hace más de 100 años',
        { alumno: { fechaNacimiento: '1925-11-10' } },
        'alumno.fechaNacimiento',
      ],
      ['teléfono de 8 dígitos', { alumno: { telefono: '98765432' } }, 'alumno.telefono'],
      ['teléfono que no empieza con 9', { alumno: { telefono: '887654321' } }, 'alumno.telefono'],
      ['teléfono de 10 dígitos', { alumno: { telefono: '9876543210' } }, 'alumno.telefono'],
      ['teléfono con letras', { alumno: { telefono: '98765432a' } }, 'alumno.telefono'],
      ['correo con formato inválido', { alumno: { correo: 'sin-arroba.test' } }, 'alumno.correo'],
      ['correo con dos arrobas', { alumno: { correo: 'a@@ejemplo.test' } }, 'alumno.correo'],
      ['correo de más de 254 caracteres', { alumno: { correo: LARGO_CORREO } }, 'alumno.correo'],
      ['nombres de un solo carácter', { alumno: { nombres: 'A' } }, 'alumno.nombres'],
      ['nombres de más de 60 caracteres', { alumno: { nombres: 'a'.repeat(61) } }, 'alumno.nombres'],
      ['nombres sin letras visibles', { alumno: { nombres: '​​​' } }, 'alumno.nombres'],
      ['nombres solo con espacios', { alumno: { nombres: '      ' } }, 'alumno.nombres'],
      ['apellidos de un carácter', { alumno: { apellidos: 'Q' } }, 'alumno.apellidos'],
      ['apellidos de más de 60 caracteres', { alumno: { apellidos: 'q'.repeat(61) } }, 'alumno.apellidos'],
      ['nombres con un carácter de control', { alumno: { nombres: 'Cami\u0007la' } }, 'alumno.nombres'],
      ['nombres con un carácter bidireccional', { alumno: { nombres: 'Camila‮' } }, 'alumno.nombres'],
      ['dirección con un salto de control', { alumno: { direccion: 'Jr. Uno\u0000 123' } }, 'alumno.direccion'],
      ['dirección con un carácter bidireccional', { alumno: { direccion: 'Av. ⁧Dos 45' } }, 'alumno.direccion'],
      ['nivel que no existe', { alumno: { nivel: 'EXPERTO' } }, 'alumno.nivel'],
      ['grado del colegio fuera de la lista', { alumno: { gradoColegio: 'DOCTORADO' } }, 'alumno.gradoColegio'],
      ['tipo de sangre fuera de la lista', { fichaMedica: { tipoSangre: 'Z+' } }, 'fichaMedica.tipoSangre'],
      [
        'enfermedades de más de 500 caracteres',
        { fichaMedica: { enfermedades: 'e'.repeat(501) } },
        'fichaMedica.enfermedades',
      ],
      ['alergias de más de 500 caracteres', { fichaMedica: { alergias: 'a'.repeat(501) } }, 'fichaMedica.alergias'],
      [
        'medicamentos de más de 500 caracteres',
        { fichaMedica: { medicamentos: 'm'.repeat(501) } },
        'fichaMedica.medicamentos',
      ],
      ['alergias con un carácter de control', { fichaMedica: { alergias: 'polen\u0000' } }, 'fichaMedica.alergias'],
      [
        'teléfono del contacto de emergencia inválido',
        { fichaMedica: { contactoEmergencia: { telefono: '12345' } } },
        'fichaMedica.contactoEmergencia.telefono',
      ],
      [
        'nombre del contacto de emergencia vacío',
        { fichaMedica: { contactoEmergencia: { nombre: '' } } },
        'fichaMedica.contactoEmergencia.nombre',
      ],
      ['claseIds vacío', { inscripcion: { claseIds: [] } }, 'inscripcion.claseIds'],
      ['claseIds que no son UUID', { inscripcion: { claseIds: ['uno', 'dos', 'tres'] } }, 'inscripcion.claseIds'],
      ['planId que no es UUID', { inscripcion: { planId: 'plan-1' } }, 'inscripcion.planId'],
      ['claveIdempotencia que no es UUID', { claveIdempotencia: 'una-clave' }, 'claveIdempotencia'],
      ['mes con otro formato (2026-13)', { inscripcion: { mes: '2026-13' } }, 'inscripcion.mes'],
      ['mes con otro formato (2026-1)', { inscripcion: { mes: '2026-1' } }, 'inscripcion.mes'],
      ['mes con texto', { inscripcion: { mes: 'noviembre' } }, 'inscripcion.mes'],
      ['montoMostrado con tres decimales', { inscripcion: { montoMostrado: '90.123' } }, 'inscripcion.montoMostrado'],
      ['montoMostrado negativo', { inscripcion: { montoMostrado: '-90.00' } }, 'inscripcion.montoMostrado'],
      ['montoMostrado numérico', { inscripcion: { montoMostrado: 90 } }, 'inscripcion.montoMostrado'],
      ['montoMostrado vacío', { inscripcion: { montoMostrado: '' } }, 'inscripcion.montoMostrado'],
      [
        'datosPersonales como texto',
        { consentimientos: { datosPersonales: 'true' } },
        'consentimientos.datosPersonales',
      ],
      ['deslinde como número', { consentimientos: { deslinde: 1 } }, 'consentimientos.deslinde'],
      ['imagen como texto', { consentimientos: { imagen: 'si' } }, 'consentimientos.imagen'],
    ];

    it.each(CASOS)(
      'criterio 12: %s responde 400 SOLICITUD_INVALIDA con el campo, sin escribir',
      async (_nombre, cambios, campo) => {
        await rechazado(await cuerpoInscripcion(e, { sobre: cambios }), [campo]);
      },
    );

    it('criterio 12: claseIds repetidos o con más de 7 elementos responde 400 en inscripcion.claseIds', async () => {
      await rechazado(
        await cuerpoInscripcion(e, { sobre: { inscripcion: { claseIds: [e.lunes.id, e.lunes.id, e.viernes.id] } } }),
        ['inscripcion.claseIds'],
      );
      const ocho = Array.from({ length: 8 }, (_, i) => `3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e0${i}`);
      await rechazado(await cuerpoInscripcion(e, { sobre: { inscripcion: { claseIds: ocho } } }), [
        'inscripcion.claseIds',
      ]);
    });

    it.each([
      ['alumno', 'alumno'],
      ['fichaMedica', 'fichaMedica'],
      ['inscripcion', 'inscripcion'],
      ['consentimientos', 'consentimientos'],
      ['claveIdempotencia', 'claveIdempotencia'],
      ['alumno.nombres', 'alumno.nombres'],
      ['alumno.apellidos', 'alumno.apellidos'],
      ['alumno.dni', 'alumno.dni'],
      ['alumno.fechaNacimiento', 'alumno.fechaNacimiento'],
      ['alumno.telefono', 'alumno.telefono'],
      ['alumno.nivel', 'alumno.nivel'],
      ['fichaMedica.tipoSangre', 'fichaMedica.tipoSangre'],
      ['fichaMedica.contactoEmergencia', 'fichaMedica.contactoEmergencia'],
      ['inscripcion.planId', 'inscripcion.planId'],
      ['inscripcion.claseIds', 'inscripcion.claseIds'],
      ['inscripcion.mes', 'inscripcion.mes'],
      ['inscripcion.montoMostrado', 'inscripcion.montoMostrado'],
      ['consentimientos.version', 'consentimientos.version'],
      ['consentimientos.datosPersonales', 'consentimientos.datosPersonales'],
      ['consentimientos.deslinde', 'consentimientos.deslinde'],
    ])('criterio 12: sin el campo obligatorio %s responde 400 con ese campo', async (campo) => {
      const sin: Objeto = {};
      const partes = campo.split('.');
      let actual = sin;
      for (const [i, parte] of partes.entries()) {
        if (i === partes.length - 1) actual[parte] = undefined;
        else {
          actual[parte] = {};
          actual = actual[parte] as Objeto;
        }
      }
      await rechazado(await cuerpoInscripcion(e, { sobre: sin }), [campo]);
    });

    it('criterio 12: los campos opcionales pueden faltar (correo, dirección, grado, enfermedades, alergias, medicamentos, seguro, imagen)', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 12: todos los campos opcionales válidos se aceptan juntos y se guardan', async () => {
      const contratos = await cargarContratos();
      const respuesta = await enviar(
        await cuerpoInscripcion(e, {
          sobre: {
            alumno: {
              correo: 'Familia.Quispe@Ejemplo.test',
              direccion: 'Jr. Los Pinos 123, Lima',
              gradoColegio: contratos.GRADOS_COLEGIO[0],
            },
            fichaMedica: {
              enfermedades: 'Asma leve',
              alergias: 'Polen',
              medicamentos: 'Ninguno',
              seguro: 'Seguro de ejemplo',
            },
            consentimientos: { imagen: true },
          },
        }),
      );

      expect(respuesta.status, respuesta.texto).toBe(201);
      const [alumno] = await leerAlumnos(e.A.id);
      expect(alumno).toMatchObject({
        direccion: 'Jr. Los Pinos 123, Lima',
        grado_colegio: contratos.GRADOS_COLEGIO[0],
      });
      expect(alumno?.correo?.toLowerCase()).toBe('familia.quispe@ejemplo.test');
    });

    it.each([
      ['un campo de más en la raíz (academiaId)', { academiaId: '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f' }],
      ['un campo de más en la raíz (estado)', { estado: 'PAGADA' }],
      ['un campo de más en la raíz (monto)', { monto: '1.00' }],
      ['un campo de más en la raíz (reservaVenceEn)', { reservaVenceEn: '2030-01-01T00:00:00.000Z' }],
      ['un campo de más en alumno (estado)', { alumno: { estado: 'ALUMNO_ACTIVO' } }],
      ['un campo de más en alumno (id)', { alumno: { id: '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f' } }],
      ['un campo de más en alumno (academiaId)', { alumno: { academiaId: '3f2b8c1e-5d4a-4b6c-8e7f-9a0b1c2d3e4f' } }],
      ['un campo de más en la ficha', { fichaMedica: { observaciones: 'algo' } }],
      ['un campo de más en el contacto de emergencia', { fichaMedica: { contactoEmergencia: { parentesco: 'tía' } } }],
      ['un campo de más en la inscripción (monto)', { inscripcion: { monto: '1.00' } }],
      ['un campo de más en los consentimientos', { consentimientos: { whatsapp: true } }],
      ['constructor en alumno', { alumno: { constructor: { prototype: {} } } }],
    ])(
      'criterio 12: el esquema es estricto en todos los niveles: %s responde 400 sin escribir',
      async (_nombre, cambios) => {
        await rechazado(await cuerpoInscripcion(e, { sobre: cambios }));
      },
    );

    it('criterio 12: un __proto__ en la raíz del JSON es un campo de más: responde 400 sin escribir', async () => {
      const antes = await estado();
      const crudo = JSON.stringify(await cuerpoInscripcion(e)).replace(/^\{/, '{"__proto__":{"admin":true},');

      const respuesta = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), undefined, { crudo });

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(await estado()).toEqual(antes);
    });

    it.each([
      ['un arreglo', '[]'],
      ['un texto', '"hola"'],
      ['null', 'null'],
      ['un número', '42'],
      ['JSON roto', '{"alumno": '],
      ['vacío', ''],
    ])('criterio 12: un cuerpo que es %s responde 400 sin escribir', async (_nombre, crudo) => {
      const antes = await estado();

      const respuesta = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), undefined, { crudo });

      expect(respuesta.status, respuesta.texto).toBe(400);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 12: un cuerpo válido con nombres en otro alfabeto y con tildes se acepta y se guarda tal cual (sin cambiar las letras)', async () => {
      const respuesta = await enviar(
        await cuerpoInscripcion(e, { sobre: { alumno: { nombres: 'María José', apellidos: 'Peña Núñez' } } }),
      );

      expect(respuesta.status, respuesta.texto).toBe(201);
      expect((await leerAlumnos(e.A.id))[0]).toMatchObject({ nombres: 'María José', apellidos: 'Peña Núñez' });
    });

    it('criterio 12: el orden es academia (404 o 403) antes que cuerpo (400): con un cuerpo inválido, una academia inexistente da 404 y una suspendida 403', async () => {
      await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');

      const inexistente = await enviar({ basura: true }, 'noexiste');
      const suspendida = await enviar({ basura: true }, 'academia-b');

      expect([inexistente.status, codigoDe(inexistente)]).toEqual([404, 'ACADEMIA_NO_ENCONTRADA']);
      expect([suspendida.status, codigoDe(suspendida)]).toEqual([403, 'ACADEMIA_SUSPENDIDA']);
    });

    it('criterio 12: varios errores se informan juntos, cada uno con su campo', async () => {
      const respuesta = await rechazado(
        await cuerpoInscripcion(e, { sobre: { alumno: { dni: '1', telefono: '2' }, inscripcion: { mes: 'x' } } }),
      );

      expect(camposConError(respuesta)).toEqual(
        expect.arrayContaining(['alumno.dni', 'alumno.telefono', 'inscripcion.mes']),
      );
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Criterio 13
  // -------------------------------------------------------------------------------------------------------------------

  describe('criterio 13: menor de edad y apoderado', () => {
    it('criterio 13: una persona mayor de edad sin apoderado se acepta (201)', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 13: una persona menor de edad sin apoderado responde 400 en apoderado y no escribe', async () => {
      await rechazado(await cuerpoInscripcion(e, { sobre: { alumno: { fechaNacimiento: '2014-03-10' } } }), [
        'apoderado',
      ]);
    });

    it('criterio 13: una persona mayor de edad con apoderado responde 400 en apoderado y no escribe', async () => {
      const menor = await cuerpoInscripcionMenor(e);
      await rechazado(variante(menor, { alumno: { fechaNacimiento: '1995-05-20' } }), ['apoderado']);
    });

    it('criterio 13: el menor con apoderado se acepta y se guardan el apoderado y su relación', async () => {
      const contratos = await cargarContratos();
      const cuerpo = await cuerpoInscripcionMenor(e, {
        sobre: { apoderado: { correo: 'apoderado@ejemplo.test', parentesco: contratos.PARENTESCOS[0] } },
      });

      const respuesta = await enviar(cuerpo);

      expect(respuesta.status, respuesta.texto).toBe(201);
      const [apoderado] = await leerApoderados(e.A.id);
      const [alumno] = await leerAlumnos(e.A.id);
      expect(apoderado).toMatchObject({
        alumno_id: alumno?.id,
        nombres: 'Rosa',
        apellidos: 'Rojas Vega',
        telefono: '955123456',
        parentesco: contratos.PARENTESCOS[0],
        correo: 'apoderado@ejemplo.test',
      });
      expect(apoderado?.dni).toBe((cuerpo['apoderado'] as Objeto)['dni']);
    });

    it('criterio 13: el DNI del apoderado igual al del alumno responde 400 en apoderado.dni', async () => {
      const menor = await cuerpoInscripcionMenor(e);
      const dniAlumno = (menor['alumno'] as Objeto)['dni'];

      await rechazado(variante(menor, { apoderado: { dni: dniAlumno } }), ['apoderado.dni']);
    });

    it('criterio 13: el apoderado se valida: sin parentesco, con teléfono inválido, nombres cortos o un campo de más responde 400', async () => {
      const menor = await cuerpoInscripcionMenor(e);

      await rechazado(variante(menor, { apoderado: { parentesco: undefined } }), ['apoderado.parentesco']);
      await rechazado(variante(menor, { apoderado: { parentesco: 'vecino' } }), ['apoderado.parentesco']);
      await rechazado(variante(menor, { apoderado: { telefono: '812345678' } }), ['apoderado.telefono']);
      await rechazado(variante(menor, { apoderado: { nombres: 'R' } }), ['apoderado.nombres']);
      await rechazado(variante(menor, { apoderado: { dni: '123' } }), ['apoderado.dni']);
      await rechazado(variante(menor, { apoderado: { correo: 'no-es-correo' } }), ['apoderado.correo']);
      await rechazado(variante(menor, { apoderado: { estado: 'x' } }));
    });

    it('criterio 13: el día del cumpleaños número 18 ya es mayor: con apoderado responde 400 y sin apoderado se acepta (hoy es 11 de noviembre en Lima)', async () => {
      const mayorHoy = await cuerpoInscripcion(e, { sobre: { alumno: { fechaNacimiento: '2008-11-11' } } });
      await rechazado(variante(await cuerpoInscripcionMenor(e), { alumno: { fechaNacimiento: '2008-11-11' } }), [
        'apoderado',
      ]);

      const respuesta = await enviar(mayorHoy);

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 13: el día antes de cumplir 18 todavía es menor: sin apoderado responde 400 y con apoderado se acepta', async () => {
      await rechazado(await cuerpoInscripcion(e, { sobre: { alumno: { fechaNacimiento: '2008-11-12' } } }), [
        'apoderado',
      ]);

      const respuesta = await enviar(
        await cuerpoInscripcionMenor(e, { sobre: { alumno: { fechaNacimiento: '2008-11-12' } } }),
      );

      expect(respuesta.status, respuesta.texto).toBe(201);
    });

    it('criterio 13: el borde del cumpleaños con el reloj: a las 23:59 del 11 en Lima (en UTC ya es 12) es menor; a las 00:00 del 12 en Lima ya es mayor', async () => {
      const nacimiento = { alumno: { fechaNacimiento: '2008-11-12' } };

      ctx.reloj.fijar(new Date('2026-11-12T04:59:00.000Z')); // 23:59 del 11 de noviembre en Lima
      await rechazado(await cuerpoInscripcion(e, { ahora: ctx.reloj.ahora(), sobre: nacimiento }), ['apoderado']);
      const menor = await enviar(await cuerpoInscripcionMenor(e, { ahora: ctx.reloj.ahora(), sobre: nacimiento }));
      expect(menor.status, menor.texto).toBe(201);

      ctx.reloj.fijar(new Date('2026-11-12T05:00:00.000Z')); // 00:00 del 12 de noviembre en Lima
      await rechazado(await cuerpoInscripcionMenor(e, { ahora: ctx.reloj.ahora(), sobre: nacimiento }), ['apoderado']);
      const mayor = await enviar(await cuerpoInscripcion(e, { ahora: ctx.reloj.ahora(), sobre: nacimiento }));
      expect(mayor.status, mayor.texto).toBe(201);
    });

    it('criterio 13: nacido el 29 de febrero cumple 18 el 1 de marzo (año no bisiesto): el 28 de febrero es menor y el 1 de marzo, mayor', async () => {
      const { plan, clase } = await crearPlanYClaseSabado(e);
      const nacimiento = { alumno: { fechaNacimiento: '2008-02-29' } };
      const opciones = (ahora: Date, sobre: Objeto = nacimiento) => ({ plan, clases: [clase], ahora, sobre });

      ctx.reloj.fijar(new Date('2026-02-28T15:00:00.000Z')); // sábado 28 de febrero de 2026, 10:00 en Lima
      await rechazado(await cuerpoInscripcion(e, opciones(ctx.reloj.ahora())), ['apoderado']);
      const vispera = await enviar(await cuerpoInscripcionMenor(e, opciones(ctx.reloj.ahora())));
      expect(vispera.status, vispera.texto).toBe(201);

      ctx.reloj.fijar(new Date('2026-03-01T15:00:00.000Z')); // domingo 1 de marzo de 2026, 10:00 en Lima
      await rechazado(await cuerpoInscripcionMenor(e, opciones(ctx.reloj.ahora())), ['apoderado']);
      const dia = await enviar(await cuerpoInscripcion(e, opciones(ctx.reloj.ahora())));
      expect(dia.status, dia.texto).toBe(201);
    });

    it('criterio 13: la edad se calcula con la fecha de Lima y no con la del servidor (22:00 de Lima, ya es el día siguiente en UTC)', async () => {
      ctx.reloj.fijar(new Date('2026-11-12T03:00:00.000Z')); // 22:00 del 11 de noviembre en Lima
      const nacimiento = { alumno: { fechaNacimiento: '2008-11-12' } };

      await rechazado(await cuerpoInscripcion(e, { ahora: ctx.reloj.ahora(), sobre: nacimiento }), ['apoderado']);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Criterio 14
  // -------------------------------------------------------------------------------------------------------------------

  describe('criterio 14: consentimientos con evidencia', () => {
    it.each([
      ['datosPersonales en false', { consentimientos: { datosPersonales: false } }, 'consentimientos.datosPersonales'],
      ['deslinde en false', { consentimientos: { deslinde: false } }, 'consentimientos.deslinde'],
      [
        'datosPersonales ausente',
        { consentimientos: { datosPersonales: undefined } },
        'consentimientos.datosPersonales',
      ],
      ['deslinde ausente', { consentimientos: { deslinde: undefined } }, 'consentimientos.deslinde'],
      ['datosPersonales como número 1', { consentimientos: { datosPersonales: 1 } }, 'consentimientos.datosPersonales'],
      ['version ausente', { consentimientos: { version: undefined } }, 'consentimientos.version'],
    ])('criterio 14: %s responde 400 sin escribir', async (_nombre, cambios, campo) => {
      await rechazado(await cuerpoInscripcion(e, { sobre: cambios }), [campo]);
    });

    it('criterio 14: una versión que no es la vigente responde 409 TEXTOS_ACTUALIZADOS con los textos vigentes y no escribe nada', async () => {
      const contratos = await cargarContratos();
      const antes = await estado();

      const respuesta = await enviar(
        await cuerpoInscripcion(e, { sobre: { consentimientos: { version: 'una-version-antigua' } } }),
      );

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(codigoDe(respuesta)).toBe('TEXTOS_ACTUALIZADOS');
      const detalles = JSON.stringify(detallesDe(respuesta));
      expect(detalles).toContain(contratos.VERSION_CONSENTIMIENTOS);
      expect(detalles).toContain('Academia A');
      expect(detalles).toMatch(/salud/i);
      expect(await estado()).toEqual(antes);
    });

    it('criterio 14: las versiones parecidas tampoco valen (mayúsculas, espacios, sufijo)', async () => {
      const contratos = await cargarContratos();
      for (const version of [
        contratos.VERSION_CONSENTIMIENTOS.toUpperCase() === contratos.VERSION_CONSENTIMIENTOS
          ? contratos.VERSION_CONSENTIMIENTOS.toLowerCase()
          : contratos.VERSION_CONSENTIMIENTOS.toUpperCase(),
        ` ${contratos.VERSION_CONSENTIMIENTOS}`,
        `${contratos.VERSION_CONSENTIMIENTOS}-2`,
        contratos.VERSION_CONSENTIMIENTOS.slice(0, -1),
      ]) {
        const respuesta = await enviar(await cuerpoInscripcion(e, { sobre: { consentimientos: { version } } }));

        expect([respuesta.status, codigoDe(respuesta)], JSON.stringify(version)).toEqual([409, 'TEXTOS_ACTUALIZADOS']);
      }
    });

    it('criterio 14: una persona mayor de edad deja los dos consentimientos obligatorios, otorgados por el TITULAR, con la versión, "ahora", la IP y el alumno y la solicitud', async () => {
      const contratos = await cargarContratos();

      const respuesta = await enviar(await cuerpoInscripcion(e));

      expect(respuesta.status, respuesta.texto).toBe(201);
      const consentimientos = await leerConsentimientos(e.A.id);
      const [solicitud] = await leerSolicitudes(e.A.id);
      const [alumno] = await leerAlumnos(e.A.id);
      expect(consentimientos.map((c) => c.tipo).sort()).toEqual(['DATOS_PERSONALES', 'DESLINDE']);
      for (const fila of consentimientos) {
        expect(fila.version).toBe(contratos.VERSION_CONSENTIMIENTOS);
        expect(fila.aceptado_en.toISOString()).toBe(AHORA_005.toISOString());
        expect(fila.ip, 'la IP con la que se envió').toMatch(/^(::ffff:)?127\.0\.0\.1$/);
        expect(fila.otorgado_por).toBe('TITULAR');
        expect(fila.aceptado).toBe(true);
        expect(fila.solicitud_id).toBe(solicitud?.id);
        expect(fila.alumno_id).toBe(alumno?.id);
      }
    });

    it('criterio 14: si es menor, quien otorga es el APODERADO', async () => {
      const respuesta = await enviar(await cuerpoInscripcionMenor(e));

      expect(respuesta.status, respuesta.texto).toBe(201);
      const consentimientos = await leerConsentimientos(e.A.id);
      expect(consentimientos.length).toBeGreaterThanOrEqual(2);
      expect(consentimientos.every((c) => c.otorgado_por === 'APODERADO')).toBe(true);
    });

    it('criterio 14: con imagen en true se guarda además el consentimiento de IMAGEN aceptado', async () => {
      const respuesta = await enviar(await cuerpoInscripcion(e, { sobre: { consentimientos: { imagen: true } } }));

      expect(respuesta.status, respuesta.texto).toBe(201);
      const consentimientos = await leerConsentimientos(e.A.id);
      expect(consentimientos.map((c) => c.tipo).sort()).toEqual(['DATOS_PERSONALES', 'DESLINDE', 'IMAGEN']);
      expect(consentimientos.find((c) => c.tipo === 'IMAGEN')?.aceptado).toBe(true);
    });

    it.each([
      ['imagen en false', { imagen: false }],
      ['imagen ausente', {}],
    ])(
      'criterio 14: con %s no queda ningún consentimiento de IMAGEN aceptado y los dos obligatorios sí',
      async (_nombre, extra) => {
        const respuesta = await enviar(await cuerpoInscripcion(e, { sobre: { consentimientos: extra } }));

        expect(respuesta.status, respuesta.texto).toBe(201);
        const consentimientos = await leerConsentimientos(e.A.id);
        expect(consentimientos.filter((c) => c.tipo === 'IMAGEN' && c.aceptado)).toEqual([]);
        expect(
          consentimientos
            .filter((c) => c.tipo !== 'IMAGEN')
            .map((c) => c.tipo)
            .sort(),
        ).toEqual(['DATOS_PERSONALES', 'DESLINDE']);
      },
    );

    it('criterio 14: ningún consentimiento queda de un envío rechazado', async () => {
      await enviar(await cuerpoInscripcion(e, { sobre: { consentimientos: { version: 'vieja' } } }));
      await enviar(await cuerpoInscripcion(e, { sobre: { alumno: { dni: '1' } } }));

      expect(await leerConsentimientos(e.A.id)).toEqual([]);
      expect(await leerSolicitudes(e.A.id)).toEqual([]);
    });
  });

  it('el DNI del formulario se guarda tal cual (con ceros al inicio) y recortado', async () => {
    const respuesta = await enviar(await cuerpoInscripcion(e, { sobre: { alumno: { dni: ' 00123456 ' } } }));

    expect(respuesta.status, respuesta.texto).toBe(201);
    expect((await leerAlumnos(e.A.id))[0]?.dni).toBe('00123456');
    expect(solicitudDe(respuesta).codigo).toMatch(/^AQ-/);
  });
});
