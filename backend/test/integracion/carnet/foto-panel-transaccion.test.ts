// spec: 008-carnet-qr (pruebas protegidas)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComo } from '../../utilidades/base-datos';
import {
  type AlumnoConQr,
  type AppCarnet,
  codigoDeRespuesta,
  crearAlumnoPorPago,
  crearAppCarnet,
  type EscenarioDelCarnet,
  transaccionesAbiertasDeLaApp,
} from '../../utilidades/escenario-carnet';
import {
  instantaneaDeLaFoto,
  patronDeClave,
  prepararEscenarioFotoPanel,
  rutaFotoAlumno,
  rutaFotoSolicitud,
  sembrarCliente,
  subirFotoPanel,
} from '../../utilidades/escenario-foto-panel';
import { conRetencion, cuerpoInscripcion, rutaPublica, type SolicitudSembrada } from '../../utilidades/inscripciones';
import {
  AlmacenDeFallosDePrueba,
  archivosBajo,
  archivosDelAlumno,
  existeArchivoDeClave,
  fotoClaveDe,
  lineasJson,
  png,
  TEXTO_DE_RUTA_EN_EL_ERROR,
} from '../../utilidades/inscripciones-005b';
import { crearDestinoDeRegistro, esperarHasta } from '../../utilidades/modulos';
import { actualizarUsuario, contarAuditoria } from '../../utilidades/usuarios';

// Criterio 25 (crítico, D-21, D-23, RNF-05), el mismo proceso de la 005b para las dos rutas del panel: primero, una transacción corta comprueba (g) a (i) del criterio 24 sin tocar archivos. Después, fuera de toda transacción, la imagen aceptada se recodifica y se guarda
// **antes** de la transacción con una clave nueva. Luego, la transacción de escritura, en este orden: `bloquearActorVigente`; `alumnos` `FOR UPDATE`; en la ruta de la solicitud, `solicitudes_inscripcion` `FOR UPDATE` y se repite la comprobación del criterio 23 (409 y se
// borra el archivo nuevo si ya no se admite); se lee la clave anterior y se guardan `foto_clave` y `actualizado_en`; la auditoría. **Después de confirmar** se borra el archivo anterior. Un fallo de `guardar` responde 500 sin cambiar la base; un rechazo propio de la
// transacción (401, 404 o 409) borra el archivo nuevo; un borrado que falla deja el `warn` `'No se pudo borrar un archivo'` con la academia y `error: { tipo }` (sin el mensaje, que lleva la ruta, ni datos personales), y la respuesta sigue siendo 204. Invariante: después
// de cualquier subida, `foto_clave` es nula o apunta a un archivo que existe en la carpeta de su academia.
// Pruebas con un `AlmacenArchivos` de prueba que envuelve al de disco (`AlmacenDeFallosDePrueba`): la secuencia (qué había en la base y cuántas transacciones había abiertas al guardar y al borrar), `guardar` que rechaza, `borrar` que rechaza y los rechazos propios de la
// transacción, que se provocan desde `guardar` (justo entre la comprobación previa y la transacción): el actor se desactiva (401) o la solicitud se cancela (409). La confirmación incierta está en `foto-panel-confirmacion-incierta.test.ts`; las carreras, en `foto-panel-carreras.test.ts`.
// Lecturas estrictas elegidas: «fuera de toda transacción» y «después de confirmar» se comprueban con las transacciones abiertas de la API (`pg_stat_activity`) en el instante de `guardar` y de `borrar`: ninguna; el orden de bloqueos se comprueba con una subida y un
// envío del formulario con el mismo DNI a la vez (criterio 37 e de 005): ninguno responde 500 ni falla con `40P01`.

const MENSAJE_BORRADO = 'No se pudo borrar un archivo';

type Cual = 'alumno' | 'solicitud';
const CUALES: readonly Cual[] = ['alumno', 'solicitud'];

describe('la foto del panel: archivo y transacción, sin restos visibles (criterio 25)', () => {
  const { destino, lineas } = crearDestinoDeRegistro();
  let ctx: AppCarnet;
  let almacen: AlmacenDeFallosDePrueba;
  let esc: EscenarioDelCarnet;
  let alumno: AlumnoConQr;
  let cliente: SolicitudSembrada;

  beforeAll(async () => {
    ctx = await crearAppCarnet({
      nivelRegistro: 'trace',
      destinoRegistro: destino,
      envolverAlmacen: (real) => {
        almacen = new AlmacenDeFallosDePrueba(real);
        return almacen;
      },
    });
  });
  beforeEach(async () => {
    esc = await prepararEscenarioFotoPanel(ctx);
    alumno = await crearAlumnoPorPago(ctx, esc);
    cliente = await sembrarCliente(esc);
    almacen.fallarBorrar = false;
    almacen.fallarGuardar = false;
    almacen.alGuardar = undefined;
    almacen.alBorrar = undefined;
    almacen.llamadas.length = 0;
    lineas.length = 0;
  });
  afterAll(async () => {
    await ctx?.cerrarTodo();
  });

  const idDelAlumno = (cual: Cual) => (cual === 'alumno' ? alumno.alumnoId : cliente.alumnoId);
  const ruta = (cual: Cual) =>
    cual === 'alumno' ? rutaFotoAlumno(alumno.alumnoId) : rutaFotoSolicitud(cliente.solicitudId);
  const subir = (cual: Cual, cuerpo: Buffer = png(100, 100), cookie = esc.cookies.secretaria) =>
    subirFotoPanel(ctx, ruta(cual), { cookie, cuerpo });
  const claveDe = (cual: Cual) => fotoClaveDe(esc.e.A.id, idDelAlumno(cual));
  const archivos = (cual: Cual) => archivosDelAlumno(ctx.raiz, esc.e.A.id, idDelAlumno(cual));
  const avisosDeBorrado = () => lineasJson(lineas).filter((linea) => linea['msg'] === MENSAJE_BORRADO);
  const operaciones = (operacion: 'guardar' | 'borrar') =>
    almacen.llamadas.filter((llamada) => llamada.operacion === operacion);

  /** Cancela la solicitud y su matrícula, ya confirmado (como dueño): lo que hace la cancelación del panel mientras la subida está entre medio. */
  const cancelar = (solicitudId: string) => async () => {
    await ejecutarComo(
      'propietario',
      "UPDATE solicitudes_inscripcion SET estado = 'CANCELADA', actualizado_en = now() WHERE academia_id = $1::uuid AND id = $2::uuid",
      [esc.e.A.id, solicitudId],
      { academiaId: esc.e.A.id },
    );
    await ejecutarComo(
      'propietario',
      "UPDATE matriculas SET estado = 'CANCELADA', reserva_vence_en = NULL, actualizado_en = now() WHERE academia_id = $1::uuid AND solicitud_id = $2::uuid",
      [esc.e.A.id, solicitudId],
      { academiaId: esc.e.A.id },
    );
  };

  describe('secuencia', () => {
    it.each(CUALES)(
      'ruta de la %s: la imagen se guarda con una clave nueva antes de la transacción (foto_clave aún no cambió, ninguna transacción abierta) y la anterior se borra después de confirmar (foto_clave ya apunta a la nueva, ninguna transacción abierta)',
      async (cual) => {
        expect((await subir(cual)).status).toBe(204);
        const anterior = (await claveDe(cual)) as string;
        almacen.llamadas.length = 0;
        let claveEnElGuardado: string | null | undefined;
        let claveEnElBorrado: string | null | undefined;
        let abiertasAlGuardar = -1;
        let abiertasAlBorrar = -1;
        almacen.alGuardar = async () => {
          claveEnElGuardado = await claveDe(cual);
          abiertasAlGuardar = await transaccionesAbiertasDeLaApp();
        };
        almacen.alBorrar = async () => {
          claveEnElBorrado = await claveDe(cual);
          abiertasAlBorrar = await transaccionesAbiertasDeLaApp();
        };

        const respuesta = await subir(cual, png(120, 120));

        expect(respuesta.status, respuesta.texto).toBe(204);
        const nueva = (await claveDe(cual)) as string;
        expect(nueva).not.toBe(anterior);
        expect(nueva).toMatch(patronDeClave(esc.e.A.id, idDelAlumno(cual)));
        expect(operaciones('guardar').map((l) => l.clave)).toEqual([nueva]);
        expect(operaciones('borrar').map((l) => l.clave)).toEqual([anterior]);
        expect(claveEnElGuardado, 'al guardar el archivo nuevo la base no debía haber cambiado').toBe(anterior);
        expect(claveEnElBorrado, 'al borrar el anterior la base ya debía apuntar al nuevo').toBe(nueva);
        expect(abiertasAlGuardar, 'guardar corre fuera de toda transacción').toBe(0);
        expect(abiertasAlBorrar, 'borrar corre después de confirmar, fuera de toda transacción').toBe(0);
        expect(almacen.llamadas.every((llamada) => llamada.academiaId === esc.e.A.id)).toBe(true);
        expect(archivos(cual)).toEqual([nueva]);
      },
    );

    it.each(CUALES)(
      'ruta de la %s: la primera foto no borra nada (no había anterior) y deja un solo archivo, el de foto_clave',
      async (cual) => {
        const respuesta = await subir(cual);

        expect(respuesta.status, respuesta.texto).toBe(204);
        expect(operaciones('borrar')).toEqual([]);
        expect(operaciones('guardar')).toHaveLength(1);
        const clave = await claveDe(cual);
        expect(clave).not.toBeNull();
        expect(archivos(cual)).toEqual([clave]);
      },
    );

    it('un rechazo anterior a guardar (404, 409, 403, 400) no toca el almacén: ni guardar ni borrar', async () => {
      const cancelada = await sembrarCliente(esc, { estado: 'CANCELADA' });

      await subirFotoPanel(ctx, rutaFotoSolicitud(cancelada.solicitudId), { cookie: esc.cookies.secretaria });
      await subirFotoPanel(ctx, rutaFotoAlumno(cliente.alumnoId), { cookie: esc.cookies.secretaria });
      await subirFotoPanel(ctx, ruta('alumno'), { cookie: esc.cookies.entrenador });
      await subirFotoPanel(ctx, ruta('alumno'), { cookie: esc.cookies.secretaria, cuerpo: Buffer.from('basura') });
      await subirFotoPanel(ctx, ruta('solicitud'), { cookie: esc.cookies.secretaria, tipo: 'image/gif' });

      expect(almacen.llamadas.filter((l) => l.operacion !== 'leer')).toEqual([]);
      expect(archivosBajo(ctx.raiz)).toEqual([]);
    });
  });

  describe('guardar falla', () => {
    it.each(CUALES)(
      'ruta de la %s: con un almacén cuyo guardar rechaza, responde 500 ERROR_INTERNO sin la ruta y no cambia nada (ni la base, ni los archivos, ni la auditoría)',
      async (cual) => {
        almacen.fallarGuardar = true;
        const antes = await instantaneaDeLaFoto(ctx, esc);

        const respuesta = await subir(cual);

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([500, 'ERROR_INTERNO']);
        expect(respuesta.texto).not.toContain(TEXTO_DE_RUTA_EN_EL_ERROR);
        expect(await claveDe(cual)).toBeNull();
        expect(await instantaneaDeLaFoto(ctx, esc)).toBe(antes);
        expect(await contarAuditoria(esc.e.A.id, 'ALUMNO_FOTO_ACTUALIZADA')).toBe(0);
        expect(operaciones('borrar'), 'no había nada que borrar').toEqual([]);
      },
    );

    it.each(CUALES)(
      'ruta de la %s: con una foto anterior, el guardar que falla deja foto_clave y el archivo anterior como estaban',
      async (cual) => {
        expect((await subir(cual)).status).toBe(204);
        const anterior = (await claveDe(cual)) as string;
        almacen.fallarGuardar = true;

        const respuesta = await subir(cual, png(150, 150));

        expect(respuesta.status).toBe(500);
        expect(await claveDe(cual)).toBe(anterior);
        expect(archivos(cual)).toEqual([anterior]);
        expect(existeArchivoDeClave(ctx.raiz, anterior)).toBe(true);
      },
    );

    it('el 500 no deja la ruta, el DNI ni la clave en el registro técnico', async () => {
      almacen.fallarGuardar = true;
      lineas.length = 0;

      await subir('alumno');
      await subir('solicitud');
      await esperarHasta(() => lineas.length > 0);

      const texto = lineas.join('\n');
      for (const secreto of [
        TEXTO_DE_RUTA_EN_EL_ERROR,
        'NombrePropioQueNoSeRegistra',
        alumno.dni,
        cliente.dni,
        'Valeria',
        'academias/',
      ]) {
        expect(texto, `el registro lleva ${secreto}`).not.toContain(secreto);
      }
    });
  });

  describe('el borrado del archivo anterior falla', () => {
    it.each(CUALES)(
      'ruta de la %s: una segunda subida responde 204 y cambia foto_clave; el archivo anterior sigue en el disco y el registro tiene el aviso con la academia y error: { tipo }, sin la ruta ni datos personales',
      async (cual) => {
        expect((await subir(cual)).status).toBe(204);
        const anterior = (await claveDe(cual)) as string;
        almacen.fallarBorrar = true;
        lineas.length = 0;

        const respuesta = await subir(cual, png(120, 120));

        expect(respuesta.status, respuesta.texto).toBe(204);
        const nueva = (await claveDe(cual)) as string;
        expect(nueva).not.toBe(anterior);
        expect(existeArchivoDeClave(ctx.raiz, anterior), 'el archivo anterior debía seguir en el disco').toBe(true);
        expect(existeArchivoDeClave(ctx.raiz, nueva)).toBe(true);
        await esperarHasta(() => avisosDeBorrado().length > 0);
        const avisos = avisosDeBorrado();
        expect(avisos).toHaveLength(1);
        expect(avisos[0]?.['level'], 'es un warn').toBe(40);
        expect(avisos[0]?.['academiaId']).toBe(esc.e.A.id);
        expect(avisos[0]?.['error'], 'solo el tipo del error').toEqual({ tipo: 'ErrorDeAlmacenDePrueba' });
        const texto = lineas.join('\n');
        for (const secreto of [
          TEXTO_DE_RUTA_EN_EL_ERROR,
          'NombrePropioQueNoSeRegistra',
          alumno.dni,
          cliente.dni,
          'Valeria',
          anterior,
          nueva,
        ]) {
          expect(texto, `el registro lleva ${secreto}`).not.toContain(secreto);
        }
      },
    );
  });

  describe('un rechazo propio de la transacción borra el archivo nuevo', () => {
    it.each(CUALES)(
      'ruta de la %s, 401: el actor se desactiva entre la comprobación previa y la transacción: 401 NO_AUTENTICADO, el archivo nuevo se borra, foto_clave y el archivo anterior no cambian y no se audita',
      async (cual) => {
        expect((await subir(cual)).status).toBe(204);
        const anterior = (await claveDe(cual)) as string;
        const auditoriaAntes = await contarAuditoria(esc.e.A.id);
        almacen.llamadas.length = 0;
        almacen.alGuardar = async () => {
          await actualizarUsuario(esc.e.A.id, esc.e.secretariaA.id, { estado: 'INACTIVO', version_token: 1 });
        };

        const respuesta = await subir(cual, png(140, 140));

        expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([401, 'NO_AUTENTICADO']);
        expect(operaciones('guardar'), 'la subida llegó a guardar el archivo nuevo').toHaveLength(1);
        const nuevo = (operaciones('guardar')[0] as { clave: string }).clave;
        expect(existeArchivoDeClave(ctx.raiz, nuevo), 'el archivo nuevo debía borrarse').toBe(false);
        expect(
          operaciones('borrar').map((l) => l.clave),
          'solo se borra el nuevo, nunca el anterior',
        ).toEqual([nuevo]);
        expect(await claveDe(cual)).toBe(anterior);
        expect(archivos(cual)).toEqual([anterior]);
        expect(await contarAuditoria(esc.e.A.id)).toBe(auditoriaAntes);
      },
    );

    it('ruta de la solicitud, 409: la solicitud se cancela entre la comprobación previa y la transacción: 409 SOLICITUD_NO_EDITABLE, el archivo nuevo se borra, foto_clave y el archivo anterior no cambian y no se audita', async () => {
      expect((await subir('solicitud')).status).toBe(204);
      const anterior = (await claveDe('solicitud')) as string;
      const auditoriaAntes = await contarAuditoria(esc.e.A.id);
      almacen.llamadas.length = 0;
      almacen.alGuardar = cancelar(cliente.solicitudId);

      const respuesta = await subir('solicitud', png(140, 140));

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(Object.keys(respuesta.body ?? {}).sort()).toEqual(['codigo', 'mensaje']);
      const nuevo = (operaciones('guardar')[0] as { clave: string }).clave;
      expect(existeArchivoDeClave(ctx.raiz, nuevo), 'el archivo nuevo debía borrarse').toBe(false);
      expect(operaciones('borrar').map((l) => l.clave)).toEqual([nuevo]);
      expect(await claveDe('solicitud')).toBe(anterior);
      expect(archivos('solicitud')).toEqual([anterior]);
      expect(await contarAuditoria(esc.e.A.id)).toBe(auditoriaAntes);
    });

    it('ruta de la solicitud, 409 sin foto anterior: el archivo nuevo se borra y foto_clave sigue nula; la carpeta del alumno queda vacía', async () => {
      almacen.alGuardar = cancelar(cliente.solicitudId);

      const respuesta = await subir('solicitud');

      expect(respuesta.status, respuesta.texto).toBe(409);
      expect(await claveDe('solicitud')).toBeNull();
      expect(archivosBajo(ctx.raiz)).toEqual([]);
    });

    it('ruta de la solicitud, 409 con el borrado del archivo nuevo que también falla: la respuesta sigue siendo la del rechazo (409), foto_clave no cambia y el aviso lleva solo el tipo del error', async () => {
      almacen.alGuardar = cancelar(cliente.solicitudId);
      almacen.fallarBorrar = true;

      const respuesta = await subir('solicitud');

      expect([respuesta.status, codigoDeRespuesta(respuesta)], respuesta.texto).toEqual([409, 'SOLICITUD_NO_EDITABLE']);
      expect(await claveDe('solicitud')).toBeNull();
      await esperarHasta(() => avisosDeBorrado().length > 0);
      const avisos = avisosDeBorrado();
      expect(avisos).toHaveLength(1);
      expect(avisos[0]?.['level']).toBe(40);
      expect(avisos[0]?.['academiaId']).toBe(esc.e.A.id);
      expect(avisos[0]?.['error']).toEqual({ tipo: 'ErrorDeAlmacenDePrueba' });
      const texto = lineas.join('\n');
      for (const secreto of [TEXTO_DE_RUTA_EN_EL_ERROR, 'NombrePropioQueNoSeRegistra', cliente.dni, 'Valeria']) {
        expect(texto, `el registro lleva ${secreto}`).not.toContain(secreto);
      }
    });
  });

  describe('orden de bloqueos: la subida y el envío del formulario con el mismo DNI a la vez', () => {
    it('la prueba retiene la fila de la solicitud; la subida del panel y el envío quedan esperando y, al soltar, no hay 500 ni 40P01 (la subida 204 y el envío 409 DNI_YA_REGISTRADO)', async () => {
      const cuerpo = await cuerpoInscripcion(esc.e, { sobre: { alumno: { dni: cliente.dni } } });

      const { resultados } = await conRetencion({
        academiaId: esc.e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar(
            'SELECT id FROM solicitudes_inscripcion WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [esc.e.A.id, cliente.solicitudId],
          );
        },
        // La subida primero y el envío después, cuando la subida ya espera: el orden de bloqueos (alumno antes que solicitud) las deja sin ciclo.
        enviar: [() => subir('solicitud'), () => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo)],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      const [subida, envio] = resultados;
      expect(subida?.status, subida?.texto).toBe(204);
      expect(envio?.status, envio?.texto).toBe(409);
      expect(envio?.body?.['codigo']).toBe('DNI_YA_REGISTRADO');
      expect(await claveDe('solicitud')).toMatch(patronDeClave(esc.e.A.id, cliente.alumnoId));
    });

    it('lo mismo con el envío primero y la subida del panel después', async () => {
      const cuerpo = await cuerpoInscripcion(esc.e, { sobre: { alumno: { dni: cliente.dni } } });

      const { resultados } = await conRetencion({
        academiaId: esc.e.A.id,
        retener: async (retenedor) => {
          await retenedor.consultar(
            'SELECT id FROM solicitudes_inscripcion WHERE academia_id = $1::uuid AND id = $2::uuid FOR UPDATE',
            [esc.e.A.id, cliente.solicitudId],
          );
        },
        enviar: [() => ctx.http.post(rutaPublica('academia-a', '/inscripcion'), cuerpo), () => subir('solicitud')],
        liberar: 'ROLLBACK',
        enOrden: true,
      });

      const [envio, subida] = resultados;
      expect(envio?.status, envio?.texto).toBe(409);
      expect(subida?.status, subida?.texto).toBe(204);
    });
  });
});
