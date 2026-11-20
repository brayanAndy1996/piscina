// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fijarConfiguracion } from '../../utilidades/configuracion';
import { contarAuditoria, fijarEstadoDeAcademia } from '../../utilidades/usuarios';
import {
  actualizarFilas,
  type AppInscripciones,
  AHORA_005,
  codigoDe,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  instantaneaDeInscripciones,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  type Objeto,
  rutaPublica,
  sembrarSolicitud,
  sha256,
  solicitudDe,
  tokenAleatorio,
  VEINTICUATRO_HORAS,
} from '../../utilidades/inscripciones';

// Criterios 29 a 32 (críticos, D-05, D-23, D-27, RNF-05, Ley 29733): seguimiento de la solicitud.
//   29. POST /api/a/{nombreCorto}/solicitudes/consulta con { token } responde 200 con { solicitud: VistaSolicitud, academia: { nombre,
//       telefono } } si el SHA-256 del token es el de una solicitud de esa academia. El token viaja en el cuerpo, nunca en la dirección.
//   30. La misma ruta con { codigo, dni } responde lo mismo si los dos coinciden con la misma solicitud; el código se recorta y se pasa a
//       mayúsculas; el DNI se recorta y uno que no tiene 8 dígitos responde el 404 del criterio 31.
//   31. Un solo 404 SOLICITUD_NO_ENCONTRADA, con el mismo cuerpo (y sin nada en las cabeceras que lo distinga): token inexistente, de otra
//       academia o con formato inválido; código inexistente o con formato inválido; código existente con otro DNI; código de otra academia.
//       Un cuerpo con token y código a la vez, o sin ninguno, responde 400 SOLICITUD_INVALIDA.
//   32. VistaSolicitud (estricta): codigo, estado (PENDIENTE_PAGO, VENCIDA o CANCELADA), creadaEn, reservaVenceEn (solo en PENDIENTE_PAGO),
//       nombres (sin apellidos), plan { nombre }, clases { nivel, diaSemana, horaInicio, horaFin }, mes, clasesTotales, monto,
//       esProporcional y fotoCargada; nunca DNI, apellidos, fecha de nacimiento, edad, teléfono, correo, dirección, datos médicos,
//       apoderado, consentimientos, foto, ids internos ni el hash del token.

describe('seguimiento de la solicitud (criterios 29 a 32)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones();
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const consultar = (cuerpo: unknown, nombreCorto = 'academia-a') =>
    ctx.http.post(rutaPublica(nombreCorto, '/solicitudes/consulta'), cuerpo);
  const solicitudDeA = (opciones: Partial<Parameters<typeof sembrarSolicitud>[1]> = {}) =>
    sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
      nombres: 'Valeria',
      apellidos: 'Mendoza Salas',
      clasesTotales: 9,
      monto: '90.00',
      ...opciones,
    });
  const vista = (respuesta: { body: Objeto | null }): Objeto => respuesta.body?.['solicitud'] as Objeto;
  const CLAVES_DE_LA_VISTA = [
    'clases',
    'clasesTotales',
    'codigo',
    'creadaEn',
    'esProporcional',
    'estado',
    'fotoCargada',
    'mes',
    'monto',
    'nombres',
    'plan',
    'reservaVenceEn',
  ];

  // -------------------------------------------------------------------------------------------------------------------
  // Criterio 29
  // -------------------------------------------------------------------------------------------------------------------

  describe('criterio 29: consulta con el token', () => {
    it('criterio 29: con el token de una solicitud de la academia responde 200 con { solicitud, academia: { nombre, telefono } } y Cache-Control: no-store', async () => {
      await fijarConfiguracion(e.A.id, { telefono: '+51 987 654 321' });
      const cliente = await solicitudDeA();

      const respuesta = await consultar({ token: cliente.token });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['academia', 'solicitud']);
      expect(respuesta.body?.['academia']).toEqual({ nombre: 'Academia A', telefono: '+51 987 654 321' });
      expect(vista(respuesta)['codigo']).toBe(cliente.codigo);
    });

    it('criterio 29: la academia trae telefono null si no lo configuró', async () => {
      const cliente = await solicitudDeA();

      expect((await consultar({ token: cliente.token })).body?.['academia']).toEqual({
        nombre: 'Academia A',
        telefono: null,
      });
    });

    it('criterio 29: con el token que devolvió el envío, la consulta muestra esa misma solicitud', async () => {
      const creada = solicitudDe(
        await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcion(e)),
      );

      const respuesta = await consultar({ token: creada.token });

      expect(respuesta.status, respuesta.texto).toBe(200);
      expect(vista(respuesta)).toMatchObject({
        codigo: creada.codigo,
        estado: 'PENDIENTE_PAGO',
        mes: '2026-11',
        clasesTotales: 9,
        monto: '90.00',
        esProporcional: true,
        fotoCargada: false,
        nombres: 'Camila',
      });
      expect(new Date(vista(respuesta)['reservaVenceEn'] as string).toISOString()).toBe(creada.reservaVenceEn);
    });

    it('criterio 29: el token no sirve en la dirección: ninguna ruta con el token en la URL responde datos de la solicitud', async () => {
      const cliente = await solicitudDeA();

      for (const ruta of [
        `/api/a/academia-a/solicitudes/${cliente.token}`,
        `/api/a/academia-a/solicitud/${cliente.token}`,
        `/api/a/academia-a/solicitudes/consulta/${cliente.token}`,
        `/api/a/academia-a/solicitudes/consulta?token=${cliente.token}`,
      ]) {
        const respuesta = await ctx.http.get(ruta);
        expect(respuesta.status, ruta).toBeGreaterThanOrEqual(400);
        expect(respuesta.texto, ruta).not.toContain(cliente.codigo);
      }
    });

    it('criterio 29: la consulta es solo de lectura: no escribe ni audita (y no cambia el estado de la fila, aunque la reserva haya vencido)', async () => {
      const cliente = await solicitudDeA({ estado: 'PENDIENTE_PAGO_VENCIDA' });
      const antes = { filas: await instantaneaDeInscripciones(e.A.id), auditoria: await contarAuditoria(e.A.id) };

      const respuesta = await consultar({ token: cliente.token });

      expect(vista(respuesta)['estado']).toBe('VENCIDA');
      expect({ filas: await instantaneaDeInscripciones(e.A.id), auditoria: await contarAuditoria(e.A.id) }).toEqual(
        antes,
      );
      expect((await leerSolicitudes(e.A.id))[0]?.estado, 'la fila sigue PENDIENTE_PAGO').toBe('PENDIENTE_PAGO');
    });

    it('criterio 29: una academia suspendida responde 403 ACADEMIA_SUSPENDIDA también en la consulta; una inexistente, 404 ACADEMIA_NO_ENCONTRADA', async () => {
      const deB = await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });
      await fijarEstadoDeAcademia(e.B.id, 'SUSPENDIDA');

      const suspendida = await consultar({ token: deB.token }, 'academia-b');
      const inexistente = await consultar({ token: deB.token }, 'noexiste');

      expect([suspendida.status, codigoDe(suspendida)]).toEqual([403, 'ACADEMIA_SUSPENDIDA']);
      expect([inexistente.status, codigoDe(inexistente)]).toEqual([404, 'ACADEMIA_NO_ENCONTRADA']);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Criterio 30
  // -------------------------------------------------------------------------------------------------------------------

  describe('criterio 30: consulta con el código y el DNI', () => {
    it('criterio 30: con el código y el DNI de la solicitud responde lo mismo que con el token', async () => {
      const cliente = await solicitudDeA();

      const porToken = await consultar({ token: cliente.token });
      const porCodigo = await consultar({ codigo: cliente.codigo, dni: cliente.dni });

      expect(porCodigo.status, porCodigo.texto).toBe(200);
      expect(porCodigo.body).toEqual(porToken.body);
    });

    it.each([
      ['en minúsculas', (codigo: string) => codigo.toLowerCase()],
      ['con espacios alrededor', (codigo: string) => `  ${codigo}  `],
      ['en minúsculas y con espacios', (codigo: string) => ` ${codigo.toLowerCase()}\t`],
    ])(
      'criterio 30: el código %s se recorta y se pasa a mayúsculas antes de buscarlo',
      async (_nombre, transformar) => {
        const cliente = await solicitudDeA({ codigo: 'AQ-7F3K9X' });

        const respuesta = await consultar({ codigo: transformar(cliente.codigo), dni: cliente.dni });

        expect(respuesta.status, respuesta.texto).toBe(200);
        expect(vista(respuesta)['codigo']).toBe('AQ-7F3K9X');
      },
    );

    it('criterio 30: el DNI se recorta', async () => {
      const cliente = await solicitudDeA();

      const respuesta = await consultar({ codigo: cliente.codigo, dni: ` ${cliente.dni} ` });

      expect(respuesta.status, respuesta.texto).toBe(200);
    });

    it('criterio 30: no se corrige una letra parecida: con la O en lugar del 0 no se encuentra', async () => {
      const cliente = await solicitudDeA({ codigo: 'AQ-0A0B0C' });

      const respuesta = await consultar({ codigo: 'AQ-OAOBOC', dni: cliente.dni });

      expect([respuesta.status, codigoDe(respuesta)]).toEqual([404, 'SOLICITUD_NO_ENCONTRADA']);
    });

    it('criterio 30: un DNI que no tiene 8 dígitos responde el mismo 404 del criterio 31 (no un 400)', async () => {
      const cliente = await solicitudDeA();

      for (const dni of ['1234567', '123456789', 'abcdefgh', '1234 5678']) {
        const respuesta = await consultar({ codigo: cliente.codigo, dni });
        expect([respuesta.status, codigoDe(respuesta)], dni).toEqual([404, 'SOLICITUD_NO_ENCONTRADA']);
      }
    });

    it('criterio 30: el DNI y el código deben ser de la misma solicitud: el DNI de otro cliente de la academia no sirve', async () => {
      const uno = await solicitudDeA();
      const dos = await solicitudDeA();

      const cruzada = await consultar({ codigo: uno.codigo, dni: dos.dni });
      const correcta = await consultar({ codigo: dos.codigo, dni: dos.dni });

      expect(cruzada.status).toBe(404);
      expect(correcta.status).toBe(200);
      expect(vista(correcta)['codigo']).toBe(dos.codigo);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Criterio 31
  // -------------------------------------------------------------------------------------------------------------------

  describe('criterio 31: un solo 404', () => {
    /** Las cabeceras de una respuesta sin las que cambian solas (la fecha). */
    const cabeceras = (respuesta: { headers: Headers }) =>
      [...respuesta.headers.entries()].filter(([nombre]) => nombre !== 'date').sort();

    it('criterio 31: token inexistente, de otra academia, con formato inválido, código inexistente o inválido, código con otro DNI y código de otra academia responden el mismo 404 con el mismo cuerpo y las mismas cabeceras', async () => {
      const cliente = await solicitudDeA();
      const otro = await solicitudDeA();
      const deB = await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });
      const valido = tokenAleatorio();
      const casos: [string, Objeto][] = [
        ['token que no existe', { token: valido }],
        ['token de otra academia', { token: deB.token }],
        ['token de 42 caracteres', { token: cliente.token.slice(0, 42) }],
        ['token de 44 caracteres', { token: `${cliente.token}A` }],
        ['token con el alfabeto base64 estándar', { token: `${cliente.token.slice(0, 41)}+/` }],
        ['token con espacios dentro', { token: `${cliente.token.slice(0, 20)} ${cliente.token.slice(21)}` }],
        ['token de 100 caracteres', { token: 'A'.repeat(100) }],
        ['código que no existe', { codigo: 'AQ-ZZZZZZ', dni: cliente.dni }],
        ['código con formato inválido (corto)', { codigo: 'AQ-12', dni: cliente.dni }],
        ['código con formato inválido (prefijo)', { codigo: 'XX-ABCDEF', dni: cliente.dni }],
        ['código con letras que no son del alfabeto (I, L, O, U)', { codigo: 'AQ-ILOUIL', dni: cliente.dni }],
        ['código existente con el DNI de otro cliente', { codigo: cliente.codigo, dni: otro.dni }],
        ['código existente con un DNI que no existe', { codigo: cliente.codigo, dni: '00000000' }],
        ['código de otra academia con su DNI', { codigo: deB.codigo, dni: deB.dni }],
        ['código de otra academia con el DNI de A', { codigo: deB.codigo, dni: cliente.dni }],
        ['código existente con un DNI inválido', { codigo: cliente.codigo, dni: '1234' }],
      ];

      const respuestas = [];
      for (const [nombre, cuerpo] of casos) respuestas.push([nombre, await consultar(cuerpo)] as const);

      for (const [nombre, respuesta] of respuestas) {
        expect([respuesta.status, codigoDe(respuesta)], `${nombre}: ${respuesta.texto}`).toEqual([
          404,
          'SOLICITUD_NO_ENCONTRADA',
        ]);
        expect(respuesta.cacheControl, nombre).toBe('no-store');
      }
      const [, primera] = respuestas[0] as readonly [string, (typeof respuestas)[number][1]];
      for (const [nombre, respuesta] of respuestas) {
        expect(respuesta.texto, nombre).toBe(primera.texto);
        expect(cabeceras(respuesta), `cabeceras de ${nombre}`).toEqual(cabeceras(primera));
      }
    });

    it('criterio 31: el 404 no dice nada de la solicitud (ni el código, ni el nombre, ni si existe)', async () => {
      const cliente = await solicitudDeA();
      const otro = await solicitudDeA();

      const respuesta = await consultar({ codigo: cliente.codigo, dni: otro.dni });

      expect(respuesta.texto).not.toContain(cliente.codigo);
      expect(respuesta.texto).not.toContain(cliente.dni);
      expect(respuesta.texto).not.toContain('Valeria');
    });

    it.each([
      [
        'token y código a la vez',
        (c: { token: string; codigo: string; dni: string }) => ({ token: c.token, codigo: c.codigo }),
      ],
      ['token, código y DNI', (c: { token: string; codigo: string; dni: string }) => c],
      ['ninguno de los dos (cuerpo vacío)', () => ({})],
      ['solo el código, sin DNI', (c: { codigo: string }) => ({ codigo: c.codigo })],
      ['solo el DNI', (c: { dni: string }) => ({ dni: c.dni })],
      ['un campo de más con el token', (c: { token: string }) => ({ token: c.token, academiaId: 'x' })],
      [
        'un campo de más con el código y el DNI',
        (c: { codigo: string; dni: string }) => ({ codigo: c.codigo, dni: c.dni, extra: 1 }),
      ],
      ['el token como número', () => ({ token: 123456 })],
      ['el token nulo', () => ({ token: null })],
      ['el DNI como número', (c: { codigo: string }) => ({ codigo: c.codigo, dni: 12345678 })],
      ['un token de más de 100 caracteres', () => ({ token: 'A'.repeat(101) })],
      ['un código de más de 100 caracteres', () => ({ codigo: 'A'.repeat(101), dni: '12345678' })],
    ])('criterio 31: %s responde 400 SOLICITUD_INVALIDA', async (_nombre, armar) => {
      const cliente = await solicitudDeA();

      const respuesta = await consultar(armar(cliente));

      expect([respuesta.status, codigoDe(respuesta)], respuesta.texto).toEqual([400, 'SOLICITUD_INVALIDA']);
      expect(respuesta.texto).not.toContain(cliente.codigo.slice(3));
    });

    it('criterio 31: un cuerpo que no es JSON válido responde 400', async () => {
      const respuesta = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), undefined, {
        crudo: '{"token":',
      });

      expect(respuesta.status).toBe(400);
    });

    it('criterio 31: el token de B no abre nada en A y el token de A no abre nada en B (aislamiento entre academias)', async () => {
      const deA = await solicitudDeA();
      const deB = await sembrarSolicitud(e.B.id, { planId: e.planB.id, claseIds: [e.lunesB.id] });

      expect((await consultar({ token: deB.token }, 'academia-a')).status).toBe(404);
      expect((await consultar({ token: deA.token }, 'academia-b')).status).toBe(404);
      expect((await consultar({ token: deA.token }, 'academia-a')).status).toBe(200);
      expect((await consultar({ token: deB.token }, 'academia-b')).status).toBe(200);
    });

    it('criterio 31: el mismo código en dos academias se resuelve con la academia de la dirección', async () => {
      const deA = await solicitudDeA({ codigo: 'AQ-ABCDEF' });
      const deB = await sembrarSolicitud(e.B.id, {
        planId: e.planB.id,
        claseIds: [e.lunesB.id],
        codigo: 'AQ-ABCDEF',
        nombres: 'Otra',
      });

      const enA = await consultar({ codigo: 'AQ-ABCDEF', dni: deA.dni }, 'academia-a');
      const enB = await consultar({ codigo: 'AQ-ABCDEF', dni: deB.dni }, 'academia-b');
      const cruzada = await consultar({ codigo: 'AQ-ABCDEF', dni: deB.dni }, 'academia-a');

      expect(vista(enA)['nombres']).toBe('Valeria');
      expect(vista(enB)['nombres']).toBe('Otra');
      expect(cruzada.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Criterio 32
  // -------------------------------------------------------------------------------------------------------------------

  describe('criterio 32: la vista mínima', () => {
    it('criterio 32: una solicitud PENDIENTE_PAGO muestra exactamente los campos de la vista, con sus valores', async () => {
      const cliente = await solicitudDeA();

      const respuesta = await consultar({ token: cliente.token });

      const solicitud = vista(respuesta);
      expect(Object.keys(solicitud).sort()).toEqual(CLAVES_DE_LA_VISTA);
      expect(solicitud).toMatchObject({
        codigo: cliente.codigo,
        estado: 'PENDIENTE_PAGO',
        nombres: 'Valeria',
        plan: { nombre: 'Plan 3 por semana' },
        mes: '2026-11',
        clasesTotales: 9,
        monto: '90.00',
        esProporcional: true,
        fotoCargada: false,
      });
      expect(new Date(solicitud['creadaEn'] as string).toISOString()).toBe(AHORA_005.toISOString());
      expect(new Date(solicitud['reservaVenceEn'] as string).toISOString()).toBe(
        new Date(AHORA_005.getTime() + VEINTICUATRO_HORAS).toISOString(),
      );
      expect(Object.keys(solicitud['plan'] as Objeto)).toEqual(['nombre']);
    });

    it('criterio 32 (P2): nombres lleva solo el primer nombre de pila: de "Valeria Andrea" se muestra "Valeria"', async () => {
      const cliente = await solicitudDeA({ nombres: 'Valeria Andrea', apellidos: 'Mendoza Salas' });

      const respuesta = await consultar({ token: cliente.token });

      expect(vista(respuesta)['nombres']).toBe('Valeria');
      expect(respuesta.texto).not.toContain('Andrea');
    });

    it('criterio 32: las clases traen solo nivel, diaSemana, horaInicio y horaFin', async () => {
      const cliente = await solicitudDeA();

      const clases = (vista(await consultar({ token: cliente.token }))['clases'] as Objeto[])
        .map((clase) => ({ ...clase }))
        .sort((a, b) => Number(a['diaSemana']) - Number(b['diaSemana']));

      expect(clases).toEqual([
        { nivel: 'BASICO', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' },
        { nivel: 'BASICO', diaSemana: 3, horaInicio: '18:00', horaFin: '19:00' },
        { nivel: 'BASICO', diaSemana: 5, horaInicio: '18:00', horaFin: '19:00' },
      ]);
    });

    it('criterio 32: nunca lleva el DNI, los apellidos, la fecha de nacimiento, el teléfono, el correo, la dirección, los datos médicos, el apoderado, los consentimientos, la foto, los ids internos ni el hash del token', async () => {
      const cliente = await solicitudDeA({ conApoderado: true });
      const [alumno] = await leerAlumnos(e.A.id);
      const [matricula] = await leerMatriculas(e.A.id);

      const respuesta = await consultar({ token: cliente.token });

      const texto = respuesta.texto;
      const prohibidos: [string, string | undefined][] = [
        ['el DNI', cliente.dni],
        ['los apellidos', 'Mendoza'],
        ['la fecha de nacimiento', alumno?.fecha_nacimiento],
        ['el teléfono', alumno?.telefono],
        ['el id del alumno', cliente.alumnoId],
        ['el id de la solicitud', cliente.solicitudId],
        ['el id de la matrícula', matricula?.id],
        ['el id del plan', e.plan.id],
        ['el id de una clase', e.lunes.id],
        ['el hash del token', sha256(cliente.token).toString('hex')],
        ['el hash del token en base64', sha256(cliente.token).toString('base64')],
        ['el token', cliente.token],
        ['el contacto de emergencia', 'Contacto'],
        ['el apoderado', 'Apoderado'],
        ['el tipo de consentimiento', 'DATOS_PERSONALES'],
        ['la ficha médica', 'tipoSangre'],
      ];
      for (const [nombre, valor] of prohibidos) {
        if (valor) expect(texto, `la vista no debe llevar ${nombre}`).not.toContain(valor);
      }
      for (const campo of [
        'edad',
        'telefono',
        'correo',
        'direccion',
        'apoderado',
        'consentimientos',
        'foto',
        'alumnoId',
        'matriculaId',
        'solicitudId',
        'tokenHash',
        'apellidos',
        'dni',
      ]) {
        expect(Object.keys(vista(respuesta)), campo).not.toContain(campo);
      }
    });

    it('criterio 32: una solicitud VENCIDA o CANCELADA muestra lo mismo sin reservaVenceEn', async () => {
      const vencida = await solicitudDeA({ estado: 'VENCIDA' });
      const cancelada = await solicitudDeA({ estado: 'CANCELADA' });

      const deVencida = vista(await consultar({ token: vencida.token }));
      const deCancelada = vista(await consultar({ token: cancelada.token }));

      expect(deVencida['estado']).toBe('VENCIDA');
      expect(deCancelada['estado']).toBe('CANCELADA');
      for (const solicitud of [deVencida, deCancelada]) {
        expect(Object.keys(solicitud).sort()).toEqual(CLAVES_DE_LA_VISTA.filter((clave) => clave !== 'reservaVenceEn'));
        expect(solicitud).toMatchObject({
          plan: { nombre: 'Plan 3 por semana' },
          mes: '2026-11',
          monto: '90.00',
          nombres: 'Valeria',
        });
      }
    });

    it('criterio 32: una PENDIENTE_PAGO cuya reserva venció se muestra VENCIDA aunque la fila no lo diga: un segundo antes sigue pendiente y en el instante del vencimiento ya es VENCIDA', async () => {
      const cliente = await solicitudDeA();
      const vence = new Date(AHORA_005.getTime() + VEINTICUATRO_HORAS);

      ctx.reloj.fijar(new Date(vence.getTime() - 1000));
      const antes = vista(await consultar({ token: cliente.token }));
      ctx.reloj.fijar(vence);
      const justo = vista(await consultar({ token: cliente.token }));
      ctx.reloj.avanzar(VEINTICUATRO_HORAS);
      const despues = vista(await consultar({ codigo: cliente.codigo, dni: cliente.dni }));

      expect(antes['estado']).toBe('PENDIENTE_PAGO');
      expect(antes).toHaveProperty('reservaVenceEn');
      expect(justo['estado']).toBe('VENCIDA');
      expect(justo).not.toHaveProperty('reservaVenceEn');
      expect(despues['estado']).toBe('VENCIDA');
    });

    it('criterio 32: fotoCargada es false en esta entrega (no hay forma de subir una foto) y true si el alumno ya tiene su clave de foto guardada', async () => {
      const cliente = await solicitudDeA();
      expect(vista(await consultar({ token: cliente.token }))['fotoCargada']).toBe(false);

      await actualizarFilas(
        'propietario',
        'alumnos',
        e.A.id,
        { id: cliente.alumnoId },
        { foto_clave: 'academias/x/alumnos/y/foto-z.jpg' },
      );

      const conFoto = vista(await consultar({ token: cliente.token }));
      expect(conFoto['fotoCargada']).toBe(true);
      expect(JSON.stringify(conFoto)).not.toContain('foto-z.jpg');
    });

    it('criterio 32: la vista no cambia por haber consultado dos veces ni por consultar por código y DNI en vez de por token', async () => {
      const cliente = await solicitudDeA();

      const uno = await consultar({ token: cliente.token });
      const dos = await consultar({ token: cliente.token });
      const tres = await consultar({ codigo: cliente.codigo, dni: cliente.dni });

      expect(dos.body).toEqual(uno.body);
      expect(tres.body).toEqual(uno.body);
    });
  });
});
