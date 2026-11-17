// spec: 002-autenticacion-roles (pruebas protegidas)
import { describe, expect, it } from 'vitest';

// Criterio 26: `MATRIZ_PERMISOS` tiene exactamente las filas, roles y alcances de la tabla "Matriz de permisos" del contrato de la
// 002 (las 21 filas de la sección 2.1 de los requerimientos más `GESTIONAR_USUARIOS` y `RESTABLECER_CLAVE`), y `puede(rol, permiso)`
// dice si el rol tiene la celda (una celda vacía es "no"). La tabla esperada está escrita aquí a mano, fila por fila, de forma
// independiente de la implementación.

type Rol = 'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO';
type Alcance = 'TODO' | 'SUS_ALUMNOS' | 'SUS_CLASES' | 'PROPIO' | 'SU_CAJA' | 'LOS_QUE_SUBE' | 'ALUMNOS';
type Fila = Partial<Record<Rol, Alcance>>;

interface ModuloPermisos {
  ROLES_USUARIO: readonly string[];
  ALCANCES: readonly string[];
  PERMISOS: readonly string[];
  MATRIZ_PERMISOS: Record<string, Fila | undefined>;
  puede: (rol: string, permiso: string) => boolean;
}

/** Carga `permisos.ts` con una importación dinámica: antes de implementarlo, la prueba falla con un mensaje claro. */
async function cargar(): Promise<ModuloPermisos> {
  const ruta = new URL('./permisos.ts', import.meta.url).href;
  let modulo: Partial<ModuloPermisos>;
  try {
    modulo = (await import(/* @vite-ignore */ ruta)) as Partial<ModuloPermisos>;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falta la funcionalidad de la 002: no se pudo cargar packages/contratos/src/permisos.ts (${motivo}).`,
      {
        cause: error,
      },
    );
  }
  for (const nombre of ['ROLES_USUARIO', 'ALCANCES', 'PERMISOS', 'MATRIZ_PERMISOS', 'puede'] as const) {
    if (modulo[nombre] === undefined) {
      throw new Error(`Falta la funcionalidad de la 002: permisos.ts no exporta ${nombre}.`);
    }
  }
  return modulo as ModuloPermisos;
}

const ROLES: readonly Rol[] = ['ADMIN', 'SECRETARIA', 'ENTRENADOR', 'ALUMNO'];

const MATRIZ_ESPERADA: Readonly<Record<string, Fila>> = {
  CONFIGURAR_PLANES_HORARIOS_AFORO: { ADMIN: 'TODO' },
  CREAR_CODIGOS_DESCUENTO: { ADMIN: 'TODO' },
  AUTORIZAR_CLASES_PARTICULARES: { ADMIN: 'TODO' },
  COBRAR_CLASE_PARTICULAR: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  REGISTRAR_INSCRIPCION_Y_COBRO: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  VERIFICAR_PAGOS: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  ABRIR_CERRAR_CAJA: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  REGISTRAR_ASISTENCIA: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  MODIFICAR_HORARIO_ALUMNO: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  VER_FICHA_ALUMNO: { ADMIN: 'TODO', SECRETARIA: 'TODO', ENTRENADOR: 'SUS_ALUMNOS' },
  EDITAR_RENDIMIENTO: { ENTRENADOR: 'SUS_ALUMNOS' },
  SUBIR_MULTIMEDIA: { ADMIN: 'TODO', ENTRENADOR: 'SUS_ALUMNOS' },
  VER_REPORTES_FINANCIEROS: { ADMIN: 'TODO', SECRETARIA: 'SU_CAJA' },
  VER_REPORTES_ASISTENCIA: { ADMIN: 'TODO', SECRETARIA: 'TODO', ENTRENADOR: 'SUS_CLASES', ALUMNO: 'PROPIO' },
  VER_CARNET: { ADMIN: 'TODO', SECRETARIA: 'TODO', ALUMNO: 'PROPIO' },
  AUTORIZAR_ASISTENCIA_OTRO_HORARIO: { ADMIN: 'TODO', SECRETARIA: 'TODO' },
  REGISTRAR_PAGOS_ENTRENADORES: { ADMIN: 'TODO' },
  VER_PAGOS_RECIBIDOS: { ENTRENADOR: 'PROPIO' },
  REGISTRAR_DIAS_CIERRE: { ADMIN: 'TODO' },
  EMITIR_CERTIFICADOS: { ADMIN: 'TODO' },
  VER_MULTIMEDIA: { ADMIN: 'TODO', ENTRENADOR: 'LOS_QUE_SUBE', ALUMNO: 'PROPIO' },
  GESTIONAR_USUARIOS: { ADMIN: 'TODO' },
  RESTABLECER_CLAVE: { ADMIN: 'TODO', SECRETARIA: 'ALUMNOS' },
};

const PERMISOS_ESPERADOS = Object.keys(MATRIZ_ESPERADA).sort();

/** Una fila sin las celdas `undefined`, para compararla de forma estricta. */
function sinVacias(fila: Fila | undefined): Fila {
  return Object.fromEntries(Object.entries(fila ?? {}).filter(([, valor]) => valor !== undefined));
}

describe('criterio 26: matriz de permisos', () => {
  it('criterio 26: la tabla esperada tiene las 23 filas del contrato (21 de la sección 2.1 más las 2 de esta historia)', () => {
    expect(PERMISOS_ESPERADOS).toHaveLength(23);
  });

  it('criterio 26: ROLES_USUARIO son exactamente ADMIN, SECRETARIA, ENTRENADOR y ALUMNO', async () => {
    const { ROLES_USUARIO } = await cargar();

    expect([...ROLES_USUARIO].sort()).toEqual([...ROLES].sort());
  });

  it('criterio 26: ALCANCES son exactamente TODO, SUS_ALUMNOS, SUS_CLASES, PROPIO, SU_CAJA, LOS_QUE_SUBE y ALUMNOS', async () => {
    const { ALCANCES } = await cargar();

    expect([...ALCANCES].sort()).toEqual(
      ['TODO', 'SUS_ALUMNOS', 'SUS_CLASES', 'PROPIO', 'SU_CAJA', 'LOS_QUE_SUBE', 'ALUMNOS'].sort(),
    );
  });

  it('criterio 26: PERMISOS y las claves de MATRIZ_PERMISOS son exactamente los 23 permisos del contrato, sin repetir', async () => {
    const { PERMISOS, MATRIZ_PERMISOS } = await cargar();

    expect([...PERMISOS].sort()).toEqual(PERMISOS_ESPERADOS);
    expect(new Set(PERMISOS).size).toBe(PERMISOS.length);
    expect(Object.keys(MATRIZ_PERMISOS).sort()).toEqual(PERMISOS_ESPERADOS);
  });

  it.each(Object.entries(MATRIZ_ESPERADA))(
    'criterio 26: la fila %s tiene exactamente los roles y alcances del contrato',
    async (permiso, esperada) => {
      const { MATRIZ_PERMISOS } = await cargar();

      expect(sinVacias(MATRIZ_PERMISOS[permiso])).toStrictEqual(esperada);
    },
  );

  it('criterio 26: los alcances de la matriz son todos alcances declarados y los roles de la matriz son todos roles declarados', async () => {
    const { MATRIZ_PERMISOS, ALCANCES, ROLES_USUARIO } = await cargar();

    for (const [permiso, fila] of Object.entries(MATRIZ_PERMISOS)) {
      for (const [rol, alcance] of Object.entries(sinVacias(fila))) {
        expect(ROLES_USUARIO, `rol ${rol} de ${permiso}`).toContain(rol);
        expect(ALCANCES, `alcance ${alcance} de ${permiso}`).toContain(alcance);
      }
    }
  });

  describe.each(Object.entries(MATRIZ_ESPERADA))('puede(rol, %s)', (permiso, esperada) => {
    it.each(ROLES.map((rol) => [rol]))(
      'criterio 26: puede(%s) es verdadero solo si la celda no está vacía',
      async (rol) => {
        const { puede } = await cargar();

        expect(puede(rol, permiso)).toBe(esperada[rol] !== undefined);
      },
    );
  });

  it('criterio 26: solo el administrador gestiona usuarios; el administrador y la secretaria restablecen contraseñas; el entrenador y el alumno ninguna', async () => {
    const { puede } = await cargar();

    expect(ROLES.filter((rol) => puede(rol, 'GESTIONAR_USUARIOS'))).toEqual(['ADMIN']);
    expect(ROLES.filter((rol) => puede(rol, 'RESTABLECER_CLAVE'))).toEqual(['ADMIN', 'SECRETARIA']);
  });

  it('criterio 26: el entrenador solo ve a sus alumnos y no verifica pagos ni abre la caja (CLAUDE.md, RN-18)', async () => {
    const { MATRIZ_PERMISOS, puede } = await cargar();

    expect(MATRIZ_PERMISOS['VER_FICHA_ALUMNO']?.ENTRENADOR).toBe('SUS_ALUMNOS');
    expect(MATRIZ_PERMISOS['EDITAR_RENDIMIENTO']?.ENTRENADOR).toBe('SUS_ALUMNOS');
    expect(puede('ENTRENADOR', 'VERIFICAR_PAGOS')).toBe(false);
    expect(puede('ENTRENADOR', 'ABRIR_CERRAR_CAJA')).toBe(false);
    expect(puede('ALUMNO', 'VERIFICAR_PAGOS')).toBe(false);
  });
});
