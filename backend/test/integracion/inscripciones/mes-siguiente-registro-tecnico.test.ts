// spec: 010-mensualidades (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cotizarPublico,
  cuerpoDeCotizacion,
  cuerpoParaMes,
  enviarPublico,
  INSTANTE,
  MES_DIC,
  rutaFormulario,
  rutaMeses,
} from '../../utilidades/escenario-mes-siguiente';
import {
  type AppInscripciones,
  cargarContratos,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  rutaPublica,
  solicitudDe,
} from '../../utilidades/inscripciones';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { dniInventado } from '../../utilidades/usuarios';

// Criterio 14 (crítico, criterio 28 de 005): el registro técnico de las rutas del mes siguiente no lleva DNI, nombres, datos médicos, token ni cuerpo. Va en su propio archivo porque el nivel de registro de pino lo fija la primera aplicación que se crea en el proceso (`opciones-registro.ts`): otra aplicación con nivel `silent` creada antes en el mismo archivo dejaría el registro vacío.

describe('el registro técnico de las rutas del mes siguiente no lleva datos personales ni el token (criterio 14)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppInscripciones;
  let e: EscenarioInscripcion;

  beforeAll(async () => {
    ctx = await crearAppInscripciones({ nivelRegistro: 'trace', destinoRegistro: destino, ahora: INSTANTE.viernes27 });
  });
  beforeEach(async () => {
    await exigirTablasDeInscripcion();
    ctx.reloj.fijar(INSTANTE.viernes27);
    e = await crearEscenarioInscripcion();
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  it('criterio 14: leer los meses, el formulario de diciembre, cotizar y enviar un formulario completo para diciembre y consultar por token no dejan ningún dato sensible en el registro', async () => {
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
      apoderadoNombres: 'Anselma',
      apoderadoApellidos: 'Huaytalla Quispe',
      apoderadoCorreo: 'anselma.secreta@ejemplo.test',
    };
    const cuerpo = await cuerpoParaMes(e, MES_DIC, {
      sobre: {
        alumno: {
          dni: dniAlumno,
          nombres: sensibles['nombres'],
          apellidos: sensibles['apellidos'],
          fechaNacimiento: '2014-03-10',
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
          contactoEmergencia: { nombre: sensibles['contacto'], telefono: '955667788' },
        },
        apoderado: {
          nombres: sensibles['apoderadoNombres'],
          apellidos: sensibles['apoderadoApellidos'],
          dni: dniApoderado,
          telefono: '944112233',
          parentesco: contratos.PARENTESCOS[0],
          correo: sensibles['apoderadoCorreo'],
        },
      },
    });

    const meses = await ctx.http.get(rutaMeses());
    const formulario = await ctx.http.get(rutaFormulario('academia-a', '?mes=2026-12'));
    const cotizacion = await cotizarPublico(
      ctx,
      cuerpoDeCotizacion({ planId: e.plan.id, claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id], mes: MES_DIC }),
    );
    const envio = await enviarPublico(ctx, cuerpo);
    expect([meses.status, formulario.status, cotizacion.status, envio.status], `${envio.texto}`).toEqual([
      200, 200, 200, 201,
    ]);
    const solicitud = solicitudDe(envio);
    const consulta = await ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), {
      token: solicitud.token,
    });
    expect(consulta.status, consulta.texto).toBe(200);
    await esperarHasta(() => lineas.some((linea) => linea.includes('/solicitudes/consulta')));

    expect(
      lineas.some((linea) => linea.includes('/inscripcion/meses')),
      'la petición de los meses se registró',
    ).toBe(true);
    const todo = lineas.join('\n');
    for (const [nombre, valor] of Object.entries(sensibles)) {
      expect(todo, `el registro lleva ${nombre}`).not.toContain(valor);
    }
    for (const prohibido of [solicitud.token, solicitud.enlace]) {
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
  });
});
