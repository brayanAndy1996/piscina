import type { EstadoConCarnet, NivelNatacion } from '@aquagestion/contratos';
import type { TransaccionAcademia } from '../../infraestructura/prisma';
import { PATRON_UUID } from '../../comun/validacion/patron-uuid';
import { alumnoNoEncontrado } from './errores';

/** Lo que el panel necesita del alumno de la sesión. Las fechas van como texto `AAAA-MM-DD`, sin zona. */
export interface AlumnoDeLaSesion {
  readonly id: string;
  readonly nombres: string;
  readonly apellidos: string;
  readonly dni: string;
  readonly nivel: NivelNatacion;
  readonly estado: EstadoConCarnet;
  readonly fechaNacimiento: string;
}

interface FilaDelAlumnoDeLaSesion {
  id: string;
  nombres: string;
  apellidos: string;
  dni: string;
  nivel: NivelNatacion;
  estado: EstadoConCarnet;
  fecha_nacimiento: string;
}

/**
 * El alumno de la sesión (spec 011, criterio 2): la única fila de `alumnos` con la academia de la transacción, el `usuario_id` de la cuenta de la sesión y un estado
 * distinto de `CLIENTE`. Es la primera sentencia de las lecturas del panel y el único origen del id del alumno: nunca sale de la dirección, de la consulta, del
 * cuerpo ni de una cabecera. Sin filas, el mismo 404 de la 008. Con más de una (el índice único del criterio 1 lo impide), falla cerrada con un error interno
 * (500 sin datos). Sin bloqueos.
 */
export async function leerAlumnoDeLaSesion(tx: TransaccionAcademia, usuarioId: string): Promise<AlumnoDeLaSesion> {
  // Un id que no es UUID no se consulta: el mismo 404 (la sesión siempre trae un UUID).
  if (!PATRON_UUID.test(usuarioId)) throw alumnoNoEncontrado();
  const filas = await tx.cliente.$queryRaw<FilaDelAlumnoDeLaSesion[]>`
    SELECT id::text AS id, nombres, apellidos, dni, nivel::text AS nivel, estado::text AS estado,
           to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento
      FROM alumnos
     WHERE academia_id = ${tx.academiaId}::uuid AND usuario_id = ${usuarioId}::uuid AND estado <> 'CLIENTE'
     LIMIT 2`;
  const fila = filas[0];
  if (fila === undefined) throw alumnoNoEncontrado();
  if (filas.length > 1) throw new Error('La cuenta de la sesión está unida a más de un alumno.');
  return {
    id: fila.id,
    nombres: fila.nombres,
    apellidos: fila.apellidos,
    dni: fila.dni,
    nivel: fila.nivel,
    estado: fila.estado,
    fechaNacimiento: fila.fecha_nacimiento,
  };
}
