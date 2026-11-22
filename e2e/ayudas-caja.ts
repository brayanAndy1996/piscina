import { randomInt } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { SUPERADMIN_E2E } from './datos-e2e';

// Pasos que comparten las pruebas E2E de la caja (006a y 006b): cada prueba crea su propia academia y su propio administrador.

export function dniInventado(): string {
  return String(randomInt(30_000_000, 99_999_999));
}

export async function crearAcademiaConAdministrador(
  page: Page,
  nombreCorto: string,
  nombreAcademia: string,
  dni: string,
) {
  await page.goto('/plataforma/ingresar');
  await page.getByLabel('Correo').fill(SUPERADMIN_E2E.correo);
  await page.getByLabel('Contraseña').fill(SUPERADMIN_E2E.clave);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Academias' })).toBeVisible();

  await page.getByRole('button', { name: 'Nueva academia' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill(nombreAcademia);
  await page.getByLabel('Nombre corto').fill(nombreCorto);
  await page.getByRole('button', { name: 'Crear academia' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: nombreCorto })).toContainText(nombreAcademia);

  await page.getByRole('button', { name: `Administradores de ${nombreAcademia}`, exact: true }).click();
  const lista = page.getByRole('dialog', { name: `Administradores de ${nombreAcademia}` });
  await lista.getByRole('button', { name: 'Nuevo administrador' }).click();
  await page.getByLabel('DNI').fill(dni);
  await page.getByLabel('Nombres').fill('Rosa');
  await page.getByLabel('Apellidos').fill('Quispe Mamani');
  await page.getByRole('button', { name: 'Crear administrador' }).click();
  await expect(lista).toContainText(dni);
  await lista.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/plataforma\/ingresar$/);
}

/** La recepción trabaja en PC, pero la caja también se mira desde el celular (RNF-01): a 360 px nada debe desbordar la pantalla. */
export async function verificarSinDesplazamientoHorizontal(page: Page) {
  const tamanoOriginal = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 780 });
  const ancho = await page.evaluate(() => ({ contenido: document.documentElement.scrollWidth, ventana: innerWidth }));
  expect(ancho.contenido).toBeLessThanOrEqual(ancho.ventana);
  if (tamanoOriginal) await page.setViewportSize(tamanoOriginal);
}

export async function ingresarYCambiarClave(page: Page, nombreCorto: string, dni: string, claveNueva: string) {
  await page.goto(`/a/${nombreCorto}/ingresar`);
  await page.getByLabel('DNI').fill(dni);
  await page.getByLabel('Contraseña').fill(dni);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/cambiar-clave$/);
  await page.getByLabel('Contraseña actual').fill(dni);
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(claveNueva);
  await page.getByLabel('Confirma la contraseña nueva').fill(claveNueva);
  await page.getByRole('button', { name: 'Guardar contraseña nueva' }).click();
  await expect(page).toHaveURL(/\/panel$/);
}
