// spec: 010-mensualidades (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import { enLima } from '../../utilidades/caja';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  cambiarMatricula,
  crearAlumnoConPagoEnVerificacion,
  desactivarClase,
  en,
  type AlumnoDeAsistencia,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, cambiarAlumno, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  cambiarHorario,
  CLAVES_DE_LA_CLASE_ACTUAL,
  CLAVES_DE_LA_CLASE_DEL_PLAN,
  CLAVES_DE_LA_LECTURA,
  CLAVES_DE_LA_MATRICULA_DE_LA_LECTURA,
  CLAVES_DEL_ALUMNO_DE_LA_LECTURA,
  CLAVES_DEL_PLAN_DE_LA_LECTURA,
  cargarContratoDeLectura,
  clasesConPrioridad,
  codigoDeRespuesta,
  crearAlumnoDeHorario,
  cuposPorClase,
  type EscenarioDeHorario,
  instantaneaDeHorario,
  lecturaDe,
  leerHorario,
  type MatriculaDeLaLectura,
  prepararEscenarioDeLectura,
  resumen,
  rutaLecturaHorario,
} from '../../utilidades/escenario-horario';
import { instantaneaDeLaAcademia } from '../../utilidades/escenario-pagos';
import {
  crearAlumnoVencido,
  DICIEMBRE,
  INSTANTES,
  matriculaDelMes,
  NOVIEMBRE,
  registrarRenovacion,
  renovacionDe,
  sembrarMatriculaDelMes,
  sembrarTitulares,
} from '../../utilidades/escenario-renovacion';
import {
  conRetencion,
  llenarClase,
  type Objeto,
  type RespuestaApi,
  sembrarSolicitud,
  sinUuid,
} from '../../utilidades/inscripciones';
import {
  actualizarFila,
  type ClaseDePrueba,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  type Retenedor,
} from '../../utilidades/planes-clases';
import { cookieDeSesion } from '../../utilidades/superadmins';
import { actualizarUsuario, fijarEstadoDeAcademia } from '../../utilidades/usuarios';

// Criterio 46 (crítico, HU-03, sección 2.1, D-23, Ley 29733; DT-38): `GET /api/alumnos/{id}/horario`, con `@Permiso('MODIFICAR_HORARIO_ALUMNO')`, responde 200 `horarioDelAlumnoSchema` (estricto): `alumno` (`id`, `nivel`) y `matriculas`, las que el criterio 35 deja cambiar (de M o de M+1, `VIGENTE` o en verificación; no una reserva de 24 horas,
// `FINALIZADA` ni `CANCELADA`), ordenadas por mes; si no tiene ninguna, `matriculas: []`. Cada una: `id`, `mes`, `estado` (`VIGENTE` o `EN_VERIFICACION`), `plan` (`id`, `nombre`, `vecesPorSemana`, `diasPermitidos` y `franjasPermitidas`, tal como está hoy), `clases` (las actuales), `clasesTotales`, `clasesUsadas` y `clasesDelPlan`: las clases activas del nivel actual del alumno en los días y franjas
// del plan, ordenadas por día, hora e id. Su `cuposRestantes` es el cupo libre de la clase para ese alumno en el mes de la matrícula, sin contar la matrícula que se cambia (definición «Cupo libre», con las reservas de prioridad si es de M+1; nunca negativo) y `conPrioridad` es `true` solo si la matrícula es de M+1 y la clase está en su matrícula de M `VIGENTE`. Coincide con el criterio 36: con `RELOJ` fijo,
// un cambio válido que agrega una clase que la matrícula no tenía responde `SIN_CUPO` por ella si y solo si su `cuposRestantes` es 0. Una clase actual que ya no cumple el plan o el nivel no aparece en `clasesDelPlan`. Sin DNI, datos médicos ni apoderado. Una transacción de la academia de la sesión, sin bloqueos, sin escribir ni auditar. `ENTRENADOR` y `ALUMNO`, 403 `SIN_PERMISO`; las demás respuestas de acceso del
// criterio 17; un `{id}` que no es UUID, inexistente, de otra academia o de un `CLIENTE`, 404 `NO_ENCONTRADO`; `?academiaId=` no cambia nada; `HEAD`, 404. Con A y B: el alumno de B con la sesión de A responde 404 y la ocupación y las reservas solo cuentan matrículas de A.
// Lecturas estrictas elegidas: (1) «ahora» es el viernes 27/11/2026 a las 10:00 de Lima (dentro de la ventana de renovación, N = 5): M es noviembre y M+1, diciembre; (2) «en verificación» es la matrícula `RESERVADA` sin vencimiento con un pago `PENDIENTE_VERIFICACION` (la renovación por Yape sin aprobar); una reserva de 24 horas es `RESERVADA` con `reserva_vence_en`; (3) el orden de `clasesDelPlan` es día, luego
// hora de inicio, luego id (texto del UUID en minúsculas); (4) las claves del JSON se comparan sin importar el orden; los arreglos del plan, sin importar el orden; las `clases` actuales, por id; (5) el alumno que cambia la matrícula de M+1 es «titular» de c si su matrícula de M `VIGENTE` la incluye, y para él las reservas no restan (definición de «Cupo libre»); los alumnos que `llenarClase` siembra son `CLIENTE`, así que
// ocupan cupo pero no apartan lugar; (6) los titulares de `sembrarTitulares` son `ALUMNO_ACTIVO` con matrícula de noviembre `VIGENTE`; (7) la coherencia con el cambio se prueba con un alumno nuevo por cada clase (el cambio que entra modifica la ocupación de esa clase y de ninguna otra de la lista).

const AFORO = 20;
const VIERNES27 = INSTANTES.viernes27;

/** Un `MatriculaDeLaLectura` del mes dado (falla si no está). */
function delMes(matriculas: readonly MatriculaDeLaLectura[], mes: string): MatriculaDeLaLectura {
  const matricula = matriculas.find((m) => m.mes === mes);
  expect(
    matricula,
    `la lectura debía traer la matrícula de ${mes}; trae ${JSON.stringify(matriculas.map((m) => m.mes))}`,
  ).toBeTruthy();
  return matricula as MatriculaDeLaLectura;
}

/** Todas las claves de todos los objetos de un valor JSON (para comprobar que no viaja DNI, nombres, datos médicos ni apoderado). */
function clavesDe(valor: unknown, acumuladas: Set<string> = new Set()): Set<string> {
  if (Array.isArray(valor)) valor.forEach((elemento) => clavesDe(elemento, acumuladas));
  else if (valor !== null && typeof valor === 'object') {
    for (const [clave, interno] of Object.entries(valor)) {
      acumuladas.add(clave);
      clavesDe(interno, acumuladas);
    }
  }
  return acumuladas;
}

/** El orden que pide el criterio 46: día, hora de inicio e id. */
function enOrdenDeLista(clases: readonly ClaseDePrueba[]): string[] {
  return [...clases]
    .sort(
      (a, b) =>
        a.dia_semana - b.dia_semana ||
        a.hora_inicio.localeCompare(b.hora_inicio) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((clase) => clase.id);
}

describe('el contrato horarioDelAlumnoSchema (criterio 46)', () => {
  const valido = () => ({
    alumno: { id: randomUUID(), nivel: 'BASICO' },
    matriculas: [
      {
        id: randomUUID(),
        mes: '2026-11',
        estado: 'VIGENTE',
        plan: {
          id: randomUUID(),
          nombre: 'Plan 3 por semana',
          vecesPorSemana: 3,
          diasPermitidos: [1, 3, 5],
          franjasPermitidas: ['17:00', '18:00'],
        },
        clases: [{ id: randomUUID(), diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }],
        clasesTotales: 12,
        clasesUsadas: 0,
        clasesDelPlan: [
          {
            id: randomUUID(),
            nivel: 'BASICO',
            diaSemana: 1,
            horaInicio: '18:00',
            horaFin: '19:00',
            cuposRestantes: 20,
            conPrioridad: false,
          },
        ],
      },
    ],
  });
  const conCambio = (cambio: (valor: ReturnType<typeof valido>) => void) => {
    const valor = valido();
    cambio(valor);
    return valor;
  };
  const primera = (valor: ReturnType<typeof valido>) =>
    valor.matriculas[0] as ReturnType<typeof valido>['matriculas'][0];

  it('criterio 46: acepta la forma documentada, con matriculas vacías y con los dos estados', async () => {
    const { horarioDelAlumnoSchema } = await cargarContratoDeLectura();

    expect(horarioDelAlumnoSchema.safeParse(valido()).success).toBe(true);
    expect(horarioDelAlumnoSchema.safeParse({ alumno: valido().alumno, matriculas: [] }).success).toBe(true);
    const enVerificacion = conCambio((v) => {
      primera(v).estado = 'EN_VERIFICACION';
    });
    expect(horarioDelAlumnoSchema.safeParse(enVerificacion).success).toBe(true);
  });

  it.each<[string, (valor: ReturnType<typeof valido>) => void]>([
    ['un campo de más en la raíz', (v) => void Object.assign(v, { dni: '45612378' })],
    ['un campo de más en el alumno (nombres)', (v) => void Object.assign(v.alumno, { nombres: 'Valeria' })],
    ['un campo de más en la matrícula (monto)', (v) => void Object.assign(primera(v), { montoCalculado: '120.00' })],
    ['un campo de más en el plan (precio)', (v) => void Object.assign(primera(v).plan, { precio: '120.00' })],
    [
      'un campo de más en una clase actual',
      (v) => void Object.assign(primera(v).clases[0] ?? {}, { cuposRestantes: 1 }),
    ],
    [
      'un campo de más en una clase del plan',
      (v) => void Object.assign(primera(v).clasesDelPlan[0] ?? {}, { aforo: 20 }),
    ],
    [
      'el estado RESERVADA',
      (v) => {
        primera(v).estado = 'RESERVADA';
      },
    ],
    [
      'el estado FINALIZADA',
      (v) => {
        primera(v).estado = 'FINALIZADA';
      },
    ],
    [
      'un mes con otro formato',
      (v) => {
        primera(v).mes = '2026-13';
      },
    ],
    ['cuposRestantes negativo', (v) => void Object.assign(primera(v).clasesDelPlan[0] ?? {}, { cuposRestantes: -1 })],
    [
      'un nivel que no existe',
      (v) => {
        v.alumno.nivel = 'EXPERTO';
      },
    ],
    ['sin clasesDelPlan', (v) => void delete (primera(v) as Objeto)['clasesDelPlan']],
    [
      'sin conPrioridad en una clase del plan',
      (v) => void delete (primera(v).clasesDelPlan[0] as Objeto)['conPrioridad'],
    ],
    ['sin alumno', (v) => void delete (v as Objeto)['alumno']],
  ])('criterio 46: rechaza %s (estricto)', async (_nombre, cambio) => {
    const { horarioDelAlumnoSchema } = await cargarContratoDeLectura();

    expect(horarioDelAlumnoSchema.safeParse(conCambio(cambio)).success).toBe(false);
  });
});

describe('la lectura del horario para el cambio (criterio 46)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeHorario;
  let cookies: ReturnType<typeof en>;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDeLectura(ctx);
    cookies = en(ctx, esc, VIERNES27);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const A = () => esc.e.A.id;
  const B = () => esc.e.B.id;
  /** `GET` con la sesión de la secretaria; con una cookie explícita (también `undefined`: sin sesión) usa esa. */
  const leer = (
    alumnoId: string,
    ...resto: [] | [cookie: string | undefined] | [cookie: string | undefined, consulta: string]
  ) => leerHorario(ctx, resto.length === 0 ? cookies.secretaria : resto[0], alumnoId, resto[1] ?? '');
  const leerBien = async (alumnoId: string, cookie?: string) =>
    lecturaDe(await leer(alumnoId, cookie ?? cookies.secretaria));

  /** Un alumno de noviembre con una sola clase por semana (el sábado de las 17:00) y el plan de una clase por semana. */
  const alumnoUnDia = (opciones: { claseIds?: readonly string[] } = {}) =>
    crearAlumnoDeHorario(ctx, esc, { plan: esc.planUnDia, claseIds: [esc.sabado17.id], ...opciones });
  /** Le agrega al alumno la matrícula `VIGENTE` de diciembre (plan de una clase por semana, sábado de las 17:00) y devuelve su id. */
  const conDiciembre = async (
    alumno: Pick<AlumnoDeAsistencia, 'alumnoId'>,
    claseIds: readonly string[] = [esc.sabado17.id],
  ) => {
    await sembrarMatriculaDelMes(A(), esc.planUnDia.id, [alumno.alumnoId], claseIds, DICIEMBRE);
    return (await matriculaDelMes(A(), alumno.alumnoId, DICIEMBRE)).id;
  };
  /** Todas las matrículas de un alumno (como dueño), con su mes y estado. */
  const matriculasDe = async (alumnoId: string) => {
    const { rows } = await ejecutarComo(
      'propietario',
      `SELECT id, anio::int AS anio, mes::int AS mes, estado::text AS estado FROM matriculas WHERE academia_id = $1::uuid AND alumno_id = $2::uuid ORDER BY anio, mes, id`,
      [A(), alumnoId],
      { academiaId: A() },
    );
    return rows as { id: string; anio: number; mes: number; estado: string }[];
  };
  /** Siembra otra matrícula (sin solicitud, como las de la renovación) del mes dado y la deja en el estado dado; devuelve su id. */
  const sembrarMes = async (
    alumnoId: string,
    mes: { anio: number; mes: number },
    estado: 'VIGENTE' | 'FINALIZADA' | 'CANCELADA' = 'VIGENTE',
    claseIds: readonly string[] = [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
  ) => {
    const antes = new Set((await matriculasDe(alumnoId)).map((m) => m.id));
    await sembrarMatriculaDelMes(A(), esc.e.plan.id, [alumnoId], claseIds, mes, 'VIGENTE');
    const nueva = (await matriculasDe(alumnoId)).find((m) => !antes.has(m.id));
    expect(nueva, 'la matrícula sembrada debía existir').toBeTruthy();
    const id = (nueva as { id: string }).id;
    if (estado !== 'VIGENTE') await cambiarMatricula(A(), id, { estado });
    return id;
  };
  /** Pasa a `estado` las matrículas `VIGENTE` de noviembre que tiene la clase (como dueño): las cerradas no ocupan cupo. */
  const cerrarVigentes = (claseId: string, estado: 'FINALIZADA' | 'CANCELADA') =>
    ejecutarComo(
      'propietario',
      `UPDATE matriculas SET estado = $3::estado_matricula, reserva_vence_en = NULL
        WHERE academia_id = $1::uuid AND estado = 'VIGENTE' AND anio = 2026 AND mes = 11 AND id IN (
          SELECT matricula_id FROM matricula_clases WHERE academia_id = $1::uuid AND clase_id = $2::uuid)`,
      [A(), claseId, estado],
      { academiaId: A() },
    );
  const todasLasClasesDeA = (): ClaseDePrueba[] => [
    esc.e.lunes,
    esc.e.miercoles,
    esc.e.viernes,
    esc.e.lunes17,
    esc.e.martes,
    esc.e.lunes08,
    esc.e.intermedioLunes,
    esc.lunes19,
    esc.martes08,
    esc.martes10,
    esc.miercoles10,
    esc.miercoles19,
    esc.sabado17,
  ];
  /** Las clases de A de un nivel que caen en los días y franjas dados, en el orden de la lista. */
  const delPlan = (
    dias: readonly number[],
    franjas: readonly string[],
    nivel = 'BASICO',
    clases: readonly ClaseDePrueba[] = todasLasClasesDeA(),
  ) =>
    enOrdenDeLista(
      clases.filter(
        (c) => c.activo && c.nivel === nivel && dias.includes(c.dia_semana) && franjas.includes(c.hora_inicio),
      ),
    );

  describe('la forma de la respuesta', () => {
    it('criterio 46: responde 200 con las claves exactas, que cumplen horarioDelAlumnoSchema, y el alumno solo con id y nivel', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const { horarioDelAlumnoSchema } = await cargarContratoDeLectura();

      const respuesta = await leer(alumno.alumnoId);

      const lectura = lecturaDe(respuesta);
      expect(Object.keys(lectura).sort()).toEqual(CLAVES_DE_LA_LECTURA);
      expect(Object.keys(lectura.alumno).sort()).toEqual(CLAVES_DEL_ALUMNO_DE_LA_LECTURA);
      expect(lectura.alumno).toEqual({ id: alumno.alumnoId, nivel: 'BASICO' });
      expect(lectura.matriculas).toHaveLength(1);
      const [matricula] = lectura.matriculas as [MatriculaDeLaLectura];
      expect(Object.keys(matricula).sort()).toEqual(CLAVES_DE_LA_MATRICULA_DE_LA_LECTURA);
      expect(Object.keys(matricula.plan).sort()).toEqual(CLAVES_DEL_PLAN_DE_LA_LECTURA);
      for (const clase of matricula.clases) expect(Object.keys(clase).sort()).toEqual(CLAVES_DE_LA_CLASE_ACTUAL);
      expect(matricula.clasesDelPlan.length).toBeGreaterThan(0);
      for (const clase of matricula.clasesDelPlan)
        expect(Object.keys(clase).sort()).toEqual(CLAVES_DE_LA_CLASE_DEL_PLAN);
      const validacion = horarioDelAlumnoSchema.safeParse(respuesta.body);
      expect(validacion.success, JSON.stringify(validacion.error)).toBe(true);
    });

    it('criterio 46: los valores de la matrícula de noviembre: id, mes, estado, clases actuales, clasesTotales y clasesUsadas', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc, { clasesTotales: 8, clasesUsadas: 3 });

      const lectura = await leerBien(alumno.alumnoId);

      const [matricula] = lectura.matriculas as [MatriculaDeLaLectura];
      expect(matricula).toMatchObject({
        id: alumno.matriculaId,
        mes: '2026-11',
        estado: 'VIGENTE',
        clasesTotales: 8,
        clasesUsadas: 3,
      });
      expect([...matricula.clases].sort((a, b) => a.diaSemana - b.diaSemana)).toEqual(
        [
          { id: esc.e.lunes.id, diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' },
          { id: esc.e.miercoles.id, diaSemana: 3, horaInicio: '18:00', horaFin: '19:00' },
          { id: esc.e.viernes.id, diaSemana: 5, horaInicio: '18:00', horaFin: '19:00' },
        ].sort((a, b) => a.diaSemana - b.diaSemana),
      );
    });

    it('criterio 46: el plan es el de la matrícula: id, nombre, vecesPorSemana, días y franjas, y nada más (ni precio ni clases por mes)', async () => {
      const alumno = await alumnoUnDia();

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      expect(matricula.plan).toMatchObject({
        id: esc.planUnDia.id,
        nombre: 'Plan de una clase por semana',
        vecesPorSemana: 1,
      });
      expect([...matricula.plan.diasPermitidos].sort()).toEqual([1, 2, 3, 5, 6]);
      expect([...matricula.plan.franjasPermitidas].sort()).toEqual(['10:00', '17:00', '18:00', '19:00']);
    });

    it('criterio 46: el nivel del alumno es el actual (INTERMEDIO si ya subió)', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await cambiarAlumno(A(), alumno.alumnoId, { nivel: 'INTERMEDIO' });

      const lectura = await leerBien(alumno.alumnoId);

      expect(lectura.alumno).toEqual({ id: alumno.alumnoId, nivel: 'INTERMEDIO' });
    });

    it('criterio 46: no viaja el DNI, los nombres, los datos médicos ni el apoderado, ni en las claves ni en el texto', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc, { conApoderado: true });

      const respuesta = await leer(alumno.alumnoId);

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      const claves = [...clavesDe(respuesta.body)].map((clave) => clave.toLowerCase());
      for (const prohibida of [
        'dni',
        'nombres',
        'apellidos',
        'telefono',
        'apoderado',
        'ficha',
        'alergias',
        'seguro',
        'foto',
        'qr',
        'token',
      ]) {
        expect(
          claves.filter((clave) => clave.includes(prohibida)),
          `no debía viajar ninguna clave con «${prohibida}»`,
        ).toEqual([]);
      }
      expect(respuesta.texto).not.toContain(alumno.dni);
    });

    it('criterio 46: dos lecturas seguidas devuelven lo mismo (es una lectura)', async () => {
      const alumno = await alumnoUnDia();
      await conDiciembre(alumno);

      const primera = await leer(alumno.alumnoId);
      const segunda = await leer(alumno.alumnoId);

      expect(primera.status).toBe(200);
      expect(segunda.texto).toBe(primera.texto);
    });
  });

  describe('qué matrículas aparecen', () => {
    it('criterio 46: un alumno sin ninguna matrícula que se pueda cambiar responde 200 con matriculas: [] (y su alumno)', async () => {
      const vencido = await crearAlumnoVencido(ctx, esc);

      const lectura = await leerBien(vencido.alumnoId);

      expect(lectura).toEqual({ alumno: { id: vencido.alumnoId, nivel: 'BASICO' }, matriculas: [] });
    });

    it('criterio 46: las matrículas de M y de M+1 van ordenadas por mes, cada una con su estado', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const diciembre = await sembrarMes(alumno.alumnoId, DICIEMBRE);
      // Se invierte el orden de creación: la de noviembre pasa a ser la más nueva.
      await cambiarMatricula(A(), alumno.matriculaId, { creado_en: new Date('2026-11-26T15:00:00.000Z') });

      const lectura = await leerBien(alumno.alumnoId);

      expect(lectura.matriculas.map((m) => [m.id, m.mes, m.estado])).toEqual([
        [alumno.matriculaId, '2026-11', 'VIGENTE'],
        [diciembre, '2026-12', 'VIGENTE'],
      ]);
    });

    it('criterio 46: la renovación de diciembre por Yape sin aprobar sale con estado EN_VERIFICACION, con su plan y sus clases', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const renovacion = renovacionDe(
        (await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId)).respuesta,
      );
      expect(renovacion.renovacion.estado).toBe('EN_VERIFICACION');

      const lectura = await leerBien(alumno.alumnoId);

      expect(lectura.matriculas.map((m) => [m.id, m.mes, m.estado])).toEqual([
        [alumno.matriculaId, '2026-11', 'VIGENTE'],
        [renovacion.renovacion.matriculaId, '2026-12', 'EN_VERIFICACION'],
      ]);
      const diciembre = delMes(lectura.matriculas, '2026-12');
      expect(diciembre.plan.id).toBe(esc.e.plan.id);
      expect(diciembre.clases.map((c) => c.id).sort()).toEqual(
        [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id].sort(),
      );
    });

    it('criterio 46: la mensualidad de noviembre en verificación (renovación tardía por Yape sin aprobar) también aparece, con estado EN_VERIFICACION', async () => {
      const alumno = await crearAlumnoConPagoEnVerificacion(ctx, esc);

      const lectura = await leerBien(alumno.alumnoId);

      expect(lectura.matriculas.map((m) => [m.id, m.mes, m.estado])).toEqual([
        [alumno.matriculaId, '2026-11', 'EN_VERIFICACION'],
      ]);
    });

    it.each([
      ['FINALIZADA de noviembre', 'finalizada'],
      ['CANCELADA de noviembre', 'cancelada'],
      ['una reserva de 24 horas (RESERVADA con vencimiento) de un alumno que no es CLIENTE', 'reserva'],
      ['VIGENTE de octubre (ni M ni M+1)', 'octubre'],
      ['VIGENTE de enero de 2027 (dos meses adelante: ni M ni M+1)', 'enero'],
    ] as const)('criterio 46: la matrícula %s no aparece: matriculas: []', async (_nombre, cual) => {
      const alumno = await crearAlumnoDeHorario(
        ctx,
        esc,
        cual === 'octubre' ? { mes: { anio: 2026, mes: 10 } } : cual === 'enero' ? { mes: { anio: 2027, mes: 1 } } : {},
      );
      if (cual === 'finalizada' || cual === 'cancelada') {
        await cambiarMatricula(A(), alumno.matriculaId, { estado: cual === 'finalizada' ? 'FINALIZADA' : 'CANCELADA' });
      }
      if (cual === 'reserva') {
        await cambiarMatricula(A(), alumno.matriculaId, {
          estado: 'RESERVADA',
          reserva_vence_en: new Date(VIERNES27.getTime() + 3 * 60 * 60 * 1000),
        });
      }

      const respuesta = await leer(alumno.alumnoId);

      expect(lecturaDe(respuesta).matriculas, respuesta.texto.slice(0, 300)).toEqual([]);
    });

    it('criterio 46: con una de noviembre y varias que no se pueden cambiar (octubre finalizada, diciembre cancelada, enero), solo sale la de noviembre; y con una de diciembre cancelada y otra vigente, la vigente', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await sembrarMes(alumno.alumnoId, { anio: 2026, mes: 10 }, 'FINALIZADA');
      await sembrarMes(alumno.alumnoId, DICIEMBRE, 'CANCELADA');
      await sembrarMes(alumno.alumnoId, { anio: 2027, mes: 1 });
      expect((await leerBien(alumno.alumnoId)).matriculas.map((m) => m.id)).toEqual([alumno.matriculaId]);

      const diciembreVigente = await sembrarMes(alumno.alumnoId, DICIEMBRE);

      expect((await leerBien(alumno.alumnoId)).matriculas.map((m) => m.id)).toEqual([
        alumno.matriculaId,
        diciembreVigente,
      ]);
    });

    it('criterio 46: M se calcula en Lima con «ahora» de RELOJ: a las 23:59:59.999 del 30/11 (ya es 1/12 en UTC) M es noviembre; a las 00:00:00.000 del 1/12 M es diciembre y M+1 enero', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await sembrarMes(alumno.alumnoId, DICIEMBRE);
      await sembrarMes(alumno.alumnoId, { anio: 2027, mes: 1 });

      const ultimo = en(ctx, esc, INSTANTES.ultimoDeLaVentana);
      const delUltimo = lecturaDe(await leer(alumno.alumnoId, ultimo.secretaria));
      const primero = en(ctx, esc, INSTANTES.primeroDeDiciembre);
      const delPrimero = lecturaDe(await leer(alumno.alumnoId, primero.secretaria));

      expect(delUltimo.matriculas.map((m) => m.mes)).toEqual(['2026-11', '2026-12']);
      expect(delPrimero.matriculas.map((m) => m.mes)).toEqual(['2026-12', '2027-01']);
    });

    it('criterio 46: en diciembre, M+1 es enero del año siguiente: aparecen la de diciembre y la de enero de 2027, no la de noviembre', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await sembrarMes(alumno.alumnoId, DICIEMBRE);
      const enero = await sembrarMes(alumno.alumnoId, { anio: 2027, mes: 1 });
      const mediados = en(ctx, esc, enLima('2026-12-15', '10:00'));

      const lectura = lecturaDe(await leer(alumno.alumnoId, mediados.secretaria));

      expect(lectura.matriculas.map((m) => m.mes)).toEqual(['2026-12', '2027-01']);
      expect(lectura.matriculas[1]?.id).toBe(enero);
    });
  });

  describe('clasesDelPlan: lo que se puede elegir', () => {
    it('criterio 46: son las clases activas del nivel del alumno en los días y franjas del plan, ordenadas por día, hora e id, con la forma de la oferta', async () => {
      // Dos clases del lunes a las 18:00 del mismo nivel: el desempate es el id.
      const otroEntrenador = await crearEntrenadorDePrueba(A());
      const lunes18Bis = await crearClaseDePrueba(A(), otroEntrenador.id, {
        nivel: 'BASICO',
        dia_semana: 1,
        hora_inicio: '18:00',
        aforo: 20,
      });
      const alumno = await crearAlumnoDeHorario(ctx, esc);

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      const esperadas = delPlan([1, 3, 5], ['17:00', '18:00', '19:00'], 'BASICO', [...todasLasClasesDeA(), lunes18Bis]);
      expect(esperadas).toHaveLength(7);
      expect(matricula.clasesDelPlan.map((c) => c.id)).toEqual(esperadas);
      const lunes17 = matricula.clasesDelPlan.find((c) => c.id === esc.e.lunes17.id);
      expect(lunes17).toEqual({
        id: esc.e.lunes17.id,
        nivel: 'BASICO',
        diaSemana: 1,
        horaInicio: '17:00',
        horaFin: '18:00',
        cuposRestantes: AFORO,
        conPrioridad: false,
      });
    });

    it('criterio 46: con el plan de una clase por semana (días 1, 2, 3, 5 y 6; franjas de 10:00 a 19:00 sin las de 08:00) salen diez clases, y no las de otro nivel ni las fuera de franja', async () => {
      const alumno = await alumnoUnDia();

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      const esperadas = delPlan([1, 2, 3, 5, 6], ['10:00', '17:00', '18:00', '19:00']);
      expect(esperadas).toHaveLength(10);
      expect(matricula.clasesDelPlan.map((c) => c.id)).toEqual(esperadas);
      expect(matricula.clasesDelPlan.map((c) => c.id)).not.toContain(esc.e.intermedioLunes.id);
      expect(matricula.clasesDelPlan.map((c) => c.id)).not.toContain(esc.e.lunes08.id);
    });

    it('criterio 46: con el nivel actual INTERMEDIO solo salen las clases de ese nivel; las clases actuales (básicas) siguen en `clases` pero no en clasesDelPlan', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await cambiarAlumno(A(), alumno.alumnoId, { nivel: 'INTERMEDIO' });

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      expect(matricula.clasesDelPlan.map((c) => c.id)).toEqual([esc.e.intermedioLunes.id]);
      expect(matricula.clasesDelPlan[0]?.nivel).toBe('INTERMEDIO');
      expect(matricula.clases.map((c) => c.id).sort()).toEqual(
        [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id].sort(),
      );
    });

    it('criterio 46: una clase desactivada no aparece', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await desactivarClase(A(), esc.miercoles19.id);

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      expect(matricula.clasesDelPlan.map((c) => c.id)).not.toContain(esc.miercoles19.id);
      expect(matricula.clasesDelPlan).toHaveLength(5);
    });

    it('criterio 46: el plan se lee tal como está hoy: si cambió el nombre y las franjas, las clases actuales que ya no cumplen siguen en `clases` y no aparecen en clasesDelPlan', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await actualizarFila('propietario', 'planes', A(), esc.e.plan.id, {
        nombre: 'Plan renombrado',
        franjas_permitidas: ['17:00', '19:00'],
      });

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      expect(matricula.plan.nombre).toBe('Plan renombrado');
      expect([...matricula.plan.franjasPermitidas].sort()).toEqual(['17:00', '19:00']);
      expect(matricula.clases.map((c) => c.id).sort()).toEqual(
        [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id].sort(),
      );
      expect(matricula.clasesDelPlan.map((c) => c.id)).toEqual(delPlan([1, 3, 5], ['17:00', '19:00']));
      for (const actual of matricula.clases) {
        expect(
          matricula.clasesDelPlan.map((c) => c.id),
          'la clase de las 18:00 ya no cumple la franja',
        ).not.toContain(actual.id);
      }
    });
  });

  describe('cuposRestantes y conPrioridad en el mes en curso (noviembre)', () => {
    it('criterio 46: sin otras matrículas, cada clase tiene todo su aforo libre (también las de la propia matrícula: no cuenta la que se cambia)', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      expect(matricula.clasesDelPlan.every((c) => c.cuposRestantes === AFORO)).toBe(true);
      expect(matricula.clasesDelPlan.every((c) => !c.conPrioridad)).toBe(true);
    });

    it('criterio 46: aforo menos la ocupación del mes: cuentan VIGENTE, la reserva de 24 horas sin vencer y la que está en verificación; no cuentan la reserva vencida, FINALIZADA, CANCELADA ni otros meses', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const clase = esc.e.lunes17.id;
      const planId = esc.e.plan.id;
      await llenarClase(A(), clase, planId, 4, { mes: NOVIEMBRE });
      await cerrarVigentes(clase, 'FINALIZADA');
      await llenarClase(A(), clase, planId, 2, { mes: NOVIEMBRE });
      await cerrarVigentes(clase, 'CANCELADA');
      await llenarClase(A(), clase, planId, 5, { mes: DICIEMBRE });
      await llenarClase(A(), clase, planId, 3, { mes: { anio: 2026, mes: 10 } });
      await llenarClase(A(), clase, planId, 3, { mes: NOVIEMBRE });
      await llenarClase(A(), clase, planId, 2, {
        mes: NOVIEMBRE,
        estado: 'RESERVADA',
        reservaVenceEn: new Date(VIERNES27.getTime() + 3 * 60 * 60 * 1000),
      });
      await llenarClase(A(), clase, planId, 1, {
        mes: NOVIEMBRE,
        estado: 'RESERVADA',
        reservaVenceEn: new Date(VIERNES27.getTime() - 60 * 60 * 1000),
      });
      await llenarClase(A(), clase, planId, 2, { mes: NOVIEMBRE, estado: 'RESERVADA', reservaVenceEn: null });

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      expect(cuposPorClase(matricula)[clase]).toBe(AFORO - (3 + 2 + 2));
      expect(cuposPorClase(matricula)[esc.lunes19.id], 'una clase sin ocupación sigue entera').toBe(AFORO);
    });

    it('criterio 46: no cuenta la matrícula que se cambia: con 19 matrículas más en su propia clase (20 con la suya), le queda 1', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await llenarClase(A(), esc.e.lunes.id, esc.e.plan.id, AFORO - 1, { mes: NOVIEMBRE });

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      expect(cuposPorClase(matricula)[esc.e.lunes.id]).toBe(1);
    });

    it('criterio 46: nunca es negativo: con la clase pasada de su aforo (25 más la propia), cuposRestantes es 0', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await llenarClase(A(), esc.e.miercoles.id, esc.e.plan.id, AFORO + 5, { mes: NOVIEMBRE });

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      expect(cuposPorClase(matricula)[esc.e.miercoles.id]).toBe(0);
      expect(matricula.clasesDelPlan.every((c) => c.cuposRestantes >= 0)).toBe(true);
    });

    it('criterio 46: en noviembre conPrioridad es siempre false, aunque el alumno tenga la clase en su matrícula VIGENTE', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);

      const [matricula] = (await leerBien(alumno.alumnoId)).matriculas as [MatriculaDeLaLectura];

      expect(clasesConPrioridad(matricula)).toEqual([]);
    });

    it('criterio 46: la ocupación de diciembre no cuenta para la matrícula de noviembre, ni la de noviembre para la de diciembre: cada una lee su mes', async () => {
      const alumno = await alumnoUnDia();
      await conDiciembre(alumno);
      const clase = esc.e.lunes17.id;
      await llenarClase(A(), clase, esc.planUnDia.id, 5, { mes: NOVIEMBRE });
      await llenarClase(A(), clase, esc.planUnDia.id, 9, { mes: DICIEMBRE });

      const lectura = await leerBien(alumno.alumnoId);

      expect(cuposPorClase(delMes(lectura.matriculas, '2026-11'))[clase]).toBe(AFORO - 5);
      expect(cuposPorClase(delMes(lectura.matriculas, '2026-12'))[clase]).toBe(AFORO - 9);
    });
  });

  describe('cuposRestantes y conPrioridad en el mes siguiente (diciembre), con las reservas de prioridad (D-06)', () => {
    /** Un alumno de diciembre (sábado de las 17:00) que en noviembre tiene `noviembreEn` (por defecto, el mismo sábado). */
    const alumnoDeDiciembre = async (noviembreEn: ClaseDePrueba = esc.sabado17) => {
      const alumno = await alumnoUnDia({ claseIds: [noviembreEn.id] });
      const matriculaId = await conDiciembre(alumno);
      return { ...alumno, matriculaDeDiciembreId: matriculaId };
    };
    const deDiciembre = async (alumnoId: string) => delMes((await leerBien(alumnoId)).matriculas, '2026-12');

    it('criterio 46: quien no es titular de la clase pierde los lugares apartados: con 19 titulares apartados le queda 1; con 20, 0; y una clase sin titulares queda entera', async () => {
      const alumno = await alumnoDeDiciembre();
      await sembrarTitulares(A(), esc.planUnDia.id, AFORO - 1, { claseIds: [esc.e.lunes17.id] });
      await sembrarTitulares(A(), esc.planUnDia.id, AFORO, { claseIds: [esc.miercoles19.id] });

      const matricula = await deDiciembre(alumno.alumnoId);

      const cupos = cuposPorClase(matricula);
      expect(cupos[esc.e.lunes17.id]).toBe(1);
      expect(cupos[esc.miercoles19.id]).toBe(0);
      expect(cupos[esc.e.viernes.id]).toBe(AFORO);
      expect(clasesConPrioridad(matricula), 'no es titular de ninguna').toEqual([]);
    });

    it('criterio 46: quien es titular de la clase (la tiene en su matrícula de noviembre VIGENTE) no pierde los apartados: aforo menos la ocupación de diciembre, con conPrioridad true solo en esa clase', async () => {
      const titular = await alumnoDeDiciembre(esc.e.lunes17);
      await sembrarTitulares(A(), esc.planUnDia.id, AFORO - 1, { claseIds: [esc.e.lunes17.id] });
      await llenarClase(A(), esc.e.lunes17.id, esc.planUnDia.id, 6, { mes: DICIEMBRE });
      await sembrarTitulares(A(), esc.planUnDia.id, AFORO, { claseIds: [esc.miercoles19.id] });

      const matricula = await deDiciembre(titular.alumnoId);

      const cupos = cuposPorClase(matricula);
      expect(cupos[esc.e.lunes17.id], 'para el titular: 20 − 6 de diciembre, sin restar los 19 apartados').toBe(
        AFORO - 6,
      );
      expect(cupos[esc.miercoles19.id], 'en la clase donde no es titular sí pierde los 20 apartados').toBe(0);
      expect(clasesConPrioridad(matricula)).toEqual([esc.e.lunes17.id]);
    });

    it('criterio 46: no cuenta la matrícula que se cambia: con la suya de diciembre ya en la clase y 18 más, a un titular le quedan 2 (20 − 18)', async () => {
      const titular = await alumnoUnDia({ claseIds: [esc.e.lunes17.id] });
      await conDiciembre(titular, [esc.e.lunes17.id]);
      await llenarClase(A(), esc.e.lunes17.id, esc.planUnDia.id, AFORO - 2, { mes: DICIEMBRE });

      const matricula = await deDiciembre(titular.alumnoId);

      expect(cuposPorClase(matricula)[esc.e.lunes17.id]).toBe(2);
      expect(clasesConPrioridad(matricula)).toEqual([esc.e.lunes17.id]);
    });

    it('criterio 46: los titulares que ya tienen su matrícula de diciembre en la clase no se cuentan dos veces: ocupan, pero no apartan', async () => {
      const alumno = await alumnoDeDiciembre();
      const clase = esc.lunes19.id;
      const [conDic, sinDic] = [8, 4]; // ocupan 8 lugares en diciembre y apartan 4 (los otros 8 ya renovaron)
      const titulares = await sembrarTitulares(A(), esc.planUnDia.id, conDic + sinDic, { claseIds: [clase] });
      await sembrarMatriculaDelMes(A(), esc.planUnDia.id, titulares.slice(0, conDic), [clase], DICIEMBRE);

      const matricula = await deDiciembre(alumno.alumnoId);

      expect(cuposPorClase(matricula)[clase]).toBe(AFORO - conDic - sinDic);
    });

    it('criterio 46: una matrícula de noviembre en verificación no aparta lugar (DR-12): con 19 así en la clase, quien no es titular la ve entera', async () => {
      const alumno = await alumnoDeDiciembre();
      await sembrarTitulares(A(), esc.planUnDia.id, AFORO - 1, {
        claseIds: [esc.e.viernes.id],
        estado: 'RESERVADA',
      });

      const matricula = await deDiciembre(alumno.alumnoId);

      expect(cuposPorClase(matricula)[esc.e.viernes.id]).toBe(AFORO);
    });

    it('criterio 46: quien tiene la clase en una matrícula de noviembre en verificación no tiene prioridad: conPrioridad false y pierde los apartados', async () => {
      const alumno = await alumnoDeDiciembre(esc.e.lunes17);
      await cambiarMatricula(A(), (await matriculaDelMes(A(), alumno.alumnoId, NOVIEMBRE)).id, {
        estado: 'RESERVADA',
        reserva_vence_en: null,
      });
      await sembrarTitulares(A(), esc.planUnDia.id, AFORO - 1, { claseIds: [esc.e.lunes17.id] });

      const matricula = await deDiciembre(alumno.alumnoId);

      expect(clasesConPrioridad(matricula)).toEqual([]);
      expect(cuposPorClase(matricula)[esc.e.lunes17.id]).toBe(1);
    });

    it('criterio 46: los alumnos CLIENTE que ocupan noviembre no apartan lugar en diciembre: con 20 en noviembre, la clase queda entera en diciembre', async () => {
      const alumno = await alumnoDeDiciembre();
      await llenarClase(A(), esc.e.lunes17.id, esc.planUnDia.id, AFORO, { mes: NOVIEMBRE });

      const matricula = await deDiciembre(alumno.alumnoId);

      expect(cuposPorClase(matricula)[esc.e.lunes17.id]).toBe(AFORO);
    });
  });

  describe('coherencia con el cambio (criterio 36): cuposRestantes es 0 si y solo si el cambio responde SIN_CUPO', () => {
    /** Prepara la ocupación de noviembre de las seis clases elegidas y devuelve la lista de ellas. */
    async function ocuparNoviembre(): Promise<ClaseDePrueba[]> {
      const planId = esc.planUnDia.id;
      await llenarClase(A(), esc.e.lunes17.id, planId, AFORO - 1, { mes: NOVIEMBRE });
      await llenarClase(A(), esc.e.lunes.id, planId, AFORO, { mes: NOVIEMBRE });
      await llenarClase(A(), esc.e.miercoles.id, planId, AFORO + 5, { mes: NOVIEMBRE });
      await llenarClase(A(), esc.miercoles19.id, planId, AFORO, {
        mes: NOVIEMBRE,
        estado: 'RESERVADA',
        reservaVenceEn: new Date(VIERNES27.getTime() + 3 * 60 * 60 * 1000),
      });
      await llenarClase(A(), esc.martes10.id, planId, 1, { mes: NOVIEMBRE });
      return [esc.e.lunes17, esc.e.lunes, esc.e.miercoles, esc.miercoles19, esc.martes10, esc.e.viernes];
    }

    it('criterio 46: en noviembre, con clases libres, casi llenas, llenas, pasadas del aforo y reservadas, el cambio entra por las de cupo y recibe SIN_CUPO por las de cupo 0', async () => {
      const elegidas = await ocuparNoviembre();
      const lector = await alumnoUnDia();
      const sondas: AlumnoDeAsistencia[] = [];
      for (let i = 0; i < elegidas.length; i++) sondas.push(await alumnoUnDia());
      const lectura = await leerBien(lector.alumnoId);
      const cupos = cuposPorClase(delMes(lectura.matriculas, '2026-11'));

      const resultados: [string, number, [number, string | undefined]][] = [];
      for (const [i, clase] of elegidas.entries()) {
        const respuesta = await cambiarHorario(ctx, cookies.secretaria, (sondas[i] as AlumnoDeAsistencia).matriculaId, [
          clase.id,
        ]);
        resultados.push([clase.id, cupos[clase.id] as number, resumen(respuesta)]);
      }

      for (const [id, cupo, respuesta] of resultados) {
        expect(respuesta, `clase ${id} con cuposRestantes ${cupo}`).toEqual(
          cupo === 0 ? [409, 'SIN_CUPO'] : [200, undefined],
        );
      }
      expect(
        resultados.some(([, cupo]) => cupo === 0),
        'la prueba debía incluir clases sin cupo',
      ).toBe(true);
      expect(
        resultados.some(([, cupo]) => cupo > 0),
        'la prueba debía incluir clases con cupo',
      ).toBe(true);
      expect(cupos[esc.e.lunes17.id]).toBe(1);
    });

    it('criterio 46: en diciembre, con titulares apartados, titulares que ya renovaron, clases llenas y clases libres, el cambio coincide con la lectura para quien no es titular', async () => {
      const planId = esc.planUnDia.id;
      await sembrarTitulares(A(), planId, AFORO - 1, { claseIds: [esc.e.lunes17.id] });
      await sembrarTitulares(A(), planId, AFORO, { claseIds: [esc.miercoles19.id] });
      const titularesDelLunes = await sembrarTitulares(A(), planId, AFORO, { claseIds: [esc.e.lunes.id] });
      await sembrarMatriculaDelMes(A(), planId, titularesDelLunes.slice(0, AFORO / 2), [esc.e.lunes.id], DICIEMBRE);
      await sembrarTitulares(A(), planId, 5, { claseIds: [esc.e.viernes.id] });
      await llenarClase(A(), esc.e.miercoles.id, planId, AFORO, { mes: DICIEMBRE });
      const elegidas = [esc.e.lunes17, esc.miercoles19, esc.e.lunes, esc.e.viernes, esc.martes10, esc.e.miercoles];
      const lector = await alumnoUnDia();
      await conDiciembre(lector);
      const sondas: string[] = [];
      for (let i = 0; i < elegidas.length; i++) {
        const sonda = await alumnoUnDia();
        sondas.push(await conDiciembre(sonda));
      }
      const cupos = cuposPorClase(delMes((await leerBien(lector.alumnoId)).matriculas, '2026-12'));

      const resultados: [string, number, [number, string | undefined]][] = [];
      for (const [i, clase] of elegidas.entries()) {
        const respuesta = await cambiarHorario(ctx, cookies.secretaria, sondas[i] as string, [clase.id]);
        resultados.push([clase.id, cupos[clase.id] as number, resumen(respuesta)]);
      }

      for (const [id, cupo, respuesta] of resultados) {
        expect(respuesta, `clase ${id} con cuposRestantes ${cupo}`).toEqual(
          cupo === 0 ? [409, 'SIN_CUPO'] : [200, undefined],
        );
      }
      expect(cupos[esc.e.lunes17.id]).toBe(1);
      expect(cupos[esc.miercoles19.id]).toBe(0);
      expect(cupos[esc.e.lunes.id], 'ocupa 10, aparta 10').toBe(0);
      expect(cupos[esc.e.viernes.id]).toBe(AFORO - 5);
    });

    it('criterio 46: un titular y quien no lo es, ante la misma clase (19 titulares y 19 ocupados en diciembre): al titular le queda 1 y entra; al otro, 0 y recibe SIN_CUPO', async () => {
      const planId = esc.planUnDia.id;
      const clase = esc.e.lunes17;
      await sembrarTitulares(A(), planId, AFORO - 1, { claseIds: [clase.id] });
      await llenarClase(A(), clase.id, planId, AFORO - 1, { mes: DICIEMBRE });
      const [titularLector, titularSonda] = [
        await alumnoUnDia({ claseIds: [clase.id] }),
        await alumnoUnDia({ claseIds: [clase.id] }),
      ];
      const [otroLector, otraSonda] = [await alumnoUnDia(), await alumnoUnDia()];
      await conDiciembre(titularLector);
      const sondaDelTitular = await conDiciembre(titularSonda);
      await conDiciembre(otroLector);
      const sondaDelOtro = await conDiciembre(otraSonda);
      const delTitular = delMes((await leerBien(titularLector.alumnoId)).matriculas, '2026-12');
      const delOtro = delMes((await leerBien(otroLector.alumnoId)).matriculas, '2026-12');

      const sinCupo = await cambiarHorario(ctx, cookies.secretaria, sondaDelOtro, [clase.id]);
      const entra = await cambiarHorario(ctx, cookies.secretaria, sondaDelTitular, [clase.id]);

      expect(cuposPorClase(delOtro)[clase.id]).toBe(0);
      expect(resumen(sinCupo), sinCupo.texto).toEqual([409, 'SIN_CUPO']);
      expect(cuposPorClase(delTitular)[clase.id]).toBe(1);
      expect(clasesConPrioridad(delTitular)).toEqual([clase.id]);
      expect(entra.status, entra.texto).toBe(200);
    });
  });

  describe('no escribe, no audita y no bloquea', () => {
    it('criterio 46: varias lecturas (con matrículas de M y de M+1, con y sin verificación) no cambian la base ni la auditoría', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      await registrarRenovacion(ctx, esc, 'YAPE', cookies.secretaria, alumno.alumnoId);
      const vencido = await crearAlumnoVencido(ctx, esc);
      const antes = await instantaneaDeHorario(esc);
      const auditoriaAntes = (await leerAuditoriaDeAcademia(A())).length;

      for (const id of [alumno.alumnoId, vencido.alumnoId]) {
        for (const cookie of [cookies.secretaria, cookies.admin]) expect((await leer(id, cookie)).status).toBe(200);
      }

      expect(await instantaneaDeHorario(esc)).toBe(antes);
      expect((await leerAuditoriaDeAcademia(A())).length).toBe(auditoriaAntes);
    });

    it('criterio 46: sin bloqueos: con la fila del alumno, la de su matrícula, sus clases y las clases del plan retenidas con FOR UPDATE, la lectura responde 200 sin esperar', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const retener = async (retenedor: Retenedor): Promise<void> => {
        await retenedor.consultar('SELECT id FROM alumnos WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE', [
          A(),
          alumno.alumnoId,
        ]);
        await retenedor.consultar(
          'SELECT id FROM matriculas WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
          [A(), alumno.matriculaId],
        );
        await retenedor.consultar(
          'SELECT matricula_id FROM matricula_clases WHERE academia_id = $1::uuid AND matricula_id = $2::uuid FOR UPDATE',
          [A(), alumno.matriculaId],
        );
        await retenedor.consultar('SELECT id FROM clases WHERE academia_id = $1::uuid ORDER BY id FOR UPDATE', [A()]);
        await retenedor.consultar('SELECT id FROM planes WHERE academia_id = $1::uuid ORDER BY id FOR UPDATE', [A()]);
      };

      const { resultados, todasEsperaron } = await conRetencion({
        academiaId: A(),
        retener,
        enviar: [() => leer(alumno.alumnoId)],
        liberar: 'ROLLBACK',
      });

      expect(todasEsperaron, 'la lectura no debía esperar ningún bloqueo').toBe(false);
      const respuesta = resultados[0] as RespuestaApi;
      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      expect(lecturaDe(respuesta).matriculas).toHaveLength(1);
    });
  });

  describe('permisos y accesos (criterio 41 y criterio 17)', () => {
    let alumno: AlumnoDeAsistencia;
    beforeEach(async () => {
      alumno = await crearAlumnoDeHorario(ctx, esc);
    });
    const cookieDe = (rol: 'admin' | 'secretaria' | 'entrenador' | 'alumno'): string =>
      rol === 'alumno' ? alumno.cookie : cookies[rol];

    it.each(['admin', 'secretaria'] as const)('el rol %s pasa el permiso y recibe 200', async (rol) => {
      const respuesta = await leer(alumno.alumnoId, cookieDe(rol));

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
    });

    it.each(['entrenador', 'alumno'] as const)(
      'el rol %s recibe 403 SIN_PERMISO sin datos, con su alumno, con uno que no existe y con un id que no es UUID',
      async (rol) => {
        const antes = await instantaneaDeHorario(esc);

        const respuestas = [
          await leer(alumno.alumnoId, cookieDe(rol)),
          await leer(randomUUID(), cookieDe(rol)),
          await leer('no-es-un-uuid', cookieDe(rol)),
        ];

        for (const respuesta of respuestas) {
          expect([respuesta.status, codigoDeRespuesta(respuesta)], `${rol}: ${respuesta.texto.slice(0, 200)}`).toEqual([
            403,
            'SIN_PERMISO',
          ]);
          expect(respuesta.texto).not.toContain(esc.e.plan.nombre);
        }
        expect(await instantaneaDeHorario(esc)).toBe(antes);
      },
    );

    it('el alumno no ve su propio horario desde su cuenta (HU-03, D-14): 403 SIN_PERMISO sobre su propio id', async () => {
      const respuesta = await leer(alumno.alumnoId, alumno.cookie);

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([403, 'SIN_PERMISO']);
    });

    it('el rol se lee de la base en cada petición: la secretaria que pasa a ENTRENADOR pierde el permiso al instante', async () => {
      await actualizarUsuario(A(), esc.e.secretariaA.id, { rol: 'ENTRENADOR' });

      const respuesta = await leer(alumno.alumnoId, cookies.secretaria);

      expect([respuesta.status, codigoDeRespuesta(respuesta)]).toEqual([403, 'SIN_PERMISO']);
    });

    it('sin sesión, 401 NO_AUTENTICADO, aun con un alumno que no existe; el Superadmin y una cookie rota también reciben 401', async () => {
      const respuestas = [
        await leer(alumno.alumnoId, undefined),
        await leer(randomUUID(), undefined),
        await leer(alumno.alumnoId, cookieDeSesion(esc.e.superadmin, VIERNES27)),
        await leer(alumno.alumnoId, 'aq_sesion=no-es-un-token'),
      ];

      for (const respuesta of respuestas) {
        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto.slice(0, 200)).toEqual([
          401,
          'NO_AUTENTICADO',
        ]);
      }
    });

    it('con el cambio de contraseña pendiente, 403 CAMBIO_DE_CLAVE_OBLIGATORIO antes que el permiso y el alumno', async () => {
      await actualizarUsuario(A(), esc.e.secretariaA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), esc.e.entrenadorA.id, { debe_cambiar_clave: true });
      await actualizarUsuario(A(), alumno.usuarioId, { debe_cambiar_clave: true });

      for (const rol of ['secretaria', 'entrenador', 'alumno'] as const) {
        for (const id of [alumno.alumnoId, randomUUID()]) {
          const respuesta = await leer(id, cookieDe(rol));
          expect([respuesta.status, codigoDeRespuesta(respuesta)], rol).toEqual([403, 'CAMBIO_DE_CLAVE_OBLIGATORIO']);
        }
      }
    });

    it('con la academia suspendida, 403 ACADEMIA_SUSPENDIDA para todos los roles', async () => {
      await fijarEstadoDeAcademia(A(), 'SUSPENDIDA');

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        const respuesta = await leer(alumno.alumnoId, cookieDe(rol));
        expect([respuesta.status, codigoDeRespuesta(respuesta)], rol).toEqual([403, 'ACADEMIA_SUSPENDIDA']);
      }
    });

    it('HEAD sobre la ruta de la lectura responde 404 con la sesión de cualquier rol y no escribe', async () => {
      const antes = await instantaneaDeHorario(esc);

      for (const rol of ['admin', 'secretaria', 'entrenador', 'alumno'] as const) {
        const respuesta = await ctx.http.enviar('HEAD', rutaLecturaHorario(alumno.alumnoId), { cookie: cookieDe(rol) });
        expect(respuesta.status, rol).toBe(404);
      }

      expect(await instantaneaDeHorario(esc)).toBe(antes);
    });
  });

  describe('404 NO_ENCONTRADO y aislamiento entre academias', () => {
    const DNI_COMUN = '45612378';

    it('un id que no es UUID y uno que no existe responden 404 NO_ENCONTRADO con el mismo cuerpo', async () => {
      const noUuid = await leer('no-es-un-uuid');
      const inexistente = await leer(randomUUID());

      expect(resumen(noUuid), noUuid.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(resumen(inexistente), inexistente.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(sinUuid(inexistente.texto)).toBe(sinUuid(noUuid.texto));
    });

    it('un CLIENTE (su reserva de 24 horas) responde 404 NO_ENCONTRADO, igual que un alumno que no existe, sin datos', async () => {
      const cliente = await sembrarSolicitud(A(), {
        planId: esc.e.plan.id,
        claseIds: [esc.e.lunes.id, esc.e.miercoles.id, esc.e.viernes.id],
        ahora: VIERNES27,
      });

      const respuesta = await leer(cliente.alumnoId);
      const inexistente = await leer(randomUUID());

      expect(resumen(respuesta), respuesta.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(sinUuid(respuesta.texto)).toBe(sinUuid(inexistente.texto));
    });

    it('con la sesión de A, el alumno de B (mismo DNI, clases a la misma hora) responde el mismo 404 que uno inexistente; el de A responde 200', async () => {
      const deA = await crearAlumnoDeHorario(ctx, esc, { dni: DNI_COMUN });
      const deB = await crearAlumnoDeHorario(ctx, esc, { academia: 'B', dni: DNI_COMUN });
      const antesDeB = await instantaneaDeLaAcademia(B());

      const deLaOtra = await leer(deB.alumnoId);
      const inexistente = await leer(randomUUID());
      const propio = await leer(deA.alumnoId);

      expect(resumen(deLaOtra), deLaOtra.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(sinUuid(deLaOtra.texto)).toBe(sinUuid(inexistente.texto));
      expect(propio.status, propio.texto).toBe(200);
      expect(await instantaneaDeLaAcademia(B()), 'B no cambia').toBe(antesDeB);
    });

    it('con la sesión de B, el alumno de A es un 404 y el de B responde con las clases de B', async () => {
      const deA = await crearAlumnoDeHorario(ctx, esc, { dni: DNI_COMUN });
      const deB = await crearAlumnoDeHorario(ctx, esc, { academia: 'B', dni: DNI_COMUN });

      const deLaOtra = await leer(deA.alumnoId, cookies.secretariaB);
      const propio = lecturaDe(await leer(deB.alumnoId, cookies.secretariaB));

      expect(resumen(deLaOtra), deLaOtra.texto).toEqual([404, 'NO_ENCONTRADO']);
      const [matricula] = propio.matriculas as [MatriculaDeLaLectura];
      expect(matricula.id).toBe(deB.matriculaId);
      expect(matricula.clases.map((c) => c.id).sort()).toEqual(
        [esc.e.lunesB.id, esc.e.miercolesB.id, esc.e.viernesB.id].sort(),
      );
      const idsDeLaLista = matricula.clasesDelPlan.map((c) => c.id);
      expect(idsDeLaLista).toEqual(
        expect.arrayContaining([esc.e.lunesB.id, esc.lunes19B.id, esc.e.miercolesB.id, esc.e.viernesB.id]),
      );
      for (const clase of todasLasClasesDeA())
        expect(idsDeLaLista, 'ninguna clase de A en la lista de B').not.toContain(clase.id);
    });

    it('?academiaId= en la dirección no cambia nada: con la academia de B no abre al alumno de B y con la de A no estorba al propio', async () => {
      const deB = await crearAlumnoDeHorario(ctx, esc, { academia: 'B' });
      const propio = await crearAlumnoDeHorario(ctx, esc);
      const sinConsulta = await leer(propio.alumnoId);

      const deLaOtra = await leer(deB.alumnoId, cookies.secretaria, `?academiaId=${B()}`);
      const conOtraAcademia = await leer(propio.alumnoId, cookies.secretaria, `?academiaId=${B()}`);
      const conLaPropia = await leer(propio.alumnoId, cookies.secretaria, `?academiaId=${A()}`);

      expect(resumen(deLaOtra), deLaOtra.texto).toEqual([404, 'NO_ENCONTRADO']);
      expect(conOtraAcademia.texto).toBe(sinConsulta.texto);
      expect(conLaPropia.texto).toBe(sinConsulta.texto);
    });

    it('la ocupación y las reservas solo cuentan matrículas de A: clases de B a la misma hora, llenas y con titulares apartados, no cambian los cupos de A', async () => {
      const alumno = await crearAlumnoDeHorario(ctx, esc);
      const lectorDeDiciembre = await alumnoUnDia();
      await conDiciembre(lectorDeDiciembre, [esc.sabado17.id]);
      const antes = await leerBien(alumno.alumnoId);
      const antesDic = delMes((await leerBien(lectorDeDiciembre.alumnoId)).matriculas, '2026-12');
      for (const clase of [esc.e.lunesB, esc.e.miercolesB, esc.e.viernesB]) {
        await llenarClase(B(), clase.id, esc.e.planB.id, AFORO, { mes: NOVIEMBRE });
        await llenarClase(B(), clase.id, esc.e.planB.id, AFORO, { mes: DICIEMBRE });
        await sembrarTitulares(B(), esc.e.planB.id, AFORO, { claseIds: [clase.id] });
      }

      const despues = await leerBien(alumno.alumnoId);
      const despuesDic = delMes((await leerBien(lectorDeDiciembre.alumnoId)).matriculas, '2026-12');

      expect(despues).toEqual(antes);
      expect(cuposPorClase(despuesDic)).toEqual(cuposPorClase(antesDic));
      expect(cuposPorClase(despuesDic)[esc.e.lunes17.id]).toBe(AFORO);
    });

    it('la ocupación de A no aparece en la lectura de B: con las clases de A llenas, las de B siguen enteras', async () => {
      const deB = await crearAlumnoDeHorario(ctx, esc, { academia: 'B' });
      for (const clase of [esc.e.lunes, esc.e.miercoles, esc.e.viernes, esc.lunes19]) {
        await llenarClase(A(), clase.id, esc.e.plan.id, AFORO, { mes: NOVIEMBRE });
      }

      const [matricula] = lecturaDe(await leer(deB.alumnoId, cookies.secretariaB)).matriculas as [MatriculaDeLaLectura];

      expect(matricula.clasesDelPlan.every((c) => c.cuposRestantes === AFORO)).toBe(true);
    });
  });
});
