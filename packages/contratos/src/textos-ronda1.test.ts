// spec: 001-academias-aislamiento (pruebas protegidas)
import { describe, expect, it } from 'vitest';
import {
  crearAcademiaSchema,
  iniciarSesionPlataformaSchema,
  reactivarAcademiaSchema,
  suspenderAcademiaSchema,
} from './index';

// Criterios 76 y 77 (ataque ronda 1): las reglas de texto viven en los esquemas compartidos de `packages/contratos/`,
// para que las reutilicen la API y las historias siguientes. Aqui se prueban por el efecto observable en los
// esquemas publicos (que rechacen, nombrando el campo, y que acepten lo valido), sin depender de sus nombres internos.

/** Campos con error de un `safeParse` fallido (la ruta del error, unida con puntos). */
function camposConError(resultado: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return (resultado.error?.issues ?? []).map((issue) => issue.path.map(String).join('.'));
}

const CONTROLES = ['\u0000', '\t', '\n', '\r', '\u0001', '\u001f', '\u007f', '\u0085', '\u009f'];
const BIDI = [
  '\u061c',
  '\u200e',
  '\u200f',
  '\u202a',
  '\u202b',
  '\u202c',
  '\u202d',
  '\u202e',
  '\u2066',
  '\u2067',
].concat(['\u2068', '\u2069']);
const POCO_VISIBLES = ['\u200b'.repeat(4), 'a\u200bb', 'a b', 'a\u0301b', '\u0301\u0301\u0301\u0301', 'ab\u200d\u200d'];

describe('criterio 76: caracteres de control y sustitutos sueltos en los esquemas', () => {
  it.each(CONTROLES)('crearAcademiaSchema rechaza nombre con el control %j en medio, nombrando el campo', (c) => {
    const resultado = crearAcademiaSchema.safeParse({ nombre: `Academia${c}Delfines`, nombreCorto: 'delfines' });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('nombre');
  });

  it.each(CONTROLES)('crearAcademiaSchema rechaza nombreCorto con el control %j en medio', (c) => {
    const resultado = crearAcademiaSchema.safeParse({ nombre: 'Academia Delfines', nombreCorto: `del${c}fines` });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('nombreCorto');
  });

  it.each(CONTROLES)('suspender y reactivar rechazan un motivo con el control %j en medio', (c) => {
    const suspender = suspenderAcademiaSchema.safeParse({ motivo: `Falta${c}de pago` });
    const reactivar = reactivarAcademiaSchema.safeParse({ motivo: `Pago${c}recibido` });

    expect(suspender.success).toBe(false);
    expect(camposConError(suspender)).toContain('motivo');
    expect(reactivar.success).toBe(false);
    expect(camposConError(reactivar)).toContain('motivo');
  });

  it.each(CONTROLES)('iniciarSesionPlataformaSchema rechaza una clave con el control %j en medio', (c) => {
    const resultado = iniciarSesionPlataformaSchema.safeParse({ correo: 'a@b.co', clave: `Clave${c}Segura` });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('clave');
  });

  it.each(['\n', '\t', '\u0000', '\u007f'])(
    'iniciarSesionPlataformaSchema no recorta la clave: control %j al final es error',
    (c) => {
      expect(iniciarSesionPlataformaSchema.safeParse({ correo: 'a@b.co', clave: `ClaveSegura${c}` }).success).toBe(
        false,
      );
      expect(iniciarSesionPlataformaSchema.safeParse({ correo: 'a@b.co', clave: `${c}ClaveSegura` }).success).toBe(
        false,
      );
    },
  );

  it.each(CONTROLES)('iniciarSesionPlataformaSchema rechaza un correo con el control %j en medio', (c) => {
    const resultado = iniciarSesionPlataformaSchema.safeParse({ correo: `a${c}b@aquagestion.test`, clave: 'x' });

    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toContain('correo');
  });

  it('rechaza un sustituto UTF-16 suelto en nombre, nombreCorto, motivo, clave y correo', () => {
    const suelto = '\ud800';
    expect(
      camposConError(crearAcademiaSchema.safeParse({ nombre: `Del${suelto}fines`, nombreCorto: 'delfines' })),
    ).toContain('nombre');
    expect(
      camposConError(crearAcademiaSchema.safeParse({ nombre: 'Delfines', nombreCorto: `del${suelto}fines` })),
    ).toContain('nombreCorto');
    expect(camposConError(suspenderAcademiaSchema.safeParse({ motivo: `Falta${suelto}de pago` }))).toContain('motivo');
    expect(camposConError(reactivarAcademiaSchema.safeParse({ motivo: `Pago${suelto}recibido` }))).toContain('motivo');
    expect(
      camposConError(iniciarSesionPlataformaSchema.safeParse({ correo: 'a@b.co', clave: `x${suelto}y` })),
    ).toContain('clave');
    expect(
      camposConError(iniciarSesionPlataformaSchema.safeParse({ correo: `a${suelto}@b.co`, clave: 'x' })),
    ).toContain('correo');
  });

  it('los saltos de linea y tabuladores de los extremos se recortan antes de validar (nombre, motivo y correo)', () => {
    const academia = crearAcademiaSchema.safeParse({ nombre: '\n  Academia Ñandú \t', nombreCorto: 'delfines' });
    const motivo = suspenderAcademiaSchema.safeParse({ motivo: ' Falta de pago\n' });
    const sesion = iniciarSesionPlataformaSchema.safeParse({ correo: '\n Dueno@AquaGestion.test\t', clave: 'x' });

    expect(academia.success && academia.data.nombre).toBe('Academia Ñandú');
    expect(motivo.success && motivo.data.motivo).toBe('Falta de pago');
    expect(sesion.success && sesion.data.correo).toBe('dueno@aquagestion.test');
  });
});

describe('criterio 77: textos visibles y sin control bidireccional', () => {
  it.each(BIDI)('rechaza el control bidireccional %j en el nombre y en el motivo', (c) => {
    expect(
      camposConError(crearAcademiaSchema.safeParse({ nombre: `Delfines${c}Club`, nombreCorto: 'delfines' })),
    ).toContain('nombre');
    expect(camposConError(suspenderAcademiaSchema.safeParse({ motivo: `Falta${c}de pago` }))).toContain('motivo');
    expect(camposConError(reactivarAcademiaSchema.safeParse({ motivo: `Pago${c}recibido` }))).toContain('motivo');
  });

  it.each(['\u2028', '\u2029'])('rechaza el separador de linea o de parrafo %j en el nombre y en el motivo', (c) => {
    expect(
      camposConError(crearAcademiaSchema.safeParse({ nombre: `Delfines${c}Club`, nombreCorto: 'delfines' })),
    ).toContain('nombre');
    expect(camposConError(suspenderAcademiaSchema.safeParse({ motivo: `Falta${c}de pago` }))).toContain('motivo');
  });

  it.each(POCO_VISIBLES)('rechaza %j: menos de 3 caracteres visibles', (texto) => {
    expect(crearAcademiaSchema.safeParse({ nombre: texto, nombreCorto: 'delfines' }).success).toBe(false);
    expect(suspenderAcademiaSchema.safeParse({ motivo: texto }).success).toBe(false);
  });

  it.each(['Academia Ñandú', 'Club 3', 'A.1', '😀😀😀', 'Del\u200bfines'])(
    'acepta %j y lo guarda tal como llega, despues del recorte',
    (texto) => {
      const academia = crearAcademiaSchema.safeParse({ nombre: texto, nombreCorto: 'delfines' });
      const motivo = suspenderAcademiaSchema.safeParse({ motivo: texto });

      expect(academia.success && academia.data.nombre).toBe(texto);
      expect(motivo.success && motivo.data.motivo).toBe(texto);
    },
  );

  it('el motivo de reactivar sigue siendo opcional', () => {
    expect(reactivarAcademiaSchema.safeParse({}).success).toBe(true);
    expect(reactivarAcademiaSchema.safeParse({ motivo: 'Pago recibido' }).success).toBe(true);
  });
});
