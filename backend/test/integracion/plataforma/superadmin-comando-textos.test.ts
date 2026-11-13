// spec: 001-academias-aislamiento (pruebas protegidas)
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo, limpiarBase } from '../../utilidades/base-datos';
import { ejecutarComando } from '../../utilidades/comandos';
import { leerAuditoriaPlataforma } from '../../utilidades/datos';
import { BIDI, CONTROLES, POCO_VISIBLES, SEPARADORES } from '../../utilidades/textos';

// Criterios 76 y 77 (ataque ronda 1, O1 y O2) en el comando `npm run plataforma:superadmin`: se aplica la misma regla de
// texto a SUPERADMIN_CORREO, SUPERADMIN_NOMBRE y SUPERADMIN_CLAVE (caracteres de control en cualquier posicion), y a
// SUPERADMIN_NOMBRE ademas la de los textos visibles (criterio 77). Si no se cumple: codigo 1, la salida nombra la
// variable y no cambia nada (criterio 35); la clave nunca aparece en la salida.
//
// Un valor de variable de entorno no puede contener el caracter nulo ni un sustituto suelto (el sistema operativo y
// Node los impiden), por eso esos casos solo se prueban en la API.

const TIMEOUT = 90_000;
const CLAVE_NUEVA = 'Nueva-Clave-Segura-2026';
const VALIDAS = {
  SUPERADMIN_CORREO: 'dueno@aquagestion.test',
  SUPERADMIN_NOMBRE: 'Dueño de la plataforma',
  SUPERADMIN_CLAVE: CLAVE_NUEVA,
};

const REPRESENTATIVOS = CONTROLES.filter(([, control]) => ['\u0001', '\t', '\n', '\u007f', '\u0085'].includes(control));

async function filasDeSuperadmins(): Promise<{ id: string }[]> {
  const { rows } = await ejecutarComo('propietario', 'SELECT id FROM superadmins', [], { plataforma: true });
  return rows as { id: string }[];
}

describe('criterios 76 y 77: entradas de texto del comando plataforma:superadmin', () => {
  beforeEach(limpiarBase);

  async function esperarRechazo(
    variables: Record<string, string>,
    variable: 'SUPERADMIN_CORREO' | 'SUPERADMIN_NOMBRE' | 'SUPERADMIN_CLAVE',
  ): Promise<void> {
    const resultado = ejecutarComando('plataforma:superadmin', variables);

    expect(resultado.estado, resultado.salida).toBe(1);
    expect(resultado.salida).toContain(variable);
    if (variable !== 'SUPERADMIN_CLAVE') expect(resultado.salida).not.toContain(variables['SUPERADMIN_CLAVE'] ?? '');
    expect(resultado.salida).not.toContain(CLAVE_NUEVA);
    expect(await filasDeSuperadmins()).toEqual([]);
    expect(await leerAuditoriaPlataforma()).toEqual([]);
  }

  it.each([
    ['en medio de la clave', { SUPERADMIN_CLAVE: 'Nueva-Clave\nSegura-2026' }],
    ['en medio de la clave (tabulador)', { SUPERADMIN_CLAVE: 'Nueva-Clave\tSegura-2026' }],
    ['en medio de la clave (U+007F)', { SUPERADMIN_CLAVE: 'Nueva-Clave\u007fSegura-2026' }],
    ['en medio de la clave (U+0085)', { SUPERADMIN_CLAVE: 'Nueva-Clave\u0085Segura-2026' }],
    ['al final de la clave', { SUPERADMIN_CLAVE: 'Nueva-Clave-Segura-2026\n' }],
    ['al comienzo de la clave', { SUPERADMIN_CLAVE: '\tNueva-Clave-Segura-2026' }],
  ])(
    'criterio 76: un control %s termina con codigo 1, nombra SUPERADMIN_CLAVE y no crea nada',
    async (_caso, cambio) => {
      const resultado = ejecutarComando('plataforma:superadmin', { ...VALIDAS, ...cambio });

      expect(resultado.estado, resultado.salida).toBe(1);
      expect(resultado.salida).toContain('SUPERADMIN_CLAVE');
      expect(resultado.salida).not.toContain('Nueva-Clave');
      expect(await filasDeSuperadmins()).toEqual([]);
      expect(await leerAuditoriaPlataforma()).toEqual([]);
    },
    TIMEOUT,
  );

  it.each(REPRESENTATIVOS)(
    'criterio 76: SUPERADMIN_NOMBRE con %s en medio termina con codigo 1, nombra la variable y no crea nada',
    async (_nombre, control) => {
      await esperarRechazo({ ...VALIDAS, SUPERADMIN_NOMBRE: `Dueño${control}plataforma` }, 'SUPERADMIN_NOMBRE');
    },
    TIMEOUT,
  );

  it.each([
    ['salto de linea', 'dueno\n@aquagestion.test'],
    ['tabulador', 'dueno\t@aquagestion.test'],
    ['U+007F', 'dueno\u007f@aquagestion.test'],
    ['U+0085 al final', 'dueno@aquagestion.test\u0085'],
  ])(
    'criterio 76: SUPERADMIN_CORREO con %s termina con codigo 1, nombra la variable y no crea nada',
    async (_caso, correo) => {
      await esperarRechazo({ ...VALIDAS, SUPERADMIN_CORREO: correo }, 'SUPERADMIN_CORREO');
    },
    TIMEOUT,
  );

  it(
    'criterio 76: con un control en la clave no modifica un superadmin existente (criterio 35)',
    async () => {
      expect(ejecutarComando('plataforma:superadmin', VALIDAS).estado).toBe(0);
      const antes = await ejecutarComo('propietario', 'SELECT * FROM superadmins', [], { plataforma: true });
      const auditoriaAntes = await leerAuditoriaPlataforma();

      const resultado = ejecutarComando('plataforma:superadmin', {
        ...VALIDAS,
        SUPERADMIN_CLAVE: 'Otra-Clave\nSegura-2026',
      });

      expect(resultado.estado, resultado.salida).toBe(1);
      expect(resultado.salida).toContain('SUPERADMIN_CLAVE');
      const despues = await ejecutarComo('propietario', 'SELECT * FROM superadmins', [], { plataforma: true });
      expect(despues.rows).toEqual(antes.rows);
      expect(await leerAuditoriaPlataforma()).toEqual(auditoriaAntes);
    },
    TIMEOUT,
  );

  it.each<[string, string]>([
    ...BIDI.slice(4, 8).map(
      ([nombre, c]) => [`control bidireccional ${nombre}`, `Dueño${c}plataforma`] as [string, string],
    ),
    ['control bidireccional al final (ejemplo de la spec)', 'Delfines\u202e'],
    ['control bidireccional envolviendo el texto (ejemplo de la spec)', '\u2066Delfines\u2069'],
    ...SEPARADORES.map(([nombre, c]) => [nombre, `Dueño${c}plataforma`] as [string, string]),
    ...POCO_VISIBLES.slice(0, 5).map(
      ([nombre, texto]) => [`menos de 3 visibles: ${nombre}`, texto] as [string, string],
    ),
  ])(
    'criterio 77: SUPERADMIN_NOMBRE con %s termina con codigo 1, nombra la variable y no crea nada',
    async (_caso, nombre) => {
      await esperarRechazo({ ...VALIDAS, SUPERADMIN_NOMBRE: nombre }, 'SUPERADMIN_NOMBRE');
    },
    TIMEOUT,
  );

  it(
    'criterio 77: SUPERADMIN_NOMBRE "Club 3" (letras, numero y espacio) se acepta y se guarda tal cual',
    async () => {
      const resultado = ejecutarComando('plataforma:superadmin', { ...VALIDAS, SUPERADMIN_NOMBRE: 'Club 3' });

      expect(resultado.estado, resultado.salida).toBe(0);
      const { rows } = await ejecutarComo('propietario', 'SELECT nombre FROM superadmins', [], { plataforma: true });
      expect(rows).toEqual([{ nombre: 'Club 3' }]);
    },
    TIMEOUT,
  );
});
