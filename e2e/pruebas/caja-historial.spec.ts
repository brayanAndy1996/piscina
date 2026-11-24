import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  crearAcademiaConAdministrador,
  dniInventado,
  ingresarYCambiarClave,
  verificarSinDesplazamientoHorizontal,
} from '../ayudas-caja';

// Historia 006b, criterio 44: el historial de caja de punta a punta. El administrador de una academia nueva abre la caja, registra un
// egreso y la cierra con un faltante; después entra al historial desde el inicio, filtra por fechas, abre el detalle, descarga el PDF del
// cierre (un archivo que empieza con %PDF-), reabre la caja con un motivo y descarga otra vez el PDF del cierre ya reabierto. Cada corrida
// crea su propia academia y su propio DNI: no depende de la semilla ni de lo que dejaron otras corridas.

/** La fecha de hoy en Lima, como la ve la web (`dd/MM/aaaa`) y como la pide la API (`AAAA-MM-DD`). */
function hoyEnLima() {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date())
      .map((parte) => [parte.type, parte.value]),
  );
  const iso = `${partes['year']}-${partes['month']}-${partes['day']}`;
  return { iso, vista: `${partes['day']}/${partes['month']}/${partes['year']}` };
}

async function abrirYCerrarConFaltante(page: Page) {
  await page.goto('/panel/caja');
  await page.getByLabel('Monto inicial (S/)').fill('100');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByText('Caja abierta con S/ 100.00.')).toBeVisible();

  await page.getByRole('button', { name: 'Registrar egreso' }).click();
  const egreso = page.getByRole('dialog', { name: 'Registrar egreso' });
  await egreso.getByLabel('Descripción').fill('Compra de tizas');
  await egreso.getByLabel('Monto (S/)').fill('15.50');
  await egreso.getByLabel('Comprobante (opcional)').fill('Boleta B001-123');
  await egreso.getByRole('button', { name: 'Registrar egreso' }).click();
  await expect(page.getByText('Egreso registrado: S/ 15.50.')).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  const cierre = page.getByRole('dialog', { name: 'Cerrar caja' });
  await cierre.getByLabel('Efectivo contado (S/)').fill('80');
  await cierre.getByLabel('Observación (obligatoria)').fill('Faltó el vuelto de la compra');
  await cierre.getByRole('button', { name: 'Cerrar caja' }).click();
  await expect(page.getByRole('region', { name: 'Resultado del cierre' })).toContainText('Faltante de S/ 4.50');
}

/** Pulsa "Descargar PDF" de un cierre y devuelve el nombre sugerido y el contenido del archivo que recibió el navegador. */
async function descargarPdf(page: Page, numeroDeCierre: number) {
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: `Descargar PDF del cierre ${numeroDeCierre}` }).click();
  const archivo = await descarga;
  const ruta = await archivo.path();
  const contenido = await readFile(ruta);
  return { nombre: archivo.suggestedFilename(), contenido };
}

test('el administrador consulta el historial, filtra, descarga el PDF del cierre y reabre la caja desde el detalle', async ({
  page,
}) => {
  const nombreCorto = `e2e-${randomBytes(4).toString('hex')}`;
  const nombreAcademia = `Academia E2E ${nombreCorto}`;
  const dni = dniInventado();
  const claveNueva = `Clave-nueva-${randomBytes(4).toString('hex')}`;
  const hoy = hoyEnLima();

  await crearAcademiaConAdministrador(page, nombreCorto, nombreAcademia, dni);
  await ingresarYCambiarClave(page, nombreCorto, dni, claveNueva);
  await abrirYCerrarConFaltante(page);

  // 1. Desde el inicio se llega al historial, que muestra los últimos 31 días con la caja de hoy.
  await page.goto('/panel');
  await page.getByRole('link', { name: /^Historial de caja/ }).click();
  await expect(page).toHaveURL(/\/panel\/cajas$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Historial de caja' })).toBeVisible();
  await expect(page.getByText(/Mostrando las cajas del \d{2}\/\d{2}\/\d{4} al /)).toContainText(`al ${hoy.vista}.`);
  const lista = page.getByRole('list', { name: 'Cajas' });
  const fila = lista.getByRole('listitem');
  await expect(fila).toHaveCount(1);
  await expect(fila).toContainText(`Caja del ${hoy.vista}`);
  await expect(fila).toContainText('Cerrada');
  await expect(fila).toContainText('Abierta por Rosa Quispe Mamani');
  await expect(fila).toContainText('Faltante de S/ 4.50');
  await expect(fila).toContainText('S/ 80.00');
  await expect(fila).toContainText('S/ 15.50');
  await expect(fila).not.toContainText('Tardío');

  // 2. El filtro explica un rango que no vale sin pedirlo, y acepta uno que sí.
  await page.getByLabel('Desde').fill('2099-01-01');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.getByLabel('Desde')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('La fecha inicial no puede ser posterior a la final.')).toBeVisible();
  await page.getByLabel('Desde').fill('2020-01-01');
  await page.getByLabel('Hasta').fill('2020-01-31');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.getByText('Mostrando las cajas del 01/01/2020 al 31/01/2020.')).toBeVisible();
  await expect(page.getByText('No hay cajas en estas fechas')).toBeVisible();
  await page.getByLabel('Desde').fill(hoy.iso);
  await page.getByLabel('Hasta').fill(hoy.iso);
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.getByText(`Mostrando las cajas del ${hoy.vista} al ${hoy.vista}.`)).toBeVisible();
  await expect(fila).toHaveCount(1);

  await verificarSinDesplazamientoHorizontal(page);

  // 3. El detalle muestra el resumen, el cierre con su observación y los movimientos, sin egresos ni cierre.
  await page.getByRole('link', { name: `Caja del ${hoy.vista}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Detalle de la caja' })).toBeVisible();
  const cierre1 = page.getByRole('article', { name: 'Cierre 1' });
  await expect(cierre1).toContainText('Faltante de S/ 4.50');
  await expect(cierre1).toContainText('Faltó el vuelto de la compra');
  await expect(cierre1).not.toContainText('Reabierto');
  await expect(page.getByRole('list', { name: 'Movimientos' })).toContainText('Egreso: Compra de tizas');
  await expect(page.getByRole('button', { name: 'Registrar egreso' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cerrar caja' })).toHaveCount(0);

  await verificarSinDesplazamientoHorizontal(page);

  // 4. El PDF del cierre llega como archivo, con su nombre y su contenido.
  const primero = await descargarPdf(page, 1);
  expect(primero.nombre).toBe(`cierre-caja-${hoy.iso}-1.pdf`);
  expect(primero.contenido.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(primero.contenido.length).toBeGreaterThan(500);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // 5. El administrador reabre la caja desde el detalle: pide el motivo y la caja de hoy vuelve a admitir egresos.
  await page.getByRole('button', { name: 'Reabrir caja' }).click();
  const reapertura = page.getByRole('dialog', { name: 'Reabrir caja' });
  await expect(reapertura).toContainText('Volverá a admitir egresos y cobros.');
  await reapertura.getByRole('button', { name: 'Reabrir caja' }).click();
  await expect(reapertura.getByLabel('Motivo de la reapertura')).toHaveAttribute('aria-invalid', 'true');
  await reapertura.getByLabel('Motivo de la reapertura').fill('Faltaba registrar un gasto');
  await reapertura.getByRole('button', { name: 'Reabrir caja' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Caja reabierta. Ya admite egresos y cobros.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ir a la caja del día' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reabrir caja' })).toHaveCount(0);
  await expect(cierre1).toContainText('Reabierto por Rosa Quispe Mamani');
  await expect(cierre1).toContainText('Motivo: Faltaba registrar un gasto');

  // 6. El cierre reabierto sigue teniendo su PDF.
  const reabierto = await descargarPdf(page, 1);
  expect(reabierto.nombre).toBe(`cierre-caja-${hoy.iso}-1.pdf`);
  expect(reabierto.contenido.subarray(0, 5).toString('latin1')).toBe('%PDF-');

  // 7. La lista refleja la caja abierta otra vez (con su último cierre) y ninguna sesión se guardó en el navegador.
  await page.getByRole('link', { name: /Volver al historial de caja/ }).click();
  await expect(fila).toContainText('Abierta');
  await expect(fila).not.toContainText('Cerrada');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
