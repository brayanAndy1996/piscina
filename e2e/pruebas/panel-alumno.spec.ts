import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ingresarYCambiarClave, verificarSinDesplazamientoHorizontal } from '../ayudas-caja';
import { sembrarPanelDelAlumno } from '../utilidades/sembrar-panel';

// Historia 011, criterio 20: el alumno ingresa en `/a/{academia}/ingresar` con su DNI como usuario y clave, cambia la contraseña obligatoria, ve en
// `/panel` su nombre, su mensualidad y una asistencia del mes con su hora, no ve el nombre de su hermano (que tiene su propia cuenta y su propia
// asistencia con otra hora), y cierra sesión. Cada corrida siembra su propia academia por SQL (`utilidades/sembrar-panel.ts`): no depende de la
// semilla ni de la hora a la que corre. El panel es de solo lectura y se mira desde el celular (RNF-01), por eso también se revisa a 360 px.

test('el alumno entra con su DNI, cambia su contraseña, ve su mensualidad y su asistencia sin datos de su hermano, y cierra sesión', async ({
  page,
}) => {
  const datos = await sembrarPanelDelAlumno();
  const claveNueva = `Clave-nueva-${randomBytes(4).toString('hex')}`;
  const nombreCompleto = `${datos.alumno.nombres} ${datos.alumno.apellidos}`;

  // 1. Entra con su DNI como usuario y clave, y la web le exige cambiarla antes de seguir.
  await ingresarYCambiarClave(page, datos.nombreCorto, datos.alumno.dni, claveNueva);
  await expect(page.getByRole('heading', { level: 1, name: nombreCompleto })).toBeVisible();

  // 2. Sus datos y su mensualidad: el estado depende del día del mes, así que se acepta «Al día» o «Por vencer»; el vencimiento es el fin del mes.
  const misDatos = page.getByRole('region', { name: 'Mis datos' });
  await expect(misDatos).toContainText(nombreCompleto);
  await expect(misDatos).toContainText(`DNI: ${datos.alumno.dni}`);
  await expect(misDatos).toContainText(/\d+ años/);
  await expect(misDatos).toContainText('Nivel: Básico');

  const mensualidad = page.getByRole('region', { name: 'Mi mensualidad' });
  await expect(mensualidad).toContainText(/Al día|Por vencer/);
  await expect(mensualidad).toContainText(datos.planNombre);
  await expect(mensualidad).toContainText(datos.claseTexto);
  await expect(mensualidad).toContainText(/Clases: \d+ de 8 usadas · te quedan \d+/);
  await expect(mensualidad).toContainText(`Vence el ${datos.venceElTexto}`);

  // 3. Su asistencia con la hora: el mes en curso, o el anterior si hoy es 1 (no hay un día pasado dentro del mes).
  const asistencia = page.getByRole('region', { name: 'Mi asistencia' });
  await expect(asistencia.getByLabel('Mes')).toBeVisible();
  if (datos.mesDeLaAsistencia !== datos.mesEnCurso) {
    await asistencia.getByLabel('Mes').selectOption(datos.mesDeLaAsistencia);
  }
  const dias = asistencia.getByRole('list', { name: /^Asistencia de / });
  const dia = dias.getByRole('listitem').filter({ hasText: datos.fechaDeLaAsistenciaTexto });
  await expect(dia).toContainText('Clase de 18:00 a 19:00');
  await expect(dia).toContainText('Puntual');
  await expect(dia).toContainText(`Llegó a las ${datos.horaDeLlegada}`);
  await expect(asistencia.getByText('Puntual', { exact: true }).first()).toBeVisible();

  // 4. Sin datos del hermano: ni su nombre ni la hora a la que llegó él. Tampoco nada que edite: solo lectura (D-14).
  const cuerpo = page.locator('body');
  await expect(cuerpo).not.toContainText(datos.hermano.nombres);
  await expect(cuerpo).not.toContainText(datos.hermano.dni);
  await expect(cuerpo).not.toContainText(datos.horaDeLlegadaDelHermano);
  await expect(page.getByText('Para corregir tus datos o cambiar tu horario, acércate a recepción.')).toBeVisible();
  await expect(page.getByRole('main').locator('input, textarea')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Mi carnet/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cambiar contraseña' })).toBeVisible();

  // 5. Desde el celular (360 px) nada desborda la pantalla.
  await verificarSinDesplazamientoHorizontal(page);

  // 6. Cierra sesión: vuelve al ingreso de su academia y la sesión ya no abre el panel.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(new RegExp(`/a/${datos.nombreCorto}/ingresar$`));
  await page.goto('/panel');
  await expect(page.getByRole('heading', { name: 'Entra por el enlace de tu academia' })).toBeVisible();
});
