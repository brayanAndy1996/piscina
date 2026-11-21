/**
 * Consentimientos de la inscripción (spec 005, criterio 14; D-07, RNF-05, Ley 29733). Los textos y su versión viven aquí para que la API
 * (que guarda la evidencia y compara la versión) y la web (que los muestra) usen los mismos. Son textos genéricos y provisionales (DR-7 de
 * 005): antes de salir a producción, la academia debe revisarlos con un abogado. Con cualquier cambio de redacción se cambia la versión.
 */

/** La versión vigente de los textos. Si el formulario trae otra, la API responde 409 `TEXTOS_ACTUALIZADOS` con los textos vigentes. */
export const VERSION_CONSENTIMIENTOS = '2026-11-v1-provisional';

/** Los tres consentimientos (D-07, sin WhatsApp por D-08): los dos primeros son obligatorios y `IMAGEN` es opcional. */
export const TIPOS_CONSENTIMIENTO = ['DATOS_PERSONALES', 'DESLINDE', 'IMAGEN'] as const;
export type TipoConsentimiento = (typeof TIPOS_CONSENTIMIENTO)[number];

export type TextosConsentimiento = Record<TipoConsentimiento, string>;

/**
 * Los tres textos con el nombre de la academia. El de datos personales nombra de forma expresa los datos de salud y, si la persona es
 * menor de edad, los datos de menores y a su apoderado como quien acepta (RNF-05). El nombre se inserta tal cual: nunca como patrón de
 * reemplazo (`$&`, `%s`).
 */
export function textosConsentimiento(nombreAcademia: string, opciones: { menor: boolean }): TextosConsentimiento {
  const academia = nombreAcademia;
  const quien = opciones.menor
    ? 'Como padre, madre o apoderado de la persona menor de edad que se inscribe, autorizo'
    : 'Autorizo';
  const datosDeMenores = opciones.menor
    ? ' Entiendo que se trata de datos de menores de edad, que reciben una protección reforzada, y que los entrego en su nombre y bajo mi responsabilidad.'
    : '';
  const deslindeQuien = opciones.menor
    ? 'Como padre, madre o apoderado de la persona menor de edad que se inscribe, declaro'
    : 'Declaro';
  const imagenQuien = opciones.menor
    ? 'Como padre, madre o apoderado de la persona menor de edad, autorizo'
    : 'Autorizo';
  return {
    DATOS_PERSONALES:
      `${quien} a ${academia} a tratar mis datos personales, los datos de salud de la ficha médica y mi información de contacto ` +
      'para gestionar la inscripción, los pagos, la asistencia y la atención en caso de emergencia, de acuerdo con la Ley 29733 de ' +
      `Protección de Datos Personales. Los datos de salud solo los verá el personal autorizado de ${academia}.` +
      datosDeMenores,
    DESLINDE:
      `${deslindeQuien} que la persona inscrita se encuentra en condiciones de salud aptas para practicar natación, que la ` +
      `información de su ficha médica es verdadera y que conozco y acepto el reglamento de ${academia}. Libero a ${academia} de ` +
      'responsabilidad por los riesgos propios de la actividad cuando se cumplen las indicaciones del personal.',
    IMAGEN:
      `${imagenQuien} a ${academia} a tomar y usar fotos y videos de las clases con fines de seguimiento del progreso y de ` +
      'comunicación de la academia. Es opcional: no marcarla no impide inscribirse.',
  };
}
