import { expect, test } from '@playwright/test';

test('la página de inicio muestra el título y que el sistema está en línea', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('AquaGestión');
  await expect(page.getByRole('heading', { level: 1, name: 'AquaGestión' })).toBeVisible();
  await expect(page.getByText('Sistema en línea')).toBeVisible();
});
