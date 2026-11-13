import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { SUPERADMIN_E2E } from '../datos-e2e';

// Historia 002, criterio 51: el superadmin crea una academia y su administrador; el administrador entra por
// `/a/{nombreCorto}/ingresar` con su DNI, cambia la contraseña obligatoriamente, crea una secretaria y cierra sesión; la
// secretaria entra y se le exige el cambio. Cada corrida crea su propia academia (nombre corto aleatorio) y sus propios DNI:
// no depende de la semilla, del orden de las pruebas ni de lo que dejaron corridas anteriores.

/** Un DNI inventado de 8 dígitos, distinto en cada corrida. */
function dniInventado(): string {
  return String(randomInt(30_000_000, 99_999_999));
}

async function ingresarComoSuperadmin(page: Page) {
  await page.goto('/plataforma/ingresar');
  await page.getByLabel('Correo').fill(SUPERADMIN_E2E.correo);
  await page.getByLabel('Contraseña').fill(SUPERADMIN_E2E.clave);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Academias' })).toBeVisible();
}

async function ingresarEnLaAcademia(page: Page, nombreCorto: string, dni: string, clave: string) {
  await page.goto(`/a/${nombreCorto}/ingresar`);
  await page.getByLabel('DNI').fill(dni);
  await page.getByLabel('Contraseña').fill(clave);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

test('el superadmin crea la academia y su administrador, que cambia su contraseña y crea una secretaria a la que también se le exige el cambio', async ({
  page,
}) => {
  const nombreCorto = `e2e-${randomBytes(4).toString('hex')}`;
  const nombreAcademia = `Academia E2E ${nombreCorto}`;
  const dniAdmin = dniInventado();
  const dniSecretaria = dniInventado();
  const claveNueva = `Clave-nueva-${randomBytes(4).toString('hex')}`;

  // 1. El superadmin crea la academia y su administrador (la contraseña inicial es el DNI).
  await ingresarComoSuperadmin(page);
  await page.getByRole('button', { name: 'Nueva academia' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill(nombreAcademia);
  await page.getByLabel('Nombre corto').fill(nombreCorto);
  await page.getByRole('button', { name: 'Crear academia' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: nombreCorto })).toContainText(nombreAcademia);

  await page.getByRole('button', { name: `Administradores de ${nombreAcademia}`, exact: true }).click();
  const listaAdministradores = page.getByRole('dialog', { name: `Administradores de ${nombreAcademia}` });
  await expect(listaAdministradores).toBeVisible();
  await listaAdministradores.getByRole('button', { name: 'Nuevo administrador' }).click();
  await page.getByLabel('DNI').fill(dniAdmin);
  await page.getByLabel('Nombres').fill('Rosa');
  await page.getByLabel('Apellidos').fill('Quispe Mamani');
  await page.getByRole('button', { name: 'Crear administrador' }).click();
  await expect(listaAdministradores).toContainText(dniAdmin);

  // Un DNI repetido en la misma academia se rechaza junto al campo.
  await listaAdministradores.getByRole('button', { name: 'Nuevo administrador' }).click();
  await page.getByLabel('DNI').fill(dniAdmin);
  await page.getByLabel('Nombres').fill('Otra');
  await page.getByLabel('Apellidos').fill('Persona');
  await page.getByRole('button', { name: 'Crear administrador' }).click();
  await expect(page.getByText('Ya existe una cuenta con ese DNI en esta academia.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await listaAdministradores.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/plataforma\/ingresar$/);

  // 2. El administrador entra con su DNI: una contraseña equivocada no entra; la correcta lo lleva al cambio obligatorio.
  await ingresarEnLaAcademia(page, nombreCorto, dniAdmin, 'una-clave-equivocada-123');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/a/${nombreCorto}/ingresar$`));

  await page.getByLabel('Contraseña').fill(dniAdmin);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/cambiar-clave$/);

  // No puede ir a otra página hasta cambiarla.
  await page.goto('/panel');
  await expect(page).toHaveURL(/\/cambiar-clave$/);

  // La nueva contraseña no puede ser el DNI.
  await page.getByLabel('Contraseña actual').fill(dniAdmin);
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(dniAdmin);
  await page.getByLabel('Confirma la contraseña nueva').fill(dniAdmin);
  await page.getByRole('button', { name: 'Guardar contraseña nueva' }).click();
  await expect(page).toHaveURL(/\/cambiar-clave$/);

  await page.getByLabel('Contraseña actual').fill(dniAdmin);
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(claveNueva);
  await page.getByLabel('Confirma la contraseña nueva').fill(claveNueva);
  await page.getByRole('button', { name: 'Guardar contraseña nueva' }).click();
  await expect(page).toHaveURL(/\/panel$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rosa Quispe Mamani' })).toBeVisible();
  await expect(page.getByText(nombreAcademia).first()).toBeVisible();

  // 3. El administrador crea una secretaria (también con su DNI como contraseña inicial) y ve que ya existe.
  await page.getByRole('link', { name: /Usuarios/ }).click();
  await expect(page).toHaveURL(/\/panel\/usuarios$/);
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  await page.getByLabel('DNI').fill(dniSecretaria);
  await page.getByLabel('Nombres').fill('Lucia');
  await page.getByLabel('Apellidos').fill('Benites Rojas');
  await page.getByLabel('Rol').selectOption('SECRETARIA');
  await page.getByRole('button', { name: 'Crear usuario' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Desactivar a Lucia Benites Rojas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restablecer contraseña de Lucia Benites Rojas' })).toBeVisible();

  // 4. El administrador cierra sesión: la sesión ya no abre el panel.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(new RegExp(`/a/${nombreCorto}/ingresar$`));
  await page.goto('/panel/usuarios');
  await expect(page.getByRole('heading', { name: 'Entra por el enlace de tu academia' })).toBeVisible();

  // 5. La secretaria entra con su DNI y se le exige el cambio de contraseña.
  await ingresarEnLaAcademia(page, nombreCorto, dniSecretaria, dniSecretaria);
  await expect(page).toHaveURL(/\/cambiar-clave$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Cambiar contraseña' })).toBeVisible();
  await page.goto('/panel');
  await expect(page).toHaveURL(/\/cambiar-clave$/);

  // Ninguna sesión se guardó en el navegador (solo vive en la cookie httpOnly).
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
