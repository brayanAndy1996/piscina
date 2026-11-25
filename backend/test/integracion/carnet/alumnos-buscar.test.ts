// spec: 008-carnet-qr (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertarAuditoria } from '../../utilidades/datos';
import {
  type AppCarnet,
  codigoDeRespuesta,
  crearAppCarnet,
  cuerpoBuscar,
  type EscenarioDelCarnet,
  instantaneaDelCarnet,
  prepararEscenarioDelCarnet,
  RUTA_BUSCAR,
} from '../../utilidades/escenario-carnet';
import { conRetencion, crearAlumnoSolo, type Libre } from '../../utilidades/inscripciones';

// Criterio 16 (crítico, sección 2.1 y 8.7, D-23, regla «Un DNI se busca con `POST`» de 002): `POST /api/alumnos/buscar`, con `@Permiso('VER_CARNET')` y alcance `TODO` (`ALUMNO`, 403), y cuerpo `buscarAlumnosSchema` (`{ texto }`, estricto, recortado, de 3 a 60
// caracteres visibles). Si `texto` son exactamente 8 dígitos, busca ese DNI exacto; si no, busca `texto` dentro de «nombres apellidos» y de «apellidos nombres», sin distinguir mayúsculas (sí las tildes, DT-8), con `%`, `_` y `\` como caracteres literales. Solo
// alumnos (no `CLIENTE`) de la academia de la sesión. Responde 200 con `{ alumnos, hayMas }`: como mucho 20, ordenados por apellidos, nombres e id, cada uno con `id`, `nombres`, `apellidos`, `dni`, `estado`, `nivel` y `tieneFoto` (estricto, nada más); `hayMas`
// es `true` si había más de 20. No escribe ni audita, y el texto buscado no va al registro técnico (en `qr-token-fuera-de-sitio.test.ts`). Prueba: el mismo nombre y el mismo DNI en la academia B no aparecen desde A; un `CLIENTE` con ese DNI no aparece; `%` no devuelve a todos.
// (Los permisos de la ruta, en `carnet-permisos.test.ts`.) Los alumnos de esta prueba se escriben como dueño: lo que se prueba es la consulta.

interface AlumnoEncontrado {
  id: string;
  nombres: string;
  apellidos: string;
  dni: string;
  estado: string;
  nivel: string;
  tieneFoto: boolean;
}

describe('buscar alumnos (criterio 16)', () => {
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

  const buscar = (texto: unknown, cookie = esc.cookies.secretaria, extra: Record<string, unknown> = {}) =>
    ctx.http.post(RUTA_BUSCAR, { texto, ...extra }, { cookie });
  const alumno = (academiaId: string, columnas: Libre) =>
    crearAlumnoSolo(academiaId, { estado: 'ALUMNO_ACTIVO', ...columnas });
  const resultado = async (texto: unknown, cookie = esc.cookies.secretaria) => {
    const respuesta = await buscar(texto, cookie);
    expect(respuesta.status, `${String(texto)}: ${respuesta.texto.slice(0, 300)}`).toBe(200);
    return respuesta.body as unknown as { alumnos: AlumnoEncontrado[]; hayMas: boolean };
  };
  const nombresDe = (alumnos: AlumnoEncontrado[]) => alumnos.map((a) => `${a.nombres} ${a.apellidos}`);

  /** Una academia con alumnos de nombres parecidos y de los casos raros de la búsqueda. */
  async function sembrarAlumnos() {
    const ids = {
      valeria: await alumno(esc.e.A.id, { dni: '47811902', nombres: 'Valeria', apellidos: 'Mendoza Salas' }),
      nunez: await alumno(esc.e.A.id, {
        dni: '45000111',
        nombres: 'Luis',
        apellidos: 'Núñez Paredes',
        estado: 'ALUMNO_VENCIDO',
      }),
      olga: await alumno(esc.e.A.id, { dni: '45000222', nombres: 'Olga', apellidos: 'Mora' }),
      subrayado: await alumno(esc.e.A.id, { dni: '45000333', nombres: 'Ana_Maria', apellidos: 'Rojas' }),
      porcentaje: await alumno(esc.e.A.id, {
        dni: '45000444',
        nombres: 'Mario%Ana',
        apellidos: 'Díaz',
        estado: 'INACTIVO',
      }),
      barra: await alumno(esc.e.A.id, {
        dni: '45000555',
        nombres: 'Juan\\Pedro',
        apellidos: 'Soto',
        nivel: 'AVANZADO',
      }),
      cliente: await alumno(esc.e.A.id, {
        dni: '45000666',
        nombres: 'Valeria',
        apellidos: 'Mendoza Clienta',
        estado: 'CLIENTE',
      }),
      deB: await alumno(esc.e.B.id, { dni: '47811902', nombres: 'Valeria', apellidos: 'Mendoza Salas' }),
      otroDeB: await alumno(esc.e.B.id, { dni: '45000999', nombres: 'Beatriz', apellidos: 'Mendoza Quispe' }),
    };
    return ids;
  }

  describe('por DNI: 8 dígitos exactos', () => {
    it('criterio 16: 8 dígitos buscan ese DNI exacto: responde solo ese alumno de la academia, no el de B con el mismo DNI y el mismo nombre', async () => {
      const ids = await sembrarAlumnos();

      const { alumnos, hayMas } = await resultado('47811902');

      expect(alumnos.map((a) => a.id)).toEqual([ids.valeria]);
      expect(hayMas).toBe(false);
      expect(alumnos[0]).toEqual({
        id: ids.valeria,
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        dni: '47811902',
        estado: 'ALUMNO_ACTIVO',
        nivel: 'BASICO',
        tieneFoto: false,
      });
    });

    it('criterio 16: desde B se ve el de B (el mismo DNI y el mismo nombre) y nunca el de A', async () => {
      const ids = await sembrarAlumnos();

      const { alumnos } = await resultado('47811902', esc.cookies.secretariaB);
      const porNombre = await resultado('mendoza', esc.cookies.secretariaB);

      expect(alumnos.map((a) => a.id)).toEqual([ids.deB]);
      expect(porNombre.alumnos.map((a) => a.id).sort()).toEqual([ids.deB, ids.otroDeB].sort());
    });

    it('criterio 16: un CLIENTE con ese DNI no aparece (ni por DNI ni por nombre)', async () => {
      await sembrarAlumnos();

      expect((await resultado('45000666')).alumnos).toEqual([]);
      expect(nombresDe((await resultado('Mendoza Clienta')).alumnos)).toEqual([]);
    });

    it('criterio 16: un DNI que no existe responde 200 con la lista vacía y hayMas false', async () => {
      await sembrarAlumnos();

      expect(await resultado('00000000')).toEqual({ alumnos: [], hayMas: false });
    });

    it('criterio 16: 7 o 9 dígitos no buscan el DNI: buscan texto en los nombres (un DNI parcial no encuentra a nadie)', async () => {
      await sembrarAlumnos();

      expect((await resultado('4781190')).alumnos).toEqual([]);
      expect((await resultado('478119022')).alumnos).toEqual([]);
      expect((await resultado('1190')).alumnos).toEqual([]);
    });

    it('criterio 16: el texto se recorta: 8 dígitos con espacios alrededor siguen siendo ese DNI', async () => {
      const ids = await sembrarAlumnos();

      expect((await resultado('  47811902  ')).alumnos.map((a) => a.id)).toEqual([ids.valeria]);
    });

    it('criterio 16: encuentra alumnos en cualquier estado que no sea CLIENTE: activos, vencidos e inactivos', async () => {
      const ids = await sembrarAlumnos();

      const vencido = await resultado('45000111');
      const inactivo = await resultado('45000444');

      expect(vencido.alumnos.map((a) => [a.id, a.estado])).toEqual([[ids.nunez, 'ALUMNO_VENCIDO']]);
      expect(inactivo.alumnos.map((a) => [a.id, a.estado])).toEqual([[ids.porcentaje, 'INACTIVO']]);
    });
  });

  describe('por nombre: dentro de «nombres apellidos» y de «apellidos nombres»', () => {
    it('criterio 16: sin distinguir mayúsculas ni minúsculas, y en cualquier parte del nombre', async () => {
      const ids = await sembrarAlumnos();

      for (const texto of [
        'mendoza',
        'MENDOZA',
        'MeNdOzA',
        'ndoz',
        'Valeria Mendoza',
        'VALERIA MENDOZA SALAS',
        'mendoza salas',
      ]) {
        const { alumnos } = await resultado(texto);
        expect(
          alumnos.map((a) => a.id),
          texto,
        ).toEqual([ids.valeria]);
      }
    });

    it('criterio 16: también en «apellidos nombres»: «salas valeria» y «mendoza salas valeria» encuentran a Valeria', async () => {
      const ids = await sembrarAlumnos();

      expect((await resultado('salas valeria')).alumnos.map((a) => a.id)).toEqual([ids.valeria]);
      expect((await resultado('Mendoza Salas Valeria')).alumnos.map((a) => a.id)).toEqual([ids.valeria]);
    });

    it('criterio 16: el texto tiene que estar seguido: «valeria salas» no está en «Valeria Mendoza Salas» ni en «Mendoza Salas Valeria»', async () => {
      await sembrarAlumnos();

      expect((await resultado('valeria salas')).alumnos).toEqual([]);
    });

    it('criterio 16: las tildes sí cuentan (DT-8): «núñez» encuentra a Núñez y «nunez» no', async () => {
      const ids = await sembrarAlumnos();

      expect((await resultado('núñez')).alumnos.map((a) => a.id)).toEqual([ids.nunez]);
      expect((await resultado('nunez')).alumnos).toEqual([]);
    });

    it('criterio 16: encuentra a los alumnos de la academia de la sesión y solo a ellos: «mendoza» desde A da a Valeria, no al CLIENTE ni a los de B', async () => {
      const ids = await sembrarAlumnos();

      const { alumnos, hayMas } = await resultado('mendoza');

      expect(alumnos.map((a) => a.id)).toEqual([ids.valeria]);
      expect(hayMas).toBe(false);
    });
  });

  describe('%, _ y \\ son caracteres literales', () => {
    it('criterio 16: «%%%» y «___» no devuelven a todos: no hay nadie con esas letras', async () => {
      await sembrarAlumnos();

      expect((await resultado('%%%')).alumnos).toEqual([]);
      expect((await resultado('___')).alumnos).toEqual([]);
      expect((await resultado('%%%%')).alumnos).toEqual([]);
    });

    it('criterio 16: «a_m» encuentra solo a «Ana_Maria» (el guion bajo no es un comodín: «Olga Mora» y «Valeria Mendoza» tienen «a m»)', async () => {
      const ids = await sembrarAlumnos();

      expect((await resultado('a_m')).alumnos.map((a) => a.id)).toEqual([ids.subrayado]);
    });

    it('criterio 16: «o%a» encuentra solo a «Mario%Ana» (el porcentaje no es un comodín: «Olga» tiene «o…a»)', async () => {
      const ids = await sembrarAlumnos();

      expect((await resultado('o%a')).alumnos.map((a) => a.id)).toEqual([ids.porcentaje]);
    });

    it('criterio 16: «n\\p» encuentra solo a «Juan\\Pedro» (la barra invertida es una letra más)', async () => {
      const ids = await sembrarAlumnos();

      expect((await resultado('n\\p')).alumnos.map((a) => a.id)).toEqual([ids.barra]);
      expect((await resultado('n\\\\p')).alumnos).toEqual([]);
    });
  });

  describe('la respuesta', () => {
    it('criterio 16: cada alumno trae exactamente id, nombres, apellidos, dni, estado, nivel y tieneFoto (nada más), y tieneFoto sale de la foto guardada', async () => {
      await sembrarAlumnos();
      const conFoto = await alumno(esc.e.A.id, {
        dni: '46000001',
        nombres: 'Fotogenia',
        apellidos: 'Con Foto',
        foto_clave: `academias/${esc.e.A.id}/alumnos/x/foto-y.jpg`,
        nivel: 'INTERMEDIO',
      });

      const respuesta = await buscar('fotogenia');

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      expect(respuesta.cacheControl).toBe('no-store');
      expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['alumnos', 'hayMas']);
      const [encontrado] = (respuesta.body as unknown as { alumnos: AlumnoEncontrado[] }).alumnos;
      expect(Object.keys(encontrado ?? {}).sort()).toEqual([
        'apellidos',
        'dni',
        'estado',
        'id',
        'nivel',
        'nombres',
        'tieneFoto',
      ]);
      expect(encontrado).toEqual({
        id: conFoto,
        nombres: 'Fotogenia',
        apellidos: 'Con Foto',
        dni: '46000001',
        estado: 'ALUMNO_ACTIVO',
        nivel: 'INTERMEDIO',
        tieneFoto: true,
      });
      expect(respuesta.texto, 'ni la clave de la foto ni su ruta').not.toContain('academias/');
      expect(respuesta.texto).not.toContain('foto-y.jpg');
    });

    it('criterio 16: no trae teléfono, correo, dirección, fecha de nacimiento, token ni nada de la ficha', async () => {
      await sembrarAlumnos();

      const respuesta = await buscar('valeria');

      expect(respuesta.texto).not.toContain('987654321');
      expect(respuesta.texto).not.toContain('2000-01-15');
      expect(respuesta.texto).not.toContain('AQ1:');
      for (const clave of ['telefono', 'correo', 'direccion', 'fechaNacimiento', 'qr', 'token', 'foto"']) {
        expect(respuesta.texto.toLowerCase(), clave).not.toContain(`"${clave}`);
      }
    });

    it('criterio 16: los resultados salen por apellidos, nombres e id, y como mucho 20 con hayMas true si había más', async () => {
      const filas: Libre[] = [];
      for (let i = 1; i <= 20; i += 1) {
        filas.push({ nombres: i % 2 === 0 ? 'Beto' : 'Ana', apellidos: `Zzt${String(i).padStart(2, '0')}` });
      }
      // Dos con el mismo apellido y distinto nombre, y dos con todo igual (los desempata el id): los primeros de la lista.
      filas.push({ nombres: 'Carlos', apellidos: 'Zzt00' }, { nombres: 'Ana', apellidos: 'Zzt00' });
      const ids = new Map<string, Libre>();
      for (const fila of filas.reverse()) ids.set(await alumno(esc.e.A.id, fila), fila);
      const gemelo = await alumno(esc.e.A.id, { nombres: 'Ana', apellidos: 'Zzt00' });
      const todos: [string, Libre][] = [...ids.entries(), [gemelo, { nombres: 'Ana', apellidos: 'Zzt00' }]];
      expect(todos).toHaveLength(23);
      const esperado = todos
        .map(([id, fila]) => ({ id, nombres: fila['nombres'] as string, apellidos: fila['apellidos'] as string }))
        .sort(
          (a, b) =>
            (a.apellidos < b.apellidos ? -1 : a.apellidos > b.apellidos ? 1 : 0) ||
            (a.nombres < b.nombres ? -1 : a.nombres > b.nombres ? 1 : 0) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
        .slice(0, 20);

      const { alumnos, hayMas } = await resultado('zzt');

      expect(alumnos).toHaveLength(20);
      expect(hayMas, 'había 23 coincidencias').toBe(true);
      expect(alumnos.map((a) => a.id)).toEqual(esperado.map((a) => a.id));
    });

    it('criterio 16: con exactamente 20 coincidencias, hayMas es false; con 21, true', async () => {
      for (let i = 1; i <= 20; i += 1)
        await alumno(esc.e.A.id, { nombres: 'Beto', apellidos: `Yyk${String(i).padStart(2, '0')}` });

      const veinte = await resultado('yyk');
      await alumno(esc.e.A.id, { nombres: 'Beto', apellidos: 'Yyk21' });
      const veintiuno = await resultado('yyk');

      expect([veinte.alumnos.length, veinte.hayMas]).toEqual([20, false]);
      expect([veintiuno.alumnos.length, veintiuno.hayMas]).toEqual([20, true]);
    });

    it('criterio 16: una academia con más de 20 coincidencias no muestra las de la otra: B con 25 coincidencias no cambia lo que ve A', async () => {
      await sembrarAlumnos();
      for (let i = 1; i <= 25; i += 1) await alumno(esc.e.B.id, { nombres: 'Valeria', apellidos: `Mendoza ${i}` });

      const deA = await resultado('mendoza');
      const deB = await resultado('mendoza', esc.cookies.secretariaB);

      expect(deA.alumnos).toHaveLength(1);
      expect(deA.hayMas).toBe(false);
      expect(deB.alumnos).toHaveLength(20);
      expect(deB.hayMas).toBe(true);
    });
  });

  describe('el cuerpo', () => {
    it.each([
      ['un texto de 2 caracteres', { texto: 'ab' }],
      ['un texto de 2 caracteres con espacios (se recorta antes de contar)', { texto: '   ab   ' }],
      ['un texto de 61 caracteres', { texto: 'a'.repeat(61) }],
      ['un texto vacío', { texto: '' }],
      ['un texto de puros espacios', { texto: '      ' }],
      ['un texto con un salto de línea', { texto: 'ab\ncd' }],
      ['un texto invisible', { texto: '​​​​' }],
      ['un texto que no es texto', { texto: 47811902 }],
      ['sin texto', {}],
      ['un campo de más (academiaId)', { texto: 'mendoza', academiaId: 'cualquiera' }],
      ['un campo de más (limite)', { texto: 'mendoza', limite: 500 }],
      ['un campo de más (dni)', { texto: 'mendoza', dni: '47811902' }],
    ])('criterio 16: %s responde 400 SOLICITUD_INVALIDA sin escribir', async (_nombre, cuerpo) => {
      await sembrarAlumnos();
      const antes = await instantaneaDelCarnet(esc.e);

      const respuesta = await ctx.http.post(RUTA_BUSCAR, cuerpo, { cookie: esc.cookies.secretaria });

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 300)).toEqual([
        400,
        'SOLICITUD_INVALIDA',
      ]);
      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    });

    it('criterio 16: el texto no viaja en la dirección: un GET con ?texto= o ?dni= no existe (404 o 405), y ?academiaId= en el POST no cambia la academia', async () => {
      const ids = await sembrarAlumnos();

      const porDireccion = await ctx.http.get(`${RUTA_BUSCAR}?texto=mendoza`, { cookie: esc.cookies.secretaria });
      const conAcademia = await ctx.http.post(`${RUTA_BUSCAR}?academiaId=${esc.e.B.id}`, cuerpoBuscar('mendoza'), {
        cookie: esc.cookies.secretaria,
      });

      expect([404, 405]).toContain(porDireccion.status);
      expect(porDireccion.texto).not.toContain('47811902');
      expect(conAcademia.status, conAcademia.texto.slice(0, 300)).toBe(200);
      expect((conAcademia.body as unknown as { alumnos: AlumnoEncontrado[] }).alumnos.map((a) => a.id)).toEqual([
        ids.valeria,
      ]);
    });
  });

  describe('no escribe, no bloquea y no audita', () => {
    it('criterio 16: buscar (con DNI, con nombre, sin resultados) no cambia nada en ninguna academia ni agrega auditoría', async () => {
      await sembrarAlumnos();
      await insertarAuditoria(esc.e.A.id, 'ACCION_PREVIA_A');
      const antes = await instantaneaDelCarnet(esc.e);

      for (const texto of ['47811902', 'mendoza', '%%%', 'nadie por aquí']) await resultado(texto);

      expect(await instantaneaDelCarnet(esc.e)).toBe(antes);
    });

    it('criterio 16 (determinista): con las filas de los alumnos retenidas (FOR UPDATE) por otra transacción, la búsqueda responde 200 sin esperar', async () => {
      await sembrarAlumnos();

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: esc.e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid ORDER BY id FOR UPDATE', [
            esc.e.A.id,
          ]);
        },
        enviar: [() => buscar('mendoza'), () => buscar('47811902')],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'la búsqueda no bloquea ni espera filas').toBe(false);
      for (const respuesta of resultados) expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
    });
  });
});
