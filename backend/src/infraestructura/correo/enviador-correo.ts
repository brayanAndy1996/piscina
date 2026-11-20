/** Token para inyectar el enviador de correo: `@Inject(ENVIADOR_CORREO) private readonly correo: EnviadorCorreo` (P7 de 005). */
export const ENVIADOR_CORREO = Symbol('ENVIADOR_CORREO');

/** Las plantillas de correo que existen (la 005 trae la del seguimiento de la solicitud; la 007 y la 010 suman las suyas). */
export type PlantillaDeCorreo = 'SEGUIMIENTO_SOLICITUD';

export interface MensajeDeCorreo {
  /** La academia que envía: el proveedor real arma el remitente y el nombre con ella. */
  readonly academiaId: string;
  /** El destinatario. Es un dato personal: nunca se registra. */
  readonly para: string;
  readonly plantilla: PlantillaDeCorreo;
  /** Lo que la plantilla necesita (por ejemplo `nombreAcademia`, `codigo` y `enlace`). El enlace es una credencial: nunca se registra. */
  readonly datos: Readonly<Record<string, string>>;
}

/**
 * Envío de correo detrás de una interfaz (D-19): el proveedor real se elige con el hosting. Los efectos secundarios (correo, archivos,
 * PDFs) ocurren después de confirmar la transacción, nunca dentro de ella. Quien llama atrapa el fallo y lo registra sin el destinatario
 * ni el enlace.
 */
export interface EnviadorCorreo {
  enviar(mensaje: MensajeDeCorreo): Promise<void>;
}
