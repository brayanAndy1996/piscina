import path from 'node:path';
import { leerNodeEnv, type NodeEnv } from './node-env';
import { parametrosDeConexionProhibidos } from './url-postgres';

/** Variables de entorno que lee la API, ya validadas. La API ya no lee `DATABASE_URL` (spec 001, criterio 5). */
export interface Entorno {
  /** Conexión del rol `aquagestion_app`, sin privilegios y sujeto a la seguridad por academia (RLS). */
  readonly DATABASE_URL_APP: string;
  /** Conexiones simultáneas de la API a la base (1 a 100, por defecto 10). */
  readonly DATABASE_POOL_MAX: number;
  /** Secreto para firmar las sesiones: al menos 32 caracteres. */
  readonly JWT_SECRETO: string;
  readonly PUERTO_API: number;
  /** Ausente (se comporta fuera de producción) o exactamente `development`, `test` o `production` (criterio 78). */
  readonly NODE_ENV: NodeEnv | undefined;
  /**
   * Carpeta donde el almacén de disco local guarda los archivos (las fotos, spec 005b; D-21). Siempre una ruta absoluta: una ruta relativa se
   * toma desde la raíz del repositorio (donde está el `.env`). Por defecto, `backend/almacenamiento`, que git ignora.
   */
  readonly ALMACEN_DIRECTORIO: string;
}

/** Error de configuración: agrupa los problemas encontrados. Los mensajes nombran la variable, nunca su valor. */
export class ErrorEntorno extends Error {
  constructor(readonly problemas: readonly string[]) {
    super(`Configuración inválida:\n${problemas.map((problema) => `- ${problema}`).join('\n')}`);
    this.name = 'ErrorEntorno';
  }
}

/**
 * Valor de `JWT_SECRETO` en `.env.example`. Es público: con `NODE_ENV=production` la API se niega a usarlo. Una
 * prueba unitaria comprueba que coincide con `.env.example`.
 */
export const JWT_SECRETO_DE_EJEMPLO = 'solo-desarrollo-cambia-este-secreto-de-ejemplo-0001';

/**
 * Secretos públicos del repositorio (criterio 79): el de `.env.example`, `JWT_SECRETO_PRUEBAS` de las utilidades de
 * prueba (`backend/test/utilidades/aplicacion.ts`) y el de respaldo de `e2e/playwright.config.ts`. Con
 * `NODE_ENV=production` la API se niega a usarlos. Una prueba unitaria comprueba que coinciden con esos archivos.
 */
export const JWT_SECRETOS_PUBLICOS: readonly string[] = [
  JWT_SECRETO_DE_EJEMPLO,
  'secreto-solo-para-pruebas-de-aquagestion-0123456789',
  'secreto-solo-para-pruebas-e2e-de-aquagestion-0123456789',
];

/** La raíz del repositorio (donde vive el `.env`): desde `src/infraestructura/entorno/` queda cuatro carpetas arriba. */
const RAIZ_DEL_REPOSITORIO = path.resolve(__dirname, '..', '..', '..', '..');
const ALMACEN_DIRECTORIO_POR_DEFECTO = ['backend', 'almacenamiento'];
/** Las carpetas que sirve la web (o copia al compilar): las mismas de `server.fs.allow` de `frontend/vite.config.ts`, con `packages/` entera. */
const CARPETAS_DE_LA_WEB = ['frontend', 'packages', 'node_modules'];

const PUERTO_API_POR_DEFECTO = 3000;
const POOL_MAXIMO_POR_DEFECTO = 10;
const POOL_MINIMO = 1;
const POOL_MAXIMO = 100;
const JWT_SECRETO_LARGO_MINIMO = 32;
const JWT_SECRETO_DISTINTOS_MINIMO = 10;

function esUrlPostgres(valor: string): boolean {
  try {
    const { protocol } = new URL(valor);
    return protocol === 'postgresql:' || protocol === 'postgres:';
  } catch {
    return false;
  }
}

const ALMACEN_NO_ES_RUTA = 'La variable ALMACEN_DIRECTORIO no es una ruta válida.';
const ALMACEN_DENTRO_DE_LA_WEB =
  'La variable ALMACEN_DIRECTORIO no puede estar dentro de las carpetas que sirve la web.';
/** Nombre corto 8.3 de Windows (`NODE_M~1`, `NODE_M~1.JS`): la misma expresión que usa Vite para rechazarlos. */
const NOMBRE_CORTO_8_3 = /^[^~.]{1,6}~\d+(\.[^~.]{0,3})?$/;

/** ¿Trae un carácter de control (U+0000 a U+001F)? Se mira por código y no con una expresión regular. */
function tieneCaracterDeControl(valor: string): boolean {
  for (let i = 0; i < valor.length; i += 1) if (valor.charCodeAt(i) <= 0x1f) return true;
  return false;
}

/**
 * Formas que Windows acepta y `path.relative` no entiende (criterio 66 b): prefijos con dos separadores (`\\?\`, `\\.\`, rutas de red),
 * `<>"|?*` (también cubre `\??\`), `:` fuera de la unidad del principio (flujos alternativos, rutas relativas a una unidad) y segmentos
 * que terminan en punto o en espacio (Windows los quita: `frontend.\public` es `frontend\public`).
 */
function esFormaInvalidaDeWindows(valor: string): boolean {
  if (/^[\\/]{2}/.test(valor)) return true;
  if (/[<>"|?*]/.test(valor)) return true;
  if (valor.replace(/^[A-Za-z]:(?=[\\/])/, '').includes(':')) return true;
  return valor.split(/[\\/]/).some((segmento) => segmento !== '.' && segmento !== '..' && /[. ]$/.test(segmento));
}

/** Raíz (unidad o `/`) y segmentos de una ruta ya resuelta, en minúsculas: la comparación no distingue mayúsculas en ningún sistema. */
function partesDeLaRuta(ruta: path.PlatformPath, resuelta: string): { raiz: string; segmentos: string[] } {
  const { root } = ruta.parse(resuelta);
  return {
    raiz: root.toLowerCase(),
    segmentos: resuelta
      .slice(root.length)
      .split(ruta.sep)
      .filter((segmento) => segmento !== '')
      .map((segmento) => segmento.toLowerCase()),
  };
}

/**
 * ¿La ruta es la carpeta o queda debajo? Compara por segmentos, sin distinguir mayúsculas. Con `path.win32`, un segmento de la ruta con
 * forma de nombre corto 8.3 coincide con cualquier segmento de la carpeta en esa posición (`NODE_M~1` puede ser `node_modules`).
 */
function estaDentroDe(ruta: path.PlatformPath, carpeta: string, resuelta: string): boolean {
  const de = partesDeLaRuta(ruta, carpeta);
  const en = partesDeLaRuta(ruta, resuelta);
  if (de.raiz !== en.raiz || en.segmentos.length < de.segmentos.length) return false;
  const conNombresCortos = ruta === path.win32;
  return de.segmentos.every(
    (segmento, i) => segmento === en.segmentos[i] || (conNombresCortos && NOMBRE_CORTO_8_3.test(en.segmentos[i] ?? '')),
  );
}

/**
 * Resuelve `ALMACEN_DIRECTORIO` y rechaza lo que la web serviría (criterio 66, decisión AB2-3). Es pura: `ruta` es `path.win32` o
 * `path.posix`, así se prueba igual en cualquier sistema. Un solo problema por valor, en este orden: carácter de control, formas de Windows
 * (solo con `path.win32`), carpetas de la web. Los problemas nombran la variable y no muestran la ruta.
 */
export function resolverAlmacenDirectorio(
  valor: string | undefined,
  opciones: { raiz: string; ruta: path.PlatformPath },
): { directorio: string } | { problema: string } {
  const { raiz, ruta } = opciones;
  const texto = valor?.trim() ?? '';
  if (tieneCaracterDeControl(texto)) return { problema: ALMACEN_NO_ES_RUTA };
  if (ruta === path.win32 && esFormaInvalidaDeWindows(texto)) return { problema: ALMACEN_NO_ES_RUTA };
  const directorio = ruta.resolve(raiz, texto || ruta.join(...ALMACEN_DIRECTORIO_POR_DEFECTO));
  if (CARPETAS_DE_LA_WEB.some((carpeta) => estaDentroDe(ruta, ruta.join(raiz, carpeta), directorio))) {
    return { problema: ALMACEN_DENTRO_DE_LA_WEB };
  }
  return { directorio };
}

/** Reglas de `JWT_SECRETO` en producción (criterio 79). Los caracteres se cuentan por punto de código. */
function esSecretoRobusto(secreto: string): boolean {
  if (JWT_SECRETOS_PUBLICOS.includes(secreto)) return false;
  if (/\s/u.test(secreto)) return false;
  const caracteres = [...secreto];
  return caracteres.length >= JWT_SECRETO_LARGO_MINIMO && new Set(caracteres).size >= JWT_SECRETO_DISTINTOS_MINIMO;
}

function esPuertoValido(valor: string): boolean {
  if (!/^\d+$/.test(valor)) return false;
  const numero = Number(valor);
  return numero >= 1 && numero <= 65535;
}

function esPoolValido(valor: string): boolean {
  if (!/^\d+$/.test(valor)) return false;
  const numero = Number(valor);
  return numero >= POOL_MINIMO && numero <= POOL_MAXIMO;
}

/**
 * Valida las variables de entorno de la API. Es una función pura: recibe el entorno y devuelve la configuración
 * o lanza `ErrorEntorno`. Nunca incluye valores de variables en los mensajes.
 */
export function validarEntorno(env: Readonly<Record<string, string | undefined>>): Entorno {
  const problemas: string[] = [];

  const urlApp = env['DATABASE_URL_APP']?.trim();
  if (!urlApp) {
    problemas.push('Falta la variable DATABASE_URL_APP.');
  } else if (!esUrlPostgres(urlApp)) {
    problemas.push('La variable DATABASE_URL_APP debe ser una URL de PostgreSQL (postgresql:// o postgres://).');
  } else {
    const prohibidos = parametrosDeConexionProhibidos(urlApp);
    if (prohibidos.length > 0) {
      problemas.push(
        `La variable DATABASE_URL_APP no puede llevar ${prohibidos.length === 1 ? 'el parámetro' : 'los parámetros'} ${prohibidos.join(', ')} en la cadena de consulta: el usuario, el servidor y la base van en la parte principal de la URL.`,
      );
    }
  }

  const lecturaNodeEnv = leerNodeEnv(env);
  if (!lecturaNodeEnv.ok) problemas.push(lecturaNodeEnv.problema);
  const nodeEnv = lecturaNodeEnv.ok ? lecturaNodeEnv.valor : undefined;

  const secreto = env['JWT_SECRETO'];
  if (!secreto) {
    problemas.push('Falta la variable JWT_SECRETO.');
  } else if (secreto.length < JWT_SECRETO_LARGO_MINIMO) {
    problemas.push(`La variable JWT_SECRETO debe tener al menos ${JWT_SECRETO_LARGO_MINIMO} caracteres.`);
  } else if (nodeEnv === 'production' && !esSecretoRobusto(secreto)) {
    problemas.push(
      `La variable JWT_SECRETO no es segura para producción: no puede ser un secreto público del repositorio, ni tener espacios, ni menos de ${JWT_SECRETO_LARGO_MINIMO} caracteres, ni menos de ${JWT_SECRETO_DISTINTOS_MINIMO} caracteres distintos. Genera uno largo y aleatorio.`,
    );
  }

  const poolTexto = env['DATABASE_POOL_MAX']?.trim();
  let pool = POOL_MAXIMO_POR_DEFECTO;
  if (poolTexto) {
    if (esPoolValido(poolTexto)) pool = Number(poolTexto);
    else
      problemas.push(`La variable DATABASE_POOL_MAX debe ser un número entero entre ${POOL_MINIMO} y ${POOL_MAXIMO}.`);
  }

  const puertoTexto = env['PUERTO_API']?.trim();
  let puerto = PUERTO_API_POR_DEFECTO;
  if (puertoTexto) {
    if (esPuertoValido(puertoTexto)) puerto = Number(puertoTexto);
    else problemas.push('La variable PUERTO_API debe ser un número entero entre 1 y 65535.');
  }

  const almacen = resolverAlmacenDirectorio(env['ALMACEN_DIRECTORIO'], { raiz: RAIZ_DEL_REPOSITORIO, ruta: path });
  let almacenDirectorio = '';
  if ('problema' in almacen) problemas.push(almacen.problema);
  else almacenDirectorio = almacen.directorio;

  if (problemas.length > 0 || !urlApp || !secreto) throw new ErrorEntorno(problemas);
  return {
    DATABASE_URL_APP: urlApp,
    DATABASE_POOL_MAX: pool,
    JWT_SECRETO: secreto,
    PUERTO_API: puerto,
    NODE_ENV: nodeEnv,
    ALMACEN_DIRECTORIO: almacenDirectorio,
  };
}
