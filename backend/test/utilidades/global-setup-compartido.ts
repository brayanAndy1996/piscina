// spec: 001-academias-aislamiento (pruebas protegidas)
import prepararBasePruebas from './global-setup';

/**
 * Preparacion de la base de pruebas compartida por los proyectos `backend-integracion` y `backend-aislado`. Todos los `globalSetup` de los proyectos corren en el mismo
 * proceso y el primero que corra (el orden entre proyectos no esta fijado) deja `DATABASE_URL` igual a `DATABASE_URL_PRUEBAS`, lo que una segunda llamada rechazaria
 * ("es igual a DATABASE_URL"). Si ya esta preparada (ambas variables apuntan a una base cuyo nombre termina en `_pruebas`, y
 * `DATABASE_URL_APP` esta fijada), no se repite; en cualquier otro caso se ejecuta la validacion y las migraciones normales, que
 * rechazan una base de desarrollo.
 */
export default function prepararBasePruebasUnaVez(): void {
  const url = process.env['DATABASE_URL_PRUEBAS'];
  const yaPreparada =
    url !== undefined &&
    url === process.env['DATABASE_URL'] &&
    process.env['DATABASE_URL_APP'] !== undefined &&
    new URL(url).pathname.replace(/^\//, '').endsWith('_pruebas');
  if (!yaPreparada) prepararBasePruebas();
}
