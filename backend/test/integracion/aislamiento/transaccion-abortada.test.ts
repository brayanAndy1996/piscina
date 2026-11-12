// spec: 001-academias-aislamiento (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { errorApiSchema } from '@aquagestion/contratos';
import { Controller, Get, Param, type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAppDePruebas } from '../../utilidades/aplicacion';
import { limpiarBase, urlAppPruebas } from '../../utilidades/base-datos';
import { crearDatosDeAislamiento, type DatosDeAislamiento } from '../../utilidades/datos';
import { crearDestinoDeRegistro, obtenerAuditoria, type AuditoriaServicePrueba } from '../../utilidades/modulos';
import {
  correrVariante,
  esperarConexionSana,
  esperarFalloPosterior,
  esperarRechazoPropio,
  esperarTransaccionAbortada,
  leerEscritoDeAcademia,
  leerEscritoDePlataforma,
  NADA,
  pasosDeAcademia,
  pasosDePlataforma,
  resultadoDe,
  SENTINELA,
  siguienteNumero,
  TODO,
  VALOR,
  VARIANTES_149,
  type Escrito,
  type Seguimiento,
  type Variante,
} from '../../utilidades/ronda10';
import { obtenerBaseDatosRonda3, type BaseDatosRonda3 } from '../../utilidades/ronda3';
import { cargarPuntoAutorizado } from '../../utilidades/ronda4';

// Criterios 149 y 151 (ataque ronda 10, F1): una transaccion abortada nunca se reporta como confirmada en `BaseDatos`.
//
// 149: dentro de `trabajo`, una sentencia falla, `trabajo` atrapa el error y termina bien (o envia una consulta sin `await` que falla
// despues de que `trabajo` termino). PostgreSQL deja la transaccion abortada y el `COMMIT` de Prisma recibe la etiqueta ROLLBACK sin
// error: `conAcademia` y `comoPlataforma` debian resolver con el valor de `trabajo` y todo lo escrito (tambien la auditoria) se habia
// perdido. Ahora rechazan con `ErrorTransaccionAbortada` (P-36; 500 ERROR_INTERNO en la API) y no queda nada escrito. En cada variante
// `trabajo` primero escribe (en `conAcademia(A, ...)`: una fila nueva de `configuraciones` con la clave `prueba_r10_<n>` y un registro con
// `registrarEnAcademia`; en `comoPlataforma`: una academia nueva `prueba-r10-<n>` y un registro con `registrarEnPlataforma`) y despues
// devuelve un valor reconocible. Variantes: 1 reintento que atrapa `esViolacionDeUnicidad` tras la escritura; 2 `SELECT 1/0` atrapado con
// `try`/`catch` vacio y con `.catch(() => undefined)`; 3 consulta sin `await` que tarda ~200 ms y luego falla (cruda y de un modelo);
// 4 la ruta de un controlador de prueba que llama a `comoPlataforma` con la variante 1 responde 500 ERROR_INTERNO. Controles: el mismo
// `trabajo` sin el paso que falla resuelve con el valor y las filas quedan; un `trabajo` que relanza el error atrapado rechaza con ese error
// (23505 o 22012), no con `ErrorTransaccionAbortada`; y con `DATABASE_POOL_MAX=1`, despues de cada variante, un `conAcademia(B, ...)` en la
// misma conexion resuelve, lee su propio contexto (criterio 23) y no ve nada de la variante.
//
// 151: un `ROLLBACK` (en `conAcademia`, `comoPlataforma`) o un `COMMIT` (en `conAcademia`) escritos dentro de `trabajo` con `$executeRaw`
// tambien rechazan con `ErrorTransaccionAbortada`; tras el `ROLLBACK` no queda nada escrito (tras el `COMMIT`, lo escrito antes queda
// confirmado y la prueba no exige lo contrario). Control de la marca: una variable `app.transaccion` fijada a nivel de sesion por un `trabajo`
// anterior en la misma conexion (`set_config(..., false)`, `DATABASE_POOL_MAX=1`) no hace pasar la comprobacion tras un `ROLLBACK`.
// El lint ya prohibe estas sentencias en el codigo; la prueba las ejecuta para comprobar la segunda capa.
//
// Una sola API de pruebas con `DATABASE_POOL_MAX=1` para todo el archivo (nestjs-pino crea un unico registrador por proceso: la primera
// aplicacion es la que tiene el destino de registros que se inspecciona).

type Contexto = 'conAcademia' | 'comoPlataforma';

interface Corrida {
  readonly n: number;
  readonly seguimiento: Seguimiento;
  readonly llamada: () => Promise<string>;
  readonly leer: () => Promise<Escrito>;
}

const { destino, lineas } = crearDestinoDeRegistro();

let app: NestExpressApplication;
let base: BaseDatosRonda3;
let auditoria: AuditoriaServicePrueba;
let datos: DatosDeAislamiento;

/** Controlador de prueba (opcion `controladores` de `crearAppDePruebas`): llama a `BaseDatos` con las variantes del criterio 149. */
function crearControladorDePrueba(): Type<unknown> {
  @Controller('prueba-r10')
  class ControladorPruebaR10 {
    @Get('plataforma/:n')
    async plataforma(@Param('n') n: string): Promise<{ valor: string }> {
      const numero = Number(n);
      const valor = await base.comoPlataforma((tx) =>
        correrVariante('unicidad', pasosDePlataforma(auditoria, tx, numero)),
      );
      return { valor };
    }

    @Get('plataforma-ok/:n')
    async plataformaSinFallo(@Param('n') n: string): Promise<{ valor: string }> {
      const numero = Number(n);
      const valor = await base.comoPlataforma((tx) =>
        correrVariante('sin-fallo', pasosDePlataforma(auditoria, tx, numero)),
      );
      return { valor };
    }

    @Get('academia/:id/:n')
    async academia(@Param('id') id: string, @Param('n') n: string): Promise<{ valor: string }> {
      const numero = Number(n);
      const valor = await base.conAcademia(id, (tx) =>
        correrVariante('unicidad', pasosDeAcademia(auditoria, tx, numero)),
      );
      return { valor };
    }
  }
  return ControladorPruebaR10;
}

function corridaDe(contexto: Contexto, variante: Variante, errorPropio?: Error): Corrida {
  const n = siguienteNumero();
  const seguimiento: Seguimiento = errorPropio === undefined ? {} : { errorPropio };
  if (contexto === 'conAcademia') {
    return {
      n,
      seguimiento,
      llamada: () =>
        base.conAcademia(datos.A.id, (tx) => correrVariante(variante, pasosDeAcademia(auditoria, tx, n), seguimiento)),
      leer: () => leerEscritoDeAcademia(datos.A.id, n),
    };
  }
  return {
    n,
    seguimiento,
    llamada: () =>
      base.comoPlataforma((tx) => correrVariante(variante, pasosDePlataforma(auditoria, tx, n), seguimiento)),
    leer: () => leerEscritoDePlataforma(n),
  };
}

const CONTEXTOS: readonly Contexto[] = ['conAcademia', 'comoPlataforma'];

beforeAll(async () => {
  app = await crearAppDePruebas({
    nivelRegistro: 'info',
    destinoRegistro: destino,
    variables: { DATABASE_POOL_MAX: '1' },
    controladores: [crearControladorDePrueba()],
  });
  base = await obtenerBaseDatosRonda3(app);
  auditoria = await obtenerAuditoria(app);
});
beforeEach(async () => {
  await limpiarBase();
  datos = await crearDatosDeAislamiento();
});
afterAll(async () => {
  await app?.close();
});

describe.each(CONTEXTOS)('criterio 149: %s no reporta como confirmada una transaccion abortada', (contexto) => {
  for (const { variante, titulo } of VARIANTES_149) {
    describe(`criterio 149, ${titulo}`, () => {
      it(`criterio 149: ${contexto} rechaza con ErrorTransaccionAbortada y no devuelve el valor de trabajo`, async () => {
        const corrida = corridaDe(contexto, variante);

        const resultado = await resultadoDe(corrida.llamada);

        await esperarTransaccionAbortada(resultado, `${contexto}, ${titulo}`);
      });

      it(`criterio 149: ${contexto}, leido como duenio con una conexion nueva no queda nada: ni la fila o la academia ni el registro de auditoria`, async () => {
        const corrida = corridaDe(contexto, variante);

        await resultadoDe(corrida.llamada);

        expect(await corrida.leer()).toEqual(NADA);
      });

      it(`criterio 149: ${contexto}, con DATABASE_POOL_MAX=1 la conexion queda sana: conAcademia(B) resuelve, lee su contexto y no ve nada de la variante`, async () => {
        const corrida = corridaDe(contexto, variante);

        await resultadoDe(corrida.llamada);

        await esperarConexionSana(base, datos.B.id, `${contexto}, ${titulo}`);
      });
    });
  }

  it(`criterio 149 (premisa de la variante 3): ${contexto}, trabajo termina antes de que la consulta enviada sin await falle`, async () => {
    const corrida = corridaDe(contexto, 'sin-await-cruda');

    await resultadoDe(corrida.llamada);

    await esperarFalloPosterior(corrida.seguimiento);
  });
});

describe.each(CONTEXTOS)('criterio 149 (controles): %s', (contexto) => {
  it(`criterio 149 (control): ${contexto}, el mismo trabajo sin el paso que falla resuelve con el valor y las filas quedan`, async () => {
    const corrida = corridaDe(contexto, 'sin-fallo');

    const resultado = await resultadoDe(corrida.llamada);

    expect(resultado).toEqual({ resolvio: true, valor: VALOR });
    expect(await corrida.leer()).toEqual(TODO);
  });

  it(`criterio 149 (control): ${contexto}, una consulta sin await que no falla no hace rechazar la transaccion: resuelve con el valor y las filas quedan`, async () => {
    const corrida = corridaDe(contexto, 'sin-await-ok');

    const resultado = await resultadoDe(corrida.llamada);

    expect(resultado).toEqual({ resolvio: true, valor: VALOR });
    expect(await corrida.leer()).toEqual(TODO);
  });

  it(`criterio 149 (control): ${contexto}, un trabajo que relanza el error de unicidad atrapado rechaza con ese error (23505), no con ErrorTransaccionAbortada`, async () => {
    const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
    const corrida = corridaDe(contexto, 'relanza-unicidad');

    const resultado = await resultadoDe(corrida.llamada);

    const error = esperarRechazoPropio(resultado, `${contexto}, relanza la unicidad`);
    expect(codigoDeErrorDeBase(error)).toBe('23505');
    expect(await corrida.leer()).toEqual(NADA);
    await esperarConexionSana(base, datos.B.id, `${contexto}, relanza la unicidad`);
  });

  it(`criterio 149 (control): ${contexto}, un trabajo que relanza SELECT 1/0 rechaza con ese error (22012), no con ErrorTransaccionAbortada`, async () => {
    const { codigoDeErrorDeBase } = await cargarPuntoAutorizado();
    const corrida = corridaDe(contexto, 'relanza-division');

    const resultado = await resultadoDe(corrida.llamada);

    const error = esperarRechazoPropio(resultado, `${contexto}, relanza SELECT 1/0`);
    expect(codigoDeErrorDeBase(error)).toBe('22012');
    expect(await corrida.leer()).toEqual(NADA);
    await esperarConexionSana(base, datos.B.id, `${contexto}, relanza SELECT 1/0`);
  });

  it(`criterio 149 (control, criterio 22): ${contexto}, un trabajo que atrapa SELECT 1/0 y despues lanza un error propio rechaza con ese mismo error`, async () => {
    const propio = new Error('error propio de la prueba r10');
    const corrida = corridaDe(contexto, 'relanza-propio', propio);

    const resultado = await resultadoDe(corrida.llamada);

    expect(resultado.resolvio).toBe(false);
    expect(resultado.error).toBe(propio);
    expect(await corrida.leer()).toEqual(NADA);
    await esperarConexionSana(base, datos.B.id, `${contexto}, error propio`);
  });
});

describe('criterio 149 (control): resolverAcademia sigue resolviendo', () => {
  it('criterio 149 (control): resolverAcademia devuelve la academia existente y null para una inexistente', async () => {
    const existente = await base.resolverAcademia(datos.A.nombreCorto);
    const inexistente = await base.resolverAcademia('no-existe-r10');

    expect(existente?.id).toBe(datos.A.id);
    expect(existente?.nombreCorto).toBe(datos.A.nombreCorto);
    expect(inexistente).toBeNull();
  });
});

describe('criterio 149, variante 4: por la API', () => {
  it('criterio 149: GET de una ruta de prueba que llama a comoPlataforma con la variante 1 responde 500 ERROR_INTERNO con el formato comun de error', async () => {
    const n = siguienteNumero();

    const respuesta = await request(app.getHttpServer()).get(`/api/prueba-r10/plataforma/${n}`);

    expect(respuesta.status).toBe(500);
    const cuerpo = errorApiSchema.parse(respuesta.body);
    expect(cuerpo.codigo).toBe('ERROR_INTERNO');
    const texto = JSON.stringify(respuesta.body);
    expect(texto).not.toContain('ErrorTransaccionAbortada');
    expect(texto).not.toContain('25P02');
    expect(texto).not.toContain(SENTINELA);
  });

  it('criterio 149: tras la respuesta 500 de la ruta de plataforma, ni la academia ni su registro de auditoria existen', async () => {
    const n = siguienteNumero();

    await request(app.getHttpServer()).get(`/api/prueba-r10/plataforma/${n}`);

    expect(await leerEscritoDePlataforma(n)).toEqual(NADA);
  });

  it('criterio 149: GET de una ruta de prueba que llama a conAcademia con la variante 1 responde 500 ERROR_INTERNO y no queda nada escrito', async () => {
    const n = siguienteNumero();

    const respuesta = await request(app.getHttpServer()).get(`/api/prueba-r10/academia/${datos.A.id}/${n}`);

    expect(respuesta.status).toBe(500);
    expect(errorApiSchema.parse(respuesta.body).codigo).toBe('ERROR_INTERNO');
    expect(await leerEscritoDeAcademia(datos.A.id, n)).toEqual(NADA);
  });

  it('criterio 149 (control): la misma ruta sin el paso que falla responde 200 con el valor y la academia y su registro quedan', async () => {
    const n = siguienteNumero();

    const respuesta = await request(app.getHttpServer()).get(`/api/prueba-r10/plataforma-ok/${n}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ valor: VALOR });
    expect(await leerEscritoDePlataforma(n)).toEqual(TODO);
  });

  it('criterio 149: despues de la respuesta 500 la conexion sigue sana (DATABASE_POOL_MAX=1)', async () => {
    const n = siguienteNumero();

    await request(app.getHttpServer()).get(`/api/prueba-r10/plataforma/${n}`);

    await esperarConexionSana(base, datos.B.id, 'despues de la ruta que responde 500');
  });
});

describe('criterio 149: registro tecnico del rechazo', () => {
  /** Registros nuevos (despues de `desde`) que genero la llamada. */
  async function registrosDe(
    llamada: () => Promise<unknown>,
  ): Promise<{ texto: string; nivel: number; mensaje: string }[]> {
    const desde = lineas.length;
    await resultadoDe(llamada);
    await new Promise((resolver) => setTimeout(resolver, 150));
    return lineas.slice(desde).map((linea) => {
      const registro = JSON.parse(linea) as { level?: number; msg?: string };
      return { texto: linea, nivel: registro.level ?? 0, mensaje: registro.msg ?? '' };
    });
  }

  it('criterio 149: el rechazo se registra (nivel warn o error) diciendo que la transaccion quedo abortada', async () => {
    const corrida = corridaDe('comoPlataforma', 'unicidad');

    const registros = await registrosDe(corrida.llamada);

    expect(
      registros.some((registro) => registro.nivel >= 40 && /abortad/i.test(registro.mensaje)),
      `ningun registro de nivel warn o error dice que la transaccion quedo abortada; mensajes: ${JSON.stringify(registros.map((r) => r.mensaje))}`,
    ).toBe(true);
  });

  it('criterio 149: el registro tecnico no lleva los parametros de las consultas, ni la URL ni la contrasena de la base', async () => {
    const corrida = corridaDe('comoPlataforma', 'unicidad');
    const url = new URL(urlAppPruebas());

    const registros = await registrosDe(corrida.llamada);

    const texto = registros.map((registro) => registro.texto).join('\n');
    expect(texto).not.toContain(SENTINELA);
    expect(texto).not.toContain(urlAppPruebas());
    if (url.password !== '') expect(texto).not.toContain(decodeURIComponent(url.password));
  });
});

describe('criterio 151: un ROLLBACK o un COMMIT escritos dentro de trabajo tampoco se reportan como exito', () => {
  describe.each(CONTEXTOS)('ROLLBACK en %s', (contexto) => {
    it(`criterio 151: ${contexto}, trabajo escribe, ejecuta ROLLBACK con $executeRaw y devuelve un valor: rechaza con ErrorTransaccionAbortada`, async () => {
      const corrida = corridaDe(contexto, 'rollback');

      const resultado = await resultadoDe(corrida.llamada);

      await esperarTransaccionAbortada(resultado, `${contexto}, ROLLBACK escrito`);
    });

    it(`criterio 151: ${contexto}, tras el ROLLBACK escrito no queda nada escrito`, async () => {
      const corrida = corridaDe(contexto, 'rollback');

      await resultadoDe(corrida.llamada);

      expect(await corrida.leer()).toEqual(NADA);
    });

    it(`criterio 151: ${contexto}, tras el ROLLBACK escrito un conAcademia(B) en la misma conexion resuelve con su propio contexto`, async () => {
      const corrida = corridaDe(contexto, 'rollback');

      await resultadoDe(corrida.llamada);

      await esperarConexionSana(base, datos.B.id, `${contexto}, ROLLBACK escrito`);
    });
  });

  describe('COMMIT en conAcademia', () => {
    it('criterio 151: conAcademia(A), trabajo escribe, ejecuta COMMIT con $executeRaw y devuelve un valor: rechaza con ErrorTransaccionAbortada', async () => {
      const corrida = corridaDe('conAcademia', 'commit');

      const resultado = await resultadoDe(corrida.llamada);

      await esperarTransaccionAbortada(resultado, 'conAcademia, COMMIT escrito');
    });

    it('criterio 151: tras el COMMIT escrito un conAcademia(B) en la misma conexion resuelve con su propio contexto', async () => {
      const corrida = corridaDe('conAcademia', 'commit');

      await resultadoDe(corrida.llamada);

      await esperarConexionSana(base, datos.B.id, 'conAcademia, COMMIT escrito');
    });
  });

  describe('control de la marca', () => {
    /**
     * Deja `app.transaccion` fijada a nivel de sesion (`set_config(..., false)`) en la unica conexion del pool. PostgreSQL deja el valor de
     * sesion por encima del local dentro de la misma transaccion, asi que el `trabajo` vuelve a fijar el local con la marca que leyo al
     * empezar (si ya hay una): de otro modo, la comprobacion del propio `trabajo` anterior rechazaria y el valor de sesion se revertiria.
     */
    async function fijarMarcaDeSesion(academiaId: string, valor: string): Promise<void> {
      await base.conAcademia(academiaId, async (tx) => {
        const filas = await tx.cliente.$queryRaw<{ marca: string | null }[]>`
          SELECT pg_catalog.current_setting('app.transaccion', true) AS marca`;
        const marca = filas[0]?.marca ?? '';
        await tx.cliente.$queryRaw`SELECT pg_catalog.set_config('app.transaccion', ${valor}, false)`;
        await tx.cliente.$queryRaw`SELECT pg_catalog.set_config('app.transaccion', ${marca}, true)`;
      });
    }
    async function conMarcaDeSesion(): Promise<Corrida> {
      await fijarMarcaDeSesion(datos.A.id, randomUUID());
      return corridaDe('conAcademia', 'rollback');
    }
    const quitarMarcaDeSesion = (): Promise<void> => fijarMarcaDeSesion(datos.B.id, '');

    it('criterio 151 (premisa del control de la marca): tras fijarla en la sesion y un ROLLBACK escrito, la conexion lee ese valor de sesion', async () => {
      const valor = randomUUID();
      await fijarMarcaDeSesion(datos.A.id, valor);
      let visto: string | null | undefined;
      try {
        await resultadoDe(() =>
          base.conAcademia(datos.A.id, async (tx) => {
            await tx.cliente.$executeRaw`ROLLBACK`;
            const filas = await tx.cliente.$queryRaw<{ marca: string | null }[]>`
              SELECT pg_catalog.current_setting('app.transaccion', true) AS marca`;
            visto = filas[0]?.marca;
            return VALOR;
          }),
        );
      } finally {
        await quitarMarcaDeSesion();
      }

      expect(visto).toBe(valor);
    });

    it('criterio 151 (control de la marca): una app.transaccion de sesion fijada por un trabajo anterior no hace pasar la comprobacion tras un ROLLBACK', async () => {
      const corrida = await conMarcaDeSesion();
      try {
        const resultado = await resultadoDe(corrida.llamada);

        await esperarTransaccionAbortada(resultado, 'ROLLBACK escrito con app.transaccion fijada en la sesion');
      } finally {
        await quitarMarcaDeSesion();
      }
    });

    it('criterio 151 (control de la marca): con esa variable de sesion, tras el ROLLBACK escrito no queda nada escrito y la conexion sigue sana', async () => {
      const corrida = await conMarcaDeSesion();
      try {
        await resultadoDe(corrida.llamada);

        expect(await corrida.leer()).toEqual(NADA);
        await esperarConexionSana(base, datos.B.id, 'ROLLBACK escrito con app.transaccion fijada en la sesion');
      } finally {
        await quitarMarcaDeSesion();
      }
    });
  });
});
