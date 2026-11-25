import { Injectable } from '@nestjs/common';
import {
  type BuscarAlumnos,
  type EstadoConCarnet,
  type NivelNatacion,
  type ResultadoBusquedaAlumnos,
  resultadoBusquedaAlumnosSchema,
} from '@aquagestion/contratos';
import { BaseDatos } from '../../infraestructura/prisma';

/** Cuántos alumnos devuelve la búsqueda como máximo (criterio 16); se piden 21 para saber si hay más. */
const TOPE_DE_RESULTADOS = 20;

interface FilaDeBusqueda {
  id: string;
  nombres: string;
  apellidos: string;
  dni: string;
  estado: EstadoConCarnet;
  nivel: NivelNatacion;
  tiene_foto: boolean;
}

/** Los caracteres que `LIKE` trata como comodines (`%`, `_`) y su escape (`\`, el de `LIKE` por omisión) pasan a ser texto literal. */
export function escaparParaLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (caracter) => `\\${caracter}`);
}

/**
 * La búsqueda de alumnos de la secretaria y el administrador (spec 008a, criterio 16; sección 8.7, DT-8). Una transacción de lectura de la
 * academia de la sesión: sin bloqueos, sin escritura, sin auditoría. Con exactamente 8 dígitos busca ese DNI; si no, busca el texto dentro de
 * «nombres apellidos» y de «apellidos nombres» sin distinguir mayúsculas (sí las tildes) y con `%`, `_` y `\` como caracteres literales. Solo
 * alumnos (nunca un `CLIENTE`, RN-05). El texto buscado no se registra en ninguna parte.
 */
@Injectable()
export class BusquedaService {
  constructor(private readonly baseDatos: BaseDatos) {}

  async buscar(academiaId: string, datos: BuscarAlumnos): Promise<ResultadoBusquedaAlumnos> {
    const texto = datos.texto;
    const filas = await this.baseDatos.conAcademia(academiaId, async (tx) => {
      if (/^[0-9]{8}$/.test(texto)) {
        return tx.cliente.$queryRaw<FilaDeBusqueda[]>`
          SELECT id::text AS id, nombres, apellidos, dni, estado::text AS estado, nivel::text AS nivel, (foto_clave IS NOT NULL) AS tiene_foto
            FROM alumnos
           WHERE academia_id = ${tx.academiaId}::uuid AND estado <> 'CLIENTE' AND dni = ${texto}
           ORDER BY apellidos, nombres, id
           LIMIT ${TOPE_DE_RESULTADOS + 1}`;
      }
      const patron = `%${escaparParaLike(texto)}%`;
      return tx.cliente.$queryRaw<FilaDeBusqueda[]>`
        SELECT id::text AS id, nombres, apellidos, dni, estado::text AS estado, nivel::text AS nivel, (foto_clave IS NOT NULL) AS tiene_foto
          FROM alumnos
         WHERE academia_id = ${tx.academiaId}::uuid AND estado <> 'CLIENTE'
           AND ((nombres || ' ' || apellidos) ILIKE ${patron} OR (apellidos || ' ' || nombres) ILIKE ${patron})
         ORDER BY apellidos, nombres, id
         LIMIT ${TOPE_DE_RESULTADOS + 1}`;
    });
    return resultadoBusquedaAlumnosSchema.parse({
      alumnos: filas.slice(0, TOPE_DE_RESULTADOS).map((fila) => ({
        id: fila.id,
        nombres: fila.nombres,
        apellidos: fila.apellidos,
        dni: fila.dni,
        estado: fila.estado,
        nivel: fila.nivel,
        tieneFoto: fila.tiene_foto,
      })),
      hayMas: filas.length > TOPE_DE_RESULTADOS,
    });
  }
}
