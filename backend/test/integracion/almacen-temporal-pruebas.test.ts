import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validarEntorno } from '../../src/infraestructura/entorno';
import { crearEntornoDePruebas, JWT_SECRETO_PRUEBAS } from '../utilidades/aplicacion';
import { urlAppPruebas } from '../utilidades/base-datos';

// Criterio 63 de la 005 (no crítico; D-26; ataque ronda 1 de la 005b, observación): las pruebas automatizadas no escriben en el almacén de desarrollo.
// Las pruebas del backend corren con `ALMACEN_DIRECTORIO` en un directorio temporal fuera del repositorio, creado para la ejecución y borrado al
// terminar, aunque una prueba cree la aplicación sin reemplazar el `AlmacenArchivos`. (La configuración de Playwright la comprueba el revisor.)

// La raíz del repositorio: este archivo está en backend/test/integracion/.
const RAIZ_DEL_REPOSITORIO = path.resolve(__dirname, '..', '..', '..');

describe('almacén de archivos de las pruebas del backend (criterio 63 a)', () => {
  it('criterio 63 a: validarEntorno(process.env).ALMACEN_DIRECTORIO, en el proceso de las pruebas, queda fuera de la raíz del repositorio', () => {
    const entorno = validarEntorno({
      DATABASE_URL_APP: urlAppPruebas(),
      JWT_SECRETO: JWT_SECRETO_PRUEBAS,
      ...process.env,
    });

    const relativa = path.relative(RAIZ_DEL_REPOSITORIO, entorno.ALMACEN_DIRECTORIO);
    const dentro = relativa === '' || (!relativa.startsWith('..') && !path.isAbsolute(relativa));
    expect(dentro, `el almacén de las pruebas (${entorno.ALMACEN_DIRECTORIO}) cae dentro del repositorio`).toBe(false);
    expect(
      process.env['ALMACEN_DIRECTORIO'],
      'la configuración de las pruebas no fija ALMACEN_DIRECTORIO',
    ).toBeTruthy();
  });

  it('criterio 63 a: crearEntornoDePruebas().ALMACEN_DIRECTORIO (el de la aplicación que crea una prueba sin reemplazar el almacén) queda fuera de la raíz del repositorio', () => {
    const entorno = crearEntornoDePruebas();

    const relativa = path.relative(RAIZ_DEL_REPOSITORIO, entorno.ALMACEN_DIRECTORIO);
    const dentro = relativa === '' || (!relativa.startsWith('..') && !path.isAbsolute(relativa));
    expect(
      dentro,
      `la aplicación de las pruebas usaría el almacén ${entorno.ALMACEN_DIRECTORIO}, dentro del repositorio`,
    ).toBe(false);
  });

  it('criterio 63 a: el directorio temporal existe durante la ejecución', () => {
    const directorio = process.env['ALMACEN_DIRECTORIO'];

    expect(directorio, 'la configuración de las pruebas no fija ALMACEN_DIRECTORIO').toBeTruthy();
    expect(fs.existsSync(directorio as string)).toBe(true);
    expect(fs.statSync(directorio as string).isDirectory()).toBe(true);
  });
});
