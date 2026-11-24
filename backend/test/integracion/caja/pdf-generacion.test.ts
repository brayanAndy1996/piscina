// spec: 006-caja (pruebas protegidas)
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerAuditoriaDeAcademia } from '../../utilidades/datos';
import {
  AYER,
  cajaDe,
  cerrarCajaDePrueba,
  codigoDe,
  cookiesDeCaja,
  crearAlumnoDeCaja,
  crearCajaDePrueba,
  crearEscenarioDeCaja,
  crearIngresoDePrueba,
  cuerpoApertura,
  cuerpoCierre,
  cuerpoEgreso,
  cuerpoReapertura,
  enLima,
  type EscenarioCaja,
  instantaneaDeCaja,
  rutaCaja,
} from '../../utilidades/caja';
import {
  type AppHistorial,
  archivosDelAlmacen,
  conexionesInactivasEnTransaccion,
  crearAppHistorial,
  exigirGeneradorInyectable,
  exigirRutasDeHistorial,
  GeneradorDePrueba,
  PDF_FALSO,
  reabrirCajaDePrueba,
  rutaPdf,
} from '../../utilidades/caja-historial';
import { leerInfoPdf, tieneFormaDePdf } from '../../utilidades/pdf';
import { conLimite, observar } from '../../utilidades/planes-clases';
import { AHORA_PRUEBAS } from '../../utilidades/usuarios';

// Criterio 43, PQ8 y PQ9 (crítico, regla "los efectos secundarios ocurren después de confirmar" de CLAUDE.md; D-10; DT-2): el PDF se arma bajo pedido con lo que
// ya está confirmado, sin guardar archivos. El generador es inyectable (`GENERADOR_PDF_CIERRE`, reemplazado con `overrideProvider`).
//   a) con un generador espía, un POST …/cierre (y una apertura, un egreso y una reapertura) no lo llama ni una vez, y en ALMACEN_DIRECTORIO no aparece
//      ningún archivo nuevo;
//   b) con un generador que rechaza su promesa y con otro que lanza al llamarlo, la descarga responde 500 ERROR_INTERNO (JSON, sin Content-Disposition); las
//      filas de `cajas`, `movimientos_caja`, `cierres_caja` y `auditoria` de la academia quedan iguales; con el generador real de nuevo, la misma descarga
//      responde 200;
//   c) con un generador que la prueba retiene (una promesa que la prueba resuelve después): mientras `generar` está en curso, ninguna conexión del rol de la
//      app a la base de pruebas está `idle in transaction` (la lectura ya terminó); después la prueba deja seguir al generador real y la descarga responde 200;
//   d) dos descargas seguidas del mismo cierre devuelven los mismos bytes, también con el proceso en TZ=Asia/Tokyo; `info.CreationDate` es `cerradoEn` y
//      `info.Title` es `Cierre de caja AAAA-MM-DD N`, sin textos de usuarios; el contenido cambia solo si ese cierre se reabre.

const ZONA_ORIGINAL = process.env['TZ'];

describe('el PDF se genera fuera de la escritura (criterio 43, PQ8 y PQ9)', () => {
  const generador = new GeneradorDePrueba();
  let ctx: AppHistorial;
  let e: EscenarioCaja;
  let cookies: ReturnType<typeof cookiesDeCaja>;
  /** K: la caja del 2 de noviembre, cerrada por la secretaria con su cierre 1. */
  let k: { id: string };

  beforeAll(async () => {
    ctx = await crearAppHistorial(AHORA_PRUEBAS, generador);
  });
  beforeEach(async () => {
    process.env['TZ'] = ZONA_ORIGINAL ?? 'UTC';
    exigirRutasDeHistorial(ctx.app);
    exigirGeneradorInyectable();
    generador.restablecer();
    ctx.reloj.fijar(AHORA_PRUEBAS);
    e = await crearEscenarioDeCaja();
    cookies = cookiesDeCaja(e);
    const alumno = await crearAlumnoDeCaja(e.A.id);
    k = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: '2026-11-02', monto_inicial: '100.00' });
    await crearIngresoDePrueba(e.A.id, k.id, e.secretariaA.id, alumno.id, {
      monto: '42.00',
      registrado_en: enLima('2026-11-02', '10:00'),
    });
    await cerrarCajaDePrueba(e.A.id, k.id, e.secretariaA.id, {
      montoDeclarado: '140.00',
      observacion: 'Faltaron dos soles',
      cerradoEn: enLima('2026-11-02', '18:00:00'),
    });
  });
  afterEach(() => {
    generador.cancelarRetenido();
    if (ZONA_ORIGINAL === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ZONA_ORIGINAL;
  });
  afterAll(async () => {
    await ctx?.http.cerrar();
  });

  const pdf = (id = k.id, numero: number | string = 1, cookie = cookies.admin) =>
    ctx.http.get(rutaPdf(id, numero), cookie);
  const estado = async () => ({
    cajasA: await instantaneaDeCaja(e.A.id),
    cajasB: await instantaneaDeCaja(e.B.id),
    auditoriaA: JSON.stringify(await leerAuditoriaDeAcademia(e.A.id)),
    auditoriaB: JSON.stringify(await leerAuditoriaDeAcademia(e.B.id)),
  });

  it('PQ8: el generador reemplazado es el que se usa: una descarga lo llama una vez y responde con sus bytes (y un 404 no lo llama)', async () => {
    const respuesta = await pdf();
    const noExiste = await pdf(k.id, 2);

    expect(respuesta.status, respuesta.texto).toBe(200);
    expect(respuesta.cuerpo.equals(PDF_FALSO)).toBe(true);
    expect(noExiste.status).toBe(404);
    expect(generador.llamadas).toHaveLength(1);
  });

  describe('a) ninguna escritura genera el PDF ni guarda archivos', () => {
    it('PQ9 a: abrir, registrar un egreso, cerrar y reabrir la caja no llaman al generador ni crean ningún archivo en ALMACEN_DIRECTORIO', async () => {
      const archivosAntes = archivosDelAlmacen();

      const apertura = await ctx.http.enviar(
        'POST',
        '/api/cajas',
        cookies.secretaria,
        cuerpoApertura({ montoInicial: '100.00' }),
      );
      expect(apertura.status, apertura.texto).toBe(201);
      const cajaId = cajaDe(apertura).id;
      const egreso = await ctx.http.enviar(
        'POST',
        rutaCaja(cajaId, '/egresos'),
        cookies.secretaria,
        cuerpoEgreso({ monto: '10.00' }),
      );
      expect(egreso.status, egreso.texto).toBe(201);
      const cierre = await ctx.http.enviar(
        'POST',
        rutaCaja(cajaId, '/cierre'),
        cookies.secretaria,
        cuerpoCierre({ montoDeclarado: '90.00', ultimoMovimientoVisto: 1 }),
      );
      expect(cierre.status, cierre.texto).toBe(200);
      const reapertura = await ctx.http.enviar(
        'POST',
        rutaCaja(cajaId, '/reapertura'),
        cookies.admin,
        cuerpoReapertura(),
      );
      expect(reapertura.status, reapertura.texto).toBe(200);

      expect(generador.llamadas, 'una escritura llamó al generador del PDF').toHaveLength(0);
      expect(archivosDelAlmacen()).toEqual(archivosAntes);
    });

    it('PQ9 a: las lecturas del historial y del detalle tampoco generan el PDF; solo la descarga lo hace, y tampoco guarda ningún archivo', async () => {
      const archivosAntes = archivosDelAlmacen();

      expect((await ctx.http.get('/api/cajas?desde=2026-11-01&hasta=2026-11-11', cookies.admin)).status).toBe(200);
      expect((await ctx.http.get(`/api/cajas/${k.id}`, cookies.admin)).status).toBe(200);
      expect(generador.llamadas).toHaveLength(0);
      expect((await pdf()).status).toBe(200);
      expect((await pdf()).status).toBe(200);

      expect(generador.llamadas, 'una llamada por descarga: el PDF no se guarda para reutilizarlo').toHaveLength(2);
      expect(archivosDelAlmacen()).toEqual(archivosAntes);
    });
  });

  describe('b) una falla del generador responde 500 sin cambiar nada', () => {
    it.each(['rechaza', 'lanza'] as const)(
      'PQ9 b: con el generador que %s, la descarga responde 500 ERROR_INTERNO (JSON, no-store, sin Content-Disposition) y las filas y la auditoría no cambian; con el real de nuevo, la misma descarga responde 200',
      async (modo) => {
        const antes = await estado();
        generador.modo = modo;

        const falla = await pdf();

        expect(falla.status, falla.texto).toBe(500);
        expect(codigoDe(falla)).toBe('ERROR_INTERNO');
        expect(falla.headers.get('content-type') ?? '').toContain('application/json');
        expect(falla.cacheControl).toBe('no-store');
        expect(falla.headers.get('content-disposition')).toBeNull();
        expect(falla.texto, 'el mensaje del error interno no sale en la respuesta').not.toContain('Falla simulada');
        expect(generador.llamadas).toHaveLength(1);
        expect(await estado()).toEqual(antes);

        generador.modo = 'real';
        const bien = await pdf();

        expect(bien.status, bien.texto.slice(0, 300)).toBe(200);
        expect(bien.headers.get('content-type')).toBe('application/pdf');
        expect(tieneFormaDePdf(bien.cuerpo)).toBe(true);
        expect(await estado()).toEqual(antes);
      },
    );

    it('PQ9 b: después de la falla, la aplicación sigue sirviendo (la lista responde 200) y una caja de otra academia no se ve afectada', async () => {
      generador.modo = 'lanza';
      expect((await pdf()).status).toBe(500);

      const lista = await ctx.http.get('/api/cajas?desde=2026-11-01&hasta=2026-11-11', cookies.admin);
      const deB = await ctx.http.get('/api/cajas?desde=2026-11-01&hasta=2026-11-11', cookies.adminB);

      expect(lista.status, lista.texto).toBe(200);
      expect(deB.status, deB.texto).toBe(200);
    });
  });

  describe('c) la lectura ya terminó mientras se genera', () => {
    it('PQ9 c: mientras el generador retenido está en curso, ninguna conexión del rol de la app queda idle in transaction; la aplicación atiende otras peticiones; al soltarlo, la descarga responde 200', async () => {
      generador.modo = 'retiene';
      const descarga = observar(pdf());

      await conLimite(generador.esperarLlamadas(1), 'el generador del PDF nunca fue llamado');

      expect(descarga.terminada(), 'la descarga no puede terminar antes de que el generador responda').toBe(false);
      expect(
        await conexionesInactivasEnTransaccion(),
        'la lectura de los datos debe terminar (commit) antes de llamar al generador',
      ).toEqual([]);
      const mientras = await conLimite(
        ctx.http.get('/api/cajas?desde=2026-11-01&hasta=2026-11-11', cookies.admin),
        'una lectura esperó la generación del PDF',
      );
      expect(mientras.status, mientras.texto).toBe(200);
      expect(descarga.terminada()).toBe(false);

      await generador.soltarRetenido();
      const respuesta = await conLimite(descarga.resultado, 'la descarga no terminó al soltar el generador');

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      expect(respuesta.headers.get('content-type')).toBe('application/pdf');
      expect(tieneFormaDePdf(respuesta.cuerpo)).toBe(true);
      expect(await conexionesInactivasEnTransaccion()).toEqual([]);
    });

    it('PQ9 c: mientras se genera el PDF no queda ningún bloqueo: un egreso a la caja abierta de hoy y un cierre responden sin esperar', async () => {
      const abierta = await ctx.http.enviar(
        'POST',
        '/api/cajas',
        cookies.secretaria,
        cuerpoApertura({ montoInicial: '100.00' }),
      );
      expect(abierta.status, abierta.texto).toBe(201);
      const cajaId = cajaDe(abierta).id;
      generador.modo = 'retiene';
      const descarga = observar(pdf());
      await conLimite(generador.esperarLlamadas(1), 'el generador del PDF nunca fue llamado');

      const egreso = await conLimite(
        ctx.http.enviar('POST', rutaCaja(cajaId, '/egresos'), cookies.secretaria, cuerpoEgreso({ monto: '10.00' })),
        'un egreso esperó mientras se generaba el PDF',
      );
      const cierre = await conLimite(
        ctx.http.enviar(
          'POST',
          rutaCaja(cajaId, '/cierre'),
          cookies.secretaria,
          cuerpoCierre({ montoDeclarado: '90.00', ultimoMovimientoVisto: 1 }),
        ),
        'un cierre esperó mientras se generaba el PDF',
      );

      expect(egreso.status, egreso.texto).toBe(201);
      expect(cierre.status, cierre.texto).toBe(200);
      expect(descarga.terminada()).toBe(false);
      await generador.soltarRetenido();
      expect((await conLimite(descarga.resultado, 'la descarga no terminó')).status).toBe(200);
    });
  });

  describe('d) la generación es determinista', () => {
    it('PQ9 d: dos descargas seguidas del mismo cierre dan los mismos bytes, también con el proceso en TZ=Asia/Tokyo y con el reloj en otro instante', async () => {
      generador.modo = 'real';
      const descargas: Buffer[] = [];

      for (const [zona, instante] of [
        ['UTC', AHORA_PRUEBAS],
        ['UTC', AHORA_PRUEBAS],
        ['Asia/Tokyo', AHORA_PRUEBAS],
        ['Asia/Tokyo', new Date(AHORA_PRUEBAS.getTime() + 60 * 60 * 1000)],
      ] as const) {
        process.env['TZ'] = zona;
        ctx.reloj.fijar(instante);

        const respuesta = await pdf(k.id, 1, cookiesDeCaja(e, instante).admin);

        expect(respuesta.status, `${zona}: ${respuesta.texto.slice(0, 300)}`).toBe(200);
        descargas.push(respuesta.cuerpo);
      }

      const [primera, ...demas] = descargas;
      demas.forEach((otra, i) =>
        expect(otra.equals(primera as Buffer), `la descarga ${i + 2} difiere de la primera`).toBe(true),
      );
    });

    it('PQ9 d: info.CreationDate es el cerradoEn del cierre (a la precisión de segundos del PDF) y info.Title es "Cierre de caja AAAA-MM-DD N", sin textos de usuarios', async () => {
      generador.modo = 'real';

      const respuesta = await pdf(k.id, 1);

      expect(respuesta.status, respuesta.texto.slice(0, 300)).toBe(200);
      const info = leerInfoPdf(respuesta.cuerpo);
      expect(info.CreationDate?.toISOString()).toBe(enLima('2026-11-02', '18:00:00').toISOString());
      expect(info.Title).toBe('Cierre de caja 2026-11-02 1');
      for (const texto of Object.values(info)) {
        for (const dato of ['Lucia', 'Benites', 'Faltaron dos soles', 'Academia A'])
          expect(String(texto)).not.toContain(dato);
      }
    });

    it('PQ9 d: el contenido cambia solo si ese cierre se reabre: tras la reapertura, el PDF del cierre 1 es distinto; el de otro cierre no se mezcla', async () => {
      generador.modo = 'real';
      const caja = await crearCajaDePrueba(e.A.id, e.secretariaA.id, { fecha: AYER, monto_inicial: '50.00' });
      await cerrarCajaDePrueba(e.A.id, caja.id, e.secretariaA.id, { cerradoEn: enLima(AYER, '18:00:00') });
      const antes = await pdf(caja.id, 1);

      const igual = await pdf(caja.id, 1);
      await reabrirCajaDePrueba(e.A.id, caja.id, 1, e.adminA.id, enLima(AYER, '19:00:00'), 'Motivo de la reapertura');
      const despues = await pdf(caja.id, 1);

      expect(antes.status, antes.texto.slice(0, 300)).toBe(200);
      expect(igual.cuerpo.equals(antes.cuerpo)).toBe(true);
      expect(despues.status, despues.texto.slice(0, 300)).toBe(200);
      expect(despues.cuerpo.equals(antes.cuerpo)).toBe(false);
      expect(
        leerInfoPdf(despues.cuerpo).CreationDate?.toISOString(),
        'la fecha de creación sigue siendo la del cierre',
      ).toBe(leerInfoPdf(antes.cuerpo).CreationDate?.toISOString());
    });

    it('PQ1 y PQ9 d: un parámetro de consulta de más se ignora y la descarga no depende de nada aleatorio: dos descargas dan los mismos bytes', async () => {
      generador.modo = 'real';
      const una = await ctx.http.enviar('GET', `${rutaPdf(k.id, 1)}?x=${randomUUID()}`, cookies.admin);
      const otra = await ctx.http.enviar('GET', `${rutaPdf(k.id, 1)}?x=${randomUUID()}`, cookies.admin);

      expect(una.status, una.texto.slice(0, 300)).toBe(200);
      expect(otra.cuerpo.equals(una.cuerpo)).toBe(true);
    });
  });
});
