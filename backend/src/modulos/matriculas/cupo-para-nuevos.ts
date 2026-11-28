import { anioYMesEnLima } from '../../comun/fechas';
import type { TransaccionAcademia } from '../../infraestructura/prisma';
import { cupoLibre } from '../mensualidades/dominio/cupo';
import { mesSiguiente } from '../mensualidades/dominio/ventana';
import { contarOcupacion, contarReservasDePrioridad } from './ocupacion';

/**
 * El cupo libre de cada clase para una **inscripción nueva** en el mes `mes` (spec 010d, DT-8; D-06, RN-11): quien se inscribe por el formulario es un
 * `CLIENTE` y nunca es titular de prioridad (DR-12 de 010). Para el mes en curso M es `aforo − ocupación`; para M+1 resta además las reservas de
 * prioridad (los lugares apartados para los titulares). Con otro mes devuelve `aforo − ocupación` (no ocurre: el estado visible y los meses de inscripción
 * ya lo filtraron). Puede dar menos de 0 si el administrador bajó el aforo por debajo de los inscritos (DR-5 de 004): quien lo muestra lo recorta a 0, y
 * se puede tomar la clase si es 1 o más.
 *
 * Es la función común del formulario, del envío y del nuevo intento tras un rechazo: lo que se muestra y lo que se decide no pueden divergir. No bloquea:
 * quien escribe ya llamó a `bloquearClasesParaCupo` (en una sola llamada); el formulario es informativo y cuenta sin bloquear.
 */
export async function cuposParaInscripcionNueva(
  tx: TransaccionAcademia,
  clases: readonly { id: string; aforo: number }[],
  mes: { anio: number; mes: number },
  ahora: Date,
): Promise<Map<string, number>> {
  const cupos = new Map<string, number>();
  if (clases.length === 0) return cupos;
  const ids = clases.map((clase) => clase.id);
  const enCurso = anioYMesEnLima(ahora);
  const siguiente = mesSiguiente(enCurso);
  const esMesSiguiente = mes.anio === siguiente.anio && mes.mes === siguiente.mes;
  const ocupacion = await contarOcupacion(tx, ids, mes, ahora);
  const reservas = esMesSiguiente
    ? await contarReservasDePrioridad(tx, ids, enCurso, ahora)
    : new Map<string, number>();
  for (const clase of clases) {
    cupos.set(
      clase.id,
      cupoLibre({
        aforo: clase.aforo,
        ocupacion: ocupacion.get(clase.id) ?? 0,
        reservas: reservas.get(clase.id) ?? 0,
        esTitular: false,
        esMesSiguiente,
      }),
    );
  }
  return cupos;
}
