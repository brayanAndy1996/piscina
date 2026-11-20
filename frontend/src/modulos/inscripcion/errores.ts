import { cotizacionSchema } from '@aquagestion/contratos';
import { z } from 'zod';

/** Lo que traen los `detalles` de los 409 del envío (criterios 14, 17, 19 y 23 de 005). Un detalle que no cumple se ignora. */

const sinCupo = z.object({ clasesSinCupo: z.array(z.string()) });
const montoCambio = z.object({ cotizacion: cotizacionSchema });
const textosActualizados = z.object({
  version: z.string(),
  textos: z.object({ DATOS_PERSONALES: z.string(), DESLINDE: z.string(), IMAGEN: z.string() }),
});
const yaRegistrada = z.object({ codigo: z.string() });

export function clasesSinCupoDe(detalles: unknown): string[] {
  const resultado = sinCupo.safeParse(detalles);
  return resultado.success ? resultado.data.clasesSinCupo : [];
}

export function cotizacionDeMontoCambio(detalles: unknown) {
  const resultado = montoCambio.safeParse(detalles);
  return resultado.success ? resultado.data.cotizacion : null;
}

export function textosActualizadosDe(detalles: unknown) {
  const resultado = textosActualizados.safeParse(detalles);
  return resultado.success ? resultado.data : null;
}

export function codigoDeSolicitudYaRegistrada(detalles: unknown): string | null {
  const resultado = yaRegistrada.safeParse(detalles);
  return resultado.success ? resultado.data.codigo : null;
}
