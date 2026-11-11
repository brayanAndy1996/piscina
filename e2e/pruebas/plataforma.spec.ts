import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { SUPERADMIN_E2E } from '../datos-e2e';

async function ingresar(page: Page, clave: string = SUPERADMIN_E2E.clave) {
  await page.getByLabel('Correo').fill(SUPERADMIN_E2E.correo);
  await page.getByLabel('Contraseña').fill(clave);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

test('el superadmin ingresa, crea una academia, la suspende, la reactiva y cierra sesión', async ({
  page,
  request,
}) => {
  // Un nombre corto distinto en cada corrida: la base de pruebas conserva las academias de corridas anteriores.
  const nombreCorto = `e2e-${randomBytes(4).toString('hex')}`;
  const nombre = `Academia E2E ${nombreCorto}`;

  // Sin sesión, la lista lleva al ingreso.
  await page.goto('/plataforma/academias');
  await expect(page).toHaveURL(/\/plataforma\/ingresar$/);

  // Una contraseña incorrecta no entra y lo dice.
  await ingresar(page, 'una-clave-equivocada-123');
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');

  await ingresar(page);
  await expect(page).toHaveURL(/\/plataforma\/academias$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Academias' })).toBeVisible();
  await expect(page.getByText(SUPERADMIN_E2E.correo)).toBeVisible();

  // Crear.
  await page.getByRole('button', { name: 'Nueva academia' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill(nombre);
  await page.getByLabel('Nombre corto').fill(nombreCorto);
  await page.getByRole('button', { name: 'Crear academia' }).click();
  const fila = page.getByRole('listitem').filter({ hasText: nombreCorto });
  await expect(fila).toContainText(nombre);
  await expect(fila.getByText('Activa', { exact: true })).toBeVisible();
  expect((await request.get(`/api/a/${nombreCorto}`)).status()).toBe(200);

  // Un nombre corto repetido se rechaza junto al campo.
  await page.getByRole('button', { name: 'Nueva academia' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Otra academia');
  await page.getByLabel('Nombre corto').fill(nombreCorto);
  await page.getByRole('button', { name: 'Crear academia' }).click();
  await expect(page.getByText('Ese nombre corto ya lo usa otra academia. Elige otro.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Suspender: exige el motivo.
  await fila.getByRole('button', { name: `Suspender ${nombre}`, exact: true }).click();
  await page.getByRole('button', { name: 'Suspender academia', exact: true }).click();
  await expect(page.getByText('El motivo debe tener al menos 3 caracteres.')).toBeVisible();
  await page.getByLabel('Motivo de la suspensión').fill('Prueba E2E de suspensión');
  await page.getByRole('button', { name: 'Suspender academia', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(fila.getByText('Suspendida', { exact: true })).toBeVisible();
  await expect(fila).toContainText('Motivo: Prueba E2E de suspensión');
  expect((await request.get(`/api/a/${nombreCorto}`)).status()).toBe(403);

  // Reactivar: pide confirmación.
  await fila.getByRole('button', { name: `Reactivar ${nombre}`, exact: true }).click();
  await page.getByRole('button', { name: 'Reactivar academia', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(fila.getByText('Activa', { exact: true })).toBeVisible();
  expect((await request.get(`/api/a/${nombreCorto}`)).status()).toBe(200);

  // Cerrar sesión: vuelve al ingreso y la lista ya no se abre.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/plataforma\/ingresar$/);
  await page.goto('/plataforma/academias');
  await expect(page).toHaveURL(/\/plataforma\/ingresar$/);

  // La sesión no se guardó en el navegador (solo vive en la cookie httpOnly).
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('la plataforma se ve completa a 360 px, sin desplazamiento horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/plataforma/ingresar');
  await ingresar(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Academias' })).toBeVisible();
  await page.getByRole('button', { name: 'Nueva academia' }).click();
  await expect(page.getByRole('dialog', { name: 'Nueva academia' })).toBeVisible();
  const ancho = await page.evaluate(() => ({ contenido: document.documentElement.scrollWidth, ventana: innerWidth }));
  expect(ancho.contenido).toBeLessThanOrEqual(ancho.ventana);
});
