// spec: 004-planes-clases-aforo (pruebas protegidas)
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  abrirRetenedor,
  type ClaseDePrueba,
  type ClientePC,
  conLimite,
  crearClaseDePrueba,
  crearEntrenadorDePrueba,
  cuerpoClase,
  escucharParaPlanesClases,
  esperarEspera,
  exigirRutasDePlanesYClases,
  leerClases,
  observar,
  type RespuestaPC,
  type Retenedor,
} from '../../utilidades/planes-clases';
import {
  AHORA_PRUEBAS,
  cookieDeUsuario,
  crearAppConReloj,
  crearEscenario,
  type Escenario,
} from '../../utilidades/usuarios';

// Criterio 32 (crítico, ronda 1 del ataque adversarial): POST /api/clases y PATCH /api/clases/{id} (reactivar o cambiar de entrenador)
// responden 409 CLASE_DUPLICADA o ENTRENADOR_OCUPADO (o 201 y 200 si el cambio termina siendo válido), nunca 500, aunque la clase que
// provocó el choque se desactive o se reactive en otra transacción confirmada entre la sentencia que falla y la relectura del choque.
//
// Las carreras son deterministas, sin tiempos ni esperas fijas (el límite de seguridad solo evita colgarse):
//
// - PATCH: la API comprueba el choque con una lectura antes de escribir y, si la clase que choca está inactiva, escribe. La clase que
//   choca (R) empieza inactiva; una transacción de la prueba (T) la reactiva sin confirmar. La lectura previa no ve el choque, pero el
//   UPDATE de la API espera a T en el índice único. Una segunda conexión de la prueba (W) pide `LOCK TABLE clases ACCESS EXCLUSIVE`
//   y queda en la cola detrás de la API. T confirma (R activa): la API recibe 23505 y revierte; W obtiene el bloqueo y toda lectura
//   de `clases` que la API haga desde una transacción nueva (la relectura del choque) queda esperando a W. Entonces W desactiva R y
//   confirma: el choque desaparece justo entre el error y la relectura. Si la API resuelve el choque dentro de la misma transacción,
//   o responde sin esperar, la prueba solo comprueba la respuesta.
// - POST: un disparador de la prueba (por sentencia, después del INSERT, también si el INSERT no insertó nada) toma un candado
//   consultivo compartido de la academia; la prueba retiene ese candado en exclusivo, la API queda detenida justo después de la
//   sentencia que detectó el choque, la prueba desactiva R y confirma (lo que libera el candado): la relectura ya no ve el choque.

const NOMBRE_DISPARADOR = 'ronda1_004_detener_despues_del_insert';
const PREFIJO_CANDADO = 'ronda1-004-';

const DIA = 3;
const HORA = '11:00';

type Escenarios = 'duplicada' | 'entrenador';

describe('criterio 32: choques del bloque con la clase que choca cambiando entre medio (carrera determinista)', () => {
  let app: NestExpressApplication;
  let http: ClientePC;
  let e: Escenario;
  let admin: string;

  beforeAll(async () => {
    ({ app } = await crearAppConReloj());
    http = await escucharParaPlanesClases(app);
    await quitarDisparador();
    await ejecutarComo(
      'propietario',
      `CREATE OR REPLACE FUNCTION public.${NOMBRE_DISPARADOR}() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN
         PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtext('${PREFIJO_CANDADO}' || coalesce(pg_catalog.current_setting('app.academia_id', true), '')));
         RETURN NULL;
       END $f$`,
    );
    // Sin EXECUTE para PUBLIC: la API se niega a atender si el rol de la app puede ejecutar funciones de `public` (spec 001). Para
    // disparar un trigger no hace falta EXECUTE.
    await ejecutarComo('propietario', `REVOKE ALL ON FUNCTION public.${NOMBRE_DISPARADOR}() FROM PUBLIC`);
    await ejecutarComo(
      'propietario',
      `CREATE TRIGGER ${NOMBRE_DISPARADOR} AFTER INSERT ON public.clases FOR EACH STATEMENT EXECUTE FUNCTION public.${NOMBRE_DISPARADOR}()`,
    );
  });
  beforeEach(async () => {
    exigirRutasDePlanesYClases(app);
    e = await crearEscenario();
    admin = cookieDeUsuario(e.adminA, AHORA_PRUEBAS);
  });
  afterAll(async () => {
    await quitarDisparador();
    await http?.cerrar();
  });

  async function quitarDisparador(): Promise<void> {
    await ejecutarComo('propietario', `DROP TRIGGER IF EXISTS ${NOMBRE_DISPARADOR} ON public.clases`);
    await ejecutarComo('propietario', `DROP FUNCTION IF EXISTS public.${NOMBRE_DISPARADOR}()`);
  }

  /** Lo que la respuesta puede ser si el choque ya no existe (válido) o si todavía existe (409 con el código del choque). */
  function exigirSinError500(respuesta: RespuestaPC, validos: number[], codigo409: string): void {
    const detalle = JSON.stringify(respuesta.body);
    expect(respuesta.status, detalle).not.toBe(500);
    expect([...validos, 409], detalle).toContain(respuesta.status);
    if (respuesta.status === 409) expect(respuesta.body?.codigo, detalle).toBe(codigo409);
  }

  async function exigirSinChoquesActivos(): Promise<void> {
    const activas = (await leerClases(e.A.id)).filter((fila) => fila.activo);
    const porNivel = new Set(activas.map((fila) => `${fila.nivel}|${fila.dia_semana}|${fila.hora_inicio}`));
    const porEntrenador = new Set(
      activas.map((fila) => `${fila.entrenador_id}|${fila.dia_semana}|${fila.hora_inicio}`),
    );
    expect(porNivel.size, 'dos clases activas del mismo nivel en el bloque').toBe(activas.length);
    expect(porEntrenador.size, 'dos clases activas del mismo entrenador en el bloque').toBe(activas.length);
  }

  // --- POST ---------------------------------------------------------------------------------------------------------------

  describe('POST /api/clases', () => {
    it.each<[string, Escenarios]>([
      ['mismo nivel y bloque con otro entrenador (CLASE_DUPLICADA)', 'duplicada'],
      ['mismo entrenador y bloque con otro nivel (ENTRENADOR_OCUPADO)', 'entrenador'],
    ])(
      'criterio 32: %s: si la clase que choca se desactiva justo después del INSERT, nunca responde 500',
      async (_nombre, escenario) => {
        const entrenador1 = await crearEntrenadorDePrueba(e.A.id);
        const entrenador2 = await crearEntrenadorDePrueba(e.A.id);
        const choca = await crearClaseDePrueba(e.A.id, entrenador1.id, {
          nivel: 'BASICO',
          dia_semana: DIA,
          hora_inicio: HORA,
        });
        const cuerpo =
          escenario === 'duplicada'
            ? cuerpoClase(entrenador2.id, { nivel: 'BASICO', diaSemana: DIA, horaInicio: HORA })
            : cuerpoClase(entrenador1.id, { nivel: 'INTERMEDIO', diaSemana: DIA, horaInicio: HORA });
        const codigo409 = escenario === 'duplicada' ? 'CLASE_DUPLICADA' : 'ENTRENADOR_OCUPADO';

        const candado: Retenedor = await abrirRetenedor(e.A.id);
        let respuesta: RespuestaPC;
        try {
          await candado.consultar('SELECT pg_advisory_xact_lock(hashtext($1))', [`${PREFIJO_CANDADO}${e.A.id}`]);
          const peticion = observar(http.post('/api/clases', admin, cuerpo));
          let detenida = false;
          try {
            detenida = await esperarEspera(
              async () => (await candado.sesionesEsperando()) >= 1,
              [peticion],
              'el POST ni respondió ni quedó detenido tras el INSERT.',
            );
            if (detenida) {
              await candado.consultar(
                'UPDATE clases SET activo = false, actualizado_en = $3::timestamptz WHERE academia_id = $1::uuid AND id = $2::uuid',
                [e.A.id, choca.id, '2026-01-01T00:00:00.000Z'],
              );
            }
          } finally {
            await candado.liberar(detenida ? 'COMMIT' : 'ROLLBACK');
          }
          respuesta = await conLimite(
            peticion.resultado,
            'Límite de seguridad: el POST no respondió tras liberar el candado.',
          );
        } finally {
          await candado.liberar('ROLLBACK');
        }

        // La clase que chocaba quedó inactiva: si el POST llegó a ser válido es 201; si todavía ve el choque, 409 con su código.
        exigirSinError500(respuesta, [201], codigo409);
        await exigirSinChoquesActivos();
      },
    );
  });

  // --- PATCH --------------------------------------------------------------------------------------------------------------

  /**
   * Reactiva `choca` (inactiva) con T sin confirmar, envía `enviar()`, hace que W espere detrás de la API, confirma T (la API recibe el choque) y,
   * si la API vuelve a leer `clases` desde otra transacción, vuelve a desactivar `choca` con W antes de que lo lea. Devuelve la respuesta.
   */
  async function conChoqueQueDesaparece(
    choca: ClaseDePrueba,
    enviar: () => Promise<RespuestaPC>,
  ): Promise<RespuestaPC> {
    const retenedorT = await abrirRetenedor(e.A.id);
    let retenedorW: Retenedor | undefined;
    try {
      // T: reactiva la clase que choca (inactiva y confirmada para cualquier lectura previa), sin confirmar.
      await retenedorT.consultar('UPDATE clases SET activo = true WHERE academia_id = $1::uuid AND id = $2::uuid', [
        e.A.id,
        choca.id,
      ]);
      const peticion = observar(enviar());
      const esperaAT = await esperarEspera(
        async () => (await retenedorT.sesionesEsperando()) >= 1,
        [peticion],
        'la petición ni respondió ni quedó esperando la fila que choca.',
      );
      if (!esperaAT) {
        // La API no necesitó esperar a T (por ejemplo, detectó el choque antes de escribir): no hay ventana que forzar.
        await retenedorT.liberar('ROLLBACK');
        return await conLimite(peticion.resultado, 'Límite de seguridad: la petición no respondió.');
      }

      retenedorW = await abrirRetenedor(e.A.id);
      const bloqueo = observar(retenedorW.consultar('LOCK TABLE public.clases IN ACCESS EXCLUSIVE MODE'));
      // W queda en la cola: espera a T y a la transacción de la API (ambas retienen la tabla).
      await esperarEspera(
        async () => (await retenedorT.sesionesEsperando()) >= 2,
        [peticion, bloqueo],
        'el bloqueo de la tabla no quedó esperando detrás de la API y de la prueba.',
      );
      await retenedorT.liberar('COMMIT');

      // La API recibe el choque y revierte; entonces W obtiene el bloqueo (o la API terminó antes de pedir otra cosa).
      await conLimite(bloqueo.resultado, 'Límite de seguridad: el bloqueo de la tabla no se obtuvo.');
      const relecturaEsperando = await esperarEspera(
        async () => (await retenedorW!.sesionesEsperando()) >= 1,
        [peticion],
        'la API ni respondió ni quedó esperando leer las clases.',
      );
      if (relecturaEsperando) {
        await retenedorW.consultar(
          'UPDATE clases SET activo = false, actualizado_en = $3::timestamptz WHERE academia_id = $1::uuid AND id = $2::uuid',
          [e.A.id, choca.id, '2026-01-01T00:00:00.000Z'],
        );
      }
      await retenedorW.liberar(relecturaEsperando ? 'COMMIT' : 'ROLLBACK');
      return await conLimite(
        peticion.resultado,
        'Límite de seguridad: la petición no respondió tras liberar el bloqueo.',
      );
    } finally {
      await retenedorT.liberar('ROLLBACK');
      await retenedorW?.liberar('ROLLBACK');
    }
  }

  describe('PATCH /api/clases/{id}', () => {
    it('criterio 32: reactivar una clase del mismo nivel y bloque (CLASE_DUPLICADA) cuando la que choca se reactiva y se vuelve a desactivar entre medio: nunca 500', async () => {
      const entrenador1 = await crearEntrenadorDePrueba(e.A.id);
      const entrenador2 = await crearEntrenadorDePrueba(e.A.id);
      const choca = await crearClaseDePrueba(e.A.id, entrenador1.id, {
        nivel: 'BASICO',
        dia_semana: DIA,
        hora_inicio: HORA,
        activo: false,
      });
      const x = await crearClaseDePrueba(e.A.id, entrenador2.id, {
        nivel: 'BASICO',
        dia_semana: DIA,
        hora_inicio: HORA,
        activo: false,
      });

      const respuesta = await conChoqueQueDesaparece(choca, () =>
        http.patch(`/api/clases/${x.id}`, admin, { activo: true }),
      );

      exigirSinError500(respuesta, [200], 'CLASE_DUPLICADA');
      await exigirSinChoquesActivos();
    });

    it('criterio 32: reactivar una clase del mismo entrenador y bloque (ENTRENADOR_OCUPADO) cuando la que choca se reactiva y se vuelve a desactivar entre medio: nunca 500', async () => {
      const entrenador1 = await crearEntrenadorDePrueba(e.A.id);
      const choca = await crearClaseDePrueba(e.A.id, entrenador1.id, {
        nivel: 'INTERMEDIO',
        dia_semana: DIA,
        hora_inicio: HORA,
        activo: false,
      });
      const x = await crearClaseDePrueba(e.A.id, entrenador1.id, {
        nivel: 'BASICO',
        dia_semana: DIA,
        hora_inicio: HORA,
        activo: false,
      });

      const respuesta = await conChoqueQueDesaparece(choca, () =>
        http.patch(`/api/clases/${x.id}`, admin, { activo: true }),
      );

      exigirSinError500(respuesta, [200], 'ENTRENADOR_OCUPADO');
      await exigirSinChoquesActivos();
    });

    it('criterio 32: cambiar el entrenador a uno ocupado en el bloque (ENTRENADOR_OCUPADO) cuando la clase que lo ocupa se reactiva y se vuelve a desactivar entre medio: nunca 500', async () => {
      const entrenador1 = await crearEntrenadorDePrueba(e.A.id);
      const entrenador2 = await crearEntrenadorDePrueba(e.A.id);
      const choca = await crearClaseDePrueba(e.A.id, entrenador2.id, {
        nivel: 'INTERMEDIO',
        dia_semana: DIA,
        hora_inicio: HORA,
        activo: false,
      });
      const x = await crearClaseDePrueba(e.A.id, entrenador1.id, {
        nivel: 'BASICO',
        dia_semana: DIA,
        hora_inicio: HORA,
      });

      const respuesta = await conChoqueQueDesaparece(choca, () =>
        http.patch(`/api/clases/${x.id}`, admin, { entrenadorId: entrenador2.id }),
      );

      exigirSinError500(respuesta, [200], 'ENTRENADOR_OCUPADO');
      await exigirSinChoquesActivos();
    });
  });
});
