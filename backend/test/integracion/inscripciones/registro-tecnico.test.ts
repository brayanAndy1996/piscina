// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { dniInventado } from '../../utilidades/usuarios';
import {
  type AppInscripciones,
  AHORA_005,
  cargarContratos,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  cuerpoCotizacion,
  cuerpoInscripcionMenor,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  type Objeto,
  rutaPublica,
  solicitudDe,
} from '../../utilidades/inscripciones';

// Criterio 28 (crítico, criterio 43 de 002, Ley 29733): en ningún nivel, el registro técnico de las rutas de esta historia lleva el DNI,
// nombres, fecha de nacimiento, teléfono, correo, dirección, datos médicos, apoderado, token, código junto con el DNI ni el cuerpo de la
// petición; la línea de la petición de pino-http no lleva cuerpo ni token (el token nunca va en una dirección de la API). Prueba con un
// registro en memoria que cotiza, envía un formulario completo y consulta, y busca cada valor. (La subida de la foto, en la 005b.)

describe('el registro técnico no lleva datos personales ni el token (criterio 28)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(AHORA_005);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it('criterio 28: cotizar, enviar un formulario completo y consultar por token y por código y DNI no dejan ningún dato sensible en el registro', async () => {
    const contratos = await cargarContratos();
    const dniAlumno = dniInventado();
    const dniApoderado = dniInventado();
    const sensibles: Record<string, string> = {
      dniAlumno,
      dniApoderado,
      nombres: 'Zenobia',
      apellidos: 'Quillahuaman Torrico',
      telefono: '987612345',
      correo: 'zenobia.secreta@ejemplo.test',
      direccion: 'Pasaje Reservadisimo 4821',
      enfermedad: 'Hipotiroidismo congenito',
      alergia: 'Alergiaextranisima',
      medicamento: 'Levotiroxina',
      seguro: 'Seguro Inventadisimo',
      contacto: 'Contactoxyz Ramirez',
      telefonoContacto: '955667788',
      apoderadoNombres: 'Anselma',
      apoderadoApellidos: 'Huaytalla Quispe',
      apoderadoTelefono: '944112233',
      apoderadoCorreo: 'anselma.secreta@ejemplo.test',
    };
    const cuerpo = await cuerpoInscripcionMenor(e, {
      sobre: {
        alumno: {
          dni: dniAlumno,
          nombres: sensibles['nombres'],
          apellidos: sensibles['apellidos'],
          telefono: sensibles['telefono'],
          correo: sensibles['correo'],
          direccion: sensibles['direccion'],
          gradoColegio: contratos.GRADOS_COLEGIO[0],
        },
        fichaMedica: {
          enfermedades: sensibles['enfermedad'],
          alergias: sensibles['alergia'],
          medicamentos: sensibles['medicamento'],
          seguro: sensibles['seguro'],
          contactoEmergencia: { nombre: sensibles['contacto'], telefono: sensibles['telefonoContacto'] },
        },
        apoderado: {
          nombres: sensibles['apoderadoNombres'],
          apellidos: sensibles['apoderadoApellidos'],
          dni: dniApoderado,
          telefono: sensibles['apoderadoTelefono'],
          correo: sensibles['apoderadoCorreo'],
        },
      },
    });

    const cotizacion = await ctx.http.post(rutaPublica('academia-a', '/inscripcion/cotizacion'), cuerpoCotizacion(e));
    const envio = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo);
    expect([cotizacion.status, envio.status], `${cotizacion.texto} ${envio.texto}`).toEqual([200, 201]);
    const solicitud = solicitudDe(envio);
    const porToken = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
      token: solicitud.token,
    });
    const porCodigo = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
      codigo: solicitud.codigo,
      dni: dniAlumno,
    });
    const noExiste = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
      codigo: 'AQ-ZZZZZZ',
      dni: dniApoderado,
    });
    const rechazado = await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), {
      ...cuerpo,
      alumno: { ...(cuerpo['alumno'] as Objeto), dni: 'DNIMALO99' },
    });
    expect([porToken.status, porCodigo.status, noExiste.status, rechazado.status]).toEqual([200, 200, 404, 400]);
    await esperarHasta(() => lineas.some((linea) => linea.includes('/solicitudes/consulta')));

    expect(lineas.length, 'la aplicación escribió registros').toBeGreaterThan(0);
    const todo = lineas.join('\n');
    for (const [nombre, valor] of Object.entries(sensibles)) {
      expect(todo, `el registro lleva ${nombre}`).not.toContain(valor);
    }
    for (const prohibido of [solicitud.token, solicitud.enlace, 'DNIMALO99']) {
      expect(todo, `el registro lleva ${prohibido}`).not.toContain(prohibido);
    }
    for (const fragmento of [
      'fichaMedica',
      'fechaNacimiento',
      'contactoEmergencia',
      'claveIdempotencia',
      '"montoMostrado"',
    ]) {
      expect(todo, `el registro lleva el cuerpo de la petición (${fragmento})`).not.toContain(fragmento);
    }
    const conCodigoYDni = lineas.filter((linea) => linea.includes(solicitud.codigo) && linea.includes(dniAlumno));
    expect(conCodigoYDni, 'ninguna línea junta el código y el DNI').toEqual([]);
  });

  it('criterio 28: las líneas de las peticiones no traen el cuerpo ni el token, y la consulta viaja por POST sin token en la dirección', async () => {
    const solicitud = solicitudDe(
      await ctx.http.post(rutaPublica('academia-a', '/inscripcion'), await cuerpoInscripcionMenor(e)),
    );
    const antes = lineas.length;

    await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), { token: solicitud.token });
    await esperarHasta(() => lineas.length > antes);

    const nuevas = lineas.slice(antes).join('\n');
    expect(nuevas).not.toContain(solicitud.token);
    expect(nuevas).not.toContain(solicitud.enlace);
    expect(nuevas, 'la petición se anota con su dirección sin datos').toContain('/solicitudes/consulta');
  });
});
