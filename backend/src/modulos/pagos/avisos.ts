import { esMenorDeEdad } from '@aquagestion/contratos';
import type { PinoLogger } from 'nestjs-pino';
import { hoyEnLima } from '../../comun/fechas';
import { enviarSinEsperar, type EnviadorCorreo } from '../../infraestructura/correo';
import type { TransaccionAcademia } from '../../infraestructura/prisma';

/**
 * Los correos del cobro y de la verificación (spec 007, criterio 51): una vez por cada destinatario distinto entre el correo del alumno y,
 * si es menor, el de su apoderado (DR-13 de 005), con los datos actuales del alumno (DR-8). Se leen dentro de la transacción y se envían
 * **después** de confirmarla, sin esperar (D-19). Ningún correo lleva el DNI ni el token.
 */

export interface DestinatarioDelAviso {
  readonly correos: readonly string[];
  readonly codigo: string;
}

/** La academia que envía, tal como la deja la sesión del actor. */
export interface AcademiaDelAviso {
  readonly id: string;
  readonly nombre: string;
  readonly nombreCorto: string;
}

/** A quién avisar: el correo actual del alumno y, si es menor, el de su apoderado, sin repetir. */
export async function destinatariosDelAviso(
  tx: TransaccionAcademia,
  alumnoId: string,
  codigo: string,
  ahora: Date,
): Promise<DestinatarioDelAviso> {
  const personas = await tx.cliente.$queryRaw<
    { correo: string | null; fecha_nacimiento: string; correo_apoderado: string | null }[]
  >`
    SELECT a.correo, a.fecha_nacimiento::text AS fecha_nacimiento, ap.correo AS correo_apoderado
      FROM alumnos a
      LEFT JOIN apoderados ap ON ap.academia_id = a.academia_id AND ap.alumno_id = a.id
     WHERE a.academia_id = ${tx.academiaId}::uuid AND a.id = ${alumnoId}::uuid`;
  const persona = personas[0];
  const correos: string[] = [];
  if (persona) {
    const menor = esMenorDeEdad(persona.fecha_nacimiento, hoyEnLima(ahora));
    for (const correo of [persona.correo, menor ? persona.correo_apoderado : null]) {
      if (correo !== null && correo !== undefined && correo !== '' && !correos.includes(correo)) correos.push(correo);
    }
  }
  return { correos, codigo };
}

/** `PAGO_CONFIRMADO` (criterio 51 a): sin esperar, ni un proveedor lento ni un fallo cambian la respuesta. */
export function avisarPagoConfirmado(
  correo: EnviadorCorreo,
  registro: PinoLogger,
  academia: AcademiaDelAviso,
  aviso: DestinatarioDelAviso,
): void {
  for (const para of aviso.correos) {
    enviarSinEsperar(
      correo,
      {
        academiaId: academia.id,
        para,
        plantilla: 'PAGO_CONFIRMADO',
        datos: {
          nombreAcademia: academia.nombre,
          codigo: aviso.codigo,
          enlaceDeIngreso: `/a/${academia.nombreCorto}/ingresar`,
          aviso:
            'Tu usuario y tu contraseña inicial son tu DNI. Al entrar por primera vez debes cambiar tu contraseña.',
        },
      },
      registro,
    );
  }
}

/**
 * `PAGO_RECHAZADO` (criterio 51 b): el código, el motivo y la indicación de entrar con su enlace o con el código y su DNI para subir otro
 * comprobante. No lleva el enlace de seguimiento: el token no se guarda.
 */
export function avisarPagoRechazado(
  correo: EnviadorCorreo,
  registro: PinoLogger,
  academia: AcademiaDelAviso,
  aviso: DestinatarioDelAviso,
  motivo: string,
): void {
  for (const para of aviso.correos) {
    enviarSinEsperar(
      correo,
      {
        academiaId: academia.id,
        para,
        plantilla: 'PAGO_RECHAZADO',
        datos: {
          nombreAcademia: academia.nombre,
          codigo: aviso.codigo,
          motivo,
          indicacion:
            'Para subir otro comprobante, entra con tu enlace de seguimiento o consulta tu solicitud con tu código y tu DNI.',
        },
      },
      registro,
    );
  }
}
