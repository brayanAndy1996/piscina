// spec: 007-pagos (pruebas protegidas)
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { urlPropietarioPruebas } from '../../utilidades/base-datos';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  abrirCajaDeHoy,
  AHORA_007,
  codigoDeRespuesta,
  cookiesDePagos,
  crearEscenarioDePagos,
  cuerpoCobro,
  type EscenarioPagos,
  exigirRutasDePagos,
  instantaneaDeLaAcademia,
  rutaCobro,
  sembrarCobrable,
} from '../../utilidades/escenario-pagos';
import {
  type AppInscripciones,
  crearAppInscripciones,
  leerAlumnos,
  leerMatriculas,
  leerSolicitudes,
  type SolicitudSembrada,
} from '../../utilidades/inscripciones';
import { crearDestinoDeRegistro } from '../../utilidades/modulos';
import { leerPagos } from '../../utilidades/pagos';
import { observar } from '../../utilidades/planes-clases';
import { crearUsuarioDePrueba, leerUsuarioPorDni, leerUsuarios } from '../../utilidades/usuarios';

// Criterio 20 (crítico, HU-04, RN-01, RN-02, RNF-03, RNF-04): en la transacción que deja el pago `CONFIRMADO` (cobro en efectivo o aprobación [007b]): a) se crea su cuenta con
// `UsuariosService.crearEnTransaccion`: rol `ALUMNO`, usuario igual a su DNI, nombres y apellidos del alumno, contraseña inicial igual a su DNI con argon2 (calculada antes de abrir la
// transacción) y `debe_cambiar_clave = true`; audita `USUARIO_CREADO` con el actor que confirma; b) el alumno pasa de `CLIENTE` a `ALUMNO_ACTIVO` y `alumnos.usuario_id` apunta a esa cuenta;
// c) la matrícula pasa de `RESERVADA` a `VIGENTE`, con `reserva_vence_en` nula; d) la solicitud pasa a `CONFIRMADA`. Después, `POST /api/a/{nombreCorto}/sesion` con su DNI como usuario y como
// contraseña inicia sesión con el cambio de contraseña obligatorio pendiente, y la secretaria puede restablecer su contraseña (`RESTABLECER_CLAVE`, alcance `ALUMNOS`).
// Criterio 21 (crítico, RN-01, RN-05; D-04): la persona sigue en `CLIENTE`, sin cuenta (el ingreso con su DNI responde como uno que no existe) hasta que su pago se confirma. Si la confirmación
// falla por cualquier motivo, no queda nada de ella: ni pago confirmado, ni cuenta, ni alumno activo, ni matrícula vigente, ni movimiento, ni auditoría.
// Criterio 23 (crítico, RNF-03; criterio 43 de 002): la contraseña inicial se hashea con argon2 antes de abrir la transacción de la confirmación, a partir del DNI leído en una lectura corta
// previa. El registro técnico nunca lleva el DNI, la contraseña ni su hash.

const { destino, lineas } = crearDestinoDeRegistro();

describe('paso de cliente a alumno al confirmar el cobro (criterios 20, 21 y 23)', () => {
  let ctx: AppInscripciones;
  let e: EscenarioPagos;
  let cookies: ReturnType<typeof cookiesDePagos>;

  beforeAll(async () => {
    // nestjs-pino crea un único registrador por proceso: el registro se inspecciona en la primera aplicación que crea este archivo.
    ctx = await crearAppInscripciones({ nivelRegistro: 'trace', destinoRegistro: destino });
  });
  beforeEach(async () => {
    ctx.reloj.fijar(AHORA_007);
    e = await crearEscenarioDePagos();
    exigirRutasDePagos(ctx.app);
    cookies = cookiesDePagos(e);
    await abrirCajaDeHoy(e);
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const cobrar = (c: SolicitudSembrada, cookie = cookies.secretaria) =>
    ctx.http.post(rutaCobro(c.solicitudId), cuerpoCobro('42.00'), { cookie });
  const ingresar = (usuario: string, clave: string) => ctx.http.post('/api/a/academia-a/sesion', { usuario, clave });

  describe('criterio 20: confirmar un pago crea al alumno', () => {
    it('criterio 20 a: se crea su cuenta: rol ALUMNO, usuario igual a su DNI, sus nombres y apellidos, activa y con el cambio de contraseña obligatorio pendiente', async () => {
      const cliente = await sembrarCobrable(e, { nombres: 'Valeria', apellidos: 'Mendoza Salas' });
      expect(await leerUsuarioPorDni(e.A.id, cliente.dni), 'antes del pago no tiene cuenta').toBeUndefined();

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      const cuenta = await leerUsuarioPorDni(e.A.id, cliente.dni);
      expect(cuenta).toMatchObject({
        dni: cliente.dni,
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        rol: 'ALUMNO',
        estado: 'ACTIVO',
        debe_cambiar_clave: true,
        version_token: 0,
        intentos_fallidos: 0,
      });
    });

    it('criterio 20 a: la contraseña inicial es el DNI, guardada con argon2 (nunca en claro), y verifica con el DNI', async () => {
      const cliente = await sembrarCobrable(e);

      await cobrar(cliente);

      const cuenta = await leerUsuarioPorDni(e.A.id, cliente.dni);
      expect(cuenta, 'el cobro debía crear la cuenta del alumno').toBeDefined();
      expect(cuenta?.clave_hash).toMatch(/^\$argon2id?\$/);
      expect(cuenta?.clave_hash).not.toContain(cliente.dni);
      const nombre = '@node-rs/argon2';
      const argon2 = (await import(/* @vite-ignore */ nombre)) as {
        verify(hash: string, clave: string): Promise<boolean>;
      };
      expect(await argon2.verify(cuenta?.clave_hash ?? '', cliente.dni)).toBe(true);
      expect(await argon2.verify(cuenta?.clave_hash ?? '', `${cliente.dni}0`)).toBe(false);
    });

    it('criterio 20 a: audita USUARIO_CREADO con el actor que confirma (la secretaria o el administrador)', async () => {
      const uno = await sembrarCobrable(e);
      const dos = await sembrarCobrable(e);

      await cobrar(uno, cookies.secretaria);
      await cobrar(dos, cookies.admin);

      const filas = await leerAuditoriaDeAcademia(e.A.id, 'USUARIO_CREADO');
      expect(filas.map((f) => [f.actor_tipo, f.actor_id])).toEqual([
        ['USUARIO', e.secretariaA.id],
        ['USUARIO', e.adminA.id],
      ]);
    });

    it('criterio 20 b, c y d: el alumno pasa a ALUMNO_ACTIVO con su cuenta, la matrícula a VIGENTE sin vencimiento y la solicitud a CONFIRMADA', async () => {
      const cliente = await sembrarCobrable(e);

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      const cuenta = await leerUsuarioPorDni(e.A.id, cliente.dni);
      const alumno = (await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId);
      expect(alumno).toMatchObject({ estado: 'ALUMNO_ACTIVO', usuario_id: cuenta?.id, dni: cliente.dni });
      const matricula = (await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId);
      expect(matricula).toMatchObject({ estado: 'VIGENTE', reserva_vence_en: null, clases_totales: 5 });
      expect((await leerSolicitudes(e.A.id)).find((s) => s.id === cliente.solicitudId)?.estado).toBe('CONFIRMADA');
    });

    it('criterio 20: con su DNI como usuario y como contraseña inicia sesión (200) con el cambio de contraseña obligatorio pendiente; la secretaria puede restablecer su contraseña', async () => {
      const cliente = await sembrarCobrable(e);
      await cobrar(cliente);

      const ingreso = await ingresar(cliente.dni, cliente.dni);

      expect(ingreso.status, ingreso.texto).toBe(200);
      expect(ingreso.body?.['usuario']).toMatchObject({
        nombres: 'Valeria',
        apellidos: 'Mendoza Salas',
        rol: 'ALUMNO',
        debeCambiarClave: true,
        academia: { nombreCorto: 'academia-a' },
      });
      const cuenta = await leerUsuarioPorDni(e.A.id, cliente.dni);
      const restablecer = await ctx.http.post(
        `/api/usuarios/${cuenta?.id}/restablecer-clave`,
        {},
        { cookie: cookies.secretaria },
      );
      expect(restablecer.status, restablecer.texto).toBe(200);
      expect((await ingresar(cliente.dni, cliente.dni)).status).toBe(200);
    });

    it('criterio 20: la cuenta es de la academia de la solicitud: con el mismo DNI en B no existe ninguna cuenta (D-23)', async () => {
      const cliente = await sembrarCobrable(e);
      await cobrar(cliente);

      expect(await leerUsuarioPorDni(e.B.id, cliente.dni)).toBeUndefined();
      expect(
        (await ctx.http.post('/api/a/academia-b/sesion', { usuario: cliente.dni, clave: cliente.dni })).status,
      ).toBe(401);
    });
  });

  describe('criterio 21: solo con el pago confirmado', () => {
    it('criterio 21: antes de pagar, el ingreso con el DNI y el DNI como clave responde exactamente como el de un usuario que no existe', async () => {
      const cliente = await sembrarCobrable(e);

      const delCliente = await ingresar(cliente.dni, cliente.dni);
      const inexistente = await ingresar('11112222', '11112222');

      expect(delCliente.status).toBe(401);
      expect(delCliente.texto).toBe(inexistente.texto);
      expect(delCliente.headers.get('set-cookie')).toBeNull();
    });

    it('criterio 21: una confirmación que falla por el DNI del personal no deja nada: ni pago, ni cuenta, ni alumno activo, ni matrícula vigente, ni movimiento, ni auditoría', async () => {
      const cliente = await sembrarCobrable(e);
      await crearUsuarioDePrueba({ academiaId: e.A.id, rol: 'ENTRENADOR', dni: cliente.dni });
      const antes = await instantaneaDeLaAcademia(e.A.id);

      const respuesta = await cobrar(cliente);

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'DNI_DEL_PERSONAL']);
      expect(await instantaneaDeLaAcademia(e.A.id)).toBe(antes);
      expect(await leerPagos(e.A.id)).toEqual([]);
      expect((await leerAlumnos(e.A.id)).find((a) => a.id === cliente.alumnoId)).toMatchObject({
        estado: 'CLIENTE',
        usuario_id: null,
      });
      expect((await leerMatriculas(e.A.id)).find((m) => m.id === cliente.matriculaId)?.estado).toBe('RESERVADA');
    });

    it('criterio 21: un cobro que sale bien deja las seis cosas a la vez; uno que falla, ninguna (el pago, la cuenta, el alumno, la matrícula, el movimiento y la auditoría van juntos)', async () => {
      const bueno = await sembrarCobrable(e);
      const malo = await sembrarCobrable(e);

      const ok = await cobrar(bueno);
      const mal = await ctx.http.post(rutaCobro(malo.solicitudId), cuerpoCobro('41.00'), {
        cookie: cookies.secretaria,
      });

      expect(ok.status).toBe(201);
      expect(mal.status).toBe(409);
      expect(await leerPagos(e.A.id)).toHaveLength(1);
      expect(
        (await leerUsuarios(e.A.id)).filter((u) => [bueno.dni, malo.dni].includes(u.dni)).map((u) => u.dni),
      ).toEqual([bueno.dni]);
      expect((await leerAlumnos(e.A.id)).filter((a) => a.estado === 'ALUMNO_ACTIVO').map((a) => a.id)).toEqual([
        bueno.alumnoId,
      ]);
      expect((await leerMatriculas(e.A.id)).filter((m) => m.estado === 'VIGENTE').map((m) => m.id)).toEqual([
        bueno.matriculaId,
      ]);
    });
  });

  describe('criterio 23: el hash fuera de la transacción y el registro técnico sin secretos', () => {
    it('criterio 23: mientras el hash espera su turno de CPU, el cobro no tiene la transacción abierta: la fila de quien cobra no está bloqueada durante más de 200 ms seguidos', async () => {
      const cliente = await sembrarCobrable(e);
      const nombre = '@node-rs/argon2';
      const argon2 = (await import(/* @vite-ignore */ nombre)) as {
        hash(clave: string, opciones: { memoryCost: number; timeCost: number; parallelism: number }): Promise<string>;
      };
      const sonda = new pg.Client({ connectionString: urlPropietarioPruebas() });
      await sonda.connect();
      const filaBloqueada = async (): Promise<boolean> => {
        await sonda.query('BEGIN');
        try {
          await sonda.query("SELECT set_config('app.academia_id', $1, true)", [e.A.id]);
          await sonda.query(
            'SELECT id FROM usuarios WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE NOWAIT',
            [e.A.id, e.secretariaA.id],
          );
          return false;
        } catch (error) {
          if ((error as { code?: string }).code === '55P03') return true;
          throw error;
        } finally {
          await sonda.query('ROLLBACK');
        }
      };
      try {
        // 12 hashes pesados ocupan los hilos de CPU de la librería: el hash del cobro espera, durante cientos de milisegundos, su turno.
        const ocupadores = Array.from({ length: 12 }, () =>
          argon2.hash('ocupar', { memoryCost: 32768, timeCost: 40, parallelism: 1 }),
        );
        const cobro = observar(cobrar(cliente));
        let desde: number | null = null;
        let maximo = 0;
        while (!cobro.terminada()) {
          const bloqueada = await filaBloqueada();
          const ahora = Date.now();
          if (bloqueada) {
            desde ??= ahora;
            maximo = Math.max(maximo, ahora - desde);
          } else {
            desde = null;
          }
        }
        const respuesta = await cobro.resultado;
        await Promise.all(ocupadores);

        expect(respuesta.status, respuesta.texto).toBe(201);
        expect(
          maximo,
          'la transacción del cobro estuvo abierta (con el actor bloqueado) mientras esperaba el hash de argon2: el hash debe calcularse antes de abrirla',
        ).toBeLessThan(200);
      } finally {
        await sonda.end().catch(() => undefined);
      }
    });

    it('criterio 23: el registro técnico nunca lleva el DNI, la contraseña ni su hash', async () => {
      const cliente = await sembrarCobrable(e);
      const antes = lineas.length;

      const respuesta = await cobrar(cliente);

      expect(respuesta.status, respuesta.texto).toBe(201);
      const cuenta = await leerUsuarioPorDni(e.A.id, cliente.dni);
      const registro = lineas.slice(antes).join('\n');
      expect(registro.length, 'el registro debe tener líneas de la petición').toBeGreaterThan(0);
      expect(registro).not.toContain(cliente.dni);
      expect(registro).not.toContain(cuenta?.clave_hash ?? 'no-hay-hash');
      expect(registro).not.toMatch(/\$argon2/);
    });

    it('criterio 23: un cobro rechazado tampoco deja el DNI ni el hash en el registro técnico', async () => {
      const cliente = await sembrarCobrable(e);
      const antes = lineas.length;

      const respuesta = await ctx.http.post(rutaCobro(cliente.solicitudId), cuerpoCobro('41.00'), {
        cookie: cookies.secretaria,
      });

      expect(respuesta.status).toBe(409);
      const registro = lineas.slice(antes).join('\n');
      expect(registro).not.toContain(cliente.dni);
      expect(registro).not.toMatch(/\$argon2/);
    });
  });
});
