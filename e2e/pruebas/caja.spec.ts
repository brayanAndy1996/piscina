import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  crearAcademiaConAdministrador,
  dniInventado,
  ingresarYCambiarClave,
  verificarSinDesplazamientoHorizontal,
} from '../ayudas-caja';

// Historia 006a, criterio 38: la caja del día de punta a punta. El superadmin crea una academia y su administrador; el administrador entra,
// cambia su contraseña, abre la caja con S/ 100, registra un egreso de S/ 15.50, cierra con S/ 80 (faltante de S/ 4.50) con su
// observación y ve el resultado; después la reabre con un motivo. Cada corrida crea su propia academia y su propio DNI: no depende de la
// semilla ni de lo que dejaron corridas anteriores (en la base de pruebas no hay caja de ninguna otra academia que pueda estorbar).

test('el administrador abre la caja, registra un egreso, cierra con un faltante y su observación, ve el resultado y la reabre', async ({
  page,
}) => {
  const nombreCorto = `e2e-${randomBytes(4).toString('hex')}`;
  const nombreAcademia = `Academia E2E ${nombreCorto}`;
  const dni = dniInventado();
  const claveNueva = `Clave-nueva-${randomBytes(4).toString('hex')}`;

  await crearAcademiaConAdministrador(page, nombreCorto, nombreAcademia, dni);
  await ingresarYCambiarClave(page, nombreCorto, dni, claveNueva);

  // 1. Desde el inicio se llega a la caja, que todavía no está abierta.
  await page.getByRole('link', { name: /^Caja/ }).click();
  await expect(page).toHaveURL(/\/panel\/caja$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Caja del día' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Abrir caja' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar caja' })).toHaveCount(0);

  // 2. Un monto mal escrito se explica y no abre nada; con S/ 100 la caja queda abierta.
  await page.getByLabel('Monto inicial (S/)').fill('100,50');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByLabel('Monto inicial (S/)')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Monto inicial (S/)').fill('100');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByText('Caja abierta con S/ 100.00.')).toBeVisible();
  const resumen = page.getByRole('region', { name: 'Resumen de la caja' });
  await expect(resumen).toContainText('Abierta por Rosa Quispe Mamani');
  await expect(resumen.getByRole('listitem').filter({ hasText: 'Efectivo esperado' })).toContainText('S/ 100.00');
  await expect(page.getByText('Todavía no hay movimientos en esta caja.')).toBeVisible();

  // 3. Un egreso mayor que el efectivo se rechaza con el disponible; uno de S/ 15.50 entra y baja el esperado.
  await page.getByRole('button', { name: 'Registrar egreso' }).click();
  const egreso = page.getByRole('dialog', { name: 'Registrar egreso' });
  await egreso.getByLabel('Descripción').fill('Compra de tizas');
  await egreso.getByLabel('Monto (S/)').fill('100.01');
  await egreso.getByRole('button', { name: 'Registrar egreso' }).click();
  await expect(egreso.getByRole('alert')).toContainText('No hay tanto efectivo en la caja: solo hay S/ 100.00.');
  await egreso.getByLabel('Monto (S/)').fill('15.50');
  await egreso.getByLabel('Comprobante (opcional)').fill('Boleta B001-123');
  await egreso.getByRole('button', { name: 'Registrar egreso' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Egreso registrado: S/ 15.50.')).toBeVisible();
  const movimientos = page.getByRole('list', { name: 'Movimientos' });
  await expect(movimientos).toContainText('Egreso: Compra de tizas');
  await expect(movimientos).toContainText('Comprobante: Boleta B001-123');
  await expect(resumen.getByRole('listitem').filter({ hasText: 'Efectivo esperado' })).toContainText('S/ 84.50');

  await verificarSinDesplazamientoHorizontal(page);

  // 4. El cierre muestra el esperado antes de contar; con S/ 80 el faltante es de S/ 4.50 y pide la observación.
  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  const cierre = page.getByRole('dialog', { name: 'Cerrar caja' });
  await expect(cierre).toContainText('S/ 84.50');
  await cierre.getByLabel('Efectivo contado (S/)').fill('80');
  await expect(cierre.getByText('Diferencia: Faltante de S/ 4.50')).toBeVisible();
  await cierre.getByRole('button', { name: 'Cerrar caja' }).click();
  await expect(cierre.getByText('Explica la diferencia (sobrante o faltante)')).toBeVisible();
  await cierre.getByLabel('Observación (obligatoria)').fill('Faltó el vuelto de la compra');
  await cierre.getByRole('button', { name: 'Cerrar caja' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 5. El resultado queda a la vista y la caja ya no admite movimientos.
  const resultado = page.getByRole('region', { name: 'Resultado del cierre' });
  await expect(resultado).toBeVisible();
  await expect(resultado).toContainText('Faltante de S/ 4.50');
  await expect(resultado).toContainText('S/ 84.50');
  await expect(resultado).toContainText('S/ 80.00');
  await expect(resultado).toContainText('Faltó el vuelto de la compra');
  await expect(resultado).not.toContainText('Cierre tardío');
  await expect(page.getByRole('button', { name: 'Registrar egreso' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cerrar caja' })).toHaveCount(0);

  await verificarSinDesplazamientoHorizontal(page);

  // 6. Recargar la página muestra lo mismo: la caja del día cerrada, no una caja nueva.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Resultado del cierre' })).toContainText('Faltante de S/ 4.50');

  // 7. El administrador reabre la caja con su motivo (obligatorio) y vuelve a admitir egresos.
  await page.getByRole('button', { name: 'Reabrir caja' }).click();
  const reapertura = page.getByRole('dialog', { name: 'Reabrir caja' });
  await reapertura.getByRole('button', { name: 'Reabrir caja' }).click();
  await expect(reapertura.getByLabel('Motivo de la reapertura')).toHaveAttribute('aria-invalid', 'true');
  await reapertura.getByLabel('Motivo de la reapertura').fill('Faltaba registrar un gasto');
  await reapertura.getByRole('button', { name: 'Reabrir caja' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Caja reabierta. Ya admite egresos y cobros.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar egreso' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar caja' })).toBeVisible();

  // Ninguna sesión se guardó en el navegador (solo vive en la cookie httpOnly).
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
