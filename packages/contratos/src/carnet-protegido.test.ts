// spec: 008-carnet-qr (pruebas protegidas)
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Contratos públicos de la 008a (spec 008-carnet-qr, «Definiciones», «Contrato» y criterios 3, 7, 12, 13, 15 y 16): `packages/contratos/src/carnet.ts` exporta `PREFIJO_QR` (`'AQ1:'`), `PATRON_TOKEN_QR`
// (`/^[A-Za-z0-9_-]{43}$/`), `contenidoQr(token)`, `tokenDelContenidoQr(texto)` (el token o `null` si el texto no tiene exactamente la forma `AQ1:` + 43 caracteres de base64url), `OPCIONES_QR`
// (`{ errorCorrectionLevel: 'M', margin: 4 }`), `carnetSchema` (estricto), `regenerarQrSchema` (`{ claveIdempotencia, motivo }`, estricto, motivo de 3 a 200 caracteres visibles),
// `buscarAlumnosSchema` (`{ texto }`, estricto, recortado, de 3 a 60 caracteres visibles) y `resultadoBusquedaAlumnosSchema` (`{ alumnos, hayMas }`, estrictos). El índice del paquete los reexporta.
// Se cargan con importación dinámica: antes de implementarlos la prueba falla con un mensaje claro y no con un error de tipos.
// Lectura estricta elegida para lo que la spec no dice con todas las letras: `carnetSchema` rechaza un `qr.contenido` que no tiene la forma de `contenidoQr`, un `generadoEn` que no es una fecha, un `estado` `CLIENTE`
// (RN-05: un cliente no tiene carnet) y cualquier clave de más en cualquier nivel.

interface Resultado {
  success: boolean;
  data?: unknown;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}
interface Esquema {
  safeParse(valor: unknown): Resultado;
}

async function cargar(archivo: string, exportaciones: readonly string[]): Promise<Record<string, unknown>> {
  const ruta = fileURLToPath(new URL(`./${archivo}`, import.meta.url));
  let modulo: Record<string, unknown>;
  try {
    modulo = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as Record<string, unknown>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 008a: no se pudo cargar "packages/contratos/src/${archivo}" (${motivo}).`,
      { cause: error },
    );
  }
  for (const nombre of exportaciones) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 008a: "packages/contratos/src/${archivo}" no exporta ${nombre}.`);
    }
  }
  return modulo;
}

const esquema = async (nombre: string): Promise<Esquema> => (await cargar('carnet.ts', [nombre]))[nombre] as Esquema;
const contenido = async (): Promise<(token: string) => string> =>
  (await cargar('carnet.ts', ['contenidoQr']))['contenidoQr'] as (token: string) => string;
const tokenDe = async (): Promise<(texto: string) => string | null> =>
  (await cargar('carnet.ts', ['tokenDelContenidoQr']))['tokenDelContenidoQr'] as (texto: string) => string | null;

const camposConError = (resultado: Resultado): string[] =>
  (resultado.error?.issues ?? []).map((problema) => problema.path.map(String).join('.'));

/** Un token como lo genera la API: 32 bytes al azar en base64url sin relleno (43 caracteres). */
const tokenNuevo = (): string => randomBytes(32).toString('base64url');

describe('exportaciones de la 008a', () => {
  it('008a: carnet.ts exporta el prefijo, el patrón, las dos funciones del contenido, las opciones del QR y los esquemas', async () => {
    const modulo = await cargar('carnet.ts', [
      'PREFIJO_QR',
      'PATRON_TOKEN_QR',
      'contenidoQr',
      'tokenDelContenidoQr',
      'OPCIONES_QR',
      'carnetSchema',
      'regenerarQrSchema',
      'buscarAlumnosSchema',
      'resultadoBusquedaAlumnosSchema',
    ]);

    expect(modulo['PREFIJO_QR']).toBe('AQ1:');
    expect(modulo['OPCIONES_QR']).toEqual({ errorCorrectionLevel: 'M', margin: 4 });
  });

  it('008a: el índice del paquete reexporta lo mismo (la API, la web y la asistencia importan de @aquagestion/contratos)', async () => {
    await cargar('index.ts', [
      'PREFIJO_QR',
      'PATRON_TOKEN_QR',
      'contenidoQr',
      'tokenDelContenidoQr',
      'OPCIONES_QR',
      'carnetSchema',
      'regenerarQrSchema',
      'buscarAlumnosSchema',
      'resultadoBusquedaAlumnosSchema',
    ]);
  });
});

describe('PATRON_TOKEN_QR y el contenido del QR (criterio 3)', () => {
  it('criterio 3: el patrón acepta 43 caracteres de base64url sin relleno y nada más', async () => {
    const patron = (await cargar('carnet.ts', ['PATRON_TOKEN_QR']))['PATRON_TOKEN_QR'] as RegExp;

    expect(patron.test(tokenNuevo())).toBe(true);
    expect(patron.test('A'.repeat(43))).toBe(true);
    expect(patron.test('-_'.repeat(21) + 'a')).toBe(true);
    for (const malo of [
      '',
      'A'.repeat(42),
      'A'.repeat(44),
      `${'A'.repeat(42)}+`,
      `${'A'.repeat(42)}/`,
      `${'A'.repeat(42)}=`,
      `${'A'.repeat(42)} `,
      `${'A'.repeat(42)}\n`,
      `${'A'.repeat(42)}á`,
    ]) {
      expect(patron.test(malo), JSON.stringify(malo)).toBe(false);
    }
  });

  it('criterio 3: contenidoQr agrega el prefijo AQ1: al token (47 caracteres)', async () => {
    const hacerContenido = await contenido();
    const token = tokenNuevo();

    const texto = hacerContenido(token);

    expect(texto).toBe(`AQ1:${token}`);
    expect(texto).toHaveLength(47);
  });

  it('criterio 3: tokenDelContenidoQr y contenidoQr son inversas para mil tokens al azar', async () => {
    const hacerContenido = await contenido();
    const leer = await tokenDe();

    for (let i = 0; i < 1000; i += 1) {
      const token = tokenNuevo();
      expect(leer(hacerContenido(token))).toBe(token);
    }
    // Los extremos del alfabeto.
    for (const token of ['A'.repeat(43), '_'.repeat(43), '-'.repeat(43), '0'.repeat(43), 'z'.repeat(43)]) {
      expect(leer(hacerContenido(token)), token).toBe(token);
    }
  });

  it('criterio 3: tokenDelContenidoQr devuelve null con un texto vacío, sin el prefijo, con aq1: en minúsculas, con espacios o saltos antes o después y con otro prefijo', async () => {
    const leer = await tokenDe();
    const token = tokenNuevo();

    const casos: [string, string][] = [
      ['vacío', ''],
      ['solo el prefijo', 'AQ1:'],
      ['sin el prefijo (el token solo)', token],
      ['prefijo en minúsculas', `aq1:${token}`],
      ['prefijo mixto', `Aq1:${token}`],
      ['espacio antes', ` AQ1:${token}`],
      ['espacio después', `AQ1:${token} `],
      ['salto de línea después', `AQ1:${token}\n`],
      ['tabulador antes', `\tAQ1:${token}`],
      ['espacio entre el prefijo y el token', `AQ1: ${token}`],
      ['otra versión del prefijo', `AQ2:${token}`],
      ['el prefijo dos veces', `AQ1:AQ1:${token}`],
      ['dos puntos de más', `AQ1::${token}`],
      ['dos tokens', `AQ1:${token}${token}`],
      ['una dirección web', `https://ejemplo.pe/carnet?t=${token}`],
    ];
    for (const [nombre, texto] of casos) expect(leer(texto), nombre).toBeNull();
  });

  it('criterio 3: tokenDelContenidoQr devuelve null con un token de 42 o 44 caracteres o con un carácter fuera de base64url', async () => {
    const leer = await tokenDe();
    const base = tokenNuevo();

    expect(leer(`AQ1:${base.slice(0, 42)}`), '42 caracteres').toBeNull();
    expect(leer(`AQ1:${base}A`), '44 caracteres').toBeNull();
    for (const caracter of ['+', '/', '=', ' ', '.', 'á', 'ñ', '\u0000', '\n', '%', '?', '#', '😀']) {
      expect(leer(`AQ1:${base.slice(0, 42)}${caracter}`), JSON.stringify(caracter)).toBeNull();
      expect(leer(`AQ1:${caracter}${base.slice(1, 43)}`), JSON.stringify(caracter)).toBeNull();
    }
  });
});

describe('carnetSchema (criterios 7 y 12)', () => {
  const token = tokenNuevo();
  const valido = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
    academia: { nombre: 'Academia A' },
    alumno: {
      id: randomUUID(),
      nombres: 'Valeria',
      apellidos: 'Mendoza Salas',
      dni: '47811902',
      nivel: 'BASICO',
      estado: 'ALUMNO_ACTIVO',
    },
    foto: null,
    matricula: {
      plan: 'Plan 3 por semana',
      clases: [{ diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
      desde: '2026-11-01',
      hasta: '2026-11-30',
      vigenteHoy: true,
    },
    qr: { contenido: `AQ1:${token}`, generadoEn: '2026-11-11T15:00:00.000Z' },
    ...cambios,
  });
  const con = (ruta: 'academia' | 'alumno' | 'matricula' | 'qr', cambios: Record<string, unknown>) => ({
    ...(valido()[ruta] as Record<string, unknown>),
    ...cambios,
  });

  it('criterio 7: acepta un carnet completo, sin foto y sin QR, sin matrícula y con la foto en data:image/jpeg;base64', async () => {
    const carnet = await esquema('carnetSchema');

    expect(carnet.safeParse(valido()).success).toBe(true);
    expect(carnet.safeParse(valido({ qr: null })).success, 'alumno sin QR (criterio 10)').toBe(true);
    expect(carnet.safeParse(valido({ matricula: null })).success, 'sin matrícula del carnet').toBe(true);
    expect(carnet.safeParse(valido({ foto: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' })).success).toBe(true);
    expect(carnet.safeParse(valido({ matricula: { ...(valido()['matricula'] as object), clases: [] } })).success).toBe(
      true,
    );
  });

  it.each(['ALUMNO_ACTIVO', 'ALUMNO_VENCIDO', 'INACTIVO'])('criterio 7: acepta el estado %s', async (estado) => {
    const carnet = await esquema('carnetSchema');

    expect(carnet.safeParse(valido({ alumno: con('alumno', { estado }) })).success).toBe(true);
  });

  it('criterio 7 y RN-05: rechaza el estado CLIENTE y un nivel que no existe', async () => {
    const carnet = await esquema('carnetSchema');

    expect(carnet.safeParse(valido({ alumno: con('alumno', { estado: 'CLIENTE' }) })).success).toBe(false);
    expect(carnet.safeParse(valido({ alumno: con('alumno', { estado: 'OTRO' }) })).success).toBe(false);
    expect(carnet.safeParse(valido({ alumno: con('alumno', { nivel: 'EXPERTO' }) })).success).toBe(false);
  });

  it.each([
    ['en la raíz', (v: Record<string, unknown>) => ({ ...v, fechaNacimiento: '2000-01-01' })],
    ['en la raíz: el token', (v: Record<string, unknown>) => ({ ...v, qrToken: token })],
    ['en la raíz: la clave de la foto', (v: Record<string, unknown>) => ({ ...v, fotoClave: 'academias/x/foto.jpg' })],
    ['en la academia', (v: Record<string, unknown>) => ({ ...v, academia: { nombre: 'A', id: randomUUID() } })],
    [
      'en el alumno: el teléfono',
      (v: Record<string, unknown>) => ({ ...v, alumno: { ...(v['alumno'] as object), telefono: '987654321' } }),
    ],
    [
      'en el alumno: el usuario',
      (v: Record<string, unknown>) => ({ ...v, alumno: { ...(v['alumno'] as object), usuarioId: randomUUID() } }),
    ],
    [
      'en el alumno: la fecha de nacimiento',
      (v: Record<string, unknown>) => ({ ...v, alumno: { ...(v['alumno'] as object), fechaNacimiento: '2014-03-10' } }),
    ],
    [
      'en la matrícula: los pagos',
      (v: Record<string, unknown>) => ({ ...v, matricula: { ...(v['matricula'] as object), monto: '42.00' } }),
    ],
    [
      'en una clase',
      (v: Record<string, unknown>) => ({
        ...v,
        matricula: {
          ...(v['matricula'] as object),
          clases: [{ diaSemana: 1, horaInicio: '18:00', horaFin: '19:00', entrenador: 'Mario' }],
        },
      }),
    ],
    [
      'en el qr: la clave de idempotencia',
      (v: Record<string, unknown>) => ({ ...v, qr: { ...(v['qr'] as object), claveIdempotencia: randomUUID() } }),
    ],
  ])('criterio 7: es estricto: rechaza una clave de más %s', async (_nombre, armar) => {
    const carnet = await esquema('carnetSchema');

    expect(carnet.safeParse(armar(valido())).success).toBe(false);
  });

  it('criterio 7: rechaza si falta una clave (ninguna es opcional: foto, matricula y qr van como null)', async () => {
    const carnet = await esquema('carnetSchema');

    for (const clave of ['academia', 'alumno', 'foto', 'matricula', 'qr']) {
      const sin = valido();
      delete sin[clave];
      expect(carnet.safeParse(sin).success, `sin ${clave}`).toBe(false);
    }
    for (const clave of ['id', 'nombres', 'apellidos', 'dni', 'nivel', 'estado']) {
      const alumno = con('alumno', {});
      delete alumno[clave];
      expect(carnet.safeParse(valido({ alumno })).success, `alumno sin ${clave}`).toBe(false);
    }
    for (const clave of ['plan', 'clases', 'desde', 'hasta', 'vigenteHoy']) {
      const matricula = con('matricula', {});
      delete matricula[clave];
      expect(carnet.safeParse(valido({ matricula })).success, `matrícula sin ${clave}`).toBe(false);
    }
  });

  it('criterio 8: la matrícula pide el día de la semana de 1 a 7, horas HH:MM y fechas AAAA-MM-DD', async () => {
    const carnet = await esquema('carnetSchema');
    const clase = { diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' };
    const conClase = (cambios: Record<string, unknown>) =>
      valido({ matricula: con('matricula', { clases: [{ ...clase, ...cambios }] }) });

    for (const dia of [1, 4, 7])
      expect(carnet.safeParse(conClase({ diaSemana: dia })).success, `día ${dia}`).toBe(true);
    for (const dia of [0, 8, -1, 1.5, '1']) {
      expect(carnet.safeParse(conClase({ diaSemana: dia })).success, `día ${String(dia)}`).toBe(false);
    }
    for (const hora of ['6:00', '18:0', '25:00', '18:60', '18h', '']) {
      expect(carnet.safeParse(conClase({ horaInicio: hora })).success, `horaInicio ${hora}`).toBe(false);
      expect(carnet.safeParse(conClase({ horaFin: hora })).success, `horaFin ${hora}`).toBe(false);
    }
    for (const fecha of ['01/11/2026', '2026-1-1', '2026-13-01', '2026-02-30', 'hoy', '']) {
      expect(
        carnet.safeParse(valido({ matricula: con('matricula', { desde: fecha }) })).success,
        `desde ${fecha}`,
      ).toBe(false);
      expect(
        carnet.safeParse(valido({ matricula: con('matricula', { hasta: fecha }) })).success,
        `hasta ${fecha}`,
      ).toBe(false);
    }
    expect(carnet.safeParse(valido({ matricula: con('matricula', { vigenteHoy: 'si' }) })).success).toBe(false);
  });

  it('criterio 12: el QR del carnet lleva el contenido con la forma de contenidoQr y la fecha en ISO; rechaza el token solo, otro prefijo o una fecha que no lo es', async () => {
    const carnet = await esquema('carnetSchema');
    const sinPrefijo = { contenido: token, generadoEn: '2026-11-11T15:00:00.000Z' };

    expect(carnet.safeParse(valido({ qr: sinPrefijo })).success, 'el token sin el prefijo').toBe(false);
    expect(carnet.safeParse(valido({ qr: con('qr', { contenido: `aq1:${token}` }) })).success).toBe(false);
    expect(carnet.safeParse(valido({ qr: con('qr', { contenido: `AQ1:${token.slice(1)}` }) })).success).toBe(false);
    expect(carnet.safeParse(valido({ qr: con('qr', { contenido: '' }) })).success).toBe(false);
    expect(carnet.safeParse(valido({ qr: con('qr', { generadoEn: 'ayer' }) })).success).toBe(false);
    expect(carnet.safeParse(valido({ qr: con('qr', { generadoEn: '' }) })).success).toBe(false);
    expect(carnet.safeParse(valido({ qr: { contenido: `AQ1:${token}` } })).success, 'sin generadoEn').toBe(false);
    expect(carnet.safeParse(valido({ qr: { generadoEn: '2026-11-11T15:00:00.000Z' } })).success).toBe(false);
  });

  it('criterio 7: el id del alumno es un UUID y los textos básicos no son vacíos', async () => {
    const carnet = await esquema('carnetSchema');

    expect(carnet.safeParse(valido({ alumno: con('alumno', { id: 'no-es-uuid' }) })).success).toBe(false);
    expect(carnet.safeParse(valido({ alumno: con('alumno', { nombres: '' }) })).success).toBe(false);
    expect(carnet.safeParse(valido({ alumno: con('alumno', { dni: 12345678 }) })).success).toBe(false);
    expect(carnet.safeParse(valido({ academia: { nombre: '' } })).success).toBe(false);
  });
});

describe('regenerarQrSchema (criterios 13 y 15)', () => {
  const valido = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
    claveIdempotencia: randomUUID(),
    motivo: 'El alumno perdió el carnet',
    ...cambios,
  });

  it('criterio 13: acepta una clave UUID y un motivo de 3 a 200 caracteres visibles', async () => {
    const regenerar = await esquema('regenerarQrSchema');

    expect(regenerar.safeParse(valido()).success).toBe(true);
    expect(regenerar.safeParse(valido({ motivo: 'abc' })).success).toBe(true);
    expect(regenerar.safeParse(valido({ motivo: 'a'.repeat(200) })).success).toBe(true);
    expect(regenerar.safeParse(valido({ motivo: 'Se robó el celular del niño: ñandú' })).success).toBe(true);
  });

  it('criterio 15: rechaza un motivo de menos de 3 o más de 200 caracteres, vacío, de puros espacios o invisible, o con controles', async () => {
    const regenerar = await esquema('regenerarQrSchema');

    for (const motivo of ['ab', 'a'.repeat(201), '', '   ', '  ab  ', '​​​​', '⠀⠀⠀', 'ab\u0000c', 'ab\nc', 'a‮b c']) {
      expect(regenerar.safeParse(valido({ motivo })).success, JSON.stringify(motivo)).toBe(false);
    }
    for (const motivo of [3, null, undefined, ['abc'], { a: 'abc' }]) {
      expect(regenerar.safeParse(valido({ motivo })).success, JSON.stringify(motivo)).toBe(false);
    }
  });

  it('criterio 13: recorta el motivo (el valor que llega a la auditoría no tiene espacios en los bordes)', async () => {
    const regenerar = await esquema('regenerarQrSchema');

    const resultado = regenerar.safeParse(valido({ motivo: '   Se perdió el carnet   ' }));

    expect(resultado.success).toBe(true);
    expect((resultado.data as { motivo: string }).motivo).toBe('Se perdió el carnet');
  });

  it('criterio 15: rechaza una clave que no es UUID, que falta o que no es texto', async () => {
    const regenerar = await esquema('regenerarQrSchema');

    for (const clave of ['no-es-uuid', '', '1234', `${randomUUID()}x`, randomUUID().replaceAll('-', ''), 5, null]) {
      expect(regenerar.safeParse(valido({ claveIdempotencia: clave })).success, JSON.stringify(clave)).toBe(false);
    }
    const sinClave = valido();
    delete sinClave['claveIdempotencia'];
    expect(regenerar.safeParse(sinClave).success).toBe(false);
    const sinMotivo = valido();
    delete sinMotivo['motivo'];
    expect(regenerar.safeParse(sinMotivo).success).toBe(false);
  });

  it('criterio 15: es estricto: un campo de más (academiaId, alumnoId, qrToken) lo rechaza y no se ignora', async () => {
    const regenerar = await esquema('regenerarQrSchema');

    for (const extra of [
      { academiaId: randomUUID() },
      { alumnoId: randomUUID() },
      { qrToken: tokenNuevo() },
      { token: tokenNuevo() },
      { cualquiera: 1 },
    ]) {
      const resultado = regenerar.safeParse(valido(extra));
      expect(resultado.success, JSON.stringify(extra)).toBe(false);
    }
  });
});

describe('buscarAlumnosSchema (criterio 16)', () => {
  it('criterio 16: acepta un texto de 3 a 60 caracteres visibles y lo recorta', async () => {
    const buscar = await esquema('buscarAlumnosSchema');

    expect(buscar.safeParse({ texto: 'abc' }).success).toBe(true);
    expect(buscar.safeParse({ texto: '47811902' }).success).toBe(true);
    expect(buscar.safeParse({ texto: 'a'.repeat(60) }).success).toBe(true);
    const recortado = buscar.safeParse({ texto: '   Mendoza Salas   ' });
    expect(recortado.success).toBe(true);
    expect((recortado.data as { texto: string }).texto).toBe('Mendoza Salas');
  });

  it('criterio 16: rechaza menos de 3, más de 60, vacío, de puros espacios, con controles o que falta', async () => {
    const buscar = await esquema('buscarAlumnosSchema');

    for (const texto of ['', 'ab', '  ab  ', '   ', 'a'.repeat(61), 'ab\u0000c', 'ab\nc', '​​​']) {
      expect(buscar.safeParse({ texto }).success, JSON.stringify(texto)).toBe(false);
    }
    for (const texto of [12345678, null, undefined, ['abc']]) {
      expect(buscar.safeParse({ texto }).success, JSON.stringify(texto)).toBe(false);
    }
    expect(buscar.safeParse({}).success).toBe(false);
  });

  it('criterio 16: es estricto: un campo de más (academiaId, dni, limite) lo rechaza', async () => {
    const buscar = await esquema('buscarAlumnosSchema');

    for (const extra of [{ academiaId: randomUUID() }, { dni: '47811902' }, { limite: 500 }, { pagina: 2 }]) {
      expect(buscar.safeParse({ texto: 'Mendoza', ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('criterio 16: los caracteres % _ y \\ son texto válido (la búsqueda los trata como literales)', async () => {
    const buscar = await esquema('buscarAlumnosSchema');

    for (const texto of ['%%%', '___', 'a\\b', "o'brien", '100%']) {
      expect(buscar.safeParse({ texto }).success, texto).toBe(true);
    }
  });
});

describe('resultadoBusquedaAlumnosSchema (criterio 16)', () => {
  const alumno = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: randomUUID(),
    nombres: 'Valeria',
    apellidos: 'Mendoza Salas',
    dni: '47811902',
    estado: 'ALUMNO_ACTIVO',
    nivel: 'BASICO',
    tieneFoto: false,
    ...cambios,
  });

  it('criterio 16: acepta una lista (también vacía) con hayMas', async () => {
    const resultado = await esquema('resultadoBusquedaAlumnosSchema');

    expect(resultado.safeParse({ alumnos: [], hayMas: false }).success).toBe(true);
    expect(resultado.safeParse({ alumnos: [alumno(), alumno({ tieneFoto: true })], hayMas: true }).success).toBe(true);
  });

  it('criterio 16: es estricto en la respuesta y en cada alumno (nada de teléfono, correo, foto ni token) y no deja a un CLIENTE', async () => {
    const resultado = await esquema('resultadoBusquedaAlumnosSchema');

    expect(resultado.safeParse({ alumnos: [], hayMas: false, total: 0 }).success).toBe(false);
    expect(resultado.safeParse({ alumnos: [] }).success).toBe(false);
    expect(resultado.safeParse({ hayMas: false }).success).toBe(false);
    for (const extra of [
      { telefono: '987654321' },
      { correo: 'a@b.pe' },
      { foto: 'data:image/jpeg;base64,AA==' },
      { fotoClave: 'academias/x/foto.jpg' },
      { qrToken: tokenNuevo() },
      { usuarioId: randomUUID() },
    ]) {
      expect(resultado.safeParse({ alumnos: [alumno(extra)], hayMas: false }).success, JSON.stringify(extra)).toBe(
        false,
      );
    }
    expect(resultado.safeParse({ alumnos: [alumno({ estado: 'CLIENTE' })], hayMas: false }).success).toBe(false);
    expect(resultado.safeParse({ alumnos: [alumno({ tieneFoto: 'si' })], hayMas: false }).success).toBe(false);
    expect(resultado.safeParse({ alumnos: [alumno({ id: 'no-es-uuid' })], hayMas: false }).success).toBe(false);
    const sinFoto = alumno();
    delete sinFoto['tieneFoto'];
    expect(resultado.safeParse({ alumnos: [sinFoto], hayMas: false }).success).toBe(false);
  });

  it('criterio 16: el error de un alumno de la lista señala su posición', async () => {
    const resultado = await esquema('resultadoBusquedaAlumnosSchema');

    const mala = resultado.safeParse({ alumnos: [alumno(), alumno({ dni: 5 })], hayMas: false });

    expect(mala.success).toBe(false);
    expect(camposConError(mala).some((campo) => campo.startsWith('alumnos.1'))).toBe(true);
  });
});
