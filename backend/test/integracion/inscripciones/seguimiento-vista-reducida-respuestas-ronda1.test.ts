// spec: 005-inscripcion-publica (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  type AppInscripciones,
  AHORA_005,
  crearAppInscripciones,
  crearEscenarioInscripcion,
  crearPlanDeDosVeces,
  cuerpoInscripcion,
  type EscenarioInscripcion,
  exigirTablasDeInscripcion,
  leerAlumnos,
  type Objeto,
  rutaPublica,
  sembrarSolicitud,
  solicitudDe,
  VEINTICUATRO_HORAS,
} from '../../utilidades/inscripciones';

// Criterio 58 (crítico, RNF-05, Ley 29733, D-05, DR-9, DR-14; criterio 32; respuesta R3, ronda 1): la vista de seguimiento lleva `nombres` (y
// `fotoCargada`) solo si la solicitud es la vigente del cliente y su estado visible no es VENCIDA ni CANCELADA. En la 005a la vista es reducida
// exactamente cuando el estado visible es VENCIDA o CANCELADA. La vista reducida tiene solo `codigo`, `estado`, `creadaEn`, `plan`, `clases`,
// `mes`, `clasesTotales`, `monto` y `esProporcional`, todos de esa solicitud y de su matrícula; las claves `nombres`, `fotoCargada` y
// `reservaVenceEn` no están. Pruebas, por token y por código con DNI (las dos dan el mismo cuerpo):
//   a) una solicitud VENCIDA (en la fila) y una CANCELADA: las claves son exactamente las de la vista reducida y el primer nombre no aparece;
//   b) una PENDIENTE_PAGO un segundo antes de vencer muestra la vista completa con `nombres`; en el instante del vencimiento, la reducida;
//   c) regreso por un tercero (criterio 21 b): un cliente "Valeria" con su solicitud vencida S1; otro envío con el mismo DNI y el nombre
//      "Intrusa" crea S2. La consulta de S1 muestra la vista reducida con el plan, las clases, el mes y el monto de S1 (no los de S2), y el
//      cuerpo no contiene "Intrusa" ni "Valeria"; la de S2 muestra "Intrusa";
//   d) la solicitud de noviembre del criterio 55, consultada el 1 de diciembre, muestra la vista reducida;
//   (e, el esquema, está en `packages/contratos/src/ronda1-respuestas-protegido.test.ts`.)

const CLAVES_REDUCIDAS = [
  'clases',
  'clasesTotales',
  'codigo',
  'creadaEn',
  'esProporcional',
  'estado',
  'mes',
  'monto',
  'plan',
];
const CLAVES_COMPLETAS = [...CLAVES_REDUCIDAS, 'fotoCargada', 'nombres', 'reservaVenceEn'].sort();

describe('la vista reducida de una solicitud que ya no es la vigente (criterio 58)', () => {
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

  const consultar = (cuerpo: unknown) => ctx.http.post(rutaPublica('academia-a', '/solicitudes/consulta'), cuerpo);
  const vista = (respuesta: { body: Objeto | null }): Objeto => respuesta.body?.['solicitud'] as Objeto;
  const sembrar = (opciones: Partial<Parameters<typeof sembrarSolicitud>[1]> = {}) =>
    sembrarSolicitud(e.A.id, {
      planId: e.plan.id,
      claseIds: [e.lunes.id, e.miercoles.id, e.viernes.id],
      nombres: 'Valeria Andrea',
      apellidos: 'Mendoza Salas',
      clasesTotales: 9,
      monto: '90.00',
      ...opciones,
    });

  /** Consulta por token y por código con DNI y comprueba que las dos dan el mismo cuerpo. */
  async function consultarDeLasDosFormas(cliente: { token: string; codigo: string; dni: string }) {
    const porToken = await consultar({ token: cliente.token });
    const porCodigo = await consultar({ codigo: cliente.codigo, dni: cliente.dni });
    expect(porToken.status, porToken.texto).toBe(200);
    expect(porCodigo.status, porCodigo.texto).toBe(200);
    expect(porCodigo.body, 'por token y por código y DNI dan el mismo cuerpo').toEqual(porToken.body);
    return porToken;
  }

  describe('a: VENCIDA y CANCELADA', () => {
    it.each([
      ['VENCIDA', { estado: 'VENCIDA' as const }],
      ['CANCELADA', { estado: 'CANCELADA' as const }],
      ['PENDIENTE_PAGO que ya venció (la fila aún no lo dice)', { estado: 'PENDIENTE_PAGO_VENCIDA' as const }],
    ])(
      'criterio 58 a: una solicitud %s muestra exactamente las claves de la vista reducida y el primer nombre no aparece en ninguna parte del cuerpo',
      async (nombre, opciones) => {
        const cliente = await sembrar(opciones);

        const respuesta = await consultarDeLasDosFormas(cliente);

        const solicitud = vista(respuesta);
        expect(Object.keys(solicitud).sort()).toEqual(CLAVES_REDUCIDAS);
        expect(solicitud['estado']).toBe(nombre.startsWith('PENDIENTE') ? 'VENCIDA' : nombre);
        expect(solicitud).toMatchObject({
          codigo: cliente.codigo,
          plan: { nombre: 'Plan 3 por semana' },
          mes: '2026-11',
          clasesTotales: 9,
          monto: '90.00',
          esProporcional: true,
        });
        expect(solicitud['clases'] as unknown[]).toHaveLength(3);
        for (const clave of ['nombres', 'fotoCargada', 'reservaVenceEn'])
          expect(solicitud, clave).not.toHaveProperty(clave);
        for (const prohibido of ['Valeria', 'Andrea', 'Mendoza', cliente.dni]) {
          expect(respuesta.texto, `el cuerpo no debe llevar ${prohibido}`).not.toContain(prohibido);
        }
      },
    );

    it('criterio 58 a: aunque el alumno ya tenga una foto guardada, la vista de una solicitud VENCIDA no lleva fotoCargada', async () => {
      const cliente = await sembrar({ estado: 'VENCIDA' });
      await ejecutarComo(
        'propietario',
        `UPDATE alumnos SET foto_clave = 'academias/x/alumnos/y/foto-z.jpg' WHERE academia_id = $1::uuid AND id = $2::uuid`,
        [e.A.id, cliente.alumnoId],
        { academiaId: e.A.id },
      );

      const respuesta = await consultar({ token: cliente.token });

      expect(vista(respuesta)).not.toHaveProperty('fotoCargada');
      expect(respuesta.texto).not.toContain('foto-z.jpg');
    });
  });

  describe('b: el instante del vencimiento', () => {
    it('criterio 58 b: una PENDIENTE_PAGO un segundo antes de vencer muestra la vista completa con nombres; en el instante del vencimiento, la reducida', async () => {
      const vence = new Date(AHORA_005.getTime() + VEINTICUATRO_HORAS);
      const cliente = await sembrar({ reservaVenceEn: vence });

      ctx.reloj.fijar(new Date(vence.getTime() - 1000));
      const antes = await consultarDeLasDosFormas(cliente);
      ctx.reloj.fijar(vence);
      const justo = await consultarDeLasDosFormas(cliente);

      expect(Object.keys(vista(antes)).sort()).toEqual(CLAVES_COMPLETAS);
      expect(vista(antes)).toMatchObject({ estado: 'PENDIENTE_PAGO', nombres: 'Valeria', fotoCargada: false });
      expect(Object.keys(vista(justo)).sort()).toEqual(CLAVES_REDUCIDAS);
      expect(vista(justo)['estado']).toBe('VENCIDA');
      expect(justo.texto).not.toContain('Valeria');
    });
  });

  describe('c: el regreso del cliente con su DNI por un tercero (criterio 21 b)', () => {
    it('criterio 58 c: la consulta de S1 muestra su vista reducida con el plan, las clases, el mes y el monto de S1, sin "Intrusa" ni "Valeria"; la de S2 muestra "Intrusa"', async () => {
      const planDeDos = await crearPlanDeDosVeces(e);
      const s1 = await sembrar({
        planId: planDeDos.id,
        claseIds: [e.lunes.id, e.miercoles.id],
        nombres: 'Valeria',
        estado: 'VENCIDA',
        clasesTotales: 6,
        clasesPorMesPlan: 8,
        precioPlan: '90.00',
        monto: '70.00',
      });

      const envio = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(e, {
          sobre: { alumno: { dni: s1.dni, nombres: 'Intrusa', apellidos: 'Otra Persona' } },
        }),
      );
      expect(envio.status, envio.texto).toBe(201);
      const s2 = solicitudDe(envio);
      expect((await leerAlumnos(e.A.id)).filter((alumno) => alumno.dni === s1.dni)).toHaveLength(1);

      const deS1 = await consultarDeLasDosFormas(s1);
      const deS2 = await consultar({ token: s2.token });

      const solicitud1 = vista(deS1);
      expect(Object.keys(solicitud1).sort()).toEqual(CLAVES_REDUCIDAS);
      expect(solicitud1).toMatchObject({
        codigo: s1.codigo,
        estado: 'VENCIDA',
        plan: { nombre: 'Plan 2 por semana' },
        mes: '2026-11',
        clasesTotales: 6,
        monto: '70.00',
      });
      expect(solicitud1['clases'] as unknown[], 'las 2 clases de S1, no las 3 de S2').toHaveLength(2);
      expect(deS1.texto).not.toContain('Intrusa');
      expect(deS1.texto).not.toContain('Valeria');
      expect(vista(deS2)).toMatchObject({ codigo: s2.codigo, estado: 'PENDIENTE_PAGO', nombres: 'Intrusa' });
      expect(Object.keys(vista(deS2)).sort()).toEqual(CLAVES_COMPLETAS);
      expect((vista(deS2)['plan'] as Objeto)['nombre']).toBe('Plan 3 por semana');
    });
  });

  describe('d: al terminar el mes (criterio 55)', () => {
    it('criterio 58 d: la solicitud enviada el 30 de noviembre, consultada el 1 de diciembre, muestra la vista reducida', async () => {
      const lunes30 = new Date('2026-11-30T15:00:00.000Z');
      ctx.reloj.fijar(lunes30);
      const envio = await ctx.http.post(
        rutaPublica('academia-a', '/inscripcion'),
        await cuerpoInscripcion(e, { ahora: lunes30 }),
      );
      expect(envio.status, envio.texto).toBe(201);
      const solicitud = solicitudDe(envio);
      const [alumno] = await leerAlumnos(e.A.id);

      ctx.reloj.fijar(new Date('2026-12-01T05:00:00.000Z'));
      const porToken = await consultar({ token: solicitud.token });
      const porCodigo = await consultar({ codigo: solicitud.codigo, dni: alumno?.dni });

      expect(Object.keys(vista(porToken)).sort()).toEqual(CLAVES_REDUCIDAS);
      expect(vista(porToken)).toMatchObject({ estado: 'VENCIDA', mes: '2026-11' });
      expect(porCodigo.body).toEqual(porToken.body);
      expect(porToken.texto).not.toContain('Camila');
    });
  });
});
