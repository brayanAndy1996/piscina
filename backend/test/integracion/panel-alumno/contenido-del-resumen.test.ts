// spec: 011-panel-alumno (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AlumnoDeAsistencia,
  crearAlumnoDeAsistencia,
  type EscenarioDeAsistencia,
  en,
  enLima,
} from '../../utilidades/escenario-asistencia';
import { type AppCarnet, crearAppCarnet } from '../../utilidades/escenario-carnet';
import {
  CLAVES_DE_LA_CLASE_DEL_REGISTRO,
  CLAVES_DE_LA_CONSULTA,
  CLAVES_DE_LA_MATRICULA_DEL_MES,
  CLAVES_DE_UN_REGISTRO_DE_ASISTENCIA,
  CLAVES_DE_UN_REGISTRO_DE_FALTA,
  consultaDe,
} from '../../utilidades/escenario-faltas';
import {
  CLAVES_DE_LA_CLASE_DEL_PANEL,
  CLAVES_DE_LA_MENSUALIDAD_DEL_PANEL,
  CLAVES_DE_LA_SIGUIENTE_DEL_PANEL,
  CLAVES_DE_UNA_MENSUALIDAD_DEL_PANEL,
  CLAVES_DEL_ALUMNO_DEL_PANEL,
  CLAVES_DEL_PANEL,
  CLAVES_DEL_PLAN_DEL_PANEL,
  clavesDe,
  type DatosSembrados,
  FORMATO_UUID,
  panelDe,
  pedirCrudo,
  prepararEscenarioDelPanel,
  RUTA_MI_ASISTENCIA,
  RUTA_MI_PANEL,
  sembrarDatosSensibles,
} from '../../utilidades/escenario-panel';

// Criterio 6 (crítico, HU-06, RN-21, RNF-05, RN-06, Ley 29733): `GET /api/mi-panel` responde 200 con `miPanelSchema` (estricto): `hoy`, `mesEnCurso`, `alumno` (`nombres`, `apellidos`, `dni`, `nivel`, `edad`, `estado`), `mensualidad` (`estado`, `actual`, `siguiente`) y `mesesDeAsistencia`. No lleva ningún id (ni del alumno, ni del usuario, ni de
// matrículas, planes, clases o pagos), ni fecha de nacimiento, teléfono, correo, dirección, colegio, ficha médica, contacto de emergencia, apoderado, consentimientos, foto ni `foto_clave`, token o contenido del QR, código o token de seguimiento, montos, método de pago, número de operación, comprobante, motivo de
// rechazo, ajuste de monto ni su motivo, entrenador de la clase, ni quién registró una asistencia o su motivo (DR-1). Prueba: las claves exactas del JSON para un adulto y para un menor con apoderado, ficha médica (alergias y enfermedades), consentimientos, foto, QR, un pago por Yape con número de operación, un ajuste de monto
// con motivo y un registro posterior con motivo, todos con textos únicos; ninguno de esos textos aparece en el cuerpo de las dos rutas del panel.
// Lecturas estrictas elegidas: las dos rutas se piden con el mes por defecto y con los meses 2026-10 y 2026-11; las cabeceras de la respuesta tampoco llevan ningún texto sembrado; ningún cuerpo contiene un UUID; las claves de la asistencia son exactamente las de `asistenciaDelMesSchema` (009b); el DNI del propio alumno sale en el resumen (HU-06)
// y no sale en la asistencia (criterio 12); el reloj está en el 17/11/2026 a las 10:00 de Lima (diciembre ya está pagado o en verificación, pero noviembre es el mes en curso).

const AHORA = enLima('2026-11-17', '10:00:00.000');

describe('lo que lleva y lo que no lleva el panel (criterio 6)', () => {
  let ctx: AppCarnet;
  let esc: EscenarioDeAsistencia;
  let adulto: AlumnoDeAsistencia;
  let menor: AlumnoDeAsistencia;
  let datosDelAdulto: DatosSembrados;
  let datosDelMenor: DatosSembrados;

  beforeAll(async () => {
    ctx = await crearAppCarnet();
  });
  beforeEach(async () => {
    esc = await prepararEscenarioDelPanel(ctx);
    adulto = await crearAlumnoDeAsistencia(ctx, esc, {
      dni: '33000001',
      nombres: 'Adela',
      apellidos: 'Adulta Visible',
      clasesUsadas: 3,
    });
    menor = await crearAlumnoDeAsistencia(ctx, esc, {
      dni: '33000002',
      nombres: 'Marco',
      apellidos: 'Menor Visible',
      conApoderado: true,
      fechaNacimiento: '2014-03-10',
      clasesUsadas: 5,
    });
    datosDelAdulto = await sembrarDatosSensibles(esc, adulto, { n: 1, diciembre: 'PAGADA' });
    datosDelMenor = await sembrarDatosSensibles(esc, menor, { n: 2, conApoderado: true, diciembre: 'EN_VERIFICACION' });
    en(ctx, esc, AHORA);
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const pedir = (ruta: string, cookie: string) => pedirCrudo(ctx.app, 'GET', ruta, { cookie });
  const RUTAS_DE_ASISTENCIA = [
    RUTA_MI_ASISTENCIA,
    `${RUTA_MI_ASISTENCIA}?mes=2026-11`,
    `${RUTA_MI_ASISTENCIA}?mes=2026-10`,
  ];
  const DEL_PERSONAL = ['Castro', 'Benites'];

  const casos = (): [string, () => AlumnoDeAsistencia, () => DatosSembrados, 'PAGADA' | 'EN_VERIFICACION'][] => [
    ['un adulto', () => adulto, () => datosDelAdulto, 'PAGADA'],
    ['un menor con apoderado', () => menor, () => datosDelMenor, 'EN_VERIFICACION'],
  ];

  describe.each(casos())('%s', (_nombre, alumnoDe, datosDe, estadoDeDiciembre) => {
    it('las claves del resumen son exactamente las del contrato, en cada nivel (alumno, mensualidad, actual, siguiente, plan y clases)', async () => {
      const alumno = alumnoDe();

      const respuesta = await pedir(RUTA_MI_PANEL, alumno.cookie);

      const panel = panelDe(respuesta);
      expect(Object.keys(panel).sort()).toEqual(CLAVES_DEL_PANEL);
      expect(Object.keys(panel.alumno).sort()).toEqual(CLAVES_DEL_ALUMNO_DEL_PANEL);
      expect(Object.keys(panel.mensualidad).sort()).toEqual(CLAVES_DE_LA_MENSUALIDAD_DEL_PANEL);
      const { actual, siguiente } = panel.mensualidad;
      expect(actual, 'noviembre está pagado: `actual` no es null').not.toBeNull();
      expect(Object.keys(actual ?? {}).sort()).toEqual(CLAVES_DE_UNA_MENSUALIDAD_DEL_PANEL);
      expect(Object.keys(actual?.plan ?? {}).sort()).toEqual(CLAVES_DEL_PLAN_DEL_PANEL);
      expect(actual?.clases.length).toBeGreaterThan(0);
      for (const clase of actual?.clases ?? []) expect(Object.keys(clase).sort()).toEqual(CLAVES_DE_LA_CLASE_DEL_PANEL);
      expect(siguiente, 'diciembre está pagado o en verificación: `siguiente` no es null').not.toBeNull();
      expect(Object.keys(siguiente ?? {}).sort()).toEqual(CLAVES_DE_LA_SIGUIENTE_DEL_PANEL);
      expect(Object.keys(siguiente?.plan ?? {}).sort()).toEqual(CLAVES_DEL_PLAN_DEL_PANEL);
      for (const clase of siguiente?.clases ?? [])
        expect(Object.keys(clase).sort()).toEqual(CLAVES_DE_LA_CLASE_DEL_PANEL);
      expect(siguiente?.estado).toBe(estadoDeDiciembre);
      expect(siguiente?.mes).toBe('2026-12');
      expect(datosDe().textos.length, 'control: la prueba sembró datos sensibles').toBeGreaterThan(10);
    });

    it('las claves de la asistencia son exactamente las de asistenciaDelMesSchema (sin DNI, motivo ni quién registró)', async () => {
      const alumno = alumnoDe();

      for (const ruta of RUTAS_DE_ASISTENCIA) {
        const consulta = consultaDe(await pedir(ruta, alumno.cookie));

        expect(Object.keys(consulta).sort(), ruta).toEqual(CLAVES_DE_LA_CONSULTA);
        if (consulta.matricula) {
          expect(Object.keys(consulta.matricula).sort(), ruta).toEqual(CLAVES_DE_LA_MATRICULA_DEL_MES);
        }
        for (const registro of consulta.registros) {
          expect(Object.keys(registro).sort(), ruta).toEqual(
            registro.tipo === 'ASISTENCIA' ? CLAVES_DE_UN_REGISTRO_DE_ASISTENCIA : CLAVES_DE_UN_REGISTRO_DE_FALTA,
          );
          expect(Object.keys(registro.clase).sort(), ruta).toEqual(CLAVES_DE_LA_CLASE_DEL_REGISTRO);
        }
      }
    });

    it('ningún texto sembrado (ficha médica, apoderado, contacto, correo, teléfono, dirección, foto, consentimiento, ajuste y su motivo, Yape, comprobante, rechazo, registro posterior) aparece en el cuerpo ni en las cabeceras de las dos rutas', async () => {
      const alumno = alumnoDe();
      const prohibidos = [...datosDe().textos, ...datosDe().identificadores, ...DEL_PERSONAL, '2014-03-10'];
      const respuestas = [
        await pedir(RUTA_MI_PANEL, alumno.cookie),
        ...(await Promise.all(RUTAS_DE_ASISTENCIA.map((ruta) => pedir(ruta, alumno.cookie)))),
      ];

      for (const respuesta of respuestas) {
        expect(respuesta.status, respuesta.texto.slice(0, 200)).toBe(200);
        const cabeceras = JSON.stringify(respuesta.headers);
        for (const prohibido of prohibidos) {
          expect(respuesta.texto, `en el cuerpo no puede salir «${prohibido}»`).not.toContain(prohibido);
          expect(cabeceras, `en las cabeceras no puede salir «${prohibido}»`).not.toContain(prohibido);
        }
        expect(respuesta.texto, 'ningún id en el cuerpo').not.toMatch(FORMATO_UUID);
      }
    });

    it('ninguna clave del cuerpo es un dato que el panel no muestra (ids, fecha de nacimiento, contactos, ficha, apoderado, consentimientos, foto, QR, tokens, montos, pagos, motivos, entrenador, quién registró)', async () => {
      const alumno = alumnoDe();
      const prohibidas =
        /(^id$|Id$|nacimiento|telefono|correo|direccion|colegio|ficha|medic|alergia|enfermedad|emergencia|apoderado|consentimiento|foto|qr|token|codigo|monto|precio|ajuste|pago|operacion|comprobante|rechazo|motivo|entrenador|registradoPor|registrado_por|verificad)/i;
      const claves = new Set<string>();
      for (const ruta of [RUTA_MI_PANEL, ...RUTAS_DE_ASISTENCIA]) {
        const respuesta = await pedir(ruta, alumno.cookie);
        expect(respuesta.status, `${ruta}: ${respuesta.texto.slice(0, 200)}`).toBe(200);
        for (const clave of clavesDe(respuesta.body)) claves.add(clave);
      }

      expect([...claves].filter((clave) => prohibidas.test(clave))).toEqual([]);
    });

    it('el DNI propio sale en el resumen (HU-06) y no sale en la asistencia', async () => {
      const alumno = alumnoDe();

      const resumen = await pedir(RUTA_MI_PANEL, alumno.cookie);
      const asistencia = await pedir(`${RUTA_MI_ASISTENCIA}?mes=2026-11`, alumno.cookie);

      expect(panelDe(resumen).alumno.dni).toBe(alumno.dni);
      expect(asistencia.texto).not.toContain(alumno.dni);
    });
  });

  it('el menor y el adulto: cada uno recibe solo lo suyo (la edad y el conteo de clases no se cruzan) y la mensualidad mostrada es la de noviembre con sus fechas', async () => {
    const delAdulto = panelDe(await pedir(RUTA_MI_PANEL, adulto.cookie));
    const delMenor = panelDe(await pedir(RUTA_MI_PANEL, menor.cookie));

    expect(delAdulto.alumno).toMatchObject({ nombres: 'Adela', dni: '33000001' });
    expect(delMenor.alumno).toMatchObject({ nombres: 'Marco', dni: '33000002', edad: 12 });
    expect(delAdulto.mensualidad.actual).toMatchObject({
      mes: '2026-11',
      desde: '2026-11-01',
      hasta: '2026-11-30',
      clasesUsadas: 3,
      clasesTotales: 12,
      clasesRestantes: 9,
    });
    expect(delMenor.mensualidad.actual).toMatchObject({ clasesUsadas: 5, clasesRestantes: 7 });
    expect(delAdulto.mensualidad.siguiente).toMatchObject({ mes: '2026-12', desde: '2026-12-01', hasta: '2026-12-31' });
    expect(JSON.stringify(delAdulto)).not.toContain('Marco');
    expect(JSON.stringify(delMenor)).not.toContain('Adela');
  });
});
