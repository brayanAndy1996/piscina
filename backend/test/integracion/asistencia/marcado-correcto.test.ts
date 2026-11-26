// spec: 009-asistencia (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import { type AppCarnet, cambiarAlumno, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  asistenciasDe,
  type AlumnoDeAsistencia,
  CLAVES_DE_LA_ASISTENCIA,
  CLAVES_DE_LA_CLASE,
  CLAVES_DE_LAS_CLASES,
  CLAVES_DEL_ALUMNO,
  CLAVES_DEL_RESULTADO,
  clasesUsadasDe,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
  LUNES,
  LUNES_SIGUIENTE,
  leerAsistencias,
  marcar,
  prepararEscenarioDeAsistencia,
  resultadoDe,
  type Via,
} from '../../utilidades/escenario-asistencia';
import { leerMatriculas } from '../../utilidades/inscripciones';

// Criterio 2 (crítico, HU-14): `POST /api/asistencias/qr`, con `registrarAsistenciaQrSchema` (`{ contenido, claveIdempotencia }`), registra la asistencia del alumno del QR si pasa todas las validaciones: una fila con
// `metodo` `QR`, `tipo` `NORMAL`, la matrícula y la clase del día, `fecha` hoy (de Lima), `llegada_en` y `registrado_en` «ahora», el estado de llegada y `registrado_por` el actor. Responde 201.
// Criterio 5 (crítico, HU-15): `POST /api/asistencias/manual` (`{ alumnoId, claveIdempotencia }`) hace lo mismo, con el mismo orden y la misma respuesta, con `metodo` `MANUAL`.
// Criterio 11 (crítico, RN-14): en la misma transacción del `INSERT`, `clases_usadas` de la matrícula del día sube en 1 (y `actualizado_en`). La respuesta trae `clases: { usadas, totales, restantes }` después del descuento. El
// invariante de las pruebas: `clases_usadas` es igual al número de asistencias de la matrícula. Un rechazo no descuenta (se comprueba en `orden-validaciones.test.ts`).
// Criterio 15 (crítico, HU-14, Ley 29733), parte del 201: `resultadoAsistenciaSchema` estricto: `asistencia` (`id`, `fecha`, `horaLlegada` `HH:MM` de Lima, `llegadaEn` ISO, `estadoLlegada`, `metodo`, `registroPosterior`), `alumno` (`id`,
// `nombres`, `apellidos`, `nivel`, `foto`), `clase` (`id`, `nivel`, `diaSemana`, `horaInicio`, `horaFin`), `clases` y `repetida`. Las claves exactas, sin DNI, token, contenido del QR, fecha de nacimiento, datos médicos, apoderado ni `foto_clave`.
// Criterio 18 (prueba obligatoria, aquí como parte de lo crítico): el marcado normal dentro de la clase no escribe en `auditoria`: la fila guarda quién, cuándo y cómo.
// Las pruebas se hacen el lunes 16/11/2026: la clase del alumno es la de los lunes de 18:00 a 19:00, que `AHORA_007` (miércoles 11/11) todavía no vio, y su matrícula (`creado_en` 11/11, 12 clases) la incluye.

describe('el marcado correcto: QR y manual (criterios 2, 5, 11, 15 y 18)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let alumno: AlumnoDeAsistencia;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeAsistencia(ctx);
    alumno = await crearAlumnoDeAsistencia(ctx, esc);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const HORA = enLima(LUNES, '18:05:00.000');

  describe.each<Via>(['QR', 'MANUAL'])('por la vía %s', (via) => {
    it('criterio 2 y 5: la secretaria registra la asistencia: 201 con el resultado, una fila con los valores del criterio 2, un descuento y ninguna auditoría', async () => {
      const cookies = en(ctx, esc, HORA);
      const clave = randomUUID();
      const auditoriaAntes = await leerAuditoriaDeAcademia(esc.e.A.id);

      const respuesta = await marcar(ctx, via, cookies.secretaria, alumno, { claveIdempotencia: clave });

      const resultado = resultadoDe(respuesta, 201);
      expect(resultado.asistencia).toMatchObject({
        fecha: LUNES,
        horaLlegada: '18:05',
        llegadaEn: HORA.toISOString(),
        estadoLlegada: 'PUNTUAL',
        metodo: via,
        registroPosterior: false,
      });
      expect(resultado.asistencia.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(resultado.alumno).toMatchObject({
        id: alumno.alumnoId,
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        nivel: 'BASICO',
        foto: null,
      });
      expect(resultado.clase).toEqual({
        id: esc.e.lunes.id,
        nivel: 'BASICO',
        diaSemana: 1,
        horaInicio: '18:00',
        horaFin: '19:00',
      });
      expect(resultado.clases).toEqual({ usadas: 1, totales: 12, restantes: 11 });
      expect(resultado.repetida).toBe(false);

      const filas = await asistenciasDe(esc.e.A.id, alumno.alumnoId);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        id: resultado.asistencia.id,
        academia_id: esc.e.A.id,
        alumno_id: alumno.alumnoId,
        matricula_id: alumno.matriculaId,
        clase_id: esc.e.lunes.id,
        fecha: LUNES,
        metodo: via,
        tipo: 'NORMAL',
        estado_llegada: 'PUNTUAL',
        registrado_por: esc.e.secretariaA.id,
        registro_posterior: false,
        motivo: null,
        clave_idempotencia: clave,
      });
      expect(filas[0]?.llegada_en.toISOString()).toBe(HORA.toISOString());
      expect(filas[0]?.registrado_en.toISOString()).toBe(HORA.toISOString());
      const matricula = (await leerMatriculas(esc.e.A.id)).find((m) => m.id === alumno.matriculaId);
      expect(matricula).toMatchObject({ clases_usadas: 1, clases_totales: 12 });
      expect(matricula?.actualizado_en.toISOString(), 'el descuento actualiza actualizado_en').toBe(HORA.toISOString());
      expect(await leerAuditoriaDeAcademia(esc.e.A.id), 'criterio 18: el marcado normal no audita').toEqual(
        auditoriaAntes,
      );
    });

    it('criterio 2 y 5: el administrador también marca, y registrado_por es él', async () => {
      const cookies = en(ctx, esc, HORA);

      const respuesta = await marcar(ctx, via, cookies.admin, alumno);

      resultadoDe(respuesta, 201);
      expect((await asistenciasDe(esc.e.A.id, alumno.alumnoId))[0]?.registrado_por).toBe(esc.e.adminA.id);
    });

    it('criterio 15: las claves exactas del JSON de la respuesta 201, sin ningún dato de más', async () => {
      const cookies = en(ctx, esc, HORA);

      const respuesta = await marcar(ctx, via, cookies.secretaria, alumno);

      const resultado = resultadoDe(respuesta, 201);
      expect(Object.keys(resultado).sort()).toEqual(CLAVES_DEL_RESULTADO);
      expect(Object.keys(resultado.asistencia).sort()).toEqual(CLAVES_DE_LA_ASISTENCIA);
      expect(Object.keys(resultado.alumno).sort()).toEqual(CLAVES_DEL_ALUMNO);
      expect(Object.keys(resultado.clase).sort()).toEqual(CLAVES_DE_LA_CLASE);
      expect(Object.keys(resultado.clases).sort()).toEqual(CLAVES_DE_LAS_CLASES);
    });
  });

  describe('el descuento (criterio 11)', () => {
    it('criterio 11: cada asistencia de un día distinto descuenta una clase: dos lunes, dos asistencias, clases_usadas 2 y «Le quedan 10 de 12»', async () => {
      const primera = await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES, '18:05')).secretaria, alumno);
      const segunda = await marcar(ctx, 'MANUAL', en(ctx, esc, enLima(LUNES_SIGUIENTE, '18:30')).secretaria, alumno);

      expect(resultadoDe(primera, 201).clases).toEqual({ usadas: 1, totales: 12, restantes: 11 });
      expect(resultadoDe(segunda, 201).clases).toEqual({ usadas: 2, totales: 12, restantes: 10 });
      expect(await clasesUsadasDe(esc.e.A.id, alumno.matriculaId)).toBe(2);
      expect((await asistenciasDe(esc.e.A.id, alumno.alumnoId)).map((fila) => fila.fecha)).toEqual([
        LUNES,
        LUNES_SIGUIENTE,
      ]);
    });

    it('criterio 11: el descuento parte de las clases ya usadas de la matrícula (4 usadas → 5) y el invariante «clases_usadas = asistencias» se cumple para lo que registra la API', async () => {
      const otro = await crearAlumnoDeAsistencia(ctx, esc, { clasesUsadas: 4 });
      const cookies = en(ctx, esc, HORA);

      const resultado = resultadoDe(await marcar(ctx, 'QR', cookies.secretaria, otro), 201);
      const sinMarcar = await clasesUsadasDe(esc.e.A.id, alumno.matriculaId);

      expect(resultado.clases).toEqual({ usadas: 5, totales: 12, restantes: 7 });
      expect(await clasesUsadasDe(esc.e.A.id, otro.matriculaId)).toBe(5);
      expect(sinMarcar, 'la matrícula de quien no marcó no cambia').toBe(0);
      expect(await asistenciasDe(esc.e.A.id, otro.alumnoId)).toHaveLength(1);
    });

    it('criterio 11: la última clase se usa y queda «Le quedan 0 de 12»; la siguiente lectura es SIN_CLASES_RESTANTES y no descuenta', async () => {
      const ultimo = await crearAlumnoDeAsistencia(ctx, esc, { clasesUsadas: 11 });

      const ultima = await marcar(ctx, 'QR', en(ctx, esc, HORA).secretaria, ultimo);
      const siguiente = await marcar(ctx, 'QR', en(ctx, esc, enLima(LUNES_SIGUIENTE, '18:05')).secretaria, ultimo);

      expect(resultadoDe(ultima, 201).clases).toEqual({ usadas: 12, totales: 12, restantes: 0 });
      expect(siguiente.status).toBe(409);
      expect(siguiente.body?.['codigo']).toBe('SIN_CLASES_RESTANTES');
      expect(await clasesUsadasDe(esc.e.A.id, ultimo.matriculaId)).toBe(12);
      expect(await asistenciasDe(esc.e.A.id, ultimo.alumnoId)).toHaveLength(1);
    });

    it('criterio 11: la matrícula de otro alumno de la misma clase no se toca', async () => {
      const compañero = await crearAlumnoDeAsistencia(ctx, esc);

      await marcar(ctx, 'MANUAL', en(ctx, esc, HORA).secretaria, alumno);

      expect(await clasesUsadasDe(esc.e.A.id, compañero.matriculaId)).toBe(0);
      expect(await leerAsistencias(esc.e.A.id)).toHaveLength(1);
    });
  });

  describe('la respuesta no lleva datos de más (criterio 15)', () => {
    it('criterio 15: ni el 201 ni el cuerpo completo llevan el DNI, el token, el contenido del QR, la fecha de nacimiento, datos médicos, apoderado ni la clave de la foto', async () => {
      const menor = await crearAlumnoDeAsistencia(ctx, esc, { conApoderado: true });
      const fotoClave = `academias/${esc.e.A.id}/alumnos/${menor.alumnoId}/foto-no-existe.jpg`;
      await cambiarAlumno(esc.e.A.id, menor.alumnoId, { foto_clave: fotoClave });
      const cookies = en(ctx, esc, HORA);

      for (const via of ['QR', 'MANUAL'] as const) {
        // La primera vía registra; la segunda es un rechazo (YA_REGISTRADA) que también lleva al alumno.
        const respuesta = await marcar(ctx, via, cookies.secretaria, menor);
        const texto = respuesta.texto;

        for (const prohibido of [
          menor.dni,
          menor.token,
          menor.contenido,
          'AQ1:',
          fotoClave,
          '"foto_clave"',
          '"fotoClave"',
          '2014-03-10',
          '"fechaNacimiento"',
          '"fecha_nacimiento"',
          '"apoderado"',
          '"ficha',
          '"enfermedades"',
          '"alergias"',
          '"telefono"',
          '"correo"',
          '"dni"',
          '"qrToken"',
          '"token"',
        ]) {
          expect(texto, `la respuesta ${via} (HTTP ${respuesta.status}) no lleva «${prohibido}»`).not.toContain(
            prohibido,
          );
        }
      }
    });
  });
});
